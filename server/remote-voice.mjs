import { sharedVoiceName } from './kokoro-voice.mjs';

// Same render(text, rate) interface as the in-process voice, backed by the
// separate TTS service. Errors use the messages api-routes already understands.
export function createRemoteVoice({ url, fetchImpl = fetch, timeoutMs = 120000 }) {
  const endpoint = new URL('/voice', url);
  return {
    name: sharedVoiceName,
    async render(text, rate = 1) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, rate }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error('VOICE_UNAVAILABLE');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.code === 'VOICE_BUSY' ? 'VOICE_BUSY' : 'VOICE_UNAVAILABLE');
      }
      try {
        return Buffer.from(await response.arrayBuffer());
      } catch {
        throw new Error('VOICE_UNAVAILABLE');
      }
    },
  };
}
