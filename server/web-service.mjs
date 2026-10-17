import { createWebApp } from './web-app.mjs';
import { parseApiServiceUrl } from './api-proxy.mjs';
import { loadEnvFile, parseTrustProxy, startService } from './service-runtime.mjs';
import { describeServiceAuth, resolveServiceAuth } from './service-auth.mjs';

loadEnvFile();
let serviceAuth;
try {
  parseApiServiceUrl(process.env.API_SERVICE_URL);
  // SERVICE_AUTH=id-token with an http api URL stops here (see service-auth.mjs).
  serviceAuth = resolveServiceAuth(process.env, process.env.API_SERVICE_URL);
} catch (error) {
  console.error(`Web service cannot start: ${error.message}`);
  process.exit(1);
}
// One trusted hop: Cloud Run's front end puts the browser's IP last in X-Forwarded-For.
const app = createWebApp({
  apiUrl: process.env.API_SERVICE_URL,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, 1),
  env: process.env,
});
startService(app, { name: 'OnboardAi web' });
console.info(describeServiceAuth(serviceAuth, 'web -> api'));
