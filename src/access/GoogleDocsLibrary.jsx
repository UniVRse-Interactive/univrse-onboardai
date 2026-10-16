import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';
import { connectedOnboardingTopics } from './onboarding-document-status.mjs';
import './google-docs-library.css';

// Two-step in-page confirmation (no browser dialog).
function DisconnectControl({ document, busy, confirming, onAsk, onConfirm, className }) {
  if (!confirming)
    return (
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => onAsk(document.id)}
      >
        Disconnect
      </button>
    );
  return (
    <span role="group" aria-label="Confirm disconnect" className="gd-confirm-disconnect">
      <span>Disconnect this guide? New answers will use the remaining company guidance.</span>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => onConfirm(document)}
      >
        Yes, disconnect
      </button>
      <button type="button" className={className} onClick={() => onAsk('')}>
        Keep
      </button>
    </span>
  );
}

// `api` is a createKnowledgeApi(...) adapter, so the same library serves the
// guest workspace and signed-in HR company knowledge.
export default function GoogleDocsLibrary({ workspace, onRefresh, api }) {
  const [topicId, setTopicId] = useState('company');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [relatedIndex, setRelatedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingId, setConfirmingId] = useState('');
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const documents = workspace.documents || [];
  const fileLimit = workspace.limits?.files ?? 12;
  const topic = onboardingDocumentTopics.find((item) => item.id === topicId);
  const drive = workspace.companyKnowledge?.drive;
  const moveToDrive = workspace.driveMoves?.enabled === true;
  const moveBlocked = workspace.driveMoves?.configured && !moveToDrive;
  const sharedDocuments = drive?.state === 'connected' ? drive.documents : [];
  const sharedIds = new Set(
    sharedDocuments.map((document) => document.googleDocId).filter(Boolean),
  );
  const connections = connectedOnboardingTopics(documents, drive);
  const connected = connections[topicId];
  const completed = Object.keys(connections).length;
  const related = [
    ...documents.filter(
      (document) =>
        !sharedIds.has(document.googleDocId) &&
        !onboardingDocumentTopics.some((item) => item.id === document.category),
    ),
    ...sharedDocuments
      .filter((document) => document.category === 'additional')
      .map((document) => ({ ...document, shared: true })),
  ];
  const index = Math.min(relatedIndex, Math.max(0, related.length - 1));
  const relatedDoc = related[index];
  const sharedFull = moveToDrive && sharedDocuments.length >= fileLimit;
  const full = sharedFull || documents.length >= fileLimit;
  function choose(id) {
    setTopicId(id);
    setUrl('');
    setName('');
    setStatus('');
    setError('');
    setEditing(false);
    if (!connections[id]) requestAnimationFrame(() => inputRef.current?.focus());
  }
  async function connect(event) {
    event.preventDefault();
    if (busy) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setStatus(
      moveToDrive ? 'Checking and saving to company Drive…' : 'Checking Google Docs access…',
    );
    setError('');
    try {
      const result = await api.connect({ category: topicId, url, name }, abort.signal);
      await onRefresh();
      if (abort.signal.aborted) return;
      setUrl('');
      setEditing(false);
      setStatus(
        result.driveMove
          ? 'Saved in the company folder. Alya can use this guidance for employees.'
          : result.duplicate
            ? 'This Google Doc is already connected.'
            : 'Connected. Alya will use the current guidance in its next answer.',
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setStatus('');
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function remove(document) {
    setConfirmingId('');
    setBusy(true);
    setError('');
    try {
      await api.disconnect(document.id);
      await onRefresh();
      setStatus('Guide disconnected. The Google Doc itself has not been deleted.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="gd-library" aria-labelledby="gd-heading">
      <div className="gd-topic-area">
        <header className="gd-topic-heading">
          <div>
            <span className="hr-kicker">THE ESSENTIALS</span>
            <h2 id="gd-heading">Six guides. A clearer start.</h2>
          </div>
          <span className="gd-completion">
            <strong>
              {completed}
              <span>/6</span>
            </strong>{' '}
            topics connected
          </span>
        </header>
        <p className="gd-intro">
          Connected guidance is ticked below. Add a Google Doc only for a topic that is missing.
        </p>
        <div className="gd-topic-grid" aria-label="Core onboarding documents">
          {onboardingDocumentTopics.map((item, number) => {
            const ready = !!connections[item.id];
            return (
              <button
                type="button"
                className={'gd-topic' + (topicId === item.id ? ' is-selected' : '')}
                key={item.id}
                aria-pressed={topicId === item.id}
                disabled={busy}
                onClick={() => choose(item.id)}
              >
                <span className="gd-topic-top">
                  <Icon name={item.icon} size={20} />
                  <span>{String(number + 1).padStart(2, '0')}</span>
                </span>
                <strong>{item.title}</strong>
                <span className="gd-topic-description">{item.description}</span>
                <span className={'gd-topic-state' + (ready ? ' is-ready' : '')}>
                  <Icon name={ready ? 'check' : 'arrow'} size={13} />
                  {ready ? 'Connected' : 'Add Google Doc'}
                </span>
              </button>
            );
          })}
        </div>
        <div className="gd-related">
          <div>
            <span className="hr-kicker">OTHER USEFUL GUIDANCE</span>
            <p>Safety, benefits or accessibility? Add another related guide.</p>
          </div>
          <button
            type="button"
            className="hr-screen-button"
            disabled={busy || full}
            onClick={() => choose('additional')}
          >
            <span aria-hidden="true">+</span> Add another Google Doc
          </button>
        </div>
        {relatedDoc && (
          <div className="gd-related-record">
            <Icon name="book" size={17} />
            <span>
              <strong>
                {relatedDoc.googleDocId
                  ? relatedDoc.title
                  : 'Existing company guidance ' + String(index + 1).padStart(2, '0')}
              </strong>
              <small>
                {relatedDoc.googleDocId
                  ? 'Related Google Doc'
                  : 'Previously added guidance · retained for Alya'}
              </small>
            </span>
            {!relatedDoc.shared && (
              <DisconnectControl
                document={relatedDoc}
                busy={busy}
                confirming={confirmingId === relatedDoc.id}
                onAsk={setConfirmingId}
                onConfirm={remove}
                className="gd-small-action"
              />
            )}
            {relatedDoc.shared && (
              <span className="gd-available">
                <Icon name="check" size={14} /> In company Drive
              </span>
            )}
            {related.length > 1 && (
              <div className="gd-pager">
                <button
                  type="button"
                  aria-label="Previous related guide"
                  disabled={index === 0}
                  onClick={() => setRelatedIndex(index - 1)}
                >
                  ←
                </button>
                <span>
                  {index + 1}/{related.length}
                </span>
                <button
                  type="button"
                  aria-label="Next related guide"
                  disabled={index === related.length - 1}
                  onClick={() => setRelatedIndex(index + 1)}
                >
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <aside
        className={'gd-connect-panel' + (status || error ? ' has-feedback' : '')}
        aria-labelledby="gd-connect-heading"
      >
        <div className="gd-doc-symbol" aria-hidden="true">
          <Icon name="book" size={28} />
          <span>DOC</span>
        </div>
        <span className="hr-kicker">GOOGLE DOCS ONLY</span>
        <h2 id="gd-connect-heading">
          {connected && !editing
            ? 'Already connected.'
            : connected
              ? 'Update this guide.'
              : moveToDrive
                ? 'Save your guide.'
                : 'Connect your guide.'}
        </h2>
        <p>
          {connected && !editing
            ? 'No need to add this guide again.'
            : moveToDrive
              ? 'Add a Doc to your company folder.'
              : 'Link a Google Doc your company can read.'}
        </p>
        {connected && !editing ? (
          <div className="gd-connected-guide">
            <span className="gd-connected-check">
              <Icon name="check" size={30} />
            </span>
            <h3>{topic.title}</h3>
            <span className="gd-available">
              <Icon name="check" size={15} /> Available to Alya
            </span>
            <p>
              {connected.source === 'drive'
                ? 'Your company Drive already provides this guidance.'
                : 'This guidance is already in your company library.'}
            </p>
            {connected.source === 'workspace' &&
              connected.googleDocId &&
              connected.category === topicId && (
                <button
                  className="hr-screen-button"
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                >
                  Change Google Doc
                </button>
              )}
          </div>
        ) : (
          <form onSubmit={connect} aria-busy={busy}>
            <div className="gd-current-topic">
              <Icon name={topic?.icon || 'book'} size={18} />
              <strong>{topic?.title || 'Another related guide'}</strong>
            </div>
            {!topic && (
              <label>
                Guide topic
                <input
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="For example, Workplace Safety"
                  required
                  disabled={busy}
                />
              </label>
            )}
            <label htmlFor="gd-link">Google Docs link</label>
            <input
              id="gd-link"
              ref={inputRef}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://docs.google.com/document/d/…"
              maxLength={2048}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
            />
            <button
              type="submit"
              className="hr-screen-button primary"
              disabled={busy || moveBlocked || (full && !connected)}
            >
              <Icon name="book" size={17} />
              {busy
                ? moveToDrive
                  ? 'Saving to company Drive…'
                  : 'Checking document…'
                : moveToDrive
                  ? 'Save to company Drive'
                  : connected
                    ? 'Replace connected Google Doc'
                    : 'Connect Google Doc'}
              <Icon name="arrow" size={17} />
            </button>
            <small>
              {moveBlocked
                ? 'Adding company-wide guidance requires verified HR access. Use the local HR workspace for now.'
                : moveToDrive
                  ? 'Moves this Doc into shared company guidance. Editor access required.'
                  : 'Only native Google Docs. Give the connected company account Viewer access.'}
            </small>
          </form>
        )}
        {connected?.source === 'workspace' && (
          <div className="gd-current-connection">
            <span>
              <Icon name="check" size={15} /> Connected for this topic
            </span>
            <div>
              {connected.googleDocId && (
                <a
                  href={'https://docs.google.com/document/d/' + connected.googleDocId + '/edit'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google Doc <Icon name="external" size={13} />
                </a>
              )}
              <DisconnectControl
                document={connected}
                busy={busy}
                confirming={confirmingId === connected.id}
                onAsk={setConfirmingId}
                onConfirm={remove}
              />
            </div>
          </div>
        )}
        <div className="gd-feedback" aria-live="polite">
          {status && (
            <p role="status">
              <Icon name={busy ? 'clock' : 'check'} size={15} />
              {status}
            </p>
          )}
          {error && (
            <p className="gd-error" role="alert">
              {error}
            </p>
          )}
          {full && !connected && (
            <p className="gd-error">
              {sharedFull
                ? 'The company folder has twelve documents. Ask HR to organise it before adding another.'
                : 'Your library has twelve documents. Disconnect an unused guide first.'}
            </p>
          )}
        </div>
        {!status && !error && (
          <footer className="gd-drive-status">
            <Icon name="shield" size={17} />
            <div>
              <strong>
                {drive?.state === 'connected'
                  ? 'Company Drive is connected'
                  : drive?.state === 'unavailable'
                    ? 'Company Drive needs attention'
                    : 'Your existing Drive connection'}
              </strong>
              <span>
                {drive?.state === 'connected'
                  ? `${drive.documents.length} guides stay available to Alya.`
                  : drive?.state === 'unavailable'
                    ? drive.error
                    : 'Individual Google Docs can be connected above.'}
              </span>
            </div>
          </footer>
        )}
      </aside>
    </section>
  );
}
