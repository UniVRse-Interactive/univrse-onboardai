import { LipsyncEn } from '@met4citizen/talkinghead/modules/lipsync-en.mjs';

const lipsync = new LipsyncEn();
export function spokenText(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, 'the linked resource')
    .replace(/[*#`]/g, '')
    .replace(/\n\s*[-•]\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function speechChunks(text) {
  const words = spokenText(text).match(/\S+/g) || [];
  const chunks = [];
  let current = '';
  for (const word of words) {
    // A short opening can play while the rest of the audio is being generated.
    // Later segments stay longer to avoid a request for every short phrase.
    const limit = chunks.length === 0 ? 105 : 210;
    if (current && current.length + word.length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += word + ' ';
    const sentenceEnd = /[.!?][”"')]*$/.test(word);
    const openingPause = chunks.length === 0 && /[,;:]$/.test(word) && current.length > 45;
    if ((sentenceEnd && (chunks.length === 0 || current.length > 65)) || openingPause) {
      chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
export function makeWordSchedule(text, rate = 0.95) {
  return [...text.matchAll(/[\p{L}\p{N}’'-]+/gu)].map((match) => {
    const mouth = lipsync.wordsToVisemes(match[0]);
    const units = (mouth.times.at(-1) || 0) + (mouth.durations.at(-1) || 1);
    const duration = Math.max(140, Math.min(780, match[0].length * 58)) / rate;
    return {
      charIndex: match.index,
      word: match[0],
      duration,
      visemes: mouth.visemes,
      times: mouth.times.map((t) => (t / units) * duration),
      durations: mouth.durations.map((d) => (d / units) * duration),
    };
  });
}
