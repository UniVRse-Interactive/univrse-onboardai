import React, { useEffect, useRef, useState, useCallback } from 'react';
import { submissionsApi } from './submissions-api.mjs';
import { Status, SubmissionDetail, dateLabel } from './SubmissionParts';
import { fileProblem, fileSize, fileExtension } from '../../shared/document-submissions.mjs';
import './documents.css';
import './dashboard-documents.css';

export function useDashboardDocuments() {
  const [data, setData] = useState({ submissions: [], available: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const live = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const result = await submissionsApi.list(false);
      if (live.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(visible, 30000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return { ...data, error, loading, refresh };
}

export function DocumentSectionNotice({ documents }) {
  const [detail, setDetail] = useState(null);
  const earlier = documents.submissions.filter((item) => !item.stepId);
  return (
    <div className="fp-doc-notice">
      <p>
        {documents.loading
          ? 'Loading document submissions…'
          : documents.temporary
            ? 'Local preview: sample documents and uploads are temporary and reset when the preview server restarts. Use sample files only.'
            : documents.available
              ? 'Upload supporting documents below. HR document reviews are separate from your onboarding checklist verification.'
              : 'Uploads are unavailable until private document storage is configured.'}
      </p>
      {documents.error && <p role="alert">{documents.error}</p>}
      <button type="button" className="fp-action" onClick={documents.refresh}>
        Refresh document status
      </button>
      {!!earlier.length && (
        <details>
          <summary>Earlier submissions ({earlier.length})</summary>
          <p>These documents were submitted before dashboard step linking.</p>
          {earlier.map((item) => (
            <button
              type="button"
              className="fp-action"
              key={item.id}
              onClick={() => setDetail(item)}
            >
              {item.title} · {item.status}
            </button>
          ))}
        </details>
      )}
      {detail && <SubmissionDetail item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

export default function DashboardDocumentUpload({ step, documents }) {
  const records = documents.submissions.filter((item) => item.stepId === step.id);
  const latest = records[0];
  const [editing, setEditing] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const input = useRef(null);
  function select(candidate) {
    setMessage('');
    const problem = fileProblem(candidate || { name: '', size: 0 });
    setError(problem || '');
    setFile(problem ? null : candidate);
  }
  async function submit(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await submissionsApi.submit(
        {
          stepId: step.id,
          title: step.title,
          type:
            step.id === 'documentation.tax-id-documents'
              ? 'Identification Document'
              : 'Employment Documents',
          resubmissionOf: latest?.status === 'Rejected' ? latest.id : undefined,
        },
        file,
      );
      setFile(null);
      setEditing(false);
      setMessage('Document submitted. Pending HR review.');
      await documents.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fp-document" data-document-step={step.id}>
      <div className="fp-document-header">
        <div>
          <small>SUPPORTING DOCUMENT</small>
          {latest ? (
            <>
              <strong>{latest.fileName}</strong>
              <span>
                {dateLabel(latest.submittedAt)} · {fileSize(latest.bytes)}
              </span>
            </>
          ) : (
            <span>No document submitted yet</span>
          )}
        </div>
        {latest && <Status status={latest.status} />}
        {latest && (
          <button type="button" className="fp-action" onClick={() => setDetail(latest)}>
            View document
          </button>
        )}
        {!editing && (
          <button
            type="button"
            className="fp-action main"
            disabled={documents.loading || !documents.available}
            onClick={() => {
              setEditing(true);
              setMessage('');
            }}
          >
            {latest?.status === 'Rejected'
              ? 'Upload corrected document'
              : latest
                ? 'Upload another file'
                : 'Upload document'}
          </button>
        )}
      </div>
      {latest?.remarks && (
        <p className="fp-document-remarks">
          <strong>HR remarks:</strong> {latest.remarks}
        </p>
      )}
      {editing && (
        <form onSubmit={submit} aria-label={'Upload for ' + step.title}>
          <div
            className="fp-document-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) {
                if (e.dataTransfer.files.length !== 1) setError('Choose one file at a time.');
                else select(e.dataTransfer.files[0]);
              }
            }}
          >
            <label>
              Choose a file or drop it here
              <input
                ref={input}
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files[0]) select(e.target.files[0]);
                }}
              />
            </label>
            <small>PDF, DOCX, JPG or PNG · Up to 5 MB per file</small>
            {file && (
              <div className="fp-selected-file">
                <strong>{file.name}</strong>
                <span>
                  {fileExtension(file.name).toUpperCase()} · {fileSize(file.size)}
                </span>
                <button
                  type="button"
                  className="fp-action"
                  disabled={busy}
                  onClick={() => input.current.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="fp-action"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    input.current.value = '';
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          <div className="fp-document-buttons">
            <button className="fp-action main" disabled={!file || busy}>
              {busy
                ? 'Uploading…'
                : latest?.status === 'Rejected'
                  ? 'Resubmit to HR'
                  : 'Submit to HR'}
            </button>
            <button
              type="button"
              className="fp-action"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setFile(null);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="fp-inline-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {records.length > 1 && (
        <details className="fp-document-history">
          <summary>Submission history ({records.length})</summary>
          {records.map((item) => (
            <button
              type="button"
              className="fp-action"
              key={item.id}
              onClick={() => setDetail(item)}
            >
              {item.fileName} · {dateLabel(item.submittedAt)} · {item.status}
            </button>
          ))}
        </details>
      )}
      {detail && (
        <SubmissionDetail
          item={detail}
          onClose={() => setDetail(null)}
          onResubmit={detail.id === latest?.id ? () => setEditing(true) : undefined}
        />
      )}
    </div>
  );
}
