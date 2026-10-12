import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { HTTPException } from 'hono/http-exception';
import { auth } from './auth.js';
import { requireAuth, getUser, type AuthVariables } from './middleware/auth.js';
import { examsRoutes } from './routes/exams.js';
import { quizRoutes } from './routes/quiz.js';
import { questionsRoutes } from './routes/questions.js';
import { bankRoutes } from './routes/bank.js';
import { statsRoutes } from './routes/stats.js';
import { accountRoutes } from './routes/account.js';
import { config } from './config.js';
import { pool } from './db/client.js';
import { closeQueues } from './jobs/queue.js';
import { pingRedis } from './services/job-progress.js';
import { logError, logInfo } from './utils/logger.js';

const app = new Hono<{ Variables: AuthVariables }>();

// --- Middleware stack (D14) -------------------------------------------------
// Ordem: request-id → access logger → cors → auth handler → guard /api/* → rotas.

// 1) request-id: propaga X-Request-Id válido do cliente ou gera UUID;
//    expõe em c.get('requestId') e devolve no header da resposta.
app.use('*', requestId());

// 2) logger leve — método+path+status+ms+requestId em linha JSON-ish.
app.use('*', async (c, next) => {
  const startedAt = Date.now();
  try {
    await next();
  } finally {
    console.log(JSON.stringify({
      level: 'info',
      event: 'http.request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - startedAt,
      requestId: c.get('requestId') ?? null,
    }));
  }
});

// 3) cors com allowlist de config.corsOrigins (credentials p/ cookies de sessão).
app.use(
  '/api/*',
  cors({
    origin: config.corsOrigins,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Set-Cookie'],
    maxAge: 600,
  }),
);

// 4) Better Auth handler — responde GET/POST de /api/auth/* direto
//    (sign-in, callback, session, sign-out). Preflight OPTIONS cai no cors acima.
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// 5) Guard de autenticação para TODAS as rotas /api/* exceto /api/auth/* (D14/D16).
//    requireAuth injeta c.set('user') — stub `local` em AUTH_DISABLED, sessão
//    Better Auth caso contrário; 401 JSON quando sem sessão.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth')) {
    return next();
  }
  return requireAuth(c, next);
});

// --- Rotas ------------------------------------------------------------------

// GET /health → {ok, db, redis} (SELECT 1 + PING) — fora de /api, sem auth.
app.get('/health', async (c) => {
  let dbUp = false;
  try {
    await pool.query('SELECT 1');
    dbUp = true;
  } catch {
    dbUp = false;
  }
  const redisUp = await pingRedis();
  const ok = dbUp && redisUp;
  return c.json({ ok, db: dbUp ? 'up' : 'down', redis: redisUp ? 'up' : 'down' }, ok ? 200 : 503);
});

app.route('/api/exams', examsRoutes);
app.route('/api/quiz', quizRoutes);
app.route('/api/questions', questionsRoutes);
app.route('/api/bank', bankRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/account', accountRoutes);

// --- Error handling (D14) ----------------------------------------------------

app.onError((err, c) => {
  const reqId = c.get('requestId') ?? null;

  if (err instanceof HTTPException) {
    logError('http.error', {
      requestId: reqId,
      status: err.status,
      message: err.message,
      path: c.req.path,
    });
    return c.json(
      { error: { code: err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'HTTP_ERROR', message: err.message, requestId: reqId } },
      err.status,
    );
  }

  logError('http.unhandled_error', {
    requestId: reqId,
    path: c.req.path,
    message: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
    stack: err instanceof Error ? err.stack : undefined,
  });

  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: reqId } },
    500,
  );
});

app.notFound((c) =>
  c.json(
    { error: { code: 'NOT_FOUND', message: 'Rota não encontrada', requestId: c.get('requestId') ?? null } },
    404,
  ),
);

// --- Server + graceful shutdown (D23) ----------------------------------------

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    logInfo('api.started', { port: info.port });
  },
);

// ServerType inclui Http2Server — narrow para http.Server clássico.
const httpServer = server as unknown as {
  close(callback?: () => void): void;
  closeIdleConnections?(): void;
};

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logInfo('api.shutdown.started', { signal });

  // Timeout duro: se drains travarem, força exit em 10s.
  const forceTimer = setTimeout(() => {
    console.error('[FATAL] api.shutdown.timeout — forçando exit');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  void (async () => {
    // 1) para de aceitar conexões e drena keep-alive
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      if (typeof httpServer.closeIdleConnections === 'function') {
        httpServer.closeIdleConnections();
      }
    });
    // 2) queues BullMQ + conexão redis compartilhada (jobs/queue.ts)
    await closeQueues().catch(() => undefined);
    // 3) pool Postgres
    await pool.end().catch(() => undefined);
    clearTimeout(forceTimer);
    logInfo('api.shutdown.done', { signal });
    process.exit(0);
  })().catch((error) => {
    logError('api.shutdown.error', {
      message: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    process.exit(1);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { requireAuth, getUser };
export default app;
