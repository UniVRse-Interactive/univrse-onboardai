// The onboarding footprint API (issue #47): pg-mem, the in-memory Firestore
// fake and synthetic people only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startAccountsApp, syntheticProfile } from './account-harness.mjs';
import { builtInTemplate } from '../../server/onboarding-content.mjs';

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
const withTrack = (track, name = 'Avery Example') => {
  const profile = syntheticProfile(name);
  profile.job.track = track;
  return profile;
};
const step = (onboarding, id) =>
  onboarding.areas.flatMap((area) => area.steps).find((s) => s.id === id);
const area = (onboarding, id) => onboarding.areas.find((a) => a.id === id);

test('every new route needs a session; employee routes refuse HR and HR routes refuse employees', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr);
    const id = employee.account.id;
    const anonymous = app.browser();
    const employeeRoutes = [
      ['get', '/api/me/onboarding'],
      ['post', '/api/me/onboarding/steps/alignment.mission-values/complete'],
      ['post', '/api/me/onboarding/steps/alignment.mission-values/reopen'],
      ['get', '/api/me/onboarding/steps/policies.workplace-conduct/check'],
      ['post', '/api/me/onboarding/steps/policies.workplace-conduct/check'],
      ['get', '/api/me/quick-questions'],
      ['get', '/api/me/first-day'],
      ['post', '/api/me/support-requests/preview'],
      ['post', '/api/me/support-requests'],
      ['get', '/api/me/support-requests'],
    ];
    const hrRoutes = [
      ['get', '/api/hr/support-requests'],
      ['patch', '/api/hr/support-requests/0123456789abcdef0123456789abcdef'],
      ['get', '/api/hr/knowledge-gaps'],
      ['get', '/api/hr/team-insights'],
      ['get', `/api/hr/employees/${id}/onboarding`],
      ['patch', `/api/hr/employees/${id}/onboarding/steps/documentation.contract`],
      ['get', `/api/hr/employees/${id}/first-day`],
      ['put', `/api/hr/employees/${id}/first-day`],
    ];
    for (const [method, path] of [...employeeRoutes, ...hrRoutes]) {
      const none = await anonymous[method](path);
      assert.deepEqual([none.status, none.body.code], [401, 'AUTH_REQUIRED'], path);
      assert.equal(none.headers.get('cache-control'), 'no-store', path);
      // Mutating and reading routes alike refuse another site's Origin.
      const origin = { origin: 'https://attacker.example' };
      const foreign =
        method === 'get'
          ? await browser.get(path, origin)
          : await browser[method](path, {}, origin);
      assert.deepEqual([foreign.status, foreign.body.code], [403, 'CROSS_ORIGIN_REJECTED'], path);
    }
    for (const [method, path] of employeeRoutes) {
      const asHr = await hr[method](path, method === 'get' ? undefined : {});
      assert.deepEqual([asHr.status, asHr.body.code], [403, 'EMPLOYEE_ROLE_REQUIRED'], path);
    }
    for (const [method, path] of hrRoutes) {
      const asEmployee = await browser[method](path, method === 'get' ? undefined : {});
      assert.deepEqual([asEmployee.status, asEmployee.body.code], [403, 'HR_ROLE_REQUIRED'], path);
    }
    // An employee who still has to change the temporary password is stopped too.
    const fresh = await app.createEmployee(hr, syntheticProfile('Blake Sample'));
    const pending = app.browser();
    await pending.signIn(fresh.employee.account.username, fresh.temporaryPassword);
    const blocked = await pending.get('/api/me/onboarding');
    assert.deepEqual([blocked.status, blocked.body.code], [403, 'PASSWORD_CHANGE_REQUIRED']);
  });
});

