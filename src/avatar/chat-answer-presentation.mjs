import { presentationGuide } from './visual-answer-content.mjs';
import { shortReply } from './short-answer.mjs';

// Source headings and titles: a line repeating one is a label, not an answer.
const sourceLabels = (passages) =>
  (Array.isArray(passages) ? passages : []).flatMap((passage) => [passage.heading, passage.title]);

// The short reply: only the answer's own sentences. This is what Alya says.
export function answerReply(message) {
  return typeof message.reply === 'string' && message.reply.trim()
    ? message.reply
    : shortReply(presentationGuide(message)?.text || message.text, {
        question: message.referenceQuestion,
        format: message.learning?.format,
        exampleUnavailable: message.exampleUnavailable,
        labels: sourceLabels(message.passages),
      }).reply;
}

export function presentAnswer(result, question = '') {
  if (typeof result?.answer !== 'string' || !result.answer.trim())
    throw new Error('The answer was empty. Please try again.');
  const passages = Array.isArray(result.passages) ? result.passages : [];
  const text =
    result.mode === 'document-search' && passages.length
      ? passages.map((passage) => passage.preview || passage.text).join('\n\n')
      : result.answer;
  const referenceQuestion = result.searchQuery || question;
  const { reply, note, heading } = shortReply(
    presentationGuide({ ...result, text, passages })?.text || text,
    {
      question: referenceQuestion,
      format: result.learning?.format,
      exampleUnavailable: result.exampleUnavailable,
      labels: sourceLabels(passages),
    },
  );
  return {
    text,
    reply,
    spoken: reply,
    // Shown with the reply, never spoken.
    replyNote: note,
    replyHeading: heading,
    referenceQuestion,
    exampleUnavailable: result.exampleUnavailable === true,
    mode: result.mode,
    passages,
    learning: result.learning,
    source: typeof result.source === 'string' ? result.source : '',
  };
}
