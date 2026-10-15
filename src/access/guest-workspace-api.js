export const workspaceApi = '/api/guest-workspace';
export const employeePath = (id) => '/employee/' + id;

export async function workspaceRequest(path = '', options = {}) {
  const response = await fetch(workspaceApi + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The workspace could not complete this request.');
  return data;
}
