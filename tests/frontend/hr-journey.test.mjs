import test from 'node:test';
import assert from 'node:assert/strict';
import {
  briefingIso,
  briefingParts,
  countsView,
  filterRequests,
  firstDayBody,
  firstDayToForm,
  gapView,
  hrStepAction,
  hrStepStatus,
  insightsView,
  onboardingCell,
  requestPatch,
  requestSourceTitles,
  requestToForm,
  supportCounter,
  trackLabel,
  validateFirstDay,
} from '../../src/access/hr-journey.mjs';

test('track labels default to Employee', () => {
  assert.equal(trackLabel('intern'), 'Intern');
  assert.equal(trackLabel('contractor'), 'Contractor');
  assert.equal(trackLabel(undefined), 'Employee');
});
test('onboarding column shows percent and waiting steps', () => {
  assert.deepEqual(onboardingCell({ onboarding: { percent: 60, waitingOnHr: 2 } }), {
    percent: '60%',
    waiting: 2,
    complete: false,
    label: '60% done, 2 waiting for HR',
  });
  const done = onboardingCell({ onboarding: { percent: 90, waitingOnHr: 0, complete: true } });
  assert.equal(done.complete, true);
  assert.equal(done.label, '90% done, complete');
  assert.equal(onboardingCell({}).percent, '—');
});
test('HR step actions: submitted steps stand out and can be verified', () => {
  const step = (completion, status) => ({ completion, status });
  assert.deepEqual(hrStepAction(step('hr_verify', 'submitted')), {
    action: 'verify',
    label: 'Verify',
    highlight: true,
  });
  assert.equal(hrStepAction(step('hr_verify', 'done')).action, 'unverify');
  assert.equal(hrStepAction(step('hr_verify', 'todo')), null);
  assert.equal(hrStepAction(step('self', 'submitted')), null);
  assert.match(hrStepStatus(step('hr_verify', 'submitted')), /waiting for you/);
  assert.equal(hrStepStatus(step('hr_verify', 'done')), 'Verified');
});
test('the Support requests counter is counts.open', () => {
  assert.equal(supportCounter({ open: 3, briefing_scheduled: 1, resolved: 9 }), 3);
  assert.equal(supportCounter(undefined), 0);
  assert.deepEqual(countsView({ open: 1, resolved: 2 }), {
    open: 1,
    briefing_scheduled: 0,
    resolved: 2,
    all: 3,
  });
});
test('status filter', () => {
  const list = [{ status: 'open' }, { status: 'resolved' }, { status: 'open' }];
  assert.equal(filterRequests(list, 'all').length, 3);
  assert.equal(filterRequests(list, 'open').length, 2);
  assert.equal(filterRequests(list, 'briefing_scheduled').length, 0);
  assert.deepEqual(filterRequests(null, 'open'), []);
});
test('briefing date and time round-trip through an ISO instant', () => {
  const iso = briefingIso('2026-10-20', '14:30');
  assert.match(iso, /^2026-10-20T|^2026-10-19T|^2026-10-21T/);
  assert.deepEqual(briefingParts(iso), { date: '2026-10-20', time: '14:30' });
  assert.equal(briefingIso('2026-10-20', ''), null);
  assert.equal(briefingIso('', '10:00'), null);
  assert.equal(briefingIso('2026-10-20', '25:00'), null);
  assert.deepEqual(briefingParts(null), { date: '', time: '' });
});
const request = (extra = {}) => ({
  id: 'r1',
  status: 'open',
  hrNote: null,
  briefingAt: null,
  docNeedsUpdate: false,
  docToUpdate: null,
  sources: [
    { title: 'Handbook', heading: 'Leave' },
    { title: 'Handbook', heading: 'Pay' },
    { title: 'Policy', heading: 'X' },
  ],
  ...extra,
});
test('request form starts from the request', () => {
  const form = requestToForm(
    request({ hrNote: 'Called', docNeedsUpdate: true, docToUpdate: 'Policy' }),
  );
  assert.equal(form.hrNote, 'Called');
  assert.equal(form.docToUpdate, 'Policy');
  assert.deepEqual(requestSourceTitles(request()), ['Handbook', 'Policy']);
});
test('an unchanged form sends nothing', () => {
  const r = request();
  assert.deepEqual(requestPatch(r, requestToForm(r)), { errors: {}, patch: {} });
});
test('Briefing scheduled needs a date and time', () => {
  const r = request();
  const form = { ...requestToForm(r), status: 'briefing_scheduled' };
  const { errors, patch } = requestPatch(r, form);
  assert.match(errors.briefing, /date and time/);
  assert.deepEqual(patch, {});
  const ok = requestPatch(r, { ...form, briefingDate: '2026-10-20', briefingTime: '09:00' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.patch.status, 'briefing_scheduled');
  assert.equal(ok.patch.briefingAt, briefingIso('2026-10-20', '09:00'));
});
test('a half-filled briefing is an error', () => {
  const r = request();
  const { errors } = requestPatch(r, { ...requestToForm(r), briefingDate: '2026-10-20' });
  assert.match(errors.briefing, /both a date and a time/);
});
test('HR note: trimmed, cleared with null, capped at 1000', () => {
  const r = request({ hrNote: 'old' });
  const form = requestToForm(r);
  assert.deepEqual(requestPatch(r, { ...form, hrNote: '  new  ' }).patch, { hrNote: 'new' });
  assert.deepEqual(requestPatch(r, { ...form, hrNote: '' }).patch, { hrNote: null });
  assert.match(requestPatch(r, { ...form, hrNote: 'x'.repeat(1001) }).errors.hrNote, /1000/);
});
test('Doc needs update must pick one of the request sources', () => {
  const r = request();
  const form = { ...requestToForm(r), docNeedsUpdate: true };
  assert.match(requestPatch(r, form).errors.docToUpdate, /Choose which document/);
  assert.match(requestPatch(r, { ...form, docToUpdate: 'Other' }).errors.docToUpdate, /Choose/);
  assert.deepEqual(requestPatch(r, { ...form, docToUpdate: 'Policy' }).patch, {
    docNeedsUpdate: true,
    docToUpdate: 'Policy',
  });
  const flagged = request({ docNeedsUpdate: true, docToUpdate: 'Policy' });
  assert.deepEqual(
    requestPatch(flagged, { ...requestToForm(flagged), docNeedsUpdate: false }).patch,
    {
      docNeedsUpdate: false,
      docToUpdate: null,
    },
  );
  assert.match(
    requestPatch(request({ sources: [] }), { ...form, docToUpdate: '' }).errors.docToUpdate,
    /no source documents/,
  );
});
test('knowledge gap groups', () => {
  const view = gapView({
    topic: 'Parking',
    count: 4,
    lastSeenDay: '2026-10-15',
    examples: ['a', 'b', 'c', 'd'],
    tracks: { employee: 3, intern: 1, contractor: 0 },
    nearestSources: [
      { title: 'Handbook', heading: 'Travel' },
      { title: 'Policy', heading: 'Policy' },
    ],
  });
  assert.equal(view.countLabel, '4 questions');
  assert.equal(view.examples.length, 3);
  assert.equal(view.tracks, 'Employee 3 · Intern 1');
  assert.deepEqual(view.sources, ['Handbook — Travel', 'Policy']);
  assert.equal(gapView({ topic: 't', count: 1 }).countLabel, '1 question');
});
test('team insights stay hidden under three employees', () => {
  const view = insightsView({
    minimumGroup: 3,
    employeesWithData: 2,
    available: false,
    openSupportRequests: 4,
  });
  assert.equal(view.available, false);
  assert.equal(view.message, 'Not enough employees yet to show team trends (needs 3).');
  assert.deepEqual(view.stats, []);
  assert.equal(insightsView(null).available, false);
});
test('team insights show aggregates when available', () => {
  const view = insightsView({
    employeesWithData: 5,
    available: true,
    openSupportRequests: 2,
    period: { from: '2026-10-01', to: '2026-10-16' },
    turns: 40,
    humanHelpRequests: 3,
    feedback: { helpful: 20, unclear: 5 },
    formats: { steps: 4, example: 2, brief: 1 },
    requests: { steps: 1 },
  });
  assert.equal(view.available, true);
  assert.equal(view.period, '2026-10-01 to 2026-10-16');
  assert.deepEqual(
    view.stats.map((s) => [s.label, s.value]),
    [
      ['Employees with activity', '5'],
      ['Open support requests', '2'],
      ['Answers given', '40'],
      ['Asked for a person', '3'],
    ],
  );
  assert.equal(view.breakdowns[0].rows[1].label, 'Still unclear');
  assert.equal(view.breakdowns.length, 3);
});
test('first-day form: required and optional fields', () => {
  assert.deepEqual(Object.keys(validateFirstDay(firstDayToForm(null))).sort(), [
    'arrivalTime',
    'hostName',
    'location',
  ]);
  const form = {
    location: 'Level 3, Tower B',
    arrivalTime: '09:00',
    hostName: 'Aina',
    hostContact: '',
    notes: '',
  };
  assert.deepEqual(validateFirstDay(form), {});
  assert.deepEqual(firstDayBody(form), {
    location: 'Level 3, Tower B',
    arrivalTime: '09:00',
    hostName: 'Aina',
  });
  assert.deepEqual(firstDayBody({ ...form, hostContact: ' 012-345 ', notes: ' Bring ID ' }), {
    location: 'Level 3, Tower B',
    arrivalTime: '09:00',
    hostName: 'Aina',
    hostContact: '012-345',
    notes: 'Bring ID',
  });
});
test('first-day limits and time format', () => {
  const base = { location: 'L', arrivalTime: '09:00', hostName: 'H', hostContact: '', notes: '' };
  assert.match(validateFirstDay({ ...base, location: 'x'.repeat(121) }).location, /120/);
  assert.match(validateFirstDay({ ...base, hostName: 'x'.repeat(81) }).hostName, /80/);
  assert.match(validateFirstDay({ ...base, hostContact: 'x'.repeat(121) }).hostContact, /120/);
  assert.match(validateFirstDay({ ...base, notes: 'x'.repeat(301) }).notes, /300/);
  for (const bad of ['9:00', '24:00', '09:60', '9am'])
    assert.match(validateFirstDay({ ...base, arrivalTime: bad }).arrivalTime, /such as 09:00/);
  assert.equal(validateFirstDay({ ...base, arrivalTime: '23:59' }).arrivalTime, undefined);
  assert.match(validateFirstDay({ ...base, location: 'a\nb' }).location, /line breaks/);
});
