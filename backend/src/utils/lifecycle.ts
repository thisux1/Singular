import { logError, logInfo } from './logger.js';

/**
 * Graceful shutdown para processos worker (D23).
 *
 * Sequência: workers → queues → redis → pool, cada etapa isolada (falha em uma
 * não impede a próxima). Timeout total default 10s → force exit.
 */

interface Closeable {
  close(): Promise<unknown>;
}

interface Quittable {
  quit(): Promise<unknown>;
}

interface Disconnectable {
  disconnect(): void;
}

interface Endable {
  end(): Promise<unknown>;
}

export interface WorkerShutdownDeps {
  /** BullMQ workers — `worker.close()` drena jobs em flight. */
  workers?: Closeable[];
  /** BullMQ queues. */
  queues?: Closeable[];
  /** Conexões ioredis avulsas (quit(); cai em disconnect() se não houver quit). */
  redis?: Array<Quittable | Disconnectable | null | undefined>;
  /** Pool pg do drizzle (`pool.end()`). */
  pool?: Endable | null;
  /** Timeout global do shutdown (ms). Default 10_000 (D23). */
  timeoutMs?: number;
  /** Nome para logs (ex.: 'exam-worker'). */
  name?: string;
}

async function safeClose(label: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logError('lifecycle.shutdown.step_failed', {
      step: label,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  }
}

export function registerWorkerShutdown(deps: WorkerShutdownDeps): void {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const name = deps.name ?? 'worker';
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logInfo('lifecycle.shutdown.started', { name, signal });

    const forceTimer = setTimeout(() => {
      logError('lifecycle.shutdown.timeout', { name, timeoutMs });
      process.exit(1);
    }, timeoutMs);
    // Não segurar o event loop caso tudo feche antes do timeout.
    forceTimer.unref();

    void (async () => {
      for (const [index, worker] of (deps.workers ?? []).entries()) {
        await safeClose(`workers[${index}]`, () => worker.close());
      }
      for (const [index, queue] of (deps.queues ?? []).entries()) {
        await safeClose(`queues[${index}]`, () => queue.close());
      }
      for (const [index, conn] of (deps.redis ?? []).entries()) {
        if (!conn) {
          continue;
        }
        await safeClose(`redis[${index}]`, async () => {
          if ('quit' in conn && typeof conn.quit === 'function') {
            try {
              await conn.quit();
            } catch {
              // Conexão já fechada — força disconnect como fallback.
              (conn as Quittable & Disconnectable).disconnect?.();
            }
            return;
          }
          (conn as Disconnectable).disconnect();
        });
      }
      if (deps.pool) {
        await safeClose('pool', () => deps.pool!.end());
      }

      clearTimeout(forceTimer);
      logInfo('lifecycle.shutdown.completed', { name, signal });
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
