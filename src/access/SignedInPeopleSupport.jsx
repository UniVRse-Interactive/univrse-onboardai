import React, { useCallback, useEffect, useRef, useState } from 'react';
import { journeyErrorMessage } from './journey-errors.mjs';
import { journeyApi } from './journey-api.mjs';
import { supportCounter } from './hr-journey.mjs';
import HrSupportRequests from './HrSupportRequests';
import { HrKnowledgeGaps, HrTeamInsights } from './HrInsights';
import { ScreenAlert, ScreenFooter, ScreenHeading } from './HrScreenParts';
import './hr-journey.css';

// People & Support for a signed-in HR session. HR sees an individual's
// struggles only when the employee confirmed a support request.
export default function SignedInPeopleSupport({ headingRef }) {
  const [requests, setRequests] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [insights, setInsights] = useState(null);
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
    const options = { signal: abort.signal };
    try {
      const [r, g, i] = await Promise.all([
        journeyApi.hrSupportRequests(options),
        journeyApi.hrKnowledgeGaps(options),
        journeyApi.hrTeamInsights(options),
      ]);
      if (token !== sequence.current) return;
      setRequests(r);
      setGaps(g);
      setInsights(i);
      setError('');
      setUpdated(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError' && token === sequence.current)
        setError(journeyErrorMessage(err));
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
  // A saved request replaces its row at once; the next refresh confirms it.
  function saved(request) {
    setRequests((current) => {
      if (!current) return current;
      const list = current.requests.map((item) =>
        item.id === request.id ? { ...item, ...request } : item,
      );
      const counts = { open: 0, briefing_scheduled: 0, resolved: 0 };
      for (const item of list) counts[item.status] = (counts[item.status] || 0) + 1;
      return { ...current, requests: list, counts };
    });
    load(true);
  }
  return (
    <>
      <ScreenHeading
        headingRef={headingRef}
        kicker="PEOPLE & SUPPORT"
        title="Support when people ask for it."
        text="See the requests employees chose to send, the gaps in your documents and how the team is doing."
      >
        {requests && (
          <dl className="hr-screen-totals">
            <div>
              <dt>Support requests</dt>
              <dd aria-label={`${supportCounter(requests.counts)} open support requests`}>
                {supportCounter(requests.counts)}
              </dd>
            </div>
          </dl>
        )}
      </ScreenHeading>
      <ScreenAlert message={error} onRetry={() => load()} />
      <div className="hrj">
        <HrSupportRequests data={requests} onChanged={saved} />
        <HrKnowledgeGaps data={gaps} />
        <HrTeamInsights data={insights} />
      </div>
      <ScreenFooter
        updated={updated}
        refreshing={refreshing}
        onRefresh={() => load()}
        scope="Employee accounts"
        retention="Only requests employees confirmed are shown"
      />
    </>
  );
}
