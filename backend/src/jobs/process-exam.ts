import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { basename, resolve, isAbsolute } from 'node:path';
import { config } from '../config.js';
import {
  enqueueExamClassification,
  getExamQueue,
  getSharedRedis,
  EXAM_PROCESS_QUEUE,
  type ProcessExamJobData,
} from './queue.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { db, pool } from '../db/client.js';
import { exams, type NewQuestionRow } from '../db/schema.js';
import type { ExtractionTier } from '../types/exam.js';
import { runFallbackPipeline } from '../services/fallback-pipeline.js';
import {
  inferSubjectByCargoTemplate,
  isValidCargoTemplateId,
} from '../services/config/cargo-templates.js';
import { reconstructLayout } from '../services/parser/layout-engine.js';
import { parseGabarito } from '../services/parser/gabarito-parser.js';
import { extractPdfFragments } from '../services/parser/pdf-extractor.js';
import { evaluateFastPathQuality, parseFastPath } from '../services/parser-fastpath.js';
import { registerWorkerShutdown } from '../utils/lifecycle.js';
import { logError, logInfo } from '../utils/logger.js';

interface QuestionInput {
  order: number;
  questionText: string;
  options: string[];
  correctAnswer?: string;
  sourcePage?: number;
  subject?: string;
  contextText?: string;
  /** Gabarito/pipeline indicam questão que depende de figura/imagem (requiresFigure) ou flag requiresPDF do parser. */
  requiresPdf?: boolean;
}

interface QuestionBuildOptions {
  examId?: string;
  cargoTemplateId?: string;
  gabaritoAnswers?: Record<number, string>;
  /** Ordens marcadas como ANULADA no gabarito (B7/D19). */
  annulledOrders?: Set<number>;
}

// D18 — contrato com services/job-progress.ts (WS-A):
// job.updateProgress({stage, percent, pageCurrent?, pageTotal?})
type ProgressStage = 'extracting' | 'structuring' | 'persisting' | 'classifying';

interface ExamProgressPayload {
  stage: ProgressStage;
  percent: number;
  pageCurrent?: number;
  pageTotal?: number;
}

export interface ProcessExamOutcome {
  ok: boolean;
  /** Mensagem amigável já persistida em exams.error_message quando ok=false. */
  error?: string;
  insertedQuestions?: number;
  tierUsed?: string;
}

/** Exame em `processing` sem heartbeat há mais tempo que isso = órfão (watchdog no boot). */
const PROCESSING_STALE_MS = 30 * 60 * 1000;

async function reportProgress(
  job: Job | undefined,
  payload: ExamProgressPayload,
): Promise<void> {
  if (!job) {
    return;
  }

  try {
    await job.updateProgress(payload);
  } catch (error) {
    logWarning('exam.progress.update_failed', {
      jobId: job.id,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  }
}

/** Mapeia usedPath real do pipeline para o enum extraction_tier (fastpath|repair|gemini). */
function toExtractionTier(usedPath: string | undefined): ExtractionTier {
  const normalized = (usedPath ?? '').toLowerCase();
  if (normalized === 'fastpath') {
    return 'fastpath';
  }
  if (normalized.includes('gemini')) {
    return 'gemini';
  }
  // ollama-*, docling e demais tiers não-Gemini caem no bucket "repair".
  return 'repair';
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

interface GabaritoExtraction {
  answers: Record<number, string>;
  /** Ordens marcadas como ANULADA no gabarito (B7). */
  annulled: Set<number>;
}

async function extractGabaritoAnswers(
  gabaritoPath: string,
  provaType?: string,
): Promise<GabaritoExtraction> {
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

  const annulled = new Set<number>(
    (parsed.annulled ?? []).filter((order) => Number.isInteger(order) && order > 0),
  );

  return { answers, annulled };
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

      // B7/D19: anulada do gabarito → acerto automático no quiz; requiresPdf
      // vem do flag do parser (requiresFigure/hasImage na página).
      const annulled = buildOptions.annulledOrders?.has(questionOrder) ?? false;
      const requiresPdf = item.requiresPdf === true;

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
        annulled,
        requiresPdf,
        hasImage: requiresPdf,
      });
    });

  return rows;
}

/**
 * Entry point do processamento de exame — NUNCA rejeita.
 *
 * Erros internos são mapeados para mensagem amigável, persistidos em
 * exams.error_message (status='failed') e retornados em `ProcessExamOutcome`.
 * Isso protege o call site síncrono (`void processExamJob(...)` em
 * routes/exams.ts — SYNC_FALLBACK) de unhandledRejection; o worker BullMQ
 * re-lança baseado em `ok` para manter a semântica de job failed.
 */
