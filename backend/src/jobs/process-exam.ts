import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { basename, resolve, isAbsolute } from 'node:path';
import { config } from '../config.js';
import { enqueueExamClassification, EXAM_PROCESS_QUEUE, type ProcessExamJobData } from './queue.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import type { NewQuestionRow } from '../db/schema.js';
import { runFallbackPipeline } from '../services/fallback-pipeline.js';
import {
  inferSubjectByCargoTemplate,
  isValidCargoTemplateId,
} from '../services/config/cargo-templates.js';
import { reconstructLayout } from '../services/parser/layout-engine.js';
import { parseGabarito } from '../services/parser/gabarito-parser.js';
import { extractPdfFragments } from '../services/parser/pdf-extractor.js';
import { evaluateFastPathQuality, parseFastPath } from '../services/parser-fastpath.js';
import { logError, logInfo } from '../utils/logger.js';

interface QuestionInput {
  order: number;
  questionText: string;
  options: string[];
  correctAnswer?: string;
  sourcePage?: number;
  subject?: string;
  contextText?: string;
}

interface QuestionBuildOptions {
  examId?: string;
  cargoTemplateId?: string;
  gabaritoAnswers?: Record<number, string>;
}

type ParsingHealth = 'healthy' | 'degraded' | 'poor';

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeOption(value: string): string {
  return normalizeText(value).replace(/^[a-e]\s*[\)\.:\-]?\s*/i, '');
}

