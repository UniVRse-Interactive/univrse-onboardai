import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areaBadge,
  areaSummary,
  areasSummary,
  optionalStepLabel,
  checkResultMessage,
  findStep,
  firstDayRows,
  focusAfterStepAction,
  formatWhen,
  isLocked,
  myRequestStatus,
  nextStepBanner,
  overallSummary,
  stepActions,
  stepErrorMessage,
  stepStatusLabel,
} from '../../src/access/onboarding-view.mjs';

const step = (completion, status, extra = {}) => ({
  id: 'a.b',
  completion,
  status,
  askAlya: null,
  ...extra,
});

test('self steps: Mark as completed, then Undo', () => {
  assert.deepEqual(stepActions(step('self', 'todo')), ['complete']);
  assert.deepEqual(stepActions(step('self', 'done')), ['reopen']);
  assert.equal(stepStatusLabel(step('self', 'done')), 'Done');
  assert.equal(isLocked(step('self', 'done')), false);
});
test('hr_verify steps: submit, wait with withdraw, then verified and locked', () => {
  assert.deepEqual(stepActions(step('hr_verify', 'todo')), ['submit']);
  assert.deepEqual(stepActions(step('hr_verify', 'submitted')), ['withdraw']);
  assert.deepEqual(stepActions(step('hr_verify', 'done')), []);
  assert.equal(stepStatusLabel(step('hr_verify', 'submitted')), 'Waiting for HR to verify');
  assert.equal(stepStatusLabel(step('hr_verify', 'done')), 'Verified by HR');
  assert.equal(isLocked(step('hr_verify', 'done')), true);
});
test('check steps: take the check; passing locks the step', () => {
  assert.deepEqual(stepActions(step('check', 'todo')), ['check']);
  assert.deepEqual(stepActions(step('check', 'done')), []);
  assert.equal(stepStatusLabel(step('check', 'done')), 'Check passed');
  assert.equal(isLocked(step('check', 'done')), true);
});
test('a step with an askAlya question always offers Ask Alya last', () => {
  assert.deepEqual(stepActions(step('self', 'todo', { askAlya: 'q?' })), ['complete', 'ask']);
  assert.deepEqual(stepActions(step('hr_verify', 'done', { askAlya: 'q?' })), ['ask']);
});
test('409 errors become calm inline messages', () => {
  assert.match(stepErrorMessage({ code: 'CHECK_REQUIRED' }), /short check with Alya/);
  assert.match(stepErrorMessage({ code: 'STEP_LOCKED' }), /only HR can change/);
  assert.match(stepErrorMessage({ code: 'STEP_NOT_FOUND' }), /no longer/);
  assert.equal(stepErrorMessage({ message: 'Server said no' }), 'Server said no');
  assert.match(stepErrorMessage(null), /try again/);
});
const onboarding = (extra = {}) => ({
  percent: 40,
  waitingOnHr: 0,
  nextStep: null,
  areas: [
    {
      id: 'documentation',
      done: 1,
      total: 3,
      steps: [step('self', 'done', { id: 'documentation.id' })],
    },
    { id: 'policies', done: 1, total: 2, steps: [step('check', 'todo', { id: 'policies.x' })] },
  ],
  ...extra,
});
test('summaries count required steps and areas at the threshold', () => {
  const data = onboarding({
    threshold: 70,
    waitingOnHr: 2,
    areas: [
      { id: 'a', done: 3, total: 4, meetsThreshold: true, percent: 75, steps: [] },
      { id: 'b', done: 1, total: 3, meetsThreshold: false, percent: 33, steps: [] },
      { id: 'c', done: 4, total: 4, meetsThreshold: true, percent: 100, steps: [] },
    ],
  });
  assert.equal(areaSummary(data.areas[0]), '3 of 4 steps done');
  assert.equal(areaSummary({ done: 0, total: 1 }), '0 of 1 step done');
  assert.equal(areasSummary(data), '2 of 3 areas at 70%');
  assert.equal(overallSummary(data), '2 of 3 areas at 70% · 2 waiting for HR to verify');
  assert.equal(areasSummary({ areas: [] }), '0 of 0 areas at 70%');
});
test('area badges use the API threshold flag, not the percent', () => {
  const data = { threshold: 70 };
  assert.equal(areaBadge({ meetsThreshold: true, percent: 75 }, data), 'Meets 70%');
  assert.equal(areaBadge({ meetsThreshold: true, percent: 100 }, data), 'Complete');
  assert.equal(areaBadge({ meetsThreshold: false, percent: 69 }, data), null);
  assert.equal(areaBadge({ meetsThreshold: false, percent: 90 }, data), null);
  assert.equal(areaBadge({ meetsThreshold: true, percent: 80 }, { threshold: 80 }), 'Meets 80%');
});
test('optional steps are labelled', () => {
  assert.equal(optionalStepLabel({ required: false }), 'Optional: doesn’t affect your progress');
  assert.equal(optionalStepLabel({ required: true }), '');
  assert.equal(optionalStepLabel({}), '');
});
test('complete shows Onboarding complete with a note', () => {
  const banner = nextStepBanner(onboarding({ complete: true, nextStep: null }));
  assert.equal(banner.kind, 'complete');
  assert.equal(banner.title, 'Onboarding complete');
  assert.match(banner.text, /still worth finishing/);
});
test('next step banner: next, waiting on HR, or complete', () => {
  const next = {
    id: 'policies.x',
    title: 'Read the code of conduct',
    areaTitle: 'Policies',
    completion: 'check',
    askAlya: 'What is the code of conduct?',
  };
  assert.deepEqual(nextStepBanner(onboarding({ nextStep: next })), {
    kind: 'next',
    title: 'Read the code of conduct',
    areaTitle: 'Policies',
    stepId: 'policies.x',
    askAlya: 'What is the code of conduct?',
    completion: 'check',
  });
  const waiting = nextStepBanner(onboarding({ waitingOnHr: 1, complete: false }));
  assert.equal(waiting.kind, 'waiting');
  assert.match(waiting.text, /1 step is with HR/);
  assert.equal(nextStepBanner(onboarding({ complete: false })).kind, 'complete');
});
test('findStep returns the step and its area', () => {
  const found = findStep(onboarding(), 'policies.x');
  assert.equal(found.area.id, 'policies');
  assert.equal(findStep(onboarding(), 'nope'), null);
  assert.equal(findStep(null, 'x'), null);
});
test('check results: pass marks done, a wrong answer explains and allows a retry', () => {
  assert.equal(checkResultMessage({ correct: true, explanation: 'Because.' }).tone, 'success');
  const wrong = checkResultMessage({ correct: false, explanation: 'Because B.' });
  assert.equal(wrong.tone, 'retry');
  assert.equal(wrong.text, 'Because B.');
});
test('my request status wording', () => {
  assert.equal(myRequestStatus({ status: 'open' }), 'With HR');
  assert.equal(myRequestStatus({ status: 'resolved' }), 'Resolved');
  assert.equal(
    myRequestStatus(
      { status: 'briefing_scheduled', briefingAt: '2026-10-20T07:30:00.000Z' },
      { timeZone: 'UTC' },
    ),
    'Briefing scheduled for 20 Oct 2026, 07:30',
  );
  assert.equal(
    myRequestStatus({ status: 'briefing_scheduled', briefingAt: null }),
    'Briefing scheduled',
  );
  assert.equal(formatWhen('nonsense'), '');
});
test('first-day card stays hidden until HR fills it in', () => {
  assert.equal(firstDayRows(null), null);
  const rows = firstDayRows({
    location: 'Level 3',
    arrivalTime: '09:00',
    hostName: 'Aina',
    hostContact: null,
    notes: 'Bring your ID',
  });
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Where to go', 'Arrive at', 'Who will meet you', 'Good to know'],
  );
});

