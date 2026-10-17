import React, { useEffect, useRef, useState } from 'react';
import { isAnswered, unansweredIds } from './activity-model.mjs';

// One question at a time, then a review of unanswered questions, a final
// confirmation and a results page with feedback and retry. Answers in progress
// are saved as a draft (onDraft) shortly after each change, so leaving the page
// does not lose them. The score is only ever shown from the server's result.
function Question({ question, value, onChange, disabled }) {
  const picked = [].concat(value ?? []);
  if (question.type === 'match')
    return (
      <div className="qr-match">
        {question.pairs.map((pair) => (
          <label key={pair.id} className="qr-match-row">
            <span>{pair.text}</span>
            <select
              disabled={disabled}
              value={value?.[pair.id] || ''}
              onChange={(e) => onChange({ ...(value || {}), [pair.id]: e.target.value })}
            >
              <option value="">Choose…</option>
              {question.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  const toggle = (id) =>
    onChange(
      question.multiple
        ? picked.includes(id)
          ? picked.filter((x) => x !== id)
          : [...picked, id]
        : id,
    );
  return (
    <div className="qr-options" role={question.multiple ? 'group' : 'radiogroup'}>
      {question.options.map((option) => (
        <label
          key={option.id}
          className={'qr-option' + (picked.includes(option.id) ? ' picked' : '')}
        >
          <input
            type={question.multiple ? 'checkbox' : 'radio'}
            name={'q-' + question.id}
            disabled={disabled}
            checked={picked.includes(option.id)}
            onChange={() => toggle(option.id)}
          />
          <span>{option.text}</span>
        </label>
      ))}
    </div>
  );
}

export default function QuizRunner({
  questions,
  passingScore,
  initialAnswers = {},
  alreadyPassed = false,
  summary = null,
  onDraft,
  onSubmit,
  onExit,
  registerGuard,
  children,
}) {
  const [answers, setAnswers] = useState(initialAnswers);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState(alreadyPassed ? 'summary' : 'answer');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('idle'); // idle | pending | saving | saved | failed
  const latest = useRef({ answers, draft: 'idle', phase });
  latest.current = { answers, draft, phase };
  const first = useRef(true);

  // Autosave the draft shortly after every change.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (phase === 'results' || phase === 'summary') return;
    setDraft('pending');
    const timer = setTimeout(async () => {
      setDraft('saving');
      try {
        await onDraft(answers);
        setDraft('saved');
      } catch {
        setDraft('failed');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [answers]);

  const unsaved = ['pending', 'saving', 'failed'].includes(draft) && phase !== 'results';
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  // Leaving the page in the app (Back, a link) saves what is still pending.
  useEffect(
    () => () => {
      const { answers: current, draft: state, phase: where } = latest.current;
      if (['pending', 'failed'].includes(state) && where !== 'results')
        onDraft(current).catch(() => {});
    },
    [],
  );

  // The page's own Back button asks before leaving with unsaved answers.
  useEffect(() => {
    registerGuard?.(() =>
      unsaved ? window.confirm('Your latest answers have not been saved yet. Leave anyway?') : true,
    );
    return () => registerGuard?.(null);
  }, [unsaved]);

  const missing = unansweredIds(questions, answers);
  const question = questions[index];

  function leave() {
    if (unsaved && !window.confirm('Your latest answers have not been saved yet. Leave anyway?'))
      return;
    onExit();
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await onSubmit(answers);
      setResult(res);
      setDraft('idle');
      setPhase('results');
    } catch (e) {
      setError(e.message || 'Your answers could not be submitted. Please try again.');
      setPhase('review');
    } finally {
      setBusy(false);
    }
  }
  function again() {
    setAnswers({});
    setIndex(0);
    setResult(null);
    setError('');
    first.current = true;
    setPhase('answer');
  }

  if (!questions.length)
    return (
      <p role="status" className="fp-muted">
        No questions are configured for this activity yet (content requirement).
      </p>
    );

  if (phase === 'summary')
    return (
      <section className="qr-card" aria-live="polite">
        <h2>You passed this activity ✓</h2>
        {summary && <p>{summary}</p>}
        <div className="qr-actions">
          <button type="button" className="fp-action main" onClick={onExit}>
            Back to onboarding
          </button>
          <button type="button" className="fp-action" onClick={again}>
            Practise again
          </button>
        </div>
      </section>
    );

  if (phase === 'results') {
    const byId = Object.fromEntries(result.questionResults.map((r) => [r.id, r]));
    return (
      <section className="qr-card" aria-live="polite">
        <h2 className={result.passed ? 'qr-pass' : 'qr-fail'}>
          {result.passed ? 'Passed ✓' : 'Not passed yet'}
        </h2>
        <p className="qr-score">
          <strong>{result.score}%</strong> · pass mark {result.passingScore}% · attempt{' '}
          {result.attempts}
        </p>
        <p>{result.feedback}</p>
        <ol className="qr-results">
          {questions.map((item) => (
            <li key={item.id} className={byId[item.id]?.correct ? 'ok' : 'miss'}>
              <strong>{byId[item.id]?.correct ? '✓ Correct' : '✗ Not quite'}</strong>
              <span>{item.prompt}</span>
              {!byId[item.id]?.correct && byId[item.id]?.explanation && (
                <p className="qr-explain">{byId[item.id].explanation}</p>
              )}
            </li>
          ))}
        </ol>
        <div className="qr-actions">
          {result.passed ? (
            <button type="button" className="fp-action main" onClick={onExit}>
              Back to onboarding
            </button>
          ) : (
            <>
              <button type="button" className="fp-action main" onClick={again}>
                Try again
              </button>
              <button type="button" className="fp-action" onClick={onExit}>
                Back to onboarding
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  const draftLabel = {
    pending: 'Saving…',
    saving: 'Saving…',
    saved: 'Draft saved',
    failed: 'Draft not saved. We will retry when you change an answer.',
    idle: '',
  }[draft];

  return (
    <section className="qr-card">
      <header className="qr-head">
        <span className="qr-draft" role="status">
          {draftLabel}
        </span>
      </header>

      {phase === 'answer' && (
        <>
          <p className="qr-progress-label">
            Question {index + 1} of {questions.length}
            {missing.length > 0 && ` · ${missing.length} unanswered`}
          </p>
          <div
            className="qr-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={questions.length - missing.length}
            aria-label="Questions answered"
          >
            <span
              style={{
                width: ((questions.length - missing.length) / questions.length) * 100 + '%',
              }}
            />
          </div>
          <fieldset className="qr-question">
            <legend>{question.prompt}</legend>
            {question.multiple && <p className="fp-muted">Select all that apply.</p>}
            {question.type === 'match' && <p className="fp-muted">Match every item.</p>}
            <Question
              question={question}
              value={answers[question.id]}
              onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
            />
          </fieldset>
          {children}
          <div className="qr-actions">
            <button
              type="button"
              className="fp-action"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            {index < questions.length - 1 ? (
              <button type="button" className="fp-action main" onClick={() => setIndex(index + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="fp-action main" onClick={() => setPhase('review')}>
                Review answers
              </button>
            )}
            <button type="button" className="fp-action" onClick={() => setPhase('review')}>
              Review all
            </button>
          </div>
        </>
      )}

      {phase === 'review' && (
        <>
          <h2>Review your answers</h2>
          <ol className="qr-review">
            {questions.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="qr-review-row"
                  onClick={() => {
                    setIndex(i);
                    setPhase('answer');
                  }}
                >
                  <span>{item.prompt}</span>
                  <strong className={isAnswered(item, answers) ? 'ok' : 'miss'}>
                    {isAnswered(item, answers) ? 'Answered' : 'Not answered'}
                  </strong>
                </button>
              </li>
            ))}
          </ol>
          {missing.length > 0 && (
            <p role="alert" className="fp-inline-error">
              Answer all {questions.length} questions before submitting ({missing.length} left).
            </p>
          )}
          {error && (
            <p role="alert" className="fp-inline-error">
              {error}
            </p>
          )}
          <div className="qr-actions">
            <button type="button" className="fp-action" onClick={() => setPhase('answer')}>
              Keep editing
            </button>
            <button
              type="button"
              className="fp-action main"
              disabled={missing.length > 0 || busy}
              onClick={() => setPhase('confirm')}
            >
              Submit assessment
            </button>
          </div>
        </>
      )}

      {phase === 'confirm' && (
        <div role="alertdialog" aria-labelledby="qr-confirm-title" className="qr-confirm">
          <h2 id="qr-confirm-title">Submit your answers?</h2>
          <p>
            You will see your score straight away. The pass mark is {passingScore}%. If you do not
            pass, you can try again.
          </p>
          <div className="qr-actions">
            <button
              type="button"
              className="fp-action"
              disabled={busy}
              onClick={() => setPhase('review')}
            >
              Go back
            </button>
            <button type="button" className="fp-action main" disabled={busy} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit now'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
