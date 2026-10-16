// Gemini text to speech for Alya (#52): the request (the transcript alone),
// WAV and PCM audio, the cache and its prompt version, the duration guard with
// one retry, the timeout and the Kokoro fallback, with a fake fetch. Through
// /api/voice too (signed in). No Google request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startAccountsApp } from './account-harness.mjs';
import { encodeWav } from '../../server/kokoro-voice.mjs';
import {
  audioToWav,
  createGeminiVoice,
  createVoiceService,
  geminiVoiceSettings,
  speechPrompt,
  speechPromptVersion,
  voiceCacheKey,
  wavFromPcm,
} from '../../server/gemini-voice.mjs';
import { maxSpeechSeconds } from '../../server/voice-guard.mjs';
import { pronunciationVersion, speechText } from '../../server/speech-pronunciation.mjs';

const wav = encodeWav(new Float32Array([0, 0.25, -0.25, 0.5]));
const pcm = Buffer.from([0x00, 0x00, 0xff, 0x7f, 0x01, 0x80, 0x00, 0x40]);
const reply = (inlineData) =>
  Response.json({
    candidates: [{ content: { role: 'model', parts: [{ inlineData }] } }],
    modelVersion: 'gemini-3.8-flash-tts',
  });

// A silent 24 kHz 16-bit mono WAV of the given length, as Gemini returns it.
const clip = (seconds) => wavFromPcm(Buffer.alloc(Math.round(seconds * 24000) * 2));
const wavReply = (wavBytes) => reply({ mimeType: 'audio/wav', data: wavBytes.toString('base64') });

function gemini(respond, options = {}) {
  const calls = [];
  const voice = createGeminiVoice({
    project: 'synthetic-project',
    getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
      return respond(calls.length);
    },
    ...options,
  });
  return { calls, voice };
}

test('settings: VOICE_PROVIDER=gemini with a project, defaults for the model, location and voice', () => {
  assert.equal(geminiVoiceSettings({}), null);
  assert.equal(geminiVoiceSettings({ VOICE_PROVIDER: 'kokoro', GOOGLE_CLOUD_PROJECT: 'p' }), null);
  assert.equal(geminiVoiceSettings({ VOICE_PROVIDER: 'gemini' }), null);
  assert.deepEqual(geminiVoiceSettings({ VOICE_PROVIDER: 'Gemini', GOOGLE_CLOUD_PROJECT: 'p' }), {
    project: 'p',
    model: 'gemini-3.8-flash-tts',
    location: 'global',
    voice: 'Sulafat',
  });
  assert.deepEqual(
    geminiVoiceSettings({
      VOICE_PROVIDER: 'gemini',
      GOOGLE_CLOUD_PROJECT: 'p',
      GEMINI_TTS_MODEL: 'gemini-x-tts',
      GEMINI_TTS_LOCATION: 'us-central1',
      GEMINI_TTS_VOICE: 'Kore',
    }),
    { project: 'p', model: 'gemini-x-tts', location: 'us-central1', voice: 'Kore' },
  );
  // An unusable value keeps the default.
  assert.equal(
    geminiVoiceSettings({
      VOICE_PROVIDER: 'gemini',
      GOOGLE_CLOUD_PROJECT: 'p',
      GEMINI_TTS_VOICE: 'x y',
    }).voice,
    'Sulafat',
  );
});

test('the request: generateContent with AUDIO, the prebuilt voice and the transcript alone', async () => {
  const { calls, voice } = gemini(() =>
    reply({ mimeType: 'audio/wav', data: wav.toString('base64') }),
  );
  const audio = await voice.render('Welcome to your first day.', 0.85);
  assert.deepEqual(audio, wav);
  assert.equal(
    calls[0].url,
    'https://aiplatform.googleapis.com/v1/projects/synthetic-project/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent',
  );
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(calls[0].body.generationConfig, {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } },
  });
  // The whole request text is the sentence: no notes, heading, style or pace
  // words the model could read aloud, and no other field that carries text.
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['contents', 'generationConfig']);
  assert.deepEqual(calls[0].body.contents, [
    { role: 'user', parts: [{ text: 'Welcome to your first day.' }] },
  ]);
  assert.equal(speechPrompt('Welcome to your first day.'), 'Welcome to your first day.');
  // Every rate sends the same request.
  for (const rate of [0.95, 1, 1.05]) await voice.render('Welcome to your first day.', rate);
  for (const call of calls) assert.deepEqual(call.body, calls[0].body);
  assert.equal(voice.header, 'gemini-sulafat');
});

