import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  readDriveKnowledge,
  DriveKnowledgeError,
  driveFailure,
  parseGoogleDocLink,
  readGoogleDocument,
} from '../server/google-drive-documents.mjs';
import { createApp } from '../server/api-routes.mjs';

function driveClient(text, listing = { files: [{ id: 'doc-1', name: 'Test handbook' }] }) {
  return {
    request: async (options) =>
      options.url.endsWith('/export') ? { data: text } : { data: listing },
  };
}

test('only native Google Docs links are accepted and submitted URLs are never fetched', async () => {
  assert.deepEqual(
    parseGoogleDocLink(
      'https://docs.google.com/document/u/0/d/handbook-12345/edit?usp=sharing#heading=test',
    ),
    { id: 'handbook-12345', url: 'https://docs.google.com/document/d/handbook-12345/edit' },
  );
  for (const value of [
    null,
    'https://docs.google.com.evil.example/document/d/handbook-12345/edit',
    'https://drive.google.com/file/d/handbook-12345/view',
    'https://docs.google.com/spreadsheets/d/handbook-12345/edit',
    'http://docs.google.com/document/d/handbook-12345/edit',
    'https://user:password@docs.google.com/document/d/handbook-12345/edit',
    'https://docs.google.com:444/document/d/handbook-12345/edit',
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
  assert.equal(
    (await readGoogleDocument('handbook-12345', { client })).text,
    'Current company policy.',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://www.googleapis.com/drive/v3/files/handbook-12345');
  assert.equal(calls[1].params.mimeType, 'text/plain');
  for (const mimeType of [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.spreadsheet',
  ]) {
    let exports = 0;
    await assert.rejects(
      readGoogleDocument('handbook-12345', {
        client: {
          request: async (request) => {
            if (request.url.endsWith('/export')) exports++;
            return { data: { mimeType } };
          },
        },
      }),
      { code: 'GOOGLE_DOC_TYPE_REQUIRED' },
    );
    assert.equal(exports, 0);
  }
  for (const [text, code] of [
    ['   ', 'DRIVE_EMPTY_DOCUMENTS'],
    ['x'.repeat(250001), 'GOOGLE_DOC_TOO_LARGE'],
  ])
    await assert.rejects(
      readGoogleDocument('handbook-12345', {
        client: {
          request: async (request) =>
            request.url.endsWith('/export')
              ? { data: text }
              : { data: { mimeType: 'application/vnd.google-apps.document' } },
        },
      }),
      { code },
    );
});

test('the connected folder can hold all six core onboarding Google Docs', async () => {
  const files = Array.from({ length: 6 }, (_, i) => ({
    id: 'core-document-' + i,
    name: 'Core guide ' + i,
  }));
  const result = await readDriveKnowledge('company-folder', {
    client: driveClient('Short approved guidance.', { files }),
  });
  assert.equal(result.length, 6);
});

test('the connected handbook size is accepted and export uses read-only text access', async () => {
  const requests = [];
  const client = {
    request: async (options) => {
      requests.push(options);
      return options.url.endsWith('/export')
        ? { data: 'a'.repeat(61145) }
        : { data: { files: [{ id: 'doc-1', name: 'Test handbook' }] } };
    },
  };
  const documents = await readDriveKnowledge('test-folder', { client });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].text.length, 61145);
  assert.match(requests[0].params.q, /'test-folder' in parents/);
  assert.equal(requests[1].params.mimeType, 'text/plain');
});

test('empty, oversized and too-many-document errors are specific', async () => {
  for (const [client, code] of [
    [driveClient(''), 'DRIVE_EMPTY_DOCUMENTS'],
    [driveClient('a'.repeat(750001)), 'DRIVE_KNOWLEDGE_TOO_LARGE'],
    [driveClient('', { files: [] }), 'DRIVE_NO_DOCUMENTS'],
    [driveClient('', { files: [], nextPageToken: 'another-page' }), 'DRIVE_TOO_MANY_DOCUMENTS'],
  ]) {
    await assert.rejects(
      readDriveKnowledge('test-folder', { client }),
      (error) => error instanceof DriveKnowledgeError && error.code === code,
    );
  }
});

test('raw Google errors and credentials are never exposed in Drive failure messages', () => {
  const error = new Error('Bearer test-private-token');
  error.response = { status: 403, data: { error: { message: 'test-private-token' } } };
  const failure = driveFailure(error);
  assert.equal(failure.code, 'DRIVE_ACCESS_DENIED');
  assert.ok(!JSON.stringify(failure).includes('test-private-token'));
  assert.equal(driveFailure(new Error('private-key-data')).code, 'DRIVE_UNAVAILABLE');
});

async function withServer(options, callback) {
  const server = createApp({ getAccessToken: async () => 'test-access-token', ...options }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const ask = (url) =>
  fetch(url + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'What are the working hours?',
      taskId: 'quiz-part-1',
      speechEnabled: false,
    }),
  });

