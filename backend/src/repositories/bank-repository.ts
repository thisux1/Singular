import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { exams, questions } from '../db/schema.js';

/**
 * Repositório do Banco de Questões (T3): consultas cross-exam sobre as
 * questions dos exames `kind='exam'` do usuário, mais o exame sintético
 * `kind='bank'` que ancora as sessões de quiz do banco.
 *
 * Convenção de ownership: `userId === undefined` → sem filtro (dev
 * single-user/AUTH_DISABLED enxerga tudo), igual aos demais repos.
 */

export interface BankQuestionFilters {
  subject?: string;
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  banca?: string;
  year?: number;
  /** ILIKE em questionText. */
  q?: string;
  page: number;
  pageSize: number;
}

export interface BankQuestionItem {
  id: string;
  examId: string;
  examTitle: string;
  questionText: string;
  contextText: string | null;
  options: string[];
  correctAnswer: string | null;
  subject: string | null;
  topic: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  annulled: boolean;
  hasImage: boolean;
  sourcePage: number | null;
  banca: string | null;
  year: number | null;
}

const YEAR_REGEX = /\b(19|20)\d{2}\b/;

/** Extrai o ano (19xx/20xx) de um examDate livre — espelha o filtro ?year=. */
export function extractExamYear(examDate: string | null | undefined): number | null {
  if (!examDate) {
    return null;
  }
  const match = YEAR_REGEX.exec(examDate);
  return match ? Number.parseInt(match[0], 10) : null;
}

