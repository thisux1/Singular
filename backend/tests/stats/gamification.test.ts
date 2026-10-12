import { describe, expect, it } from 'vitest';
import {
  buildStatsSummary,
  computeLevel,
  computeStreakDays,
  computeWeakestSubject,
  computeXp,
} from '../../src/services/gamification.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function finishedSession(overrides: Partial<{
  score: number | null;
  totalQuestions: number;
  finishedAt: Date;
  totalTimeMs: number | null;
}> = {}) {
  return {
    score: overrides.score ?? 50,
    totalQuestions: overrides.totalQuestions ?? 10,
    finishedAt: overrides.finishedAt ?? new Date(),
    totalTimeMs: overrides.totalTimeMs === undefined ? 60_000 : overrides.totalTimeMs,
  };
}

describe('gamification — fórmulas puras', () => {
  it('computeXp: 10*corretas + 2*respondidas + 25*finalizadas + 40*score>=70', () => {
    expect(computeXp({
      totalCorrect: 10,
      totalAnswered: 20,
      finishedSessions: 3,
      highScoreSessions: 2,
    })).toBe(10 * 10 + 2 * 20 + 25 * 3 + 40 * 2); // 295
    expect(computeXp({ totalCorrect: 0, totalAnswered: 0, finishedSessions: 0, highScoreSessions: 0 })).toBe(0);
  });

  it('computeLevel: level = floor(sqrt(xp/100)) + 1 e progresso dentro do level', () => {
    expect(computeLevel(0)).toEqual({ level: 1, levelProgressPct: 0 });
    expect(computeLevel(99)).toEqual({ level: 1, levelProgressPct: 99 });
    expect(computeLevel(100)).toEqual({ level: 2, levelProgressPct: 0 });
    // xp 250 → level 2; base 100, próximo 400 → 150/300 = 50%
    expect(computeLevel(250)).toEqual({ level: 2, levelProgressPct: 50 });
    expect(computeLevel(400)).toEqual({ level: 3, levelProgressPct: 0 });
    expect(computeLevel(900)).toEqual({ level: 4, levelProgressPct: 0 });
  });

  it('computeStreakDays: dias consecutivos UTC terminando hoje ou ontem', () => {
    const now = new Date('2026-03-10T15:00:00.000Z');
    const day = (back: number) => new Date(now.getTime() - back * DAY_MS);

    expect(computeStreakDays([], now)).toBe(0);
    // hoje + ontem + anteontem → 3
    expect(computeStreakDays([day(0), day(1), day(2)], now)).toBe(3);
    // sem hoje, mas ontem+anteontem → 2 (dia de hoje ainda em aberto)
    expect(computeStreakDays([day(1), day(2)], now)).toBe(2);
    // nem hoje nem ontem → 0 (streak quebrada)
    expect(computeStreakDays([day(2), day(3)], now)).toBe(0);
    // gap na sequência: hoje + anteontem (sem ontem) → 1
    expect(computeStreakDays([day(0), day(2), day(3)], now)).toBe(1);
    // múltiplas sessões no mesmo dia contam 1 dia
    expect(computeStreakDays([day(0), day(0), day(1), day(1)], now)).toBe(2);
    // streak de 7+
    expect(computeStreakDays([0, 1, 2, 3, 4, 5, 6, 7].map(day), now)).toBe(8);
  });

  it('computeWeakestSubject: menor accuracy, desempate por volume, null vazio', () => {
    expect(computeWeakestSubject([])).toBeNull();
    expect(computeWeakestSubject([
      { subject: 'Mat', total: 10, correct: 9 },
      { subject: 'Port', total: 10, correct: 5 },
      { subject: 'Dir', total: 4, correct: 4 },
    ])).toEqual({ subject: 'Port', accuracyPct: 50 });
    // empate 50% → maior volume vence
    expect(computeWeakestSubject([
      { subject: 'A', total: 2, correct: 1 },
      { subject: 'B', total: 10, correct: 5 },
    ])).toEqual({ subject: 'B', accuracyPct: 50 });
  });

  it('buildStatsSummary: xp/level/streak/badges encadeados', () => {
    const now = new Date('2026-03-10T15:00:00.000Z');
    const day = (back: number) => new Date(now.getTime() - back * DAY_MS);

    const summary = buildStatsSummary({
      now,
      finishedSessions: [
        // score 100 com 10 questões → 'perfect' e 'sharp' e bônus >=70
        finishedSession({ score: 100, totalQuestions: 10, finishedAt: day(1), totalTimeMs: 1000 }),
        finishedSession({ score: 50, totalQuestions: 4, finishedAt: day(0), totalTimeMs: 2000 }),
      ],
      totalAnswered: 120,
      totalCorrect: 80,
      answersTimeMs: 999_999,
      perSubject: [{ subject: 'Mat', total: 120, correct: 80 }],
    });

    // xp = 10*80 + 2*120 + 25*2 + 40*1 = 800 + 240 + 50 + 40 = 1130
    expect(summary.xp).toBe(1130);
    // level = floor(sqrt(11.3)) + 1 = 4; base 900, next 1600 → 230/700 ≈ 32.86
    expect(summary.level).toBe(4);
    expect(summary.levelProgressPct).toBeCloseTo(32.86, 2);
    expect(summary.streakDays).toBe(2);
    expect(summary.totalSessions).toBe(2);
    expect(summary.totalAnswered).toBe(120);
    expect(summary.totalCorrect).toBe(80);
    expect(summary.accuracyPct).toBeCloseTo(66.67, 2);
    // sessões têm totalTimeMs → usa soma delas, não o fallback de respostas
    expect(summary.totalTimeMs).toBe(3000);
    expect(summary.weakestSubject).toEqual({ subject: 'Mat', accuracyPct: 66.67 });

    const badges = Object.fromEntries(summary.badges.map((b) => [b.id, b.earned]));
    expect(badges['first-session']).toBe(true);
    expect(badges['perfect']).toBe(true);   // 100% com >=5 questões
    expect(badges['sharp']).toBe(true);     // >=90% com >=10 questões
    expect(badges['centurion']).toBe(true); // >=100 respondidas
    expect(badges['scholar']).toBe(false);  // <500 respondidas
    expect(badges['streak-7']).toBe(false); // streak 2
    expect(summary.badges).toHaveLength(6);
  });

  it('buildStatsSummary: badges NÃO conquistados nos edge-cases', () => {
    const summary = buildStatsSummary({
      finishedSessions: [
        // 100% mas só 4 questões → sem 'perfect'; <10 questões → sem 'sharp'
        finishedSession({ score: 100, totalQuestions: 4, totalTimeMs: null }),
        // score 69 → sem bônus >=70
        finishedSession({ score: 69, totalQuestions: 20, totalTimeMs: null }),
      ],
      totalAnswered: 99,
      totalCorrect: 90,
      answersTimeMs: 500,
      perSubject: [],
    });

    const badges = Object.fromEntries(summary.badges.map((b) => [b.id, b.earned]));
    expect(badges['perfect']).toBe(false);
    expect(badges['sharp']).toBe(false);
    expect(badges['centurion']).toBe(false);
    expect(summary.weakestSubject).toBeNull();
    // sem totalTimeMs nas sessões → fallback answersTimeMs
    expect(summary.totalTimeMs).toBe(500);
  });

  it('buildStatsSummary: usuário novo → zeros, badges todos false', () => {
    const summary = buildStatsSummary({
      finishedSessions: [],
      totalAnswered: 0,
      totalCorrect: 0,
      answersTimeMs: 0,
      perSubject: [],
    });

    expect(summary).toMatchObject({
      xp: 0,
      level: 1,
      levelProgressPct: 0,
      streakDays: 0,
      totalSessions: 0,
      totalAnswered: 0,
      totalCorrect: 0,
      accuracyPct: 0,
      totalTimeMs: 0,
      weakestSubject: null,
      perSubject: [],
    });
    expect(summary.badges.every((b) => !b.earned)).toBe(true);
  });
});
