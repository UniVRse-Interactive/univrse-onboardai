import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountRequest } from './account-api.mjs';
import { createKnowledgeApi, hrKnowledgeBase } from './company-knowledge-api.mjs';
import GoogleDocsLibrary from './GoogleDocsLibrary';
import { ScreenAlert, ScreenFooter, ScreenHeading } from './HrScreenParts';

// "Good guidance starts here" for a signed-in HR session, backed by
// /api/hr/company-knowledge/*.
export default function HrCompanyKnowledge({ headingRef }) {
  const api = useMemo(
    () =>
      createKnowledgeApi(hrKnowledgeBase, (url, { method, body, signal }) =>
        accountRequest(url, { method, body, signal }),
      ),
    [],
  );
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const token = ++sequence.current;
    setRefreshing(true);
    try {
      const value = await api.snapshot();
      if (token !== sequence.current) return;
      setSnapshot(value);
      setError('');
      setUpdated(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError' && token === sequence.current) setError(err.message);
    } finally {
      if (token === sequence.current) setRefreshing(false);
    }
  }, [api]);
  useEffect(() => {
    load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  return (
    <>
      <ScreenHeading
        headingRef={headingRef}
        kicker="COMPANY KNOWLEDGE"
        title="Good guidance starts here."
        text="Six onboarding essentials, with room for other related guidance."
      />
      <ScreenAlert message={error} onRetry={load} />
      {snapshot ? (
        <GoogleDocsLibrary workspace={snapshot} onRefresh={load} api={api} />
      ) : (
        !error && (
          <div className="hr-screen-loading" role="status">
            <h2>Getting your company guidance ready…</h2>
          </div>
        )
      )}
      <ScreenFooter
        updated={updated}
        refreshing={refreshing}
        onRefresh={load}
        scope="Company guidance"
        retention="Shared with every employee’s Alya"
      />
    </>
  );
}
