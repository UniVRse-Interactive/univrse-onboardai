import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createApp } from './api-routes.mjs';
import { avatarRoute } from './avatar-route.mjs';
import { createWindowsVoice } from './optional-windows-voice.mjs';
import { createSharedVoice } from './kokoro-voice.mjs';
import { describeKnowledgeSource } from './company-document-retriever.mjs';
import { describeChatStorage } from './chat-store.mjs';
import { AccountsConfigError, describeAccounts } from './account-settings.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
// With DATABASE_URL set, refuse to start without the Firestore settings that
// keep local personal data in the emulator (see account-settings.mjs).
let accountsLine;
try {
  accountsLine = describeAccounts(process.env);
} catch (error) {
  if (!(error instanceof AccountsConfigError)) throw error;
  console.error(`OnboardAi cannot start: ${error.message}`);
  process.exit(1);
}
let localVoice = null;
// K_SERVICE is set by Cloud Run, which never has a Windows voice.
if (process.env.GOOGLE_CLOUD_TTS !== 'enabled' && !process.env.K_SERVICE) {
  try {
    localVoice = await createWindowsVoice();
    if (localVoice) console.log(`Local voice ready: ${localVoice.name}`);
  } catch (error) {
    console.warn(`Local voice unavailable: ${error.message}`);
  }
}
const sharedVoice = createSharedVoice();
const app = createApp({ localVoice, sharedVoice });
process.on('exit', () => {
  localVoice?.close();
  app.locals.closeChat();
});
app.get(
  '/avatars/alya/alya.glb',
  avatarRoute(process.argv.includes('--production') ? 'dist' : 'public'),
);
const server = createHttpServer(app);
let vite;
if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  // Share the HTTP listener for live updates instead of reserving a second port.
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`OnboardAi ready at http://localhost:${port}`);
  if (['gemini-chat', 'document-search'].includes(process.env.AI_MODE))
    console.info(`Company knowledge: ${describeKnowledgeSource(process.env)}.`);
  console.info(`Accounts: ${accountsLine}.`);
  if (process.env.AI_MODE === 'gemini-chat' || process.env.DATABASE_URL)
    console.info(`Saved chats: ${describeChatStorage(process.env)}.`);
  if (process.env.VOICE_WARMUP !== 'false') {
    sharedVoice
      .prepare()
      .then(() => console.info('Alya’s shared voice is ready.'))
      .catch(() =>
        console.warn('Voice warmup unavailable. Run npm run voice:prepare to install the model.'),
      );
  }
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  localVoice?.close();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 4000);
  deadline.unref();
  try {
    await Promise.all([new Promise((resolve) => server.close(resolve)), vite?.close()]);
  } finally {
    clearTimeout(deadline);
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
