import { readdirSync } from 'node:fs';
import pg from 'pg';
import { migrate, migrationName, migrationsDirectory } from './database-migrations.mjs';
import {
  firestoreMigrationName,
  firestoreMigrationsDirectory,
  migrateFirestore,
} from './firestore-migrations.mjs';
import { createFirestoreClient, firestoreConfig } from './firestore-client.mjs';

// `npm run db:migrate` and `npm run db:migrations:check` live here so they can
// be tested. Output is safe for CI logs: never a URL, secret or document data.
export const targetOrder = ['sql', 'firestore'];

export { firestoreAllowed };

export class MigrationSetupError extends Error {}

const configured = (env) => ({
  sql: Boolean((env.DATABASE_URL || '').trim()),
  firestore: Boolean(firestoreConfig(env)),
});
// Mirrors account-settings: outside Cloud Run (no K_SERVICE, no CLOUD_RUN_JOB)
// only the Firestore emulator is migrated, so unreviewed branch migrations can
// never reach a cloud database from a developer machine.
const firestoreAllowed = (env) =>
  Boolean(
    (env.K_SERVICE || '').trim() ||
    (env.CLOUD_RUN_JOB || '').trim() ||
    (env.FIRESTORE_EMULATOR_HOST || '').trim(),
  );
const skippedNote =
  'Firestore migrations skipped: FIRESTORE_EMULATOR_HOST is not set (outside Cloud Run only the emulator is migrated).';
const missingVariable = { sql: 'DATABASE_URL', firestore: 'FIRESTORE_DATABASE_ID' };

// Returns the targets to run, in order sql then firestore. Throws
// MigrationSetupError before anything is touched.
export function selectTargets(env, notes = []) {
  const have = configured(env);
  const listed = (env.MIGRATION_TARGETS || '').trim();
  if (!listed) {
    const skipped = have.firestore && !firestoreAllowed(env);
    if (skipped) {
      have.firestore = false;
      notes.push(skippedNote);
    }
    const targets = targetOrder.filter((target) => have[target]);
    if (!targets.length)
      throw new MigrationSetupError(
        skipped
          ? skippedNote
          : 'Set DATABASE_URL (and optionally FIRESTORE_DATABASE_ID) in .env first (see .env.example), then run npm run db:up.',
      );
    return targets;
  }
  const names = listed
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names)
    if (!targetOrder.includes(name))
      throw new MigrationSetupError(
        `Unknown migration target "${name.slice(0, 40)}"; MIGRATION_TARGETS accepts sql and firestore.`,
      );
  const targets = targetOrder.filter((target) => names.includes(target));
  if (!targets.length) throw new MigrationSetupError('MIGRATION_TARGETS lists no target.');
  for (const target of targets)
    if (!have[target])
      throw new MigrationSetupError(
        `MIGRATION_TARGETS includes ${target}, but ${missingVariable[target]} is not set.`,
      );
  if (targets.includes('firestore') && !firestoreAllowed(env))
    throw new MigrationSetupError(
      'MIGRATION_TARGETS includes firestore, but FIRESTORE_EMULATOR_HOST is not set (outside Cloud Run only the emulator is migrated).',
    );
  if (targets.includes('firestore') && !firestoreConfig(env).projectId)
    throw new MigrationSetupError(
      'MIGRATION_TARGETS includes firestore, but FIRESTORE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is not set.',
    );
  return targets;
}

// The Cloud SQL socket form postgresql://USER:PASS@/DB?host=/cloudsql/... has
// no host, which new URL() rejects, so only the scheme is checked here.
export const databaseUrlProblem = (value) =>
  /^postgres(ql)?:\/\/\S+$/i.test(String(value || '').trim())
    ? null
    : 'DATABASE_URL must be a postgresql:// connection URL';

const defaults = {
  createPool: (connectionString) =>
    new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }),
  createFirestore: (config) => createFirestoreClient(config)(),
};

// Returns the exit code.
export async function runMigrations({
  env = process.env,
  out = (line) => console.log(line),
  err = (line) => console.error(line),
  createPool = defaults.createPool,
  createFirestore = defaults.createFirestore,
  sqlOptions = {},
  firestoreOptions = {},
} = {}) {
  let targets;
  const notes = [];
  try {
    targets = selectTargets(env, notes);
    if (targets.includes('sql')) {
      const problem = databaseUrlProblem(env.DATABASE_URL);
      if (problem) throw new MigrationSetupError(problem);
    }
  } catch (error) {
    if (!(error instanceof MigrationSetupError)) throw error;
    err(`Migration stopped: ${error.message}`);
    return 1;
  }
  for (const note of notes) out(note);
  const summary = [];
  for (const target of targets) {
    const log = (line) => out(`[${target}] ${line}`);
    let close = async () => {};
    try {
      let result;
      if (target === 'sql') {
        const pool = createPool(env.DATABASE_URL.trim());
        close = () => pool.end();
        result = await migrate(pool, { log, ...sqlOptions });
      } else {
        const firestore = await createFirestore(firestoreConfig(env));
        close = () => firestore.terminate?.();
        result = await migrateFirestore(firestore, { log, ...firestoreOptions });
      }
      summary.push(
        `${target} ${result.applied.length} applied, ${result.skipped.length} already applied`,
      );
    } catch (error) {
      const reason = error.message?.startsWith('Migration ')
        ? error.message
        : target === 'sql'
          ? `the database could not be reached (${error.code || error.name}). Is it running? Try npm run db:up.`
          : `Firestore could not be used (${typeof error.code === 'number' || /^[A-Z_]+$/.test(error.code || '') ? error.code : error.name}).`;
      err(`Migration stopped: [${target}] ${reason}`);
      return 1;
    } finally {
      await close().catch(() => {});
    }
  }
  out(`Migrations finished: ${summary.join('; ')}.`);
  return 0;
}

// Detection check: finds files the runners would silently skip. No database.
export function checkMigrationFiles({
  sqlDirectory = migrationsDirectory,
  firestoreDirectory = firestoreMigrationsDirectory,
} = {}) {
  const problems = [],
    listing = [],
    counts = {};
  const groups = [
    ['sql', sqlDirectory, migrationName, 'NNN_snake_name.sql'],
    ['firestore', firestoreDirectory, firestoreMigrationName, 'NNN_snake_name.mjs'],
  ];
  for (const [target, directory, pattern, shape] of groups) {
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT' || target === 'sql') throw error;
    }
    const seen = new Map();
    counts[target] = 0;
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'README.md') continue;
      if (entry.isDirectory() && target === 'sql' && entry.name === 'firestore') continue;
      if (!entry.isFile() || !pattern.test(entry.name)) {
        problems.push(`[${target}] ${entry.name} does not match ${shape}, so it would be skipped`);
        continue;
      }
      const number = entry.name.slice(0, 3);
      if (seen.has(number))
        problems.push(
          `[${target}] ${entry.name} and ${seen.get(number)} share the number ${number}`,
        );
      seen.set(number, entry.name);
      listing.push(`[${target}] ${entry.name}`);
      counts[target]++;
    }
  }
  return { problems, listing, counts };
}
