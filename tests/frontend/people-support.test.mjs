import test from 'node:test';
import assert from 'node:assert/strict';
import { guestPeople, supportSummaryPeople } from '../../src/access/people-support.mjs';

const summary = (turns, extra = {}) => ({
  turns,
  humanHelpRequests: 0,
  feedback: { helpful: 0, unclear: 0 },
  requests: { steps: 0, example: 0, brief: 0 },
  ...extra,
});

test('support-summaries map to rows by name with answers and activity', () => {
  const people = supportSummaryPeople({
    employees: [
      { account: { id: 'a1', username: 'EMP-1' }, name: 'Aisha Rahman', summary: summary(0) },
      { account: { id: 'a2', username: 'EMP-2' }, name: 'Ben Lee', summary: summary(1) },
      {
        account: { id: 'a3', username: 'EMP-3' },
        name: 'Cara Ng',
        summary: summary(5, { humanHelpRequests: 2 }),
      },
    ],
  });
  assert.deepEqual(
    people.map((p) => [p.id, p.name, p.answers, p.activity, p.detail]),
    [
      ['a1', 'Aisha Rahman', 0, 'Not started', '0 answers · Not started'],
      ['a2', 'Ben Lee', 1, 'Early activity', '1 answer · Early activity'],
      ['a3', 'Cara Ng', 5, 'Human support requested', '5 answers · Human support requested'],
    ],
  );
  assert.equal(people[0].account.username, 'EMP-1');
});

test('a blank name falls back to the employee ID', () => {
  const [row] = supportSummaryPeople({
    employees: [{ account: { id: 'a1', username: 'EMP-9' }, name: '  ', summary: summary(2) }],
  });
  assert.equal(row.name, 'EMP-9');
});

test('missing or empty payloads give an empty list', () => {
  assert.deepEqual(supportSummaryPeople({ employees: [] }), []);
  assert.deepEqual(supportSummaryPeople(null), []);
});

test('guest employees use the same row shape', () => {
  const [row] = guestPeople([{ id: 'g1', name: 'Employee 1', summary: summary(4) }]);
  assert.equal(row.name, 'Employee 1');
  assert.equal(row.detail, '4 answers · Support in progress');
});
