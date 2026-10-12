import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { enqueueExamProcessing } from '../jobs/queue.js';
import { processExamJob } from '../jobs/process-exam.js';
import {
  examsRepository,
  type StoredExamRecord,
} from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import type { NewQuestionRow } from '../db/schema.js';
import { getUser, ownershipUserId } from '../middleware/auth.js';
import {
  isValidCargoTemplateId,
  listCargoTemplateCatalog,
} from '../services/config/cargo-templates.js';
import { getExamProgress } from '../services/job-progress.js';
import { mimeForKey, storage } from '../services/storage.js';
import {
  readAndValidateUpload,
  saveUpload,
  UploadError,
  type ValidatedUpload,
} from '../services/upload.js';
import { config } from '../config.js';
import { logError, logInfo } from '../utils/logger.js';

export const examsRoutes = new Hono();

const STALE_PROCESSING_MS = 30 * 60 * 1000; // 30min — reprocess de processing travado (D18)
const EXAM_LIST_MAX_LIMIT = 200;
const EXAM_LIST_DEFAULT_LIMIT = 50;

const MAX_FIELD_LENGTHS = {
  title: 500,
  edital: 500,
  provaType: 16,
} as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function examNotFound(c: Context, examId: string) {
  return c.json(
    {
      error: {
        code: 'EXAM_NOT_FOUND',
        message: 'Prova não encontrada',
        exam_id: examId,
      },
    },
    404,
  );
}

function validationError(c: Context, field: string, message: string) {
  return c.json(
    { error: { code: 'VALIDATION', field, message } },
    400,
  );
}

function parseOptionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveIntegerField(
  fieldName: string,
  value: FormDataEntryValue | null,
): { value?: number; error?: string } {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== 'string') {
    return { error: `Campo ${fieldName} deve ser inteiro positivo` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }

  if (!/^\d+$/.test(trimmed)) {
    return { error: `Campo ${fieldName} deve ser inteiro positivo` };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: `Campo ${fieldName} deve ser inteiro positivo` };
  }

  return { value: parsed };
}

/** Data real no formato ISO `YYYY-MM-DD` (rejeita 2024-02-30 etc.). */
function isValidExamDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * DTO de exame (D17) — NUNCA expõe filePath/gabaritoPath/fileKey/
 * gabaritoKey/fileHash/userId. Cliente baixa o arquivo via
 * `GET /api/exams/:id/file`.
 */
function toExamDTO(exam: StoredExamRecord) {
  return {
    id: exam.id,
    title: exam.title,
    status: exam.status,
    fileType: exam.fileType,
    originalFilename: exam.originalFilename,
    createdAt: exam.createdAt,
    processedAt: exam.processedAt ?? null,
    errorMessage: exam.errorMessage ?? null,
    totalQuestions: exam.totalQuestions ?? null,
    pageOffset: exam.pageOffset ?? null,
    pageStart: exam.pageStart ?? null,
    pageEnd: exam.pageEnd ?? null,
    provaType: exam.provaType ?? null,
    cargoTemplateId: exam.cargoTemplateId ?? null,
    edital: exam.edital ?? null,
    examDate: exam.examDate ?? null,
    extractionTier: exam.extractionTier ?? null,
    hasGabarito: Boolean(exam.gabaritoKey ?? exam.gabaritoPath),
    parsingLog: exam.parsingLog ?? null,
  };
}

/**
 * Busca exame já aplicando ownership (D16): em auth ativa filtra por
 * `user_id`; em AUTH_DISABLED `ownershipUserId` retorna undefined →
 * busca sem filtro (dev single-user vê tudo, inclusive legados `system`).
 */
async function getOwnedExam(c: Context, examId: string) {
  return examsRepository.getByIdForUser(ownershipUserId(c), examId);
}

