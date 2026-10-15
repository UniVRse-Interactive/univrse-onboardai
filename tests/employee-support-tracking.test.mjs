import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chatStores } from './server/chat-stores.mjs';
import { createConversationService } from '../server/gemini-chat-workflow.mjs';
import { createAnswerGuide } from '../server/answer-guide-metadata.mjs';
import { createApp } from '../server/api-routes.mjs';
import { summariseSupport, employeeOverview } from '../server/employee-support-tracking.mjs';
import { reportText } from '../src/avatar/hr-support-report.mjs';

function service(store) {
  return createConversationService({
    env: {},
    memory: store.create(),
    retrieve: async () => [
      {
        title: 'Test guide',
        heading: 'Work routine',
        text: 'Synthetic company guidance: submit a morning update. Include completed tasks in your work report.',
      },
    ],
    models: {
      plan: {
        invoke: async () => ({
          kind: 'company',
          query: 'morning update work report',
          clarification: '',
        }),
      },
      answer: {
        invoke: async () => ({
          answer: '1. Submit your morning update.\n2. Include completed tasks in your work report.',
          citations: [1],
        }),
      },
    },
  });
}

test('cards reuse delivered instructions, preserve conditions and require confirmed company sources', () => {
  const text = '1. Submit receipts only after approval.\n2. Claim mileage at 0.50 per kilometre.';
  assert.deepEqual(createAnswerGuide(text, { format: 'steps', hasSources: true }).items, [
    'Submit receipts only after approval.',
    'Claim mileage at 0.50 per kilometre.',
  ]);
  assert.deepEqual(
    createAnswerGuide('1. Open the tool. 2. Send the update.', {
      format: 'steps',
      hasSources: true,
    }).items,
    ['Open the tool.', 'Send the update.'],
  );
  const answer = 'Office hours start at 10.30 AM. Confirm exceptions with your manager.';
  const card = createAnswerGuide(answer, { hasSources: true });
  assert.equal(card.items.join(' '), answer);
  assert.equal(createAnswerGuide(answer, { hasSources: false }), null);
  assert.equal(createAnswerGuide(answer, { hasSources: true, kind: 'conversation' }), null);
});

for (const store of chatStores)
  test(`${store.name}: support summaries aggregate saved chats, count retries once, and never store raw requests or health labels`, async () => {
    const engine = service(store),
      memory = engine.memory;
    try {
      const a = await memory.create('employee'),
        b = await memory.create('employee'),
        id = randomUUID();
      await engine.ask(
        'employee',
        a.id,
        'I am autistic. Please explain the work report in smaller steps. My private name is SECRET.',
        id,
      );
      await engine.ask(
        'employee',
        a.id,
        'I am autistic. Please explain the work report in smaller steps. My private name is SECRET.',
        id,
      );
      await engine.ask('employee', b.id, 'Give me an example.', randomUUID());
      await engine.ask('employee', b.id, 'Keep it short.', randomUUID());
      const summary = await memory.supportSummary('employee');
      assert.equal(summary.turns, 3);
      assert.equal(summary.conversations, 2);
      assert.equal(summary.requests.example, 1);
      assert.equal(summary.requests.brief, 1);
      assert.equal(summary.cards, 3);
      assert.ok(summary.overview.basis.includes('3 recorded answers'));
      const rows = store.supportEventData(memory);
      assert.equal(rows.length, 3);
      assert.ok(!JSON.stringify(rows).includes('SECRET'));
      assert.ok(!JSON.stringify(rows).includes('autistic'));
      assert.equal((await memory.supportSummary('someone-else')).turns, 0);
    } finally {
      await engine.close();
    }
  });

test('employee overview uses explicit requests and feedback rather than assuming a preferred style or ability', () => {
  const events = Array.from({ length: 4 }, (_, i) => ({
    kind: 'turn',
    conversationId: 'one',
    updated: i + 1,
    data: { format: 'steps', request: null, card: true },
  }));
  const automatic = summariseSupport(events);
  assert.equal(automatic.mostUsed, 'steps');
  assert.match(automatic.overview.interaction, /without requesting a different explanation/);
  assert.ok(!automatic.overview.recommendations.some((s) => s.includes('one manageable action')));
  const supported = employeeOverview({
    turns: 4,
    requests: { steps: 2, example: 1, brief: 0 },
    feedback: { helpful: 1, unclear: 1 },
    humanHelpRequests: 1,
  });
  assert.match(supported.interaction, /smaller steps \(2 requests\)/);
  assert.match(supported.interaction, /1 answer helpful/);
  assert.match(supported.followUp, /requested human support/);
  assert.ok(supported.recommendations.some((s) => s.includes('one manageable action')));
  assert.ok(supported.recommendations.some((s) => s.includes('practical example')));
  assert.ok(
    !JSON.stringify(supported).match(/autism|intelligence|unable to|slow learner|mastered/i),
  );
});

test('HR export is a concise employee summary with practical support, without voice statistics or repeated notices', () => {
  const summary = summariseSupport([
    {
      kind: 'turn',
      conversationId: 'one',
      updated: 1,
      data: { format: 'example', request: 'example', card: true },
    },
  ]);
  summary.messages = [{ text: 'PRIVATE CHAT' }];
  summary.voiceStarts = 8;
  const text = reportText({ summary, createdAt: 1000 }, 'Sam');
  assert.match(text, /Employee: Sam/);
  assert.match(text, /HOW THE EMPLOYEE USES SUPPORT/);
  assert.match(text, /SUGGESTED SUPPORT FOR HR/);
  assert.match(text, /practical example/);
  assert.match(text, /early summary/);
  assert.ok(!text.includes('PRIVATE CHAT'));
  assert.ok(!text.includes('voice started'));
  assert.ok(!text.includes('performance score'));
  assert.ok(!text.includes('No raw questions'));
});

