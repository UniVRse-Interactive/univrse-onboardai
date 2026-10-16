import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { AccessBrand } from './LoginPage';
import { workspaceRequest } from './guest-workspace-api';
import { guestPeople } from './people-support.mjs';
import { defaultHrSection, visibleHrSections } from './hr-navigation.mjs';
import CompanyDocumentLibrary from './CompanyDocumentLibrary';
import HrEmployees from './HrEmployees';
import HrCompanyKnowledge from './HrCompanyKnowledge';
import SignedInPeopleSupport from './SignedInPeopleSupport';
import PeopleSupport, { PeopleTotals } from './PeopleSupport';
import { ScreenAlert, ScreenFooter, ScreenHeading } from './HrScreenParts';
import './account-access.css';
import './hr-onboarding-summary.css';
import './hr-workspace.css';
import './accounts.css';
import './hr-screen.css';
import './hr-screen-views.css';

// Guest HR: this browser's guest-workspace employees and uploaded documents.
function GuestViews({ section, headingRef }) {
  const [workspace, setWorkspace] = useState(null),
    [employeeId, setEmployeeId] = useState(''),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [removing, setRemoving] = useState(''),
    [notice, setNotice] = useState(''),
    [refreshing, setRefreshing] = useState(false),
    [updated, setUpdated] = useState(null);
  const abortRef = useRef(null),
    sequence = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    const token = ++sequence.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    if (!quiet) setRefreshing(true);
    try {
      const value = await workspaceRequest('', { signal: abort.signal });
      if (token !== sequence.current) return;
      setWorkspace(value);
      setEmployeeId((id) => (value.guests.some((g) => g.id === id) ? id : value.lastGuestId));
      setError('');
      setUpdated(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError' && token === sequence.current) setError(err.message);
    } finally {
      if (token === sequence.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    const timer = setInterval(visible, 10000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      abortRef.current?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  async function newGuest() {
    setAdding(true);
    setError('');
    try {
      const guest = await workspaceRequest('/guests', { method: 'POST' });
      setEmployeeId(guest.id);
      await refresh(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }
  async function removeEmployee(person) {
    if (
      !window.confirm(
        `Remove ${person.name}’s record?\n\nThis permanently deletes their saved conversations, feedback and onboarding support summary in this browser’s workspace. Company documents and other employee records will be kept. This cannot be undone.`,
      )
    )
      return;
    setRemoving(person.id);
    setError('');
    try {
      await workspaceRequest('/guests/' + person.id, { method: 'DELETE' });
      setNotice(person.name + '’s record was removed.');
      await refresh(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving('');
    }
  }
  const people = workspace ? guestPeople(workspace.guests) : null;
  const peopleView = section === 'people';
  return (
    <>
      <ScreenHeading
        kicker={peopleView ? 'PEOPLE & SUPPORT' : 'COMPANY DOCUMENTATION'}
        title={peopleView ? 'A clearer picture of your people.' : 'Good guidance starts here.'}
        text={
          peopleView
            ? 'See the support employees ask for, and what you can offer next.'
            : 'Upload the documents Alya answers from.'
        }
        headingRef={headingRef}
      >
        {people && peopleView && <PeopleTotals people={people} />}
      </ScreenHeading>
      <ScreenAlert message={error} onRetry={() => refresh()} />
      <p role="status" className="hr-screen-notice">
        {notice}
      </p>
      {!workspace ? (
        !error && (
          <div className="hr-screen-loading" role="status">
            <h2>Getting your workspace ready…</h2>
          </div>
        )
      ) : peopleView ? (
        <PeopleSupport
          people={people}
          selectedId={employeeId}
          onSelect={setEmployeeId}
          guest={{
            adding,
            removing,
            canAdd: workspace.guests.length < workspace.limits.guests,
            onAdd: newGuest,
            onRemove: removeEmployee,
          }}
        />
      ) : (
        <div className="hr-screen-scroll">
          <CompanyDocumentLibrary workspace={workspace} onRefresh={() => refresh(true)} />
        </div>
      )}
      <ScreenFooter
        updated={updated}
        refreshing={refreshing}
        onRefresh={() => refresh()}
        scope="This browser’s workspace"
        retention="Temporary access · Activity retained for 24 hours"
      />
    </>
  );
}

export default function HrWorkspace({ navigate, account = null, onSignOut }) {
  const hrAccount = account?.role === 'hr' ? account : null;
  const signedIn = !!hrAccount;
  const sections = visibleHrSections(signedIn);
  const [view, setView] = useState(() => defaultHrSection(signedIn));
  const headingRef = useRef(null);
  const current = sections.some((section) => section.id === view)
    ? view
    : defaultHrSection(signedIn);
  function show(id) {
    setView(id);
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  return (
    <div className={'hr-preview-page hr-screen' + (current === 'people' ? '' : ' hr-screen-flow')}>
      <header className="hr-screen-header">
        <AccessBrand />
        <nav aria-label="HR workspace sections">
          {sections.map((section) => (
            <button
              type="button"
              key={section.id}
              aria-pressed={current === section.id}
              onClick={() => show(section.id)}
            >
              <Icon name={section.icon} size={18} />
              {section.label}
            </button>
          ))}
        </nav>
        {hrAccount ? (
          <div className="account-session">
            <span className="account-signed-in">
              Signed in as <strong>{hrAccount.username}</strong>
            </span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : (
          <button className="hr-screen-signin" type="button" onClick={() => navigate('/login')}>
            Back to sign in <Icon name="arrow" size={16} />
          </button>
        )}
      </header>
      <main className="hr-screen-main" id="hr-main">
        {current === 'accounts' ? (
          <HrEmployees />
        ) : signedIn ? (
          current === 'people' ? (
            <SignedInPeopleSupport headingRef={headingRef} />
          ) : (
            <HrCompanyKnowledge headingRef={headingRef} />
          )
        ) : (
          <GuestViews key={current} section={current} headingRef={headingRef} />
        )}
      </main>
    </div>
  );
}
