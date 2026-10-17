// Service-to-service ID tokens (issue #57): web -> api and api -> tts send a Google-signed ID
// token in X-Serverless-Authorization, only on Cloud Run. Nothing here reaches Google: the
// GoogleAuth factory and the token providers are fakes, and the services are local stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import {
  createIdTokenProvider,
  describeServiceAuth,
  idTokenErrorCode,
  resolveServiceAuth,
  ServiceAuthConfigError,
  serviceIdTokenProvider,
} from '../../server/service-auth.mjs';
import { createApiProxy } from '../../server/api-proxy.mjs';
import { createWebApp } from '../../server/web-app.mjs';
import { createRemoteVoice } from '../../server/remote-voice.mjs';
import { createApp } from '../../server/api-routes.mjs';
import { encodeWav } from '../../server/kokoro-voice.mjs';
import { startAccountsApp } from './account-harness.mjs';

const apiOrigin = 'https://onboardai-api-staging-abc123-as.a.run.app';
const ttsOrigin = 'https://onboardai-tts-staging-abc123-as.a.run.app';
const leakedSecret = 'eyJhbGciOiJSUzI1NiJ9.do-not-log-me.signature';

async function listen(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// An api or tts stand-in that records every request's headers.
async function echoServer() {
  const seen = [];
  const server = await listen((req, res) => {
    req.resume().on('end', () => {
      seen.push(req.headers);
      if (req.url === '/voice') {
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        return res.end(encodeWav(new Float32Array([0, 0.25])));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return { ...server, seen };
}

// A provider that records the audiences it was asked for.
function stubProvider(token = 'stub-id-token') {
  const audiences = [];
  const provider = async (audience) => {
    audiences.push(audience);
    return token;
  };
  return { provider, audiences };
}

// A fake GoogleAuth: getIdTokenClient(audience) -> client whose headers carry a fake token.
function fakeAuth() {
  const calls = { factory: 0, clients: [], headers: 0 };
  const authFactory = () => {
    calls.factory++;
    return {
      async getIdTokenClient(audience) {
        calls.clients.push(audience);
        return {
          async getRequestHeaders() {
            calls.headers++;
            return new Headers({ authorization: `Bearer fake-token-for-${audience}` });
          },
        };
      },
    };
  };
  return { authFactory, calls };
}

function captureErrors(t) {
  const lines = [];
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
  return lines;
}

test('mode resolution: unset is automatic (Cloud Run and https), none never mints, id-token always does', () => {
  const mode = (env, url) => resolveServiceAuth(env, url).mode;
  const onCloudRun = { K_SERVICE: 'onboardai-web-staging' };
  // Unset: local dev, compose and tests never mint.
  assert.equal(mode({}, apiOrigin), 'none');
  assert.equal(mode({}, 'http://127.0.0.1:3141'), 'none');
  assert.equal(mode({ SERVICE_AUTH: '' }, apiOrigin), 'none', 'blank counts as unset');
  assert.equal(mode(onCloudRun, 'http://api:8080'), 'none', 'on Cloud Run but not https');
  assert.equal(mode(onCloudRun, apiOrigin), 'id-token');
  assert.equal(mode({ ...onCloudRun, SERVICE_AUTH: ' ' }, apiOrigin), 'id-token');
  // none: never, even on Cloud Run with https.
  assert.equal(mode({ ...onCloudRun, SERVICE_AUTH: 'none' }, apiOrigin), 'none');
  assert.equal(mode({ SERVICE_AUTH: 'none' }, 'http://127.0.0.1:3141'), 'none');
  // id-token: always, also off Cloud Run, but only for an https target.
  assert.equal(mode({ SERVICE_AUTH: 'id-token' }, apiOrigin), 'id-token');
  assert.equal(mode({ ...onCloudRun, SERVICE_AUTH: 'id-token' }, apiOrigin), 'id-token');
  assert.throws(
    () => resolveServiceAuth({ SERVICE_AUTH: 'id-token' }, 'http://127.0.0.1:3141'),
    (error) => error instanceof ServiceAuthConfigError && /https/.test(error.message),
  );
  assert.throws(
    () => resolveServiceAuth({ SERVICE_AUTH: 'yes' }, apiOrigin),
    (error) =>
      error instanceof ServiceAuthConfigError && /id-token, none or unset/.test(error.message),
  );
  assert.throws(
    () => resolveServiceAuth({ K_SERVICE: 'x' }, 'not a url'),
    (error) => error instanceof ServiceAuthConfigError,
  );
  // No target (the api without TTS_SERVICE_URL): nothing to sign.
  assert.deepEqual(resolveServiceAuth({ SERVICE_AUTH: 'id-token' }, undefined), {
    mode: 'none',
    audience: null,
    reason: 'no target URL',
  });
});

test('the audience is the target origin, and the start-up line says on or off with it', () => {
  const on = resolveServiceAuth({ K_SERVICE: 'onboardai-web' }, `${apiOrigin}/some/path?x=1`);
  assert.equal(on.audience, apiOrigin);
  assert.equal(
    describeServiceAuth(on, 'web -> api'),
    `Service-to-service ID tokens for web -> api: on (audience ${apiOrigin}; on Cloud Run).`,
  );
  assert.equal(
    describeServiceAuth(resolveServiceAuth({}, 'http://127.0.0.1:3141/'), 'web -> api'),
    'Service-to-service ID tokens for web -> api: off (audience http://127.0.0.1:3141; not on Cloud Run).',
  );
  assert.equal(
    describeServiceAuth(resolveServiceAuth({ SERVICE_AUTH: 'none' }, ttsOrigin), 'api -> tts'),
    `Service-to-service ID tokens for api -> tts: off (audience ${ttsOrigin}; SERVICE_AUTH=none).`,
  );
  assert.equal(
    describeServiceAuth(resolveServiceAuth({}, undefined), 'api -> tts'),
    'Service-to-service ID tokens for api -> tts: off (no target URL).',
  );
});

test('no GoogleAuth is constructed when ID tokens are off, and only at the first mint when on', async () => {
  const { authFactory, calls } = fakeAuth();
  for (const [env, url] of [
    [{}, apiOrigin],
    [{}, 'http://127.0.0.1:3141'],
    [{ K_SERVICE: 'onboardai-web' }, 'http://api:8080'],
    [{ K_SERVICE: 'onboardai-web', SERVICE_AUTH: 'none' }, apiOrigin],
    [{ SERVICE_AUTH: 'id-token' }, undefined],
  ])
    assert.equal(serviceIdTokenProvider({ env, url, authFactory }), null, JSON.stringify(env));
  assert.equal(calls.factory, 0);

  const provider = serviceIdTokenProvider({
    env: { K_SERVICE: 'onboardai-web' },
    url: apiOrigin,
    authFactory,
  });
  assert.equal(typeof provider, 'function');
  assert.equal(calls.factory, 0, 'nothing is constructed before the first request');
  assert.equal(await provider(apiOrigin), `fake-token-for-${apiOrigin}`);
  assert.equal(calls.factory, 1);
});

test('one ID token client per audience per provider; the token is read through the client each time', async () => {
  const { authFactory, calls } = fakeAuth();
  const provider = createIdTokenProvider({ authFactory });
  const tokens = await Promise.all([
    provider(apiOrigin),
    provider(apiOrigin),
    provider(ttsOrigin),
    provider(apiOrigin),
  ]);
  assert.deepEqual(tokens, [
    `fake-token-for-${apiOrigin}`,
    `fake-token-for-${apiOrigin}`,
    `fake-token-for-${ttsOrigin}`,
    `fake-token-for-${apiOrigin}`,
  ]);
  await provider(ttsOrigin);
  assert.equal(calls.factory, 1, 'one GoogleAuth');
  assert.deepEqual(calls.clients, [apiOrigin, ttsOrigin], 'one client per audience');
  assert.equal(calls.headers, 5, 'every request asks the client, which caches the token');

  // A plain-object header map (older library shape) works too.
  const legacy = createIdTokenProvider({
    authFactory: () => ({
      getIdTokenClient: async () => ({
        getRequestHeaders: async () => ({ Authorization: 'Bearer legacy-token' }),
      }),
    }),
  });
  assert.equal(await legacy(apiOrigin), 'legacy-token');
});

test('a failed client lookup is not cached: the next request tries again', async () => {
  let attempts = 0;
  const provider = createIdTokenProvider({
    authFactory: () => ({
      async getIdTokenClient() {
        attempts++;
        if (attempts === 1)
          throw Object.assign(new Error('metadata server unavailable'), { code: 'ECONNREFUSED' });
        return { getRequestHeaders: async () => new Headers({ authorization: 'Bearer second' }) };
      },
    }),
  });
  await assert.rejects(provider(apiOrigin), { code: 'ECONNREFUSED' });
  assert.equal(await provider(apiOrigin), 'second');
  assert.equal(await provider(apiOrigin), 'second');
  assert.equal(attempts, 2);
});

test('error codes for the log line never carry the message or the token', () => {
  assert.equal(
    idTokenErrorCode(Object.assign(new Error(leakedSecret), { code: 'ENOTFOUND' })),
    'ENOTFOUND',
  );
  assert.equal(idTokenErrorCode({ status: 403, message: leakedSecret }), '403');
  assert.equal(idTokenErrorCode({ response: { status: 500 } }), '500');
  assert.equal(
    idTokenErrorCode(
      new Error(
        'Cannot fetch ID token in this environment, use GCE or set the GOOGLE_APPLICATION_CREDENTIALS environment variable to a service account credentials JSON file.',
      ),
    ),
    'NO_ID_TOKEN_CREDENTIALS',
  );
  assert.equal(idTokenErrorCode(new TypeError(leakedSecret)), 'TypeError');
  assert.equal(idTokenErrorCode({ code: `Bearer ${leakedSecret}`, name: 'Error' }), 'Error');
  assert.equal(idTokenErrorCode(undefined), 'UNKNOWN');
});

test('web proxy: adds X-Serverless-Authorization for the api origin, drops the browser one, keeps Authorization', async () => {
  const api = await echoServer();
  const { provider, audiences } = stubProvider();
  // A trailing slash and path in API_SERVICE_URL still give the origin as audience.
  const on = await listen(
    createWebApp({ apiUrl: `${api.url}/`, distDir: tmpdir(), idTokenProvider: provider }),
  );
  const off = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir(), env: {} }));
  const browser = {
    'Content-Type': 'application/json',
    Cookie: 'alya_session=abc',
    Authorization: 'Bearer app-level-token',
    'X-Serverless-Authorization': 'Bearer forged-by-the-browser',
  };
  const post = (url) =>
    fetch(`${url}/api/chat?x=1`, { method: 'POST', headers: browser, body: '{"q":1}' });
  try {
    assert.equal((await post(on.url)).status, 200);
    assert.equal((await post(off.url)).status, 200);
    const [signed, plain] = api.seen;
    assert.equal(signed['x-serverless-authorization'], 'Bearer stub-id-token');
    assert.deepEqual(audiences, [api.url]);
    assert.equal(plain['x-serverless-authorization'], undefined, 'never forwarded when off');
    assert.equal(signed.authorization, 'Bearer app-level-token');
    assert.equal(plain.authorization, 'Bearer app-level-token');
    // Turning ID tokens on adds that one header and changes nothing else. (The two web
    // servers listen on different ports, hence different host values.)
    const differ = new Set(['x-serverless-authorization', 'host', 'x-forwarded-host']);
    const rest = (headers) =>
      Object.fromEntries(Object.entries(headers).filter(([name]) => !differ.has(name)));
    assert.equal(signed['x-forwarded-host'], new URL(on.url).host);
    assert.equal(plain['x-forwarded-host'], new URL(off.url).host);
    assert.deepEqual(rest(signed), rest(plain));
    assert.deepEqual(
      Object.keys(signed).filter((name) => !(name in plain)),
      ['x-serverless-authorization'],
    );
  } finally {
    await on.close();
    await off.close();
    await api.close();
  }
});

test('web proxy: the env decides by default (no token off Cloud Run, fail fast for id-token over http)', async () => {
  const api = await echoServer();
  const web = await listen(
    createWebApp({ apiUrl: api.url, distDir: tmpdir(), env: { K_SERVICE: 'onboardai-web' } }),
  );
  try {
    await fetch(`${web.url}/api/health`, {
      headers: { 'X-Serverless-Authorization': 'Bearer forged' },
    });
    assert.equal(api.seen[0]['x-serverless-authorization'], undefined, 'http target: off');
  } finally {
    await web.close();
    await api.close();
  }
  assert.throws(
    () =>
      createWebApp({
        apiUrl: 'http://127.0.0.1:9',
        distDir: tmpdir(),
        env: { SERVICE_AUTH: 'id-token' },
      }),
    ServiceAuthConfigError,
  );
});

test('web proxy: on Cloud Run with an https api, the GoogleAuth client for the api origin signs each request', async () => {
  const { authFactory, calls } = fakeAuth();
  const seen = [];
  const proxy = createApiProxy({
    apiUrl: `${apiOrigin}/`,
    idTokenProvider: serviceIdTokenProvider({
      env: { K_SERVICE: 'onboardai-web-staging' },
      url: `${apiOrigin}/`,
      authFactory,
    }),
    fetchImpl: async (url, init) => {
      seen.push([url, init.headers.get('x-serverless-authorization')]);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  const web = await listen(express().use('/api', proxy));
  try {
    await fetch(`${web.url}/api/health`);
    await fetch(`${web.url}/api/config`);
    assert.deepEqual(seen, [
      [`${apiOrigin}/api/health`, `Bearer fake-token-for-${apiOrigin}`],
      [`${apiOrigin}/api/config`, `Bearer fake-token-for-${apiOrigin}`],
    ]);
    assert.deepEqual(calls.clients, [apiOrigin]);
  } finally {
    await web.close();
  }
});

test('web proxy: a mint failure is a 502 API_UNAVAILABLE without the token, logged as one code-only line', async (t) => {
  const lines = captureErrors(t);
  const api = await echoServer();
  const failing = async () => {
    throw Object.assign(new Error(`metadata answered ${leakedSecret}`), { code: 'ECONNREFUSED' });
  };
  const web = await listen(
    createWebApp({ apiUrl: api.url, distDir: tmpdir(), idTokenProvider: failing }),
  );
  const empty = await listen(
    createWebApp({ apiUrl: api.url, distDir: tmpdir(), idTokenProvider: async () => '' }),
  );
  try {
    const response = await fetch(`${web.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), {
      code: 'API_UNAVAILABLE',
      error: 'The assistant is temporarily unavailable. Please try again shortly.',
    });
    assert.ok(!text.includes(leakedSecret));
    assert.equal(api.seen.length, 0, 'nothing reaches the api unsigned');
    assert.deepEqual(lines, ['Service-to-service ID token for web -> api failed: ECONNREFUSED.']);

    assert.equal((await fetch(`${empty.url}/api/health`)).status, 502);
    assert.equal(lines[1], 'Service-to-service ID token for web -> api failed: NO_ID_TOKEN.');
    assert.equal(api.seen.length, 0);
  } finally {
    await web.close();
    await empty.close();
    await api.close();
  }
});

test('remote voice: adds X-Serverless-Authorization for the tts origin; a mint failure is VOICE_UNAVAILABLE', async (t) => {
  const lines = captureErrors(t);
  const tts = await echoServer();
  const { provider, audiences } = stubProvider('tts-stub-token');
  try {
    const signed = createRemoteVoice({ url: `${tts.url}/ignored/path`, idTokenProvider: provider });
    assert.ok((await signed.render('Hello', 1)).length > 0);
    assert.equal(tts.seen[0]['x-serverless-authorization'], 'Bearer tts-stub-token');
    assert.equal(tts.seen[0]['content-type'], 'application/json');
    assert.deepEqual(audiences, [tts.url]);

    await createRemoteVoice({ url: tts.url }).render('Hello', 1);
    assert.equal(tts.seen[1]['x-serverless-authorization'], undefined, 'off by default');

    const failing = createRemoteVoice({
      url: tts.url,
      idTokenProvider: async () => {
        throw Object.assign(new Error(leakedSecret), { status: 403 });
      },
    });
    await assert.rejects(failing.render('Hello', 1), /^Error: VOICE_UNAVAILABLE$/);
    assert.equal(tts.seen.length, 2, 'nothing reaches the tts unsigned');
    assert.deepEqual(lines, ['Service-to-service ID token for api -> tts failed: 403.']);
  } finally {
    await tts.close();
  }
});

test('api: /api/voice signs its tts calls when ID tokens are on and keeps the voice failure answer', async (t) => {
  const lines = captureErrors(t);
  const tts = await echoServer();
  const { provider, audiences } = stubProvider('api-to-tts-token');
  // /api/voice needs a signed-in account (#55): each app gets an employee who
  // calls it with their session cookie.
  const withEmployee = async (options) => {
    const app = await startAccountsApp(options);
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    return { app, cookie: browser.cookieHeader };
  };
  const signed = await withEmployee({
    env: { TTS_SERVICE_URL: tts.url },
    idTokenProvider: provider,
  });
  // On Cloud Run but with an http tts URL (compose): automatic mode stays off.
  const auto = await withEmployee({
    env: { TTS_SERVICE_URL: tts.url, K_SERVICE: 'onboardai-api' },
  });
  const failing = await withEmployee({
    env: { TTS_SERVICE_URL: tts.url },
    idTokenProvider: async () => {
      throw new Error(leakedSecret);
    },
  });
  const voice = ({ app, cookie }) =>
    fetch(`${app.url}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Hello there' }),
    });
  try {
    assert.equal((await voice(signed)).status, 200);
    assert.equal(tts.seen[0]['x-serverless-authorization'], 'Bearer api-to-tts-token');
    assert.deepEqual(audiences, [tts.url]);
    assert.equal((await voice(auto)).status, 200);
    assert.equal(tts.seen[1]['x-serverless-authorization'], undefined);

    const down = await voice(failing);
    assert.equal(down.status, 503);
    const text = await down.text();
    assert.equal(JSON.parse(text).code, 'VOICE_UNAVAILABLE');
    assert.ok(!text.includes(leakedSecret));
    assert.equal(tts.seen.length, 2);
    assert.deepEqual(lines, ['Service-to-service ID token for api -> tts failed: Error.']);
  } finally {
    await signed.app.close();
    await auto.app.close();
    await failing.app.close();
    await tts.close();
  }
  assert.throws(
    () => createApp({ env: { TTS_SERVICE_URL: 'http://tts:8080', SERVICE_AUTH: 'id-token' } }),
    ServiceAuthConfigError,
  );
});

// Runs a service entry file in an empty folder (no .env) and returns its exit code and output.
async function runEntry(file, env) {
  const cwd = await mkdtemp(join(tmpdir(), 'service-auth-'));
  const child = spawn(process.execPath, [join(import.meta.dirname, '../../server', file)], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const [code] = await once(child, 'exit');
  return { code, output };
}

test('web and api services refuse to start with SERVICE_AUTH=id-token and an http target', async () => {
  const web = await runEntry('web-service.mjs', {
    API_SERVICE_URL: 'http://127.0.0.1:9',
    SERVICE_AUTH: 'id-token',
  });
  assert.equal(web.code, 1);
  assert.match(
    web.output,
    /Web service cannot start: SERVICE_AUTH=id-token needs an https target URL, not http:\/\/127\.0\.0\.1:9\./,
  );
  const api = await runEntry('api-service.mjs', {
    TTS_SERVICE_URL: 'http://127.0.0.1:9',
    SERVICE_AUTH: 'id-token',
  });
  assert.equal(api.code, 1);
  assert.match(api.output, /OnboardAi API cannot start: SERVICE_AUTH=id-token needs an https/);
  const typo = await runEntry('web-service.mjs', {
    API_SERVICE_URL: apiOrigin,
    SERVICE_AUTH: 'idtoken',
  });
  assert.equal(typo.code, 1);
  assert.match(typo.output, /SERVICE_AUTH must be id-token, none or unset/);
});
