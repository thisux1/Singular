import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Paths resolved relative to THIS FILE, never process.cwd() (D22 — cwd-dependence era bug).
// moduleDir = <repo>/backend/src
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(moduleDir, '..');
const repoRoot = path.resolve(backendRoot, '..');

// .env loading independente de cwd. dotenv NÃO sobrescreve vars já setadas,
// então backend/.env tem precedência sobre a raiz (mesma semântica anterior).
dotenv.config({ path: path.resolve(backendRoot, '.env') });
dotenv.config({ path: path.resolve(repoRoot, '.env') });

// Strings vazias em env são tratadas como "não definido" → default aplica.
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const positiveNumber = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().positive().default(fallback));

const nonNegativeNumber = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().min(0).default(fallback));

const booleanString = (fallback: boolean) =>
  z.preprocess(emptyToUndefined, z.stringbool().default(fallback));

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().optional(),
);

const envSchema = z.object({
  PORT: positiveNumber(3001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z
    .string()
    .default('postgres://postgres:postgres@localhost:5432/singular'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE_MB: positiveNumber(25),
  SYNC_FALLBACK: booleanString(false),
  PROCESSING_FORCE_FALLBACK: booleanString(false),

  // Escala real é 0–100 (D13). Valores <=1 são tratados abaixo como
  // provável config legada na escala 0–1 e revertem para o default.
  FASTPATH_MIN_CONFIDENCE: positiveNumber(80),
  FASTPATH_MIN_QUESTIONS: positiveNumber(1),
  FASTPATH_MIN_QUESTION_CHARS: positiveNumber(10),

  PIPELINE_PYTHON_BIN: optionalString,
  PIPELINE_ENTRYPOINT: optionalString,
  PIPELINE_EXTRACT_MIN_CHARS: positiveNumber(180),
  PIPELINE_GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_API_KEY: optionalString,
  GOOGLE_API_KEY: optionalString,

  CLASSIFICATION_ENABLED: booleanString(true),
  CLASSIFICATION_MODEL: z.string().default('gemini-2.5-flash'),
  CLASSIFICATION_BATCH_SIZE: positiveNumber(10),
  CLASSIFICATION_REQUEST_TIMEOUT_MS: positiveNumber(30000),
  CLASSIFICATION_MAX_RETRIES: nonNegativeNumber(2),
  CLASSIFICATION_DAILY_USD_LIMIT: nonNegativeNumber(1),
  CLASSIFICATION_INPUT_USD_PER_1M: nonNegativeNumber(0.3),
  CLASSIFICATION_OUTPUT_USD_PER_1M: nonNegativeNumber(2.5),

  // ---------- Auth (D6) ----------
  AUTH_DISABLED: booleanString(true),
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5190,http://localhost:5173'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  GCS_BUCKET: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(`[FATAL] config.invalid_env — variáveis de ambiente inválidas:\n${issues}`);
  throw new Error('Invalid environment configuration (config.invalid_env)');
}

const env = parsed.data;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Paths relativos a env resolvem contra backendRoot; absolutos passam direto.
function resolveBackendPath(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(backendRoot, raw);
}

// PIPELINE_PYTHON_BIN aceita path absoluto OU path relativo (resolvido contra
// o repo root) OU nome de binário (resolvido via PATH no boot do worker — D7).
function resolvePythonBin(raw: string | undefined): string {
  if (raw !== undefined) {
    if (path.isAbsolute(raw)) {
      return raw;
    }

    if (raw.includes('/') || raw.includes('\\')) {
      return path.resolve(repoRoot, raw);
    }

    return raw;
  }

  const venvPython = path.join(repoRoot, '.venv', 'bin', 'python');
  return existsSync(venvPython) ? venvPython : 'python3';
}

// D13: valor <= 1 indica config legada na escala 0–1 → warning + default 80.
function resolveFastPathMinConfidence(value: number): number {
  if (value <= 1) {
    console.warn(
      `[WARN] config.fastpath_confidence_legacy_scale — FASTPATH_MIN_CONFIDENCE=${value} ` +
        'parece estar na escala 0–1 (provável config errada legada; escala atual é 0-100). ' +
        'Usando default 80.',
    );
    return 80;
  }

  return value;
}

const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const trustedOrigins = [...new Set([...corsOrigins, env.FRONTEND_URL])];

export const config = {
  port: env.PORT,
  redisUrl: env.REDIS_URL,
  databaseUrl: env.DATABASE_URL,
  uploadDir: resolveBackendPath(env.UPLOAD_DIR, path.join(backendRoot, 'uploads')),
  maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  syncFallback: env.SYNC_FALLBACK,
  processingForceFallback: env.PROCESSING_FORCE_FALLBACK,
  fastPathMinConfidence: resolveFastPathMinConfidence(env.FASTPATH_MIN_CONFIDENCE),
  fastPathMinQuestions: env.FASTPATH_MIN_QUESTIONS,
  fastPathMinQuestionChars: env.FASTPATH_MIN_QUESTION_CHARS,
  pipelinePythonBin: resolvePythonBin(env.PIPELINE_PYTHON_BIN),
  pipelineEntrypoint: resolveBackendPath(
    env.PIPELINE_ENTRYPOINT,
    path.join(repoRoot, 'pipeline', 'main.py'),
  ),
  pipelineExtractMinChars: env.PIPELINE_EXTRACT_MIN_CHARS,
  pipelineGeminiModel: env.PIPELINE_GEMINI_MODEL,
  geminiApiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
  classificationEnabled: env.CLASSIFICATION_ENABLED,
  classificationModel: env.CLASSIFICATION_MODEL,
  classificationBatchSize: clampNumber(env.CLASSIFICATION_BATCH_SIZE, 1, 10),
  classificationRequestTimeoutMs: env.CLASSIFICATION_REQUEST_TIMEOUT_MS,
  classificationMaxRetries: Math.trunc(env.CLASSIFICATION_MAX_RETRIES),
  classificationDailyUsdLimit: env.CLASSIFICATION_DAILY_USD_LIMIT,
  classificationInputUsdPer1M: env.CLASSIFICATION_INPUT_USD_PER_1M,
  classificationOutputUsdPer1M: env.CLASSIFICATION_OUTPUT_USD_PER_1M,

  // ---------- Auth (D6) ----------
  authDisabled: env.AUTH_DISABLED,
  betterAuthSecret: env.BETTER_AUTH_SECRET,
  betterAuthUrl: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  corsOrigins,
  trustedOrigins,
  frontendUrl: env.FRONTEND_URL,
  gcsBucket: env.GCS_BUCKET,

  /** Absoluto — usado por src/db/migrate.ts sem depender de cwd. */
  migrationsFolder: path.join(backendRoot, 'drizzle'),
} as const;

export type AppConfig = typeof config;
