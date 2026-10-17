import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import {
  additionalArea,
  areaListView,
  areaTitle,
  documentLabel,
  moveOptions,
} from './onboarding-document-status.mjs';
import {
  acceptAttribute,
  documentSyncState,
  errorNeedsRefresh,
  formatCharacters,
  knowledgeErrorMessage,
  knowledgeText as text,
  moveSuccessMessage,
  removeSuccessMessage,
  uploadProgressMessage,
  uploadSuccessMessage,
  validateDocumentName,
  validateUploadFile,
} from './company-knowledge-upload.mjs';
import './company-knowledge-library.css';

const focusSelector = (key) =>
  `[data-focus="${globalThis.CSS?.escape ? globalThis.CSS.escape(key) : key}"]`;
const plural = (count) => (count === 1 ? '1 document' : `${count} documents`);

// Results of an upload, move or remove, read out by the card's live region.
function Feedback({ item }) {
  return (
    <div className="gd-feedback" aria-live="polite">
      {item &&
        (item.tone === 'error' ? (
          <p className="gd-error" role="alert">
            {item.text}
          </p>
        ) : (
          <p className={item.tone === 'progress' ? 'gd-syncing' : undefined}>
            <Icon name={item.tone === 'progress' ? 'clock' : 'check'} size={15} />
            <span>
              {item.text}
              {item.syncCompleted && (
                <strong className="gd-feedback-sync"> · {text.syncCompletedStatus}</strong>
              )}
            </span>
          </p>
        ))}
    </div>
  );
}

