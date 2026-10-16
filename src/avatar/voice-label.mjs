// Which voice the settings name (QA F-3). /api/config sends
// `voice: { id, label, provider }`, where `id` is exactly the X-Alya-Voice value
// of the configured voice. Each /api/voice response names the voice that spoke
// in its X-Alya-Voice header; a different value means the backup (fallback)
// voice is speaking. An older server without `voice` never shows the note.

export const backupVoiceNote = 'Using Alya’s backup voice right now.';

export function configuredVoiceLabel(config) {
  const label = config?.voice?.label || config?.sharedVoiceName;
  return typeof label === 'string' && label.trim() ? label.trim() : 'Alya’s voice';
}

// True when a clip's X-Alya-Voice is not the configured voice id.
export function usingBackupVoice(config, header) {
  const id = config?.voice?.id;
  if (typeof id !== 'string' || !id || typeof header !== 'string' || !header) return false;
  return header !== id;
}

// The Gemini voice has no rate control, so it always speaks at its natural
// pace: the speed control is hidden for it. Kokoro (or an older server without
// config.voice) keeps the control. A mid-session fallback to Kokoro does not
// bring the control back; `rate` is still sent and still applies to Kokoro.
export const naturalPaceLine = 'Alya’s voice speaks at a natural pace.';
export function showsSpeedControl(config) {
  return config?.voice?.provider !== 'gemini';
}
