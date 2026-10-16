import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';
import {
  connectedOnboardingTopics,
  documentLabel,
  relatedDocuments,
} from './onboarding-document-status.mjs';
import {
  acceptAttribute,
  formatCharacters,
  knowledgeText as text,
  uploadSuccessMessage,
  validateAdditionalName,
  validateUploadFile,
} from './company-knowledge-upload.mjs';
import './company-knowledge-library.css';

// Two-step in-page confirmation (no browser dialog).
function RemoveControl({ document, busy, confirming, onAsk, onConfirm, className }) {
  if (!confirming)
    return (
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => onAsk(document.id)}
      >
        {text.removeAction}
      </button>
    );
  return (
    <span role="group" aria-label="Confirm remove" className="gd-confirm-disconnect">
      <span>{text.confirmRemove}</span>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => onConfirm(document)}
      >
        Yes, remove
      </button>
      <button type="button" className={className} onClick={() => onAsk('')}>
        Keep
      </button>
    </span>
  );
}

// `api` is a createKnowledgeApi(...) adapter for the signed-in HR company
// knowledge endpoints.
export default function CompanyKnowledgeLibrary({ workspace, onRefresh, api }) {
  const [topicId, setTopicId] = useState('company');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [relatedIndex, setRelatedIndex] = useState(0);
  const [confirmingId, setConfirmingId] = useState('');
  const abortRef = useRef(null);
  const fileRef = useRef(null);
  const nameRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const documents = workspace.documents || [];
  const fileLimit = workspace.limits?.files ?? 12;
  const topic = onboardingDocumentTopics.find((item) => item.id === topicId);
  const connections = connectedOnboardingTopics(documents);
  const connected = connections[topicId];
  const completed = Object.keys(connections).length;
  const related = relatedDocuments(documents);
  const index = Math.min(relatedIndex, Math.max(0, related.length - 1));
  const relatedDoc = related[index];
  const full = documents.length >= fileLimit;
  const blocked = full && !connected && !!topic;
  function choose(id) {
    setTopicId(id);
    setName('');
    setStatus('');
    setError('');
    setConfirmingId('');
  }
  function pick() {
    if (busy) return;
    if (!topic) {
      const problem = validateAdditionalName(name);
      if (problem) {
        setError(problem);
        nameRef.current?.focus();
        return;
      }
    }
    setError('');
    fileRef.current?.click();
  }
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    const problem = validateUploadFile(file);
    if (problem) {
      setError(problem);
      setStatus('');
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    setError('');
    try {
      const result = await api.upload(file, { category: topicId, name }, abort.signal);
      await onRefresh();
      if (abort.signal.aborted) return;
      setName('');
      setStatus(uploadSuccessMessage(result, file.name));
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
      await api.remove(document.id);
      await onRefresh();
      setStatus('Guide removed. New answers use the remaining company guidance.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const uploadButton = (label, primary) => (
    <button
      type="button"
      className={'hr-screen-button' + (primary ? ' primary' : '')}
      disabled={busy || blocked}
      onClick={pick}
    >
      <Icon name="book" size={17} />
      {busy ? 'Uploading…' : label}
    </button>
  );
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
          Uploaded guidance is ticked below. Upload a document only for a topic that is missing.
        </p>
        <div className="gd-topic-grid" aria-label="Core onboarding documents">
          {onboardingDocumentTopics.map((item, number) => {
            const doc = connections[item.id];
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
                <span className="gd-topic-description">
                  {doc
                    ? `${documentLabel(doc)} · ${formatCharacters(doc.characters)}`
                    : item.description}
                </span>
                <span className={'gd-topic-state' + (doc ? ' is-ready' : '')}>
                  <Icon name={doc ? 'check' : 'arrow'} size={13} />
                  {doc ? text.connected : text.uploadAction}
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
            <span aria-hidden="true">+</span> {text.addAnother}
          </button>
        </div>
        {relatedDoc && (
          <div className="gd-related-record">
            <Icon name="book" size={17} />
            <span>
              <strong>{relatedDoc.title || documentLabel(relatedDoc)}</strong>
              <small>
                {formatCharacters(relatedDoc.characters)}
                {relatedDoc.fileName ? ' · ' + relatedDoc.fileName : ''}
              </small>
            </span>
            <RemoveControl
              document={relatedDoc}
              busy={busy}
              confirming={confirmingId === relatedDoc.id}
              onAsk={setConfirmingId}
              onConfirm={remove}
              className="gd-small-action"
            />
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
        </div>
        <span className="hr-kicker">{topic ? topic.title.toUpperCase() : 'ANOTHER GUIDE'}</span>
        <h2 id="gd-connect-heading">{connected ? text.replaceHeading : text.heading}</h2>
        <p>{text.hint}</p>
        <div className="gd-current-topic">
          <Icon name={topic?.icon || 'book'} size={18} />
          <strong>{topic?.title || 'Another related guide'}</strong>
        </div>
        {connected && (
          <div className="gd-current-connection">
            <span>
              <Icon name="check" size={15} /> {text.connected}: {documentLabel(connected)} ·{' '}
              {formatCharacters(connected.characters)}
            </span>
          </div>
        )}
        {!topic && (
          <>
            <label htmlFor="gd-name">{text.nameLabel}</label>
            <input
              id="gd-name"
              ref={nameRef}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={text.namePlaceholder}
              autoComplete="off"
              disabled={busy}
            />
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={acceptAttribute}
          aria-label={text.chooseFile}
          onChange={upload}
        />
        <div className="gd-actions">
          {uploadButton(connected ? text.replaceAction : text.uploadAction, true)}
          {connected && (
            <RemoveControl
              document={connected}
              busy={busy}
              confirming={confirmingId === connected.id}
              onAsk={setConfirmingId}
              onConfirm={remove}
              className="hr-screen-button"
            />
          )}
        </div>
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
          {blocked && <p className="gd-error">{text.limitReached}</p>}
        </div>
        {!status && !error && (
          <footer className="gd-note">
            <Icon name="shield" size={17} />
            <div>
              <span>{text.privacy}</span>
            </div>
          </footer>
        )}
      </aside>
    </section>
  );
}
