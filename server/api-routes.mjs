import express from 'express';
import { GoogleAuth } from 'google-auth-library';

import { tasks, demoAnswer, systemPrompt } from './sample-onboarding-content.mjs';

import {
  readDriveKnowledge,
  readGoogleDocument,
  driveSystemPrompt,
  driveFailure,
} from './google-drive-documents.mjs';
import { searchDocuments } from './document-search.mjs';
import { createSharedVoice, sharedVoiceName } from './kokoro-voice.mjs';
import { createRemoteVoice } from './remote-voice.mjs';
import { parseVoiceRequest, voiceRequestError, voiceFailure } from './voice-request.mjs';
import { randomBytes } from 'node:crypto';
import { sessionHash } from './saved-conversations.mjs';
import { createConversationService, conversationFailure } from './gemini-chat-workflow.mjs';
import { mountGuestWorkspaceRoutes } from './guest-workspace-routes.mjs';
import { moveGoogleDocumentToFolder } from './google-drive-document-moves.mjs';
import { vertexConfig, vertexGenerateContentUrl, createAccessTokenProvider } from './vertex-ai.mjs';

export function createApp({
  env = process.env,
  fetchImpl = fetch,
  localVoice = null,
  loadDriveKnowledge = readDriveKnowledge,
  loadGoogleDocument = readGoogleDocument,
  moveGoogleDocument = moveGoogleDocumentToFolder,
  sharedVoice = env.TTS_SERVICE_URL
    ? createRemoteVoice({ url: env.TTS_SERVICE_URL })
    : createSharedVoice(),
  trustProxy = false,
  conversationService = null,
  guestModels = null,
  guestStore = null,
  getAccessToken = null,
} = {}) {
  const app = express();
  const documentSearch = env.AI_MODE === 'document-search';
  const memoryChat = env.AI_MODE === 'gemini-chat';
  let conversations = conversationService;
  const chatService = () =>
    (conversations ||= createConversationService({ env, loadDocuments: loadDriveKnowledge }));

  app.disable('x-powered-by');
  // With a trusted proxy in front, req.ip and req.host are the browser's IP and host.
  app.set('trust proxy', trustProxy);
  app.use(express.json({ limit: '24kb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Legacy billed Cloud Text-to-Speech is opt-in; GOOGLE_CLOUD_PROJECT alone only means Vertex AI.
  const cloudTts = env.GOOGLE_CLOUD_TTS === 'enabled' && Boolean(env.GOOGLE_CLOUD_PROJECT);
  const vertexToken = getAccessToken || createAccessTokenProvider();

  const googleVoiceAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  // Small local-prototype request limit.
  const requests = new Map();

  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') return next();

    const now = Date.now();

    for (const [key, value] of requests) {
      if (now - value.start > 60000) {
        requests.delete(key);
      }
    }

    const entry = requests.get(req.ip) || {
      start: now,
      count: 0,
    };

    entry.count++;
    requests.set(req.ip, entry);

    if (entry.count > 30) {
      return res.status(429).json({
        error: 'Please wait a moment before asking again.',
      });
    }

    next();
  });

  const guestWorkspace = mountGuestWorkspaceRoutes(app, {
    env,
    models: guestModels,
    store: guestStore,
    loadDrive: loadDriveKnowledge,
    loadGoogleDoc: loadGoogleDocument,
    moveGoogleDoc: moveGoogleDocument,
  });
  app.locals.closeChat = () => {
    conversations?.close();
    guestWorkspace.close();
  };

  // Public configuration. Credentials stay on the server.
  app.get('/api/config', (req, res) => {
    res.json({
      aiMode: memoryChat
        ? 'gemini-memory'
        : documentSearch
          ? 'document-search'
          : vertexConfig(env)
            ? 'gemini'
            : 'demo',
      conversationMemory: memoryChat,
      memoryRetentionDays: memoryChat ? 30 : null,
      adaptiveLearning: memoryChat,
      supportSummary: false,

      speechMode: cloudTts ? 'google' : localVoice ? 'windows-local' : 'browser-demo',

      voiceName: localVoice?.name || null,
      sharedVoiceName,
      tasks,

      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',

      knowledgeMode: env.GOOGLE_DRIVE_FOLDER_ID ? 'google-drive' : 'sample-tasks',
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  function chatOwner(req, res, next) {
    if (!memoryChat) return res.status(404).json({ error: 'Saved conversations are not enabled.' });
    // Same-origin browser requests only; no permission is granted by a thread ID.
    if (req.get('origin')) {
      try {
        if (new URL(req.get('origin')).host !== req.host)
          return res.status(403).json({ error: 'Open chat on the website itself.' });
      } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
      }
    }
    res.set('Cache-Control', 'no-store');
    let token = req
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('alya_session='))
      ?.slice(13);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      token = randomBytes(32).toString('hex');
    }
    res.cookie('alya_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || env.NODE_ENV === 'production',
      maxAge: 30 * 86400000,
      path: '/api',
    });
    req.chatOwner = sessionHash(token);
    next();
  }
  function chatFailure(res, error) {
    const failure = conversationFailure(error);
    res.status(failure.status).json({ code: failure.code, error: failure.error });
  }
  app.get('/api/conversations', chatOwner, (req, res) => {
    try {
      res.json({ conversations: chatService().memory.list(req.chatOwner) });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations', chatOwner, (req, res) => {
    try {
      res.status(201).json(chatService().memory.create(req.chatOwner));
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.get('/api/conversations/:id', chatOwner, (req, res) => {
    try {
      res.json(chatService().memory.read(req.chatOwner, req.params.id));
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.delete('/api/conversations/:id', chatOwner, (req, res) => {
    try {
      chatService().memory.erase(req.chatOwner, req.params.id);
      res.status(204).end();
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/learning', chatOwner, (req, res) => {
    try {
      res.json({
        learning: chatService().settings(req.chatOwner, req.params.id, req.body),
      });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.get('/api/employee-support-summary', chatOwner, (req, res) => {
    // A browser-session cookie and the HR guest selector are not verified HR
    // credentials. Keep real reports closed until role-based access is connected.
    res
      .status(403)
      .json({ code: 'HR_ACCESS_REQUIRED', error: 'Reports require verified HR access.' });
  });
  app.post('/api/support-summary/settings', chatOwner, (req, res) => {
    try {
      const settings = chatService().memory.supportSettings(req.chatOwner, req.body);
      res.json({ recording: settings.recording });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/feedback', chatOwner, (req, res) => {
    try {
      chatService().memory.feedback(
        req.chatOwner,
        req.params.id,
        req.body.messageId,
        req.body.rating,
      );
      res.json({ rating: req.body.rating });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/voice-event', chatOwner, (req, res) => {
    try {
      chatService().memory.voiceEvent(req.chatOwner, req.params.id, req.body.messageId);
      res.json({ saved: true });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/human-help', chatOwner, (req, res) => {
    try {
      chatService().memory.humanHelp(req.chatOwner, req.params.id, req.body.messageId);
      res.json({ saved: true });
    } catch (error) {
      chatFailure(res, error);
    }
  });

  // A single server-controlled voice for every visitor. No device voice,
  // cloud TTS billing, client voice override or public audio cache.
  app.post('/api/voice', async (req, res) => {
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

  // Text chat and avatar share the explicitly selected answer engine.
  app.post('/api/chat', async (req, res) => {
    const { question, taskId, style = 'simple' } = req.body || {};

    const task = tasks.find((item) => item.id === taskId);

    if (
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 1600 ||
      !task ||
      !['simple', 'steps'].includes(style)
    ) {
      return res.status(400).json({
        error: 'Choose a task and enter a question ' + 'of up to 1,600 characters.',
      });
    }

    if (memoryChat) {
      return chatOwner(req, res, async () => {
        const { conversationId, requestId } = req.body;
        if (
          typeof conversationId !== 'string' ||
          typeof requestId !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(requestId)
        )
          return res
            .status(400)
            .json({ error: 'Choose a saved conversation before sending a question.' });
        const abort = new AbortController(),
          timer = setTimeout(() => abort.abort(), 60000);
        const closed = () => {
          if (!res.writableEnded) abort.abort();
        };
        res.on('close', closed);
        try {
          const result = await chatService().ask(
            req.chatOwner,
            conversationId,
            question.trim(),
            requestId,
            abort.signal,
            req.body.learningAction,
          );
          const { supportSummary, ...employeeAnswer } = result;
          if (!res.destroyed) res.json(employeeAnswer);
        } catch (error) {
          if (!res.destroyed) chatFailure(res, error);
        } finally {
          clearTimeout(timer);
          res.off('close', closed);
        }
      });
    }

    // Used by both the text chat and the avatar.
    async function deliver(result) {
      if (localVoice && !cloudTts && req.body.speechEnabled === true) {
        const rate = Math.max(0.8, Math.min(1.1, Number(req.body.speechRate) || 0.95));

        try {
          result.speech = await localVoice.render(result.answer, rate);
        } catch {
          result.speechError =
            'The local voice could not prepare this answer. ' +
            'You can still read it. Please try again.';
        }
      }

      res.json(result);
    }

    if (documentSearch) {
      const start = performance.now();
      try {
        const documents = await loadDriveKnowledge(env.GOOGLE_DRIVE_FOLDER_ID);
        return deliver({
          ...searchDocuments(question, documents),
          taskId,
          latencyMs: Math.round(performance.now() - start),
        });
      } catch (error) {
        return res.status(503).json(driveFailure(error));
      }
    }

    // Without Vertex AI configured, return a labelled sample answer.
    const vertex = vertexConfig(env);
    if (!vertex) {
      return deliver(demoAnswer(question, task, style));
    }

    const start = performance.now();

    let instruction = systemPrompt(task, style);
    let source = task.sourceStatus;

    // Read the selected Drive folder for each question.
    if (env.GOOGLE_DRIVE_FOLDER_ID) {
      try {
        const documents = await loadDriveKnowledge(env.GOOGLE_DRIVE_FOLDER_ID);

        instruction = driveSystemPrompt(documents, style);

        source = 'Google Drive: ' + documents.map((document) => document.title).join(', ');
      } catch (error) {
        return res.status(503).json(driveFailure(error));
      }
    }

    try {
      const token = await vertexToken();

      const response = await fetchImpl(vertexGenerateContentUrl(vertex), {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },

        signal: AbortSignal.timeout(25000),

        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: instruction }],
          },

          contents: [
            {
              role: 'user',
              parts: [{ text: question.trim() }],
            },
          ],

          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1600,
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 402) {
          return res.status(402).json({
            code: 'GEMINI_CREDIT_REQUIRED',
            error:
              "Gemini cannot answer because the project's prepaid credit is depleted. The project owner must restore billing for the Google Cloud project, then try again.",
          });
        }
        throw new Error('Google AI request failed.');
      }

      const data = await response.json();

      const answer = data.candidates?.[0]?.content?.parts
        ?.filter((part) => !part.thought)
        .map((part) => part.text || '')
        .join('')
        .trim();

      if (!answer) {
        throw new Error('No answer returned.');
      }

      await deliver({
        answer,
        mode: 'gemini',
        source,
        taskId,
        latencyMs: Math.round(performance.now() - start),
      });
    } catch {
      res.status(502).json({
        error:
          'Google AI could not answer right now. ' +
          'Check Vertex AI access, model availability and quota, ' +
          'then try again.',
      });
    }
  });

  // LOCAL WINDOWS VOICE
  app.post('/api/tts/local', async (req, res) => {
    if (!localVoice) {
      return res.status(503).json({
        error:
          'A local Windows voice is not available. ' +
          'Configure Google voice or use a browser ' +
          'with speech support.',
      });
    }

    const text = req.body?.text;

    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 5000) {
      return res.status(400).json({
        error: 'Enter speech text of up to 5,000 bytes.',
      });
    }

    const rate = Math.max(0.8, Math.min(1.1, Number(req.body?.rate) || 0.95));

    try {
      const speech = await localVoice.render(text, rate);

      res.json(speech);
    } catch {
      res.status(502).json({
        error: 'The local voice could not prepare this answer. ' + 'Please try again.',
      });
    }
  });

  // GOOGLE TEXT-TO-SPEECH
  app.post('/api/tts', async (req, res) => {
    if (!cloudTts) {
      return res.status(503).json({
        error: 'Google voice is not configured. ' + 'Use the local preview voice.',
      });
    }

    const ssml = req.body?.input?.ssml;

    const invalidSpeech =
      typeof ssml !== 'string' ||
      Buffer.byteLength(ssml, 'utf8') > 5000 ||
      !ssml.startsWith('<speak>') ||
      !ssml.endsWith('</speak>') ||
      /<(?!\/?speak\b|mark\b|break\b)[^>]*>/i.test(ssml);

    if (invalidSpeech) {
      return res.status(400).json({
        error: 'Invalid speech input.',
      });
    }

    try {
      const client = await googleVoiceAuth.getClient();
      const token = await client.getAccessToken();

      const speakingRate = Math.max(
        0.75,
        Math.min(1.15, Number(req.body?.audioConfig?.speakingRate) || 0.95),
      );

      const response = await fetchImpl(
        'https://texttospeech.googleapis.com/v1beta1/text:synthesize',
        {
          method: 'POST',
          signal: AbortSignal.timeout(25000),

          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token.token}`,
            'x-goog-user-project': env.GOOGLE_CLOUD_PROJECT,
          },

          body: JSON.stringify({
            input: { ssml },

            voice: {
              languageCode: 'en-US',
              name: 'en-US-Standard-F',
            },

            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate,
            },

            enableTimePointing: ['SSML_MARK'],
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Voice unavailable.');
      }

      const data = await response.json();

      res.json({
        ...data,
        timepoints: data.timepoints || [],
      });
    } catch {
      res.status(502).json({
        error: 'Google voice could not play. ' + 'You can still read the answer.',
      });
    }
  });

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      error: err.status === 413 ? 'Request is too large.' : 'Invalid request.',
    });
  });

  return app;
}
