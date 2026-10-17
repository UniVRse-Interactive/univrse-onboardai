// The retrieval allowlist end to end (issue #79): with Vertex AI Search on,
// account chats and document search use only passages of active
// companyDocuments entries, ask the search for 10 results, carry each
// passage's upload date, and never show a gs:// URI or the bucket name. A
// delete or replace on this instance takes effect in the next answer; a
// library failure fails closed. Fake Google (search and sync), fake Gemini,
// the in-memory Firestore fake and synthetic documents only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AIMessage } from '@langchain/core/messages';
import { startAccountsApp } from './account-harness.mjs';
import { createApp } from '../../server/api-routes.mjs';
import { createConversationService } from '../../server/gemini-chat-workflow.mjs';
import {
  checkKnowledgeConfig,
  KnowledgeConfigError,
} from '../../server/company-document-retriever.mjs';
import { signedInFetch, stubAccounts } from './signed-in.mjs';
import { chunkResult, summary, syntheticLibrary } from './active-documents-fixtures.mjs';
import { companyDocumentUri, vertexDocumentId } from '../../server/discovery-engine-documents.mjs';

const bucket = 'demo-allowlist-bucket';
const vertexEnv = {
  GOOGLE_CLOUD_PROJECT: 'demo-allowlist',
  VERTEX_SEARCH_ENGINE_ID: 'demo-allowlist-engine',
  DOCS_BUCKET: bucket,
  VERTEX_SEARCH_DATA_STORE_ID: 'demo-allowlist-store',
  ONBOARDAI_ENVIRONMENT: 'staging',
};
const path = '/api/hr/company-knowledge/documents';
const leaveText = 'Synthetic leave guidance: staff book leave two weeks ahead.';
const orphanRoot = `gs://${bucket}/UniVRse - Employee Handbook.pdf`;
const orphanUuid = `gs://${bucket}/056e3b6c-0000-4000-8000-000000000000/03 Business Conduct Policy.docx`;
const uriOf = (id, fileName) => companyDocumentUri({ bucket, id, fileName });

// Google for the app: the sync (GCS upload/delete, import, document delete)
// answers ok; each search answers with `results()` and is recorded.
function fakeGoogle() {
  const google = {
    searches: [],
    results: () => [],
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith(':search')) {
        google.searches.push(JSON.parse(init.body));
        return Response.json({ results: google.results() });
      }
      return Response.json({});
    },
  };
  return google;
}
// Gemini stand-ins: a company plan, and an answer citing passage 1. Every
// answer SystemMessage is kept.
function recordingModels(prompts) {
  return () => ({
    plan: {
      invoke: async () => ({
        kind: 'company',
        query: 'leave booking',
        clarification: '',
        category: 'onboarding',
        topic: 'leave',
      }),
    },
    answer: {
      invoke: async (messages) => {
        prompts.push(messages[0].content);
        return {
          answer: 'Book leave two weeks ahead.',
          citations: [1],
          coverage: 'full',
        };
      },
    },
    summarize: { invoke: async () => new AIMessage('Earlier questions.') },
  });
}
const ask = (browser, conversationId, question = 'How do I book leave?') =>
  browser.post('/api/chat', {
    question,
    taskId: 'quiz-part-1',
    conversationId,
    requestId: randomUUID(),
  });
// The onboardai_active_documents lines written to stdout during `run`.
async function activeLines(t, run) {
  const lines = [];
  t.mock.method(console, 'log', (text) => {
    try {
      const entry = JSON.parse(text);
      if (entry.event === 'onboardai_active_documents') lines.push(entry);
    } catch {
      // Not a JSON line.
    }
  });
  await run();
  return lines;
}

