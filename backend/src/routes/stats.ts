import { Hono } from 'hono';
import { getUser, requireAuth, type AuthVariables } from '../middleware/auth.js';
import { quizRepository } from '../repositories/quiz-repository.js';
import { buildStatsSummary } from '../services/gamification.js';

export const statsRoutes = new Hono<{ Variables: AuthVariables }>();

// Mesmo padrão de quiz/questions: guard por rota (idempotente com o global).
statsRoutes.use('*', requireAuth);

/**
 * GET /api/stats/summary — agrega quizSessions + quizAnswers do usuário em
 * XP/level/streak/badges. Fórmulas documentadas em services/gamification.ts.
 * Escopo: getUser.id (mesmo padrão de GET /quiz/sessions — em AUTH_DISABLED
 * agrega as sessões do usuário stub 'local').
 */
statsRoutes.get('/summary', async (c) => {
  const userId = getUser(c).id;

  const [finishedSessions, answerTotals, perSubject] = await Promise.all([
    quizRepository.finishedSessionsForStats(userId),
    quizRepository.answerTotalsForUser(userId),
    quizRepository.perSubjectForUser(userId),
  ]);

  const summary = buildStatsSummary({
    finishedSessions,
    totalAnswered: answerTotals.total,
    totalCorrect: answerTotals.correct,
    answersTimeMs: answerTotals.timeMs,
    perSubject,
  });

  return c.json(summary);
});