test('a new employee sees 0% with the first Documentation step next; self steps persist across browsers', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr);
    const first = await browser.get('/api/me/onboarding');
    assert.equal(first.status, 200);
    assert.equal(first.body.percent, 0);
    assert.equal(first.body.track, 'employee');
    assert.equal(first.body.nextStep.id, 'documentation.contract');
    assert.equal(first.body.nextStep.areaTitle, 'Documentation');
    assert.deepEqual(
      first.body.areas.map((a) => a.id),
      ['documentation', 'policies', 'alignment', 'role-tools', 'team-support'],
    );
    // Served without the stored template too (built-in fallback), and nothing written.
    assert.deepEqual(app.firestore.paths('onboardingProgress/'), []);

    // Alya's briefing comes first (contract v1.5).
    const gated = await browser.post('/api/me/onboarding/steps/alignment.mission-values/complete');
    assert.deepEqual([gated.status, gated.body.code], [409, 'BRIEFING_REQUIRED']);
    const briefed = await browser.post(
      '/api/me/onboarding/steps/alignment.mission-values/briefing',
      { completion: 'listened' },
    );
    assert.equal(briefed.status, 200);
    assert.deepEqual(
      [
        step(briefed.body, 'alignment.mission-values').briefed,
        step(briefed.body, 'alignment.mission-values').status,
      ],
      [true, 'todo'],
    );
    const done = await browser.post('/api/me/onboarding/steps/alignment.mission-values/complete');
    assert.equal(done.status, 200);
    assert.equal(step(done.body, 'alignment.mission-values').status, 'done');
    assert.equal(step(done.body, 'alignment.mission-values').source, 'employee');
    assert.equal(step(done.body, 'alignment.mission-values').updatedAt, '2026-10-15T01:00:00.000Z');
    assert.equal(area(done.body, 'alignment').percent, 25);
    assert.equal(done.body.percent, 5);
    // Completing it again changes nothing.
    const again = await browser.post('/api/me/onboarding/steps/alignment.mission-values/complete');
    assert.deepEqual(again.body, done.body);
    const stored = app.firestore.read(`onboardingProgress/${employee.account.id}`);
    assert.deepEqual(stored, {
      accountId: employee.account.id,
      updatedAt: '2026-10-15T01:00:00.000Z',
      steps: {
        'alignment.mission-values': {
          status: 'done',
          updatedAt: '2026-10-15T01:00:00.000Z',
          source: 'employee',
          actorId: employee.account.id,
          briefedAt: '2026-10-15T01:00:00.000Z',
          briefedBy: 'listened',
        },
      },
    });

    // Another browser, signed in fresh, sees the same footprint.
    const phone = app.browser();
    await browser.post('/api/auth/sign-out');
    assert.equal((await phone.signIn('PC-0001', 'employee-own-pass-1')).status, 200);
    assert.equal((await phone.get('/api/me/onboarding')).body.percent, 5);

    // Undo a self step.
    const undone = await phone.post('/api/me/onboarding/steps/alignment.mission-values/reopen');
    assert.equal(step(undone.body, 'alignment.mission-values').status, 'todo');
    assert.equal(undone.body.percent, 0);
    // Reopening keeps the briefing.
    assert.equal(step(undone.body, 'alignment.mission-values').briefed, true);
    assert.deepEqual(app.firestore.read(`onboardingProgress/${employee.account.id}`).steps, {
      'alignment.mission-values': {
        briefedAt: '2026-10-15T01:00:00.000Z',
        briefedBy: 'listened',
      },
    });

    // Unknown steps.
    for (const path of [
      '/api/me/onboarding/steps/documentation.nope/complete',
      '/api/me/onboarding/steps/nope/reopen',
      '/api/me/onboarding/steps/documentation.nope/check',
    ]) {
      const missing = path.endsWith('check') ? await phone.get(path) : await phone.post(path);
      assert.deepEqual([missing.status, missing.body.code], [404, 'STEP_NOT_FOUND'], path);
    }
  });
});

