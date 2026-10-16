import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { presentAnswer } from '../../src/avatar/chat-answer-presentation.mjs';
import { answerSpeech, neverSpoken, plainSpeech } from '../../src/avatar/spoken-answer.mjs';
import { replyNotes, replySentences } from '../../src/avatar/short-answer.mjs';
import { answerPresentation } from '../../src/avatar/answer-presentation.mjs';
import { spokenText } from '../../src/avatar/speech-text-and-mouth-timing.js';
import {
  visualAnswer,
  visualPointLabel,
  visualTopicTitle,
} from '../../src/avatar/visual-answer-content.mjs';
import { createServerSpeech } from '../../src/avatar/answer-audio-player.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/spoken-answers.json', import.meta.url), 'utf8'),
);
const answerOf = (entry) => ({
  id: 'a1',
  role: 'assistant',
  ...presentAnswer(entry.result, entry.question),
});
const named = (part) => fixtures.answers.find((entry) => entry.name.includes(part));

// Wording that belongs to the interface. It must never be spoken at all.
const interfaceText = [
  ...Object.values(replyNotes),
  'the linked resource',
  'Full answer',
  'Company sources',
  'Need another explanation',
  'Did this help',
  'Still unclear',
  'Ask HR to follow up',
  'Sent to HR',
  'Listen again',
  'Previous step',
  'Next step',
  'Alya explains',
  'Smaller steps',
  'Show example',
  'Keep it brief',
  'I need a person',
  'Fictional worked example',
];
// Labels the stage and guide build for an answer: scene labels and eyebrows,
// artwork captions, guide titles and point labels, the topic title.
function labelsFor(message) {
  const presentation = answerPresentation(message);
  const guide = visualAnswer(message);
  return [
    ...(presentation?.scenes ?? []).flatMap((scene) => [
      scene.label,
      scene.eyebrow,
      ...(scene.visuals ?? []).map((visual) => visual.label),
    ]),
    ...(guide?.items ?? []).flatMap((item) => [item.title, visualPointLabel(item)]),
    visualTopicTitle(message),
  ].filter((label) => typeof label === 'string' && label.trim());
}
// Heading lines in the source: markdown headings, bold-only lines, lines that
// end in a colon, and lines repeating a passage heading or title.
function headingLines(entry) {
  const passages = entry.result.passages ?? [];
  const titles = new Set(
    passages
      .flatMap((p) => [p.heading, p.title])
      .filter(Boolean)
      .map((t) => t.toLowerCase()),
  );
  return [entry.result.answer, ...passages.map((p) => p.text), ...titles]
    .flatMap((text) => String(text).split('\n'))
    .map((line) => line.trim())
    .filter((line) => {
      const plain = line.replace(/[*_`#]/g, '').trim();
      return (
        plain &&
        (/^#{1,6}\s/.test(line) ||
          /^\*\*[^*]+\*\*:?$/.test(line) ||
          /:$/.test(plain) ||
          titles.has(plain.toLowerCase()))
      );
    })
    .map((line) =>
      line
        .replace(/[*_`#]/g, '')
        .replace(/:$/, '')
        .trim(),
    );
}
const lower = (value) => value.toLowerCase();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertOnlyAnswer(entry, message, segments) {
  const spoken = lower(segments.join(' '));
  for (const text of interfaceText)
    assert.ok(!spoken.includes(lower(text)), `${entry.name}: speaks "${text}"`);
  assert.doesNotMatch(spoken, /https?:|www\./, `${entry.name}: speaks a web address`);
  // A generated label may be spoken only where it is the answer's own words.
  const source = lower(
    [entry.result.answer, ...(entry.result.passages ?? []).map((p) => p.text)]
      .join(' ')
      .replace(/\s+/g, ' '),
  );
  for (const label of labelsFor(message)) {
    const plain = lower(label.replace(/[.:…]+$/, '').trim());
    if (!source.includes(plain))
      assert.ok(!spoken.includes(plain), `${entry.name}: speaks the label "${label}"`);
  }
  // A heading is never spoken, on its own or fused onto the sentence after it.
  for (const heading of headingLines(entry))
    for (const segment of segments)
      assert.doesNotMatch(
        segment,
        new RegExp('^' + escape(heading) + '(?:[\\s:.,;-]|$)', 'i'),
        `${entry.name}: speaks the heading "${heading}"`,
      );
  for (const segment of segments) {
    assert.doesNotMatch(segment, /^\d+[.)]\s/, `${entry.name}: speaks a step number`);
    assert.doesNotMatch(segment, /\bStep \d+ of \d+\b/, `${entry.name}: speaks a step count`);
  }
}

// The player as the page uses it, recording what it would POST to /api/voice.
async function voiceRequests(text, segments) {
  const originalWindow = globalThis.window,
    originalFetch = globalThis.fetch;
  const requests = [];
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
      return {
        connect() {},
        disconnect() {},
        start() {
          setImmediate(() => this.onended?.());
        },
        stop() {},
      };
    }
  }
  globalThis.window = { AudioContext };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...JSON.parse(options.body) });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const player = createServerSpeech();
  try {
    await player.speak(text, { rate: 0.95, segments });
  } finally {
    player.dispose();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
  return requests;
}

test('fixtures cover real payloads and every hint, label and fallback case', () => {
  assert.ok(fixtures.answers.filter((entry) => entry.name.startsWith('real:')).length >= 8);
  assert.ok(fixtures.plainReplies.filter((entry) => entry.name.startsWith('real:')).length >= 4);
  const notes = fixtures.answers.map((entry) => answerOf(entry).replyNote);
  for (const note of Object.values(replyNotes)) assert.ok(notes.includes(note), note);
});