function mapUploadError(c: Context, error: unknown, prefix = '') {
  if (error instanceof UploadError) {
    if (error.code === 'INVALID_FILE_TYPE') {
      return c.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: `${prefix}Tipo de arquivo inválido. Use PDF ou imagem (PNG/JPG/WEBP).`.trim(),
          },
        },
        415,
      );
    }
    return c.json(
      {
        error: {
          code: 'INVALID_FILE_SIZE',
          message: `${prefix}Arquivo vazio ou acima do limite configurado.`.trim(),
        },
      },
      413,
    );
  }
  throw error;
}

examsRoutes.get('/', async (c) => {
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  let limit = EXAM_LIST_DEFAULT_LIMIT;
  let offset = 0;

  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw)) {
      return validationError(c, 'limit', 'limit deve ser inteiro positivo');
    }
    limit = Math.min(Number.parseInt(limitRaw, 10), EXAM_LIST_MAX_LIMIT);
    if (limit <= 0) limit = EXAM_LIST_DEFAULT_LIMIT;
  }

  if (offsetRaw !== undefined) {
    if (!/^\d+$/.test(offsetRaw)) {
      return validationError(c, 'offset', 'offset deve ser inteiro >= 0');
    }
    offset = Number.parseInt(offsetRaw, 10);
  }

  const exams = await examsRepository.listByUser(ownershipUserId(c), { limit, offset });
  return c.json({
    exams: exams.map((exam) => toExamDTO(exam)),
    limit,
    offset,
  });
});

