import test from 'node:test';
import assert from 'node:assert/strict';
import { speechTimeline, waveDuration } from '../server/windows-audio-mouth-timing.mjs';
import { createWindowsVoice } from '../server/optional-windows-voice.mjs';

function wave(ms) {
  const bytes = ms * 32,
    b = Buffer.alloc(44 + bytes);
  b.write('RIFF');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
test('mouth timings preserve silence, plosives and changes within a syllable', () => {
  const audio = wave(1000);
  assert.equal(waveDuration(audio), 1000);
  const data = speechTimeline({
    audioContent: audio.toString('base64'),
    words: [{ text: 'bye', time: 100 }],
    mouths: [
      { id: 0, time: 0, duration: 100 },
      { id: 21, time: 100, duration: 80 },
      { id: 11, time: 180, duration: 220 },
      { id: 4, time: 400, duration: 200 },
      { id: 6, time: 400, duration: 200 },
      { id: 0, time: 600, duration: 400 },
    ],
  });
  assert.deepEqual(data.visemes, ['sil', 'PP', 'aa', 'I', 'E', 'I', 'sil']);
  assert.deepEqual(data.vtimes, [0, 100, 180, 290, 400, 500, 600]);
  assert.deepEqual(data.vdurations, [100, 80, 110, 110, 100, 100, 400]);
  assert.equal(data.wtimes[0], 100);
  assert.equal(data.vtimes.at(-1) + data.vdurations.at(-1), 1000);
  assert.throws(() => waveDuration(Buffer.from('not-a-wave')), /Invalid/);
  assert.throws(
    () => speechTimeline({ audioContent: audio.toString('base64'), mouths: [] }),
    /mouth timings/,
  );
});
test(
  'installed Windows voice generates real audio with timestamps on the same sample clock',
  { skip: process.platform !== 'win32' },
  async () => {
    const voice = await createWindowsVoice();
    try {
      const standard = await voice.render('Of course. Welcome to your first day.', 0.95);
      const fast = await voice.render('Of course. Welcome to your first day.', 1.1);
      assert.equal(Buffer.from(standard.audioContent, 'base64').toString('ascii', 0, 4), 'RIFF');
      assert.equal(standard.words.length, 7);
      assert.ok(standard.visemes.includes('PP'));
      assert.ok(standard.visemes.includes('FF'));
      assert.ok(standard.wtimes[2] > standard.wtimes[1] + 500, 'sentence pause is retained');
      assert.ok(standard.durationMs > 3000);
      assert.ok(fast.durationMs < standard.durationMs, 'pace changes the audio and its timing');
      for (const data of [standard, fast]) {
        data.vtimes.forEach((time, i) => {
          assert.ok(time >= 0 && time < data.durationMs);
          assert.ok(data.vdurations[i] > 0);
          assert.ok(time + data.vdurations[i] <= data.durationMs + 1);
          if (i) assert.ok(time >= data.vtimes[i - 1]);
        });
        assert.equal(data.visemes.at(-1), 'sil');
        assert.ok(
          Math.abs(data.vtimes.at(-1) + data.vdurations.at(-1) - data.durationMs) < 5,
          'final silence ends at the WAV duration',
        );
      }
    } finally {
      voice.close();
    }
  },
);
