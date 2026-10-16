import express from 'express';
import { GoogleAuth } from 'google-auth-library';

import { tasks, demoAnswer, systemPrompt } from './sample-onboarding-content.mjs';

import { createCompanyRetriever, knowledgeMode } from './company-document-retriever.mjs';
import { searchFailure } from './vertex-ai-search.mjs';
import { quoteSearchResults } from './document-search.mjs';
import { createSharedVoice, sharedVoiceName } from './kokoro-voice.mjs';
import { createRemoteVoice } from './remote-voice.mjs';
import { parseVoiceRequest, voiceRequestError, voiceFailure } from './voice-request.mjs';
import { randomBytes } from 'node:crypto';
import { sessionHash } from './saved-conversations.mjs';
import { createConversationService, conversationFailure } from './gemini-chat-workflow.mjs';
import { mountGuestWorkspaceRoutes } from './guest-workspace-routes.mjs';
import { vertexConfig, vertexGenerateContentUrl, createAccessTokenProvider } from './vertex-ai.mjs';
import { createProfileAutofill } from './profile-autofill.mjs';
import { ChatError } from './chat-errors.mjs';
import { accountErrors } from './account-errors.mjs';
import { accountSettings } from './account-settings.mjs';
import { createAccountBackends, createAccountService } from './account-service.mjs';
import { createCompanyDocumentStore } from './company-documents.mjs';
import { createCompanyKnowledge, isAccountOwner } from './company-knowledge.mjs';
import { createFirestoreClient } from './firestore-client.mjs';
import { readDriveKnowledge, readGoogleDocument } from './google-drive-documents.mjs';
import {
  accountCookie,
  accountCookieOptions,
  mountAccountRoutes,
  readCookie,
  sameOrigin,
  sendAccountError,
} from './account-routes.mjs';

