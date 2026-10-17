import { tasks } from './sample-onboarding-content.mjs';
import {
  createVertexSearch,
  searchConfigProblem,
  vertexSearchConfig,
} from './vertex-ai-search.mjs';

// Where company passages come from. VERTEX_SEARCH_ENGINE_ID switches on Vertex AI
// Search; without it the server uses the built-in, unapproved sample guide so
// local development keeps working with no Google Cloud data store.
export function knowledgeMode(env) {
  return vertexSearchConfig(env) ? 'vertex-ai-search' : 'sample-tasks';
}

// The answer modes that search company documents.
const searchingModes = ['gemini-chat', 'document-search'];

export class KnowledgeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnowledgeConfigError';
  }
}

// Throws KnowledgeConfigError when a searching mode would use Vertex AI Search
// without DOCS_BUCKET. Chat admits only passages of active company documents
// (active-company-documents.mjs), which it recognises by their gs:// URI in
// that bucket; without it every passage would be withheld. The api and the
// local server refuse to start instead (createApp itself withholds them all).
export function checkKnowledgeConfig(env = {}) {
  if (!searchingModes.includes(env.AI_MODE) || !vertexSearchConfig(env)) return;
  if (String(env.DOCS_BUCKET || '').trim()) return;
  throw new KnowledgeConfigError(
    'VERTEX_SEARCH_ENGINE_ID is set without DOCS_BUCKET. Chat uses only passages of active company documents and needs the documents bucket name to recognise them. Set DOCS_BUCKET, or leave VERTEX_SEARCH_ENGINE_ID blank to use the sample guide.',
  );
}

export function describeKnowledgeSource(env) {
  const config = vertexSearchConfig(env);
  if (!config) return 'the sample onboarding guide (VERTEX_SEARCH_ENGINE_ID is not set)';
  const problem = searchConfigProblem(config);
  return `Vertex AI Search engine ${config.engine} (${config.location})${problem ? `, incomplete: ${problem}; company questions will fail` : ''}`;
}

export const sampleSourceTitle = 'Sample onboarding guide (confirm with HR)';

const stopWords = new Set(
  'a an and are as at be can could do does for from have how i if in is it me my of on or our please should tell that the their there this to us was we what when where which who why will with would you your company univrse'.split(
    ' ',
  ),
);
const termsOf = (value) =>
  new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
      (word) => word.length > 2 && !stopWords.has(word),
    ),
  );

// Sample tasks that share a meaningful word with the query. The text says it is
// unapproved so Gemini (and the search preview) present it as sample guidance.
export function samplePassages(query) {
  const wanted = termsOf(typeof query === 'string' ? query : '');
  return tasks
    .map((task) => {
      const guidance = [
        task.summary,
        'Steps:',
        ...task.steps.map((step, i) => `${i + 1}. ${step}`),
        task.verification,
      ].join('\n');
      return {
        matches: [...termsOf(task.title + ' ' + guidance)].some((term) => wanted.has(term)),
        passage: {
          title: sampleSourceTitle,
          heading: task.title,
          text: 'Unapproved sample guidance: confirm with HR before relying on it.\n' + guidance,
        },
      };
    })
    .filter((item) => item.matches)
    .map((item) => item.passage);
}

// retrieve(query, { signal, pageSize }) -> [{ title, heading, text, excerpt?,
// uri?, vertexId? }] in rank order. pageSize (Vertex AI Search only) asks for
// that many results instead of 5; the sample guide ignores it.
export function createCompanyRetriever({ env = {}, fetchImpl, getAccessToken, log } = {}) {
  const config = vertexSearchConfig(env);
  if (!config) return async (query) => samplePassages(query);
  const search = createVertexSearch({ config, fetchImpl, getAccessToken, log });
  return (query, options) =>
    search(query, {
      signal: options?.signal,
      ...(options?.pageSize ? { pageSize: options.pageSize } : {}),
    });
}
