import { sharedVoiceName } from './kokoro-voice.mjs';
import {
  logIdTokenFailure,
  serverlessAuthorization,
  serverlessAuthorizationHeader,
} from './service-auth.mjs';

// Same render(text, rate) interface as the in-process voice, backed by the
// separate TTS service. Errors use the messages api-routes already understands.
// With an idTokenProvider (service-auth.mjs) each request carries the api's ID
// token for the tts origin in X-Serverless-Authorization.
export function createRemoteVoice({
  url,
  fetchImpl = fetch,
  timeoutMs = 120000,
  idTokenProvider = null,
}) {
  const endpoint = new URL('/voice', url);
  return {
    name: sharedVoiceName,
    async render(text, rate = 1) {
      const headers = { 'Content-Type': 'application/json' };
      if (idTokenProvider) {
        try {
          headers[serverlessAuthorizationHeader] = await serverlessAuthorization(
            idTokenProvider,
            endpoint.origin,
          );
        } catch (error) {
          logIdTokenFailure('api -> tts', error);
          throw new Error('VOICE_UNAVAILABLE');
        }
      }
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
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
