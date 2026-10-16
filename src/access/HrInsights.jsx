import React from 'react';
import { gapView, insightsView } from './hr-journey.mjs';

// People & Support, section 2: topics the company documents did not cover.
export function HrKnowledgeGaps({ data }) {
  return (
    <section className="hrj-section" aria-labelledby="hrj-gaps-title">
      <div className="hrj-section-heading">
        <div>
          <h2 id="hrj-gaps-title">Knowledge gaps</h2>
          <p>
            Questions about onboarding that the company documents could not answer, grouped by
            topic. They are anonymous: no names, chats or exact times.
          </p>
        </div>
      </div>
      {!data ? (
        <p role="status">Loading knowledge gaps…</p>
      ) : data.groups.length ? (
        <ul className="hrj-gaps">
          {data.groups.map((group) => {
            const view = gapView(group);
            return (
              <li key={group.topic}>
                <header>
                  <h3>{view.topic}</h3>
                  <span className="hrj-count">{view.countLabel}</span>
                </header>
                {view.examples.length > 0 && (
                  <ul className="hrj-examples" aria-label={`Examples for ${view.topic}`}>
                    {view.examples.map((example, index) => (
                      <li key={index}>{example}</li>
                    ))}
                  </ul>
                )}
                {view.tracks && <p className="hrj-hint">Tracks: {view.tracks}</p>}
                {view.sources.length > 0 && (
                  <p className="hrj-hint">Nearest sources: {view.sources.join('; ')}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hrj-empty">No gaps found yet. Alya has answered from your documents.</p>
      )}
    </section>
  );
}

// People & Support, section 3: aggregates, only with three or more employees.
export function HrTeamInsights({ data }) {
  const view = insightsView(data);
  return (
    <section className="hrj-section" aria-labelledby="hrj-insights-title">
      <div className="hrj-section-heading">
        <div>
          <h2 id="hrj-insights-title">Team insights</h2>
          <p>Trends across your team, never about one person.</p>
        </div>
      </div>
      {!data ? (
        <p role="status">Loading team insights…</p>
      ) : !view.available ? (
        <p className="hrj-empty">{view.message}</p>
      ) : (
        <>
          {view.period && <p className="hrj-hint">Period: {view.period}</p>}
          <dl className="hrj-stats">
            {view.stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="hrj-breakdowns">
            {view.breakdowns.map((breakdown) => (
              <div key={breakdown.title}>
                <h3>{breakdown.title}</h3>
                <ul>
                  {breakdown.rows.map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="hrj-hint">{view.footnote}</p>
        </>
      )}
    </section>
  );
}
