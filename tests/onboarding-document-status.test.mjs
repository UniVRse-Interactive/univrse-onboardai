import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedOnboardingTopics } from '../src/access/onboarding-document-status.mjs';

test('earlier Drive guides tick matching topics without creating copies or marking missing topics', () => {
  const drive = {
    state: 'connected',
    documents: [
      { title: 'General Info.docx' },
      { title: 'Onboarding Guide' },
      { title: 'SOP Internal Meeting' },
      { title: 'Unclassified notes' },
    ],
  };
  const before = JSON.stringify(drive);
  const connected = connectedOnboardingTopics([], drive);
  assert.deepEqual(Object.keys(connected), ['company', 'handbook', 'communication']);
  assert.equal(connected.company.source, 'drive');
  assert.equal(connected.handbook.title, 'Onboarding Guide');
  assert.equal(connected['first-week'], undefined);
  assert.equal(connected.role, undefined);
  assert.equal(connected.it, undefined);
  assert.equal(JSON.stringify(drive), before);
  assert.deepEqual(connectedOnboardingTopics([], { ...drive, state: 'unavailable' }), {});
  const firstWeek = connectedOnboardingTopics([], {
    state: 'connected',
    documents: [{ title: 'First-Day & First-Week Guide' }],
  });
  assert.deepEqual(Object.keys(firstWeek), ['first-week']);
});

test('explicit HR topic assignments take precedence and related or ambiguous guides are not guessed', () => {
  const documents = [
    { id: 'legacy', title: 'Employee handbook.docx', category: '' },
    { id: 'current', title: 'Updated guidance', category: 'handbook' },
    { id: 'related', title: 'IT account setup', category: 'additional' },
    { id: 'ambiguous', title: 'Welcome guide and handbook', category: '' },
  ];
  const connected = connectedOnboardingTopics(documents, {
    state: 'connected',
    documents: [{ title: 'Employee handbook' }],
  });
  assert.deepEqual(Object.keys(connected), ['handbook']);
  assert.equal(connected.handbook.id, 'current');
  assert.equal(connected.handbook.source, 'workspace');
  assert.deepEqual(connectedOnboardingTopics(documents, undefined), connected);
  const shared = connectedOnboardingTopics(
    [{ title: 'Employee Handbook', googleDocId: 'handbook-123', category: 'handbook' }],
    {
      state: 'connected',
      documents: [
        { title: 'Employee Handbook', googleDocId: 'handbook-123', category: 'handbook' },
      ],
    },
  );
  assert.equal(
    shared.handbook.source,
    'drive',
    'shared guides do not offer a misleading browser-only disconnect',
  );
});
