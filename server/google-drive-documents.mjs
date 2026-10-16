import { GoogleAuth } from 'google-auth-library';
import { workspaceLimits } from './workspace-limits.mjs';
import { onboardingDocumentTopics } from './onboarding-document-topics.mjs';

// Read-only Google Drive access for the HR company-knowledge library (from #28):
// single Google Docs that HR links, and the optional GOOGLE_DRIVE_FOLDER_ID
// folder. Credentials are Application Default Credentials with the
// drive.readonly scope. A local `gcloud auth application-default login` has no
// Drive scope, so Drive answers 403 and the library shows DRIVE_ACCESS_DENIED.
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

// Each authenticated client keeps its own small, in-memory document snapshot.
// We still list Drive on every turn to check versions, removals and download access.
const snapshots = new WeakMap();

export class DriveKnowledgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DriveKnowledgeError';
    this.code = code;
  }
}

export function parseGoogleDocLink(value) {
  let url;
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    url = new URL(value.trim());
  } catch {
    throw new DriveKnowledgeError(
      'GOOGLE_DOC_LINK_INVALID',
      'Paste a Google Docs document link beginning with https://docs.google.com/document/d/.',
    );
  }
  const id = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{8,200})(?:\/|$)/)?.[1];
  if (url.origin !== 'https://docs.google.com' || url.username || url.password || !id)
    throw new DriveKnowledgeError(
      'GOOGLE_DOC_LINK_INVALID',
      'Use a native Google Docs document link. Links to PDFs, Word files, Sheets and other websites are not supported.',
    );
  return { id, url: `https://docs.google.com/document/d/${id}/edit` };
}

// Verify the real Drive file type; changing a link or filename cannot bypass this check.
export async function readGoogleDocument(id, { client: suppliedClient } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(id))
    throw new DriveKnowledgeError(
      'GOOGLE_DOC_LINK_INVALID',
      'Choose a valid Google Docs document.',
    );
  const client = suppliedClient || (await auth.getClient());
  const endpoint = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id);
  const { data: file } = await client.request({
    url: endpoint,
    timeout: 15000,
    params: { fields: 'id,mimeType,trashed,capabilities(canDownload)', supportsAllDrives: true },
  });
  if (file.trashed || file.mimeType !== 'application/vnd.google-apps.document')
    throw new DriveKnowledgeError(
      'GOOGLE_DOC_TYPE_REQUIRED',
      'Only native Google Docs are accepted. Open the file in Google Docs and save it as a Google Doc first.',
    );
  if (file.capabilities?.canDownload === false)
    throw new DriveKnowledgeError(
      'DRIVE_DOCUMENT_RESTRICTED',
      'This Google Doc cannot be read with the current permissions. Ask the document owner to allow the connected company account to read it.',
    );
  const exported = await client.request({
    url: endpoint + '/export',
    timeout: 15000,
    params: { mimeType: 'text/plain' },
    responseType: 'text',
    maxContentLength: workspaceLimits.bytes,
  });
  const text = String(exported.data).trim();
  if (!text)
    throw new DriveKnowledgeError(
      'DRIVE_EMPTY_DOCUMENTS',
      'This Google Doc is empty. Add the guidance and let Google Docs save it before connecting it.',
    );
  if (text.length > workspaceLimits.characters)
    throw new DriveKnowledgeError(
      'GOOGLE_DOC_TOO_LARGE',
      'This Google Doc is too long. Connect a shorter guide with up to 250,000 readable characters.',
    );
  return { text };
}

// Never forward raw Google errors, request headers, credentials or document
// contents to the browser. Only these known, actionable messages are public.
export function driveFailure(error) {
  if (error instanceof DriveKnowledgeError) {
    return { error: error.message, code: error.code };
  }
  const status = error?.response?.status;
  if (status === 401 || error?.code === 'ENOENT') {
    return {
      code: 'DRIVE_AUTH_REQUIRED',
      error:
        'Google Drive authentication is unavailable. Reconnect the local Google credentials, then try again.',
    };
  }
  if (status === 403) {
    return {
      code: 'DRIVE_ACCESS_DENIED',
      error:
        "Google Drive access was denied. Check the folder's Viewer sharing and the service account's authentication permissions.",
    };
  }
  if (status === 404) {
    return {
      code: 'DRIVE_NOT_FOUND',
      error:
        'The knowledge folder or a document could not be found. Check the selected folder and its sharing permissions.',
    };
  }
  if (status === 429) {
    return {
      code: 'DRIVE_RATE_LIMIT',
      error: 'Google Drive is temporarily limiting requests. Please wait a moment and try again.',
    };
  }
  return {
    code: 'DRIVE_UNAVAILABLE',
    error:
      'Company documents could not be read from Google Drive. Please try again or ask the administrator to check the connection.',
  };
}

