import { buildUploadRequest } from './company-knowledge-upload.mjs';

// Request adapter for the HR Company Documentation page.
export const hrKnowledgeBase = '/api/hr/company-knowledge';

// `request(url, { method, body, signal })` resolves with the parsed JSON body
// (or null for 204) and rejects with an Error whose message is shown to HR.
export function createKnowledgeApi(base, request) {
  const root = base.replace(/\/+$/, '');
  const documentUrl = (id) => root + '/documents/' + encodeURIComponent(id);
  return {
    base: root,
    // GET: { topics, documents, limits }
    snapshot: (options = {}) => request(root, { method: 'GET', ...options }),
    // POST: 201 { id, duplicate: false, replaced } or 200 { id, duplicate: true, replaced: null }
    // `replaces` is a current document id: the file becomes its next version.
    upload: (file, { category, name, replaces }, signal) => {
      const { url, ...options } = buildUploadRequest(root, { category, name, replaces }, file);
      return request(url, { ...options, signal });
    },
    // PATCH { category } -> { document }
    moveDocument: (id, category) =>
      request(documentUrl(id), { method: 'PATCH', body: { category } }),
    remove: (id) => request(documentUrl(id), { method: 'DELETE' }),
  };
}
