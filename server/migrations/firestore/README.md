# Firestore migrations

Files here change the Firestore database (indexes of data, backfills, renamed
fields). `npm run db:migrate` runs them after the SQL migrations when the
`firestore` target is selected (`MIGRATION_TARGETS`, or `FIRESTORE_DATABASE_ID`
is set).

## Format

- File name: `NNN_snake_name.mjs` (three digits, lower-case letters, digits and
  underscores). A file that does not match is never run; `npm run db:migrations:check`
  fails on it. Numbers are unique and files run in name order.
- Each file exports one function:

  ```js
  export async function up({ firestore, log }) {
    // firestore: the @google-cloud/firestore client of the target database
    // log(line): prints "[firestore] line" (never log document data)
  }
  ```

- Do not import from `src/`, `scripts/` or `docs/`. Only `server/` reaches the runtime image.

## Rules

- Forward-only: there is no `down`. Fix a mistake with a new file.
- Idempotent: a file may be retried after a crash or a failure part-way, so running
  it twice must give the same result (use `set`, or check before writing).
- Never edit a file that has been applied anywhere; add a new one.
- A file that throws is not recorded as applied and is retried on the next run, so it
  must be safe to re-run after a partial failure.
- Each file must finish within 5 minutes (the lease), and a whole `db:migrate` run within the
  migrate job's 10-minute timeout. Past 5 minutes the lease expires and another runner (for
  example the job's retry) takes it over and runs the same file again while the first may
  still be writing. Split long backfills into several smaller files.
- Every line passed to `log()` is printed, prefixed `[firestore]`, into the Deploy run log
  on GitHub. Never log document contents or personal data: log only counts and ID-free
  summaries (for example `updated 120 documents`).
- Outside Cloud Run (neither `K_SERVICE` nor `CLOUD_RUN_JOB` set) only the Firestore emulator
  (`FIRESTORE_EMULATOR_HOST`) is migrated, never a cloud database.

## Tracking and locking

- Applied files are documents in the `schema_migrations` collection of the
  database, document id = file name.
- Before running a file, a runner takes a lease by creating
  `schema_migration_locks/<file name>` in a transaction (it fails if a live lease
  exists). A second runner waits, then finds the marker and skips the file. The
  lease is deleted when the file finishes or fails and expires after 5 minutes if
  the runner dies.
- The marker is written only after `up()` returned.
