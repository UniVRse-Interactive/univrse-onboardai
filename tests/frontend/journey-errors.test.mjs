import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldProblems,
  journeyErrorMessage,
  rateLimitMessage,
} from '../../src/access/journey-errors.mjs';
import { firstDayErrorView } from '../../src/access/hr-journey.mjs';
import { previewErrorMessage, sendErrorView } from '../../src/access/support-flow.mjs';

test('rate limits get a calm message whatever the code', () => {
  assert.equal(
    journeyErrorMessage({ status: 429, code: 'RATE_LIMITED', message: 'x' }),
    rateLimitMessage,
  );
  assert.match(rateLimitMessage, /try again shortly/);
});
test('known codes have plain wording; unknown ones keep the server text', () => {
  for (const code of [
    'CHECK_NOT_FOUND',
    'CHECK_ANSWER_INVALID',
    'STEP_STATUS_INVALID',
    'SUPPORT_REQUEST_NOT_FOUND',
    'BRIEFING_TIME_REQUIRED',
    'CHAT_NOT_FOUND',
    'ANSWER_NOT_FOUND',
    'PROFILE_STORAGE_UNAVAILABLE',
    'PROFILE_STORAGE_TIMEOUT',
    'EMPLOYEE_ROLE_REQUIRED',
  ])
    assert.ok(journeyErrorMessage({ code, message: 'raw' }).length > 10, code);
  assert.equal(journeyErrorMessage({ code: 'OTHER', message: 'Server said' }), 'Server said');
  assert.match(journeyErrorMessage({}), /try again/i);
});
test('server fields[] become inline messages', () => {
  assert.deepEqual(
    fieldProblems(
      [
        { field: 'location', problem: 'required' },
        { field: 'arrivalTime', problem: 'invalid_time' },
        { field: 'location', problem: 'too_long' },
      ],
      { location: 'Location', arrivalTime: 'Arrival time' },
    ),
    { location: 'Location is required.', arrivalTime: 'Arrival time needs a time such as 09:00.' },
  );
  assert.deepEqual(fieldProblems(undefined), {});
});
test('FIRST_DAY_INVALID maps to field errors, other failures to one message', () => {
  const view = firstDayErrorView({
    status: 400,
    code: 'FIRST_DAY_INVALID',
    fields: [{ field: 'hostName', problem: 'required' }],
  });
  assert.deepEqual(view, { errors: { hostName: 'Host name is required.' }, message: '' });
  assert.match(
    firstDayErrorView({ status: 503, code: 'PROFILE_STORAGE_UNAVAILABLE' }).message,
    /not available/,
  );
});
test('SUPPORT_REQUEST_INVALID puts a note problem on the note', () => {
  const view = sendErrorView({
    status: 400,
    code: 'SUPPORT_REQUEST_INVALID',
    fields: [{ field: 'note', problem: 'too_long' }],
  });
  assert.equal(view.note, 'Your note is too long.');
  assert.equal(view.message, '');
  assert.match(sendErrorView({ status: 429 }).message, /try again shortly/);
});
test('preview errors: a bare 404 and the coded 404s read sensibly', () => {
  assert.match(previewErrorMessage({ status: 404 }), /couldn’t find that answer/);
  assert.match(
    previewErrorMessage({ status: 404, code: 'ANSWER_NOT_FOUND' }),
    /couldn’t find that answer/,
  );
  assert.match(
    previewErrorMessage({ status: 404, code: 'CHAT_NOT_FOUND' }),
    /couldn’t find that chat/,
  );
});

test('v1.4 and v1.5 codes have plain wording', () => {
  assert.equal(
    journeyErrorMessage({ status: 503, code: 'CHECK_GRADER_UNAVAILABLE', message: 'raw' }),
    'Alya can’t check written answers right now. Please try again later.',
  );
  assert.equal(
    journeyErrorMessage({ status: 409, code: 'BRIEFING_REQUIRED', message: 'raw' }),
    'Listen to Alya’s briefing first.',
  );
  assert.match(
    journeyErrorMessage({ status: 404, code: 'BRIEFING_NOT_FOUND', message: 'raw' }),
    /no briefing/,
  );
  assert.equal(
    journeyErrorMessage({ status: 400, code: 'BRIEFING_COMPLETION_INVALID', message: 'raw' }),
    'That briefing could not be recorded. Please try again.',
  );
});