test('hr_verify steps wait for HR; only HR verifies them and the employee cannot undo a verification', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const { employee, browser } = await app.readyEmployee(hr);
    const id = employee.account.id;
    // The employee gets Alya's briefing before submitting (v1.5); HR's
    // verification below is never gated (role-responsibilities is unbriefed).
    const gated = await browser.post('/api/me/onboarding/steps/documentation.contract/complete');
    assert.deepEqual([gated.status, gated.body.code], [409, 'BRIEFING_REQUIRED']);
    await browser.post('/api/me/onboarding/steps/documentation.contract/briefing', {
      completion: 'read',
    });
    const submitted = await browser.post(
      '/api/me/onboarding/steps/documentation.contract/complete',
    );
    assert.equal(step(submitted.body, 'documentation.contract').status, 'submitted');
    assert.equal(submitted.body.waitingOnHr, 1);
    assert.equal(submitted.body.percent, 0); // waiting on HR is not done
    assert.equal(submitted.body.nextStep.id, 'documentation.personal-bank-details');

    // HR sees the same picture, and the employee list shows it.
    const seen = await hr.get(`/api/hr/employees/${id}/onboarding`);
    assert.deepEqual(seen.body, submitted.body);
    const listed = (await hr.get('/api/hr/employees')).body.employees[0];
    assert.deepEqual(
      [listed.track, listed.onboarding],
      ['employee', { percent: 0, waitingOnHr: 1, complete: false }],
    );

    // The employee may withdraw their own submission, then submit again.
    const withdrawn = await browser.post('/api/me/onboarding/steps/documentation.contract/reopen');
    assert.equal(step(withdrawn.body, 'documentation.contract').status, 'todo');
    await browser.post('/api/me/onboarding/steps/documentation.contract/complete');

    // HR verifies.
    const verified = await hr.patch(
      `/api/hr/employees/${id}/onboarding/steps/documentation.contract`,
      {
        status: 'done',
      },
    );
    assert.equal(verified.status, 200);
    assert.equal(step(verified.body, 'documentation.contract').status, 'done');
    assert.equal(step(verified.body, 'documentation.contract').source, 'hr');
    assert.equal(verified.body.waitingOnHr, 0);
    assert.equal(verified.body.percent, 5);
    assert.equal(
      app.firestore.read(`onboardingProgress/${id}`).steps['documentation.contract'].actorId,
      hrId,
    );
    // Locked for the employee.
    const locked = await browser.post('/api/me/onboarding/steps/documentation.contract/reopen');
    assert.deepEqual([locked.status, locked.body.code], [409, 'STEP_LOCKED']);
    // Completing an already-verified step leaves it done.
    const repeat = await browser.post('/api/me/onboarding/steps/documentation.contract/complete');
    assert.equal(step(repeat.body, 'documentation.contract').source, 'hr');

    // HR can verify a step that was never submitted, and unverify one.
    await hr.patch(`/api/hr/employees/${id}/onboarding/steps/documentation.emergency-contact`, {
      status: 'done',
    });
    const unverified = await hr.patch(
      `/api/hr/employees/${id}/onboarding/steps/documentation.contract`,
      { status: 'todo' },
    );
    assert.equal(step(unverified.body, 'documentation.contract').status, 'todo');
    assert.equal(step(unverified.body, 'documentation.emergency-contact').status, 'done');

    // HR changes hr_verify steps only, with a valid status, for an existing employee.
    for (const [path, body, status, code] of [
      ['alignment.mission-values', { status: 'done' }, 409, 'STEP_NOT_HR_VERIFIED'],
      ['policies.workplace-conduct', { status: 'done' }, 409, 'STEP_NOT_HR_VERIFIED'],
      ['documentation.nope', { status: 'done' }, 404, 'STEP_NOT_FOUND'],
      ['documentation.contract', { status: 'submitted' }, 400, 'STEP_STATUS_INVALID'],
      ['documentation.contract', { status: 'done', note: 'x' }, 400, 'STEP_STATUS_INVALID'],
      ['documentation.contract', [], 400, 'STEP_STATUS_INVALID'],
    ]) {
      const refused = await hr.patch(`/api/hr/employees/${id}/onboarding/steps/${path}`, body);
      assert.deepEqual([refused.status, refused.body.code], [status, code], path);
    }
    const hrId404 = await hr.get(`/api/hr/employees/${hrId}/onboarding`);
    assert.deepEqual([hrId404.status, hrId404.body.code], [404, 'EMPLOYEE_NOT_FOUND']);
    const nobody = await hr.patch(
      '/api/hr/employees/00000000-0000-4000-8000-000000000000/onboarding/steps/documentation.contract',
      { status: 'done' },
    );
    assert.deepEqual([nobody.status, nobody.body.code], [404, 'EMPLOYEE_NOT_FOUND']);

    // Each HR change wrote an onboarding_step_verified audit row with IDs only.
    const events = await app.rows(
      "SELECT actor_id, target_id, detail FROM account_events WHERE action = 'onboarding_step_verified'",
    );
    assert.equal(events.length, 3);
    assert.ok(events.every((e) => e.actor_id === hrId && e.target_id === id));
    const details = events
      .map((e) => (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail))
      .map((d) => `${d.stepId} ${d.status}`)
      .sort();
    assert.deepEqual(details, [
      'documentation.contract done',
      'documentation.contract todo',
      'documentation.emergency-contact done',
    ]);
  });
});