examsRoutes.post(
  '/upload',
  bodyLimit({
    // 10% de folga para o overhead do multipart (D15) — antes do formData parse.
    maxSize: Math.ceil(config.maxUploadSizeBytes * 1.1),
    onError: (c) =>
      c.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Upload excede o limite de tamanho configurado.',
          },
        },
        413,
      ),
  }),
  async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Corpo inválido. Envie multipart/form-data com campo file',
          },
        },
        400,
      );
    }

    const file = formData.get('file');
    const gabaritoFile = formData.get('gabaritoFile');
    const title = parseOptionalString(formData.get('title'));
    const edital = parseOptionalString(formData.get('edital'));
    const examDate = parseOptionalString(formData.get('examDate'));
    const provaType = parseOptionalString(formData.get('provaType'))?.toUpperCase();
    const cargoTemplateId = parseOptionalString(formData.get('cargoTemplateId'));
    const pageStartRaw = formData.get('pageStart');
    const pageEndRaw = formData.get('pageEnd');

    // --- Bounds validation (D17) → 400 VALIDATION antes de tocar storage ---
    if (title !== undefined && title.length > MAX_FIELD_LENGTHS.title) {
      return validationError(c, 'title', `title excede ${MAX_FIELD_LENGTHS.title} caracteres`);
    }
    if (edital !== undefined && edital.length > MAX_FIELD_LENGTHS.edital) {
      return validationError(c, 'edital', `edital excede ${MAX_FIELD_LENGTHS.edital} caracteres`);
    }
    if (examDate !== undefined && !isValidExamDate(examDate)) {
      return validationError(c, 'examDate', 'examDate deve ser data real no formato YYYY-MM-DD');
    }
    if (provaType !== undefined && provaType.length > MAX_FIELD_LENGTHS.provaType) {
      return validationError(c, 'provaType', `provaType excede ${MAX_FIELD_LENGTHS.provaType} caracteres`);
    }

    if (!(file instanceof File)) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Campo file é obrigatório' } }, 400);
    }

    if (gabaritoFile && !(gabaritoFile instanceof File)) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Gabarito file inválido' } }, 400);
    }

    const parsedPageStart = parsePositiveIntegerField('pageStart', pageStartRaw);
    if (parsedPageStart.error) {
      return validationError(c, 'pageStart', parsedPageStart.error);
    }

    const parsedPageEnd = parsePositiveIntegerField('pageEnd', pageEndRaw);
    if (parsedPageEnd.error) {
      return validationError(c, 'pageEnd', parsedPageEnd.error);
    }

    if (
      parsedPageStart.value !== undefined
      && parsedPageEnd.value !== undefined
      && parsedPageEnd.value < parsedPageStart.value
    ) {
      return validationError(c, 'pageEnd', 'pageEnd deve ser maior ou igual a pageStart');
    }

    if (cargoTemplateId && !isValidCargoTemplateId(cargoTemplateId)) {
      return validationError(c, 'cargoTemplateId', 'cargoTemplateId inválido');
    }

    // --- Magic bytes + hash (D15/D24) ---
    let validatedFile: ValidatedUpload;
    try {
      validatedFile = await readAndValidateUpload(file);
    } catch (error) {
      return mapUploadError(c, error);
    }

    let validatedGabarito: ValidatedUpload | undefined;
    if (gabaritoFile instanceof File) {
      try {
        validatedGabarito = await readAndValidateUpload(gabaritoFile);
      } catch (error) {
        return mapUploadError(c, error, 'Gabarito: ');
      }
    }

    const userId = getUser(c).id;

    // --- Dedup (D24): mesmo conteúdo + usuário → exame existente, sem regravar.
    const existing = await examsRepository.findByFileHash(ownershipUserId(c), validatedFile.fileHash);
    if (existing) {
      logInfo('exam.upload.deduped', {
        examId: existing.id,
        fileHash: validatedFile.fileHash,
      });
      return c.json({ exam_id: existing.id, deduped: true }, 200);
    }

    const examId = randomUUID();
    const saved = await saveUpload(userId, examId, validatedFile, 'source');
    let savedGabarito: Awaited<ReturnType<typeof saveUpload>> | undefined;
    if (validatedGabarito) {
      try {
        savedGabarito = await saveUpload(userId, examId, validatedGabarito, 'gabarito');
      } catch (error) {
        // sem órfãos: se o gabarito falhar, remove o source já gravado.
        await storage.delete(saved.fileKey).catch(() => undefined);
        throw error;
      }
    }

    let exam: StoredExamRecord;
    try {
      exam = await examsRepository.create({
        id: examId,
        userId,
        title,
        originalFilename: validatedFile.originalFilename,
        filePath: saved.filePath,
        fileKey: saved.fileKey,
        gabaritoKey: savedGabarito?.fileKey,
        fileHash: validatedFile.fileHash,
        fileType: saved.fileType,
        pageStart: parsedPageStart.value,
        pageEnd: parsedPageEnd.value,
        provaType,
        cargoTemplateId,
        edital,
        examDate,
        gabaritoPath: savedGabarito?.filePath,
      });
    } catch (error) {
      // Insert falhou → remove arquivos já gravados (sem órfãos — D15).
      await storage.delete(saved.fileKey).catch(() => undefined);
      if (savedGabarito) {
        await storage.delete(savedGabarito.fileKey).catch(() => undefined);
      }
      throw error;
    }

    logInfo('exam.upload.received', {
      examId: exam.id,
      userId,
      originalFilename: exam.originalFilename,
      fileType: exam.fileType,
      size: validatedFile.sizeBytes,
      storage: storage.kind,
    });

    try {
      if (config.syncFallback) {
        void processExamJob({ examId: exam.id }).catch(async (error) => {
          logError('exam.job.sync_failed', {
            examId: exam.id,
            errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
          });
          await examsRepository.updateStatus(exam.id, 'failed', {
            errorMessage: error instanceof Error ? error.message : 'Processing failed',
          });
        });
      } else {
        const enqueued = await enqueueExamProcessing({ examId: exam.id });
        logInfo('exam.job.enqueued', { examId: exam.id, deduped: enqueued.deduped });
      }
    } catch (error) {
      // Enqueue falhou → marca failed (row existe e pode ser reprocessado).
      logError('exam.job.enqueue_failed', {
        examId: exam.id,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
      await examsRepository.updateStatus(exam.id, 'failed', {
        errorMessage: 'Falha ao enfileirar processamento. Tente reprocessar.',
      });
      return c.json(
        { error: { code: 'ENQUEUE_FAILED', message: 'Falha ao enfileirar processamento', exam_id: exam.id } },
        502,
      );
    }

    return c.json(
      {
        exam_id: exam.id,
        status: 'queued',
      },
      202,
    );
  },
);

