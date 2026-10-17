// Calm wording for the errors the onboarding-journey routes can return.

const messages = {
  CHECK_NOT_FOUND: 'This step has no check. Your list has been refreshed.',
  CHECK_ANSWER_INVALID: 'Choose one of the answers, then try again.',
  CHECK_GRADER_UNAVAILABLE: 'Alya can’t check written answers right now. Please try again later.',
  BRIEFING_REQUIRED: 'Listen to Alya’s briefing first.',
  BRIEFING_NOT_FOUND: 'This step has no briefing. Your list has been refreshed.',
  BRIEFING_COMPLETION_INVALID: 'That briefing could not be recorded. Please try again.',
  STEP_STATUS_INVALID: 'That change is not possible for this step.',
  STEP_NOT_FOUND: 'This step is no longer in your plan. Your list has been refreshed.',
  STEP_NOT_HR_VERIFIED: 'Only steps that HR verifies can be changed here.',
  SUPPORT_REQUEST_NOT_FOUND: 'That request no longer exists. The list has been refreshed.',
  BRIEFING_TIME_REQUIRED: 'Choose a date and time for the briefing.',
  CHAT_NOT_FOUND: 'I couldn’t find that chat. Please open it again.',
  ANSWER_NOT_FOUND: 'I couldn’t find that answer to share. Please try asking again.',
  PROFILE_STORAGE_UNAVAILABLE: 'Saving is not available right now. Please try again shortly.',
  PROFILE_STORAGE_TIMEOUT: 'That took too long. Please try again shortly.',
  EMPLOYEE_ROLE_REQUIRED: 'This part is for employee accounts.',
};

export const rateLimitMessage = 'That’s a lot at once. Please try again shortly.';

export function journeyErrorMessage(error, fallback = 'That did not work. Please try again.') {
  if (error?.status === 429) return rateLimitMessage;
  if (error?.code && messages[error.code]) return messages[error.code];
  return error?.message || fallback;
}

const problemText = {
  required: 'is required.',
  too_long: 'is too long.',
  invalid: 'is not valid.',
  invalid_time: 'needs a time such as 09:00.',
  invalid_characters: 'cannot contain line breaks.',
};

// Server `fields: [{field, problem}]` -> { field: 'Label is required.' }.
export function fieldProblems(fields, labels = {}) {
  const out = {};
  for (const { field, problem } of Array.isArray(fields) ? fields : []) {
    if (out[field]) continue;
    out[field] = `${labels[field] || 'This field'} ${problemText[problem] || 'is not valid.'}`;
  }
  return out;
}
