import { ChatError } from './chat-errors.mjs';

const unavailable = () =>
  new ChatError(
    503,
    'SUBMISSION_STORAGE_UNAVAILABLE',
    'Document storage is unavailable. Please try again or contact HR.',
  );
// Separate private bucket; never connect employee files to Vertex AI Search.
export function createSubmissionFiles({ env, fetchImpl = fetch, getAccessToken }) {
  const bucket = env.EMPLOYEE_DOCUMENTS_BUCKET?.trim();
  if (!bucket || bucket === env.DOCS_BUCKET?.trim()) return null;
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/`;
  const name = (id) => `employee-submissions/${id}`;
  async function request(url, options = {}) {
    try {
      const token = await getAccessToken();
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(20000),
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
      if (!response.ok && !(options.method === 'DELETE' && response.status === 404))
        throw unavailable();
      return response;
    } catch {
      throw unavailable();
    }
  }
  return {
    temporary: false,
    async put(id, content, mime) {
      await request(
        `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(name(id))}`,
        { method: 'POST', headers: { 'Content-Type': mime }, body: content },
      );
    },
    async get(id) {
      return Buffer.from(
        await (await request(base + encodeURIComponent(name(id)) + '?alt=media')).arrayBuffer(),
      );
    },
    async remove(id) {
      await request(base + encodeURIComponent(name(id)), { method: 'DELETE' });
    },
  };
}

// Only explicitly injected by the local preview/test harness.
export function createMemorySubmissionFiles() {
  const files = new Map();
  return {
    temporary: true,
    async put(id, bytes) {
      files.set(id, Buffer.from(bytes));
    },
    async get(id) {
      if (!files.has(id)) throw unavailable();
      return Buffer.from(files.get(id));
    },
    async remove(id) {
      files.delete(id);
    },
  };
}
