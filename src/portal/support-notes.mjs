// "Put it into words": private notes a signed-in employee drafts on the People &
// support page. They live only in this browser's localStorage, under the
// account's id, and are never sent to the server. Sharing a struggle with HR is
// a separate, explicit step (Ask HR in the chat). The old shared "portal"
// record, which also held a local profile and checklist, is erased.

export const legacyKey = 'univrse-onboardai-portal-v1';
export const notesKey = (accountId) => 'onboardai-support-notes-v2-' + accountId;
export const maxNotes = 10;

export function readNotes(storage, accountId, teamIds) {
  if (!accountId) return [];
  try {
    storage.removeItem(legacyKey);
  } catch {}
  try {
    const value = JSON.parse(storage.getItem(notesKey(accountId)));
    return Array.isArray(value)
      ? value
          .filter(
            (note) =>
              typeof note?.id === 'string' &&
              typeof note?.text === 'string' &&
              teamIds.includes(note.team),
          )
          .slice(0, maxNotes)
      : [];
  } catch {
    return [];
  }
}

// -> true when saved.
export function writeNotes(storage, accountId, notes) {
  if (!accountId) return false;
  try {
    storage.setItem(notesKey(accountId), JSON.stringify(notes.slice(0, maxNotes)));
    return true;
  } catch {
    return false;
  }
}
