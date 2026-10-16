// The HR company Google Docs library, /api/hr/company-knowledge (issue #32), and
// the restored read-only Drive reader. Google Drive is always an injected fake;
// documents and people are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startAccountsApp, driveDenied } from './account-harness.mjs';
import {
  DriveKnowledgeError,
  driveFailure,
  parseGoogleDocLink,
  readDriveKnowledge,
  readGoogleDocument,
} from '../../server/google-drive-documents.mjs';
import { planConnection } from '../../server/company-documents.mjs';
import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';
import { workspaceLimits } from '../../server/workspace-limits.mjs';

const link = (id) => `https://docs.google.com/document/d/${id}/edit?usp=sharing`;
// A fake Drive: Doc ID -> text, or an Error to throw. Records each read.
function fakeDrive(docs) {
  const reads = [];
  return {
    reads,
    load: async (id) => {
      reads.push(id);
      const found = docs[id];
      if (found instanceof Error) throw found;
      if (found === undefined)
        throw Object.assign(new Error('Synthetic not found'), { response: { status: 404 } });
      return { text: found };
    },
  };
}
const guides = {
  'handbook-doc-0001': 'Dress Code\nStaff wear smart casual clothing from Monday to Thursday.',
  'handbook-doc-0002': 'Dress Code\nTeam shirts are worn every Friday in the synthetic office.',
  'safety-doc-00001': 'Fire Safety\nThe synthetic assembly point is the north car park.',
  'welcome-doc-0001': 'Welcome\nThe synthetic company builds onboarding tools.',
};

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

test('only native Google Docs links are accepted, and the reader checks the real file type', async () => {
  assert.deepEqual(
    parseGoogleDocLink(
      'https://docs.google.com/document/u/0/d/handbook-12345/edit?usp=sharing#heading=test',
    ),
    { id: 'handbook-12345', url: 'https://docs.google.com/document/d/handbook-12345/edit' },
  );
  for (const value of [
    null,
    'not a link',
    'https://docs.google.com.evil.example/document/d/handbook-12345/edit',
    'https://drive.google.com/file/d/handbook-12345/view',
    'https://docs.google.com/spreadsheets/d/handbook-12345/edit',
    'http://docs.google.com/document/d/handbook-12345/edit',
    'https://user:password@docs.google.com/document/d/handbook-12345/edit',
    'https://docs.google.com/document/d/e/published-id/pub',
  ])
    assert.throws(() => parseGoogleDocLink(value), { code: 'GOOGLE_DOC_LINK_INVALID' });

  const calls = [];
  const client = {
    request: async (request) => {
      calls.push(request);
      return request.url.endsWith('/export')
        ? { data: ' Current company policy. ' }
        : {
            data: {
              mimeType: 'application/vnd.google-apps.document',
              capabilities: { canDownload: true },
            },
          };
    },
  };
  assert.deepEqual(await readGoogleDocument('handbook-12345', { client }), {
    text: 'Current company policy.',
  });
  assert.equal(calls[0].url, 'https://www.googleapis.com/drive/v3/files/handbook-12345');
  assert.equal(calls[1].params.mimeType, 'text/plain');
  assert.ok(calls.every((request) => !request.method)); // reads only
  const typed = (mimeType, text = 'x', extra = {}) => ({
    request: async (request) =>
      request.url.endsWith('/export')
        ? { data: text }
        : { data: { mimeType, capabilities: { canDownload: true }, ...extra } },
  });
  for (const [client, code] of [
    [typed('application/pdf'), 'GOOGLE_DOC_TYPE_REQUIRED'],
    [typed('application/vnd.google-apps.spreadsheet'), 'GOOGLE_DOC_TYPE_REQUIRED'],
    [
      typed('application/vnd.google-apps.document', 'x', { trashed: true }),
      'GOOGLE_DOC_TYPE_REQUIRED',
    ],
    [
      typed('application/vnd.google-apps.document', 'x', { capabilities: { canDownload: false } }),
      'DRIVE_DOCUMENT_RESTRICTED',
    ],
    [typed('application/vnd.google-apps.document', '   '), 'DRIVE_EMPTY_DOCUMENTS'],
    [typed('application/vnd.google-apps.document', 'x'.repeat(250001)), 'GOOGLE_DOC_TOO_LARGE'],
  ])
    await assert.rejects(readGoogleDocument('handbook-12345', { client }), { code });
  await assert.rejects(readGoogleDocument('../x', { client }), { code: 'GOOGLE_DOC_LINK_INVALID' });
});