test('raw PCM (audio/L16) is wrapped in a WAV header with its sample rate', () => {
  const out = audioToWav('audio/L16;codec=pcm;rate=24000', pcm.toString('base64'));
  assert.equal(out.toString('ascii', 0, 4), 'RIFF');
  assert.equal(out.toString('ascii', 8, 12), 'WAVE');
  assert.equal(out.readUInt16LE(22), 1); // mono
  assert.equal(out.readUInt32LE(24), 24000);
  assert.equal(out.readUInt16LE(34), 16);
  assert.equal(out.readUInt32LE(40), pcm.length);
  assert.deepEqual(out.subarray(44), pcm);
  assert.equal(audioToWav('audio/pcm;rate=16000', pcm.toString('base64')).readUInt32LE(24), 16000);
  assert.deepEqual(wavFromPcm(pcm).subarray(44), pcm);
  assert.throws(() => audioToWav('audio/mpeg', pcm.toString('base64')), /UNSUPPORTED_AUDIO/);
  assert.throws(() => audioToWav('audio/wav', pcm.toString('base64')), /BAD_AUDIO/);
  assert.throws(() => audioToWav('audio/wav', ''), /EMPTY_AUDIO/);
});

test('the cache key starts with the prompt and pronunciation versions, so an older clip is never served', async () => {
  assert.equal(speechPromptVersion, 2);
  const key = voiceCacheKey({ model: 'm', voice: 'Sulafat', rate: 1, text: 'Hi.' });
  assert.equal(key, `prompt-v2\npron-v${pronunciationVersion}\nm\nSulafat\n1\nHi.`);
  assert.equal(pronunciationVersion, 1);
  const { voice } = gemini(() => wavReply(clip(1)));
  await voice.render('Hi.', 0.95);
  assert.deepEqual(voice.cacheKeys(), [
    voiceCacheKey({ model: 'gemini-3.8-flash-tts', voice: 'Sulafat', rate: 0.95, text: 'Hi.' }),
  ]);
  assert.match(voice.cacheKeys()[0], /^prompt-v2\npron-v1\n/);
});

