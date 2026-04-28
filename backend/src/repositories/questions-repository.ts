import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { questions, type NewQuestionRow } from '../db/schema.js';

export interface PendingClassificationQuestion {
  id: string;
  order: number;
  questionText: string;
  options: string[];
}

export interface QuestionClassificationPatch {
  questionId: string;
  subject: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

class QuestionsRepository {
  async replaceForExam(examId: string, rows: NewQuestionRow[]): Promise<number> {
    return await db.transaction(async (tx) => {
      await tx.delete(questions).where(eq(questions.examId, examId));

      if (rows.length === 0) {
        return 0;
      }

      const inserted = await tx.insert(questions).values(rows).returning({ id: questions.id });
      return inserted.length;
    });
  }

  async countByExamId(examId: string): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(questions)
      .where(eq(questions.examId, examId));

    return result?.value ?? 0;
  }

  async listByExamId(examId: string): Promise<typeof questions.$inferSelect[]> {
    return await db
      .select()
      .from(questions)
      .where(eq(questions.examId, examId))
      .orderBy(asc(questions.order), asc(questions.createdAt));
  }

  async listPendingClassificationByExamId(examId: string): Promise<PendingClassificationQuestion[]> {
    return await db
      .select({
        id: questions.id,
        order: questions.order,
        questionText: questions.questionText,
        options: questions.options,
      })
      .from(questions)
      .where(and(eq(questions.examId, examId), eq(questions.classificationStatus, 'pending')))
      .orderBy(asc(questions.order), asc(questions.createdAt));
  }

  async updateClassificationsForExam(examId: string, patches: QuestionClassificationPatch[]): Promise<number> {
    if (patches.length === 0) {
      return 0;
    }

    return await db.transaction(async (tx) => {
      let updatedCount = 0;

      for (const patch of patches) {
        const [updated] = await tx
          .update(questions)
          .set({
            subject: patch.subject,
            topic: patch.topic,
            difficulty: patch.difficulty,
            classificationStatus: 'classified',
          })
          .where(and(eq(questions.examId, examId), eq(questions.id, patch.questionId)))
          .returning({ id: questions.id });

        if (updated) {
          updatedCount += 1;
        }
      }

      return updatedCount;
    });
  }

  async markClassificationFailed(examId: string, questionIds: string[]): Promise<number> {
    if (questionIds.length === 0) {
      return 0;
    }

    return await db.transaction(async (tx) => {
      let updatedCount = 0;

      for (const questionId of questionIds) {
        const [updated] = await tx
          .update(questions)
          .set({ classificationStatus: 'failed' })
          .where(and(eq(questions.examId, examId), eq(questions.id, questionId)))
          .returning({ id: questions.id });

        if (updated) {
          updatedCount += 1;
        }
      }

      return updatedCount;
    });
  }

  async getById(questionId: string): Promise<typeof questions.$inferSelect | undefined> {
    const [question] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    return question;
  }

  async getByExamAndId(examId: string, questionId: string): Promise<typeof questions.$inferSelect | undefined> {
    const [question] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.examId, examId), eq(questions.id, questionId)))
      .limit(1);

    return question;
  }

  async update(id: string, patch: Partial<NewQuestionRow>): Promise<boolean> {
    const [updated] = await db
      .update(questions)
      .set({ ...patch, createdAt: undefined })
      .where(eq(questions.id, id))
      .returning({ id: questions.id });

    return !!updated;
  }

  async delete(examId: string, questionId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(questions)
      .where(and(eq(questions.examId, examId), eq(questions.id, questionId)))
      .returning({ id: questions.id });

    return !!deleted;
  }
}

export const questionsRepository = new QuestionsRepository();
