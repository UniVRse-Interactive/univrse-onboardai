import { GoogleAuth } from 'google-auth-library';

process.loadEnvFile('.env');

async function testDrive() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId || !/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new Error('Set a valid GOOGLE_DRIVE_FOLDER_ID in .env.');
  }

  // Uses the keyless credentials created by gcloud.
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const client = await auth.getClient();

  // Confirm that the service account can access the folder.
  const folder = await client.request({
    url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId),
    params: {
      fields: 'name,mimeType',
      supportsAllDrives: true,
    },
  });

  if (folder.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('The ID must belong to a Drive folder.');
  }

  console.log('Folder accessible: ' + folder.data.name);

  // Find Google Docs directly inside this folder.
  const listing = await client.request({
    url: 'https://www.googleapis.com/drive/v3/files',
    params: {
      q:
        `'${folderId}' in parents ` +
        'and trashed = false ' +
        "and mimeType = 'application/vnd.google-apps.document'",
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });

  const documents = listing.data.files || [];

  if (documents.length === 0) {
    console.log('Add a Google Doc directly inside the folder.');
    return;
  }

  const document = documents[0];

  const exported = await client.request({
    url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(document.id) + '/export',
    params: {
      mimeType: 'text/plain',
    },
    responseType: 'text',
  });

  console.log('Document read: ' + document.name);
  console.log('Characters read: ' + String(exported.data).length);
  console.log('Drive connection successful!');
}

testDrive().catch((error) => {
  console.error('Drive test failed.');

  const status = error.response?.status;
  if (status) console.error('HTTP status: ' + status);

  const googleMessage = error.response?.data?.error?.message;
  console.error(googleMessage || error.message);

  process.exitCode = 1;
});
