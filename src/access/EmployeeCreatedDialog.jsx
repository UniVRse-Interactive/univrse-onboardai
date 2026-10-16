import React, { useEffect, useRef, useState } from 'react';
import { copyBothText, copyStatusMessage, copyToClipboard } from './employee-departments.mjs';
import './employee-created-dialog.css';

const focusable =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function selectContents(node) {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// Shows the assigned Employee ID and temporary password once. The password lives
// only in the `created` prop (held by the parent while open): no storage, no logging.
export default function EmployeeCreatedDialog({ created, onClose }) {
  const { username, temporaryPassword, fullName, department } = created;
  const [status, setStatus] = useState('');
  const dialogRef = useRef(null),
    idRef = useRef(null),
    passwordRef = useRef(null),
    bothRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialogRef.current.querySelectorAll(focusable)];
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialogRef.current.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }
  async function copy(what, text, node) {
    const result = await copyToClipboard(text);
    if (!result.copied) selectContents(node.current);
    setStatus(copyStatusMessage(what, result));
  }
  return (
    <div className="created-backdrop">
      <div
        className="created-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="created-dialog-title"
        aria-describedby="created-dialog-note"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <h3 id="created-dialog-title">Employee account created</h3>
        <p className="created-who">
          {fullName}
          {department ? ` · ${department}` : ''}
        </p>
        <div ref={bothRef} className="created-values">
          <div className="created-row">
            <span className="created-label" id="created-id-label">
              Employee ID
            </span>
            <code className="created-value" ref={idRef} aria-labelledby="created-id-label">
              {username}
            </code>
            <button
              type="button"
              className="account-secondary"
              onClick={() => copy('ID', username, idRef)}
            >
              Copy ID
            </button>
          </div>
          <div className="created-row">
            <span className="created-label" id="created-password-label">
              Temporary password
            </span>
            <code
              className="created-value"
              ref={passwordRef}
              aria-labelledby="created-password-label"
            >
              {temporaryPassword}
            </code>
            <button
              type="button"
              className="account-secondary"
              onClick={() => copy('password', temporaryPassword, passwordRef)}
            >
              Copy password
            </button>
          </div>
        </div>
        <p role="status" className="created-status">
          {status}
        </p>
        <p id="created-dialog-note" className="created-note">
          This password won't be shown again. Share it securely — they'll choose a new one at first
          sign-in.
        </p>
        <div className="created-actions">
          <button
            type="button"
            className="account-secondary"
            onClick={() => copy('both', copyBothText({ username, temporaryPassword }), bothRef)}
          >
            Copy both
          </button>
          <button type="button" className="account-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
