// The api's GCS + Vertex AI Search sync of HR documents: the D-1 delete fix
// (delete by sha256(uri)[:32], a paginated list fallback only on 404, and no
// swallowed failure) and the structured onboardai_docs_sync log lines (C-SYNC).
// Fake fetch and fake Firestore only; synthetic names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { startAccountsApp } from './account-harness.mjs';
import {
  createVertexDocumentSync,
  deploymentEnvironment,
  syncLine,
  syncOperations,
  writeSyncLine,
} from '../../server/company-documents.mjs';

const path = '/api/hr/company-knowledge/documents';
const bucket = 'demo-sync-docs';
const env = {
  GOOGLE_CLOUD_PROJECT: 'demo-sync',
  DOCS_BUCKET: bucket,
  VERTEX_SEARCH_DATA_STORE_ID: 'demo-sync-store',
};
const documents =
  'https://discoveryengine.googleapis.com/v1/projects/demo-sync/locations/global/collections/default_collection/dataStores/demo-sync-store/branches/default_branch/documents';
const sha32 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const text = 'Synthetic leave guidance: staff book leave two weeks ahead.';
const fileName = 'Synthetic Leave Guide.txt';
const lineKeys = [
  'severity',
  'event',
  'environment',
  'operation',
  'outcome',
  'status',
  'reason',
  'documentId',
];

// A scripted fake for Google: route(method, url) -> Response | throw.
function fakeGoogle(route) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init = {}) => {
      const method = init.method || 'GET';
      calls.push([method, String(url)]);
      return (await route(method, String(url), init)) ?? Response.json({});
    },
  };
}

async function withSyncApp(route, check, extraEnv = {}) {
  const google = fakeGoogle(route);
  const app = await startAccountsApp({ env: { ...env, ...extraEnv }, fetchImpl: google.fetchImpl });
  try {
    const hr = await app.hrBrowser();
    const up = await hr.upload(`${path}?category=policies`, Buffer.from(text), fileName);
    assert.equal(up.status, 201, up.text);
    google.calls.length = 0;
    app.syncEvents.length = 0;
    await check({ app, hr, id: up.body.id, google });
  } finally {
    await app.close();
  }
}
const uriOf = (id) => `gs://${bucket}/${id}/${fileName}`;
const gcsObject = (id) =>
  `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(`${id}/${fileName}`)}`;

test('D-1: a delete removes the Vertex AI Search document by sha256(uri)[:32] and lists nothing', async () => {
  await withSyncApp(
    () => undefined,
    async ({ app, hr, id, google }) => {
      assert.equal((await hr.delete(`${path}/${id}`)).status, 204);
      assert.deepEqual(google.calls, [
        ['DELETE', gcsObject(id)],
        ['DELETE', `${documents}/${sha32(uriOf(id))}`],
      ]);
      // The Firestore UUID is never used as a Vertex document ID any more.
      assert.ok(google.calls.every(([, url]) => !url.endsWith(`/documents/${id}`)));
      assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
      assert.deepEqual(
        app.syncEvents.map((e) => [e.operation, e.outcome, e.status]),
        [
          ['gcs.delete', 'ok', 200],
          ['discoveryengine.delete', 'ok', 200],
        ],
      );
    },
  );
});

test('D-1: on a 404 the delete lists every page and removes each document with the same URI', async () => {
  const pages = (id) => ({
    '': {
      documents: [{ id: 'other-doc', content: { uri: `gs://${bucket}/${randomUUID()}/x.txt` } }],
      nextPageToken: 'page-2',
    },
    'page-2': {
      documents: [{ name: `${documents}/legacy-doc`, content: { uri: uriOf(id) } }],
    },
  });
  let state;
  await withSyncApp(
    (method, url) => {
      if (method === 'DELETE' && url.endsWith(`/documents/${sha32(uriOf(state))}`))
        return new Response('{}', { status: 404 });
      if (method === 'GET' && url.startsWith(`${documents}?`))
        return Response.json(pages(state)[new URL(url).searchParams.get('pageToken') ?? '']);
    },
    async ({ app, hr, id, google }) => {
      state = id;
      assert.equal((await hr.delete(`${path}/${id}`)).status, 204);
      assert.deepEqual(google.calls, [
        ['DELETE', gcsObject(id)],
        ['DELETE', `${documents}/${sha32(uriOf(id))}`],
        ['GET', `${documents}?pageSize=1000`],
        ['GET', `${documents}?pageSize=1000&pageToken=page-2`],
        ['DELETE', `${documents}/legacy-doc`],
      ]);
      assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
      assert.deepEqual(
        app.syncEvents.map((e) => [e.operation, e.status]),
        [
          ['gcs.delete', 200],
          ['discoveryengine.delete', 404],
          ['discoveryengine.list', 200],
          ['discoveryengine.list', 200],
          ['discoveryengine.delete', 200],
        ],
      );
      // A 404 on a delete is "already gone": logged as ok.
      assert.equal(app.syncEvents[1].outcome, 'ok');
    },
  );
});

