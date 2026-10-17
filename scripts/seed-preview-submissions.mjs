// Synthetic meeting-review data, only imported by the guarded local preview.
import { pdf } from '../tests/server/document-fixtures.mjs';
import { syntheticProfile } from '../tests/server/account-harness.mjs';

export async function seedPreviewSubmissions(fixture, hr, employee) {
  const other = await fixture.readyEmployee(hr, {
    profile: syntheticProfile('Nadia Rahman', 'People & Culture'),
  });
  const third = await fixture.readyEmployee(hr, {
    profile: syntheticProfile('Daniel Tan', 'Customer Success'),
  });
  const rows = [
    [employee, 'Signed employment agreement', 'Employment Documents', 'Pending Review', ''],
    [
      other.browser,
      'Professional qualification',
      'Certificates and Qualifications',
      'Under Review',
      'Checking the qualification details.',
    ],
    [
      employee,
      'Identity document copy',
      'Identification Document',
      'Approved',
      'The submitted copy is clear and complete.',
    ],
    [third.browser, 'Leave supporting letter', 'Leave Supporting Documents', 'Pending Review', ''],
    [
      employee,
      'Personal and bank details',
      'Employment Documents',
      'Rejected',
      'Please upload a complete, readable copy of your personal and bank details.',
    ],
    [
      other.browser,
      'Medical leave certificate',
      'Medical Certificate',
      'Approved',
      'Document received and reviewed.',
    ],
  ];
  for (const [browser, title, type, status, remarks] of rows) {
    const stepId =
      browser === employee
        ? {
            'Signed employment agreement': 'documentation.contract',
            'Identity document copy': 'documentation.tax-id-documents',
            'Personal and bank details': 'documentation.personal-bank-details',
          }[title]
        : null;
    const query = new URLSearchParams({ title, type, ...(stepId ? { stepId } : {}) });
    const name = title.toLowerCase().replaceAll(' ', '-') + '.pdf';
    const result = await browser.upload(
      `/api/me/document-submissions?${query}`,
      pdf('SAMPLE ONLY - ' + title + ' - Not an actual employee document.'),
      name,
    );
    if (result.status !== 201) throw new Error('Preview submission seed failed: ' + result.text);
    if (status !== 'Pending Review') {
      const reviewed = await hr.patch('/api/hr/document-submissions/' + result.body.submission.id, {
        status,
        remarks,
        revision: 1,
      });
      if (reviewed.status !== 200) throw new Error('Preview review seed failed.');
    }
  }
}