// A stateless answer that could not be prepared: the status and JSON body the
// browser receives (unchanged from before accounts existed).
class AnswerFailure extends Error {
  constructor(status, body) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export function createApp({
  env = process.env,
  fetchImpl = fetch,
  localVoice = null,
  sharedVoice = env.TTS_SERVICE_URL
    ? createRemoteVoice({ url: env.TTS_SERVICE_URL })
    : createSharedVoice(),
  trustProxy = false,
  // The saved-chat service (gemini-chat-workflow.mjs), or a function
  // ({ retrieve }) => service that is given the app's company retriever.
  conversationService = null,
  guestModels = null,
  guestStore = null,
  getAccessToken = null,
  // Accounts service (account-service.mjs). By default it is built when
  // DATABASE_URL is set; pass null to turn accounts off.
  accountService = undefined,
  // Profile autofill service (profile-autofill.mjs). By default it uses Vertex
  // AI through fetchImpl and getAccessToken; pass null to turn it off.
  profileAutofill = undefined,
  // The HR company Google Docs library (company-documents.mjs). By default it
  // is stored in Firestore whenever accounts are on.
  companyDocuments = undefined,
  // Read-only Google Drive access for that library (google-drive-documents.mjs).
  loadGoogleDocument = readGoogleDocument,
  loadDriveKnowledge = readDriveKnowledge,
  // The company search (Vertex AI Search, or the sample guide); tests replace it.
  companyRetrieve = undefined,
} = {}) {
  const app = express();
  const documentSearch = env.AI_MODE === 'document-search';
  const memoryChat = env.AI_MODE === 'gemini-chat';
  // Throws AccountsConfigError when DATABASE_URL is set without the Firestore
  // settings accounts need (see account-settings.mjs).
  const settings = accountSettings(env);
  const accounts =
    accountService !== undefined
      ? accountService
      : settings
        ? createAccountService(createAccountBackends(settings))
        : null;
  const vertexToken = getAccessToken || createAccessTokenProvider();
  const autofill =
    profileAutofill !== undefined
      ? profileAutofill
      : createProfileAutofill({ env, fetchImpl, getAccessToken: vertexToken });
  // Company passages for gemini-chat and document-search: Vertex AI Search, or
  // the sample guide when VERTEX_SEARCH_ENGINE_ID is unset.
  const retrieve =
    companyRetrieve || createCompanyRetriever({ env, fetchImpl, getAccessToken: vertexToken });
  // With accounts on, HR's company Google Docs library (and the optional
  // GOOGLE_DRIVE_FOLDER_ID folder) is searched too, for chats owned by an
  // account only. Anonymous browsers and guest workspaces are unchanged.
  const library = !accounts
    ? null
    : companyDocuments !== undefined
      ? companyDocuments
      : settings
        ? createCompanyDocumentStore({ firestore: createFirestoreClient(settings.firestore) })
        : null;
  const knowledge = library
    ? createCompanyKnowledge({
        env,
        documents: library,
        companyRetrieve: retrieve,
        loadGoogleDoc: loadGoogleDocument,
        loadDrive: loadDriveKnowledge,
      })
    : null;
  // retrieve(query, options, owner): `owner` is the chat's owner, when known.
  const chatRetrieve = (query, options, owner) =>
    knowledge && isAccountOwner(owner)
      ? knowledge.retrieve(query, { signal: options?.signal })
      : retrieve(query, options);
  const quoteRetrieve = (query, options, owner) =>
    knowledge && isAccountOwner(owner)
      ? knowledge.quote(query, { signal: options?.signal })
      : retrieve(query, options);
  let conversations = typeof conversationService === 'function' ? null : conversationService;
  const chatService = () =>
    (conversations ||=
      typeof conversationService === 'function'
        ? conversationService({ retrieve: chatRetrieve })
        : createConversationService({ env, retrieve: chatRetrieve }));

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
    companyRetrieve: retrieve,
  });
  mountAccountRoutes(app, {
    env,
    accounts,
    profileAutofill: autofill,
    chatMemory: () => chatService().memory,
    companyKnowledge: knowledge,
  });
  // Both stores close asynchronously (Firestore client or SQLite file), as do
  // the account database pool and the profile and library clients.
  app.locals.closeChat = async () => {
    await Promise.allSettled([
      conversations?.close(),
      guestWorkspace.close(),
      accounts?.close(),
      library?.close?.(),
    ]);
  };

  // A usable account session (no forced password change) for this request, or
  // null. Never throws: /api/config must answer even if the database is down.
  async function signedInAccount(req) {
    const token = accounts ? readCookie(req, accountCookie) : undefined;
    if (token === undefined) return null;
    try {
      const session = await accounts.session(token);
      return session && !session.account.mustChangePassword ? session.account : null;
    } catch {
      return null;
    }
  }

  // Public configuration. Credentials stay on the server. With accounts on, a
  // signed-in account's chats are always saved, so conversationMemory is true
  // for that browser in every answer mode.
  app.get('/api/config', async (req, res) => {
    const savedChats = memoryChat || Boolean(await signedInAccount(req));
    if (accounts) res.set({ 'Cache-Control': 'no-store', Vary: 'Cookie' });
    res.json({
      aiMode: memoryChat
        ? 'gemini-memory'
        : documentSearch
          ? 'document-search'
          : vertexConfig(env)
            ? 'gemini'
            : 'demo',
      conversationMemory: savedChats,
      memoryRetentionDays: savedChats ? 30 : null,
      adaptiveLearning: memoryChat,
      supportSummary: false,

      speechMode: cloudTts ? 'google' : localVoice ? 'windows-local' : 'browser-demo',

      voiceName: localVoice?.name || null,
      sharedVoiceName,
      tasks,

      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',

      knowledgeMode: memoryChat || documentSearch ? knowledgeMode(env) : 'sample-tasks',

      // HR and employee sign-in is available (DATABASE_URL is set).
      accounts: Boolean(accounts),
      // HR can pre-fill profile forms from a document: accounts are on and
      // GOOGLE_CLOUD_PROJECT is set (credentials are not probed).
      profileAutofill: Boolean(accounts && autofill?.available),
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // Saved chats belong to the signed-in account (`account:<uuid>`) when an
  // account cookie is present, in every answer mode; an expired or invalid one
  // is 401 SESSION_EXPIRED and never falls back to the anonymous cookie.
  // Without an account cookie, gemini-chat uses the anonymous browser cookie.
  async function chatOwner(req, res, next) {
    if (accounts && readCookie(req, accountCookie) !== undefined) {
      if (!sameOrigin(req))
        return res.status(403).json({ error: 'Open chat on the website itself.' });
      res.set('Cache-Control', 'no-store');
      let session;
      try {
        session = await accounts.session(readCookie(req, accountCookie));
      } catch (error) {
        return chatFailure(res, error);
      }
      if (!session) {
        res.clearCookie(accountCookie, accountCookieOptions(req, env));
        return sendAccountError(res, accountErrors.sessionExpired());
      }
      if (session.account.mustChangePassword)
        return sendAccountError(res, accountErrors.passwordChangeRequired());
      req.chatOwner = `account:${session.account.id}`;
      return next();
    }
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
  // The store is async (Firestore or SQLite); every failure is a ChatError.
  app.get('/api/conversations', chatOwner, async (req, res) => {
    try {
      res.json({ conversations: await chatService().memory.list(req.chatOwner) });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations', chatOwner, async (req, res) => {
    try {
      res.status(201).json(await chatService().memory.create(req.chatOwner));
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.get('/api/conversations/:id', chatOwner, async (req, res) => {
    try {
      res.json(await chatService().memory.read(req.chatOwner, req.params.id));
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.delete('/api/conversations/:id', chatOwner, async (req, res) => {
    try {
      await chatService().memory.erase(req.chatOwner, req.params.id);
      res.status(204).end();
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/learning', chatOwner, async (req, res) => {
    try {
      res.json({ learning: await chatService().settings(req.chatOwner, req.params.id, req.body) });
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
  app.post('/api/support-summary/settings', chatOwner, async (req, res) => {
    try {
      const settings = await chatService().memory.supportSettings(req.chatOwner, req.body);
      res.json({ recording: settings.recording });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/feedback', chatOwner, async (req, res) => {
    try {
      await chatService().memory.feedback(
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
  app.post('/api/conversations/:id/voice-event', chatOwner, async (req, res) => {
    try {
      await chatService().memory.voiceEvent(req.chatOwner, req.params.id, req.body.messageId);
      res.json({ saved: true });
    } catch (error) {
      chatFailure(res, error);
    }
  });
  app.post('/api/conversations/:id/human-help', chatOwner, async (req, res) => {
    try {
      await chatService().memory.humanHelp(req.chatOwner, req.params.id, req.body.messageId);
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

    // A signed-in account's question is saved as a turn of its conversation in
    // every answer mode (document search, sample answers, single-turn Gemini).
    if (accounts && readCookie(req, accountCookie) !== undefined) {
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
          const result = await saveTurn(
            req.chatOwner,
            conversationId,
            question.trim(),
            requestId,
            abort.signal,
            () =>
              answerOnce({
                question,
                task,
                style,
                taskId,
                signal: abort.signal,
                owner: req.chatOwner,
              }),
          );
          if (!res.destroyed) await deliver(result);
        } catch (error) {
          if (res.destroyed) return;
          if (error instanceof AnswerFailure) res.status(error.status).json(error.body);
          else chatFailure(res, error);
        } finally {
          clearTimeout(timer);
          res.off('close', closed);
        }
      });
    }

    let result;
    try {
      result = await answerOnce({ question, task, style, taskId });
    } catch (error) {
      if (!(error instanceof AnswerFailure)) throw error;
      return res.status(error.status).json(error.body);
    }
    return deliver(result);
  });

  // One answer without conversation history, from the configured engine:
  // document search, the labelled sample answer, or single-turn Gemini. A
  // failure is an AnswerFailure carrying the response the browser receives.
  // `owner` is the account's chat owner for a signed-in turn.
  async function answerOnce({ question, task, style, taskId, signal, owner = null }) {
    if (documentSearch) {
      const start = performance.now();
      let passages;
      try {
        passages = await quoteRetrieve(question.trim(), signal ? { signal } : undefined, owner);
      } catch (error) {
        // Company library and Drive failures are ChatErrors with fixed codes.
        const failure =
          error instanceof ChatError
            ? { status: error.status, code: error.code, error: error.message }
            : searchFailure(error);
        throw new AnswerFailure(failure.status, { code: failure.code, error: failure.error });
      }
      return {
        ...quoteSearchResults(passages),
        taskId,
        latencyMs: Math.round(performance.now() - start),
      };
    }

    // Without Vertex AI configured, return a labelled sample answer.
    const vertex = vertexConfig(env);
    if (!vertex) {
      return demoAnswer(question, task, style);
    }

    const start = performance.now();

    // Single-turn Gemini mode answers from the sample task only. Company
    // documents are searched in gemini-chat and document-search modes.
    const instruction = systemPrompt(task, style);
    const source = task.sourceStatus;

    try {
      const token = await vertexToken();

      const response = await fetchImpl(vertexGenerateContentUrl(vertex), {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },

        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
          : AbortSignal.timeout(25000),

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
          throw new AnswerFailure(402, {
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

      return {
        answer,
        mode: 'gemini',
        source,
        taskId,
        latencyMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      if (error instanceof AnswerFailure) throw error;
      throw new AnswerFailure(502, {
        error:
          'Google AI could not answer right now. ' +
          'Check Vertex AI access, model availability and quota, ' +
          'then try again.',
      });
    }
  }

  // Saves one question and its answer in a saved conversation, as the guest
  // workspace does for document-search turns. The chat is leased while the
  // answer is prepared; repeating a request ID returns the saved answer.
  async function saveTurn(owner, id, question, requestId, signal, compute) {
    const turn = await chatService().memory.acquire(owner, id),
      row = turn.row;
    try {
      const completed = row.messages.find(
        (m) => m.requestId === requestId && m.role === 'assistant',
      );
      if (completed) {
        const original = row.messages.find((m) => m.requestId === requestId && m.role === 'user');
        if (original?.text !== question)
          throw new ChatError(
            409,
            'REQUEST_CONFLICT',
            'Start a new request for a different question.',
          );
        return completed.result;
      }
      if (row.messages.length >= 160)
        throw new ChatError(
          409,
          'CHAT_FULL',
          'This conversation has reached 80 questions. Start a new chat; you can still read this one.',
        );
      const result = { ...(await compute()), conversationId: id };
      signal?.throwIfAborted();
      await turn.save(
        [
          { id: requestId + '-u', requestId, role: 'user', text: question },
          { id: requestId + '-a', requestId, role: 'assistant', text: result.answer, result },
        ],
        row.learning,
      );
      return result;
    } finally {
      await turn.release();
    }
  }

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
