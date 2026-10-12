import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { exams } from '../db/schema.js';
import { getUser, requireAuth, type AuthVariables } from '../middleware/auth.js';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import {
  computeScorePercent,
  isQuizMode,
  quizRepository,
  type QuizMode,
  type SessionQuestionState,
} from '../repositories/quiz-repository.js';

export const quizRoutes = new Hono<{ Variables: AuthVariables }>();

// Guard por rota (D6/D16) — aplicado aqui para não depender da montagem global
// em index.ts (WS-A). Se o guard global também for aplicado, é idempotente.
quizRoutes.use('*', requireAuth);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeAnswer(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  const direct = /^[A-E]$/.exec(normalized);
  if (direct) {
    return direct[0];
  }

  const withPrefix = /^([A-E])[\)\.:\-\s]/.exec(normalized);
  return withPrefix?.[1];
}

/** Ownership inline — ExamRecord não expõe userId (D16). */
async function getExamOwnerId(examId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: exams.userId })
    .from(exams)
    .where(eq(exams.id, examId))
    .limit(1);

  return row?.userId;
}

function isOwnedBy(userId: string | undefined, ownerId: string | undefined): boolean {
  if (config.authDisabled) {
    return true;
  }

  return ownerId !== undefined && ownerId === userId;
}

/** Extrai o snapshot de questões salvo em modeParams.questionIds. */
function sessionQuestionIds(session: { modeParams: Record<string, unknown> | null }): string[] {
  const raw = session.modeParams?.['questionIds'];
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((id): id is string => typeof id === 'string' && isUuid(id));
}

interface SubjectStat {
  subject: string;
  total: number;
  correct: number;
}

/** perSubject sobre o conjunto da sessão; anuladas contam como acerto (B7). */
function buildPerSubject(states: SessionQuestionState[]): SubjectStat[] {
  const bySubject = new Map<string, { total: number; correct: number }>();

  for (const state of states) {
    const key = state.subject ?? 'Sem disciplina';
    const bucket = bySubject.get(key) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (state.annulled || state.isCorrect === true) {
      bucket.correct += 1;
    }
    bySubject.set(key, bucket);
  }

  return Array.from(bySubject.entries()).map(([subject, stat]) => ({
    subject,
    total: stat.total,
    correct: stat.correct,
  }));
}

function sessionNotFound(c: Context, sessionId: string) {
  return c.json(
    {
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão de quiz não encontrada',
        session_id: sessionId,
      },
    },
    404,
  );
}

async function getOwnedSession(sessionId: string, userId: string) {
  const session = await quizRepository.getSessionById(sessionId);
  if (!session || !isOwnedBy(userId, session.userId)) {
    return undefined;
  }

  return session;
}

async function validateExamReadyForQuiz(examId: string, userId: string): Promise<
  | { ok: true; totalQuestions: number }
  | { ok: false; status: ContentfulStatusCode; body: Record<string, unknown> }
> {
  if (!isUuid(examId)) {
    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: 'EXAM_NOT_FOUND',
          message: 'Prova não encontrada',
          exam_id: examId,
        },
      },
    };
  }

  const exam = await examsRepository.getById(examId);
  if (!exam) {
    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: 'EXAM_NOT_FOUND',
          message: 'Prova não encontrada',
          exam_id: examId,
        },
      },
    };
  }

  // Ownership/IDOR (D16): exame de outro usuário → 404 para não vazar existência.
  const ownerId = await getExamOwnerId(examId);
  if (!isOwnedBy(userId, ownerId)) {
    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: 'EXAM_NOT_FOUND',
          message: 'Prova não encontrada',
          exam_id: examId,
        },
      },
    };
  }

  if (exam.status === 'queued' || exam.status === 'processing') {
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: 'EXAM_NOT_READY',
          message: 'Prova ainda está em processamento',
          exam_id: examId,
        },
      },
    };
  }

  if (exam.status === 'failed') {
    return {
      ok: false,
      status: 422,
      body: {
        error: {
          code: 'EXAM_FAILED',
          message: 'Processamento da prova falhou',
          exam_id: examId,
        },
      },
    };
  }

  const totalQuestions = await questionsRepository.countByExamId(examId);
  if (totalQuestions < 1) {
    return {
      ok: false,
      status: 422,
      body: {
        error: {
          code: 'QUESTIONS_NOT_FOUND',
          message: 'Não há questões disponíveis para esta prova',
          exam_id: examId,
        },
      },
    };
  }

  return {
    ok: true,
    totalQuestions,
  };
}

