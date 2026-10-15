import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  readDriveKnowledge,
  DriveKnowledgeError,
  driveFailure,
} from '../server/google-drive-documents.mjs';
import { createApp } from '../server/api-routes.mjs';

function driveClient(text, listing = { files: [{ id: 'doc-1', name: 'Test handbook' }] }) {
  return {
    request: async (options) =>
      options.url.endsWith('/export') ? { data: text } : { data: listing },
  };
}

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
    [driveClient('a'.repeat(120001)), 'DRIVE_KNOWLEDGE_TOO_LARGE'],
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

test('missing Google login explains the required Drive authentication without leaking provider details', () => {
  const failure = driveFailure(
    new Error('Could not load the default credentials. private-provider-details'),
  );
  assert.equal(failure.code, 'DRIVE_AUTH_REQUIRED');
  assert.match(failure.error, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(failure.error, /Gemini API key and folder ID alone are not enough/);
  assert.ok(!JSON.stringify(failure).includes('private-provider-details'));
});

async function withServer(options, callback) {
  const server = createApp(options).listen(0, '127.0.0.1');
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
    { title: 'Policy', text: 'Current policy' },
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
      env: { GEMINI_API_KEY: 'test-server-key', GOOGLE_DRIVE_FOLDER_ID: 'test-folder' },
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
      assert.ok(!JSON.stringify(data).includes('test-server-key'));
    },
  );
});

test('Drive failures stop the Gemini request and retain a safe actionable error', async () => {
  let called = false;
  await withServer(
    {
      env: { GEMINI_API_KEY: 'test-server-key', GOOGLE_DRIVE_FOLDER_ID: 'test-folder' },
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
