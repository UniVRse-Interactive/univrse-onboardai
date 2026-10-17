// Account-owned chats also search HR's uploaded company knowledge library
// (issues #32 and #35); signed-out browsers get no answer at all (issue #55).
// Synthetic documents and fake Gemini models only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp, fakeRetrieve } from './account-harness.mjs';
import { createCompanyKnowledge } from '../../server/company-knowledge.mjs';

const handbook =
  'Dress Code\nStaff wear smart casual clothing from Monday to Thursday, and the synthetic team shirt on Friday.';
const parking =
  'Parking\nStaff park in the synthetic blue garage on level three, and visitors use the open lot by the gate.';
const ask = (browser, conversationId, question) =>
  browser.post('/api/chat', {
    question,
    taskId: 'quiz-part-1',
    ...(conversationId ? { conversationId, requestId: randomUUID() } : {}),
  });

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
async function uploadHandbook(hr) {
  const connected = await hr.upload(
    '/api/hr/company-knowledge/documents?category=policies',
    Buffer.from(handbook),
    'Employee Handbook.txt',
  );
  assert.equal(connected.status, 201, connected.text);
}

test('document search: an employee’s answer quotes the uploaded handbook first; signed-out browsers get nothing', async () => {
  await withApp({ mode: 'document-search' }, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const question = 'What is the dress code?';

    const before = await ask(browser, chat.id, question);
    assert.deepEqual(
      before.body.passages.map((p) => p.title),
      ['Synthetic handbook'],
    );
    await uploadHandbook(hr);
    const after = await ask(browser, chat.id, question);
    assert.equal(after.status, 200, after.text);
    assert.equal(after.body.matched, true);
    assert.deepEqual(
      after.body.passages.map((p) => p.title),
      ['Employee Handbook', 'Synthetic handbook'],
    );
    assert.match(after.body.passages[0].preview, /smart casual clothing/);
    assert.match(after.body.answer, /Source: Employee Handbook — Dress Code/);
    assert.equal(after.body.source, 'Company documents: Employee Handbook, Synthetic handbook');
    // The saved turn holds the same answer.
    const saved = (await browser.get(`/api/conversations/${chat.id}`)).body.messages;
    assert.equal(saved.at(-1).text, after.body.answer);

    // A signed-out browser is refused and reads nothing.
    const signedOut = await ask(app.browser(), null, question);
    assert.deepEqual([signedOut.status, signedOut.body.code], [401, 'AUTH_REQUIRED']);
    assert.equal(signedOut.body.passages, undefined);
  });
});

test('gemini-chat: account chats retrieve the uploaded handbook alongside the company search', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    await uploadHandbook(hr);
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const answered = await ask(browser, chat.id, 'What should I wear?');
    assert.equal(answered.status, 200, answered.text);
    assert.equal(answered.body.mode, 'gemini-memory');
    // The fake model cites passage 1, which is the library's best match.
    assert.deepEqual(
      answered.body.passages.map((p) => [p.id, p.title, p.heading]),
      [[1, 'Employee Handbook', 'Dress Code']],
    );
    // A signed-out browser cannot open a chat or ask.
    const signedOut = app.browser();
    assert.equal((await signedOut.post('/api/conversations')).status, 401);
    const refused = await ask(signedOut, chat.id, 'What should I wear?');
    assert.deepEqual([refused.status, refused.body.code], [401, 'AUTH_REQUIRED']);
  });
});

test('an uploaded additional guide is found by its text, and a deleted one is gone', async () => {
  await withApp({ mode: 'document-search' }, async (app) => {
    const hr = await app.hrBrowser();
    const up = await hr.upload(
      '/api/hr/company-knowledge/documents?category=additional&name=Parking',
      Buffer.from(parking),
      'parking.md',
    );
    assert.equal(up.status, 201, up.text);
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const found = await ask(browser, chat.id, 'Where do staff park?');
    assert.equal(found.status, 200, found.text);
    assert.equal(found.body.passages[0].title, 'Parking');
    assert.match(found.body.passages[0].preview, /blue garage/);
    // Signed-out browsers never read the library.
    const signedOut = await ask(app.browser(), null, 'Where do staff park?');
    assert.deepEqual([signedOut.status, signedOut.body.passages], [401, undefined]);
    assert.equal(
      (await hr.delete(`/api/hr/company-knowledge/documents/${up.body.id}`)).status,
      204,
    );
    const gone = await ask(browser, chat.id, 'Where do staff park?');
    assert.ok(gone.body.passages.every((p) => p.title !== 'Parking'));
  });
});

test('without connected documents the company search results pass through unchanged', async () => {
  const company = await fakeRetrieve('dress code');
  const knowledge = createCompanyKnowledge({
    documents: { list: async () => [] },
    companyRetrieve: async () => company,
  });
  assert.equal(await knowledge.retrieve('dress code'), company);
  assert.equal(await knowledge.quote('dress code'), company);
  // With documents, the library leads and the two sources alternate.
  const withDocs = createCompanyKnowledge({
    documents: { list: async () => [{ title: 'Employee Handbook', text: handbook }] },
    companyRetrieve: async () => [...company, { title: 'Second', heading: '', text: 'Other' }],
  });
  assert.deepEqual(
    (await withDocs.retrieve('dress code')).map((p) => p.title),
    ['Employee Handbook', 'Synthetic handbook', 'Second'],
  );
});
