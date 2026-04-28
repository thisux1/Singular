import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { exams } from '../db/schema.js';
import type { ExamRecord, ExamStatus } from '../types/exam.js';

interface CreateExamInput {
  title?: string;
  originalFilename: string;
  filePath: string;
  fileType: 'pdf' | 'image';
  pageStart?: number;
  pageEnd?: number;
  provaType?: string;
  cargoTemplateId?: string;
  edital?: string;
  examDate?: string;
  gabaritoPath?: string;
}

function toExamRecord(row: typeof exams.$inferSelect): ExamRecord {
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    filePath: row.filePath,
    fileType: row.fileType,
    status: row.status,
    errorMessage: row.errorMessage ?? undefined,
    totalQuestions: row.totalQuestions ?? undefined,
    pageOffset: row.pageOffset ?? undefined,
    pageStart: row.pageStart ?? undefined,
    pageEnd: row.pageEnd ?? undefined,
    provaType: row.provaType ?? undefined,
    cargoTemplateId: row.cargoTemplateId ?? undefined,
    edital: row.edital ?? undefined,
    examDate: row.examDate ?? undefined,
    gabaritoPath: row.gabaritoPath ?? undefined,
    extractionTier: row.extractionTier ?? undefined,
    parsingLog: row.parsingLog ?? undefined,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString(),
  };
}

class ExamsRepository {
  async create(input: CreateExamInput): Promise<ExamRecord> {
    const [created] = await db
      .insert(exams)
      .values({
        id: randomUUID(),
        title: input.title ?? input.originalFilename,
        originalFilename: input.originalFilename,
        filePath: input.filePath,
        fileType: input.fileType,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        provaType: input.provaType,
        cargoTemplateId: input.cargoTemplateId,
        edital: input.edital,
        examDate: input.examDate,
        gabaritoPath: input.gabaritoPath,
        status: 'queued',
      })
      .returning();

    return toExamRecord(created);
  }

  async getById(id: string): Promise<ExamRecord | undefined> {
    const [row] = await db.select().from(exams).where(eq(exams.id, id)).limit(1);
    if (!row) {
      return undefined;
    }

    return toExamRecord(row);
  }

  async listAll(): Promise<ExamRecord[]> {
    const rows = await db.select().from(exams).orderBy(desc(exams.createdAt));
    return rows.map(toExamRecord);
  }

  async updateStatus(
    id: string,
    status: ExamStatus,
    patch?: Partial<ExamRecord>,
  ): Promise<ExamRecord | undefined> {
    const processedAt = status === 'completed' || status === 'failed' ? new Date() : undefined;

    const [updated] = await db
      .update(exams)
      .set({
        status,
        errorMessage: patch?.errorMessage,
        totalQuestions: patch?.totalQuestions,
        pageOffset: patch?.pageOffset,
        extractionTier: patch?.extractionTier,
        parsingLog: patch?.parsingLog,
        processedAt,
      })
      .where(eq(exams.id, id))
      .returning();

    if (!updated) {
      return undefined;
    }

    return toExamRecord(updated);
  }

  async delete(id: string): Promise<boolean> {
    const [deleted] = await db.delete(exams).where(eq(exams.id, id)).returning({ id: exams.id });
    return !!deleted;
  }
}

export const examsRepository = new ExamsRepository();
