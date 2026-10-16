import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupVoiceNote,
  configuredVoiceLabel,
  naturalPaceLine,
  showsSpeedControl,
  usingBackupVoice,
} from '../../src/avatar/voice-label.mjs';
import { createServerSpeech } from '../../src/avatar/answer-audio-player.js';

// /api/config: voice: { id, label, provider }; id equals X-Alya-Voice exactly.
const gemini = {
  sharedVoiceName: 'Alya · Heart (English)',
  voice: { id: 'gemini-sulafat', label: 'Alya · Sulafat (English)', provider: 'gemini' },
};

test('the settings name the configured voice from /api/config', () => {
  assert.equal(configuredVoiceLabel(gemini), 'Alya · Sulafat (English)');
  // An older server without `voice` keeps its shared voice name.
  assert.equal(
    configuredVoiceLabel({ sharedVoiceName: 'Alya · Heart (English)' }),
    'Alya · Heart (English)',
  );
  assert.equal(configuredVoiceLabel(null), 'Alya’s voice');
});

test('a clip whose X-Alya-Voice differs from config.voice.id is the backup voice', () => {
  assert.equal(usingBackupVoice(gemini, 'gemini-sulafat'), false);
  assert.equal(usingBackupVoice(gemini, 'kokoro-af-heart'), true, 'Kokoro stepped in');
  assert.equal(usingBackupVoice(gemini, ''), false, 'nothing has spoken yet');
  const kokoro = { voice: { id: 'kokoro-af-heart', label: 'Alya · Heart', provider: 'kokoro' } };
  assert.equal(usingBackupVoice(kokoro, 'kokoro-af-heart'), false);
  // The id is compared, never names inside labels.
  assert.equal(
    usingBackupVoice({ voice: { id: 'gemini-sulafat', label: 'Alya · Heart' } }, 'gemini-sulafat'),
    false,
  );
  assert.equal(backupVoiceNote, 'Using Alya’s backup voice right now.');
});

test('an older server without config.voice never shows the backup note', () => {
  const older = { sharedVoiceName: 'Alya · Heart (English)' };
  assert.equal(usingBackupVoice(older, 'gemini-sulafat'), false);
  assert.equal(usingBackupVoice(older, 'kokoro-af-heart'), false);
  assert.equal(usingBackupVoice({ voice: { label: 'Alya' } }, 'kokoro-af-heart'), false);
  assert.equal(usingBackupVoice(null, 'kokoro-af-heart'), false);
});

test('the speed control is hidden for the Gemini voice, which has a natural pace only', () => {
  assert.equal(showsSpeedControl(gemini), false);
  assert.equal(naturalPaceLine, 'Alya’s voice speaks at a natural pace.');
  assert.equal(
    showsSpeedControl({
      voice: { id: 'kokoro-af-heart', label: 'Alya · Heart', provider: 'kokoro' },
    }),
    true,
  );
  assert.equal(
    showsSpeedControl({ sharedVoiceName: 'Alya · Heart (English)' }),
    true,
    'older server',
  );
  assert.equal(showsSpeedControl(null), true);
  // A Kokoro fallback mid-session does not reveal it: the rule reads config only.
  assert.equal(usingBackupVoice(gemini, 'kokoro-af-heart'), true);
  assert.equal(showsSpeedControl(gemini), false);
});

test('the player reports each clip’s X-Alya-Voice', async () => {
  const originalWindow = globalThis.window,
    originalFetch = globalThis.fetch;
  class AudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    createBufferSource() {
      return {
        connect() {},
        disconnect() {},
        start() {
          setImmediate(() => this.onended?.());
        },
        stop() {},
      };
    }
  }
  globalThis.window = { AudioContext };
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'X-Alya-Voice': 'kokoro-af-heart' }),
    arrayBuffer: async () => new ArrayBuffer(4),
  });
  const voices = [];
  const player = createServerSpeech({ onVoice: (voice) => voices.push(voice) });
  try {
    assert.equal(await player.speak('Ask HR first.'), 'ended');
    assert.deepEqual(voices, ['kokoro-af-heart']);
  } finally {
    player.dispose();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
