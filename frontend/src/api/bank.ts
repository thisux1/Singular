import { apiFetch } from './client';

export type BankDifficulty = 'easy' | 'medium' | 'hard';

export type BankFilters = {
  subjects: string[];
  topics: string[];
  bancas: string[];
  years: number[];
};

export type BankQuestion = {
  id: string;
  examId: string;
  examTitle: string;
  questionText: string;
  contextText?: string | null;
  options: string[];
  /** Gabarito — letra (ex.: 'C') ou texto livre quando a prova tem gabarito. */
  correctAnswer: string;
  subject: string | null;
  topic: string | null;
  difficulty: BankDifficulty | null;
  annulled: boolean;
  hasImage: boolean;
  sourcePage: number | null;
  banca: string | null;
  year: number | null;
};

export type BankQuestionsResult = {
  items: BankQuestion[];
  total: number;
  page: number;
  pageSize: number;
};

export type BankQuestionsQuery = {
  subject?: string;
  topic?: string;
  difficulty?: BankDifficulty | '';
  banca?: string;
  year?: number | '';
  q?: string;
  page?: number;
  pageSize?: number;
};

export type BankSession = {
  sessionId: string;
  examId: string;
  questionIds: string[];
};

export function fetchBankFilters(): Promise<BankFilters> {
  return apiFetch<BankFilters>('/bank/filters');
}

export function fetchBankQuestions(query: BankQuestionsQuery): Promise<BankQuestionsResult> {
  const params = new URLSearchParams();

  if (query.subject) params.set('subject', query.subject);
  if (query.topic) params.set('topic', query.topic);
  if (query.difficulty) params.set('difficulty', query.difficulty);
  if (query.banca) params.set('banca', query.banca);
  if (query.year !== undefined && query.year !== '') params.set('year', String(query.year));
  if (query.q) params.set('q', query.q);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));

  const qs = params.toString();
  return apiFetch<BankQuestionsResult>(`/bank/questions${qs ? `?${qs}` : ''}`);
}

/** Monta uma sessão de quiz a partir de ids selecionados no banco. */
export function createBankSession(questionIds: string[]): Promise<BankSession> {
  return apiFetch<BankSession>('/bank/session', {
    method: 'POST',
    body: JSON.stringify({ questionIds }),
  });
}
