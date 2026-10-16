// What the check dialog shows (contract v1.4): a shuffled multiple-choice
// check, or a written answer that Alya checks. Pure rules; the dialog renders.

import { journeyErrorMessage } from './journey-errors.mjs';

export const WRITTEN_MAX = 600;
export const privacyLine = 'Your written answer is only used to check it and is not saved.';
export const graderUnavailable =
  'Alya can’t check written answers right now. Please try again later.';
export const checkingText = 'Alya is checking your answer…';

// "choice" or "written". A check without a type is a choice check (v1.3).
export function checkType(check) {
  return check?.type === 'written' ? 'written' : 'choice';
}

// The options in the order the server sent them (already shuffled), labelled
// by position only. The opaque id is only what gets posted back.
export function positionedOptions(check) {
  const options = Array.isArray(check?.options) ? check.options : [];
  return options
    .filter((option) => option && typeof option.id === 'string' && option.text)
    .map((option, index) => ({ id: option.id, text: option.text, position: index + 1 }));
}

// The written answer's limit, from the check (maxLength), else 600.
export function writtenLimit(check) {
  const value = Number(check?.maxLength);
  return Number.isInteger(value) && value > 0 ? value : WRITTEN_MAX;
}
const length = (text) => [...String(text ?? '')].length;
export function answerCounter(text, max = WRITTEN_MAX) {
  return `${length(text)} / ${max}`;
}
// A problem with the answer before sending, or ''.
export function answerProblem(text, max = WRITTEN_MAX) {
  if (!String(text ?? '').trim()) return 'Write your answer first.';
  if (length(text) > max) return `Keep your answer to ${max} characters or fewer.`;
  return '';
}
export function writtenBody(text) {
  return { answer: String(text ?? '').trim() };
}

// A failed GET or POST. `field` goes under the textarea; `message` is general.
// The written answer always stays in the box so it can be edited and resent.
export function checkErrorView(error, type = 'choice') {
  if (error?.code === 'CHECK_ANSWER_INVALID')
    return type === 'written'
      ? { field: `Write between 1 and ${WRITTEN_MAX} characters, then try again.`, message: '' }
      : { field: '', message: journeyErrorMessage(error) };
  if (error?.code === 'CHECK_GRADER_UNAVAILABLE') return { field: '', message: graderUnavailable };
  if (error?.code === 'BRIEFING_REQUIRED')
    return {
      field: '',
      message: 'Listen to Alya’s briefing on this step first. Choose “Get Alya’s briefing”.',
    };
  return { field: '', message: journeyErrorMessage(error) };
}

// The result of an answer -> what the dialog says.
//   choice:  { correct, explanation }
//   written: { correct, feedback, explanation|null } (explanation only on a pass)
export function checkResultView(result, type = 'choice') {
  if (type === 'written')
    return result?.correct
      ? {
          tone: 'success',
          title: 'That covers it. Step marked done.',
          feedback: result.feedback || '',
          explanation: result.explanation || '',
          keepAnswer: false,
        }
      : {
          tone: 'retry',
          title: 'Not quite yet.',
          feedback: result?.feedback || '',
          explanation: '',
          keepAnswer: true,
          hint: 'Your answer is still in the box. Edit it and ask Alya to check again.',
        };
  return result?.correct
    ? {
        tone: 'success',
        title: 'That’s right. Step marked done.',
        feedback: '',
        explanation: result.explanation || '',
        keepAnswer: false,
      }
    : {
        tone: 'retry',
        title: 'Not quite. Here is why.',
        feedback: '',
        explanation: result?.explanation || '',
        keepAnswer: true,
        hint: 'You can choose again. Nothing is recorded for a wrong answer.',
      };
}

// The dialog's state for one moment:
//   loading | unavailable | answering | checking | passed
export function checkView({ check, error, result, busy } = {}) {
  const type = checkType(check);
  if (!check) return { phase: error ? 'unavailable' : 'loading', type };
  const passed = result?.correct === true;
  return {
    phase: passed ? 'passed' : busy ? 'checking' : 'answering',
    type,
    showForm: !passed,
    submitLabel:
      type === 'written'
        ? busy
          ? 'Checking…'
          : 'Ask Alya to check'
        : busy
          ? 'Checking…'
          : 'Check my answer',
    status: busy ? (type === 'written' ? checkingText : 'Checking your answer…') : '',
    privacy: type === 'written' ? privacyLine : '',
  };
}
