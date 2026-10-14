// Microsoft SAPI visemes -> Oculus/TalkingHead morph names.
// https://learn.microsoft.com/dotnet/api/system.speech.synthesis.speechsynthesizer.visemereached
const mouths = [
  'sil',
  'aa',
  'aa',
  'O',
  'E',
  'RR',
  'I',
  'U',
  'O',
  'aa',
  'O',
  'aa',
  'aa',
  'RR',
  'nn',
  'SS',
  'CH',
  'TH',
  'FF',
  'DD',
  'kk',
  'PP',
];
export function waveDuration(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Invalid Windows voice audio.');
  let byteRate = 0,
    size = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 4),
      length = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + length > buffer.length) throw new Error('Truncated voice audio.');
    if (name === 'fmt ' && length >= 16) byteRate = buffer.readUInt32LE(offset + 16);
    if (name === 'data') size += length;
    offset += 8 + length + (length % 2);
  }
  if (!byteRate || !size) throw new Error('Empty Windows voice audio.');
  return (size / byteRate) * 1000;
}
export function speechTimeline(result) {
  const duration = waveDuration(Buffer.from(result.audioContent, 'base64'));
  const points = (result.mouths || [])
    .filter((p) => mouths[p.id] && Number.isFinite(p.time) && p.time >= 0 && p.time < duration)
    .sort((a, b) => a.time - b.time);
  if (!points.length) throw new Error('This installed voice did not provide mouth timings.');
  const visemes = [],
    vtimes = [],
    vdurations = [];
  for (let i = 0; i < points.length;) {
    const p = points[i],
      group = [];
    while (i < points.length && points[i].time === p.time) group.push(points[i++]);
    const end = Math.min(duration, points[i]?.time ?? duration);
    const length = Math.max(
      1,
      Math.min(Math.max(...group.map((p) => p.duration || end - p.time)), end - p.time),
    );
    // Some Windows voices report both halves of a diphthong at the same
    // offset. Split that syllable's duration rather than overlap its shapes.
    const shapes = group.flatMap((p) =>
      p.id === 9
        ? ['aa', 'U']
        : p.id === 10
          ? ['O', 'I']
          : p.id === 11
            ? ['aa', 'I']
            : [mouths[p.id]],
    );
    shapes.forEach((shape, j) => {
      visemes.push(shape);
      vtimes.push(p.time + (length * j) / shapes.length);
      vdurations.push(length / shapes.length);
    });
  }
  const spoken = (result.words || [])
    .filter((w) => w.text && Number.isFinite(w.time) && w.time >= 0 && w.time < duration)
    .sort((a, b) => a.time - b.time);
  return {
    audioContent: result.audioContent,
    voice: result.voice,
    durationMs: duration,
    words: spoken.map((w) => w.text),
    wtimes: spoken.map((w) => w.time),
    wdurations: spoken.map((w, i) => Math.max(1, (spoken[i + 1]?.time ?? duration) - w.time)),
    visemes,
    vtimes,
    vdurations,
  };
}