test('gemini-chat: only active documents reach Gemini and the answer, with their upload dates; a delete leaves chat at once', async (t) => {
  const google = fakeGoogle();
  const prompts = [];
  const app = await startAccountsApp({
    mode: 'gemini-chat',
    env: vertexEnv,
    companyRetrieve: null,
    fetchImpl: google.fetchImpl,
    models: recordingModels(prompts),
  });
  try {
    const hr = await app.hrBrowser();
    const up = await hr.upload(
      `${path}?category=policies`,
      Buffer.from(leaveText),
      'Leave Guide.txt',
    );
    assert.equal(up.status, 201, up.text);
    const id = up.body.id;
    const listed = (await hr.get('/api/hr/company-knowledge')).body.documents;
    const uploadedDay = listed[0].connectedAt.slice(0, 10);
    assert.match(uploadedDay, /^\d{4}-\d{2}-\d{2}$/);
    const uri = uriOf(id, 'Leave Guide.txt');
    google.results = () => [
      chunkResult({ uri: orphanRoot, content: 'Orphan handbook text.', chunkId: 'o1' }),
      chunkResult({ uri: orphanUuid, content: 'Orphan conduct text.', chunkId: 'o2' }),
      chunkResult({ uri, content: leaveText, chunkId: 'c1' }),
      // A chunk known only by its data store document ID.
      chunkResult({
        vertexId: vertexDocumentId(uri),
        content: 'Leave is approved by your manager.',
        chunkId: 'c2',
      }),
    ];
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;

    let answered;
    const lines = await activeLines(t, async () => {
      answered = await ask(browser, chat.id);
    });
    assert.equal(answered.status, 200, answered.text);
    assert.deepEqual(
      answered.body.passages.map((p) => [p.id, p.title, p.date, p.dateKind]),
      [[1, 'Leave Guide.txt', uploadedDay, 'uploaded']],
    );
    assert.equal(answered.body.source, 'Leave Guide.txt');
    assert.equal('guardrail' in answered.body, false);
    // Gemini saw the two admitted passages, numbered in rank order, with dates.
    // (the Dates instruction follows the passages on its own line)
    const passagesJson = prompts[0]
      .slice(prompts[0].indexOf('Reference passages: ') + 20)
      .split('\n')[0];
    assert.deepEqual(
      JSON.parse(passagesJson).map((p) => [p.id, p.text, p.date, p.dateKind]),
      [
        [1, leaveText, uploadedDay, 'uploaded'],
        [2, 'Leave is approved by your manager.', uploadedDay, 'uploaded'],
      ],
    );
    assert.ok(!prompts[0].includes('Orphan'));
    // The allowlisted search asks for 10 results.
    assert.equal(google.searches.length, 1);
    assert.equal(google.searches[0].pageSize, 10);
    assert.equal(google.searches[0].query, 'leave booking');
    assert.deepEqual(lines, [
      {
        severity: 'INFO',
        event: 'onboardai_active_documents',
        environment: 'staging',
        result: 'dropped',
        dropped: 2,
      },
    ]);
    // Neither the answer nor the saved chat shows a gs:// URI or the bucket.
    const saved = await browser.get(`/api/conversations/${chat.id}`);
    for (const body of [answered.text, saved.text]) {
      assert.ok(!body.includes('gs://'));
      assert.ok(!body.includes(bucket));
    }
    const message = saved.body.messages.at(-1);
    assert.deepEqual(
      message.result.passages.map((p) => [p.title, p.date, p.dateKind]),
      [['Leave Guide.txt', uploadedDay, 'uploaded']],
    );
    assert.equal('guardrail' in message, false);

    // HR deletes the document: the next answer on this instance no longer has it.
    assert.equal((await hr.delete(`${path}/${id}`)).status, 204);
    const after = await ask(browser, chat.id);
    assert.equal(after.status, 200, after.text);
    assert.deepEqual(after.body.passages, []);
    assert.equal(after.body.coverage, 'none');
    assert.match(after.body.answer, /couldn’t find that information/);
    assert.equal(prompts.length, 1, 'no answer call without passages');
  } finally {
    await app.close();
  }
});

test('a replaced version leaves chat at once: only the new version is admitted', async () => {
  const google = fakeGoogle();
  const prompts = [];
  const app = await startAccountsApp({
    mode: 'gemini-chat',
    env: vertexEnv,
    companyRetrieve: null,
    fetchImpl: google.fetchImpl,
    models: recordingModels(prompts),
  });
  try {
    const hr = await app.hrBrowser();
    const v1 = await hr.upload(
      `${path}?category=policies`,
      Buffer.from('Synthetic badges are collected on level 9.'),
      'Badge Guide.txt',
    );
    assert.equal(v1.status, 201, v1.text);
    const oldUri = uriOf(v1.body.id, 'Badge Guide.txt');
    let newUri = null;
    google.results = () => [
      chunkResult({
        uri: oldUri,
        content: 'Synthetic badges are collected on level 9.',
        chunkId: 'v1',
      }),
      ...(newUri
        ? [
            chunkResult({
              uri: newUri,
              content: 'Synthetic badges are collected on level 4.',
              chunkId: 'v2',
            }),
          ]
        : []),
    ];
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const before = await ask(browser, chat.id, 'Where do I collect my badge?');
    assert.equal(before.status, 200, before.text);
    assert.match(prompts.at(-1), /level 9/);

    const v2 = await hr.upload(
      `${path}?category=policies&replaces=${v1.body.id}`,
      Buffer.from('Synthetic badges are collected on level 4.'),
      'Badge Guide v2.txt',
    );
    assert.equal(v2.status, 201, v2.text);
    newUri = uriOf(v2.body.id, 'Badge Guide v2.txt');
    const after = await ask(browser, chat.id, 'Where do I collect my badge?');
    assert.equal(after.status, 200, after.text);
    assert.match(prompts.at(-1), /level 4/);
    assert.doesNotMatch(prompts.at(-1), /level 9/);
    assert.deepEqual(
      after.body.passages.map((p) => p.title),
      ['Badge Guide v2.txt'],
    );
  } finally {
    await app.close();
  }
});

