import fs from 'node:fs/promises';
import { extractPdfFragments } from './parser/pdf-extractor.js';
import { reconstructLayout } from './parser/layout-engine.js';
import { parseQuestions } from './parser/question-parser.js';
import { logError, logInfo } from '../utils/logger.js';

export interface ParsedQuestion {
  order: number;
  questionText: string;
  options: string[];
  correctAnswer?: string;
  sourcePage?: number;
  contextText?: string;
}

export interface FastPathResult {
  totalQuestions: number;
  confidence: number;
  questions: ParsedQuestion[];
}

export interface FastPathQualityResult {
  acceptable: boolean;
  reason?: string;
}

interface EvaluateFastPathQualityInput {
  minConfidence: number;
  minQuestions: number;
  minQuestionChars: number;
}

interface ParseFastPathInput {
  examId: string;
  filePath: string;
  pageStart?: number;
  pageEnd?: number;
}

export async function parseFastPath(input: ParseFastPathInput): Promise<FastPathResult> {
  const startedAt = Date.now();

  try {
    const fileBuffer = await fs.readFile(input.filePath);
    
    // Step 1: Raw extraction using pdfjs-dist
    const extracted = await extractPdfFragments(fileBuffer, undefined, {
      pageStart: input.pageStart,
      pageEnd: input.pageEnd,
    });
    
    // Step 2: Line Reconstruction & Column detection
    const { lines } = reconstructLayout(extracted);
    
    // Step 3: Parse questions via regex state machine
    const { questions, sharedTexts } = parseQuestions(lines, extracted.pageInfo as any);
    
    if (questions.length === 0) {
      return { totalQuestions: 0, confidence: 0, questions: [] };
    }

    // Step 4: Map back to FastPath schema and average confidence
    let totalConfidence = 0;
    const mappedQuestions: ParsedQuestion[] = questions.map((q: any) => {
      totalConfidence += q.confidenceScore || 0;
      
      const optionsArr = [];
      if (q.options.A) optionsArr.push('A) ' + q.options.A);
      if (q.options.B) optionsArr.push('B) ' + q.options.B);
      if (q.options.C) optionsArr.push('C) ' + q.options.C);
      if (q.options.D) optionsArr.push('D) ' + q.options.D);
      if (q.options.E) optionsArr.push('E) ' + q.options.E);

      let questionText = q.text;
      
      let contextText = undefined;
      if (q.sharedTextId && sharedTexts) {
        const shared = sharedTexts.find((s: any) => s.id === q.sharedTextId);
        if (shared && shared.text) {
          contextText = shared.text;
        }
      }

      return {
        order: q.id,
        questionText: questionText,
        options: optionsArr,
        sourcePage: q.page,
        contextText: contextText,
      };
    });

    const averageConfidence = totalConfidence / questions.length;

    const durationMs = Date.now() - startedAt;
    logInfo('exam.parsing.fastpath.metrics', {
      v: 1,
      examId: input.examId,
      durationMs,
      questionsExtracted: mappedQuestions.length,
      confidence: averageConfidence,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
    });

    return {
      totalQuestions: mappedQuestions.length,
      confidence: averageConfidence, // 0 to 100
      questions: mappedQuestions,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logError('exam.parsing.fastpath.failed', {
      v: 1,
      examId: input.examId,
      filePath: input.filePath,
      durationMs,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });

    logInfo('exam.parsing.fastpath.metrics', {
      v: 1,
      examId: input.examId,
      durationMs,
      questionsExtracted: 0,
      confidence: 0,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
    });

    return {
      totalQuestions: 0,
      confidence: 0,
      questions: [],
    };
  }
}

export function evaluateFastPathQuality(
  parsed: FastPathResult,
  input: EvaluateFastPathQualityInput,
): FastPathQualityResult {
  if (parsed.totalQuestions < input.minQuestions) {
    return {
      acceptable: false,
      reason: `LOW_QUESTION_COUNT:${parsed.totalQuestions}`,
    };
  }

  if (parsed.confidence < input.minConfidence) {
    return {
      acceptable: false,
      reason: `LOW_CONFIDENCE:${parsed.confidence}`,
    };
  }

  const hasQuestionBelowThreshold = parsed.questions.some(
    (question) => question.questionText.trim().length < input.minQuestionChars,
  );

  if (hasQuestionBelowThreshold) {
    return {
      acceptable: false,
      reason: 'LOW_TEXT_QUALITY',
    };
  }

  return {
    acceptable: true,
  };
}
