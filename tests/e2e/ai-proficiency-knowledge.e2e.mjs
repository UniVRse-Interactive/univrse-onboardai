// PR #75: company knowledge metadata-only storage, Vertex-only retrieval, onboarding
// templates v3 and the AI proficiency self-assessment API.
// Needs a live app: BASE_URL, HR_ID, HR_PASSWORD (a local HR account) and, to read the
// stored documents, FIRESTORE_EMULATOR_HOST + FIRESTORE_PROJECT_ID (emulator only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, ask } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3130';
const { HR_ID, HR_PASSWORD, FIRESTORE_EMULATOR_HOST, FIRESTORE_PROJECT_ID } = process.env;
const hr = client(base);
const emp = client(base);
const run = Date.now().toString(36);
const fact = `Zorblax cafeteria rule ${run}: lunch tokens are issued at the Plinth Annex on Thursdays only.`;
const created = [];
let employeeId;
let newEmployeeId;

const profile = {
  job: {
    fullName: 'Quinn Tester',
    preferredName: 'Quinn',
    jobTitle: 'Onboarding Analyst',
    department: 'People & Culture',
    startDate: '2026-11-02',
    manager: 'Jordan Sample',
  },
  contact: {
    workEmail: 'quinn.tester@example.com',
    personalEmail: 'quinn.home@example.org',
    mobileNumber: '+65 5550 0101',
  },
  emergencyContact: {
    name: 'Riley Example',
    relationship: 'Sibling',
    phoneNumber: '+65 5550 0102',
  },
  homeAddress: {
    line1: '1 Example Street',
    line2: '#01-01',
    city: 'Sample City',
    state: 'Sample State',
    postcode: '000001',
    country: 'Exampleland',
  },
};

async function upload(category, fileName, text) {
  await hr.get('/api/hr/company-knowledge');
  const res = await fetch(
    `${base}/api/hr/company-knowledge/documents?${new URLSearchParams({ category })}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(fileName),
        origin: base,
        cookie: hr.cookie(),
      },
      body: Buffer.from(text),
    },
  );
  const json = await res.json().catch(() => null);
  if (json?.id && !json.duplicate) created.push(json.id);
  return { status: res.status, json };
}

after(async () => {
  for (const id of created) {
    await hr.call('DELETE', `/api/hr/company-knowledge/documents/${id}`);
  }
  if (newEmployeeId) await hr.call('DELETE', `/api/hr/employees/${newEmployeeId}`);
});

test('sign in as HR', { skip: !HR_ID || !HR_PASSWORD }, async () => {
  const r = await hr.post('/api/auth/sign-in', { username: HR_ID, password: HR_PASSWORD });
  assert.equal(r.status, 200, r.text);
});

test('company knowledge: upload, duplicate, no text stored, delete, delete again', async () => {
  const a = await upload('role-tools', `qa75-${run}.txt`, fact);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const dup = await upload('role-tools', `qa75-${run}.txt`, fact);
  assert.equal(dup.status, 200);
  assert.equal(dup.json.duplicate, true);
  const list = await hr.get('/api/hr/company-knowledge');
  assert.equal(list.status, 200);
  const listed = JSON.stringify(list.json);
  assert.ok(listed.includes(a.json.id), 'uploaded doc is listed');
  assert.ok(!listed.includes('Plinth Annex'), 'listing carries no document text');
  created.length = 0;
  if (FIRESTORE_EMULATOR_HOST) {
    const url = `http://${FIRESTORE_EMULATOR_HOST}/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/companyDocuments`;
    const fs = await (await fetch(url, { headers: { authorization: 'Bearer owner' } })).json();
    const stored = (fs.documents || []).find((d) => d.name.endsWith('/' + a.json.id));
    assert.ok(stored, 'firestore metadata doc exists');
    assert.ok(!('text' in stored.fields), 'no text field: ' + Object.keys(stored.fields));
    assert.ok(!JSON.stringify(stored).includes('Plinth'), 'no text content anywhere');
    for (const k of ['category', 'title', 'fileName', 'characters', 'bytes', 'fingerprint'])
      assert.ok(k in stored.fields, 'has ' + k);
    console.log('stored fields:', Object.keys(stored.fields).sort().join(','));
  }
  const del = await hr.call('DELETE', `/api/hr/company-knowledge/documents/${a.json.id}`);
  assert.equal(del.status, 204, del.text);
  const again = await hr.call('DELETE', `/api/hr/company-knowledge/documents/${a.json.id}`);
  assert.equal(again.status, 404, again.text);
  const after = await hr.get('/api/hr/company-knowledge');
  assert.ok(!JSON.stringify(after.json).includes(a.json.id), 'removed from list');
});

