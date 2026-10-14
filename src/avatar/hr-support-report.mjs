export const reportDate = (value) =>
  value
    ? new Intl.DateTimeFormat('en-MY', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kuala_Lumpur',
      }).format(new Date(value))
    : 'No recorded activity yet';

export function reportText(snapshot, name = '') {
  const s = snapshot.summary,
    overview = s.overview || { interaction: s.description, recommendations: [], followUp: '' };
  return [
    'UNIVRSE — EMPLOYEE ONBOARDING SUMMARY',
    name.trim() ? 'Employee: ' + name.trim() : 'Employee: not specified',
    'Prepared: ' + reportDate(snapshot.createdAt),
    'Period: ' + reportDate(s.period.from) + ' — ' + reportDate(s.period.to),
    '',
    'HOW THE EMPLOYEE USES SUPPORT',
    overview.interaction,
    '',
    'SUGGESTED SUPPORT FOR HR',
    ...overview.recommendations.map((item) => '• ' + item),
    '',
    'NEXT CHECK-IN',
    overview.followUp,
    '',
    overview.basis || `Based on ${s.turns} recorded answers.`,
    s.turns < 3
      ? 'This is an early summary; confirm support preferences with the employee.'
      : 'Confirm these support suggestions with the employee.',
  ].join('\n');
}
