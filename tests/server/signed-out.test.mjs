// Guest access is removed (issue #55): without a signed-in account, chat,
// saved conversations, voice, tts and the former guest workspace API answer
// nothing and create nothing, in every answer mode. pg-mem, the in-memory
// Firestore fake and synthetic content only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAccountsApp } from './account-harness.mjs';
import { encodeWav } from '../../server/kokoro-voice.mjs';

const chatId = '00000000-0000-4000-8000-000000000001';
const signedOutCalls = [
  ['post', '/api/chat', { question: 'What is the dress code?', taskId: 'quiz-part-1' }],
  [
    'post',
    '/api/chat',
    {
      question: 'What is the dress code?',
      taskId: 'quiz-part-1',
      conversationId: chatId,
      requestId: randomUUID(),
    },
  ],
  ['get', '/api/conversations'],
  ['post', '/api/conversations'],
  ['get', `/api/conversations/${chatId}`],
  ['delete', `/api/conversations/${chatId}`],
  ['post', `/api/conversations/${chatId}/learning`, { preference: 'steps' }],
  ['post', `/api/conversations/${chatId}/feedback`, { messageId: 'x-a', rating: 'helpful' }],
  ['post', `/api/conversations/${chatId}/voice-event`, { messageId: 'x-a' }],
  ['post', `/api/conversations/${chatId}/human-help`, { messageId: 'x-a' }],
  ['post', '/api/support-summary/settings', { recording: false }],
  ['get', '/api/employee-support-summary'],
  ['post', '/api/voice', { text: 'Hello there' }],
  ['post', '/api/tts', { input: { ssml: '<speak>Hello</speak>' } }],
  ['post', '/api/tts/local', { text: 'Hello there' }],
];

for (const mode of ['gemini-chat', 'document-search', ''])
  test(`${mode || 'demo'}: signed-out chat, conversation, voice and tts calls are 401 and create nothing`, async () => {
    const voiced = [];
    const sharedVoice = {
      render: async (...args) => {
        voiced.push(args);
        return encodeWav(new Float32Array([0, 0.5]));
      },
    };
    const localVoice = {
      name: 'Synthetic local voice',
      render: async (...args) => {
        voiced.push(args);
        return { audio: '', marks: [] };
      },
      close() {},
    };
    let searches = 0;
    const app = await startAccountsApp({
      mode,
      sharedVoice,
      localVoice,
      env: { GOOGLE_CLOUD_TTS: 'enabled', GOOGLE_CLOUD_PROJECT: 'synthetic-project' },
      companyRetrieve: async () => {
        searches++;
        return [];
      },
    });
    try {
      const anonymous = app.browser();
      // An old anonymous session cookie grants nothing either.
      const oldCookie = app.browser();
      oldCookie.cookies.set('alya_session', 'f'.repeat(64));
      for (const visitor of [anonymous, oldCookie])
        for (const [method, path, body] of signedOutCalls) {
          const response = await visitor[method](path, body);
          assert.deepEqual(
            [response.status, response.body?.code],
            [401, 'AUTH_REQUIRED'],
            `${method} ${path}`,
          );
          assert.deepEqual(response.headers.getSetCookie(), [], `${method} ${path}`);
          assert.equal(response.body.answer, undefined);
        }
      assert.deepEqual(voiced, []);
      assert.equal(searches, 0);
      // Nothing was stored anywhere.
      assert.deepEqual(app.firestore.paths(''), []);
      // A signed-in employee still gets an answer and a voice.
      const hr = await app.hrBrowser();
      const { browser } = await app.readyEmployee(hr);
      const chat = await browser.post('/api/conversations');
      assert.equal(chat.status, 201);
      const answered = await browser.post('/api/chat', {
        question: 'What is the dress code?',
        taskId: 'quiz-part-1',
        conversationId: chat.body.id,
        requestId: randomUUID(),
      });
      assert.ok([200, 502].includes(answered.status), answered.text); // demo, search or gemini
      const spoken = await browser.post('/api/voice', { text: 'Hello there' });
      assert.equal(spoken.status, 200);
      assert.equal(voiced.length, 1);
    } finally {
      await app.close();
    }
  });

test('the former guest workspace API is a JSON 404 for everyone and stores nothing', async () => {
  const app = await startAccountsApp({ mode: 'document-search' });
  try {
    const hr = await app.hrBrowser();
    for (const visitor of [app.browser(), hr]) {
      for (const [method, path, body] of [
        ['get', '/api/guest-workspace'],
        ['post', '/api/guest-workspace/guests', { name: 'Avery' }],
        ['post', '/api/guest-workspace/conversations', {}],
        ['post', '/api/guest-workspace/chat', { question: 'Hello' }],
        ['delete', '/api/guest-workspace/documents/x'],
      ]) {
        const response = await visitor[method](path, body);
        assert.deepEqual(
          [response.status, response.body],
          [404, { code: 'NOT_FOUND', error: 'This API route is unavailable.' }],
          `${method} ${path}`,
        );
        assert.deepEqual(response.headers.getSetCookie(), []);
      }
      const upload = await visitor.upload(
        '/api/guest-workspace/documents',
        Buffer.from('Working hours are 9 to 5.'),
        'guide.txt',
      );
      assert.equal(upload.status, 404);
    }
    assert.deepEqual(app.firestore.paths('conversations/'), []);
    assert.deepEqual(app.firestore.paths('companyDocuments/'), []);
  } finally {
    await app.close();
  }
});
