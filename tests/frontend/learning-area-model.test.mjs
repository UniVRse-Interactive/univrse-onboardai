import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learningSummary,
  learningStatus,
  continueLearning,
  taskResources,
} from '../../src/portal/learning-area-model.mjs';
test('optional activities do not block area completion or continue action', () => {
  const area = {
    id: 'team-support',
    steps: [
      { id: 'required', required: true, status: 'done' },
      { id: 'optional', required: false, status: 'todo' },
    ],
  };
  assert.deepEqual(learningSummary(area), { done: 1, total: 1, next: undefined, action: 'Review' });
  assert.equal(continueLearning([area]), undefined);
});
test('continue stays in the four learning areas and skips completed mandatory tasks', () => {
  const areas = [
    { id: 'documentation', steps: [{ id: 'doc', status: 'todo' }] },
    {
      id: 'policies',
      steps: [
        { id: 'done', status: 'done' },
        { id: 'optional', required: false, status: 'todo' },
        { id: 'next', status: 'todo', briefed: true },
      ],
    },
  ];
  assert.equal(continueLearning(areas).id, 'next');
  assert.equal(learningSummary(areas[1]).action, 'Continue');
  assert.equal(learningStatus(areas[1].steps[2]), 'In Progress');
  assert.equal(learningStatus({ status: 'todo' }), 'Not Started');
  assert.equal(learningStatus({ status: 'done' }), 'Completed');
});
test('resource links come only from provided HTTPS descriptions', () => {
  assert.deepEqual(taskResources({ description: 'Use the assigned invitation.' }), []);
  assert.deepEqual(
    taskResources({ description: 'Read (https://example.com/resource) or javascript:alert(1)' }),
    ['https://example.com/resource'],
  );
});

import { checklistModel } from '../../src/portal/learning-area-model.mjs';
test('checklist mirrors saved steps: four areas, required count only, done only when done', () => {
  const step = (id, status, extra = {}) => ({ id, title: id, status, ...extra });
  const model = checklistModel({
    areas: [
      { id: 'documentation', title: 'Documentation', steps: [step('doc', 'done')] },
      {
        id: 'policies',
        title: 'P',
        icon: 'p',
        steps: [step('a', 'done'), step('b', 'todo', { briefed: true }), step('c', 'submitted')],
      },
      {
        id: 'team-support',
        title: 'T',
        steps: [step('d', 'todo'), step('opt', 'todo', { required: false })],
      },
    ],
  });
  assert.deepEqual(
    model.groups.map((g) => g.id),
    ['policies', 'team-support'],
  );
  assert.equal(model.done, 1);
  assert.equal(model.total, 4);
  assert.equal(model.percent, 25);
  const [policies, team] = model.groups;
  assert.deepEqual(
    policies.tasks.map((t) => [t.done, t.started]),
    [
      [true, false],
      [false, true],
      [false, true],
    ],
  );
  assert.equal(team.total, 1);
  assert.equal(team.tasks[1].required, false);
  assert.deepEqual(checklistModel(null), { groups: [], done: 0, total: 0, percent: 0 });
});
