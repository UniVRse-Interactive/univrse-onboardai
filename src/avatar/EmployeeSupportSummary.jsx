import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { learningFormats } from './AnswerStyleSettings';
import { reportText, reportDate as date } from './hr-support-report.mjs';
import './employee-support-summary.css';

function ReportPreview({ snapshot, onClose }) {
  const dialog = useRef(null),
    [name, setName] = useState(''),
    [approved, setApproved] = useState(false),
    [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus?.();
    };
  }, []);
  function download() {
    if (!approved) return;
    const url = URL.createObjectURL(
      new Blob([reportText(snapshot, name)], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download =
      'alya-support-summary-' + new Date(snapshot.createdAt).toISOString().slice(0, 10) + '.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  }
  return (
    <dialog
      ref={dialog}
      className="alya-report-dialog"
      aria-labelledby="alya-report-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="uv-eyebrow">YOU CONTROL WHAT YOU SHARE</span>
          <h2 id="alya-report-title">Review your HR report.</h2>
        </div>
        <button aria-label="Close report preview" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <p>
        This is a snapshot of your support use. Downloading creates a file for you; it does not send
        anything to HR.
      </p>
      <label className="alya-report-name">
        Name to include (optional)
        <input
          maxLength={60}
          autoComplete="off"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setApproved(false);
          }}
          placeholder="Your preferred name"
        />
      </label>
      <pre tabIndex={0} aria-label="Report contents">
        {reportText(snapshot, name)}
      </pre>
      <label className="alya-report-approval">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        I have reviewed this report and choose to export it for HR.
      </label>
      <div className="alya-report-actions">
        <button onClick={onClose}>Keep it private</button>
        <button disabled={!approved} onClick={download}>
          <Icon name="download" size={17} />
          Download reviewed report
        </button>
      </div>
      {downloaded && (
        <p role="status">
          Report downloaded. You can share the file through your approved private HR channel.
        </p>
      )}
    </dialog>
  );
}

export default function EmployeeSupportSummary({
  summary,
  disabled,
  error,
  onRecording,
  onRefresh,
}) {
  const [expanded, setExpanded] = useState(true),
    [snapshot, setSnapshot] = useState(null);
  return (
    <section className="alya-support-summary" aria-labelledby="alya-support-title">
      <header>
        <div>
          <span className="uv-eyebrow">
            <Icon name="heart" size={15} />
            SUPPORT THAT FITS YOU
          </span>
          <h2 id="alya-support-title">Your onboarding experience.</h2>
          <p>
            A live summary of support used across your saved chats. Only you can review and export
            it here.
          </p>
        </div>
        <button
          aria-expanded={expanded}
          aria-controls="alya-support-content"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Less detail' : 'View summary'}
          <Icon name="down" size={16} />
        </button>
      </header>
      <div id="alya-support-content" hidden={!expanded}>
        {error && (
          <div className="alya-support-error" role="alert">
            {error}
            <button onClick={onRefresh}>Try again</button>
          </div>
        )}
        {!summary ? (
          <p>Loading your support summary…</p>
        ) : (
          <>
            <div className="alya-support-status">
              <span>
                <i className={'uv-small-dot ' + (summary.recording ? 'mint' : '')} />
                {summary.recording ? 'Summary updates with your conversations' : 'Updates paused'}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={summary.recording}
                  disabled={disabled}
                  onChange={(e) => onRecording(e.target.checked)}
                />
                Update from future interactions
              </label>
            </div>
            <div className="alya-support-description">
              <Icon name="chat" size={20} />
              <div>
                <span>HOW THE EMPLOYEE USES SUPPORT</span>
                <p>{summary.overview?.interaction || summary.description}</p>
              </div>
            </div>
            {!!summary.overview && (
              <div className="alya-employee-overview">
                <section>
                  <span className="uv-eyebrow">WHAT HR CAN OFFER</span>
                  <ul>
                    {summary.overview.recommendations.map((item) => (
                      <li key={item}>
                        <Icon name="check" size={15} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <span className="uv-eyebrow">NEXT CHECK-IN</span>
                  <p>{summary.overview.followUp}</p>
                  <small>
                    {summary.overview.limited
                      ? 'Early summary — confirm preferences as onboarding continues.'
                      : summary.overview.basis}
                  </small>
                </section>
              </div>
            )}
            <dl className="alya-support-stats">
              {[
                ['Answers recorded', summary.turns],
                [
                  'Requests for support',
                  Object.values(summary.requests).reduce((a, b) => a + b, 0) +
                    summary.humanHelpRequests,
                ],
                ['Visual guides provided', summary.cards],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <details className="alya-support-evidence">
              <summary>
                Supporting statistics
                <Icon name="down" size={15} />
              </summary>
              <div className="alya-support-detail-grid">
                <section>
                  <h3>Answer formats used</h3>
                  <p>Formats delivered by Alya, including automatic choices.</p>
                  {Object.entries(summary.formats).map(([key, count]) => (
                    <div className="alya-format-stat" key={key}>
                      <span>{learningFormats[key]}</span>
                      <meter
                        min={0}
                        max={Math.max(1, summary.turns)}
                        value={count}
                        aria-label={learningFormats[key] + ' answers'}
                      />
                      <strong>{count}</strong>
                    </div>
                  ))}
                </section>
                <section>
                  <h3>Support & feedback</h3>
                  <dl>
                    {[
                      ['Smaller steps requested', summary.requests.steps],
                      ['Examples requested', summary.requests.example],
                      ['Shorter answers requested', summary.requests.brief],
                      ['Helpful', summary.feedback.helpful],
                      ['Still unclear', summary.feedback.unclear],
                      ['Human help requested', summary.humanHelpRequests],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            </details>
            <footer>
              <div>
                <p>Based on recorded conversations, requests and feedback.</p>
                <small>
                  {summary.turns
                    ? `Recorded period: ${date(summary.period.from)} — ${date(summary.period.to)}`
                    : 'New conversations will build this summary.'}
                </small>
              </div>
              <button
                disabled={disabled || !summary.turns}
                onClick={() =>
                  setSnapshot({ summary: structuredClone(summary), createdAt: Date.now() })
                }
              >
                <Icon name="shield" size={17} />
                Review employee summary
                <Icon name="arrow" size={17} />
              </button>
            </footer>
          </>
        )}
      </div>
      {snapshot && <ReportPreview snapshot={snapshot} onClose={() => setSnapshot(null)} />}
    </section>
  );
}
