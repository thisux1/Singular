import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { exams } from '../db/schema.js';
import { db, pool } from '../db/client.js';
import {
  enqueueExamClassification,
  getClassificationQueue,
  getSharedRedis,
  EXAM_CLASSIFICATION_QUEUE,
  type ProcessClassificationJobData,
} from './queue.js';
import { getGeminiClassifierService } from '../services/classification/gemini-classifier.js';
import { registerWorkerShutdown } from '../utils/lifecycle.js';
import { logError, logInfo } from '../utils/logger.js';

// ── Budget diário em Redis (D21) ────────────────────────────────────────────
// Chave `classification:cost:<yyyymmdd>` com INCRBYFLOAT + EXPIREAT na
// meia-noite local. Substitui o Map em memória que zerava a cada restart.

function dayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function costKey(now = new Date()): string {
  return `classification:cost:${dayKey(now)}`;
}

function msUntilNextDay(now = new Date()): number {
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 60_000);
}

/** Falha de leitura do budget → fail-open com log (Redis é dep dura da fila anyway). */
async function getDailyCost(now = new Date()): Promise<number> {
  try {
    const raw = await getSharedRedis().get(costKey(now));
    const value = raw === null ? 0 : Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    logError('classification.budget.read_failed', {
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    return 0;
  }
}

async function addDailyCost(costUsd: number, now = new Date()): Promise<number> {
  try {
    const redis = getSharedRedis();
    const key = costKey(now);
    const next = await redis.incrbyfloat(key, costUsd); // ioredis retorna string
    // Garante expiração na virada do dia (idempotente a cada chamada).
    await redis.expireat(key, Math.floor((now.getTime() + msUntilNextDay(now)) / 1000));
    const parsed = Number.parseFloat(next);
    return Number.isFinite(parsed) ? parsed : -1;
  } catch (error) {
    logError('classification.budget.write_failed', {
      costUsd,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    return -1;
  }
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const output: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    output.push(items.slice(index, index + batchSize));
  }

  return output;
}

/**
 * Falha de classificação fica visível no exame (D21): escreve
 * `classification.error` em parsing_log (exposto via GET /exams/:id) e marca as
 * pendentes como classification_status='failed' (visível em
 * GET /exams/:id/questions e no agregado do status).
 */
async function markClassificationFailedForExam(examId: string, errorMessage: string): Promise<void> {
  try {
    const pending = await questionsRepository.listPendingClassificationByExamId(examId);
    if (pending.length > 0) {
      await questionsRepository.markClassificationFailed(examId, pending.map((q) => q.id));
    }

    const exam = await examsRepository.getById(examId);
    if (exam) {
      // Update direto só em parsing_log — updateStatus re-stamparia
      // processed_at em exames completed/failed (side-effect indesejado).
      await db
        .update(exams)
        .set({
          parsingLog: {
            ...(exam.parsingLog ?? {}),
            classification: {
              status: 'failed',
              error: errorMessage,
              at: new Date().toISOString(),
            },
          },
        })
        .where(eq(exams.id, examId));
    }
  } catch (error) {
    logError('classification.mark_failed_failed', {
      examId,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  }
}

export async function processClassificationJob(data: ProcessClassificationJobData): Promise<void> {
  if (!config.classificationEnabled) {
    logInfo('classification.skipped.disabled', { examId: data.examId });
    return;
  }

  const exam = await examsRepository.getById(data.examId);
  if (!exam) {
    throw new Error(`EXAM_NOT_FOUND:${data.examId}`);
  }

  const pending = await questionsRepository.listPendingClassificationByExamId(data.examId);
  if (pending.length === 0) {
    logInfo('classification.skipped.no_pending', { examId: data.examId });
    return;
  }

  if (config.classificationDailyUsdLimit > 0 && (await getDailyCost()) >= config.classificationDailyUsdLimit) {
    const delayMs = msUntilNextDay();
    await enqueueExamClassification({ examId: data.examId }, { delayMs });
    logInfo('classification.paused.daily_limit', {
      examId: data.examId,
      daily_limit_usd: config.classificationDailyUsdLimit,
      current_daily_cost_usd: Number((await getDailyCost()).toFixed(8)),
      resume_in_ms: delayMs,
    });
    return;
  }

  let classifier: ReturnType<typeof getGeminiClassifierService>;
  try {
    classifier = getGeminiClassifierService();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'GEMINI_API_KEY_MISSING') {
      // Sem chave não adianta retry (D21): marca failed + log — exame não trava.
      await markClassificationFailedForExam(data.examId, 'GEMINI_API_KEY_MISSING');
      logError('classification.aborted.no_api_key', { examId: data.examId });
      return;
    }
    throw error;
  }

  const batches = splitIntoBatches(pending, config.classificationBatchSize);
  let hitDailyLimit = false;

  for (const batch of batches) {
    if (config.classificationDailyUsdLimit > 0 && (await getDailyCost()) >= config.classificationDailyUsdLimit) {
      hitDailyLimit = true;
      break;
    }

    const result = await classifier.classifyBatch(data.examId, batch);

    if (result.classified.length > 0) {
      await questionsRepository.updateClassificationsForExam(data.examId, result.classified);
    }

    if (result.failedQuestionIds.length > 0) {
      await questionsRepository.markClassificationFailed(data.examId, result.failedQuestionIds);
    }

    const cumulativeUsd = await addDailyCost(result.usage.estimatedCostUsd);

    logInfo('classification.batch.processed', {
      examId: data.examId,
      batch_size: batch.length,
      classified_count: result.classified.length,
      failed_count: result.failedQuestionIds.length,
      batch_cost_usd: Number(result.usage.estimatedCostUsd.toFixed(8)),
      cumulative_daily_cost_usd: cumulativeUsd >= 0 ? Number(cumulativeUsd.toFixed(8)) : null,
    });

    if (config.classificationDailyUsdLimit > 0 && cumulativeUsd >= 0 && cumulativeUsd >= config.classificationDailyUsdLimit) {
      hitDailyLimit = true;
      break;
    }
  }

  if (hitDailyLimit) {
    const remaining = await questionsRepository.listPendingClassificationByExamId(data.examId);
    if (remaining.length > 0) {
      const delayMs = msUntilNextDay();
      await enqueueExamClassification({ examId: data.examId }, { delayMs });
      logInfo('classification.reenqueued.next_day', {
        examId: data.examId,
        pending_count: remaining.length,
        resume_in_ms: delayMs,
      });
    }
    return;
  }

  const remaining = await questionsRepository.listPendingClassificationByExamId(data.examId);
  logInfo('classification.completed', {
    examId: data.examId,
    pending_remaining: remaining.length,
    daily_cost_usd: Number((await getDailyCost()).toFixed(8)),
  });
}

export function startClassificationWorker(workerConnection?: Redis): Worker {
  const connection = workerConnection ?? new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    EXAM_CLASSIFICATION_QUEUE,
    async (job) => {
      const data = job.data as ProcessClassificationJobData;
      try {
        await processClassificationJob(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        logError('classification.failed', {
          examId: data.examId,
          errorMessage: message,
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: 1,
    },
  );

  // attempts=2 (queue defaults): só marca failed/visível na ÚLTIMA tentativa —
  // a primeira falha ainda tem retry do BullMQ com backoff (D21).
  worker.on('failed', (job, error) => {
    const examId = (job?.data as ProcessClassificationJobData | undefined)?.examId;
    if (!examId) {
      return;
    }

    const maxAttempts = job?.opts?.attempts ?? 1;
    if ((job?.attemptsMade ?? 0) < maxAttempts) {
      return;
    }

    void markClassificationFailedForExam(
      examId,
      error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    );
  });

  worker.on('error', (error) => {
    logError('worker.error', {
      queue: EXAM_CLASSIFICATION_QUEUE,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  });

  return worker;
}

if (process.argv[1] && process.argv[1].includes('process-classification')) {
  const workerConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
  const worker = startClassificationWorker(workerConnection);

  registerWorkerShutdown({
    name: 'classification-worker',
    workers: [worker],
    queues: [getClassificationQueue()],
    redis: [workerConnection, getSharedRedis()],
    pool,
  });

  logInfo('worker.started', { queue: EXAM_CLASSIFICATION_QUEUE });
}
