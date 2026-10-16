import { spokenText } from './speech-text-and-mouth-timing.js';

const clothingWords =
  /\b(wear|wearing|dress|attire|clothes|clothing|outfits?|jeans|shirts?|t-?shirt|blouse|trousers|skirts?|slippers|sleepwear|beachwear|business casual|smart casual)\b/i;

// Keep contrasting permissions in separate scenes ("wear trousers, but avoid
// ripped jeans") without rewriting the source or losing character offsets.
function spokenSegments(text) {
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].flatMap(
    ({ segment, index }) => {
      const cuts = [0];
      for (const match of segment.matchAll(/;\s+|\s+(?=(?:but|whereas|however|instead)\b)/gi))
        cuts.push(match.index + match[0].length);
      cuts.push(segment.length);
      return cuts.slice(0, -1).map((start, part) => ({
        segment: segment.slice(start, cuts[part + 1]),
        index: index + start,
      }));
    },
  );
}

export function clothingPresentation(message, reply) {
  const question = message.referenceQuestion || '';
  const isTopic =
    clothingWords.test(question) ||
    ((!question || /\b(first.day|first.week|orientation)\b/i.test(question)) &&
      clothingWords.test(reply));
  if (!isTopic || !reply?.trim()) return null;
  // Match precisely the cleaned text passed to speechChunks/getProgress.
  const text = spokenText(reply);
  let previousGarments = [];
  const scenes = spokenSegments(text).map(({ segment, index }) => {
    const sentence = segment.trim();
    const garments = [];
    if (/\b(blouses?)\b/i.test(sentence)) garments.push('blouse');
    if (/\b(?:collared|smart) shirts?\b/i.test(sentence)) garments.push('collared');
    else if (/\bt[ -]?shirts?\b/i.test(sentence)) garments.push('shirt');
    else if (/\bshirts?\b/i.test(sentence)) garments.push('collared');
    if (/\b(blazers?|suit jackets?)\b/i.test(sentence)) garments.push('blazer');
    if (/\b(?:a |knee.length |modest |office )dress\b|\bdresses\b/i.test(sentence))
      garments.push('dress');
    if (/\bjeans\b/i.test(sentence)) garments.push('jeans');
    if (/\btrousers\b/i.test(sentence)) garments.push('trousers');
    if (/\bskirts?\b/i.test(sentence)) garments.push('skirt');
    if (/\bshorts|short (?:hot )?pants|hot pants\b/i.test(sentence)) garments.push('shorts');
    if (/\bslippers\b/i.test(sentence)) garments.push('slippers');
    if (/\bsleepwear|pyjamas|pajamas\b/i.test(sentence)) garments.push('sleepwear');
    if (/\bbeachwear|swimwear\b/i.test(sentence)) garments.push('beachwear');
    if (/\b(shoes|loafers|flats|closed.toe)\b/i.test(sentence)) garments.push('shoes');
    const casual = sentence.match(/\b(business casual|smart casual)\b/i)?.[1];
    const neat = /\b(clean|neat|neatly|tidy)\b/i.test(sentence);
    if (
      !garments.length &&
      previousGarments.length === 1 &&
      /\b(pair|(?:wear|choose|keep|select|clean|press)\s+(?:it|them|these))\b/i.test(sentence)
    )
      garments.push(...previousGarments);
    if (!garments.length && (casual || neat)) garments.push('outfit');
    previousGarments = garments;
    const avoid =
      !/\b(not prohibited|not forbidden|no need to avoid|do not need to avoid|not inappropriate)\b/i.test(
        sentence,
      ) &&
      /\b(avoid|not allowed|not permitted|prohibited|do not wear|not to be worn|must not wear|cannot wear|can['’]t wear|never wear|not appropriate|inappropriate)\b/i.test(
        sentence,
      );
    const conditional =
      /\b(only|unless|except|approval|if|weekdays|check|confirm|depends|policy|dress code)\b/i.test(
        sentence,
      );
    const label = avoid
      ? /\bweekdays\b/i.test(sentence)
        ? 'Avoid on weekdays'
        : 'Avoid for office'
      : /\bFridays? only|only on Fridays?\b/i.test(sentence)
        ? 'Friday only'
        : casual
          ? casual[0].toUpperCase() + casual.slice(1)
          : neat
            ? 'Neat & tidy'
            : garments.length > 1
              ? 'Office clothing'
              : {
                  blazer: 'Blazer',
                  dress: 'Office dress',
                  shoes: 'Office shoes',
                  blouse: 'Blouse',
                  collared: 'Collared shirt',
                  shirt: 'T-shirt',
                  jeans: 'Jeans',
                  trousers: 'Trousers',
                  skirt: 'Skirt',
                  shorts: 'Shorts',
                  slippers: 'Slippers',
                  sleepwear: 'Sleepwear',
                  beachwear: 'Beachwear',
                }[garments[0]] || 'Dress guidance';
    return {
      start: index,
      end: index + segment.length,
      body: sentence,
      label,
      garments: [...new Set(garments)],
      ripped: /\bripped jeans\b/i.test(sentence),
      avoid,
      conditional,
    };
  });
  // Blank/non-clothing sentences remain in the timeline as deliberate gaps,
  // so an old garment is never shown during unrelated spoken information.
  return scenes.some((scene) => scene.garments.length) ? { text, scenes } : null;
}

export function clothingSceneAt(presentation, character) {
  if (!presentation || !Number.isFinite(character)) return -1;
  const index = presentation.scenes.findIndex(
    (scene) => character >= scene.start && character < scene.end,
  );
  return index >= 0 && presentation.scenes[index].garments.length ? index : -1;
}
