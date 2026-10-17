import React, { useEffect, useId, useRef } from 'react';
import Icon from '../portal/Icon';
import CheckForm from '../portal/CheckForm';
import {
  briefingAction,
  briefingRecordedText,
  briefingTitle,
  dashboardPath,
  opensInPage,
  recordedPhases,
  shouldFocusBriefingCard,
} from './briefing-flow.mjs';

// Alya's briefing on a required step (contract v1.5, #66), as a transcript
// entry. It is shown on this page only and never saved to the conversation.
// When the briefing is recorded, the step's own action appears below it:
// Mark as completed, Mark as submitted, or Alya's question for a check.
export default function BriefingEntry({
  message,
  briefing,
  voiceAvailable,
  onAction,
  onCheckPassed,
  onDashboard,
  onRetry,
  onHelpful,
}) {
  const titleId = useId(),
    cardTitleId = useId();
  const step = briefing?.step || { title: message.stepTitle };
  const phase = briefing?.phase || 'presenting';
  const action = briefingAction(step);
  const recorded = recordedPhases.includes(phase);
  const cardRef = useRef(null);
  // undefined until the first render, so a card that is there from the start
  // (a step briefed earlier) counts as appearing.
  const previous = useRef(undefined);
  // Move focus to the card when it appears and when the step is completed,
  // unless the employee is typing a follow-up question in the chat.
  useEffect(() => {
    const before = previous.current;
    previous.current = phase;
    const typing = document.activeElement?.id === 'alya-question';
    if (!cardRef.current || !shouldFocusBriefingCard({ before, phase, typing })) return;
    cardRef.current.focus({ preventScroll: false });
  }, [phase]);
  return (
    <article className="alya-message assistant alya-briefing" aria-labelledby={titleId}>
      <div className="alya-message-author">
        <span className="alya-message-mark">A</span>
        <strong>Alya</strong>
        <small>BRIEFING</small>
      </div>
      <div className="alya-answer-body">
        <h3 className="alya-briefing-title" id={titleId}>
          {briefingTitle(step)}
        </h3>
        <p>{message.text}</p>
        {message.source && <p className="alya-briefing-source">From: {message.source}</p>}
        <p className="alya-briefing-saved">This briefing isn’t saved in your chats.</p>
        <div className="alya-briefing-status" role="status">
          {phase === 'presenting' &&
            (voiceAvailable
              ? 'Listen to the end and your briefing is recorded.'
              : 'Step through the briefing on Alya’s stage. On the last page, choose “I’ve read the briefing”.')}
          {phase === 'recording' && 'Recording your briefing…'}
          {recorded &&
            (briefing.completion === 'earlier'
              ? 'You’ve already had this briefing.'
              : briefingRecordedText(briefing.completion))}
          {phase === 'completed' && briefing.doneText && <> {briefing.doneText}</>}
        </div>
        {!recorded && onHelpful && (
          <div className="alya-answer-feedback" aria-label="Feedback on this briefing">
            <span>Did this help?</span>
            <button type="button" disabled={phase === 'recording'} onClick={onHelpful}>
              <Icon name="check" size={13} />
              Helpful
            </button>
          </div>
        )}
        {briefing?.error && (
          <div className="alya-briefing-error" role="alert">
            <p>{briefing.error}</p>
            {phase === 'presenting' && onRetry && (
              <button type="button" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
        {recorded && (
          <section
            className={
              'alya-briefing-card' +
              (action.kind === 'check' && phase !== 'completed' ? ' is-check' : '')
            }
            ref={cardRef}
            tabIndex={-1}
            aria-labelledby={cardTitleId}
          >
            {phase === 'completed' || action.kind === 'none' ? (
              <>
                <h4 id={cardTitleId}>
                  {phase === 'completed' ? (
                    <>
                      <Icon name="check" size={15} />
                      {briefing.doneText}
                    </>
                  ) : (
                    action.text
                  )}
                </h4>
                {onDashboard && (
                  <a
                    href={dashboardPath}
                    className="alya-briefing-secondary"
                    onClick={(event) => {
                      if (!opensInPage(event)) return;
                      event.preventDefault();
                      onDashboard();
                    }}
                  >
                    Back to your dashboard
                  </a>
                )}
              </>
            ) : action.kind === 'check' ? (
              <>
                <h4 id={cardTitleId}>{action.label}</h4>
                <p className="alya-briefing-note">{action.note}</p>
                <CheckForm step={step} showStepTitle={false} onPassed={onCheckPassed} />
              </>
            ) : (
              <>
                <h4 id={cardTitleId}>
                  Next for <strong>{step.title}</strong>
                </h4>
                {action.note && <p className="alya-briefing-note">{action.note}</p>}
                <button type="button" disabled={phase === 'acting'} onClick={onAction}>
                  <Icon name="check" size={14} />
                  {phase === 'acting' ? 'Saving…' : action.label}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
