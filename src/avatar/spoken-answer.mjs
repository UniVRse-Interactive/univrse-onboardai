import { spokenText } from './speech-text-and-mouth-timing.js';
import { answerReply } from './chat-answer-presentation.mjs';
import { answerPresentation } from './answer-presentation.mjs';
import { replyNotes } from './short-answer.mjs';

// What Alya says, and nothing else. Every speak() call in the chat goes
// through here. The audio player sends exactly these words to /api/voice.

// Interface wording that must never be read aloud, whatever builds the reply.
export const neverSpoken = Object.values(replyNotes);
const isInterfaceText = (segment) =>
  neverSpoken.some((hint) => spokenText(hint).toLowerCase() === segment.toLowerCase());

// An answer: its short reply, sent scene by scene, so each scene changes
// exactly when the voice reaches its first word. `text` is always the
// segments joined with spaces, which keeps the scene and caption timing exact.
export function answerSpeech(message) {
  const reply = answerReply(message);
  const presentation = answerPresentation(message, reply);
  const scenes = presentation?.scenes.map((scene) => scene.body) ?? [spokenText(reply)];
  const segments = scenes.map(spokenText).filter(Boolean);
  if (segments.some(isInterfaceText)) {
    // Never expected: the reply carries no hints. Speak only the answer and
    // let the player split it itself, as scene boundaries no longer match.
    const text = segments.filter((segment) => !isInterfaceText(segment)).join(' ');
    return { text, segments: [] };
  }
  return { text: segments.join(' '), segments };
}

// A plain reply, such as the confirmation after an approval card. It has no
// scenes, so the player chooses the audio boundaries.
export function plainSpeech(text) {
  return { text: spokenText(text || ''), segments: [] };
}
