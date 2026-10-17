// Pure helpers and user-facing text for the HR Company Documentation page.
export const acceptedExtensions = ['.pdf', '.docx', '.txt', '.md'];
export const acceptAttribute = acceptedExtensions.join(',');
export const maxUploadBytes = 5 * 1024 * 1024;
export const maxNameLength = 80;

export const knowledgeText = {
  heading: 'Five areas. A clearer start.',
  intro:
    'Each area holds as many documents as you need. Upload a PDF, Word (.docx), text or Markdown file, up to 5 MB.',
  privacy: 'The text is shared with every employee’s Alya. The original file is not kept.',
  uploadAction: 'Upload document',
  uploading: 'Uploading…',
  addAnother: 'Add another document',
  emptyArea: 'No documents yet',
  moveAction: 'Move to…',
  moveLabel: 'Move to',
  moveConfirm: 'Move',
  cancel: 'Cancel',
  removeAction: 'Remove',
  confirmRemove: 'Remove this document? New answers will use the remaining company guidance.',
  confirmRemoveAction: 'Yes, remove',
  keep: 'Keep',
  nameLabel: 'Document name (optional)',
  namePlaceholder: 'For example, Workplace Safety',
  chooseFile: 'Choose a file',
  limitReached: 'The library is full. Remove a document before adding another.',
  syncingStatus: 'Real-time AI Index Syncing…',
  syncCompletedStatus: 'Real-time AI Index Syncing: Completed',
  replaceAction: 'Replace file',
  replaceChooseFile: 'Choose the new version',
  replacing: 'Replacing…',
  replaceConfirm: 'Replace',
  addSeparate: 'Add as separate',
  replacePromptLabel: 'Same title in this area',
  replacedStatus: 'The new version will be searchable in about a minute.',
  replaceIdentical: 'This file is identical to the current version, so nothing changed.',
};

export function formatCharacters(count) {
  return Number(count || 0).toLocaleString('en-US') + ' characters';
}

// Returns 'syncing', 'completed', or '' for a document row in the HR library.
export function documentSyncState(syncByDocId, documentId) {
  const state = syncByDocId?.[documentId];
  return state === 'syncing' || state === 'completed' ? state : '';
}

export function uploadProgressMessage(fileName) {
  return `Uploading ${fileName} — ${knowledgeText.syncingStatus}`;
}

// An optional document name: '' is fine (the file name becomes the title).
// Returns an error message, or '' when the name is acceptable.
export function validateDocumentName(value) {
  const name = String(value ?? '').trim();
  if (name.length > maxNameLength) return `Keep the name to ${maxNameLength} characters or fewer.`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Use a single line for the name.';
  return '';
}

// Returns an error message, or '' when the file can be sent.
export function validateUploadFile(file) {
  if (!file) return 'Choose a file to upload.';
  const dot = String(file.name || '').lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase();
  if (!acceptedExtensions.includes(extension))
    return 'Upload a PDF, Word (.docx), text or Markdown file.';
  if (!file.size) return 'That file is empty.';
  if (file.size > maxUploadBytes) return 'That file is larger than 5 MB.';
  return '';
}

// Describes the upload request; the caller passes it to the request adapter.
// `category` is an area id or 'additional'. A blank name is left out, so the
// server titles the document after its file name.
// `replaces` (a current document id) files the file as that document's next
// version; without `name` the new version keeps the old title.
export function buildUploadRequest(base, { category, name, replaces }, file) {
  const query = new URLSearchParams({ category });
  const title = String(name ?? '').trim();
  if (title) query.set('name', title);
  if (replaces) query.set('replaces', String(replaces));
  return {
    url: base.replace(/\/+$/, '') + '/documents?' + query.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    rawBody: file,
  };
}

// POST …/documents answers { id, duplicate }: an upload only ever adds.
export function uploadSuccessMessage(result, fileName, areaTitle) {
  const where = areaTitle ? ` in ${areaTitle}` : '';
  if (result?.duplicate) return `This document is already${where}.`;
  return `Uploaded ${fileName}${areaTitle ? ` to ${areaTitle}` : ''}. Alya will use it in the next answer.`;
}

// POST …/documents?replaces= answers 201 { id, duplicate: false, replaced: { id, cleanup } }
// or 200 { id, duplicate: true, replaced: null } (same text: nothing changed).
// cleanup 'pending' needs nothing from HR, so both read the same.
export function replaceSuccessMessage(result) {
  if (result?.duplicate) return knowledgeText.replaceIdentical;
  return knowledgeText.replacedStatus;
}

