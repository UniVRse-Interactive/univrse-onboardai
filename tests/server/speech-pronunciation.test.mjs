// The speech-only pronunciation map (server/speech-pronunciation.mjs): whole
// words with their exact spelling, possessives, nothing inside other words,
// and the transcriptions npm run check:voice maps back. Pure functions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pronunciationVersion,
  pronunciations,
  speechText,
  writtenFromHeard,
} from '../../server/speech-pronunciation.mjs';
import { compareTranscript } from '../../scripts/check-gemini-voice.mjs';

const spokenOf = (word) => pronunciations.find((entry) => entry.word === word).spoken;
const univrse = spokenOf('UniVRse');
const alya = spokenOf('Alya');

test('the map: UniVRse is "Uni V R se" and Alya is respelled for two syllables', () => {
  assert.equal(pronunciationVersion, 1);
  assert.deepEqual(
    pronunciations.map((entry) => entry.word),
    ['UniVRse', 'Alya'],
  );
  assert.equal(univrse, 'Uni V R se');
  assert.notEqual(alya, 'Alya');
});

test('whole words with the exact spelling, possessives included', () => {
  assert.equal(
    speechText('Welcome to your first day at UniVRse.'),
    `Welcome to your first day at ${univrse}.`,
  );
  assert.equal(speechText("UniVRse's values"), `${univrse}'s values`);
  assert.equal(speechText('UniVRse’s values'), `${univrse}’s values`);
  assert.equal(speechText('Join UniVRse-Staff Wi-Fi'), `Join ${univrse}-Staff Wi-Fi`);
  assert.equal(
    speechText("Hi, I'm Alya, your onboarding companion."),
    `Hi, I'm ${alya}, your onboarding companion.`,
  );
  assert.equal(speechText("Alya's briefing"), `${alya}'s briefing`);
  assert.equal(speechText('Ask Alya and UniVRse HR'), `Ask ${alya} and ${univrse} HR`);
});

test('nothing changes inside other words or in another letter case', () => {
  for (const text of [
    'The universe is big.',
    'univrse in lower case',
    'UNIVRSE in capitals',
    'MyUniVRse and UniVRses',
    'Kalya, Alyah, ALYA and alya',
    'UniVRse2 and 2Alya',
    '',
  ])
    assert.equal(speechText(text), text);
  assert.equal(speechText(null), '');
});

test('check:voice reads the respelled names back as the written ones', () => {
  for (const heard of [
    'Uni VR se',
    'UniVR se',
    'Uni V R se',
    'Uni-V-R-se',
    'uni v r seh',
    'UniVRse',
  ])
    assert.equal(writtenFromHeard(`Welcome to ${heard}.`), 'Welcome to UniVRse.', heard);
  for (const heard of ['Ahl-yah', 'Ahl yuh', 'Al-ya', 'Alya', 'Aaliyah', 'Aliyah', 'Alia'])
    assert.equal(writtenFromHeard(`Hi, I'm ${heard}.`), "Hi, I'm Alya.", heard);
  // Ordinary words stay.
  assert.equal(
    writtenFromHeard('The universe, a villa and a valley.'),
    'The universe, a villa and a valley.',
  );
  assert.deepEqual(
    compareTranscript(
      'Welcome to your first day at UniVRse.',
      'Welcome to your first day at Uni VR se.',
    ),
    { extra: [], missing: [], heardAs: [] },
  );
  assert.deepEqual(
    compareTranscript(
      "Hi, I'm Alya, your onboarding companion.",
      "Hi, I'm Ahl-yah, your onboarding companion.",
    ),
    { extra: [], missing: [], heardAs: [] },
  );
  // A leak around a respelled name is still extra words.
  assert.deepEqual(
    compareTranscript('Welcome to UniVRse.', "Director's notes: calm. Welcome to Uni V R se.")
      .extra,
    ['directors', 'notes', 'calm'],
  );
});
