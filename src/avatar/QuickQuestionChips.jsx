import React from 'react';

// Suggested questions near the composer. Tapping one sends it with its id.
export default function QuickQuestionChips({ chips, disabled, onPick }) {
  if (!chips.length) return null;
  return (
    <div className="alya-chips" role="group" aria-label="Suggested questions">
      {chips.map((chip) => (
        <button key={chip.id} type="button" disabled={disabled} onClick={() => onPick(chip)}>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
