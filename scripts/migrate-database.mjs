// npm run db:migrate: applies the SQL files in server/migrations to the
// PostgreSQL database in DATABASE_URL. Safe to run again; applied files are
// recorded in schema_migrations and skipped. DATABASE_URL is never printed.
import { existsSync } from 'node:fs';
import pg from 'pg';
import { migrate } from '../server/database-migrations.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = (process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
  console.error('Set DATABASE_URL in .env first (see .env.example), then run npm run db:up.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
try {
  const { applied } = await migrate(pool, { log: (line) => console.log(line) });
  console.log(
    applied.length ? `Database migrated (${applied.length} applied).` : 'Database is up to date.',
  );
} catch (error) {
  const reason = error.message?.startsWith('Migration ')
    ? error.message
    : `the database could not be reached (${error.code || error.name}). Is it running? Try npm run db:up.`;
  console.error(`Migration stopped: ${reason}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
