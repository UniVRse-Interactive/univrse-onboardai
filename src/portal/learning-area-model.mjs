export const learningAreas = ['policies', 'alignment', 'role-tools', 'team-support'];
export function learningSummary(area) {
  const required = area.steps.filter((step) => step.required !== false);
  const done = required.filter((step) => step.status === 'done').length;
  return {
    done,
    total: required.length,
    next: required.find((step) => step.status !== 'done'),
    action:
      done === required.length
        ? 'Review'
        : area.steps.some((step) => step.briefed || step.status !== 'todo')
          ? 'Continue'
          : 'Start',
  };
}
export const learningStatus = (step) =>
  step.status === 'done'
    ? 'Completed'
    : step.briefed || step.status === 'submitted'
      ? 'In Progress'
      : 'Not Started';
export function continueLearning(areas) {
  return areas
    .filter((area) => learningAreas.includes(area.id))
    .flatMap((area) => area.steps)
    .find((step) => step.required !== false && step.status !== 'done');
}
export function focusLearningStep(id) {
  const task = document.getElementById('learning-' + id);
  if (!task) return;
  task.closest('.learning-area').open = true;
  task.open = true;
  task.querySelector('summary').focus();
  task.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
// Only URLs supplied in the existing task content are offered; never construct company links.
export function taskResources(step) {
  return [...new Set((step.description || '').match(/https:\/\/[^\s)<>]+/g) || [])];
}

// How a task is verified, in the employee's words: what finishes it, whether it
// is mandatory, what happens when it is not passed, and what is saved. The
// methods match the server (server/task-verification-routes.mjs).
const guides = {
  policy: {
    method: 'Reading acknowledgement + short quiz',
    toComplete: 'Acknowledge that you read the summary, then pass the quiz at the pass mark.',
    ifStuck: 'Read the notes on the questions you missed and retry as often as you need.',
    saved: 'Your acknowledgement and each quiz attempt are saved separately.',
  },
  matching: {
    method: 'Matching activity',
    toComplete: 'Match every item correctly.',
    ifStuck: 'Re-read the summary above and try again.',
    saved: 'Each attempt and the date you passed.',
  },
  knowledge: {
    method: 'Short knowledge check',
    toComplete: 'Answer the questions and reach the pass mark.',
    ifStuck: 'Read the notes on missed questions and retry as often as you need.',
    saved: 'Each attempt, your score and the date you passed.',
  },
  access: {
    method: 'Coordinator confirmation',
    toComplete:
      'Request confirmation. This task completes when your onboarding coordinator confirms you have access.',
    ifStuck: 'If you cannot open the tool, ask your onboarding coordinator for the invitation.',
    saved: 'Your request and the coordinator’s confirmation.',
  },
  scenario: {
    method: 'Scenario check',
    toComplete: 'Answer the scenario correctly.',
    ifStuck: 'Read the explanation and try again.',
    saved: 'Completion once you pass.',
  },
  assessment: {
    method: 'Self-assessment (not pass/fail)',
    toComplete:
      'Save your self-assessment. The practice exercise is optional and recorded separately.',
    ifStuck: 'Choose “Not sure yet” if you cannot rate yourself. Nothing here is graded.',
    saved: 'Your rating, your learning path and, if you confirm it, the practice exercise.',
  },
  self: {
    method: 'Self-reported practical task',
    toComplete: 'Do the task, then confirm it. This is your own confirmation, not a system check.',
    ifStuck: 'Ask your onboarding coordinator or manager for help.',
    saved: 'Your confirmation and its date.',
  },
  optional: {
    method: 'Optional',
    toComplete: 'Nothing is required. Skip it if you prefer.',
    ifStuck: 'Nothing is lost if you skip.',
    saved: 'Nothing is saved for this activity.',
  },
};

export function verificationGuide(step, areaId, accessStepIds = []) {
  const mandatory = step.required !== false;
  let kind = 'self';
  if (!mandatory) kind = 'optional';
  else if (areaId === 'policies') kind = 'policy';
  else if (areaId === 'alignment')
    kind = step.id === 'alignment.products-customers' ? 'matching' : 'knowledge';
  else if (step.id === 'role-tools.ai-readiness-training') kind = 'assessment';
  else if (accessStepIds.includes(step.id)) kind = 'access';
  else if (step.completion === 'check') kind = 'scenario';
  return { kind, mandatory, ...guides[kind] };
}

// Where an access request stands: 'done' | 'awaiting' | 'none'.
export function accessState(step, record) {
  if (step.status === 'done' || record?.status === 'confirmed') return 'done';
  return record?.status === 'awaiting_confirmation' ? 'awaiting' : 'none';
}

