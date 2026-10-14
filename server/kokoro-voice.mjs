import { resolve } from 'node:path';

export const sharedVoiceName = 'Alya · Heart (English)';
export function encodeWav(samples, sampleRate = 24000) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  return wav;
}
export function createSharedVoice({ allowDownload = false } = {}) {
  let enginePromise = null,
    tail = Promise.resolve(),
    waiting = 0;
  async function engine() {
    if (!enginePromise)
      enginePromise = (async () => {
        const { env } = await import('@huggingface/transformers');
        env.cacheDir = resolve(process.env.KOKORO_CACHE_DIR || '.cache/kokoro');
        env.allowRemoteModels = allowDownload;
        const { KokoroTTS } = await import('kokoro-js');
        return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'cpu',
        });
      })().catch((error) => {
        enginePromise = null;
        throw error;
      });
    return enginePromise;
  }
  return {
    name: sharedVoiceName,
    async prepare() {
      await engine();
    },
    async render(text, rate = 1) {
      if (waiting >= 8) throw new Error('VOICE_BUSY');
      waiting++;
      const job = tail
        .catch(() => {})
        .then(async () => {
          const tts = await engine();
          const audio = await tts.generate(text, { voice: 'af_heart', speed: rate });
          return encodeWav(audio.audio, audio.sampling_rate);
        });
      tail = job;
      try {
        return await job;
      } finally {
        waiting--;
      }
    },
  };
}
