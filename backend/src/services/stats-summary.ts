import { quizRepository } from '../repositories/quiz-repository.js';
import { buildStatsSummary, type StatsSummary } from './gamification.js';

/**
 * Monta o payload de GET /api/stats/summary para um userId (queries no
 * quiz-repository + fórmulas puras de gamification.ts). Fonte única usada
 * pela rota de stats e por GET /api/account (statsSummary embutido).
 */
export async function getStatsSummaryForUser(userId: string): Promise<StatsSummary> {
  const [finishedSessions, answerTotals, perSubject] = await Promise.all([
    quizRepository.finishedSessionsForStats(userId),
    quizRepository.answerTotalsForUser(userId),
    quizRepository.perSubjectForUser(userId),
  ]);

  return buildStatsSummary({
    finishedSessions,
    totalAnswered: answerTotals.total,
    totalCorrect: answerTotals.correct,
    answersTimeMs: answerTotals.timeMs,
    perSubject,
  });
}
