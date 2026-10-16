import { createHash } from 'node:crypto';
import { quoteSearchResults } from './document-search.mjs';
import {
  CompanySearchError,
  searchConfigProblem,
  searchFailure,
  vertexSearchConfig,
} from './vertex-ai-search.mjs';
import {
  createUploadedDocumentIndex,
  quoteUploadedDocuments,
} from './uploaded-document-search.mjs';

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

// The shared company documents (Vertex AI Search, when VERTEX_SEARCH_ENGINE_ID is
// set) plus this browser workspace's own uploads. Uploads stay scoped to the
// workspace that owns them, and no chat or report data is merged. Without a
// search engine the workspace answers from its uploads only: the built-in
// sample guide is never mixed into HR's uploaded company guidance.
// Company search failures surface as CompanySearchError (fixed SEARCH_* codes).
export function createWorkspaceKnowledge({ env = {}, companyRetrieve, uploaded }) {
  const config = vertexSearchConfig(env);
  const companySearch = Boolean(config);
  const indexes = new Map();

  function uploadIndex(owner) {
    const documents = uploaded(owner);
    const hash = createHash('sha256')
      .update(JSON.stringify(documents.map(({ title, text }) => [title, text])))
      .digest('hex');
    const cached = indexes.get(owner);
    if (cached?.hash === hash) return cached.rank;
    if (!cached && indexes.size >= 100) indexes.delete(indexes.keys().next().value);
    const rank = createUploadedDocumentIndex(documents);
    indexes.set(owner, { hash, rank });
    return rank;
  }
  const company = async (query, signal) =>
    companySearch ? companyRetrieve(query, { signal }) : [];

  return {
    // Whether the shared company document search is configured on this server.
    companySearch,
    // False when an employee question would have nothing to search.
    hasKnowledge: (owner) => companySearch || uploaded(owner).length > 0,
    // Gemini mode: up to six [{ title, heading, text }] for the chat workflow.
    async retrieve(owner, query, { signal } = {}) {
      const uploads = uploadIndex(owner)(query);
      return interleavePassages(await company(query, signal), uploads, 6);
    },
    // Search-only mode: up to two quoted [{ title, heading, text, preview }].
    async quote(owner, question, { signal } = {}) {
      const uploads = quoteUploadedDocuments(question, uploaded(owner));
      const shared = quoteSearchResults(await company(question, signal)).passages;
      return interleavePassages(shared, uploads, 2);
    },
    // Company-source status for the HR document library. Vertex AI Search is not
    // probed (every probe would be a billed search); only its settings are checked.
    status() {
      if (!config) return { state: 'not-configured', documents: [] };
      if (searchConfigProblem(config)) {
        const { code, error } = searchFailure(new CompanySearchError('SEARCH_NOT_CONFIGURED'));
        return { state: 'unavailable', documents: [], code, error };
      }
      return { state: 'configured', documents: [] };
    },
  };
}
