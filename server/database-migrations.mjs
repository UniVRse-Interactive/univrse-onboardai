import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Plain SQL migrations in server/migrations, applied in file-name order by
// `npm run db:migrate`. Each file runs once, inside its own transaction, and is
// recorded in schema_migrations. Running the runner again changes nothing.
export const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const migrationName = /^\d{3}_[a-z0-9_]+\.sql$/;

export function migrationFiles(directory = migrationsDirectory) {
  return readdirSync(directory)
    .filter((name) => migrationName.test(name))
    .sort();
}

// pool: a node-postgres Pool (or a compatible test pool).
// Returns { applied: [names run now], skipped: [names already recorded] }.
export async function migrate(pool, { directory = migrationsDirectory, log = () => {} } = {}) {
  const tracked = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
  );
  if (!tracked.rows[0].n)
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
  const applied = [],
    skipped = [];
  for (const name of migrationFiles(directory)) {
    const sql = readFileSync(join(directory, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialises concurrent runners: the second waits, then sees the record.
      await client.query('SELECT pg_advisory_xact_lock(4223001)');
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (done.rows.length) {
        await client.query('COMMIT');
        skipped.push(name);
        log(`Already applied: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      applied.push(name);
      log(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // Schema statements carry no secrets or personal data, so the database's
      // message is safe to show and helps fix the migration.
      throw Object.assign(
        new Error(`Migration ${name} failed (${error.code || error.name}): ${error.message}`),
        { code: error.code },
      );
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}
