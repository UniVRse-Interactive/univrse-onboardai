import { createApp } from './api-routes.mjs';
import {
  checkKnowledgeConfig,
  describeKnowledgeSource,
  KnowledgeConfigError,
} from './company-document-retriever.mjs';
import { describeChatStorage } from './chat-store.mjs';
import { loadEnvFile, parseTrustProxy, startService } from './service-runtime.mjs';
import { AccountsConfigError, describeAccounts } from './account-settings.mjs';
import {
  describeServiceAuth,
  resolveServiceAuth,
  ServiceAuthConfigError,
} from './service-auth.mjs';

loadEnvFile();
let accountsLine;
let serviceAuth;
try {
  accountsLine = describeAccounts(process.env);
  // SERVICE_AUTH=id-token with an http TTS_SERVICE_URL stops here (see service-auth.mjs).
  serviceAuth = resolveServiceAuth(process.env, process.env.TTS_SERVICE_URL);
  // Vertex AI Search without DOCS_BUCKET stops here (the retrieval allowlist).
  checkKnowledgeConfig(process.env);
} catch (error) {
  if (!(
    error instanceof AccountsConfigError ||
    error instanceof ServiceAuthConfigError ||
    error instanceof KnowledgeConfigError
  ))
    throw error;
  console.error(`OnboardAi API cannot start: ${error.message}`);
  process.exit(1);
}
// The API never uses the Windows voice; voice comes from the TTS service.
// Two trusted hops: Google's front end for this service, then the web instance
// that appended the browser's IP (see docs/cloud-run-services.md).
const app = createApp({ trustProxy: parseTrustProxy(process.env.TRUST_PROXY, 2) });
startService(app, { name: 'OnboardAi API', onClose: () => app.locals.closeChat() });
if (['gemini-chat', 'document-search'].includes(process.env.AI_MODE))
  console.info(`Company knowledge: ${describeKnowledgeSource(process.env)}.`);
console.info(`Accounts: ${accountsLine}.`);
console.info(describeServiceAuth(serviceAuth, 'api -> tts'));
if (process.env.AI_MODE === 'gemini-chat' || process.env.DATABASE_URL)
  console.info(`Saved chats: ${describeChatStorage(process.env)}.`);
