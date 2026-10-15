import * as T from 'three';

// A shared spatial deformation keeps the separate eyelids, lips, teeth and
// facial morphs aligned. The source GLB and its rig remain untouched.
export function sculptPortrait(x, y, z) {
  const jaw = Math.exp(-(((y - 1.535) / 0.085) ** 2));
  const nose = Math.exp(-((x / 0.028) ** 2) - ((y - 1.64) / 0.044) ** 2);
  return [
    x * (1 - 0.075 * jaw),
    y > 1.79 ? 1.79 + (y - 1.79) * 0.82 : y,
    z - 0.008 * nose * T.MathUtils.smoothstep(z, 0.115, 0.155),
  ];
}

// The opaque undercoat, cards and strands share this transform so no layer
// can sink through another. Preserve the authored ponytail and temple hairline.
export function sculptHair(x, y, z) {
  const base = sculptPortrait(x, y, z);
  const crown = T.MathUtils.smoothstep(y, 1.76, 1.9);
  return [base[0] * (1 + 0.025 * crown), base[1] + 0.024 * crown, base[2] - 0.006 * crown];
}

const hairMesh = /Hair|Locks|Ponytail/;
const headMesh =
  /^(Alya_Head|Left_(?:Blinking|Brow|BrownIris|Catchlight|Ear|Eyebrow|Eyelashes|LashLine|Nostril|Pupil|Sclera|TearDuct|WaterLine)|Right_(?:Blinking|Brow|BrownIris|Catchlight|Ear|Eyebrow|Eyelashes|LashLine|Nostril|Pupil|Sclera|TearDuct|WaterLine)|Oral_Cavity|Tongue|Upper_Teeth|Lower_Teeth)/;

function sculptMesh(mesh) {
  const sculpt = hairMesh.test(mesh.name) ? sculptHair : sculptPortrait;
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const targets = geometry.morphAttributes.position || [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const base = sculpt(x, y, z);
    for (const target of targets) {
      const relative = geometry.morphTargetsRelative;
      const moved = sculpt(
        target.getX(i) + (relative ? x : 0),
        target.getY(i) + (relative ? y : 0),
        target.getZ(i) + (relative ? z : 0),
      );
      target.setXYZ(i, ...moved.map((value, axis) => value - (relative ? base[axis] : 0)));
    }
    position.setXYZ(i, ...base);
  }
  position.needsUpdate = true;
  targets.forEach((target) => {
    target.needsUpdate = true;
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function styleAvatar(model, renderer) {
  // Capture the artist's brown strand variation before the existing outfit pass.
  const originalHairColors = new Map();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (/Hair/.test(material.name)) originalHairColors.set(material.name, material.color.clone());
    }
  });
  const styled = new Set();
  const sculpted = new Set();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (hairMesh.test(mesh.name)) mesh.visible = true;
    if (mesh.visible && !sculpted.has(mesh.geometry)) {
      sculpted.add(mesh.geometry);
      sculptMesh(mesh);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (styled.has(material)) continue;
      styled.add(material);
      material.envMapIntensity = 0.55;
      if (material.map)
        material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const name = material.name;
      if (/Skin/.test(name)) {
        material.roughness = 0.82;
        material.envMapIntensity = 0.38;
        if (material.normalScale) material.normalScale.setScalar(0.16);
        if (material.isMeshPhysicalMaterial) {
          material.sheen = 0.12;
          material.sheenColor.set('#d5a293');
          material.specularIntensity = 0.32;
        }
      } else if (/Hair/.test(name)) {
        material.color.set('#171e29');
        material.roughness = 0.42;
        material.envMapIntensity = 0.75;
        if (material.isMeshPhysicalMaterial) {
          material.sheen = 0.3;
          material.sheenColor.set('#667f91');
        }
        if (material.alphaTest) {
          material.alphaToCoverage = true;
          material.alphaTest = 0.4;
        }
      } else if (/Navy/.test(name)) {
        material.color.set(name === 'Navy_Lapels' ? '#29464f' : '#132a33');
        material.roughness = name === 'Navy_Lapels' ? 0.4 : 0.62;
        material.metalness = 0.12;
        if (material.isMeshPhysicalMaterial) {
          material.sheen = 0.35;
          material.sheenColor.set('#537b83');
        }
      } else if (name === 'Ivory_Knit') {
        material.color.set('#202d36');
        material.roughness = 0.7;
      } else if (/Tailoring|Covered_Buttons|Hair_Tie/.test(name)) {
        material.color.set('#b6c9c5');
        material.metalness = 0.7;
        material.roughness = 0.32;
      } else if (name === 'Iris') {
        // Iris detail is authored in vertex colors; preserve that radial pattern.
        material.color.set('#8bbcb1');
        material.roughness = 0.24;
      } else if (name === 'Sclera') {
        material.color.set('#b9b8b1');
        material.roughness = 0.22;
      } else if (name === 'Lips') {
        material.color.set('#9e5f60');
        material.roughness = 0.4;
      }
      material.needsUpdate = true;
    }
  });

  // Only head meshes receive this second pass. Clone shared materials so ears
  // cannot change the neck and facial adjustments cannot recolor the outfit.
  const headMaterials = new Map();
  model.traverse((mesh) => {
    if (!mesh.isMesh || !(headMesh.test(mesh.name) || hairMesh.test(mesh.name))) return;
    const refine = (source) => {
      if (headMaterials.has(source)) return headMaterials.get(source);
      const material = source.clone();
      headMaterials.set(source, material);
      const name = material.name;
      if (/Hair/.test(name)) {
        material.color.copy(originalHairColors.get(name));
        material.metalness = 0;
        material.roughness = name === 'Hair_Soft_Undercoat' ? 0.86 : 0.68;
        material.envMapIntensity = 0.42;
        if (material.isMeshPhysicalMaterial) {
          material.specularIntensity = 0.28;
          material.sheen = 0.18;
          material.sheenColor.set('#9b7965');
          material.sheenRoughness = 0.75;
        }
        // Keep fine alpha strands while the opaque undercoat covers the scalp.
        if (material.alphaTest) material.alphaTest = 0.25;
      } else if (/Skin/.test(name)) {
        material.roughness = 0.94;
        material.envMapIntensity = 0.3;
        material.normalScale?.setScalar(0.24);
        if (material.isMeshPhysicalMaterial) {
          material.specularIntensity = 0.24;
          material.sheen = 0.06;
        }
      } else if (name === 'Iris') {
        material.color.set('#fff2df');
        material.roughness = 0.28;
        material.envMapIntensity = 0.6;
      } else if (name === 'Sclera') {
        material.color.set('#d4cec2');
        material.roughness = 0.28;
        material.clearcoat = 0.3;
        material.clearcoatRoughness = 0.18;
      } else if (/Eye_Catchlight/.test(name)) {
        material.color.set('#eae7df');
      } else if (name === 'Lips') {
        material.color.set('#98665f');
        material.roughness = 0.52;
      } else if (name === 'Brows_and_Lashes') {
        material.color.set('#42312a');
        material.roughness = 0.82;
      }
      return material;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(refine)
      : refine(mesh.material);
  });
  // No ear accessories are created. The source GLB contains anatomical ears only.
  const used = new Set();
  model.traverse((mesh) => {
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [])
      used.add(material);
  });
  for (const source of headMaterials.keys()) if (!used.has(source)) source.dispose();
}
