import { apiFetch } from './client';

export type QuizSession = {
  sessionId: string;
  totalQuestions: number;
};

export type AnswerResult = {
  isCorrect: boolean;
  correctAnswer: string | null;
};

export type QuizResult = {
  score: number;
  correct: number;
  total: number;
  answers: Array<{
    questionId: string;
    questionText: string;
    selectedAnswer: string;
    correctAnswer: string | null;
    isCorrect: boolean;
  }>;
};

export function startQuiz(examId: string): Promise<QuizSession> {
  return apiFetch<QuizSession>('/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ examId }),
  });
}

export function submitAnswer(quizId: string, questionId: string, optionId: string): Promise<AnswerResult> {
  return apiFetch<AnswerResult>(`/quiz/${quizId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ questionId, selectedAnswer: optionId }),
  });
}

export function fetchQuizResult(quizId: string): Promise<QuizResult> {
  return apiFetch<QuizResult>(`/quiz/${quizId}/result`);
}
