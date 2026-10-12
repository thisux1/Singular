import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E — Singular.
 *
 * Pré-requisitos: stack real no ar (Postgres+Redis via docker-compose,
 * API e frontend). O config NÃO sobe api/db — assume que já estão rodando:
 *
 * - Local (dev):   frontend dev do usuário em :5190 é reutilizado
 *                  (reuseExistingServer). Se nada estiver no ar, o webServer
 *                  abaixo sobe `npm run dev` do frontend na porta da baseURL.
 * - Isolado:       E2E_BASE_URL=http://localhost:5401 com vite próprio
 *                  (ver e2e/README.md, receita com :3005/:5401).
 * - CI:            E2E_WEB_COMMAND aponta para `vite preview` do build.
 *
 * Env vars:
 *   E2E_BASE_URL     baseURL dos specs (default http://localhost:5190)
 *   E2E_WEB_COMMAND  comando do webServer quando a porta estiver livre
 *   DATABASE_URL     usado pelo seed (default: quizsaber local)
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5190';

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL,
    // fundo 3D é pesado demais pra CI/headless: reduced-motion cai no tier 'low'
    // (useGpuTier) e o canvas vira o fallback estático — specs testam DOM puro.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // cwd deste config = e2e/ — por isso --prefix ../frontend.
    command:
      process.env.E2E_WEB_COMMAND ??
      'npm --prefix ../frontend run dev -- --port 5190 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
