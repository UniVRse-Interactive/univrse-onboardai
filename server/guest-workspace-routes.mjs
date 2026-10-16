import express from 'express';
import { randomBytes } from 'node:crypto';
import {
  createGuestWorkspaceStore,
  guestWorkspaceLifetime,
  workspaceLimits,
} from './guest-workspace-store.mjs';
import { sessionHash, ChatError } from './saved-conversations.mjs';
import { readUploadedDocument } from './read-uploaded-document.mjs';
import { createConversationService, conversationFailure } from './gemini-chat-workflow.mjs';
import { createCompanyRetriever } from './company-document-retriever.mjs';
import { adaptLearning } from './answer-style-preferences.mjs';
import { createAnswerGuide } from './answer-guide-metadata.mjs';
import { tasks } from './sample-onboarding-content.mjs';
import { sharedVoiceName } from './kokoro-voice.mjs';
import { createWorkspaceKnowledge } from './workspace-company-knowledge.mjs';
import { vertexConfig } from './vertex-ai.mjs';

// Guest HR and employee views share an isolated browser workspace. This cookie
// is not an HR credential and cannot open the separate saved-chat store.
// companyRetrieve(query, { signal }) is the shared company document search
// (Vertex AI Search); it is used only when VERTEX_SEARCH_ENGINE_ID is set.
export function mountGuestWorkspaceRoutes(
  app,
  { env, models, store: providedStore, companyRetrieve = createCompanyRetriever({ env }) } = {},
) {
  const router = express.Router(),
    available = !!(vertexConfig(env) || models);
  let saved = providedStore,
    service;
  const store = () => (saved ||= createGuestWorkspaceStore({ geminiAvailable: available }));
  const answerMode = env.AI_MODE === 'document-search' || !available ? 'search' : 'gemini';
  const knowledge = createWorkspaceKnowledge({
    env,
    companyRetrieve,
    uploaded: (owner) => store().documents(owner),
  });
  function engine() {
    return (service ||= createConversationService({
      env,
      models,
      memory: store().memory,
      retrieve: async (query, config) => {
        const guest = store().guestForConversation(config.configurable.thread_id);
        if (!guest)
          throw new ChatError(404, 'WORKSPACE_GUEST_NOT_FOUND', 'This guest chat is unavailable.');
        return knowledge.retrieve(guest.workspace_owner, query, { signal: config?.signal });
      },
    }));
  }
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin')) {
      try {
        if (new URL(req.get('origin')).host !== req.host) throw new Error();
      } catch {
        return res.status(403).json({ error: 'Open this workspace on the website itself.' });
      }
    }
    const prefix = 'onboardai_workspace=';
    let token = req
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(prefix))
      ?.slice(prefix.length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) token = randomBytes(32).toString('hex');
    res.cookie('onboardai_workspace', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || env.NODE_ENV === 'production',
      maxAge: guestWorkspaceLifetime,
      path: '/api/guest-workspace',
    });
    req.workspaceOwner = sessionHash(token);
    await store().ensure(req.workspaceOwner);
    next();
  });
  const person = (req) => store().selectGuest(req.workspaceOwner, req.params.guestId);
  router.get('/', async (req, res) => {
    const snapshot = await store().snapshot(req.workspaceOwner);
    // `drive` is the HR page's name for the company document source, which is
    // now the company document search (Vertex AI Search) status.
    if (!res.destroyed) res.json({ ...snapshot, companyKnowledge: { drive: knowledge.status() } });
  });
  router.post('/guests', (req, res) => {
    const guest = store().newGuest(req.workspaceOwner);
    res.status(201).json({ id: guest.id, name: guest.name });
  });
  router.delete('/guests/:guestId', async (req, res) => {
    await store().removeGuest(req.workspaceOwner, req.params.guestId);
    res.status(204).end();
  });
  router.post(
    '/documents',
    express.raw({ type: 'application/octet-stream', limit: workspaceLimits.bytes }),
    async (req, res) => {
      let name;
      try {
        name = decodeURIComponent(req.get('X-File-Name') || '');
      } catch {
        throw new ChatError(400, 'FILE_NAME_INVALID', 'Choose a file with a valid name.');
      }
      const document = await readUploadedDocument(name, req.body);
      if (req.aborted || res.destroyed) return;
      const added = store().addDocument(req.workspaceOwner, document);
      res.status(added.duplicate ? 200 : 201).json(added);
    },
  );
  router.delete('/documents/:id', (req, res) => {
    store().removeDocument(req.workspaceOwner, req.params.id);
    res.status(204).end();
  });
  router.get('/guests/:guestId/config', (req, res) => {
    const guest = person(req);
    res.json({
      aiMode: answerMode === 'gemini' ? 'gemini-memory' : 'document-search',
      conversationMemory: true,
      memoryRetentionDays: 1,
      adaptiveLearning: answerMode === 'gemini',
      answerFormatsAvailable: answerMode === 'gemini',
      supportSummary: false,
      knowledgeMode: knowledge.companySearch ? 'company-documents' : 'uploaded-documents',
      guestWorkspace: true,
      employeeName: guest.name,
      documentCount: store().documents(req.workspaceOwner).length,
      sharedVoiceName,
      tasks,
    });
  });
  // The chat store's methods are async; Express 5 passes rejections to the
  // error handler below.
  router.get('/guests/:guestId/conversations', async (req, res) =>
    res.json({ conversations: await store().memory.list(person(req).chat_owner) }),
  );
  router.post('/guests/:guestId/conversations', async (req, res) =>
    res.status(201).json(await store().memory.create(person(req).chat_owner)),
  );
  router.get('/guests/:guestId/conversations/:id', async (req, res) =>
    res.json(await store().memory.read(person(req).chat_owner, req.params.id)),
  );
  router.delete('/guests/:guestId/conversations/:id', async (req, res) => {
    await store().memory.erase(person(req).chat_owner, req.params.id);
    res.status(204).end();
  });
  router.post('/guests/:guestId/conversations/:id/learning', async (req, res) => {
    const guest = person(req);
    if (answerMode !== 'gemini')
      throw new ChatError(
        409,
        'WORKSPACE_FORMATS_UNAVAILABLE',
        'Conversational answer formats require Gemini. Document search quotes the source text.',
      );
    res.json({ learning: await engine().settings(guest.chat_owner, req.params.id, req.body) });
  });
  router.post('/guests/:guestId/conversations/:id/feedback', async (req, res) => {
    await store().memory.feedback(
      person(req).chat_owner,
      req.params.id,
      req.body?.messageId,
      req.body?.rating,
    );
    res.json({ rating: req.body.rating });
  });
  router.post('/guests/:guestId/conversations/:id/human-help', async (req, res) => {
    await store().memory.humanHelp(person(req).chat_owner, req.params.id, req.body?.messageId);
    res.json({ saved: true });
  });
  router.post('/guests/:guestId/chat', async (req, res) => {
    const guest = person(req),
      { question, conversationId, requestId } = req.body || {};
    if (
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 1600 ||
      typeof conversationId !== 'string' ||
      typeof requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(requestId)
    )
      throw new ChatError(
        400,
        'WORKSPACE_QUESTION_INVALID',
        'Choose a chat and enter a question of up to 1,600 characters.',
      );
    if (!knowledge.hasKnowledge(req.workspaceOwner))
      throw new ChatError(
        409,
        'WORKSPACE_KNOWLEDGE_EMPTY',
        'Company guidance is not available yet. HR can upload company documents to get started.',
      );
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 60000);
    const closed = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on('close', closed);
    try {
      const result =
        answerMode === 'gemini'
          ? await engine().ask(
              guest.chat_owner,
              conversationId,
              question.trim(),
              requestId,
              abort.signal,
            )
          : await searchAnswer(guest, conversationId, question.trim(), requestId, abort.signal);
      const { supportSummary, ...answer } = result;
      if (!res.destroyed) res.json(answer);
    } catch (error) {
      if (!res.destroyed) {
        const failure = conversationFailure(error);
        res.status(failure.status).json(failure);
      }
    } finally {
      clearTimeout(timer);
      res.off('close', closed);
    }
  });
  async function searchAnswer(guest, id, question, requestId, signal) {
    const turn = await store().memory.acquire(guest.chat_owner, id),
      row = turn.row;
    try {
      const completed = row.messages.find(
        (m) => m.requestId === requestId && m.role === 'assistant',
      );
      if (completed) {
        if (
          row.messages.find((m) => m.requestId === requestId && m.role === 'user')?.text !==
          question
        )
          throw new ChatError(
            409,
            'REQUEST_CONFLICT',
            'Start a new request for a different question.',
          );
        return completed.result;
      }
      if (row.messages.length >= 160)
        throw new ChatError(409, 'CHAT_FULL', 'Start a new chat to ask more questions.');
      // Company search failures are CompanySearchErrors (fixed SEARCH_* codes).
      const passages = await knowledge.quote(guest.workspace_owner, question, { signal });
      const found = { mode: 'document-search', matched: passages.length > 0, passages };
      const answer =
        passages.map((p) => p.preview || p.text).join('\n\n') ||
        "I couldn't find a matching passage in the company documents. Try a specific topic such as working hours or dress code, or ask HR to confirm.";
      const learning = { ...adaptLearning(row.learning, { question }), format: 'standard' };
      const result = {
        ...found,
        answer,
        learning,
        conversationId: id,
        source: found.matched ? 'Company documents' : 'No matching company passage',
      };
      result.card = createAnswerGuide(answer, { hasSources: found.matched });
      signal?.throwIfAborted();
      await turn.save(
        [
          { id: requestId + '-u', requestId, role: 'user', text: question },
          { id: requestId + '-a', requestId, role: 'assistant', text: answer, result },
        ],
        learning,
      );
      return result;
    } finally {
      await turn.release();
    }
  }
  router.use((req, res) =>
    res.status(404).json({ error: 'This workspace action is unavailable.' }),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!(error instanceof ChatError))
      console.warn('Workspace request failed:', error.name, error.code || error.type || 'UNKNOWN');
    if (error.type === 'entity.too.large')
      return res
        .status(413)
        .json({ code: 'FILE_TOO_LARGE', error: 'Each file must be 5 MB or smaller.' });
    const failure = conversationFailure(error);
    res.status(failure.status).json(failure);
  });
  app.use('/api/guest-workspace', router);
  return { close: () => saved?.close() };
}
