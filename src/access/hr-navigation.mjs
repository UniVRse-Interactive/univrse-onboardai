// HR workspace sections. Signed-in HR manages accounts as well; guest HR only
// sees People & Support and Company Documentation.
export const hrSections = [
  { id: 'accounts', label: 'Employee accounts', icon: 'user', signedInOnly: true },
  { id: 'people', label: 'People & Support', icon: 'people', signedInOnly: false },
  { id: 'knowledge', label: 'Company Documentation', icon: 'book', signedInOnly: false },
];

export function visibleHrSections(signedIn) {
  return hrSections.filter((section) => signedIn || !section.signedInOnly);
}

export function defaultHrSection(signedIn) {
  return visibleHrSections(signedIn)[0].id;
}
