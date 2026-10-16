// DELETE /api/hr/employees/:id (issue #32): pg-mem, the in-memory Firestore
// fake and synthetic people only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp } from './account-harness.mjs';
import { ownerDocId } from '../../server/firestore-chat-memory.mjs';

const ask = (browser, conversationId, question, requestId = randomUUID()) =>
  browser.post('/api/chat', { question, taskId: 'quiz-part-1', conversationId, requestId });

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

// An employee with every kind of Firestore data: a profile, two chats with
// messages, checkpoints and support observations, feedback, support
// preferences and import drafts that mention the account.
async function employeeWithData(app, hr, password) {
  const { employee, browser } = await app.readyEmployee(hr, { password });
  const id = employee.account.id;
  const chats = [];
  for (const question of ['What should I wear?', 'Where is the dress code?']) {
    const chat = (await browser.post('/api/conversations')).body;
    const requestId = randomUUID();
    const answered = await ask(browser, chat.id, question, requestId);
    assert.equal(answered.status, 200, answered.text);
    const rated = await browser.post(`/api/conversations/${chat.id}/feedback`, {
      messageId: requestId + '-a',
      rating: 'unclear',
    });
    assert.equal(rated.status, 200);
    chats.push(chat.id);
  }
  return { id, browser, chats, owner: `account:${id}` };
}

// Synthetic employeeImports drafts in the shape issue #27 stores.
function writeImportDrafts(app, hrId, { target, duplicate, creator, other }) {
  const draft = (extra) => ({
    status: 'ready',
    createdBy: { accountId: hrId, username: 'HR-0001' },
    possibleDuplicates: [],
    targetEmployee: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...extra,
  });
  app.firestore.write(
    'employeeImports/draft-target',
    draft({ targetEmployee: { accountId: target, username: 'EMP-0001', fullName: 'Avery' } }),
  );
  app.firestore.write(
    'employeeImports/draft-duplicate',
    draft({
      possibleDuplicates: [
        { accountId: other, username: 'EMP-0002', fullName: 'Blake', status: 'active' },
        { accountId: duplicate, username: 'EMP-0001', fullName: 'Avery', status: 'active' },
      ],
    }),
  );
  app.firestore.write(
    'employeeImports/draft-creator',
    draft({ createdBy: { accountId: creator, username: 'EMP-0001' } }),
  );
  app.firestore.write(
    'employeeImports/draft-other',
    draft({
      targetEmployee: { accountId: other, username: 'EMP-0002', fullName: 'Blake' },
      possibleDuplicates: [{ accountId: other, username: 'EMP-0002' }],
    }),
  );
}

// Every Firestore path that belongs to this employee.
function firestoreDataOf(app, { id, owner, chats }) {
  return [
    ...app.firestore.paths(`employeeProfiles/${id}`),
    ...app.firestore.paths(`supportPreferences/${ownerDocId(owner)}`),
    ...chats.flatMap((chat) => [
      ...app.firestore.paths(`conversations/${chat}`),
      ...app.firestore.paths(`chatCheckpoints/${chat}/`),
    ]),
    ...app.firestore
      .paths('conversations/')
      .filter((path) => app.firestore.read(path)?.owner === owner),
  ];
}