test('employee chat is not answered from a local upload (Vertex-only retrieval)', async () => {
  const made = await hr.post('/api/hr/employees', { profile });
  assert.equal(made.status, 201, made.text);
  newEmployeeId = made.json.employee.account.id;
  employeeId = made.json.employee.account.username;
  const temp = made.json.temporaryPassword;
  const si = await emp.post('/api/auth/sign-in', { username: employeeId, password: temp });
  assert.equal(si.status, 200, si.text);
  if (si.json.account.mustChangePassword !== false) {
    const ch = await emp.post('/api/auth/password', {
      currentPassword: temp,
      newPassword: 'QaEmp-75-Strong!pw',
    });
    assert.equal(ch.status, 200, ch.text);
  }
  const r = await ask(emp, 'Where are lunch tokens issued on Thursdays at the Zorblax cafeteria?');
  console.log('upload-only question ->', r.status, r.text.slice(0, 400));
  assert.ok(!/Plinth Annex/i.test(r.text), 'answer must not come from the upload');
});

test('regression: sample onboarding guide question is answered', async () => {
  const r = await ask(emp, 'What should I do in my first week?');
  console.log('guide question ->', r.status, r.text.slice(0, 300));
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.length > 80);
});

test('AI proficiency contract', async () => {
  const get = await emp.get('/api/me/ai-proficiency');
  assert.equal(get.status, 200, get.text);
  assert.equal(get.json.levels.length, 10);
  assert.ok(get.json.learningPaths);
  assert.equal(get.json.aiProficiency.status, 'unanswered');
  assert.equal(get.json.aiProficiency.learningPathId, 'beginner');
  assert.equal(get.json.aiProficiency.trainingCompleted, false);

  const path = async (body) => {
    const r = await emp.put('/api/me/ai-proficiency', body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.onboarding, 'has onboarding');
    return r.json;
  };
  const step = (j) =>
    JSON.stringify(j.onboarding).includes('ai-readiness-training')
      ? findStep(j.onboarding, 'role-tools.ai-readiness-training')
      : null;
  const mapping = [
    [{ status: 'assessed', level: 1 }, 'beginner'],
    [{ status: 'assessed', level: 3 }, 'beginner'],
    [{ status: 'assessed', level: 4 }, 'intermediate'],
    [{ level: 6 }, 'intermediate'],
    [{ status: 'assessed', level: 7 }, 'advanced'],
    [{ status: 'assessed', level: 10 }, 'advanced'],
    [{ status: 'not_sure' }, 'beginner'],
    [{ status: 'skipped' }, 'beginner'],
  ];
  for (const [body, want] of mapping) {
    const j = await path(body);
    assert.equal(j.aiProficiency.learningPathId, want, JSON.stringify(body));
    assert.equal(j.aiProficiency.trainingCompleted, false);
    assert.notEqual(step(j)?.status, 'done', 'rating must not complete the step');
  }
  const j10 = await path({ status: 'assessed', level: 5 });
  assert.equal(j10.aiProficiency.level, 5);
  assert.ok(j10.aiProficiency.practiceTask && j10.aiProficiency.learningPath);

  for (const bad of [
    { status: 'assessed', level: 0 },
    { status: 'assessed', level: 11 },
    { status: 'assessed', level: 2.5 },
    { status: 'assessed', level: '5' },
    { status: 'assessed' },
    { status: 'bogus' },
    { level: 5, extra: 1 },
    {},
    { status: 'not_sure', level: 3 },
  ]) {
    const r = await emp.put('/api/me/ai-proficiency', bad);
    assert.equal(r.status, 400, JSON.stringify(bad) + ' -> ' + r.text);
    assert.equal(r.json.error?.code ?? r.json.code, 'AI_PROFICIENCY_INVALID', r.text);
  }
  const x = await emp.put('/api/me/ai-proficiency?companyId=other', { level: 3 });
  assert.equal(x.status, 403, x.text);
  const x2 = await emp.put('/api/me/ai-proficiency', { level: 3, companyId: 'other' });
  assert.ok([400, 403].includes(x2.status), 'body companyId: ' + x2.status);
  console.log('body companyId ->', x2.status, x2.text.slice(0, 120));
  const x3 = await emp.get('/api/me/ai-proficiency?companyId=other');
  assert.equal(x3.status, 403, x3.text);

  const bigNote = await emp.post('/api/me/ai-proficiency/complete-training', {
    practiceNote: 'x'.repeat(2001),
  });
  assert.equal(bigNote.status, 400, bigNote.text);
  const mid = await emp.get('/api/me/ai-proficiency');
  assert.equal(mid.json.aiProficiency.trainingCompleted, false);

  const done = await emp.post('/api/me/ai-proficiency/complete-training', {
    practiceNote: 'Secret practice note ' + run,
  });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.aiProficiency.trainingCompleted, true);
  assert.ok(done.json.aiProficiency.trainingCompletedAt);
  assert.equal(findStep(done.json.onboarding, 'role-tools.ai-readiness-training').status, 'done');
  assert.ok(!JSON.stringify(done.json).includes('Secret practice note'), 'note not echoed');

  const re = await path({ status: 'assessed', level: 8 });
  assert.equal(re.aiProficiency.trainingCompleted, true);
  assert.equal(findStep(re.onboarding, 'role-tools.ai-readiness-training').status, 'done');
  assert.equal(re.aiProficiency.learningPathId, 'advanced');

  const empHr = await emp.get(`/api/hr/employees/${newEmployeeId}/ai-proficiency`);
  assert.equal(empHr.status, 403);
  assert.equal(empHr.json.error?.code ?? empHr.json.code, 'HR_ROLE_REQUIRED');
  const hrView = await hr.get(`/api/hr/employees/${newEmployeeId}/ai-proficiency`);
  assert.equal(hrView.status, 200, hrView.text);
  assert.equal(hrView.json.aiProficiency.level, 8);
  assert.equal(hrView.json.levels.length, 10);
  const hrSelf = await hr.get('/api/me/ai-proficiency');
  assert.ok([403, 404].includes(hrSelf.status), 'HR on employee route: ' + hrSelf.status);
});

