import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createApp } from './api-routes.mjs';
import { avatarRoute } from './avatar-route.mjs';
import { createWindowsVoice } from './optional-windows-voice.mjs';
import { readDriveKnowledge, driveFailure } from './google-drive-documents.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
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
const app = createApp({ localVoice });
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
  // Prepare company text while the page/avatar loads. Every question still
  // checks current Drive revisions and access; startup failure never blocks the website.
  if (
    ['gemini-chat', 'document-search'].includes(process.env.AI_MODE) &&
    process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.KNOWLEDGE_WARMUP !== 'false'
  ) {
    readDriveKnowledge(process.env.GOOGLE_DRIVE_FOLDER_ID)
      .then(() => console.info('Company document cache is ready.'))
      .catch((error) => console.warn('Company document warmup:', driveFailure(error).code));
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
