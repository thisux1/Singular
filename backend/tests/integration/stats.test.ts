import { afterAll, beforeAll, describe, expect } from 'vitest';
import { checkDbAvailable, makeItDb } from '../helpers/db.js';
import {
  createTestUser,
  deleteTestUsers,
  insertAnswer,
  insertExam,
  insertQuestion,
  insertSession,
  testUserId,
} from '../helpers/seed.js';
import { examsRepository } from '../../src/repositories/exams-repository.js';
import { quizRepository } from '../../src/repositories/quiz-repository.js';
import { buildStatsSummary } from '../../src/services/gamification.js';
import { statsRoutes } from '../../src/routes/stats.js';
import { examsRoutes } from '../../src/routes/exams.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * T4 — stats/gamificação: queries do quiz-repository + composição do
 * summary, agregação statsByExamIds e GET /api/exams (stats + exclui bank).
 */
describe('stats e agregações (T4)', () => {
  let dbUp = false;
  const itDb = makeItDb(() => dbUp);

  const userS = testUserId('stats');
  const users = [userS];

  let examId = '';
  let otherExamId = '';
  let qMat1 = '';
  let qMat2 = '';
  let qPort = '';

  beforeAll(async () => {
    dbUp = await checkDbAvailable();
    if (!dbUp) return;

    await createTestUser(userS);

    const exam = await insertExam({ userId: userS, status: 'completed', banca: 'Cesgranrio' });
    examId = exam.id;
    const other = await insertExam({ userId: userS, status: 'completed' });
    otherExamId = other.id;

    const m1 = await insertQuestion({ examId, order: 1, subject: 'Matemática', correctAnswer: 'A' });
    const m2 = await insertQuestion({ examId, order: 2, subject: 'Matemática', correctAnswer: 'B' });
    const p1 = await insertQuestion({ examId, order: 3, subject: 'Português', correctAnswer: 'C' });
    qMat1 = m1.id;
    qMat2 = m2.id;
    qPort = p1.id;

    const yesterday = new Date(Date.now() - DAY_MS);

    // s1: finished ontem, score 100, 2 questões — perfect + sharp elegível.
    const s1 = await insertSession({
      examId, userId: userS, totalQuestions: 2,
      finishedAt: yesterday, score: 100, correctAnswers: 2, totalTimeMs: 5000,
      modeParams: { questionIds: [qMat1, qMat2] },
    });
    // s2: finished hoje, score 50.
    const s2 = await insertSession({
      examId, userId: userS, totalQuestions: 2,
      finishedAt: new Date(), score: 50, correctAnswers: 1, totalTimeMs: 3000,
      modeParams: { questionIds: [qPort, qMat1] },
    });
    // s3: em andamento — NÃO conta como sessão finalizada, mas suas respostas
    // entram em totalAnswered/totalCorrect.
    const s3 = await insertSession({
      examId: otherExamId, userId: userS, totalQuestions: 1,
      modeParams: { questionIds: [qPort] },
    });
    // s4: finalizada em OUTRO exame — garante que statsByExamIds isola por exame.
    await insertSession({
      examId: otherExamId, userId: userS, totalQuestions: 5,
      finishedAt: new Date(), score: 80, correctAnswers: 4, totalTimeMs: 9000,
    });

    await insertAnswer({ sessionId: s1.id, questionId: qMat1, selectedAnswer: 'A', isCorrect: true, timeSpentMs: 2000 });
    await insertAnswer({ sessionId: s1.id, questionId: qMat2, selectedAnswer: 'B', isCorrect: true, timeSpentMs: 2000 });
    await insertAnswer({ sessionId: s2.id, questionId: qPort, selectedAnswer: 'A', isCorrect: false, timeSpentMs: 1500 });
    await insertAnswer({ sessionId: s2.id, questionId: qMat1, selectedAnswer: 'C', isCorrect: false, timeSpentMs: 1500 });
    await insertAnswer({ sessionId: s3.id, questionId: qPort, selectedAnswer: 'C', isCorrect: true, timeSpentMs: 800 });
  });

  afterAll(async () => {
    if (!dbUp) return;
    await deleteTestUsers(users);
  });

  itDb('finishedSessionsForStats: só sessões com finishedAt', async () => {
    const sessions = await quizRepository.finishedSessionsForStats(userS);
    expect(sessions).toHaveLength(3); // s1, s2, s4 — s3 em aberto fica fora
    expect(sessions.every((s) => s.finishedAt instanceof Date)).toBe(true);
  });

  itDb('answerTotalsForUser: respostas de TODAS as sessões (inclusive aberta)', async () => {
    const totals = await quizRepository.answerTotalsForUser(userS);
    expect(totals.total).toBe(5);
    expect(totals.correct).toBe(3);
    expect(totals.timeMs).toBe(7800);
  });

  itDb('perSubjectForUser: agrega por disciplina', async () => {
    const perSubject = await quizRepository.perSubjectForUser(userS);
    const bySubject = new Map(perSubject.map((r) => [r.subject, r]));
    // Mat: m1 acertou (s1) + m2 acertou (s1) + m1 errou (s2) → 3 total, 2 corretas
    expect(bySubject.get('Matemática')).toMatchObject({ total: 3, correct: 2 });
    // Port: errou (s2) + acertou (s3) → 2 total, 1 correta
    expect(bySubject.get('Português')).toMatchObject({ total: 2, correct: 1 });
  });

  itDb('summary composto: xp/level/streak coerentes com as fórmulas', async () => {
    const [finishedSessions, totals, perSubject] = await Promise.all([
      quizRepository.finishedSessionsForStats(userS),
      quizRepository.answerTotalsForUser(userS),
      quizRepository.perSubjectForUser(userS),
    ]);

    const summary = buildStatsSummary({
      finishedSessions, totalAnswered: totals.total, totalCorrect: totals.correct,
      answersTimeMs: totals.timeMs, perSubject,
    });

    // highScore: s1 (100) e s4 (80) → 2 sessões >=70
    // xp = 10*3 + 2*5 + 25*3 + 40*2 = 30 + 10 + 75 + 80 = 195
    expect(summary.xp).toBe(195);
    expect(summary.level).toBe(2); // floor(sqrt(1.95))+1
    expect(summary.streakDays).toBe(2); // hoje + ontem
    expect(summary.totalSessions).toBe(3);
    expect(summary.totalAnswered).toBe(5);
    expect(summary.totalCorrect).toBe(3);
    expect(summary.accuracyPct).toBe(60);
    expect(summary.totalTimeMs).toBe(5000 + 3000 + 9000);
    expect(summary.weakestSubject?.subject).toBe('Português'); // 50% < 66.67%

    const badges = Object.fromEntries(summary.badges.map((b) => [b.id, b.earned]));
    expect(badges['first-session']).toBe(true);
    // s1: score 100 mas só 2 questões (<5) → 'perfect' false;
    // s4: score 80 → 'sharp' false (precisa >=90 com >=10 questões).
    expect(badges['perfect']).toBe(false);
    expect(badges['sharp']).toBe(false);
    expect(badges['streak-7']).toBe(false);
    expect(badges['centurion']).toBe(false);
  });

  itDb('statsByExamIds: group-by por exame, só finalizadas, bestScore = max', async () => {
    const stats = await quizRepository.statsByExamIds(userS, [examId, otherExamId]);

    expect(stats.get(examId)).toEqual({ sessionsCount: 2, bestScore: 100 });
    // s4 finalizada (80); s3 aberta não conta.
    expect(stats.get(otherExamId)).toEqual({ sessionsCount: 1, bestScore: 80 });
    // exame sem sessões → ausente do mapa
    expect(stats.get('00000000-0000-4000-8000-000000000000')).toBeUndefined();

    // userId de outro usuário → mapa vazio
    const none = await quizRepository.statsByExamIds(testUserId('nobody'), [examId]);
    expect(none.size).toBe(0);
  });

  itDb('GET /summary (rota) retorna o shape do contrato', async () => {
    const res = await statsRoutes.request('/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    for (const key of [
      'xp', 'level', 'levelProgressPct', 'streakDays', 'totalSessions',
      'totalAnswered', 'totalCorrect', 'accuracyPct', 'totalTimeMs',
      'weakestSubject', 'perSubject', 'badges',
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(Array.isArray(body['perSubject'])).toBe(true);
    const badges = body['badges'] as Array<{ id: string; label: string; earned: boolean }>;
    expect(badges.map((b) => b.id)).toEqual([
      'first-session', 'perfect', 'streak-7', 'centurion', 'scholar', 'sharp',
    ]);
  });

  itDb('GET /api/exams inclui stats por exame e exclui kind=bank', async () => {
    const res = await examsRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      exams: Array<{ id: string; kind: string; stats: { sessionsCount: number; bestScore: number | null } }>;
    };

    expect(body.exams.length).toBeGreaterThan(0);
    // nenhum exame sintético do banco na lista padrão
    expect(body.exams.every((e) => e.kind !== 'bank')).toBe(true);
    for (const exam of body.exams) {
      expect(typeof exam.stats.sessionsCount).toBe('number');
      expect(exam.stats.bestScore === null || typeof exam.stats.bestScore === 'number').toBe(true);
    }

    // O exame semeado aparece com stats reais (dev enxerga todos os users).
    const mine = body.exams.find((e) => e.id === examId);
    expect(mine?.stats).toEqual({ sessionsCount: 2, bestScore: 100 });
  });

  itDb('listByUser exclui kind=bank do resultado', async () => {
    // cria bank exam do userS para provar a exclusão
    const bankExam = await insertExam({
      userId: userS, kind: 'bank', status: 'completed', title: 'Banco de Questões',
    });
    const listed = await examsRepository.listByUser(userS, { limit: 50, offset: 0 });
    expect(listed.some((e) => e.id === bankExam.id)).toBe(false);
    expect(listed.some((e) => e.id === examId)).toBe(true);
  });
});