function computeContentHash(questionText: string, options: string[]): string {
  const normalizedQuestion = normalizeText(questionText);
  const normalizedOptions = options.map((option) => normalizeOption(option)).sort();
  const payload = `${normalizedQuestion}||${normalizedOptions.join('||')}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function parseCorrectAnswer(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  const match = /^([A-E])$/.exec(normalized) ?? /^([A-E])[\)\.:\-\s]/.exec(normalized);
  return match?.[1];
}

function logWarning(event: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.warn(`[WARN] ${event}`, payload);
    return;
  }

  console.warn(`[WARN] ${event}`);
}

function mapProcessingErrorForUser(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const normalized = rawMessage.toLowerCase();

  if (rawMessage === 'ZERO_VALID_QUESTIONS') {
    return 'Nenhuma questão identificada. Verifique se o arquivo contém questões objetivas e ajuste faixa de páginas/template.';
  }

  if (
    normalized.includes('invalidpdf')
    || normalized.includes('invalid pdf')
    || normalized.includes('pipeline_input')
    || normalized.includes('pipeline input')
    || normalized.includes('pdf')
    || normalized.includes('parser')
    || normalized.includes('pipeline_')
  ) {
    return 'Arquivo não processável. Use PDF ou imagem legível com questões objetivas.';
  }

  const shortMessage = rawMessage.length > 220
    ? `${rawMessage.slice(0, 217)}...`
    : rawMessage;

  return shortMessage;
}

function logGabaritoQuality(params: {
  examId: string;
  gabaritoPath: string;
  provaType: string | null;
  gabaritoAnswersCount: number;
  extractedQuestions: number;
  matchedQuestions: number;
}): void {
  const coverage = params.extractedQuestions > 0
    ? Number((params.matchedQuestions / params.extractedQuestions).toFixed(4))
    : 0;

  logInfo('exam.gabarito.quality', {
    examId: params.examId,
    provaType: params.provaType,
    gabaritoFile: basename(params.gabaritoPath),
    gabaritoAnswers: params.gabaritoAnswersCount,
    extractedQuestions: params.extractedQuestions,
    matchedQuestions: params.matchedQuestions,
    coverage,
  });

  if (params.gabaritoAnswersCount === 0) {
    logWarning('exam.gabarito.zero_answers', {
      examId: params.examId,
      provaType: params.provaType,
      gabaritoFile: basename(params.gabaritoPath),
      extractedQuestions: params.extractedQuestions,
      matchedQuestions: params.matchedQuestions,
    });
  }
}

function getQuestionsExpected(examHasGabarito: boolean, gabaritoAnswers: Record<number, string>): number | null {
  if (!examHasGabarito) {
    return null;
  }

  return Object.keys(gabaritoAnswers).length;
}

function emitParsingTelemetry(params: {
  examId: string;
  tierUsed: string;
  durationMs: number;
  questionsExtracted: number;
  questionsExpected: number | null;
  costUsd: number;
  health: ParsingHealth;
  fallbackReason?: string;
}): void {
  logInfo('exam.processing.tier_used', {
    v: 1,
    examId: params.examId,
    tierUsed: params.tierUsed,
    durationMs: params.durationMs,
    questionsExtracted: params.questionsExtracted,
    questionsExpected: params.questionsExpected,
    costUsd: params.costUsd,
    fallbackReason: params.fallbackReason,
  });

  logInfo('exam.parsing.health', {
    v: 1,
    examId: params.examId,
    health: params.health,
    tierUsed: params.tierUsed,
    durationMs: params.durationMs,
    questionsExtracted: params.questionsExtracted,
    questionsExpected: params.questionsExpected,
    costUsd: params.costUsd,
    fallbackReason: params.fallbackReason,
  });
}

function buildParsingLog(params: {
  durationMs: number;
  questionsExtracted: number;
  questionsExpected: number | null;
  costUsd: number;
  health: ParsingHealth;
  tierUsed: string;
  fallbackReason?: string;
}): Record<string, unknown> {
  return {
    v: 1,
    durationMs: params.durationMs,
    questionsExtracted: params.questionsExtracted,
    questionsExpected: params.questionsExpected,
    costUsd: params.costUsd,
    health: params.health,
    tierUsed: params.tierUsed,
    ...(params.fallbackReason ? { fallbackReason: params.fallbackReason } : {}),
  };
}

async function extractGabaritoAnswers(
  gabaritoPath: string,
  provaType?: string,
): Promise<Record<number, string>> {
  const absolutePath = isAbsolute(gabaritoPath) ? gabaritoPath : resolve(process.cwd(), gabaritoPath);
  const fileBuffer = await fs.readFile(absolutePath);
  const extracted = await extractPdfFragments(fileBuffer);
  const { lines } = reconstructLayout(extracted);
  const parsed = parseGabarito(lines, provaType ?? null);

  const answers: Record<number, string> = {};
  for (const [key, value] of Object.entries(parsed.gabaritoMap ?? {})) {
    const order = Number.parseInt(key, 10);
    const normalizedAnswer = parseCorrectAnswer(String(value));
    if (Number.isInteger(order) && order > 0 && normalizedAnswer) {
      answers[order] = normalizedAnswer;
    }
  }

  return answers;
}

function toNewQuestionRows(
  examId: string,
  items: QuestionInput[],
  buildOptions: QuestionBuildOptions = {},
): NewQuestionRow[] {
  const rows: NewQuestionRow[] = [];
  const canInferSubject =
    typeof buildOptions.cargoTemplateId === 'string' && isValidCargoTemplateId(buildOptions.cargoTemplateId);
  const gabaritoAnswers = buildOptions.gabaritoAnswers ?? {};

  items.forEach((item, index) => {
      const questionText = item.questionText.trim();
      const questionOptions = item.options
        .map((option) => option.trim())
        .filter((option, optionIndex, list) => option.length > 0 && list.indexOf(option) === optionIndex);

      if (questionText.length === 0 || questionOptions.length < 2) {
        return;
      }

      const questionOrder = item.order > 0 ? item.order : index + 1;
      const parsedCorrectAnswer = parseCorrectAnswer(item.correctAnswer);
      const gabaritoCorrectAnswer = gabaritoAnswers[questionOrder];

      if (gabaritoCorrectAnswer && parsedCorrectAnswer && gabaritoCorrectAnswer !== parsedCorrectAnswer) {
        logWarning('exam.gabarito.answer_mismatch', {
          examId: buildOptions.examId,
          questionOrder,
          explicitAnswer: parsedCorrectAnswer,
          gabaritoAnswer: gabaritoCorrectAnswer,
        });
      }

      const finalCorrectAnswer = gabaritoCorrectAnswer ?? parsedCorrectAnswer ?? null;
      const gabaritoMatched = Boolean(gabaritoCorrectAnswer);

      const normalizedSubject = typeof item.subject === 'string' ? item.subject.trim() : '';
      const inferredSubject = canInferSubject && normalizedSubject.length === 0
        ? inferSubjectByCargoTemplate(buildOptions.cargoTemplateId!, questionOrder)
        : undefined;

      rows.push({
        examId,
        order: questionOrder,
        questionText,
        options: questionOptions,
        correctAnswer: finalCorrectAnswer,
        gabaritoMatched,
        subject: normalizedSubject || inferredSubject || null,
        sourcePage: item.sourcePage ?? null,
        contextText: item.contextText ?? null,
        contentHash: computeContentHash(questionText, questionOptions),
      });
    });

  return rows;
}

export async function processExamJob(data: ProcessExamJobData): Promise<void> {
  const exam = await examsRepository.getById(data.examId);
  if (!exam) {
    throw new Error(`EXAM_NOT_FOUND:${data.examId}`);
  }

  await examsRepository.updateStatus(data.examId, 'processing');
  logInfo('exam.processing.started', { examId: data.examId });

  let gabaritoAnswers: Record<number, string> = {};
  if (exam.gabaritoPath) {
    try {
      gabaritoAnswers = await extractGabaritoAnswers(exam.gabaritoPath, exam.provaType);
      logInfo('exam.gabarito.processed', {
        examId: data.examId,
        gabaritoAnswers: Object.keys(gabaritoAnswers).length,
      });
    } catch (error) {
      logError('exam.gabarito.processing_failed', {
        examId: data.examId,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    }
  }

  const processingStartedAt = Date.now();
  const questionsExpected = getQuestionsExpected(Boolean(exam.gabaritoPath), gabaritoAnswers);

  const parsed = await parseFastPath({
    examId: data.examId,
    filePath: exam.filePath,
    pageStart: exam.pageStart,
    pageEnd: exam.pageEnd,
  });

  const quality = evaluateFastPathQuality(parsed, {
    minConfidence: config.fastPathMinConfidence,
    minQuestions: config.fastPathMinQuestions,
    minQuestionChars: config.fastPathMinQuestionChars,
  });

  const shouldUseFallback = config.processingForceFallback || !quality.acceptable;

  const extractedQuestions = shouldUseFallback
    ? []
    : toNewQuestionRows(
      data.examId,
      parsed.questions.map((question) => ({
        order: question.order,
        questionText: question.questionText,
        options: question.options,
        correctAnswer: question.correctAnswer,
        sourcePage: question.sourcePage,
        contextText: question.contextText,
      })),
      {
        examId: data.examId,
        cargoTemplateId: exam.cargoTemplateId,
        gabaritoAnswers,
      },
      );

  if (exam.gabaritoPath) {
    const gabaritoAnswersCount = Object.keys(gabaritoAnswers).length;
    const matchedQuestions = extractedQuestions.filter((question) => question.gabaritoMatched).length;
    logGabaritoQuality({
      examId: data.examId,
      gabaritoPath: exam.gabaritoPath,
      provaType: exam.provaType ?? null,
      gabaritoAnswersCount,
      extractedQuestions: extractedQuestions.length,
      matchedQuestions,
    });
  }

  if (!shouldUseFallback) {
    const insertedQuestions = await questionsRepository.replaceForExam(data.examId, extractedQuestions);
    const durationMs = Date.now() - processingStartedAt;
    const health: ParsingHealth = quality.acceptable ? 'healthy' : (insertedQuestions > 0 ? 'degraded' : 'poor');
    const parsingLog = buildParsingLog({
      durationMs,
      questionsExtracted: insertedQuestions,
      questionsExpected,
      costUsd: 0,
      health,
      tierUsed: 'fastpath',
    });

    emitParsingTelemetry({
      examId: data.examId,
      tierUsed: 'fastpath',
      durationMs,
      questionsExtracted: insertedQuestions,
      questionsExpected,
      costUsd: 0,
      health,
    });

    logInfo('exam.questions.persisted', {
      examId: data.examId,
      insertedQuestions,
      source: 'fastpath',
    });

    if (insertedQuestions === 0) {
      throw new Error('ZERO_VALID_QUESTIONS');
    }

    const pageOffset = extractedQuestions[0]?.sourcePage ?? undefined;

    await examsRepository.updateStatus(data.examId, 'reviewing', {
      totalQuestions: insertedQuestions,
      pageOffset,
      errorMessage: undefined,
      extractionTier: 'fastpath',
      parsingLog,
    });

    logInfo('exam.processing.completed', {
      examId: data.examId,
      totalQuestions: insertedQuestions,
      confidence: parsed.confidence,
      pipelinePath: 'fastpath',
    });

    if (config.classificationEnabled) {
      void enqueueExamClassification({ examId: data.examId }).catch((error) => {
        logError('classification.enqueue.failed', {
          examId: data.examId,
          errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        });
      });
    }

    return;
  }

  const fallbackReason = config.processingForceFallback
    ? 'FORCED_BY_CONFIG'
    : (quality.reason ?? 'FASTPATH_NOT_ACCEPTABLE');

  logInfo('exam.processing.fallback.triggered', {
    examId: data.examId,
    fallbackReason,
    fastPathConfidence: parsed.confidence,
    fastPathTotalQuestions: parsed.totalQuestions,
  });

  const pipelineResult = await runFallbackPipeline({
    examId: data.examId,
    filePath: exam.filePath,
    fallbackReason,
    pageStart: exam.pageStart,
    pageEnd: exam.pageEnd,
    provaType: exam.provaType,
  });

  if (pipelineResult.status === 'error') {
    throw new Error(`${pipelineResult.errorCode}:${pipelineResult.message}`);
  }

  const mappedPipelineQuestions = toNewQuestionRows(
    data.examId,
    pipelineResult.questions.map((question) => ({
      order: question.order,
      questionText: question.questionText,
      options: question.options,
      correctAnswer: question.correctAnswer,
      sourcePage: question.sourcePage,
      contextText: question.contextText,
    })),
    {
      examId: data.examId,
      cargoTemplateId: exam.cargoTemplateId,
      gabaritoAnswers,
    },
  );

  if (exam.gabaritoPath) {
    const gabaritoAnswersCount = Object.keys(gabaritoAnswers).length;
    const matchedQuestions = mappedPipelineQuestions.filter((question) => question.gabaritoMatched).length;
    logGabaritoQuality({
      examId: data.examId,
      gabaritoPath: exam.gabaritoPath,
      provaType: exam.provaType ?? null,
      gabaritoAnswersCount,
      extractedQuestions: mappedPipelineQuestions.length,
      matchedQuestions,
    });
  }

  const insertedQuestions = await questionsRepository.replaceForExam(data.examId, mappedPipelineQuestions);
  const durationMs = Date.now() - processingStartedAt;
  const health: ParsingHealth = !quality.acceptable && insertedQuestions > 0
    ? 'degraded'
    : (insertedQuestions > 0 ? 'healthy' : 'poor');
  const parsingLog = buildParsingLog({
    durationMs,
    questionsExtracted: insertedQuestions,
    questionsExpected,
    costUsd: 0,
    health,
    tierUsed: pipelineResult.usedPath,
    fallbackReason,
  });

  emitParsingTelemetry({
    examId: data.examId,
    tierUsed: pipelineResult.usedPath,
    durationMs,
    questionsExtracted: insertedQuestions,
    questionsExpected,
    costUsd: 0,
    health,
    fallbackReason,
  });

  logInfo('exam.questions.persisted', {
    examId: data.examId,
    insertedQuestions,
    source: pipelineResult.usedPath,
  });

  if (insertedQuestions === 0) {
    throw new Error('ZERO_VALID_QUESTIONS');
  }

  const pageOffset = mappedPipelineQuestions[0]?.sourcePage ?? undefined;

  await examsRepository.updateStatus(data.examId, 'reviewing', {
    totalQuestions: insertedQuestions,
    pageOffset,
    errorMessage: undefined,
    extractionTier: 'gemini',
    parsingLog,
  });

  logInfo('exam.processing.completed', {
    examId: data.examId,
    totalQuestions: insertedQuestions,
    pipelinePath: pipelineResult.usedPath,
    fallbackTriggered: pipelineResult.fallbackTriggered,
    fallbackReason: pipelineResult.fallbackReason,
    extractionChars: pipelineResult.extractionChars,
  });

  if (config.classificationEnabled) {
    void enqueueExamClassification({ examId: data.examId }).catch((error) => {
      logError('classification.enqueue.failed', {
        examId: data.examId,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    });
  }
}

export function startExamWorker(): Worker {
  const workerConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    EXAM_PROCESS_QUEUE,
    async (job) => {
      const data = job.data as ProcessExamJobData;

      try {
        await processExamJob(data);
      } catch (error) {
        const technicalMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        const userMessage = mapProcessingErrorForUser(error);
        await examsRepository.updateStatus(data.examId, 'failed', { errorMessage: userMessage });
        logError('exam.processing.failed', {
          examId: data.examId,
          errorMessage: technicalMessage,
        });
        throw error;
      }
    },
    {
      connection: workerConnection,
      concurrency: 1, // Reduced from 2 to 1 to prevent GPU (VRAM) lock-ups
    },
  );

  return worker;
}

if (process.argv[1] && process.argv[1].includes('process-exam')) {
  logInfo('worker.queue.auto_cleanup.disabled', { queue: EXAM_PROCESS_QUEUE });
  startExamWorker();
  logInfo('worker.started', { queue: EXAM_PROCESS_QUEUE });
}
