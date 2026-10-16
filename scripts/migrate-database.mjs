// npm run db:migrate: applies the SQL files in server/migrations (DATABASE_URL)
// and the Firestore files in server/migrations/firestore (FIRESTORE_DATABASE_ID).
// MIGRATION_TARGETS=sql,firestore picks the targets; unset runs every configured one.
// Safe to run again. Nothing secret is printed (see server/migration-runner.mjs).
import { existsSync } from 'node:fs';
import { runMigrations } from '../server/migration-runner.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
process.exitCode = await runMigrations();
