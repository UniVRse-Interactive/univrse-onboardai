import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WRITTEN_MAX,
  answerCounter,
  answerProblem,
  checkErrorView,
  checkResultView,
  checkType,
  checkView,
  checkingText,
  graderUnavailable,
  positionedOptions,
  privacyLine,
  writtenBody,
  writtenLimit,
} from '../../src/access/check-view.mjs';

// GET /api/me/onboarding/steps/:stepId/check, contract v1.4.
const choice = {
  stepId: 'policies.handbook',
  type: 'choice',
  scenario: 'A colleague asks to borrow your badge.',
  options: [
    { id: 'q7x', text: 'Lend it for the day' },
    { id: 'a2k', text: 'Say no and point them to reception' },
    { id: 'm9p', text: 'Ignore the request' },
  ],
  sourceTitle: 'Employee Handbook',
};
const written = {
  stepId: 'policies.pdpa',
  type: 'written',
  scenario: 'A client emails asking for a colleague’s phone number. What do you do?',
  sourceTitle: 'Data protection policy',
  maxLength: 600,
};

test('the view state per check type', () => {
  assert.deepEqual(checkView({}), { phase: 'loading', type: 'choice' });
  assert.equal(checkView({ error: { code: 'X' } }).phase, 'unavailable');
  const choosing = checkView({ check: choice });
  assert.equal(choosing.type, 'choice');
  assert.equal(choosing.phase, 'answering');
  assert.equal(choosing.submitLabel, 'Check my answer');
  assert.equal(choosing.privacy, '', 'only written checks carry the privacy line');
  const writing = checkView({ check: written });
  assert.equal(writing.type, 'written');
  assert.equal(writing.submitLabel, 'Ask Alya to check');
  assert.equal(writing.privacy, privacyLine);
  assert.equal(privacyLine, 'Your written answer is only used to check it and is not saved.');
  const checking = checkView({ check: written, busy: true });
  assert.equal(checking.phase, 'checking');
  assert.equal(checking.status, checkingText);
  assert.equal(checkingText, 'Alya is checking your answer…');
  assert.equal(checkView({ check: written, result: { correct: true } }).phase, 'passed');
  assert.equal(checkView({ check: written, result: { correct: true } }).showForm, false);
  assert.equal(checkView({ check: written, result: { correct: false } }).showForm, true);
  // A v1.3 check without a type is a choice check.
  assert.equal(checkType({ options: [] }), 'choice');
});

test('options are labelled by their position as sent, never by id', () => {
  const first = positionedOptions(choice);
  assert.deepEqual(
    first.map((option) => [option.position, option.text]),
    [
      [1, 'Lend it for the day'],
      [2, 'Say no and point them to reception'],
      [3, 'Ignore the request'],
    ],
  );
  // The server reshuffles on every request: the same option gets a new number,
  // and the ids (opaque) never decide a label.
  const reshuffled = positionedOptions({ ...choice, options: [...choice.options].reverse() });
  assert.deepEqual(
    reshuffled.map((option) => [option.position, option.id]),
    [
      [1, 'm9p'],
      [2, 'a2k'],
      [3, 'q7x'],
    ],
  );
  const lettered = positionedOptions({
    options: [
      { id: 'c', text: 'Third' },
      { id: 'a', text: 'First' },
    ],
  });
  assert.deepEqual(
    lettered.map((option) => option.position),
    [1, 2],
    'an id of "a" does not become option 1',
  );
  assert.deepEqual(positionedOptions({ options: [{ id: 'x' }, null, { text: 'no id' }] }), []);
});

test('the written answer counter and its 600 character limit', () => {
  assert.equal(writtenLimit(written), 600);
  assert.equal(writtenLimit({ maxLength: 250 }), 250);
  assert.equal(writtenLimit({}), WRITTEN_MAX);
  assert.equal(writtenLimit({ maxLength: '0' }), WRITTEN_MAX);
  assert.equal(answerCounter('', 600), '0 / 600');
  assert.equal(answerCounter('Ask the client to contact my colleague.', 600), '39 / 600');
  assert.equal(answerCounter('👋 hi', 600), '4 / 600', 'counts characters, not code units');
  assert.equal(answerProblem('   '), 'Write your answer first.');
  assert.equal(answerProblem('a'.repeat(600)), '');
  assert.equal(answerProblem('a'.repeat(601)), 'Keep your answer to 600 characters or fewer.');
  assert.deepEqual(writtenBody('  I would not share it.  '), { answer: 'I would not share it.' });
});

test('the new error codes map to inline and general messages', () => {
  assert.deepEqual(checkErrorView({ status: 400, code: 'CHECK_ANSWER_INVALID' }, 'written'), {
    field: 'Write between 1 and 600 characters, then try again.',
    message: '',
  });
  assert.deepEqual(checkErrorView({ status: 400, code: 'CHECK_ANSWER_INVALID' }, 'choice'), {
    field: '',
    message: 'Choose one of the answers, then try again.',
  });
  assert.deepEqual(checkErrorView({ status: 503, code: 'CHECK_GRADER_UNAVAILABLE' }, 'written'), {
    field: '',
    message: graderUnavailable,
  });
  assert.equal(
    graderUnavailable,
    'Alya can’t check written answers right now. Please try again later.',
  );
  assert.match(checkErrorView({ status: 409, code: 'BRIEFING_REQUIRED' }).message, /briefing/);
  assert.equal(
    checkErrorView({ status: 429 }).message,
    'That’s a lot at once. Please try again shortly.',
  );
});

test('a failed written answer keeps the text for another try; a pass shows the explanation', () => {
  const fail = checkResultView(
    { correct: false, feedback: 'You named the right person, but not why.', explanation: null },
    'written',
  );
  assert.equal(fail.tone, 'retry');
  assert.equal(fail.keepAnswer, true);
  assert.equal(fail.feedback, 'You named the right person, but not why.');
  assert.equal(fail.explanation, '', 'the official explanation is only shown on a pass');
  const pass = checkResultView(
    { correct: true, feedback: 'Well put.', explanation: 'Personal data needs consent.' },
    'written',
  );
  assert.equal(pass.tone, 'success');
  assert.equal(pass.feedback, 'Well put.');
  assert.equal(pass.explanation, 'Personal data needs consent.');
  assert.equal(pass.keepAnswer, false);
  // The choice flow is unchanged: a wrong answer explains and allows a retry.
  const wrong = checkResultView({ correct: false, explanation: 'Badges are personal.' });
  assert.equal(wrong.title, 'Not quite. Here is why.');
  assert.equal(wrong.explanation, 'Badges are personal.');
  assert.match(wrong.hint, /Nothing is recorded/);
  assert.equal(
    checkResultView({ correct: true, explanation: 'Yes.' }).title,
    'That’s right. Step marked done.',
  );
});
