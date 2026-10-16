import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuestWorkspaceStore } from '../server/guest-workspace-store.mjs';
import {
  hrOnboardingTasks,
  onboardingProgress,
  validJoiningDate,
} from '../server/hr-onboarding.mjs';
import { hrDashboardSnapshot } from '../src/access/hr-dashboard-insights.mjs';

test('HR milestones persist separately for each employee and workspace, preserving support reports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'onboardai-hr-'));
  const path = join(directory, 'workspace.sqlite');
  let store = createGuestWorkspaceStore({ path });
  try {
    const original = store.snapshot('a').guests[0];
    const second = store.newGuest('a');
    store.ensure('b');
    const details = {
      startDate: '2026-10-16',
      department: 'Operations',
      completed: ['arrival', 'welcome'],
      version: 0,
    };
    assert.equal(store.updateOnboarding('a', original.id, details).version, 1);
    assert.deepEqual(store.snapshot('a').guests[0].summary, original.summary);
    assert.equal(
      store.snapshot('a').guests.find((person) => person.id === second.id).onboarding.completed
        .length,
      0,
    );
    assert.throws(() => store.updateOnboarding('b', original.id, details), { status: 404 });
    assert.throws(() => store.updateOnboarding('a', original.id, details), { status: 409 });
    store.close();
    store = createGuestWorkspaceStore({ path });
    const employee = store.snapshot('a').guests.find((person) => person.id === original.id);
    assert.deepEqual(employee.onboarding, { ...details, version: 1 });
    assert.equal(onboardingProgress(employee.onboarding).percent, 33);
    store.updateOnboarding('a', original.id, {
      ...details,
      completed: hrOnboardingTasks.map((task) => task.id),
      version: 1,
    });
    assert.equal(onboardingProgress(store.snapshot('a').guests[0].onboarding).status, 'Complete');
    store.removeGuest('a', original.id);
    assert.equal(store.snapshot('a').guests.length, 1);
    assert.equal(store.snapshot('a').guests[0].onboarding.completed.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HR record validation rejects invalid dates, milestones and unexpected report fields', () => {
  const store = createGuestWorkspaceStore({ path: ':memory:' });
  try {
    const employee = store.snapshot('owner').guests[0];
    const valid = { startDate: '', department: '', completed: [], version: 0 };
    for (const change of [
      { startDate: '2026-02-30' },
      { startDate: '16/10/2026' },
      { startDate: null },
      { completed: ['arrival', 'arrival'] },
      { completed: ['made-up-task'] },
      { completed: 'arrival' },
      { department: 'x'.repeat(65) },
      { department: 'Team\nOne' },
      { version: -1 },
      { version: '0' },
      { summary: { turns: 100 } },
    ])
      assert.throws(() => store.updateOnboarding('owner', employee.id, { ...valid, ...change }), {
        status: 400,
      });
    assert.equal(validJoiningDate('2024-02-29'), true);
    assert.equal(validJoiningDate('2026-02-29'), false);
    assert.equal(store.snapshot('owner').guests[0].onboarding.version, 0);
  } finally {
    store.close();
  }
});

test('dashboard uses joining dates and confirmed tasks, never chat counts, for hiring and progress', () => {
  const summary = {
    turns: 99,
    requests: { steps: 0, example: 0, brief: 0 },
    humanHelpRequests: 0,
    feedback: { helpful: 0, unclear: 0 },
  };
  const employees = [
    { id: 'one', created: Date.now(), onboarding: { startDate: '', completed: [] }, summary },
    {
      id: 'two',
      onboarding: { startDate: '2026-10-01', completed: ['arrival'] },
      summary: { ...summary, requests: { ...summary.requests, steps: 1 } },
    },
    {
      id: 'three',
      onboarding: { startDate: '2026-09-30', completed: hrOnboardingTasks.map((task) => task.id) },
      summary: { ...summary, humanHelpRequests: 1 },
    },
  ];
  const data = hrDashboardSnapshot(employees, new Date(2026, 9, 16));
  assert.equal(data.employees, 3);
  assert.equal(data.newHires, 1);
  assert.equal(data.inProgress, 1);
  assert.equal(data.complete, 1);
  assert.equal(data.missingDates, 1);
  assert.equal(data.signals.length, 2);
  assert.equal(data.signals[0].employee.id, 'three');
  assert.equal(hrDashboardSnapshot([employees[0]]).hasDates, false);
  assert.equal(onboardingProgress(employees[0].onboarding).percent, 0);
  assert.equal(hrDashboardSnapshot([]).signals.length, 0);
});