test('policy checks: no answer in the question, a wrong answer stores nothing, a correct one completes the step', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr);
    const path = '/api/me/onboarding/steps/policies.workplace-conduct';
    const required = await browser.post(`${path}/complete`);
    assert.deepEqual([required.status, required.body.code], [409, 'CHECK_REQUIRED']);
    // The check needs Alya's briefing first (v1.5).
    for (const blocked of [
      await browser.get(`${path}/check`),
      await browser.post(`${path}/check`, { optionId: 'w5n1' }),
    ])
      assert.deepEqual([blocked.status, blocked.body.code], [409, 'BRIEFING_REQUIRED']);
    await browser.post(`${path}/briefing`, { completion: 'listened' });

    const question = await browser.get(`${path}/check`);
    assert.equal(question.status, 200);
    assert.deepEqual(Object.keys(question.body), [
      'stepId',
      'type',
      'scenario',
      'options',
      'sourceTitle',
    ]);
    assert.equal(question.body.type, 'choice');
    assert.equal(question.body.stepId, 'policies.workplace-conduct');
    assert.equal(question.body.sourceTitle, 'UniVRse - Employee Handbook');
    assert.ok(question.body.options.every((o) => Object.keys(o).join() === 'id,text'));
    assert.ok(!question.text.includes('correctOptionId') && !question.text.includes('explanation'));

    const expected = builtInTemplate('employee').areas[1].steps[1].check;
    const wrong = expected.options.find((o) => o.id !== expected.correctOptionId).id;
    const missed = await browser.post(`${path}/check`, { optionId: wrong });
    assert.equal(missed.status, 200);
    assert.equal(missed.body.correct, false);
    assert.equal(missed.body.explanation, expected.explanation);
    assert.equal(step(missed.body.onboarding, 'policies.workplace-conduct').status, 'todo');
    // Wrong answers are not stored anywhere: the step holds its briefing only.
    assert.deepEqual(app.firestore.read(`onboardingProgress/${employee.account.id}`).steps, {
      'policies.workplace-conduct': {
        briefedAt: '2026-10-15T01:00:00.000Z',
        briefedBy: 'listened',
      },
    });
    const everything = JSON.stringify([...app.firestore.store.documents.values()]);
    assert.ok(!everything.includes('optionId') && !everything.includes(wrong));

    for (const body of [
      {},
      { optionId: 'z' },
      { optionId: 1 },
      [],
      { answer: 'I would forward it to IT.' },
      { optionId: expected.correctOptionId, answer: 'x' },
    ]) {
      const invalid = await browser.post(`${path}/check`, body);
      assert.deepEqual([invalid.status, invalid.body.code], [400, 'CHECK_ANSWER_INVALID']);
    }
    const passed = await browser.post(`${path}/check`, { optionId: expected.correctOptionId });
    assert.equal(passed.body.correct, true);
    assert.equal(step(passed.body.onboarding, 'policies.workplace-conduct').status, 'done');
    assert.equal(area(passed.body.onboarding, 'policies').percent, 25);
    assert.deepEqual(
      Object.keys(app.firestore.read(`onboardingProgress/${employee.account.id}`).steps),
      ['policies.workplace-conduct'],
    );
    // A passed check is locked; a later wrong answer does not undo it.
    const locked = await browser.post(`${path}/reopen`);
    assert.deepEqual([locked.status, locked.body.code], [409, 'STEP_LOCKED']);
    const late = await browser.post(`${path}/check`, { optionId: wrong });
    assert.equal(late.body.correct, false);
    assert.equal(step(late.body.onboarding, 'policies.workplace-conduct').status, 'done');
    // Completing a passed check is fine.
    assert.equal((await browser.post(`${path}/complete`)).status, 200);
    // Steps without a check.
    const none = await browser.get('/api/me/onboarding/steps/alignment.mission-values/check');
    assert.deepEqual([none.status, none.body.code], [404, 'CHECK_NOT_FOUND']);
  });
});

