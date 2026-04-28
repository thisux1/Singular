import { Hono } from 'hono';
import { enqueueExamProcessing } from '../jobs/queue.js';
import { processExamJob } from '../jobs/process-exam.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import {
  isValidCargoTemplateId,
  listCargoTemplateCatalog,
} from '../services/config/cargo-templates.js';
import { saveUpload, validateUploadFile } from '../services/upload.js';
import { config } from '../config.js';
import { logInfo } from '../utils/logger.js';

export const examsRoutes = new Hono();

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

examsRoutes.get('/', async (c) => {
    const exams = await examsRepository.listAll();
    return c.json({
        exams: exams.map((exam) => ({
            id: exam.id,
            title: exam.title,
            status: exam.status,
            createdAt: exam.createdAt,
            totalQuestions: exam.totalQuestions,
        })),
    });
});

examsRoutes.post('/upload', async (c) => {
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
    const title = formData.get('title');
    const edital = formData.get('edital');
    const examDate = formData.get('examDate');
    const provaTypeRaw = formData.get('provaType');
    const cargoTemplateIdRaw = formData.get('cargoTemplateId');
    const pageStartRaw = formData.get('pageStart');
    const pageEndRaw = formData.get('pageEnd');

    if (!(file instanceof File)) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Campo file é obrigatório' } }, 400);
    }

    if (gabaritoFile && !(gabaritoFile instanceof File)) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Gabarito file inválido' } }, 400);
    }

    const parsedPageStart = parsePositiveIntegerField('pageStart', pageStartRaw);
    if (parsedPageStart.error) {
      return c.json({ error: { code: 'INVALID_INPUT', message: parsedPageStart.error } }, 400);
    }

    const parsedPageEnd = parsePositiveIntegerField('pageEnd', pageEndRaw);
    if (parsedPageEnd.error) {
      return c.json({ error: { code: 'INVALID_INPUT', message: parsedPageEnd.error } }, 400);
    }

    if (
      parsedPageStart.value !== undefined
      && parsedPageEnd.value !== undefined
      && parsedPageEnd.value < parsedPageStart.value
    ) {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'pageEnd deve ser maior ou igual a pageStart' } },
        400,
      );
    }

    const provaType = parseOptionalString(provaTypeRaw)?.toUpperCase();
    const cargoTemplateId = parseOptionalString(cargoTemplateIdRaw);
    if (cargoTemplateId && !isValidCargoTemplateId(cargoTemplateId)) {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'cargoTemplateId inválido' } },
        400,
      );
    }

    try {
      validateUploadFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_UPLOAD';
      if (message === 'INVALID_FILE_TYPE') {
        return c.json(
          {
            error: {
              code: 'INVALID_FILE_TYPE',
              message: 'Tipo de arquivo inválido. Use PDF ou imagem (PNG/JPG/WEBP).',
            },
          },
          400,
        );
      }

      return c.json(
        {
          error: {
            code: 'INVALID_FILE_SIZE',
            message: 'Arquivo inválido ou acima do limite configurado.',
          },
        },
        400,
      );
    }

    const saved = await saveUpload(file);
    let gabaritoPath;

    if (gabaritoFile instanceof File) {
      try {
        validateUploadFile(gabaritoFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INVALID_UPLOAD';
        if (message === 'INVALID_FILE_TYPE') {
          return c.json(
            {
              error: {
                code: 'INVALID_INPUT',
                message: 'Gabarito file inválido: tipo de arquivo não suportado',
              },
            },
            400,
          );
        }

        return c.json(
          {
            error: {
              code: 'INVALID_INPUT',
              message: 'Gabarito file inválido ou acima do limite configurado',
            },
          },
          400,
        );
      }
      const savedGabarito = await saveUpload(gabaritoFile);
      gabaritoPath = savedGabarito.filePath;
    }

    const exam = await examsRepository.create({
      title: parseOptionalString(title),
      originalFilename: saved.originalFilename,
      filePath: saved.filePath,
      fileType: saved.fileType,
      pageStart: parsedPageStart.value,
      pageEnd: parsedPageEnd.value,
      provaType,
      cargoTemplateId,
      edital: parseOptionalString(edital),
      examDate: parseOptionalString(examDate),
      gabaritoPath,
    });

    logInfo('exam.upload.received', {
      examId: exam.id,
      originalFilename: exam.originalFilename,
      fileType: exam.fileType,
      size: file.size,
    });

    if (config.syncFallback) {
      void processExamJob({ examId: exam.id });
    } else {
      await enqueueExamProcessing({ examId: exam.id });
      logInfo('exam.job.enqueued', { examId: exam.id });
    }

    return c.json(
      {
        exam_id: exam.id,
        status: 'queued',
      },
      202,
    );
});