test('D-1: a failed list, a failed delete or a timeout throws and keeps the entry for HR to retry', async () => {
  for (const [name, route, status, code, failedLine] of [
    [
      'list 500',
      (method, url) => {
        if (method === 'DELETE' && url.startsWith(documents))
          return new Response('{}', { status: 404 });
        if (method === 'GET') return new Response('{}', { status: 500 });
      },
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      ['discoveryengine.list', 500, 'http'],
    ],
    [
      'list network error',
      (method, url) => {
        if (method === 'DELETE' && url.startsWith(documents))
          return new Response('{}', { status: 404 });
        if (method === 'GET') throw new TypeError('fetch failed');
      },
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      ['discoveryengine.list', null, 'network'],
    ],
    [
      'unreadable list body',
      (method, url) => {
        if (method === 'DELETE' && url.startsWith(documents))
          return new Response('{}', { status: 404 });
        if (method === 'GET') return new Response('not json', { status: 200 });
      },
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      null,
    ],
    [
      'vertex delete 403',
      (method, url) => {
        if (method === 'DELETE' && url.startsWith(documents))
          return new Response('{}', { status: 403 });
      },
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      ['discoveryengine.delete', 403, 'http'],
    ],
    [
      'gcs delete 500',
      (method, url) => {
        if (method === 'DELETE' && url.includes('storage.googleapis.com'))
          return new Response('{}', { status: 500 });
      },
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      ['gcs.delete', 500, 'http'],
    ],
    [
      'vertex delete timeout',
      (method, url) => {
        if (method === 'DELETE' && url.startsWith(documents))
          throw new DOMException('The operation timed out.', 'TimeoutError');
      },
      504,
      'COMPANY_KNOWLEDGE_TIMEOUT',
      ['discoveryengine.delete', null, 'timeout'],
    ],
  ])
    await withSyncApp(route, async ({ app, hr, id }) => {
      const failed = await hr.delete(`${path}/${id}`);
      assert.deepEqual([failed.status, failed.body.code], [status, code], name);
      assert.deepEqual(app.firestore.paths('companyDocuments/'), [`companyDocuments/${id}`], name);
      assert.deepEqual(
        (await hr.get('/api/hr/company-knowledge')).body.documents.map((d) => d.id),
        [id],
        name,
      );
      if (failedLine) {
        const line = app.syncEvents.find((e) => e.outcome === 'failed');
        assert.deepEqual([line.operation, line.status, line.reason], failedLine, name);
        assert.equal(line.severity, 'WARNING');
        assert.equal(line.documentId, id);
      }
    });
});

