import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountStore } from '../../server/account-store.mjs';
import {
  guardProblem,
  loginFileName,
  renderBanner,
  runLocalSetup,
} from '../../server/local-setup.mjs';
import { generatePassword, hashPassword, verifyPassword } from '../../server/password-hashing.mjs';
import { fastScrypt } from './account-harness.mjs';
import { createTestDatabase } from './test-database.mjs';

const dbPassword = 'synthetic-db-secret';
const baseEnv = (directory, extra = {}) => ({
  DATABASE_URL: `postgresql://onboardai:${dbPassword}@postgres:5432/onboardai`,
  FIRESTORE_EMULATOR_HOST: 'firestore:8681',
  NODE_ENV: 'production',
  LOCAL_SETUP_DIR: directory,
  LOCAL_HR_ID: 'HR-0001',
  LOCAL_APP_URL: 'http://localhost:3100',
  LOCAL_EMULATOR_UI_URL: 'http://localhost:4000',
  ...extra,
});

async function harness(extra = {}) {
  const database = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'local-setup-'));
  const lines = [],
    errors = [];
  let counter = 0;
  const run = (envExtra = {}, options = {}) =>
    runLocalSetup({
      env: baseEnv(directory, { ...extra, ...envExtra }),
      createPool: () => database.pool,
      hash: (password) => hashPassword(password, fastScrypt),
      generate: () => `generated-${++counter}`,
      now: () => Date.parse('2026-10-16T10:00:00Z'),
      sleep: async () => {},
      out: (line) => lines.push(line),
      err: (line) => errors.push(line),
      ...options,
    });
  const store = createAccountStore({ pool: database.pool, log: () => {} });
  return {
    database,
    directory,
    lines,
    errors,
    run,
    store,
    file: async () => JSON.parse(await readFile(join(directory, loginFileName), 'utf8')),
    text: () => [...lines, ...errors].join('\n'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('the guard refuses Cloud Run, a missing emulator and non-local databases', () => {
  const ok = baseEnv('/x');
  assert.equal(guardProblem(ok), null, 'NODE_ENV=production is expected');
  assert.match(guardProblem({ ...ok, K_SERVICE: 'onboardai-api' }), /Cloud Run/);
  assert.match(guardProblem({ ...ok, FIRESTORE_EMULATOR_HOST: '' }), /FIRESTORE_EMULATOR_HOST/);
  assert.match(guardProblem({ ...ok, DATABASE_URL: '' }), /DATABASE_URL/);
  assert.match(guardProblem({ ...ok, DATABASE_URL: 'not a url' }), /DATABASE_URL/);
  assert.match(
    guardProblem({ ...ok, DATABASE_URL: 'postgresql://u:p@10.1.2.3:5432/db' }),
    /local database/,
  );
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'postgres'])
    assert.equal(guardProblem({ ...ok, DATABASE_URL: `postgresql://u:p@${host}:5432/db` }), null);
});

test('a refused run exits non-zero without touching the database or the file system', async () => {
  const h = await harness();
  try {
    let pools = 0;
    const code = await h.run(
      { K_SERVICE: 'x' },
      {
        createPool: () => {
          pools++;
          return h.database.pool;
        },
      },
    );
    assert.equal(code, 1);
    assert.equal(pools, 0);
    assert.match(h.errors.join(''), /refused/);
    assert.equal(h.errors.join('').includes(dbPassword), false);
  } finally {
    await h.cleanup();
  }
});

