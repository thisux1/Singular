import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { examsRepository } from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { quizRepository } from '../repositories/quiz-repository.js';

export const quizRoutes = new Hono();

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

function computeScorePercent(correctAnswers: number, totalQuestions: number): number {
  if (totalQuestions <= 0) {
    return 0;
  }

  return Number(((correctAnswers / totalQuestions) * 100).toFixed(2));
}

async function validateExamReadyForQuiz(examId: string): Promise<
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
  const body = await c.req.json().catch(() => ({}));
  const examId = typeof body.examId === 'string' ? body.examId : '';

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

  const guard = await validateExamReadyForQuiz(examId);
  if (!guard.ok) {
    return c.json(guard.body, guard.status);
  }

  const session = await quizRepository.createSession({
    examId,
    totalQuestions: guard.totalQuestions,
  });

  return c.json({
    sessionId: session.id,
    totalQuestions: session.totalQuestions,
  });
});

quizRoutes.post('/:sessionId/answer', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const questionId = typeof body.questionId === 'string' ? body.questionId : '';
  const selectedAnswerRaw = typeof body.selectedAnswer === 'string' ? body.selectedAnswer : '';
  const selectedAnswer = normalizeAnswer(selectedAnswerRaw);

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

  const session = await quizRepository.getSessionById(sessionId);
  if (!session) {
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

  const existingAnswer = await quizRepository.getAnswerBySessionAndQuestion(sessionId, questionId);
  if (existingAnswer) {
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

  const normalizedCorrect = normalizeAnswer(question.correctAnswer ?? '');
  const isCorrect = normalizedCorrect ? normalizedCorrect === selectedAnswer : false;

  await quizRepository.upsertAnswer({
    sessionId,
    questionId,
    selectedAnswer,
    isCorrect,
  });

  return c.json({
    isCorrect,
    correctAnswer: normalizedCorrect ?? null,
  });
});

quizRoutes.post('/:sessionId/finish', async (c) => {
  const sessionId = c.req.param('sessionId');

  if (!isUuid(sessionId)) {
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

  const session = await quizRepository.getSessionById(sessionId);

  if (!session) {
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

  if (session.finishedAt) {
    return c.json({
      sessionId: session.id,
      finishedAt: session.finishedAt.toISOString(),
      score: session.score ?? 0,
      correct: session.correctAnswers,
      total: session.totalQuestions,
    });
  }

  const [answeredCount, correctCount] = await Promise.all([
    quizRepository.countAnswersBySessionId(sessionId),
    quizRepository.countCorrectAnswersBySessionId(sessionId),
  ]);

  const score = computeScorePercent(correctCount, session.totalQuestions);
  const finalized = await quizRepository.finalizeSession({
    sessionId,
    correctAnswers: correctCount,
    score,
  });

  return c.json({
    sessionId: session.id,
    finishedAt: finalized?.finishedAt?.toISOString() ?? new Date().toISOString(),
    score,
    correct: correctCount,
    total: session.totalQuestions,
    answered: answeredCount,
  });
});

quizRoutes.get('/:sessionId/result', async (c) => {
  const sessionId = c.req.param('sessionId');

  if (!isUuid(sessionId)) {
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

  const session = await quizRepository.getSessionById(sessionId);

  if (!session) {
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

  let currentSession = session;
  const answeredCount = await quizRepository.countAnswersBySessionId(sessionId);
  if (!currentSession.finishedAt && answeredCount >= currentSession.totalQuestions) {
    const correctCount = await quizRepository.countCorrectAnswersBySessionId(sessionId);
    const score = computeScorePercent(correctCount, currentSession.totalQuestions);
    const finalized = await quizRepository.finalizeSession({
      sessionId,
      correctAnswers: correctCount,
      score,
    });

    if (finalized) {
      currentSession = finalized;
    }
  }

  const answers = await quizRepository.listAnswersBySessionId(sessionId);
  const correct = currentSession.correctAnswers;
  const total = currentSession.totalQuestions;
  const score = currentSession.score ?? computeScorePercent(correct, total);

  return c.json({
    score,
    correct,
    total,
    answers: answers.map((answer) => ({
      questionId: answer.questionId,
      questionText: answer.questionText,
      selectedAnswer: answer.selectedAnswer,
      isCorrect: answer.isCorrect,
      correctAnswer: normalizeAnswer(answer.correctAnswer ?? '') ?? null,
      answeredAt: answer.answeredAt.toISOString(),
    })),
  });
});
