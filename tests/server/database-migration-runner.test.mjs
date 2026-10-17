import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkMigrationFiles,
  runMigrations,
  selectTargets,
} from '../../server/migration-runner.mjs';
import { accountSettings } from '../../server/account-settings.mjs';
import { migrateFirestore } from '../../server/firestore-migrations.mjs';
import { FakeFirestore } from './fake-firestore.mjs';
import { createTestDatabase } from './test-database.mjs';

const secret = 'synthetic-pw-9f3';
const sqlUrl = `postgresql://app:${secret}@db.internal:5432/app`;
const socketUrl = `postgresql://app:${secret}@/app?host=/cloudsql/proj:region:inst`;
const fsEnv = { FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_PROJECT_ID: 'demo-test' };
const emulatorEnv = { ...fsEnv, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8681' };

async function tempTree(files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'migrations-'));
  const sql = join(root, 'sql');
  const firestore = join(sql, 'firestore');
  await mkdir(firestore, { recursive: true });
  for (const [path, content] of Object.entries(files)) await writeFile(join(sql, path), content);
  return { root, sql, firestore, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const upFile = (body = '') => `export async function up({ firestore, log }) { ${body} }\n`;

test('selectTargets: unset runs every configured target in order', () => {
  assert.deepEqual(selectTargets({ DATABASE_URL: sqlUrl, ...emulatorEnv }), ['sql', 'firestore']);
  assert.deepEqual(selectTargets({ DATABASE_URL: sqlUrl }), ['sql']);
  assert.deepEqual(selectTargets(emulatorEnv), ['firestore']);
  assert.throws(() => selectTargets({}), /Set DATABASE_URL/);
});

test('selectTargets: listed targets run exactly, sql before firestore', () => {
  const env = { DATABASE_URL: sqlUrl, ...emulatorEnv };
  assert.deepEqual(selectTargets({ ...env, MIGRATION_TARGETS: 'firestore, sql' }), [
    'sql',
    'firestore',
  ]);
  assert.deepEqual(selectTargets({ ...env, MIGRATION_TARGETS: 'sql' }), ['sql']);
});

test('selectTargets: a listed target that is not configured names the variable', () => {
  assert.throws(
    () => selectTargets({ DATABASE_URL: sqlUrl, MIGRATION_TARGETS: 'sql,firestore' }),
    /firestore, but FIRESTORE_DATABASE_ID is not set/,
  );
  assert.throws(
    () => selectTargets({ ...fsEnv, MIGRATION_TARGETS: 'sql' }),
    /sql, but DATABASE_URL is not set/,
  );
  assert.throws(
    () =>
      selectTargets({
        FIRESTORE_DATABASE_ID: 'x',
        FIRESTORE_EMULATOR_HOST: 'h',
        MIGRATION_TARGETS: 'firestore',
      }),
    /FIRESTORE_PROJECT_ID/,
  );
  assert.deepEqual(
    selectTargets({
      FIRESTORE_DATABASE_ID: 'x',
      FIRESTORE_EMULATOR_HOST: 'h',
      GOOGLE_CLOUD_PROJECT: 'p',
      MIGRATION_TARGETS: 'firestore',
    }),
    ['firestore'],
  );
});

test('selectTargets: an unknown target name is refused', () => {
  assert.throws(
    () => selectTargets({ DATABASE_URL: sqlUrl, MIGRATION_TARGETS: 'sql,mongo' }),
    /Unknown migration target "mongo"/,
  );
});

test('runMigrations: a missing target exits 1 before any database is touched', async () => {
  let touched = 0;
  const errors = [];
  const code = await runMigrations({
    env: { DATABASE_URL: sqlUrl, MIGRATION_TARGETS: 'sql,firestore' },
    err: (line) => errors.push(line),
    out: () => {},
    createPool: () => (touched++, null),
    createFirestore: () => (touched++, null),
  });
  assert.equal(code, 1);
  assert.equal(touched, 0);
  assert.match(errors[0], /^Migration stopped: .*FIRESTORE_DATABASE_ID/);
});

test('runMigrations: sql path applies the real migrations once, then skips them', async () => {
  const database = await createTestDatabase();
  const run = async (env) => {
    const out = [],
      err = [];
    const code = await runMigrations({
      env,
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      createPool: () => ({ ...database.pool, end: async () => {} }),
    });
    return { code, out, err };
  };
  // createTestDatabase already applied them, so everything is "already applied".
  const first = await run({ DATABASE_URL: socketUrl, MIGRATION_TARGETS: 'sql' });
  assert.equal(first.code, 0);
  assert.match(first.out[0], /^\[sql\] Already applied: 001_accounts\.sql$/);
  assert.match(first.out.at(-1), /^Migrations finished: sql 0 applied, \d+ already applied\.$/);
  assert.deepEqual(first.err, []);
  for (const line of [...first.out, ...first.err]) {
    assert.ok(!line.includes(secret) && !line.includes('cloudsql'), line);
  }
});

test('runMigrations: firestore apply, skip, order and summary line', async () => {
  const tree = await tempTree({});
  try {
    await writeFile(join(tree.firestore, '001_first.mjs'), upFile());
    await writeFile(join(tree.firestore, '002_second.mjs'), upFile());
    const firestore = new FakeFirestore();
    const run = async () => {
      const out = [];
      const code = await runMigrations({
        env: { ...emulatorEnv, MIGRATION_TARGETS: 'firestore' },
        out: (l) => out.push(l),
        err: () => {},
        createFirestore: async () => firestore.connect(),
        firestoreOptions: { directory: tree.firestore },
      });
      return { code, out };
    };
    const first = await run();
    assert.equal(first.code, 0);
    assert.deepEqual(first.out, [
      '[firestore] Applied: 001_first.mjs',
      '[firestore] Applied: 002_second.mjs',
      'Migrations finished: firestore 2 applied, 0 already applied.',
    ]);
    assert.deepEqual(firestore.paths('schema_migrations/'), [
      'schema_migrations/001_first.mjs',
      'schema_migrations/002_second.mjs',
    ]);
    assert.deepEqual(firestore.paths('schema_migration_locks/'), []);
    const second = await run();
    assert.deepEqual(second.out, [
      '[firestore] Already applied: 001_first.mjs',
      '[firestore] Already applied: 002_second.mjs',
      'Migrations finished: firestore 0 applied, 2 already applied.',
    ]);
  } finally {
    await tree.cleanup();
  }
});

test('runMigrations: a firestore failure stops with exit 1 and records nothing', async () => {
  const tree = await tempTree({});
  try {
    await writeFile(
      join(tree.firestore, '001_bad.mjs'),
      upFile(
        "await firestore.collection('x').doc('a').set({ ok: 1 }); throw new Error('private document text');",
      ),
    );
    await writeFile(join(tree.firestore, '002_later.mjs'), upFile());
    const firestore = new FakeFirestore();
    const out = [],
      err = [];
    const code = await runMigrations({
      env: { ...emulatorEnv, MIGRATION_TARGETS: 'firestore' },
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      createFirestore: async () => firestore,
      firestoreOptions: { directory: tree.firestore },
    });
    assert.equal(code, 1);
    assert.match(
      err[0],
      /^Migration stopped: \[firestore\] Migration 001_bad\.mjs failed \(Error\)$/,
    );
    assert.ok(!err.join().includes('private document text'));
    assert.deepEqual(firestore.paths('schema_migrations/'), []);
    assert.deepEqual(firestore.paths('schema_migration_locks/'), []);
    assert.ok(!out.some((l) => l.startsWith('Migrations finished')));
  } finally {
    await tree.cleanup();
  }
});

test('runMigrations: a sql failure stops before firestore runs', async () => {
  let firestoreCreated = false;
  const err = [];
  const code = await runMigrations({
    env: { DATABASE_URL: sqlUrl, ...emulatorEnv },
    out: () => {},
    err: (l) => err.push(l),
    createPool: () => ({
      query: async () => {
        throw Object.assign(new Error(`connect failed for ${sqlUrl}`), { code: 'ECONNREFUSED' });
      },
      end: async () => {},
    }),
    createFirestore: async () => ((firestoreCreated = true), new FakeFirestore()),
  });
  assert.equal(code, 1);
  assert.equal(firestoreCreated, false);
  assert.match(
    err[0],
    /^Migration stopped: \[sql\] the database could not be reached \(ECONNREFUSED\)/,
  );
  assert.ok(!err[0].includes(secret));
});

test('runMigrations: a malformed DATABASE_URL is refused without echoing it', async () => {
  const err = [];
  const code = await runMigrations({
    env: { DATABASE_URL: `mysql://x:${secret}@h/db` },
    out: () => {},
    err: (l) => err.push(l),
  });
  assert.equal(code, 1);
  assert.match(err[0], /must be a postgresql:\/\/ connection URL/);
  assert.ok(!err[0].includes(secret));
});

test('migrateFirestore: two concurrent runners apply each file exactly once', async () => {
  const tree = await tempTree({});
  try {
    globalThis.__m45Runs = 0;
    await writeFile(
      join(tree.firestore, '001_slow.mjs'),
      upFile(
        "globalThis.__m45Runs++; await new Promise((r) => setTimeout(r, 40)); await firestore.collection('data').doc('d').set({ n: globalThis.__m45Runs });",
      ),
    );
    const a = new FakeFirestore();
    const b = a.connect();
    const options = { directory: tree.firestore, pollMs: 5 };
    const [ra, rb] = await Promise.all([
      migrateFirestore(a, options),
      migrateFirestore(b, options),
    ]);
    assert.equal(globalThis.__m45Runs, 1);
    assert.equal(ra.applied.length + rb.applied.length, 1);
    assert.equal(ra.skipped.length + rb.skipped.length, 1);
    assert.deepEqual(a.paths('schema_migration_locks/'), []);
  } finally {
    delete globalThis.__m45Runs;
    await tree.cleanup();
  }
});

test('migrateFirestore: an expired lease is taken over, a live one makes the runner wait', async () => {
  const tree = await tempTree({});
  try {
    await writeFile(join(tree.firestore, '001_x.mjs'), upFile());
    const firestore = new FakeFirestore();
    let clock = 1000;
    firestore.write('schema_migration_locks/001_x.mjs', { owner: 'dead', expiresAt: 500 });
    const result = await migrateFirestore(firestore, {
      directory: tree.firestore,
      now: () => clock,
    });
    assert.deepEqual(result.applied, ['001_x.mjs']);
    // A live lease that never clears: the runner gives up after waitMs.
    await rm(join(tree.firestore, '001_x.mjs'));
    await writeFile(join(tree.firestore, '002_y.mjs'), upFile());
    firestore.write('schema_migration_locks/002_y.mjs', { owner: 'busy', expiresAt: 1e12 });
    await assert.rejects(
      migrateFirestore(firestore, {
        directory: tree.firestore,
        now: () => clock,
        sleep: async () => (clock += 1000),
        waitMs: 3000,
      }),
      /Migration 002_y\.mjs is locked by another runner/,
    );
    assert.deepEqual(firestore.paths('schema_migrations/'), ['schema_migrations/001_x.mjs']);
  } finally {
    await tree.cleanup();
  }
});

test('migrateFirestore: a file without up() fails and is not recorded', async () => {
  const tree = await tempTree({});
  try {
    await writeFile(join(tree.firestore, '001_nope.mjs'), 'export const x = 1;\n');
    const firestore = new FakeFirestore();
    await assert.rejects(
      migrateFirestore(firestore, { directory: tree.firestore }),
      /Migration 001_nope\.mjs failed: it does not export up\(\)/,
    );
    assert.deepEqual(firestore.paths('schema_migrations/'), []);
  } finally {
    await tree.cleanup();
  }
});

test('checkMigrationFiles: the repository files pass', () => {
  const { problems, counts } = checkMigrationFiles();
  assert.deepEqual(problems, []);
  assert.ok(counts.sql >= 4);
});

test('checkMigrationFiles: README and firestore/ are allowed; bad names and duplicates fail', async () => {
  const tree = await tempTree({
    '001_a.sql': '',
    '002_b.sql': '',
    'README.md': '',
  });
  try {
    await writeFile(join(tree.firestore, 'README.md'), '');
    await writeFile(join(tree.firestore, '001_x.mjs'), '');
    let result = checkMigrationFiles({
      sqlDirectory: tree.sql,
      firestoreDirectory: tree.firestore,
    });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.listing, [
      '[sql] 001_a.sql',
      '[sql] 002_b.sql',
      '[firestore] 001_x.mjs',
    ]);
    await writeFile(join(tree.sql, '5_add_x.sql'), '');
    await writeFile(join(tree.sql, '002_other.sql'), '');
    await writeFile(join(tree.firestore, '001_y.mjs'), '');
    await writeFile(join(tree.firestore, '002_Bad.mjs'), '');
    await writeFile(join(tree.firestore, '003_x.js'), '');
    result = checkMigrationFiles({ sqlDirectory: tree.sql, firestoreDirectory: tree.firestore });
    const text = result.problems.join('\n');
    assert.match(text, /\[sql\] 5_add_x\.sql does not match/);
    assert.match(text, /\[sql\] 002_other\.sql and 002_b\.sql share the number 002/);
    assert.match(text, /\[firestore\] 001_y\.mjs and 001_x\.mjs share the number 001/);
    assert.match(text, /\[firestore\] 002_Bad\.mjs does not match/);
    assert.match(text, /\[firestore\] 003_x\.js does not match/);
  } finally {
    await tree.cleanup();
  }
});

