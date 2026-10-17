import { journeyCollections, quickQuestionsDoc } from '../../onboarding-collections.mjs';
import { builtInQuickQuestions } from '../../onboarding-content.mjs';

// Issue #50: seeds config/quickQuestions with the general quick-question chips
// per track (server/onboarding-content.mjs). An existing document is left as
// it is, so re-running changes nothing.
export async function up({ firestore, log }) {
  const ref = firestore.collection(journeyCollections.config).doc(quickQuestionsDoc);
  const wrote = await firestore.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    tx.set(ref, builtInQuickQuestions());
    return true;
  });
  log(`quick questions: ${wrote ? 'created' : 'already present'}`);
}
