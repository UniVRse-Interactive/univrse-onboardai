import { createHash } from 'node:crypto';
import { AccountError } from './account-errors.mjs';
import { documentCategories, onboardingDocumentTopics } from './onboarding-document-topics.mjs';
import {
  createUploadedDocumentIndex,
  quoteUploadedDocuments,
} from './uploaded-document-search.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// Company knowledge for signed-in accounts (issues #32 and #35):
//
// - The HR library at /api/hr/company-knowledge (account-routes.mjs): files
//   that HR uploads, read into plain text and stored company-wide in Firestore
//   companyDocuments (company-documents.mjs). Only the extracted text and
//   metadata are kept; the original file never is.
// - Retrieval for chats owned by an account (`account:<id>`): the library,
//   interleaved with the existing company retriever (Vertex AI Search, or the
//   sample guide).
export const isAccountOwner = (owner) => typeof owner === 'string' && owner.startsWith('account:');

// Up to `limit` passages, alternating between two ranked lists (first list first),
// so each source keeps its own rank order and neither crowds out the other.
export function interleavePassages(first, second, limit) {
  const merged = [];
  for (let i = 0; merged.length < limit && (i < first.length || i < second.length); i++) {
    if (i < first.length) merged.push(first[i]);
    if (merged.length < limit && i < second.length) merged.push(second[i]);
  }
  return merged;
}

const requestErrors = {
  fileRequired: () =>
    new AccountError(
      415,
      'FILE_UPLOAD_REQUIRED',
      'Upload a PDF, Word (.docx), text or Markdown file. Google Docs links are no longer accepted.',
    ),
  topicRequired: () =>
    new AccountError(
      400,
      'DOCUMENT_TOPIC_REQUIRED',
      'Choose one of the five onboarding areas or Other useful guidance.',
    ),
  nameInvalid: () =>
    new AccountError(
      400,
      'DOCUMENT_NAME_INVALID',
      'Give the document a short name of one line and up to 80 characters, or leave the name out to use the file name.',
    ),
};
export { requestErrors as companyKnowledgeRequestErrors };

const validTitle = (title) =>
  Boolean(title) && title.length <= 80 && !/[\u0000-\u001f\u007f]/.test(title);

// A document's title from its file name: no extension, no control characters,
// at most 80 characters.
export function titleFromFileName(fileName) {
  const base = String(fileName ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return base || 'Company document';
}

// What the HR page sees of a stored document: never the text.
const documentView = ({ id, title, fileName, category, characters, bytes, created }) => ({
  id,
  title,
  fileName,
  category,
  characters,
  bytes,
  created,
});

export function createCompanyKnowledge({
  // createCompanyDocumentStore(...)
  documents,
  // The existing company retriever: retrieve(query, { signal }) -> passages.
  companyRetrieve,
}) {
  // GET /api/hr/company-knowledge: never the text.
  async function snapshot() {
    return {
      topics: onboardingDocumentTopics,
      documents: (await documents.list()).map(documentView),
      limits: workspaceLimits,
    };
  }

  // Validates an upload's query before the file is read: the category (an
  // area id or 'additional') and the optional document name. Returns
  // { category, name } where name is HR's trimmed name or null (the file name
  // is then the title).
  function describe({ category, name }) {
    if (typeof category !== 'string' || !documentCategories.includes(category))
      throw requestErrors.topicRequired();
    if (name === undefined) return { category, name: null };
    const title = typeof name === 'string' ? name.trim() : '';
    if (!validTitle(title)) throw requestErrors.nameInvalid();
    return { category, name: title };
  }

  // Stores a file read by readUploadedDocument ({ name, text, bytes }) in the
  // described area. Returns { id, duplicate: true } or { id, duplicate: false }.
  const add = (actorId, { category, name }, file, at) =>
    documents.add(
      {
        category,
        title: name ?? titleFromFileName(file.name),
        fileName: file.name,
        text: file.text,
        bytes: file.bytes,
      },
      actorId,
      at,
    );

  // PATCH /api/hr/company-knowledge/documents/:id { category }. `audit` runs
  // the move inside the company_document_moved audit row. Resolves to
  // { document } (no audit row when the document is already there).
  async function move(id, body, audit) {
    const category = body && typeof body === 'object' ? body.category : undefined;
    if (typeof category !== 'string' || !documentCategories.includes(category))
      throw requestErrors.topicRequired();
    const before = await documents.get(id);
    if (before.category === category) return { document: documentView(before) };
    const moved = await audit({ documentId: before.id, from: before.category, to: category }, () =>
      documents.move(id, category),
    );
    return { document: documentView(moved) };
  }

  const library = async () => (await documents.list()).map(({ title, text }) => ({ title, text }));
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
    snapshot,
    describe,
    add,
    move,
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
