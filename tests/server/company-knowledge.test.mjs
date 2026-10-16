// The HR company knowledge library, /api/hr/company-knowledge: file uploads
// (issue #35). Files and people are synthetic; nothing reaches Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { startAccountsApp } from './account-harness.mjs';
import { docx, pdf } from './document-fixtures.mjs';
import { planUpload } from '../../server/company-documents.mjs';
import { createApiProxy } from '../../server/api-proxy.mjs';
import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';
import { workspaceLimits } from '../../server/workspace-limits.mjs';
import { interleavePassages } from '../../server/company-knowledge.mjs';

const path = '/api/hr/company-knowledge/documents';
const handbook = 'Dress Code Staff wear smart casual clothing from Monday to Thursday.';
const handbook2 = 'Dress Code Team shirts are worn every Friday in the synthetic office.';
const safety = 'Fire Safety The synthetic assembly point is the north car park.';

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
const sha = (text) => createHash('sha256').update(text).digest('hex');

test('library rules: one document per topic, any number of related guides, twelve documents and the text limit', () => {
  const doc = (id, category, text, characters = text.length) => ({
    id,
    category,
    fingerprint: sha(text),
    characters,
  });
  const stored = [doc('a', 'handbook', 'Handbook text'), doc('b', 'additional', 'Safety')];
  const plan = (category, text) => planUpload(stored, { category, text });
  assert.deepEqual(
    { ...plan('it', 'IT text'), id: 'new' },
    { id: 'new', duplicate: false, replaced: false },
  );
  assert.deepEqual(plan('handbook', 'New handbook'), { id: 'a', duplicate: false, replaced: true });
  assert.deepEqual(plan('handbook', 'Handbook text'), { id: 'a', duplicate: true });
  assert.deepEqual(plan('additional', 'Safety'), { id: 'b', duplicate: true });
  // The same text under another topic is refused.
  assert.throws(() => plan('it', 'Safety'), { code: 'COMPANY_DOCUMENT_DUPLICATE', status: 409 });
  // Twelve documents; a topic can still be replaced when full.
  const full = Array.from({ length: workspaceLimits.files }, (_, i) =>
    doc(`d${i}`, i === 0 ? 'role' : 'additional', `Guide ${i}`),
  );
  assert.throws(() => planUpload(full, { category: 'additional', text: 'New' }), {
    code: 'WORKSPACE_DOCUMENT_LIMIT',
    status: 409,
  });
  assert.equal(planUpload(full, { category: 'role', text: 'New' }).replaced, true);
  // 750,000 characters in total.
  const big = [doc('x', 'additional', 'Big', 700000)];
  assert.throws(() => planUpload(big, { category: 'it', text: 'y'.repeat(60000) }), {
    code: 'WORKSPACE_TEXT_LIMIT',
    status: 413,
  });
});

test('HR uploads PDF, DOCX, text and Markdown files; only text and metadata are stored', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;

    const empty = await hr.get('/api/hr/company-knowledge');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    assert.deepEqual(empty.body, { documents: [], limits: workspaceLimits });

    const files = [
      ['company', 'overview.pdf', pdf('Our synthetic company builds onboarding tools.')],
      ['handbook', 'handbook.docx', docx(handbook)],
      ['it', 'it guide.txt', Buffer.from('Laptops are collected from the synthetic IT desk.')],
      ['role', 'role.md', Buffer.from('# Role\nSynthetic engineers pair on every change.')],
    ];
    const ids = [];
    for (const [category, fileName, buffer] of files) {
      const up = await hr.upload(`${path}?category=${category}`, buffer, fileName);
      assert.equal(up.status, 201, up.text);
      assert.deepEqual(Object.keys(up.body), ['id', 'duplicate', 'replaced']);
      assert.deepEqual({ ...up.body, id: 'x' }, { id: 'x', duplicate: false, replaced: false });
      ids.push(up.body.id);
    }
    const stored = app.firestore.read(`companyDocuments/${ids[1]}`);
    assert.deepEqual(
      { ...stored, connectedAt: 'iso', fingerprint: 'sha' },
      {
        category: 'handbook',
        title: 'Employee Handbook',
        fileName: 'handbook.docx',
        text: handbook,
        characters: handbook.length,
        bytes: files[1][2].length,
        fingerprint: 'sha',
        connectedBy: hrId,
        connectedAt: 'iso',
      },
    );
    assert.equal(stored.fingerprint, sha(handbook));
    assert.match(stored.connectedAt, /^\d{4}-\d{2}-\d{2}T/);
    // The file's bytes are nowhere in what is stored.
    assert.ok(!JSON.stringify(stored).includes('PK'));

    const listed = (await hr.get('/api/hr/company-knowledge')).body;
    assert.deepEqual(Object.keys(listed), ['documents', 'limits']);
    assert.deepEqual(
      listed.documents.map((d) => [d.id, d.fileName, d.category]),
      files.map(([category, fileName], i) => [ids[i], fileName, category]),
    );
    assert.equal(listed.documents[1].title, 'Employee Handbook');
    for (const doc of listed.documents) {
      assert.deepEqual(Object.keys(doc), [
        'id',
        'title',
        'fileName',
        'category',
        'characters',
        'bytes',
        'created',
      ]);
      assert.equal(typeof doc.created, 'number');
      assert.ok(doc.characters > 0 && doc.bytes > 0);
    }
    assert.ok(!JSON.stringify(listed).includes('Laptops'));

    // The guest workspace and its library are gone (issue #55).
    const guest = await app.browser().get('/api/guest-workspace');
    assert.deepEqual([guest.status, guest.body.code], [404, 'NOT_FOUND']);
  });
});

