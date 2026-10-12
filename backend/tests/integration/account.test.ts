import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
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
import { db } from '../../src/db/client.js';
import { account, exams, questions, quizAnswers, quizSessions, session } from '../../src/db/schema.js';
import {
  buildAccountExport,
  deleteUserAccount,
  listUserProviders,
  PasswordRequiredError,
  PasswordVerificationError,
} from '../../src/services/account-service.js';
import { accountRoutes } from '../../src/routes/account.js';

/**
 * T2 — conta: GET /, GET /export, DELETE. Service-level com DB real
 * (DELETE via service: a rota sempre apaga o PRÓPRIO usuário — no
 * AUTH_DISABLED dos testes isso seria o stub 'local', então o caminho
 * feliz de delete é exercido no service com usuário semeado).
 */
describe('account (T2)', () => {
  let dbUp = false;
  const itDb = makeItDb(() => dbUp);

  const userPw = testUserId('acct-pw');   // credential + google
  const userOauth = testUserId('acct-g'); // só google
  const users = [userPw, userOauth];

  let examId = '';
  let questionId = '';
  let sessionId = '';
  let answerId = '';

  const PW_HASH = () => hashPassword('senha-super-123');

  beforeAll(async () => {
    dbUp = await checkDbAvailable();
    if (!dbUp) return;

    await createTestUser(userPw);
    await createTestUser(userOauth);

    const now = new Date();
    // userPw: credential (email/senha) + google linkado.
    await db.insert(account).values([
      {
        id: `${userPw}-cred`, accountId: userPw, providerId: 'credential',
        userId: userPw, password: await PW_HASH(), createdAt: now, updatedAt: now,
      },
      {
        id: `${userPw}-goog`, accountId: 'g-123', providerId: 'google',
        userId: userPw, createdAt: now, updatedAt: now,
      },
      {
        id: `${userOauth}-goog`, accountId: 'g-456', providerId: 'google',
        userId: userOauth, createdAt: now, updatedAt: now,
      },
    ]);
    await db.insert(session).values({
      id: `${userPw}-sess`, token: `${userPw}-tok`, userId: userPw,
      expiresAt: new Date(Date.now() + 3600_000), createdAt: now, updatedAt: now,
    });

    // Dados de domínio do userPw (o export e a cascata são medidos nele).
    const exam = await insertExam({ userId: userPw, status: 'completed', banca: 'FCC' });
    examId = exam.id;
    const q = await insertQuestion({ examId, order: 1, subject: 'Direito', correctAnswer: 'C' });
    questionId = q.id;
    const s = await insertSession({
      examId, userId: userPw, totalQuestions: 1,
      finishedAt: new Date(), score: 100, correctAnswers: 1,
      modeParams: { questionIds: [questionId] },
    });
    sessionId = s.id;
    const a = await insertAnswer({ sessionId, questionId, selectedAnswer: 'C', isCorrect: true });
    answerId = a.id;
  });

  afterAll(async () => {
    if (!dbUp) return;
    await deleteTestUsers(users);
  });

  itDb('listUserProviders: credential+google; só-google; dedup', async () => {
    expect((await listUserProviders(userPw)).sort()).toEqual(['credential', 'google']);
    expect(await listUserProviders(userOauth)).toEqual(['google']);
  });

  itDb('buildAccountExport: shape do contrato completo', async () => {
    const out = await buildAccountExport(userPw);

    // contrato: user, exams, questions, quizSessions, quizAnswers, stats
    for (const key of ['user', 'exams', 'questions', 'quizSessions', 'quizAnswers', 'stats']) {
      expect(out).toHaveProperty(key);
    }
    expect(out.user.id).toBe(userPw);
    expect(out.user.email).toBe(`${userPw}@it.local`);
    expect(out.user.providers.sort()).toEqual(['credential', 'google']);

    // exams no DTO da API — SEM campos internos (filePath/fileKey/userId...)
    const myExam = out.exams.find((e) => e.id === examId);
    expect(myExam).toBeDefined();
    expect(myExam).toMatchObject({ title: 'IT Exam', status: 'completed', banca: 'FCC', kind: 'exam' });
    for (const forbidden of ['filePath', 'fileKey', 'gabaritoKey', 'gabaritoPath', 'fileHash', 'userId']) {
      expect(myExam).not.toHaveProperty(forbidden);
    }

    expect(out.questions.some((q) => q.id === questionId)).toBe(true);
    expect(out.quizSessions.some((s) => s.id === sessionId)).toBe(true);
    expect(out.quizAnswers.some((a) => a.id === answerId)).toBe(true);

    // stats = payload de /api/stats/summary
    expect(out.stats).toMatchObject({ totalSessions: 1, totalAnswered: 1, totalCorrect: 1 });
    expect(typeof out.stats.xp).toBe('number');
    expect(Array.isArray(out.stats.badges)).toBe(true);
  });

  itDb('buildAccountExport: usuário vazio → arrays vazios, sem erro', async () => {
    const empty = testUserId('acct-empty');
    users.push(empty);
    await createTestUser(empty);

    const out = await buildAccountExport(empty);
    expect(out.exams).toEqual([]);
    expect(out.questions).toEqual([]);
    expect(out.quizSessions).toEqual([]);
    expect(out.quizAnswers).toEqual([]);
    expect(out.stats.totalSessions).toBe(0);
  });

  itDb('deleteUserAccount: credential exige senha — sem → PasswordRequiredError', async () => {
    await expect(deleteUserAccount(userPw, {})).rejects.toBeInstanceOf(PasswordRequiredError);
  });

  itDb('deleteUserAccount: credential senha errada → PasswordVerificationError', async () => {
    await expect(
      deleteUserAccount(userPw, { password: 'errada-123' }),
    ).rejects.toBeInstanceOf(PasswordVerificationError);
  });

  itDb('deleteUserAccount: OAuth-only apaga sem senha + cascata completa', async () => {
    // dado de domínio no OAuth-only para provar a cascata além de session/account
    const oauthExam = await insertExam({ userId: userOauth, status: 'completed' });
    await insertQuestion({ examId: oauthExam.id, order: 1 });

    await deleteUserAccount(userOauth, {});

    const [acc, ex, qs] = await Promise.all([
      db.select().from(account).where(eq(account.userId, userOauth)),
      db.select().from(exams).where(eq(exams.userId, userOauth)),
      db.select().from(questions).where(eq(questions.examId, oauthExam.id)),
    ]);
    expect(acc).toHaveLength(0);
    expect(ex).toHaveLength(0);
    expect(qs).toHaveLength(0);
  });

  itDb('deleteUserAccount: credential com senha correta → apaga tudo em cascata', async () => {
    await deleteUserAccount(userPw, { password: 'senha-super-123' });

    const [acc, sess, ex, qs, qss, qa] = await Promise.all([
      db.select().from(account).where(eq(account.userId, userPw)),
      db.select().from(session).where(eq(session.userId, userPw)),
      db.select().from(exams).where(eq(exams.userId, userPw)),
      db.select().from(questions).where(eq(questions.examId, examId)),
      db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)),
      db.select().from(quizAnswers).where(eq(quizAnswers.sessionId, sessionId)),
    ]);
    expect(acc).toHaveLength(0);
    expect(sess).toHaveLength(0);
    expect(ex).toHaveLength(0);
    expect(qs).toHaveLength(0);
    expect(qss).toHaveLength(0);
    expect(qa).toHaveLength(0);
  });

  // --- Rotas (usuário stub 'local' do AUTH_DISABLED; só caminhos não-destrutivos) ---

  itDb('GET / (rota): user + providers + statsSummary', async () => {
    const res = await accountRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    for (const key of ['user', 'providers', 'statsSummary']) {
      expect(body).toHaveProperty(key);
    }
    const u = body['user'] as Record<string, unknown>;
    for (const key of ['id', 'name', 'email', 'image', 'createdAt']) {
      expect(u).toHaveProperty(key);
    }
    expect(u['id']).toBe('local');
    expect(Array.isArray(body['providers'])).toBe(true);
    const stats = body['statsSummary'] as Record<string, unknown>;
    for (const key of ['xp', 'level', 'streakDays', 'badges']) {
      expect(stats).toHaveProperty(key);
    }
  });

  itDb('GET /export (rota): attachment + contrato', async () => {
    const res = await accountRoutes.request('/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="singular-export.json"');
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const body = await res.json() as Record<string, unknown>;
    for (const key of ['user', 'exams', 'questions', 'quizSessions', 'quizAnswers', 'stats']) {
      expect(body).toHaveProperty(key);
    }
  });

  itDb('DELETE / (rota): sem confirmation APAGAR → 400, nada é apagado', async () => {
    const res = await accountRoutes.request('/', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'apagar' }), // case errada → rejeita
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');

    // stub 'local' continua vivo (prova de que nada foi apagado)
    const res2 = await accountRoutes.request('/');
    expect(res2.status).toBe(200);
  });
});
