import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { exams } from '../db/schema.js';
import { getSharedRedis } from '../jobs/queue.js';
import { getUser, requireAuth, type AuthVariables } from '../middleware/auth.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { getExplainerService } from '../services/explainer.js';
import { logError, logInfo } from '../utils/logger.js';
import type { QuestionRow } from '../db/schema.js';

export const questionsRoutes = new Hono<{ Variables: AuthVariables }>();

questionsRoutes.use('*', requireAuth);

const DEFAULT_EXPLAIN_DAILY_LIMIT = 30;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function explainDailyLimit(): number {
  const raw = Number.parseInt(process.env['EXPLAIN_DAILY_LIMIT'] ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_EXPLAIN_DAILY_LIMIT;
}

function localDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function secondsUntilNextDay(now = new Date()): number {
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(Math.ceil((next.getTime() - now.getTime()) / 1000), 60);
}

/**
 * Rate limit do explainer (D20): INCR + EXPIREAT na meia-noite local.
 * Fail-open: Redis indisponível não deve derrubar geração de explicação.
 */
async function consumeExplainQuota(userId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = explainDailyLimit();
  try {
    const redis = getSharedRedis();
    const key = `explain:${userId}:${localDayKey()}`;
    const used = await redis.incr(key);
    if (used === 1) {
      await redis.expireat(key, Math.floor(Date.now() / 1000) + secondsUntilNextDay());
    }

    return { allowed: used <= limit, used, limit };
  } catch (error) {
    logError('explainer.rate_limit.failed', {
      userId,
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    return { allowed: true, used: 0, limit };
  }
}

function questionNotFound(c: Context, questionId: string) {
  return c.json(
    {
      error: {
        code: 'QUESTION_NOT_FOUND',
        message: 'Questão não encontrada',
        question_id: questionId,
      },
    },
    404,
  );
}

/** Ownership: questão → exame → user (D16). authDisabled bypassa. */
async function ownsQuestion(question: QuestionRow, userId: string): Promise<boolean> {
  if (config.authDisabled) {
    return true;
  }

  const [row] = await db
    .select({ userId: exams.userId })
    .from(exams)
    .where(eq(exams.id, question.examId))
    .limit(1);

  return row?.userId === userId;
}

function explanationPayload(question: QuestionRow, cached: boolean) {
  return {
    explanation: question.explanation,
    explanationSteps: question.explanationSteps ?? [],
    commonMistakes: question.commonMistakes ?? [],
    cached,
  };
}

questionsRoutes.get('/:id/explanation', async (c) => {
  const user = getUser(c);
  const questionId = c.req.param('id');

  if (!isUuid(questionId)) {
    return c.json(
      {
        error: {
          code: 'INVALID_ID',
          message: 'ID inválido',
          question_id: questionId,
        },
      },
      400,
    );
  }

  const question = await questionsRepository.getById(questionId);

  if (!question || !(await ownsQuestion(question, user.id))) {
    return questionNotFound(c, questionId);
  }

  // Somente leitura do cache — não gera (geração é POST /explain, D20).
  const text = question.explanation ?? 'Explicação indisponível para esta questão no momento.';

  return c.json({
    explanation: text,
    explanationSteps: question.explanationSteps ?? [],
    commonMistakes: question.commonMistakes ?? [],
    cached: question.explanation !== null,
  });
});

questionsRoutes.post('/:id/explain', async (c) => {
  const user = getUser(c);
  const questionId = c.req.param('id');

  if (!isUuid(questionId)) {
    return c.json(
      {
        error: {
          code: 'INVALID_ID',
          message: 'ID inválido',
          question_id: questionId,
        },
      },
      400,
    );
  }

  const question = await questionsRepository.getById(questionId);

  if (!question || !(await ownsQuestion(question, user.id))) {
    return questionNotFound(c, questionId);
  }

  // Cache: explanation já populada → retorna sem gastar quota (D20).
  if (question.explanation) {
    return c.json(explanationPayload(question, true));
  }

  const quota = await consumeExplainQuota(user.id);
  if (!quota.allowed) {
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Limite diário de explicações atingido (${quota.limit}/dia)`,
          limit: quota.limit,
          used: quota.used,
        },
      },
      429,
    );
  }

  let result;
  try {
    result = await getExplainerService().generate(question);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    logError('explainer.generate.failed', {
      questionId,
      examId: question.examId,
      userId: user.id,
      errorMessage: message,
    });

    if (message === 'GEMINI_API_KEY_MISSING') {
      return c.json(
        {
          error: {
            code: 'EXPLAINER_UNAVAILABLE',
            message: 'Explainer indisponível: GEMINI_API_KEY não configurada',
          },
        },
        503,
      );
    }

    return c.json(
      {
        error: {
          code: 'EXPLAINER_FAILED',
          message: 'Falha ao gerar explicação — tente novamente',
        },
      },
      502,
    );
  }

  const updated = await questionsRepository.update(questionId, {
    explanation: result.explanation,
    explanationSteps: result.explanationSteps,
    commonMistakes: result.commonMistakes,
  });

  if (!updated) {
    logError('explainer.persist.failed', { questionId });
  }

  logInfo('explainer.generated', {
    questionId,
    examId: question.examId,
    userId: user.id,
    quotaUsed: quota.used,
    quotaLimit: quota.limit,
  });

  return c.json({
    explanation: result.explanation,
    explanationSteps: result.explanationSteps,
    commonMistakes: result.commonMistakes,
    cached: false,
  });
});