examsRoutes.get('/cargo-templates', (c) => {
  return c.json({ templates: listCargoTemplateCatalog() });
});

examsRoutes.get('/:id/status', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return examNotFound(c, examId);
  }

  const exam = await getOwnedExam(c, examId);

  if (!exam) {
    return examNotFound(c, examId);
  }

  return c.json({
    exam_id: exam.id,
    status: exam.status,
    error_message: exam.errorMessage ?? null,
    total_questions: exam.totalQuestions ?? null,
    page_offset: exam.pageOffset ?? null,
    page_start: exam.pageStart ?? null,
    page_end: exam.pageEnd ?? null,
    prova_type: exam.provaType ?? null,
    cargo_template_id: exam.cargoTemplateId ?? null,
    edital: exam.edital ?? null,
    exam_date: exam.examDate ?? null,
    has_gabarito: Boolean(exam.gabaritoKey ?? exam.gabaritoPath),
    classification: (exam.parsingLog?.['classification'] as Record<string, unknown> | undefined) ?? null,
  });
});

examsRoutes.get('/:id/progress', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return examNotFound(c, examId);
  }

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return examNotFound(c, examId);
  }

  const progress = await getExamProgress(exam);
  return c.json(progress);
});

examsRoutes.get('/:id/file', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return examNotFound(c, examId);
  }

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return examNotFound(c, examId);
  }

  const headersFor = (name: string, mimeSource: string) => ({
    'Content-Type': mimeForKey(mimeSource),
    'Content-Disposition': `inline; filename="${encodeURIComponent(name)}"`,
  });

  // GCS → 302 para signed URL (TTL 15min). Local → stream (D17).
  if (exam.fileKey) {
    const readUrl = await storage.getReadUrl(exam.fileKey);
    if (readUrl) {
      return c.redirect(readUrl, 302);
    }

    // Driver local: confirma existência antes de abrir stream (erro async no
    // stream com response já iniciada quebraria a resposta).
    const localPath = storage.resolveLocalPath(exam.fileKey);
    if (localPath && (await stat(localPath).catch(() => null))) {
      const stream = storage.createReadStream(exam.fileKey);
      return c.body(Readable.toWeb(stream) as ReadableStream, 200, headersFor(exam.originalFilename, exam.fileKey));
    }
  }

  // Legado: linhas sem fileKey — stream do filePath absoluto se dentro do uploadDir.
  if (!exam.fileKey && exam.filePath && storage.kind === 'local') {
    let localPath: string | null = null;
    try {
      localPath = storage.resolveLocalPath(exam.filePath);
    } catch {
      localPath = null; // fora do uploadDir → trata como ausente
    }
    if (localPath && (await stat(localPath).catch(() => null))) {
      const stream = storage.createReadStream(exam.filePath);
      return c.body(Readable.toWeb(stream) as ReadableStream, 200, headersFor(exam.originalFilename, exam.filePath));
    }
  }

  return c.json(
    { error: { code: 'FILE_NOT_FOUND', message: 'Arquivo não disponível', exam_id: examId } },
    404,
  );
});

