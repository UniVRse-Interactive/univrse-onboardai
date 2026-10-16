import express from 'express';
import { randomBytes } from 'node:crypto';
import { createGuestWorkspaceStore, guestWorkspaceLifetime } from './guest-workspace-store.mjs';
import { sessionHash, ChatError } from './saved-conversations.mjs';
import { createConversationService, conversationFailure } from './gemini-chat-workflow.mjs';
import {
  createAlyaConversationService,
  usesAlyaBrain,
  alyaBrainConfigured,
  alyaBrainInfo,
} from './alya-brain-service.mjs';
import { createKnowledgeRetriever } from './company-document-retriever.mjs';
import { searchDocuments } from './document-search.mjs';
import { sourceQuestion, sourceAnswerSupport } from './source-answer-support.mjs';
import { createAnswerGuide } from './answer-guide-metadata.mjs';
import { tasks } from './sample-onboarding-content.mjs';
import { sharedVoiceName } from './kokoro-voice.mjs';
import { createWorkspaceKnowledge } from './workspace-company-knowledge.mjs';
import { driveFailure, readGoogleDocument, parseGoogleDocLink } from './google-drive-documents.mjs';
import { vertexConfig } from './vertex-ai.mjs';
import { onboardingDocumentTopics } from './onboarding-document-topics.mjs';
import { localDocumentMovesAllowed } from './google-drive-document-moves.mjs';

