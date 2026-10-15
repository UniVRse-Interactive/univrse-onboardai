import express from 'express';
import { resolve } from 'node:path';
import { createApiProxy } from './api-proxy.mjs';
import { avatarRoute } from './avatar-route.mjs';

// Web service: serves dist/ and the avatar, and proxies /api/* to the API service.
export function createWebApp({ apiUrl, distDir = resolve('dist'), trustProxy = false, ...proxy }) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/web-health', (req, res) => res.json({ ok: true }));
  app.use('/api', createApiProxy({ apiUrl, ...proxy }));
  app.get('/avatars/alya/alya.glb', avatarRoute(distDir));
  app.use(express.static(distDir));
  app.get('/{*path}', (req, res) => res.sendFile(resolve(distDir, 'index.html')));
  return app;
}