/** Escapa metacaracteres do LIKE para o termo `q` ser literal. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function scopeConditions(userId: string | undefined) {
  const conditions = [ne(exams.kind, 'bank')];
  if (userId !== undefined) {
    conditions.push(eq(exams.userId, userId));
  }
  return conditions;
}

class BankRepository {
  /** Exame sintético `kind='bank'` do usuário (o mais antigo, se houver vários). */
  async findBankExam(userId: string | undefined): Promise<typeof exams.$inferSelect | undefined> {
    const where = userId === undefined
      ? eq(exams.kind, 'bank')
      : and(eq(exams.kind, 'bank'), eq(exams.userId, userId));

    const [row] = await db
      .select()
      .from(exams)
      .where(where)
      .orderBy(asc(exams.createdAt))
      .limit(1);

    return row;
  }

  /**
   * getOrCreateBankExam: âncora das sessões mode='bank'. Criado com
   * status='completed' e filePath vazio — nunca passa por processamento.
   */
  async getOrCreateBankExam(
    userId: string | undefined,
    ownerId: string,
  ): Promise<typeof exams.$inferSelect> {
    const existing = await this.findBankExam(userId);
    if (existing) {
      return existing;
    }

    const [created] = await db
      .insert(exams)
      .values({
        userId: ownerId,
        title: 'Banco de Questões',
        originalFilename: '__bank__',
        filePath: '',
        fileType: 'pdf',
        status: 'completed',
        kind: 'bank',
        processedAt: new Date(),
      })
      .returning();

    return created;
  }

  /** Distincts para os dropdowns do frontend — só exames kind='exam' do escopo. */
  async listFilters(userId: string | undefined): Promise<{
    subjects: string[];
    topics: string[];
    bancas: string[];
    years: number[];
  }> {
    const scope = scopeConditions(userId);

    const subjectRows = await db
      .selectDistinct({ subject: questions.subject })
      .from(questions)
      .innerJoin(exams, eq(exams.id, questions.examId))
      .where(and(...scope, isNotNull(questions.subject)))
      .orderBy(asc(questions.subject));

    const topicRows = await db
      .selectDistinct({ topic: questions.topic })
      .from(questions)
      .innerJoin(exams, eq(exams.id, questions.examId))
      .where(and(...scope, isNotNull(questions.topic)))
      .orderBy(asc(questions.topic));

    const bancaRows = await db
      .selectDistinct({ banca: exams.banca })
      .from(exams)
      .where(and(...scope, isNotNull(exams.banca)))
      .orderBy(asc(exams.banca));

    // Years derivam de examDate (varchar livre) — extrai via regex em JS.
    const examDateRows = await db
      .selectDistinct({ examDate: exams.examDate })
      .from(exams)
      .where(and(...scope, isNotNull(exams.examDate)));

    const years = [...new Set(
      examDateRows
        .map((row) => extractExamYear(row.examDate))
        .filter((year): year is number => year !== null),
    )].sort((a, b) => b - a);

    return {
      subjects: subjectRows.map((row) => row.subject).filter((s): s is string => s !== null),
      topics: topicRows.map((row) => row.topic).filter((t): t is string => t !== null),
      bancas: bancaRows.map((row) => row.banca).filter((b): b is string => b !== null),
      years,
    };
  }

  /**
   * Lista paginada com filtros AND. `year` casa via regex POSIX `\y<ano>\y`
   * (word boundary) sobre examDate — equivalente ao /\b(19|20)\d{2}\b/.
   */
  async listQuestions(
    userId: string | undefined,
    filters: BankQuestionFilters,
  ): Promise<{ items: BankQuestionItem[]; total: number }> {
    const conditions = scopeConditions(userId);

    if (filters.subject) {
      conditions.push(eq(questions.subject, filters.subject));
    }
    if (filters.topic) {
      conditions.push(eq(questions.topic, filters.topic));
    }
    if (filters.difficulty) {
      conditions.push(eq(questions.difficulty, filters.difficulty));
    }
    if (filters.banca) {
      conditions.push(eq(exams.banca, filters.banca));
    }
    if (filters.year !== undefined) {
      conditions.push(sql`${exams.examDate} ~ ${`\\y${filters.year}\\y`}`);
    }
    if (filters.q) {
      conditions.push(ilike(questions.questionText, `%${escapeLikePattern(filters.q)}%`));
    }

    const where = and(...conditions);

    const [totalRow] = await db
      .select({ value: count() })
      .from(questions)
      .innerJoin(exams, eq(exams.id, questions.examId))
      .where(where);

    const rows = await db
      .select({
        id: questions.id,
        examId: questions.examId,
        examTitle: exams.title,
        questionText: questions.questionText,
        contextText: questions.contextText,
        options: questions.options,
        correctAnswer: questions.correctAnswer,
        subject: questions.subject,
        topic: questions.topic,
        difficulty: questions.difficulty,
        annulled: questions.annulled,
        hasImage: questions.hasImage,
        sourcePage: questions.sourcePage,
        banca: exams.banca,
        examDate: exams.examDate,
      })
      .from(questions)
      .innerJoin(exams, eq(exams.id, questions.examId))
      .where(where)
      .orderBy(desc(questions.createdAt), desc(questions.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    return {
      items: rows.map((row) => ({
        id: row.id,
        examId: row.examId,
        examTitle: row.examTitle,
        questionText: row.questionText,
        contextText: row.contextText,
        options: row.options,
        correctAnswer: row.correctAnswer,
        subject: row.subject,
        topic: row.topic,
        difficulty: row.difficulty,
        annulled: row.annulled,
        hasImage: row.hasImage,
        sourcePage: row.sourcePage,
        banca: row.banca,
        year: extractExamYear(row.examDate),
      })),
      total: totalRow?.value ?? 0,
    };
  }

  /**
   * Ownership check do POST /bank/session: retorna as linhas de questions
   * que pertencem a exames kind='exam' do usuário. Caller compara com os
   * ids pedidos — qualquer id faltante é inválido/inacessível.
   */
  async findOwnedQuestions(
    userId: string | undefined,
    questionIds: string[],
  ): Promise<Array<{ id: string }>> {
    if (questionIds.length === 0) {
      return [];
    }

    const conditions = scopeConditions(userId);
    conditions.push(inArray(questions.id, questionIds));

    return await db
      .select({ id: questions.id })
      .from(questions)
      .innerJoin(exams, eq(exams.id, questions.examId))
      .where(and(...conditions));
  }
}

export const bankRepository = new BankRepository();
