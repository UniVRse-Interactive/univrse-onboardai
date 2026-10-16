// npm run check:search -- "optional question"
// Runs one Vertex AI Search chunk search with Application Default Credentials and
// prints the status, file names and sections. Never prints tokens or passage text.
import { existsSync } from 'node:fs';
import {
  createVertexSearch,
  searchConfigProblem,
  searchFailure,
  servingConfigName,
  vertexSearchConfig,
} from '../server/vertex-ai-search.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = vertexSearchConfig(process.env);
const problem = config ? searchConfigProblem(config) : 'VERTEX_SEARCH_ENGINE_ID is not set';
if (problem) {
  console.error(
    `SEARCH_NOT_CONFIGURED: ${problem}. Set GOOGLE_CLOUD_PROJECT and VERTEX_SEARCH_ENGINE_ID ` +
      '(and optionally VERTEX_SEARCH_LOCATION, default global) in .env, ' +
      'then run `gcloud auth application-default login`.',
  );
  process.exitCode = 1;
} else {
  const query = process.argv.slice(2).join(' ').trim() || 'What are the working hours?';
  const search = createVertexSearch({ config, log: () => {} });
  const started = performance.now();
  try {
    const passages = await search(query);
    console.log(
      JSON.stringify(
        {
          ok: true,
          backend: 'vertex-ai-search',
          servingConfig: servingConfigName(config),
          query,
          latencyMs: Math.round(performance.now() - started),
          passages: passages.map((passage) => ({
            file: passage.title,
            section: passage.heading,
            characters: passage.text.length,
          })),
        },
        null,
        2,
      ),
    );
    if (!passages.length)
      console.log(
        'No passages matched. Check that documents were imported into the data store and indexing has finished.',
      );
  } catch (error) {
    const failure = searchFailure(error);
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: failure.code,
          httpStatus: error?.upstreamStatus ?? null,
          reason: error?.reason ?? null,
          // Google's developer message, for the operator only. It holds no credentials.
          detail: error?.upstreamMessage ?? null,
          error: failure.error,
        },
        null,
        2,
      ),
    );
    if (failure.code === 'SEARCH_AUTH_REQUIRED')
      console.error(
        'Run `gcloud auth application-default login`, or impersonate the API service account (see docs/chat-and-memory.md).',
      );
    process.exitCode = 1;
  }
}
