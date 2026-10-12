import { apiFetch } from './client';

export type QuizMode = 'all' | 'subjects' | 'random' | 'wrong';

export type StartQuizInput = {
  examId: string;
  mode?: QuizMode;
  subjects?: string[];
  count?: number;
  shuffle?: boolean;
};

export type QuizSession = {
  sessionId: string;
  totalQuestions: number;
  mode: QuizMode;
  /** Snapshot ordenado do conjunto da sessão (definido no start). */
  questionIds: string[];
};

export type QuizSessionSummary = {
  sessionId: string;
  examId: string;
  mode: QuizMode | string;
  status: 'finished' | 'in_progress' | string;
  score: number | null;
  correct: number;
  total: number;
  totalTimeMs: number | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AnswerResult = {
  isCorrect: boolean;
  correctAnswer: string | null;
};

export type QuizFinishResult = {
  sessionId: string;
  finishedAt: string;
  score: number;
  correct: number;
  total: number;
  answered: number;
  totalTimeMs: number | null;
};

export type QuizResultAnswer = {
  questionId: string;
  order: number;
  questionText: string;
  subject: string | null;
  selectedAnswer: string;
  correctAnswer: string | null;
  isCorrect: boolean;
  annulled: boolean;
  timeSpentMs: number | null;
  answeredAt: string | null;
};

export type QuizPerSubjectStat = {
  subject: string;
  total: number;
  correct: number;
};

export type QuizResult = {
  sessionId: string;
  examId: string;
  mode: QuizMode | string;
  score: number;
  correct: number;
  total: number;
  answered: number;
  totalTimeMs: number | null;
  startedAt: string;
  finishedAt: string;
  answers: QuizResultAnswer[];
  perSubject: QuizPerSubjectStat[];
};

type QuizSessionsResponse = { sessions: QuizSessionSummary[] };

export function startQuiz(input: StartQuizInput): Promise<QuizSession> {
  return apiFetch<QuizSession>('/quiz/start', {
    method: 'POST',
    body: JSON.stringify({
      examId: input.examId,
      mode: input.mode ?? 'all',
      ...(input.subjects && input.subjects.length > 0 ? { subjects: input.subjects } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.shuffle ? { shuffle: true } : {}),
    }),
  });
}

export async function fetchQuizSessions(examId: string): Promise<QuizSessionSummary[]> {
  const data = await apiFetch<QuizSessionsResponse>(`/quiz/sessions?examId=${encodeURIComponent(examId)}`);
  return data.sessions;
}

export function submitAnswer(
  sessionId: string,
  questionId: string,
  selectedAnswer: string,
  timeSpentMs?: number,
): Promise<AnswerResult> {
  return apiFetch<AnswerResult>(`/quiz/${sessionId}/answer`, {
    method: 'POST',
    body: JSON.stringify({
      questionId,
      selectedAnswer,
      ...(timeSpentMs !== undefined ? { timeSpentMs: Math.round(timeSpentMs) } : {}),
    }),
  });
}

export function finishQuiz(sessionId: string): Promise<QuizFinishResult> {
  return apiFetch<QuizFinishResult>(`/quiz/${sessionId}/finish`, {
    method: 'POST',
  });
}

export function fetchQuizResult(sessionId: string): Promise<QuizResult> {
  return apiFetch<QuizResult>(`/quiz/${sessionId}/result`);
}
