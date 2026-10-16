import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/api-routes.mjs';
const fakeToken = async () => 'test-access-token';
async function server(env = {}, fetchImpl, localVoice, getAccessToken = fakeToken) {
  const s = createApp({ env, fetchImpl, localVoice, getAccessToken }).listen(0, '127.0.0.1');
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
const vertexReply = () =>
  Response.json({
    candidates: [{ content: { parts: [{ text: 'Ask HR to confirm the sample guide.' }] } }],
  });
test('Gemini mode calls Vertex AI global with a bearer token and no API key', async () => {
  let request;
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project', GEMINI_MODEL: 'gemini-test-model' },
    async (url, options) => {
      request = { url, options };
      return vertexReply();
    },
  );
  try {
    const d = await (
      await post(s.url, '/api/chat', { question: 'What is next?', taskId: 'quiz-part-1' })
    ).json();
    assert.equal(d.mode, 'gemini');
    assert.equal(
      request.url,
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global' +
        '/publishers/google/models/gemini-test-model:generateContent',
    );
    assert.equal(request.options.headers.Authorization, 'Bearer test-access-token');
    assert.equal(request.options.headers['x-goog-api-key'], undefined);
    const body = JSON.parse(request.options.body);
    assert.match(body.systemInstruction.parts[0].text, /UNAPPROVED SAMPLE/);
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents[0].parts[0].text, 'What is next?');
    assert.deepEqual(body.generationConfig, { temperature: 0.2, maxOutputTokens: 1600 });
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.aiMode, 'gemini');
    assert.equal(JSON.stringify(config).includes('test-access-token'), false);
  } finally {
    await s.close();
  }
});
test('Gemini mode uses the regional Vertex AI host for a regional location', async () => {
  let url;
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    async (u) => {
      url = u;
      return vertexReply();
    },
  );
  try {
    await post(s.url, '/api/chat', { question: 'What is next?', taskId: 'quiz-part-1' });
    assert.equal(
      url,
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1' +
        '/publishers/google/models/gemini-3.5-flash-lite:generateContent',
    );
  } finally {
    await s.close();
  }
});
test('Gemini mode without GOOGLE_CLOUD_PROJECT falls back to demo answers and never calls Google', async () => {
  const s = await server({}, async () => assert.fail('Vertex must not be called'));
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.aiMode, 'demo');
    const d = await (
      await post(s.url, '/api/chat', { question: 'What is next?', taskId: 'quiz-part-1' })
    ).json();
    assert.notEqual(d.mode, 'gemini');
  } finally {
    await s.close();
  }
});
test('Google failures stay visible and never silently become demo answers', async () => {
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project' },
    async () => new Response('private provider details', { status: 429 }),
  );
  try {
    const r = await post(s.url, '/api/chat', { question: 'help', taskId: 'quiz-part-1' });
    assert.equal(r.status, 502);
    const text = JSON.stringify(await r.json());
    assert.match(text, /Google AI/);
    assert.ok(!text.includes('private provider'));
  } finally {
    await s.close();
  }
});
test('credential lookup failures return a safe error and never leak the token error', async () => {
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project' },
    async () => assert.fail('no request without a token'),
    undefined,
    async () => {
      throw new Error('secret ADC failure detail');
    },
  );
  try {
    const r = await post(s.url, '/api/chat', { question: 'help', taskId: 'quiz-part-1' });
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(await r.json()).includes('secret ADC'));
  } finally {
    await s.close();
  }
});
test('no server or script file reads GEMINI_API_KEY', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const offenders = [];
  for (const dir of ['server', 'scripts'])
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url)))
      if (
        f !== 'check-shareable-files.mjs' &&
        /\.(mjs|js|ps1|cs)$/.test(f) &&
        readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8').includes('GEMINI_API_KEY')
      )
        offenders.push(`${dir}/${f}`);
  assert.deepEqual(offenders, []);
});
// Issue #32 brought back the read-only Drive reader for the HR company library
// only: one file talks to Drive, with the drive.readonly scope and no writes,
// and one file reads GOOGLE_DRIVE_FOLDER_ID.
test('only the read-only Drive reader talks to Google Drive, and only the HR library reads the folder', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const drive = [],
    folder = [];
  for (const dir of ['server', 'scripts'])
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (!/\.(mjs|js|ps1|cs)$/.test(f)) continue;
      const text = readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8');
      if (/googleapis\.com\/drive|auth\/drive/.test(text)) drive.push(`${dir}/${f}`);
      if (/\.GOOGLE_DRIVE_FOLDER_ID|\[['"]GOOGLE_DRIVE_FOLDER_ID/.test(text))
        folder.push(`${dir}/${f}`);
    }
  assert.deepEqual(drive, ['server/google-drive-documents.mjs']);
  assert.deepEqual(folder, ['server/company-knowledge.mjs']);
  const reader = readFileSync(
    new URL('../server/google-drive-documents.mjs', import.meta.url),
    'utf8',
  );
  assert.deepEqual(reader.match(/auth\/drive[\w.]*/g), ['auth/drive.readonly']);
  assert.doesNotMatch(reader, /method:\s*'(PATCH|POST|PUT|DELETE)'/);
});
test('company search settings are reported in /api/config only for the modes that search', async () => {
  const env = {
    GOOGLE_CLOUD_PROJECT: 'test-project',
    VERTEX_SEARCH_ENGINE_ID: 'test-engine',
    GOOGLE_DRIVE_FOLDER_ID: 'retired-folder',
  };
  for (const [mode, expected] of [
    ['gemini-chat', 'vertex-ai-search'],
    ['document-search', 'vertex-ai-search'],
    ['gemini', 'sample-tasks'],
    ['demo', 'sample-tasks'],
  ]) {
    const s = await server({ ...env, AI_MODE: mode }, async (url) =>
      assert.fail('no request expected: ' + url),
    );
    try {
      const config = await (await fetch(s.url + '/api/config')).json();
      assert.equal(config.knowledgeMode, expected, mode);
      assert.ok(!JSON.stringify(config).includes('test-engine'));
    } finally {
      await s.close();
    }
  }
});
test('TTS proxy rejects external audio and oversized SSML before any cloud request', async () => {
  const s = await server({ GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_TTS: 'enabled' });
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
test('GOOGLE_CLOUD_PROJECT alone does not enable Cloud TTS or change speechMode', async () => {
  const s = await server({ GOOGLE_CLOUD_PROJECT: 'test-project' }, async (url) =>
    assert.fail('no request expected: ' + url),
  );
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.speechMode, 'browser-demo');
    const r = await post(s.url, '/api/tts', { input: { ssml: '<speak>Hello</speak>' } });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /not configured/);
  } finally {
    await s.close();
  }
});
test('GOOGLE_CLOUD_TTS=enabled keeps the legacy Cloud TTS route and speechMode', async () => {
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_TTS: 'enabled' },
    async (url) => assert.fail('no request expected: ' + url),
  );
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.speechMode, 'google');
    // Past the not-configured gate: invalid SSML is rejected with 400, not 503.
    const r = await post(s.url, '/api/tts', { input: { ssml: 'plain text' } });
    assert.equal(r.status, 400);
  } finally {
    await s.close();
  }
});
test('Windows local voice still works when only GOOGLE_CLOUD_PROJECT is set', async () => {
  const voice = { name: 'V', render: async () => ({ audioContent: 'w' }) };
  const s = await server(
    { GOOGLE_CLOUD_PROJECT: 'test-project' },
    async () => vertexReply(),
    voice,
  );
  try {
    const config = await (await fetch(s.url + '/api/config')).json();
    assert.equal(config.speechMode, 'windows-local');
    const d = await (
      await post(s.url, '/api/chat', {
        question: 'x',
        taskId: 'quiz-part-1',
        speechEnabled: true,
      })
    ).json();
    assert.equal(d.speech?.audioContent, 'w');
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
