// #48 support requests, #49 knowledge gaps, #50 chips and first-day details.
// Run: BASE_URL=http://127.0.0.1:3130 HR_ID=... HR_PASSWORD=... node --test tests/e2e/support-gaps.e2e.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, ask } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3130';
const hrId = process.env.HR_ID;
const hrPassword = process.env.HR_PASSWORD;
const skip = !hrId || !hrPassword ? 'HR_ID and HR_PASSWORD are not set' : false;
const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

async function newEmployee(hr, fullName, startOffsetDays) {
  const dept = (await hr.get('/api/hr/departments')).json.departments.find((d) => !d.archived).name;
  const startDate = new Date(Date.now() + startOffsetDays * 864e5).toISOString().slice(0, 10);
  const r = await hr.post('/api/hr/employees', {
    profile: { job: { fullName, department: dept, startDate, track: 'employee' } },
  });
  assert.equal(r.status, 201);
  const c = client(base);
  const temp = r.json.temporaryPassword;
  await c.post('/api/auth/sign-in', { username: r.json.employee.account.username, password: temp });
  const password = `Qa-${Math.random().toString(36).slice(2)}-Pass1!`;
  assert.equal(
    (await c.post('/api/auth/password', { currentPassword: temp, newPassword: password })).status,
    200,
  );
  return { c, id: r.json.employee.account.id, name: fullName };
}

test('#50 chips and first-day details', { skip }, async () => {
  const hr = client(base);
  await hr.post('/api/auth/sign-in', { username: hrId, password: hrPassword });
  const e = await newEmployee(hr, 'Qa Chip Emp', 1);
  const chips = (await e.c.get('/api/me/quick-questions')).json;
  log('chips', chips);
  const list = chips.questions ?? chips.chips ?? chips;
  const host = list.find((q) => /Who will meet me/.test(q.label ?? q.question ?? q.text));
  assert.ok(host, 'host chip present for a new starter');
  // before HR fills the details in
  let r = await ask(e.c, host.question ?? host.label, { quickQuestionId: host.id });
  log('host before', r.json?.answer, r.json?.coverage, r.json?.source);
  assert.equal(r.json.coverage, 'none');
  assert.match(r.json.answer, /HR/);
  // HR enters the host
  const put = await hr.put(`/api/hr/employees/${e.id}/first-day`, {
    location: 'Level 12 reception',
    arrivalTime: '09:30',
    hostName: 'Qa Host Person',
    hostContact: 'qa.host@example.test',
    notes: 'Bring your IC.',
  });
  assert.equal(put.status, 200);
  r = await ask(e.c, host.question ?? host.label, { quickQuestionId: host.id });
  log('host after', r.json.answer, r.json.coverage, r.json.source);
  assert.match(r.json.answer, /Qa Host Person/);
  assert.match(r.json.answer, /qa\.host@example\.test/);
  // background chip: cited answer
  const bg = await ask(e.c, 'Explain the company background');
  log('background', bg.json.answer.slice(0, 200), bg.json.passages?.length, bg.json.coverage);
  assert.ok(bg.json.passages.length > 0);
});

test('#48 support request lifecycle and #49 knowledge gaps', { skip }, async () => {
  const hr = client(base);
  await hr.post('/api/auth/sign-in', { username: hrId, password: hrPassword });
  const e = await newEmployee(hr, `Qa Support ${Math.random().toString(36).slice(2, 7)}`, -2);
  const a = await ask(e.c, 'What are the working hours?');
  assert.equal(a.status, 200);
  const conv = (await e.c.get(`/api/conversations/${a.conversationId}`)).json;
  const msg = (conv.messages ?? conv.conversation.messages)
    .filter((m) => m.role === 'assistant')
    .at(-1);
  const body = { conversationId: a.conversationId, messageId: msg.id };
  const pre = await e.c.post('/api/me/support-requests/preview', body);
  log('preview', pre.status, pre.json);
  assert.equal(pre.status, 200);
  assert.equal(pre.json.question ?? pre.json.preview?.question, 'What are the working hours?');
  // preview alone sends nothing
  let list = (await hr.get('/api/hr/support-requests')).json.requests;
  assert.ok(!list.some((q) => q.employee?.name === e.name), 'preview sends nothing');
  const made = await e.c.post('/api/me/support-requests', { ...body, note: 'QA note' });
  assert.equal(made.status, 201);
  list = (await hr.get('/api/hr/support-requests')).json.requests;
  const mine = list.find((q) => q.employee?.name === e.name);
  assert.ok(mine, 'HR sees it under the employee name');
  const open0 = (await hr.get('/api/hr/team-insights')).json.openSupportRequests;
  const at = new Date(Date.now() + 864e5).toISOString();
  let p = await hr.patch(`/api/hr/support-requests/${mine.id}`, {
    status: 'briefing_scheduled',
    briefingAt: at,
  });
  assert.equal(p.status, 200);
  let seen = (await e.c.get('/api/me/support-requests')).json.requests[0];
  log('employee sees', seen);
  assert.equal(seen.status, 'briefing_scheduled');
  assert.ok(seen.briefingAt);
  assert.ok(!('hrNote' in seen));
  p = await hr.patch(`/api/hr/support-requests/${mine.id}`, { status: 'resolved' });
  assert.equal(p.status, 200);
  seen = (await e.c.get('/api/me/support-requests')).json.requests[0];
  assert.equal(seen.status, 'resolved');
  const open1 = (await hr.get('/api/hr/team-insights')).json.openSupportRequests;
  log('open requests before/after resolve', open0, open1);
  assert.ok(open1 <= open0);
  // retired per-employee summaries
  const sums = await hr.get('/api/hr/support-summaries');
  assert.ok([404, 410].includes(sums.status), 'summaries removed');

  // #49 gaps
  const gap = await ask(
    e.c,
    'My email is qa.person@example.test and my phone is 012-3456789. How do I claim the pet insurance perk for my hamster?',
  );
  log('gap answer', gap.json.coverage, gap.json.category);
  const weather = await ask(e.c, "What's the weather today?");
  log('weather', weather.json.category, weather.json.coverage);
  const gaps = JSON.stringify((await hr.get('/api/hr/knowledge-gaps')).json);
  assert.ok(!/qa\.person@example\.test/.test(gaps) && !/3456789/.test(gaps), 'redacted');
  assert.ok(/\[email\]/.test(gaps), 'email placeholder stored');
  assert.ok(!/weather/i.test(gaps), 'off-topic not logged');
  assert.ok(!/Qa Support Two/.test(gaps) && !/CS-\d{4}/.test(gaps), 'no names or ids');
  assert.ok(!/T\d\d:\d\d/.test(gaps), 'no time of day');
});
