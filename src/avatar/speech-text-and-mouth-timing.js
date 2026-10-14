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
    if (current.length + word.length > 210) {
      chunks.push(current.trim());
      current = '';
    }
    current += word + ' ';
    if (/[.!?]$/.test(word) && current.length > 65) {
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
