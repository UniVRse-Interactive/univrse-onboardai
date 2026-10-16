import React from 'react';
import Icon from '../portal/Icon';
import { reportDate } from '../avatar/hr-support-report.mjs';

// Shared page heading and footer for the HR workspace views.
export function ScreenHeading({ kicker, title, text, headingRef, children }) {
  return (
    <div className="hr-screen-heading">
      <div>
        <span className="hr-kicker">
          HR WORKSPACE <span aria-hidden="true">/</span> {kicker}
        </span>
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

export function ScreenAlert({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="hr-screen-alert" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function ScreenFooter({ updated, refreshing, onRefresh, scope, retention }) {
  return (
    <footer className="hr-screen-footer">
      <span>
        <span className="hr-screen-dot" />{' '}
        {updated ? 'Updated ' + reportDate(updated) : 'Connecting'} · {scope}
      </span>
      <button type="button" disabled={refreshing} onClick={onRefresh}>
        <Icon name="clock" size={14} />
        {refreshing ? 'Refreshing…' : 'Refresh workspace'}
      </button>
      <span>{retention}</span>
    </footer>
  );
}
