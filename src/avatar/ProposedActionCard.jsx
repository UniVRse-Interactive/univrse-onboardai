import React from 'react';
import {
  actionIsPending,
  actionPrompt,
  actionResolvedText,
  decisionLabels,
} from '../access/support-flow.mjs';

// F5: Alya proposes a change to the employee's checklist and waits for a yes.
export default function ProposedActionCard({ action, busy, error, onDecide }) {
  const pending = actionIsPending(action);
  return (
    <div className="alya-action-card" role="group" aria-label="Alya’s suggestion">
      {pending ? (
        <>
          <p>{actionPrompt(action)}</p>
          <div className="alya-action-buttons">
            <button type="button" disabled={busy} onClick={() => onDecide('approve')}>
              {decisionLabels.approve}
            </button>
            <button type="button" disabled={busy} onClick={() => onDecide('decline')}>
              {decisionLabels.decline}
            </button>
          </div>
        </>
      ) : (
        <p className="alya-action-resolved" role="status">
          {actionResolvedText(action)}
        </p>
      )}
      {error && (
        <p className="alya-action-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
