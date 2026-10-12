import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import {
  exams,
  questions,
  quizAnswers,
  quizSessions,
  user,
  type NewExamRow,
  type NewQuestionRow,
  type NewQuizAnswerRow,
  type NewQuizSessionRow,
} from '../../src/db/schema.js';

/** Fixtures dos testes de integração — cleanup por delete em `user` (cascade). */

export function testUserId(tag: string): string {
  return `it-${tag}-${randomUUID().slice(0, 8)}`;
}

export async function createTestUser(id: string): Promise<void> {
  const now = new Date();
  await db
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@it.local`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: user.id });
}

export async function deleteTestUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // exams/sessions têm FK cascade em user_id → limpa a árvore inteira.
  await db.delete(user).where(inArray(user.id, ids));
}

export async function insertExam(
  values: Partial<NewExamRow> & { userId: string },
): Promise<typeof exams.$inferSelect> {
  const [row] = await db
    .insert(exams)
    .values({
      title: 'IT Exam',
      originalFilename: 'it.pdf',
      filePath: `/tmp/${randomUUID()}.pdf`,
      fileType: 'pdf',
      status: 'completed',
      ...values,
    })
    .returning();
  return row;
}

export async function insertQuestion(
  values: Partial<NewQuestionRow> & { examId: string; order: number },
): Promise<typeof questions.$inferSelect> {
  const [row] = await db
    .insert(questions)
    .values({
      questionText: `Questão ${randomUUID().slice(0, 8)}`,
      options: ['A) x', 'B) y', 'C) z', 'D) w', 'E) v'],
      correctAnswer: 'A',
      contentHash: randomUUID().replaceAll('-', ''),
      ...values,
    })
    .returning();
  return row;
}

export async function insertSession(
  values: Partial<NewQuizSessionRow> & { examId: string; userId: string },
): Promise<typeof quizSessions.$inferSelect> {
  const [row] = await db
    .insert(quizSessions)
    .values({
      mode: 'all',
      totalQuestions: 1,
      ...values,
    })
    .returning();
  return row;
}

export async function insertAnswer(
  values: NewQuizAnswerRow,
): Promise<typeof quizAnswers.$inferSelect> {
  const [row] = await db.insert(quizAnswers).values(values).returning();
  return row;
}
