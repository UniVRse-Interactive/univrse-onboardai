import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Firestore migrations in server/migrations/firestore, applied in file-name
// order by `npm run db:migrate`. Each file exports `up({ firestore, log })` and
// runs once per database. Applied files are recorded as documents in the
// `schema_migrations` collection (document id = file name).
//
// Two runners must never both apply one file. Before running a file a runner
// takes a lease: it creates `schema_migration_locks/<file>` inside a
// transaction (only if the document is missing or its lease has expired).
// The other runner waits, then sees the marker and skips. The lease is
// released when the file finishes or fails; a crashed runner's lease expires.
// A file that throws is never recorded, so the next run tries it again.
export const firestoreMigrationsDirectory = fileURLToPath(
  new URL('./migrations/firestore/', import.meta.url),
);
export const firestoreMigrationName = /^\d{3}_[a-z0-9_]+\.mjs$/;
export const MARKER_COLLECTION = 'schema_migrations';
export const LOCK_COLLECTION = 'schema_migration_locks';

export function firestoreMigrationFiles(directory = firestoreMigrationsDirectory) {
  return readdirSync(directory)
    .filter((name) => firestoreMigrationName.test(name))
    .sort();
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns true when this runner holds the lease, false when the file is
// already recorded as applied.
async function acquire(firestore, name, { leaseMs, pollMs, waitMs, now, sleep, owner }) {
  const marker = firestore.collection(MARKER_COLLECTION).doc(name);
  const lock = firestore.collection(LOCK_COLLECTION).doc(name);
  const deadline = now() + waitMs;
  for (;;) {
    if ((await marker.get()).exists) return false;
    const taken = await firestore.runTransaction(async (tx) => {
      const current = await tx.get(lock);
      if (current.exists && current.data().expiresAt > now()) return false;
      tx.set(lock, { owner, expiresAt: now() + leaseMs });
      return true;
    });
    if (taken) {
      // Another runner may have finished between the check and the lease.
      if ((await marker.get()).exists) {
        await lock.delete().catch(() => {});
        return false;
      }
      return true;
    }
    if (now() >= deadline)
      throw Object.assign(
        new Error(`Migration ${name} is locked by another runner; gave up waiting.`),
        { safe: true },
      );
    await sleep(pollMs);
  }
}

// firestore: a @google-cloud/firestore client (or compatible test double).
// Returns { applied: [names run now], skipped: [names already recorded] }.
export async function migrateFirestore(
  firestore,
  {
    directory = firestoreMigrationsDirectory,
    log = () => {},
    leaseMs = 5 * 60 * 1000,
    pollMs = 1000,
    waitMs = 8 * 60 * 1000,
    now = () => Date.now(),
    sleep = sleepFor,
  } = {},
) {
  const applied = [],
    skipped = [];
  const owner = crypto.randomUUID();
  for (const name of firestoreMigrationFiles(directory)) {
    const marker = firestore.collection(MARKER_COLLECTION).doc(name);
    const lock = firestore.collection(LOCK_COLLECTION).doc(name);
    try {
      if (!(await acquire(firestore, name, { leaseMs, pollMs, waitMs, now, sleep, owner }))) {
        skipped.push(name);
        log(`Already applied: ${name}`);
        continue;
      }
      try {
        const module = await import(pathToFileURL(join(directory, name)).href);
        if (typeof module.up !== 'function')
          throw Object.assign(new Error(`Migration ${name} failed: it does not export up().`), {
            safe: true,
          });
        await module.up({ firestore, log: (line) => log(String(line)) });
        await marker.create({ appliedAt: new Date(now()) });
      } finally {
        await lock.delete().catch(() => {});
      }
      applied.push(name);
      log(`Applied: ${name}`);
    } catch (error) {
      // Only the file name and a status code are shown: Firestore error text
      // can carry document paths or data.
      if (error.safe) throw error;
      const reason = `(${typeof error.code === 'number' || /^[A-Z_]+$/.test(error.code || '') ? error.code : error.name})`;
      throw Object.assign(new Error(`Migration ${name} failed ${reason}`), { code: error.code });
    }
  }
  return { applied, skipped };
}
