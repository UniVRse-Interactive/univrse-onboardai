import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerSpeech } from '../src/avatar/answer-audio-player.js';

function mockPlayback() {
  const originalWindow = globalThis.window,
    originalFetch = globalThis.fetch;
  const requests = [],
    sources = [],
    statuses = [];
  class AudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    async decodeAudioData() {
      return { duration: 1 };
    }
    createBufferSource() {
      const source = {
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
  }
  globalThis.window = { AudioContext };
  globalThis.fetch = (url, options) =>
    new Promise((resolve) => requests.push({ url, options, resolve }));
  const player = createServerSpeech({ onStatus: (status) => statuses.push(status) });
  const reply = () =>
    requests.at(-1).resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  return {
    player,
    requests,
    sources,
    statuses,
    reply,
    restore() {
      player.dispose();
      globalThis.window = originalWindow;
      globalThis.fetch = originalFetch;
    },
  };
}

test('cancelled server audio cannot start late playback or reopen the avatar mouth', async () => {
  const fixture = mockPlayback();
  try {
    const playback = fixture.player.speak('An answer that is still loading.');
    fixture.player.stop();
    fixture.reply();
    await playback;
    assert.equal(fixture.requests[0].options.signal.aborted, true);
    assert.equal(fixture.sources.length, 0);
    assert.equal(fixture.player.getFrame().speaking, false);
    assert.equal(fixture.statuses.at(-1).state, 'idle');
  } finally {
    fixture.restore();
  }
});

test('current server audio plays automatically and stopping it clears the mouth frame', async () => {
  const fixture = mockPlayback();
  try {
    const playback = fixture.player.speak('Welcome to your first day.');
    fixture.reply();
    await new Promise(setImmediate);
    assert.equal(fixture.requests[0].url, '/api/voice');
    assert.equal(fixture.sources[0].started, true);
    assert.equal(fixture.player.getFrame().speaking, true);
    fixture.player.stop();
    await playback;
    assert.equal(fixture.sources[0].stopped, true);
    assert.equal(fixture.player.getFrame().speaking, false);
  } finally {
    fixture.restore();
  }
});

test('the opening plays before later audio is ready, and stop cancels the prefetched audio', async () => {
  const fixture = mockPlayback();
  try {
    const playback = fixture.player.speak(
      'Please contact HR. Bring the documents requested by your manager on your first day.',
    );
    assert.equal(JSON.parse(fixture.requests[0].options.body).text, 'Please contact HR.');
    fixture.reply();
    await new Promise(setImmediate);
    assert.equal(fixture.sources[0].started, true);
    assert.equal(fixture.requests.length, 2);
    fixture.player.stop();
    fixture.reply();
    await playback;
    assert.equal(fixture.requests[1].options.signal.aborted, true);
    assert.equal(fixture.sources.length, 1);
    assert.equal(fixture.player.getFrame().speaking, false);
  } finally {
    fixture.restore();
  }
});
