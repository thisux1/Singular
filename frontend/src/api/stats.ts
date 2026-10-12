import { apiFetch } from './client';

export type StatsBadge = {
  id: string;
  label: string;
  earned: boolean;
};

export type StatsPerSubject = {
  subject: string;
  total: number;
  correct: number;
  accuracyPct: number;
};

export type StatsSummary = {
  xp: number;
  level: number;
  /** Progresso dentro do nível atual (0–100). */
  levelProgressPct: number;
  streakDays: number;
  totalSessions: number;
  totalAnswered: number;
  totalCorrect: number;
  accuracyPct: number;
  totalTimeMs: number;
  weakestSubject: { subject: string; accuracyPct: number } | null;
  perSubject: StatsPerSubject[];
  badges: StatsBadge[];
};

export function fetchStatsSummary(): Promise<StatsSummary> {
  return apiFetch<StatsSummary>('/stats/summary');
}
