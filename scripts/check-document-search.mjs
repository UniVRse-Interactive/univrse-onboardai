import { readDriveKnowledge, driveFailure } from '../server/google-drive-documents.mjs';
import { searchDocuments } from '../server/document-search.mjs';

process.loadEnvFile('.env');
try {
  const documents = await readDriveKnowledge(process.env.GOOGLE_DRIVE_FOLDER_ID);
  const questions = process.argv.slice(2);
  for (const question of questions.length
    ? questions
    : ['What are the hours of work?', 'What to wear?']) {
    const result = searchDocuments(question, documents);
    console.log(
      JSON.stringify(
        {
          question,
          mode: result.mode,
          matched: result.matched,
          passages: result.passages.map((passage) => ({
            title: passage.title,
            heading: passage.heading,
            characters: passage.text.length,
          })),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(driveFailure(error).error);
  process.exitCode = 1;
}
