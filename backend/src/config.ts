import dotenv from 'dotenv';
import path from 'node:path';

// Procura o .env na pasta atual ou na pasta pai (raiz do projeto)
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumberAllowZero(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === 'true';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const config = {
  port: parseNumber(process.env.PORT, 3001),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/singular',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxUploadSizeBytes: parseNumber(process.env.MAX_UPLOAD_SIZE_MB, 25) * 1024 * 1024,
  syncFallback: process.env.SYNC_FALLBACK === 'true',
  processingForceFallback: parseBoolean(process.env.PROCESSING_FORCE_FALLBACK, false),
  fastPathMinConfidence: parseNumber(process.env.FASTPATH_MIN_CONFIDENCE, 80),
  fastPathMinQuestions: parseNumber(process.env.FASTPATH_MIN_QUESTIONS, 1),
  fastPathMinQuestionChars: parseNumber(process.env.FASTPATH_MIN_QUESTION_CHARS, 10),
  pipelinePythonBin: process.env.PIPELINE_PYTHON_BIN 
    ? path.resolve(process.cwd(), process.env.PIPELINE_PYTHON_BIN.startsWith('./') ? '..' : '', process.env.PIPELINE_PYTHON_BIN)
    : 'python3',
  pipelineEntrypoint: process.env.PIPELINE_ENTRYPOINT 
    ? path.resolve(process.cwd(), process.env.PIPELINE_ENTRYPOINT.startsWith('./') ? '..' : '', process.env.PIPELINE_ENTRYPOINT)
    : '../pipeline/main.py',
  pipelineExtractMinChars: parseNumber(process.env.PIPELINE_EXTRACT_MIN_CHARS, 180),
  pipelineGeminiModel: process.env.PIPELINE_GEMINI_MODEL ?? 'gemini-2.5-flash',
  geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
  classificationEnabled: parseBoolean(process.env.CLASSIFICATION_ENABLED, true),
  classificationModel: process.env.CLASSIFICATION_MODEL ?? 'gemini-2.5-flash',
  classificationBatchSize: clampNumber(parseNumber(process.env.CLASSIFICATION_BATCH_SIZE, 10), 1, 10),
  classificationRequestTimeoutMs: parseNumber(process.env.CLASSIFICATION_REQUEST_TIMEOUT_MS, 30000),
  classificationMaxRetries: Math.max(0, Math.trunc(parseNumberAllowZero(process.env.CLASSIFICATION_MAX_RETRIES, 2))),
  classificationDailyUsdLimit: parseNumberAllowZero(process.env.CLASSIFICATION_DAILY_USD_LIMIT, 1),
  classificationInputUsdPer1M: parseNumberAllowZero(process.env.CLASSIFICATION_INPUT_USD_PER_1M, 0.3),
  classificationOutputUsdPer1M: parseNumberAllowZero(process.env.CLASSIFICATION_OUTPUT_USD_PER_1M, 2.5),
};
