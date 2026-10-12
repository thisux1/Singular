import { describe, expect, it } from 'vitest';
import {
  clampQuestionCount,
  computeScorePercent,
  isQuizMode,
  RANDOM_MODE_DEFAULT_COUNT,
  RANDOM_MODE_MIN_COUNT,
} from '../../src/repositories/quiz-repository.js';

describe('quiz-repository helpers (puros)', () => {
  it('isQuizMode aceita apenas modos válidos', () => {
    expect(isQuizMode('all')).toBe(true);
    expect(isQuizMode('subjects')).toBe(true);
    expect(isQuizMode('random')).toBe(true);
    expect(isQuizMode('wrong')).toBe(true);
    expect(isQuizMode('ALL')).toBe(false);
    expect(isQuizMode('')).toBe(false);
    expect(isQuizMode(undefined)).toBe(false);
    expect(isQuizMode(42)).toBe(false);
  });

  it('clampQuestionCount: default 30, clamp [5, total]', () => {
    expect(clampQuestionCount(undefined, 70)).toBe(RANDOM_MODE_DEFAULT_COUNT);
    expect(clampQuestionCount(2, 70)).toBe(RANDOM_MODE_MIN_COUNT);
    expect(clampQuestionCount(100, 70)).toBe(70);
    expect(clampQuestionCount(10, 10)).toBe(10);
    // total < mínimo → usa o próprio total
    expect(clampQuestionCount(undefined, 3)).toBe(3);
    expect(clampQuestionCount(50, 3)).toBe(3);
    expect(clampQuestionCount(undefined, 0)).toBe(0);
    // valores inválidos caem no default clampado
    expect(clampQuestionCount(-5, 40)).toBe(30);
    expect(clampQuestionCount(1.5, 40)).toBe(30);
  });

  it('computeScorePercent: percentual com 2 casas, zero-safe', () => {
    expect(computeScorePercent(0, 0)).toBe(0);
    expect(computeScorePercent(7, 10)).toBe(70);
    expect(computeScorePercent(1, 3)).toBe(33.33);
    expect(computeScorePercent(70, 70)).toBe(100);
  });
});
