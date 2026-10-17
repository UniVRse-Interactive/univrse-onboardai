import { journeyCollections } from '../../onboarding-collections.mjs';
import { builtInTemplate, templateVersion, tracks } from '../../onboarding-content.mjs';

// Contract v1.4 and v1.5 (issue #63): template version 2, with shuffled choice
// checks and written checks, and Alya's briefing on every required step.
// Migration 001 never updates a template it already seeded, so stacks seeded
// with version 1 keep the old content. This overwrites onboardingTemplates/
// {track} wherever the stored version is below the built-in one (or missing,
// or the document is gone) and keeps a template that is already at or above
// it. Step ids are unchanged, so onboardingProgress is untouched. Re-running
// changes nothing. Every later content change needs its own version bump and
// a migration like this one.
export async function up({ firestore, log }) {
  const counts = { upgraded: 0, created: 0, kept: 0 };
  for (const track of tracks) {
    const ref = firestore.collection(journeyCollections.templates).doc(track);
    const outcome = await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        tx.set(ref, builtInTemplate(track));
        return 'created';
      }
      const version = snapshot.data()?.version;
      if (Number.isInteger(version) && version >= templateVersion) return 'kept';
      tx.set(ref, builtInTemplate(track));
      return 'upgraded';
    });
    counts[outcome]++;
  }
  log(
    `onboarding templates v${templateVersion}: ${counts.upgraded} upgraded, ${counts.created} created, ${counts.kept} already current`,
  );
}
