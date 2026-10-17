// Account-owned chats exclusively query Vertex AI Search (`companyRetrieve`)
// at runtime and never search or fall back to in-memory Firestore
// `companyDocuments`; signed-out browsers get no answer at all (issue #55).
// Synthetic documents and fake Gemini models only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp, fakeRetrieve } from './account-harness.mjs';
import { createCompanyKnowledge } from '../../server/company-knowledge.mjs';
import { createVertexDocumentSync, gcsObjectName } from '../../server/company-documents.mjs';

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

test('document search: an employee’s answer always queries Vertex AI Search (companyRetrieve) and never in-memory Firestore companyDocuments; signed-out browsers get nothing', async () => {
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
      ['Synthetic handbook'],
    );
    assert.equal(after.body.source, 'Company documents: Synthetic handbook');
    // The saved turn holds the same answer.
    const saved = (await browser.get(`/api/conversations/${chat.id}`)).body.messages;
    assert.equal(saved.at(-1).text, after.body.answer);

    // A signed-out browser is refused and reads nothing.
    const signedOut = await ask(app.browser(), null, question);
    assert.deepEqual([signedOut.status, signedOut.body.code], [401, 'AUTH_REQUIRED']);
    assert.equal(signedOut.body.passages, undefined);
  });
});

test('gemini-chat: account chats retrieve exclusively from companyRetrieve (Vertex AI Search) even when HR documents exist in Firestore', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    await uploadHandbook(hr);
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const answered = await ask(browser, chat.id, 'What should I wear?');
    assert.equal(answered.status, 200, answered.text);
    assert.equal(answered.body.mode, 'gemini-memory');
    assert.deepEqual(
      answered.body.passages.map((p) => [p.id, p.title, p.heading]),
      [[1, 'Synthetic handbook', 'Dress']],
    );
    // A signed-out browser cannot open a chat or ask.
    const signedOut = app.browser();
    assert.equal((await signedOut.post('/api/conversations')).status, 401);
    const refused = await ask(signedOut, chat.id, 'What should I wear?');
    assert.deepEqual([refused.status, refused.body.code], [401, 'AUTH_REQUIRED']);
  });
});

test('Firestore companyDocuments remains strictly for HR UI management while runtime search queries companyRetrieve', async () => {
  await withApp({ mode: 'document-search' }, async (app) => {
    const hr = await app.hrBrowser();
    const up = await hr.upload(
      '/api/hr/company-knowledge/documents?category=additional&name=Parking',
      Buffer.from(parking),
      'parking.md',
    );
    assert.equal(up.status, 201, up.text);
    const listed = await hr.get('/api/hr/company-knowledge');
    assert.deepEqual(
      listed.body.documents.map((d) => d.title),
      ['Parking'],
    );
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const found = await ask(browser, chat.id, 'Where do staff park?');
    assert.equal(found.status, 200, found.text);
    assert.deepEqual(
      found.body.passages.map((p) => p.title),
      ['Synthetic handbook'],
    );
    assert.equal(
      (await hr.delete(`/api/hr/company-knowledge/documents/${up.body.id}`)).status,
      204,
    );
  });
});

test('retrieve() and quote() always and only query companyRetrieve without calling documents.list()', async () => {
  const company = await fakeRetrieve('dress code');
  let documentsListCalled = false;
  const withDocs = createCompanyKnowledge({
    documents: {
      list: async () => {
        documentsListCalled = true;
        return [{ title: 'Employee Handbook', text: handbook }];
      },
    },
    companyRetrieve: async () => company,
  });
  assert.equal(await withDocs.retrieve('dress code'), company);
  assert.equal(await withDocs.quote('What is the dress code?'), company);
  assert.equal(documentsListCalled, false);
});

test('createVertexDocumentSync uploads to GCS + triggers documents:import and deletes from GCS + documents.delete', async () => {
  const calls = [];
  const docId = '11111111-2222-3333-4444-555555555555';
  assert.equal(gcsObjectName(docId, 'Handbook.pdf'), `${docId}/Handbook.pdf`);
  assert.equal(gcsObjectName(docId, 'Notes.md'), `${docId}/Notes.txt`);

  const sync = createVertexDocumentSync({
    env: {
      GOOGLE_CLOUD_PROJECT: 'test-proj',
      DOCS_BUCKET: 'test-proj-onboardai-docs',
      VERTEX_SEARCH_DATA_STORE_ID: 'onboardai-docs',
    },
    getAccessToken: async () => 'fake-token',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body });
      if ((init.method || 'GET') === 'GET' && url.includes('/documents?pageSize=1000')) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                id: 'hashed-doc-id',
                content: { uri: `gs://test-proj-onboardai-docs/${docId}/Notes.txt` },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await sync.uploadDocument({
    id: docId,
    fileName: 'Notes.md',
    text: '# Welcome\nHello Lumora',
    content: Buffer.from('# Welcome\nHello Lumora'),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.match(
    calls[0].url,
    /storage\.googleapis\.com\/upload\/storage\/v1\/b\/test-proj-onboardai-docs\/o/,
  );
  assert.equal(calls[1].method, 'POST');
  assert.match(
    calls[1].url,
    /dataStores\/onboardai-docs\/branches\/default_branch\/documents:import$/,
  );
  assert.deepEqual(JSON.parse(calls[1].body), {
    gcsSource: {
      inputUris: [`gs://test-proj-onboardai-docs/${docId}/Notes.txt`],
      dataSchema: 'content',
    },
    reconciliationMode: 'INCREMENTAL',
  });

  calls.length = 0;
  await sync.deleteDocument({ id: docId, fileName: 'Notes.md' });
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      [
        'DELETE',
        `https://storage.googleapis.com/storage/v1/b/test-proj-onboardai-docs/o/${encodeURIComponent(`${docId}/Notes.txt`)}`,
      ],
      [
        'DELETE',
        `https://discoveryengine.googleapis.com/v1/projects/test-proj/locations/global/collections/default_collection/dataStores/onboardai-docs/branches/default_branch/documents/${docId}`,
      ],
      [
        'GET',
        'https://discoveryengine.googleapis.com/v1/projects/test-proj/locations/global/collections/default_collection/dataStores/onboardai-docs/branches/default_branch/documents?pageSize=1000',
      ],
      [
        'DELETE',
        'https://discoveryengine.googleapis.com/v1/projects/test-proj/locations/global/collections/default_collection/dataStores/onboardai-docs/branches/default_branch/documents/hashed-doc-id',
      ],
    ],
  );
});