test('the guard: a clip too long for its sentence is retried once; the second clip is used', async () => {
  const logs = [];
  const text = 'Your reporting manager is Kelvin Ong, who is the CTO.';
  // The user's recording: the leaked clip ran 19.40 s; the clean ones 3.72-5.04 s.
  const { calls, voice } = gemini((n) => wavReply(clip(n === 1 ? 19.4 : 4.2)), {
    log: (line) => logs.push(line),
  });
  const audio = await voice.render(text, 0.95);
  assert.deepEqual(audio, clip(4.2));
  assert.equal(calls.length, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^voice_guard_rejected \{/);
  const logged = JSON.parse(logs[0].slice('voice_guard_rejected '.length));
  assert.deepEqual(Object.keys(logged), [
    'model',
    'durationSeconds',
    'expectedSeconds',
    'maxSeconds',
    'attempt',
  ]);
  assert.equal(logged.model, 'gemini-3.8-flash-tts');
  assert.equal(logged.durationSeconds, 19.4);
  assert.equal(logged.attempt, 1);
  assert.ok(logged.expectedSeconds > 3 && logged.expectedSeconds < 6);
  // No employee text in the log.
  for (const word of ['Kelvin', 'manager', 'CTO']) assert.ok(!logs[0].includes(word));
  // The accepted clip is cached; the rejected one never was.
  await voice.render(text, 0.95);
  assert.equal(calls.length, 2);
  assert.equal(voice.cacheSize(), 1);
});

test('the guard: two rejected clips throw GUARD_REJECTED and nothing is cached', async () => {
  const logs = [];
  const text = 'Use only approved AI tools.';
  const { calls, voice } = gemini(() => wavReply(clip(11.6)), { log: (line) => logs.push(line) });
  await assert.rejects(voice.render(text, 1), (e) => e.code === 'GUARD_REJECTED');
  assert.equal(calls.length, 2);
  assert.equal(voice.cacheSize(), 0);
  assert.deepEqual(
    logs.map((line) => JSON.parse(line.slice('voice_guard_rejected '.length)).attempt),
    [1, 2],
  );
  // The next request synthesises again rather than serving a rejected clip.
  await assert.rejects(voice.render(text, 1), (e) => e.code === 'GUARD_REJECTED');
  assert.equal(calls.length, 4);
  assert.equal(voice.cacheSize(), 0);
});

test('the guard boundary through the voice: a clip at the limit is accepted, just past it is rejected', async () => {
  const text = 'Please arrive at Reception, Level 12, Tower B by 08:45.';
  const limit = maxSpeechSeconds(text);
  const atLimit = gemini(() => wavReply(clip(limit - 0.001)), { log: () => {} });
  assert.deepEqual(await atLimit.voice.render(text, 1), clip(limit - 0.001));
  assert.equal(atLimit.calls.length, 1);
  const past = gemini(() => wavReply(clip(limit + 0.05)), { log: () => {} });
  await assert.rejects(past.voice.render(text, 1), (e) => e.code === 'GUARD_REJECTED');
  assert.equal(past.calls.length, 2);
});

test('the cache: the same model, voice, rate and text is synthesised once; concurrent requests share one call', async () => {
  const { calls, voice } = gemini(
    () => reply({ mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') }),
    {
      cacheEntries: 2,
    },
  );
  const [a, b] = await Promise.all([voice.render('One.', 1), voice.render('One.', 1)]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  await voice.render('One.', 1);
  assert.equal(calls.length, 1);
  await voice.render('One.', 0.85); // another rate
  await voice.render('Two.', 1);
  assert.equal(calls.length, 3);
  assert.equal(voice.cacheSize(), 2);
  await voice.render('One.', 1); // evicted (least recently used)
  assert.equal(calls.length, 4);
});

test('failures: HTTP errors, no audio and the timeout throw and are not cached', async () => {
  const failing = gemini(() =>
    Response.json({ error: { message: 'private text' } }, { status: 400 }),
  );
  await assert.rejects(
    failing.voice.render('x', 1),
    (e) => e.code === 'HTTP_ERROR' && e.status === 400,
  );
  await assert.rejects(failing.voice.render('x', 1), (e) => e.code === 'HTTP_ERROR');
  assert.equal(failing.calls.length, 2);
  const empty = gemini(() =>
    Response.json({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] }),
  );
  await assert.rejects(empty.voice.render('x', 1), (e) => e.code === 'NO_AUDIO');
  const slow = gemini(
    () =>
      new Promise((resolve, reject) => {
        const signal = slow.calls[0].signal;
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
    { timeoutMs: 30 },
  );
  await assert.rejects(slow.voice.render('x', 1), (e) => e.code === 'TIMEOUT');
  const noToken = createGeminiVoice({
    project: 'p',
    getAccessToken: async () => {
      throw new Error('no ADC');
    },
    fetchImpl: async () => assert.fail('no request without a token'),
  });
  await assert.rejects(noToken.render('x', 1), (e) => e.code === 'CREDENTIALS_UNAVAILABLE');
});

test('the voice service falls back to Kokoro and names the voice used', async () => {
  const logs = [];
  const kokoro = { render: async () => wav };
  const ok = createVoiceService({
    gemini: { header: 'gemini-sulafat', render: async () => pcm },
    kokoro,
  });
  assert.deepEqual(await ok.render('x', 1), { wav: pcm, voice: 'gemini-sulafat' });
  const broken = createVoiceService({
    gemini: {
      header: 'gemini-sulafat',
      render: async () => {
        throw Object.assign(new Error('x'), { code: 'HTTP_ERROR', status: 404 });
      },
    },
    kokoro,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(await broken.render('Private sentence', 1), { wav, voice: 'kokoro-af-heart' });
  assert.deepEqual(logs, ['Gemini voice failed; using Kokoro: {"code":"HTTP_ERROR","status":404}']);
  assert.deepEqual(await createVoiceService({ kokoro }).render('x', 1), {
    wav,
    voice: 'kokoro-af-heart',
  });
  const none = createVoiceService({
    gemini: { header: 'g', render: async () => Promise.reject(new Error('x')) },
    kokoro: { render: async () => Promise.reject(new Error('VOICE_UNAVAILABLE')) },
    log: () => {},
  });
  await assert.rejects(none.render('x', 1), /VOICE_UNAVAILABLE/);
});

test('the voice service: a guard rejection (after its retry) falls back to Kokoro', async () => {
  const logs = [];
  const { calls, voice: geminiVoice } = gemini(() => wavReply(clip(30)), {
    log: (line) => logs.push(line),
  });
  const kokoroCalls = [];
  const service = createVoiceService({
    gemini: geminiVoice,
    kokoro: {
      render: async (...args) => {
        kokoroCalls.push(args);
        return wav;
      },
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(await service.render('Welcome to your first day.', 0.95), {
    wav,
    voice: 'kokoro-af-heart',
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(kokoroCalls, [['Welcome to your first day.', 0.95]]);
  assert.equal(logs.filter((line) => line.startsWith('voice_guard_rejected ')).length, 2);
  assert.equal(
    logs.at(-1),
    'Gemini voice failed; using Kokoro: {"code":"GUARD_REJECTED","status":null}',
  );
  for (const line of logs) assert.ok(!line.includes('Welcome'));
});

test('/api/voice: the Gemini voice when it answers, Kokoro with its header when it fails', async () => {
  let fail = false;
  const kokoroCalls = [];
  const app = await startAccountsApp({
    sharedVoice: {
      render: async (...args) => {
        kokoroCalls.push(args);
        return wav;
      },
    },
    geminiVoice: {
      header: 'gemini-sulafat',
      render: async () => {
        if (fail) throw Object.assign(new Error('x'), { code: 'HTTP_ERROR', status: 404 });
        return wavFromPcm(pcm);
      },
    },
  });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const spoken = await fetch(app.url + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: browser.cookieHeader },
      body: JSON.stringify({ text: 'Hello there', rate: 0.95 }),
    });
    assert.equal(spoken.status, 200);
    assert.equal(spoken.headers.get('content-type'), 'audio/wav');
    assert.equal(spoken.headers.get('x-alya-voice'), 'gemini-sulafat');
    assert.deepEqual(Buffer.from(await spoken.arrayBuffer()), wavFromPcm(pcm));
    assert.equal(kokoroCalls.length, 0);
    fail = true;
    const fallback = await fetch(app.url + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: browser.cookieHeader },
      body: JSON.stringify({ text: 'Hello there', rate: 0.95 }),
    });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('x-alya-voice'), 'kokoro-af-heart');
    assert.deepEqual(kokoroCalls, [['Hello there', 0.95]]);
  } finally {
    await app.close();
  }
});

test('/api/voice: a clip the guard rejects twice is Kokoro, or 503 VOICE_UNAVAILABLE without Kokoro', async () => {
  let kokoroWorks = true;
  const { calls, voice: geminiVoice } = gemini(() => wavReply(clip(40)), { log: () => {} });
  const app = await startAccountsApp({
    sharedVoice: {
      render: async () => {
        if (!kokoroWorks) throw new Error('VOICE_UNAVAILABLE');
        return wav;
      },
    },
    geminiVoice,
  });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const speak = () =>
      fetch(app.url + '/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: browser.cookieHeader },
        body: JSON.stringify({ text: 'Hello there', rate: 1 }),
      });
    const kokoro = await speak();
    assert.equal(kokoro.status, 200);
    assert.equal(kokoro.headers.get('x-alya-voice'), 'kokoro-af-heart');
    assert.deepEqual(Buffer.from(await kokoro.arrayBuffer()), wav);
    assert.equal(calls.length, 2);
    kokoroWorks = false;
    const unavailable = await speak();
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'VOICE_UNAVAILABLE');
    // Retried again (nothing cached), then refused.
    assert.equal(calls.length, 4);
    assert.equal(geminiVoice.cacheSize(), 0);
  } finally {
    await app.close();
  }
});

test('/api/config names the configured voice and its X-Alya-Voice id, for Gemini and for Kokoro (QA F-3)', async () => {
  const { createApp } = await import('../../server/api-routes.mjs');
  const { once } = await import('node:events');
  const configOf = async (env) => {
    const server = createApp({
      env,
      accountService: null,
      getAccessToken: async () => 'synthetic-token',
      fetchImpl: async () => assert.fail('no Google request'),
      sharedVoice: { render: async () => wav },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      return await (await fetch(`http://127.0.0.1:${server.address().port}/api/config`)).json();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
  const gemini = await configOf({ VOICE_PROVIDER: 'gemini', GOOGLE_CLOUD_PROJECT: 'synthetic' });
  assert.deepEqual(gemini.voice, {
    id: 'gemini-sulafat',
    label: 'Alya · Sulafat (Gemini)',
    provider: 'gemini',
  });
  // sharedVoiceName stays as it was, for compatibility.
  assert.equal(gemini.sharedVoiceName, 'Alya · Heart (English)');
  const kore = await configOf({
    VOICE_PROVIDER: 'gemini',
    GOOGLE_CLOUD_PROJECT: 'synthetic',
    GEMINI_TTS_VOICE: 'Kore',
  });
  assert.deepEqual(kore.voice, {
    id: 'gemini-kore',
    label: 'Alya · Kore (Gemini)',
    provider: 'gemini',
  });
  for (const env of [{}, { VOICE_PROVIDER: 'kokoro', GOOGLE_CLOUD_PROJECT: 'synthetic' }]) {
    const config = await configOf(env);
    assert.deepEqual(config.voice, {
      id: 'kokoro-af-heart',
      label: 'Alya · Heart',
      provider: 'kokoro',
    });
    assert.equal(config.sharedVoiceName, 'Alya · Heart (English)');
    assert.ok('voiceName' in config && 'speechMode' in config);
  }
});

test('voice.id equals the X-Alya-Voice of a clip in the configured voice, for both providers', async () => {
  for (const geminiVoice of [
    {
      header: 'gemini-sulafat',
      name: 'Alya · Sulafat (Gemini)',
      render: async () => wavFromPcm(pcm),
    },
    null,
  ]) {
    const app = await startAccountsApp({ sharedVoice: { render: async () => wav }, geminiVoice });
    try {
      const hr = await app.hrBrowser();
      const { browser } = await app.readyEmployee(hr);
      const config = (await browser.get('/api/config')).body;
      const spoken = await fetch(app.url + '/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: browser.cookieHeader },
        body: JSON.stringify({ text: 'Hello there', rate: 1 }),
      });
      assert.equal(spoken.headers.get('x-alya-voice'), config.voice.id);
      assert.equal(config.voice.provider, geminiVoice ? 'gemini' : 'kokoro');
    } finally {
      await app.close();
    }
  }
});

test('the voice service speaks the respelled names with Gemini and Kokoro; the guard measures that text', async () => {
  const written = 'Welcome to UniVRse. I am Alya.';
  const spoken = speechText(written);
  assert.notEqual(spoken, written);
  const guarded = [];
  const { calls, voice: geminiVoice } = gemini(() => wavReply(clip(2)), {
    guard: (wavBytes, text) => {
      guarded.push(text);
      return { ok: true, durationSeconds: 2, expectedSeconds: 2, maxSeconds: 4 };
    },
  });
  const kokoroTexts = [];
  const kokoro = {
    render: async (text) => {
      kokoroTexts.push(text);
      return wav;
    },
  };
  await createVoiceService({ gemini: geminiVoice, kokoro }).render(written, 1);
  assert.deepEqual(calls[0].body.contents[0].parts, [{ text: spoken }]);
  assert.deepEqual(guarded, [spoken]);
  await createVoiceService({ kokoro }).render(written, 0.95);
  assert.deepEqual(kokoroTexts, [spoken]);
});

test('/api/voice gives the voice the respelled names; the response text is not involved', async () => {
  const texts = [];
  const app = await startAccountsApp({
    sharedVoice: { render: async () => wav },
    geminiVoice: {
      header: 'gemini-sulafat',
      render: async (text) => {
        texts.push(text);
        return wavFromPcm(pcm);
      },
    },
  });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const spoken = await fetch(app.url + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: browser.cookieHeader },
      body: JSON.stringify({ text: "Hi, I'm Alya. Welcome to UniVRse's team.", rate: 1 }),
    });
    assert.equal(spoken.status, 200);
    assert.deepEqual(texts, [speechText("Hi, I'm Alya. Welcome to UniVRse's team.")]);
    assert.equal(texts[0], "Hi, I'm Ahl-yuh. Welcome to Uni V R se's team.");
  } finally {
    await app.close();
  }
});
