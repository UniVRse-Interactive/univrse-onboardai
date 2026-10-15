export const voiceRates = [0.85, 0.95, 1, 1.05];
export const voiceRequestError = 'Enter voice text of up to 700 characters with a supported speed.';

// Returns { text, rate } for a valid request body, otherwise null.
export function parseVoiceRequest(body) {
  const { text, rate = 1 } = body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 700 || !voiceRates.includes(rate))
    return null;
  return { text: text.trim(), rate };
}

export function voiceFailure(error) {
  const busy = error?.message === 'VOICE_BUSY';
  return {
    status: 503,
    code: busy ? 'VOICE_BUSY' : 'VOICE_UNAVAILABLE',
    error: busy
      ? 'Alya’s voice is busy. Please try again shortly.'
      : 'Alya’s shared voice is unavailable. The administrator should run npm run voice:prepare. Your text answer is still available.',
  };
}
