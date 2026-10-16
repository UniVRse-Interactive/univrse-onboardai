import { existsSync } from 'node:fs';
import { createBrain } from '../server/alya-brain/server/brain.mjs';
import { usesAlyaBrain, alyaBrainConfigured } from '../server/alya-brain-service.mjs';
import { createGeminiModels, conversationFailure } from '../server/gemini-chat-workflow.mjs';
import { vertexConfig } from '../server/vertex-ai.mjs';
import { HumanMessage } from '@langchain/core/messages';
if (existsSync('.env')) process.loadEnvFile('.env');
if (usesAlyaBrain(process.env)) {
  if (!alyaBrainConfigured(process.env)) {
    console.error('ALYA_BRAIN_NOT_CONFIGURED: Set GEMINI_API_KEY in the server-only .env.');
    process.exitCode = 1;
  } else {
    try {
      const brain = createBrain({ env: process.env, loadDocuments: async () => [] });
      const result = await brain.ask('Hello.', { timeoutMs: 30000 });
      console.log(
        JSON.stringify({
          ok: true,
          backend: 'alya-brain',
          stateless: true,
          model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
          hasAnswer: Boolean(result.answer),
          sourceCount: result.passages.length,
        }),
      );
    } catch {
      console.error(
        'ALYA_BRAIN_UNAVAILABLE: Check the Gemini API key, model availability and quota. No provider payload was printed.',
      );
      process.exitCode = 1;
    }
  }
} else {
  const vertex = vertexConfig(process.env);
  if (!vertex) {
    console.error(
      'GEMINI_NOT_CONFIGURED: Set GOOGLE_CLOUD_PROJECT for the legacy Vertex mode, or select AI_MODE=alya-brain for the supplied package.',
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
      console.error(JSON.stringify(conversationFailure(error)));
      process.exitCode = 1;
    }
}
