import test from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks, makeWordSchedule } from '../src/avatar/speech-text-and-mouth-timing.js';

test('speech starts with a short opening and still reads all conditions in order', () => {
  const text =
    'Please contact HR. Bring your identification and arrive at the time confirmed by your manager. If your start time is unclear, confirm it before travelling.';
  const chunks = speechChunks(text);
  assert.equal(chunks[0], 'Please contact HR.');
  assert.equal(chunks.join(' '), text);
  const longSentence =
    'Before your first day please check the company instructions carefully and confirm your arrival time and required documents with HR';
  const opening = speechChunks(longSentence);
  assert.ok(opening[0].length <= 105);
  assert.ok(opening.length > 1);
  assert.equal(opening.join(' '), longSentence);
});

test('long speech keeps every word and preserves word offsets for mouth movement', () => {
  const text = 'Please confirm your assigned activities with HR. '.repeat(35).trim();
  const chunks = speechChunks(text);
  assert.ok(chunks.every((chunk) => chunk.length <= 220));
  assert.equal(chunks.join(' '), text);
  const words = makeWordSchedule('Hello, please ask HR.');
  assert.deepEqual(
    words.map((word) => word.charIndex),
    [0, 7, 14, 18],
  );
  assert.ok(
    words.every((word) => word.duration > 0 && word.times.every((time) => Number.isFinite(time))),
  );
  assert.ok(words.flatMap((word) => word.visemes).includes('PP'));
});
