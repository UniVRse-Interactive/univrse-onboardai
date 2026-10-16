import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerSpeech } from '../../src/avatar/answer-audio-player.js';
import { answerPresentation, presentationSceneAt } from '../../src/avatar/answer-presentation.mjs';
import { presentAnswer, answerReply } from '../../src/avatar/chat-answer-presentation.mjs';
import { sceneOrder, shownScene } from '../../src/avatar/scene-steps.mjs';

// The stage reads only the player's progress and clock, so any voice that
// returns a WAV per sentence through /api/voice (Kokoro or Gemini) drives it.
function mockVoice({ seconds = () => 1, fail = false } = {}) {
  const originalWindow = globalThis.window,
    originalFetch = globalThis.fetch;
  const requests = [],
    sources = [],
    statuses = [],
    clocks = [];
  class AudioContext {
    constructor() {
      clocks.push(this);
    }
    state = 'running';
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    async decodeAudioData(buffer) {
      return { duration: buffer.seconds };
    }
    createBufferSource() {
      const context = this;
      const source = {
        connect() {},
        disconnect() {},
        start() {
          this.startedAt = context.currentTime;
        },
        stop() {
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
  }
  globalThis.window = { AudioContext };
  globalThis.fetch = (url, options) =>
    new Promise((resolve) => {
      const text = JSON.parse(options.body).text;
      requests.push({ url, text, options });
      resolve(
        fail
          ? { ok: false, status: 503, json: async () => ({ error: 'Voice unavailable' }) }
          : { ok: true, arrayBuffer: async () => ({ seconds: seconds(text) }) },
      );
    });
  const player = createServerSpeech({ onStatus: (status) => statuses.push(status) });
  return {
    player,
    requests,
    sources,
    statuses,
    clock: () => clocks[0],
    restore() {
      player.dispose();
      globalThis.window = originalWindow;
      globalThis.fetch = originalFetch;
    },
  };
}
const settle = () => new Promise(setImmediate);

const hours =
  'The workweek is generally from Monday through Friday, with normal operating hours from 9:00 a.m. to 5:30 p.m., with one hour for lunch. Lunch is at 12:30. Hours may vary with manager approval.';

// How the chat page speaks an answer: its visible short reply, with each scene
// sent as its own audio segment.
function speakLikeThePage(player, message) {
  const text = answerReply(message);
  const presentation = answerPresentation(message, text);
  const playback = player.speak(text, {
    rate: 0.95,
    segments: presentation.scenes.map((scene) => scene.body),
  });
  return { presentation, playback };
}

for (const [voice, seconds] of [
  ['a Kokoro-length clip', (text) => text.split(' ').length * 0.3],
  ['a slower Gemini-length clip', (text) => text.split(' ').length * 0.55 + 0.8],
])
  test(`scenes change on audio boundaries with ${voice}`, async () => {
    const fixture = mockVoice({ seconds });
    try {
      const message = {
        id: 'a1',
        ...presentAnswer({ answer: hours, mode: 'gemini-memory' }, 'What are the working hours?'),
      };
      const { presentation, playback } = speakLikeThePage(fixture.player, message);
      const order = sceneOrder(presentation);
      const shown = [];
      let offset = 0;
      // Walk every audio chunk (a scene can be split into several requests).
      for (let i = 0; ; i++) {
        await settle();
        if (fixture.sources.length <= i) break;
        const chunk = fixture.requests[i].text,
          source = fixture.sources[i],
          duration = seconds(chunk);
        const expected = presentationSceneAt(presentation, offset);
        assert.ok(expected >= 0, chunk);
        // Early, midway and late in this chunk's audio, its own scene shows.
        for (const share of [0.05, 0.5, 0.9]) {
          fixture.clock().currentTime = source.startedAt + duration * share;
          const spokenIndex = presentationSceneAt(presentation, fixture.player.getProgress());
          assert.equal(spokenIndex, expected, `${chunk} at ${share}`);
          assert.equal(
            shownScene(presentation, { voiceLed: true, started: true, spokenIndex, order }),
            expected,
          );
        }
        if (shown.at(-1) !== expected) shown.push(expected);
        fixture.clock().currentTime = source.startedAt + duration;
        source.onended();
        offset += chunk.length + 1;
      }
      assert.deepEqual(shown, order, 'every scene played, in order');
      // Every word Alya says is the visible reply, sent sentence by sentence.
      assert.equal(fixture.requests.map((r) => r.text).join(' '), presentation.text);
      await playback;
      assert.equal(fixture.player.getProgress(), null);
      assert.equal(fixture.statuses.at(-1).state, 'idle');
    } finally {
      fixture.restore();
    }
  });

test('when the voice is unavailable the guide still shows, stepped by the reader', async () => {
  const fixture = mockVoice({ fail: true });
  try {
    const message = {
      id: 'a1',
      ...presentAnswer({ answer: hours, mode: 'gemini-memory' }, 'What are the working hours?'),
    };
    const { presentation, playback } = speakLikeThePage(fixture.player, message);
    await playback;
    assert.equal(fixture.statuses.at(-1).state, 'unavailable');
    assert.equal(fixture.player.getProgress(), null);
    assert.equal(fixture.sources.length, 0);
    const order = sceneOrder(presentation);
    // The stage is not voice-led any more: the first scene is on screen.
    assert.equal(
      shownScene(presentation, { voiceLed: false, step: { scene: 0, page: 0 }, order }),
      0,
    );
    assert.ok(order.length >= 2);
  } finally {
    fixture.restore();
  }
});