examsRoutes.get('/cargo-templates', (c) => {
  return c.json({ templates: listCargoTemplateCatalog() });
});

examsRoutes.get('/:id/status', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
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

  const exam = await examsRepository.getById(examId);

  if (!exam) {
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
    has_gabarito: Boolean(exam.gabaritoPath),
  });
});

examsRoutes.get('/:id/questions', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
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

  const exam = await examsRepository.getById(examId);

  if (!exam) {
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
      options: row.options,
      sourcePage: row.sourcePage ?? null,
      difficulty: row.difficulty ?? null,
      subject: row.subject ?? null,
      topic: row.topic ?? null,
      classificationStatus: row.classificationStatus,
      confidence: row.confidence ?? null,
      correctAnswer: row.correctAnswer ?? null,
    })),
  });
});

examsRoutes.get('/:id', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
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

  const exam = await examsRepository.getById(examId);

  if (!exam) {
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

  return c.json(exam);
});

examsRoutes.delete('/:id', async (c) => {
  const examId = c.req.param('id');
  const deleted = await examsRepository.delete(examId);

  if (!deleted) {
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

  return c.json({ status: 'deleted', exam_id: examId });
});

examsRoutes.post('/:id/reprocess', async (c) => {
  const examId = c.req.param('id');

  if (!isUuid(examId)) {
    return c.json({ error: { code: 'INVALID_ID', message: 'ID inválido' } }, 400);
  }

  const exam = await examsRepository.getById(examId);

  if (!exam) {
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

  // Only allow reprocess if status is failed
  if (exam.status !== 'failed') {
    return c.json(
      {
        error: {
          code: 'EXAM_NOT_FAILED',
          message: 'Apenas provas com falha podem ser reprocessadas',
          exam_id: examId,
          status: exam.status,
        },
      },
      400,
    );
  }

  await examsRepository.updateStatus(examId, 'queued', {
    errorMessage: undefined,
    totalQuestions: undefined,
  });

  if (config.syncFallback) {
    void processExamJob({ examId });
  } else {
    await enqueueExamProcessing({ examId });
    logInfo('exam.job.reenqueued', { examId });
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

  const exam = await examsRepository.getById(examId);
  if (!exam || (exam.status !== 'reviewing' && exam.status !== 'completed')) {
    return c.json({ error: { code: 'INVALID_STATE', message: 'Exam não está em modo de revisão/edição' } }, 409);
  }

  const body = await c.req.json();
  const patch: any = {};
  if (typeof body.questionText === 'string') patch.questionText = body.questionText;
  if (typeof body.contextText === 'string' || body.contextText === null) patch.contextText = body.contextText;
  if (Array.isArray(body.options)) patch.options = body.options;
  if (typeof body.subject === 'string') patch.subject = body.subject;
  if (typeof body.correctAnswer === 'string') patch.correctAnswer = body.correctAnswer;

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

  const exam = await examsRepository.getById(examId);
  if (!exam || (exam.status !== 'reviewing' && exam.status !== 'completed')) {
    return c.json({ error: { code: 'INVALID_STATE', message: 'Exam não está em modo de revisão/edição' } }, 409);
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

  const exam = await examsRepository.getById(examId);
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
