import { createBrain } from './alya-brain/server/brain.mjs';
import { adaptLearning } from './alya-brain/server/answer-style-preferences.mjs';
import { createChatMemory, ChatError } from './saved-conversations.mjs';
import { updateLearning } from './answer-style-preferences.mjs';
import { createAnswerGuide } from './answer-guide-metadata.mjs';

export const usesAlyaBrain = (env) => env.AI_MODE === 'alya-brain';
export const alyaBrainConfigured = (env) => Boolean(env.GEMINI_API_KEY?.trim());
export const alyaBrainInfo = (env, models) => ({
  id: 'alya-brain',
  version: '1.0.0',
  stateless: true,
  configured: Boolean(models || alyaBrainConfigured(env)),
});

const formatRequests = {
  standard: 'Please answer in 2–3 short sentences.',
  steps: 'Please explain this step by step in at most three short steps.',
  example: 'Please give me a short fictional worked example.',
  brief: 'Please keep the answer brief, in one or two short sentences.',
};

// The supplied brain is kept unmodified. This adapter owns application concerns:
// authorized document scopes, transcripts, request deduplication and UI metadata.
// Saved messages, reports and inferred preferences never enter its prompt.
export function createAlyaConversationService({
  env = process.env,
  loadDocuments,
  loadDocumentsForScope,
  models,
  memory = createChatMemory(env.CHAT_DATABASE_PATH),
} = {}) {
  const brains = new Map();
  function brainFor(owner, id) {
    const key = JSON.stringify([owner, id]);
    if (!brains.has(key)) {
      if (brains.size >= 100) brains.delete(brains.keys().next().value);
      brains.set(
        key,
        createBrain({
          env,
          models,
          loadDocuments: () =>
            loadDocumentsForScope
              ? loadDocumentsForScope(owner, id)
              : loadDocuments(env.GOOGLE_DRIVE_FOLDER_ID),
        }),
      );
    }
    return brains.get(key);
  }
  async function ask(owner, id, question, requestId, signal, action) {
    if (action != null)
      throw new ChatError(
        400,
        'LEARNING_ACTION_REMOVED',
        'Ask your company or onboarding question directly.',
      );
    if (typeof question !== 'string' || !question.trim() || question.length > 1600)
      throw new ChatError(400, 'QUESTION_INVALID', 'Enter a question of up to 1,600 characters.');
    const { row, release } = memory.acquire(owner, id);
    try {
      const completed = row.messages.find(
        (message) => message.requestId === requestId && message.role === 'assistant',
      );
      if (completed) {
        const original = row.messages.find(
          (message) => message.requestId === requestId && message.role === 'user',
        );
        if (original?.text !== question)
          throw new ChatError(
            409,
            'REQUEST_CONFLICT',
            'Start a new request for a different question.',
          );
        return {
          ...completed.result,
          learning: row.learning,
          conversationId: id,
          supportSummary: memory.supportSummary(owner),
        };
      }
      if (row.messages.length >= 160)
        throw new ChatError(
          409,
          'CHAT_FULL',
          'Start a new chat to ask more questions. Your existing chat is kept.',
        );
      if (!models && !alyaBrainConfigured(env))
        throw new ChatError(
          503,
          'ALYA_BRAIN_NOT_CONFIGURED',
          'Set GEMINI_API_KEY on the server to enable the supplied Alya brain.',
        );
      signal?.throwIfAborted();
      const requestedFormat = formatRequests[row.learning.preference];
      const currentQuestion = requestedFormat ? question + '\n\n' + requestedFormat : question;
      const started = performance.now();
      let answer;
      try {
        answer = await brainFor(owner, id).ask(currentQuestion, { signal });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error.name === 'TimeoutError')
          throw new ChatError(
            504,
            'ALYA_BRAIN_TIMEOUT',
            'Alya took too long to answer. Please try again. Your saved chat is kept.',
          );
        throw new ChatError(
          502,
          'ALYA_BRAIN_UNAVAILABLE',
          'Alya could not prepare a verified answer. Check Gemini and company document availability, then try again.',
        );
      }
      signal?.throwIfAborted();
      const learning = adaptLearning(
        { preference: row.learning.preference },
        { question: currentQuestion, query: question },
      );
      const result = {
        ...answer,
        mode: 'alya-brain',
        brain: 'alya-brain',
        conversationId: id,
        searchQuery: question,
        learning,
        latencyMs: Math.round(performance.now() - started),
        card: createAnswerGuide(answer.answer, {
          format: learning.format,
          hasSources: answer.passages.length > 0,
        }),
      };
      memory.save(
        owner,
        id,
        [
          ...row.messages,
          { id: requestId + '-u', requestId, role: 'user', text: question },
          { id: requestId + '-a', requestId, role: 'assistant', text: result.answer, result },
        ],
        learning,
      );
      return { ...result, supportSummary: memory.supportSummary(owner) };
    } finally {
      release();
    }
  }
  function settings(owner, id, patch) {
    const row = memory.read(owner, id);
    try {
      return memory.setLearning(owner, id, updateLearning(row.learning, patch));
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError(400, 'LEARNING_SETTINGS_INVALID', error.message);
    }
  }
  return {
    ask,
    settings,
    memory,
    close: () => {
      brains.clear();
      memory.close();
    },
  };
}
