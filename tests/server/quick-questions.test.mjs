// Quick-question chips, first-day details and personal chip answers (issue
// #50): pg-mem, the in-memory Firestore fake and synthetic people only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp, syntheticProfile } from './account-harness.mjs';
import { builtInQuickQuestions } from '../../server/onboarding-content.mjs';

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
const DAY = 24 * 60 * 60 * 1000;
const ask = (browser, conversationId, question, extra = {}, requestId = randomUUID()) =>
  browser.post('/api/chat', {
    question,
    taskId: 'quiz-part-1',
    conversationId,
    requestId,
    ...extra,
  });
const chipIds = async (browser) =>
  (await browser.get('/api/me/quick-questions')).body.chips.map((chip) => chip.id);
const details = {
  location: 'Reception, Level 12, Tower B',
  arrivalTime: '08:45',
  hostName: 'Riley Host',
  hostContact: 'riley.host@example.com',
  notes: 'Bring your IC.',
};

test('chips: the next-step chip and personal chips before the start date, knowledge chips after', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    // The harness clock is 2026-10-15; the synthetic start date is 2026-11-02.
    const { browser } = await app.readyEmployee(hr);
    const first = await browser.get('/api/me/quick-questions');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.chips, [
      {
        id: 'step:documentation.contract',
        label: 'How do I sign my employment contract?',
        question: 'How do I sign my employment contract?',
        kind: 'knowledge',
        stepId: 'documentation.contract',
      },
      {
        id: 'day-one-arrival',
        label: 'Where and what time do I report on day 1?',
        question: 'Where and what time do I report on day 1?',
        kind: 'personal',
        stepId: null,
      },
      {
        id: 'day-one-host',
        label: 'Who will meet me on my first day?',
        question: 'Who will meet me on my first day?',
        kind: 'personal',
        stepId: null,
      },
    ]);
    // Completing the next step (after its briefing, v1.5) changes the step chip.
    await browser.post('/api/me/onboarding/steps/documentation.contract/briefing', {
      completion: 'read',
    });
    assert.equal((await chipIds(browser))[0], 'step:documentation.contract');
    await browser.post('/api/me/onboarding/steps/documentation.contract/complete');
    assert.equal((await chipIds(browser))[0], 'step:documentation.personal-bank-details');
    // The day after the start date (company time): still personal; two days
    // after: knowledge. Sessions last 12 hours, so sign in again after each jump.
    const later = async (ms) => {
      app.clock.advance(ms);
      await browser.signIn('PC-0001', 'employee-own-pass-1');
      return (await chipIds(browser)).slice(1);
    };
    assert.deepEqual(await later(Date.parse('2026-11-03T15:00:00Z') - app.clock.now().getTime()), [
      'day-one-arrival',
      'day-one-host',
    ]);
    // 2026-11-03T16:00Z is already 2026-11-04 in Malaysia.
    assert.deepEqual(await later(60 * 60 * 1000), ['company-background', 'working-hours']);
    assert.deepEqual(await later(DAY), ['company-background', 'working-hours']);
  });
});

test('chips come from config/quickQuestions per track, with the built-in list as fallback', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const profile = syntheticProfile();
    profile.job.track = 'intern';
    profile.job.startDate = '';
    const { browser } = await app.readyEmployee(hr, { profile });
    const config = builtInQuickQuestions();
    config.intern = [
      { id: 'synthetic-knowledge', label: 'K?', question: 'K?', kind: 'knowledge' },
      { id: 'synthetic-host', label: 'H?', question: 'H?', kind: 'personal', personal: 'host' },
    ];
    app.firestore.write('config/quickQuestions', config);
    // No start date: personal first, filled with knowledge.
    assert.deepEqual(await chipIds(browser), [
      'step:documentation.contract',
      'synthetic-host',
      'synthetic-knowledge',
    ]);
    // A malformed list falls back to the built-in chips.
    app.firestore.write('config/quickQuestions', { ...config, intern: [{ id: 'x' }] });
    assert.deepEqual(await chipIds(browser), [
      'step:documentation.contract',
      'day-one-arrival',
      'day-one-host',
    ]);
  });
});

