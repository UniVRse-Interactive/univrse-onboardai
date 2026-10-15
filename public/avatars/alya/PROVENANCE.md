# ALYA: asset provenance and fitted outfit

## Current implementation

`digital-human.glb.gz` is the real-time skinned GLB used by the application.
`digital-human.json` records its hashes, sizes, controls, and preservation audit.
There is no portrait or video replacement in the current renderer.

The existing head, face, eyes, brows, lashes, hair, teeth, tongue, retained upper
chest, and skeleton **are third-party assets**, not geometry created from scratch
in this project. A previous redesign imported them from the TalkingHead example
`mpfb.glb`, made with Blender and MPFB:

- Source: https://github.com/met4citizen/TalkingHead/blob/main/avatars/mpfb.glb
- Maintainer's explicit MPFB CC0 declaration, rechecked 2026-10-15:
  https://github.com/met4citizen/TalkingHead#readme
- CC0 terms: https://creativecommons.org/publicdomain/zero/1.0/

The source hash remains in the manifest. Its earlier project-specific changes
include cropping hidden geometry, eyelid-closure adjustment, material tuning and
integration with ALYA's existing outfit. This body-fitting revision preserves
those Human meshes and facial morphs; it does not download or substitute another
finished avatar. Preserving this head does not make it original project artwork.

The coat, sleeves, pockets and buttons originate in the supplied original ALYA
package, retained at `alya.glb.gz`. Their original author and upstream licensing
have not been independently established; possession of that package is not proof
of ownership. No new license claim is made for those underlying meshes.

Three.js supplies the renderer (MIT). The existing speech pipeline uses
TalkingHead LipsyncEn (MIT) for estimated mouth timing and Kokoro speech.
These dependencies and the backend are unchanged by the garment fitting work.

## Original project work: body-fitted-v2

`scripts/fit-alya-garments.py` constructs a new contoured inner top, narrow
self-fabric neckline facing, and rolled/notched lapel surfaces. This geometry and
its fitting algorithm are authored in this project; no third-party garment code,
new model, photograph, or texture is copied or downloaded.

Inspection found a shirt-to-chest gap of roughly 3 cm in the old upper garment.
The original outfit had been shifted forward, then given additional lapel lift
without fitting it to the retained torso. Independent shoulder and sleeve weight
fields could also separate neighboring pieces. The retained skin is incomplete
below the upper chest, making unconstrained shrink-wrapping unsuitable.

The new top uses a smooth torso contour, with a rounded neckline fitted about
4 mm in front of the actual skin. The hidden side edges end under the coat. The
jacket front and collar are reshaped around the chest with skin clearance checks.
Lapel depth is supported by the actual jacket surface; inward fabric thickness
and a small roll provide layering without the former large stand-off. Coat,
sleeves and new pieces share a spatial skinning field on the existing skeleton;
the neckline blends toward nearby skin weights. No body or facial skin vertices
are resculpted. There are no new bones, facial controls or cloth simulation.

The slate-teal wool normal/roughness maps are the project's deterministic woven
maps from `tailor-alya-outfit.py`. The oyster top and physical material settings
in `src/avatar/digital-human.js` are retained. Camera, lighting, head materials,
UI, audio, facial animation and conversation logic are unchanged in this revision.

## Reproduction and backups

The immediately preceding asset and manifest are backed up locally in
`.cache/avatar-history/fit-before/`; the earlier body baseline remains in
`.cache/avatar-history/body-before/`. These ignored backups are local, not bundled
with a deployment. Keep a copy when reproducing on another machine.

Run from the project root with Blender installed:

```sh
gzip -dc .cache/avatar-history/fit-before/digital-human.glb.gz > /tmp/alya-fit-before.glb
blender -b --python scripts/fit-alya-garments.py -- --source /tmp/alya-fit-before.glb --output /tmp/alya-fitted.glb
node scripts/package-tailored-avatar.mjs /tmp/alya-fit-before.glb /tmp/alya-fitted.glb /tmp/alya-fitted.glb.fit.json
```

Packaging rejects changes to preserved Human mesh positions or facial morph
positions exceeding one micrometre. It checks 155 morph arrays. The actual
round-trip tolerance, byte counts and input hash are stored in the manifest.
`tests/digital-human.test.mjs` also ray-tests exported neckline clearance and
lapel/jacket layering, embedded textile maps, normalized weights and controls.

## Verification and limits

Offline Blender renders inspect neutral, turned-head, blink/mouth, desktop,
narrow viewport and shoulder/chest motion poses. They are exported-model renders
with offline studio lighting, **not application screenshots**. The camera sizes
match the renderer's desktop and narrow settings; Blender material response is
not identical to Three.js. Inspecting these does not establish live browser frame
rate, WebGL shading, microphone operation or speech synchronization.

The browser runtime reported no available browser connection during this work.
The normal development server and asset endpoint can be checked over HTTP, but
actual in-application visual acceptance remains outstanding until browser access
is available. No claim of verified photorealism is made. The retained coat's base
topology and the existing real-time head still limit realism; no premium scanned
cloth, new digital-human asset or paid service is included.

The existing lip-sync uses audio-clock-synchronized estimated visemes, not audio
phoneme recognition. Skin has no true subsurface scattering. Clothing is skinned
for the supported subtle idle motion, not validated for walking or large gestures.

## Earlier implementation history

`alya.glb.gz` and its original manifest remain unchanged. The unused
`avatar-art-direction.js`, original poster and previous offline portrait are
historical assets, not the current animated implementation. The first tailoring
pass is reproducible with `scripts/tailor-alya-outfit.py`; it introduced woven
maps and shoulder/waist fitting, and is superseded by the body-fitting pass above.
`scripts/build-digital-human.py` records the earlier third-party-head integration;
it is not an original-character creation script and is not invoked by this pass.
