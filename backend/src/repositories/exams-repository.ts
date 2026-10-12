import { and, desc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { exams } from '../db/schema.js';
import type { ExamRecord, ExamStatus, ExtractionTier } from '../types/exam.js';

interface CreateExamInput {
  id?: string;
  userId?: string;
  title?: string;
  originalFilename: string;
  filePath: string;
  fileKey?: string;
  gabaritoKey?: string;
  fileHash?: string;
  fileType: 'pdf' | 'image';
  pageStart?: number;
  pageEnd?: number;
  provaType?: string;
  cargoTemplateId?: string;
  edital?: string;
  examDate?: string;
  banca?: string;
  gabaritoPath?: string;
}

/**
 * Contrato do patch de status (D24):
 * - campo AUSENTE/`undefined` → coluna não é tocada;
 * - campo `null` → coluna é LIMPA (NULL no banco);
 * - valor → coluna recebe o valor.
 *
 * ⚠️ BREAKING vs. implementação anterior: `errorMessage: undefined` NÃO limpa
 * mais a coluna — callers que dependiam disso (reprocess/reviewing) devem
 * passar `null` explicitamente.
 */
export interface ExamStatusPatch {
  errorMessage?: string | null;
  totalQuestions?: number | null;
  pageOffset?: number | null;
  extractionTier?: ExtractionTier | null;
  parsingLog?: Record<string, unknown> | null;
  /** null → limpa processed_at (ex.: reprocess volta para queued). */
  processedAt?: Date | null;
}

/**
 * ExamRecord enriquecido com campos de ownership/storage.
 * Mantido aqui (não em types/exam.ts) para não quebrar contratos de outros
 * workstreams; é um superset — todo ExamRecord field continua presente.
 */
export interface StoredExamRecord extends ExamRecord {
  userId: string;
  fileKey?: string;
  gabaritoKey?: string;
  fileHash?: string;
}

export interface ListOptions {
  limit: number;
  offset: number;
}

function toExamRecord(row: typeof exams.$inferSelect): StoredExamRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    originalFilename: row.originalFilename,
    filePath: row.filePath,
    fileKey: row.fileKey ?? undefined,
    gabaritoKey: row.gabaritoKey ?? undefined,
    fileHash: row.fileHash ?? undefined,
    fileType: row.fileType,
    status: row.status,
    kind: row.kind,
    banca: row.banca ?? undefined,
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
  async create(input: CreateExamInput): Promise<StoredExamRecord> {
    const [created] = await db
      .insert(exams)
      .values({
        id: input.id ?? randomUUID(),
        ...(input.userId ? { userId: input.userId } : {}),
        title: input.title ?? input.originalFilename,
        originalFilename: input.originalFilename,
        filePath: input.filePath,
        fileKey: input.fileKey,
        gabaritoKey: input.gabaritoKey,
        fileHash: input.fileHash,
        fileType: input.fileType,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        provaType: input.provaType,
        cargoTemplateId: input.cargoTemplateId,
        edital: input.edital,
        examDate: input.examDate,
        banca: input.banca,
        gabaritoPath: input.gabaritoPath,
        status: 'queued',
      })
      .returning();

    return toExamRecord(created);
  }

  async getById(id: string): Promise<StoredExamRecord | undefined> {
    const [row] = await db.select().from(exams).where(eq(exams.id, id)).limit(1);
    if (!row) {
      return undefined;
    }

    return toExamRecord(row);
  }

  /**
   * `userId === undefined` → sem filtro (bypass dev/AUTH_DISABLED).
   * Caso contrário filtra por `exams.user_id` (D16).
   */
  async getByIdForUser(
    userId: string | undefined,
    id: string,
  ): Promise<StoredExamRecord | undefined> {
    const where = userId === undefined
      ? eq(exams.id, id)
      : and(eq(exams.id, id), eq(exams.userId, userId));

    const [row] = await db.select().from(exams).where(where).limit(1);
    if (!row) {
      return undefined;
    }

    return toExamRecord(row);
  }

  async listAll(): Promise<StoredExamRecord[]> {
    const rows = await db.select().from(exams).orderBy(desc(exams.createdAt));
    return rows.map(toExamRecord);
  }

  /**
   * Lista paginada. `userId === undefined` → sem filtro (dev single-user).
   * Exames `kind='bank'` (sintéticos do banco de questões) são EXCLUÍDOS da
   * lista padrão — não são provas navegáveis pelo usuário.
   */
  async listByUser(
    userId: string | undefined,
    options: ListOptions,
  ): Promise<StoredExamRecord[]> {
    const baseQuery = userId === undefined
      ? db.select().from(exams).where(ne(exams.kind, 'bank'))
      : db.select().from(exams).where(and(eq(exams.userId, userId), ne(exams.kind, 'bank')));

    const rows = await baseQuery
      .orderBy(desc(exams.createdAt))
      .limit(options.limit)
      .offset(options.offset);

    return rows.map(toExamRecord);
  }

  /**
   * Dedup por conteúdo (D24): mesmo arquivo (sha256) já upado pelo usuário →
   * retorna o exame existente. `userId === undefined` → busca global (dev).
   */
  async findByFileHash(
    userId: string | undefined,
    fileHash: string,
  ): Promise<StoredExamRecord | undefined> {
    const where = userId === undefined
      ? eq(exams.fileHash, fileHash)
      : and(eq(exams.fileHash, fileHash), eq(exams.userId, userId));

    const [row] = await db
      .select()
      .from(exams)
      .where(where)
      .orderBy(desc(exams.createdAt))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return toExamRecord(row);
  }

  /**
   * Dedup global (camada 2): exame de QUALQUER usuário, kind='exam',
   * status='completed' com este fileHash — fonte para clonar questions
   * sem reprocessar. Retorna o mais recente quando houver vários.
   */
  async findCompletedByFileHash(fileHash: string): Promise<StoredExamRecord | undefined> {
    const [row] = await db
      .select()
      .from(exams)
      .where(and(
        eq(exams.fileHash, fileHash),
        eq(exams.status, 'completed'),
        eq(exams.kind, 'exam'),
      ))
      .orderBy(desc(exams.createdAt))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return toExamRecord(row);
  }

  /** Persiste chaves/hash de storage pós-upload (D4). */
  async updateStorageKeys(
    id: string,
    keys: { fileKey?: string; gabaritoKey?: string | null; fileHash?: string },
  ): Promise<void> {
    await db
      .update(exams)
      .set({
        fileKey: keys.fileKey,
        gabaritoKey: keys.gabaritoKey,
        fileHash: keys.fileHash,
      })
      .where(eq(exams.id, id));
  }

  async updateStatus(
    id: string,
    status: ExamStatus,
    patch?: ExamStatusPatch,
  ): Promise<StoredExamRecord | undefined> {
    // undefined → drizzle ignora a key no SET (coluna preservada);
    // null explícito → NULL no banco (D24).
    const processedAt = patch?.processedAt !== undefined
      ? patch.processedAt
      : status === 'completed' || status === 'failed'
        ? new Date()
        : undefined;

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