test('the folder reader lists Google Docs and reports specific errors; Drive errors never leak', async () => {
  const folderClient = (text, listing) => ({
    request: async (request) =>
      request.url.endsWith('/export') ? { data: text } : { data: listing },
  });
  const files = [
    { id: 'core-doc-1', name: 'Overview', appProperties: { onboardaiTopic: 'company' } },
    { id: 'core-doc-2', name: 'Parking notes' },
  ];
  const documents = await readDriveKnowledge('company-folder', {
    client: folderClient('Short approved guidance.', { files }),
  });
  assert.deepEqual(
    documents.map(({ googleDocId, title, category }) => [googleDocId, title, category]),
    [
      ['core-doc-1', 'Welcome & Company Overview', 'company'],
      ['core-doc-2', 'Parking notes', ''],
    ],
  );
  for (const [client, code] of [
    [folderClient('', { files }), 'DRIVE_EMPTY_DOCUMENTS'],
    [folderClient('a'.repeat(750001), { files: [files[0]] }), 'DRIVE_KNOWLEDGE_TOO_LARGE'],
    [folderClient('', { files: [] }), 'DRIVE_NO_DOCUMENTS'],
    [folderClient('', { files: [], nextPageToken: 'more' }), 'DRIVE_TOO_MANY_DOCUMENTS'],
  ])
    await assert.rejects(
      readDriveKnowledge('company-folder', { client }),
      (error) => error instanceof DriveKnowledgeError && error.code === code,
    );
  await assert.rejects(readDriveKnowledge("bad' or 1", {}), { code: 'DRIVE_FOLDER_INVALID' });

  const error = Object.assign(new Error('Bearer synthetic-private-token'), {
    response: { status: 403, data: { error: { message: 'synthetic-private-token' } } },
  });
  assert.equal(driveFailure(error).code, 'DRIVE_ACCESS_DENIED');
  assert.ok(!JSON.stringify(driveFailure(error)).includes('synthetic-private-token'));
  for (const [status, code] of [
    [401, 'DRIVE_AUTH_REQUIRED'],
    [404, 'DRIVE_NOT_FOUND'],
    [429, 'DRIVE_RATE_LIMIT'],
    [500, 'DRIVE_UNAVAILABLE'],
  ])
    assert.equal(driveFailure({ response: { status } }).code, code);
  assert.equal(driveFailure(new Error('private-key-data')).code, 'DRIVE_UNAVAILABLE');
});

test('library rules: one Doc per topic, any number of related guides, twelve documents and the text limit', () => {
  const doc = (id, category, googleDocId, text, characters = text.length) => ({
    id,
    category,
    googleDocId,
    fingerprint: planFingerprint(text),
    characters,
  });
  const stored = [
    doc('a', 'handbook', 'doc-a', 'Handbook text'),
    doc('b', 'additional', 'doc-b', 'Safety'),
  ];
  const connect = (category, googleDocId, text) =>
    planConnection(stored, { category, googleDocId, text });
  // A new topic, a replaced topic, the same Doc refreshed, a duplicate related guide.
  assert.deepEqual(
    { ...connect('it', 'doc-c', 'IT text'), id: 'new' },
    { id: 'new', duplicate: false, replaced: false },
  );
  assert.deepEqual(connect('handbook', 'doc-c', 'New handbook'), {
    id: 'a',
    duplicate: false,
    replaced: true,
  });
  assert.deepEqual(connect('handbook', 'doc-a', 'Handbook text v2'), {
    id: 'a',
    duplicate: false,
    replaced: true,
  });
  assert.deepEqual(connect('additional', 'doc-b', 'Safety'), { id: 'b', duplicate: true });
  // The same Doc on another topic, or the same text twice.
  assert.throws(() => connect('it', 'doc-a', 'x'), { code: 'GOOGLE_DOC_ALREADY_CONNECTED' });
  assert.throws(() => connect('it', 'doc-z', 'Safety'), { code: 'GOOGLE_DOC_ALREADY_CONNECTED' });
  // Twelve documents; a topic can still be replaced when full.
  const full = Array.from({ length: workspaceLimits.files }, (_, i) =>
    doc(`d${i}`, i === 0 ? 'role' : 'additional', `doc-${i}`, `Guide ${i}`),
  );
  assert.throws(
    () => planConnection(full, { category: 'additional', googleDocId: 'doc-new', text: 'New' }),
    { code: 'WORKSPACE_DOCUMENT_LIMIT', status: 409 },
  );
  assert.equal(
    planConnection(full, { category: 'role', googleDocId: 'doc-new', text: 'New' }).replaced,
    true,
  );
  // 750,000 characters in total.
  const big = [doc('x', 'additional', 'doc-x', 'Big', 700000)];
  assert.throws(
    () => planConnection(big, { category: 'it', googleDocId: 'doc-y', text: 'y'.repeat(60000) }),
    { code: 'WORKSPACE_TEXT_LIMIT', status: 413 },
  );
});

