import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function glb(bytes) {
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.toString('utf8', 20, 20 + length)), bin: 28 + length };
}
function values(asset, index) {
  const a = asset.json.accessors[index];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  if (a.componentType !== 5126) throw new Error('Expected float geometry accessor');
  const out = new Float32Array(a.count * width);
  if (a.bufferView !== undefined) {
    const v = asset.json.bufferViews[a.bufferView];
    const start = asset.bin + (v.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < width; c++) {
        out[i * width + c] = asset.bytes.readFloatLE(
          start + i * (v.byteStride || width * 4) + c * 4,
        );
      }
  }
  if (a.sparse) {
    const { indices, values, count } = a.sparse;
    const iv = asset.json.bufferViews[indices.bufferView],
      vv = asset.json.bufferViews[values.bufferView];
    const io = asset.bin + (iv.byteOffset || 0) + (indices.byteOffset || 0);
    const vo = asset.bin + (vv.byteOffset || 0) + (values.byteOffset || 0);
    const size = { 5121: 1, 5123: 2, 5125: 4 }[indices.componentType];
    for (let i = 0; i < count; i++) {
      const at = asset.bytes.readUIntLE(io + i * size, size);
      for (let c = 0; c < width; c++)
        out[at * width + c] = asset.bytes.readFloatLE(vo + (i * width + c) * 4);
    }
  }
  return out;
}
const [beforePath, afterPath, fitReportPath] = process.argv.slice(2);
if (!beforePath || !afterPath)
  throw new Error('Usage: node scripts/package-tailored-avatar.mjs before.glb tailored.glb');
const before = glb(await readFile(beforePath)),
  after = glb(await readFile(afterPath));
let maxHeadDelta = 0,
  checkedMorphs = 0;
function compare(left, right) {
  if (left.length !== right.length) throw new Error('Head vertex count changed');
  for (let i = 0; i < left.length; i++) {
    const delta = Math.abs(left[i] - right[i]);
    if (!Number.isFinite(delta) || delta > 0.000001)
      throw new Error('Head or facial morph changed');
    maxHeadDelta = Math.max(maxHeadDelta, delta);
  }
}
for (const n of before.json.nodes.filter(
  (n) => n.mesh !== undefined && n.name.startsWith('Human'),
)) {
  const counterpart = after.json.nodes.find((o) => o.name === n.name);
  if (!counterpart) throw new Error(`Missing preserved mesh ${n.name}`);
  const a = before.json.meshes[n.mesh],
    b = after.json.meshes[counterpart.mesh];
  if (a.primitives.length !== b.primitives.length) throw new Error('Head primitives changed');
  for (let p = 0; p < a.primitives.length; p++) {
    compare(
      values(before, a.primitives[p].attributes.POSITION),
      values(after, b.primitives[p].attributes.POSITION),
    );
    const targets = a.primitives[p].targets || [];
    if (targets.length !== (b.primitives[p].targets || []).length)
      throw new Error('Facial controls changed');
    for (let t = 0; t < targets.length; t++) {
      if (a.extras.targetNames[t] !== b.extras.targetNames[t])
        throw new Error('Facial control ordering changed');
      compare(
        values(before, targets[t].POSITION),
        values(after, b.primitives[p].targets[t].POSITION),
      );
      checkedMorphs++;
    }
  }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compressed = gzipSync(after.bytes, { level: 9 });
const fitting = fitReportPath ? JSON.parse(await readFile(fitReportPath, 'utf8')) : null;
const path = 'public/avatars/alya/digital-human.json';
const manifest = JSON.parse(await readFile(path, 'utf8'));
Object.assign(manifest, {
  sha256: hash(after.bytes),
  originalBytes: after.bytes.length,
  transferBytes: compressed.length,
  meshCount: after.json.meshes.length,
  outfitRevision: fitting?.revision || 'tailored-wool-v1',
  headPreservation: {
    inputSha256: hash(before.bytes),
    maxCoordinateDeltaMetres: maxHeadDelta,
    checkedMorphs,
  },
});
if (fitting) manifest.garmentFitting = fitting;
else delete manifest.garmentFitting;
await writeFile('public/avatars/alya/digital-human.glb.gz', compressed);
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    checkedMorphs,
    maxHeadDelta,
    bytes: after.bytes.length,
    compressed: compressed.length,
  }),
);
