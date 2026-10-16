import { vertexGenerateContentUrl } from './vertex-ai.mjs';
import { pronunciationVersion, speechText } from './speech-pronunciation.mjs';
import { checkVoiceClip } from './voice-guard.mjs';

// Alya's voice from Gemini text to speech on Vertex AI (issue #52), with the
// Kokoro voice as the fallback. POST /api/voice is unchanged: a sentence and a
// rate go in, audio/wav comes out, and X-Alya-Voice names the voice used.
//
//   VOICE_PROVIDER       gemini | kokoro (default kokoro)
//   GEMINI_TTS_MODEL     default gemini-3.8-flash-tts (a Preview model)
//   GEMINI_TTS_LOCATION  default global
//   GEMINI_TTS_VOICE     default Sulafat, a warm female prebuilt voice
//   GOOGLE_CLOUD_PROJECT the Vertex AI project (Application Default Credentials)
//
// The prompt is the sentence and nothing else. Version 1 put "director's
// notes" (style and pace) before a TRANSCRIPT heading in the same text, and the
// model read the notes aloud in about a quarter of the clips. The model
// rejects a systemInstruction (400) and has no pace field, so there is no
// separate place for style: Gemini speaks at its natural pace and the rate
// does not change its delivery. Every clip then passes the duration guard
// (voice-guard.mjs): a clip too long for its sentence is retried once and
// then left to Kokoro, and is never cached. See docs/onboarding-journey.md.
export const speechPromptVersion = 2;
export const geminiVoiceDefaults = Object.freeze({
  model: 'gemini-3.8-flash-tts',
  location: 'global',
  voice: 'Sulafat',
});
export const kokoroVoiceHeader = 'kokoro-af-heart';
const voicePattern = /^[A-Za-z][A-Za-z-]{1,40}$/;
const modelPattern = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const locationPattern = /^(global|us|eu|[a-z]+-[a-z]+[0-9]+)$/;

// The whole text of the request: the transcript alone. No heading, style or
// pace words, which the model may speak.
export function speechPrompt(text) {
  return String(text);
}

// The cache key: the prompt and pronunciation versions first, so a clip made
// with another prompt format or another pronunciation map is never served.
export function voiceCacheKey({ model, voice, rate, text }) {
  return `prompt-v${speechPromptVersion}\npron-v${pronunciationVersion}\n${model}\n${voice}\n${rate}\n${text}`;
}

