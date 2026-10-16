import { speechChunks, makeWordSchedule, spokenText } from './speech-text-and-mouth-timing.js';

export function createServerSpeech({ onStatus = () => {} } = {}) {
  const Context = window.AudioContext || window.webkitAudioContext;
  let context = null,
    source = null,
    abort = null,
    generation = 0,
    frame = null,
    disposed = false;
  const supported = !!Context;
  function prime() {
    if (!supported) return;
    if (!context) context = new Context();
    context.resume().catch(() => {});
  }
  function stop(report = true) {
    generation++;
    abort?.abort();
    abort = null;
    frame = null;
    const active = source;
    source = null;
    try {
      active?.stop();
    } catch {}
    if (report && !disposed) onStatus({ state: 'idle', error: '' });
  }
  function getFrame() {
    if (!frame || context?.state !== 'running') return { speaking: false, viseme: 'sil', value: 0 };
    const elapsed = (context.currentTime - frame.start) * 1000;
    let offset = 0;
    for (const word of frame.words) {
      const duration = word.duration * frame.scale,
        gap = 60 * frame.scale;
      if (elapsed < offset + duration + gap) {
        const local = (elapsed - offset) / frame.scale,
          index = word.times.findLastIndex((time) => time <= local);
        if (index < 0 || local > word.duration) return { speaking: true, viseme: 'sil', value: 0 };
        const progress = Math.min(
          1,
          (local - word.times[index]) / Math.max(1, word.durations[index]),
        );
        return {
          speaking: true,
          viseme: word.visemes[index] || 'sil',
          value: 0.55 * Math.sin(Math.PI * progress),
        };
      }
      offset += duration + gap;
    }
    return { speaking: true, viseme: 'sil', value: 0 };
  }
  function getProgress() {
    if (!frame || context?.state !== 'running') return null;
    const elapsed = Math.max(0, (context.currentTime - frame.start) * 1000);
    let offset = 0;
    for (const word of frame.words) {
      offset += (word.duration + 60) * frame.scale;
      if (elapsed < offset) return frame.character + word.charIndex;
    }
    return frame.character + frame.length - 1;
  }
  async function speak(text, { rate = 0.95, segments } = {}) {
    stop(false);
    const token = generation;
    if (!supported) {
      onStatus({
        state: 'unavailable',
        error: 'Audio playback is unsupported in this browser. Your text answer is available.',
      });
      return;
    }
    prime();
    // Scene boundaries are also audio boundaries. Validate against the actual
    // answer so a stale presentation can never replace or omit spoken words.
    const prepared = Array.isArray(segments) ? segments.map(spokenText).filter(Boolean) : [];
    const chunks =
      prepared.length && prepared.join(' ') === spokenText(text)
        ? prepared.flatMap(speechChunks)
        : speechChunks(text);
    if (!chunks.length) return;
    abort = new AbortController();
    const signal = abort.signal;
    onStatus({ state: 'starting', error: '' });
    async function load(sentence) {
      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ text: sentence, rate }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Alya’s shared voice is unavailable.');
      }
      return context.decodeAudioData(await response.arrayBuffer());
    }
    try {
      let pending = load(chunks[0]);
      for (let i = 0; i < chunks.length; i++) {
        const audio = await pending;
        if (disposed || generation !== token) return;
        // Prepare one following sentence while the current one plays.
        pending = i + 1 < chunks.length ? load(chunks[i + 1]) : null;
        pending?.catch(() => {});
        if (context.state !== 'running')
          throw new Error(
            'Sound is blocked. Allow audio for this website, then ask your question again.',
          );
        const active = context.createBufferSource();
        source = active;
        active.buffer = audio;
        active.connect(context.destination);
        const words = makeWordSchedule(chunks[i], rate),
          estimated = words.reduce((sum, word) => sum + word.duration + 60, 0) || 1;
        frame = {
          words,
          scale: (audio.duration * 1000) / estimated,
          start: context.currentTime,
          character: chunks.slice(0, i).reduce((sum, chunk) => sum + chunk.length + 1, 0),
          length: chunks[i].length,
        };
        onStatus({ state: 'speaking', error: '' });
        await new Promise((resolve) => {
          active.onended = resolve;
          active.start();
        });
        active.disconnect();
        if (generation !== token || disposed) return;
        frame = null;
        source = null;
        if (pending) onStatus({ state: 'starting', error: '' });
      }
      onStatus({ state: 'idle', error: '' });
    } catch (error) {
      if (generation !== token || disposed) return;
      stop(false);
      onStatus({
        state: 'unavailable',
        error:
          error.message || 'The shared voice could not play. Your text answer is still available.',
      });
    }
  }
  function dispose() {
    disposed = true;
    stop(false);
    context?.close().catch(() => {});
  }
  return { supported, prime, speak, stop, getFrame, getProgress, dispose };
}
