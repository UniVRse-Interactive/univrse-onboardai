// Browser client for the onboarding-journey routes (contract v1): the
// employee footprint, quick questions, support requests and agent actions,
// and the HR views over them. Every route needs a signed-in account.

import { accountRequest } from './account-api.mjs';

const enc = encodeURIComponent;
const post = (path, body, options) => accountRequest(path, { ...options, method: 'POST', body });

export const journeyApi = {
  // Employee
  onboarding: (options) => accountRequest('/api/me/onboarding', options),
  completeStep: (stepId, options) =>
    post('/api/me/onboarding/steps/' + enc(stepId) + '/complete', undefined, options),
  reopenStep: (stepId, options) =>
    post('/api/me/onboarding/steps/' + enc(stepId) + '/reopen', undefined, options),
  check: (stepId, options) =>
    accountRequest('/api/me/onboarding/steps/' + enc(stepId) + '/check', options),
  // v1.4: a choice check posts the chosen option's opaque id; a written check
  // posts the employee's answer (never stored by the server).
  answerCheck: (stepId, optionId, options) =>
    post('/api/me/onboarding/steps/' + enc(stepId) + '/check', { optionId }, options),
  answerWrittenCheck: (stepId, answer, options) =>
    post('/api/me/onboarding/steps/' + enc(stepId) + '/check', { answer }, options),
  // v1.5: what the employee confirmed: "listened" or "read".
  recordBriefing: (stepId, completion, options) =>
    post('/api/me/onboarding/steps/' + enc(stepId) + '/briefing', { completion }, options),
  quickQuestions: (options) => accountRequest('/api/me/quick-questions', options),
  firstDay: (options) => accountRequest('/api/me/first-day', options),
  previewSupportRequest: ({ conversationId, messageId }, options) =>
    post('/api/me/support-requests/preview', { conversationId, messageId }, options),
  createSupportRequest: (body, options) => post('/api/me/support-requests', body, options),
  mySupportRequests: (options) => accountRequest('/api/me/support-requests', options),
  decideAction: (actionId, decision, options) =>
    post('/api/me/agent-actions/' + enc(actionId), { decision }, options),

  // HR
  hrSupportRequests: (options) => accountRequest('/api/hr/support-requests', options),
  updateSupportRequest: (id, patch, options) =>
    accountRequest('/api/hr/support-requests/' + enc(id), {
      ...options,
      method: 'PATCH',
      body: patch,
    }),
  hrKnowledgeGaps: (options) => accountRequest('/api/hr/knowledge-gaps', options),
  hrTeamInsights: (options) => accountRequest('/api/hr/team-insights', options),
  employeeOnboarding: (id, options) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/onboarding', options),
  setEmployeeStep: (id, stepId, status, options) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/onboarding/steps/' + enc(stepId), {
      ...options,
      method: 'PATCH',
      body: { status },
    }),
  employeeFirstDay: (id, options) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/first-day', options),
  saveFirstDay: (id, body, options) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/first-day', {
      ...options,
      method: 'PUT',
      body,
    }),
};
