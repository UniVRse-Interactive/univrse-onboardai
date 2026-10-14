import { mkdir, writeFile } from 'node:fs/promises';
import { createSharedVoice } from '../server/kokoro-voice.mjs';
console.log(
  'Preparing the fixed Alya Heart voice. The model is downloaded once and cached locally.',
);
const voice = createSharedVoice({ allowDownload: true });
await voice.prepare();
const wav = await voice.render(
  'Hello. I am Alya, your onboarding companion. How may I help you today?',
);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/alya-heart-voice.wav', wav);
console.log(`Ready: ${voice.name}. Verified WAV audio: ${wav.length} bytes.`);
