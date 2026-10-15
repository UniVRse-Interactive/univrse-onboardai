import { readDriveKnowledge, driveFailure } from './google-drive-documents.mjs';

// Company Drive guidance is the existing shared company source. Website uploads
// remain scoped to the browser workspace that owns them. No chat/report data is merged.
export function createWorkspaceKnowledge({ folderId, loadDrive = readDriveKnowledge, uploaded }) {
  let cachedStatus,
    checkedAt = 0,
    checking;
  async function load(owner) {
    const drive = folderId ? await loadDrive(folderId) : [];
    return [...drive, ...uploaded(owner)];
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
            documents: files.map((file) => ({ title: file.title, characters: file.text.length })),
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
  return { load, status };
}
