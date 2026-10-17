import { retiredTopicAreas, documentCategories } from '../../onboarding-document-topics.mjs';

// Issue #68: companyDocuments.category moves from the six retired topic ids to
// the five onboarding areas (or 'additional'). Titles, text and everything else
// are untouched. A document already in a current category is left alone, and a
// category that is neither retired nor current becomes 'additional', so running
// this again changes nothing.
export async function up({ firestore, log }) {
  const counts = { moved: 0, additional: 0, kept: 0 };
  const found = await firestore.collection('companyDocuments').select('category').get();
  for (const doc of found.docs) {
    const category = doc.data().category;
    if (documentCategories.includes(category)) {
      counts.kept++;
      continue;
    }
    const next = Object.hasOwn(retiredTopicAreas, category)
      ? retiredTopicAreas[category]
      : 'additional';
    await firestore.runTransaction(async (tx) => {
      const ref = firestore.collection('companyDocuments').doc(doc.id);
      const current = await tx.get(ref);
      if (!current.exists || documentCategories.includes(current.data().category)) return;
      tx.update(ref, { category: next });
    });
    counts[next === 'additional' ? 'additional' : 'moved']++;
  }
  log(
    `company documents: ${counts.moved} re-filed into areas, ${counts.additional} set to additional, ${counts.kept} already current`,
  );
}
