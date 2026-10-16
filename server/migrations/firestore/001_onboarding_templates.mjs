import { journeyCollections } from '../../onboarding-collections.mjs';
import { builtInTemplate, tracks } from '../../onboarding-content.mjs';

// Issue #47: seeds onboardingTemplates/{track} for employee, intern and
// contractor with the built-in footprint (server/onboarding-content.mjs). A
// template that already exists is left as it is, so re-running changes
// nothing and a later HR edit is never overwritten. A change to a seeded
// template needs a new migration file.
export async function up({ firestore, log }) {
  let created = 0,
    kept = 0;
  for (const track of tracks) {
    const ref = firestore.collection(journeyCollections.templates).doc(track);
    const wrote = await firestore.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, builtInTemplate(track));
      return true;
    });
    if (wrote) created++;
    else kept++;
  }
  log(`onboarding templates: ${created} created, ${kept} already present`);
}
