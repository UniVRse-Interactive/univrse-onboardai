import { createHash } from 'node:crypto';
import { AccountError } from './account-errors.mjs';
import { onboardingDocumentTopics } from './onboarding-document-topics.mjs';
import {
  createUploadedDocumentIndex,
  quoteUploadedDocuments,
} from './uploaded-document-search.mjs';
import { interleavePassages } from './workspace-company-knowledge.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// Company knowledge for signed-in accounts (issues #32 and #35):
//
// - The HR library at /api/hr/company-knowledge (account-routes.mjs): files
//   that HR uploads, read into plain text and stored company-wide in Firestore
//   companyDocuments (company-documents.mjs). Only the extracted text and
//   metadata are kept; the original file never is.
// - Retrieval for chats owned by an account (`account:<id>`): the library,
//   interleaved with the existing company retriever (Vertex AI Search, or the
//   sample guide). Guest workspaces and anonymous browsers never see it.
export const isAccountOwner = (owner) => typeof owner === 'string' && owner.startsWith('account:');

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

export function createCompanyKnowledge({
  // createCompanyDocumentStore(...)
  documents,
  // The existing company retriever: retrieve(query, { signal }) -> passages.
  companyRetrieve,
}) {
  // GET /api/hr/company-knowledge: never the text.
  async function snapshot() {
    const stored = await documents.list();
    return {
      documents: stored.map(({ id, title, fileName, category, characters, bytes, created }) => ({
        id,
        title,
        fileName,
        category,
        characters,
        bytes,
        created,
      })),
      limits: workspaceLimits,
    };
  }

  // The topic title (and its validation) for an upload's query, before the
  // file is read. Returns { category, title }.
  function describe({ category, name }) {
    const topic =
      typeof category === 'string' && onboardingDocumentTopics.find((item) => item.id === category);
    if (!topic && category !== 'additional') throw requestErrors.topicRequired();
    const title = topic?.title || (typeof name === 'string' ? name.trim() : '');
    if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title))
      throw requestErrors.nameInvalid();
    return { category, title };
  }

  // Stores a file read by readUploadedDocument ({ name, text, bytes }) under
  // the described topic. Returns { id, duplicate: true } or
  // { id, duplicate: false, replaced }.
  const add = (actorId, { category, title }, file, at) =>
    documents.add(
      { category, title, fileName: file.name, text: file.text, bytes: file.bytes },
      actorId,
      at,
    );

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
