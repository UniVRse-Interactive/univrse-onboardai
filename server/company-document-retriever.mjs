import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createHash } from 'node:crypto';
import { passagesFor } from './document-search.mjs';

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

// Local ranked retrieval: Gemini rewrites the query, so no embedding API or
// additional per-document model charges are needed. This is not vector search.
export class CompanyRetriever extends BaseRetriever {
  lc_namespace = ['univrse', 'company'];
  constructor(chunks) {
    super();
    this.chunks = chunks;
    this.documentFrequency = new Map();
    this.index = chunks.map((doc) => {
      const body = words(doc.pageContent);
      const heading = new Set(words(doc.metadata.heading || ''));
      const frequency = new Map();
      for (const term of body) frequency.set(term, (frequency.get(term) || 0) + 1);
      for (const term of new Set([...body, ...heading]))
        this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
      return { doc, heading, frequency, length: body.length };
    });
  }
  async _getRelevantDocuments(query) {
    const terms = [...new Set(words(query))];
    const expanded = new Set(terms);
    for (const topic of topics)
      if (topic.some((t) => terms.includes(t))) topic.forEach((t) => expanded.add(t));
    const ranked = this.index
      .map(({ doc, heading, frequency, length }, index) => {
        let score = 0,
          exact = 0;
        for (const term of expanded) {
          const tf = frequency.get(term) || 0;
          if (tf || heading.has(term)) {
            const df = this.documentFrequency.get(term) || 0;
            const idf = Math.log(1 + (this.chunks.length - df + 0.5) / (df + 0.5));
            score +=
              idf *
              (tf / (tf + 1.2 * (0.25 + (0.75 * length) / 230)) + (heading.has(term) ? 2 : 0)) *
              (terms.includes(term) ? 1 : 0.45);
            if (terms.includes(term)) exact++;
          }
        }
        return { doc, index, score, exact };
      })
      .filter(
        (r) =>
          r.score > 0 &&
          (r.exact > 0 || terms.some((t) => topics.some((topic) => topic.includes(t)))),
      )
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return ranked.slice(0, 6).map(
      ({ doc }) =>
        new Document({
          pageContent: doc.pageContent,
          metadata: { title: doc.metadata.title, heading: doc.metadata.heading },
        }),
    );
  }
}

export function createKnowledgeRetriever(loadDocuments, folderId) {
  let cachedHash = '',
    cachedRetriever = null;
  return async function retrieve(query, config) {
    // The loader checks Drive every turn and reuses exports only when the
    // document revision and current download access are confirmed unchanged.
    const documents = await loadDocuments(folderId, config?.configurable?.owner);
    const hash = createHash('sha256').update(JSON.stringify(documents)).digest('hex');
    if (hash !== cachedHash) {
      const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1800, chunkOverlap: 250 });
      const chunks = [];
      for (const document of documents)
        for (const section of passagesFor(document)) {
          for (const text of await splitter.splitText(section.text))
            chunks.push(
              new Document({
                pageContent: text,
                metadata: {
                  title: section.title,
                  heading: section.heading,
                  terms: new Set(words(text + ' ' + section.heading)),
                },
              }),
            );
        }
      cachedRetriever = new CompanyRetriever(chunks);
      cachedHash = hash;
    }
    return cachedRetriever.invoke(query, config);
  };
}