test('C-SYNC: one JSON line per request, for success and failure, with ids and statuses only', async () => {
  const logged = [];
  const sync = createVertexDocumentSync({
    env: { ...env, ONBOARDAI_ENVIRONMENT: 'staging' },
    getAccessToken: async () => 'synthetic-token',
    logEvent: (entry) => logged.push(entry),
    fetchImpl: async (url) =>
      String(url).includes(':import') ? new Response('{}', { status: 429 }) : Response.json({}),
  });
  const id = randomUUID();
  await assert.rejects(
    sync.uploadDocument({
      id,
      fileName: 'Secret Synthetic Name.txt',
      text: 'Secret synthetic text',
    }),
    { code: 'COMPANY_KNOWLEDGE_UNAVAILABLE' },
  );
  assert.deepEqual(logged, [
    {
      severity: 'INFO',
      event: 'onboardai_docs_sync',
      environment: 'staging',
      operation: 'gcs.upload',
      outcome: 'ok',
      status: 200,
      reason: null,
      documentId: id,
    },
    {
      severity: 'WARNING',
      event: 'onboardai_docs_sync',
      environment: 'staging',
      operation: 'discoveryengine.import',
      outcome: 'failed',
      status: 429,
      reason: 'http',
      documentId: id,
    },
  ]);
  for (const line of logged) assert.deepEqual(Object.keys(line), lineKeys);
  const textOut = JSON.stringify(logged);
  for (const secret of ['Secret', bucket, 'gs://', 'synthetic-token', 'demo-sync-store'])
    assert.ok(!textOut.includes(secret), secret);

  // No credentials: the operation is logged as failed, nothing is sent.
  const noToken = [];
  const offline = createVertexDocumentSync({
    env,
    getAccessToken: async () => {
      throw new Error('no ADC');
    },
    logEvent: (entry) => noToken.push(entry),
    fetchImpl: async () => assert.fail('nothing is sent without a token'),
  });
  await assert.rejects(offline.deleteDocument({ id, fileName: 'a.txt' }), {
    code: 'COMPANY_KNOWLEDGE_UNAVAILABLE',
  });
  assert.deepEqual(
    noToken.map((e) => [e.operation, e.outcome, e.status, e.reason, e.environment]),
    [['gcs.delete', 'failed', null, 'network', 'local']],
  );
});

test('C-SYNC: the line format, the environment label and the default stdout writer', () => {
  assert.deepEqual(syncOperations, [
    'gcs.upload',
    'gcs.delete',
    'discoveryengine.import',
    'discoveryengine.delete',
    'discoveryengine.list',
    'replace.rollback',
    'replace.cleanup',
  ]);
  for (const [value, expected] of [
    ['staging', 'staging'],
    ['production', 'production'],
    [' production ', 'production'],
    ['prod', 'local'],
    ['', 'local'],
    [undefined, 'local'],
  ])
    assert.equal(deploymentEnvironment({ ONBOARDAI_ENVIRONMENT: value }), expected, String(value));
  assert.equal(deploymentEnvironment(), 'local');
  // Only a Firestore document ID is ever logged as documentId.
  assert.equal(
    syncLine({ operation: 'gcs.delete', ok: true, documentId: 'Leave Policy.pdf' }).documentId,
    null,
  );
  assert.deepEqual(syncLine({ operation: 'replace.cleanup', ok: false }), {
    severity: 'WARNING',
    event: 'onboardai_docs_sync',
    environment: 'local',
    operation: 'replace.cleanup',
    outcome: 'failed',
    status: null,
    reason: 'network',
    documentId: null,
  });
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(line);
  try {
    writeSyncLine(syncLine({ operation: 'gcs.upload', ok: true, status: 200 }));
  } finally {
    console.log = original;
  }
  assert.equal(printed.length, 1);
  assert.equal(typeof printed[0], 'string');
  assert.deepEqual(Object.keys(JSON.parse(printed[0])), lineKeys);
});

test('C-SYNC: the upload route writes the lines through the store and never a file name', async () => {
  const app = await startAccountsApp({
    env: { ...env, ONBOARDAI_ENVIRONMENT: 'production' },
    fetchImpl: async () => Response.json({ name: 'operations/import-1' }),
  });
  try {
    const hr = await app.hrBrowser();
    const up = await hr.upload(`${path}?category=policies`, Buffer.from(text), 'Secret Name.txt');
    assert.equal(up.status, 201);
    assert.deepEqual(
      app.syncEvents.map((e) => [e.environment, e.operation, e.outcome, e.documentId]),
      [
        ['production', 'gcs.upload', 'ok', up.body.id],
        ['production', 'discoveryengine.import', 'ok', up.body.id],
      ],
    );
    assert.ok(app.logs.every((line) => !/secret/i.test(line)));
  } finally {
    await app.close();
  }
});
