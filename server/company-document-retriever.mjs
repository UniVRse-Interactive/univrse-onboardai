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

// retrieve(query, { signal }) -> [{ title, heading, text, excerpt? }] in rank order.
export function createCompanyRetriever({ env = {}, fetchImpl, getAccessToken, log } = {}) {
  const config = vertexSearchConfig(env);
  if (!config) return async (query) => samplePassages(query);
  const search = createVertexSearch({ config, fetchImpl, getAccessToken, log });
  return (query, options) => search(query, { signal: options?.signal });
}
