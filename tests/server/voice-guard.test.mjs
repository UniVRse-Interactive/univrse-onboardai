// The duration guard for Gemini text to speech: spoken words, the expected
// length of a sentence, WAV durations and the accept/reject boundary, with the
// real clips of the prompt-leak defect as its calibration cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wavFromPcm } from '../../server/gemini-voice.mjs';
import {
  checkVoiceClip,
  expectedSpeechSeconds,
  maxSpeechSeconds,
  numberWords,
  spokenUnits,
  spokenWords,
  voiceGuardRule,
  wavDurationSeconds,
} from '../../server/voice-guard.mjs';

const clip = (seconds) => wavFromPcm(Buffer.alloc(Math.round(seconds * 24000) * 2));

test('spoken words: numbers, times, ordinals, money, acronyms and contractions as words', () => {
  assert.deepEqual(spokenWords('Please arrive at Reception, Level 12, Tower B by 08:45.'), [
    'please',
    'arrive',
    'at',
    'reception',
    'level',
    'twelve',
    'tower',
    'b',
    'by',
    'eight',
    'forty',
    'five',
  ]);
  // "8:45" and "08:45" are the same words.
  assert.deepEqual(spokenWords('by 8:45'), spokenWords('by 08:45'));
  assert.deepEqual(spokenWords('12:00 1:05 12:30'), [
    'twelve',
    'one',
    'oh',
    'five',
    'twelve',
    'thirty',
  ]);
  assert.deepEqual(spokenWords('the 1st and 21st'), ['the', 'first', 'and', 'twenty', 'first']);
  assert.deepEqual(spokenWords('$1,500 and 3.5 days, 10%'), [
    'one',
    'thousand',
    'five',
    'hundred',
    'dollars',
    'and',
    'three',
    'point',
    'five',
    'days',
    'ten',
    'percent',
  ]);
  assert.deepEqual(spokenWords('A.I. and p.m.'), ['ai', 'and', 'pm']);
  assert.deepEqual(spokenWords("You're unwell; it's fine, you can't, cannot, don't."), [
    'you',
    'are',
    'unwell',
    'it',
    'is',
    'fine',
    'you',
    'can',
    'not',
    'can',
    'not',
    'do',
    'not',
  ]);
  assert.equal(numberWords(14), 'fourteen');
  assert.equal(numberWords(2026), 'two thousand twenty six');
  assert.equal(numberWords('10234'), 'one zero two three four');
  assert.deepEqual(spokenWords(''), []);
});

test('expected length: letters, three per acronym letter and a pause per comma or sentence end', () => {
  // "Yes" is 3 letters and one sentence end.
  assert.equal(spokenUnits('Yes.'), 3 + voiceGuardRule.pauseUnits);
  // CTO counts 9 (three letters, each said as a short word).
  assert.equal(spokenUnits('the CTO'), 3 + 9);
  // A lone capital is a letter said on its own; the article "A" is not.
  assert.equal(spokenUnits('Uni V R se'), 3 + 4 + 4 + 2);
  assert.equal(spokenUnits('Tower B'), 5 + 4);
  assert.equal(spokenUnits('A day'), 1 + 3);
  assert.equal(
    expectedSpeechSeconds('Yes.'),
    voiceGuardRule.baseSeconds + voiceGuardRule.secondsPerUnit * spokenUnits('Yes.'),
  );
  assert.equal(
    maxSpeechSeconds('Yes.'),
    voiceGuardRule.factor * expectedSpeechSeconds('Yes.') + voiceGuardRule.slackSeconds,
  );
  assert.ok(
    expectedSpeechSeconds('A much longer sentence, with a pause.') > expectedSpeechSeconds('Yes.'),
  );
});

test('WAV duration: PCM WAVs, extra chunks, streamed sizes and bytes that are not a WAV', () => {
  assert.equal(wavDurationSeconds(clip(2.5)), 2.5);
  assert.equal(wavDurationSeconds(wavFromPcm(Buffer.alloc(32000), 16000)), 1);
  // A LIST chunk before the data, as some encoders write.
  const plain = clip(1);
  const list = Buffer.alloc(8 + 4);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(4, 4);
  list.write('INFO', 8, 'ascii');
  const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  withList.writeUInt32LE(withList.length - 8, 4);
  assert.equal(wavDurationSeconds(withList), 1);
  // A streamed WAV with an unknown data size uses the bytes present.
  const streamed = Buffer.from(clip(1.5));
  streamed.writeUInt32LE(0xffffffff, 40);
  assert.equal(wavDurationSeconds(streamed), 1.5);
  assert.equal(wavDurationSeconds(Buffer.from('not a wav at all')), null);
  assert.equal(wavDurationSeconds(Buffer.alloc(0)), null);
  // A clip whose length cannot be read is rejected.
  assert.equal(checkVoiceClip(Buffer.from('RIFF....WAVEdata'), 'Yes.').ok, false);
});

test('the boundary: at the limit is accepted, just past it is rejected', () => {
  const text = 'Use only approved AI tools.';
  const limit = maxSpeechSeconds(text);
  assert.equal(checkVoiceClip(clip(limit - 0.001), text).ok, true);
  assert.equal(checkVoiceClip(clip(limit + 0.01), text).ok, false);
  const result = checkVoiceClip(clip(1), text);
  assert.deepEqual(Object.keys(result), ['ok', 'durationSeconds', 'expectedSeconds', 'maxSeconds']);
  assert.equal(result.maxSeconds, limit);
});

// The durations measured in the defect's evidence (tts-leak-repro): every
// leaked clip is rejected and every clean one is accepted, including the
// slower clips of the old pace notes.
const repro = [
  ['Your reporting manager is Kelvin Ong, who is the CTO.', [19.4, 15.08], [3.72, 5.04]],
  ['Please arrive at Reception, Level 12, Tower B by 08:45.', [21.32, 8.36], [6.16, 6.36, 5.72]],
  ['Never share your password, including with IT.', [17.16], [3.4, 4.12]],
  ['Open the full answer for the remaining details and conditions.', [18.96, 12.08, 11.88], [4.88]],
  ['Use only approved AI tools.', [11.6, 11.36], [3.6, 3.64]],
  ['Casual Friday allows long jeans and clean sneakers.', [9.56], [4.0, 5.32]],
  ['Yes.', [], [1.16, 1.4, 1.56]],
  ['Please feel free to reach out to HR if you need any additional assistance.', [], [6.28]],
];
for (const [text, leaked, clean] of repro)
  test(`calibration: "${text.slice(0, 40)}"`, () => {
    for (const seconds of leaked)
      assert.equal(checkVoiceClip(clip(seconds), text).ok, false, `${seconds} s must be rejected`);
    for (const seconds of clean)
      assert.equal(checkVoiceClip(clip(seconds), text).ok, true, `${seconds} s must be accepted`);
  });