export async function readDriveKnowledge(folderId, { client: suppliedClient } = {}) {
  if (!folderId || !/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new DriveKnowledgeError(
      'DRIVE_FOLDER_INVALID',
      'Set a valid Google Drive knowledge folder ID before asking a company question.',
    );
  }

  const client = suppliedClient || (await auth.getClient());

  const listing = await client.request({
    url: 'https://www.googleapis.com/drive/v3/files',
    timeout: 15000,
    params: {
      q:
        `'${folderId}' in parents ` +
        'and trashed = false ' +
        "and mimeType = 'application/vnd.google-apps.document'",
      fields:
        'nextPageToken,files(id,name,version,modifiedTime,appProperties,capabilities(canDownload))',
      pageSize: workspaceLimits.files,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });

  if (listing.data.nextPageToken) {
    throw new DriveKnowledgeError(
      'DRIVE_TOO_MANY_DOCUMENTS',
      'The knowledge folder supports up to twelve Google Docs. Remove an unused document before adding another.',
    );
  }

  const files = listing.data.files || [];

  let folders = snapshots.get(client);
  if (!folders) {
    folders = new Map();
    snapshots.set(client, folders);
  }
  const previous = folders.get(folderId) || new Map();
  // Drop the old snapshot before loading. Failed reads never fall back to it.
  folders.delete(folderId);
  const nextSnapshot = new Map();

  if (files.length === 0) {
    throw new DriveKnowledgeError(
      'DRIVE_NO_DOCUMENTS',
      'No Google Docs were found directly inside the knowledge folder. Add a Google Doc with company guidance, then try again.',
    );
  }

  const documents = await Promise.all(
    files.map(async (file) => {
      const category = file.appProperties?.onboardaiTopic;
      const topic = onboardingDocumentTopics.find((item) => item.id === category);
      const metadata = {
        googleDocId: file.id,
        title:
          topic?.title ||
          (category === 'additional' && file.appProperties?.onboardaiLabel) ||
          file.name,
        category: topic ? topic.id : category === 'additional' ? category : '',
      };
      if (file.capabilities?.canDownload === false) {
        throw new DriveKnowledgeError(
          'DRIVE_DOCUMENT_RESTRICTED',
          'A company document cannot be exported with the current Drive permissions. Ask the administrator to review its access.',
        );
      }
      // If version/access metadata is unavailable, use the original full export.
      const revision =
        typeof file.version === 'string' &&
        typeof file.modifiedTime === 'string' &&
        file.capabilities?.canDownload === true
          ? JSON.stringify([file.version, file.modifiedTime, file.name, file.appProperties])
          : null;
      const saved = previous.get(file.id);
      if (revision && saved?.revision === revision) {
        nextSnapshot.set(file.id, saved);
        return { ...metadata, text: saved.text };
      }
      const exported = await client.request({
        url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '/export',
        timeout: 15000,
        params: {
          mimeType: 'text/plain',
        },
        responseType: 'text',
      });

      const text = String(exported.data).trim();
      if (revision) nextSnapshot.set(file.id, { revision, text });
      return { ...metadata, text };
    }),
  );

  const readable = documents.filter((doc) => doc.text);

  if (readable.length === 0) {
    throw new DriveKnowledgeError(
      'DRIVE_EMPTY_DOCUMENTS',
      'The Google Docs in the knowledge folder are empty. Add company guidance and wait for it to save, then try again.',
    );
  }

  const totalCharacters = readable.reduce((total, doc) => total + doc.text.length, 0);

  if (totalCharacters > workspaceLimits.totalCharacters) {
    throw new DriveKnowledgeError(
      'DRIVE_KNOWLEDGE_TOO_LARGE',
      `The connected documents contain ${totalCharacters.toLocaleString('en-US')} characters. The library supports 750,000; use shorter guides before trying again.`,
    );
  }

  // Bounded even if a development process checks several different folders.
  if (folders.size >= 4) folders.delete(folders.keys().next().value);
  folders.set(folderId, nextSnapshot);
  return readable;
}
