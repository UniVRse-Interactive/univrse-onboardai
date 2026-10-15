import { createApp } from './api-routes.mjs';
import { describeKnowledgeSource } from './company-document-retriever.mjs';
import { loadEnvFile, parseTrustProxy, startService } from './service-runtime.mjs';

loadEnvFile();
// The API never uses the Windows voice; voice comes from the TTS service.
// Two trusted hops: Google's front end for this service, then the web instance
// that appended the browser's IP (see docs/cloud-run-services.md).
const app = createApp({ trustProxy: parseTrustProxy(process.env.TRUST_PROXY, 2) });
startService(app, { name: 'OnboardAi API', onClose: () => app.locals.closeChat() });
if (['gemini-chat', 'document-search'].includes(process.env.AI_MODE))
  console.info(`Company knowledge: ${describeKnowledgeSource(process.env)}.`);
