import express from 'express';
import { resolve } from 'node:path';
import { createApiProxy } from './api-proxy.mjs';
import { avatarRoute } from './avatar-route.mjs';
import { serviceIdTokenProvider } from './service-auth.mjs';

// Web service: serves dist/ and the avatar, and proxies /api/* to the API service.
// The proxy signs its requests with an ID token when SERVICE_AUTH (or Cloud Run
// with an https api URL) says so; pass idTokenProvider to override, null for off.
export function createWebApp({
  apiUrl,
  distDir = resolve('dist'),
  trustProxy = false,
  env = process.env,
  idTokenProvider = serviceIdTokenProvider({ env, url: apiUrl }),
  ...proxy
}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/web-health', (req, res) => res.json({ ok: true }));
  app.use('/api', createApiProxy({ apiUrl, idTokenProvider, ...proxy }));
  app.get('/avatars/alya/alya.glb', avatarRoute(distDir));
  app.use(express.static(distDir));
  app.get('/{*path}', (req, res) => res.sendFile(resolve(distDir, 'index.html')));
  return app;
}
