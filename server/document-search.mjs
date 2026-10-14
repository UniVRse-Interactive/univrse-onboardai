// A small lexical search preview. It quotes the source; it does not generate
// answers, execute document instructions, or decide who may access a document.
const stopWords = new Set(
  'a an and are as at be can could do does for from give have how i in is it me my of on our please tell that the their there this to us we what when where which who why with would you your company univrse interactive sdn bhd policy information guide'.split(
    ' ',
  ),
);

function stem(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function normalize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(stem).join(' ');
}

function conceptsFor(question) {
  const tokens = new Set(
    normalize(question)
      .split(' ')
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
  const concepts = [];
  // These aliases only find passages. They never supply company facts.
  if (
    /\b(?:work|working|office|operating)\b.*\bhours?\b|\bhours?\b.*\bwork\b|\bworkweek\b|\bwork schedule\b|\bwhat time\b/i.test(
      question,
    )
  ) {
    concepts.push(
      [
        'hours of work',
        'working hours',
        'office hours',
        'operating hours',
        'workweek',
        'work schedule',
      ].map(normalize),
    );
    for (const word of ['work', 'office', 'operat', 'hour', 'workweek', 'schedule', 'time'])
      tokens.delete(word);
  }
  if (/\b(?:wear|wearing|dress|attire|clothing|outfit)\b/i.test(question)) {
    concepts.push(
      ['dress code', 'attire', 'clothing', 'wear', 'outfit', 'smart casual'].map(normalize),
    );
    for (const word of ['wear', 'dress', 'attire', 'cloth', 'outfit', 'code']) tokens.delete(word);
  }
  for (const word of tokens) concepts.push([word]);
  return concepts;
}

function isHeading(raw) {
  const line = raw.trim();
  return (
    !/^\s*\t/.test(raw) &&
    line.length <= 90 &&
    line.split(/\s+/).length <= 12 &&
    /^[A-Z][A-Za-z0-9 /&()’'–-]*$/.test(line) &&
    !/^[A-Z\s]+$/.test(line)
  );
}

export function passagesFor(document) {
  const sections = [];
  let heading = '',
    lines = [];
  const flush = () => {
    if (lines.length) sections.push({ heading, text: lines.join('\n').trim() });
    lines = [];
  };
  for (const raw of document.text.split(/\r?\n/)) {
    if (/^\s*\d+\s*$/.test(raw)) continue; // Exported page numbers.
    if (isHeading(raw)) {
      flush();
      heading = raw.trim();
    } else if (raw.trim()) lines.push(raw.trimEnd());
  }
  flush();

  const passages = [];
  for (const section of sections) {
    let remaining = section.text;
    while (remaining) {
      let end = Math.min(1800, remaining.length);
      if (end < remaining.length) {
        const boundary = Math.max(
          remaining.lastIndexOf('\n', end),
          remaining.lastIndexOf('. ', end),
        );
        if (boundary > 600) end = boundary + 1;
        else end = remaining.lastIndexOf(' ', end) + 1 || end;
      }
      passages.push({
        title: document.title.trim(),
        heading: section.heading,
        text: remaining.slice(0, end).trim(),
      });
      remaining = remaining.slice(end).trim();
    }
  }
  return passages;
}

function contains(text, term) {
  return (' ' + text + ' ').includes(' ' + term + ' ');
}

function previewFor(passage, concepts) {
  // Select a source paragraph rather than generating or rewriting a policy.
  const paragraphs = passage.text
    .split(/\n+/)
    .map((text) => text.trim())
    .filter((text) => text.length >= 80);
  const ranked = paragraphs
    .map((text, index) => ({
      text,
      index,
      score: concepts.reduce(
        (total, aliases) =>
          total + aliases.filter((term) => contains(normalize(text), term)).length,
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.text || passage.text;
}

export function searchDocuments(question, documents) {
  const concepts = conceptsFor(question);
  const passages = documents.flatMap(passagesFor).map((passage) => ({
    ...passage,
    body: normalize(passage.text),
    label: normalize(passage.heading),
  }));
  const ranked = passages
    .map((passage) => {
      let score = 0,
        matched = 0;
      for (const aliases of concepts) {
        const inHeading = aliases.some((term) => contains(passage.label, term));
        const inBody = aliases.some((term) => contains(passage.body, term));
        if (inHeading || inBody) {
          matched++;
          const frequency = passages.filter((other) =>
            aliases.some((term) => contains(other.body + ' ' + other.label, term)),
          ).length;
          const weight = 1 + Math.log(1 + passages.length / Math.max(1, frequency));
          score += weight * (inHeading ? 4 : 1);
        }
      }
      return { ...passage, score, coverage: matched / concepts.length };
    })
    .filter((passage) => concepts.length && passage.coverage >= 0.7 && passage.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = [];
  for (const passage of ranked) {
    if (passage.score < ranked[0].score * 0.8) break;
    if (selected.some((item) => item.title === passage.title && item.heading === passage.heading))
      continue;
    selected.push({
      title: passage.title,
      heading: passage.heading,
      text: passage.text,
      preview: previewFor(passage, concepts),
    });
    if (selected.length === 2) break;
  }
  const answer = selected.length
    ? 'Matching passages from your company documents:\n\n' +
      selected
        .map(
          (passage) =>
            `Source: ${passage.title}${passage.heading ? ' — ' + passage.heading : ''}\n${passage.text}`,
        )
        .join('\n\n')
    : "I couldn't find a matching passage in the connected company documents. Try a specific topic such as working hours or dress code, or ask HR to confirm.";
  return {
    answer,
    mode: 'document-search',
    matched: selected.length > 0,
    passages: selected,
    source: selected.length
      ? 'Google Drive: ' + [...new Set(selected.map((item) => item.title))].join(', ')
      : 'Google Drive: no matching passage',
  };
}
