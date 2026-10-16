import { GoogleAuth } from 'google-auth-library';
import { DriveKnowledgeError, readDriveKnowledge } from './google-drive-documents.mjs';
import { onboardingDocumentTopics } from './onboarding-document-topics.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// Reads retain their separate read-only client. This client uses existing Google
// credentials and needs permission to edit the source and destination folder.
const writer = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
const pending = new Map();
const endpoint = 'https://www.googleapis.com/drive/v3/files/';
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(id);
function failure(code, message, statusCode = 409) {
  return Object.assign(new DriveKnowledgeError(code, message), { statusCode });
}

export function localDocumentMovesAllowed(env, req) {
  return (
    env.GOOGLE_DRIVE_DOCUMENT_MOVES === 'enabled' &&
    !!env.GOOGLE_DRIVE_FOLDER_ID &&
    env.NODE_ENV !== 'production' &&
    !env.K_SERVICE &&
    !req.app.get('trust proxy') &&
    !req.get('x-forwarded-for') &&
    !req.get('forwarded') &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname)
  );
}

// Serialise local imports so concurrent requests cannot overfill the folder.
export async function moveGoogleDocumentToFolder(id, folderId, options) {
  if (!validId(id) || !validId(folderId) || id === folderId)
    throw failure('DRIVE_MOVE_INVALID', 'Choose a valid Google Doc and company folder.', 400);
  const previous = pending.get(folderId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => move(id, folderId, options));
  pending.set(folderId, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(folderId) === operation) pending.delete(folderId);
  }
}

async function move(id, folderId, { category, name, text, client: suppliedClient } = {}) {
  if (
    (!onboardingDocumentTopics.some((item) => item.id === category) && category !== 'additional') ||
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 80 ||
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > workspaceLimits.characters
  )
    throw failure(
      'DRIVE_MOVE_INVALID',
      'Choose an onboarding topic and a readable Google Doc.',
      400,
    );
  let client;
  try {
    client = suppliedClient || (await writer.getClient());
    const [{ data: folder }, { data: file }] = await Promise.all([
      client.request({
        url: endpoint + folderId,
        timeout: 15000,
        params: {
          fields: 'id,mimeType,trashed,driveId,capabilities(canAddChildren)',
          supportsAllDrives: true,
        },
      }),
      client.request({
        url: endpoint + id,
        timeout: 15000,
        params: {
          fields:
            'id,mimeType,trashed,driveId,parents,appProperties,capabilities(canEdit,canMoveItemWithinDrive,canMoveItemOutOfDrive)',
          supportsAllDrives: true,
        },
      }),
    ]);
    if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder')
      throw failure('DRIVE_FOLDER_INVALID', 'The configured company folder is unavailable.', 503);
    if (file.trashed || file.mimeType !== 'application/vnd.google-apps.document')
      throw failure(
        'GOOGLE_DOC_TYPE_REQUIRED',
        'Only native Google Docs can be added to the company folder.',
        422,
      );
    const alreadyInFolder = file.parents?.includes(folderId) === true;
    if (
      alreadyInFolder &&
      file.appProperties?.onboardaiTopic === category &&
      file.appProperties?.onboardaiLabel === name
    )
      return { googleDocId: id, alreadyInFolder: true, moved: false };
    const canMove =
      file.driveId === folder.driveId
        ? file.capabilities?.canMoveItemWithinDrive
        : file.capabilities?.canMoveItemOutOfDrive;
    if (
      file.capabilities?.canEdit !== true ||
      (!alreadyInFolder &&
        (folder.capabilities?.canAddChildren !== true || canMove !== true || !file.parents?.length))
    )
      throw failure(
        'DRIVE_MOVE_PERMISSION_REQUIRED',
        'The connected company account needs Editor access to this Google Doc and permission to move it into the company folder.',
        403,
      );
    let documents;
    try {
      documents = await readDriveKnowledge(folderId, { client });
    } catch (error) {
      if (error.code === 'DRIVE_NO_DOCUMENTS') documents = [];
      else throw error;
    }
    const others = documents.filter((document) => document.googleDocId !== id);
    if (!alreadyInFolder && documents.length >= workspaceLimits.files)
      throw failure(
        'DRIVE_TOO_MANY_DOCUMENTS',
        'The company folder has twelve Google Docs. Ask HR to organise the folder before adding another.',
      );
    if (
      others.reduce((total, document) => total + document.text.length, 0) + text.length >
      workspaceLimits.totalCharacters
    )
      throw failure(
        'DRIVE_KNOWLEDGE_TOO_LARGE',
        'These guides exceed the company library’s readable text limit. Use a shorter guide.',
      );
    if (category !== 'additional' && others.some((document) => document.category === category))
      throw failure(
        'DRIVE_TOPIC_ALREADY_CONNECTED',
        'This topic already has a Google Doc in the company folder. Update that document or add a different related guide.',
      );
    const params = { fields: 'id,parents,appProperties', supportsAllDrives: true };
    if (!alreadyInFolder) {
      params.addParents = folderId;
      params.removeParents = file.parents.join(',');
    }
    try {
      const { data: saved } = await client.request({
        method: 'PATCH',
        url: endpoint + id,
        params,
        timeout: 15000,
        retry: false,
        data: {
          appProperties: { ...file.appProperties, onboardaiTopic: category, onboardaiLabel: name },
        },
      });
      if (!saved.parents?.includes(folderId) || saved.appProperties?.onboardaiTopic !== category)
        throw failure(
          'DRIVE_MOVE_UNCONFIRMED',
          'Google Drive has not confirmed this move. Refresh the library before trying again.',
          503,
        );
    } catch (error) {
      // A timeout may happen after Google has completed a move. Verify once;
      // do not repeat a write or claim that an unconfirmed move succeeded.
      if (error.response?.status === 403 || error.response?.status === 401) throw error;
      const { data: check } = await client.request({
        url: endpoint + id,
        timeout: 15000,
        params: { fields: 'parents,appProperties', supportsAllDrives: true },
      });
      if (
        !check.parents?.includes(folderId) ||
        check.appProperties?.onboardaiTopic !== category ||
        check.appProperties?.onboardaiLabel !== name
      )
        throw failure(
          'DRIVE_MOVE_UNCONFIRMED',
          'Google Drive has not confirmed this move. Refresh the library before trying again.',
          503,
        );
    }
    return { googleDocId: id, alreadyInFolder, moved: !alreadyInFolder };
  } catch (error) {
    if (error instanceof DriveKnowledgeError) throw error;
    if (error.response?.status === 403)
      throw failure(
        'DRIVE_MOVE_PERMISSION_REQUIRED',
        'Google Drive did not allow the move. Check Editor access to the document and company folder, and the server’s Google Drive write permission.',
        403,
      );
    throw failure(
      'DRIVE_MOVE_UNAVAILABLE',
      'The document could not be saved to the company folder. Check the Google connection and try again.',
      503,
    );
  }
}