test('document search goes through the same allowlist and page size', async () => {
  const google = fakeGoogle();
  const app = await startAccountsApp({
    mode: 'document-search',
    env: vertexEnv,
    companyRetrieve: null,
    fetchImpl: google.fetchImpl,
  });
  try {
    const hr = await app.hrBrowser();
    const up = await hr.upload(
      `${path}?category=policies`,
      Buffer.from(leaveText),
      'Leave Guide.txt',
    );
    assert.equal(up.status, 201, up.text);
    google.results = () => [
      chunkResult({ uri: orphanRoot, content: 'Orphan handbook text.', chunkId: 'o1' }),
      chunkResult({ uri: uriOf(up.body.id, 'Leave Guide.txt'), content: leaveText, chunkId: 'c1' }),
    ];
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const found = await ask(browser, chat.id);
    assert.equal(found.status, 200, found.text);
    assert.equal(found.body.matched, true);
    assert.deepEqual(
      found.body.passages.map((p) => p.title),
      ['Leave Guide.txt'],
    );
    assert.equal(found.body.source, 'Company documents: Leave Guide.txt');
    assert.ok(!found.text.includes('gs://') && !found.text.includes(bucket));
    assert.ok(!found.text.includes('Orphan'));
    assert.equal(google.searches[0].pageSize, 10);
  } finally {
    await app.close();
  }
});

test('a library failure with no snapshot fails the chat closed with 503 COMPANY_KNOWLEDGE_UNAVAILABLE', async (t) => {
  const google = fakeGoogle();
  const prompts = [];
  const app = await startAccountsApp({
    mode: 'gemini-chat',
    env: vertexEnv,
    companyRetrieve: null,
    fetchImpl: google.fetchImpl,
    models: recordingModels(prompts),
  });
  try {
    const hr = await app.hrBrowser();
    const up = await hr.upload(
      `${path}?category=policies`,
      Buffer.from(leaveText),
      'Leave Guide.txt',
    );
    assert.equal(up.status, 201, up.text);
    google.results = () => [
      chunkResult({ uri: uriOf(up.body.id, 'Leave Guide.txt'), content: leaveText }),
    ];
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    // Every companyDocuments query fails from now on (the upload invalidated
    // the cache, so there is no snapshot to fall back on).
    app.firestore.fail(14, { times: 5, only: ['query'], match: /^companyDocuments$/ });
    let failed;
    const lines = await activeLines(t, async () => {
      failed = await ask(browser, chat.id);
    });
    assert.equal(failed.status, 503, failed.text);
    assert.equal(failed.body.code, 'COMPANY_KNOWLEDGE_UNAVAILABLE');
    assert.equal(failed.body.answer, undefined);
    assert.equal(prompts.length, 0);
    assert.deepEqual(lines, [
      {
        severity: 'WARNING',
        event: 'onboardai_active_documents',
        environment: 'staging',
        result: 'unavailable',
      },
    ]);
    app.firestore.heal();
    const recovered = await ask(browser, chat.id);
    assert.equal(recovered.status, 200, recovered.text);
    assert.equal(recovered.body.passages.length, 1);
  } finally {
    await app.close();
  }
});

test('the sample guide is unchanged: no allowlist, no library read, passages without dates', async () => {
  const prompts = [];
  const app = await startAccountsApp({ mode: 'gemini-chat', models: recordingModels(prompts) });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    // Any companyDocuments query would fail the turn: none is made.
    app.firestore.fail(14, { times: 99, only: ['query'], match: /^companyDocuments$/ });
    const answered = await ask(browser, chat.id);
    assert.equal(answered.status, 200, answered.text);
    assert.deepEqual(answered.body.passages, [
      {
        id: 1,
        title: 'Synthetic handbook',
        heading: 'Dress',
        text: 'Business casual clothing.',
        date: null,
        dateKind: null,
      },
    ]);
    assert.match(prompts[0], /"date":null,"dateKind":null/);
  } finally {
    await app.close();
  }
});

// createApp straight, with the stand-in accounts and no Firestore library.
async function withServer(options, check) {
  const app = createApp({
    getAccessToken: async () => 'synthetic-token',
    accountService: stubAccounts(),
    conversationService: null,
    ...options,
    env: { CHAT_DATABASE_PATH: ':memory:', ...options.env },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.closeChat();
  }
}
const signedIn = signedInFetch();
async function quote(url) {
  const chat = await (await signedIn(url + '/api/conversations', { method: 'POST' })).json();
  const response = await signedIn(url + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'How do I book leave?',
      taskId: 'quiz-part-1',
      conversationId: chat.id,
      requestId: randomUUID(),
    }),
  });
  return { status: response.status, body: await response.json() };
}

