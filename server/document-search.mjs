// AI_MODE=document-search: a search-only preview. It quotes the top passages from
// the same company search Gemini chat uses (Vertex AI Search, or the sample guide
// when no engine is configured). It does not call Gemini, generate answers,
// follow document instructions or decide who may access a document.
export function quoteSearchResults(passages, limit = 2) {
  const selected = passages.slice(0, limit).map(({ title, heading, text, excerpt }) => ({
    title,
    heading,
    text,
    preview: excerpt || text,
  }));
  const answer = selected.length
    ? 'Matching passages from your company documents:\n\n' +
      selected
        .map(
          (passage) =>
            `Source: ${passage.title}${passage.heading ? ' — ' + passage.heading : ''}\n${passage.preview}`,
        )
        .join('\n\n')
    : "I couldn't find a matching passage in the company documents. Try naming a specific topic, or ask HR to confirm.";
  return {
    answer,
    mode: 'document-search',
    matched: selected.length > 0,
    passages: selected,
    source: selected.length
      ? 'Company documents: ' + [...new Set(selected.map((item) => item.title))].join(', ')
      : 'Company documents: no matching passage',
  };
}
