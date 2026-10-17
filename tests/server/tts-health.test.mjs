// GET /api/health/tts (issue #67): the deploy smoke test's sign-in-free proof that the api
// signs its calls to the private tts service. The tts is a local stub; nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../../server/api-routes.mjs';

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

async function ttsStub(status = 200) {
  const seen = [];
  const server = await listen((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return { ...server, seen };
}

async function startApi(options) {
  const app = createApp(options);
  const server = await listen(app);
  return server;
}

test('health/tts: 200 ok when the signed tts health call succeeds, signed out', async () => {
  const tts = await ttsStub(200);
  const audiences = [];
  const api = await startApi({
    env: { TTS_SERVICE_URL: tts.url },
    idTokenProvider: async (audience) => {
      audiences.push(audience);
      return 'health-token';
    },
  });
  try {
    const response = await fetch(`${api.url}/api/health/tts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, tts: 'ok' });
    assert.equal(tts.seen.length, 1);
    assert.equal(tts.seen[0].method, 'GET');
    assert.equal(tts.seen[0].url, '/health');
    assert.equal(tts.seen[0].headers['x-serverless-authorization'], 'Bearer health-token');
    assert.deepEqual(audiences, [tts.url]);
  } finally {
    await api.close();
    await tts.close();
  }
});

test('health/tts: a failing tts is 503 unavailable', async () => {
  const tts = await ttsStub(500);
  const api = await startApi({
    env: { TTS_SERVICE_URL: tts.url },
    idTokenProvider: async () => 'health-token',
  });
  try {
    const response = await fetch(`${api.url}/api/health/tts`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, tts: 'unavailable' });
  } finally {
    await api.close();
    await tts.close();
  }
});

test('health/tts: an unreachable tts is 503 unavailable', async () => {
  const tts = await ttsStub(200);
  await tts.close();
  const api = await startApi({ env: { TTS_SERVICE_URL: tts.url }, idTokenProvider: null });
  try {
    const response = await fetch(`${api.url}/api/health/tts`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, tts: 'unavailable' });
  } finally {
    await api.close();
  }
});

test('health/tts: no ID token means 503 and nothing is sent', async (t) => {
  const lines = [];
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
  const tts = await ttsStub(200);
  const api = await startApi({
    env: { TTS_SERVICE_URL: tts.url },
    idTokenProvider: async () => {
      throw new Error('secret-token-text');
    },
  });
  try {
    const response = await fetch(`${api.url}/api/health/tts`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, tts: 'unavailable' });
    assert.equal(tts.seen.length, 0);
    assert.ok(!lines.join('\n').includes('secret-token-text'));
  } finally {
    await api.close();
    await tts.close();
  }
});

test('health/tts: local mode (no TTS_SERVICE_URL) is 200 local', async () => {
  const api = await startApi({ env: {} });
  try {
    const response = await fetch(`${api.url}/api/health/tts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, tts: 'local' });
    const health = await fetch(`${api.url}/api/health`);
    assert.deepEqual(await health.json(), { ok: true });
  } finally {
    await api.close();
  }
});
