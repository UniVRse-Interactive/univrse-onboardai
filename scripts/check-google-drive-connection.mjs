import { existsSync } from 'node:fs';
import { readDriveKnowledge, driveFailure } from '../server/google-drive-documents.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
try {
  const documents = await readDriveKnowledge(process.env.GOOGLE_DRIVE_FOLDER_ID);
  console.log(
    JSON.stringify({
      ok: true,
      access: process.env.GOOGLE_DRIVE_ACCESS === 'public' ? 'public' : 'authenticated',
      documents: documents.length,
      characters: documents.reduce((sum, document) => sum + document.text.length, 0),
    }),
  );
} catch (error) {
  console.error(JSON.stringify(driveFailure(error)));
  process.exitCode = 1;
}
