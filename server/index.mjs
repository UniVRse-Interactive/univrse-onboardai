import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createApp } from './api-routes.mjs';
import { createWindowsVoice } from './optional-windows-voice.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
let localVoice = null;
if (!process.env.GOOGLE_CLOUD_PROJECT) {
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
// Lossless compression keeps the original 130 MiB avatar intact while reducing
// its transfer size. Browsers decode gzip before passing the GLB to Three.js.
app.get('/avatars/alya/alya.glb', (req, res) => {
  res.set({
    'Content-Type': 'model/gltf-binary',
    'Content-Encoding': 'gzip',
    'Cache-Control': 'public, max-age=86400',
    Vary: 'Accept-Encoding',
  });
  const assetRoot = process.argv.includes('--production') ? 'dist' : 'public';
  res.sendFile(resolve(assetRoot, 'avatars/alya/alya.glb.gz'));
});
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
server.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`OnboardAi ready at http://localhost:${port}`),
);
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
