import { pool } from '../../src/db/client.js';
import { it } from 'vitest';

/**
 * Helper dos testes de integração: rodam contra o Postgres de dev
 * (DATABASE_URL). Se o banco estiver fora, os testes passam vacuosamente
 * com warning — nunca quebram a suite por indisponibilidade de ambiente.
 */
export async function checkDbAvailable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function makeItDb(getAvailable: () => boolean) {
  return (name: string, fn: () => Promise<void> | void) =>
    it(name, async () => {
      if (!getAvailable()) {
        console.warn(`[skip] ${name} — DB indisponível`);
        return;
      }
      await fn();
    });
}
