import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { accountApi } from './account-api.mjs';
import {
  autofillAccept,
  autofillDisabledNote,
  autofillErrorMessage,
  autofillPrivacyNote,
  autofillSummary,
  checkAutofillFile,
  clearFieldMarks,
  droppedLabels,
  emptyAutofillState,
  markFilled,
  mergeAutofill,
  warningNotes,
} from './profile-autofill.mjs';

// State for one panel. `form`/`setForm` are the profile form; the hook fills
// only empty fields and tracks which ones came from the document.
export function useProfileAutofill(form, setForm) {
  const [marksState, setMarksState] = useState(emptyAutofillState);
  const [reading, setReading] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const formRef = useRef(form),
    abortRef = useRef(null),
    alive = useRef(true);
  formRef.current = form;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function run(file) {
    const problem = checkAutofillFile(file);
    setSummary('');
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const abort = new AbortController();
    abortRef.current = abort;
    setReading(file.name);
    try {
      const result = await accountApi.autofillProfile(file, abort.signal);
      if (!alive.current) return;
      const merged = mergeAutofill(formRef.current, result);
      const notes = warningNotes(result.warnings, merged.form);
      setForm(merged.form);
      setMarksState((previous) => markFilled(previous, merged.filled, notes));
      setSummary(
        autofillSummary({
          ...merged,
          fileName: file.name,
          dropped: droppedLabels(result.warnings, merged.form),
        }),
      );
    } catch (err) {
      if (!alive.current) return;
      if (err?.name === 'AbortError') setError('Cancelled. Nothing was filled in.');
      else setError(autofillErrorMessage(err));
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      if (alive.current) setReading('');
    }
  }
  return {
    marks: marksState.marks,
    notes: marksState.notes,
    reading,
    error,
    summary,
    run,
    cancel: () => abortRef.current?.abort(),
    edited: (path) => setMarksState((previous) => clearFieldMarks(previous, path)),
  };
}

export default function AutofillControl({ idPrefix, enabled, autofill }) {
  const { reading, error, summary, run, cancel } = autofill;
  const inputRef = useRef(null),
    summaryRef = useRef(null),
    errorRef = useRef(null);
  useEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const inputId = `${idPrefix}-autofill`;
  const noteId = `${inputId}-note`;
  const disabled = !enabled || !!reading;
  return (
    <div className="account-autofill">
      <div className="account-field">
        <label htmlFor={inputId}>Autofill from document</label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={autofillAccept}
          disabled={disabled}
          aria-describedby={noteId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) run(file);
          }}
        />
        <p className="account-field-hint" id={noteId}>
          {enabled ? autofillPrivacyNote : autofillDisabledNote}
          {enabled && ' PDF, Word, text, Markdown, JPG or PNG, up to 5 MB.'}
        </p>
      </div>
      <div role="status" className="account-autofill-progress" hidden={!reading}>
        {reading && <span>Reading {reading} with Gemini…</span>}
        {reading && (
          <button type="button" className="account-link-button" onClick={cancel}>
            Cancel reading
          </button>
        )}
      </div>
      {error && (
        <div className="account-error-summary" role="alert" tabIndex={-1} ref={errorRef}>
          <Icon name="info" size={18} />
          <p>{error}</p>
        </div>
      )}
      <p
        role="status"
        className="account-autofill-summary"
        tabIndex={-1}
        ref={summaryRef}
        hidden={!summary}
      >
        {summary}
      </p>
    </div>
  );
}
