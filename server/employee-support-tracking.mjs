import { supportRequest, teachingFormats } from './answer-style-preferences.mjs';
import {
  answerNotFound,
  busyMessages,
  chatBusy,
  feedbackInvalid,
  supportSettingsInvalid,
} from './chat-errors.mjs';

const emptyFormats = () => ({ standard: 0, steps: 0, example: 0, brief: 0 });
export function employeeOverview({ turns, conversations, requests, feedback, humanHelpRequests }) {
  const requested = Object.entries(requests)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const label = {
        steps: 'smaller steps',
        example: 'worked examples',
        brief: 'shorter explanations',
      }[key];
      return `${label} (${count} ${count === 1 ? 'request' : 'requests'})`;
    });
  let interaction = !turns
    ? 'The employee’s onboarding summary will take shape as they use Alya.'
    : requested.length
      ? `The employee requested ${requested.join(' and ')}.`
      : 'The employee has used Alya for onboarding guidance without requesting a different explanation so far.';
  if (feedback.helpful)
    interaction += ` They marked ${feedback.helpful} ${feedback.helpful === 1 ? 'answer' : 'answers'} helpful.`;
  if (feedback.unclear)
    interaction += ` They marked ${feedback.unclear} ${feedback.unclear === 1 ? 'answer' : 'answers'} still unclear.`;
  if (!feedback.helpful && !feedback.unclear && turns)
    interaction += ' Their feedback on the explanations is still to be confirmed.';
  if (turns && conversations)
    interaction =
      `Across ${turns} answered ${turns === 1 ? 'question' : 'questions'} in ${conversations} ${conversations === 1 ? 'conversation' : 'conversations'}, ` +
      interaction[0].toLowerCase() +
      interaction.slice(1);
  const recommendations = [];
  if (requests.steps)
    recommendations.push('Offer one manageable action at a time, with clear numbered steps.');
  if (requests.example)
    recommendations.push('Include a practical example when introducing an unfamiliar task.');
  if (requests.brief)
    recommendations.push(
      'Keep the first explanation short, with more detail available when requested.',
    );
  if (!recommendations.length)
    recommendations.push(
      'Start with clear, concise instructions and let the employee choose more detail or an example.',
    );
  const followUp = humanHelpRequests
    ? 'The employee requested human support. Arrange a private check-in to discuss the task and the help they want.'
    : feedback.unclear
      ? 'Check which part of the task is unclear and offer another explanation or a buddy.'
      : 'Ask whether the explanation format is useful and confirm the employee’s preferred support for their next task.';
  return {
    interaction,
    recommendations,
    followUp,
    basis: `Based on ${turns} recorded ${turns === 1 ? 'answer' : 'answers'} and the employee’s explicit requests and feedback.`,
    limited: turns < 3,
  };
}
export function turnObservation(question, result) {
  return {
    format: teachingFormats.slice(1).includes(result.learning?.format)
      ? result.learning.format
      : 'standard',
    request: supportRequest(question)?.format || null,
    card: !!result.card,
  };
}

export function summariseSupport(events, { recording = true, version = 0, updatedAt = null } = {}) {
  const formats = emptyFormats(),
    requests = { steps: 0, example: 0, brief: 0 },
    feedback = { helpful: 0, unclear: 0 };
  let turns = 0,
    cards = 0,
    voiceStarts = 0,
    humanHelpRequests = 0;
  const conversations = new Set();
  for (const event of events) {
    const data = event.data;
    if (event.kind === 'turn') {
      turns++;
      conversations.add(event.conversationId);
      formats[data.format]++;
      if (data.request in requests) requests[data.request]++;
      if (data.card) cards++;
    }
    if (event.kind === 'feedback' && data.rating in feedback) feedback[data.rating]++;
    if (event.kind === 'voice') voiceStarts++;
    if (event.kind === 'help') humanHelpRequests++;
  }
  const first = events.length ? Math.min(...events.map((e) => e.updated)) : null;
  const last = events.length ? Math.max(...events.map((e) => e.updated)) : null;
  const ranked = Object.entries(formats).sort((a, b) => b[1] - a[1]);
  const mostUsed = turns >= 3 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
  const overview = employeeOverview({
    turns,
    conversations: conversations.size,
    requests,
    feedback,
    humanHelpRequests,
  });
  return {
    recording,
    version,
    updatedAt: updatedAt || last,
    period: { from: first, to: last },
    turns,
    conversations: conversations.size,
    formats,
    requests,
    feedback,
    cards,
    voiceStarts,
    humanHelpRequests,
    mostUsed,
    overview,
    description: overview.interaction,
    scope: 'This browser’s saved conversations',
    note: 'Observed use of Alya, not a diagnosis, ability assessment or performance score. Individual reports are reviewed before export.',
  };
}

// The only accepted settings change: { recording: true | false }.
export const isSupportSettings = (patch) =>
  Boolean(patch) &&
  typeof patch === 'object' &&
  !Array.isArray(patch) &&
  Object.keys(patch).length === 1 &&
  typeof patch.recording === 'boolean';
