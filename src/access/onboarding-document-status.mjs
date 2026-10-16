import { onboardingDocumentTopics } from '../../server/onboarding-document-topics.mjs';

// Earlier Drive guides predate the six topic slots. Match clear document names
// for display only; this does not move, copy or change the connected guidance.
const topicNames = {
  company: /\b(company overview|company information|general info(?:rmation)?|welcome guide)\b/,
  // The company uses its existing Onboarding Guide as the employee handbook.
  handbook: /\b(handbook|onboarding guide|workplace policies|staff policies)\b/,
  'first-week': /\b(first day|first week|orientation guide|induction guide)\b/,
  role: /\b(role guide|team guide|role and team|job responsibilities)\b/,
  it: /\b(it guide|it setup|account setup|accounts setup|technology setup)\b/,
  communication: /\b(communication|communications|meeting|meetings)\b/,
};

function documentTopic(document) {
  if (onboardingDocumentTopics.some((topic) => topic.id === document.category))
    return document.category;
  // Preserve a topic that HR explicitly added as related guidance.
  if (document.category) return null;
  const title = String(document.title || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  const matches = Object.keys(topicNames).filter((id) => topicNames[id].test(title));
  return matches.length === 1 ? matches[0] : null;
}

export function connectedOnboardingTopics(documents, drive) {
  const connected = {};
  const sharedIds = new Set(
    (drive?.state === 'connected' ? drive.documents : [])
      .map((document) => document.googleDocId)
      .filter(Boolean),
  );
  const sources = [
    ...documents.map((document) => ({
      ...document,
      source: sharedIds.has(document.googleDocId) ? 'drive' : 'workspace',
    })),
    ...(drive?.state === 'connected' ? drive.documents : []).map((document) => ({
      ...document,
      source: 'drive',
    })),
  ];
  for (const document of sources) {
    const topic = documentTopic(document);
    if (
      topic &&
      (!connected[topic] || (document.category === topic && connected[topic].category !== topic))
    )
      connected[topic] = document;
  }
  return connected;
}
