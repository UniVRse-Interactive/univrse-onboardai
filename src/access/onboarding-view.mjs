// What the signed-in employee sees for the onboarding footprint
// (GET /api/me/onboarding, contract v1): labels, step actions, messages.

import { journeyErrorMessage } from './journey-errors.mjs';

export const stepStatusLabels = {
  todo: 'To do',
  submitted: 'Waiting for HR to verify',
};

// Status text for one step.
export function stepStatusLabel(step) {
  if (step.status === 'submitted') return stepStatusLabels.submitted;
  if (step.status === 'done') {
    if (step.completion === 'hr_verify') return 'Verified by HR';
    if (step.completion === 'check') return 'Check passed';
    return 'Done';
  }
  return stepStatusLabels.todo;
}

export const actionLabels = {
  complete: 'Mark as done',
  reopen: 'Undo',
  submit: 'I’ve submitted this',
  withdraw: 'Withdraw',
  check: 'Take the check with Alya',
  ask: 'Ask Alya',
  briefing: 'Get Alya’s briefing',
};

// v1.5: a required step needs Alya's briefing before it can be completed.
export const briefingGateReason = 'Listen to Alya’s briefing first';
export const briefingDoneLabel = 'Briefing done';
export function needsBriefing(step) {
  return step?.briefingRequired === true && step.briefed !== true;
}
// "Briefing done" while the step still has something left to do.
export function briefingStatus(step) {
  return step?.briefingRequired === true && step.briefed === true && step.status !== 'done'
    ? briefingDoneLabel
    : '';
}

// The buttons a step shows, in order. Verified HR steps and passed checks are
// locked, so they only keep "Ask Alya".
export function stepActions(step) {
  const actions = [];
  const { completion, status } = step;
  if (status === 'todo' && needsBriefing(step)) actions.push('briefing');
  if (completion === 'self') actions.push(status === 'done' ? 'reopen' : 'complete');
  else if (completion === 'hr_verify') {
    if (status === 'todo') actions.push('submit');
    else if (status === 'submitted') actions.push('withdraw');
  } else if (completion === 'check' && status === 'todo') actions.push('check');
  if (step.askAlya) actions.push('ask');
  return actions;
}

// The step's buttons with their state. Until the briefing is done, the action
// that completes the step is disabled and says why.
const completing = new Set(['complete', 'submit', 'check']);
export function stepActionStates(step) {
  const gated = needsBriefing(step);
  return stepActions(step).map((action) => ({
    action,
    label: actionLabels[action],
    disabled: gated && completing.has(action),
    reason: gated && completing.has(action) ? briefingGateReason : '',
  }));
}

export function isLocked(step) {
  return step.status === 'done' && step.completion !== 'self';
}

// Calm inline text for a failed step action (409s named in the contract).
export function stepErrorMessage(error) {
  switch (error?.code) {
    case 'BRIEFING_REQUIRED':
      return 'Listen to Alya’s briefing first. Choose “Get Alya’s briefing”.';
    case 'BRIEFING_NOT_FOUND':
      return 'This step has no briefing. Your list has been refreshed.';
    case 'CHECK_REQUIRED':
      return 'This step needs a short check with Alya first. Choose “Take the check with Alya”.';
    case 'STEP_LOCKED':
      return 'HR has already verified this step, so only HR can change it.';
    case 'STEP_NOT_FOUND':
      return 'This step is no longer in your plan. Your list has been refreshed.';
    default:
      return journeyErrorMessage(error);
  }
}

export function areaSummary(area) {
  return `${area.done} of ${area.total} ${area.total === 1 ? 'step' : 'steps'} done`;
}

export const optionalLabel = 'Optional: doesn’t affect your progress';
export const optionalStepLabel = (step) => (step.required === false ? optionalLabel : '');

// The threshold and "complete" come from the API; nothing is recomputed here.
export function thresholdOf(onboarding) {
  return Number.isFinite(onboarding?.threshold) ? onboarding.threshold : 70;
}
export function areasAtThreshold(onboarding) {
  const areas = onboarding?.areas || [];
  return { met: areas.filter((area) => area.meetsThreshold).length, total: areas.length };
}
export function areasSummary(onboarding) {
  const { met, total } = areasAtThreshold(onboarding);
  return `${met} of ${total} areas at ${thresholdOf(onboarding)}%`;
}
// "Complete" at 100%, "Meets 70%" at or above the threshold, otherwise null.
export function areaBadge(area, onboarding) {
  if (!area?.meetsThreshold) return null;
  return area.percent >= 100 ? 'Complete' : `Meets ${thresholdOf(onboarding)}%`;
}
export function overallSummary(onboarding) {
  const waiting = onboarding.waitingOnHr
    ? ` · ${onboarding.waitingOnHr} waiting for HR to verify`
    : '';
  return `${areasSummary(onboarding)}${waiting}`;
}

// The "Your next step" banner. kind: 'next' | 'complete' | 'waiting'.
export function nextStepBanner(onboarding) {
  if (onboarding.nextStep) {
    const { nextStep } = onboarding;
    return {
      kind: 'next',
      title: nextStep.title,
      areaTitle: nextStep.areaTitle,
      stepId: nextStep.id,
      askAlya: nextStep.askAlya || null,
      completion: nextStep.completion,
    };
  }
  if (onboarding.complete)
    return {
      kind: 'complete',
      title: 'Onboarding complete',
      text:
        'Every area is at ' +
        thresholdOf(onboarding) +
        '% or more. The remaining steps are still worth finishing when you can.',
    };
  if (onboarding.waitingOnHr > 0)
    return {
      kind: 'waiting',
      title: 'You’re waiting on HR',
      text: `${onboarding.waitingOnHr} ${onboarding.waitingOnHr === 1 ? 'step is' : 'steps are'} with HR to verify. Nothing else is needed from you right now.`,
    };
  return {
    kind: 'complete',
    title: 'No steps left right now',
    text: 'Ask HR if anything else is needed.',
  };
}

// A step by id, with its area.
export function findStep(onboarding, stepId) {
  for (const area of onboarding?.areas || [])
    for (const step of area.steps) if (step.id === stepId) return { area, step };
  return null;
}

// Result of a check answer: { correct, explanation } -> message and tone.
export function checkResultMessage(result) {
  if (result?.correct)
    return { tone: 'success', title: 'That’s right. Step marked done.', text: result.explanation };
  return {
    tone: 'retry',
    title: 'Not quite. Here is why.',
    text: result?.explanation || '',
  };
}

export function formatWhen(iso, { timeZone } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

// Status text for the employee's own request (MyRequest, no HR note).
export function myRequestStatus(request, options) {
  if (request.status === 'briefing_scheduled') {
    const when = formatWhen(request.briefingAt, options);
    return when ? `Briefing scheduled for ${when}` : 'Briefing scheduled';
  }
  if (request.status === 'resolved') return 'Resolved';
  return 'With HR';
}

// Rows for the "Your first day" card; null while HR has not filled it in.
export function firstDayRows(firstDay) {
  if (!firstDay) return null;
  const rows = [
    { label: 'Where to go', value: firstDay.location },
    { label: 'Arrive at', value: firstDay.arrivalTime },
    { label: 'Who will meet you', value: firstDay.hostName },
  ];
  if (firstDay.hostContact) rows.push({ label: 'How to reach them', value: firstDay.hostContact });
  if (firstDay.notes) rows.push({ label: 'Good to know', value: firstDay.notes });
  return rows.filter((row) => row.value);
}