const planFingerprint = (text) => createHash('sha256').update(text).digest('hex');

test('HR connects, lists, replaces and removes company Google Docs; another HR browser sees the same library', async () => {
  const drive = fakeDrive(guides);
  await withApp({ loadGoogleDocument: drive.load }, async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;

    const empty = await hr.get('/api/hr/company-knowledge');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    assert.deepEqual(empty.body, {
      documents: [],
      limits: workspaceLimits,
      companyKnowledge: { drive: { state: 'not-configured', documents: [] } },
      driveMoves: { enabled: false, configured: false },
    });

    const connected = await hr.post('/api/hr/company-knowledge/documents', {
      category: 'handbook',
      url: link('handbook-doc-0001'),
    });
    assert.equal(connected.status, 201, connected.text);
    assert.deepEqual(Object.keys(connected.body), ['id', 'duplicate', 'replaced']);
    assert.deepEqual(
      { ...connected.body, id: 'x' },
      { id: 'x', duplicate: false, replaced: false },
    );
    const id = connected.body.id;
    // Stored company-wide in Firestore companyDocuments.
    const stored = app.firestore.read(`companyDocuments/${id}`);
    assert.deepEqual(
      { ...stored, connectedAt: 'iso', fingerprint: 'sha' },
      {
        category: 'handbook',
        title: 'Employee Handbook',
        googleDocId: 'handbook-doc-0001',
        text: guides['handbook-doc-0001'],
        characters: guides['handbook-doc-0001'].length,
        bytes: Buffer.byteLength(guides['handbook-doc-0001']),
        fingerprint: 'sha',
        connectedBy: hrId,
        connectedAt: 'iso',
      },
    );
    assert.match(stored.connectedAt, /^\d{4}-\d{2}-\d{2}T/);

    const related = await hr.post('/api/hr/company-knowledge/documents', {
      category: 'additional',
      url: link('safety-doc-00001'),
      name: '  Workplace Safety  ',
    });
    assert.equal(related.status, 201);
    // The same related guide again is a duplicate (200), not a second copy.
    const duplicate = await hr.post('/api/hr/company-knowledge/documents', {
      category: 'additional',
      url: link('safety-doc-00001'),
      name: 'Another name',
    });
    assert.deepEqual(
      [duplicate.status, duplicate.body],
      [200, { id: related.body.id, duplicate: true }],
    );

    // GET mirrors #28's snapshot fields: id, title, bytes, created, category,
    // googleDocId, characters (no text).
    const listed = (await hr.get('/api/hr/company-knowledge')).body.documents;
    assert.deepEqual(
      listed.map((doc) => [doc.id, doc.title, doc.category, doc.googleDocId]),
      [
        [id, 'Employee Handbook', 'handbook', 'handbook-doc-0001'],
        [related.body.id, 'Workplace Safety', 'additional', 'safety-doc-00001'],
      ],
    );
    for (const doc of listed) {
      assert.deepEqual(Object.keys(doc), [
        'id',
        'title',
        'bytes',
        'created',
        'category',
        'googleDocId',
        'characters',
      ]);
      assert.equal(typeof doc.created, 'number');
    }

    // Another HR account in another browser sees the same library.
    const colleague = app.browser();
    await app.createHr('HR-0002', 'synthetic-hr-pass-2');
    assert.equal((await colleague.signIn('HR-0002', 'synthetic-hr-pass-2')).status, 200);
    assert.deepEqual((await colleague.get('/api/hr/company-knowledge')).body.documents, listed);

    // Changing a topic's Doc replaces it in place (200, same ID).
    const replaced = await colleague.post('/api/hr/company-knowledge/documents', {
      category: 'handbook',
      url: link('handbook-doc-0002'),
    });
    assert.deepEqual(
      [replaced.status, replaced.body],
      [200, { id, duplicate: false, replaced: true }],
    );
    assert.equal(app.firestore.read(`companyDocuments/${id}`).text, guides['handbook-doc-0002']);
    assert.equal(app.firestore.paths('companyDocuments/').length, 2);
    // The same Doc on another topic is refused.
    const taken = await hr.post('/api/hr/company-knowledge/documents', {
      category: 'it',
      url: link('handbook-doc-0002'),
    });
    assert.deepEqual([taken.status, taken.body.code], [409, 'GOOGLE_DOC_ALREADY_CONNECTED']);

    // Disconnecting removes the record only (the Google Doc is never written to).
    assert.equal((await hr.delete(`/api/hr/company-knowledge/documents/${id}`)).status, 204);
    const missing = await hr.delete(`/api/hr/company-knowledge/documents/${id}`);
    assert.deepEqual([missing.status, missing.body.code], [404, 'WORKSPACE_DOCUMENT_NOT_FOUND']);
    const invalid = await hr.delete('/api/hr/company-knowledge/documents/not-an-id');
    assert.deepEqual([invalid.status, invalid.body.code], [404, 'WORKSPACE_DOCUMENT_NOT_FOUND']);
    assert.deepEqual(
      (await colleague.get('/api/hr/company-knowledge')).body.documents.map((d) => d.id),
      [related.body.id],
    );

    // Guest workspaces keep their own upload library: no company documents there.
    const guest = await app.browser().get('/api/guest-workspace');
    assert.equal(guest.status, 200);
    assert.deepEqual(guest.body.documents, []);
  });
});

