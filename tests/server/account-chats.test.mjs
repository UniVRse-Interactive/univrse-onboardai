import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp } from './account-harness.mjs';

const HOUR = 60 * 60 * 1000;
const ask = (browser, conversationId, question, requestId = randomUUID()) =>
  browser.post('/api/chat', { question, taskId: 'quiz-part-1', conversationId, requestId });

async function withApp(options, check) {
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

test('document-search: a signed-in employee’s chats are saved per turn and follow the account to a second browser', async () => {
  await withApp({ mode: 'document-search' }, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser: laptop } = await app.readyEmployee(hr);
    const owner = `account:${employee.account.id}`;
    const config = (await laptop.get('/api/config')).body;
    assert.equal(config.aiMode, 'document-search');
    assert.equal(config.accounts, true);
    assert.equal(config.conversationMemory, true);
    assert.equal(config.memoryRetentionDays, 30);

    const created = await laptop.post('/api/conversations');
    assert.equal(created.status, 201);
    assert.equal(laptop.cookies.has('alya_session'), false); // no anonymous cookie
    const chat = created.body;
    const requestId = randomUUID();
    const answered = await ask(laptop, chat.id, 'How do I finish the onboarding quiz?', requestId);
    assert.equal(answered.status, 200);
    assert.equal(answered.body.mode, 'document-search');
    assert.equal(answered.body.conversationId, chat.id);
    assert.equal(answered.body.matched, true);
    // Repeating the request ID returns the saved answer instead of a new turn.
    const repeated = await ask(laptop, chat.id, 'How do I finish the onboarding quiz?', requestId);
    assert.equal(repeated.body.answer, answered.body.answer);
    const conflict = await ask(laptop, chat.id, 'A different question', requestId);
    assert.deepEqual([conflict.status, conflict.body.code], [409, 'REQUEST_CONFLICT']);
    // A turn needs a saved conversation.
    const loose = await laptop.post('/api/chat', {
      question: 'Hello there',
      taskId: 'quiz-part-1',
    });
    assert.equal(loose.status, 400);

    // Stored in Firestore under the account, not a browser cookie.
    const stored = app.firestore.read(`conversations/${chat.id}`);
    assert.equal(stored.owner, owner);
    assert.equal(stored.messageCount, 2);
    assert.equal(stored.title, 'How do I finish the onboarding quiz?');
    assert.deepEqual(app.firestore.paths(`conversations/${chat.id}/`), [
      `conversations/${chat.id}/messages/0000`,
      `conversations/${chat.id}/messages/0001`,
    ]);

    // Another browser, same account: same chats and messages.
    const phone = app.browser();
    assert.equal((await phone.signIn('PC-0001', 'employee-own-pass-1')).status, 200);
    const listed = await phone.get('/api/conversations');
    assert.deepEqual(
      listed.body.conversations.map((c) => c.id),
      [chat.id],
    );
    const opened = await phone.get(`/api/conversations/${chat.id}`);
    assert.deepEqual(
      opened.body.messages.map((m) => [m.role, m.text]),
      [
        ['user', 'How do I finish the onboarding quiz?'],
        ['assistant', answered.body.answer],
      ],
    );
    // Feedback and deletion work for the account in this mode too.
    const rated = await phone.post(`/api/conversations/${chat.id}/feedback`, {
      messageId: requestId + '-a',
      rating: 'helpful',
    });
    assert.equal(rated.status, 200);

    // Another employee sees none of it.
    const other = await app.readyEmployee(hr, { password: 'second-own-pass-1' });
    assert.deepEqual((await other.browser.get('/api/conversations')).body.conversations, []);
    assert.equal((await other.browser.get(`/api/conversations/${chat.id}`)).status, 404);

    // Without an account nothing answers (issue #55): no saved chats and no
    // stateless answers.
    const signedOut = app.browser();
    assert.equal((await signedOut.get('/api/config')).body.conversationMemory, false);
    const listing = await signedOut.get('/api/conversations');
    assert.deepEqual([listing.status, listing.body.code], [401, 'AUTH_REQUIRED']);
    const stateless = await signedOut.post('/api/chat', {
      question: 'How do I finish the onboarding quiz?',
      taskId: 'quiz-part-1',
    });
    assert.deepEqual([stateless.status, stateless.body.code], [401, 'AUTH_REQUIRED']);
    assert.equal(stateless.body.answer, undefined);

    assert.equal((await phone.delete(`/api/conversations/${chat.id}`)).status, 204);
    assert.deepEqual((await laptop.get('/api/conversations')).body.conversations, []);
  });
});

