import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApp } from '../server/api-routes.mjs';
import { createWebApp } from '../server/web-app.mjs';
import { createTtsApp } from '../server/tts-app.mjs';
import { createRemoteVoice } from '../server/remote-voice.mjs';
import { parseApiServiceUrl } from '../server/api-proxy.mjs';
import { parseTrustProxy } from '../server/service-runtime.mjs';
import { encodeWav } from '../server/kokoro-voice.mjs';
import { createGuestWorkspaceStore } from '../server/guest-workspace-store.mjs';
import { workspaceLimits } from '../server/workspace-limits.mjs';

async function listen(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    host: `127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
const chatApp = (options = {}) => ({
  env: { AI_MODE: 'gemini-chat', NODE_ENV: 'production' },
  conversationService: { memory: { list: () => [] }, close() {} },
  ...options,
});
const json = (url, path, body, headers = {}) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('proxy forwards method, path, body, cookie and headers, and returns status, body and every Set-Cookie', async () => {
  let seen;
  const api = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      res.writeHead(418, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': ['a=1; Path=/api; HttpOnly', 'b=2; Path=/api; Secure'],
        'X-Custom': 'kept',
      });
      res.end('{"teapot":true}');
    });
  });
  const web = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir() }));
  try {
    const raw = '{"question":"hi","n":1}';
    const response = await fetch(`${web.url}/api/chat?x=1&y=two`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: 'alya_session=abc; other=1' },
      body: raw,
    });
    assert.equal(response.status, 418);
    assert.equal(await response.text(), '{"teapot":true}');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('x-custom'), 'kept');
    assert.deepEqual(response.headers.getSetCookie(), [
      'a=1; Path=/api; HttpOnly',
      'b=2; Path=/api; Secure',
    ]);
    assert.equal(seen.method, 'PUT');
    assert.equal(seen.url, '/api/chat?x=1&y=two');
    assert.equal(seen.body.toString(), raw);
    assert.equal(seen.headers.cookie, 'alya_session=abc; other=1');
    assert.equal(seen.headers['content-type'], 'application/json');
  } finally {
    await web.close();
    await api.close();
  }
});

test('proxy sets the browser-facing forwarded host and appends the client IP', async () => {
  const seen = [];
  const api = await listen((req, res) => {
    seen.push(req.headers);
    res.end('ok');
  });
  const direct = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir() }));
  const behindGoogle = await listen(
    createWebApp({ apiUrl: api.url, distDir: tmpdir(), trustProxy: 1 }),
  );
  try {
    await fetch(`${direct.url}/api/config`, {
      headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-For': 'spoofed' },
    });
    assert.equal(seen[0]['x-forwarded-host'], direct.host, 'ignores client-supplied host');
    assert.equal(seen[0]['x-forwarded-for'], 'spoofed, 127.0.0.1');

    // fetch cannot override Host, so use http.get.
    await new Promise((resolve, reject) =>
      http
        .get(
          `${behindGoogle.url}/api/config`,
          { headers: { Host: 'onboardai-web.example', 'X-Forwarded-For': '203.0.113.7' } },
          (res) => res.resume().on('end', resolve),
        )
        .on('error', reject),
    );
    // Cloud Run puts the browser IP last; it is not repeated.
    assert.equal(seen[1]['x-forwarded-for'], '203.0.113.7');
    assert.equal(seen[1]['x-forwarded-host'], 'onboardai-web.example');
  } finally {
    await direct.close();
    await behindGoogle.close();
    await api.close();
  }
});

test('proxy returns 502 JSON when the API is down, 413 for oversized bodies, and web-health needs no API', async () => {
  const dead = await listen(() => {});
  const deadUrl = dead.url;
  await dead.close();
  const web = await listen(createWebApp({ apiUrl: deadUrl, distDir: tmpdir(), maxBodyBytes: 100 }));
  try {
    const down = await fetch(`${web.url}/api/health`);
    assert.equal(down.status, 502);
    assert.match(down.headers.get('content-type'), /application\/json/);
    assert.equal((await down.json()).code, 'API_UNAVAILABLE');
    const big = await json(web.url, '/api/chat', { question: 'x'.repeat(500) });
    assert.equal(big.status, 413);
    const health = await fetch(`${web.url}/web-health`);
    assert.equal(health.status, 200);
  } finally {
    await web.close();
  }
});

test('proxy streams a slow response and a client abort does not crash the web service', async () => {
  const api = await listen(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('first,');
    await new Promise((r) => setTimeout(r, 50));
    res.end('second');
  });
  const web = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir() }));
  try {
    const response = await fetch(`${web.url}/api/x`);
    assert.equal(await response.text(), 'first,second');
    const controller = new AbortController();
    const pending = fetch(`${web.url}/api/x`, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending);
    assert.equal((await fetch(`${web.url}/web-health`)).status, 200);
  } finally {
    await web.close();
    await api.close();
  }
});

test('avatar GLB is streamed without Content-Length so Cloud Run accepts files over 32 MiB', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'dist-'));
  await mkdir(join(dist, 'avatars/alya'), { recursive: true });
  const glb = gzipSync(Buffer.from('glTF fake model'));
  await writeFile(join(dist, 'avatars/alya/alya.glb.gz'), glb);
  await writeFile(join(dist, 'index.html'), '<html>app</html>');
  const web = await listen(createWebApp({ apiUrl: 'http://127.0.0.1:9', distDir: dist }));
  try {
    const raw = await new Promise((resolve, reject) => {
      http
        .get(`${web.url}/avatars/alya/alya.glb`, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });
    assert.equal(raw.headers['content-length'], undefined);
    assert.equal(raw.headers['transfer-encoding'], 'chunked');
    assert.equal(raw.headers['content-encoding'], 'gzip');
    assert.equal(raw.headers['content-type'], 'model/gltf-binary');
    assert.deepEqual(raw.body, glb);
    assert.equal(await (await fetch(`${web.url}/mira`)).text(), '<html>app</html>');
  } finally {
    await web.close();
  }
});

test('origin check accepts the forwarded host behind the proxy and still rejects other sites', async () => {
  const proxied = await listen(createApp(chatApp({ trustProxy: 2 })));
  const unproxied = await listen(createApp(chatApp()));
  const asBrowser = (url, origin, forwardedHost) =>
    fetch(url + '/api/conversations', {
      headers: { Origin: origin, 'X-Forwarded-Host': forwardedHost },
    });
  try {
    const same = await asBrowser(
      proxied.url,
      'https://onboardai-web.example',
      'onboardai-web.example',
    );
    assert.equal(same.status, 200);
    const cross = await asBrowser(proxied.url, 'https://evil.example', 'onboardai-web.example');
    assert.equal(cross.status, 403);
    const garbage = await asBrowser(proxied.url, 'not a url', 'onboardai-web.example');
    assert.equal(garbage.status, 403);
    // Without a trusted proxy the header is ignored, so it cannot be used to forge a match.
    const forged = await asBrowser(unproxied.url, 'https://evil.example', 'evil.example');
    assert.equal(forged.status, 403);
  } finally {
    await proxied.close();
    await unproxied.close();
  }
});

test('web to API: session cookie round-trips through the proxy and cross-site requests are rejected', async () => {
  const api = await listen(createApp(chatApp({ trustProxy: 2 })));
  const web = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir() }));
  try {
    const first = await fetch(`${web.url}/api/conversations`, { headers: { Origin: web.url } });
    assert.equal(first.status, 200);
    const cookies = first.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    assert.match(
      cookies[0],
      /^alya_session=[a-f0-9]{64}; Max-Age=\d+; Path=\/api; Expires=.*HttpOnly; Secure; SameSite=Strict/,
    );
    const token = cookies[0].split(';')[0];
    const again = await fetch(`${web.url}/api/conversations`, {
      headers: { Origin: web.url, Cookie: token },
    });
    assert.equal(again.status, 200);
    assert.equal(again.headers.getSetCookie()[0].split(';')[0], token, 'the same session is kept');
    const cross = await fetch(`${web.url}/api/conversations`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403);
  } finally {
    await web.close();
    await api.close();
  }
});

test('employee workspaces and Google Docs links work through the web proxy with bounded bodies', async () => {
  const store = createGuestWorkspaceStore({ path: ':memory:' });
  const app = createApp({
    env: { AI_MODE: 'document-search', NODE_ENV: 'production' },
    trustProxy: 2,
    guestStore: store,
    loadGoogleDocument: async () => ({
      text: 'Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.',
    }),
  });
  const api = await listen(app);
  const web = await listen(createWebApp({ apiUrl: api.url, distDir: tmpdir() }));
  try {
    const first = await fetch(web.url + '/api/guest-workspace', {
      headers: { Origin: web.url },
    });
    assert.equal(first.status, 200);
    const snapshot = await first.json();
    const cookie = first.headers.getSetCookie()[0].split(';')[0];
    assert.match(first.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Strict/);
    const headers = { Origin: web.url, Cookie: cookie };
    const uploaded = await json(
      web.url,
      '/api/guest-workspace/documents',
      { category: 'company', url: 'https://docs.google.com/document/d/company-guidance-123/edit' },
      headers,
    );
    assert.equal(uploaded.status, 201);
    const again = await fetch(web.url + '/api/guest-workspace', { headers });
    assert.equal((await again.json()).documents[0].title, 'Welcome & Company Overview');
    const fileUpload = await fetch(web.url + '/api/guest-workspace/documents', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': 'guide.txt',
      },
      body: 'A local file is not a native Google Doc.',
    });
    assert.equal(fileUpload.status, 415);
    assert.equal(
      (
        await fetch(web.url + '/api/guest-workspace/guests/' + snapshot.lastGuestId + '/config', {
          headers,
        })
      ).status,
      200,
    );
    const cross = await json(
      web.url,
      '/api/guest-workspace/guests',
      {},
      {
        ...headers,
        Origin: 'https://other.example',
      },
    );
    assert.equal(cross.status, 403);
    const largeJson = await json(
      web.url,
      '/api/guest-workspace/guests',
      {
        padding: 'x'.repeat(70 * 1024),
      },
      headers,
    );
    assert.equal(largeJson.status, 413, 'JSON retains the smaller proxy limit');
    const oversized = await fetch(web.url + '/api/guest-workspace/documents', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'big.txt' },
      body: Buffer.alloc(workspaceLimits.bytes + 1, 'x'),
    });
    assert.equal(oversized.status, 413, 'the proxy rejects oversized file bodies');
  } finally {
    await web.close();
    await api.close();
    app.locals.closeChat();
  }
});

test('rate limit is keyed by the end user IP behind the proxy, not the proxy IP', async () => {
  const behind = await listen(createApp({ env: {}, trustProxy: 2 }));
  const noTrust = await listen(createApp({ env: {} }));
  // Cloud Run chain at the API: "<browser>, <web instance>"; the socket is Google's front end.
  const post = (url, client) =>
    json(url, '/api/voice', { text: '' }, { 'X-Forwarded-For': `${client}, 10.9.9.9` });
  try {
    for (let i = 0; i < 30; i++) assert.equal((await post(behind.url, '203.0.113.1')).status, 400);
    assert.equal((await post(behind.url, '203.0.113.1')).status, 429);
    assert.equal((await post(behind.url, '203.0.113.2')).status, 400, 'another user is unaffected');
    // Without the setting every caller shares the proxy's bucket (the bug being fixed).
    for (let i = 0; i < 30; i++) await post(noTrust.url, `198.51.100.${i}`);
    assert.equal((await post(noTrust.url, '198.51.100.200')).status, 429);
  } finally {
    await behind.close();
    await noTrust.close();
  }
});

test('API forwards validated voice requests to the TTS service and maps its failures', async () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5]));
  const requests = [];
  let mode = 'ok';
  const tts = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks)) });
      if (mode === 'busy') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end('{"code":"VOICE_BUSY","error":"busy"}');
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'X-Alya-Voice': 'kokoro-af-heart' });
      res.end(wav);
    });
  });
  const api = await listen(createApp({ env: { TTS_SERVICE_URL: tts.url } }));
  try {
    const ok = await json(api.url, '/api/voice', {
      text: '  Hello there  ',
      rate: 0.95,
      voice: 'x',
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'audio/wav');
    assert.equal(ok.headers.get('x-alya-voice'), 'kokoro-af-heart');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), wav);
    assert.deepEqual(requests, [
      { method: 'POST', url: '/voice', body: { text: 'Hello there', rate: 0.95 } },
    ]);

    assert.equal((await json(api.url, '/api/voice', { text: 'x', rate: 3 })).status, 400);
    assert.equal(requests.length, 1, 'invalid input is not forwarded');

    mode = 'busy';
    const busy = await json(api.url, '/api/voice', { text: 'Hello' });
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).code, 'VOICE_BUSY');
  } finally {
    await api.close();
    await tts.close();
  }
  // TTS service stopped: unavailable, not a crash.
  const lonely = await listen(createApp({ env: { TTS_SERVICE_URL: tts.url } }));
  try {
    const down = await json(lonely.url, '/api/voice', { text: 'Hello' });
    assert.equal(down.status, 503);
    assert.equal((await down.json()).code, 'VOICE_UNAVAILABLE');
  } finally {
    await lonely.close();
  }
});

test('remote voice client reports busy and unavailable as the in-process voice does', async () => {
  const tts = await listen((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"code":"VOICE_UNAVAILABLE","error":"no model"}');
  });
  try {
    await assert.rejects(createRemoteVoice({ url: tts.url }).render('Hi', 1), /VOICE_UNAVAILABLE/);
  } finally {
    await tts.close();
  }
});

test('TTS service validates input, returns audio/wav and the documented 503 shape', async () => {
  let behaviour = 'ok';
  const calls = [];
  const app = createTtsApp({
    sharedVoice: {
      render: async (text, rate) => {
        calls.push([text, rate]);
        if (behaviour === 'busy') throw new Error('VOICE_BUSY');
        if (behaviour === 'broken') throw new Error('model missing');
        return encodeWav(new Float32Array([0, 0.5]));
      },
    },
  });
  const tts = await listen(app);
  try {
    assert.equal(
      (await fetch(tts.url + '/health')).status,
      503,
      'not ready before the model loads',
    );
    app.locals.setReady(true);
    assert.equal((await fetch(tts.url + '/health')).status, 200);

    const ok = await json(tts.url, '/voice', { text: 'Hello', rate: 1.05 });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'audio/wav');
    assert.equal(ok.headers.get('x-alya-voice'), 'kokoro-af-heart');
    assert.deepEqual(calls[0], ['Hello', 1.05]);
    assert.equal(
      (await json(tts.url, '/voice', { text: 'Hello' })).status,
      200,
      'rate defaults to 1',
    );

    for (const body of [
      {},
      { text: '' },
      { text: '   ' },
      { text: 5 },
      { text: 'x'.repeat(701) },
      { text: 'Hello', rate: 2 },
      { text: 'Hello', rate: '1' },
    ])
      assert.equal(
        (await json(tts.url, '/voice', body)).status,
        400,
        JSON.stringify(body).slice(0, 40),
      );
    assert.equal((await json(tts.url, '/voice', { text: 'x'.repeat(700) })).status, 200);
    const malformed = await fetch(tts.url + '/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    assert.equal(malformed.status, 400);

    behaviour = 'busy';
    const busy = await json(tts.url, '/voice', { text: 'Hello' });
    assert.equal(busy.status, 503);
    const busyBody = await busy.json();
    assert.equal(busyBody.code, 'VOICE_BUSY');
    assert.equal(typeof busyBody.error, 'string');
    behaviour = 'broken';
    const broken = await json(tts.url, '/voice', { text: 'Hello' });
    assert.equal(broken.status, 503);
    assert.equal((await broken.json()).code, 'VOICE_UNAVAILABLE');
  } finally {
    await tts.close();
  }
});

test('service configuration helpers', () => {
  assert.equal(
    parseApiServiceUrl('https://onboardai-api-abc.a.run.app/'),
    'https://onboardai-api-abc.a.run.app',
  );
  assert.throws(() => parseApiServiceUrl(undefined), /API_SERVICE_URL/);
  assert.throws(() => parseApiServiceUrl('ftp://x'), /API_SERVICE_URL/);
  assert.equal(parseTrustProxy(undefined, 2), 2);
  assert.equal(parseTrustProxy('1', 2), 1);
  assert.equal(parseTrustProxy('false', 2), false);
  assert.equal(parseTrustProxy(undefined, undefined), false);
});
