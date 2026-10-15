import express from 'express';
import { parseVoiceRequest, voiceRequestError, voiceFailure } from './voice-request.mjs';

// Kokoro text-to-speech service. `sharedVoice` is { render(text, rate) }; call
// app.locals.setReady(true) once the model is loaded.
export function createTtsApp({ sharedVoice }) {
  const app = express();
  let ready = false;
  app.locals.setReady = (value) => {
    ready = Boolean(value);
  };
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  app.get('/health', (req, res) => {
    res.status(ready ? 200 : 503).json({ ok: ready });
  });

  app.post('/voice', async (req, res) => {
    const request = parseVoiceRequest(req.body);
    if (!request) return res.status(400).json({ error: voiceRequestError });
    try {
      const wav = await sharedVoice.render(request.text, request.rate);
      if (res.destroyed) return;
      res.set({
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
        'X-Alya-Voice': 'kokoro-af-heart',
      });
      res.send(wav);
    } catch (error) {
      if (res.destroyed) return;
      const { status, code, error: message } = voiceFailure(error);
      res.status(status).json({ code, error: message });
    }
  });

  // Malformed JSON and oversized bodies are client errors, not 500s.
  app.use((error, req, res, next) => {
    if (error?.status >= 400 && error.status < 500)
      return res.status(error.status).json({ error: voiceRequestError });
    next(error);
  });
  return app;
}
