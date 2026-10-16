// npm run check:voice (scripts/check-gemini-voice.mjs): the transcript
// comparison, the cookie file, the options and the pass/fail summary. The
// live synthesis and transcription are not called here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSentences,
  compareTranscript,
  cookieHeaderFromFile,
  formatTable,
  parseArguments,
  summarise,
} from '../../scripts/check-gemini-voice.mjs';

test('the fixed set: at least 12 sentences with short, long, times, names, "Yes." and a list item', () => {
  assert.ok(checkSentences.length >= 12);
  assert.ok(checkSentences.includes('Yes.'));
  assert.ok(checkSentences.some((s) => /08:45/.test(s)));
  assert.ok(checkSentences.some((s) => /^1\. /.test(s)));
  assert.ok(checkSentences.some((s) => s.length > 140));
  assert.ok(checkSentences.some((s) => /Kelvin Ong/.test(s)));
});

test('a clean transcript passes after normalisation (case, punctuation, times, numbers)', () => {
  for (const [sentence, transcript] of [
    [
      'Please arrive at Reception, Level 12, Tower B by 08:45.',
      'please arrive at reception level 12 tower b by 8:45',
    ],
    [
      'Please arrive at Reception, Level 12, Tower B by 08:45.',
      'Please arrive at reception, level twelve, Tower B by oh eight forty-five.',
    ],
    ['Welcome to your first day at UniVRse.', 'Welcome to your first day at Universe.'],
    ['If you are unwell, tell your manager.', "If you're unwell, tell your manager."],
    ['1. Sign your employment contract.', 'One, sign your employment contract.'],
    ['Sarah Lim will meet you.', 'Sara Lim will meet you.'],
  ])
    assert.deepEqual(compareTranscript(sentence, transcript), {
      extra: [],
      missing: [],
      heardAs: [],
    });
});

test('names and acronyms the transcriber spells differently are heard-as, not extra', () => {
  assert.deepEqual(
    compareTranscript(
      'Welcome to your first day at UniVRse.',
      'Welcome to your first day at Una VR.',
    ),
    { extra: [], missing: [], heardAs: ['univrse=una vr'] },
  );
  assert.deepEqual(compareTranscript('Kelvin Ong is the CTO.', 'Kelvin Ong is the CTL.').heardAs, [
    'cto=ctl',
  ]);
});

test('a leaked prompt or an invented opener is extra words', () => {
  const leak = compareTranscript(
    'Your reporting manager is Kelvin Ong, who is the CTO.',
    "Director's notes: Style, calm, warm, and clear like a patient colleague. Pace, gentle. Your reporting manager is Kelvin Ong, who is the CTO.",
  );
  assert.deepEqual(leak.extra.slice(0, 3), ['directors', 'notes', 'style']);
  assert.deepEqual(leak.missing, []);
  const opener = compareTranscript(
    'Please arrive at Reception, Level 12, Tower B by 08:45.',
    'Hi, yeah, just got word on the schedule for the shoot. So everyone should arrive at reception, level 12, Tower B by 8:45.',
  );
  assert.ok(opener.extra.includes('shoot'));
  assert.deepEqual(opener.missing, ['please']);
  // A common word replaced is an extra word too; a dropped word is missing.
  assert.deepEqual(compareTranscript('Never share it.', 'Always share it.'), {
    extra: ['always'],
    missing: ['never'],
    heardAs: [],
  });
  assert.deepEqual(compareTranscript('Yes.', 'Yes, of course.').extra, ['of', 'course']);
  assert.deepEqual(compareTranscript('No, devices cannot be used.', 'No devices can be used.'), {
    extra: [],
    missing: ['not'],
    heardAs: [],
  });
  // Number fillers only count as allowed when the sentence has digits.
  assert.deepEqual(compareTranscript('See you then.', 'See you then oh.').extra, ['oh']);
});

test('cookie files: a curl/Netscape jar or a plain header line', () => {
  const jar = [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_127.0.0.1\tFALSE\t/api\tFALSE\t0\tonboardai_session\tabc123',
    '127.0.0.1\tFALSE\t/\tFALSE\t0\tother\tx',
    '',
  ].join('\n');
  assert.equal(cookieHeaderFromFile(jar), 'onboardai_session=abc123; other=x');
  assert.equal(cookieHeaderFromFile('a=b; c=d\n'), 'a=b; c=d');
});

test('options: rounds, concurrency, server mode needs a cookie file', () => {
  assert.deepEqual(parseArguments([]), { rounds: 2, concurrency: 4, allowFallback: false });
  assert.deepEqual(
    parseArguments(['--base-url', 'https://x.example/', '--cookie-file', 'jar', '--rounds', '1']),
    {
      rounds: 1,
      concurrency: 4,
      allowFallback: false,
      baseUrl: 'https://x.example',
      cookieFile: 'jar',
    },
  );
  assert.throws(() => parseArguments(['--base-url', 'https://x.example']), /cookie-file/);
  assert.throws(() => parseArguments(['--rounds', '0']), /rounds/);
  assert.throws(() => parseArguments(['--nope']), /Unknown option/);
});

test('the summary fails on extra words, a guard trip, an error or (server mode) a fallback', () => {
  const ok = {
    index: 0,
    round: 1,
    rate: 1,
    voice: 'gemini-sulafat',
    ms: 1200,
    durationSeconds: 1.1,
    maxSeconds: 2.4,
    guardOk: true,
    extra: [],
    missing: [],
    heardAs: ['cto=ctl'],
    transcript: 'Yes.',
  };
  assert.equal(summarise([ok]).failed, false);
  assert.equal(summarise([ok]).clipsWithNamesHeardAs, 1);
  assert.equal(summarise([{ ...ok, extra: ['directors'] }]).failed, true);
  assert.equal(summarise([{ ...ok, guardOk: false }]).failed, true);
  assert.equal(summarise([{ ...ok, error: 'HTTP 500' }]).failed, true);
  const kokoro = { ...ok, voice: 'kokoro-af-heart', guardOk: null };
  assert.equal(summarise([kokoro]).failed, true);
  assert.equal(summarise([kokoro], { allowFallback: true }).failed, false);
  // Missing words are reported, not failed.
  assert.equal(summarise([{ ...ok, missing: ['not'] }]).failed, false);
  const table = formatTable([ok]);
  assert.match(table, /^#\s+round\s+rate\s+voice/);
  assert.match(table, /gemini-sulafat\s+1200\s+1\.10\s+2\.40\s+pass/);
});
