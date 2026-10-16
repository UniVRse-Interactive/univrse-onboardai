import * as T from 'three';
import { prepareDigitalHuman } from './digital-human.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function createAvatarScene(
  container,
  { signal, getSpeechFrame, getReducedMotion, getThinking, getPresenting, onPhase = () => {} },
) {
  let renderer;
  try {
    renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    throw new Error(
      '3D rendering is unavailable on this device. You can still use chat and voice.',
    );
  }
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(28, 1, 0.01, 20);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Alya, your animated 3D avatar');
  renderer.domElement.setAttribute('role', 'img');
  container.appendChild(renderer.domElement);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.03);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new T.HemisphereLight('#dce9ef', '#18232d', 0.35));
  for (const [color, power, position] of [
    ['#fff1e8', 2.8, [-2.5, 3.2, 2.6]],
    ['#c5dfef', 0.85, [2, 1.9, 2]],
    ['#9bdbcf', 2.4, [1.2, 2.2, -1.6]],
  ]) {
    const light = new T.DirectionalLight(color, power);
    light.position.set(...position);
    light.target.position.set(0, 1.6, 0);
    if (position[0] < 0) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      Object.assign(light.shadow.camera, {
        left: -0.65,
        right: 0.65,
        top: 0.65,
        bottom: -0.65,
        near: 0.1,
        far: 8,
      });
      light.shadow.bias = -0.0002;
      light.shadow.normalBias = 0.002;
    }
    scene.add(light, light.target);
  }
  let model = null,
    raf = 0,
    disposed = false,
    lastFrame = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const compact = height < 400 || camera.aspect < 0.36;
    camera.position.set(
      0.065,
      compact ? 1.66 : 1.6,
      compact ? (camera.aspect < 0.36 ? 1.45 : 1.1) : Math.max(1.55, 0.95 / camera.aspect),
    );
    camera.lookAt(0, compact ? 1.65 : 1.57, 0);
    camera.updateProjectionMatrix();
    // Resize clears the WebGL buffer, including while a tab is in the background.
    if (model) renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const contextLost = (event) => {
    event.preventDefault();
    onPhase(
      'unavailable',
      'The 3D view needs more graphics memory. Chat and voice are still available.',
    );
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  function disposeModel(root) {
    const materials = new Set(),
      textures = new Set();
    root?.traverse((o) => {
      o.geometry?.dispose();
      if (o.skeleton?.boneTexture) textures.add(o.skeleton.boneTexture);
      for (const material of Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    disposeModel(model);
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    onPhase('loading', 'Preparing Alya…');
    const metadataResponse = await fetch('/avatars/alya/manifest.json', { signal });
    if (!metadataResponse.ok) throw new Error('Avatar metadata could not load.');
    const metadata = await metadataResponse.json();
    const response = await fetch(
      '/avatars/alya/alya.glb?v=' + encodeURIComponent(metadata.sha256.slice(0, 12)),
      { signal },
    );
    if (!response.ok) throw new Error('The avatar file could not load.');
    const bytes = await response.arrayBuffer();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onPhase('loading', 'Preparing the 3D view…');
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    model = gltf.scene;
    if (signal.aborted) {
      disposeModel(model);
      throw new DOMException('Aborted', 'AbortError');
    }
    prepareDigitalHuman(model, renderer);
    model.rotation.y = -0.055;
    scene.add(model);
    const morphs = new Map();
    model.traverse((o) => {
      for (const [name, index] of Object.entries(o.morphTargetDictionary || {})) {
        if (!morphs.has(name)) morphs.set(name, []);
        morphs.get(name).push([o, index]);
      }
    });
    const set = (name, value) => {
      for (const [mesh, index] of morphs.get(name) || []) mesh.morphTargetInfluences[index] = value;
    };
    const expressionLevels = new Map();
    const ease = (name, target, dt) => {
      const value = T.MathUtils.damp(expressionLevels.get(name) || 0, target, 6, dt);
      expressionLevels.set(name, value);
      set(name, value);
    };
    let nextGaze = 0,
      gazeX = 0,
      gazeY = 0;
    const mouthNames = [...morphs.keys()].filter((name) => name.startsWith('viseme_'));
    const levels = new Map(mouthNames.map((name) => [name, 0]));
    const head = model.getObjectByName('Head'),
      neck = model.getObjectByName('Neck'),
      chest = model.getObjectByName('Spine2');
    const headRest = head?.rotation.clone(),
      neckRest = neck?.rotation.clone(),
      chestRest = chest?.rotation.clone();
    let nextBlink = performance.now() + 2400,
      blinkStart = 0,
      ready = false;
    function tick(now) {
      if (disposed || signal.aborted) return;
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < 1000 / 30 || document.hidden) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const frame = getSpeechFrame?.(now) || { speaking: false, viseme: 'sil', value: 0 };
      for (const name of mouthNames) {
        const target = name === 'viseme_' + frame.viseme ? frame.value : 0;
        const next = T.MathUtils.lerp(levels.get(name), target, 1 - Math.exp(-dt * 28));
        levels.set(name, next);
        set(name, next);
      }
      if (now > nextBlink && !blinkStart) {
        blinkStart = now;
        nextBlink = now + 3200 + Math.random() * 2200;
      }
      const blink = blinkStart ? Math.max(0, Math.sin((Math.PI * (now - blinkStart)) / 230)) : 0;
      if (blinkStart && now - blinkStart > 230) blinkStart = 0;
      const reduced = reduce.matches || getReducedMotion?.();
      set('eyeBlinkLeft', reduced ? 0 : blink);
      set('eyeBlinkRight', reduced ? 0 : blink);
      const thinking = getThinking?.() && !frame.speaking;
      ease('mouthSmileLeft', frame.speaking ? 0.025 : thinking ? 0.035 : 0.1, dt);
      ease('mouthSmileRight', frame.speaking ? 0.025 : thinking ? 0.035 : 0.09, dt);
      ease('eyeSquintLeft', 0.025, dt);
      ease('eyeSquintRight', 0.025, dt);
      ease('browInnerUp', thinking ? 0.09 : 0.025, dt);
      ease('cheekSquintLeft', frame.speaking ? 0.015 : 0.04, dt);
      ease('cheekSquintRight', frame.speaking ? 0.015 : 0.04, dt);
      if (now > nextGaze) {
        nextGaze = now + 2600 + Math.random() * 3000;
        gazeX = Math.random() < 0.65 ? 0 : (Math.random() - 0.5) * 0.18;
        gazeY = (Math.random() - 0.5) * 0.06;
      }
      const x = reduced ? 0 : gazeX,
        y = reduced ? 0 : gazeY;
      for (const side of ['Left', 'Right']) {
        ease('eyeLookUp' + side, Math.max(0, y), dt);
        ease('eyeLookDown' + side, Math.max(0, -y), dt);
        ease('eyeLookOut' + side, Math.max(0, side === 'Left' ? x : -x), dt);
        ease('eyeLookIn' + side, Math.max(0, side === 'Left' ? -x : x), dt);
      }
      if (!reduced) {
        const seconds = now / 1000;
        model.position.y = Math.sin(seconds * 1.4) * 0.0015;
        if (chest) {
          chest.rotation.x = chestRest.x + Math.sin(seconds * 1.15) * 0.003;
          chest.rotation.z = chestRest.z + Math.sin(seconds * 0.47) * 0.002;
        }
        if (head) {
          head.rotation.x =
            headRest.x +
            Math.sin(seconds * (frame.speaking ? 3.1 : 0.7)) * (frame.speaking ? 0.014 : 0.005);
          const facing = headRest.y + (getPresenting?.() && frame.speaking ? 0.07 : 0);
          head.rotation.y = T.MathUtils.damp(
            head.rotation.y,
            facing + Math.sin(seconds * 0.65) * 0.028,
            3,
            dt,
          );
        }
        if (neck) neck.rotation.z = neckRest.z + Math.sin(seconds * 0.8) * 0.009;
      } else {
        model.position.y = 0;
        if (head) head.rotation.copy(headRest);
        if (neck) neck.rotation.copy(neckRest);
        if (chest) chest.rotation.copy(chestRest);
      }
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        onPhase('ready', 'Alya is ready');
      }
    }
    raf = requestAnimationFrame(tick);
    return { dispose };
  } catch (error) {
    dispose();
    if (error.name === 'AbortError') throw error;
    throw new Error(
      error.message || 'The 3D avatar could not load. Chat and voice remain available.',
    );
  }
}
