import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export const EXAM_PROCESS_QUEUE = 'exam-process';
export const EXAM_CLASSIFICATION_QUEUE = 'exam-classification';

let redisConnection: Redis | null = null;
let examQueue: Queue | null = null;
let examQueueEvents: QueueEvents | null = null;
let classificationQueue: Queue | null = null;
let classificationQueueEvents: QueueEvents | null = null;

function ensureQueue(): Queue {
  if (!redisConnection) {
    redisConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  if (!examQueue) {
    examQueue = new Queue(EXAM_PROCESS_QUEUE, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }

  if (!examQueueEvents) {
    examQueueEvents = new QueueEvents(EXAM_PROCESS_QUEUE, {
      connection: redisConnection,
    });
  }

  return examQueue;
}

function ensureClassificationQueue(): Queue {
  if (!redisConnection) {
    redisConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  if (!classificationQueue) {
    classificationQueue = new Queue(EXAM_CLASSIFICATION_QUEUE, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }

  if (!classificationQueueEvents) {
    classificationQueueEvents = new QueueEvents(EXAM_CLASSIFICATION_QUEUE, {
      connection: redisConnection,
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

export async function enqueueExamProcessing(data: ProcessExamJobData): Promise<void> {
  const queue = ensureQueue();
  try {
    const job = await queue.getJob(data.examId);
    if (job) {
      await job.remove();
    }
  } catch (err) {
    // ignore
  }
  await queue.add('process-exam', data, {
    jobId: data.examId,
  });
}

export async function enqueueExamClassification(
  data: ProcessClassificationJobData,
  options?: { delayMs?: number },
): Promise<void> {
  const queue = ensureClassificationQueue();
  const delayMs = options?.delayMs ?? 0;

  await queue.add('process-classification', data, {
    jobId: `${data.examId}:classification:${Date.now()}`,
    delay: delayMs,
  });
}
