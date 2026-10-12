import { asc, eq, inArray } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import { db } from '../db/client.js';
import {
  account,
  exams,
  questions,
  quizAnswers,
  quizSessions,
  user,
  verification,
  type UserRow,
} from '../db/schema.js';
import { logError, logInfo } from '../utils/logger.js';
import { getStatsSummaryForUser } from './stats-summary.js';
import { storage } from './storage.js';

/**
 * Serviços de conta (WS-A T2) — lógica fora da rota para teste direto com
 * DB real (mesmo padrão dos repositórios).
 */

export class PasswordVerificationError extends Error {
  constructor() {
    super('Senha incorreta');
    this.name = 'PasswordVerificationError';
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('Senha obrigatória para contas com email/senha');
    this.name = 'PasswordRequiredError';
  }
}

export interface AccountUserDTO {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
}

export function toAccountUserDTO(row: Pick<UserRow, 'id' | 'name' | 'email' | 'image' | 'createdAt'>): AccountUserDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/** providerId das credenciais vinculadas ('credential', 'google', ...). */
export async function listUserProviders(userId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));

  return [...new Set(rows.map((row) => row.providerId))];
}

/** Serializa uma row do drizzle para JSON (Date → ISO). */
function serializeRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

/**
 * Mesmo DTO de GET /api/exams/:id (D17) — NUNCA expõe filePath/fileKey/
 * gabaritoKey/fileHash/userId no export. hasGabarito derivado das keys.
 */
function toExportExamDTO(row: typeof exams.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    fileType: row.fileType,
    originalFilename: row.originalFilename,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage ?? null,
    totalQuestions: row.totalQuestions ?? null,
    pageOffset: row.pageOffset ?? null,
    pageStart: row.pageStart ?? null,
    pageEnd: row.pageEnd ?? null,
    provaType: row.provaType ?? null,
    cargoTemplateId: row.cargoTemplateId ?? null,
    edital: row.edital ?? null,
    examDate: row.examDate ?? null,
    banca: row.banca ?? null,
    kind: row.kind,
    extractionTier: row.extractionTier ?? null,
    hasGabarito: Boolean(row.gabaritoKey ?? row.gabaritoPath),
    parsingLog: row.parsingLog ?? null,
  };
}

/**
 * Export LGPD (portabilidade) — TODOS os dados do usuário:
 * - exams: todas as provas (incl. kind='bank') já no DTO da API — sem
 *   filePath/fileKey/gabaritoKey internos;
 * - questions: todas as questões das provas do usuário;
 * - quizSessions + quizAnswers: todo o histórico de jogo;
 * - stats: mesmo agregado de /api/stats/summary.
 */
export async function buildAccountExport(userId: string) {
  const [userRow, providerIds, examRows, sessionRows, stats] = await Promise.all([
    db.select().from(user).where(eq(user.id, userId)).limit(1),
    listUserProviders(userId),
    db.select().from(exams).where(eq(exams.userId, userId)).orderBy(asc(exams.createdAt)),
    db.select().from(quizSessions).where(eq(quizSessions.userId, userId)).orderBy(asc(quizSessions.startedAt)),
    getStatsSummaryForUser(userId),
  ]);

  const examIds = examRows.map((row) => row.id);
  const questionRows = examIds.length === 0
    ? []
    : await db
        .select()
        .from(questions)
        .where(inArray(questions.examId, examIds))
        .orderBy(asc(questions.examId), asc(questions.order));

  const sessionIds = sessionRows.map((row) => row.id);
  const answerRows = sessionIds.length === 0
    ? []
    : await db
        .select()
        .from(quizAnswers)
        .where(inArray(quizAnswers.sessionId, sessionIds))
        .orderBy(asc(quizAnswers.answeredAt));

  return {
    user: userRow[0]
      ? { ...toAccountUserDTO(userRow[0]), emailVerified: userRow[0].emailVerified, providers: providerIds }
      : { id: userId, name: '', email: '', image: null, createdAt: '', emailVerified: false, providers: providerIds },
    exams: examRows.map((row) => toExportExamDTO(row)),
    questions: questionRows.map((row) => serializeRow(row)),
    quizSessions: sessionRows.map((row) => serializeRow(row)),
    quizAnswers: answerRows.map((row) => serializeRow(row)),
    stats,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Exclusão de conta (LGPD — direito ao esquecimento).
 *
 * Confirmação de senha: se o usuário tem credential account (email/senha),
 * `password` é OBRIGATÓRIO e verificado via scrypt (better-auth/crypto).
 * Contas só-OAuth não têm senha → basta o confirmation 'APAGAR' checado na
 * rota (decisão documentada: não dá para pedir senha de quem não tem).
 *
 * Cascata do schema apaga session/account/exams(→questions)/quizSessions
 * (→quizAnswers) — sessões morrem junto (= revogação). Arquivos de storage
 * (fileKey/gabaritoKey) são removidos best-effort ANTES do delete.
 */
export async function deleteUserAccount(
  userId: string,
  input: { password?: string },
): Promise<void> {
  const accounts = await db
    .select()
    .from(account)
    .where(eq(account.userId, userId));

  const credential = accounts.find(
    (row) => row.providerId === 'credential' && row.password,
  );

  if (credential) {
    if (!input.password) {
      throw new PasswordRequiredError();
    }
    const ok = await verifyPassword({
      hash: credential.password as string,
      password: input.password,
    });
    if (!ok) {
      throw new PasswordVerificationError();
    }
  }

  // Remove objetos de storage antes de apagar a row (melhor esforço — falha
  // não impede a exclusão; órfãos são tolerados e logados).
  const examRows = await db
    .select({ fileKey: exams.fileKey, gabaritoKey: exams.gabaritoKey })
    .from(exams)
    .where(eq(exams.userId, userId));

  for (const row of examRows) {
    for (const key of [row.fileKey, row.gabaritoKey]) {
      if (key) {
        await storage.delete(key).catch((error) => {
          logError('account.delete.storage_orphan', {
            userId,
            key,
            error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
          });
        });
      }
    }
  }

  // verification rows não têm FK para user (identifier-based), mas tokens de
  // reset guardam value=userId — limpa os órfãos junto com a conta.
  await db.delete(verification).where(eq(verification.value, userId));
  await db.delete(user).where(eq(user.id, userId));

  logInfo('account.deleted', {
    userId,
    examsRemoved: examRows.length,
    providers: accounts.map((row) => row.providerId),
  });
}
