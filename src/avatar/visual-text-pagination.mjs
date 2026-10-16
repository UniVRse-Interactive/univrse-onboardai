// Split for the available reading space, without summarising or removing words.
// `fits` measures the actual paragraph style in the browser.
export function paginateVisualText(text, fits) {
  const pages = [];
  let start = 0;
  while (start < text.length) {
    while (/\s/.test(text[start] || '') && start < text.length) start++;
    if (start === text.length) break;
    const rest = text.slice(start);
    let length = rest.length;
    if (!fits(rest)) {
      // Search by code point so an emoji or non-Latin character stays intact.
      const characters = Array.from(rest);
      let low = 1,
        high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(characters.slice(0, middle).join(''))) low = middle;
        else high = middle - 1;
      }
      length = characters.slice(0, low).join('').length;
      const prefix = rest.slice(0, length);
      // Prefer a complete sentence when it uses at least half the page.
      // Decimal points and the dots within a.m./p.m. are not boundaries here.
      const sentences = [...prefix.matchAll(/[.!?][”"')]*\s+(?=[A-Z“"])/g)];
      const sentence = sentences.at(-1);
      const phrases = [
        ...rest.matchAll(
          /\b(?:\d{1,2}(?:[.:]\d{2})?\s*[ap]\.?m\.?|not (?:allowed|permitted|required))\b/gi,
        ),
      ];
      const wordBoundary = [...prefix.matchAll(/\s+/g)]
        .filter(
          (boundary) =>
            !phrases.some(
              (phrase) =>
                boundary.index > phrase.index && boundary.index < phrase.index + phrase[0].length,
            ),
        )
        .at(-1);
      if (sentence && sentence.index + 1 >= length / 2)
        length = sentence.index + sentence[0].length;
      else if (wordBoundary && wordBoundary.index > 0) length = wordBoundary.index;
    }
    const end = start + length;
    pages.push({ start, end, text: text.slice(start, end).trim() });
    start = end;
  }
  return pages.length ? pages : [{ start: 0, end: 0, text: '' }];
}

export function visualPageAt(pages, character) {
  const next = pages.findIndex((page) => page.end > character);
  return next < 0 ? pages.length - 1 : next;
}
