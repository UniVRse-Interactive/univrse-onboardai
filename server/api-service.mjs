import { createApp } from './api-routes.mjs';
import { describeKnowledgeSource } from './company-document-retriever.mjs';
import { describeChatStorage } from './chat-store.mjs';
import { loadEnvFile, parseTrustProxy, startService } from './service-runtime.mjs';
import { AccountsConfigError, describeAccounts } from './account-settings.mjs';

loadEnvFile();
let accountsLine;
try {
  accountsLine = describeAccounts(process.env);
} catch (error) {
  if (!(error instanceof AccountsConfigError)) throw error;
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
if (process.env.AI_MODE === 'gemini-chat' || process.env.DATABASE_URL)
  console.info(`Saved chats: ${describeChatStorage(process.env)}.`);
