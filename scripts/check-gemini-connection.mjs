import { existsSync } from 'node:fs';
import { createGeminiModels, conversationFailure } from '../server/gemini-chat-workflow.mjs';
import { HumanMessage } from '@langchain/core/messages';
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_NOT_CONFIGURED: Add a Gemini key to the server .env.');
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
        model: process.env.GEMINI_MODEL,
        structuredOutput: plan.kind === 'conversation',
      }),
    );
  } catch (error) {
    console.error(JSON.stringify(conversationFailure(error)));
    process.exitCode = 1;
  }
