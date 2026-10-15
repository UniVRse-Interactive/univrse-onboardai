import { storageError } from './chat-errors.mjs';
import { createFirestoreChatMemory } from './firestore-chat-memory.mjs';
import { createFirestoreClient, firestoreConfig } from './firestore-client.mjs';
import { createChatMemory } from './saved-conversations.mjs';

// Saved chats, preferences and support observations live in one store:
// Firestore when FIRESTORE_DATABASE_ID is set (with FIRESTORE_PROJECT_ID or
// GOOGLE_CLOUD_PROJECT), else the local SQLite file. Both expose the same
// promise-based interface:
//
//   checkpointer                       LangGraph checkpoint saver
//   list(owner)                        -> [{ id, title, created, updated }], newest first
//   create(owner)                      -> { id, title, messages, learning, created, updated }
//   read(owner, id)                    -> { id, title, messages, created, updated, learning }
//   erase(owner, id)                   deletes visible history, observations and checkpoints
//   acquire(owner, id)                 -> { row, save(messages, learning), release() }
//   setLearning(owner, id, learning)   -> learning
//   supportSummary(owner)              -> summary
//   supportSettings(owner, patch)      -> summary
//   feedback(owner, id, messageId, rating), voiceEvent(...), humanHelp(...) -> summary
//   close()
//
// `owner` is an opaque string chosen by api-routes: the hashed anonymous
// session cookie, or `account:<uuid>` for a signed-in account. Failures are
// ChatErrors (see chat-errors.mjs).
export function createChatStore(env = process.env) {
  const firestore = firestoreConfig(env);
  if (!firestore) return createChatMemory(env.CHAT_DATABASE_PATH);
  if (!firestore.projectId) throw storageError('STORAGE_NOT_CONFIGURED');
  return createFirestoreChatMemory({ firestore: createFirestoreClient(firestore) });
}

export function describeChatStorage(env = process.env) {
  const firestore = firestoreConfig(env);
  if (!firestore)
    return `SQLite file ${env.CHAT_DATABASE_PATH || '.cache/chat/conversations.sqlite'}`;
  if (!firestore.projectId)
    return 'not configured (FIRESTORE_DATABASE_ID is set without GOOGLE_CLOUD_PROJECT or FIRESTORE_PROJECT_ID)';
  return `Firestore database ${firestore.databaseId} in ${firestore.projectId}`;
}
