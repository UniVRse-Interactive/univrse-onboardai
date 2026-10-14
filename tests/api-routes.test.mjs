import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/api-routes.mjs';
async function server(env = {}, fetchImpl, localVoice) {
  const s = createApp({ env, fetchImpl, localVoice }).listen(0, '127.0.0.1');
  await once(s, 'listening');
  return {
    url: `http://127.0.0.1:${s.address().port}`,
    close: () => new Promise((r) => s.close(r)),
  };
}
const post = (url, path, body) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('local demo is labelled and does not invent policies, links or approvals', async () => {
  const s = await server();
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.aiMode, 'demo');
    assert.equal(config.speechMode, 'browser-demo');
    for (const q of [
      'What is the salary policy?',
      'Where is the link?',
      'Can you approve this task?',
    ]) {
      const r = await post(s.url, '/api/chat', { question: q, taskId: 'quiz-part-1' });
      assert.equal(r.status, 200);
      const d = await r.json();
      assert.equal(d.mode, 'demo');
      assert.match(d.answer, /HR|not been|authorized/i);
    }
    assert.equal(
      (await post(s.url, '/api/chat', { question: 'hello', taskId: 'missing' })).status,
      400,
    );
    assert.equal(
      (await post(s.url, '/api/chat', { question: 'x'.repeat(1601), taskId: 'quiz-part-1' }))
        .status,
      400,
    );
    assert.equal(
      (await post(s.url, '/api/tts', { input: { ssml: '<speak>Hello</speak>' } })).status,
      503,
    );
  } finally {
    await s.close();
  }
});
test('Gemini integration sends server-side credentials and grounded system instruction', async () => {
  let request;
  const s = await server({ GEMINI_API_KEY: 'test-only-key' }, async (url, options) => {
    request = { url, options };
    return Response.json({
      candidates: [{ content: { parts: [{ text: 'Ask HR to confirm the sample guide.' }] } }],
    });
  });
  try {
    const d = await (
      await post(s.url, '/api/chat', { question: 'What is next?', taskId: 'quiz-part-1' })
    ).json();
    assert.equal(d.mode, 'gemini');
    assert.equal(request.options.headers['x-goog-api-key'], 'test-only-key');
    assert.match(request.options.body, /UNAPPROVED SAMPLE/);
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(JSON.stringify(config).includes('test-only-key'), false);
  } finally {
    await s.close();
  }
});
test('Google failures stay visible and never silently become demo answers', async () => {
  const s = await server(
    { GEMINI_API_KEY: 'test-only-key' },
    async () => new Response('failure', { status: 429 }),
  );
  try {
    const r = await post(s.url, '/api/chat', { question: 'help', taskId: 'quiz-part-1' });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /Google AI/);
  } finally {
    await s.close();
  }
});
test('TTS proxy rejects external audio and oversized SSML before any cloud request', async () => {
  const s = await server({ GOOGLE_CLOUD_PROJECT: 'test-project' });
  try {
    for (const ssml of [
      '<speak><audio src="https://example.com/private"/></speak>',
      '<speak>' + 'A'.repeat(5000) + '</speak>',
    ])
      assert.equal((await post(s.url, '/api/tts', { input: { ssml } })).status, 400);
  } finally {
    await s.close();
  }
});
test('local speech arrives with the answer and muted requests do not synthesize audio', async () => {
  const rendered = [];
  const voice = {
    name: 'Test voice',
    render: async (text, rate) => {
      rendered.push({ text, rate });
      return {
        audioContent: 'test-wave',
        visemes: ['PP', 'aa'],
        vtimes: [100, 150],
        vdurations: [50, 100],
      };
    },
  };
  const s = await server({}, undefined, voice);
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.speechMode, 'windows-local');
    const response = await post(s.url, '/api/chat', {
      question: 'What is next?',
      taskId: 'quiz-part-1',
      speechEnabled: true,
      speechRate: 1.1,
    });
    const result = await response.json();
    assert.equal(result.speech.audioContent, 'test-wave');
    assert.equal(rendered[0].text, result.answer);
    assert.equal(rendered[0].rate, 1.1);
    await post(s.url, '/api/chat', {
      question: 'What is next?',
      taskId: 'quiz-part-1',
      speechEnabled: false,
    });
    assert.equal(rendered.length, 1);
    for (const text of ['', 123, 'é'.repeat(2501)])
      assert.equal((await post(s.url, '/api/tts/local', { text })).status, 400);
    assert.equal(rendered.length, 1);
  } finally {
    await s.close();
  }
});
test('a local speech failure preserves the text answer and explains the failure', async () => {
  const s = await server({}, undefined, {
    name: 'Test voice',
    render: async () => {
      throw new Error('test failure');
    },
  });
  try {
    const result = await (
      await post(s.url, '/api/chat', {
        question: 'What is next?',
        taskId: 'quiz-part-1',
        speechEnabled: true,
      })
    ).json();
    assert.ok(result.answer);
    assert.equal(result.mode, 'demo');
    assert.match(result.speechError, /local voice/);
    assert.equal(result.speech, undefined);
  } finally {
    await s.close();
  }
});
