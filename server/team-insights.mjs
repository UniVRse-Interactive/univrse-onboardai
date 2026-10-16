import { companyDay } from './onboarding-progress.mjs';

// GET /api/hr/team-insights (issue #48, D1 Option A): Alya support use summed
// over every employee account, never per person. The aggregates appear only
// when at least `minimumGroup` employees have recorded activity, so no single
// employee can be singled out. The shapes follow summariseSupport
// (employee-support-tracking.mjs); the period is given as calendar days, not
// times, for the same reason.
export const minimumGroup = 3;

const hasData = (summary) =>
  Boolean(summary) &&
  (summary.turns > 0 ||
    summary.humanHelpRequests > 0 ||
    summary.feedback?.helpful > 0 ||
    summary.feedback?.unclear > 0);

// summaries: one supportSummary per employee account (any order).
export function teamInsights(summaries, { openSupportRequests = 0 } = {}) {
  const active = summaries.filter(hasData);
  const base = {
    minimumGroup,
    employeesWithData: active.length,
    available: active.length >= minimumGroup,
    openSupportRequests,
  };
  if (!base.available) return base;
  const sum = (pick) => active.reduce((total, summary) => total + (Number(pick(summary)) || 0), 0);
  const froms = active.map((s) => s.period?.from).filter(Number.isFinite);
  const tos = active.map((s) => s.period?.to).filter(Number.isFinite);
  return {
    ...base,
    period: {
      from: froms.length ? companyDay(new Date(Math.min(...froms))) : null,
      to: tos.length ? companyDay(new Date(Math.max(...tos))) : null,
    },
    turns: sum((s) => s.turns),
    feedback: {
      helpful: sum((s) => s.feedback?.helpful),
      unclear: sum((s) => s.feedback?.unclear),
    },
    formats: {
      standard: sum((s) => s.formats?.standard),
      steps: sum((s) => s.formats?.steps),
      example: sum((s) => s.formats?.example),
      brief: sum((s) => s.formats?.brief),
    },
    requests: {
      steps: sum((s) => s.requests?.steps),
      example: sum((s) => s.requests?.example),
      brief: sum((s) => s.requests?.brief),
    },
    humanHelpRequests: sum((s) => s.humanHelpRequests),
  };
}
