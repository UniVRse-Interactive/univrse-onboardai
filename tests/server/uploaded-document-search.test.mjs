import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUploadedDocumentIndex,
  passagesFor,
  quoteUploadedDocuments,
} from '../../server/uploaded-document-search.mjs';

// Synthetic uploaded guides; no company data.
const handbook = {
  title: 'Test handbook',
  text: `Part-Time Employees
Part-time employees work fewer than the normal working hours.
Hours of Work
TEST company working hours:
DAY
\tWORKING HOURS
\tMonday
\t9:00 AM – 5:30 PM
The workweek runs Monday through Friday, from 9:00 a.m. to 5:30 p.m., with one hour for lunch. These hours may change with management approval.
Dress Code and Public Image
The current dress code is smart casual. Clean, neat clothing is required. Ask HR for clarification before a formal client meeting.
Workspace
Employees keep their desk clean.
`,
};
const guide = {
  title: 'guide.txt',
  text: 'Dress Code\nBusiness casual clothing is required. Plain T-shirts are permitted on Fridays only.\nWorking Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.',
};

test('uploaded documents split into heading sections bounded to about 1,800 characters', () => {
  const text = 'The parking permit costs a fictional test amount. '.repeat(100);
  const passages = passagesFor({ title: ' Parking.md ', text: 'Parking\n' + text + '\n12\n' });
  assert.ok(passages.length > 1);
  assert.ok(passages.every((p) => p.title === 'Parking.md' && p.heading === 'Parking'));
  assert.ok(passages.every((p) => p.text.length <= 1800 && text.includes(p.text)));
  assert.ok(!passages.some((p) => /^12$/m.test(p.text)), 'page numbers are dropped');
});

test('quoted search ranks the full working-hours section first and keeps its qualifications', () => {
  const [first] = quoteUploadedDocuments('what is the hours of work', [handbook]);
  assert.equal(first.title, 'Test handbook');
  assert.equal(first.heading, 'Hours of Work');
  assert.match(first.text, /Monday through Friday/);
  assert.match(first.text, /may change with management approval/);
  assert.match(first.preview, /one hour for lunch/);
  assert.ok(handbook.text.includes(first.preview));
  assert.ok(!first.text.includes('fewer than'));
});

test('quoted search finds dress guidance by clothing aliases and declines unrelated questions', () => {
  const [dress] = quoteUploadedDocuments('what to wear', [handbook]);
  assert.equal(dress.heading, 'Dress Code and Public Image');
  assert.match(dress.preview, /smart casual/);
  for (const question of [
    '',
    'hello',
    'What is the CEO salary?',
    'What are the working hours on Mars?',
  ])
    assert.deepEqual(quoteUploadedDocuments(question, [handbook]), [], question);
  assert.ok(quoteUploadedDocuments('working hours', [handbook, guide]).length <= 2);
});

test('the Gemini index understands T-shirt phrasing, keeps conditions and returns at most six passages', () => {
  const rank = createUploadedDocumentIndex([handbook, guide]);
  const [first] = rank('if i wear the tshirt');
  assert.deepEqual(first, {
    title: 'guide.txt',
    heading: 'Dress Code',
    text: 'Business casual clothing is required. Plain T-shirts are permitted on Fridays only.',
  });
  assert.deepEqual(rank('quantum banana teleporter'), []);
  assert.deepEqual(rank(''), []);
  const many = createUploadedDocumentIndex(
    Array.from({ length: 10 }, (_, i) => ({
      title: `hours-${i}.txt`,
      text: `Working Hours\nTeam ${i} office hours start at ${i + 7} AM.`,
    })),
  );
  assert.equal(many('working hours').length, 6);
});
