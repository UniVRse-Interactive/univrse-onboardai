// Maps the `companyKnowledge.drive` field of GET /api/guest-workspace
// ({state: 'not-configured'|'configured'|'unavailable', documents: [], error?})
// to what the HR document library shows. The key is still named `drive`
// for compatibility; the source is Vertex AI Search.
export function companyKnowledgeStatus(knowledge, uploadCount = 0) {
  const state = knowledge?.state;
  const searchConnected = state === 'configured';
  const unavailable = state === 'unavailable';
  const warning = unavailable
    ? knowledge.error || 'Company document search is unavailable right now.'
    : '';
  let indicator;
  if (unavailable) indicator = 'Connection needs attention';
  else if (searchConnected || uploadCount > 0) indicator = 'Ready for Alya';
  else indicator = 'Awaiting documents';
  return {
    searchConnected,
    unavailable,
    warning,
    indicator,
    ready: !unavailable && (searchConnected || uploadCount > 0),
  };
}
