// HR side of the onboarding journey: tracks, support requests, knowledge gaps,
// team insights and the first-day form. Pure rules; the server re-checks all.

import { fieldProblems, journeyErrorMessage } from './journey-errors.mjs';

export const tracks = [
  { value: 'employee', label: 'Employee' },
  { value: 'intern', label: 'Intern' },
  { value: 'contractor', label: 'Contractor' },
];
export const defaultTrack = 'employee';
export const isTrack = (value) => tracks.some((track) => track.value === value);
export function trackLabel(value) {
  return tracks.find((track) => track.value === value)?.label || 'Employee';
}

// Employees table cell: "60%" plus how many steps wait on HR.
export function onboardingCell(employee) {
  const onboarding = employee?.onboarding;
  if (!onboarding) return { percent: '—', waiting: 0, complete: false, label: 'No data' };
  const waiting = onboarding.waitingOnHr || 0;
  return {
    percent: `${onboarding.percent}%`,
    waiting,
    complete: onboarding.complete === true,
    label: `${onboarding.percent}% done${onboarding.complete ? ', complete' : ''}${waiting ? `, ${waiting} waiting for HR` : ''}`,
  };
}

// Steps that need HR's attention come first in the per-employee panel.
export function hrStepAction(step) {
  if (step.completion !== 'hr_verify') return null;
  if (step.status === 'submitted') return { action: 'verify', label: 'Verify', highlight: true };
  if (step.status === 'done') return { action: 'unverify', label: 'Unverify', highlight: false };
  return null;
}
export function hrStepStatus(step) {
  if (step.status === 'submitted') return 'Submitted — waiting for you to verify';
  if (step.status === 'done') return step.completion === 'hr_verify' ? 'Verified' : 'Done';
  return 'To do';
}
export function hrStepError(error) {
  return journeyErrorMessage(error);
}

// Support requests.
export const requestStatuses = [
  { value: 'open', label: 'Open' },
  { value: 'briefing_scheduled', label: 'Briefing scheduled' },
  { value: 'resolved', label: 'Resolved' },
];
export const requestFilters = [{ value: 'all', label: 'All' }, ...requestStatuses];
export const statusLabel = (value) =>
  requestStatuses.find((status) => status.value === value)?.label || 'Open';

export function countsView(counts = {}) {
  const open = counts.open || 0,
    scheduled = counts.briefing_scheduled || 0,
    resolved = counts.resolved || 0;
  return { open, briefing_scheduled: scheduled, resolved, all: open + scheduled + resolved };
}
// The "Support requests" counter is the open count.
export const supportCounter = (counts) => countsView(counts).open;

export function filterRequests(requests, filter) {
  const list = Array.isArray(requests) ? requests : [];
  return filter === 'all' || !filter ? list : list.filter((request) => request.status === filter);
}

const pad = (n) => String(n).padStart(2, '0');
// ISO instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in the browser's zone.
export function briefingParts(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: '', time: '' };
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}
// Local date and time -> ISO instant, or null when either is missing/invalid.
export function briefingIso(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || ''))
    return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export const hrNoteMax = 1000;

export function requestToForm(request) {
  const { date, time } = briefingParts(request.briefingAt);
  return {
    status: request.status,
    hrNote: request.hrNote || '',
    briefingDate: date,
    briefingTime: time,
    docNeedsUpdate: !!request.docNeedsUpdate,
    docToUpdate: request.docToUpdate || '',
  };
}

export function requestSourceTitles(request) {
  return [...new Set((request.sources || []).map((source) => source.title).filter(Boolean))];
}

// Form -> { errors, patch }. The patch holds only what changed (PATCH body).
export function requestPatch(request, form) {
  const errors = {};
  const patch = {};
  const note = String(form.hrNote ?? '').trim();
  if ([...note].length > hrNoteMax) errors.hrNote = `Keep your note to ${hrNoteMax} characters.`;
  const iso = briefingIso(form.briefingDate, form.briefingTime);
  const hasBriefingInput = !!(form.briefingDate || form.briefingTime);
  if (hasBriefingInput && !iso) errors.briefing = 'Choose both a date and a time for the briefing.';
  if (form.status === 'briefing_scheduled' && !iso && !errors.briefing)
    errors.briefing = 'Choose a date and time for the briefing.';
  if (form.docNeedsUpdate) {
    const titles = requestSourceTitles(request);
    if (!form.docToUpdate || !titles.includes(form.docToUpdate))
      errors.docToUpdate = titles.length
        ? 'Choose which document needs updating.'
        : 'This request has no source documents to choose from.';
  }
  if (Object.keys(errors).length) return { errors, patch: {} };

  if (form.status !== request.status) patch.status = form.status;
  if (note !== (request.hrNote || '')) patch.hrNote = note || null;
  if (hasBriefingInput && iso !== request.briefingAt) patch.briefingAt = iso;
  if (!hasBriefingInput && request.briefingAt) patch.briefingAt = null;
  const docNeeds = !!form.docNeedsUpdate;
  if (docNeeds !== !!request.docNeedsUpdate) patch.docNeedsUpdate = docNeeds;
  const doc = docNeeds ? form.docToUpdate : null;
  if (doc !== (request.docToUpdate || null)) patch.docToUpdate = doc;
  return { errors, patch };
}

