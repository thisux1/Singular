import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config.js';

export interface PipelineQuestion {
  order: number;
  questionText: string;
  options: string[];
  correctAnswer?: string;
  sourcePage?: number;
  contextText?: string;
}

export interface PipelineSuccessResult {
  status: 'ok';
  usedPath: string;  // Provider name: gemini, ollama-glm-ocr, ollama-qwen-vl, etc.
  fallbackTriggered: boolean;
  fallbackReason?: string;
  totalQuestions: number;
  questions: PipelineQuestion[];
  extractionChars: number;
}

export interface PipelineErrorResult {
  status: 'error';
  errorCode: string;
  message: string;
  /** Reportado pelo pipeline em needs_review/error (D11). */
  extractionChars?: number;
}

export type PipelineResult = PipelineSuccessResult | PipelineErrorResult;

interface RunFallbackPipelineInput {
  examId: string;
  filePath: string;
  fallbackReason: string;
  pageStart?: number;
  pageEnd?: number;
  provaType?: string;
}

interface PythonPayload {
  exam_id: string;
  file_path: string;
  fallback_reason: string;
  extract_min_chars: number;
  gemini_model: string;
  gemini_api_key?: string;
  page_start?: number;
  page_end?: number;
  prova_type?: string;
}

// --- D8: env allowlist — o subprocess nunca recebe process.env inteiro. ------
const ENV_EXACT_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'LANG',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
]);

const ENV_PREFIX_ALLOWLIST = [
  'OLLAMA_',
  'PDF_DPI',
  'PIPELINE_',
  'PROCESSING_',
];

function buildChildEnv(): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (ENV_EXACT_ALLOWLIST.has(key) || ENV_PREFIX_ALLOWLIST.some((p) => key.startsWith(p))) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}

// --- D9: timeout/caps --------------------------------------------------------
const DEFAULT_PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;
const SIGKILL_GRACE_MS = 5_000;
const STDOUT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const STDERR_MAX_BYTES = 1 * 1024 * 1024;  // 1MB ring buffer (últimos bytes)

function resolvePipelineTimeoutMs(): number {
  // PIPELINE_TIMEOUT_MS não faz parte do config zod-validado (config.ts é de
  // outro workstream) — lido direto do env com fallback para o default do D9.
  const raw = process.env.PIPELINE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PIPELINE_TIMEOUT_MS;
}

function resolvePipelineEntrypoint(): string {
  if (path.isAbsolute(config.pipelineEntrypoint)) {
    return config.pipelineEntrypoint;
  }

  return path.resolve(process.cwd(), config.pipelineEntrypoint);
}

/**
 * Extrai o JSON do pipeline: stdout deve ser 1 JSON; em outputs com linhas
 * extras (warnings), tenta a última linha não-vazia antes de falhar.
 */
function parsePipelineOutput(stdout: string): PipelineResult | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const candidates = [trimmed];
  const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 1) {
    candidates.push(lines[lines.length - 1]!);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
        return normalizePipelineResult(parsed);
      }
    } catch {
      // tenta o próximo candidato
    }
  }

  return undefined;
}

/**
 * Normaliza o payload do Python para o contrato TS.
 *
 * `status:"needs_review"` (D11 — sem alucinação) é mapeado para
 * `PipelineErrorResult` com errorCode propagado — o schema de exames já
 * representa needs_review como `failed` + error_code (BACKEND-SCHEMA §1.2),
 * e manter `status:'error'` preserva o narrowing `status === 'error'`
 * existente no worker (jobs/process-exam.ts — outro workstream).
 */
function normalizePipelineResult(parsed: Record<string, unknown>): PipelineResult {
  if (parsed.status === 'ok') {
    return parsed as unknown as PipelineSuccessResult;
  }

  const errorCode = typeof parsed.errorCode === 'string' && parsed.errorCode.length > 0
    ? parsed.errorCode
    : parsed.status === 'needs_review'
      ? 'PIPELINE_NEEDS_REVIEW'
      : 'PIPELINE_ERROR';
  const message = typeof parsed.message === 'string' && parsed.message.length > 0
    ? parsed.message
    : `Pipeline returned status ${String(parsed.status)}`;
  const extractionChars = typeof parsed.extractionChars === 'number'
    ? parsed.extractionChars
    : undefined;

  return { status: 'error', errorCode, message, ...(extractionChars !== undefined ? { extractionChars } : {}) };
}

