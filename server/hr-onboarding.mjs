// HR-confirmed milestones. Chat activity and employee device checklists never complete these.
export const hrOnboardingTasks = [
  { id: 'arrival', title: 'First-day arrangements confirmed' },
  { id: 'welcome', title: 'Welcome and orientation completed' },
  { id: 'equipment', title: 'Work accounts and equipment ready' },
  { id: 'team', title: 'Manager and team introductions completed' },
  { id: 'role', title: 'Role, priorities and first tasks agreed' },
  { id: 'check-in', title: 'Onboarding check-in completed' },
];

export function onboardingProgress(onboarding) {
  const done = new Set(onboarding?.completed || []);
  const completed = hrOnboardingTasks.filter((task) => done.has(task.id)).length;
  return {
    completed,
    total: hrOnboardingTasks.length,
    percent: Math.round((completed / hrOnboardingTasks.length) * 100),
    status:
      completed === hrOnboardingTasks.length
        ? 'Complete'
        : completed
          ? 'In progress'
          : 'Not started',
    next: hrOnboardingTasks.find((task) => !done.has(task.id))?.title || 'All milestones confirmed',
  };
}

export function validJoiningDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
