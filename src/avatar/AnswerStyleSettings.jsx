import React, { useState } from 'react';
import Icon from '../portal/Icon';

export const learningFormats = {
  standard: 'Clear explanation',
  steps: 'Step by step',
  example: 'Worked example',
  brief: 'Brief answer',
};
const reasons = {
  default: 'A clear explanation with useful details.',
  'employee-choice': 'Using the explanation format you selected.',
  'explanation-request': 'Showing smaller steps because you asked for another explanation.',
  'example-request': 'Using an example because you asked for one.',
  'brief-request': 'Keeping the answer brief because you requested it.',
  'revisited-topic': 'We revisited this topic, so Alya is showing it in smaller steps.',
  understood: 'Returning to the usual explanation after you said you understood.',
};

export default function AnswerStyleSettings({ learning, disabled, onSettings, onClose }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div
      className="alya-learning-panel"
      id="alya-learning-options"
      aria-label="Answer style settings"
    >
      <header>
        <strong>Answer style.</strong>
        <button aria-label="Close answer style settings" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      <p>
        Alya adjusts explanations from your requests and revisited topics. You can change the format
        anytime.
      </p>
      <label htmlFor="alya-teaching-format">Explanation format</label>
      <select
        id="alya-teaching-format"
        value={learning?.preference || 'auto'}
        disabled={disabled}
        onChange={(e) => onSettings({ preference: e.target.value })}
      >
        <option value="auto">Automatic support</option>
        {Object.entries(learningFormats).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <div className="alya-learning-reason" role="status">
        <Icon name="info" size={13} />
        <span>
          <strong>{learningFormats[learning?.format] || learningFormats.standard}</strong>
          {reasons[learning?.reason] || reasons.default}
        </span>
      </div>
      {confirmReset ? (
        <div className="alya-delete-confirm">
          <p>Reset the answer style? Your chat history stays saved.</p>
          <button
            disabled={disabled}
            onClick={() => {
              onSettings({ reset: true });
              setConfirmReset(false);
            }}
          >
            Reset answer style
          </button>
          <button onClick={() => setConfirmReset(false)}>Keep settings</button>
        </div>
      ) : (
        <button
          className="alya-learning-reset"
          disabled={disabled}
          onClick={() => setConfirmReset(true)}
        >
          Reset answer style
        </button>
      )}
    </div>
  );
}
