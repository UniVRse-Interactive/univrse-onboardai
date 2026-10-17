import {
  onboardingDocumentTopics,
  retiredTopicAreas,
} from '../../server/onboarding-document-topics.mjs';

// The page's view of GET /api/hr/company-knowledge (issue #68): five
// onboarding areas, each holding any number of documents, plus "Other useful
// guidance" ('additional').
export const additionalArea = Object.freeze({
  id: 'additional',
  title: 'Other useful guidance',
  description: 'Safety, benefits or accessibility? Add other related guidance here.',
  icon: 'book',
});

const validTopic = (topic) =>
  topic && typeof topic.id === 'string' && topic.id && typeof topic.title === 'string';

// The areas in the API's order. The snapshot's `topics` win; the shared list
// is only a fallback for an older server that does not send them.
export function areaTopics(snapshot) {
  const topics = Array.isArray(snapshot?.topics) ? snapshot.topics.filter(validTopic) : [];
  return (topics.length ? topics : onboardingDocumentTopics)
    .filter((topic) => topic.id !== additionalArea.id)
    .map(({ id, title, description, icon }) => ({
      id,
      title,
      description: description || '',
      icon: icon || 'book',
    }));
}

// Where a document is listed: its own area; a retired topic id (a stack not
// yet migrated) in the area migration 004 moves it to; anything else under
// Other useful guidance.
export function areaIdFor(category, areaIds) {
  if (areaIds.includes(category)) return category;
  const mapped = retiredTopicAreas[category];
  if (mapped && areaIds.includes(mapped)) return mapped;
  return additionalArea.id;
}

export function documentLabel(document) {
  return document?.title || document?.fileName || 'Uploaded document';
}

export function areasConnectedText(connected, total) {
  return `${connected}/${total} areas connected`;
}

// { areas, additional, connected, total, countText, documentCount, fileLimit, full }
// Each area: { id, title, description, icon, number, documents, empty }.
// Documents keep the API's order (oldest first) inside their area.
export function areaListView(snapshot) {
  const topics = areaTopics(snapshot);
  const ids = topics.map((topic) => topic.id);
  const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  const grouped = new Map([...ids, additionalArea.id].map((id) => [id, []]));
  for (const document of documents) grouped.get(areaIdFor(document.category, ids)).push(document);
  const build = (topic, number) => {
    const list = grouped.get(topic.id);
    return { ...topic, number, documents: list, empty: list.length === 0 };
  };
  const areas = topics.map((topic, index) => build(topic, index + 1));
  const connected = areas.filter((area) => !area.empty).length;
  const fileLimit = snapshot?.limits?.files ?? 40;
  return {
    areas,
    additional: build(additionalArea, 0),
    connected,
    total: areas.length,
    countText: areasConnectedText(connected, areas.length),
    documentCount: documents.length,
    fileLimit,
    full: documents.length >= fileLimit,
  };
}

// The places a document can move to: every other area, then Other useful
// guidance (unless it is already there). `currentId` is where it is listed.
export function moveOptions(areas, currentId) {
  return [...areas, additionalArea]
    .filter((area) => area.id !== currentId)
    .map((area) => ({ value: area.id, label: area.title }));
}

export function areaTitle(view, id) {
  if (id === additionalArea.id) return additionalArea.title;
  return view.areas.find((area) => area.id === id)?.title || additionalArea.title;
}
