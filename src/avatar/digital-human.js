import * as T from 'three';

// Material tuning only: do not apply the old mannequin-specific vertex sculpt
// to this independently authored face, its eyelids, or its facial morphs.
export function prepareDigitalHuman(model, renderer) {
  const replacements = new Map();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const prepare = (source) => {
      if (replacements.has(source)) return replacements.get(source);
      const material = new T.MeshPhysicalMaterial();
      T.MeshStandardMaterial.prototype.copy.call(material, source);
      replacements.set(source, material);
      material.envMapIntensity = 0.4;
      for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
        if (texture) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      const name = material.name;
      if (name === 'Human.body') {
        material.roughness = 0.64;
        material.specularIntensity = 0.35;
        material.ior = 1.4;
        // A light rose tint confined to the lips in this model's skin atlas.
        // UV anchoring follows the existing mouth morphs without changing the
        // skin texture, geometry, teeth, or surrounding facial materials.
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            #ifdef USE_MAP
              vec2 lipUV = (vMapUv - vec2(0.910, 0.515)) / vec2(0.014, 0.021);
              float lipTint = (1.0 - smoothstep(0.60, 1.0, length(lipUV))) * 0.40;
              diffuseColor.rgb *= mix(vec3(1.0), vec3(1.10, 0.70, 0.78), lipTint);
            #endif`,
          );
        };
        material.customProgramCacheKey = () => 'alya-subtle-rose-lips-v1';
      } else if (name.includes('high-poly')) {
        material.roughness = 0.22;
        material.clearcoat = 0.3;
        material.clearcoatRoughness = 0.15;
      } else if (name.includes('ponytail')) {
        material.roughness = 0.7;
        material.specularIntensity = 0.3;
        material.alphaToCoverage = true;
        material.alphaTest = 0.28;
        material.side = T.DoubleSide;
      } else if (/^Alya_(Wool|Lapel)$/.test(name)) {
        // Embedded weave normal and roughness maps carry the fabric detail.
        material.roughness = 1;
        material.metalness = 0;
        material.specularIntensity = 0.3;
        material.sheen = 0.18;
        material.sheenColor.set('#718789');
        material.sheenRoughness = 0.85;
      } else if (name === 'Alya_Silk') {
        material.roughness = 0.66;
        material.specularIntensity = 0.28;
        material.sheen = 0.12;
        material.sheenColor.set('#d5cbb9');
      } else if (/^Alya_(Thread|Button)$/.test(name)) {
        material.metalness = 0;
        material.roughness = name === 'Alya_Thread' ? 0.88 : 0.53;
      } else if (/Navy|Ivory|Tailoring/.test(name)) {
        material.roughness = 0.82;
        material.metalness = 0;
        material.sheen = 0.15;
        material.sheenColor.set('#476067');
        material.sheenRoughness = 0.85;
      } else if (/eyebrow|eyelash/.test(name)) {
        material.color.set('#30241f');
        material.roughness = 0.85;
      }
      return material;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(prepare)
      : prepare(mesh.material);
  });
  // Textures are shared with the replacements and disposed by the scene owner.
  replacements.forEach((_, material) => material.dispose());
}
