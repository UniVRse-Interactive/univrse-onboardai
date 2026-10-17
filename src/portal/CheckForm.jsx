import React, { useEffect, useId, useRef, useState } from 'react';
import { journeyApi } from '../access/journey-api.mjs';
import {
  answerCounter,
  answerProblem,
  checkErrorView,
  checkResultView,
  checkView,
  positionedOptions,
  writtenBody,
  writtenLimit,
} from '../access/check-view.mjs';
import './footprint.css';

// Alya's question for a check step (contract v1.4), used in the dashboard's
// check dialog and inline on Alya's page after her briefing (#66).
//   choice:  the options in the order the server shuffled them, numbered by position;
//   written: the employee's own words, which Alya checks.
// A pass marks the step done (onPassed); otherwise Alya explains and the
// employee can try again, with a written answer kept in the box.
export default function CheckForm({
  step,
  onPassed,
  onCancel,
  cancelLabel = 'Not now',
  showStepTitle = true,
}) {
  const [check, setCheck] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [choice, setChoice] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState({ field: '', message: '' });
  const alive = useRef(true);
  const groupName = useId(),
    answerId = useId(),
    counterId = useId(),
    privacyId = useId(),
    fieldErrorId = useId();
  useEffect(() => {
    alive.current = true;
    journeyApi
      .check(step.id)
      .then((data) => alive.current && setCheck(data))
      .catch((err) => alive.current && setLoadError(err));
    return () => {
      alive.current = false;
    };
  }, [step.id]);
  const view = checkView({ check, error: loadError, result, busy });
  const written = view.type === 'written';
  const max = writtenLimit(check);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (written) {
      const tooShortOrLong = answerProblem(answer, max);
      if (tooShortOrLong) return setProblem({ field: tooShortOrLong, message: '' });
    } else if (!choice) return;
    setBusy(true);
    setProblem({ field: '', message: '' });
    try {
      const data = written
        ? await journeyApi.answerWrittenCheck(step.id, writtenBody(answer).answer)
        : await journeyApi.answerCheck(step.id, choice);
      if (!alive.current) return;
      setResult(data);
      if (data.correct) onPassed?.(data.onboarding);
    } catch (err) {
      // The written answer stays in the box whatever went wrong.
      if (alive.current) setProblem(checkErrorView(err, view.type));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const message = result ? checkResultView(result, view.type) : null;
  const describedBy = [counterId, privacyId, problem.field ? fieldErrorId : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={'fp-check' + (written ? ' is-written' : '')}>
      {showStepTitle && <p className="fp-check-step">{step.title}</p>}
      {loadError && (
        <p className="fp-inline-error" role="alert">
          {checkErrorView(loadError).message}
        </p>
      )}
      {view.phase === 'loading' && <p role="status">Getting your question…</p>}
      {check && view.showForm && (
        <form onSubmit={submit} noValidate>
          <p className="fp-check-scenario">{check.scenario}</p>
          {written ? (
            <div className="fp-written">
              <label htmlFor={answerId}>Your answer</label>
              <textarea
                id={answerId}
                rows={6}
                maxLength={max}
                value={answer}
                disabled={busy}
                aria-describedby={describedBy}
                aria-invalid={problem.field ? true : undefined}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  if (problem.field) setProblem({ field: '', message: '' });
                }}
              />
              <p className="fp-written-meta">
                <span id={privacyId}>{view.privacy}</span>
                <span id={counterId}>{answerCounter(answer, max)}</span>
              </p>
              {problem.field && (
                <p className="fp-field-error" id={fieldErrorId}>
                  {problem.field}
                </p>
              )}
            </div>
          ) : (
            <fieldset className="fp-check-options">
              <legend>What would you do?</legend>
              {positionedOptions(check).map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={groupName}
                    value={option.id}
                    checked={choice === option.id}
                    onChange={() => {
                      setChoice(option.id);
                      setResult(null);
                    }}
                  />
                  <span className="fp-option-number" aria-hidden="true">
                    {option.position}
                  </span>
                  <span>{option.text}</span>
                </label>
              ))}
            </fieldset>
          )}
          {check.sourceTitle && <p className="fp-muted">Based on: {check.sourceTitle}</p>}
          {problem.message && (
            <p className="fp-inline-error" role="alert">
              {problem.message}
            </p>
          )}
          <div className="uv-form-actions">
            {onCancel && (
              <button type="button" className="uv-button secondary" onClick={onCancel}>
                {cancelLabel}
              </button>
            )}
            <button
              className="uv-button primary"
              disabled={busy || (written ? !answer.trim() : !choice)}
            >
              {view.submitLabel}
            </button>
          </div>
        </form>
      )}
      <div role="status" aria-live="polite">
        {view.status && <p className="fp-check-checking">{view.status}</p>}
        {message && !busy && (
          <div className={'fp-check-result ' + message.tone}>
            <strong>{message.title}</strong>
            {message.feedback && <p>{message.feedback}</p>}
            {message.explanation && <p>{message.explanation}</p>}
            {message.hint && <p className="fp-muted">{message.hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