// Guest HR and employee views share an isolated browser workspace. This cookie
// is not an HR credential and cannot open the separate employee/Drive database.
export function mountGuestWorkspaceRoutes(
  app,
  {
    env,
    models,
    store: providedStore,
    loadDrive,
    loadGoogleDoc = readGoogleDocument,
    moveGoogleDoc,
  } = {},
) {
  const suppliedBrain = usesAlyaBrain(env);
  const router = express.Router(),
    available = suppliedBrain
      ? Boolean(alyaBrainConfigured(env) || models)
      : !!(vertexConfig(env) || models);
  let saved = providedStore,
    service;
  const store = () => (saved ||= createGuestWorkspaceStore({ geminiAvailable: available }));
  const answerMode = suppliedBrain
    ? 'alya-brain'
    : env.AI_MODE === 'document-search' || !available
      ? 'search'
      : 'gemini';
  const knowledge = createWorkspaceKnowledge({
    folderId: env.GOOGLE_DRIVE_FOLDER_ID,
    loadDrive,
    readLinked: loadGoogleDoc,
    uploaded: (owner) => store().documents(owner),
  });
  const retrievers = new Map();
  function engine() {
    if (suppliedBrain)
      return (service ||= createAlyaConversationService({
        env,
        models,
        memory: store().memory,
        loadDocumentsForScope: async (owner, id) => {
          const guest = store().guestForConversation(id);
          if (!guest || guest.chat_owner !== owner)
            throw new ChatError(
              404,
              'WORKSPACE_GUEST_NOT_FOUND',
              'This guest chat is unavailable.',
            );
          return knowledge.load(guest.workspace_owner);
        },
      }));
    return (service ||= createConversationService({
      env,
      models,
      memory: store().memory,
      retrieve: async (query, config) => {
        const guest = store().guestForConversation(config.configurable.thread_id);
        if (!guest)
          throw new ChatError(404, 'WORKSPACE_GUEST_NOT_FOUND', 'This guest chat is unavailable.');
        if (!retrievers.has(guest.workspace_owner)) {
          if (retrievers.size >= 100) retrievers.delete(retrievers.keys().next().value);
          retrievers.set(
            guest.workspace_owner,
            createKnowledgeRetriever(async () => knowledge.load(guest.workspace_owner)),
          );
        }
        return retrievers.get(guest.workspace_owner)(query, config);
      },
    }));
  }
  router.use((req, res, next) => {
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
    store().ensure(req.workspaceOwner);
    next();
  });
  const person = (req) => store().selectGuest(req.workspaceOwner, req.params.guestId);
  router.get('/', async (req, res) => {
    const snapshot = store().snapshot(req.workspaceOwner);
    const drive = await knowledge.status();
    if (!res.destroyed)
      res.json({
        ...snapshot,
        companyKnowledge: { drive },
        driveMoves: {
          enabled: localDocumentMovesAllowed(env, req),
          configured: env.GOOGLE_DRIVE_DOCUMENT_MOVES === 'enabled',
        },
      });
  });
  router.post('/guests', (req, res) => {
    const guest = store().newGuest(req.workspaceOwner);
    res.status(201).json({ id: guest.id, name: guest.name });
  });
  router.patch('/guests/:guestId/onboarding', (req, res) => {
    res.json(store().updateOnboarding(req.workspaceOwner, req.params.guestId, req.body));
  });
  router.delete('/guests/:guestId', (req, res) => {
    store().removeGuest(req.workspaceOwner, req.params.guestId);
    res.status(204).end();
  });
  router.post('/documents', async (req, res) => {
    const movesRequested = env.GOOGLE_DRIVE_DOCUMENT_MOVES === 'enabled';
    if (movesRequested && !localDocumentMovesAllowed(env, req))
      throw new ChatError(
        403,
        'DRIVE_MOVE_HR_ACCESS_REQUIRED',
        'Adding documents to the company folder requires verified HR access. Use the local HR workspace for now.',
      );
    if (!req.is('application/json'))
      throw new ChatError(
        415,
        'GOOGLE_DOC_ONLY',
        'Only Google Docs links are accepted. Paste a Google Docs document link instead of uploading a file.',
      );
    const { category, url, name } = req.body || {};
    const topic = onboardingDocumentTopics.find((item) => item.id === category);
    if (!topic && category !== 'additional')
      throw new ChatError(
        400,
        'DOCUMENT_TOPIC_REQUIRED',
        'Choose one of the six onboarding topics or add another related guide.',
      );
    const title = topic?.title || (typeof name === 'string' ? name.trim() : '');
    if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title))
      throw new ChatError(
        400,
        'DOCUMENT_NAME_INVALID',
        'Give the additional guide a short topic name of up to 80 characters.',
      );
    let link, document;
    try {
      link = parseGoogleDocLink(url);
      document = await loadGoogleDoc(link.id);
    } catch (error) {
      const failure = driveFailure(error);
      const status =
        failure.code === 'GOOGLE_DOC_LINK_INVALID'
          ? 400
          : ['GOOGLE_DOC_TYPE_REQUIRED', 'GOOGLE_DOC_TOO_LARGE', 'DRIVE_EMPTY_DOCUMENTS'].includes(
                failure.code,
              )
            ? 422
            : 503;
      throw new ChatError(status, failure.code, failure.error);
    }
    if (req.aborted || res.destroyed) return;
    const connection = {
      name: title,
      text: document.text,
      googleDocId: link.id,
      category,
    };
    // Validate local limits before changing Google Drive. Failed moves never
    // create a local record that would falsely appear connected.
    store().checkGoogleDocConnection(req.workspaceOwner, connection);
    let driveMove;
    if (movesRequested) {
      try {
        driveMove = await moveGoogleDoc(link.id, env.GOOGLE_DRIVE_FOLDER_ID, connection);
      } catch (error) {
        const failure = driveFailure(error);
        throw new ChatError(error.statusCode || 503, failure.code, failure.error);
      }
      knowledge.invalidate();
    }
    let added;
    try {
      added = store().connectGoogleDoc(req.workspaceOwner, connection);
    } catch (error) {
      if (driveMove)
        throw new ChatError(
          503,
          'DRIVE_MOVE_LOCAL_SAVE_FAILED',
          'The Google Doc reached the company folder, but its local record could not be saved. Refresh the library; the document does not need to be moved again.',
        );
      throw error;
    }
    retrievers.delete(req.workspaceOwner);
    if (!res.destroyed)
      res.status(added.duplicate || added.replaced ? 200 : 201).json({ ...added, driveMove });
  });
  router.delete('/documents/:id', (req, res) => {
    store().removeDocument(req.workspaceOwner, req.params.id);
    retrievers.delete(req.workspaceOwner);
    res.status(204).end();
  });
  router.get('/guests/:guestId/config', (req, res) => {
    const guest = person(req);
    res.json({
      aiMode: suppliedBrain
        ? 'alya-brain'
        : answerMode === 'gemini'
          ? 'gemini-memory'
          : 'document-search',
      ...(suppliedBrain ? { brain: alyaBrainInfo(env, models), answerContext: 'stateless' } : {}),
      conversationMemory: true,
      memoryRetentionDays: 1,
      adaptiveLearning: true,
      answerFormatsAvailable: true,
      supportSummary: false,
      knowledgeMode: env.GOOGLE_DRIVE_FOLDER_ID ? 'company-documents' : 'uploaded-documents',
      guestWorkspace: true,
      employeeName: guest.name,
      documentCount: store().documents(req.workspaceOwner).length,
      sharedVoiceName,
      tasks,
    });
  });
  router.get('/guests/:guestId/conversations', (req, res) =>
    res.json({ conversations: store().memory.list(person(req).chat_owner) }),
  );
  router.post('/guests/:guestId/conversations', (req, res) =>
    res.status(201).json(store().memory.create(person(req).chat_owner)),
  );
  router.get('/guests/:guestId/conversations/:id', (req, res) =>
    res.json(store().memory.read(person(req).chat_owner, req.params.id)),
  );
  router.delete('/guests/:guestId/conversations/:id', (req, res) => {
    store().memory.erase(person(req).chat_owner, req.params.id);
    res.status(204).end();
  });
  router.post('/guests/:guestId/conversations/:id/learning', (req, res) => {
    const guest = person(req);
    res.json({ learning: engine().settings(guest.chat_owner, req.params.id, req.body) });
  });
  router.post('/guests/:guestId/conversations/:id/feedback', (req, res) => {
    store().memory.feedback(
      person(req).chat_owner,
      req.params.id,
      req.body?.messageId,
      req.body?.rating,
    );
    res.json({ rating: req.body.rating });
  });
  router.post('/guests/:guestId/conversations/:id/human-help', (req, res) => {
    store().memory.humanHelp(person(req).chat_owner, req.params.id, req.body?.messageId);
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
    if (
      !suppliedBrain &&
      !env.GOOGLE_DRIVE_FOLDER_ID &&
      !store().documents(req.workspaceOwner).length
    )
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
        answerMode === 'gemini' || suppliedBrain
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
    const { row, release } = store().memory.acquire(guest.chat_owner, id);
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
      let documents;
      try {
        documents = await knowledge.load(guest.workspace_owner);
      } catch (error) {
        const failure = driveFailure(error);
        throw new ChatError(503, failure.code, failure.error);
      }
      const searchQuery = sourceQuestion(question, row.messages);
      const found = searchDocuments(searchQuery, documents);
      const answer = found.passages?.map((p) => p.preview || p.text).join('\n\n') || found.answer;
      const { learning, exampleUnavailable } = sourceAnswerSupport(row.learning, {
        question,
        query: searchQuery,
        answer,
        matched: found.matched,
      });
      const result = {
        ...found,
        answer,
        learning,
        searchQuery,
        exampleUnavailable,
        conversationId: id,
        source: found.matched ? 'Company documents' : 'No matching company passage',
      };
      result.card = createAnswerGuide(answer, {
        format: learning.format,
        hasSources: found.matched,
      });
      signal?.throwIfAborted();
      store().memory.save(
        guest.chat_owner,
        id,
        [
          ...row.messages,
          { id: requestId + '-u', requestId, role: 'user', text: question },
          { id: requestId + '-a', requestId, role: 'assistant', text: answer, result },
        ],
        learning,
      );
      return result;
    } finally {
      release();
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