// null for Kokoro; otherwise the Gemini settings. An unusable value keeps the
// default rather than failing the voice.
export function geminiVoiceSettings(env = process.env) {
  if ((env.VOICE_PROVIDER || '').trim().toLowerCase() !== 'gemini') return null;
  const project = (env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (!project) return null;
  const pick = (name, pattern, fallback) => {
    const value = (env[name] || '').trim();
    return pattern.test(value) ? value : fallback;
  };
  return {
    project,
    model: pick('GEMINI_TTS_MODEL', modelPattern, geminiVoiceDefaults.model),
    location: pick('GEMINI_TTS_LOCATION', locationPattern, geminiVoiceDefaults.location),
    voice: pick('GEMINI_TTS_VOICE', voicePattern, geminiVoiceDefaults.voice),
  };
}

export const geminiVoiceHeader = (voice) => `gemini-${voice.toLowerCase()}`;

// A WAV file around 16-bit little-endian PCM (Gemini's audio/L16 output).
export function wavFromPcm(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// The WAV bytes of one inlineData part: audio/wav as it is, raw PCM
// (audio/L16;rate=24000, audio/pcm) wrapped in a header. Anything else throws.
export function audioToWav(mimeType, data) {
  const type = String(mimeType || '').toLowerCase();
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) throw voiceError('EMPTY_AUDIO');
  if (/^audio\/(x-)?wav\b/.test(type) || /^audio\/wave\b/.test(type)) {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw voiceError('BAD_AUDIO');
    return bytes;
  }
  if (/^audio\/(l16|pcm)\b/.test(type)) {
    const rate = Number(/rate=(\d+)/.exec(type)?.[1]) || 24000;
    const channels = Number(/channels=(\d+)/.exec(type)?.[1]) || 1;
    return wavFromPcm(bytes, rate, channels, 16);
  }
  throw voiceError('UNSUPPORTED_AUDIO');
}

const round = (seconds) => (Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null);

const voiceError = (code, status = null) =>
  Object.assign(new Error(`Gemini voice failed (${code}).`), { code, status });

export function createGeminiVoice({
  project,
  location = geminiVoiceDefaults.location,
  model = geminiVoiceDefaults.model,
  voice = geminiVoiceDefaults.voice,
  // async () => OAuth access token (Application Default Credentials).
  getAccessToken,
  fetchImpl = fetch,
  timeoutMs = 15000,
  cacheEntries = 32,
  // (wav, text) => { ok, durationSeconds, expectedSeconds, maxSeconds }
  guard = checkVoiceClip,
  // Synthesis attempts per sentence when the guard rejects a clip.
  attempts = 2,
  log = (line) => console.warn(line),
}) {
  const url = vertexGenerateContentUrl({ project, location, model });
  // Least recently used first; keyed by prompt version, model, voice, rate and
  // text. Only clips that passed the guard are kept.
  const cache = new Map();
  const pending = new Map();
  const remember = (key, wav) => {
    cache.delete(key);
    cache.set(key, wav);
    while (cache.size > cacheEntries) cache.delete(cache.keys().next().value);
  };

  async function synthesize(text) {
    let token;
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
    if (!token) throw voiceError('CREDENTIALS_UNAVAILABLE');
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: speechPrompt(text) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      });
    } catch (error) {
      throw voiceError(error?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw voiceError('HTTP_ERROR', response.status);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw voiceError('BAD_RESPONSE');
    }
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
    if (!part) throw voiceError('NO_AUDIO');
    return audioToWav(part.inlineData.mimeType, part.inlineData.data);
  }

  // A clip that passes the guard, after at most `attempts` syntheses.
  async function guarded(text) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const wav = await synthesize(text);
      const check = guard(wav, text);
      if (check.ok) return wav;
      // The model and the timings only: never the text.
      log(
        'voice_guard_rejected ' +
          JSON.stringify({
            model,
            durationSeconds: round(check.durationSeconds),
            expectedSeconds: round(check.expectedSeconds),
            maxSeconds: round(check.maxSeconds),
            attempt,
          }),
      );
    }
    throw voiceError('GUARD_REJECTED');
  }

  return {
    name: `Alya · ${voice} (Gemini)`,
    header: geminiVoiceHeader(voice),
    model,
    voice,
    cacheSize: () => cache.size,
    cacheKeys: () => [...cache.keys()],
    // One synthesis with no guard, retry or cache (npm run check:voice).
    synthesizeOnce: (text) => synthesize(text),
    async render(text, rate = 1) {
      const key = voiceCacheKey({ model, voice, rate, text });
      if (cache.has(key)) {
        const wav = cache.get(key);
        remember(key, wav);
        return wav;
      }
      // The same sentence requested twice at once is synthesised once.
      if (pending.has(key)) return pending.get(key);
      const work = guarded(text)
        .then((wav) => {
          remember(key, wav);
          return wav;
        })
        .finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}

// The voice /api/voice uses: Gemini first when configured, Kokoro (the
// in-process voice or the tts service) as the fallback. Resolves to
// { wav, voice } with the X-Alya-Voice value of the voice actually used; when
// Kokoro fails too, its error is thrown (the existing voiceFailure mapping).
// Both voices get the text with the names respelled for speech
// (speech-pronunciation.mjs); the guard measures that respelled text.
export function createVoiceService({ gemini = null, kokoro, log = (line) => console.warn(line) }) {
  return {
    provider: gemini ? 'gemini' : 'kokoro',
    async render(written, rate = 1) {
      const text = speechText(written);
      if (gemini) {
        try {
          return { wav: await gemini.render(text, rate), voice: gemini.header };
        } catch (error) {
          // The code and HTTP status only: never the text or provider messages.
          log(
            'Gemini voice failed; using Kokoro: ' +
              JSON.stringify({ code: error?.code || 'UNKNOWN', status: error?.status ?? null }),
          );
        }
      }
      return { wav: await kokoro.render(text, rate), voice: kokoroVoiceHeader };
    },
  };
}
