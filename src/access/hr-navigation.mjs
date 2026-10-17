// HR workspace sections. Every section needs a signed-in HR account.
export const hrSections = [
  { id: 'accounts', label: 'Employee accounts', icon: 'user' },
  { id: 'people', label: 'People & Support', icon: 'people' },
  { id: 'knowledge', label: 'Company Documentation', icon: 'book' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export const defaultHrSection = () => hrSections[0].id;
