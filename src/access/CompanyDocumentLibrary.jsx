import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { reportDate } from '../avatar/hr-support-report.mjs';
import { workspaceRequest } from './guest-workspace-api';
import { companyKnowledgeStatus } from './company-knowledge-status.mjs';

export default function CompanyDocumentLibrary({ workspace, onRefresh }) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const abortRef = useRef(null);
  const knowledge = companyKnowledgeStatus(
    workspace.companyKnowledge?.drive,
    workspace.documents.length,
  );
  const totalDocuments = workspace.documents.length;
  useEffect(() => () => abortRef.current?.abort(), []);
  async function upload(files) {
    if (!files.length || busy) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setError('');
    let added = 0;
    try {
      for (const file of files) {
        if (file.size > workspace.limits.bytes)
          throw new Error(file.name + ' is larger than 5 MB.');
        setStatus('Preparing ' + file.name + '…');
        const result = await workspaceRequest('/documents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
          signal: abort.signal,
        });
        if (!result.duplicate) added++;
      }
      setStatus(
        added
          ? `${added} ${added === 1 ? 'document is' : 'documents are'} ready for Alya’s next answer.`
          : 'These documents are already in your library.',
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setStatus(added ? added + ' uploaded before this file.' : '');
      }
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        onRefresh();
      }
    }
  }
  async function remove(document) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await workspaceRequest('/documents/' + document.id, { method: 'DELETE' });
      setStatus(
        'Document removed. Saved answers are unchanged; new answers use the remaining files.',
      );
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hr-knowledge" id="company-documents" aria-labelledby="hr-knowledge-title">
      <div className="hr-knowledge-intro">
        <span className="access-eyebrow">02 / COMPANY KNOWLEDGE</span>
        <h2 id="hr-knowledge-title">Company documents.</h2>
        <p>
          Add the guidance employees need. Alya uses the readable text in these files and shows its
          sources in the answer.
        </p>
        <label className="hr-upload-field">
          <Icon name="book" size={20} />
          <strong>Add company documents</strong>
          <span>PDF, Word (.docx), TXT or Markdown · 5 MB each</span>
          <input
            type="file"
            aria-label="Upload company documents"
            accept=".pdf,.docx,.txt,.md"
            multiple
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files);
              event.target.value = '';
              upload(files);
            }}
          />
        </label>
        <small>
          Up to 12 files. Text-based PDFs only; scanned pages need a readable text copy.
        </small>
      </div>
      <div className="hr-library">
        <header>
          <h3>
            Your document library{' '}
            <span>
              {totalDocuments} {totalDocuments === 1 ? 'document' : 'documents'}
            </span>
          </h3>
          <span className="hr-ready-indicator">
            <i /> {busy ? 'Updating' : knowledge.indicator}
          </span>
        </header>
        {knowledge.searchConnected && (
          <section className="hr-drive-library" aria-label="Shared company document search">
            <h4>
              Company document search <span>Connected</span>
            </h4>
            <p>
              Alya searches your shared company documents (Vertex AI Search) when answering. Uploads
              below add to them.
            </p>
          </section>
        )}
        {knowledge.unavailable && (
          <p className="hr-workspace-error" role="alert">
            {knowledge.warning}
          </p>
        )}
        {workspace.documents.length ? (
          <section className="hr-upload-library" aria-label="Uploaded company documents">
            <h4>
              Website uploads{' '}
              <span>
                {workspace.documents.length} / {workspace.limits.files}
              </span>
            </h4>
            <ul className="hr-document-list">
              {workspace.documents.map((document) => (
                <li key={document.id}>
                  <span className="hr-file-type">
                    {document.title.split('.').at(-1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{document.title}</strong>
                    <small>
                      {document.characters.toLocaleString()} characters · Added{' '}
                      {reportDate(document.created)}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    aria-label={'Remove ' + document.title}
                    onClick={() => remove(document)}
                  >
                    <Icon name="close" size={16} />
                    <span>Remove</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="hr-library-empty">
            <Icon name="book" size={30} />
            <h3>
              {knowledge.searchConnected
                ? 'Add more company guidance.'
                : 'Your company guidance starts here.'}
            </h3>
            <p>Upload additional guidance for employees to ask Alya about.</p>
          </div>
        )}
        {status && (
          <p className="hr-library-status" role="status">
            <Icon name="check" size={15} />
            {status}
          </p>
        )}
        {error && (
          <p className="hr-workspace-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
