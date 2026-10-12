import { Redis } from 'ioredis';

import { config } from './config.js';
import { pool } from './db/client.js';
import {
  getClassificationQueue,
  getExamQueue,
  getSharedRedis,
} from './jobs/queue.js';
import {
  recoverStaleProcessingExams,
  startExamWorker,
} from './jobs/process-exam.js';
import { startClassificationWorker } from './jobs/process-classification.js';
import { registerWorkerShutdown } from './utils/lifecycle.js';
import { logError, logInfo } from './utils/logger.js';

const workerConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

const examWorker = startExamWorker(workerConnection);
const classificationWorker = startClassificationWorker(workerConnection);

void recoverStaleProcessingExams().catch((error) => {
  logError('exam.watchdog.failed', {
    errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
  });
});

registerWorkerShutdown({
  name: 'workers',
  workers: [examWorker, classificationWorker],
  queues: [getExamQueue(), getClassificationQueue()],
  redis: [workerConnection, getSharedRedis()],
  pool,
});

logInfo('worker.started', { queues: ['exam-process', 'exam-classification'] });
