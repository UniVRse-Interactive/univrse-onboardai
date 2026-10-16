import { checkInStatus } from './hr-report-insights.mjs';

function person({ id, name, summary, account = null }) {
  const answers = summary.turns;
  const activity = checkInStatus(summary);
  return {
    id,
    name,
    summary,
    account,
    answers,
    activity,
    detail: `${answers} ${answers === 1 ? 'answer' : 'answers'} · ${activity}`,
  };
}

// GET /api/hr/support-summaries -> { employees: [{ account, name, summary }] }.
// `summary` is the same value as the guest snapshot's guests[].summary.
export function supportSummaryPeople(payload) {
  return (payload?.employees || []).map(({ account, name, summary }) =>
    person({
      id: account.id,
      name: String(name || '').trim() || account.username,
      summary,
      account,
    }),
  );
}

// Guest workspace snapshot guests[] -> the same row shape.
export function guestPeople(guests = []) {
  return guests.map((guest) => person(guest));
}