test('the track picks the template; 3 of 4 required steps in every area completes a contractor', async () => {
  // A grader that passes every written answer: grading has its own tests.
  const checkGrader = { grade: async () => ({ correct: true, feedback: 'Well done.' }) };
  await withApp({ checkGrader }, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr, {
      profile: withTrack('contractor'),
    });
    const id = employee.account.id;
    app.briefAll(id, { track: 'contractor' });
    assert.equal(employee.profile.job.track, 'contractor');
    const start = (await browser.get('/api/me/onboarding')).body;
    assert.deepEqual([start.track, start.threshold, start.complete], ['contractor', 70, false]);
    assert.deepEqual(
      start.areas.map((a) => [a.id, a.total]),
      [
        ['documentation', 4],
        ['policies', 4],
        ['alignment', 4],
        ['role-tools', 11],
        ['team-support', 4],
      ],
    );
    assert.equal(step(start, 'documentation.confidentiality-agreement').completion, 'hr_verify');
    const template = builtInTemplate('contractor');
    // Complete enough required steps in every area to meet the 70% threshold.
    for (const a of template.areas) {
      const requiredSteps = a.steps.filter((t) => t.required);
      const needed = Math.ceil(requiredSteps.length * 0.7);
      for (const s of requiredSteps.slice(0, needed)) {
        if (s.completion === 'self')
          await browser.post(`/api/me/onboarding/steps/${s.id}/complete`);
        if (s.completion === 'hr_verify') {
          await browser.post(`/api/me/onboarding/steps/${s.id}/complete`);
          await hr.patch(`/api/hr/employees/${id}/onboarding/steps/${s.id}`, { status: 'done' });
        }
        if (s.completion === 'check')
          await browser.post(
            `/api/me/onboarding/steps/${s.id}/check`,
            s.check.type === 'written'
              ? { answer: 'I would keep it in company systems, because it is confidential.' }
              : { optionId: s.check.correctOptionId },
          );
      }
    }
    const end = (await browser.get('/api/me/onboarding')).body;
    assert.deepEqual(
      [end.percent, end.complete, end.waitingOnHr, end.nextStep.id],
      [75, true, 0, 'documentation.confidentiality-agreement'],
    );
    assert.ok(end.areas.every((a) => a.meetsThreshold && a.percent >= 70));
    const listed = (await hr.get('/api/hr/employees')).body.employees[0];
    assert.deepEqual(
      [listed.track, listed.onboarding],
      ['contractor', { percent: 75, waitingOnHr: 0, complete: true }],
    );
    // Undoing one self step drops that area to 2 of 4: no longer complete.
    const undone = await browser.post(
      '/api/me/onboarding/steps/alignment.products-customers/reopen',
    );
    assert.deepEqual(
      [
        area(undone.body, 'alignment').meetsThreshold,
        undone.body.complete,
        undone.body.nextStep.id,
      ],
      [false, false, 'alignment.products-customers'],
    );
    // The optional step completes and reopens like a self step and changes no progress.
    const optional = await browser.post(
      '/api/me/onboarding/steps/team-support.working-preferences/complete',
    );
    assert.equal(step(optional.body, 'team-support.working-preferences').status, 'done');
    assert.equal(step(optional.body, 'team-support.working-preferences').required, false);
    assert.deepEqual(
      [optional.body.percent, area(optional.body, 'team-support').done],
      [undone.body.percent, 3],
    );
    const reopened = await browser.post(
      '/api/me/onboarding/steps/team-support.working-preferences/reopen',
    );
    assert.equal(step(reopened.body, 'team-support.working-preferences').status, 'todo');
    const hrOptional = await hr.patch(
      `/api/hr/employees/${id}/onboarding/steps/team-support.working-preferences`,
      { status: 'done' },
    );
    assert.deepEqual([hrOptional.status, hrOptional.body.code], [409, 'STEP_NOT_HR_VERIFIED']);

    // HR can change the track; an invalid one is a profile problem.
    const changed = await hr.put(`/api/hr/employees/${id}/profile`, {
      profile: withTrack('intern'),
    });
    assert.equal(changed.status, 200);
    assert.equal((await browser.get('/api/me/onboarding')).body.track, 'intern');
    const bad = await hr.put(`/api/hr/employees/${id}/profile`, { profile: withTrack('manager') });
    assert.deepEqual(bad.body.fields, [{ field: 'job.track', problem: 'invalid_track' }]);
    // Upper case is accepted and stored in lower case.
    const upper = await hr.put(`/api/hr/employees/${id}/profile`, { profile: withTrack('Intern') });
    assert.equal(upper.body.employee.profile.job.track, 'intern');
  });
});