test('demo and single-turn Gemini modes save a signed-in turn too, and a failed answer saves nothing', async () => {
  await withApp({ mode: '' }, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    assert.equal((await browser.get('/api/config')).body.aiMode, 'demo');
    const chat = (await browser.post('/api/conversations')).body;
    const answer = await ask(browser, chat.id, 'Can you approve this task?');
    assert.equal(answer.status, 200);
    assert.equal(answer.body.mode, 'demo');
    assert.equal((await browser.get(`/api/conversations/${chat.id}`)).body.messages.length, 2);
  });
  // GOOGLE_CLOUD_PROJECT turns on single-turn Gemini; the harness refuses any
  // Google request, so the answer fails with the usual 502.
  await withApp({ mode: '', env: { GOOGLE_CLOUD_PROJECT: 'synthetic-project' } }, async (app) => {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    assert.equal((await browser.get('/api/config')).body.aiMode, 'gemini');
    const chat = (await browser.post('/api/conversations')).body;
    const failed = await ask(browser, chat.id, 'What is next?');
    assert.equal(failed.status, 502);
    assert.match(failed.body.error, /Google AI could not answer/);
    const saved = await browser.get(`/api/conversations/${chat.id}`);
    assert.equal(saved.body.messages.length, 0);
    // The chat is not left locked by the failed answer.
    assert.equal(app.firestore.read(`conversations/${chat.id}`).turnToken, null);
  });
});

test('gemini-chat: the account owns its chats; a signed-out browser gets no anonymous chats', async () => {
  await withApp({ mode: 'gemini-chat' }, async (app) => {
    const hr = await app.hrBrowser();
    const { employee, browser: laptop } = await app.readyEmployee(hr);
    // Issue #55: a signed-out browser is refused and gets no session cookie.
    const signedOut = app.browser();
    const refused = await signedOut.post('/api/conversations');
    assert.deepEqual([refused.status, refused.body.code], [401, 'AUTH_REQUIRED']);
    assert.equal(signedOut.cookies.size, 0);
    // An old anonymous cookie is ignored.
    signedOut.cookies.set('alya_session', 'f'.repeat(64));
    assert.equal((await signedOut.get('/api/conversations')).status, 401);
    assert.deepEqual(app.firestore.paths('conversations/'), []);

    laptop.cookies.set('alya_session', 'f'.repeat(64));
    const chat = (await laptop.post('/api/conversations')).body;
    const answered = await ask(laptop, chat.id, 'What should I wear?');
    assert.equal(answered.status, 200);
    assert.equal(answered.body.mode, 'gemini-memory');
    assert.equal(answered.body.supportSummary, undefined);
    assert.equal(
      app.firestore.read(`conversations/${chat.id}`).owner,
      `account:${employee.account.id}`,
    );
    const phone = app.browser();
    await phone.signIn('PC-0001', 'employee-own-pass-1');
    assert.deepEqual(
      (await phone.get('/api/conversations')).body.conversations.map((c) => c.id),
      [chat.id],
    );
    // HR accounts chat too, in their own chats.
    const hrChat = await hr.post('/api/conversations');
    assert.equal(hrChat.status, 201);
    assert.deepEqual(
      (await hr.get('/api/conversations')).body.conversations.map((c) => c.id),
      [hrChat.body.id],
    );
    // Signing out leaves the browser with nothing.
    await laptop.post('/api/auth/sign-out');
    assert.equal((await laptop.get('/api/conversations')).status, 401);
  });
});

test('an expired or invalid account cookie is 401 SESSION_EXPIRED on conversation endpoints, never anonymous', async () => {
  for (const mode of ['gemini-chat', 'document-search']) {
    await withApp({ mode }, async (app) => {
      const hr = await app.hrBrowser();
      const { browser } = await app.readyEmployee(hr);
      const chat = (await browser.post('/api/conversations')).body;
      const forged = app.browser();
      forged.cookies.set('onboardai_account', 'not-a-real-token');
      app.clock.advance(12 * HOUR);
      for (const visitor of [browser, forged]) {
        for (const [method, path, body] of [
          ['get', '/api/conversations'],
          ['post', '/api/conversations'],
          ['get', `/api/conversations/${chat.id}`],
          [
            'post',
            '/api/chat',
            {
              question: 'Hello?',
              taskId: 'quiz-part-1',
              conversationId: chat.id,
              requestId: randomUUID(),
            },
          ],
          ['post', `/api/conversations/${chat.id}/feedback`, { messageId: 'x', rating: 'helpful' }],
        ]) {
          const holder = visitor.copy();
          const response = await holder[method](path, body);
          assert.deepEqual(
            [response.status, response.body.code],
            [401, 'SESSION_EXPIRED'],
            `${mode} ${path}`,
          );
          assert.equal(holder.cookies.has('alya_session'), false);
          assert.equal(holder.cookies.has('onboardai_account'), false); // cleared
        }
      }
      // /api/config still answers, as a signed-out browser.
      const config = await browser.get('/api/config');
      assert.equal(config.status, 200);
      assert.equal(config.body.conversationMemory, false);
      assert.equal(config.headers.get('cache-control'), 'no-store');
      assert.equal(app.firestore.read(`conversations/${chat.id}`).messageCount, 0);
    });
  }
});