test('deleting an employee removes every kind of personal data, then the account, and keeps the ID in the audit', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const gone = await employeeWithData(app, hr, 'employee-own-pass-1');
    const kept = await employeeWithData(app, hr, 'second-own-pass-1');
    writeImportDrafts(app, hrId, {
      target: gone.id,
      duplicate: gone.id,
      creator: gone.id,
      other: kept.id,
    });

    // Before: profile, chats, messages, checkpoints and preferences exist.
    const before = firestoreDataOf(app, gone);
    for (const prefix of [
      'employeeProfiles/',
      'supportPreferences/',
      'conversations/',
      'chatCheckpoints/',
    ])
      assert.ok(
        before.some((path) => path.startsWith(prefix)),
        `${prefix} has data before deletion`,
      );
    assert.ok(before.some((path) => /\/messages\/0001$/.test(path)));
    const keptBefore = firestoreDataOf(app, kept);

    const deleted = await hr.delete(`/api/hr/employees/${gone.id}`);
    assert.equal(deleted.status, 204, deleted.text);
    assert.equal(deleted.text, '');
    assert.equal(deleted.headers.get('cache-control'), 'no-store');

    // Firestore: nothing of this employee is left; the other employee is untouched.
    assert.deepEqual(firestoreDataOf(app, gone), []);
    assert.deepEqual(firestoreDataOf(app, kept), keptBefore);
    assert.deepEqual(app.firestore.paths('employeeImports/'), ['employeeImports/draft-other']);

    // PostgreSQL: the account and its sessions are gone; the audit keeps the ID.
    assert.deepEqual(await app.rows(`SELECT id FROM accounts WHERE id = '${gone.id}'`), []);
    assert.deepEqual(
      await app.rows(`SELECT token_hash FROM sessions WHERE account_id = '${gone.id}'`),
      [],
    );
    const audit = await app.rows(
      "SELECT actor_id, target_id, target_label FROM account_events WHERE action = 'employee_deleted'",
    );
    assert.deepEqual(audit, [{ actor_id: hrId, target_id: null, target_label: 'PC-0001' }]);
    // Earlier events about the account keep its ID too.
    const earlier = await app.rows(
      "SELECT action FROM account_events WHERE target_label = 'PC-0001' ORDER BY id",
    );
    assert.deepEqual(
      earlier.map((row) => row.action),
      ['employee_created', 'signed_in', 'password_changed', 'employee_deleted'],
    );
    assert.deepEqual(
      await app.rows(
        "SELECT count(*)::int AS n FROM account_events WHERE target_label = 'PC-0002'",
      ),
      [{ n: 0 }],
    );

    // The employee's browser is signed out; HR no longer lists the account.
    const after = await gone.browser.get('/api/conversations');
    assert.deepEqual([after.status, after.body.code], [401, 'SESSION_EXPIRED']);
    const listed = (await hr.get('/api/hr/employees')).body.employees;
    assert.deepEqual(
      listed.map((entry) => entry.account.username),
      ['PC-0002'],
    );
    const again = await hr.delete(`/api/hr/employees/${gone.id}`);
    assert.deepEqual([again.status, again.body.code], [404, 'EMPLOYEE_NOT_FOUND']);
    // The other employee still works.
    assert.equal((await kept.browser.get('/api/conversations')).body.conversations.length, 2);
    // The deleted ID is never handed out again: the next one is PC-0003.
    const next = await hr.post('/api/hr/employees', {
      profile: { job: { fullName: 'Casey Example', department: 'People & Culture' } },
    });
    assert.equal(next.status, 201);
    assert.equal(next.body.employee.account.username, 'PC-0003');
  });
});

test('a Firestore failure leaves the account in place and a retry finishes the deletion', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const gone = await employeeWithData(app, hr, 'employee-own-pass-1');

    // A batch commit fails part-way through the chat cleanup.
    app.firestore.fail(14, { only: ['commit'] });
    const failed = await hr.delete(`/api/hr/employees/${gone.id}`);
    assert.deepEqual(
      [failed.status, failed.body.code],
      [503, 'PROFILE_STORAGE_UNAVAILABLE'],
      failed.text,
    );
    assert.doesNotMatch(failed.text, /Injected|private|conversations\//);
    // The account and its profile are still there; nothing was recorded.
    assert.equal((await app.rows(`SELECT id FROM accounts WHERE id = '${gone.id}'`)).length, 1);
    assert.equal((await hr.get(`/api/hr/employees/${gone.id}`)).status, 200);
    assert.ok(app.firestore.read(`employeeProfiles/${gone.id}`));
    assert.deepEqual(
      await app.rows("SELECT id FROM account_events WHERE action = 'employee_deleted'"),
      [],
    );
    // The employee was signed out first, so no new data appears meanwhile.
    assert.equal((await gone.browser.get('/api/conversations')).status, 401);

    app.firestore.heal();
    const retried = await hr.delete(`/api/hr/employees/${gone.id}`);
    assert.equal(retried.status, 204, retried.text);
    assert.deepEqual(firestoreDataOf(app, gone), []);
    assert.deepEqual(await app.rows(`SELECT id FROM accounts WHERE id = '${gone.id}'`), []);
    assert.deepEqual(
      await app.rows("SELECT target_label FROM account_events WHERE action = 'employee_deleted'"),
      [{ target_label: 'PC-0001' }],
    );
  });
});

