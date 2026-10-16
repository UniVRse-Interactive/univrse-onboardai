import test from 'node:test';
import assert from 'node:assert/strict';
import { moveGoogleDocumentToFolder } from '../server/google-drive-document-moves.mjs';

const folderId = 'company-folder-123';
const id = 'new-guide-123';
const options = {
  category: 'it',
  name: 'IT & Account Setup Guide',
  text: 'Request your work account from IT.',
};
function fixture() {
  const state = {
    folder: {
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: { canAddChildren: true },
    },
    file: {
      id,
      mimeType: 'application/vnd.google-apps.document',
      parents: ['previous-folder'],
      appProperties: { retained: 'yes' },
      capabilities: { canEdit: true, canMoveItemWithinDrive: true },
    },
    documents: [],
    calls: [],
    patchError: null,
    timeoutAfterMove: false,
  };
  const client = {
    request: async (request) => {
      state.calls.push(structuredClone(request));
      const url = request.url;
      if (request.method === 'PATCH') {
        if (state.patchError) throw state.patchError;
        state.file.parents = [folderId];
        state.file.appProperties = request.data.appProperties;
        if (state.timeoutAfterMove)
          throw new Error('Synthetic timeout after Google accepted the update');
        return { data: state.file };
      }
      if (url.endsWith('/files')) return { data: { files: state.documents } };
      if (url.endsWith('/' + folderId)) return { data: state.folder };
      if (url.endsWith('/export')) return { data: 'Current company guidance.' };
      if (url.endsWith('/' + id)) return { data: structuredClone(state.file) };
      throw new Error('Unexpected API request');
    },
  };
  return { state, client };
}

test('a Google Doc moves into the configured folder once, preserving its identity and metadata', async () => {
  const { state, client } = fixture();
  const moved = await moveGoogleDocumentToFolder(id, folderId, { ...options, client });
  assert.equal(moved.moved, true);
  assert.equal(moved.googleDocId, id);
  const patch = state.calls.find((call) => call.method === 'PATCH');
  assert.equal(patch.params.addParents, folderId);
  assert.equal(patch.params.removeParents, 'previous-folder');
  assert.equal(patch.data.appProperties.retained, 'yes');
  assert.equal(patch.data.appProperties.onboardaiTopic, 'it');
  assert.deepEqual(state.file.parents, [folderId]);
  assert.equal(
    (await moveGoogleDocumentToFolder(id, folderId, { ...options, client })).alreadyInFolder,
    true,
  );
  assert.equal(state.calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.ok(state.calls.every((call) => call.method !== 'POST' && call.method !== 'DELETE'));
});

test('unmovable, inaccessible and non-Google documents fail before changing Google Drive', async () => {
  for (const setting of ['folder', 'source', 'type']) {
    const { state, client } = fixture();
    if (setting === 'folder') state.folder.capabilities.canAddChildren = false;
    if (setting === 'source') state.file.capabilities.canMoveItemWithinDrive = false;
    if (setting === 'type') state.file.mimeType = 'application/pdf';
    await assert.rejects(moveGoogleDocumentToFolder(id, folderId, { ...options, client }), {
      code: setting === 'type' ? 'GOOGLE_DOC_TYPE_REQUIRED' : 'DRIVE_MOVE_PERMISSION_REQUIRED',
    });
    assert.equal(state.calls.filter((call) => call.method === 'PATCH').length, 0);
    assert.deepEqual(state.file.parents, ['previous-folder']);
  }
});

test('a full library or a conflicting core topic cannot be moved into the company library', async () => {
  for (const full of [true, false]) {
    const { state, client } = fixture();
    state.documents = full
      ? Array.from({ length: 12 }, (_, index) => ({
          id: 'existing-guide-' + index,
          name: 'Guide ' + index,
        }))
      : [{ id: 'existing-it-guide', name: 'IT guide', appProperties: { onboardaiTopic: 'it' } }];
    await assert.rejects(moveGoogleDocumentToFolder(id, folderId, { ...options, client }), {
      code: full ? 'DRIVE_TOO_MANY_DOCUMENTS' : 'DRIVE_TOPIC_ALREADY_CONNECTED',
    });
    assert.equal(state.calls.filter((call) => call.method === 'PATCH').length, 0);
  }
});

test('permission failures hide provider details and a lost response is verified without repeating a move', async () => {
  const denied = fixture();
  denied.state.patchError = Object.assign(new Error('private provider token'), {
    response: { status: 403 },
  });
  await assert.rejects(
    moveGoogleDocumentToFolder(id, folderId, { ...options, client: denied.client }),
    (error) =>
      error.code === 'DRIVE_MOVE_PERMISSION_REQUIRED' &&
      !error.message.includes('private provider token'),
  );
  const accepted = fixture();
  accepted.state.timeoutAfterMove = true;
  assert.equal(
    (await moveGoogleDocumentToFolder(id, folderId, { ...options, client: accepted.client })).moved,
    true,
  );
  assert.equal(accepted.state.calls.filter((call) => call.method === 'PATCH').length, 1);
  const unknown = fixture();
  unknown.state.patchError = new Error('Network failed before the move');
  await assert.rejects(
    moveGoogleDocumentToFolder(id, folderId, { ...options, client: unknown.client }),
    { code: 'DRIVE_MOVE_UNCONFIRMED' },
  );
  assert.deepEqual(unknown.state.file.parents, ['previous-folder']);
});
