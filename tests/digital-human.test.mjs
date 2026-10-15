import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { prepareDigitalHuman } from '../src/avatar/digital-human.js';

test('replacement is a complete rigged GLB with compatible speech, eyes and preserved outfit', async () => {
  const manifest = JSON.parse(await readFile('public/avatars/alya/digital-human.json', 'utf8'));
  const compressed = await readFile('public/avatars/alya/digital-human.glb.gz');
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(compressed.length, manifest.transferBytes);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const controls = new Set(gltf.meshes.flatMap((mesh) => mesh.extras?.targetNames || []));
  for (const name of [
    'viseme_aa',
    'viseme_PP',
    'viseme_FF',
    'viseme_O',
    'eyeBlinkLeft',
    'eyeBlinkRight',
    'eyeLookOutLeft',
    'eyeLookInRight',
  ])
    assert.ok(controls.has(name), name);
  for (const name of ['Head', 'Neck', 'Spine2'])
    assert.ok(
      gltf.nodes.some((n) => n.name === name),
      name,
    );
  assert.ok(gltf.materials.some((m) => m.name === 'Human.body'));
  assert.ok(gltf.materials.some((m) => m.name === 'Alya_Wool'));
  assert.ok(gltf.materials.some((m) => m.name === 'Human.ponytail01'));
  for (const mesh of gltf.meshes)
    for (const p of mesh.primitives) {
      const count = gltf.accessors[p.attributes.POSITION].count;
      for (const target of p.targets || [])
        assert.equal(gltf.accessors[target.POSITION].count, count, mesh.name);
    }
  const wool = gltf.materials.find((m) => m.name === 'Alya_Wool');
  assert.ok(wool.normalTexture, 'woven normal map is embedded');
  assert.ok(wool.pbrMetallicRoughness.metallicRoughnessTexture, 'fabric roughness map is embedded');
  for (const node of gltf.nodes.filter((n) => /Notched_Lapel$/.test(n.name))) {
    const primitive = gltf.meshes[node.mesh].primitives[0];
    assert.ok(
      gltf.accessors[primitive.attributes.POSITION].count > 500,
      'lapels have a rolled, thickened surface',
    );
  }
  const sleeve = gltf.nodes.find((n) => n.name === 'Left_Jacket_Sleeve');
  const weightAccessor =
    gltf.accessors[gltf.meshes[sleeve.mesh].primitives[0].attributes.WEIGHTS_0];
  const view = gltf.bufferViews[weightAccessor.bufferView];
  const start =
    28 + bytes.readUInt32LE(12) + (view.byteOffset || 0) + (weightAccessor.byteOffset || 0);
  assert.equal(weightAccessor.componentType, 5126);
  let blended = 0;
  for (let i = 0; i < weightAccessor.count; i++) {
    const weights = Array.from({ length: 4 }, (_, c) =>
      bytes.readFloatLE(start + i * (view.byteStride || 16) + c * 4),
    );
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 0.0001, 'normalized skin weights');
    if (weights.filter((w) => w > 0.01).length > 1) blended++;
  }
  assert.ok(blended > weightAccessor.count / 2, 'sleeves blend across the skeleton');
  assert.ok(manifest.headPreservation.maxCoordinateDeltaMetres < 0.000001);
  assert.ok(manifest.headPreservation.checkedMorphs >= 150);
  assert.ok(compressed.length < 25_000_000);
});

test('new material preparation preserves geometry, morphs and texture data', () => {
  const geometry = new T.SphereGeometry();
  const material = new T.MeshStandardMaterial({ map: new T.Texture() });
  material.name = 'Human.body';
  const mesh = new T.Mesh(geometry, material);
  mesh.morphTargetInfluences = [0.2];
  const root = new T.Group();
  root.add(mesh);
  prepareDigitalHuman(root, { capabilities: { getMaxAnisotropy: () => 4 } });
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material.map, material.map);
  assert.equal(mesh.morphTargetInfluences[0], 0.2);
  assert.ok(mesh.material.isMeshPhysicalMaterial);
  assert.equal(mesh.material.map.anisotropy, 4);
});

test('visible neckline fits the chest and lapels sit outside their jacket support', async () => {
  const bytes = gunzipSync(await readFile('public/avatars/alya/digital-human.glb.gz'));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  function accessor(index) {
    const a = gltf.accessors[index];
    const v = gltf.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC3: 3 }[a.type];
    const size = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const start = 28 + jsonLength + (v.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count * width }, (_, i) => {
      const at =
        start + Math.floor(i / width) * (v.byteStride || width * size) + (i % width) * size;
      return a.componentType === 5126 ? bytes.readFloatLE(at) : bytes.readUIntLE(at, size);
    });
  }
  function mesh(name) {
    const node = gltf.nodes.find((n) => n.name === name);
    assert.ok(node, name);
    const p = gltf.meshes[node.mesh].primitives[0];
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(accessor(p.attributes.POSITION), 3),
    );
    geometry.setIndex(accessor(p.indices));
    const result = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    // Exported garment and human meshes share metre-scale identity transforms.
    assert.ok(
      !node.matrix || node.matrix.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6),
    );
    result.updateMatrixWorld();
    return result;
  }
  const body = mesh('Human'),
    shirt = mesh('Ivory_Blouse');
  const coat = mesh('Navy_Blazer_Body');
  const lapels = [mesh('Left_Notched_Lapel'), mesh('Right_Notched_Lapel')];
  const ray = new T.Raycaster();
  function front(surface, x, height) {
    ray.set(new T.Vector3(x, height, 1), new T.Vector3(0, 0, -1));
    return ray.intersectObject(surface, false)[0]?.point.z;
  }
  const positions = shirt.geometry.attributes.position;
  for (const x of [-0.05, -0.025, 0, 0.025, 0.05]) {
    let top = -Infinity;
    for (let i = 0; i < positions.count; i++)
      if (Math.abs(positions.getX(i) - x) < 0.0001) top = Math.max(top, positions.getY(i));
    assert.ok(top > 1.445 && top < 1.47, 'rounded neckline stays on retained upper chest');
    const height = top - 0.001;
    const skinDepth = front(body, x, height),
      fabricDepth = front(shirt, x, height);
    assert.ok(
      skinDepth !== undefined && fabricDepth !== undefined,
      'both skin and fabric cover neckline',
    );
    const gap = fabricDepth - skinDepth;
    assert.ok(gap > 0.001 && gap < 0.008, `neckline clearance ${gap} at ${x}`);
  }
  let supported = 0;
  for (const x of [-0.115, -0.1, 0.1, 0.115]) {
    for (const height of [1.24, 1.3, 1.36, 1.42, 1.46]) {
      const jacket = front(coat, x, height);
      const lapel = front(x < 0 ? lapels[1] : lapels[0], x, height);
      if (jacket === undefined || lapel === undefined) continue;
      assert.ok(lapel > jacket + 0.0003, 'lapel does not sink into jacket');
      assert.ok(lapel - jacket < 0.015, 'lapel stays supported by jacket');
      supported++;
    }
  }
  assert.ok(supported >= 8, 'check both lapels across chest and collar');
  for (const m of [body, shirt, coat, ...lapels]) {
    m.geometry.dispose();
    m.material.dispose();
  }
});