test('nothing is deleted while one of the employee’s answers is running', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const busy = await employeeWithData(app, hr, 'employee-own-pass-1');
    const path = `conversations/${busy.chats[0]}`;
    app.firestore.write(path, {
      ...app.firestore.read(path),
      turnToken: 'synthetic-lease',
      turnUntil: Date.now() + 60000,
    });
    const refused = await hr.delete(`/api/hr/employees/${busy.id}`);
    assert.deepEqual([refused.status, refused.body.code], [409, 'CHAT_BUSY']);
    assert.ok(app.firestore.read(path));
    assert.equal(app.firestore.read(path).deleting, undefined);
    assert.ok(app.firestore.read(`employeeProfiles/${busy.id}`));
    assert.equal((await app.rows(`SELECT id FROM accounts WHERE id = '${busy.id}'`)).length, 1);
    // Once the answer has finished, the deletion goes through.
    app.firestore.write(path, { ...app.firestore.read(path), turnToken: null, turnUntil: 0 });
    assert.equal((await hr.delete(`/api/hr/employees/${busy.id}`)).status, 204);
    assert.deepEqual(firestoreDataOf(app, busy), []);
  });
});

test('HR accounts and unknown IDs are 404, and only HR may delete', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const otherHr = await app.createHr('HR-0002', 'synthetic-hr-pass-2');
    const { employee, browser: staff } = await app.readyEmployee(hr);
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    for (const id of [hrId, otherHr.id, randomUUID(), 'not-a-uuid']) {
      const refused = await hr.delete(`/api/hr/employees/${id}`);
      assert.deepEqual([refused.status, refused.body.code], [404, 'EMPLOYEE_NOT_FOUND'], id);
    }
    assert.equal(
      (await app.rows("SELECT count(*)::int AS n FROM accounts WHERE role = 'hr'"))[0].n,
      2,
    );
    // HR's own session still works.
    assert.equal((await hr.get('/api/hr/employees')).status, 200);

    // An employee session, no session, or another site cannot delete.
    const asEmployee = await staff.delete(`/api/hr/employees/${employee.account.id}`);
    assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED']);
    const anonymous = await app.browser().delete(`/api/hr/employees/${employee.account.id}`);
    assert.deepEqual([anonymous.status, anonymous.body.code], [401, 'AUTH_REQUIRED']);
    const crossSite = await hr.delete(`/api/hr/employees/${employee.account.id}`, {
      Origin: 'https://attacker.example',
    });
    assert.deepEqual([crossSite.status, crossSite.body.code], [403, 'CROSS_ORIGIN_REJECTED']);
    assert.equal(
      (await app.rows(`SELECT id FROM accounts WHERE id = '${employee.account.id}'`)).length,
      1,
    );
    assert.ok(app.firestore.read(`employeeProfiles/${employee.account.id}`));
  });
});

test('a Firestore timeout is 504 PROFILE_STORAGE_TIMEOUT and also keeps the account', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee } = await app.createEmployee(hr);
    const id = employee.account.id;
    // The profile and draft cleanup commit never answers.
    app.firestore.fail(0, { only: ['commit'], hang: true });
    const slow = await hr.delete(`/api/hr/employees/${id}`);
    assert.deepEqual([slow.status, slow.body.code], [504, 'PROFILE_STORAGE_TIMEOUT']);
    assert.equal((await app.rows(`SELECT id FROM accounts WHERE id = '${id}'`)).length, 1);
    assert.ok(app.firestore.read(`employeeProfiles/${id}`));
    app.firestore.heal();
    assert.equal((await hr.delete(`/api/hr/employees/${id}`)).status, 204);
    assert.deepEqual(app.firestore.paths(`employeeProfiles/${id}`), []);
  });
});

test('an employee with no chats, profile or drafts is deleted cleanly (each step is a no-op)', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee } = await app.createEmployee(hr);
    const id = employee.account.id;
    await app.firestore.connect().collection('employeeProfiles').doc(id).delete();
    assert.deepEqual(app.firestore.paths('employeeImports/'), []);
    assert.equal((await hr.delete(`/api/hr/employees/${id}`)).status, 204);
    assert.deepEqual(app.firestore.paths(), []);
    assert.deepEqual(await app.rows(`SELECT id FROM accounts WHERE id = '${id}'`), []);
  });
});
