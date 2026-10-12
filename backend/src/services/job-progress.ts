import { getExamQueue, getSharedRedis } from '../jobs/queue.js';
import type { ExamStatus } from '../types/exam.js';

/**
 * Progresso do job de processamento de um exame (D18).
 *
 * Reusa `getExamQueue()`/`getSharedRedis()` de jobs/queue.ts (mesma conexão
 * e mesma instância de Queue — lifecycle/shutdown centralizados lá via
 * `closeQueues()`).
 *
 * CONTRATO com o worker (jobs/process-exam.ts — outro workstream):
 *   job.updateProgress({stage, percent, pageCurrent?, pageTotal?})
 * com stage ∈ extracting|structuring|persisting|classifying.
 * Campos são lidos defensivamente (todos opcionais na prática).
 */
export interface ExamProgress {
  status: ExamStatus;
  stage?: string;
  percent: number;
  pageCurrent?: number;
  pageTotal?: number;
  /** Presente quando o job falhou (BullMQ failedReason) ou exam falhou. */
  error?: string;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Derivado do status persistido quando não há job localizável. */
function deriveProgress(examStatus: ExamStatus, errorMessage?: string): ExamProgress {
  switch (examStatus) {
    case 'queued':
      return { status: examStatus, percent: 0 };
    case 'processing':
      // Job sumiu mas status diz processing → indeterminado; frontend continua polling.
      return { status: examStatus, percent: 0 };
    case 'reviewing':
    case 'completed':
      return { status: examStatus, percent: 100 };
    case 'failed':
      return { status: examStatus, percent: 100, error: errorMessage };
  }
}

export async function getExamProgress(exam: {
  id: string;
  status: ExamStatus;
  errorMessage?: string;
}): Promise<ExamProgress> {
  try {
    const job = await getExamQueue().getJob(exam.id); // jobId === examId

    if (!job) {
      return deriveProgress(exam.status, exam.errorMessage);
    }

    const raw = (job.progress ?? {}) as Record<string, unknown>;
    const percent = toFiniteNumber(raw.percent);
    const stage = typeof raw.stage === 'string' ? raw.stage : undefined;
    const pageCurrent = toFiniteNumber(raw.pageCurrent);
    const pageTotal = toFiniteNumber(raw.pageTotal);

    const jobState = await job.getState().catch(() => undefined);
    const failed = jobState === 'failed' || exam.status === 'failed';

    return {
      status: exam.status,
      ...(stage ? { stage } : {}),
      percent: clampPercent(
        percent ?? (failed || exam.status === 'completed' || exam.status === 'reviewing' ? 100 : 0),
      ),
      ...(pageCurrent !== undefined ? { pageCurrent } : {}),
      ...(pageTotal !== undefined ? { pageTotal } : {}),
      ...(failed && job.failedReason
        ? { error: job.failedReason }
        : exam.errorMessage
          ? { error: exam.errorMessage }
          : {}),
    };
  } catch {
    // Redis/queue indisponível → fallback no status persistido.
    return deriveProgress(exam.status, exam.errorMessage);
  }
}

/** PING para /health — usa a conexão compartilhada de jobs/queue.ts. */
export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await getSharedRedis().ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
