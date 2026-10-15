import { existsSync } from 'node:fs';
import { createGeminiModels, conversationFailure } from '../server/gemini-chat-workflow.mjs';
import { vertexConfig } from '../server/vertex-ai.mjs';
import { HumanMessage } from '@langchain/core/messages';
if (existsSync('.env')) process.loadEnvFile('.env');
const vertex = vertexConfig(process.env);
if (!vertex) {
  console.error(
    'GEMINI_NOT_CONFIGURED: Set GOOGLE_CLOUD_PROJECT (and optionally GOOGLE_CLOUD_LOCATION) in .env, ' +
      'then run `gcloud auth application-default login`.',
  );
  process.exitCode = 1;
} else
  try {
    const models = createGeminiModels(process.env);
    const plan = await models.plan.invoke(
      [
        new HumanMessage(
          'Classify this greeting. Return kind conversation, query hello, clarification empty string: Hello.',
        ),
      ],
      { signal: AbortSignal.timeout(20000) },
    );
    console.log(
      JSON.stringify({
        ok: true,
        backend: 'vertex-ai',
        project: vertex.project,
        location: vertex.location,
        model: vertex.model,
        structuredOutput: plan.kind === 'conversation',
      }),
    );
  } catch (error) {
    const message = String(error?.message || '');
    if (/default credentials|credential/i.test(message)) {
      console.error(
        'ADC_MISSING: No Application Default Credentials. Run `gcloud auth application-default login`.',
      );
    } else {
      console.error(JSON.stringify(conversationFailure(error)));
    }
    process.exitCode = 1;
  }
