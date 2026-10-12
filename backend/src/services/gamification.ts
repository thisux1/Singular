/**
 * Gamificação / stats do usuário (T4) — funções PURAS, sem acesso a DB,
 * para cobertura direta por unit tests. As queries ficam no quiz-repository
 * e a rota /api/stats/summary só monta o input.
 *
 * Fórmulas (contrato):
 * - xp = 10*corretas + 2*respondidas + 25*sessões_finalizadas + 40*sessões_com_score>=70
 * - xp necessário para o level L = (L-1)^2 * 100
 *   → level = floor(sqrt(xp/100)) + 1
 *   → levelProgressPct = fração (0-100) do xp dentro do level atual
 * - streakDays = dias consecutivos (UTC) com >=1 sessão finalizada,
 *   terminando hoje ou ontem (se nem hoje nem ontem têm sessão → 0)
 */

export const XP_PER_CORRECT = 10;
export const XP_PER_ANSWERED = 2;
export const XP_PER_FINISHED_SESSION = 25;
export const XP_BONUS_HIGH_SCORE = 40;
export const HIGH_SCORE_THRESHOLD = 70;

export const NO_SUBJECT_LABEL = 'Sem disciplina';

export interface FinishedSessionStat {
  score: number | null;
  totalQuestions: number;
  finishedAt: Date;
  totalTimeMs: number | null;
}

export interface SubjectAggregate {
  subject: string;
  total: number;
  correct: number;
}

export interface BadgeDef {
  id: string;
  label: string;
}

export interface Badge extends BadgeDef {
  earned: boolean;
}

export interface StatsSummaryInput {
  finishedSessions: FinishedSessionStat[];
  totalAnswered: number;
  totalCorrect: number;
  /** Soma de time_spent_ms das respostas (fallback quando sessões não têm total_time_ms). */
  answersTimeMs: number;
  perSubject: SubjectAggregate[];
  /** Relógio injetável para testes de streak. */
  now?: Date;
}

export interface StatsSummary {
  xp: number;
  level: number;
  levelProgressPct: number;
  streakDays: number;
  totalSessions: number;
  totalAnswered: number;
  totalCorrect: number;
  accuracyPct: number;
  totalTimeMs: number;
  weakestSubject: { subject: string; accuracyPct: number } | null;
  perSubject: Array<{ subject: string; total: number; correct: number; accuracyPct: number }>;
  badges: Badge[];
}

/** Catálogo fixo de badges — earned calculado por buildStatsSummary. */
export const BADGE_DEFS: readonly BadgeDef[] = [
  { id: 'first-session', label: 'Primeira sessão' },
  { id: 'perfect', label: 'Gabaritou' },
  { id: 'streak-7', label: '7 dias seguidos' },
  { id: 'centurion', label: 'Centurião' },
  { id: 'scholar', label: 'Erudito' },
  { id: 'sharp', label: 'Mira afiada' },
];

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function computeXp(input: {
  totalCorrect: number;
  totalAnswered: number;
  finishedSessions: number;
  highScoreSessions: number;
}): number {
  return (
    XP_PER_CORRECT * input.totalCorrect
    + XP_PER_ANSWERED * input.totalAnswered
    + XP_PER_FINISHED_SESSION * input.finishedSessions
    + XP_BONUS_HIGH_SCORE * input.highScoreSessions
  );
}

/** level = floor(sqrt(xp/100)) + 1; progresso até o próximo em %. */
export function computeLevel(xp: number): { level: number; levelProgressPct: number } {
  const safeXp = Math.max(xp, 0);
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1;

  const baseXp = (level - 1) ** 2 * 100;
  const nextLevelXp = level ** 2 * 100;
  const span = nextLevelXp - baseXp; // = (2*level - 1) * 100

  const levelProgressPct = span > 0
    ? Math.min(round2(((safeXp - baseXp) / span) * 100), 100)
    : 0;

  return { level, levelProgressPct };
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Streak em dias UTC consecutivos com >=1 sessão finalizada.
 * Começa a contar de hoje; se hoje não tem sessão mas ontem tem, a streak
 * vale a partir de ontem (dia ainda em aberto). Nem hoje nem ontem → 0.
 */
export function computeStreakDays(finishedAts: Date[], now: Date = new Date()): number {
  if (finishedAts.length === 0) {
    return 0;
  }

  const days = new Set(finishedAts.map(utcDayKey));

  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!days.has(utcDayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(utcDayKey(cursor))) {
      return 0;
    }
  }

  let streak = 0;
  while (days.has(utcDayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

/** Menor accuracyPct; desempate pelo maior volume. null se não há respostas. */
export function computeWeakestSubject(
  perSubject: SubjectAggregate[],
): { subject: string; accuracyPct: number } | null {
  const answered = perSubject.filter((row) => row.total > 0);
  if (answered.length === 0) {
    return null;
  }

  const weakest = answered.reduce((min, row) => {
    const accuracy = row.correct / row.total;
    const minAccuracy = min.correct / min.total;
    if (accuracy < minAccuracy || (accuracy === minAccuracy && row.total > min.total)) {
      return row;
    }
    return min;
  });

  return {
    subject: weakest.subject,
    accuracyPct: round2((weakest.correct / weakest.total) * 100),
  };
}

export function buildStatsSummary(input: StatsSummaryInput): StatsSummary {
  const now = input.now ?? new Date();
  const sessions = input.finishedSessions;

  const totalSessions = sessions.length;
  const highScoreSessions = sessions.filter(
    (s) => s.score !== null && s.score >= HIGH_SCORE_THRESHOLD,
  ).length;

  const xp = computeXp({
    totalCorrect: input.totalCorrect,
    totalAnswered: input.totalAnswered,
    finishedSessions: totalSessions,
    highScoreSessions,
  });
  const { level, levelProgressPct } = computeLevel(xp);
  const streakDays = computeStreakDays(
    sessions.map((s) => s.finishedAt),
    now,
  );

  // totalTimeMs: soma de total_time_ms das sessões finalizadas; sessões sem
  // tempo registrado caem no fallback da soma de time_spent_ms das respostas.
  const sessionTimeMs = sessions.reduce((acc, s) => acc + (s.totalTimeMs ?? 0), 0);
  const totalTimeMs = sessionTimeMs > 0 ? sessionTimeMs : input.answersTimeMs;

  const accuracyPct = input.totalAnswered > 0
    ? round2((input.totalCorrect / input.totalAnswered) * 100)
    : 0;

  const perSubject = input.perSubject
    .map((row) => ({
      subject: row.subject,
      total: row.total,
      correct: row.correct,
      accuracyPct: row.total > 0 ? round2((row.correct / row.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject));

  const hasPerfect = sessions.some((s) => s.score === 100 && s.totalQuestions >= 5);
  const hasSharp = sessions.some((s) => s.score !== null && s.score >= 90 && s.totalQuestions >= 10);

  const earnedById: Record<string, boolean> = {
    'first-session': totalSessions >= 1,
    perfect: hasPerfect,
    'streak-7': streakDays >= 7,
    centurion: input.totalAnswered >= 100,
    scholar: input.totalAnswered >= 500,
    sharp: hasSharp,
  };

  return {
    xp,
    level,
    levelProgressPct,
    streakDays,
    totalSessions,
    totalAnswered: input.totalAnswered,
    totalCorrect: input.totalCorrect,
    accuracyPct,
    totalTimeMs,
    weakestSubject: computeWeakestSubject(input.perSubject),
    perSubject,
    badges: BADGE_DEFS.map((def) => ({ ...def, earned: earnedById[def.id] ?? false })),
  };
}
