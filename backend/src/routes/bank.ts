import { Hono, type Context } from 'hono';
import {
  getUser,
  ownershipUserId,
  requireAuth,
  type AuthVariables,
} from '../middleware/auth.js';
import { bankRepository, type BankQuestionFilters } from '../repositories/bank-repository.js';
import { quizRepository } from '../repositories/quiz-repository.js';
import { logInfo } from '../utils/logger.js';

export const bankRoutes = new Hono<{ Variables: AuthVariables }>();

// Mesmo padrão de quiz/questions: guard por rota (idempotente com o global).
bankRoutes.use('*', requireAuth);

const BANK_SESSION_MAX_QUESTIONS = 200;
const BANK_PAGE_SIZE_DEFAULT = 25;
const BANK_PAGE_SIZE_MAX = 100;
const BANK_TEXT_FILTER_MAX = 200;

const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validationError(c: Context, field: string, message: string) {
  return c.json(
    { error: { code: 'VALIDATION', field, message } },
    400,
  );
}

function parseOptionalTextParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * GET /api/bank/filters — valores distintos para os dropdowns do banco:
 * subjects/topics das questions + bancas/years dos exames (kind='exam')
 * visíveis do usuário.
 */
bankRoutes.get('/filters', async (c) => {
  const filters = await bankRepository.listFilters(ownershipUserId(c));
  return c.json(filters);
});

/**
 * GET /api/bank/questions — lista paginada com filtros AND:
 * subject, topic, difficulty, banca, year, q (ILIKE em questionText),
 * page (default 1), pageSize (default 25, max 100).
 */
bankRoutes.get('/questions', async (c) => {
  const subject = parseOptionalTextParam(c.req.query('subject'));
  const topic = parseOptionalTextParam(c.req.query('topic'));
  const banca = parseOptionalTextParam(c.req.query('banca'));
  const difficultyRaw = parseOptionalTextParam(c.req.query('difficulty'));
  const yearRaw = parseOptionalTextParam(c.req.query('year'));
  const q = parseOptionalTextParam(c.req.query('q'));
  const pageRaw = parseOptionalTextParam(c.req.query('page'));
  const pageSizeRaw = parseOptionalTextParam(c.req.query('pageSize'));

  for (const [field, value] of Object.entries({ subject, topic, banca, q })) {
    if (value !== undefined && value.length > BANK_TEXT_FILTER_MAX) {
      return validationError(c, field, `${field} excede ${BANK_TEXT_FILTER_MAX} caracteres`);
    }
  }

  let difficulty: BankQuestionFilters['difficulty'];
  if (difficultyRaw !== undefined) {
    if (!DIFFICULTIES.has(difficultyRaw)) {
      return validationError(c, 'difficulty', 'difficulty deve ser easy|medium|hard');
    }
    difficulty = difficultyRaw as BankQuestionFilters['difficulty'];
  }

  let year: number | undefined;
  if (yearRaw !== undefined) {
    if (!/^\d{4}$/.test(yearRaw)) {
      return validationError(c, 'year', 'year deve ser um ano de 4 dígitos');
    }
    year = Number.parseInt(yearRaw, 10);
  }

  let page = 1;
  if (pageRaw !== undefined) {
    if (!/^\d+$/.test(pageRaw) || Number.parseInt(pageRaw, 10) < 1) {
      return validationError(c, 'page', 'page deve ser inteiro >= 1');
    }
    page = Number.parseInt(pageRaw, 10);
  }

  let pageSize = BANK_PAGE_SIZE_DEFAULT;
  if (pageSizeRaw !== undefined) {
    if (!/^\d+$/.test(pageSizeRaw) || Number.parseInt(pageSizeRaw, 10) < 1) {
      return validationError(c, 'pageSize', 'pageSize deve ser inteiro >= 1');
    }
    pageSize = Math.min(Number.parseInt(pageSizeRaw, 10), BANK_PAGE_SIZE_MAX);
  }

  const { items, total } = await bankRepository.listQuestions(ownershipUserId(c), {
    subject,
    topic,
    difficulty,
    banca,
    year,
    q,
    page,
    pageSize,
  });

  return c.json({ items, total, page, pageSize });
});

/**
 * POST /api/bank/session — cria quizSession mode='bank' ancorada no exame
 * sintético do usuário. Body: { questionIds: string[] } (1..200, todos
 * pertencentes a exames do próprio usuário). Resposta compatível com
 * POST /quiz/start para reuso direto do player.
 */
bankRoutes.post('/session', async (c) => {
  const user = getUser(c);

  const body = await c.req.json().catch(() => ({}));
  const rawIds = (body as Record<string, unknown>)['questionIds'];

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return c.json(
      { error: { code: 'INVALID_INPUT', field: 'questionIds', message: 'questionIds deve ser array não-vazio' } },
      400,
    );
  }

  if (rawIds.length > BANK_SESSION_MAX_QUESTIONS) {
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          field: 'questionIds',
          message: `questionIds excede o máximo de ${BANK_SESSION_MAX_QUESTIONS} questões`,
        },
      },
      400,
    );
  }

  if (!rawIds.every((id): id is string => typeof id === 'string' && isUuid(id))) {
    return c.json(
      { error: { code: 'VALIDATION', field: 'questionIds', message: 'questionIds deve conter apenas UUIDs' } },
      400,
    );
  }

  // Dedup preservando a ordem pedida.
  const questionIds = [...new Set(rawIds)];

  const owned = await bankRepository.findOwnedQuestions(ownershipUserId(c), questionIds);
  if (owned.length !== questionIds.length) {
    return c.json(
      {
        error: {
          code: 'INVALID_QUESTIONS',
          message: 'questionIds contém questões inexistentes ou que não pertencem ao usuário',
        },
      },
      422,
    );
  }

  const bankExam = await bankRepository.getOrCreateBankExam(ownershipUserId(c), user.id);

  const session = await quizRepository.createSession({
    examId: bankExam.id,
    userId: user.id,
    mode: 'bank',
    modeParams: { questionIds },
    totalQuestions: questionIds.length,
  });

  logInfo('bank.session.created', {
    sessionId: session.id,
    bankExamId: bankExam.id,
    userId: user.id,
    totalQuestions: questionIds.length,
  });

  return c.json({
    sessionId: session.id,
    examId: bankExam.id,
    mode: 'bank',
    totalQuestions: session.totalQuestions,
    questionIds,
  });
});
