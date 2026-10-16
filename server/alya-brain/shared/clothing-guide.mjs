// Shared, deterministic topic selection. No company policy is inferred from a garment.
export function clothingTopic(question, previous = null) {
  const q = String(question || '').toLowerCase();
  const explicit =
    /\b(dress\s*code|attire|outfits?|clothes|clothing|business\s+(casual|formal)|smart\s+casual|jeans|blouses?|skirts?|trousers|shirts?|t-?shirts?|footwear|shoes|sneakers?|sleeveless|sleepwear|beachwear|pajamas|pyjamas)\b/.test(
      q,
    ) || /\b(what|can|should|may|allowed|not|cannot)\b.{0,35}\bwear\b/.test(q);
  const continuation =
    /^(?:(?:and|but|what about|how about) (?:on )?(?:fridays?|mondays?|tuesdays?|wednesdays?|thursdays?|weekdays?|weekends?|tomorrow|the first day|ripped ones|plain ones|dark ones)|(?:can|may) i wear (?:it|them|those)(?: on friday)?|(?:is that|are those) (?:allowed|okay|ok|suitable)|show (?:me )?(?:more|examples)|give (?:me )?(?:an example|examples)|please (?:explain this step by step|give me a worked example|keep it short))[?.!]*$/i.test(
      q.trim(),
    );
  if (previous && continuation) return previous;
  if (!explicit) return null;
  if (/\bsneakers?\b/.test(q)) return 'sneakers';
  if (/\bsleeveless\b/.test(q)) return 'sleeveless';
  if (/\bjeans\b/.test(q)) return 'jeans';
  if (/business\s+formal/.test(q)) return 'formal';
  if (/business\s+casual/.test(q)) return 'business-casual';
  if (/smart\s+casual/.test(q)) return 'smart-casual';
  if (/\b(shoes|footwear)\b/.test(q)) return 'shoes';
  if (
    /\b(not suitable|unsuitable|avoid|cannot|can't|not allowed|sleepwear|beachwear|offensive)\b/.test(
      q,
    )
  )
    return 'avoid';
  return 'overview';
}

export const clothingAnswerInstruction =
  'For this clothing question, give a concise answer: normally 2–3 short spoken segments, about 40–55 words. Keep all necessary prohibitions, day-specific exceptions and conditions even if that needs more words. Keep examples brief and distinguish illustrations from company approvals. Do not recommend business casual, jeans or any item unless the reference passages support it. If the user asks whether an unseen outfit is suitable, ask for a description; do not pretend to see an image. When evidence is missing, say so and direct them to HR. Explicit requests for full detail may override brevity.';
