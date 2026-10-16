// Keep a source-character map through the same cleanup used by the voice.
// This lets the guide follow real audio playback without rewriting company policy.
export function presentationCues(guide) {
  let units = guide.text.split('').map((char, source) => ({ char, source }));
  function replace(pattern, replacement) {
    const text = units.map((unit) => unit.char).join('');
    const positions = [];
    units.forEach((unit) => {
      for (let i = 0; i < unit.char.length; i++) positions.push(unit);
    });
    const next = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      next.push(...positions.slice(cursor, match.index));
      next.push(
        ...Array.from(replacement, (char) => ({ char, source: positions[match.index].source })),
      );
      cursor = match.index + match[0].length;
    }
    next.push(...positions.slice(cursor));
    units = next;
  }
  replace(/https?:\/\/\S+/g, 'the linked resource');
  replace(/[*#`]/g, '');
  replace(/\n\s*[-•]\s*/g, '. ');
  replace(/\s+/g, ' ');
  if (units[0]?.char === ' ') units.shift();
  if (units.at(-1)?.char === ' ') units.pop();
  let cursor = 0;
  const ranges = guide.items.map((item) => {
    const found = guide.text.indexOf(item.body, cursor);
    const start = found < 0 ? cursor : found;
    cursor = start + item.body.length;
    return { start, end: cursor };
  });
  return {
    text: units.map((unit) => unit.char).join(''),
    offsets: units.map((unit) => unit.source),
    ranges,
  };
}

export function presentationPosition(cues, spokenCharacter) {
  const source = cues.offsets[Math.max(0, Math.min(cues.offsets.length - 1, spokenCharacter))] || 0;
  const part = Math.max(
    0,
    cues.ranges.findLastIndex((range) => range.start <= source),
  );
  const range = cues.ranges[part];
  return {
    part,
    character: Math.max(0, Math.min(range.end - range.start - 1, source - range.start)),
  };
}