test('first run creates the HR account, writes a 0600 login file and prints the banner', async () => {
  const h = await harness();
  try {
    assert.equal(await h.run(), 0);
    const login = await h.file();
    assert.deepEqual(Object.keys(login).sort(), [
      'appUrl',
      'emulatorUiUrl',
      'hrId',
      'password',
      'updatedAt',
    ]);
    assert.equal(login.hrId, 'HR-0001');
    assert.equal(login.password, 'generated-1');
    assert.equal(login.appUrl, 'http://localhost:3100');
    assert.equal(login.emulatorUiUrl, 'http://localhost:4000');
    assert.equal(login.updatedAt, '2026-10-16T10:00:00.000Z');
    assert.equal((await stat(join(h.directory, loginFileName))).mode & 0o777, 0o600);
    const [row] = await h.database.rows(
      'SELECT role, must_change_password FROM accounts WHERE username = $1',
      ['HR-0001'],
    );
    assert.deepEqual(row, { role: 'hr', must_change_password: false });
    const account = await h.store.findForSignIn('HR-0001');
    assert.equal(await verifyPassword('generated-1', account.password_hash), true);
    const text = h.text();
    for (const expected of [
      'http://localhost:3100',
      'http://localhost:4000',
      'HR-0001',
      'generated-1',
    ])
      assert.ok(text.includes(expected), expected);
    assert.equal(text.includes(dbPassword), false);
    assert.equal(text.includes('postgresql://'), false);
  } finally {
    await h.cleanup();
  }
});

test('running again reuses the stored login and changes nothing', async () => {
  const h = await harness();
  try {
    await h.run();
    const before = await h.database.rows('SELECT * FROM accounts');
    const events = await h.database.rows('SELECT * FROM account_events');
    const fileBefore = await readFile(join(h.directory, loginFileName), 'utf8');
    h.lines.length = 0;
    assert.equal(await h.run({}, { now: () => Date.parse('2026-10-17T10:00:00Z') }), 0);
    assert.deepEqual(await h.database.rows('SELECT * FROM accounts'), before);
    assert.deepEqual(await h.database.rows('SELECT * FROM account_events'), events);
    assert.equal(await readFile(join(h.directory, loginFileName), 'utf8'), fileBefore);
    assert.ok(h.text().includes('generated-1'));
  } finally {
    await h.cleanup();
  }
});

test('an existing account with no file, or a wrong stored password, is left unchanged', async () => {
  const h = await harness();
  try {
    await h.store.createAccount({
      username: 'HR-0001',
      passwordHash: await hashPassword('the-users-own-password', fastScrypt),
      role: 'hr',
      mustChangePassword: false,
      action: 'hr_account_created',
      at: new Date(),
    });
    const before = await h.database.rows('SELECT * FROM accounts');
    assert.equal(await h.run(), 0);
    assert.deepEqual(await h.database.rows('SELECT * FROM accounts'), before);
    await assert.rejects(stat(join(h.directory, loginFileName)));
    assert.match(h.text(), /npm run local:reset-hr/);
    assert.match(h.text(), /not stored here/);

    await writeFile(
      join(h.directory, loginFileName),
      JSON.stringify({ hrId: 'HR-0001', password: 'stale-password' }),
    );
    h.lines.length = 0;
    assert.equal(await h.run(), 0);
    assert.deepEqual(await h.database.rows('SELECT * FROM accounts'), before);
    assert.equal((await h.file()).password, 'stale-password');
    assert.match(h.text(), /npm run local:reset-hr/);
    assert.equal(h.text().includes('stale-password'), false);
  } finally {
    await h.cleanup();
  }
});

test('reset sets a new password, clears the lock, ends sessions and records the event', async () => {
  const h = await harness();
  try {
    await h.run();
    const account = await h.store.findForSignIn('HR-0001');
    await h.database.rows(
      `INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
       VALUES ($2, $1, now(), now() + interval '1 day')`,
      [account.id, 'a'.repeat(64)],
    );
    await h.database.rows(
      `UPDATE accounts SET failed_attempts = 5, locked_until = now() + interval '1 hour'`,
    );
    assert.equal(await h.run({ LOCAL_HR_RESET: '1' }), 0);
    const after = await h.store.findForSignIn('HR-0001');
    assert.equal(await verifyPassword('generated-2', after.password_hash), true);
    assert.equal(await verifyPassword('generated-1', after.password_hash), false);
    assert.equal(after.failed_attempts, 0);
    assert.equal(after.locked_until, null);
    assert.equal((await h.database.rows('SELECT * FROM sessions')).length, 0);
    const events = await h.database.rows('SELECT action FROM account_events ORDER BY created_at');
    assert.ok(events.some((e) => e.action === 'hr_password_reset'));
    assert.equal((await h.file()).password, 'generated-2');
    assert.equal((await stat(join(h.directory, loginFileName))).mode & 0o777, 0o600);
  } finally {
    await h.cleanup();
  }
});

