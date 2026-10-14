import test from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks, makeWordSchedule } from '../src/avatar/speech-text-and-mouth-timing.js';

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
