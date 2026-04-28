import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { questions, quizAnswers, quizSessions } from '../db/schema.js';

interface CreateSessionInput {
  examId: string;
  totalQuestions: number;
}

interface FinalizeSessionInput {
  sessionId: string;
  correctAnswers: number;
  score: number;
}

interface UpsertAnswerInput {
  sessionId: string;
  questionId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  timeSpentMs?: number;
}

class QuizRepository {
  async createSession(input: CreateSessionInput): Promise<typeof quizSessions.$inferSelect> {
    const [created] = await db
      .insert(quizSessions)
      .values({
        examId: input.examId,
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

  async finalizeSession(input: FinalizeSessionInput): Promise<typeof quizSessions.$inferSelect | undefined> {
    const [updated] = await db
      .update(quizSessions)
      .set({
        finishedAt: new Date(),
        correctAnswers: input.correctAnswers,
        score: input.score,
      })
      .where(eq(quizSessions.id, input.sessionId))
      .returning();

    return updated;
  }

  async upsertAnswer(input: UpsertAnswerInput): Promise<typeof quizAnswers.$inferSelect> {
    const [answer] = await db
      .insert(quizAnswers)
      .values({
        sessionId: input.sessionId,
        questionId: input.questionId,
        selectedAnswer: input.selectedAnswer,
        isCorrect: input.isCorrect,
        timeSpentMs: input.timeSpentMs,
      })
      .onConflictDoUpdate({
        target: [quizAnswers.sessionId, quizAnswers.questionId],
        set: {
          selectedAnswer: input.selectedAnswer,
          isCorrect: input.isCorrect,
          timeSpentMs: input.timeSpentMs,
          answeredAt: new Date(),
        },
      })
      .returning();

    return answer;
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

  async listAnswersBySessionId(sessionId: string): Promise<Array<typeof quizAnswers.$inferSelect & {
    questionText: string;
    correctAnswer: string | null;
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
      })
      .from(quizAnswers)
      .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
      .where(eq(quizAnswers.sessionId, sessionId))
      .orderBy(asc(quizAnswers.answeredAt));
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
