import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/api-routes.mjs';
import { encodeWav } from '../server/kokoro-voice.mjs';
import { signedInFetch, stubAccounts } from './server/signed-in.mjs';

// /api/voice needs a signed-in account (issue #55).
const fetch = signedInFetch();

test('different signed-in visitors receive the same server voice and cannot override its identity', async () => {
  const calls = [],
    audio = encodeWav(new Float32Array([0, 0.25, -0.25, 1, -1]));
  const server = createApp({
    env: {},
    accountService: stubAccounts(),
    sharedVoice: {
      render: async (...args) => {
        calls.push(args);
        return audio;
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/voice`;
    const outputs = [];
    for (const [agent, who] of [
      ['Windows', 'a'],
      ['iPhone', 'b'],
    ]) {
      const response = await signedInFetch(who)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': agent },
        body: JSON.stringify({ text: 'Hello', voice: agent }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-alya-voice'), 'kokoro-af-heart');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      outputs.push(Buffer.from(await response.arrayBuffer()));
    }
    assert.deepEqual(outputs[0], outputs[1]);
    assert.deepEqual(calls, [
      ['Hello', 1],
      ['Hello', 1],
    ]);
    const bad = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(701) }),
    });
    assert.equal(bad.status, 400);
    // Signed out: 401 and no synthesis.
    const signedOut = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    assert.deepEqual([signedOut.status, (await signedOut.json()).code], [401, 'AUTH_REQUIRED']);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('shared WAV encoding produces mono PCM with real sample values', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readInt16LE(46), 32767);
  assert.equal(wav.readInt16LE(48), -32768);
  assert.equal(wav.readUInt32LE(40), 8);
});
