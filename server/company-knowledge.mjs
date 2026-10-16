import { createHash } from 'node:crypto';
import { AccountError } from './account-errors.mjs';
import { ChatError } from './chat-errors.mjs';
import {
  driveFailure,
  parseGoogleDocLink,
  readDriveKnowledge,
  readGoogleDocument,
} from './google-drive-documents.mjs';
import { onboardingDocumentTopics } from './onboarding-document-topics.mjs';
import {
  createUploadedDocumentIndex,
  quoteUploadedDocuments,
} from './uploaded-document-search.mjs';
import { interleavePassages } from './workspace-company-knowledge.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// Company knowledge for signed-in accounts (issue #32):
//
// - The HR library at /api/hr/company-knowledge (account-routes.mjs): Google Docs
//   that HR links, stored company-wide in Firestore companyDocuments
//   (company-documents.mjs), plus the status of the optional GOOGLE_DRIVE_FOLDER_ID
//   folder. Request and response shapes mirror the guest workspace library of #28.
// - Retrieval for chats owned by an account (`account:<id>`): the connected Docs
//   and the Drive folder, interleaved with the existing company retriever
//   (Vertex AI Search, or the sample guide). Guest workspaces and anonymous
//   browsers never see this library.
//
// Answers use the text saved when HR connected a Doc; connecting the same link
// to the same topic again refreshes it. The Drive folder is read on each turn.
export const driveStatusTtlMs = 30000;
export const isAccountOwner = (owner) => typeof owner === 'string' && owner.startsWith('account:');

const requestErrors = {
  googleDocOnly: () =>
    new AccountError(
      415,
      'GOOGLE_DOC_ONLY',
      'Only Google Docs links are accepted. Paste a Google Docs document link instead of uploading a file.',
    ),
  topicRequired: () =>
    new AccountError(
      400,
      'DOCUMENT_TOPIC_REQUIRED',
      'Choose one of the six onboarding topics or add another related guide.',
    ),
  nameInvalid: () =>
    new AccountError(
      400,
      'DOCUMENT_NAME_INVALID',
      'Give the additional guide a short topic name of up to 80 characters.',
    ),
};
export { requestErrors as companyKnowledgeRequestErrors };

// The status an HR link failure gets, as in #28.
const linkFailureStatus = (code) =>
  code === 'GOOGLE_DOC_LINK_INVALID'
    ? 400
    : ['GOOGLE_DOC_TYPE_REQUIRED', 'GOOGLE_DOC_TOO_LARGE', 'DRIVE_EMPTY_DOCUMENTS'].includes(code)
      ? 422
      : 503;