test('a topic upload replaces, identical text is a duplicate, and delete removes', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const first = await hr.upload(`${path}?category=handbook`, Buffer.from(handbook), 'v1.txt');
    assert.equal(first.status, 201);
    const id = first.body.id;

    const same = await hr.upload(`${path}?category=handbook`, Buffer.from(handbook), 'copy.txt');
    assert.deepEqual([same.status, same.body], [200, { id, duplicate: true }]);

    const replaced = await hr.upload(`${path}?category=handbook`, Buffer.from(handbook2), 'v2.md');
    assert.deepEqual(
      [replaced.status, replaced.body],
      [200, { id, duplicate: false, replaced: true }],
    );
    const doc = app.firestore.read(`companyDocuments/${id}`);
    assert.deepEqual([doc.text, doc.fileName], [handbook2, 'v2.md']);
    assert.equal(app.firestore.paths('companyDocuments/').length, 1);

    // The same text under another topic is a 409.
    const taken = await hr.upload(`${path}?category=it`, Buffer.from(handbook2), 'again.txt');
    assert.deepEqual([taken.status, taken.body.code], [409, 'COMPANY_DOCUMENT_DUPLICATE']);

    // Another HR browser sees the same library and can delete.
    const colleague = app.browser();
    await app.createHr('HR-0002', 'synthetic-hr-pass-2');
    await colleague.signIn('HR-0002', 'synthetic-hr-pass-2');
    assert.equal((await colleague.delete(`${path}/${id}`)).status, 204);
    const missing = await hr.delete(`${path}/${id}`);
    assert.deepEqual([missing.status, missing.body.code], [404, 'WORKSPACE_DOCUMENT_NOT_FOUND']);
    assert.deepEqual((await hr.get('/api/hr/company-knowledge')).body.documents, []);
  });
});

test('additional guides need a name of one line and up to 80 characters', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const body = Buffer.from(safety);
    const up = (query, buffer = body) => hr.upload(`${path}?${query}`, buffer, 'safety.txt');
    const named = await up('category=additional&name=' + encodeURIComponent('  Workplace Safety '));
    assert.equal(named.status, 201, named.text);
    const second = await up(
      'category=additional&name=Parking',
      Buffer.from('Parking is on level three of the garage.'),
    );
    assert.equal(second.status, 201);
    const duplicate = await up('category=additional&name=Another', body);
    assert.deepEqual(
      [duplicate.status, duplicate.body],
      [200, { id: named.body.id, duplicate: true }],
    );
    const listed = (await hr.get('/api/hr/company-knowledge')).body.documents;
    assert.deepEqual(
      listed.map((d) => [d.title, d.category]),
      [
        ['Workplace Safety', 'additional'],
        ['Parking', 'additional'],
      ],
    );
    const other = Buffer.from('Other synthetic guidance text.');
    for (const [query, status, code] of [
      ['category=additional', 400, 'DOCUMENT_NAME_INVALID'],
      ['category=additional&name=', 400, 'DOCUMENT_NAME_INVALID'],
      ['category=additional&name=%20%20', 400, 'DOCUMENT_NAME_INVALID'],
      ['category=additional&name=' + 'x'.repeat(81), 400, 'DOCUMENT_NAME_INVALID'],
      ['category=additional&name=Line%0Abreak', 400, 'DOCUMENT_NAME_INVALID'],
      ['category=additional&name=a&name=b', 400, 'DOCUMENT_NAME_INVALID'],
      ['', 400, 'DOCUMENT_TOPIC_REQUIRED'],
      ['category=payroll', 400, 'DOCUMENT_TOPIC_REQUIRED'],
      ['category=it&category=role', 400, 'DOCUMENT_TOPIC_REQUIRED'],
    ]) {
      const response = await up(query, other);
      assert.deepEqual([response.status, response.body.code], [status, code], query);
    }
    assert.equal((await up('category=additional&name=' + 'x'.repeat(80), other)).status, 201);
    assert.equal(app.firestore.paths('companyDocuments/').length, 3);
  });
});

