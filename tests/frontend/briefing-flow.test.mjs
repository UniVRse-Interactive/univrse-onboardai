import test from 'node:test';
import assert from 'node:assert/strict';
import {
  briefingAction,
  briefingErrorMessage,
  briefingMessage,
  briefingRecordedText,
  briefingTitle,
  canConfirmRead,
  findBriefing,
  listenedCompletion,
} from '../../src/avatar/briefing-flow.mjs';
import { createServerSpeech } from '../../src/avatar/answer-audio-player.js';
import { answerSpeech } from '../../src/avatar/spoken-answer.mjs';
import { answerPresentation } from '../../src/avatar/answer-presentation.mjs';
import { sceneOrder } from '../../src/avatar/scene-steps.mjs';
import {
  actionLabels,
  briefingDoneLabel,
  briefingGateReason,
  briefingStatus,
  stepActionStates,
  stepActions,
  stepErrorMessage,
} from '../../src/access/onboarding-view.mjs';

// A required step from GET /api/me/onboarding (contract v1.5).
const step = (overrides = {}) => ({
  id: 'documentation.contract',
  title: 'Sign your employment contract',
  description: '',
  required: true,
  completion: 'hr_verify',
  askAlya: 'How do I sign my contract?',
  hasCheck: false,
  status: 'todo',
  briefing: {
    text: 'Your contract arrives by email on your first morning. Read it, sign it and return it to People & Culture. HR then confirms it in your plan.',
    sourceTitle: 'First-Day & First-Week Guide',
  },
  briefingRequired: true,
  briefed: false,
  ...overrides,
});

