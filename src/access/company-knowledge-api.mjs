import { buildUploadRequest } from './company-knowledge-upload.mjs';

// Request adapter for the "Good guidance starts here" company knowledge library.
export const guestKnowledgeBase = '/api/guest-workspace';
export const hrKnowledgeBase = '/api/hr/company-knowledge';

// `request(url, { method, body, signal })` resolves with the parsed JSON body
// (or null for 204) and rejects with an Error whose message is shown to HR.
export function createKnowledgeApi(base, request) {
  const root = base.replace(/\/+$/, '');
  return {
    base: root,
    snapshot: (options = {}) => request(root, { method: 'GET', ...options }),
    upload: (file, { category, name }, signal) => {
      const { url, ...options } = buildUploadRequest(root, { category, name }, file);
      return request(url, { ...options, signal });
    },
    remove: (id) => request(root + '/documents/' + encodeURIComponent(id), { method: 'DELETE' }),
  };
}

// Plain same-origin JSON request for the guest workspace (cookie based).
export async function jsonRequest(url, { method = 'GET', body, signal } = {}) {
  const response = await fetch(url, {
    method,
    signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The workspace could not complete this request.');
  return data;
}
