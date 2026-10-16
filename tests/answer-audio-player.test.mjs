import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerSpeech } from '../src/avatar/answer-audio-player.js';
import { clothingPresentation, clothingSceneAt } from '../src/avatar/clothing-presentation.mjs';
import { answerPresentation, presentationSceneAt } from '../src/avatar/answer-presentation.mjs';

function mockPlayback() {
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
    clocks,
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

test('guide progress follows the audio clock across chunks and clears on cancellation', async () => {
  const fixture = mockPlayback();
  try {
    const opening = 'Please contact HR.';
    const playback = fixture.player.speak(
      opening + ' Bring the documents requested by your manager on your first day.',
    );
    assert.equal(fixture.player.getProgress(), null);
    fixture.reply();
    await new Promise(setImmediate);
    assert.equal(fixture.player.getProgress(), 0);
    fixture.clocks[0].currentTime = 0.9;
    const nearEnd = fixture.player.getProgress();
    assert.ok(nearEnd > 0 && nearEnd < opening.length);
    fixture.sources[0].onended();
    await new Promise(setImmediate);
    assert.equal(fixture.player.getProgress(), null, 'buffering must not advance the guide');
    fixture.reply();
    await new Promise(setImmediate);
    assert.equal(fixture.player.getProgress(), opening.length + 1);
    fixture.clocks[0].state = 'suspended';
    assert.equal(fixture.player.getProgress(), null, 'blocked audio must not advance the guide');
    fixture.clocks[0].state = 'running';
    fixture.player.stop();
    await playback;
    assert.equal(fixture.player.getProgress(), null);
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

test('clothing scene changes occur at actual audio boundaries, including short segments', async () => {
  const fixture = mockPlayback();
  const text = 'Wear a blouse. Wear trousers. Avoid beachwear.';
  const presentation = clothingPresentation({ referenceQuestion: 'What should I wear?' }, text);
  try {
    const playback = fixture.player.speak(text, {
      segments: presentation.scenes.map((scene) => scene.body),
    });
    for (let index = 0; index < presentation.scenes.length; index++) {
      assert.equal(
        JSON.parse(fixture.requests[index].options.body).text,
        presentation.scenes[index].body,
      );
      fixture.reply();
      await new Promise(setImmediate);
      assert.equal(clothingSceneAt(presentation, fixture.player.getProgress()), index);
      fixture.clocks[0].currentTime += 0.99;
      assert.equal(clothingSceneAt(presentation, fixture.player.getProgress()), index);
      fixture.sources[index].onended();
      await new Promise(setImmediate);
      assert.equal(fixture.player.getProgress(), null);
    }
    await playback;
    assert.equal(fixture.statuses.at(-1).state, 'idle');
  } finally {
    fixture.restore();
  }
});

test('stale scene segments cannot change the spoken answer', async () => {
  const fixture = mockPlayback();
  try {
    const playback = fixture.player.speak('Ask HR about office hours.', {
      segments: ['Wear jeans.'],
    });
    assert.equal(JSON.parse(fixture.requests[0].options.body).text, 'Ask HR about office hours.');
    fixture.player.stop();
    fixture.reply();
    await playback;
  } finally {
    fixture.restore();
  }
});

test('hours, leave and first-day scenes follow audio boundaries and reset after interruption', async () => {
  for (const text of [
    'Working hours are 9am to 5pm. Lunch is at 12pm.',
    'Submit your leave request. Wait for manager approval.',
    'Arrive at reception. Bring your laptop. Meet your team.',
  ]) {
    const fixture = mockPlayback();
    const presentation = answerPresentation({ text, reply: text });
    try {
      const playback = fixture.player.speak(text, {
        segments: presentation.scenes.map((scene) => scene.body),
      });
      for (const [index, scene] of presentation.scenes.entries()) {
        assert.equal(JSON.parse(fixture.requests[index].options.body).text, scene.body);
        fixture.reply();
        await new Promise(setImmediate);
        assert.equal(presentationSceneAt(presentation, fixture.player.getProgress()), index);
        fixture.clocks[0].currentTime += 0.9;
        assert.equal(presentationSceneAt(presentation, fixture.player.getProgress()), index);
        if (index === presentation.scenes.length - 1) fixture.player.stop();
        else fixture.sources[index].onended();
        await new Promise(setImmediate);
        assert.equal(fixture.player.getProgress(), null);
      }
      await playback;
      assert.equal(presentationSceneAt(presentation, fixture.player.getProgress()), -1);
      assert.equal(fixture.player.getFrame().speaking, false);
    } finally {
      fixture.restore();
    }
  }
});

test('voice failure clears onboarding progress and preserves a readable text answer', async () => {
  const fixture = mockPlayback();
  try {
    const playback = fixture.player.speak('Ask HR about leave.');
    fixture.requests[0].resolve({ ok: false, json: async () => ({ error: 'Voice unavailable' }) });
    await playback;
    assert.equal(fixture.player.getProgress(), null);
    assert.equal(fixture.statuses.at(-1).state, 'unavailable');
    assert.equal(fixture.sources.length, 0);
  } finally {
    fixture.restore();
  }
});
