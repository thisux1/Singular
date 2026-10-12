import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

/**
 * Roda o seed antes de qualquer spec: cria a "E2E Prova Sintética" no banco
 * apontado por DATABASE_URL (default: quizsaber dev) e grava
 * e2e/.e2e-state.json com o examId para os specs lerem.
 */
export default function globalSetup(_config: FullConfig): void {
  const e2eDir = path.dirname(fileURLToPath(import.meta.url));
  const output = execFileSync(process.execPath, [path.join(e2eDir, 'seed.mjs')], {
    encoding: 'utf8',
    env: process.env,
  });
  process.stdout.write(output);
}