function findStep(onboarding, id) {
  const seen = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.id === id) seen.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(onboarding);
  return seen[0];
}

test('chat records an AI proficiency rating', async () => {
  const r = await ask(emp, 'I rated my AI proficiency level 3');
  console.log('chat rating ->', r.status, r.text.slice(0, 300));
  assert.equal(r.status, 200, r.text);
  const g = await emp.get('/api/me/ai-proficiency');
  assert.equal(g.json.aiProficiency.level, 3);
  assert.equal(g.json.aiProficiency.learningPathId, 'beginner');
});

test('v3 templates: step counts', async () => {
  const o = await emp.get('/api/me/onboarding');
  assert.equal(o.status, 200, o.text);
  const areas = o.json.onboarding?.areas ?? o.json.areas ?? o.json.onboarding?.sections;
  console.log(
    'areas keys:',
    areas ? areas.map((a) => a.id ?? a.areaId).join(',') : Object.keys(o.json),
  );
  const steps = (id) => {
    const area = areas.find((a) => (a.id ?? a.areaId) === id);
    return area.steps ?? area.items;
  };
  const ts = steps('team-support');
  const rt = steps('role-tools');
  const req = (s) => s.filter((x) => !x.optional && x.required !== false);
  console.log('team-support', ts.length, req(ts).length, 'role-tools', rt.length, req(rt).length);
  assert.equal(ts.length, 5);
  assert.equal(req(ts).length, 4);
  assert.equal(rt.length, 11);
  assert.ok(rt.some((x) => x.id === 'role-tools.ai-readiness-training'));
});
