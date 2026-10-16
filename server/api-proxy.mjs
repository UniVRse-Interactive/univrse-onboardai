import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { autofillFileBytes, workspaceLimits } from './workspace-limits.mjs';
import { autofillErrors } from './account-errors.mjs';

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'forwarded',
]);

export function parseApiServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'API_SERVICE_URL must be an http(s) URL, for example https://onboardai-api.run.app',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('API_SERVICE_URL must be an http(s) URL.');
  return url.origin;
}

const tooLarge = { code: 'REQUEST_TOO_LARGE', error: 'That request is too large.' };
const autofillTooLarge = autofillErrors.tooLarge();
// Raw file uploads (application/octet-stream POSTs): the API path, the body
// limit, and the 413 answer when a file is larger. Autofill keeps the API's
// own AUTOFILL_FILE_TOO_LARGE answer.
const uploads = new Map([
  ['/guest-workspace/documents', { limit: workspaceLimits.bytes, tooLarge }],
  [
    '/hr/employees/autofill',
    {
      limit: autofillFileBytes,
      tooLarge: { code: autofillTooLarge.code, error: autofillTooLarge.message },
    },
  ],
]);

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return size ? Buffer.concat(chunks) : undefined;
}

// Express handler mounted at /api on the web service. It passes raw request
// bytes to the API service and streams the answer back. req.ip and req.host
// follow the app's `trust proxy` setting, so behind Google's front end they are
// the browser's IP and host.
export function createApiProxy({
  apiUrl,
  fetchImpl = fetch,
  timeoutMs = 290000,
  maxBodyBytes = 64 * 1024,
}) {
  const origin = parseApiServiceUrl(apiUrl);
  return async function apiProxy(req, res) {
    const upload =
      req.method === 'POST' && req.is('application/octet-stream') ? uploads.get(req.path) : null;
    const body = await readBody(req, upload ? upload.limit : maxBodyBytes).catch(() => null);
    if (body === null) return res.status(413).json(upload ? upload.tooLarge : tooLarge);

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (hopByHop.has(name) || name.startsWith('x-forwarded-')) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const priorFor = req.get('x-forwarded-for');
    // Google's front end has usually already added the browser's IP as the last entry.
    const alreadyLast = priorFor?.split(',').pop().trim() === req.ip;
    headers.set(
      'x-forwarded-for',
      !priorFor ? String(req.ip) : alreadyLast ? priorFor : `${priorFor}, ${req.ip}`,
    );
    headers.set('x-forwarded-host', req.get('host') || '');
    headers.set('x-forwarded-proto', req.protocol);
    headers.set('accept-encoding', 'identity');

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let upstream;
    try {
      upstream = await fetchImpl(origin + req.originalUrl, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      if (res.destroyed) return;
      const timedOut = error?.name === 'TimeoutError';
      return res.status(timedOut ? 504 : 502).json({
        code: timedOut ? 'API_TIMEOUT' : 'API_UNAVAILABLE',
        error: timedOut
          ? 'The assistant took too long to answer. Please try again.'
          : 'The assistant is temporarily unavailable. Please try again shortly.',
      });
    }

    res.status(upstream.status);
    const encoded = upstream.headers.has('content-encoding');
    for (const [name, value] of upstream.headers) {
      if (hopByHop.has(name) && name !== 'content-length') continue;
      if (name === 'set-cookie') continue;
      if (encoded && (name === 'content-encoding' || name === 'content-length')) continue;
      res.setHeader(name, value);
    }
    // getSetCookie keeps each Set-Cookie header separate; iteration would merge them.
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    if (!upstream.body || req.method === 'HEAD') return res.end();
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      res.destroy();
    }
  };
}
