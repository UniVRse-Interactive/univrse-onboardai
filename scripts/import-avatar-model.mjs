import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, basename } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/import-avatar-model.mjs <ALYA.glb>');
const source = resolve(process.argv[2]);
const packageDirectory = dirname(source);
const supplied = JSON.parse(await readFile(join(packageDirectory, 'asset-info.json'), 'utf8'));
const provenance = await readFile(join(packageDirectory, 'PROVENANCE.md'), 'utf8');
const bytes = await readFile(source);
if (
  bytes.toString('ascii', 0, 4) !== 'glTF' ||
  bytes.readUInt32LE(4) !== 2 ||
  bytes.readUInt32LE(8) !== bytes.length
)
  throw new Error('Expected a complete glTF 2.0 binary model.');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const controls = [...new Set(gltf.meshes.flatMap((mesh) => mesh.extras?.targetNames || []))];
for (const name of ['viseme_aa', 'viseme_PP', 'viseme_O', 'eyeBlinkLeft', 'eyeBlinkRight'])
  if (!controls.includes(name)) throw new Error('Missing avatar control: ' + name);
for (const name of ['Head', 'Neck', 'Spine2', 'Hips'])
  if (!gltf.nodes.some((node) => node.name === name))
    throw new Error('Missing avatar bone: ' + name);
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== supplied.sha256 || bytes.length !== supplied.originalBytes)
  throw new Error('The supplied model does not match its asset-info.json.');
if (gltf.buffers.some((buffer) => buffer.uri) || gltf.images?.some((image) => image.uri))
  throw new Error('The avatar must embed its geometry and textures.');
const gzip = gzipSync(bytes, { level: 9 });
if (!gunzipSync(gzip).equals(bytes)) throw new Error('Compressed model verification failed.');
const destination = resolve('public/avatars/alya');
await mkdir(destination, { recursive: true });
// Keep the previous local assets available without adding a second model to Git.
const previous = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
const backup = resolve('.cache/avatar-history/before-' + previous.sha256.slice(0, 12));
await mkdir(backup, { recursive: true });
for (const file of ['alya.glb.gz', 'manifest.json', 'poster.png', 'PROVENANCE.md']) {
  try {
    await copyFile(join(destination, file), join(backup, file), 1);
  } catch (error) {
    if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error;
  }
}
await writeFile(join(destination, 'alya.glb.gz'), gzip);
await writeFile(
  join(destination, 'manifest.json'),
  JSON.stringify(
    {
      ...supplied,
      sourcePackage: 'ALYA-avatar/ALYA-avatar/' + basename(source),
      sha256: hash,
      originalBytes: bytes.length,
      transferBytes: gzip.length,
      compression: 'Lossless gzip; all geometry, textures, bones and facial controls unchanged.',
      facialControls: controls,
      meshCount: gltf.meshes.length,
    },
    null,
    2,
  ),
);
await writeFile(
  join(destination, 'PROVENANCE.md'),
  '# Website integration\n\nImported from the user-supplied ALYA-avatar/ALYA-avatar/ALYA.glb package. The model is preserved byte for byte inside lossless gzip; the manifest records its SHA-256. The supplied material, lighting and animation helpers are integrated with the existing presentation and audio-clock-driven mouth timing. Previous model assets are backed up locally in the ignored .cache/avatar-history directory.\n\nThe source package’s provenance follows unchanged. Its reproduction paths and earlier validation notes describe the source project, not this website. No additional ownership or license claims are made here.\n\n---\n\n' +
    provenance,
);
console.log(
  JSON.stringify({
    name: 'Alya',
    originalMiB: +(bytes.length / 1048576).toFixed(1),
    transferMiB: +(gzip.length / 1048576).toFixed(1),
    facialControls: controls.length,
  }),
);