test('#66: a step with a briefing starts with Ask Alya; its action follows the briefing', () => {
  const briefing = { briefingRequired: true, askAlya: 'Who is my buddy?' };
  assert.deepEqual(stepActions(step('self', 'todo', briefing)), ['ask']);
  assert.deepEqual(stepActions(step('hr_verify', 'todo', briefing)), ['ask']);
  assert.deepEqual(stepActions(step('check', 'todo', briefing)), ['ask']);
  assert.deepEqual(stepActions(step('self', 'todo', { ...briefing, briefed: true })), [
    'ask',
    'complete',
  ]);
  assert.deepEqual(stepActions(step('check', 'done', { ...briefing, briefed: true })), ['ask']);
  assert.equal(
    stepErrorMessage({ status: 409, code: 'BRIEFING_REQUIRED' }),
    'Listen to Alya’s briefing first. Choose “Ask Alya” on this step.',
  );
});

test('one wording everywhere: Mark as completed and Mark as submitted', async () => {
  const { actionLabels } = await import('../../src/access/onboarding-view.mjs');
  const { briefingAction } = await import('../../src/avatar/briefing-flow.mjs');
  assert.equal(actionLabels.complete, 'Mark as completed');
  assert.equal(actionLabels.submit, 'Mark as submitted');
  // The dashboard shortcut and Alya's page use the same words.
  assert.equal(briefingAction({ completion: 'self', status: 'todo' }).label, actionLabels.complete);
  assert.equal(
    briefingAction({ completion: 'hr_verify', status: 'todo' }).label,
    actionLabels.submit,
  );
  assert.equal(
    briefingAction({ completion: 'hr_verify', status: 'todo' }).note,
    'HR will verify it.',
  );
  // Status texts are unchanged.
  assert.equal(
    stepStatusLabel({ completion: 'hr_verify', status: 'submitted' }),
    'Waiting for HR to verify',
  );
  assert.equal(stepStatusLabel({ completion: 'hr_verify', status: 'done' }), 'Verified by HR');
  assert.equal(stepStatusLabel({ completion: 'self', status: 'done' }), 'Done');
});

test('#66 QA: after a dashboard action, focus goes back to its button or to the step status', () => {
  const briefed = { briefingRequired: true, briefed: true, askAlya: 'Who is my buddy?' };
  // Mark as completed is gone once the step is done: focus the "Done" badge.
  assert.equal(focusAfterStepAction(step('self', 'done', briefed), 'complete'), 'status');
  assert.equal(focusAfterStepAction(step('hr_verify', 'submitted', briefed), 'submit'), 'status');
  assert.equal(focusAfterStepAction(step('self', 'todo', briefed), 'reopen'), 'status');
  // A failed action leaves the step as it was: back to the same button.
  assert.equal(focusAfterStepAction(step('self', 'todo', briefed), 'complete'), 'action');
  assert.equal(focusAfterStepAction(step('hr_verify', 'submitted'), 'withdraw'), 'action');
  // The step left the plan.
  assert.equal(focusAfterStepAction(undefined, 'complete'), 'status');
});
