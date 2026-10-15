import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { sculptPortrait, sculptHair, styleAvatar } from '../src/avatar/avatar-art-direction.js';

function portrait(relative) {
  const root = new T.Group();
  const head = new T.Bone();
  head.name = 'Head';
  head.position.y = 1.53;
  root.add(head);
  const geometry = new T.BufferGeometry();
  const rest = [0.03, 1.56, 0.13, -0.03, 1.56, 0.13, 0, 1.59, 0.15];
  const delta = [0, -0.02, 0.01, 0, -0.02, 0.01, 0, 0, 0];
  geometry.setAttribute('position', new T.Float32BufferAttribute(rest, 3));
  geometry.morphTargetsRelative = relative;
  geometry.morphAttributes.position = [
    new T.Float32BufferAttribute(
      delta.map((value, index) => value + (relative ? 0 : rest[index])),
      3,
    ),
  ];
  const mesh = new T.Mesh(geometry, new T.MeshPhysicalMaterial());
  mesh.material.name = 'Face_Skin';
  mesh.name = 'Alya_Head';
  root.add(mesh);
  return { root, head, mesh, rest, delta };
}

for (const relative of [true, false]) {
  test(`portrait sculpt preserves the open-mouth endpoint (${relative ? 'relative' : 'absolute'} morph)`, () => {
    const { root, mesh, rest, delta } = portrait(relative);
    styleAvatar(root, { capabilities: { getMaxAnisotropy: () => 8 } });
    const position = mesh.geometry.attributes.position;
    const target = mesh.geometry.morphAttributes.position[0];
    for (let i = 0; i < 3; i++) {
      const expected = sculptPortrait(
        ...rest.slice(i * 3, i * 3 + 3).map((v, j) => v + delta[i * 3 + j]),
      );
      const actual = [target.getX(i), target.getY(i), target.getZ(i)];
      const base = [position.getX(i), position.getY(i), position.getZ(i)];
      actual.forEach((value, axis) =>
        assert.ok(Math.abs(value + (relative ? base[axis] : 0) - expected[axis]) < 1e-6),
      );
    }
    assert.equal(mesh.morphTargetInfluences.length, 1);
    assert.ok(mesh.geometry.boundingSphere.radius > 0);
  });
}

test('no ear accessories are added to the model', () => {
  const { root, head } = portrait(true);
  const before = root.children.length;
  styleAvatar(root, { capabilities: { getMaxAnisotropy: () => 8 } });
  assert.equal(head.children.length, 0);
  assert.equal(root.children.length, before);
});

test('hair remains visible and its crown stays outside the scalp', () => {
  const { root, mesh } = portrait(true);
  mesh.name = 'Individual_Hair_Fibers_0';
  mesh.visible = false;
  mesh.material.name = 'Hair_Fine_Fiber_0';
  mesh.material.color.set('#594030');
  const color = mesh.material.color.clone();
  styleAvatar(root, { capabilities: { getMaxAnisotropy: () => 8 } });
  assert.equal(mesh.visible, true);
  assert.ok(mesh.material.color.equals(color));
  for (const y of [1.8, 1.85, 1.9]) {
    const scalp = sculptPortrait(0.1, y, -0.1);
    const hair = sculptHair(0.1, y, -0.1);
    assert.ok(hair[0] > scalp[0]);
    assert.ok(hair[1] > scalp[1]);
    assert.ok(hair[2] < scalp[2]);
  }
});

test('head skin edits do not affect shared neck material or existing body geometry', () => {
  const { root, mesh, rest } = portrait(true);
  mesh.material.name = 'Skin';
  mesh.name = 'Left_Ear';
  const neck = new T.Mesh(mesh.geometry.clone(), mesh.material);
  neck.name = 'Neck_and_Decolletage';
  root.add(neck);
  styleAvatar(root, { capabilities: { getMaxAnisotropy: () => 8 } });
  assert.notEqual(mesh.material, neck.material);
  assert.equal(mesh.material.roughness, 0.94);
  assert.equal(neck.material.roughness, 0.82);
  for (let i = 0; i < 3; i++) {
    const expected = sculptPortrait(...rest.slice(i * 3, i * 3 + 3));
    const actual = new T.Vector3()
      .fromBufferAttribute(neck.geometry.attributes.position, i)
      .toArray();
    actual.forEach((v, axis) => assert.ok(Math.abs(v - expected[axis]) < 1e-6));
  }
});
