// The duration guard for Gemini text to speech. The model sometimes speaks
// words that are not in the sentence (it read its own prompt aloud before the
// prompt became the transcript alone), and such a clip runs far longer than
// the sentence could. The guard estimates how long the sentence takes to say
// and rejects a clip that runs past a calibrated limit. It never sees the
// transcript of the audio; it is a cheap check on every synthesised clip.
//
// The calibration (docs/onboarding-journey.md, "Alya's voice") uses the
// spoken length of the sentence: letters, with numbers and times written out
// as words and each letter of an acronym (HR, CTO) counted as a short word.

const ones = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ordinalWords = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

// 0-9999 as words; longer numbers digit by digit.
export function numberWords(value) {
  const digits = String(value).replace(/^0+(?=\d)/, '');
  const n = Number(digits);
  if (!/^\d+$/.test(digits) || n > 9999) return [...digits].map((d) => ones[d]).join(' ');
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000)
    return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  return ones[Math.floor(n / 1000)] + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '');
}

function ordinal(value) {
  const words = numberWords(value).split(' ');
  const last = words.pop();
  const spoken =
    ordinalWords[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th');
  return [...words, spoken].join(' ');
}

// 08:45 -> eight forty five; 12:00 -> twelve; 1:05 -> one oh five.
function timeWords(hours, minutes) {
  const hour = numberWords(Number(hours));
  if (minutes === '00') return hour;
  if (minutes.startsWith('0')) return `${hour} oh ${ones[Number(minutes[1])]}`;
  return `${hour} ${numberWords(Number(minutes))}`;
}

// The sentence as lower-case words in the order they are spoken: numbers,
// times, ordinals and symbols written out, punctuation and apostrophes
// removed, hyphenated words split ("A.I." -> "ai", "you're" -> "youre").
export function spokenWords(text) {
  const written = String(text || '')
    .replace(/[’‘`´]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\$\s?(\d[\d.]*)/g, ' $1 dollars ')
    .replace(/\b(\d{1,2})[:.](\d{2})\b/g, (match, h, m) =>
      Number(h) <= 24 && Number(m) <= 59 ? ` ${timeWords(h, m)} ` : match,
    )
    .replace(
      /\b(\d+)\.(\d+)\b/g,
      (_, whole, part) =>
        ` ${numberWords(whole)} point ${[...part].map((d) => ones[d]).join(' ')} `,
    )
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n) => ` ${ordinal(n)} `)
    .replace(/\d+/g, (n) => ` ${numberWords(n)} `)
    .replace(/%/g, ' percent ')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .toLowerCase()
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1')
    .replace(/\b([a-z])\.(?![a-z])/g, '$1')
    // Contractions as their words, so "you're" = "you are" and "can't" = "cannot".
    .replace(/\bcan't\b|\bcannot\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/\blet's\b/g, 'let us')
    .replace(/\b(it|that|what|there|here|who|where|how|he|she)'s\b/g, '$1 is')
    .replace(/'re\b/g, ' are')
    .replace(/'m\b/g, ' am')
    .replace(/'ll\b/g, ' will')
    .replace(/'ve\b/g, ' have')
    .replace(/'d\b/g, ' would')
    .replace(/'/g, '')
    .replace(/[^a-z\s]+/g, ' ');
  return written.split(/\s+/).filter(Boolean);
}

// The guard's units: spoken letters, an acronym letter counting as three
// (HR is said "aitch are", and so may the VR of UniVRse; a lone capital such
// as the B of Tower B or the V of "Uni V R se" counts four, but not the
// article "A"),
// and pauseUnits per comma, colon or sentence end.
export function spokenUnits(text, rule = voiceGuardRule) {
  const source = String(text || '');
  let units = 0;
  for (const token of source.split(/\s+/)) {
    const bare = token.replace(/[^A-Za-z0-9]/g, '');
    if (/^[A-Z]{2,5}s?$/.test(bare)) units += bare.replace(/s$/, '').length * 3;
    // A letter said on its own ("vee", "ar") takes a little longer than in an acronym.
    else if (/^[B-Z]$/.test(bare)) units += 4;
    else {
      units += spokenWords(token).join('').length;
      // Capitals inside a word may be said as letters too (UniVRse: "uni-vee-ar-se").
      for (const run of bare.slice(1).match(/[A-Z]{2,}/g) || []) units += run.length * 2;
    }
  }
  units += (source.match(/[,;:.!?](\s|$)/g) || []).length * rule.pauseUnits;
  return units;
}

// Calibrated on live clips of the transcript-only prompt (gemini-3.8-flash-tts,
// Sulafat; docs/onboarding-journey.md): a clip lasts about baseSeconds +
// secondsPerUnit x units, and the longest of 468 ran 1.40 x that (81% of its
// limit). A clip is rejected past factor x expected + slackSeconds, which
// rejects all 11 leaked clips of the earlier prompt, the mildest 1.64 x.
export const voiceGuardRule = Object.freeze({
  baseSeconds: 0.5,
  secondsPerUnit: 0.062,
  pauseUnits: 6,
  factor: 1.35,
  slackSeconds: 1,
});

export function expectedSpeechSeconds(text, rule = voiceGuardRule) {
  return rule.baseSeconds + rule.secondsPerUnit * spokenUnits(text, rule);
}

export function maxSpeechSeconds(text, rule = voiceGuardRule) {
  return rule.factor * expectedSpeechSeconds(text, rule) + rule.slackSeconds;
}

// The length of a PCM WAV in seconds, from its fmt and data chunks; null when
// the bytes are not a readable WAV.
export function wavDurationSeconds(wav) {
  const bytes = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || []);
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= bytes.length) byteRate = bytes.readUInt32LE(offset + 16);
    if (id === 'data') {
      if (!byteRate) return null;
      // A streamed WAV may give 0 or 0xFFFFFFFF as its data size.
      const available = bytes.length - offset - 8;
      const length = size && size <= available ? size : available;
      return length / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

// { ok, durationSeconds, expectedSeconds, maxSeconds } for one clip.
export function checkVoiceClip(wav, text, rule = voiceGuardRule) {
  const durationSeconds = wavDurationSeconds(wav);
  const expectedSeconds = expectedSpeechSeconds(text, rule);
  const maxSeconds = maxSpeechSeconds(text, rule);
  return {
    ok: durationSeconds !== null && durationSeconds <= maxSeconds,
    durationSeconds,
    expectedSeconds,
    maxSeconds,
  };
}