examsRoutes.get('/:id/questions', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return examNotFound(c, examId);
  }

  const exam = await getOwnedExam(c, examId);

  if (!exam) {
    return examNotFound(c, examId);
  }

  if (exam.status === 'processing' || exam.status === 'queued') {
    return c.json(
      {
        error: {
          code: 'EXAM_NOT_READY',
          message: 'Prova ainda está em processamento',
          exam_id: examId,
        },
      },
      409,
    );
  }

  if (exam.status === 'failed') {
    return c.json(
      {
        error: {
          code: 'EXAM_FAILED',
          message: 'Processamento da prova falhou',
          exam_id: examId,
          error_message: exam.errorMessage ?? null,
        },
      },
      422,
    );
  }

  const rows = await questionsRepository.listByExamId(examId);
  if (rows.length === 0) {
    return c.json(
      {
        error: {
          code: 'QUESTIONS_NOT_FOUND',
          message: 'Não há questões disponíveis para esta prova',
          exam_id: examId,
        },
      },
      422,
    );
  }

  return c.json({
    questions: rows.map((row) => ({
      id: row.id,
      examId: row.examId,
      order: row.order,
      questionText: row.questionText,
      contextText: row.contextText ?? null,
      options: row.options,
      sourcePage: row.sourcePage ?? null,
      difficulty: row.difficulty ?? null,
      subject: row.subject ?? null,
      topic: row.topic ?? null,
      classificationStatus: row.classificationStatus,
      confidence: row.confidence ?? null,
      correctAnswer: row.correctAnswer ?? null,
      annulled: row.annulled ?? false,
      requiresPdf: row.requiresPdf ?? row.hasImage ?? false,
      hasImage: row.hasImage ?? false,
    })),
  });
});

examsRoutes.get('/:id', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return examNotFound(c, examId);
  }

  const exam = await getOwnedExam(c, examId);

  if (!exam) {
    return examNotFound(c, examId);
  }

  return c.json(toExamDTO(exam));
});

examsRoutes.delete('/:id', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);
  }

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return examNotFound(c, examId);
  }

  // Remove arquivos do storage antes da row (sem órfãos; falha não bloqueia o delete).
  const storageKeys = [exam.fileKey, exam.gabaritoKey].filter((k): k is string => Boolean(k));
  for (const key of storageKeys) {
    await storage.delete(key).catch((error) => {
      logError('exam.delete.storage_failed', {
        examId,
        key,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    });
  }

  // Legado sem fileKey: filePath absoluto dentro do uploadDir.
  if (storageKeys.length === 0) {
    if (exam.filePath) {
      await storage.deleteLegacyLocalPath(exam.filePath).catch(() => undefined);
    }
    if (exam.gabaritoPath) {
      await storage.deleteLegacyLocalPath(exam.gabaritoPath).catch(() => undefined);
    }
  }

  const deleted = await examsRepository.delete(examId);
  if (!deleted) {
    return examNotFound(c, examId);
  }

  logInfo('exam.deleted', { examId });
  return c.json({ status: 'deleted', exam_id: examId });
});

examsRoutes.post('/:id/reprocess', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);
  }

  const exam = await getOwnedExam(c, examId);

  if (!exam) {
    return examNotFound(c, examId);
  }

  // D18: reprocess aceita `failed` ou `processing` stale (>30min sem atualizar).
  const lastActivityAt = exam.processedAt ?? exam.createdAt;
  const staleProcessing = exam.status === 'processing'
    && Date.now() - new Date(lastActivityAt).getTime() > STALE_PROCESSING_MS;

  if (exam.status !== 'failed' && !staleProcessing) {
    return c.json(
      {
        error: {
          code: 'INVALID_STATE',
          message: 'Apenas provas com falha ou processamento travado (>30min) podem ser reprocessadas',
          exam_id: examId,
          status: exam.status,
        },
      },
      409,
    );
  }

  // null explícito limpa colunas — contrato updateStatus (D24).
  await examsRepository.updateStatus(examId, 'queued', {
    errorMessage: null,
    totalQuestions: null,
    processedAt: null,
  });

  if (config.syncFallback) {
    void processExamJob({ examId }).catch(async (error) => {
      logError('exam.job.sync_reprocess_failed', {
        examId,
        errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
      await examsRepository.updateStatus(examId, 'failed', {
        errorMessage: error instanceof Error ? error.message : 'Processing failed',
      });
    });
  } else {
    const enqueued = await enqueueExamProcessing({ examId });
    logInfo('exam.job.reenqueued', { examId, deduped: enqueued.deduped });
  }

  return c.json({
    exam_id: examId,
    status: 'queued',
  });
});

