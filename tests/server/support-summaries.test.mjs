// GET /api/hr/support-summaries (issue #32): pg-mem, the in-memory Firestore
// fake and synthetic people only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp, syntheticProfile } from './account-harness.mjs';

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

test('summaries name each employee account and carry the chat store’s support summary, with no transcripts', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    // Preferred name set (the harness profile has preferredName "Avery").
    const { employee: avery, browser } = await app.readyEmployee(hr, {
      profile: syntheticProfile('Avery Example', 'Sales & Marketing'),
    });
    // Preferred name empty: the full name is used.
    const blank = syntheticProfile('Blake Sample', 'Customer Success');
    blank.job.preferredName = '';
    const blake = await hr.post('/api/hr/employees', { profile: blank });
    assert.equal(blake.status, 201);
    // No profile at all: the ID is used.
    const casey = (await app.createEmployee(hr, syntheticProfile('Casey Example', 'Finance')))
      .employee;
    await app.firestore.connect().collection('employeeProfiles').doc(casey.account.id).delete();

    const before = await hr.get('/api/hr/support-summaries');
    assert.equal(before.status, 200);
    assert.equal(before.headers.get('cache-control'), 'no-store');
    const listed = (await hr.get('/api/hr/employees')).body.employees;
    // Sorted like /api/hr/employees (by ID, ignoring case), with the same accounts.
    assert.deepEqual(
      before.body.employees.map((entry) => entry.account),
      listed.map((entry) => entry.account),
    );
    assert.deepEqual(
      before.body.employees.map((entry) => [entry.account.username, entry.name]),
      [
        ['CS-0001', 'Blake Sample'],
        ['FN-0001', 'FN-0001'],
        ['SM-0001', 'Avery'],
      ],
    );
    for (const entry of before.body.employees) {
      assert.deepEqual(Object.keys(entry), ['account', 'name', 'summary']);
      assert.equal(entry.summary.turns, 0);
      assert.equal(entry.summary.recording, true);
    }

    // Avery chats, rates an answer and asks for human help.
    const question = 'What should I wear on my first day?';
    const chat = (await browser.post('/api/conversations')).body;
    const requestId = randomUUID();
    const answered = await ask(browser, chat.id, question, requestId);
    assert.equal(answered.status, 200, answered.text);
    await ask(browser, chat.id, 'Explain that in smaller steps please');
    await browser.post(`/api/conversations/${chat.id}/feedback`, {
      messageId: requestId + '-a',
      rating: 'helpful',
    });
    await browser.post(`/api/conversations/${chat.id}/human-help`, {
      messageId: requestId + '-a',
    });

    const after = await hr.get('/api/hr/support-summaries');
    const entry = after.body.employees.find((e) => e.account.id === avery.account.id);
    assert.equal(entry.summary.turns, 2);
    assert.equal(entry.summary.conversations, 1);
    assert.deepEqual(entry.summary.feedback, { helpful: 1, unclear: 0 });
    assert.equal(entry.summary.humanHelpRequests, 1);
    // The chat store's supportSummary for the account owner, the value the
    // guest workspace gives in guests[].summary, with only its scope text replaced.
    const stored = await app.memory.supportSummary(`account:${avery.account.id}`);
    assert.equal(stored.scope, 'This browser’s saved conversations');
    assert.deepEqual(entry.summary, { ...stored, scope: 'This employee’s saved conversations' });
    assert.ok(
      after.body.employees.every((e) => e.summary.scope === 'This employee’s saved conversations'),
    );
    // Aggregates only: no question, answer, passage or document text.
    for (const text of [
      question,
      'smaller steps please',
      answered.body.answer,
      'Business casual clothing.',
      'Synthetic handbook',
      chat.id,
    ])
      assert.ok(!after.text.includes(text), `the payload must not contain "${text}"`);
    assert.ok(!/"messages"|"text"|"passages"/.test(after.text));
  });
});

test('the employee’s recording choice is respected and the route is for HR only', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    await ask(browser, chat.id, 'What should I wear?');
    const paused = await browser.post('/api/support-summary/settings', { recording: false });
    assert.equal(paused.status, 200);
    await ask(browser, chat.id, 'And on Fridays?');
    const [entry] = (await hr.get('/api/hr/support-summaries')).body.employees;
    assert.equal(entry.account.id, employee.account.id);
    assert.equal(entry.summary.recording, false);
    assert.equal(entry.summary.turns, 1); // the second answer was not recorded

    const asEmployee = await browser.get('/api/hr/support-summaries');
    assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED']);
    const anonymous = await app.browser().get('/api/hr/support-summaries');
    assert.deepEqual([anonymous.status, anonymous.body.code], [401, 'AUTH_REQUIRED']);

    // A chat-store failure is the HR routes' Firestore error.
    app.firestore.fail(14, { only: ['query'] });
    const failed = await hr.get('/api/hr/support-summaries');
    assert.deepEqual([failed.status, failed.body.code], [503, 'PROFILE_STORAGE_UNAVAILABLE']);
  });
});

test('with no employee accounts the list is empty', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const empty = await hr.get('/api/hr/support-summaries');
    assert.deepEqual([empty.status, empty.body], [200, { employees: [] }]);
  });
});
