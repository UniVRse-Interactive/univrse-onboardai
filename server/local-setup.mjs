// Local Docker stack set-up: node server/local-setup.mjs (the compose `setup`
// service, run in the api image). Waits for PostgreSQL, applies the migrations
// and makes sure the local HR login exists, then prints it. Local test data
// only: the guard refuses to run against anything that looks like a cloud
// database. Idempotent; it never touches an account other than LOCAL_HR_ID.
import { randomInt } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createAccountStore } from './account-store.mjs';
import { migrate } from './database-migrations.mjs';
import { hashPassword, passwordProblem, verifyPassword } from './password-hashing.mjs';

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);
export const loginFileName = 'hr-login.json';
export const resetCommand = 'npm run local:reset-hr';

// Returns null when it is safe to continue, else a message saying why not.
export function guardProblem(env) {
  if (env.K_SERVICE) return 'K_SERVICE is set, so this looks like Cloud Run.';
  if (!env.FIRESTORE_EMULATOR_HOST) return 'FIRESTORE_EMULATOR_HOST is not set.';
  let host;
  try {
    host = new URL(String(env.DATABASE_URL || '')).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL is missing or not a valid URL.';
  }
  if (!localHosts.has(host)) return 'DATABASE_URL does not point at a local database.';
  return null;
}

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
// Four groups of five, e.g. "k3fmx-9qa2p-..." (about 99 bits).
export function generatePassword(pick = randomInt) {
  return Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => alphabet[pick(alphabet.length)]).join(''),
  ).join('-');
}

export function renderBanner({ appUrl, emulatorUiUrl, hrId, password, note }) {
  const rows = [
    ['App', appUrl],
    ['Emulator UI', emulatorUiUrl],
    ['HR ID', hrId],
    ['HR password', password ?? '(not stored here)'],
  ];
  const lines = rows.map(([label, value]) => `  ${label.padEnd(12)} ${value}`);
  if (note) lines.push('', `  ${note}`);
  const width = Math.max(...lines.map((line) => line.length)) + 2;
  const rule = '='.repeat(width);
  return [rule, '  Local test login (local data only)', rule, ...lines, rule].join('\n');
}

const defaultFs = { mkdir, readFile, writeFile, rename, chmod };

async function readLogin(fs, path) {
  try {
    const data = JSON.parse(await fs.readFile(path, 'utf8'));
    return typeof data?.password === 'string' && data.password ? data : null;
  } catch {
    return null;
  }
}

async function writeLogin(fs, directory, login) {
  await fs.mkdir(directory, { recursive: true });
  const path = join(directory, loginFileName);
  const temporary = `${path}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(login, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, path);
}

async function waitForDatabase(pool, { timeoutMs, intervalMs, sleep, now, log }) {
  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (now() >= deadline)
        throw new Error(
          `PostgreSQL did not become ready in ${Math.round(timeoutMs / 1000)} s (${error.code || error.name}).`,
        );
      if (attempt === 1) log('Waiting for PostgreSQL...');
      await sleep(intervalMs);
    }
  }
}

// Everything is injectable so tests need no Docker, network or real clock.
// Returns the exit code; output goes through out/err.
export async function runLocalSetup({
  env = process.env,
  createPool = (url) =>
    new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 }),
  fs = defaultFs,
  hash = hashPassword,
  verify = verifyPassword,
  generate = generatePassword,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
  waitMs = 60000,
  intervalMs = 1000,
} = {}) {
  const problem = guardProblem(env);
  if (problem) {
    err(`Local set-up refused: ${problem} It only runs against the local Docker stack.`);
    return 1;
  }
  const hrId = (env.LOCAL_HR_ID || 'HR-0001').trim();
  const directory = env.LOCAL_SETUP_DIR || '/local-setup';
  const appUrl = env.LOCAL_APP_URL || 'http://localhost:3100';
  const emulatorUiUrl = env.LOCAL_EMULATOR_UI_URL || 'http://localhost:4000';
  const reset = env.LOCAL_HR_RESET === '1';
  const loginPath = join(directory, loginFileName);
  const pool = createPool(env.DATABASE_URL);
  const store = createAccountStore({ pool, log: () => {} });
  const banner = (password, note) =>
    out(renderBanner({ appUrl, emulatorUiUrl, hrId, password, note }));
  const save = async (password) =>
    writeLogin(fs, directory, {
      hrId,
      password,
      appUrl,
      emulatorUiUrl,
      updatedAt: new Date(now()).toISOString(),
    });

  try {
    await waitForDatabase(pool, { timeoutMs: waitMs, intervalMs, sleep, now, log: out });
    const { applied } = await migrate(pool);
    out(
      applied.length ? `Database migrated (${applied.length} applied).` : 'Database is up to date.',
    );

    const account = await store.findForSignIn(hrId);
    if (account && account.role !== 'hr') {
      err(`Local set-up stopped: ${hrId} is not an HR account. Set LOCAL_HR_ID to another ID.`);
      return 1;
    }

    if (account && reset) {
      const password = generate();
      await store.resetHrPassword(hrId, await hash(password), new Date(now()));
      await save(password);
      out(`Reset the password for ${hrId}.`);
      banner(password);
      return 0;
    }

    if (account) {
      const stored = await readLogin(fs, loginPath);
      if (stored && (await verify(stored.password, account.password_hash))) {
        out(`${hrId} already exists; using the stored login.`);
        banner(stored.password);
        return 0;
      }
      out(`${hrId} exists, but its password is not stored here, so it was left unchanged.`);
      banner(null, `To set a new one, run: ${resetCommand}`);
      return 0;
    }

    const password = generate();
    if (passwordProblem(password, hrId)) throw new Error('The generated password was rejected.');
    try {
      await store.createAccount({
        username: hrId,
        passwordHash: await hash(password),
        role: 'hr',
        mustChangePassword: false,
        createdBy: null,
        action: 'hr_account_created',
        at: new Date(now()),
      });
    } catch (error) {
      if (error.code !== 'USERNAME_TAKEN') throw error;
      out(`${hrId} was created by someone else just now; left unchanged.`);
      banner(null, `To set a new password, run: ${resetCommand}`);
      return 0;
    }
    await save(password);
    out(`Created HR account ${hrId}.`);
    banner(password);
    return 0;
  } catch (error) {
    // Never print the error object: it can carry connection details.
    err(
      `Local set-up failed: ${error.message?.startsWith('Migration ') || error.message?.startsWith('PostgreSQL ') ? error.message : `the database or login file could not be used (${error.code || error.name}).`}`,
    );
    return 1;
  } finally {
    await store.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runLocalSetup();
}
