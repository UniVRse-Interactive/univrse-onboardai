import { onboardingProgress } from '../../server/hr-onboarding.mjs';

export function supportSignal(employee) {
  const summary = employee.summary;
  if (summary.humanHelpRequests) return { label: 'Human help requested', kind: 'human' };
  if (summary.feedback.unclear) return { label: 'Clarification requested', kind: 'clarify' };
  if (Object.values(summary.requests).some((count) => count > 0))
    return { label: 'Support preferences recorded', kind: 'preference' };
  return null;
}

export function hrDashboardSnapshot(employees, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const withDates = employees.filter((employee) => employee.onboarding?.startDate);
  const signals = employees
    .map((employee) => ({ employee, signal: supportSignal(employee) }))
    .filter((item) => item.signal)
    .sort((a, b) => {
      const priority = { human: 0, clarify: 1, preference: 2 };
      return priority[a.signal.kind] - priority[b.signal.kind];
    });
  return {
    employees: employees.length,
    newHires: withDates.filter((employee) => employee.onboarding.startDate.startsWith(month + '-'))
      .length,
    missingDates: employees.length - withDates.length,
    hasDates: withDates.length > 0,
    inProgress: employees.filter(
      (employee) => onboardingProgress(employee.onboarding).status === 'In progress',
    ).length,
    complete: employees.filter(
      (employee) => onboardingProgress(employee.onboarding).status === 'Complete',
    ).length,
    signals,
  };
}
