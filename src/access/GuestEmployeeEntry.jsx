import React, { useEffect, useState } from 'react';
import { employeePath, workspaceRequest } from './guest-workspace-api';

export default function GuestEmployeeEntry({ navigate }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    workspaceRequest('', { signal: abort.signal })
      .then(async (workspace) => {
        if (abort.signal.aborted) return;
        const id =
          workspace.lastGuestId ||
          (await workspaceRequest('/guests', { method: 'POST', signal: abort.signal })).id;
        if (!abort.signal.aborted) navigate(employeePath(id));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => abort.abort();
  }, []);
  return (
    <main className="uv-empty">
      <h1>{error ? 'Your workspace is unavailable.' : 'Getting Alya ready…'}</h1>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
