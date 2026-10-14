import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';

const source = resolve(
  process.argv[2] ||
    'C:/Users/User/OneDrive/Documents/ChatGPT/Original AI Avatar/model/alya-original.glb',
);
const bytes = await readFile(source);
if (
  bytes.toString('ascii', 0, 4) !== 'glTF' ||
  bytes.readUInt32LE(4) !== 2 ||
  bytes.readUInt32LE(8) !== bytes.length
)
  throw new Error('Expected a complete glTF 2.0 binary model.');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const controls = [...new Set(gltf.meshes.flatMap((mesh) => mesh.extras?.targetNames || []))];
for (const name of ['viseme_aa', 'viseme_PP', 'eyeBlinkLeft', 'eyeBlinkRight'])
  if (!controls.includes(name)) throw new Error('Missing avatar control: ' + name);
const gzip = gzipSync(bytes, { level: 9 });
if (!gunzipSync(gzip).equals(bytes)) throw new Error('Compressed model verification failed.');
const destination = resolve('public/avatars/alya');
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'alya.glb.gz'), gzip);
await copyFile(
  resolve(dirname(source), '../preview/blender-front.png'),
  join(destination, 'poster.png'),
);
await writeFile(
  join(destination, 'manifest.json'),
  JSON.stringify(
    {
      name: 'Alya',
      source: 'Original AI Avatar/model/alya-original.glb',
      sha256: createHash('sha256').update(bytes).digest('hex'),
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
  '# Alya\n\nImported from the user’s Original AI Avatar package. Original geometry, textures, blazer, hair, rig and facial controls are preserved byte for byte inside lossless gzip. The poster is its actual Blender render. No stock avatar model was substituted.\n\nBrowser rendering: Three.js (MIT). English text-to-mouth estimates: TalkingHead LipsyncEn (MIT). Speech: the visitor’s Web Speech API voices. Browser speech does not provide exact phoneme timing.\n',
);
console.log(
  JSON.stringify({
    name: 'Alya',
    originalMiB: +(bytes.length / 1048576).toFixed(1),
    transferMiB: +(gzip.length / 1048576).toFixed(1),
    facialControls: controls.length,
  }),
);
