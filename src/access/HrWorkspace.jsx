import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { AccessBrand } from './LoginPage';
import { learningFormats } from '../avatar/AnswerStyleSettings';
import { reportDate, reportText } from '../avatar/hr-support-report.mjs';
import { onboardingSnapshot, checkInStatus } from './hr-report-insights.mjs';
import { workspaceRequest } from './guest-workspace-api';
import CompanyDocumentLibrary from './CompanyDocumentLibrary';
import HrEmployees from './HrEmployees';
import './account-access.css';
import './hr-onboarding-summary.css';
import './hr-workspace.css';
import './accounts.css';

function EmployeeSummary({ employee }) {
  const s = employee.summary;
  function download() {
    const text = reportText({ summary: s, createdAt: Date.now() }, employee.name);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'onboardai-' + employee.name.toLowerCase().replaceAll(' ', '-') + '.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="hr-individual-summary" aria-labelledby="hr-individual-heading">
      <header>
        <div>
          <span className="access-eyebrow">EMPLOYEE ONBOARDING EXPERIENCE</span>
          <h2 id="hr-individual-heading">{employee.name}</h2>
          <p>
            {checkInStatus(s)} · {s.conversations} saved{' '}
            {s.conversations === 1 ? 'conversation' : 'conversations'}
          </p>
        </div>
        <button
          className="hr-icon-action"
          aria-label={'Download summary for ' + employee.name}
          disabled={!s.turns}
          onClick={download}
        >
          <Icon name="download" size={21} />
        </button>
      </header>
      {s.turns ? (
        <>
          <div className="hr-interaction-description">
            <Icon name="chat" size={23} />
            <div>
              <h3>Automatic onboarding summary</h3>
              <p>{s.overview.interaction}</p>
            </div>
          </div>
          <dl className="hr-individual-stats">
            {[
              ['Answers recorded', s.turns],
              ['Helpful answers', s.feedback.helpful],
              ['Still unclear', s.feedback.unclear],
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <div className="hr-next-check-in">
            <Icon name={s.humanHelpRequests ? 'people' : 'chat'} size={22} />
            <div>
              <span className="access-eyebrow">RECOMMENDED CHECK-IN</span>
              <p>{s.overview.followUp}</p>
              {s.humanHelpRequests > 0 && (
                <strong>
                  {s.humanHelpRequests} human support{' '}
                  {s.humanHelpRequests === 1 ? 'request' : 'requests'} recorded
                </strong>
              )}
            </div>
          </div>
          <section className="hr-suggested-support">
            <span className="access-eyebrow">PRACTICAL SUPPORT TO OFFER</span>
            <ul>
              {s.overview.recommendations.map((item) => (
                <li key={item}>
                  <Icon name="check" size={17} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <small>
              {s.overview.basis}{' '}
              {s.overview.limited
                ? 'Early activity: confirm preferences before making a support plan.'
                : 'Confirm the proposed support with the employee.'}
            </small>
          </section>
        </>
      ) : (
        <div className="hr-report-empty">
          <Icon name="chat" size={30} />
          <h3>A real conversation comes first.</h3>
          <p>
            This summary updates automatically from the employee’s questions, support requests and
            feedback. No answered questions have been recorded for this employee yet.
          </p>
        </div>
      )}
      <details className="hr-summary-evidence">
        <summary>
          Supporting statistics
          <Icon name="down" size={17} />
        </summary>
        <div className="hr-evidence-columns">
          <section>
            <h3>Answer formats delivered</h3>
            {Object.entries(s.formats).map(([format, count]) => (
              <div className="hr-format-count" key={format}>
                <span>{learningFormats[format]}</span>
                <meter
                  min={0}
                  max={s.turns || 1}
                  value={count}
                  aria-label={learningFormats[format] + ' answers'}
                />
                <strong>{count}</strong>
              </div>
            ))}
            <small>
              Formats delivered include Alya’s automatic choices. They are not a measure of the
              employee’s ability or confirmed preferences.
            </small>
          </section>
          <section>
            <h3>Explicit support requests</h3>
            <dl>
              {[
                ['Smaller steps', s.requests.steps],
                ['Worked examples', s.requests.example],
                ['Brief explanations', s.requests.brief],
                ['Human help', s.humanHelpRequests],
                ['Visual guides provided', s.cards],
              ].map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </details>
      <footer>
        <span>Latest activity: {reportDate(s.period.to)}</span>
        <p>
          This summary describes support use, not a diagnosis, ability assessment or performance
          score. Task completion is not verified.
        </p>
      </footer>
    </section>
  );
}

export default function HrWorkspace({ navigate, account = null, onSignOut, accounts = false }) {
  const hrAccount = account?.role === 'hr' ? account : null;
  const [workspace, setWorkspace] = useState(null),
    [employeeId, setEmployeeId] = useState(''),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [removing, setRemoving] = useState(''),
    [notice, setNotice] = useState(''),
    [refreshing, setRefreshing] = useState(false),
    [updated, setUpdated] = useState(null);
  const abortRef = useRef(null),
    sequence = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    const token = ++sequence.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    if (!quiet) setRefreshing(true);
    try {
      const value = await workspaceRequest('', { signal: abort.signal });
      if (token !== sequence.current) return;
      setWorkspace(value);
      setEmployeeId((id) => (value.guests.some((g) => g.id === id) ? id : value.lastGuestId));
      setError('');
      setUpdated(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError' && token === sequence.current) setError(err.message);
    } finally {
      if (token === sequence.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    const timer = setInterval(visible, 10000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      abortRef.current?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  async function newGuest() {
    setAdding(true);
    setError('');
    try {
      const guest = await workspaceRequest('/guests', { method: 'POST' });
      setEmployeeId(guest.id);
      await refresh(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }
  async function removeEmployee(person) {
    if (
      !window.confirm(
        `Remove ${person.name}’s record?\n\nThis permanently deletes their saved conversations, feedback and onboarding support summary in this browser’s workspace. Company documents and other employee records will be kept. This cannot be undone.`,
      )
    )
      return;
    setRemoving(person.id);
    setError('');
    try {
      await workspaceRequest('/guests/' + person.id, { method: 'DELETE' });
      setNotice(person.name + '’s record was removed.');
      await refresh(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving('');
    }
  }
  const employee = workspace?.guests.find((g) => g.id === employeeId) || workspace?.guests[0],
    totals = workspace ? onboardingSnapshot(workspace.guests) : null;
  return (
    <div className="hr-preview-page">
      <header className="hr-preview-header">
        <AccessBrand />
        <div>
          <span className="hr-preview-badge">HR workspace</span>
        </div>
        <nav className="hr-section-nav" aria-label="HR workspace sections">
          {hrAccount && <a href="#employee-accounts">Employee accounts</a>}
          <a href="#employee-summaries">Employee summaries</a>
          <a href="#company-documents">Company documents</a>
        </nav>
        {hrAccount ? (
          <div className="account-session">
            <span className="account-signed-in">
              Signed in as <strong>{hrAccount.username}</strong>
            </span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => navigate('/login')}>
            Back to sign in <Icon name="arrow" size={16} />
          </button>
        )}
      </header>
      <main className="hr-experience-main">
        <div className="hr-experience-heading">
          <div>
            <span className="access-eyebrow">PEOPLE FIRST. SUPPORT THAT FITS.</span>
            <h1>People & onboarding.</h1>
            <p>Understand how employees use Alya and the support they ask for.</p>
          </div>
        </div>
        {error && (
          <div className="hr-workspace-error" role="alert">
            {error}
            <button onClick={() => refresh()}>Try again</button>
          </div>
        )}
        {hrAccount && <HrEmployees />}
        <p role="status" className="hr-removal-notice">
          {notice}
        </p>
        {!workspace ? (
          <p role="status">Loading your workspace…</p>
        ) : (
          <>
            <section
              className="hr-company-overview"
              id="employee-summaries"
              aria-labelledby="hr-company-heading"
            >
              <div className="hr-company-heading">
                <span className="hr-overview-icon">
                  <Icon name="people" size={22} />
                </span>
                <div>
                  <span className="access-eyebrow">01 / ONBOARDING EXPERIENCE</span>
                  <h2 id="hr-company-heading">Your people, their support.</h2>
                </div>
                <button className="hr-refresh" disabled={refreshing} onClick={() => refresh()}>
                  <Icon name="clock" size={15} />
                  {refreshing ? 'Refreshing…' : 'Refresh reports'}
                </button>
              </div>
              <dl className="hr-company-stats">
                {[
                  ['Employees', totals.employees],
                  ['Answers recorded', totals.answers],
                  ['Support requests', totals.requests],
                ].map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              <p className="hr-company-description">
                {totals.answers
                  ? `${totals.helpful} ${totals.helpful === 1 ? 'answer' : 'answers'} marked helpful · ${totals.unclear} still unclear · ${totals.human} human support ${totals.human === 1 ? 'request' : 'requests'}. Select an employee to review their automatically updated support summary.`
                  : 'Each employee’s report updates automatically as they ask Alya questions and use support.'}
              </p>
              <small className="hr-refreshed-at">
                Updated {reportDate(updated)} · Refreshes while this page is open
              </small>
            </section>
            <div className="hr-summary-workspace">
              <aside className="hr-employee-list" aria-label="Employee summary selection">
                <div>
                  <span className="access-eyebrow">INDIVIDUAL SUPPORT</span>
                  <h2>
                    Employee summaries <span>{workspace.guests.length}</span>
                  </h2>
                </div>
                {workspace.guests.map((person, index) => (
                  <div className="hr-employee-row" key={person.id}>
                    <button
                      key={person.id}
                      aria-pressed={employee?.id === person.id}
                      onClick={() => setEmployeeId(person.id)}
                    >
                      <span className="hr-employee-initial">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>
                          {person.summary.turns} {person.summary.turns === 1 ? 'answer' : 'answers'}{' '}
                          · {checkInStatus(person.summary)}
                        </small>
                      </span>
                      <Icon name="chevron" size={17} />
                    </button>
                    <details className="hr-employee-menu">
                      <summary aria-label={'Actions for ' + person.name}>⋯</summary>
                      <button
                        type="button"
                        disabled={!!removing}
                        onClick={(event) => {
                          event.currentTarget.closest('details').open = false;
                          removeEmployee(person);
                        }}
                      >
                        {removing === person.id ? 'Removing…' : 'Remove employee record'}
                      </button>
                    </details>
                  </div>
                ))}
                {!workspace.guests.length && <p>No employee records. Add an employee to begin.</p>}
                <button
                  className="hr-add-guest"
                  disabled={
                    adding || !!removing || workspace.guests.length >= workspace.limits.guests
                  }
                  onClick={newGuest}
                >
                  <Icon name="user" size={17} />
                  {adding ? 'Creating…' : 'Add employee'}
                </button>
                <p>
                  Each employee has their own conversation history and automatic support summary.
                </p>
              </aside>
              {employee && <EmployeeSummary key={employee.id} employee={employee} />}
            </div>
            <CompanyDocumentLibrary workspace={workspace} onRefresh={() => refresh(true)} />
            <p className="hr-access-note">
              Temporary access · This browser’s employee records are retained for 24 hours after the
              last activity.{accounts ? '' : ' Account access is not connected yet.'}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
