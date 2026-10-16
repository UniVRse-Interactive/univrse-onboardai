import React, { useState } from 'react';
import Icon from '../portal/Icon';
import { learningFormats } from '../avatar/AnswerStyleSettings';
import { reportDate, reportText } from '../avatar/hr-support-report.mjs';
import { checkInStatus, onboardingSnapshot } from './hr-report-insights.mjs';

const employeePageSize = 2;

function EmployeeSummary({ employee }) {
  const [view, setView] = useState('overview');
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
          aria-label={'Download report for ' + employee.name}
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

// The People & Support list and report. `people` rows come from
// people-support.mjs, so signed-in accounts and guest employees look the same.
export default function PeopleSupport({
  people,
  selectedId,
  onSelect,
  guest = null,
  className = '',
}) {
  const [page, setPage] = useState(0);
  const employee = people.find((person) => person.id === selectedId) || people[0];
  const lastPage = Math.max(0, Math.ceil(people.length / employeePageSize) - 1);
  const current = Math.min(page, lastPage);
  function changePage(next) {
    setPage(next);
    onSelect(people[next * employeePageSize]?.id || '');
  }
  return (
    <div className={'hr-summary-workspace hr-screen-reports ' + className}>
      <aside className="hr-employee-list" aria-label="Employee summary selection">
        <div className="hr-employee-list-heading">
          <span className="hr-kicker">YOUR PEOPLE</span>
          <h2>
            Employees <span>{people.length}</span>
          </h2>
        </div>
        <div className="hr-screen-employee-rows">
          {people
            .slice(current * employeePageSize, current * employeePageSize + employeePageSize)
            .map((person, index) => (
              <div className="hr-employee-row" key={person.id}>
                <button
                  type="button"
                  aria-pressed={employee?.id === person.id}
                  onClick={() => onSelect(person.id)}
                >
                  <span className="hr-employee-initial">
                    {String(current * employeePageSize + index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.detail}</small>
                  </span>
                  <Icon name="chevron" size={17} />
                </button>
                {guest && (
                  <details className="hr-employee-menu">
                    <summary aria-label={'Actions for ' + person.name}>⋯</summary>
                    <button
                      type="button"
                      disabled={!!guest.removing}
                      onClick={(event) => {
                        event.currentTarget.closest('details').open = false;
                        guest.onRemove(person);
                      }}
                    >
                      {guest.removing === person.id ? 'Removing…' : 'Remove employee record'}
                    </button>
                  </details>
                )}
              </div>
            ))}
        </div>
        {lastPage > 0 && (
          <div className="hr-employee-pager">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => changePage(current - 1)}
              aria-label="Previous employees"
            >
              ←
            </button>
            <span>
              {current + 1} / {lastPage + 1}
            </span>
            <button
              type="button"
              disabled={current === lastPage}
              onClick={() => changePage(current + 1)}
              aria-label="Next employees"
            >
              →
            </button>
          </div>
        )}
        {!people.length && (
          <p>{guest ? 'No employee records yet.' : 'No employee accounts yet.'}</p>
        )}
        {guest && (
          <button
            type="button"
            className="hr-add-guest"
            disabled={guest.adding || !!guest.removing || !guest.canAdd}
            onClick={guest.onAdd}
          >
            <Icon name="user" size={17} />
            {guest.adding ? 'Creating…' : 'Add employee'}
          </button>
        )}
        <p className="hr-sidebar-note">
          Each employee has their own conversations and automatic support summary.
        </p>
        <div className="hr-sidebar-auto">
          <Icon name="clock" size={16} />
          <span>Reports update automatically</span>
        </div>
      </aside>
      {employee ? (
        <EmployeeSummary key={employee.id} employee={employee} />
      ) : (
        <div className="hr-report-empty">
          <Icon name="people" size={36} />
          <h2>{guest ? 'Make room for a new start.' : 'No employees to report on yet.'}</h2>
          <p>
            {guest
              ? 'Add an employee to begin their onboarding record.'
              : 'Create an employee account to start their onboarding record.'}
          </p>
        </div>
      )}
    </div>
  );
}

export function PeopleTotals({ people }) {
  const totals = onboardingSnapshot(people);
  return (
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
  );
}
