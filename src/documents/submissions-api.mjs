import { accountRequest } from '../access/account-api.mjs';
const base = (hr) => `/api/${hr ? 'hr' : 'me'}/document-submissions`;
export const submissionsApi = {
  list: (hr) => accountRequest(base(hr)),
  detail: (hr, id) => accountRequest(`${base(hr)}/${encodeURIComponent(id)}`),
  submit: ({ type, title, resubmissionOf, stepId }, file) =>
    accountRequest(
      `${base(false)}?${new URLSearchParams({ type, title, ...(stepId ? { stepId } : {}), ...(resubmissionOf ? { resubmissionOf } : {}) })}`,
      {
        method: 'POST',
        rawBody: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
      },
    ),
  review: (id, body) =>
    accountRequest(`${base(true)}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  async file(hr, id) {
    const response = await fetch(`${base(hr)}/${encodeURIComponent(id)}/file`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to download this document.');
    }
    return response.blob();
  },
};
