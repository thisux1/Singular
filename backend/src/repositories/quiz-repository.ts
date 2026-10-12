import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { questions, quizAnswers, quizSessions } from '../db/schema.js';

export type QuizMode = 'all' | 'subjects' | 'random' | 'wrong';

/**
 * Modo persistido em quiz_sessions.mode: os QuizMode selecionáveis via
 * POST /quiz/start MAIS 'bank' (sessão do banco de questões, criada apenas
 * via POST /api/bank/session — `isQuizMode` continua rejeitando 'bank'
 * no /quiz/start).
 */
export type SessionMode = QuizMode | 'bank';

export const QUIZ_MODES: readonly QuizMode[] = ['all', 'subjects', 'random', 'wrong'];

/** Random mode: default 30 questões, clamp em [5, total] (BACKEND-SCHEMA §2). */
export const RANDOM_MODE_DEFAULT_COUNT = 30;
export const RANDOM_MODE_MIN_COUNT = 5;

export function isQuizMode(value: unknown): value is QuizMode {
  return typeof value === 'string' && (QUIZ_MODES as readonly string[]).includes(value);
}

/** Clamp do `count` do modo random: [5, total]; com total < 5 usa o próprio total. */
export function clampQuestionCount(count: number | undefined, total: number): number {
  const upper = Math.max(total, 0);
  const effectiveMin = Math.min(RANDOM_MODE_MIN_COUNT, upper);
  const requested = Number.isInteger(count) && (count as number) > 0
    ? (count as number)
    : RANDOM_MODE_DEFAULT_COUNT;
  return Math.max(effectiveMin, Math.min(requested, upper));
}

export function computeScorePercent(correctAnswers: number, totalQuestions: number): number {
  if (totalQuestions <= 0) {
    return 0;
  }

  return Number(((correctAnswers / totalQuestions) * 100).toFixed(2));
}

interface CreateSessionInput {
  examId: string;
  userId: string;
  mode: SessionMode;
  modeParams: Record<string, unknown>;
  totalQuestions: number;
}

interface FinalizeSessionInput {
  sessionId: string;
  correctAnswers: number;
  score: number;
  totalTimeMs: number | null;
}

interface InsertAnswerInput {
  sessionId: string;
  questionId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  timeSpentMs?: number;
}

interface SelectQuestionIdsInput {
  examId: string;
  userId: string;
  mode: QuizMode;
  subjects?: string[];
  count?: number;
  shuffle?: boolean;
}

/** Linha de resposta + estado da questão dentro do conjunto da sessão. */
export interface SessionQuestionState {
  questionId: string;
  order: number;
  questionText: string;
  subject: string | null;
  annulled: boolean;
  correctAnswer: string | null;
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  timeSpentMs: number | null;
  answeredAt: Date | null;
}

class QuizRepository {
  async createSession(input: CreateSessionInput): Promise<typeof quizSessions.$inferSelect> {
    const [created] = await db
      .insert(quizSessions)
      .values({
        examId: input.examId,
        userId: input.userId,
        mode: input.mode,
        modeParams: input.modeParams,
        totalQuestions: input.totalQuestions,
      })
      .returning();

    return created;
  }

  async getSessionById(sessionId: string): Promise<typeof quizSessions.$inferSelect | undefined> {
    const [session] = await db
      .select()
      .from(quizSessions)
      .where(eq(quizSessions.id, sessionId))
      .limit(1);

    return session;
  }

