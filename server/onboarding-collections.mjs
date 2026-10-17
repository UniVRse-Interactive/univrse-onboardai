// Firestore collections of the onboarding journey (issues #47-#51). Shared by
// the services, the employee delete cascade and the migrations.
export const journeyCollections = Object.freeze({
  templates: 'onboardingTemplates',
  progress: 'onboardingProgress',
  firstDay: 'employeeFirstDay',
  supportRequests: 'supportRequests',
  knowledgeGaps: 'knowledgeGaps',
  agentActions: 'agentActions',
  config: 'config',
  taskVerifications: 'taskVerifications',
});
// config/{quickQuestionsDoc}: the general chips per track.
export const quickQuestionsDoc = 'quickQuestions';
