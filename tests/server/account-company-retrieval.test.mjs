// Account-owned chats also search HR's company Google Docs library and the
// Drive folder (issue #32); anonymous chats do not. Synthetic documents, fake
// Drive and fake Gemini models only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp, driveDenied, fakeRetrieve } from './account-harness.mjs';
import { createCompanyKnowledge } from '../../server/company-knowledge.mjs';
import { DriveKnowledgeError } from '../../server/google-drive-documents.mjs';

const handbook =
  'Dress Code\nStaff wear smart casual clothing from Monday to Thursday, and the synthetic team shirt on Friday.';
const parking =
  'Parking\nStaff park in the synthetic blue garage on level three, and visitors use the open lot by the gate.';
const docs = { 'handbook-doc-0001': handbook, 'parking-doc-0001': parking };
const loadGoogleDocument = async (id) => ({ text: docs[id] });
const ask = (browser, conversationId, question) =>
  browser.post('/api/chat', {
    question,
    taskId: 'quiz-part-1',
    ...(conversationId ? { conversationId, requestId: randomUUID() } : {}),
  });

async function withApp(options, check) {
  const app = await startAccountsApp({ loadGoogleDocument, ...options });
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
async function connectHandbook(hr) {
  const connected = await hr.post('/api/hr/company-knowledge/documents', {
    category: 'handbook',
    url: 'https://docs.google.com/document/d/handbook-doc-0001/edit',
  });
  assert.equal(connected.status, 201, connected.text);
}

test('document search: an employee’s answer quotes the connected Google Doc first; anonymous answers do not', async () => {
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
    await connectHandbook(hr);
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

    // An anonymous browser keeps the company search only.
    const anonymous = await ask(app.browser(), null, question);
    assert.equal(anonymous.status, 200);
    assert.deepEqual(
      anonymous.body.passages.map((p) => p.title),
      ['Synthetic handbook'],
    );
  });
});

test('gemini-chat: account chats retrieve the connected Doc alongside the company search', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    await connectHandbook(hr);
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
    // The anonymous browser's chat sees only the company search.
    const anonymous = app.browser();
    const own = (await anonymous.post('/api/conversations')).body;
    const plain = await ask(anonymous, own.id, 'What should I wear?');
    assert.deepEqual(
      plain.body.passages.map((p) => p.title),
      ['Synthetic handbook'],
    );
  });
});

test('the Drive folder feeds account answers; an empty folder adds nothing and a refused folder fails closed', async () => {
  const folder = [
    {
      googleDocId: 'parking-doc-0001',
      title: 'Parking guide',
      category: 'additional',
      text: parking,
    },
  ];
  let folderState = 'ready';
  const loadDriveKnowledge = async () => {
    if (folderState === 'empty')
      throw new DriveKnowledgeError('DRIVE_NO_DOCUMENTS', 'No Google Docs in the folder.');
    if (folderState === 'denied') throw driveDenied();
    return folder;
  };
  await withApp(
    {
      mode: 'document-search',
      env: { GOOGLE_DRIVE_FOLDER_ID: 'synthetic-folder' },
      loadDriveKnowledge,
    },
    async (app) => {
      const hr = await app.hrBrowser();
      // The same Doc also connected by HR is used once, under the folder's title.
      const connected = await hr.post('/api/hr/company-knowledge/documents', {
        category: 'additional',
        name: 'Parking',
        url: 'https://docs.google.com/document/d/parking-doc-0001/edit',
      });
      assert.equal(connected.status, 201);
      const { browser } = await app.readyEmployee(hr);
      const chat = (await browser.post('/api/conversations')).body;
      const found = await ask(browser, chat.id, 'Where do staff park?');
      assert.equal(found.status, 200, found.text);
      assert.deepEqual(
        found.body.passages.map((p) => p.title),
        ['Parking guide', 'Synthetic handbook'],
      );

      folderState = 'empty';
      const empty = await ask(browser, chat.id, 'Where do staff park?');
      assert.equal(empty.status, 200);
      assert.equal(empty.body.passages[0].title, 'Parking'); // HR's own connection

      folderState = 'denied';
      const before = (await browser.get(`/api/conversations/${chat.id}`)).body.messages.length;
      const refused = await ask(browser, chat.id, 'Where do staff park?');
      assert.deepEqual([refused.status, refused.body.code], [503, 'DRIVE_ACCESS_DENIED']);
      assert.equal(
        (await browser.get(`/api/conversations/${chat.id}`)).body.messages.length,
        before,
      );
      // Anonymous answers never read the folder.
      assert.equal((await ask(app.browser(), null, 'Where do staff park?')).status, 200);
    },
  );
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
