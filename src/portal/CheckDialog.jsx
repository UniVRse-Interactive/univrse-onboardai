import React, { useState } from 'react';
import UvDialog from './UvDialog';
import CheckForm from './CheckForm';

// The dashboard's shortcut to a check, once Alya's briefing is done: the same
// question as on Alya's page, in a dialog with "Not now" and, after a pass, "Done".
export default function CheckDialog({ step, onClose, onPassed }) {
  const [passed, setPassed] = useState(false);
  return (
    <UvDialog
      title="A quick check with Alya"
      onClose={onClose}
      fallbacks={[`[data-step-status="${step.id}"]`, '#fp-title']}
    >
      <CheckForm
        step={step}
        onCancel={passed ? null : onClose}
        onPassed={(onboarding) => {
          setPassed(true);
          onPassed(onboarding);
        }}
      />
      {passed && (
        <div className="uv-form-actions fp-check-done">
          <button type="button" className="uv-button primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </UvDialog>
  );
}
