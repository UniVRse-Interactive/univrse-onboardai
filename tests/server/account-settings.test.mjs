import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/api-routes.mjs';
import {
  AccountsConfigError,
  accountSettings,
  describeAccounts,
} from '../../server/account-settings.mjs';
import { firestoreConfig } from '../../server/firestore-client.mjs';
import { describeChatStorage } from '../../server/chat-store.mjs';
import { accountEnv, startAccountsApp } from './account-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const secret = 'synthetic-db-secret';

test('accounts are off without DATABASE_URL and need Firestore settings when it is set', () => {
  assert.equal(accountSettings({}), null);
  assert.equal(accountSettings({ DATABASE_URL: '  ' }), null);
  assert.equal(describeAccounts({}), 'off (DATABASE_URL is not set)');
  const local = accountSettings(accountEnv);
  assert.deepEqual(local.firestore, { projectId: 'demo-test', databaseId: '(default)' });
  assert.equal(local.emulator, '127.0.0.1:1');
  assert.equal(
    describeAccounts(accountEnv),
    'on (PostgreSQL; profiles in the Firestore emulator at 127.0.0.1:1, project demo-test)',
  );
  // On Cloud Run the emulator is not required.
  const { FIRESTORE_EMULATOR_HOST, ...cloud } = accountEnv;
  assert.equal(accountSettings({ ...cloud, K_SERVICE: 'onboardai-api' }).emulator, null);
  const refused = [
    [{ ...accountEnv, FIRESTORE_DATABASE_ID: '' }, /FIRESTORE_DATABASE_ID is not set/],
    [{ ...accountEnv, FIRESTORE_EMULATOR_HOST: '' }, /FIRESTORE_EMULATOR_HOST is not set/],
    [cloud, /never reaches cloud Firestore/],
    [
      { ...accountEnv, FIRESTORE_PROJECT_ID: '' },
      /FIRESTORE_PROJECT_ID \(or GOOGLE_CLOUD_PROJECT\)/,
    ],
    [
      { ...accountEnv, DATABASE_URL: 'mysql://user:synthetic-db-secret@host/db' },
      /postgresql:\/\//,
    ],
    [{ ...accountEnv, DATABASE_URL: 'not a url synthetic-db-secret' }, /postgresql:\/\//],
  ];
  for (const [env, message] of refused) {
    assert.throws(
      () => accountSettings(env),
      (error) => {
        assert.ok(error instanceof AccountsConfigError);
        assert.match(error.message, message);
        assert.ok(!error.message.includes(secret), 'the database password is never shown');
        return true;
      },
    );
    assert.throws(() => createApp({ env }), AccountsConfigError);
  }
});

test('Firestore reads its project from FIRESTORE_PROJECT_ID, falling back to GOOGLE_CLOUD_PROJECT', () => {
  assert.equal(firestoreConfig({ GOOGLE_CLOUD_PROJECT: 'p' }), null);
  assert.deepEqual(
    firestoreConfig({ FIRESTORE_DATABASE_ID: '(default)', GOOGLE_CLOUD_PROJECT: 'vertex-project' }),
    { projectId: 'vertex-project', databaseId: '(default)' },
  );
  assert.deepEqual(
    firestoreConfig({
      FIRESTORE_DATABASE_ID: '(default)',
      GOOGLE_CLOUD_PROJECT: 'vertex-project',
      FIRESTORE_PROJECT_ID: ' demo-onboardai ',
    }),
    { projectId: 'demo-onboardai', databaseId: '(default)' },
  );
  assert.equal(
    describeChatStorage({ FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_PROJECT_ID: 'demo-x' }),
    'Firestore database (default) in demo-x',
  );
});

function run(script, { env = {}, input = '', args = [] } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'onboardai-accounts-'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, script), ...args], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

test('the servers refuse to start when accounts are on without the Firestore emulator', async () => {
  const { FIRESTORE_EMULATOR_HOST, ...env } = accountEnv;
  for (const script of ['server/api-service.mjs', 'server/index.mjs']) {
    const started = await run(script, { env: { ...env, PORT: '0', VOICE_WARMUP: 'false' } });
    assert.equal(started.code, 1, script);
    assert.match(
      started.stderr,
      /cannot start: Accounts are turned on because DATABASE_URL is set/,
    );
    assert.match(started.stderr, /FIRESTORE_EMULATOR_HOST is not set/);
    assert.ok(!started.stderr.includes(secret) && !started.stdout.includes(secret));
    assert.ok(!started.stdout.includes('ready'));
  }
});