test('HR first-day details: a validated full replacement with an audit row; the employee reads their own', async () => {
  await withApp({}, async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const { employee, browser } = await app.readyEmployee(hr);
    const id = employee.account.id;
    assert.deepEqual((await browser.get('/api/me/first-day')).body, {
      firstDay: null,
      startDate: '2026-11-02',
    });
    assert.deepEqual((await hr.get(`/api/hr/employees/${id}/first-day`)).body, {
      firstDay: null,
      startDate: '2026-11-02',
    });

    const saved = await hr.put(`/api/hr/employees/${id}/first-day`, details);
    assert.equal(saved.status, 200);
    const firstDay = {
      ...details,
      updatedAt: '2026-10-15T01:00:00.000Z',
      updatedBy: hrId,
    };
    assert.deepEqual(saved.body, { firstDay });
    assert.deepEqual(app.firestore.read(`employeeFirstDay/${id}`), firstDay);
    assert.deepEqual((await browser.get('/api/me/first-day')).body, {
      firstDay,
      startDate: '2026-11-02',
    });
    // A full replacement: left-out optional fields become null.
    const replaced = await hr.put(`/api/hr/employees/${id}/first-day`, {
      location: ' Lobby ',
      arrivalTime: '09:00',
      hostName: 'Jordan Host',
    });
    assert.deepEqual(
      [
        replaced.body.firstDay.location,
        replaced.body.firstDay.hostContact,
        replaced.body.firstDay.notes,
      ],
      ['Lobby', null, null],
    );
    const events = await app.rows(
      "SELECT actor_id, target_id FROM account_events WHERE action = 'first_day_updated'",
    );
    assert.deepEqual(events, [
      { actor_id: hrId, target_id: id },
      { actor_id: hrId, target_id: id },
    ]);

    for (const [body, fields] of [
      [{}, ['location required', 'arrivalTime required', 'hostName required']],
      [{ ...details, arrivalTime: '8:45' }, ['arrivalTime invalid_time']],
      [{ ...details, arrivalTime: '24:00' }, ['arrivalTime invalid_time']],
      [{ ...details, location: 'x'.repeat(121) }, ['location too_long']],
      [{ ...details, hostName: 'x'.repeat(81) }, ['hostName too_long']],
      [{ ...details, hostContact: 'x'.repeat(121) }, ['hostContact too_long']],
      [{ ...details, notes: 'x'.repeat(301) }, ['notes too_long']],
      [{ ...details, hostName: 'Line\nbreak' }, ['hostName invalid_characters']],
      [{ ...details, location: 12 }, ['location not_text']],
      [{ ...details, extra: 'x' }, ['extra unknown']],
    ]) {
      const refused = await hr.put(`/api/hr/employees/${id}/first-day`, body);
      assert.equal(refused.status, 400, JSON.stringify(body));
      assert.equal(refused.body.code, 'FIRST_DAY_INVALID');
      assert.deepEqual(
        refused.body.fields.map((f) => `${f.field} ${f.problem}`),
        fields,
      );
    }
    // Notes may span lines.
    const multi = await hr.put(`/api/hr/employees/${id}/first-day`, {
      ...details,
      notes: 'Bring your IC.\r\nPark at B2.',
    });
    assert.equal(multi.body.firstDay.notes, 'Bring your IC.\nPark at B2.');
    const missing = await hr.put(
      '/api/hr/employees/00000000-0000-4000-8000-000000000000/first-day',
      details,
    );
    assert.deepEqual([missing.status, missing.body.code], [404, 'EMPLOYEE_NOT_FOUND']);
    // Failed requests wrote no audit row.
    assert.equal(
      (
        await app.rows(
          "SELECT count(*)::int AS n FROM account_events WHERE action = 'first_day_updated'",
        )
      )[0].n,
      3,
    );
  });
});

