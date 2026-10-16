import { readDriveKnowledge, readGoogleDocument, driveFailure } from './google-drive-documents.mjs';

// Company Drive guidance is the existing shared company source. Website uploads
// remain scoped to the browser workspace that owns them. No chat/report data is merged.
export function createWorkspaceKnowledge({
  folderId,
  loadDrive = readDriveKnowledge,
  readLinked = readGoogleDocument,
  uploaded,
}) {
  let cachedStatus,
    checkedAt = 0,
    checking;
  async function load(owner) {
    const drive = folderId ? await loadDrive(folderId) : [];
    const sharedIds = new Set(drive.map((document) => document.googleDocId).filter(Boolean));
    const documents = await Promise.all(
      uploaded(owner).map(async (document) => {
        if (document.googleDocId && sharedIds.has(document.googleDocId)) return null;
        if (!document.googleDocId) return document;
        // Always check current content and access; a failed read never uses saved policy text.
        const current = await readLinked(document.googleDocId);
        return { title: document.title, text: current.text };
      }),
    );
    return [...drive, ...documents.filter(Boolean)];
  }
  async function status() {
    if (!folderId) return { state: 'not-configured', documents: [] };
    if (cachedStatus && Date.now() - checkedAt < 30000) return cachedStatus;
    if (!checking)
      checking = (async () => {
        try {
          const files = await loadDrive(folderId);
          cachedStatus = {
            state: 'connected',
            documents: files.map((file) => ({
              title: file.title,
              googleDocId: file.googleDocId,
              category: file.category,
              characters: file.text.length,
            })),
          };
        } catch (error) {
          cachedStatus = { state: 'unavailable', documents: [], ...driveFailure(error) };
        }
        return cachedStatus;
      })().finally(() => {
        checkedAt = Date.now();
        checking = null;
      });
    return checking;
  }
  return {
    load,
    status,
    invalidate: () => {
      cachedStatus = null;
      checkedAt = 0;
    },
  };
}