examsRoutes.patch('/:id/questions/:qId', async (c) => {
  const examId = c.req.param('id');
  const questionId = c.req.param('qId');
  if (!isUuid(examId) || !isUuid(questionId)) {
    return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);
  }

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return examNotFound(c, examId);
  }
  if (exam.status !== 'reviewing' && exam.status !== 'completed') {
    return c.json({ error: { code: 'INVALID_STATE', message: 'Exam não está em modo de revisão/edição' } }, 409);
  }

  // IDOR fix (D16): a questão precisa pertencer a ESTE exame.
  const question = await questionsRepository.getForExamAndQuestion(examId, questionId);
  if (!question) {
    return c.json({ error: { code: 'QUESTION_NOT_FOUND', message: 'Questão não pertence a esta prova' } }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'JSON malformado' } }, 400);
  }

  const patch: Partial<NewQuestionRow> = {};
  if (typeof body.questionText === 'string') patch.questionText = body.questionText;
  if (typeof body.contextText === 'string' || body.contextText === null) patch.contextText = body.contextText;
  if (Array.isArray(body.options) && body.options.every((o) => typeof o === 'string')) {
    patch.options = body.options as string[];
  }
  if (typeof body.subject === 'string') patch.subject = body.subject;
  if (typeof body.correctAnswer === 'string') patch.correctAnswer = body.correctAnswer;

  if (Object.keys(patch).length === 0) {
    return c.json({ error: { code: 'VALIDATION', message: 'Nenhum campo editável enviado' } }, 400);
  }

  const success = await questionsRepository.update(questionId, patch);
  if (!success) {
    return c.json({ error: { code: 'UPDATE_FAILED', message: 'Falha ao atualizar' } }, 500);
  }
  return c.json({ success: true });
});

examsRoutes.delete('/:id/questions/:qId', async (c) => {
  const examId = c.req.param('id');
  const questionId = c.req.param('qId');
  if (!isUuid(examId) || !isUuid(questionId)) {
    return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);
  }

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return examNotFound(c, examId);
  }
  if (exam.status !== 'reviewing' && exam.status !== 'completed') {
    return c.json({ error: { code: 'INVALID_STATE', message: 'Exam não está em modo de revisão/edição' } }, 409);
  }

  // IDOR fix (D16): membership check explícito antes do delete.
  const question = await questionsRepository.getForExamAndQuestion(examId, questionId);
  if (!question) {
    return c.json({ error: { code: 'QUESTION_NOT_FOUND', message: 'Questão não pertence a esta prova' } }, 404);
  }

  const success = await questionsRepository.delete(examId, questionId);
  if (!success) {
    return c.json({ error: { code: 'DELETE_FAILED', message: 'Questão não encontrada' } }, 404);
  }
  return c.json({ success: true });
});

examsRoutes.post('/:id/publish', async (c) => {
  const examId = c.req.param('id');
  if (!isUuid(examId)) return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);

  const exam = await getOwnedExam(c, examId);
  if (!exam) {
    return c.json({ error: { code: 'EXAM_NOT_FOUND', message: 'Prova não encontrada', exam_id: examId } }, 404);
  }

  if (exam.status === 'completed') {
    return c.json({ success: true, status: 'completed' });
  }

  if (exam.status !== 'reviewing') {
    return c.json({ error: { code: 'INVALID_STATE', message: 'Exam não está em modo de review' } }, 409);
  }

  const count = await questionsRepository.countByExamId(examId);
  if (count === 0) {
     return c.json({ error: { code: 'NO_QUESTIONS', message: 'Impossível publicar com 0 questões' } }, 422);
  }

  await examsRepository.updateStatus(examId, 'completed', { totalQuestions: count });
  return c.json({ success: true, status: 'completed' });
});
