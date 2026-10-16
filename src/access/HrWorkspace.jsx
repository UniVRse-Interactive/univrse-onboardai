import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { AccessBrand } from './LoginPage';
import { learningFormats } from '../avatar/AnswerStyleSettings';
import { reportDate, reportText } from '../avatar/hr-support-report.mjs';
import { onboardingSnapshot, checkInStatus } from './hr-report-insights.mjs';
import { workspaceRequest } from './guest-workspace-api';
import GoogleDocsLibrary from './GoogleDocsLibrary';
import HrDashboard from './HrDashboard';
import './account-access.css';
import './hr-onboarding-summary.css';
import './hr-workspace.css';
import './hr-screen.css';

const employeePageSize = 2;

function EmployeeSummary({ employee, initialView = 'overview' }) {
  const [view, setView] = useState(initialView);
  const [supportPage, setSupportPage] = useState(0);
  const s = employee.summary;
  const recommendations = s.overview.recommendations;
  const lastPage = Math.max(0, Math.ceil(recommendations.length / 2) - 1);
  const page = Math.min(supportPage, lastPage);
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
      <header className="hr-report-heading">
        <div>
          <span className="hr-kicker">EMPLOYEE ONBOARDING EXPERIENCE</span>
          <h2 id="hr-individual-heading">{employee.name}</h2>
          <p>
            {checkInStatus(s)} <span aria-hidden="true">·</span> {s.conversations} saved{' '}
            {s.conversations === 1 ? 'conversation' : 'conversations'}
          </p>
        </div>
        <button
          className="hr-screen-button hr-download-report"
          aria-label={'Download summary for ' + employee.name}
          disabled={!s.turns}
          onClick={download}
        >
          <Icon name="download" size={17} />
          <span>Download report</span>
        </button>
      </header>
      <nav className="hr-report-tabs" aria-label="Employee report sections">
        <button
          type="button"
          aria-pressed={view === 'overview'}
          onClick={() => setView('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          aria-pressed={view === 'evidence'}
          onClick={() => setView('evidence')}
        >
          Statistics
        </button>
        <button type="button" aria-pressed={view === 'support'} onClick={() => setView('support')}>
          Practical support
        </button>
      </nav>
      {view === 'support' ? (
        <div className="hr-report-content">
          <div>
            <span className="hr-kicker">A USEFUL NEXT STEP</span>
            <h3>Support you can offer</h3>
          </div>
          <div className="hr-report-support-grid">
            <section className="hr-report-check-in">
              <span className="hr-kicker">
                <Icon name={s.humanHelpRequests ? 'people' : 'chat'} size={16} /> NEXT CHECK-IN
              </span>
              <p>{s.overview.followUp}</p>
              {s.humanHelpRequests > 0 && (
                <strong>
                  {s.humanHelpRequests} human support{' '}
                  {s.humanHelpRequests === 1 ? 'request' : 'requests'}
                </strong>
              )}
            </section>
            <section className="hr-report-suggestions">
              <span className="hr-kicker">PRACTICAL SUPPORT TO OFFER</span>
              <ul>
                {recommendations.slice(page * 2, page * 2 + 2).map((item) => (
                  <li key={item}>
                    <Icon name="check" size={16} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {lastPage > 0 && (
                <div className="hr-report-pager">
                  <button
                    type="button"
                    disabled={!page}
                    onClick={() => setSupportPage(page - 1)}
                    aria-label="Previous support suggestions"
                  >
                    ←
                  </button>
                  <span>
                    {page + 1} / {lastPage + 1}
                  </span>
                  <button
                    type="button"
                    disabled={page === lastPage}
                    onClick={() => setSupportPage(page + 1)}
                    aria-label="Next support suggestions"
                  >
                    →
                  </button>
                </div>
              )}
            </section>
          </div>
          <p className="hr-report-basis">{s.overview.basis}</p>
        </div>
      ) : view === 'evidence' ? (
        <div className="hr-report-content hr-report-evidence">
          <div className="hr-evidence-columns">
            <section>
              <span className="hr-kicker">ANSWER FORMATS</span>
              <h3>How guidance was presented</h3>
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
              <p className="hr-report-small">
                Includes Alya’s automatic choices. Confirm any preferences with the employee.
              </p>
            </section>
            <section>
              <span className="hr-kicker">REQUESTS & FEEDBACK</span>
              <h3>What the employee requested</h3>
              <dl className="hr-request-breakdown">
                {[
                  ['Smaller steps', s.requests.steps],
                  ['Worked examples', s.requests.example],
                  ['Brief explanations', s.requests.brief],
                  ['Human help', s.humanHelpRequests],
                  ['Helpful answers', s.feedback.helpful],
                  ['Still unclear', s.feedback.unclear],
                ].map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      ) : s.turns ? (
        <div className="hr-report-content">
          <div className="hr-report-story">
            <span className="hr-story-icon">
              <Icon name="chat" size={20} />
            </span>
            <div>
              <h3>Onboarding so far</h3>
              <p>{s.overview.interaction}</p>
            </div>
          </div>
          <dl className="hr-report-metrics">
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
        </div>
      ) : (
        <div className="hr-report-empty">
          <span className="hr-empty-mark">
            <Icon name="chat" size={34} />
          </span>
          <span className="hr-kicker">READY WHEN THEY ARE</span>
          <h3>A conversation starts the picture.</h3>
          <p>
            As this employee asks Alya questions and requests support, their summary will appear
            here automatically.
          </p>
          <div className="hr-empty-flow">
            <span>Ask Alya</span>
            <Icon name="arrow" size={16} />
            <span>Use support</span>
            <Icon name="arrow" size={16} />
            <span>Review here</span>
          </div>
        </div>
      )}
      <footer className="hr-report-footnote">
        <span>Latest activity: {reportDate(s.period.to)}</span>
        <p>
          Describes recorded support use. Confirm needs with the employee; this is not a diagnosis
          or performance assessment.
        </p>
      </footer>
    </section>
  );
}

export default function HrWorkspace({ navigate }) {
  const [workspace, setWorkspace] = useState(null);
  const [view, setView] = useState('dashboard');
  const [reportView, setReportView] = useState('overview');
  const [employeeId, setEmployeeId] = useState('');
  const [employeePage, setEmployeePage] = useState(0);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(null);
  const abortRef = useRef(null);
  const sequence = useRef(0);
  const headingRef = useRef(null);
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
      setEmployeeId((id) =>
        value.guests.some((guest) => guest.id === id) ? id : value.lastGuestId,
      );
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
  async function newEmployee() {
    setAdding(true);
    setError('');
    try {
      const employee = await workspaceRequest('/guests', { method: 'POST' });
      setEmployeeId(employee.id);
      setEmployeePage(Math.floor((workspace?.guests.length || 0) / employeePageSize));
      await refresh(true);
      setView('reports');
      setReportView('overview');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }
  async function removeEmployee(person) {
    if (
      !window.confirm(
        'Remove ' +
          person.name +
          '’s record?\n\nThis permanently deletes their saved conversations, feedback and onboarding support summary in this browser’s workspace. Company documents and other employee records will be kept. This cannot be undone.',
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
  const employee =
    workspace?.guests.find((person) => person.id === employeeId) || workspace?.guests[0];
  const totals = workspace ? onboardingSnapshot(workspace.guests) : null;
  const lastEmployeePage = Math.max(
    0,
    Math.ceil((workspace?.guests.length || 0) / employeePageSize) - 1,
  );
  const currentEmployeePage = Math.min(employeePage, lastEmployeePage);
  function changeEmployeePage(page) {
    setEmployeePage(page);
    setEmployeeId(workspace.guests[page * employeePageSize]?.id || '');
  }
  function openReport(id, section = 'overview') {
    setEmployeeId(id);
    setEmployeePage(
      Math.floor(workspace.guests.findIndex((person) => person.id === id) / employeePageSize),
    );
    setReportView(section);
    setView('reports');
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  return (
    <div className="hr-preview-page hr-screen">
      <header className="hr-screen-header">
        <AccessBrand />
        <nav aria-label="HR workspace sections">
          <button
            type="button"
            aria-pressed={view === 'dashboard'}
            onClick={() => {
              setView('dashboard');
              setNotice('');
            }}
          >
            <Icon name="dashboard" size={18} />
            Dashboard
          </button>
          <button
            type="button"
            aria-pressed={view === 'reports'}
            onClick={() => {
              setView('reports');
              setNotice('');
            }}
          >
            <Icon name="people" size={18} />
            Employee reports
          </button>
          <button
            type="button"
            aria-pressed={view === 'documents'}
            onClick={() => {
              setView('documents');
              setNotice('');
            }}
          >
            <Icon name="book" size={18} />
            Company documents
          </button>
        </nav>
        <button className="hr-screen-signin" type="button" onClick={() => navigate('/login/hr')}>
          Back to sign in <Icon name="arrow" size={16} />
        </button>
      </header>
      <main className="hr-screen-main" id="hr-main">
        <div className="hr-screen-heading">
          <div>
            <span className="hr-kicker">
              HR WORKSPACE <span aria-hidden="true">/</span>{' '}
              {view === 'dashboard'
                ? 'DASHBOARD'
                : view === 'reports'
                  ? 'PEOPLE & SUPPORT'
                  : 'COMPANY KNOWLEDGE'}
            </span>
            <h1 ref={headingRef} tabIndex={-1}>
              {view === 'dashboard'
                ? 'A good start, for everyone.'
                : view === 'reports'
                  ? 'A clearer picture of your people.'
                  : 'Good guidance starts here.'}
            </h1>
            <p>
              {view === 'dashboard'
                ? 'Your people, their onboarding and the support that helps.'
                : view === 'reports'
                  ? 'See the support employees ask for, and what you can offer next.'
                  : 'Six onboarding essentials, with room for other related guidance.'}
            </p>
          </div>
          {totals && view === 'reports' && (
            <dl className="hr-screen-totals">
              {[
                ['Employees', totals.employees],
                ['Answers', totals.answers],
                ['Support requests', totals.requests],
              ].map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {error && (
          <div className="hr-screen-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => refresh()}>
              Try again
            </button>
          </div>
        )}
        <p
          role="status"
          className={view === 'dashboard' ? 'hr-visually-hidden' : 'hr-screen-notice'}
        >
          {notice}
        </p>
        {!workspace ? (
          <div className="hr-screen-loading" role="status">
            <Icon name="people" size={32} />
            <h2>Getting your workspace ready…</h2>
          </div>
        ) : view === 'documents' ? (
          <GoogleDocsLibrary workspace={workspace} onRefresh={() => refresh(true)} />
        ) : view === 'dashboard' ? (
          <HrDashboard
            workspace={workspace}
            onReport={openReport}
            onDocuments={() => {
              setView('documents');
              requestAnimationFrame(() => headingRef.current?.focus());
            }}
            onAdd={newEmployee}
            adding={adding}
            onNotice={setNotice}
            onRefresh={(id, details) => {
              setWorkspace((previous) => ({
                ...previous,
                guests: previous.guests.map((person) =>
                  person.id === id ? { ...person, onboarding: details } : person,
                ),
              }));
              refresh(true);
            }}
          />
        ) : (
          <div className="hr-summary-workspace hr-screen-reports">
            <aside className="hr-employee-list" aria-label="Employee summary selection">
              <div className="hr-employee-list-heading">
                <span className="hr-kicker">YOUR PEOPLE</span>
                <h2>
                  Employees <span>{workspace.guests.length}</span>
                </h2>
              </div>
              <div className="hr-screen-employee-rows">
                {workspace.guests
                  .slice(
                    currentEmployeePage * employeePageSize,
                    currentEmployeePage * employeePageSize + employeePageSize,
                  )
                  .map((person, index) => (
                    <div className="hr-employee-row" key={person.id}>
                      <button
                        type="button"
                        aria-pressed={employee?.id === person.id}
                        onClick={() => setEmployeeId(person.id)}
                      >
                        <span className="hr-employee-initial">
                          {String(currentEmployeePage * employeePageSize + index + 1).padStart(
                            2,
                            '0',
                          )}
                        </span>
                        <span>
                          <strong>{person.name}</strong>
                          <small>
                            {person.summary.turns}{' '}
                            {person.summary.turns === 1 ? 'answer' : 'answers'} ·{' '}
                            {checkInStatus(person.summary)}
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
              </div>
              {lastEmployeePage > 0 && (
                <div className="hr-employee-pager">
                  <button
                    type="button"
                    disabled={currentEmployeePage === 0}
                    onClick={() => changeEmployeePage(currentEmployeePage - 1)}
                    aria-label="Previous employees"
                  >
                    ←
                  </button>
                  <span>
                    {currentEmployeePage + 1} / {lastEmployeePage + 1}
                  </span>
                  <button
                    type="button"
                    disabled={currentEmployeePage === lastEmployeePage}
                    onClick={() => changeEmployeePage(currentEmployeePage + 1)}
                    aria-label="Next employees"
                  >
                    →
                  </button>
                </div>
              )}
              {!workspace.guests.length && <p>No employee records yet.</p>}
              <button
                type="button"
                className="hr-add-guest"
                disabled={
                  adding || !!removing || workspace.guests.length >= workspace.limits.guests
                }
                onClick={newEmployee}
              >
                <Icon name="user" size={17} />
                {adding ? 'Creating…' : 'Add employee'}
              </button>
              <p className="hr-sidebar-note">
                Each employee has their own conversations and automatic support summary.
              </p>
              <div className="hr-sidebar-auto">
                <Icon name="clock" size={16} />
                <span>Reports update automatically</span>
              </div>
            </aside>
            {employee ? (
              <EmployeeSummary
                key={employee.id + reportView}
                employee={employee}
                initialView={reportView}
              />
            ) : (
              <div className="hr-report-empty">
                <Icon name="people" size={36} />
                <h2>Make room for a new start.</h2>
                <p>Add an employee to begin their onboarding record.</p>
              </div>
            )}
          </div>
        )}
        <footer className="hr-screen-footer">
          <span>
            <span className="hr-screen-dot" />{' '}
            {view === 'dashboard' && notice ? (
              notice
            ) : (
              <>
                {updated ? 'Updated ' + reportDate(updated) : 'Connecting'} · This browser’s
                workspace
              </>
            )}
          </span>
          <button type="button" disabled={refreshing} onClick={() => refresh()}>
            <Icon name="clock" size={14} />
            {refreshing ? 'Refreshing…' : 'Refresh workspace'}
          </button>
          <span>Temporary access · Activity retained for 24 hours</span>
        </footer>
      </main>
    </div>
  );
}