test('file errors reuse the guest reader codes; JSON bodies are refused; nothing is stored', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const post = (name, buffer) => hr.upload(`${path}?category=it`, buffer, name);
    for (const [name, buffer, status, code] of [
      ['guide.html', Buffer.from('<p>x</p>'), 415, 'FILE_TYPE_UNSUPPORTED'],
      ['guide.docx', Buffer.from('x'), 422, 'FILE_INVALID'],
      ['guide.pdf', Buffer.from('plain text'), 422, 'FILE_INVALID'],
      ['guide.txt', Buffer.alloc(0), 400, 'FILE_EMPTY'],
      ['guide.pdf', pdf(''), 422, 'FILE_NO_TEXT'],
      ['guide.txt', Buffer.alloc(workspaceLimits.bytes + 1, 'x'), 413, 'FILE_TOO_LARGE'],
      ['guide.txt', Buffer.from('a'.repeat(250001)), 422, 'FILE_TEXT_TOO_LONG'],
      ['../guide.txt', Buffer.from('Some text.'), 400, 'FILE_NAME_INVALID'],
    ]) {
      const response = await post(name, buffer);
      assert.deepEqual([response.status, response.body?.code], [status, code], `${name} ${code}`);
    }
    const badName = await hr.request(
      'POST',
      `${path}?category=it`,
      undefined,
      {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': '%E0%A4%A',
      },
      Buffer.from('x'),
    );
    assert.deepEqual([badName.status, badName.body.code], [400, 'FILE_NAME_INVALID']);

    // The old Google Docs link body.
    const json = await hr.post(path, {
      category: 'it',
      url: 'https://docs.google.com/document/d/abc12345/edit',
    });
    assert.deepEqual([json.status, json.body.code], [415, 'FILE_UPLOAD_REQUIRED']);
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
  });
});

test('twelve documents and the shared text limit apply to uploads', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    for (let i = 0; i < workspaceLimits.files; i++) {
      const up = await hr.upload(
        `${path}?category=additional&name=Guide%20${i}`,
        Buffer.from(`Synthetic guide number ${i} for staff.`),
        `g${i}.txt`,
      );
      assert.equal(up.status, 201, up.text);
    }
    const over = await hr.upload(
      `${path}?category=additional&name=More`,
      Buffer.from('One more synthetic guide for staff.'),
      'more.txt',
    );
    assert.deepEqual([over.status, over.body.code], [409, 'WORKSPACE_DOCUMENT_LIMIT']);
    // A topic upload cannot exceed 750,000 characters either: replace two by
    // clearing and filling with 250,000-character files.
    for (const doc of (await hr.get('/api/hr/company-knowledge')).body.documents)
      await hr.delete(`${path}/${doc.id}`);
    for (const [category, fill] of [
      ['company', 'a'],
      ['handbook', 'b'],
      ['it', 'c'],
    ])
      assert.equal(
        (await hr.upload(`${path}?category=${category}`, Buffer.from(fill.repeat(250000)), 'x.txt'))
          .status,
        201,
      );
    const tooMuch = await hr.upload(
      `${path}?category=role`,
      Buffer.from('Another synthetic guide.'),
      'r.txt',
    );
    assert.deepEqual([tooMuch.status, tooMuch.body.code], [413, 'WORKSPACE_TEXT_LIMIT']);
  });
});

test('documents connected from Google Docs before #35 still list and carry no Drive fields', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const id = randomUUID();
    await app.firestore
      .connect()
      .collection('companyDocuments')
      .doc(id)
      .set({
        category: 'handbook',
        title: 'Employee Handbook',
        googleDocId: 'legacy-doc-0001',
        text: handbook,
        characters: handbook.length,
        bytes: Buffer.byteLength(handbook),
        fingerprint: sha(handbook),
        connectedBy: 'someone',
        connectedAt: '2026-10-01T00:00:00.000Z',
      });
    const snapshot = (await hr.get('/api/hr/company-knowledge')).body;
    assert.deepEqual(snapshot.documents, [
      {
        id,
        title: 'Employee Handbook',
        fileName: '',
        category: 'handbook',
        characters: handbook.length,
        bytes: Buffer.byteLength(handbook),
        created: Date.parse('2026-10-01T00:00:00.000Z'),
      },
    ]);
    assert.ok(!('companyKnowledge' in snapshot) && !('driveMoves' in snapshot));
    // Uploading to that topic replaces the legacy document.
    const replaced = await hr.upload(`${path}?category=handbook`, Buffer.from(handbook2), 'n.txt');
    assert.deepEqual(
      [replaced.status, replaced.body],
      [200, { id, duplicate: false, replaced: true }],
    );
    assert.equal(app.firestore.read(`companyDocuments/${id}`).googleDocId, undefined);
  });
});

