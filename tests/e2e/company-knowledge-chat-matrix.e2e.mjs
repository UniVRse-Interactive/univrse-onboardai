// Issue #79: sample-guide chat matrix. Prints one JSON line per question/run.
// Needs BASE_URL, HR_ID, HR_PASSWORD, optional RUNS (default 2), QUESTIONS (JSON array) and Gemini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, ask } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3143';
const { HR_ID, HR_PASSWORD } = process.env;
const runs = Number(process.env.RUNS || 2);
const skip = !HR_ID || !HR_PASSWORD ? 'HR_ID and HR_PASSWORD are not set' : false;
const QUESTIONS = process.env.QUESTIONS
  ? JSON.parse(process.env.QUESTIONS)
  : [
      'What should I do on my first day?',
      'What are the working hours?',
      'Who do I ask about my laptop?',
      'How do I find the company documents that apply to my role?',
      'What if I cannot open an approved company link?',
    ];
const WITHHELD = 'does not clearly establish';

test('sample-guide chat matrix', { skip, timeout: 600000 }, async () => {
  const hr = client(base);
  await hr.post('/api/auth/sign-in', { username: HR_ID, password: HR_PASSWORD });
  const dept = (await hr.get('/api/hr/departments')).json.departments.find((d) => !d.archived).name;
  const created = await hr.post('/api/hr/employees', {
    profile: {
      job: {
        fullName: `Qa Matrix ${Date.now().toString(36)}`,
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
  await emp.post('/api/auth/password', {
    currentPassword: temp,
    newPassword: `Qa-${Math.random().toString(36).slice(2)}-Pass1!`,
  });
  for (const q of QUESTIONS) {
    for (let i = 1; i <= runs; i++) {
      const r = await ask(emp, q);
      const j = r.json || {};
      console.log(
        'ROW ' +
          JSON.stringify({
            q,
            run: i,
            status: r.status,
            coverage: j.coverage,
            passages: (j.passages || []).map((p) => ({
              date: p.date ?? null,
              dateKind: p.dateKind ?? null,
            })),
            withheld: String(j.answer || '').includes(WITHHELD),
            guardrail: 'guardrail' in j,
            source: j.source,
            total: j.timingsMs?.total,
            answer: String(j.answer || '').slice(0, 110),
          }),
      );
    }
  }
});
