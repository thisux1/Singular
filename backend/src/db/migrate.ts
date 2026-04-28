import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

async function main(): Promise<void> {
  try {
    await migrate(db, {
      migrationsFolder: './drizzle',
    });
    console.info('db.migrate.success');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('db.migrate.error', error);
  process.exitCode = 1;
});
