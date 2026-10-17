import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { answerReply, presentAnswer } from '../../src/avatar/chat-answer-presentation.mjs';
import { answerPresentation } from '../../src/avatar/answer-presentation.mjs';
import { answerExtras, askHrOffer } from '../../src/access/support-flow.mjs';
import { alyaPosterUrl } from '../../src/avatar/avatar-poster.mjs';

const dress =
  'The current Company dress code is smart casual. Generally, clean, neat clothing is acceptable. Employees should be neatly and properly dressed during office hours, ripped jeans, short pants, t-shirt, and slippers are not allowed in the office on weekdays.';

test('our API sends no searchQuery, so the question guides the short reply', () => {
  const result = { answer: dress, mode: 'gemini-memory', passages: [{ title: 'Handbook' }] };
  const answer = presentAnswer(result, 'Can I wear jeans?');
  assert.equal(answer.referenceQuestion, 'Can I wear jeans?');
  assert.match(answer.reply, /^Ripped jeans/, 'the matching restriction leads');
  assert.equal(answer.spoken, answer.reply, 'Alya says exactly the visible reply');
  assert.equal(answer.text, dress, 'the full answer is kept for "Full answer"');
  assert.equal(
    presentAnswer({ ...result, searchQuery: 'office attire' }, 'x').referenceQuestion,
    'office attire',
  );
  assert.equal(presentAnswer(result).referenceQuestion, '');
  assert.throws(() => presentAnswer({ answer: '  ' }, 'q'), /empty/);
});

test('a reloaded chat rebuilds the same reply and keeps the journey fields', () => {
  const result = {
    answer: 'I couldn’t find this in the company documents. HR can help with parking.',
    mode: 'gemini-memory',
    coverage: 'none',
    category: 'facilities',
  };
  const live = {
    id: 'r1-a',
    role: 'assistant',
    ...presentAnswer(result, 'Where can I park?'),
    ...answerExtras(result, null),
  };
  const stored = { id: 'r1-a', role: 'assistant', result, feedback: null };
  const reloaded = {
    ...stored,
    ...presentAnswer(stored.result, 'Where can I park?'),
    ...answerExtras(stored, stored.result),
  };
  assert.equal(reloaded.reply, live.reply);
  assert.equal(answerReply(reloaded), live.reply);
  assert.equal(reloaded.coverage, 'none');
  assert.equal(askHrOffer(reloaded), 'no-answer', 'the "couldn’t find this" note still offers HR');
  const [unanswered] = answerPresentation(reloaded).scenes;
  assert.equal(unanswered.label, 'Check company guidance');
  assert.ok(
    unanswered.visuals.every((visual) => ['document', 'people'].includes(visual.kind)),
    'no invented policy picture for the part the documents do not cover',
  );
});

test('a re-explained answer in steps keeps its reexplainOf and lists every step sentence', () => {
  const result = {
    answer: dress,
    mode: 'gemini-memory',
    learning: { format: 'steps' },
    reexplainOf: 'r0-a',
  };
  const message = {
    ...presentAnswer(result, 'Please explain this step by step'),
    ...answerExtras(result, null),
  };
  assert.equal(message.reexplainOf, 'r0-a');
  assert.equal(message.learning.format, 'steps');
  assert.ok(answerReply(message).split('. ').length >= 2);
});

test('the poster cache key matches the avatar model it shows', async () => {
  const manifest = JSON.parse(await readFile('public/avatars/alya/manifest.json', 'utf8'));
  assert.equal(alyaPosterUrl, '/avatars/alya/poster.png?v=' + manifest.sha256.slice(0, 12));
});