test('a stored template replaces the built-in one; a malformed one falls back to it', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const custom = builtInTemplate('employee');
    custom.areas[0].steps[0].title = 'Synthetic custom contract step';
    app.firestore.write('onboardingTemplates/employee', custom);
    let view = (await browser.get('/api/me/onboarding')).body;
    assert.equal(view.nextStep.title, 'Synthetic custom contract step');
    app.firestore.write('onboardingTemplates/employee', {
      ...custom,
      areas: custom.areas.slice(1),
    });
    view = (await browser.get('/api/me/onboarding')).body;
    assert.equal(view.nextStep.title, 'Sign your employment contract');
    assert.ok(app.logs.some((line) => /template is malformed/.test(line)));
  });
});

test('answer style, feedback and help requests never change onboarding completion', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const before = (await browser.get('/api/me/onboarding')).body;
    const chat = (await browser.post('/api/conversations')).body;
    const requestId = crypto.randomUUID();
    await browser.post('/api/chat', {
      question: 'What should I wear?',
      taskId: 'quiz-part-1',
      conversationId: chat.id,
      requestId,
    });
    await browser.post(`/api/conversations/${chat.id}/learning`, { preference: 'steps' });
    await browser.post(`/api/conversations/${chat.id}/feedback`, {
      messageId: requestId + '-a',
      rating: 'unclear',
    });
    await browser.post('/api/me/support-requests', {
      conversationId: chat.id,
      messageId: requestId + '-a',
    });
    const after = (await browser.get('/api/me/onboarding')).body;
    assert.deepEqual(after, before);
  });
});