for (const [command, script, failure] of [
  ['hr:create', 'scripts/create-hr-account.mjs', /could not be created/],
  ['hr:reset-password', 'scripts/reset-hr-password.mjs', /could not be reset/],
]) {
  test(`npm run ${command} refuses arguments, weak or mismatched passwords, and never prints them`, async () => {
    const env = {
      DATABASE_URL: 'postgresql://onboardai:synthetic-db-secret@127.0.0.1:1/onboardai',
    };
    const withArgument = await run(script, { env, args: ['HR-0001', 'typed-password-1'] });
    assert.equal(withArgument.code, 1);
    assert.match(withArgument.stderr, new RegExp(`npm run ${command} takes no arguments`));
    const cases = [
      ['HR-0001\nshort\nshort\n', /at least 8/],
      ['HR-00001\nhr-00001\nhr-00001\n', /same as the ID/],
      ['HR-0001\nsynthetic-pass-1\nsynthetic-pass-2\n', /do not match/],
      ['x\nsynthetic-pass-1\n', /3 to 32 letters/],
    ];
    for (const [input, message] of cases) {
      const result = await run(script, { env, input });
      assert.equal(result.code, 1, input);
      assert.match(result.stderr, message);
    }
    // Valid piped input reaches the database; here it is unreachable, which is
    // reported without the connection URL or the password.
    const unreachable = await run(script, { env, input: 'HR-0001\nsynthetic-pass-1\n' });
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.stderr, failure);
    const printed = unreachable.stdout + unreachable.stderr;
    assert.ok(!printed.includes('synthetic-pass-1') && !printed.includes(secret));
    const noUrl = await run(script, { input: 'HR-0001\nsynthetic-pass-1\n' });
    assert.match(noUrl.stderr, /Set DATABASE_URL/);
  });
}

test('npm run db:migrate explains an unreachable database without printing DATABASE_URL', async () => {
  const result = await run('scripts/migrate-database.mjs', {
    env: { DATABASE_URL: 'postgresql://onboardai:synthetic-db-secret@127.0.0.1:1/onboardai' },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /Migration stopped: \[sql\] the database could not be reached \(ECONNREFUSED\)/,
  );
  assert.ok(!(result.stdout + result.stderr).includes(secret));
  assert.match((await run('scripts/migrate-database.mjs')).stderr, /Set DATABASE_URL/);
});

test('without DATABASE_URL account routes are 503, and chat, conversations and voice need a sign-in nobody can make', async () => {
  for (const mode of ['document-search', 'gemini-chat']) {
    const app = await startAccountsApp({ mode, accounts: false });
    try {
      const browser = app.browser();
      browser.cookies.set('onboardai_account', 'a'.repeat(64));
      const config = await browser.get('/api/config');
      assert.equal(config.body.accounts, false);
      // Issue #55: no anonymous saved chats in any mode.
      assert.equal(config.body.conversationMemory, false);
      assert.notEqual(config.headers.get('cache-control'), 'no-store');
      for (const [method, path, body] of [
        ['post', '/api/auth/sign-in', { username: 'HR-0001', password: 'synthetic-hr-pass-1' }],
        ['get', '/api/auth/session'],
        ['post', '/api/auth/sign-out'],
        ['post', '/api/auth/password', { currentPassword: 'a', newPassword: 'b' }],
        ['get', '/api/me/profile'],
        ['get', '/api/me/onboarding'],
        ['get', '/api/hr/employees'],
        ['post', '/api/hr/employees', {}],
        ['put', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/status`, {}],
        ['delete', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`],
        ['get', '/api/hr/support-requests'],
        ['get', '/api/hr/company-knowledge'],
        ['post', '/api/hr/company-knowledge/documents', { category: 'it', url: 'x' }],
        ['delete', '/api/hr/company-knowledge/documents/x'],
      ]) {
        const response = await browser[method](path, body);
        assert.deepEqual(
          [response.status, response.body.code],
          [503, 'ACCOUNTS_NOT_CONFIGURED'],
          path,
        );
      }
      // The account cookie is not honoured without accounts, and there is no
      // anonymous fallback: 401 AUTH_REQUIRED, nothing answered or stored.
      for (const [method, path, body] of [
        ['get', '/api/conversations'],
        ['post', '/api/conversations'],
        [
          'post',
          '/api/chat',
          { question: 'How do I finish the onboarding quiz?', taskId: 'quiz-part-1' },
        ],
        ['post', '/api/voice', { text: 'Hello' }],
      ]) {
        const response = await browser[method](path, body);
        assert.deepEqual([response.status, response.body.code], [401, 'AUTH_REQUIRED'], path);
      }
      assert.ok(!browser.cookies.has('alya_session'));
      assert.deepEqual(app.firestore.paths('conversations/'), []);
      assert.equal((await app.rows('SELECT count(*)::int AS n FROM sessions'))[0].n, 0);
    } finally {
      await app.close();
    }
  }
});
