import React, { useEffect } from 'react';
import { PasswordField } from './LoginPage';

// Moves focus to the first invalid input (or the error summary) after a failed submit.
export function useFocusFirstError(formRef, errors, summaryRef, summary) {
  useEffect(() => {
    const hasFieldError = Object.keys(errors || {}).length > 0;
    if (!hasFieldError && !summary) return;
    const frame = requestAnimationFrame(() => {
      const invalid = hasFieldError && formRef.current?.querySelector('[aria-invalid="true"]');
      (invalid || summaryRef?.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [errors, summary]);
}

export function FieldError({ id, message }) {
  return message ? (
    <p className="account-field-error" id={id}>
      {message}
    </p>
  ) : null;
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete = 'off',
  required = false,
  maxLength,
  inputMode,
  readOnly = false,
  describedBy = '',
  fromDocument = false,
  note = '',
}) {
  const hintId = hint ? id + '-hint' : '';
  const errorId = error ? id + '-error' : '';
  const markId = fromDocument ? id + '-mark' : '';
  const noteId = note ? id + '-note' : '';
  const described =
    [hintId, errorId, markId, noteId, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <div className="access-field account-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="account-required"> (required)</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="off"
        spellCheck={false}
        maxLength={maxLength}
        inputMode={inputMode}
        readOnly={readOnly}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
      />
      {hint && (
        <p className="account-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
      {fromDocument && (
        <p className="account-field-mark" id={markId}>
          From document, please check
        </p>
      )}
      {note && (
        <p className="account-field-note" id={noteId}>
          {note}
        </p>
      )}
    </div>
  );
}

export function SecretField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  confirm = false,
  hint,
}) {
  const errorId = error ? id + '-error' : undefined;
  const hintId = hint ? id + '-hint' : undefined;
  return (
    <div className="account-field">
      <PasswordField
        id={id}
        label={label}
        confirm={confirm}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        describedBy={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        invalid={!!error}
        placeholder=" "
        maxLength={200}
        name={id}
      />
      {hint && (
        <p className="account-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
