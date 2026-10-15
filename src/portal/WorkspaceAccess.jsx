import React, { useEffect, useRef, useState } from 'react';

export async function workspaceRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || 'The workspace request failed. Please try again.');
  return data;
}

export function AccessScreen({ onAccess, employees = [] }) {
  const [tab, setTab] = useState('employee'),
    [action, setAction] = useState('select');
  const [name, setName] = useState(''),
    [employeeId, setEmployeeId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function enter(role, kind) {
    setBusy(true);
    setError('');
    try {
      const access = await workspaceRequest('/api/access', {
        method: 'POST',
        body: JSON.stringify({ role, action: kind, name, employeeId }),
      });
      onAccess(access);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="oa-access">
      <div className="oa-access-intro">
        <span className="uv-eyebrow">OnboardAi</span>
        <h1>
          A clearer start.
          <br />
          Support at every step.
        </h1>
        <p>Company guidance, your next actions, and a conversation with Alya when you need help.</p>
      </div>
      <section className="oa-card">
        <h2>Open your workspace</h2>
        <p className="oa-notice">
          Guest / local preview. Employee IDs identify profiles within this browser preview. This is
          not employee authentication or verified HR access. No password is collected.
        </p>
        <div className="oa-switch" role="group" aria-label="Access choice">
          <button
            aria-pressed={tab === 'employee'}
            onClick={() => {
              setTab('employee');
              setError('');
            }}
          >
            Employee
          </button>
          <button
            aria-pressed={tab === 'hr'}
            onClick={() => {
              setTab('hr');
              setError('');
            }}
          >
            HR preview
          </button>
        </div>
        {error && (
          <p role="alert" className="oa-error">
            {error}
          </p>
        )}
        {tab === 'employee' ? (
          <>
            <div className="oa-switch" role="group" aria-label="Employee profile action">
              <button aria-pressed={action === 'select'} onClick={() => setAction('select')}>
                Employee access
              </button>
              <button aria-pressed={action === 'signup'} onClick={() => setAction('signup')}>
                Create employee profile
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                enter('employee', action);
              }}
            >
              {action === 'signup' && (
                <label>
                  Your name
                  <input
                    required
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label>
                Employee ID
                <input
                  required
                  maxLength={40}
                  pattern="[A-Za-z0-9_.\-]+"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  list="oa-employee-profiles"
                  autoComplete="off"
                />
              </label>
              <datalist id="oa-employee-profiles">
                {employees.map((e) => (
                  <option key={e.id} value={e.code}>
                    {e.name}
                  </option>
                ))}
              </datalist>
              <button className="uv-button primary" disabled={busy}>
                {action === 'signup' ? 'Create preview profile' : 'Open employee dashboard'}
              </button>
            </form>
            <button
              className="uv-button secondary"
              disabled={busy}
              onClick={() => enter('employee', 'guest')}
            >
              Continue as a new guest
            </button>
          </>
        ) : (
          <>
            <p>
              Manage guidance and review factual support summaries for this browser’s preview
              profiles. This choice does not verify that you are HR.
            </p>
            <button
              className="uv-button primary"
              disabled={busy}
              onClick={() => enter('hr', 'preview')}
            >
              Open HR preview
            </button>
          </>
        )}
      </section>
    </main>
  );
}

export function HrWorkspace({ onLeave }) {
  const uploadInput = useRef(null);
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState('');
  const [name, setName] = useState(''),
    [employeeId, setEmployeeId] = useState(''),
    [file, setFile] = useState(null),
    [pending, setPending] = useState('');
  async function refresh() {
    const result = await workspaceRequest('/api/hr/workspace');
    setData(result);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
      setPending('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file || !/\.(txt|md)$/i.test(file.name) || file.size > 100000)
      throw Error('Choose a UTF-8 .txt or .md file up to 100 KB.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw Error('Save the file as UTF-8 plain text before uploading.');
    }
    await workspaceRequest('/api/hr/documents', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, text }),
    });
    setFile(null);
    if (uploadInput.current) uploadInput.current.value = '';
  }
  const person = data?.employees.find((e) => e.id === selected),
    summary = person?.summary;
  return (
    <div className="oa-hr">
      <header className="oa-workspace-header">
        <div>
          <span className="uv-eyebrow">OnboardAi · HR preview</span>
          <h1>Guidance and employee support</h1>
        </div>
        <button className="uv-button secondary" onClick={onLeave}>
          Switch access
        </button>
      </header>
      <p className="oa-notice">
        Local preview only—not verified HR access. Profiles and uploads belong to this browser’s
        workspace. Employee IDs are labels, not passwords. Production use requires verified employee
        and HR authentication.
      </p>
      {error && (
        <p role="alert" className="oa-error">
          {error}
        </p>
      )}
      {!data ? (
        <button className="uv-button secondary" onClick={() => run(async () => {})} disabled={busy}>
          Load workspace
        </button>
      ) : (
        <>
          <section className="oa-metrics" aria-label="Recorded support totals">
            <p>
              <strong>{data.totals.employees}</strong>Employee profiles
            </p>
            <p>
              <strong>{data.totals.answers}</strong>Recorded answers
            </p>
            <p>
              <strong>{data.totals.humanHelpRequests}</strong>Human support requests
            </p>
          </section>
          <div className="oa-hr-grid">
            <section className="oa-card">
              <h2>Company guidance</h2>
              <p>
                Uploaded guidance is combined with connected Google Drive documents for employees in
                this preview. Use UTF-8 .txt or .md files, up to 100 KB each. Combined processing
                limit: 120,000 characters. PDF and Word uploads are not supported.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(upload);
                }}
              >
                <label>
                  Guidance file
                  <input
                    ref={uploadInput}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    onChange={(e) => setFile(e.target.files[0] || null)}
                  />
                </label>
                <button className="uv-button primary" disabled={busy || !file}>
                  Upload guidance
                </button>
              </form>
              <ul className="oa-items">
                {data.documents.map((d) => (
                  <li key={d.id}>
                    <span>
                      <strong>{d.name}</strong>
                      <small>{Math.ceil(d.bytes / 1000)} KB</small>
                    </span>
                    <button
                      className="uv-button secondary"
                      disabled={busy}
                      onClick={() =>
                        pending === d.id
                          ? run(() =>
                              workspaceRequest('/api/hr/documents/' + d.id, { method: 'DELETE' }),
                            )
                          : setPending(d.id)
                      }
                    >
                      {pending === d.id ? 'Confirm remove' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
              {!data.documents.length && (
                <p>
                  No uploaded guidance yet. Connected Drive guidance remains available when
                  configured.
                </p>
              )}
            </section>
            <section className="oa-card">
              <h2>Employee profiles</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await workspaceRequest('/api/hr/employees', {
                      method: 'POST',
                      body: JSON.stringify({ name, employeeId }),
                    });
                    setName('');
                    setEmployeeId('');
                  });
                }}
              >
                <label>
                  Name
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Employee ID
                  <input
                    required
                    maxLength={40}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                  />
                </label>
                <button className="uv-button primary" disabled={busy}>
                  Add preview employee
                </button>
              </form>
              <ul className="oa-items">
                {data.employees.map((e, i) => (
                  <li key={e.id}>
                    <button
                      className="oa-person"
                      aria-pressed={selected === e.id}
                      onClick={() => setSelected(e.id)}
                    >
                      <strong>
                        {i + 1}. {e.name}
                      </strong>
                      <small>
                        {e.code}
                        {e.guest ? ' · guest' : ''}
                      </small>
                    </button>
                    <button
                      className="uv-button secondary"
                      disabled={busy}
                      onClick={() =>
                        pending === e.id
                          ? run(() =>
                              workspaceRequest('/api/hr/employees/' + e.id, { method: 'DELETE' }),
                            )
                          : setPending(e.id)
                      }
                    >
                      {pending === e.id ? 'Confirm removal and erase chats' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
              <p>
                Removing a profile erases its chats and recorded support. Other employees’ histories
                are not reassigned.
              </p>
            </section>
          </div>
          <section className="oa-card oa-report">
            <div className="oa-workspace-header">
              <h2>{person ? person.name + ' · support summary' : 'Employee support summary'}</h2>
              <button
                className="uv-button secondary"
                disabled={busy}
                onClick={() => run(async () => {})}
              >
                Refresh recorded activity
              </button>
            </div>
            {!summary ? (
              <p>Choose an employee profile to review their recorded support.</p>
            ) : !summary.turns ? (
              <p>No recorded onboarding interactions yet. This employee’s report starts empty.</p>
            ) : (
              <>
                <p>{summary.overview.interaction}</p>
                <dl className="oa-report-counts">
                  <div>
                    <dt>Answers</dt>
                    <dd>{summary.turns}</dd>
                  </div>
                  <div>
                    <dt>Smaller steps requested</dt>
                    <dd>{summary.requests.steps}</dd>
                  </div>
                  <div>
                    <dt>Examples requested</dt>
                    <dd>{summary.requests.example}</dd>
                  </div>
                  <div>
                    <dt>Brief answers requested</dt>
                    <dd>{summary.requests.brief}</dd>
                  </div>
                  <div>
                    <dt>Helpful feedback</dt>
                    <dd>{summary.feedback.helpful}</dd>
                  </div>
                  <div>
                    <dt>Still unclear feedback</dt>
                    <dd>{summary.feedback.unclear}</dd>
                  </div>
                  <div>
                    <dt>Human support requests</dt>
                    <dd>{summary.humanHelpRequests}</dd>
                  </div>
                </dl>
                <h3>Suggested check-in</h3>
                <p>{summary.overview.followUp}</p>
                <ul>
                  {summary.overview.recommendations.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p>{summary.overview.basis}</p>
              </>
            )}
            <p className="oa-notice">
              These are explicit requests and feedback, not measures of understanding, ability,
              performance or task completion. Reports contain no transcripts or diagnoses. Recorded
              activity follows the existing 30-day conversation retention.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