export const feedbackRatings = ['helpful', 'unclear', null];

// SQLite support observations, written inside the conversation store's transactions.
export function createSupportStore(db, { owned, isBusy, retention }) {
  db.exec(`CREATE TABLE IF NOT EXISTS support_preferences (
    owner TEXT PRIMARY KEY, recording INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS support_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL,
    UNIQUE(conversation_id,message_id,kind)
  ); CREATE INDEX IF NOT EXISTS support_owner ON support_events(owner,updated);`);
  function preference(owner) {
    db.prepare('INSERT OR IGNORE INTO support_preferences(owner,updated) VALUES(?,?)').run(
      owner,
      Date.now(),
    );
    return db.prepare('SELECT * FROM support_preferences WHERE owner=?').get(owner);
  }
  function bump(owner) {
    preference(owner);
    db.prepare('UPDATE support_preferences SET revision=revision+1,updated=? WHERE owner=?').run(
      Date.now(),
      owner,
    );
  }
  function put(owner, id, messageId, kind, data) {
    if (!preference(owner).recording) return;
    const exists = db
      .prepare(
        'SELECT data FROM support_events WHERE conversation_id=? AND message_id=? AND kind=? AND owner=?',
      )
      .get(id, messageId, kind, owner);
    const json = JSON.stringify(data);
    if (exists?.data === json) return;
    db.prepare(
      'INSERT INTO support_events(owner,conversation_id,message_id,kind,data,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(conversation_id,message_id,kind) DO UPDATE SET data=excluded.data,updated=excluded.updated',
    ).run(owner, id, messageId, kind, json, Date.now());
    bump(owner);
  }
  function summary(owner) {
    const pref = preference(owner);
    const rows = db
      .prepare(
        'SELECT e.* FROM support_events e JOIN conversations c ON c.id=e.conversation_id WHERE e.owner=? AND c.owner=? AND c.updated>=? ORDER BY e.id',
      )
      .all(owner, owner, Date.now() - retention);
    return summariseSupport(
      rows.map((e) => ({
        conversationId: e.conversation_id,
        kind: e.kind,
        data: JSON.parse(e.data),
        updated: e.updated,
      })),
      { recording: !!pref.recording, version: pref.revision, updatedAt: pref.updated },
    );
  }
  function settings(owner, patch) {
    if (!isSupportSettings(patch)) throw supportSettingsInvalid();
    preference(owner);
    db.prepare(
      'UPDATE support_preferences SET recording=?,revision=revision+1,updated=? WHERE owner=?',
    ).run(Number(patch.recording), Date.now(), owner);
    return summary(owner);
  }
  function message(owner, id, messageId) {
    const raw = owned(owner, id);
    if (isBusy(id)) throw chatBusy(busyMessages.feedback);
    const messages = JSON.parse(raw.messages);
    const found = messages.find((m) => m.id === messageId && m.role === 'assistant');
    if (!found) throw answerNotFound();
    return { messages, found };
  }
  const feedback = db.transaction((owner, id, messageId, rating) => {
    if (!feedbackRatings.includes(rating)) throw feedbackInvalid();
    const { messages, found } = message(owner, id, messageId);
    found.feedback = rating;
    db.prepare('UPDATE conversations SET messages=?,updated=? WHERE owner=? AND id=?').run(
      JSON.stringify(messages),
      Date.now(),
      owner,
      id,
    );
    if (rating) put(owner, id, messageId, 'feedback', { rating });
    else if (
      db
        .prepare(
          "DELETE FROM support_events WHERE owner=? AND conversation_id=? AND message_id=? AND kind='feedback'",
        )
        .run(owner, id, messageId).changes
    )
      bump(owner);
    return summary(owner);
  });
  const voice = db.transaction((owner, id, messageId) => {
    message(owner, id, messageId);
    put(owner, id, messageId, 'voice', {});
    return summary(owner);
  });
  const humanHelp = db.transaction((owner, id, messageId) => {
    const { messages, found } = message(owner, id, messageId);
    found.humanHelpRequested = true;
    db.prepare('UPDATE conversations SET messages=?,updated=? WHERE owner=? AND id=?').run(
      JSON.stringify(messages),
      Date.now(),
      owner,
      id,
    );
    put(owner, id, messageId, 'help', {});
    return summary(owner);
  });
  function remove(id) {
    const owner = db.prepare('SELECT owner FROM conversations WHERE id=?').get(id)?.owner;
    if (db.prepare('DELETE FROM support_events WHERE conversation_id=?').run(id).changes && owner)
      bump(owner);
  }
  return {
    summary,
    settings,
    feedback,
    voice,
    humanHelp,
    remove,
    turn: (owner, id, messageId, question, result) =>
      put(owner, id, messageId, 'turn', turnObservation(question, result)),
  };
}