const extensionPattern = /\.(?:pdf|docx|txt|md)$/;
// Underscores are already spaces when this runs, so a date may use a space too.
const versionToken =
  /(?:(?:^|[\s\-.])(?:v\d+|version \d+|rev \d+|final|draft|\d{4}[-. ]\d{2}(?:[-. ]\d{2})?)|\s*\(\d+\))$/;

// A title reduced to what stays the same between versions of a document:
// lower case, one space between words, no file extension and no one trailing
// version token (v2, version 2, rev 2, (2), final, draft or a date).
export function normaliseTitle(value) {
  const clean = (text) => text.replace(/[\s_]+/g, ' ').trim();
  const base = clean(String(value ?? '').toLowerCase()).replace(extensionPattern, '');
  const trimmed = clean(base);
  const stripped = clean(trimmed.replace(versionToken, ''));
  return stripped || trimmed;
}

// The document in `documents` (one area's list, oldest first) whose normalised
// title equals the one being uploaded; the newest match wins. `name` is the
// typed title, else the file name is used.
export function findSameTitleDocument(documents, { name, fileName }) {
  const wanted = normaliseTitle(String(name ?? '').trim() || fileName);
  if (!wanted || !Array.isArray(documents)) return null;
  const matches = documents.filter(
    (document) => normaliseTitle(document?.title || document?.fileName) === wanted,
  );
  return matches[matches.length - 1] || null;
}

const dateParts = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };

// "3 March 2026" from connectedAt (ISO), falling back to created (ms); '' if neither is usable.
export function formatUploadedDate(document) {
  for (const value of [document?.connectedAt, document?.created]) {
    if (value == null || value === '') continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('en-GB', dateParts);
  }
  return '';
}

export function sameTitlePrompt(document) {
  const date = formatUploadedDate(document);
  const title = document?.title || document?.fileName || 'Uploaded document';
  return `Replace '${title}'${date ? ` (uploaded ${date})` : ''} with this file, or add it as a separate document?`;
}

// "Version 2 · Uploaded 3 March 2026". Version is always shown (legacy reads as 1).
export function versionLine(document) {
  const version =
    Number.isInteger(document?.version) && document.version >= 1 ? document.version : 1;
  const date = formatUploadedDate(document);
  return `Version ${version}` + (date ? ` · Uploaded ${date}` : '');
}

export function moveSuccessMessage(title, areaTitle) {
  return `Moved “${title}” to ${areaTitle}.`;
}

export function removeSuccessMessage(title) {
  return `Removed “${title}”. New answers use the remaining company guidance.`;
}

export const rateLimitMessage = 'That’s a lot of changes at once. Wait a minute, then try again.';

const errorMessages = {
  upload: {
    COMPANY_DOCUMENT_DUPLICATE:
      'This document is already in another area. Use Move to… on that document instead.',
    DOCUMENT_NAME_INVALID:
      'Give the document a name of one line and up to 80 characters, or leave the name empty.',
    DOCUMENT_TOPIC_REQUIRED: 'That area is no longer available. Refresh the page and try again.',
  },
  replace: {
    COMPANY_DOCUMENT_DUPLICATE:
      'This text is already in the library as another document. Choose a different file.',
    WORKSPACE_DOCUMENT_NOT_FOUND: 'That document was already removed. The list has been refreshed.',
  },
  move: {
    COMPANY_DOCUMENT_DUPLICATE:
      'A document with the same text is already in that area, so this one stays where it is.',
    DOCUMENT_TOPIC_REQUIRED: 'That area is no longer available. Refresh the page and try again.',
    WORKSPACE_DOCUMENT_NOT_FOUND: 'That document was already removed. The list has been refreshed.',
  },
  remove: {
    WORKSPACE_DOCUMENT_NOT_FOUND: 'That document was already removed. The list has been refreshed.',
  },
};

const fallbacks = {
  upload: 'The document could not be uploaded. Please try again.',
  replace: 'The file could not be replaced. Please try again.',
  move: 'The document could not be moved. Please try again.',
  remove: 'The document could not be removed. Please try again.',
};

// Calm wording for a failed upload, move or remove. Codes the page knows map
// to their own text; anything else keeps the server's message.
export function knowledgeErrorMessage(error, action = 'upload') {
  if (error?.status === 429) return rateLimitMessage;
  const known = errorMessages[action]?.[error?.code];
  if (known) return known;
  return error?.message || fallbacks[action] || fallbacks.upload;
}

// Whether the page should reload the library after this error (the document
// it acted on is gone, or the areas changed underneath it).
export function errorNeedsRefresh(error) {
  return [
    'WORKSPACE_DOCUMENT_NOT_FOUND',
    'DOCUMENT_TOPIC_REQUIRED',
    'COMPANY_DOCUMENT_ALREADY_REPLACED',
  ].includes(error?.code);
}
