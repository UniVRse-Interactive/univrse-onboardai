import { GoogleAuth } from 'google-auth-library';

// Service-to-service ID tokens for the private Cloud Run services (#57): web -> api and
// api -> tts. Cloud Run checks a Google-signed ID token in X-Serverless-Authorization, so
// Authorization stays free for the app's own use (it passes through unchanged).
export const serverlessAuthorizationHeader = 'x-serverless-authorization';

export class ServiceAuthConfigError extends Error {}

// SERVICE_AUTH = "id-token" | "none" | unset. Unset (auto) mints only on Cloud Run (K_SERVICE)
// and only for an https target, so local runs, compose and tests never call the metadata
// server. Returns { mode, audience, reason }; audience is the target origin (null without
// a target URL). Throws ServiceAuthConfigError for an unknown value, or for "id-token" with
// a target that is not https.
export function resolveServiceAuth(env, url) {
  const setting = String(env.SERVICE_AUTH ?? '').trim();
  if (!['', 'none', 'id-token'].includes(setting))
    throw new ServiceAuthConfigError('SERVICE_AUTH must be id-token, none or unset.');
  if (!url) return { mode: 'none', audience: null, reason: 'no target URL' };
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new ServiceAuthConfigError('The target service URL is not a valid URL.');
  }
  const https = target.protocol === 'https:';
  const audience = target.origin;
  if (setting === 'none') return { mode: 'none', audience, reason: 'SERVICE_AUTH=none' };
  if (setting === 'id-token') {
    if (!https)
      throw new ServiceAuthConfigError(
        `SERVICE_AUTH=id-token needs an https target URL, not ${audience}.`,
      );
    return { mode: 'id-token', audience, reason: 'SERVICE_AUTH=id-token' };
  }
  if (!env.K_SERVICE) return { mode: 'none', audience, reason: 'not on Cloud Run' };
  if (!https) return { mode: 'none', audience, reason: 'target is not https' };
  return { mode: 'id-token', audience, reason: 'on Cloud Run' };
}

// The start-up line for one hop, e.g. "web -> api".
export function describeServiceAuth({ mode, audience, reason }, hop) {
  const details = audience ? `audience ${audience}; ${reason}` : reason;
  return `Service-to-service ID tokens for ${hop}: ${mode === 'id-token' ? 'on' : 'off'} (${details}).`;
}

// idTokenProvider(audience) -> Promise<ID token>. One GoogleAuth per provider, created on
// the first mint, and one IdTokenClient per audience; the client caches the token until
// shortly before it expires. A failed client lookup is retried on the next request.
export function createIdTokenProvider({ authFactory = () => new GoogleAuth() } = {}) {
  let auth;
  const clients = new Map();
  return async function idTokenProvider(audience) {
    let client = clients.get(audience);
    if (!client) {
      auth ??= authFactory();
      const pending = Promise.resolve(auth.getIdTokenClient(audience));
      clients.set(audience, pending);
      pending.catch(() => {
        if (clients.get(audience) === pending) clients.delete(audience);
      });
      client = pending;
    }
    const headers = await (await client).getRequestHeaders();
    const value =
      typeof headers?.get === 'function'
        ? headers.get('authorization')
        : (headers?.authorization ?? headers?.Authorization);
    return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '') : '';
  };
}

// The provider a hop should use for `url` (null when ID tokens are off). Nothing from
// google-auth-library is constructed when they are off.
export function serviceIdTokenProvider({ env, url, authFactory } = {}) {
  return resolveServiceAuth(env, url).mode === 'id-token'
    ? createIdTokenProvider({ authFactory })
    : null;
}

// A short, token-free code for the log line: an error code or HTTP status, never a message.
export function idTokenErrorCode(error) {
  if (/^Cannot fetch ID token in this environment/.test(error?.message ?? ''))
    return 'NO_ID_TOKEN_CREDENTIALS';
  for (const value of [error?.code, error?.status, error?.response?.status, error?.name]) {
    const text = value === undefined || value === null ? '' : String(value);
    if (/^[\w.-]{1,64}$/.test(text)) return text;
  }
  return 'UNKNOWN';
}

export function logIdTokenFailure(hop, error) {
  console.error(`Service-to-service ID token for ${hop} failed: ${idTokenErrorCode(error)}.`);
}

// The X-Serverless-Authorization value for one request: "Bearer <ID token for audience>".
export async function serverlessAuthorization(idTokenProvider, audience) {
  const token = await idTokenProvider(audience);
  if (typeof token !== 'string' || !token)
    throw Object.assign(new Error('No ID token was returned.'), { code: 'NO_ID_TOKEN' });
  return `Bearer ${token}`;
}
