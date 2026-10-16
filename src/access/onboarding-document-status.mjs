import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';

// Maps the uploaded documents of GET /api/hr/company-knowledge to the six
// essentials. Legacy entries may have an empty `fileName`.
export function connectedOnboardingTopics(documents) {
  const connected = {};
  for (const document of documents || []) {
    if (onboardingDocumentTopics.some((topic) => topic.id === document.category))
      connected[document.category] = document;
  }
  return connected;
}

// Documents outside the six essentials ("additional" and anything unknown).
export function relatedDocuments(documents) {
  return (documents || []).filter(
    (document) => !onboardingDocumentTopics.some((topic) => topic.id === document.category),
  );
}

export function documentLabel(document) {
  return document.fileName || document.title || 'Uploaded document';
}
