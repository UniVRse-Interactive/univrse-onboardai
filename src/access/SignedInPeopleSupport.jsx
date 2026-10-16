import React, { useCallback, useEffect, useRef, useState } from 'react';
import { accountApi } from './account-api.mjs';
import { supportSummaryPeople } from './people-support.mjs';
import PeopleSupport, { PeopleTotals } from './PeopleSupport';
import { ScreenAlert, ScreenFooter, ScreenHeading } from './HrScreenParts';

// People & Support for a signed-in HR session: real employee accounts, by name.
export default function SignedInPeopleSupport({ headingRef }) {
  const [people, setPeople] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(null);
  const sequence = useRef(0);
  const abortRef = useRef(null);
  const load = useCallback(async (quiet = false) => {
    const token = ++sequence.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    if (!quiet) setRefreshing(true);
    try {
      const data = await accountApi.supportSummaries({ signal: abort.signal });
      if (token !== sequence.current) return;
      const next = supportSummaryPeople(data);
      setPeople(next);
      setSelectedId((id) => (next.some((person) => person.id === id) ? id : next[0]?.id || ''));
      setError('');
      setUpdated(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError' && token === sequence.current) setError(err.message);
    } finally {
      if (token === sequence.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    load();
    const visible = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    const timer = setInterval(visible, 10000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      sequence.current++;
      abortRef.current?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  return (
    <>
      <ScreenHeading
        headingRef={headingRef}
        kicker="PEOPLE & SUPPORT"
        title="A clearer picture of your people."
        text="See the support employees ask for, and what you can offer next."
      >
        {people && <PeopleTotals people={people} />}
      </ScreenHeading>
      <ScreenAlert message={error} onRetry={() => load()} />
      {!people ? (
        !error && (
          <div className="hr-screen-loading" role="status">
            <h2>Getting your people ready…</h2>
          </div>
        )
      ) : (
        <PeopleSupport people={people} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      <ScreenFooter
        updated={updated}
        refreshing={refreshing}
        onRefresh={() => load()}
        scope="Employee accounts"
        retention="Reports update from saved conversations"
      />
    </>
  );
}
