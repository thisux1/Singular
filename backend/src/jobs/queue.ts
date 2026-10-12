import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logError, logInfo } from '../utils/logger.js';

export const EXAM_PROCESS_QUEUE = 'exam-process';
export const EXAM_CLASSIFICATION_QUEUE = 'exam-classification';

let redisConnection: Redis | null = null;
let examQueue: Queue | null = null;
let classificationQueue: Queue | null = null;

/**
 * Conexão ioredis compartilhada (somente comandos — BullMQ workers usam
 * conexões dedicadas próprias). Reusada pelos budgets/contadores em Redis
 * (classificação diária, rate-limit do explainer) e pelo lifecycle shutdown.
 */
export function getSharedRedis(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  return redisConnection;
}

export function getExamQueue(): Queue {
  if (!examQueue) {
    examQueue = new Queue(EXAM_PROCESS_QUEUE, {
      connection: getSharedRedis(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }

  return examQueue;
}

export function getClassificationQueue(): Queue {
  if (!classificationQueue) {
    classificationQueue = new Queue(EXAM_CLASSIFICATION_QUEUE, {
      connection: getSharedRedis(),
      defaultJobOptions: {
        // D21 — 2 tentativas com backoff para falhas transitórias.
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }

  return classificationQueue;
}

export interface ProcessExamJobData {
  examId: string;
}

export interface ProcessClassificationJobData {
  examId: string;
}

export interface EnqueueResult {
  jobId: string;
  /** true quando um job vivo já existia para o exame e nada foi re-enfileirado. */
  deduped: boolean;
}

// Estados em que um job existente ainda vai processar/está processando o exame —
// re-enfileirar seria duplicação (D18).
const LIVE_JOB_STATES = new Set([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

export async function enqueueExamProcessing(data: ProcessExamJobData): Promise<EnqueueResult> {
  const queue = getExamQueue();

  try {
    const existing = await queue.getJob(data.examId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_JOB_STATES.has(state)) {
        logInfo('enqueue.deduped', {
          examId: data.examId,
          jobId: existing.id,
          jobState: state,
        });
        return { jobId: existing.id ?? data.examId, deduped: true };
      }

      // Job terminal (failed/completed/unknown) ocupa o jobId — remover para
      // permitir re-add (reprocess). Falha de remove é logada, não engolida.
      try {
        await existing.remove();
        logInfo('enqueue.removed_terminal_job', {
          examId: data.examId,
          jobId: existing.id,
          jobState: state,
        });
      } catch (removeError) {
        logError('enqueue.remove_failed', {
          examId: data.examId,
          jobId: existing.id,
          jobState: state,
          errorMessage: removeError instanceof Error ? removeError.message : 'UNKNOWN_ERROR',
        });
      }
    }
  } catch (err) {
    // getJob/getState indisponível (Redis hiccup) — segue para o add; BullMQ
    // rejeita jobId duplicado se ainda existir, e logamos o resultado abaixo.
    logError('enqueue.lookup_failed', {
      examId: data.examId,
      errorMessage: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
    });
  }

  const job = await queue.add('process-exam', data, {
    jobId: data.examId,
  });

  return { jobId: job.id ?? data.examId, deduped: false };
}

export async function enqueueExamClassification(
  data: ProcessClassificationJobData,
  options?: { delayMs?: number },
): Promise<void> {
  const queue = getClassificationQueue();
  const delayMs = options?.delayMs ?? 0;

  await queue.add('process-classification', data, {
    jobId: `${data.examId}:classification:${Date.now()}`,
    delay: delayMs,
  });
}

/** Fecha queues + conexão compartilhada (graceful shutdown — D23). */
export async function closeQueues(): Promise<void> {
  const closers: Promise<unknown>[] = [];

  if (examQueue) {
    closers.push(examQueue.close().catch(() => undefined));
    examQueue = null;
  }
  if (classificationQueue) {
    closers.push(classificationQueue.close().catch(() => undefined));
    classificationQueue = null;
  }

  await Promise.all(closers);

  if (redisConnection) {
    const conn = redisConnection;
    redisConnection = null;
    await conn.quit().catch(() => undefined);
  }
}