// The checklist beside Alya: the same steps and statuses as the onboarding
// section (never a second list). Only required steps are counted; a step is
// "done" only when the server says so, never because its section was opened.
export function checklistModel(onboarding, { accessStepIds = [], tools = {} } = {}) {
  const groups = (onboarding?.areas || [])
    .filter((area) => learningAreas.includes(area.id))
    .map((area) => {
      const tasks = area.steps.map((step) => ({
        id: step.id,
        title: step.title,
        required: step.required !== false,
        done: step.status === 'done',
        started: step.status === 'submitted' || Boolean(step.briefed),
        state: taskStatusLabel(step, area.id, accessStepIds, tools[step.id]),
      }));
      const required = tasks.filter((task) => task.required);
      return {
        id: area.id,
        title: area.title,
        icon: area.icon,
        tasks,
        done: required.filter((task) => task.done).length,
        total: required.length,
      };
    });
  const done = groups.reduce((sum, group) => sum + group.done, 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  return { groups, done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

// Clicking a checklist task hands its id to the onboarding page, which opens it.
export const focusStepKey = 'onboarding-focus-step';

// The honest status of a task. Access to a tool is "Verified" only after the
// coordinator confirms it; a self-reported setup task is "Employee-confirmed".
export function taskStatusLabel(step, areaId, accessStepIds = [], toolRecord) {
  if (areaId === 'role-tools' && accessStepIds.includes(step.id)) {
    const state = accessState(step, toolRecord);
    if (state === 'done') return 'Verified';
    if (state === 'awaiting') return 'Awaiting verification';
    return step.briefed ? 'In Progress' : 'Not Started';
  }
  if (
    step.status === 'done' &&
    step.completion === 'self' &&
    (areaId === 'role-tools' || areaId === 'team-support') &&
    step.id !== 'role-tools.ai-readiness-training'
  )
    return 'Employee-confirmed';
  return learningStatus(step);
}

// The one primary button of a task. mode "open" reveals the activity inline;
// mode "confirm" records an employee-confirmed setup task. null = nothing to do
// (finished, or waiting on someone else).
export function primaryAction(
  step,
  areaId,
  { accessStepIds = [], hasQuiz = false, acknowledged = false, tool } = {},
) {
  const kind = verificationGuide(step, areaId, accessStepIds).kind;
  const done = step.status === 'done';
  if (kind === 'policy') {
    if (done) return { label: 'Review', mode: 'open', quiet: true };
    if (!acknowledged || !hasQuiz) return { label: 'Read & Confirm Acknowledgement', mode: 'open' };
    return { label: 'Start Quiz', mode: 'open' };
  }
  if (kind === 'matching' || kind === 'knowledge') {
    const label =
      step.id === 'alignment.role-contribution'
        ? 'Start Activity'
        : kind === 'matching'
          ? 'Start Activity'
          : 'Start Quiz';
    return done ? { label: 'Review', mode: 'open', quiet: true } : { label, mode: 'open' };
  }
  if (kind === 'access') {
    return accessState(step, tool) === 'none'
      ? { label: 'Request Access Verification', mode: 'open' }
      : null;
  }
  if (kind === 'assessment')
    return { label: done ? 'Review Assessment' : 'Start Assessment', mode: 'open', quiet: done };
  if (kind === 'scenario') return done ? null : { label: 'Start Quiz', mode: 'open' };
  if (kind === 'optional')
    return step.id === 'team-support.working-preferences'
      ? { label: 'Open Optional Form', mode: 'open', quiet: true }
      : done
        ? null
        : { label: 'Confirm Setup', mode: 'confirm', quiet: true };
  return done ? null : { label: 'Confirm Setup', mode: 'confirm' };
}

// The real cause of a failed load, in plain words, never a generic message.
export function describeLoadError(e) {
  if (e?.status === 404 || e?.code === 'NOT_FOUND')
    return 'The verification activities could not be loaded: this server does not have the verification routes. Restart the server so it runs the current code.';
  if (e?.status === 401 || e?.status === 403)
    return 'The verification activities could not be loaded because your session is not allowed to read them. Sign in again.';
  if (e?.status === 503)
    return (
      e.message || 'The verification activities could not be loaded because storage is unavailable.'
    );
  if (!e?.status)
    return 'The verification activities could not be loaded: the server could not be reached. Check your connection.';
  return `The verification activities could not be loaded (${e.code || e.status}): ${e.message}`;
}