test('every answer speaks only its reply sentences, and the scenes join to exactly that', () => {
  for (const entry of fixtures.answers) {
    const message = answerOf(entry);
    const speech = answerSpeech(message);
    // Only the short reply's own sentences, in order.
    assert.equal(speech.text, replySentences(message.reply).map(spokenText).join(' '), entry.name);
    assert.equal(speech.text, spokenText(message.reply), entry.name);
    // Scene sync: the segments are the spoken text, and the stage's scenes are
    // built over that same text, so captions and scenes follow the voice.
    assert.equal(speech.segments.join(' '), speech.text, entry.name);
    const presentation = answerPresentation(message);
    if (speech.text) {
      assert.equal(presentation.text, speech.text, entry.name);
      assert.deepEqual(
        presentation.scenes.map((scene) => scene.body),
        speech.segments,
        entry.name,
      );
    } else assert.equal(presentation, null, entry.name);
    assertOnlyAnswer(entry, message, speech.segments);
  }
});

test('the requests sent to /api/voice carry only those sentences, split on scene edges', async () => {
  for (const entry of fixtures.answers) {
    const message = answerOf(entry);
    const speech = answerSpeech(message);
    const requests = await voiceRequests(speech.text, speech.segments);
    assert.equal(requests.map((request) => request.text).join(' '), speech.text, entry.name);
    assert.ok(requests.every((request) => request.url === '/api/voice'));
    assertOnlyAnswer(
      entry,
      message,
      requests.map((request) => request.text),
    );
    // Each request belongs to one scene: no request crosses a scene boundary.
    for (const request of requests)
      assert.ok(
        speech.segments.some((segment) => segment.includes(request.text)),
        `${entry.name}: "${request.text}" spans two scenes`,
      );
  }
});

test('interface hints and labels still show with the reply, but are not part of it', () => {
  const details = answerOf(named('details hint'));
  assert.equal(details.replyNote, replyNotes.details);
  assert.ok(!details.reply.includes(replyNotes.details));
  assert.deepEqual(answerSpeech(details).segments, [spokenText(details.reply)]);

  const fallback = answerOf(named('source fallback'));
  assert.equal(fallback.reply, '');
  assert.equal(fallback.replyNote, replyNotes.source);
  assert.deepEqual(answerSpeech(fallback), { text: '', segments: [] }, 'nothing is spoken');

  const noExample = answerOf(named('missing worked example'));
  assert.equal(noExample.replyNote, replyNotes.noExample);
  assert.ok(!answerSpeech(noExample).text.includes('worked example'));

  // The backend's "Fictional worked example:" line stays visible as a heading.
  const example = answerOf(named('backend example label'));
  assert.equal(example.replyHeading, 'Fictional worked example');
  assert.match(answerSpeech(example).text, /^For example, a new hire/);

  const headings = answerOf(named('markdown heading'));
  assert.equal(headings.replyHeading, 'Dress code');
  assert.equal(
    answerSpeech(headings).text,
    'Wear smart casual clothes from Monday to Thursday. Long jeans and clean sneakers are fine on Friday.',
  );

  const search = answerOf(named('document search'));
  assert.equal(search.replyHeading, 'Dress code', 'the passage heading is a label');
  assert.match(answerSpeech(search).text, /^Our dress code is smart casual/);
  assert.doesNotMatch(answerSpeech(search).text, /\d+ \/ \d+/, 'no page counter');
});

test('web addresses are skipped in speech, with the word that introduced them', () => {
  assert.equal(
    answerSpeech(answerOf(named('web addresses'))).text,
    'Read the handbook before orientation. Report IT issues, then sign in again.',
  );
  assert.equal(spokenText('See the guide (https://example.com/a?b=1).'), 'See the guide.');
  assert.equal(spokenText('Open https://example.com/a.b today.'), 'Open today.');
});

test('the Steps format speaks each step without its number', () => {
  const steps = answerOf(named('numbered steps'));
  assert.equal(steps.learning.format, 'steps');
  // The chat shows these as a numbered list; the numbers are never spoken.
  assert.deepEqual(answerSpeech(steps).segments, [
    'Open the employee portal.',
    'Choose the leave type and dates.',
    'Submit the request for manager approval.',
  ]);
});

test('plain replies after an approval card are spoken as written, minus web addresses', () => {
  for (const entry of fixtures.plainReplies) {
    const speech = plainSpeech(entry.text);
    assert.equal(speech.text, spokenText(entry.text), entry.name);
    assert.deepEqual(speech.segments, []);
    assert.doesNotMatch(speech.text, /https?:|www\.|linked resource/i, entry.name);
    if (entry.name.startsWith('real:')) assert.equal(speech.text, entry.text.trim(), entry.name);
  }
  assert.deepEqual(plainSpeech(''), { text: '', segments: [] });
});

test('guard: a hint that reaches a reply is still never spoken', () => {
  // As if an older build stored the hint inside the reply.
  const message = {
    id: 'old',
    role: 'assistant',
    text: 'Ask HR before you travel. More text.',
    reply: 'Ask HR before you travel. ' + replyNotes.details,
    referenceQuestion: 'Can I travel?',
  };
  const speech = answerSpeech(message);
  assert.equal(speech.text, 'Ask HR before you travel.');
  assert.deepEqual(speech.segments, []);
  for (const hint of neverSpoken) assert.ok(!speech.text.includes(hint));
});
