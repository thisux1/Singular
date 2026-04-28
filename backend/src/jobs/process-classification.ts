import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { enqueueExamClassification, EXAM_CLASSIFICATION_QUEUE, type ProcessClassificationJobData } from './queue.js';
import { getGeminiClassifierService } from '../services/classification/gemini-classifier.js';
import { logError, logInfo } from '../utils/logger.js';

const dailyCostUsage = new Map<string, number>();

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function getDailyCost(now = new Date()): number {
  return dailyCostUsage.get(dayKey(now)) ?? 0;
}

function addDailyCost(costUsd: number, now = new Date()): number {
  const key = dayKey(now);
  const next = getDailyCost(now) + costUsd;
  dailyCostUsage.set(key, next);
  return next;
}

function msUntilNextDay(now = new Date()): number {
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 60_000);
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const output: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    output.push(items.slice(index, index + batchSize));
  }

  return output;
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

  if (config.classificationDailyUsdLimit > 0 && getDailyCost() >= config.classificationDailyUsdLimit) {
    const delayMs = msUntilNextDay();
    await enqueueExamClassification({ examId: data.examId }, { delayMs });
    logInfo('classification.paused.daily_limit', {
      examId: data.examId,
      daily_limit_usd: config.classificationDailyUsdLimit,
      current_daily_cost_usd: Number(getDailyCost().toFixed(8)),
      resume_in_ms: delayMs,
    });
    return;
  }

  const classifier = getGeminiClassifierService();
  const batches = splitIntoBatches(pending, config.classificationBatchSize);
  let hitDailyLimit = false;

  for (const batch of batches) {
    if (config.classificationDailyUsdLimit > 0 && getDailyCost() >= config.classificationDailyUsdLimit) {
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

    const cumulativeUsd = addDailyCost(result.usage.estimatedCostUsd);

    logInfo('classification.batch.processed', {
      examId: data.examId,
      batch_size: batch.length,
      classified_count: result.classified.length,
      failed_count: result.failedQuestionIds.length,
      batch_cost_usd: Number(result.usage.estimatedCostUsd.toFixed(8)),
      cumulative_daily_cost_usd: Number(cumulativeUsd.toFixed(8)),
    });

    if (config.classificationDailyUsdLimit > 0 && cumulativeUsd >= config.classificationDailyUsdLimit) {
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
    daily_cost_usd: Number(getDailyCost().toFixed(8)),
  });
}

export function startClassificationWorker(): Worker {
  const workerConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  return new Worker(
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
      connection: workerConnection,
      concurrency: 1,
    },
  );
}

if (process.argv[1] && process.argv[1].includes('process-classification')) {
  startClassificationWorker();
  logInfo('worker.started', { queue: EXAM_CLASSIFICATION_QUEUE });
}