// The real player, with audio that plays when told to.
function mockVoice({ fail = false } = {}) {
  const originalWindow = globalThis.window,
    originalFetch = globalThis.fetch;
  const sources = [];
  class AudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
  }
  globalThis.window = { AudioContext };
  globalThis.fetch = async () =>
    fail
      ? { ok: false, json: async () => ({ error: 'Voice unavailable' }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  const player = createServerSpeech();
  const settle = () => new Promise(setImmediate);
  return {
    player,
    sources,
    settle,
    // Let every audio chunk play to its natural end.
    async playThrough() {
      for (let i = 0; i < 20; i++) {
        await settle();
        const playing = sources.find((source) => !source.done && source.onended);
        if (!playing) continue;
        playing.done = true;
        playing.onended();
      }
    },
    restore() {
      player.dispose();
      globalThis.window = originalWindow;
      globalThis.fetch = originalFetch;
    },
  };
}
const speakBriefing = (player) => {
  const speech = answerSpeech(briefingMessage(step()));
  return player.speak(speech.text, { segments: speech.segments });
};

test('"listened" is sent only when the briefing plays to its natural end', async () => {
  const fixture = mockVoice();
  try {
    const playback = speakBriefing(fixture.player);
    await fixture.playThrough();
    const outcome = await playback;
    assert.equal(outcome, 'ended');
    assert.equal(listenedCompletion(outcome), 'listened');
  } finally {
    fixture.restore();
  }
});

test('stopping, interrupting or leaving the page records nothing', async () => {
  // Stop voice.
  let fixture = mockVoice();
  try {
    const playback = speakBriefing(fixture.player);
    await fixture.settle();
    fixture.player.stop();
    assert.equal(await playback, 'stopped');
    assert.equal(listenedCompletion('stopped'), null);
  } finally {
    fixture.restore();
  }
  // Interrupted by another answer, or "Listen again" restarting it.
  fixture = mockVoice();
  try {
    const first = speakBriefing(fixture.player);
    await fixture.settle();
    const again = speakBriefing(fixture.player);
    assert.equal(await first, 'stopped', 'the interrupted playback never counts');
    await fixture.playThrough();
    assert.equal(listenedCompletion(await again), 'listened', 'the restart can count');
  } finally {
    fixture.restore();
  }
  // Navigating away disposes the player mid-briefing.
  fixture = mockVoice();
  try {
    const playback = speakBriefing(fixture.player);
    await fixture.settle();
    fixture.player.dispose();
    assert.equal(listenedCompletion(await playback), null);
  } finally {
    fixture.restore();
  }
  // A voice failure is not listening either; the read path takes over.
  fixture = mockVoice({ fail: true });
  try {
    assert.equal(listenedCompletion(await speakBriefing(fixture.player)), null);
  } finally {
    fixture.restore();
  }
  assert.equal(listenedCompletion('unavailable'), null);
  assert.equal(listenedCompletion('empty'), null);
});

test('the briefing entry presents and speaks the whole briefing text, nothing else', () => {
  const message = briefingMessage(step());
  assert.equal(briefingTitle(step()), 'Briefing: Sign your employment contract');
  assert.equal(message.briefing, true);
  assert.equal(message.reply, step().briefing.text, 'the full text, not a short reply');
  const speech = answerSpeech(message);
  assert.equal(speech.text, step().briefing.text);
  assert.equal(speech.segments.join(' '), speech.text);
  assert.equal(answerPresentation(message).text, speech.text);
  assert.equal(briefingMessage(step({ briefing: null })), null);
  assert.equal(briefingMessage(step({ briefing: { text: '  ' } })), null);
});

test('reading needs the last page of the last scene, and only without voice', () => {
  const presentation = answerPresentation(briefingMessage(step()));
  const order = sceneOrder(presentation);
  assert.equal(order.length, 3);
  const last = { scene: order.length - 1, page: 0 };
  assert.equal(
    canConfirmRead({ voiceAvailable: false, step: { scene: 0, page: 0 }, order }),
    false,
  );
  assert.equal(canConfirmRead({ voiceAvailable: false, step: last, order }), true);
  // A long last caption has two pages: the button waits for the second.
  assert.equal(
    canConfirmRead({ voiceAvailable: false, step: last, order, pageCounts: { [order.at(-1)]: 2 } }),
    false,
  );
  assert.equal(
    canConfirmRead({
      voiceAvailable: false,
      step: { ...last, page: 1 },
      order,
      pageCounts: { [order.at(-1)]: 2 },
    }),
    true,
  );
  assert.equal(canConfirmRead({ voiceAvailable: true, step: last, order }), false);
  assert.equal(canConfirmRead({ voiceAvailable: false, step: last, order: [] }), false);
});

test('after the briefing, the card offers the step’s own action', () => {
  assert.deepEqual(briefingAction(step({ completion: 'self', title: 'Meet your buddy' })), {
    kind: 'complete',
    label: 'Mark as done',
    done: 'Marked “Meet your buddy” as done.',
  });
  assert.deepEqual(briefingAction(step()), {
    kind: 'complete',
    label: 'I’ve submitted this',
    done: 'Sent “Sign your employment contract” to HR to verify.',
  });
  assert.deepEqual(briefingAction(step({ completion: 'check' })), {
    kind: 'check',
    label: 'Take the check',
    done: '',
  });
  assert.equal(briefingAction(step({ status: 'done' })).kind, 'none');
  assert.match(briefingAction(step({ status: 'submitted' })).text, /waiting for HR/);
});

test('the dashboard gates completion until the briefing is done', () => {
  for (const completion of ['self', 'hr_verify', 'check']) {
    const states = stepActionStates(step({ completion }));
    assert.equal(states[0].action, 'briefing', 'the briefing is the first action');
    assert.equal(states[0].label, 'Get Alya’s briefing');
    assert.equal(states[0].disabled, false);
    const completing = states.find(
      (state) => state.action !== 'briefing' && state.action !== 'ask',
    );
    assert.equal(completing.disabled, true, completion);
    assert.equal(completing.reason, 'Listen to Alya’s briefing first');
    assert.equal(briefingGateReason, completing.reason);
  }
  const briefed = step({ briefed: true });
  assert.deepEqual(stepActions(briefed), ['submit', 'ask'], 'no briefing action once done');
  assert.ok(stepActionStates(briefed).every((state) => !state.disabled));
  assert.equal(briefingStatus(briefed), briefingDoneLabel);
  assert.equal(briefingDoneLabel, 'Briefing done');
  assert.equal(briefingStatus(step()), '');
  assert.equal(briefingStatus(step({ briefed: true, status: 'done' })), '');
  // Optional steps (and API payloads before v1.5) are unchanged.
  const optional = step({ required: false, briefing: null, briefingRequired: false });
  assert.deepEqual(stepActions(optional), ['submit', 'ask']);
  assert.deepEqual(stepActions({ id: 'x', completion: 'self', status: 'todo', askAlya: null }), [
    'complete',
  ]);
  assert.equal(actionLabels.briefing, 'Get Alya’s briefing');
});

test('409 BRIEFING_REQUIRED and BRIEFING_NOT_FOUND read calmly', () => {
  assert.equal(
    stepErrorMessage({ status: 409, code: 'BRIEFING_REQUIRED' }),
    'Listen to Alya’s briefing first. Choose “Get Alya’s briefing”.',
  );
  assert.match(stepErrorMessage({ status: 404, code: 'BRIEFING_NOT_FOUND' }), /no briefing/);
  assert.match(briefingErrorMessage({ status: 404, code: 'BRIEFING_NOT_FOUND' }), /no briefing/);
  assert.match(briefingErrorMessage({ status: 409, code: 'BRIEFING_REQUIRED' }), /isn’t recorded/);
  assert.equal(
    briefingErrorMessage({ status: 429 }),
    'That’s a lot at once. Please try again shortly.',
  );
});

test('the briefing is read from the onboarding payload by step id', () => {
  const onboarding = {
    areas: [{ id: 'documentation', steps: [step(), step({ id: 'b', briefing: null })] }],
  };
  assert.equal(
    findBriefing(onboarding, 'documentation.contract').step.id,
    'documentation.contract',
  );
  assert.match(findBriefing(onboarding, 'b').missing, /no briefing/);
  assert.match(findBriefing(onboarding, 'gone').missing, /no longer in your plan/);
  assert.equal(briefingRecordedText('listened'), 'Briefing done. Thanks for listening.');
  assert.equal(briefingRecordedText('read'), 'Briefing done. Thanks for reading it.');
  assert.equal(briefingRecordedText('helpful'), 'Briefing done. Marked as helpful.');
});
