import { apiFetch } from './client';

export type QuestionExplanation = {
  explanation: string;
  explanationSteps: string[];
  commonMistakes: string[];
  /** true quando veio do cache (não consumiu quota de geração). */
  cached: boolean;
};

/**
 * Gera (ou lê do cache) a explicação de uma questão.
 * 429 RATE_LIMITED quando a quota diária estoura — tratar no caller.
 */
export function explainQuestion(questionId: string): Promise<QuestionExplanation> {
  return apiFetch<QuestionExplanation>(`/questions/${questionId}/explain`, {
    method: 'POST',
  });
}
