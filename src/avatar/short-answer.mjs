import { simpleAnswer } from './visual-answer-content.mjs';

const detailSentence = 'Open the full answer for the remaining details and conditions.';

function plainSentence(text) {
  return text
    .trim()
    .replace(/^(?:[-•]|\d+[.)])(?:\s+|$)/, '')
    .replace(
      /^(?:Please keep in mind, however, that|It is important to note that|Please note that)\s+/i,
      '',
    )
    .replace(/\bin order to\b/gi, 'to')
    .replace(/\bprior to\b/gi, 'before')
    .replace(/\bat this point in time\b/gi, 'now')
    .replace(/^Generally, (.+) is acceptable\.$/i, '$1 is usually acceptable.')
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
    .trim();
}

export function replySentences(text) {
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(String(text || ''))]
    .map((entry) => plainSentence(entry.segment))
    .filter(Boolean);
}

function supportingScore(sentence, question) {
  const topic = (value) =>
    value
      .toLowerCase()
      .replace(
        /\b(wear|wearing|attire|outfits?|dress|clothes|clothing|shirts?|jeans)\b/g,
        'clothing',
      )
      .replace(/\b(hours?|workweek|schedule|starts?|finishes?)\b/g, 'schedule');
  const words = new Set(topic(question).match(/[a-z]{4,}/g) || []);
  const overlap = [...new Set(topic(sentence).match(/[a-z]{4,}/g) || [])].filter((word) =>
    words.has(word),
  ).length;
  const practical =
    /\b(check|ask|contact|prepare|bring|request|keep|submit|share|explain|show|allowed|acceptable|approval|only|before|after|must)\b/i.test(
      sentence,
    )
      ? 1
      : 0;
  const background = /\bprofessional business office\b|\bkeep in mind\b/i.test(sentence) ? 3 : 0;
  return overlap * 2 + practical - background;
}

// A compact explanation, not a two-line preview. Keep useful conditions whole
// and never invent additional facts just to reach a sentence count.
export function shortAnswer(
  text,
  { question = '', format = 'standard', exampleUnavailable = false } = {},
) {
  const cleaned = String(text || '')
    .replace(/[●•]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  let sentences = replySentences(replySentences(cleaned).map(simpleAnswer).join(' '));
  if (!sentences.length) sentences = [cleaned];
  const seen = new Set();
  sentences = sentences.filter((sentence) => {
    if (
      /:$/.test(sentence) ||
      /\b(?:as outlined|in advance as|as follows|as specified in the table)\s*(?:below)?\s*:/i.test(
        sentence,
      )
    )
      return false;
    const key =
      /^(?:Dress neatly during office hours|Clean, neat clothing is usually acceptable)\.$/i.test(
        sentence,
      )
        ? 'neat-clothing'
        : sentence.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!sentences.length) return 'Please read the full source for the complete instructions.';
  if (format === 'example') {
    const example = sentences.findIndex((sentence) =>
      /^(?:for example[,:]?|worked example:|example:|contoh[,:])/i.test(sentence),
    );
    if (example >= 0) sentences = sentences.slice(example);
  }
  // A specific permission question should lead with the source sentence about
  // that item, not an unrelated introductory policy paragraph.
  if (
    /\b(can|may|allowed|permitted|if i|boleh)\b/i.test(question) &&
    format !== 'steps' &&
    format !== 'example'
  ) {
    const normalize = (value) => value.toLowerCase().replace(/t[ -]?shirts?/g, 'tshirt');
    const ignored = new Set(
      'can may am are is i we wear wearing use using allowed permitted please office work company if my the a an on in to it this that do does could would should boleh saya pakai'.split(
        ' ',
      ),
    );
    const terms = (normalize(question).match(/[a-z]{3,}/g) || []).filter(
      (word) => !ignored.has(word),
    );
    const direct = sentences.findIndex((sentence) => {
      const words = new Set(normalize(sentence).match(/[a-z]{3,}/g) || []);
      return (
        terms.some((word) => words.has(word)) &&
        /\b(allowed|permitted|not|only|must|approval|prohibited)\b/i.test(sentence)
      );
    });
    if (direct > 0)
      sentences = [sentences[direct], ...sentences.filter((_, index) => index !== direct)];
  }
  const finish = (sentence) => (/[.!?][”"')]*$/.test(sentence) ? sentence : sentence + '.');
  const first = finish(sentences[0]);
  const brief = format === 'brief';
  const maximum = brief ? 2 : 3;
  const limit = brief ? 35 : 75;
  const candidates = sentences
    .slice(1)
    .map((sentence, index) => ({ sentence, index, score: supportingScore(sentence, question) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (format === 'steps' || format === 'example') candidates.sort((a, b) => a.index - b.index);
  const selected = [];
  let words = first.split(/\s+/).length;
  for (const candidate of candidates) {
    if (selected.length >= maximum - 1) break;
    const count = candidate.sentence.split(/\s+/).length;
    if (words + count > limit) continue;
    selected.push(candidate);
    words += count;
  }
  selected.sort((a, b) => a.index - b.index);
  const reply = [first, ...selected.map(({ sentence }) => finish(sentence))];
  // A necessary long condition remains one complete sentence. The original
  // source is still accessible if the rest cannot fit a concise explanation.
  if (reply.length === 1 && sentences.length > 1) reply.push(detailSentence);
  if (exampleUnavailable) {
    if (reply.length >= maximum) reply.pop();
    reply.push('This guidance does not include a worked example for this topic.');
  }
  return reply.join(' ');
}
