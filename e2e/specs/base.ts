import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.e2e-state.json',
);

type E2EState = { examId: string; title: string };

/** examId semeado pelo global-setup (e2e/.e2e-state.json). */
export function getSeededExam(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
}

/**
 * Fixture base: marca o onboarding como concluído (localStorage
 * 'singular_onboarded') para o OnboardingDialog não bloquear a UI.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('singular_onboarded', '1');
      } catch {
        // storage indisponível — o teste falha no diálogo se for o caso
      }
    });
    await use(context);
  },
});

export { expect };
