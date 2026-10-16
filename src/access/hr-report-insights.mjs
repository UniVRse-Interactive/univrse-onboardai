export function onboardingSnapshot(employees) {
  const totals = {
    employees: employees.length,
    answers: 0,
    requests: 0,
    helpful: 0,
    unclear: 0,
    human: 0,
  };
  for (const { summary } of employees) {
    totals.answers += summary.turns;
    totals.requests +=
      Object.values(summary.requests).reduce((a, b) => a + b, 0) + summary.humanHelpRequests;
    totals.helpful += summary.feedback.helpful;
    totals.unclear += summary.feedback.unclear;
    totals.human += summary.humanHelpRequests;
  }
  return totals;
}

export function checkInStatus(summary) {
  if (!summary.turns) return 'Not started';
  if (summary.humanHelpRequests) return 'Human support requested';
  if (summary.feedback.unclear) return 'Clarification requested';
  return summary.turns < 3 ? 'Early activity' : 'Support in progress';
}