quizRoutes.post('/start', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const examId = typeof body.examId === 'string' ? body.examId : '';
  const mode: QuizMode = isQuizMode(body.mode) ? body.mode : 'all';
  const subjects = Array.isArray(body.subjects)
    ? body.subjects.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    : undefined;
  const count = Number.isInteger(body.count) && body.count > 0 ? (body.count as number) : undefined;
  const shuffle = body.shuffle === true;

  if (examId.length === 0) {
    return c.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Campo examId é obrigatório',
        },
      },
      400,
    );
  }

  if (body.mode !== undefined && !isQuizMode(body.mode)) {
    return c.json(
      {
        error: {
          code: 'INVALID_MODE',
          message: 'mode deve ser all|subjects|random|wrong',
        },
      },
      400,
    );
  }

  if (mode === 'subjects' && (!subjects || subjects.length === 0)) {
    return c.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'mode=subjects exige subjects[] não-vazio',
        },
      },
      400,
    );
  }

  const guard = await validateExamReadyForQuiz(examId, user.id);
  if (!guard.ok) {
    return c.json(guard.body, guard.status);
  }

  const questionIds = await quizRepository.selectQuestionIds({
    examId,
    userId: user.id,
    mode,
    subjects,
    count,
    shuffle,
  });

  if (questionIds.length === 0) {
    if (mode === 'wrong') {
      return c.json(
        {
          error: {
            code: 'NO_WRONG_ANSWERS',
            message: 'Sem erros registrados nesta prova para revisar',
            exam_id: examId,
          },
        },
        422,
      );
    }

    if (mode === 'subjects') {
      return c.json(
        {
          error: {
            code: 'SUBJECTS_EMPTY',
            message: 'Nenhuma questão encontrada para as disciplinas informadas (classificação pendente ou subjects inexistentes)',
            exam_id: examId,
          },
        },
        422,
      );
    }

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

  const modeParams: Record<string, unknown> = {
    ...(subjects ? { subjects } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(shuffle ? { shuffle } : {}),
    // Snapshot do conjunto — necessário para scoring de anuladas e replay do
    // modo random/wrong depois que a seleção original não é mais reproduzível.
    questionIds,
  };

  const session = await quizRepository.createSession({
    examId,
    userId: user.id,
    mode,
    modeParams,
    totalQuestions: questionIds.length,
  });

  return c.json({
    sessionId: session.id,
    totalQuestions: session.totalQuestions,
    mode,
    questionIds,
  });
});

quizRoutes.get('/sessions', async (c) => {
  const user = getUser(c);
  const examId = c.req.query('examId');

  const sessions = await quizRepository.listSessionsByUser(
    user.id,
    examId && isUuid(examId) ? examId : undefined,
  );

  return c.json({
    sessions: sessions.map((session) => ({
      sessionId: session.id,
      examId: session.examId,
      mode: session.mode ?? 'all',
      status: session.finishedAt ? 'finished' : 'in_progress',
      score: session.score ?? null,
      correct: session.correctAnswers,
      total: session.totalQuestions,
      totalTimeMs: session.totalTimeMs ?? null,
      createdAt: session.startedAt.toISOString(),
      finishedAt: session.finishedAt?.toISOString() ?? null,
    })),
  });
});

quizRoutes.post('/:sessionId/answer', async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const questionId = typeof body.questionId === 'string' ? body.questionId : '';
  const selectedAnswerRaw = typeof body.selectedAnswer === 'string' ? body.selectedAnswer : '';
  const selectedAnswer = normalizeAnswer(selectedAnswerRaw);
  const timeSpentMs = Number.isFinite(body.timeSpentMs) && body.timeSpentMs >= 0
    ? Math.round(body.timeSpentMs as number)
    : undefined;

  if (questionId.length === 0 || !selectedAnswer) {
    return c.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Campos questionId e selectedAnswer (A-E) são obrigatórios',
        },
      },
      400,
    );
  }

  if (!isUuid(sessionId)) {
    return sessionNotFound(c, sessionId);
  }

  if (!isUuid(questionId)) {
    return c.json(
      {
        error: {
          code: 'QUESTION_NOT_FOUND',
          message: 'Questão não pertence à prova da sessão',
          question_id: questionId,
        },
      },
      404,
    );
  }

  const session = await getOwnedSession(sessionId, user.id);
  if (!session) {
    return sessionNotFound(c, sessionId);
  }

  if (session.finishedAt) {
    return c.json(
      {
        error: {
          code: 'SESSION_FINISHED',
          message: 'Sessão já finalizada',
          session_id: sessionId,
        },
      },
      409,
    );
  }

  const question = await questionsRepository.getByExamAndId(session.examId, questionId);
  if (!question) {
    return c.json(
      {
        error: {
          code: 'QUESTION_NOT_FOUND',
          message: 'Questão não pertence à prova da sessão',
          question_id: questionId,
        },
      },
      404,
    );
  }

  const normalizedCorrect = normalizeAnswer(question.correctAnswer ?? '');
  const isCorrect = normalizedCorrect ? normalizedCorrect === selectedAnswer : false;

  // Race-safe: ON CONFLICT (session_id, question_id) DO NOTHING — duplicata → 409.
  const { inserted } = await quizRepository.insertAnswer({
    sessionId,
    questionId,
    selectedAnswer,
    isCorrect,
    timeSpentMs,
  });

  if (!inserted) {
    return c.json(
      {
        error: {
          code: 'QUESTION_ALREADY_ANSWERED',
          message: 'Questão já respondida para esta sessão',
          session_id: sessionId,
          question_id: questionId,
        },
      },
      409,
    );
  }

  return c.json({
    isCorrect,
    correctAnswer: normalizedCorrect ?? null,
  });
});