test('request, link and Drive errors use #28’s codes and never reach Drive for a bad link', async () => {
  const drive = fakeDrive({
    'restricted-doc-01': driveDenied(),
    'sheet-document-1': new DriveKnowledgeError('GOOGLE_DOC_TYPE_REQUIRED', 'Only native Docs.'),
    'unauthorised-doc': Object.assign(new Error('Synthetic private detail'), {
      response: { status: 401 },
    }),
  });
  await withApp({ loadGoogleDocument: drive.load }, async (app) => {
    const hr = await app.hrBrowser();
    const post = (body, headers) => hr.post('/api/hr/company-knowledge/documents', body, headers);
    for (const [body, status, code] of [
      [{ category: 'payroll', url: link('restricted-doc-01') }, 400, 'DOCUMENT_TOPIC_REQUIRED'],
      [{ url: link('restricted-doc-01') }, 400, 'DOCUMENT_TOPIC_REQUIRED'],
      [{ category: 'additional', url: link('restricted-doc-01') }, 400, 'DOCUMENT_NAME_INVALID'],
      [
        { category: 'additional', name: 'x'.repeat(81), url: link('restricted-doc-01') },
        400,
        'DOCUMENT_NAME_INVALID',
      ],
      [
        { category: 'additional', name: 'Line\nbreak', url: link('restricted-doc-01') },
        400,
        'DOCUMENT_NAME_INVALID',
      ],
      [{ category: 'it', url: 'https://example.com/handbook.pdf' }, 400, 'GOOGLE_DOC_LINK_INVALID'],
      [{ category: 'it', url: 42 }, 400, 'GOOGLE_DOC_LINK_INVALID'],
    ]) {
      const response = await post(body);
      assert.deepEqual([response.status, response.body.code], [status, code], JSON.stringify(body));
    }
    assert.deepEqual(drive.reads, []); // nothing reached Drive yet

    // Not JSON (for example a file upload).
    const upload = await fetch(app.url + '/api/hr/company-knowledge/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', cookie: hr.cookieHeader },
      body: 'binary',
    });
    assert.deepEqual([upload.status, (await upload.json()).code], [415, 'GOOGLE_DOC_ONLY']);

    const warnings = [];
    const warn = console.warn;
    console.warn = (line) => warnings.push(String(line));
    try {
      for (const [id, status, code] of [
        // A credential without the Drive scope, or a Doc not shared with it.
        ['restricted-doc-01', 503, 'DRIVE_ACCESS_DENIED'],
        ['unauthorised-doc', 503, 'DRIVE_AUTH_REQUIRED'],
        ['missing-document', 503, 'DRIVE_NOT_FOUND'],
        ['sheet-document-1', 422, 'GOOGLE_DOC_TYPE_REQUIRED'],
      ]) {
        const response = await post({ category: 'it', url: link(id) });
        assert.deepEqual([response.status, response.body.code], [status, code], id);
        assert.ok(!response.text.includes('Synthetic'));
      }
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
    // The log names the operation and code only, never the Doc or Google's text.
    assert.ok(warnings.some((line) => line.includes('"code":"DRIVE_ACCESS_DENIED"')));
    assert.ok(warnings.every((line) => !/restricted-doc-01|Synthetic/.test(line)));
  });
});

