// Issue #79: chat regression on the sample guide (no stale reply, no guardrail key, dates null,
// no gs:// in any body). Needs BASE_URL, HR_ID, HR_PASSWORD and Gemini (AI_MODE=gemini-chat).
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, ask } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3143';
const { HR_ID, HR_PASSWORD } = process.env;
const skip = !HR_ID || !HR_PASSWORD ? 'HR_ID and HR_PASSWORD are not set' : false;

test('first-day question: answered, no guardrail, dates null, no gs://', { skip }, async () => {
  const hr = client(base);
  await hr.post('/api/auth/sign-in', { username: HR_ID, password: HR_PASSWORD });
  const dept = (await hr.get('/api/hr/departments')).json.departments.find((d) => !d.archived).name;
  const created = await hr.post('/api/hr/employees', {
    profile: {
      job: {
        fullName: `Qa Fresh ${Date.now().toString(36)}`,
        department: dept,
        startDate: new Date().toISOString().slice(0, 10),
        track: 'employee',
      },
    },
  });
  assert.equal(created.status, 201);
  const emp = client(base);
  const temp = created.json.temporaryPassword;
  await emp.post('/api/auth/sign-in', {
    username: created.json.employee.account.username,
    password: temp,
  });
  const pw = `Qa-${Math.random().toString(36).slice(2)}-Pass1!`;
  await emp.post('/api/auth/password', { currentPassword: temp, newPassword: pw });
  const r = await ask(emp, 'What should I do on my first day?');
  assert.equal(r.status, 200, r.text);
  console.log('answer:', r.json.answer.slice(0, 200));
  console.log('coverage:', r.json.coverage, 'passages:', r.json.passages.length);
  assert.ok(r.json.answer.length > 20);
  assert.equal('guardrail' in r.json, false);
  for (const p of r.json.passages) assert.equal(p.date, null);
  assert.ok(!r.text.includes('gs://'));
  const conv = await emp.get(`/api/conversations/${r.conversationId}`);
  assert.ok(!conv.text.includes('gs://'));
  assert.ok(!conv.text.includes('"guardrail"'));
});