function changingDrive() {
  const state = {
    files: [
      {
        id: 'doc-1',
        name: 'Policy',
        version: '1',
        modifiedTime: '2026-10-14T00:00:00Z',
        capabilities: { canDownload: true },
      },
    ],
    text: 'Current policy',
    listings: 0,
    exports: 0,
    listingError: null,
    exportError: null,
  };
  const client = {
    request: async (options) => {
      if (options.url.endsWith('/export')) {
        state.exports++;
        if (state.exportError) throw state.exportError;
        return { data: state.text };
      }
      state.listings++;
      assert.match(options.params.fields, /version/);
      assert.match(options.params.fields, /canDownload/);
      if (state.listingError) throw state.listingError;
      return { data: { files: structuredClone(state.files) } };
    },
  };
  return { state, client };
}

test('unchanged documents skip repeat exports while edits and removals are checked each turn', async () => {
  const { state, client } = changingDrive();
  await readDriveKnowledge('test-folder', { client });
  assert.deepEqual(await readDriveKnowledge('test-folder', { client }), [
    { googleDocId: 'doc-1', category: '', title: 'Policy', text: 'Current policy' },
  ]);
  assert.equal(state.listings, 2);
  assert.equal(state.exports, 1);
  state.files[0].version = '2';
  state.text = 'Updated policy';
  assert.equal((await readDriveKnowledge('test-folder', { client }))[0].text, 'Updated policy');
  assert.equal(state.exports, 2);
  state.files = [];
  await assert.rejects(readDriveKnowledge('test-folder', { client }), {
    code: 'DRIVE_NO_DOCUMENTS',
  });
  assert.equal(state.listings, 4);
});

test('document snapshots remain separate for authenticated clients and folders', async () => {
  const first = changingDrive(),
    second = changingDrive();
  second.state.text = 'Different account policy';
  await readDriveKnowledge('test-folder', { client: first.client });
  assert.equal(
    (await readDriveKnowledge('test-folder', { client: second.client }))[0].text,
    'Different account policy',
  );
  await readDriveKnowledge('another-folder', { client: first.client });
  assert.equal(first.state.exports, 2);
  assert.equal(second.state.exports, 1);
});

test('revoked export access and failed Drive requests cannot return an old policy', async () => {
  const { state, client } = changingDrive();
  await readDriveKnowledge('test-folder', { client });
  state.files[0].capabilities.canDownload = false;
  await assert.rejects(readDriveKnowledge('test-folder', { client }), {
    code: 'DRIVE_DOCUMENT_RESTRICTED',
  });
  state.files[0].capabilities.canDownload = true;
  state.files[0].version = '2';
  state.exportError = new Error('Export denied');
  await assert.rejects(readDriveKnowledge('test-folder', { client }), /Export denied/);
  state.exportError = null;
  state.listingError = new Error('Folder denied');
  await assert.rejects(readDriveKnowledge('test-folder', { client }), /Folder denied/);
  state.listingError = null;
  state.text = 'New accessible policy';
  assert.equal((await readDriveKnowledge('test-folder', { client }))[0].text, state.text);
});

test('missing revision or access metadata keeps full exports instead of trusting a snapshot', async () => {
  const { state, client } = changingDrive();
  delete state.files[0].version;
  await readDriveKnowledge('test-folder', { client });
  state.text = 'Edited without revision metadata';
  assert.equal((await readDriveKnowledge('test-folder', { client }))[0].text, state.text);
  assert.equal(state.exports, 2);
});

test('chat sends Drive reference text to Gemini and returns its answer with source metadata', async () => {
  let requestBody;
  await withServer(
    {
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_DRIVE_FOLDER_ID: 'test-folder' },
      loadDriveKnowledge: async (folder) => {
        assert.equal(folder, 'test-folder');
        return [{ title: 'Test handbook', text: 'Test company hours: 10 AM to 6 PM.' }];
      },
      fetchImpl: async (url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({
          candidates: [
            {
              content: { parts: [{ text: 'Test hours are 10 AM to 6 PM. Source: Test handbook' }] },
            },
          ],
        });
      },
    },
    async (url) => {
      const response = await ask(url),
        data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.mode, 'gemini');
      assert.match(data.source, /Test handbook/);
      assert.match(requestBody.systemInstruction.parts[0].text, /Test company hours/);
      assert.match(requestBody.systemInstruction.parts[0].text, /reference data/);
      assert.ok(!JSON.stringify(data).includes('test-access-token'));
    },
  );
});

test('Drive failures stop the Gemini request and retain a safe actionable error', async () => {
  let called = false;
  await withServer(
    {
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_DRIVE_FOLDER_ID: 'test-folder' },
      loadDriveKnowledge: async () => {
        throw new DriveKnowledgeError(
          'DRIVE_EMPTY_DOCUMENTS',
          'The knowledge documents are empty.',
        );
      },
      fetchImpl: async () => {
        called = true;
        throw new Error('should not call Gemini');
      },
    },
    async (url) => {
      const response = await ask(url),
        data = await response.json();
      assert.equal(response.status, 503);
      assert.equal(data.code, 'DRIVE_EMPTY_DOCUMENTS');
      assert.equal(called, false);
    },
  );
});