export async function runFallbackPipeline(input: RunFallbackPipelineInput): Promise<PipelineResult> {
  const entrypoint = resolvePipelineEntrypoint();

  const payload: PythonPayload = {
    exam_id: input.examId,
    file_path: input.filePath,
    fallback_reason: input.fallbackReason,
    extract_min_chars: config.pipelineExtractMinChars,
    gemini_model: config.pipelineGeminiModel,
    gemini_api_key: config.geminiApiKey,
    page_start: input.pageStart,
    page_end: input.pageEnd,
    prova_type: input.provaType,
  };

  const child = spawn(config.pipelinePythonBin, [entrypoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildChildEnv(), // D8 — nunca process.env inteiro
  });

  console.log(`[Python Worker] Spawned with PID: ${child.pid}`);

  return await new Promise<PipelineResult>((resolve) => {
    let stdoutLength = 0;
    const stdoutChunks: Buffer[] = [];
    let stderrBuffer = '';
    let stdoutOverflow = false;
    let timedOut = false;
    let settled = false;

    const finish = (result: PipelineResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      resolve(result);
    };

    const kill = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        // processo já morto — close handler resolve
      }
    };

    // D9: timeout → SIGTERM; +5s → SIGKILL.
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      killHandle = setTimeout(() => kill('SIGKILL'), SIGKILL_GRACE_MS);
      killHandle.unref?.();
    }, resolvePipelineTimeoutMs());
    timeoutHandle.unref?.();
    let killHandle: ReturnType<typeof setTimeout>;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength > STDOUT_MAX_BYTES) {
        if (!stdoutOverflow) {
          stdoutOverflow = true;
          kill('SIGKILL');
        }
        return; // para de acumular — cap de memória
      }
      stdoutChunks.push(chunk);
      if (process.env.DEBUG) console.log(`[Python Stdout] ${chunk.toString('utf8').substring(0, 50)}...`);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Ring buffer: mantém apenas os últimos STDERR_MAX_BYTES.
      stderrBuffer = (stderrBuffer + chunk.toString('utf8')).slice(-STDERR_MAX_BYTES);
    });

    child.on('error', (error) => {
      finish({
        status: 'error',
        errorCode: 'PIPELINE_PROCESS_ERROR',
        message: error.message,
      });
    });

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          status: 'error',
          errorCode: 'PIPELINE_TIMEOUT',
          message: `Pipeline excedeu o timeout de ${resolvePipelineTimeoutMs()}ms`,
        });
        return;
      }

      if (stdoutOverflow) {
        finish({
          status: 'error',
          errorCode: 'PIPELINE_OUTPUT_OVERFLOW',
          message: `Pipeline excedeu o limite de stdout (${STDOUT_MAX_BYTES} bytes)`,
        });
        return;
      }

      if (code !== 0) {
        finish({
          status: 'error',
          errorCode: 'PIPELINE_EXIT_NON_ZERO',
          message: stderrBuffer.trim() || `Pipeline exited with code ${String(code)}`,
        });
        return;
      }

      const parsed = parsePipelineOutput(Buffer.concat(stdoutChunks).toString('utf8'));
      finish(
        parsed ?? {
          status: 'error',
          errorCode: 'PIPELINE_INVALID_OUTPUT',
          message: 'Pipeline output is not valid JSON',
        },
      );
    });

    // D9: EPIPE no stdin é erro do pipeline (child morreu cedo), não crash.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') {
        finish({
          status: 'error',
          errorCode: 'PIPELINE_STDIN_EPIPE',
          message: 'Pipeline fechou stdin antes de receber o payload (EPIPE)',
        });
        return;
      }
      finish({
        status: 'error',
        errorCode: 'PIPELINE_STDIN_ERROR',
        message: error.message,
      });
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (error) {
      finish({
        status: 'error',
        errorCode: 'PIPELINE_STDIN_ERROR',
        message: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    }
  });
}
