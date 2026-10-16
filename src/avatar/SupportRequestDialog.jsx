import React, { useEffect, useId, useRef, useState } from 'react';
import UvDialog from '../portal/UvDialog';
import { journeyApi } from '../access/journey-api.mjs';
import {
  NOTE_MAX,
  noteCounter,
  noteProblem,
  previewErrorMessage,
  previewView,
  requestBody,
  sendErrorView,
  sentMessage,
} from '../access/support-flow.mjs';

// The consent step before anything reaches HR: shows exactly the question,
// Alya's answer and its sources, with an optional note. Nothing is sent until
// the employee chooses Send to HR.
export default function SupportRequestDialog({ conversationId, message, onClose, onSent }) {
  const [phase, setPhase] = useState('loading');
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const [noteError, setNoteError] = useState('');
  const alive = useRef(true);
  const doneRef = useRef(null);
  const noteId = useId();
  useEffect(() => {
    alive.current = true;
    journeyApi
      .previewSupportRequest({ conversationId, messageId: message.id })
      .then((data) => {
        if (!alive.current) return;
        setPreview(previewView(data));
        setPhase('review');
      })
      .catch((err) => {
        if (!alive.current) return;
        setError(previewErrorMessage(err));
        setPhase('failed');
      });
    return () => {
      alive.current = false;
    };
  }, [conversationId, message.id]);
  useEffect(() => {
    if (phase === 'sent') doneRef.current?.focus();
  }, [phase]);
  const problem = noteProblem(note) || noteError;
  async function send(event) {
    event.preventDefault();
    if (problem || phase !== 'review') return;
    setPhase('sending');
    setError('');
    try {
      const body = requestBody({ conversationId, messageId: message.id, note });
      const data = await journeyApi.createSupportRequest(body);
      if (!alive.current) return;
      setSent({ request: data.request });
      setPhase('sent');
      onSent(message.id, data.request);
    } catch (err) {
      if (!alive.current) return;
      const view = sendErrorView(err);
      setNoteError(view.note);
      setError(view.message);
      setPhase('review');
    }
  }
  return (
    <UvDialog
      title="Ask HR to follow up"
      onClose={onClose}
      wide
      className="sr-dialog"
      fallbacks={[`[data-ask-hr-status="${message.id}"]`]}
    >
      <div className="sr-body">
        {phase === 'loading' && <p role="status">Getting your request ready…</p>}
        {phase === 'failed' && (
          <p className="sr-error" role="alert">
            {error}
          </p>
        )}
        {(phase === 'review' || phase === 'sending') && preview && (
          <form onSubmit={send}>
            <p className="sr-lead">
              This is exactly what HR will see. Nothing is shared until you choose Send to HR.
            </p>
            <dl className="sr-preview">
              <div>
                <dt>Your question</dt>
                <dd>{preview.question}</dd>
              </div>
              <div>
                <dt>Alya’s answer</dt>
                <dd>{preview.answer}</dd>
              </div>
              <div>
                <dt>Sources</dt>
                <dd>
                  {preview.sources.length ? (
                    <ul>
                      {preview.sources.map((source) => (
                        <li key={source}>{source}</li>
                      ))}
                    </ul>
                  ) : (
                    'No company sources were used.'
                  )}
                </dd>
              </div>
            </dl>
            <div className="sr-note">
              <label htmlFor={noteId}>Add a note for HR (optional)</label>
              <textarea
                id={noteId}
                rows={3}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteError('');
                }}
                aria-invalid={problem ? true : undefined}
                aria-describedby={noteId + '-count'}
              />
              <p id={noteId + '-count'} className={problem ? 'sr-error-text' : ''}>
                <span>{problem || `Up to ${NOTE_MAX} characters.`}</span>
                <span>{noteCounter(note)}</span>
              </p>
            </div>
            {error && (
              <p className="sr-error" role="alert">
                {error}
              </p>
            )}
            <div className="uv-form-actions">
              <button type="button" className="uv-button secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="uv-button primary" disabled={!!problem || phase === 'sending'}>
                {phase === 'sending' ? 'Sending…' : 'Send to HR'}
              </button>
            </div>
          </form>
        )}
        {phase === 'sent' && sent && (
          <div role="status" aria-live="polite">
            <p className="sr-lead">{sentMessage(sent.request)}</p>
            <p className="sr-hint">
              You can follow it under “Your requests to HR” on your dashboard.
            </p>
            <div className="uv-form-actions">
              <button type="button" className="uv-button primary" ref={doneRef} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
        {phase === 'failed' && (
          <div className="uv-form-actions">
            <button type="button" className="uv-button secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </UvDialog>
  );
}
