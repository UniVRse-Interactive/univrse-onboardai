// How Alya says a few names (the user's decisions). POST /api/voice respells
// them in the text it sends to the voice, Gemini or Kokoro; the text on screen
// never changes. Each entry matches the written word as a whole word, with
// its exact (case-sensitive) spelling, including a possessive ("UniVRse's").
//
// `heard` lists how a transcriber may write the respelled word, so that
// npm run check:voice counts it as the word and not as extra or missing words.
//
// Raise pronunciationVersion whenever an entry changes: it is part of the
// Gemini voice cache key, so a clip spoken the old way is never served again.
export const pronunciationVersion = 1;
// (Only the `heard` read-back patterns changed in #67; the spoken text did not, so the version stays.)

export const pronunciations = Object.freeze([
  {
    word: 'UniVRse',
    // The VR is heard: "Uni V R se".
    spoken: 'Uni V R se',
    heard: [
      /\buni[\s-]*v[\s.-]*r[\s.-]*(?:se|seh|suh|sey|see|s[\s.-]*e|s|c)\b/gi,
      /\buni\s*vr\s*se\b/gi,
    ],
  },
  {
    word: 'Alya',
    // Two syllables, as spelled: AHL-yah. Measured with gemini-3.8-flash-tts
    // (Sulafat): "Ahl-yuh" was said in two syllables in 5 of 6 clips; "Alya"
    // itself mostly came out as three (AH-lee-uh).
    spoken: 'Ahl-yuh',
    heard: [/\b(?:ahl|al|aal|ahh?l|ohl|ol)[\s-]*y(?:ah|a|uh)\b/gi, /\ba+l[iy]+a+h?\b/gi],
  },
]);

const letters = '\\p{L}\\p{N}';
// The written word, alone: no letter or digit directly before or after it.
const wholeWord = (word) => new RegExp(`(?<![${letters}])${word}(?![${letters}])`, 'gu');
const rules = pronunciations.map((entry) => ({ ...entry, pattern: wholeWord(entry.word) }));

// The text as the voice should say it.
export function speechText(text) {
  let out = String(text ?? '');
  for (const { pattern, spoken } of rules) out = out.replace(pattern, spoken);
  return out;
}

// A transcript with the respelled words written as the original words again
// (for npm run check:voice).
export function writtenFromHeard(transcript) {
  let out = String(transcript ?? '');
  for (const { heard, word } of rules)
    for (const pattern of heard) out = out.replace(pattern, word);
  return out;
}
