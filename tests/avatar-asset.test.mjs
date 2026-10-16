import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

test('website asset preserves the supplied ALYA package and its facial rig', async () => {
  const manifest = JSON.parse(await readFile('public/avatars/alya/manifest.json', 'utf8'));
  const compressed = await readFile('public/avatars/alya/alya.glb.gz'),
    bytes = gunzipSync(compressed);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(bytes.length, manifest.originalBytes);
  assert.equal(compressed.length, manifest.transferBytes);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const controls = new Set(gltf.meshes.flatMap((mesh) => mesh.extras?.targetNames || []));
  for (const name of ['viseme_aa', 'viseme_PP', 'viseme_O', 'eyeBlinkLeft', 'eyeBlinkRight'])
    assert.ok(controls.has(name), name);
  for (const name of ['Head', 'Neck', 'Spine2', 'Hips'])
    assert.ok(
      gltf.nodes.some((node) => node.name === name),
      name,
    );
  assert.deepEqual([...controls].sort(), [...manifest.facialControls].sort());
  assert.equal(controls.size, 66);
  assert.equal(gltf.meshes.length, manifest.meshCount);
  assert.equal(manifest.sourcePackage, 'ALYA-avatar/ALYA-avatar/ALYA.glb');
  assert.equal(manifest.outfitRevision, 'body-fitted-v2');
  assert.ok(gltf.images.every((image) => image.bufferView !== undefined));
});
