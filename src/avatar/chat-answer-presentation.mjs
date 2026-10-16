import { presentationGuide } from './visual-answer-content.mjs';
import { shortAnswer } from './short-answer.mjs';

export function answerReply(message) {
  return typeof message.reply === 'string' && message.reply.trim()
    ? message.reply
    : shortAnswer(presentationGuide(message)?.text || message.text, {
        question: message.referenceQuestion,
        format: message.learning?.format,
        exampleUnavailable: message.exampleUnavailable,
      });
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
  const reply = shortAnswer(presentationGuide({ ...result, text, passages })?.text || text, {
    question: referenceQuestion,
    format: result.learning?.format,
    exampleUnavailable: result.exampleUnavailable,
  });
  return {
    text,
    reply,
    spoken: reply,
    referenceQuestion,
    exampleUnavailable: result.exampleUnavailable === true,
    mode: result.mode,
    passages,
    learning: result.learning,
    source: typeof result.source === 'string' ? result.source : '',
  };
}