quizRoutes.post('/:sessionId/finish', async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param('sessionId');

  if (!isUuid(sessionId)) {
    return sessionNotFound(c, sessionId);
  }

  let session = await getOwnedSession(sessionId, user.id);

  if (!session) {
    return sessionNotFound(c, sessionId);
  }

  // Idempotente: já finalizada → retorna valores persistidos.
  if (session.finishedAt) {
    const answeredCount = await quizRepository.countAnswersBySessionId(sessionId);
    return c.json({
      sessionId: session.id,
      finishedAt: session.finishedAt.toISOString(),
      score: session.score ?? 0,
      correct: session.correctAnswers,
      total: session.totalQuestions,
      answered: answeredCount,
      totalTimeMs: session.totalTimeMs ?? null,
    });
  }

  // Conjunto da sessão: snapshot em modeParams.questionIds; sessões antigas
  // (pré-modo) caem no fallback "todas as questões do exame".
  let questionIds = sessionQuestionIds(session);
  if (questionIds.length === 0) {
    const all = await quizRepository.selectQuestionIds({
      examId: session.examId,
      userId: user.id,
      mode: 'all',
    });
    questionIds = all;
  }

  const states = await quizRepository.listSessionQuestionStates(sessionId, session.examId, questionIds);

  const correctCount = states.filter((s) => s.annulled || s.isCorrect === true).length;
  const answeredCount = states.filter((s) => s.selectedAnswer !== null).length;
  const total = states.length > 0 ? states.length : session.totalQuestions;
  const score = computeScorePercent(correctCount, total);

  // totalTimeMs: soma de time_spent_ms quando houver, senão elapsed (D27).
  const spentMs = await quizRepository.sumTimeSpentBySessionId(sessionId);
  const totalTimeMs = spentMs ?? Math.max(Date.now() - session.startedAt.getTime(), 0);

  const finalized = await quizRepository.finalizeSession({
    sessionId,
    correctAnswers: correctCount,
    score,
    totalTimeMs,
  });

  if (finalized) {
    session = finalized;
  } else {
    // Outra chamada finalizou primeiro — refetch para resposta idempotente.
    session = (await quizRepository.getSessionById(sessionId)) ?? session;
  }

  return c.json({
    sessionId: session.id,
    finishedAt: session.finishedAt?.toISOString() ?? new Date().toISOString(),
    score: session.score ?? score,
    correct: session.correctAnswers,
    total: session.totalQuestions,
    answered: answeredCount,
    totalTimeMs: session.totalTimeMs ?? totalTimeMs,
  });
});

quizRoutes.get('/:sessionId/result', async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param('sessionId');

  if (!isUuid(sessionId)) {
    return sessionNotFound(c, sessionId);
  }

  const session = await getOwnedSession(sessionId, user.id);

  if (!session) {
    return sessionNotFound(c, sessionId);
  }

  // D19 — GET sem side-effect: não-finalizada → 409 (auto-finish removido).
  if (!session.finishedAt) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FINISHED',
          message: 'Sessão ainda não finalizada — chame POST /quiz/:sid/finish primeiro',
          session_id: sessionId,
        },
      },
      409,
    );
  }

  let questionIds = sessionQuestionIds(session);
  if (questionIds.length === 0) {
    questionIds = await quizRepository.selectQuestionIds({
      examId: session.examId,
      userId: user.id,
      mode: 'all',
    });
  }

  const states = await quizRepository.listSessionQuestionStates(sessionId, session.examId, questionIds);
  const answered = states.filter((s) => s.selectedAnswer !== null);

  const correct = session.correctAnswers;
  const total = session.totalQuestions;
  const score = session.score ?? computeScorePercent(correct, total);

  return c.json({
    sessionId: session.id,
    examId: session.examId,
    mode: session.mode ?? 'all',
    score,
    correct,
    total,
    answered: answered.length,
    totalTimeMs: session.totalTimeMs ?? null,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt.toISOString(),
    answers: answered.map((state) => ({
      questionId: state.questionId,
      order: state.order,
      questionText: state.questionText,
      subject: state.subject ?? null,
      selectedAnswer: state.selectedAnswer,
      correctAnswer: normalizeAnswer(state.correctAnswer ?? '') ?? null,
      isCorrect: state.isCorrect === true,
      annulled: state.annulled,
      timeSpentMs: state.timeSpentMs ?? null,
      answeredAt: state.answeredAt?.toISOString() ?? null,
    })),
    perSubject: buildPerSubject(states),
  });
});