test('Vertex AI Search without a company library or without DOCS_BUCKET withholds every passage', async (t) => {
  const id = '66666666-6666-4666-8666-666666666666';
  const searched = [];
  const fetchImpl = async (url, init) => {
    searched.push(JSON.parse(init.body));
    return Response.json({
      results: [chunkResult({ uri: uriOf(id, 'Leave Guide.txt'), content: leaveText })],
    });
  };
  // No library at all: nothing is searched or quoted.
  await withServer(
    { env: { AI_MODE: 'document-search', ...vertexEnv }, fetchImpl },
    async (url) => {
      const result = await quote(url);
      assert.equal(result.status, 200);
      assert.equal(result.body.matched, false);
      assert.deepEqual(result.body.passages, []);
    },
  );
  assert.equal(searched.length, 0);
  // A library but no bucket: one start-up error line, then every passage is dropped.
  const errors = [];
  t.mock.method(console, 'error', (text) => errors.push(text));
  t.mock.method(console, 'log', () => {});
  const { DOCS_BUCKET, ...noBucket } = vertexEnv;
  const library = syntheticLibrary([summary({ id, fileName: 'Leave Guide.txt' })]);
  await withServer(
    { env: { AI_MODE: 'document-search', ...noBucket }, fetchImpl, companyDocuments: library },
    async (url) => {
      const result = await quote(url);
      assert.equal(result.status, 200);
      assert.equal(result.body.matched, false);
    },
  );
  assert.equal(searched.length, 1);
  assert.equal(library.reads, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /VERTEX_SEARCH_ENGINE_ID is set without DOCS_BUCKET/);
  assert.ok(DOCS_BUCKET);
});

test('checkKnowledgeConfig refuses Vertex AI Search without DOCS_BUCKET in the searching modes only', () => {
  const { DOCS_BUCKET: _bucket, ...noBucket } = vertexEnv;
  for (const mode of ['gemini-chat', 'document-search'])
    assert.throws(
      () => checkKnowledgeConfig({ ...noBucket, AI_MODE: mode }),
      (error) =>
        error instanceof KnowledgeConfigError &&
        /VERTEX_SEARCH_ENGINE_ID is set without DOCS_BUCKET/.test(error.message),
    );
  assert.throws(() =>
    checkKnowledgeConfig({ ...noBucket, AI_MODE: 'gemini-chat', DOCS_BUCKET: '  ' }),
  );
  for (const env of [
    { ...vertexEnv, AI_MODE: 'gemini-chat' },
    { ...noBucket, AI_MODE: 'gemini' },
    { ...noBucket, AI_MODE: 'demo' },
    { AI_MODE: 'gemini-chat' },
    {},
  ])
    assert.doesNotThrow(() => checkKnowledgeConfig(env));
});

test('the api and the local server refuse to start with Vertex AI Search and no DOCS_BUCKET', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DOCS_BUCKET: _bucket, ...noBucket } = vertexEnv;
  for (const file of ['api-service.mjs', 'index.mjs']) {
    const cwd = await mkdtemp(join(tmpdir(), 'knowledge-config-'));
    const child = spawn(process.execPath, [join(import.meta.dirname, '../../server', file)], {
      cwd,
      env: {
        PATH: process.env.PATH,
        ...noBucket,
        AI_MODE: 'gemini-chat',
        PORT: '0',
        VOICE_WARMUP: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    await rm(cwd, { recursive: true, force: true });
    assert.equal(code, 1, `${file}: ${output}`);
    assert.match(output, /cannot start: VERTEX_SEARCH_ENGINE_ID is set without DOCS_BUCKET/);
    assert.ok(!output.includes('ready'));
  }
});

test('a conversation service without the allowlist keeps the old passage fields plus null dates', async () => {
  const prompts = [];
  const service = createConversationService({
    env: {},
    models: recordingModels(prompts)(),
    memory: (await import('../../server/chat-store.mjs')).createChatStore({
      CHAT_DATABASE_PATH: ':memory:',
    }),
    retrieve: async () => [
      {
        title: 'Plain.pdf',
        heading: '',
        text: 'Plain text.',
        date: '2026-02-30x',
        dateKind: 'effective',
      },
    ],
  });
  try {
    const chat = await service.memory.create('person');
    const result = await service.ask('person', chat.id, 'How do I book leave?', randomUUID());
    // A malformed date or an unknown dateKind becomes null.
    assert.deepEqual(result.passages, [
      { id: 1, title: 'Plain.pdf', heading: '', text: 'Plain text.', date: null, dateKind: null },
    ]);
  } finally {
    await service.close();
  }
});