export function requestUpdateError(error) {
  return journeyErrorMessage(error, 'Could not save this request. Please try again.');
}

// Knowledge gaps.
export function gapView(group) {
  const counts = group.tracks || {};
  const trackText = tracks
    .filter((track) => counts[track.value] > 0)
    .map((track) => `${track.label} ${counts[track.value]}`)
    .join(' · ');
  return {
    topic: group.topic,
    countLabel: `${group.count} ${group.count === 1 ? 'question' : 'questions'}`,
    examples: (group.examples || []).slice(0, 3),
    tracks: trackText,
    sources: (group.nearestSources || []).map((source) =>
      source.heading && source.heading !== source.title
        ? `${source.title} — ${source.heading}`
        : source.title,
    ),
    lastSeenDay: group.lastSeenDay || '',
  };
}

// Team insights.
export const insightsUnavailableText = 'Not enough employees yet to show team trends (needs 3).';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function insightsView(insights) {
  if (!insights || insights.available !== true)
    return { available: false, message: insightsUnavailableText, stats: [], breakdowns: [] };
  const stats = [
    { label: 'Employees with activity', value: String(insights.employeesWithData ?? 0) },
    { label: 'Open support requests', value: String(insights.openSupportRequests ?? 0) },
  ];
  if (typeof insights.turns === 'number')
    stats.push({ label: 'Answers given', value: String(insights.turns) });
  if (typeof insights.humanHelpRequests === 'number')
    stats.push({ label: 'Asked for a person', value: String(insights.humanHelpRequests) });
  const breakdowns = [];
  const add = (title, record, names) => {
    if (!record || typeof record !== 'object') return;
    const rows = Object.entries(record)
      .filter(([, n]) => typeof n === 'number')
      .map(([key, n]) => ({ label: names[key] || key, value: n }));
    if (rows.length) breakdowns.push({ title, rows });
  };
  add('Did this help?', insights.feedback, { helpful: 'Helpful', unclear: 'Still unclear' });
  add('Answer styles asked for', insights.formats, {
    steps: 'Smaller steps',
    example: 'Examples',
    brief: 'Brief',
  });
  add('Explanation requests', insights.requests, {
    steps: 'Smaller steps',
    example: 'Examples',
    brief: 'Brief',
  });
  let period = '';
  if (typeof insights.period === 'string') period = insights.period;
  else if (insights.period && typeof insights.period === 'object') {
    const from = insights.period.from || insights.period.start || '';
    const to = insights.period.to || insights.period.end || '';
    period = from && to ? `${from} to ${to}` : from || to;
  }
  return {
    available: true,
    message: '',
    period,
    stats,
    breakdowns,
    footnote: `Based on ${plural(insights.employeesWithData ?? 0, 'employee', 'employees')}. Never shown for fewer than 3.`,
  };
}

// First-day details form.
export const firstDayLimits = { location: 120, hostName: 80, hostContact: 120, notes: 300 };

export function firstDayToForm(firstDay) {
  return {
    location: firstDay?.location || '',
    arrivalTime: firstDay?.arrivalTime || '',
    hostName: firstDay?.hostName || '',
    hostContact: firstDay?.hostContact || '',
    notes: firstDay?.notes || '',
  };
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const controls = /[\u0000-\u001f\u007f]/;
export function validateFirstDay(form) {
  const errors = {};
  const text = (key) => String(form?.[key] ?? '').trim();
  const check = (key, label, required) => {
    const value = text(key);
    if (!value) {
      if (required) errors[key] = `${label} is required.`;
      return;
    }
    if ([...value].length > firstDayLimits[key])
      errors[key] = `${label} must be at most ${firstDayLimits[key]} characters.`;
    else if (key !== 'notes' && controls.test(value))
      errors[key] = `${label} cannot contain line breaks.`;
  };
  check('location', 'Location', true);
  check('hostName', 'Host name', true);
  check('hostContact', 'Host contact', false);
  check('notes', 'Notes', false);
  const time = text('arrivalTime');
  if (!time) errors.arrivalTime = 'Arrival time is required.';
  else if (!timePattern.test(time)) errors.arrivalTime = 'Use a time such as 09:00.';
  return errors;
}

// Form -> PUT body; blank optional fields are left out.
export function firstDayBody(form) {
  const body = {
    location: String(form.location).trim(),
    arrivalTime: String(form.arrivalTime).trim(),
    hostName: String(form.hostName).trim(),
  };
  const contact = String(form.hostContact ?? '').trim();
  const notes = String(form.notes ?? '').trim();
  if (contact) body.hostContact = contact;
  if (notes) body.notes = notes;
  return body;
}

export const firstDayLabels = {
  location: 'Location',
  arrivalTime: 'Arrival time',
  hostName: 'Host name',
  hostContact: 'Host contact',
  notes: 'Notes',
};
// A save failure -> { errors: {field: text}, message } (server FIRST_DAY_INVALID fields[]).
export function firstDayErrorView(error) {
  const errors = fieldProblems(error?.fields, firstDayLabels);
  if (Object.keys(errors).length) return { errors, message: '' };
  return {
    errors: {},
    message: journeyErrorMessage(error, 'Could not save the first-day details. Please try again.'),
  };
}
