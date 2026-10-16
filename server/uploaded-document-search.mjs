// Local lexical search over HR's uploaded company documents (the company
// knowledge library), searched here instead of being imported into the shared
// Vertex AI Search data store.
// It quotes or ranks source text; it never generates answers or follows
// instructions inside a document. It is not vector search.

// --- Passages ---------------------------------------------------------------

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

// Splits one document into heading sections of at most about 1,800 characters.
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

// --- Ranked passages for Gemini (AI_MODE other than document-search) ---------

const stop = new Set(
  'a an and are as at be can could do does for from how i if in is it me my of on or our please should that the their there this to us was we what when where which who why will with would you your'.split(
    ' ',
  ),
);
const topics = [
  [
    'dress',
    'wear',
    'tshirt',
    'shirt',
    'clothing',
    'attire',
    'outfit',
    'casual',
    'jeans',
    'sneakers',
  ],
  ['hours', 'hour', 'schedule', 'working', 'start', 'finish', 'office', 'time'],
  ['leave', 'vacation', 'holiday', 'annual', 'pto'],
  ['probation', 'confirmation', 'confirmed'],
  ['salary', 'pay', 'payment', 'payroll'],
];
function words(text) {
  return (
    text
      .toLowerCase()
      .replace(/t[\s-]?shirts?/g, 'tshirt')
      .match(/[a-z0-9]+/g)
      ?.filter((w) => !stop.has(w)) || []
  );
}

// Returns rank(query) -> up to six [{ title, heading, text }] in rank order.
// Gemini rewrites the question first, so no embedding API is needed.
export function createUploadedDocumentIndex(documents) {
  const chunks = documents.flatMap(passagesFor);
  const documentFrequency = new Map();
  const index = chunks.map((chunk) => {
    const body = words(chunk.text);
    const heading = new Set(words(chunk.heading || ''));
    const frequency = new Map();
    for (const term of body) frequency.set(term, (frequency.get(term) || 0) + 1);
    for (const term of new Set([...body, ...heading]))
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    return { chunk, heading, frequency, length: body.length };
  });
  return function rank(query) {
    const terms = [...new Set(words(typeof query === 'string' ? query : ''))];
    const expanded = new Set(terms);
    for (const topic of topics)
      if (topic.some((t) => terms.includes(t))) topic.forEach((t) => expanded.add(t));
    return index
      .map(({ chunk, heading, frequency, length }, position) => {
        let score = 0,
          exact = 0;
        for (const term of expanded) {
          const tf = frequency.get(term) || 0;
          if (tf || heading.has(term)) {
            const df = documentFrequency.get(term) || 0;
            const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
            score +=
              idf *
              (tf / (tf + 1.2 * (0.25 + (0.75 * length) / 230)) + (heading.has(term) ? 2 : 0)) *
              (terms.includes(term) ? 1 : 0.45);
            if (terms.includes(term)) exact++;
          }
        }
        return { chunk, position, score, exact };
      })
      .filter(
        (r) =>
          r.score > 0 &&
          (r.exact > 0 || terms.some((t) => topics.some((topic) => topic.includes(t)))),
      )
      .sort((a, b) => b.score - a.score || a.position - b.position)
      .slice(0, 6)
      .map(({ chunk }) => ({ title: chunk.title, heading: chunk.heading, text: chunk.text }));
  };
}

// --- Quoted passages for AI_MODE=document-search -----------------------------

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

// Up to two [{ title, heading, text, preview }] passages that cover the question.
export function quoteUploadedDocuments(question, documents) {
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
  return selected;
}