for (const store of chatStores)
  test(`${store.name}: feedback corrections and voice starts are idempotent, recording can pause, and deletion removes support observations`, async () => {
    const engine = service(store),
      memory = engine.memory;
    const summary = () => memory.supportSummary('employee');
    try {
      const chat = await memory.create('employee'),
        id = randomUUID();
      await engine.ask('employee', chat.id, 'Explain again.', id);
      const messageId = id + '-a';
      const start = (await summary()).version;
      await memory.feedback('employee', chat.id, messageId, 'unclear');
      await memory.feedback('employee', chat.id, messageId, 'unclear');
      assert.equal((await summary()).feedback.unclear, 1);
      assert.equal((await summary()).version, start + 1);
      await memory.feedback('employee', chat.id, messageId, 'helpful');
      assert.deepEqual((await summary()).feedback, { helpful: 1, unclear: 0 });
      assert.equal((await memory.read('employee', chat.id)).messages.at(-1).feedback, 'helpful');
      await memory.feedback('employee', chat.id, messageId, null);
      assert.deepEqual((await summary()).feedback, { helpful: 0, unclear: 0 });
      assert.equal((await memory.read('employee', chat.id)).messages.at(-1).feedback, null);
      await memory.feedback('employee', chat.id, messageId, 'helpful');
      await memory.voiceEvent('employee', chat.id, messageId);
      await memory.voiceEvent('employee', chat.id, messageId);
      assert.equal((await summary()).voiceStarts, 1);
      await memory.humanHelp('employee', chat.id, messageId);
      await memory.humanHelp('employee', chat.id, messageId);
      assert.equal((await summary()).humanHelpRequests, 1);
      assert.equal(
        (await memory.read('employee', chat.id)).messages.at(-1).humanHelpRequested,
        true,
      );
      await memory.supportSettings('employee', { recording: false });
      assert.equal((await summary()).recording, false);
      await engine.ask('employee', chat.id, 'Give me another example.', randomUUID());
      assert.equal((await summary()).turns, 1);
      await memory.supportSettings('employee', { recording: true });
      await engine.ask('employee', chat.id, 'Keep it short.', randomUUID());
      assert.equal((await summary()).turns, 2);
      const before = (await summary()).version;
      await memory.erase('employee', chat.id);
      assert.equal((await summary()).turns, 0);
      assert.equal((await summary()).feedback.helpful, 0);
      assert.equal((await summary()).version, before + 1);
      assert.equal(store.storedRows(memory, chat.id), 0);
    } finally {
      await engine.close();
    }
  });

for (const store of chatStores)
  test(`${store.name}: summary and feedback endpoints enforce session ownership, same-origin mutations and bounded settings`, async () => {
    const engine = service(store),
      app = createApp({ env: { AI_MODE: 'gemini-chat' }, conversationService: engine });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const identity = async () => {
        const response = await fetch(base + '/api/conversations');
        return response.headers.get('set-cookie').split(';')[0];
      };
      const cookie = await identity(),
        other = await identity();
      const created = await fetch(base + '/api/conversations', {
          method: 'POST',
          headers: { cookie },
        }),
        chat = await created.json();
      const id = randomUUID();
      await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Explain again.',
          taskId: 'quiz-part-1',
          conversationId: chat.id,
          requestId: id,
          speechEnabled: false,
        }),
      });
      const post = (path, body, identity = cookie, origin) =>
        fetch(base + path, {
          method: 'POST',
          headers: {
            cookie: identity,
            'Content-Type': 'application/json',
            ...(origin ? { origin } : {}),
          },
          body: JSON.stringify(body),
        });
      const feedbackPath = '/api/conversations/' + chat.id + '/feedback',
        voicePath = '/api/conversations/' + chat.id + '/voice-event';
      assert.equal(
        (await post(feedbackPath, { messageId: id + '-a', rating: 'helpful' }, other)).status,
        404,
      );
      assert.equal((await post(voicePath, { messageId: id + '-a' }, other)).status, 404);
      assert.equal(
        (
          await post(
            feedbackPath,
            { messageId: id + '-a', rating: 'helpful' },
            cookie,
            'https://untrusted.invalid',
          )
        ).status,
        403,
      );
      assert.equal(
        (await post(feedbackPath, { messageId: id + '-a', rating: 'ability-score' })).status,
        400,
      );
      assert.equal(
        (await post(feedbackPath, { messageId: id + '-u', rating: 'helpful' })).status,
        404,
      );
      assert.equal(
        (await post('/api/support-summary/settings', { recording: true, diagnosis: 'autism' }))
          .status,
        400,
      );
      const summaryResponse = await fetch(base + '/api/employee-support-summary', {
        headers: { cookie },
      });
      assert.equal(summaryResponse.headers.get('cache-control'), 'no-store');
      assert.equal((await summaryResponse.json()).turns, 1);
      assert.equal(
        (
          await (
            await fetch(base + '/api/employee-support-summary', { headers: { cookie: other } })
          ).json()
        ).turns,
        0,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await engine.close();
    }
  });
