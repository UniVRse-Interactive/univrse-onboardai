import React from 'react';
import { FieldError } from './account-fields';
import {
  departmentOptions,
  departmentPlaceholder,
  idFormatHint,
  selectedDepartment,
} from './employee-departments.mjs';

// Department <select>. `legacy` is the stored text of an employee being edited
// (shown as an extra "(current)" option when it is not one of the six).
// `showIdHint` adds the "IDs look like PE-0001" hint on the add form.
export default function DepartmentField({
  id,
  label,
  value,
  onChange,
  error,
  required,
  legacy = '',
  showIdHint = false,
  fromDocument = false,
  note = '',
}) {
  const hint = showIdHint ? idFormatHint(value) : '';
  const hintId = hint ? id + '-hint' : '';
  const errorId = error ? id + '-error' : '';
  const markId = fromDocument ? id + '-mark' : '';
  const noteId = note ? id + '-note' : '';
  const described = [hintId, errorId, markId, noteId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="access-field account-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="account-required"> (required)</span>}
      </label>
      <select
        id={id}
        name={id}
        className="account-select"
        value={selectedDepartment(value, legacy)}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
      >
        <option value="">{departmentPlaceholder}</option>
        {departmentOptions(legacy).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