test('AI proficiency self-assessment: deterministic path mapping, step sync, non-destructive editing and 403 access control', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser } = await app.readyEmployee(hr);
    const other = await app.readyEmployee(hr, { profile: syntheticProfile('Blake Sample') });
    const id = employee.account.id;
    app.briefAll(id);

    // 1. Default unanswered state.
    const initial = await browser.get('/api/me/ai-proficiency');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.aiProficiency.status, 'unanswered');
    assert.equal(initial.body.aiProficiency.level, null);
    assert.equal(initial.body.aiProficiency.learningPathId, 'beginner');
    assert.equal(initial.body.aiProficiency.trainingCompleted, false);
    assert.equal(Object.keys(initial.body.levels).length, 10);

    // 2. Validation errors.
    for (const badBody of [
      {},
      { status: 'unanswered' },
      { status: 'assessed', level: 0 },
      { status: 'assessed', level: 11 },
      { status: 'assessed', level: 4.5 },
      { status: 'not_sure', level: 3 },
      { status: 'skipped', level: 1 },
      { status: 'assessed', level: 5, extra: true },
    ]) {
      const bad = await browser.put('/api/me/ai-proficiency', badBody);
      assert.deepEqual([bad.status, bad.body.code], [400, 'AI_PROFICIENCY_INVALID']);
    }

    // 3. Submit rating 5 -> intermediate, step remains todo.
    const assessed = await browser.put('/api/me/ai-proficiency', {
      status: 'assessed',
      level: 5,
    });
    assert.equal(assessed.status, 200);
    assert.equal(assessed.body.aiProficiency.status, 'assessed');
    assert.equal(assessed.body.aiProficiency.level, 5);
    assert.equal(assessed.body.aiProficiency.learningPathId, 'intermediate');
    assert.equal(assessed.body.aiProficiency.trainingCompleted, false);
    assert.equal(step(assessed.body.onboarding, 'role-tools.ai-readiness-training').status, 'todo');

    // 4. Complete training -> step becomes done.
    const completed = await browser.post('/api/me/ai-proficiency/complete-training', {
      practiceNote: 'Refined prompt with constraints and verification checklist.',
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.aiProficiency.trainingCompleted, true);
    assert.equal(
      step(completed.body.onboarding, 'role-tools.ai-readiness-training').status,
      'done',
    );

    // 5. Non-destructive editing: changing rating to 8 -> advanced preserves trainingCompleted and step done.
    const edited = await browser.put('/api/me/ai-proficiency', {
      status: 'assessed',
      level: 8,
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.aiProficiency.learningPathId, 'advanced');
    assert.equal(edited.body.aiProficiency.trainingCompleted, true);
    assert.equal(step(edited.body.onboarding, 'role-tools.ai-readiness-training').status, 'done');

    // 6. Access control: HR can read an employee's AI proficiency, another employee gets 403 FORBIDDEN.
    const hrView = await hr.get(`/api/hr/employees/${id}/ai-proficiency`);
    assert.equal(hrView.status, 200);
    assert.equal(hrView.body.aiProficiency.level, 8);

    const crossEmployeeRead = await other.browser.get(`/api/hr/employees/${id}/ai-proficiency`);
    assert.equal(crossEmployeeRead.status, 403);

    const crossUserQuery = await other.browser.get(`/api/me/ai-proficiency?userId=${id}`);
    assert.deepEqual([crossUserQuery.status, crossUserQuery.body.code], [403, 'FORBIDDEN']);

    const crossCompanyWrite = await browser.put('/api/me/ai-proficiency?companyId=other-co', {
      status: 'skipped',
    });
    assert.deepEqual([crossCompanyWrite.status, crossCompanyWrite.body.code], [403, 'FORBIDDEN']);
  });
});

test('a Firestore failure on the footprint is the profile storage error, with no data in the log', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    app.firestore.fail(14, { only: ['get'], times: 5 });
    const failed = await browser.get('/api/me/onboarding');
    assert.deepEqual([failed.status, failed.body.code], [503, 'PROFILE_STORAGE_UNAVAILABLE']);
    assert.ok(app.logs.every((line) => !line.includes('Injected failure')));
  });
});
