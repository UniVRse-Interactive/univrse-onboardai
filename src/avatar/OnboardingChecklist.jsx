import React, { useCallback, useEffect, useState } from 'react';
import { journeyApi, ONBOARDING_CHANGED } from '../access/journey-api.mjs';
import { checklistModel, focusStepKey } from '../portal/learning-area-model.mjs';
import './onboarding-checklist.css';

// The employee's saved onboarding progress (GET /api/me/onboarding), reloaded
// when it changes, when the tab regains focus and when the page opens.
export function useOnboardingChecklist() {
  const [onboarding, setOnboarding] = useState(null);
  const [extras, setExtras] = useState({});
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await journeyApi.onboarding();
      // Access statuses come from the saved verification records; if they cannot
      // be read, tasks fall back to their plain saved status.
      const [handbook, saved] = await Promise.all([
        journeyApi.getPolicyHandbook().catch(() => null),
        journeyApi.getVerifications().catch(() => null),
      ]);
      setOnboarding(next);
      setExtras({
        accessStepIds: handbook?.toolAccessSteps || [],
        tools: saved?.verifications?.roleTools?.tools || {},
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
    const visible = () => document.visibilityState === 'visible' && load();
    window.addEventListener(ONBOARDING_CHANGED, load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED, load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  return { model: onboarding ? checklistModel(onboarding, extras) : null, failed, reload: load };
}

function Mark({ done, started }) {
  return (
    <span className={'obc-mark' + (done ? ' done' : started ? ' started' : '')} aria-hidden="true">
      {done ? '✓' : ''}
    </span>
  );
}

// Compact checklist of the four learning areas beside Alya. Each task opens
// the matching task in the onboarding section, where it is completed.
export default function OnboardingChecklist({ checklist, navigate, collapsible = false }) {
  const { model, failed, reload } = checklist;
  const firstOpen = model?.groups.find((group) => group.done < group.total)?.id;
  const [open, setOpen] = useState(null);
  const current = open ?? firstOpen;

  function go(taskId) {
    try {
      window.sessionStorage.setItem(focusStepKey, taskId);
    } catch {
      // Without storage the task is simply not scrolled to.
    }
    navigate('/onboarding');
  }

  const body = !model ? (
    failed ? (
      <p role="alert" className="obc-note">
        Your checklist could not be loaded.{' '}
        <button type="button" className="obc-link" onClick={reload}>
          Try again
        </button>
      </p>
    ) : (
      <p role="status" className="obc-note">
        Loading your checklist…
      </p>
    )
  ) : (
    <>
      <div className="obc-summary">
        <strong>
          {model.done} of {model.total} tasks completed
        </strong>
        <span>{model.percent}%</span>
      </div>
      <div
        className="obc-bar"
        role="progressbar"
        aria-label="Onboarding tasks completed"
        aria-valuemin={0}
        aria-valuemax={model.total}
        aria-valuenow={model.done}
        aria-valuetext={`${model.done} of ${model.total} tasks completed`}
      >
        <span style={{ width: model.percent + '%' }} />
      </div>
      <div className="obc-groups">
        {model.groups.map((group) => {
          const expanded = current === group.id;
          return (
            <section key={group.id} className="obc-group">
              <button
                type="button"
                className="obc-group-head"
                aria-expanded={expanded}
                aria-controls={'obc-' + group.id}
                onClick={() => setOpen(expanded ? '' : group.id)}
              >
                <span aria-hidden="true">{group.icon}</span>
                <span className="obc-group-title">{group.title}</span>
                <span className="obc-count">
                  {group.done}/{group.total}
                </span>
              </button>
              {expanded && (
                <ul id={'obc-' + group.id} className="obc-tasks">
                  {group.tasks.map((task) => (
                    <li key={task.id}>
                      <button type="button" className="obc-task" onClick={() => go(task.id)}>
                        <Mark done={task.done} started={task.started} />
                        <span>
                          {task.title}
                          {!task.required && <small> · Optional</small>}
                        </span>
                        <span className="obc-state">{task.state}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );

  return collapsible ? (
    <details className="obc obc-collapsible">
      <summary>
        <strong>Your onboarding checklist</strong>
        {model && (
          <span>
            {model.done} of {model.total} completed
          </span>
        )}
      </summary>
      {body}
    </details>
  ) : (
    <aside className="obc" aria-label="Your onboarding checklist">
      <h3>Your onboarding checklist</h3>
      {body}
    </aside>
  );
}