test('the library is HR-only, and a Firestore failure is a fixed 503', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { browser: staff } = await app.readyEmployee(hr);
    const zero = '00000000-0000-0000-0000-000000000000';
    for (const [method, url] of [
      ['get', '/api/hr/company-knowledge'],
      ['delete', `${path}/${zero}`],
    ]) {
      const asEmployee = await staff[method](url);
      assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED']);
      const anonymous = await app.browser()[method](url);
      assert.deepEqual([anonymous.status, anonymous.body.code], [401, 'AUTH_REQUIRED']);
    }
    const body = Buffer.from(handbook);
    const asEmployee = await staff.upload(`${path}?category=it`, body, 'a.txt');
    assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED']);
    const anonymous = await app.browser().upload(`${path}?category=it`, body, 'a.txt');
    assert.deepEqual([anonymous.status, anonymous.body.code], [401, 'AUTH_REQUIRED']);
    // Another site's request is refused.
    const cross = await hr.upload(`${path}?category=it`, body, 'a.txt', {
      Origin: 'https://other.example',
    });
    assert.equal(cross.status, 403);
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);

    app.firestore.fail(14, { only: ['query'] });
    const failed = await hr.get('/api/hr/company-knowledge');
    assert.deepEqual([failed.status, failed.body.code], [503, 'COMPANY_KNOWLEDGE_UNAVAILABLE']);
    app.firestore.fail(14, { only: ['transaction'] });
    const notSaved = await hr.upload(`${path}?category=company`, body, 'a.txt');
    assert.deepEqual([notSaved.status, notSaved.body.code], [503, 'COMPANY_KNOWLEDGE_UNAVAILABLE']);
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
  });
  assert.deepEqual(
    onboardingDocumentTopics.map((topic) => topic.id),
    ['company', 'handbook', 'first-week', 'role', 'it', 'communication'],
  );
});

test('logs never contain file names or text', async () => {
  const lines = [];
  const warn = console.warn;
  console.warn = (line) => lines.push(String(line));
  try {
    await withApp({}, async (app) => {
      const hr = await app.hrBrowser();
      app.firestore.fail(14, { only: ['transaction'] });
      await hr.upload(
        `${path}?category=it`,
        Buffer.from('Secret synthetic text.'),
        'secret-name.txt',
      );
      await hr.upload(`${path}?category=it`, Buffer.from('x'), 'secret-name.html');
      assert.ok([...lines, ...app.logs].every((l) => !/secret/i.test(l)));
    });
  } finally {
    console.warn = warn;
  }
});

test('the web proxy forwards the upload path as a 5 MiB raw upload with the reader’s 413 code', async () => {
  const seen = [];
  const proxy = createApiProxy({
    apiUrl: 'https://api.example',
    fetchImpl: async (url, init) => {
      seen.push([url, init.body?.length]);
      return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  const web = express().use('/api', proxy);
  const server = await new Promise((resolve) => {
    const listening = web.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/hr/company-knowledge/documents?category=it`;
  const post = (size, type) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: Buffer.alloc(size, 'x'),
    });
  try {
    const ok = await post(workspaceLimits.bytes, 'application/octet-stream');
    assert.equal(ok.status, 201);
    assert.deepEqual(seen, [
      ['https://api.example/api/hr/company-knowledge/documents?category=it', workspaceLimits.bytes],
    ]);
    const big = await post(workspaceLimits.bytes + 1, 'application/octet-stream');
    assert.deepEqual([big.status, (await big.json()).code], [413, 'FILE_TOO_LARGE']);
    // Without the octet-stream type the small JSON limit applies.
    const json = await post(70 * 1024, 'application/json');
    assert.deepEqual([json.status, (await json.json()).code], [413, 'REQUEST_TOO_LARGE']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Moved from the deleted workspace-company-knowledge.test.mjs (issue #55): the
// library and the company retriever are interleaved this way.
test('passages from two ranked sources alternate, keep their own order and stop at the limit', () => {
  assert.deepEqual(interleavePassages([1, 2, 3], ['a', 'b'], 6), [1, 'a', 2, 'b', 3]);
  assert.deepEqual(interleavePassages([1, 2, 3], ['a', 'b'], 2), [1, 'a']);
  assert.deepEqual(interleavePassages([], ['a', 'b', 'c'], 2), ['a', 'b']);
  assert.deepEqual(interleavePassages([1], [], 6), [1]);
  assert.deepEqual(interleavePassages([], [], 6), []);
});
