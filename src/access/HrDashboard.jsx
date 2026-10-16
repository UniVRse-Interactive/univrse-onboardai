import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { hrOnboardingTasks, onboardingProgress } from '../../server/hr-onboarding.mjs';
import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';
import { hrDashboardSnapshot, supportSignal } from './hr-dashboard-insights.mjs';
import { connectedOnboardingTopics } from './onboarding-document-status.mjs';
import { workspaceRequest } from './guest-workspace-api';
import './hr-dashboard.css';

const pageSize = 2;
function joiningDate(date) {
  return date
    ? new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Joining date not set';
}

function OnboardingEditor({ employee, onClose, onSaved }) {
  const dialog = useRef(null);
  const [draft, setDraft] = useState({
    startDate: employee.onboarding?.startDate || '',
    department: employee.onboarding?.department || '',
    completed: employee.onboarding?.completed || [],
    version: employee.onboarding?.version || 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const progress = onboardingProgress(draft);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previous;
    };
  }, []);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const details = {
      ...draft,
      startDate: fields.get('startDate'),
      department: fields.get('department'),
    };
    setBusy(true);
    setError('');
    try {
      const saved = await workspaceRequest('/guests/' + employee.id + '/onboarding', {
        method: 'PATCH',
        body: JSON.stringify(details),
      });
      onSaved(employee.id, saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="hr-onboarding-dialog"
      aria-labelledby="hr-onboarding-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <header>
          <div>
            <span className="hr-kicker">EMPLOYEE DETAILS</span>
            <h2 id="hr-onboarding-title">{employee.name}</h2>
          </div>
          <button
            type="button"
            aria-label="Close employee details"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="hr-onboarding-fields">
          <label>
            Joining date
            <input type="date" name="startDate" defaultValue={draft.startDate} disabled={busy} />
          </label>
          <label>
            Team or department
            <input
              type="text"
              name="department"
              maxLength={64}
              placeholder="e.g. Operations"
              defaultValue={draft.department}
              disabled={busy}
            />
          </label>
        </div>
        <fieldset disabled={busy}>
          <legend>
            Onboarding checklist{' '}
            <span>
              {progress.completed} / {progress.total} confirmed
            </span>
          </legend>
          <p>Tick a milestone after HR has confirmed it with the employee.</p>
          {hrOnboardingTasks.map((task) => (
            <label key={task.id} className="hr-milestone">
              <input
                type="checkbox"
                checked={draft.completed.includes(task.id)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    completed: event.target.checked
                      ? [...draft.completed, task.id]
                      : draft.completed.filter((id) => id !== task.id),
                  })
                }
              />
              <span>{task.title}</span>
            </label>
          ))}
        </fieldset>
        <p className="hr-checklist-note">
          This HR checklist is separate from Alya’s support report and the employee’s device
          checklist.
        </p>
        {error && (
          <p className="hr-editor-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="hr-screen-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="hr-screen-button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save employee details'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export default function HrDashboard({
  workspace,
  onReport,
  onDocuments,
  onAdd,
  adding,
  onRefresh,
  onNotice,
}) {
  const [page, setPage] = useState(0);
  const [signalPage, setSignalPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const editTrigger = useRef(null);
  const data = hrDashboardSnapshot(workspace.guests);
  const connections = connectedOnboardingTopics(
    workspace.documents,
    workspace.companyKnowledge?.drive,
  );
  const connected = Object.keys(connections).length;
  const lastPage = Math.max(0, Math.ceil(workspace.guests.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const lastSignalPage = Math.max(0, Math.ceil(data.signals.length / 2) - 1);
  const currentSignalPage = Math.min(signalPage, lastSignalPage);
  function edit(employee, event) {
    editTrigger.current = event.currentTarget;
    setEditing(employee);
  }
  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }
  return (
    <div className="hr-dashboard">
      <dl className="hr-dashboard-metrics" aria-label="Onboarding overview">
        {[
          ['Employees', data.employees, 'Records in this workspace', 'people'],
          [
            'New hires this month',
            data.hasDates ? data.newHires : '—',
            data.hasDates ? 'Based on saved joining dates' : 'Add joining dates to see this',
            'calendar',
          ],
          [
            'Onboarding in progress',
            data.inProgress,
            `${data.complete} completed · HR checklist`,
            'checklist',
          ],
          [
            'Employees using support',
            data.signals.length,
            'Recorded requests and feedback',
            'chat',
          ],
        ].map(([label, value, note, icon]) => (
          <div key={label}>
            <dt>
              <Icon name={icon} size={16} />
              {label}
            </dt>
            <dd>{value}</dd>
            <small>{note}</small>
          </div>
        ))}
      </dl>
      <div className="hr-dashboard-columns">
        <section className="hr-dashboard-people" aria-labelledby="hr-dashboard-people-heading">
          <header className="hr-dashboard-section-heading">
            <div>
              <span className="hr-kicker">PEOPLE OVERVIEW</span>
              <h2 id="hr-dashboard-people-heading">Every start, in view.</h2>
            </div>
            <button
              className="hr-screen-button primary"
              type="button"
              disabled={adding || workspace.guests.length >= workspace.limits.guests}
              onClick={onAdd}
            >
              <span aria-hidden="true">+</span> {adding ? 'Adding…' : 'Add employee'}
            </button>
          </header>
          {workspace.guests.length ? (
            <table className="hr-dashboard-table">
              <caption className="hr-visually-hidden">
                Employee joining details, HR-confirmed progress and next actions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Onboarding</th>
                  <th scope="col">Next step</th>
                </tr>
              </thead>
              <tbody>
                {workspace.guests
                  .slice(currentPage * pageSize, currentPage * pageSize + pageSize)
                  .map((employee, index) => {
                    const progress = onboardingProgress(employee.onboarding);
                    const signal = supportSignal(employee);
                    return (
                      <tr key={employee.id}>
                        <td>
                          <div className="hr-dashboard-person">
                            <span className="hr-dashboard-initial" aria-hidden="true">
                              {String(currentPage * pageSize + index + 1).padStart(2, '0')}
                            </span>
                            <div>
                              <button
                                type="button"
                                className="hr-person-edit"
                                onClick={(event) => edit(employee, event)}
                                aria-label={'Edit onboarding for ' + employee.name}
                              >
                                {employee.name}
                                <Icon name="chevron" size={13} />
                              </button>
                              <span className="hr-dashboard-department">
                                {employee.onboarding?.department || 'Team not set'}
                              </span>
                              <span className="hr-dashboard-joining">
                                {joiningDate(employee.onboarding?.startDate)}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="hr-progress-label">
                            <strong>{progress.percent}%</strong>
                            <span>
                              {progress.completed}/{progress.total}
                            </span>
                          </div>
                          <progress
                            max={progress.total}
                            value={progress.completed}
                            aria-label={employee.name + ' HR-confirmed onboarding progress'}
                          />
                          <span
                            className={
                              'hr-dashboard-stage' +
                              (progress.status === 'Complete' ? ' is-complete' : '')
                            }
                          >
                            {progress.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="hr-dashboard-next"
                            onClick={
                              signal
                                ? () => onReport(employee.id, 'support')
                                : (event) => edit(employee, event)
                            }
                            aria-label={
                              (signal ? 'Review support for ' : 'Update checklist for ') +
                              employee.name
                            }
                          >
                            <span>
                              {signal
                                ? 'Review support'
                                : progress.status === 'Complete'
                                  ? 'View checklist'
                                  : 'Update checklist'}
                            </span>
                            <Icon name="arrow" size={15} />
                          </button>
                          <button
                            type="button"
                            className="hr-dashboard-report-link"
                            onClick={() => onReport(employee.id)}
                          >
                            Support report
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <div className="hr-dashboard-empty">
              <Icon name="people" size={30} />
              <h3>Your next employee starts here.</h3>
              <p>Add an employee to organise their onboarding and support.</p>
            </div>
          )}
          <footer className="hr-dashboard-table-footer">
            <p>Progress reflects HR-confirmed milestones.</p>
            <div className="hr-dashboard-pagination" aria-label="Employee pages">
              <span>
                {workspace.guests.length
                  ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, workspace.guests.length)} of ${workspace.guests.length}`
                  : '0 employees'}
              </span>
              {lastPage > 0 && (
                <>
                  <button
                    type="button"
                    disabled={!currentPage}
                    aria-label="Previous dashboard employees"
                    onClick={() => setPage(currentPage - 1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={currentPage === lastPage}
                    aria-label="Next dashboard employees"
                    onClick={() => setPage(currentPage + 1)}
                  >
                    →
                  </button>
                </>
              )}
            </div>
          </footer>
        </section>
        <aside className="hr-dashboard-side">
          <section className="hr-dashboard-signals" aria-labelledby="hr-signals-heading">
            <header>
              <span className="hr-kicker">SUPPORT SIGNALS</span>
              <h2 id="hr-signals-heading">
                Support to review <span>{data.signals.length}</span>
              </h2>
            </header>
            {data.signals.length ? (
              <div className="hr-signal-list">
                {data.signals
                  .slice(currentSignalPage * 2, currentSignalPage * 2 + 2)
                  .map(({ employee, signal }) => (
                    <button
                      type="button"
                      key={employee.id}
                      onClick={() => onReport(employee.id, 'support')}
                      aria-label={'Review ' + signal.label.toLowerCase() + ' for ' + employee.name}
                    >
                      <span className="hr-signal-icon">
                        <Icon name={signal.kind === 'human' ? 'people' : 'chat'} size={17} />
                      </span>
                      <span>
                        <strong>{employee.name}</strong>
                        <small>{signal.label}</small>
                      </span>
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
              </div>
            ) : (
              <p className="hr-signals-empty">
                No support requests recorded yet. Employee requests and feedback will appear here.
              </p>
            )}
            {lastSignalPage > 0 && (
              <div className="hr-dashboard-pagination">
                <span>
                  {currentSignalPage + 1} / {lastSignalPage + 1}
                </span>
                <button
                  type="button"
                  disabled={!currentSignalPage}
                  onClick={() => setSignalPage(currentSignalPage - 1)}
                  aria-label="Previous support signals"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={currentSignalPage === lastSignalPage}
                  onClick={() => setSignalPage(currentSignalPage + 1)}
                  aria-label="Next support signals"
                >
                  →
                </button>
              </div>
            )}
            <p className="hr-signals-note">Recorded requests and feedback.</p>
          </section>
          <button className="hr-dashboard-documents" type="button" onClick={onDocuments}>
            <span className="hr-documents-heading">
              <Icon name="book" size={19} />
              <strong>Company guidance</strong>
              <Icon name="arrow" size={17} />
            </span>
            <span className="hr-documents-count">
              <strong>
                {connected}
                <span> / {onboardingDocumentTopics.length}</span>
              </strong>{' '}
              essentials connected
            </span>
            <span className="hr-documents-track" aria-hidden="true">
              {onboardingDocumentTopics.map((topic) => (
                <span key={topic.id} className={connections[topic.id] ? 'is-connected' : ''} />
              ))}
            </span>
            <span className="hr-documents-caption">Manage the guidance Alya uses.</span>
          </button>
        </aside>
      </div>
      {editing && (
        <OnboardingEditor
          employee={editing}
          onClose={closeEditor}
          onSaved={(id, details) => {
            closeEditor();
            onNotice('Onboarding details saved for ' + editing.name + '.');
            onRefresh(id, details);
          }}
        />
      )}
    </div>
  );
}
