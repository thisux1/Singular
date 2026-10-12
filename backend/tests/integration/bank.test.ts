import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { checkDbAvailable, makeItDb } from '../helpers/db.js';
import {
  createTestUser,
  deleteTestUsers,
  insertExam,
  insertQuestion,
  testUserId,
} from '../helpers/seed.js';
import { bankRepository } from '../../src/repositories/bank-repository.js';
import { bankRoutes } from '../../src/routes/bank.js';
import { quizRoutes } from '../../src/routes/quiz.js';
import { quizRepository } from '../../src/repositories/quiz-repository.js';
import { db } from '../../src/db/client.js';
import { quizSessions } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * T3 — banco de questões: filters, questions com filtros combinados,
 * ownership em POST /session e o fluxo completo session→answer→finish→result
 * (snapshot cross-exam sem filtro por session.examId).
 *
 * Rotas exercitadas via <routes>.request em AUTH_DISABLED (user 'local' —
 * ownershipUserId()=undefined → escopo global, coerente com dev single-user).
 */
describe('banco de questões (T3)', () => {
  let dbUp = false;
  const itDb = makeItDb(() => dbUp);

  const userB = testUserId('bank-u');
  const userOther = testUserId('bank-o');
  const users = [userB, userOther];

  const jsonHeaders = { 'Content-Type': 'application/json' };

  let qMat1 = '';
  let qMat2 = '';
  let qPort = '';
  let qInfo = '';
  let qOther = '';
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    dbUp = await checkDbAvailable();
    if (!dbUp) return;

    await createTestUser(userB);
    await createTestUser(userOther);

    const exam1 = await insertExam({
      userId: userB,
      title: 'Cesgranrio 2023',
      banca: 'Cesgranrio',
      examDate: '2023-05-14',
      status: 'completed',
    });
    const exam2 = await insertExam({
      userId: userB,
      title: 'FCC 2020',
      banca: 'FCC',
      examDate: '2020-01-20',
      status: 'completed',
    });
    const otherExam = await insertExam({
      userId: userOther,
      title: 'Prova de outro usuário',
      banca: 'OutraBanca',
      examDate: '2021-03-10',
      status: 'completed',
    });

    const m1 = await insertQuestion({
      examId: exam1.id, order: 1,
      questionText: 'Calcule o juros simples do capital',
      subject: 'Matemática', topic: 'Juros', difficulty: 'easy', correctAnswer: 'B',
    });
    const m2 = await insertQuestion({
      examId: exam1.id, order: 2,
      questionText: 'Porcentagem de desconto sucessivo',
      subject: 'Matemática', topic: 'Porcentagem', difficulty: 'hard',
      annulled: true, correctAnswer: 'D',
    });
    const p1 = await insertQuestion({
      examId: exam2.id, order: 1,
      questionText: 'Analise a oração subordinada',
      subject: 'Português', topic: 'Sintaxe', difficulty: 'medium', correctAnswer: 'A',
    });
    const i1 = await insertQuestion({
      examId: exam2.id, order: 2,
      questionText: 'Protocolo de rede TCP',
      subject: 'Informática', topic: 'Redes', difficulty: 'easy', correctAnswer: 'E',
      hasImage: true, sourcePage: 7,
    });
    const o1 = await insertQuestion({
      examId: otherExam.id, order: 1,
      questionText: 'Questão de outro usuário',
      subject: 'Direito', topic: 'Constitucional', difficulty: 'hard',
    });

    qMat1 = m1.id;
    qMat2 = m2.id;
    qPort = p1.id;
    qInfo = i1.id;
    qOther = o1.id;
  });

  afterAll(async () => {
    if (!dbUp) return;
    for (const sid of createdSessionIds) {
      await db.delete(quizSessions).where(eq(quizSessions.id, sid)).catch(() => undefined);
    }
    await deleteTestUsers(users);
    // usuário 'local' (stub AUTH_DISABLED) permanece — é estado legítimo do dev.
  });

  // ---------- repository ----------

  itDb('listFilters: distinct de subjects/topics/bancas/years no escopo do usuário', async () => {
    const filters = await bankRepository.listFilters(userB);

    expect(filters.subjects).toEqual(
      expect.arrayContaining(['Matemática', 'Português', 'Informática']),
    );
    expect(filters.subjects).not.toContain('Direito'); // de outro usuário
    expect(filters.topics).toEqual(expect.arrayContaining(['Juros', 'Sintaxe', 'Redes']));
    expect(filters.bancas).toEqual(['Cesgranrio', 'FCC']);
    expect(filters.years).toEqual(expect.arrayContaining([2023, 2020]));
    expect(filters.years).not.toContain(2021);
  });

  itDb('listQuestions sem filtro retorna todas do usuário com metadados do exame', async () => {
    const { items, total } = await bankRepository.listQuestions(userB, { page: 1, pageSize: 25 });

    expect(total).toBe(4);
    expect(items).toHaveLength(4);
    const byId = new Map(items.map((i) => [i.id, i]));

    expect(byId.get(qMat1)).toMatchObject({
      examTitle: 'Cesgranrio 2023',
      banca: 'Cesgranrio',
      year: 2023,
      subject: 'Matemática',
      topic: 'Juros',
      difficulty: 'easy',
      correctAnswer: 'B',
    });
    expect(byId.get(qMat2)?.annulled).toBe(true);
    expect(byId.get(qInfo)).toMatchObject({ banca: 'FCC', year: 2020, hasImage: true, sourcePage: 7 });
    expect(byId.has(qOther)).toBe(false);
  });

  itDb('listQuestions: filtros combinados (subject+difficulty, banca, year, q)', async () => {
    const mat = await bankRepository.listQuestions(userB, {
      subject: 'Matemática', page: 1, pageSize: 25,
    });
    expect(mat.total).toBe(2);

    const matEasy = await bankRepository.listQuestions(userB, {
      subject: 'Matemática', difficulty: 'easy', page: 1, pageSize: 25,
    });
    expect(matEasy.items.map((i) => i.id)).toEqual([qMat1]);

    const fcc = await bankRepository.listQuestions(userB, {
      banca: 'FCC', page: 1, pageSize: 25,
    });
    expect(fcc.total).toBe(2);

    const y2020 = await bankRepository.listQuestions(userB, {
      year: 2020, page: 1, pageSize: 25,
    });
    expect(new Set(y2020.items.map((i) => i.id))).toEqual(new Set([qPort, qInfo]));

    const combo = await bankRepository.listQuestions(userB, {
      banca: 'FCC', year: 2020, topic: 'Sintaxe', page: 1, pageSize: 25,
    });
    expect(combo.items.map((i) => i.id)).toEqual([qPort]);

    const byText = await bankRepository.listQuestions(userB, {
      q: 'juros simples', page: 1, pageSize: 25,
    });
    expect(byText.items.map((i) => i.id)).toEqual([qMat1]);

    const nothing = await bankRepository.listQuestions(userB, {
      subject: 'Matemática', banca: 'FCC', page: 1, pageSize: 25,
    });
    expect(nothing.total).toBe(0);
  });

  itDb('listQuestions: paginação', async () => {
    const page1 = await bankRepository.listQuestions(userB, { page: 1, pageSize: 2 });
    const page2 = await bankRepository.listQuestions(userB, { page: 2, pageSize: 2 });
    expect(page1.total).toBe(4);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    const ids1 = new Set(page1.items.map((i) => i.id));
    expect(page2.items.every((i) => !ids1.has(i.id))).toBe(true);
  });

  itDb('findOwnedQuestions: ids de outro usuário não são encontrados', async () => {
    const found = await bankRepository.findOwnedQuestions(userB, [qMat1, qPort, qOther]);
    expect(new Set(found.map((r) => r.id))).toEqual(new Set([qMat1, qPort]));

    // dev (undefined) → sem filtro: todas as questions de kind='exam' valem.
    const foundAll = await bankRepository.findOwnedQuestions(undefined, [qMat1, qOther]);
    expect(foundAll).toHaveLength(2);
  });

  itDb('getOrCreateBankExam: cria uma vez e é idempotente', async () => {
    const first = await bankRepository.getOrCreateBankExam(userB, userB);
    expect(first.kind).toBe('bank');
    expect(first.status).toBe('completed');
    expect(first.title).toBe('Banco de Questões');
    expect(first.originalFilename).toBe('__bank__');

    const second = await bankRepository.getOrCreateBankExam(userB, userB);
    expect(second.id).toBe(first.id);
  });

  // ---------- rotas ----------

  itDb('GET /filters retorna os 4 arrays', async () => {
    const res = await bankRoutes.request('/filters');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    for (const key of ['subjects', 'topics', 'bancas', 'years']) {
      expect(Array.isArray(body[key])).toBe(true);
    }
    // dev enxerga tudo → inclui os subjects semeados
    expect(body['subjects']).toEqual(expect.arrayContaining(['Matemática', 'Direito']));
  });

  itDb('GET /questions valida params e pagina', async () => {
    const badDifficulty = await bankRoutes.request('/questions?difficulty=expert');
    expect(badDifficulty.status).toBe(400);
    const badYear = await bankRoutes.request('/questions?year=abc');
    expect(badYear.status).toBe(400);
    const badPage = await bankRoutes.request('/questions?page=0');
    expect(badPage.status).toBe(400);

    const res = await bankRoutes.request('/questions?subject=Matem%C3%A1tica&difficulty=easy&page=1&pageSize=10');
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ id: string }>; total: number; page: number; pageSize: number };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.items.some((i) => i.id === qMat1)).toBe(true);
    expect(body.items.some((i) => i.id === qMat2)).toBe(false); // hard, não easy
  });

  itDb('POST /session: validação de entrada', async () => {
    const noBody = await bankRoutes.request('/session', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({}),
    });
    expect(noBody.status).toBe(400);

    const empty = await bankRoutes.request('/session', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ questionIds: [] }),
    });
    expect(empty.status).toBe(400);

    const notUuid = await bankRoutes.request('/session', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ questionIds: ['abc'] }),
    });
    expect(notUuid.status).toBe(400);

    const tooMany = await bankRoutes.request('/session', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ questionIds: Array.from({ length: 201 }, () => randomUUID()) }),
    });
    expect(tooMany.status).toBe(400);
  });

  itDb('POST /session: questionId inexistente → 422 INVALID_QUESTIONS', async () => {
    const res = await bankRoutes.request('/session', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ questionIds: ['00000000-0000-4000-8000-000000000000'] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_QUESTIONS');
  });

  itDb('POST /session cria sessão mode=bank e o player completo funciona', async () => {
    // Cria sessão via rota (user 'local' em AUTH_DISABLED).
    const res = await bankRoutes.request('/session', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ questionIds: [qMat1, qPort] }),
    });
    expect(res.status).toBe(200);
    const created = await res.json() as {
      sessionId: string; examId: string; mode: string; totalQuestions: number; questionIds: string[];
    };
    createdSessionIds.push(created.sessionId);

    expect(created.mode).toBe('bank');
    expect(created.totalQuestions).toBe(2);
    expect(created.questionIds).toEqual([qMat1, qPort]);

    const bankExam = await bankRepository.findBankExam(undefined);
    expect(created.examId).toBe(bankExam?.id);

    const session = await quizRepository.getSessionById(created.sessionId);
    expect(session?.mode).toBe('bank');
    expect(session?.examId).toBe(bankExam?.id);

    // --- Caminho crítico do spec: answer/finish/result com questions de
    // exames diferentes (snapshot, NÃO session.examId). ---
    const answerRes = await quizRoutes.request(`/${created.sessionId}/answer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ questionId: qMat1, selectedAnswer: 'B' }),
    });
    expect(answerRes.status).toBe(200);
    const answered = await answerRes.json() as { isCorrect: boolean; correctAnswer: string };
    expect(answered.isCorrect).toBe(true);
    expect(answered.correctAnswer).toBe('B');

    // Questão fora do snapshot → 404 (mesmo pertencendo a exame visível).
    const outsideRes = await quizRoutes.request(`/${created.sessionId}/answer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ questionId: qInfo, selectedAnswer: 'A' }),
    });
    expect(outsideRes.status).toBe(404);

    const finishRes = await quizRoutes.request(`/${created.sessionId}/finish`, {
      method: 'POST', headers: jsonHeaders, body: '{}',
    });
    expect(finishRes.status).toBe(200);
    const finished = await finishRes.json() as { score: number; correct: number; total: number; answered: number };
    expect(finished.total).toBe(2);
    expect(finished.correct).toBe(1);
    expect(finished.answered).toBe(1);
    expect(finished.score).toBe(50);

    const resultRes = await quizRoutes.request(`/${created.sessionId}/result`);
    expect(resultRes.status).toBe(200);
    const result = await resultRes.json() as {
      mode: string;
      answers: Array<{ questionId: string; isCorrect: boolean }>;
      perSubject: Array<{ subject: string; total: number; correct: number }>;
    };
    expect(result.mode).toBe('bank');
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]).toMatchObject({ questionId: qMat1, isCorrect: true });
    // perSubject cobre o snapshot inteiro (Mat + Port).
    const subjects = result.perSubject.map((s) => s.subject);
    expect(subjects).toEqual(expect.arrayContaining(['Matemática', 'Português']));
  });
});