export function createCompanyKnowledge({
  env = {},
  // createCompanyDocumentStore(...)
  documents,
  // The existing company retriever: retrieve(query, { signal }) -> passages.
  companyRetrieve,
  loadGoogleDoc = readGoogleDocument,
  loadDrive = readDriveKnowledge,
  log = (line) => console.warn(line),
}) {
  const folderId = (env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const logDrive = (operation, code) =>
    log('Company knowledge Drive request failed: ' + JSON.stringify({ operation, code }));

  // The Drive folder's state for the HR library, checked at most every 30 seconds.
  let cachedStatus = null,
    checkedAt = 0,
    checking = null;
  async function driveStatus() {
    if (!folderId) return { state: 'not-configured', documents: [] };
    if (cachedStatus && Date.now() - checkedAt < driveStatusTtlMs) return cachedStatus;
    checking ||= (async () => {
      try {
        const files = await loadDrive(folderId);
        cachedStatus = {
          state: 'connected',
          documents: files.map((file) => ({
            title: file.title,
            googleDocId: file.googleDocId,
            category: file.category,
            characters: file.text.length,
          })),
        };
      } catch (error) {
        const failure = driveFailure(error);
        logDrive('read folder', failure.code);
        cachedStatus = { state: 'unavailable', documents: [], ...failure };
      }
      return cachedStatus;
    })().finally(() => {
      checkedAt = Date.now();
      checking = null;
    });
    return checking;
  }

  // GET /api/hr/company-knowledge
  async function snapshot() {
    const [stored, drive] = await Promise.all([documents.list(), driveStatus()]);
    return {
      documents: stored.map(({ id, title, bytes, created, category, googleDocId, characters }) => ({
        id,
        title,
        bytes,
        created,
        category,
        googleDocId,
        characters,
      })),
      limits: workspaceLimits,
      companyKnowledge: { drive },
      // #28's local-only "move into the company folder" is not offered here.
      driveMoves: { enabled: false, configured: false },
    };
  }

  // POST /api/hr/company-knowledge/documents with { category, url, name }.
  // Returns { id, duplicate: true } or { id, duplicate: false, replaced }.
  async function connect(actorId, body, at) {
    const { category, url, name } = body && typeof body === 'object' ? body : {};
    const topic = onboardingDocumentTopics.find((item) => item.id === category);
    if (!topic && category !== 'additional') throw requestErrors.topicRequired();
    const title = topic?.title || (typeof name === 'string' ? name.trim() : '');
    if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title))
      throw requestErrors.nameInvalid();
    let link, document;
    try {
      link = parseGoogleDocLink(url);
      document = await loadGoogleDoc(link.id);
    } catch (error) {
      const failure = driveFailure(error);
      const status = linkFailureStatus(failure.code);
      if (status === 503) logDrive('read document', failure.code);
      throw new AccountError(status, failure.code, failure.error);
    }
    return documents.connect(
      { category, title, googleDocId: link.id, text: document.text },
      actorId,
      at,
    );
  }

  // Documents for an account's chat: the Drive folder, then connected Docs that
  // are not also in the folder. An empty folder adds nothing; any other Drive
  // failure fails the answer (a failed read never falls back to older text).
  async function library() {
    const [drive, stored] = await Promise.all([
      folderId
        ? loadDrive(folderId).catch((error) => {
            if (error?.code === 'DRIVE_NO_DOCUMENTS') return [];
            const failure = driveFailure(error);
            logDrive('read folder for an answer', failure.code);
            throw new ChatError(503, failure.code, failure.error);
          })
        : [],
      documents.list(),
    ]);
    const shared = new Set(drive.map((doc) => doc.googleDocId).filter(Boolean));
    return [
      ...drive.map(({ title, text }) => ({ title, text })),
      ...stored
        .filter((doc) => !shared.has(doc.googleDocId))
        .map(({ title, text }) => ({ title, text })),
    ];
  }
  let index = null;
  function rank(docs, query) {
    const hash = createHash('sha256')
      .update(JSON.stringify(docs.map(({ title, text }) => [title, text])))
      .digest('hex');
    if (index?.hash !== hash) index = { hash, rank: createUploadedDocumentIndex(docs) };
    return index.rank(query);
  }
  const both = (query, signal) =>
    Promise.all([library(), companyRetrieve(query, signal ? { signal } : undefined)]);

  return {
    driveStatus,
    snapshot,
    connect,
    remove: (id) => documents.remove(id),
    library,
    // Gemini chat: up to six [{ title, heading, text }], the library first.
    async retrieve(query, { signal } = {}) {
      const [docs, company] = await both(query, signal);
      if (!docs.length) return company;
      return interleavePassages(rank(docs, query), company, 6);
    },
    // Document search: ranked passages for quoteSearchResults (which keeps two).
    async quote(question, { signal } = {}) {
      const [docs, company] = await both(question, signal);
      if (!docs.length) return company;
      const own = quoteUploadedDocuments(question, docs).map(
        ({ title, heading, text, preview }) => ({ title, heading, text, excerpt: preview }),
      );
      return interleavePassages(own, company, own.length + company.length);
    },
  };
}
