// Alya's briefing on a required step (contract v1.5). The briefing text comes
// from GET /api/me/onboarding; there is no chat turn. Pure rules; the page renders.

import { stepBounds } from './scene-steps.mjs';
import { journeyErrorMessage } from '../access/journey-errors.mjs';

export const briefingTitle = (step) => `Briefing: ${step?.title || 'this step'}`;
export const readButtonLabel = 'I’ve read the briefing';

// The transcript entry for a briefing. It is never saved to the conversation.
// Its reply is the whole briefing text, so Alya presents and says all of it.
export function briefingMessage(step) {
  const text = String(step?.briefing?.text || '').trim();
  if (!step?.id || !text) return null;
  return {
    id: 'briefing-' + step.id,
    role: 'assistant',
    briefing: true,
    stepId: step.id,
    stepTitle: step.title,
    text,
    reply: text,
    spoken: text,
    referenceQuestion: step.title,
    source: step.briefing.sourceTitle || '',
    passages: [],
  };
}

// The voice path: only a natural end counts as "listened". A stop, an
// interruption, leaving the page or a voice failure records nothing.
export function listenedCompletion(outcome) {
  return outcome === 'ended' ? 'listened' : null;
}

// The read path is offered when Alya cannot speak (voice off or unavailable),
// and only on the last page of the last scene.
export function canConfirmRead({ voiceAvailable, step, order, pageCounts } = {}) {
  if (voiceAvailable || !Array.isArray(order) || !order.length || !step) return false;
  return stepBounds(step, order, pageCounts).last;
}

// After the briefing: the card with the step's own action.
//   self -> Mark as done, hr_verify -> I've submitted this (both POST complete),
//   check -> Take the check (back to the dashboard with the check open).
export function briefingAction(step) {
  const title = step?.title || 'this step';
  if (step?.status === 'done') return { kind: 'none', text: `“${title}” is already done.` };
  if (step?.status === 'submitted')
    return { kind: 'none', text: `“${title}” is waiting for HR to verify.` };
  if (step?.completion === 'self')
    return { kind: 'complete', label: 'Mark as done', done: `Marked “${title}” as done.` };
  if (step?.completion === 'hr_verify')
    return {
      kind: 'complete',
      label: 'I’ve submitted this',
      done: `Sent “${title}” to HR to verify.`,
    };
  if (step?.completion === 'check') return { kind: 'check', label: 'Take the check', done: '' };
  return { kind: 'none', text: '' };
}

export function briefingRecordedText(completion) {
  if (completion === 'read') return 'Briefing done. Thanks for reading it.';
  if (completion === 'helpful') return 'Briefing done. Marked as helpful.';
  return 'Briefing done. Thanks for listening.';
}

// Calm wording for the briefing routes' errors.
export function briefingErrorMessage(error) {
  switch (error?.code) {
    case 'BRIEFING_NOT_FOUND':
      return 'This step has no briefing to record. Your dashboard has the latest steps.';
    case 'BRIEFING_REQUIRED':
      return 'The briefing isn’t recorded yet. Please listen to it or read it to the end.';
    case 'STEP_NOT_FOUND':
      return 'This step is no longer in your plan.';
    default:
      return journeyErrorMessage(error, 'That did not work. Please try again.');
  }
}

// The briefing for a step id in an Onboarding payload, or why there is none.
export function findBriefing(onboarding, stepId) {
  for (const area of onboarding?.areas || [])
    for (const step of area.steps || [])
      if (step.id === stepId)
        return step.briefing?.text
          ? { step, area }
          : { step, area, missing: 'This step has no briefing from Alya.' };
  return { missing: 'This step is no longer in your plan.' };
}