export async function processExamJob(
  data: ProcessExamJobData,
  job?: Job,
): Promise<ProcessExamOutcome> {
  try {
    return await runProcessExam(data, job);
  } catch (error) {
    const technicalMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const userMessage = mapProcessingErrorForUser(error);

    try {
      await examsRepository.updateStatus(data.examId, 'failed', { errorMessage: userMessage });
    } catch (statusError) {
      logError('exam.processing.fail_status_update_failed', {
        examId: data.examId,
        errorMessage: statusError instanceof Error ? statusError.message : 'UNKNOWN_ERROR',
      });
    }

    logError('exam.processing.failed', {
      examId: data.examId,
      errorMessage: technicalMessage,
    });

    return { ok: false, error: userMessage };
  }
}

async function runProcessExam(
  data: ProcessExamJobData,
  job?: Job,
): Promise<ProcessExamOutcome> {
  const exam = await examsRepository.getById(data.examId);
  if (!exam) {
    throw new Error(`EXAM_NOT_FOUND:${data.examId}`);
  }

  const pageTotal = exam.pageStart && exam.pageEnd && exam.pageEnd >= exam.pageStart
    ? exam.pageEnd - exam.pageStart + 1
    : undefined;

  // Stamp de início em parsing_log — o watchdog de boot usa isso para detectar
  // exames órfãos em `processing` (worker crash/stalled, D18).
  await examsRepository.updateStatus(data.examId, 'processing', {
    parsingLog: { v: 1, processingStartedAt: new Date().toISOString() },
  });
  logInfo('exam.processing.started', { examId: data.examId });
  await reportProgress(job, { stage: 'extracting', percent: 10, pageTotal });

  let gabaritoAnswers: Record<number, string> = {};
  let annulledOrders: Set<number> = new Set();
  if (exam.gabaritoPath) {
    try {
      const gabarito = await extractGabaritoAnswers(exam.gabaritoPath, exam.provaType);
      gabaritoAnswers = gabarito.answers;
      annulledOrders = gabarito.annulled;
      logInfo('exam.gabarito.processed', {
        examId: data.examId,
        gabaritoAnswers: Object.keys(gabaritoAnswers).length,
        gabaritoAnnulled: annulledOrders.size,
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
        requiresPdf: question.requiresPdf,
      })),
      {
        examId: data.examId,
        cargoTemplateId: exam.cargoTemplateId,
        gabaritoAnswers,
        annulledOrders,
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
    await reportProgress(job, { stage: 'persisting', percent: 80, pageTotal });
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
      // null limpa erro de tentativa anterior (D24 — updateStatus null-aware via WS-A).
      errorMessage: null!,
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
      await reportProgress(job, { stage: 'classifying', percent: 95, pageTotal });
      void enqueueExamClassification({ examId: data.examId }).catch((error) => {
        logError('classification.enqueue.failed', {
          examId: data.examId,
          errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        });
      });
    }

    return { ok: true, insertedQuestions, tierUsed: 'fastpath' };
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

  await reportProgress(job, { stage: 'extracting', percent: 20, pageTotal });

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

  await reportProgress(job, { stage: 'structuring', percent: 60, pageTotal });

  const mappedPipelineQuestions = toNewQuestionRows(
    data.examId,
    pipelineResult.questions.map((question) => ({
      order: question.order,
      questionText: question.questionText,
      options: question.options,
      correctAnswer: question.correctAnswer,
      sourcePage: question.sourcePage,
      contextText: question.contextText,
      // requiresFigure (D10) atravessa o PipelineResult via JSON mesmo não
      // estando na interface — services/fallback-pipeline.ts é de outro WS.
      requiresPdf: (question as { requiresFigure?: boolean }).requiresFigure,
    })),
    {
      examId: data.examId,
      cargoTemplateId: exam.cargoTemplateId,
      gabaritoAnswers,
      annulledOrders,
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

  await reportProgress(job, { stage: 'persisting', percent: 90, pageTotal });
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
    // null limpa erro de tentativa anterior (D24 — updateStatus null-aware via WS-A).
    errorMessage: null!,
    // Grava o usedPath REAL reportado pelo pipeline (era hardcoded 'gemini').
    extractionTier: toExtractionTier(pipelineResult.usedPath),
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
    await reportProgress(job, { stage: 'classifying', percent: 95, pageTotal });
    void enqueueExamClassification({ examId: data.examId }).catch((error) => {
      logError('classification.enqueue.failed', {
        examId: data.examId,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    });
  }

  return { ok: true, insertedQuestions, tierUsed: pipelineResult.usedPath };
}

/** Marca exame como failed sem sobrescrever uma falha já registrada (idempotente). */
async function ensureExamFailed(examId: string, error: unknown): Promise<void> {
  try {
    const exam = await examsRepository.getById(examId);
    if (!exam || exam.status === 'failed') {
      return;
    }

    await examsRepository.updateStatus(examId, 'failed', {
      errorMessage: mapProcessingErrorForUser(error),
    });
    logError('exam.processing.failed.worker_event', {
      examId,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  } catch (statusError) {
    logError('exam.processing.fail_status_update_failed', {
      examId,
      errorMessage: statusError instanceof Error ? statusError.message : 'UNKNOWN_ERROR',
    });
  }
}

/**
 * Watchdog de boot (D18): exames em `processing` cujo início (stamp em
 * parsing_log.processingStartedAt, fallback createdAt) passou de 30min são
 * órfãos — worker morreu antes de concluir. Marcados `failed` com mensagem
 * amigável para destravar a fila (reprocess aceita failed).
 *
 * Jobs ainda enfileirados (waiting/delayed/prioritized) são preservados — o
 * exame vai ser processado por um job vivo.
 */
export async function recoverStaleProcessingExams(): Promise<void> {
  const staleRows = await db
    .select({
      id: exams.id,
      parsingLog: exams.parsingLog,
      createdAt: exams.createdAt,
    })
    .from(exams)
    .where(eq(exams.status, 'processing'));

  if (staleRows.length === 0) {
    return;
  }

  const now = Date.now();
  const queue = getExamQueue();

  for (const row of staleRows) {
    const stamped = row.parsingLog?.['processingStartedAt'];
    const stampedMs = typeof stamped === 'string' ? Date.parse(stamped) : Number.NaN;
    const referenceMs = Number.isFinite(stampedMs) ? stampedMs : row.createdAt.getTime();
    const ageMs = now - referenceMs;

    if (ageMs <= PROCESSING_STALE_MS) {
      continue;
    }

    let jobState = 'missing';
    try {
      const job = await queue.getJob(row.id);
      jobState = job ? await job.getState() : 'missing';
    } catch (error) {
      logError('exam.watchdog.job_lookup_failed', {
        examId: row.id,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    }

    // Job ainda vai rodar (re-enfileirado/retry) — não marca failed.
    if (jobState === 'waiting' || jobState === 'delayed' || jobState === 'prioritized' || jobState === 'waiting-children') {
      continue;
    }

    await examsRepository.updateStatus(row.id, 'failed', {
      errorMessage: 'Processamento expirado. Reprocessar a prova para tentar novamente.',
    });
    logError('exam.watchdog.stale_processing_failed', {
      examId: row.id,
      ageMs,
      jobState,
    });
  }
}

export function startExamWorker(workerConnection?: Redis): Worker {
  const connection = workerConnection ?? new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    EXAM_PROCESS_QUEUE,
    async (job) => {
      const data = job.data as ProcessExamJobData;
      const result = await processExamJob(data, job);

      // processExamJob já persistiu status=failed + mensagem; re-lança para o
      // BullMQ registrar a falha do job (failedReason visível no progress DTO).
      if (!result.ok) {
        throw new Error(result.error ?? 'PROCESSING_FAILED');
      }
    },
    {
      connection,
      concurrency: 1, // Reduced from 2 to 1 to prevent GPU (VRAM) lock-ups
    },
  );

  // Falha de job fora do processExamJob (crash, stall excedido, erro interno
  // BullMQ) → garante que o exame não fica preso em `processing` (D18).
  worker.on('failed', (job, error) => {
    const examId = (job?.data as ProcessExamJobData | undefined)?.examId;
    if (examId) {
      void ensureExamFailed(examId, error);
    }
  });

  worker.on('error', (error) => {
    logError('worker.error', {
      queue: EXAM_PROCESS_QUEUE,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  });

  return worker;
}

if (process.argv[1] && process.argv[1].includes('process-exam')) {
  logInfo('worker.queue.auto_cleanup.disabled', { queue: EXAM_PROCESS_QUEUE });

  const workerConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
  const worker = startExamWorker(workerConnection);

  void recoverStaleProcessingExams().catch((error) => {
    logError('exam.watchdog.failed', {
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  });

  registerWorkerShutdown({
    name: 'exam-worker',
    workers: [worker],
    queues: [getExamQueue()],
    redis: [workerConnection, getSharedRedis()],
    pool,
  });

  logInfo('worker.started', { queue: EXAM_PROCESS_QUEUE });
}