// `api` is a createKnowledgeApi(...) adapter for the signed-in HR company
// knowledge endpoints; `workspace` is its snapshot { topics, documents, limits }.
export default function CompanyKnowledgeLibrary({ workspace, onRefresh, api }) {
  const view = useMemo(() => areaListView(workspace), [workspace]);
  // { kind: 'upload' | 'move' | 'remove', area?, id?, fileName?, title? } while a request runs.
  const [busy, setBusy] = useState(null);
  // The one document with an open Move or Remove step: { id, action }.
  const [pending, setPending] = useState(null);
  const [moveTarget, setMoveTarget] = useState('');
  // { area, tone: 'progress' | 'status' | 'error', text, syncCompleted? }
  const [feedback, setFeedback] = useState(null);
  // Per-document AI index sync state for newly uploaded documents: { [id]: 'syncing' | 'completed' }
  const [syncStates, setSyncStates] = useState({});
  const [extraName, setExtraName] = useState('');
  const [nameError, setNameError] = useState('');
  const rootRef = useRef(null);
  const fileRef = useRef(null);
  const uploadAreaRef = useRef('');
  const abortRef = useRef(null);
  const syncTimersRef = useRef({});
  const focusRef = useRef('');
  useEffect(
    () => () => {
      abortRef.current?.abort();
      Object.values(syncTimersRef.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );
  // Moves focus once a request has finished and the list has re-rendered.
  useEffect(() => {
    if (busy || !focusRef.current) return;
    const target = rootRef.current?.querySelector(focusSelector(focusRef.current));
    focusRef.current = '';
    target?.focus();
  });

  function openStep(document, action, options) {
    if (busy) return;
    setFeedback(null);
    setPending({ id: document.id, action });
    if (action === 'move') {
      setMoveTarget(options[0]?.value || '');
      focusRef.current = 'move-select-' + document.id;
    } else focusRef.current = 'keep-' + document.id;
  }
  function closeStep(document, action) {
    setPending(null);
    focusRef.current = action + '-' + document.id;
  }
  function onStepKey(event, document, action) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeStep(document, action);
  }

  function pick(areaId) {
    if (busy || view.full) return;
    setFeedback(null);
    if (areaId === additionalArea.id) {
      const problem = validateDocumentName(extraName);
      setNameError(problem);
      if (problem) {
        rootRef.current?.querySelector(focusSelector('extra-name'))?.focus();
        return;
      }
    }
    uploadAreaRef.current = areaId;
    fileRef.current?.click();
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const areaId = uploadAreaRef.current;
    if (!file || busy || !areaId) return;
    const title = areaTitle(view, areaId);
    const problem = validateUploadFile(file);
    if (problem) {
      setFeedback({ area: areaId, tone: 'error', text: problem });
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    const name = areaId === additionalArea.id ? extraName : '';
    const pendingTitle =
      String(name || '').trim() ||
      String(file.name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') ||
      file.name;
    setPending(null);
    setBusy({ kind: 'upload', area: areaId, fileName: file.name, title: pendingTitle });
    setFeedback({ area: areaId, tone: 'progress', text: uploadProgressMessage(file.name) });
    try {
      const result = await api.upload(file, { category: areaId, name }, abort.signal);
      if (result?.id && !result.duplicate) {
        setSyncStates((prev) => ({ ...prev, [result.id]: 'syncing' }));
      }
      await onRefresh();
      if (abort.signal.aborted) return;
      if (areaId === additionalArea.id) setExtraName('');
      if (result?.id && !result.duplicate) {
        clearTimeout(syncTimersRef.current[result.id]);
        syncTimersRef.current[result.id] = setTimeout(() => {
          delete syncTimersRef.current[result.id];
          setSyncStates((prev) => ({ ...prev, [result.id]: 'completed' }));
          setFeedback((current) =>
            current?.area === areaId && current?.tone === 'progress'
              ? {
                  area: areaId,
                  tone: 'status',
                  text: uploadSuccessMessage(result, file.name, title),
                  syncCompleted: true,
                }
              : current,
          );
        }, 1200);
      } else {
        setFeedback({
          area: areaId,
          tone: 'status',
          text: uploadSuccessMessage(result, file.name, title),
          syncCompleted: Boolean(result?.id),
        });
      }
    } catch (err) {
      if (err.name === 'AbortError' || abort.signal.aborted) return;
      if (errorNeedsRefresh(err)) await onRefresh();
      const message = knowledgeErrorMessage(err, 'upload');
      if (err.code === 'DOCUMENT_NAME_INVALID' && areaId === additionalArea.id)
        setNameError(message);
      setFeedback({ area: areaId, tone: 'error', text: message });
    } finally {
      if (!abort.signal.aborted) {
        focusRef.current = 'upload-' + areaId;
        setBusy(null);
      }
    }
  }

  async function move(document, fromId) {
    const to = moveTarget;
    if (!to || busy) return;
    const label = documentLabel(document);
    setBusy({ kind: 'move', id: document.id });
    try {
      await api.moveDocument(document.id, to);
      await onRefresh();
      setPending(null);
      setFeedback({
        area: to,
        tone: 'status',
        text: moveSuccessMessage(label, areaTitle(view, to)),
      });
      focusRef.current = 'doc-' + document.id;
    } catch (err) {
      const gone = err.code === 'WORKSPACE_DOCUMENT_NOT_FOUND';
      if (errorNeedsRefresh(err)) await onRefresh();
      setPending(null);
      setFeedback({ area: fromId, tone: 'error', text: knowledgeErrorMessage(err, 'move') });
      focusRef.current = gone ? 'area-' + fromId : 'move-' + document.id;
    } finally {
      setBusy(null);
    }
  }

  async function remove(document, areaId) {
    if (busy) return;
    const label = documentLabel(document);
    setBusy({ kind: 'remove', id: document.id });
    try {
      await api.remove(document.id);
      await onRefresh();
      setPending(null);
      setFeedback({ area: areaId, tone: 'status', text: removeSuccessMessage(label) });
      focusRef.current = 'area-' + areaId;
    } catch (err) {
      const gone = err.code === 'WORKSPACE_DOCUMENT_NOT_FOUND';
      if (errorNeedsRefresh(err)) await onRefresh();
      setPending(null);
      setFeedback({ area: areaId, tone: 'error', text: knowledgeErrorMessage(err, 'remove') });
      focusRef.current = gone ? 'area-' + areaId : 'remove-' + document.id;
    } finally {
      setBusy(null);
    }
  }

  function documentRow(document, area) {
    const titleId = 'gd-doc-title-' + document.id;
    const step = pending?.id === document.id ? pending.action : '';
    const options = moveOptions(view.areas, area.id);
    const meta = [document.fileName, formatCharacters(document.characters)].filter(Boolean);
    const syncState = documentSyncState(syncStates, document.id);
    const docClass =
      'gd-doc' +
      (syncState === 'syncing'
        ? ' is-syncing'
        : syncState === 'completed'
          ? ' is-sync-completed'
          : '');
    return (
      <li
        className={docClass}
        key={document.id}
        tabIndex={-1}
        data-focus={'doc-' + document.id}
        data-document-id={document.id}
        data-sync-state={syncState || undefined}
      >
        <div className="gd-doc-text">
          <strong id={titleId}>{documentLabel(document)}</strong>
          <small>{meta.join(' · ')}</small>
          {syncState && (
            <span
              className={
                'gd-sync-badge ' + (syncState === 'syncing' ? 'is-syncing' : 'is-completed')
              }
              role="status"
            >
              <Icon name={syncState === 'syncing' ? 'clock' : 'check'} size={13} />
              {syncState === 'syncing' ? text.syncingStatus : text.syncCompletedStatus}
            </span>
          )}
        </div>
        {step === 'move' ? (
          <div
            className="gd-step"
            role="group"
            aria-labelledby={titleId}
            onKeyDown={(event) => onStepKey(event, document, 'move')}
          >
            <label htmlFor={'gd-move-' + document.id}>{text.moveLabel}</label>
            <select
              id={'gd-move-' + document.id}
              data-focus={'move-select-' + document.id}
              value={moveTarget}
              disabled={!!busy}
              onChange={(event) => setMoveTarget(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="gd-step-actions">
              <button
                type="button"
                className="gd-doc-action primary"
                disabled={!!busy || !moveTarget}
                onClick={() => move(document, area.id)}
              >
                {busy?.kind === 'move' && busy.id === document.id ? 'Moving…' : text.moveConfirm}
              </button>
              <button
                type="button"
                className="gd-doc-action"
                disabled={!!busy}
                onClick={() => closeStep(document, 'move')}
              >
                {text.cancel}
              </button>
            </span>
          </div>
        ) : step === 'remove' ? (
          <div
            className="gd-step"
            role="group"
            aria-labelledby={titleId}
            aria-describedby={'gd-remove-text-' + document.id}
            onKeyDown={(event) => onStepKey(event, document, 'remove')}
          >
            <span id={'gd-remove-text-' + document.id} className="gd-step-text">
              {text.confirmRemove}
            </span>
            <span className="gd-step-actions">
              <button
                type="button"
                className="gd-doc-action danger"
                disabled={!!busy}
                onClick={() => remove(document, area.id)}
              >
                {busy?.kind === 'remove' && busy.id === document.id
                  ? 'Removing…'
                  : text.confirmRemoveAction}
              </button>
              <button
                type="button"
                className="gd-doc-action"
                data-focus={'keep-' + document.id}
                disabled={!!busy}
                onClick={() => closeStep(document, 'remove')}
              >
                {text.keep}
              </button>
            </span>
          </div>
        ) : (
          <div className="gd-doc-actions">
            <button
              type="button"
              className="gd-doc-action"
              data-focus={'move-' + document.id}
              aria-describedby={titleId}
              disabled={!!busy}
              onClick={() => openStep(document, 'move', options)}
            >
              {text.moveAction}
            </button>
            <button
              type="button"
              className="gd-doc-action"
              data-focus={'remove-' + document.id}
              aria-describedby={titleId}
              disabled={!!busy}
              onClick={() => openStep(document, 'remove')}
            >
              {text.removeAction}
            </button>
          </div>
        )}
      </li>
    );
  }

  function areaCard(area) {
    const extra = area.id === additionalArea.id;
    const headingId = 'gd-area-' + area.id;
    const uploading = busy?.kind === 'upload' && busy.area === area.id;
    return (
      <article
        className={'gd-area' + (area.empty ? ' is-empty' : '') + (extra ? ' is-extra' : '')}
        key={area.id}
        aria-labelledby={headingId}
      >
        <header className="gd-area-head">
          <span className="gd-area-icon">
            <Icon name={area.icon} size={20} />
          </span>
          {area.number > 0 && (
            <span className="gd-area-number" aria-hidden="true">
              {String(area.number).padStart(2, '0')}
            </span>
          )}
          <h3 id={headingId} tabIndex={-1} data-focus={'area-' + area.id}>
            {area.title}
          </h3>
          <p>{area.description}</p>
        </header>
        <div className={'gd-area-state' + (area.empty ? '' : ' is-ready')}>
          <Icon name={area.empty ? 'book' : 'check'} size={14} />
          {area.empty ? text.emptyArea : plural(area.documents.length)}
        </div>
        {(!area.empty || uploading) && (
          <ul className="gd-docs" aria-label={'Documents in ' + area.title}>
            {area.documents.map((document) => documentRow(document, area))}
            {uploading && (
              <li className="gd-doc is-syncing" data-sync-state="syncing">
                <div className="gd-doc-text">
                  <strong>{busy.title || busy.fileName}</strong>
                  <small>{busy.fileName}</small>
                  <span className="gd-sync-badge is-syncing" role="status">
                    <Icon name="clock" size={13} />
                    {text.syncingStatus}
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
        <div className="gd-area-foot">
          {extra && (
            <div className="gd-name-field">
              <label htmlFor="gd-extra-name">{text.nameLabel}</label>
              <input
                id="gd-extra-name"
                data-focus="extra-name"
                maxLength={80}
                value={extraName}
                onChange={(event) => {
                  setExtraName(event.target.value);
                  setNameError('');
                }}
                placeholder={text.namePlaceholder}
                autoComplete="off"
                disabled={!!busy}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'gd-extra-name-error' : undefined}
              />
              {nameError && (
                <p id="gd-extra-name-error" className="gd-field-error" role="alert">
                  {nameError}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            className={'hr-screen-button' + (area.empty ? ' primary' : '')}
            data-focus={'upload-' + area.id}
            disabled={!!busy || view.full}
            aria-describedby={view.full ? 'gd-limit' : undefined}
            onClick={() => pick(area.id)}
          >
            <Icon name="book" size={17} />
            {uploading ? text.uploading : extra ? text.addAnother : text.uploadAction}
          </button>
        </div>
        <Feedback item={feedback?.area === area.id ? feedback : null} />
      </article>
    );
  }

  return (
    <section className="gd-library" aria-labelledby="gd-heading" ref={rootRef}>
      <header className="gd-library-heading">
        <div>
          <span className="hr-kicker">THE ESSENTIALS</span>
          <h2 id="gd-heading">{text.heading}</h2>
          <p className="gd-intro">{text.intro}</p>
        </div>
        <p className="gd-completion">
          <strong>
            {view.connected}
            <span>/{view.total}</span>
          </strong>{' '}
          areas connected
        </p>
      </header>
      {view.full && (
        <p id="gd-limit" className="gd-limit" role="status">
          {text.limitReached}
        </p>
      )}
      <div className="gd-areas">
        {view.areas.map(areaCard)}
        {areaCard(view.additional)}
      </div>
      <footer className="gd-note">
        <Icon name="shield" size={17} />
        <span>
          {text.privacy} {view.documentCount} of {view.fileLimit} documents in use.
        </span>
      </footer>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={acceptAttribute}
        aria-label={text.chooseFile}
        onChange={upload}
      />
    </section>
  );
}