test('accountSettings accepts the Cloud SQL socket forms and TCP URLs, and hides the URL', () => {
  const base = { ...fsEnv, K_SERVICE: 'api' };
  for (const url of [
    socketUrl,
    `postgresql://app:${secret}@localhost/app?host=/cloudsql/proj:region:inst`,
    sqlUrl,
  ])
    assert.equal(accountSettings({ ...base, DATABASE_URL: url }).databaseUrl, url);
  assert.throws(
    () => accountSettings({ ...base, DATABASE_URL: `mysql://app:${secret}@h/app` }),
    (error) =>
      /must be a postgresql:\/\/ connection URL/.test(error.message) &&
      !error.message.includes(secret),
  );
  assert.throws(
    () => accountSettings({ ...base, DATABASE_URL: `not a url ${secret}` }),
    (e) => !e.message.includes(secret),
  );
});

test('local set-up also runs the Firestore migrations when Firestore is configured', async () => {
  const { runLocalSetup } = await import('../../server/local-setup.mjs');
  const { generatePassword } = await import('../../server/password-hashing.mjs');
  const { fastScrypt } = await import('./account-harness.mjs');
  const { hashPassword } = await import('../../server/password-hashing.mjs');
  const database = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'local-setup-fs-'));
  const lines = [];
  let created = 0;
  try {
    const code = await runLocalSetup({
      env: {
        DATABASE_URL: 'postgresql://u:p@postgres:5432/db',
        FIRESTORE_EMULATOR_HOST: 'firestore:8681',
        ...fsEnv,
        LOCAL_SETUP_DIR: directory,
      },
      createPool: () => database.pool,
      createFirestore: async () => (created++, new FakeFirestore()),
      hash: (password) => hashPassword(password, fastScrypt),
      generate: generatePassword,
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      sleep: async () => {},
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.equal(created, 1);
    // Every Firestore migration file runs on a fresh emulator (#47 added the first).
    const { firestoreMigrationFiles } = await import('../../server/firestore-migrations.mjs');
    const files = firestoreMigrationFiles().length;
    assert.ok(
      lines.includes(files ? `Firestore migrated (${files} applied).` : 'Firestore is up to date.'),
      lines.join('\n'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cloud Firestore is migrated only inside Cloud Run; outside it needs the emulator', async () => {
  const base = { DATABASE_URL: sqlUrl, ...fsEnv };
  // K_SERVICE and CLOUD_RUN_JOB both count as Cloud Run.
  for (const marker of [{ K_SERVICE: 'api' }, { CLOUD_RUN_JOB: 'migrate' }])
    assert.deepEqual(selectTargets({ ...base, ...marker, MIGRATION_TARGETS: 'sql,firestore' }), [
      'sql',
      'firestore',
    ]);
  // Neither, with the emulator.
  assert.deepEqual(
    selectTargets({
      ...base,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8681',
      MIGRATION_TARGETS: 'firestore',
    }),
    ['firestore'],
  );
  // Neither, without it: a listed firestore target is a preflight error.
  let touched = 0;
  const errors = [];
  const code = await runMigrations({
    env: { ...base, MIGRATION_TARGETS: 'sql,firestore' },
    out: () => {},
    err: (l) => errors.push(l),
    createPool: () => (touched++, null),
    createFirestore: () => (touched++, null),
  });
  assert.equal(code, 1);
  assert.equal(touched, 0);
  assert.match(errors[0], /FIRESTORE_EMULATOR_HOST/);
  // Unset targets: firestore is left out with one line; sql still runs.
  const notes = [];
  assert.deepEqual(selectTargets(base, notes), ['sql']);
  assert.deepEqual(notes, [
    'Firestore migrations skipped: FIRESTORE_EMULATOR_HOST is not set (outside Cloud Run only the emulator is migrated).',
  ]);
  const database = await createTestDatabase();
  const out = [];
  let firestoreCreated = false;
  const ok = await runMigrations({
    env: base,
    out: (l) => out.push(l),
    err: () => {},
    createPool: () => ({ ...database.pool, end: async () => {} }),
    createFirestore: async () => ((firestoreCreated = true), new FakeFirestore()),
  });
  assert.equal(ok, 0);
  assert.equal(firestoreCreated, false);
  assert.match(out[0], /^Firestore migrations skipped:/);
  assert.match(out.at(-1), /^Migrations finished: sql /);
  assert.ok(!out.at(-1).includes('firestore'));
  // Only firestore configured and not allowed: nothing to run, exit 1.
  assert.throws(() => selectTargets(fsEnv), /FIRESTORE_EMULATOR_HOST/);
});

test('local set-up skips Firestore migrations without the emulator host', async () => {
  const { runLocalSetup } = await import('../../server/local-setup.mjs');
  const database = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'local-setup-fs2-'));
  let created = 0;
  try {
    await runLocalSetup({
      // No emulator host: the guard refuses first, and Firestore is never created.
      env: {
        DATABASE_URL: 'postgresql://u:p@postgres:5432/db',
        ...fsEnv,
        LOCAL_SETUP_DIR: directory,
      },
      createPool: () => database.pool,
      createFirestore: async () => (created++, new FakeFirestore()),
      out: () => {},
      err: () => {},
    });
    assert.equal(created, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