test('the Drive folder state follows #28: connected documents or a fixed error', async () => {
  const folder = [
    {
      googleDocId: 'folder-doc-0001',
      title: 'Welcome & Company Overview',
      category: 'company',
      text: 'Welcome text',
    },
  ];
  let fail = false;
  const loadDriveKnowledge = async (folderId) => {
    assert.equal(folderId, 'synthetic-folder');
    if (fail) throw driveDenied();
    return folder;
  };
  await withApp(
    { env: { GOOGLE_DRIVE_FOLDER_ID: 'synthetic-folder' }, loadDriveKnowledge },
    async (app) => {
      const hr = await app.hrBrowser();
      assert.deepEqual((await hr.get('/api/hr/company-knowledge')).body.companyKnowledge, {
        drive: {
          state: 'connected',
          documents: [
            {
              title: 'Welcome & Company Overview',
              googleDocId: 'folder-doc-0001',
              category: 'company',
              characters: 12,
            },
          ],
        },
      });
    },
  );
  fail = true;
  await withApp(
    { env: { GOOGLE_DRIVE_FOLDER_ID: 'synthetic-folder' }, loadDriveKnowledge },
    async (app) => {
      const hr = await app.hrBrowser();
      const { drive } = (await hr.get('/api/hr/company-knowledge')).body.companyKnowledge;
      assert.deepEqual(
        { ...drive, error: typeof drive.error },
        { state: 'unavailable', documents: [], code: 'DRIVE_ACCESS_DENIED', error: 'string' },
      );
    },
  );
});

test('the library is HR-only, and a Firestore failure is a fixed 503', async () => {
  await withApp({ loadGoogleDocument: fakeDrive(guides).load }, async (app) => {
    const hr = await app.hrBrowser();
    const { browser: staff } = await app.readyEmployee(hr);
    for (const [method, path, body] of [
      ['get', '/api/hr/company-knowledge'],
      [
        'post',
        '/api/hr/company-knowledge/documents',
        { category: 'it', url: link('welcome-doc-0001') },
      ],
      ['delete', '/api/hr/company-knowledge/documents/00000000-0000-0000-0000-000000000000'],
    ]) {
      const asEmployee = await staff[method](path, body);
      assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED'], path);
      const anonymous = await app.browser()[method](path, body);
      assert.deepEqual([anonymous.status, anonymous.body.code], [401, 'AUTH_REQUIRED'], path);
    }
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);

    app.firestore.fail(14, { only: ['query'] });
    const failed = await hr.get('/api/hr/company-knowledge');
    assert.deepEqual([failed.status, failed.body.code], [503, 'COMPANY_KNOWLEDGE_UNAVAILABLE']);
    app.firestore.fail(14, { only: ['transaction'] });
    const notSaved = await hr.post('/api/hr/company-knowledge/documents', {
      category: 'company',
      url: link('welcome-doc-0001'),
    });
    assert.deepEqual([notSaved.status, notSaved.body.code], [503, 'COMPANY_KNOWLEDGE_UNAVAILABLE']);
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
  });
  // Every topic in the shared list can be connected.
  assert.deepEqual(
    onboardingDocumentTopics.map((topic) => topic.id),
    ['company', 'handbook', 'first-week', 'role', 'it', 'communication'],
  );
});
