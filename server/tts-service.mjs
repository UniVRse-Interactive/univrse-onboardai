import { createTtsApp } from './tts-app.mjs';
import { createSharedVoice } from './kokoro-voice.mjs';
import { startService } from './service-runtime.mjs';

// The model comes from the image (KOKORO_CACHE_DIR / .cache/kokoro); it is never downloaded here.
const sharedVoice = createSharedVoice();
const app = createTtsApp({ sharedVoice });
const started = Date.now();
startService(app, { name: 'OnboardAi TTS' });
sharedVoice
  .prepare()
  .then(() => {
    app.locals.setReady(true);
    console.log(`Voice model loaded in ${Date.now() - started} ms.`);
  })
  .catch((error) => {
    console.error(`Voice model could not be loaded: ${error.message}`);
    process.exit(1);
  });
