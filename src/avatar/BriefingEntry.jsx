import React, { useId } from 'react';
import Icon from '../portal/Icon';
import { briefingAction, briefingRecordedText, briefingTitle } from './briefing-flow.mjs';

// Alya's briefing on a required step (contract v1.5), as a transcript entry.
// It is shown on this page only and never saved to the conversation.
export default function BriefingEntry({
  message,
  briefing,
  voiceAvailable,
  onAction,
  onRetry,
  onHelpful,
}) {
  const titleId = useId();
  const step = briefing?.step || { title: message.stepTitle };
  const phase = briefing?.phase || 'presenting';
  const action = briefingAction(step);
  const recorded = ['done', 'acting', 'completed'].includes(phase);
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
        {recorded && phase !== 'completed' && (
          <div className="alya-briefing-card">
            {action.kind === 'none' ? (
              <p>{action.text}</p>
            ) : (
              <>
                <p>
                  Next for <strong>{step.title}</strong>
                </p>
                <button type="button" disabled={phase === 'acting'} onClick={onAction}>
                  {action.kind === 'check' && <Icon name="checklist" size={14} />}
                  {phase === 'acting' ? 'Saving…' : action.label}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