test('reset recovers an existing account whose password was not stored', async () => {
  const h = await harness();
  try {
    await h.store.createAccount({
      username: 'HR-0001',
      passwordHash: await hashPassword('the-users-own-password', fastScrypt),
      role: 'hr',
      mustChangePassword: false,
      action: 'hr_account_created',
      at: new Date(),
    });
    assert.equal(await h.run({ LOCAL_HR_RESET: '1' }), 0);
    assert.equal((await h.file()).password, 'generated-1');
  } finally {
    await h.cleanup();
  }
});

test('other accounts are never touched, and a non-HR account with the ID is refused', async () => {
  const h = await harness();
  try {
    const other = await hashPassword('other-person-pass', fastScrypt);
    for (const [username, role] of [
      ['HR-QA27', 'hr'],
      ['QA27-employee', 'employee'],
    ])
      await h.store.createAccount({
        username,
        passwordHash: other,
        role,
        mustChangePassword: false,
        action: 'hr_account_created',
        at: new Date(),
      });
    const snapshot = () =>
      h.database.rows("SELECT * FROM accounts WHERE username <> 'HR-0001' ORDER BY username");
    const before = await snapshot();
    await h.run();
    await h.run({ LOCAL_HR_RESET: '1' });
    assert.deepEqual(await snapshot(), before);

    assert.equal(await h.run({ LOCAL_HR_ID: 'QA27-employee', LOCAL_HR_RESET: '1' }), 1);
    assert.match(h.errors.join(''), /not an HR account/);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await h.cleanup();
  }
});

test('it waits for PostgreSQL with retries, then gives up with a clear message', async () => {
  const h = await harness();
  try {
    let tries = 0;
    const flaky = {
      ...h.database.pool,
      query: (text, values) =>
        ++tries < 3
          ? Promise.reject(
              Object.assign(new Error('connect ECONNREFUSED secret'), { code: 'ECONNREFUSED' }),
            )
          : h.database.pool.query(text, values),
    };
    assert.equal(await h.run({}, { createPool: () => flaky }), 0);
    assert.ok(tries >= 3);

    let clock = 0;
    const down = {
      query: () => Promise.reject(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })),
      end: async () => {},
    };
    h.errors.length = 0;
    const code = await h.run(
      {},
      {
        createPool: () => down,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms * 10;
        },
      },
    );
    assert.equal(code, 1);
    assert.match(h.errors.join(''), /did not become ready in 60 s/);
    assert.equal(h.errors.join('').includes(dbPassword), false);
  } finally {
    await h.cleanup();
  }
});

test('generated passwords are readable and strong enough, and the banner marks a missing one', () => {
  const password = generatePassword();
  assert.match(password, /^([a-z2-9]{5}-){3}[a-z2-9]{5}$/);
  assert.notEqual(generatePassword(), password);
  const banner = renderBanner({
    appUrl: 'http://localhost:3100',
    emulatorUiUrl: 'http://localhost:4000',
    hrId: 'HR-0001',
    password: null,
    note: 'To set a new one, run: npm run local:reset-hr',
  });
  assert.match(banner, /\(not stored here\)/);
});

test('a reused login follows a changed web port: only the URL fields are rewritten, still 0600', async () => {
  const h = await harness();
  try {
    await h.run();
    const before = await h.file();
    const accounts = await h.database.rows('SELECT * FROM accounts');
    assert.equal(
      await h.run({
        LOCAL_APP_URL: 'http://localhost:3150',
        LOCAL_EMULATOR_UI_URL: 'http://localhost:4010',
      }),
      0,
    );
    assert.deepEqual(await h.file(), {
      ...before,
      appUrl: 'http://localhost:3150',
      emulatorUiUrl: 'http://localhost:4010',
    });
    assert.equal((await stat(join(h.directory, loginFileName))).mode & 0o777, 0o600);
    assert.deepEqual(await h.database.rows('SELECT * FROM accounts'), accounts);
    assert.ok(h.text().includes('http://localhost:3150'));
  } finally {
    await h.cleanup();
  }
});