for (const mode of ['document-search', 'gemini-chat'])
  test(`${mode}: personal chips answer from the first-day details, never the documents`, async () => {
    let searches = 0;
    await withApp(
      {
        mode,
        companyRetrieve: async () => {
          searches++;
          return [{ title: 'Synthetic handbook', heading: 'Dress', text: 'Business casual.' }];
        },
      },
      async (app) => {
        const hr = await app.hrBrowser();
        const { employee, browser } = await app.readyEmployee(hr);
        const chat = (await browser.post('/api/conversations')).body;
        const question = 'Who will meet me on my first day?';

        // Before HR fills the details in: coverage none and a pointer to HR.
        const early = await ask(browser, chat.id, question, { quickQuestionId: 'day-one-host' });
        assert.equal(early.status, 200, early.text);
        assert.equal(early.body.coverage, 'none');
        assert.equal(early.body.category, 'onboarding');
        assert.equal(early.body.quickQuestionId, 'day-one-host');
        assert.equal(early.body.source, 'Your first-day details from HR');
        assert.deepEqual(early.body.passages, []);
        assert.equal(early.body.proposedAction, null);
        assert.equal(early.body.reexplainOf, null);
        assert.match(early.body.answer, /HR hasn’t added your first-day details yet/);
        assert.match(early.body.answer, /Monday,? 2 November 2026/);

        await hr.put(`/api/hr/employees/${employee.account.id}/first-day`, details);
        const host = await ask(browser, chat.id, question, { quickQuestionId: 'day-one-host' });
        assert.equal(host.body.coverage, 'full');
        assert.match(
          host.body.answer,
          /^Riley Host will meet you on your first day, Monday,? 2 November 2026\./,
        );
        assert.match(host.body.answer, /riley\.host@example\.com/);
        const arrival = await ask(browser, chat.id, 'Where and what time do I report on day 1?', {
          quickQuestionId: 'day-one-arrival',
        });
        assert.match(
          arrival.body.answer,
          /Please arrive at Reception, Level 12, Tower B by 08:45\./,
        );
        assert.match(arrival.body.answer, /A note from HR: Bring your IC\./);
        // The documents were never searched for personal chips.
        assert.equal(searches, 0);
        // Not knowledge gaps either.
        assert.deepEqual(app.firestore.paths('knowledgeGaps/'), []);

        // The saved messages carry the chip id at the top level.
        const opened = (await browser.get(`/api/conversations/${chat.id}`)).body;
        const answers = opened.messages.filter((m) => m.role === 'assistant');
        assert.deepEqual(
          answers.map((m) => [m.quickQuestionId, m.coverage, m.category]),
          [
            ['day-one-host', 'none', 'onboarding'],
            ['day-one-host', 'full', 'onboarding'],
            ['day-one-arrival', 'full', 'onboarding'],
          ],
        );

        // A knowledge chip takes the normal path and is searched.
        const knowledge = await ask(browser, chat.id, 'What’s the dress code?', {
          quickQuestionId: 'dress-code',
        });
        assert.equal(knowledge.body.quickQuestionId, 'dress-code');
        assert.equal(knowledge.body.source.includes('Synthetic handbook'), true);
        assert.equal(searches, 1);
        // A step chip too.
        const stepChip = await ask(browser, chat.id, 'How do I sign my employment contract?', {
          quickQuestionId: 'step:documentation.contract',
        });
        assert.equal(stepChip.body.quickQuestionId, 'step:documentation.contract');
        // An unknown chip id is an ordinary question.
        const unknown = await ask(browser, chat.id, 'Who will meet me?', {
          quickQuestionId: 'not-a-chip',
        });
        assert.equal(unknown.body.quickQuestionId, null);
        assert.equal(searches, 3);
      },
    );
  });

test('HR accounts have no chips: a personal chip id is an ordinary question for them', async () => {
  await withApp({ mode: 'document-search' }, async (app) => {
    const hr = await app.hrBrowser();
    const chat = (await hr.post('/api/conversations')).body;
    const answer = await ask(hr, chat.id, 'Who will meet me on my first day?', {
      quickQuestionId: 'day-one-host',
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.quickQuestionId, null);
    assert.equal(answer.body.coverage, 'full'); // the synthetic handbook matched
  });
});