  /**
   * Seleciona o conjunto de questões da sessão conforme o modo (D19).
   * `wrong`: distinct question_id com is_correct=false em sessões FINALIZADAS
   * do mesmo usuário neste exame.
   */
  async selectQuestionIds(input: SelectQuestionIdsInput): Promise<string[]> {
    if (input.mode === 'wrong') {
      const wrongRows = await db
        .selectDistinct({ questionId: quizAnswers.questionId })
        .from(quizAnswers)
        .innerJoin(quizSessions, eq(quizSessions.id, quizAnswers.sessionId))
        .where(and(
          eq(quizSessions.examId, input.examId),
          eq(quizSessions.userId, input.userId),
          isNotNull(quizSessions.finishedAt),
          eq(quizAnswers.isCorrect, false),
        ));

      const ids = wrongRows.map((row) => row.questionId);
      if (ids.length === 0) {
        return [];
      }

      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.examId, input.examId), inArray(questions.id, ids)))
        .orderBy(asc(questions.order));

      return rows.map((row) => row.id);
    }

    if (input.mode === 'subjects') {
      const subjects = (input.subjects ?? [])
        .map((subject) => subject.trim())
        .filter((subject) => subject.length > 0);

      if (subjects.length === 0) {
        return [];
      }

      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.examId, input.examId), inArray(questions.subject, subjects)))
        .orderBy(asc(questions.order));

      return rows.map((row) => row.id);
    }

    if (input.mode === 'random') {
      const [totalRow] = await db
        .select({ value: count() })
        .from(questions)
        .where(eq(questions.examId, input.examId));
      const total = totalRow?.value ?? 0;
      const limit = clampQuestionCount(input.count, total);

      if (limit === 0) {
        return [];
      }

      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.examId, input.examId))
        .orderBy(sql`random()`)
        .limit(limit);

      return rows.map((row) => row.id);
    }

    // mode === 'all'
    const rows = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.examId, input.examId))
      .orderBy(input.shuffle === true ? sql`random()` : asc(questions.order));

    return rows.map((row) => row.id);
  }

  /**
   * Insert atômico — substitui o check-then-act (race) por
   * ON CONFLICT DO NOTHING + verificação do retorno (D19/BACKEND-SCHEMA §2).
   */
  async insertAnswer(input: InsertAnswerInput): Promise<{ inserted: boolean }> {
    const inserted = await db
      .insert(quizAnswers)
      .values({
        sessionId: input.sessionId,
        questionId: input.questionId,
        selectedAnswer: input.selectedAnswer,
        isCorrect: input.isCorrect,
        timeSpentMs: input.timeSpentMs,
      })
      .onConflictDoNothing({
        target: [quizAnswers.sessionId, quizAnswers.questionId],
      })
      .returning({ id: quizAnswers.id });

    return { inserted: inserted.length > 0 };
  }

  async getAnswerBySessionAndQuestion(
    sessionId: string,
    questionId: string,
  ): Promise<typeof quizAnswers.$inferSelect | undefined> {
    const [answer] = await db
      .select()
      .from(quizAnswers)
      .where(and(eq(quizAnswers.sessionId, sessionId), eq(quizAnswers.questionId, questionId)))
      .limit(1);

    return answer;
  }

  /**
   * Idempotente: só finaliza se finished_at ainda for NULL. Retorna undefined
   * quando outra chamada já finalizou (caller refaz o fetch).
   */
  async finalizeSession(input: FinalizeSessionInput): Promise<typeof quizSessions.$inferSelect | undefined> {
    const [updated] = await db
      .update(quizSessions)
      .set({
        finishedAt: new Date(),
        correctAnswers: input.correctAnswers,
        score: input.score,
        totalTimeMs: input.totalTimeMs,
      })
      .where(and(eq(quizSessions.id, input.sessionId), isNull(quizSessions.finishedAt)))
      .returning();

    return updated;
  }

  /** Soma de time_spent_ms — null quando nenhuma resposta tem tempo registrado. */
  async sumTimeSpentBySessionId(sessionId: string): Promise<number | null> {
    const [result] = await db
      .select({ value: sql<number | null>`sum(${quizAnswers.timeSpentMs})` })
      .from(quizAnswers)
      .where(eq(quizAnswers.sessionId, sessionId));

    return result?.value ?? null;
  }

  async listAnswersBySessionId(sessionId: string): Promise<Array<typeof quizAnswers.$inferSelect & {
    questionText: string;
    correctAnswer: string | null;
    subject: string | null;
    annulled: boolean;
  }>> {
    return await db
      .select({
        id: quizAnswers.id,
        sessionId: quizAnswers.sessionId,
        questionId: quizAnswers.questionId,
        selectedAnswer: quizAnswers.selectedAnswer,
        isCorrect: quizAnswers.isCorrect,
        timeSpentMs: quizAnswers.timeSpentMs,
        answeredAt: quizAnswers.answeredAt,
        questionText: questions.questionText,
        correctAnswer: questions.correctAnswer,
        subject: questions.subject,
        annulled: questions.annulled,
      })
      .from(quizAnswers)
      .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
      .where(eq(quizAnswers.sessionId, sessionId))
      .orderBy(asc(quizAnswers.answeredAt));
  }

  /**
   * Estado completo do conjunto de questões da sessão (snapshot em
   * modeParams.questionIds) com left join nas respostas — base para score,
   * perSubject e result.
   *
   * `examId === null` → sem filtro de exame: usado por sessões mode='bank',
   * cujo snapshot mistura questões de exames diferentes (session.examId é o
   * exame sintético kind='bank', que não tem questions próprias).
   */
  async listSessionQuestionStates(
    sessionId: string,
    examId: string | null,
    questionIds: string[],
  ): Promise<SessionQuestionState[]> {
    if (questionIds.length === 0) {
      return [];
    }

    const where = examId === null
      ? inArray(questions.id, questionIds)
      : and(eq(questions.examId, examId), inArray(questions.id, questionIds));

    const rows = await db
      .select({
        questionId: questions.id,
        order: questions.order,
        questionText: questions.questionText,
        subject: questions.subject,
        annulled: questions.annulled,
        correctAnswer: questions.correctAnswer,
        selectedAnswer: quizAnswers.selectedAnswer,
        isCorrect: quizAnswers.isCorrect,
        timeSpentMs: quizAnswers.timeSpentMs,
        answeredAt: quizAnswers.answeredAt,
      })
      .from(questions)
      .leftJoin(quizAnswers, and(
        eq(quizAnswers.questionId, questions.id),
        eq(quizAnswers.sessionId, sessionId),
      ))
      .where(where)
      .orderBy(asc(questions.order));

    return rows;
  }

  async listSessionsByUser(
    userId: string,
    examId?: string,
  ): Promise<typeof quizSessions.$inferSelect[]> {
    const conditions = [eq(quizSessions.userId, userId)];
    if (examId) {
      conditions.push(eq(quizSessions.examId, examId));
    }

    return await db
      .select()
      .from(quizSessions)
      .where(and(...conditions))
      .orderBy(desc(quizSessions.startedAt));
  }

  /**
   * Agregação por exame para GET /api/exams (T4): sessões FINALIZADAS do
   * usuário agrupadas por examId — sessionsCount + bestScore (max score).
   * `userId === undefined` → sem filtro (dev single-user).
   */
  async statsByExamIds(
    userId: string | undefined,
    examIds: string[],
  ): Promise<Map<string, { sessionsCount: number; bestScore: number | null }>> {
    const result = new Map<string, { sessionsCount: number; bestScore: number | null }>();
    if (examIds.length === 0) {
      return result;
    }

    const conditions = [
      isNotNull(quizSessions.finishedAt),
      inArray(quizSessions.examId, examIds),
    ];
    if (userId !== undefined) {
      conditions.push(eq(quizSessions.userId, userId));
    }

    const rows = await db
      .select({
        examId: quizSessions.examId,
        sessionsCount: count(),
        bestScore: sql<number | null>`max(${quizSessions.score})`,
      })
      .from(quizSessions)
      .where(and(...conditions))
      .groupBy(quizSessions.examId);

    for (const row of rows) {
      result.set(row.examId, {
        sessionsCount: row.sessionsCount,
        bestScore: row.bestScore,
      });
    }

    return result;
  }

  // --- Stats/gamificação (T4) ------------------------------------------------
  // Escopo por usuário REAL (getUser.id) — mesmo padrão de listSessionsByUser.

  /** Sessões finalizadas do usuário — base de xp/streak/badges/totalTimeMs. */
  async finishedSessionsForStats(userId: string): Promise<Array<{
    score: number | null;
    totalQuestions: number;
    finishedAt: Date;
    totalTimeMs: number | null;
  }>> {
    const rows = await db
      .select({
        score: quizSessions.score,
        totalQuestions: quizSessions.totalQuestions,
        finishedAt: quizSessions.finishedAt,
        totalTimeMs: quizSessions.totalTimeMs,
      })
      .from(quizSessions)
      .where(and(eq(quizSessions.userId, userId), isNotNull(quizSessions.finishedAt)));

    return rows
      .filter((row): row is typeof row & { finishedAt: Date } => row.finishedAt !== null);
  }

  /**
   * Totais de respostas do usuário (todas as sessões, inclusive em andamento):
   * respondidas, corretas e soma de time_spent_ms.
   */
  async answerTotalsForUser(userId: string): Promise<{
    total: number;
    correct: number;
    timeMs: number;
  }> {
    const [row] = await db
      .select({
        total: count(),
        correct: sql<number>`count(*) filter (where ${quizAnswers.isCorrect})`,
        timeMs: sql<number | null>`sum(${quizAnswers.timeSpentMs})`,
      })
      .from(quizAnswers)
      .innerJoin(quizSessions, eq(quizSessions.id, quizAnswers.sessionId))
      .where(eq(quizSessions.userId, userId));

    return {
      total: row?.total ?? 0,
      correct: Number(row?.correct ?? 0),
      timeMs: Number(row?.timeMs ?? 0),
    };
  }

  /** Respostas agregadas por disciplina (null → 'Sem disciplina'). */
  async perSubjectForUser(userId: string): Promise<Array<{
    subject: string;
    total: number;
    correct: number;
  }>> {
    const rows = await db
      .select({
        subject: questions.subject,
        total: count(),
        correct: sql<number>`count(*) filter (where ${quizAnswers.isCorrect})`,
      })
      .from(quizAnswers)
      .innerJoin(quizSessions, eq(quizSessions.id, quizAnswers.sessionId))
      .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
      .where(eq(quizSessions.userId, userId))
      .groupBy(questions.subject);

    return rows.map((row) => ({
      subject: row.subject ?? 'Sem disciplina',
      total: row.total,
      correct: Number(row.correct),
    }));
  }

  async countAnswersBySessionId(sessionId: string): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(quizAnswers)
      .where(eq(quizAnswers.sessionId, sessionId));

    return result?.value ?? 0;
  }

  async countCorrectAnswersBySessionId(sessionId: string): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(quizAnswers)
      .where(and(eq(quizAnswers.sessionId, sessionId), eq(quizAnswers.isCorrect, true)));

    return result?.value ?? 0;
  }
}

export const quizRepository = new QuizRepository();
