import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const canvas = document.querySelector("#viewport");
const joystick = document.querySelector("#joystick");
const joystickKnob = document.querySelector(".joystick-knob");
const playButton = document.querySelector("#play-button");
const horseNameInput = document.querySelector("#horse-name");
const activeColorInput = document.querySelector("#active-color");
const loadingScreen = document.querySelector("#loading-screen");
const loadingStatus = document.querySelector("#loading-status");
const loadingProgress = document.querySelector("#loading-progress");
const music = new Audio("uploads/Wide_Meadow_-_Open_Range_-_Treblo.ogg");
const musicFadeSeconds = 15;
let musicStarted = false;
let musicStartPending = false;
let musicFadeFrame = 0;
const colorParts = ["base", "mane", "tail", "muzzle", "hoof", "eye", "marking"];
const appearanceSliders = [...document.querySelectorAll(".appearance-slider")];
const appearanceTabs = [...document.querySelectorAll(".appearance-tab")];
const appearanceRows = [...document.querySelectorAll(".appearance-row")];
const patternSelect = document.querySelector("#pattern-select");
let activeAppearancePart = "base";

music.loop = true;
music.preload = "auto";
music.volume = 0;

function updateMusicVolume() {
  if (!musicStarted) return;
  const duration = Number.isFinite(music.duration) && music.duration > 0 ? music.duration : 186;
  const fadeIn = THREE.MathUtils.clamp(music.currentTime / musicFadeSeconds, 0, 1);
  const fadeOut = THREE.MathUtils.clamp((duration - music.currentTime) / musicFadeSeconds, 0, 1);
  music.volume = Math.min(fadeIn, fadeOut);
  musicFadeFrame = requestAnimationFrame(updateMusicVolume);
}

function startMusic() {
  if (musicStarted || musicStartPending) return;
  musicStartPending = true;
  music.play().then(() => {
    musicStarted = true;
    musicStartPending = false;
    cancelAnimationFrame(musicFadeFrame);
    updateMusicVolume();
  }).catch((error) => {
    musicStartPending = false;
    console.warn("[Open Range audio] waiting for another interaction", error);
  });
}

// Capture the first gesture before UI controls can stop propagation.
document.addEventListener("pointerdown", startMusic, { capture: true, passive: true });
document.addEventListener("keydown", startMusic, { capture: true });

// The selected horse is a skinned horse with authored locomotion clips.
const horses = [
  { file: "uploads/horse.glb", type: "gltf", clip: "Walk", palette: [0x9a7e65, 0xdbc4a2], animationRate: 1.0 }
];
const horseLooks = [
  { base: "#9a7e65", mane: "#4a3026", tail: "#4a3026", muzzle: "#704b39", hoof: "#2d2521", eye: "#171312", marking: "#eadcc2", pattern: "none" }
];
const horseNames = [""];
const horseHsl = horseLooks.map((look) => Object.fromEntries(
  colorParts.map((part) => {
    const color = new THREE.Color(look[part]);
    return [part, color.getHSL({ h: 0, s: 0, l: 0 })];
  })
));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeae4d7);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 240);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const loadingTasks = { terrain: false, horse: false };
let loadingFinished = false;
function completeLoadingTask(task, error = false) {
  loadingTasks[task] = true;
  const completed = Object.values(loadingTasks).filter(Boolean).length;
  if (loadingProgress) loadingProgress.style.width = `${error ? Math.max(42, completed * 50) : completed * 50}%`;
  if (loadingStatus) {
    if (error) loadingStatus.textContent = "Starting with available assets…";
    else if (!loadingTasks.terrain) loadingStatus.textContent = "Painting the meadow…";
    else if (!loadingTasks.horse) loadingStatus.textContent = "Saddling your horse…";
    else loadingStatus.textContent = "Ready to ride";
  }
  if (!loadingFinished && loadingTasks.terrain && loadingTasks.horse) {
    loadingFinished = true;
    // Compile the first visible frame while the overlay is still blocking the
    // view, avoiding a shader hitch the first time the scene appears.
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    requestAnimationFrame(() => loadingScreen?.classList.add("is-ready"));
  }
}

scene.add(new THREE.HemisphereLight(0xd8e2ec, 0x59483c, 2.15));
const sun = new THREE.DirectionalLight(0xffe1bd, 3.3);
sun.position.set(-25, 38, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -42;
sun.shadow.camera.right = 42;
sun.shadow.camera.top = 42;
sun.shadow.camera.bottom = -42;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.00025;
scene.add(sun);
scene.add(sun.target);

const horseAnchor = new THREE.Group();
scene.add(horseAnchor);
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
let horseModel = null;
let horseMixer = null;
let activeAction = null;
let activeClip = null;
let hoofBones = [];
const hoofDustState = { running: false, trailDistance: 0, nextTrailHoof: 0, previousRunPhase: null };

// Camera-facing sprites are deliberately used here instead of a custom point
// shader. They stay readable at game-camera distances and make the dust's
// soft, foggy shape obvious even on low-end WebGL implementations.
const dustParticleCount = 150;
const dustTextureCanvas = document.createElement("canvas");
dustTextureCanvas.width = 64;
dustTextureCanvas.height = 64;
const dustTextureContext = dustTextureCanvas.getContext("2d");
const dustGradient = dustTextureContext.createRadialGradient(32, 32, 2, 32, 32, 32);
dustGradient.addColorStop(0, "rgba(246, 232, 211, .72)");
dustGradient.addColorStop(.38, "rgba(205, 177, 146, .36)");
dustGradient.addColorStop(1, "rgba(170, 139, 108, 0)");
dustTextureContext.fillStyle = dustGradient;
dustTextureContext.fillRect(0, 0, 64, 64);
const dustTexture = new THREE.CanvasTexture(dustTextureCanvas);
dustTexture.colorSpace = THREE.SRGBColorSpace;
const dustParticles = [];
for (let index = 0; index < dustParticleCount; index++) {
  const material = new THREE.SpriteMaterial({
    map: dustTexture,
    color: 0xb99a7b,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  sprite.frustumCulled = false;
  sprite.renderOrder = 5;
  scene.add(sprite);
  dustParticles.push({
    sprite,
    velocity: new THREE.Vector3(),
    age: 0,
    lifetime: 0,
    startSize: 0,
    baseOpacity: 0,
    seed: (index * .61803398875) % 1
  });
}

let selected = 0;
let mode = "selection";
let modelRequest = 0;
let selectionZoom = 1;
let selectionOrbit = 0;
let selectionOrbitStart = 0;
let selectionPitch = .38;
let selectionPitchStart = .38;
let rideCameraFollow = null;
let rideCameraYaw = 0;
let rideCameraPitch = .38;
let rideCameraZoom = 1;
let rideCameraTargetHeight = .98;

function disposeHorse() {
  if (!horseModel) return;
  horseAnchor.remove(horseModel);
  horseModel.traverse((child) => {
    child.geometry?.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose?.());
    }
  });
  horseModel = null;
  horseMixer = null;
  activeAction = null;
  activeClip = null;
  hoofBones = [];
  resetHoofDust();
}

function fitModel(root) {
  const originalBox = measureModelBounds(root);
  const originalSize = originalBox.getSize(new THREE.Vector3());
  // Both imported horses share a physical height. Normalizing by their
  // largest dimension made the longer model look too large and the shorter
  // model look too small in the selection scene.
  const targetHeight = innerWidth < 761 ? 1.7 : 2.1;
  const sourceHeight = originalSize.y > .001
    ? originalSize.y
    : Math.max(originalSize.x, originalSize.y, originalSize.z, .001);
  console.info("[Open Range sizing]", JSON.stringify({ size: originalSize.toArray(), sourceHeight, targetHeight, scale: targetHeight / sourceHeight }));
  root.scale.setScalar(targetHeight / sourceHeight);
  root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  const rotatedBox = measureModelBounds(root);
  const rotatedCenter = rotatedBox.getCenter(new THREE.Vector3());
  root.position.x -= rotatedCenter.x;
  root.position.z -= rotatedCenter.z;
  root.position.y -= rotatedBox.min.y;
}

function measureModelBounds(root) {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry?.attributes?.position;
    if (child.isSkinnedMesh && position && child.applyBoneTransform) {
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i);
        child.applyBoneTransform(i, point);
        point.applyMatrix4(child.matrixWorld);
        bounds.expandByPoint(point);
      }
      return;
    }
    bounds.union(new THREE.Box3().setFromObject(child));
  });
  return bounds;
}

function colorFrom(value) {
  return new THREE.Color(value);
}

function isRootBoneTrack(track, rootBoneNames) {
  const split = track.name.lastIndexOf(".");
  if (split < 0) return false;
  const nodeName = track.name.slice(0, split);
  const property = track.name.slice(split + 1);
  const isRootBone = [...rootBoneNames].some((name) => nodeName === name || nodeName.endsWith(`|${name}`) || nodeName.endsWith(`/${name}`));
  return isRootBone && (property === "position" || property === "scale");
}

function prepareClip(root, clip) {
  // Root motion belongs to the world anchor. FBX files often name the root
  // bone Armature|Hips instead of literally "root", so identify the actual
  // top-level bones instead of filtering only one hard-coded track name.
  const rootBoneNames = new Set();
  root.traverse((child) => {
    if (child.isBone && !child.parent?.isBone) rootBoneNames.add(child.name);
  });
  const prepared = clip.clone();
  prepared.tracks = prepared.tracks.filter((track) => !isRootBoneTrack(track, rootBoneNames));
  return prepared;
}

function patternApplies(pattern, nx, ny, nz, head, hoof, mane) {
  if (pattern === "none") return false;
  if (pattern === "blaze") return head && Math.abs(nx - .5) < .2 && ny > .45;
  if (pattern === "star") return head && ny > .68 && Math.abs(nx - .5) < .3;
  if (pattern === "socks") return hoof || (ny < .25 && (nx < .28 || nx > .72));
  if (pattern === "pinto") return ny > .18 && Math.sin(nx * 17.1 + nz * 11.7) > .55;
  if (pattern === "appaloosa") return ny > .24 && Math.sin(nx * 31.7 + nz * 23.1 + ny * 17.3) > .86;
  return mane;
}

function buildBodyPatternColors(mesh, look) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return;
  const bounds = new THREE.Box3().setFromBufferAttribute(position);
  const size = bounds.getSize(new THREE.Vector3());
  const colors = [];
  const base = colorFrom(look.base);
  const marking = colorFrom(look.marking);
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  const bones = mesh.skeleton?.bones || [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = THREE.MathUtils.clamp((x - bounds.min.x) / Math.max(size.x, .001), 0, 1);
    const ny = THREE.MathUtils.clamp((y - bounds.min.y) / Math.max(size.y, .001), 0, 1);
    const nz = THREE.MathUtils.clamp((z - bounds.min.z) / Math.max(size.z, .001), 0, 1);
    const longitudinal = Math.max(nx, nz);
    let weightedRegion = "";
    if (skinIndex && skinWeight && bones.length) {
      let strongestWeight = 0;
      for (let slot = 0; slot < skinIndex.itemSize; slot++) {
        const weight = skinWeight.getComponent(i, slot);
        const bone = bones[skinIndex.getComponent(i, slot)];
        if (bone && weight > strongestWeight) {
          strongestWeight = weight;
          weightedRegion = bone.name.toLowerCase();
        }
      }
    }
    const head = /head|muzzle|snout|nose|jaw|face|neck/i.test(weightedRegion) || (ny > .38 && longitudinal > .72);
    const isHoof = /hoof|foot|toe|ankle|fetlock/i.test(weightedRegion) || ny < .11;
    const isMane = /mane|tail|hair|braid/i.test(weightedRegion) || (ny > .67 && (nx < .28 || nx > .72 || nz < .28 || nz > .72));
    const chosen = patternApplies(look.pattern, nx, ny, nz, head, isHoof, isMane) ? marking : base;
    colors.push(chosen.r, chosen.g, chosen.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

function appearancePartForMaterial(materialName = "") {
  const name = materialName.toLowerCase();
  if (/eye|pupil/.test(name)) return "eye";
  if (/hoof|hooves|foot|toe|shoe/.test(name)) return "hoof";
  if (/snout|muzzle|nose/.test(name)) return "muzzle";
  if (/tail/.test(name)) return "tail";
  // The new asset calls the mane material "main".
  if (/mane|main|hair|braid/.test(name)) return "mane";
  return "base";
}

function applyHorseAppearance(root, look) {
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (!child.userData.openRangeAppearanceMaterials) {
      child.userData.openRangeAppearanceMaterials = materials.map((source) => {
        // Keep the horse's appearance stable and view-independent. The mesh
        // remains a shadow caster, but terrain lighting is no longer applied
        // to the horse's pixels themselves.
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          vertexColors: false,
          transparent: source.transparent,
          opacity: source.opacity,
          alphaTest: source.alphaTest,
          side: source.side,
          depthWrite: source.depthWrite,
          depthTest: source.depthTest,
          fog: false
        });
        material.name = source.name;
        material.toneMapped = false;
        return material;
      });
      child.material = Array.isArray(child.material)
        ? child.userData.openRangeAppearanceMaterials
        : child.userData.openRangeAppearanceMaterials[0];
    }
    const activeMaterials = Array.isArray(child.material) ? child.material : [child.material];
    activeMaterials.forEach((material) => {
      // The replacement horse has named material slots for each editable
      // region, so colors stay clean and independent instead of relying on
      // approximate vertex-position classification.
      const part = appearancePartForMaterial(material.name || child.name);
      const usesPattern = part === "base" && look.pattern !== "none";
      if (usesPattern) buildBodyPatternColors(child, look);
      material.color?.copy(colorFrom(look[part] || look.base));
      material.map = null;
      material.vertexColors = usesPattern;
      material.toneMapped = false;
      material.needsUpdate = true;
    });
  });
}

function styleModel(root, variant) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        // Keep the authored materials smooth and shaded; the former fallback
        // horse was intentionally faceted and is no longer used.
        material.flatShading = false;
        material.roughness = Math.max(material.roughness ?? .75, .62);
        material.needsUpdate = true;
      });
    }
  });
  applyHorseAppearance(root, horseLooks[variant]);
}

function poseSignature(root) {
  let value = 0;
  root.traverse((child) => {
    if (child.isBone) value += child.position.x * 13.1 + child.position.y * 17.3 + child.quaternion.x * 19.7 + child.quaternion.z * 23.9;
    if (child.morphTargetInfluences) child.morphTargetInfluences.forEach((weight, index) => { value += weight * (index + 1) * 29.3; });
  });
  return value;
}

function findAnimation(root, preferredNames = []) {
  const clips = root.animations || [];
  for (const name of preferredNames) {
    const exact = clips.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
  }
  return clips.find((candidate) => /gallop|canter|trot|run|walk|idle|horse/i.test(candidate.name)) || clips[0];
}

function findExactAnimation(root, preferredNames = []) {
  const clips = root.animations || [];
  return preferredNames.map((name) => clips.find((clip) => clip.name.toLowerCase() === name.toLowerCase())).find(Boolean) || null;
}

function playClip(root, clip, rate, blend = 0) {
  if (!horseMixer || !clip) return null;
  const action = horseMixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(rate);
  action.enabled = true;
  action.clampWhenFinished = false;
  if (activeAction && activeAction !== action) {
    if (blend > 0) activeAction.crossFadeTo(action, blend, false);
    else activeAction.stop();
  }
  action.play();
  activeAction = action;
  activeClip = clip;
  return action;
}

function getPreparedClip(root, sourceClip) {
  root.userData.openRangePreparedClips ||= new Map();
  if (!root.userData.openRangePreparedClips.has(sourceClip.uuid)) {
    root.userData.openRangePreparedClips.set(sourceClip.uuid, prepareClip(root, sourceClip));
  }
  return root.userData.openRangePreparedClips.get(sourceClip.uuid);
}

function switchGait(names, rate) {
  if (!horseModel || !horseMixer) return false;
  const sourceClip = findExactAnimation(horseModel, names);
  if (!sourceClip) return false;
  const clip = getPreparedClip(horseModel, sourceClip);
  if (activeClip !== clip) playClip(horseModel, clip, rate, .12);
  else {
    activeAction.paused = false;
    activeAction.setEffectiveTimeScale(rate);
  }
  return true;
}

function updateHorseGait() {
  if (mode !== "ride" || !horseModel || !horseMixer || !activeAction) return;
  const speed = Math.abs(player.speed);
  if (speed < .22) {
    // Mesh2Motion has a real authored Idle. If another source has no idle,
    // hold its authored pose until the player starts moving again.
    if (!switchGait(["Idle", "Rest_Pose"], .72)) {
      // If this asset has no idle clip, keep its authored cycle running
      // slowly instead of freezing it at frame zero.
      activeAction.enabled = true;
      activeAction.paused = false;
      activeAction.setEffectiveTimeScale(.55);
      activeAction.play();
    }
    return;
  }
  const galloping = speed >= 7.5;
  const names = galloping ? ["Gallop", "Run", "Canter", "Trot", "Walk"] : ["Walk", "Trot", "Run", "Canter", "Gallop"];
  const rate = galloping ? THREE.MathUtils.clamp(.9 + (speed - 7.5) * .025, .9, 1.15) : THREE.MathUtils.clamp(.72 + speed * .035, .72, .98);
  if (!switchGait(names, rate)) {
    activeAction.enabled = true;
    activeAction.paused = false;
    activeAction.setEffectiveTimeScale(rate);
    activeAction.play();
  }
}

const hoofBoneNames = [
  "front_leg_foot_l",
  "front_leg_foot_r",
  "back_leg_foot_l",
  "back_leg_foot_r"
];
const hoofWorldPosition = new THREE.Vector3();
const hoofTravelDirection = new THREE.Vector3();
const hoofDustSide = new THREE.Vector3();
const runContactPhases = [.02, .26, .51, .76];

function setHoofDustBones(root) {
  hoofBones = hoofBoneNames.map((name) => root.getObjectByName(name)).filter(Boolean);
  hoofDustState.previousRunPhase = null;
}

function resetHoofDust() {
  hoofDustState.running = false;
  hoofDustState.trailDistance = 0;
  hoofDustState.nextTrailHoof = 0;
  hoofDustState.previousRunPhase = null;
  dustParticles.forEach((particle) => {
    particle.sprite.visible = false;
    particle.sprite.material.opacity = 0;
  });
}

function nextDustParticle() {
  return dustParticles.find((particle) => !particle.sprite.visible)
    || dustParticles.reduce((oldest, particle) => particle.age > oldest.age ? particle : oldest);
}

function emitHoofDust(position, hoofIndex, puffCount = 6) {
  hoofTravelDirection.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
  hoofTravelDirection.multiplyScalar(Math.sign(player.speed) || 1);
  hoofDustSide.set(-hoofTravelDirection.z, 0, hoofTravelDirection.x);
  for (let puffIndex = 0; puffIndex < puffCount; puffIndex++) {
    const particle = nextDustParticle();
    particle.seed = (particle.seed * 1.73 + hoofIndex * .37 + puffIndex * .19 + .19) % 1;
    const seed = particle.seed;
    const lateral = (seed - .5) * .72;
    const backwardSpeed = 1.5 + seed * 1.7;
    const upwardSpeed = .62 + seed * .56;
    particle.sprite.position.set(
      position.x + hoofDustSide.x * lateral * .08,
      heightAt(position.x, position.z) + .08 + seed * .035,
      position.z + hoofDustSide.z * lateral * .08
    );
    particle.velocity.set(
      -hoofTravelDirection.x * backwardSpeed + hoofDustSide.x * lateral,
      upwardSpeed,
      -hoofTravelDirection.z * backwardSpeed + hoofDustSide.z * lateral
    );
    particle.lifetime = .7 + seed * .38;
    particle.age = 0;
    particle.startSize = .14 + seed * .11;
    particle.baseOpacity = .24 + seed * .14;
    particle.sprite.scale.set(particle.startSize, particle.startSize * (.72 + seed * .2), 1);
    particle.sprite.material.opacity = particle.baseOpacity;
    particle.sprite.visible = true;
  }
}

function getHoofDustPosition(hoofIndex) {
  const bone = hoofBones[hoofIndex];
  if (bone) {
    bone.getWorldPosition(hoofWorldPosition);
    return hoofWorldPosition;
  }
  // Keep the effect visible even while an asset is still resolving its rig.
  // These offsets match the four feet around the horse's ground contact area.
  const sideOffset = [-.42, .42, -.36, .36][hoofIndex] || 0;
  const frontOffset = hoofIndex < 2 ? -.42 : .3;
  hoofTravelDirection.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
  hoofDustSide.set(-hoofTravelDirection.z, 0, hoofTravelDirection.x);
  hoofWorldPosition.set(
    player.x + hoofTravelDirection.x * frontOffset + hoofDustSide.x * sideOffset,
    heightAt(player.x, player.z) + .08,
    player.z + hoofTravelDirection.z * frontOffset + hoofDustSide.z * sideOffset
  );
  return hoofWorldPosition;
}

function updateHoofDust(dt) {
  dustParticles.forEach((particle) => {
    if (!particle.sprite.visible) return;
    particle.age += dt;
    if (particle.age >= particle.lifetime) {
      particle.sprite.visible = false;
      particle.sprite.material.opacity = 0;
      return;
    }
    particle.sprite.position.addScaledVector(particle.velocity, dt);
    particle.velocity.x *= Math.pow(.2, dt);
    particle.velocity.y -= 1.45 * dt;
    particle.velocity.z *= Math.pow(.2, dt);
    const lifeRatio = particle.age / particle.lifetime;
    particle.sprite.material.opacity = particle.baseOpacity * (1 - lifeRatio) ** .8;
    const size = particle.startSize * (1 + lifeRatio * 1.8);
    particle.sprite.scale.set(size, size * (.72 + particle.seed * .2), 1);
  });

  const isRunning = mode === "ride" && Math.abs(player.speed) >= 7.5;
  if (isRunning && !hoofDustState.running) {
    for (let hoofIndex = 0; hoofIndex < 4; hoofIndex++) emitHoofDust(getHoofDustPosition(hoofIndex), hoofIndex, 5);
  }
  hoofDustState.running = isRunning;
  if (isRunning && activeAction && activeClip && hoofBones.length) {
    const runPhase = (activeAction.time % activeClip.duration) / activeClip.duration;
    if (hoofDustState.previousRunPhase !== null) {
      for (let hoofIndex = 0; hoofIndex < hoofBones.length; hoofIndex++) {
        const contactPhase = runContactPhases[hoofIndex % runContactPhases.length];
        const wrapped = runPhase < hoofDustState.previousRunPhase;
        const crossed = wrapped
          ? contactPhase > hoofDustState.previousRunPhase || contactPhase <= runPhase
          : contactPhase > hoofDustState.previousRunPhase && contactPhase <= runPhase;
        if (crossed) {
          emitHoofDust(getHoofDustPosition(hoofIndex), hoofIndex);
        }
      }
    }
    hoofDustState.previousRunPhase = runPhase;
  } else {
    hoofDustState.previousRunPhase = null;
  }
  if (isRunning) {
    // Games commonly pair footstep bursts with rate-over-distance emission:
    // the bursts sell impact, while this short stream leaves a readable wake
    // when the horse is moving quickly between animation contacts.
    hoofDustState.trailDistance += Math.abs(player.speed) * dt;
    while (hoofDustState.trailDistance >= .44) {
      hoofDustState.trailDistance -= .44;
      const hoofIndex = hoofDustState.nextTrailHoof++ % 4;
      emitHoofDust(getHoofDustPosition(hoofIndex), hoofIndex, 2);
    }
  } else {
    hoofDustState.trailDistance = 0;
    hoofDustState.nextTrailHoof = 0;
  }
}

function playAvailableAnimation(root, variant) {
  const clips = root.animations || [];
  const requested = horses[variant].clip;
  const sourceClip = findAnimation(root, requested ? [requested] : []);
  const clip = sourceClip ? getPreparedClip(root, sourceClip) : null;
  const audit = clips.map((candidate) => `${candidate.name}:${candidate.duration.toFixed(3)}s/${candidate.tracks.length}t`);
  console.info("[Open Range animation audit]", JSON.stringify({ file: horses[variant].file, requested, clips: audit, skinnedMeshes: countSkinnedMeshes(root), morphMeshes: countMorphMeshes(root) }));
  if (!clip || clip.duration <= 0 || clip.tracks.length === 0) {
    console.warn("[Open Range animation audit] no playable clip", horses[variant].file);
    return false;
  }
  horseMixer = new THREE.AnimationMixer(root);
  const action = playClip(root, clip, horses[variant].animationRate);
  const before = poseSignature(root);
  horseMixer.update(Math.min(.2, clip.duration * .25));
  const after = poseSignature(root);
  const loopProbe = Math.max(clip.duration * 1.25, .25);
  horseMixer.update(loopProbe);
  const looped = action.isRunning() && action.time >= 0 && action.time < clip.duration;
  action.reset().play();
  horseMixer.update(0);
  console.info("[Open Range animation audit] playing", JSON.stringify({ file: horses[variant].file, clip: clip.name, duration: clip.duration, tracks: clip.tracks.length, poseChanged: Math.abs(after - before) > 0.000001, actionRunning: action.isRunning(), loopMode: action.loop === THREE.LoopRepeat, looped }));
  return true;
}

function countSkinnedMeshes(root) {
  let count = 0;
  root.traverse((child) => { if (child.isSkinnedMesh) count++; });
  return count;
}

function countMorphMeshes(root) {
  let count = 0;
  root.traverse((child) => { if (child.morphTargetInfluences) count++; });
  return count;
}

function auditRuntimeFile(index, root) {
  const clips = root.animations || [];
  const summary = clips.map((clip) => ({ name: clip.name, duration: Number(clip.duration.toFixed(3)), tracks: clip.tracks.length }));
  const requestedNames = [horses[index].clip, "Run", "Gallop", "Canter"].filter(Boolean);
  const clipsToCheck = [];
  requestedNames.forEach((name) => {
    const clip = clips.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (clip && !clipsToCheck.includes(clip)) clipsToCheck.push(clip);
  });
  if (!clipsToCheck.length && clips[0]) clipsToCheck.push(clips[0]);
  const verifications = [];
  clipsToCheck.forEach((sourceClip) => {
    const testClip = prepareClip(root, sourceClip);
    if (testClip.duration <= 0 || testClip.tracks.length === 0) return;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(testClip).setLoop(THREE.LoopRepeat, Infinity).play();
    const before = poseSignature(root);
    mixer.update(Math.min(.2, testClip.duration * .25));
    const after = poseSignature(root);
    const poseChanged = Math.abs(after - before) > 0.000001;
    mixer.update(Math.max(testClip.duration * 1.25, .25));
    const looped = action.isRunning() && action.time >= 0 && action.time < testClip.duration;
    const actionRunning = action.isRunning();
    verifications.push({ clip: testClip.name, poseChanged, actionRunning, loopMode: action.loop === THREE.LoopRepeat, looped });
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
  });
  console.info("[Open Range verified animation]", JSON.stringify({ file: horses[index].file, checks: verifications }));
  console.info("[Open Range verified asset]", JSON.stringify({ file: horses[index].file, clips: summary, skinnedMeshes: countSkinnedMeshes(root), morphMeshes: countMorphMeshes(root), playable: verifications.length > 0, sourceChecked: true }));
}

function auditRuntimeAssets() {
  const audited = new Set();
  horses.forEach((horse, index) => {
    if (audited.has(horse.file)) return;
    audited.add(horse.file);
    if (horse.type === "gltf") gltfLoader.load(horse.file, (gltf) => auditRuntimeFile(index, prepareGLTF(gltf)), undefined, (error) => console.error("[Open Range verified asset] failed", horse.file, error));
    else fbxLoader.load(horse.file, (model) => auditRuntimeFile(index, model), undefined, (error) => console.error("[Open Range verified asset] failed", horse.file, error));
  });
}

function setHorse(root, variant) {
  disposeHorse();
  horseModel = root;
  styleModel(root, variant);
  if (!playAvailableAnimation(root, variant)) {
    console.error("[Open Range animation audit] rejected asset because it has no usable animation", horses[variant].file);
    disposeHorse();
    completeLoadingTask("horse", true);
    return;
  }
  // Fit after the first animated pose has been applied. Skinned meshes often
  // expose a tiny bind-pose box even though their visible animated pose is
  // much taller.
  fitModel(root);
  horseAnchor.add(root);
  setHoofDustBones(root);
  completeLoadingTask("horse");
  if (mode === "ride") updateHorseGait();
}

function prepareGLTF(gltf) {
  // GLTFLoader returns animations beside the scene. Keep them together so
  // the mixer can be created from the same asset instance that is rendered.
  gltf.scene.animations = gltf.animations || [];
  return gltf.scene;
}

function loadHorse(variant) {
  const request = ++modelRequest;
  const data = horses[variant];
  disposeHorse();
  if (data.type === "gltf") {
    gltfLoader.load(data.file,
      (gltf) => { if (request === modelRequest) setHorse(prepareGLTF(gltf), variant); },
      undefined,
      (error) => {
        if (request === modelRequest) {
          console.error("[Open Range verified asset] failed", data.file, error);
          completeLoadingTask("horse", true);
        }
      }
    );
  } else {
    fbxLoader.load(data.file,
      (model) => { if (request === modelRequest) setHorse(model, variant); },
      undefined,
      (error) => {
        if (request === modelRequest) {
          console.error("[Open Range verified asset] failed", data.file, error);
          completeLoadingTask("horse", true);
        }
      }
    );
  }
}

// --- Terrain --------------------------------------------------------------
const tileSize = 28;
const tileRadius = 5;
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const terrainTiles = [];
const grassTexture = new THREE.TextureLoader().load(
  "assets/grass-terrain-hd.png",
  () => completeLoadingTask("terrain"),
  undefined,
  (error) => {
    console.error("[Open Range loading] terrain texture failed", error);
    completeLoadingTask("terrain", true);
  }
);
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(1.65, 1.65);
grassTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
grassTexture.colorSpace = THREE.SRGBColorSpace;
const terrainMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: grassTexture,
  roughness: .96,
  metalness: 0,
  flatShading: false
});

// --- Interactive grass ----------------------------------------------------
// One instanced blade mesh gives us thousands of grass blades in a single
// draw. This follows the same broad strategy used by modern open-world
// foliage systems: stream deterministic patches around the camera/player,
// distribute blades evenly through each patch, and do wind/contact deformation
// in the vertex shader. WebGPU-capable devices get the full field; the WebGL
// fallback keeps the same coverage with fewer blades so older/mobile GPUs stay
// responsive.
const webgl2Available = renderer.capabilities.isWebGL2;
const webgpuAvailable = typeof navigator !== "undefined" && Boolean(navigator.gpu);
const grassQuality = webgpuAvailable
  ? { name: "high", bladesPerCell: 1024 }
  : { name: "fallback", bladesPerCell: 225 };
const grassPatchSize = 10;
const grassChunkSize = 20;
const grassCellsPerChunk = grassChunkSize / grassPatchSize;
// Keep one extra ring of chunks populated beyond the visible fog range. This
// gives newly exposed terrain time to stream in before the rider can see it,
// including after a fast camera turn.
const grassChunkRadius = 6;
const grassChunkDiameter = grassChunkRadius * 2 + 1;
const grassChunkBoundsRadius = Math.hypot(grassChunkSize * .72, 8);
const grassFogNear = 24;
const grassFogFar = 112;
// Keep the original draw range. The custom shader handles the final fade into
// the fog; the larger pooled window gives replacement chunks time to arrive
// without hiding already-loaded chunks at a chunk boundary.
const grassRenderDistance = 104;
const grassChunkCount = grassChunkDiameter ** 2;
const grassInstancesPerChunk = grassQuality.bladesPerCell * grassCellsPerChunk ** 2;
const grassInstanceCount = grassChunkCount * grassInstancesPerChunk;
const grassLoadFadeSeconds = 1.35;
const grassCellBirths = new Map();
const grassGroup = new THREE.Group();
grassGroup.visible = true;
grassGroup.frustumCulled = false;
scene.add(grassGroup);
const grassUniforms = {
  time: { value: 0 },
  playerPosition: { value: new THREE.Vector3() },
  playerVelocity: { value: new THREE.Vector2() },
  windDirection: { value: new THREE.Vector2(.9, .42).normalize() },
  windStrength: { value: .24 },
  loadFadeSeconds: { value: grassLoadFadeSeconds },
  fogColor: { value: new THREE.Color(0x958c82) },
  fogNear: { value: grassFogNear },
  fogFar: { value: grassFogFar }
};

function grassGeometry(instanceCount) {
  const geometry = new THREE.InstancedBufferGeometry();
  // Two crossed, pointed ribbons keep the blades readable from every camera
  // angle without paying for a fully volumetric blade mesh.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -.04, 0, 0, .04, 0, 0, .03, .55, 0, .006, 1, 0, -.006, 1, 0, -.03, .55, 0,
    0, 0, -.04, 0, 0, .04, 0, .55, .03, 0, 1, .006, 0, 1, -.006, 0, .55, -.03
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, .86, .55, .58, 1, .42, 1, .14, .55,
    0, 0, 1, 0, .86, .55, .58, 1, .42, 1, .14, .55
  ], 2));
  geometry.setIndex([
    0, 1, 2, 0, 2, 5, 5, 2, 4, 2, 3, 4,
    6, 7, 8, 6, 8, 11, 11, 8, 10, 8, 9, 10
  ]);
  geometry.instanceCount = instanceCount;
  geometry.setAttribute("instanceOffset", new THREE.InstancedBufferAttribute(new Float32Array(instanceCount * 3), 3));
  geometry.setAttribute("instanceScale", new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1));
  geometry.setAttribute("instanceRotation", new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1));
  geometry.setAttribute("instanceSeed", new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1));
  geometry.setAttribute("instanceBirth", new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1));
  return geometry;
}

const grassMaterial = new THREE.ShaderMaterial({
  uniforms: grassUniforms,
  vertexShader: `
    attribute vec3 instanceOffset;
    attribute float instanceScale;
    attribute float instanceRotation;
    attribute float instanceSeed;
    attribute float instanceBirth;
    uniform float time;
    uniform vec3 playerPosition;
    uniform vec2 playerVelocity;
    uniform vec2 windDirection;
    uniform float windStrength;
    uniform float loadFadeSeconds;
    varying float vHeight;
    varying float vSeed;
    varying float vDistance;
    varying float vLoadFade;

    void main() {
      float height = clamp(position.y, 0.0, 1.0);
      float rotationSin = sin(instanceRotation);
      float rotationCos = cos(instanceRotation);
      vec2 blade = vec2(
        position.x * rotationCos - position.z * rotationSin,
        position.x * rotationSin + position.z * rotationCos
      ) * instanceScale;

      vec2 worldXZ = instanceOffset.xz;
      // A broad, slowly changing wind field keeps neighboring blades moving
      // together. The JS-driven strength has calm gaps and soft gust pulses;
      // these small spatial offsets stop the whole meadow from moving in lockstep.
      vec2 crossWind = vec2(-windDirection.y, windDirection.x);
      float localGust = sin(time * .14 + worldXZ.x * .012 + worldXZ.y * .009);
      float localRipple = sin(time * .39 + worldXZ.x * .021 - worldXZ.y * .017 + instanceSeed * 3.0);
      vec2 wind = (windDirection * (.88 + localGust * .10 + localRipple * .035)
        + crossWind * sin(time * .18 + worldXZ.x * .006 - worldXZ.y * .004) * .09)
        * windStrength * (.028 + instanceScale * .018) * height * height;

      vec2 awayFromPlayer = worldXZ - playerPosition.xz;
      float playerDistance = length(awayFromPlayer);
      vec2 pushDirection = playerDistance > .001 ? awayFromPlayer / playerDistance : vec2(0.0);
      float playerInfluence = 1.0 - smoothstep(.55, 3.3, playerDistance);
      // A second, velocity-aligned wake makes the bend read as the horse
      // travelling through the field instead of a static radial deformation.
      vec2 velocityDirection = length(playerVelocity) > .001 ? normalize(playerVelocity) : vec2(0.0);
      float wake = max(dot(normalize(awayFromPlayer + vec2(.0001)), velocityDirection), 0.0);
      float wakeInfluence = (1.0 - smoothstep(1.3, 4.4, playerDistance)) * wake;
      vec2 playerPush = pushDirection * playerInfluence * .52;
      playerPush += (pushDirection * .22 + velocityDirection * .12) * wakeInfluence;
      // Distant blades become smaller/cheaper-looking while remaining present
      // all the way to the fog line, avoiding a hard ring of popping grass.
      float distanceFromPlayer = distance(worldXZ, playerPosition.xz);
      float lodScale = mix(1.0, .38, smoothstep(36.0, 112.0, distanceFromPlayer));
      // A streamed chunk is retained at its old location until this buffer is
      // completely written. Starting the new buffer at scale zero made a
      // visible empty square in the camera view while it "loaded".
      float renderScale = lodScale;
      blade += (wind + playerPush) * instanceScale * renderScale * height * height;

      vec3 worldLocalPosition = vec3(
        blade.x + instanceOffset.x,
        height * instanceScale * renderScale + instanceOffset.y,
        blade.y + instanceOffset.z
      );
      vec4 worldPosition = modelMatrix * instanceMatrix * vec4(worldLocalPosition, 1.0);
      vec4 viewPosition = viewMatrix * worldPosition;
      vHeight = height;
      vSeed = instanceSeed;
      vLoadFade = smoothstep(0.0, 1.0, clamp((time - instanceBirth) / max(loadFadeSeconds, .001), 0.0, 1.0));
      // Three.js scene fog is based on forward camera depth. Use that same
      // measure here so the custom grass fades at the same stable boundary
      // as the terrain instead of switching between radial and view-space
      // distances as the rider and camera move.
      vDistance = max(-viewPosition.z, 0.0);
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    varying float vHeight;
    varying float vSeed;
    varying float vDistance;
    varying float vLoadFade;

    void main() {
      vec3 deep = vec3(.055, .16, .045);
      vec3 fresh = vec3(.19, .42, .075);
      vec3 sunlit = vec3(.42, .60, .13);
      float variation = fract(sin(vSeed * 91.7) * 43758.5453);
      vec3 grassColor = mix(deep, fresh, smoothstep(.05, .8, vHeight));
      grassColor = mix(grassColor, sunlit, variation * .24 * vHeight);
      float distanceFog = smoothstep(fogNear, fogFar, vDistance);
      // Let far grass dissolve into the fog instead of leaving a dark,
      // opaque layer inside it. As the rider moves closer, the same smooth
      // fade brings the blades back into view without a popping ring.
      float grassVisibility = vLoadFade * (1.0 - smoothstep(fogNear - 4.0, fogFar - 14.0, vDistance));
      gl_FragColor = vec4(mix(grassColor, fogColor, distanceFog), grassVisibility);
    }
  `,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
  transparent: true
});
const grassIdentity = new THREE.Matrix4();
const grassChunks = [];

function setGrassChunkBounds(chunk, worldChunkX, worldChunkZ) {
  // InstancedMesh has its own boundingSphere, and Three.js uses that object
  // for renderer-side frustum culling when it is present. The blade positions
  // are stored in the custom instanceOffset attribute, so the default sphere
  // computed from the tiny base ribbon only describes the origin. Keep the
  // conservative chunk sphere in mesh-local space instead.
  chunk.boundingSphere.center.set(
    worldChunkX * grassChunkSize + grassChunkSize * .5,
    0,
    worldChunkZ * grassChunkSize + grassChunkSize * .5
  );
}

for (let index = 0; index < grassChunkCount; index++) {
  const mesh = new THREE.InstancedMesh(grassGeometry(grassInstancesPerChunk), grassMaterial, grassInstancesPerChunk);
  // The blade positions and wind/contact deformation are custom shader data,
  // not the InstancedMesh matrices Three.js uses for its coarse frustum test.
  // That test can pop an entire chunk when the camera pitches or orbits, even
  // though some deformed blades are still inside the view. The explicit
  // player-distance gate below is stable; skip the unreliable second gate.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  for (let instance = 0; instance < grassInstancesPerChunk; instance++) mesh.setMatrixAt(instance, grassIdentity);
  mesh.instanceMatrix.needsUpdate = true;
  // instanceOffset is a custom world-space attribute, so Three.js cannot
  // infer this bound from the base blade geometry. InstancedMesh culling uses
  // mesh.boundingSphere (not geometry.boundingSphere), so initialize the
  // mesh-owned sphere explicitly and move its center with each chunk.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), grassChunkBoundsRadius);
  grassGroup.add(mesh);
  grassChunks.push(mesh);
}
console.info("[Open Range grass] quality", JSON.stringify({ mode: grassQuality.name, instances: grassInstanceCount, chunks: grassChunkCount, chunkSize: grassChunkSize, renderDistance: grassRenderDistance, webgl2Available }));

function grassHash(value) {
  const valueSin = Math.sin(value * 12.9898) * 43758.5453;
  return valueSin - Math.floor(valueSin);
}

// Replanning is stable now, so this budget is spent on actual chunk writes
// instead of rebuilding the same queue every frame.
const grassStreamBudgetMs = webgpuAvailable ? 3.5 : 2.5;
let grassStreamingQueue = [];
let grassChunkByKey = new Map();
const grassStreamFrustum = new THREE.Frustum();
const grassStreamProjection = new THREE.Matrix4();
const grassStreamSphere = new THREE.Sphere();

function grassChunkIsInCamera(worldChunkX, worldChunkZ) {
  // updateGrassField runs before the camera update in the current frame, so
  // the camera matrices describe the last rendered view. That is exactly the
  // view the player is looking at while the stream queue catches up.
  camera.updateMatrixWorld();
  grassStreamProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  grassStreamFrustum.setFromProjectionMatrix(grassStreamProjection);
  grassStreamSphere.center.set(
    worldChunkX * grassChunkSize + grassChunkSize * .5,
    0,
    worldChunkZ * grassChunkSize + grassChunkSize * .5
  );
  grassStreamSphere.radius = grassChunkBoundsRadius;
  return grassStreamFrustum.intersectsSphere(grassStreamSphere);
}

function populateGrassChunk(chunk, worldChunkX, worldChunkZ) {
  const chunkOriginX = worldChunkX * grassChunkSize;
  const chunkOriginZ = worldChunkZ * grassChunkSize;
  const bladesPerRow = Math.ceil(Math.sqrt(grassQuality.bladesPerCell));
  const cellStep = grassPatchSize / bladesPerRow;
  const offsets = chunk.geometry.getAttribute("instanceOffset");
  const scales = chunk.geometry.getAttribute("instanceScale");
  const rotations = chunk.geometry.getAttribute("instanceRotation");
  const seeds = chunk.geometry.getAttribute("instanceSeed");
  const births = chunk.geometry.getAttribute("instanceBirth");
  let instance = 0;
  for (let localCellX = 0; localCellX < grassCellsPerChunk; localCellX++) {
    for (let localCellZ = 0; localCellZ < grassCellsPerChunk; localCellZ++) {
      const worldCellX = worldChunkX * grassCellsPerChunk + localCellX;
      const worldCellZ = worldChunkZ * grassCellsPerChunk + localCellZ;
      const cellOriginX = worldCellX * grassPatchSize;
      const cellOriginZ = worldCellZ * grassPatchSize;
      const patchSeed = worldCellX * 37.1 + worldCellZ * 53.7;
      const cellKey = `${worldCellX}:${worldCellZ}`;
      // A reused chunk is a new visible surface, so restart its fade even if
      // this deterministic cell was populated during an earlier stream pass.
      grassCellBirths.set(cellKey, grassUniforms.time.value);
      for (let slot = 0; slot < grassQuality.bladesPerCell; slot++) {
        const slotSeed = patchSeed + slot * 17.173;
        const column = slot % bladesPerRow;
        const row = Math.floor(slot / bladesPerRow);
        const x = cellOriginX + (column + .08 + grassHash(slotSeed * 3.1 + patchSeed) * .84) * cellStep;
        const z = cellOriginZ + (row + .08 + grassHash(slotSeed * 5.7 + patchSeed) * .84) * cellStep;
        const scale = .3 + grassHash(slotSeed * 7.9 + patchSeed) * .28;
        offsets.setXYZ(instance, x, heightAt(x, z), z);
        scales.setX(instance, scale);
        rotations.setX(instance, grassHash(slotSeed * 2.7 + patchSeed) * Math.PI * 2);
        seeds.setX(instance, grassHash(slotSeed * 13.1 + patchSeed * 1.9));
        births.setX(instance, grassCellBirths.get(cellKey));
        instance++;
      }
    }
  }
  setGrassChunkBounds(chunk, worldChunkX, worldChunkZ);
  offsets.needsUpdate = true;
  scales.needsUpdate = true;
  rotations.needsUpdate = true;
  seeds.needsUpdate = true;
  births.needsUpdate = true;
  chunk.userData.pendingKey = null;
  chunk.userData.loadedKey = `${worldChunkX}:${worldChunkZ}`;
  chunk.visible = true;
}

function processGrassStreaming(immediate = false) {
  const deadline = performance.now() + (immediate ? Number.POSITIVE_INFINITY : grassStreamBudgetMs);
  while (grassStreamingQueue.length && performance.now() < deadline) {
    const entry = grassStreamingQueue.shift();
    // A newer stream request can supersede an entry while it waits in the
    // queue. Never spend a frame filling a chunk that is no longer wanted.
    if (grassChunkByKey.get(entry.key) !== entry.chunk) continue;
    populateGrassChunk(entry.chunk, entry.worldChunkX, entry.worldChunkZ);
  }
}

function pruneGrassBirths() {
  if (grassCellBirths.size <= 2500) return;
  const centerCellX = Math.floor(player.x / grassPatchSize);
  const centerCellZ = Math.floor(player.z / grassPatchSize);
  const keepRadius = grassChunkRadius * grassCellsPerChunk + 2;
  for (const cellKey of grassCellBirths.keys()) {
    const [cellX, cellZ] = cellKey.split(":").map(Number);
    if (Math.abs(cellX - centerCellX) > keepRadius || Math.abs(cellZ - centerCellZ) > keepRadius) grassCellBirths.delete(cellKey);
  }
}

function updateGrassField(force = false, immediate = false) {
  const centerChunkX = Math.floor(player.x / grassChunkSize);
  const centerChunkZ = Math.floor(player.z / grassChunkSize);
  const key = `${centerChunkX}:${centerChunkZ}`;
  const needsPlan = force || !grassGroup.userData.initialized || grassGroup.userData.key !== key;
  // Do not rebuild a pending plan every frame. Rebuilding kept replacing queue
  // entries while camera sorting was still based on the previous view.
  if (!needsPlan) {
    processGrassStreaming(immediate);
    return;
  }
  grassGroup.userData.key = key;

  const pendingByKey = new Map(grassStreamingQueue.map((entry) => [entry.key, entry]));
  const nextChunkByKey = new Map();
  const available = new Set(grassChunks);
  const missing = [];
  const desiredChunks = [];
  for (let relativeChunkX = -grassChunkRadius; relativeChunkX <= grassChunkRadius; relativeChunkX++) {
    for (let relativeChunkZ = -grassChunkRadius; relativeChunkZ <= grassChunkRadius; relativeChunkZ++) {
      const worldChunkX = centerChunkX + relativeChunkX;
      const worldChunkZ = centerChunkZ + relativeChunkZ;
      const chunkKey = `${worldChunkX}:${worldChunkZ}`;
      desiredChunks.push({ worldChunkX, worldChunkZ, chunkKey });
    }
  }

  // Reserve the complete overlap before assigning any new keys. Assigning
  // outer keys in the same pass used to let a new key steal a chunk that was
  // still needed by a later overlapping key, making every chunk look missing
  // whenever the rider crossed a chunk boundary.
  for (const { chunkKey } of desiredChunks) {
    const existing = grassChunkByKey.get(chunkKey);
    if (existing && available.has(existing)) {
      available.delete(existing);
      nextChunkByKey.set(chunkKey, existing);
      existing.visible = Boolean(existing.userData.loadedKey);
      if (pendingByKey.has(chunkKey)) missing.push(pendingByKey.get(chunkKey));
    }
  }

  for (const { worldChunkX, worldChunkZ, chunkKey } of desiredChunks) {
    if (nextChunkByKey.has(chunkKey)) continue;
    const chunk = available.values().next().value;
    available.delete(chunk);
    // Keep an already populated chunk alive until its replacement has been
    // written. Clearing it here created visible holes during a normal stream
    // shift, even though the old grass was still valid on screen.
    chunk.visible = Boolean(chunk.userData.loadedKey);
    chunk.userData.pendingKey = chunkKey;
    nextChunkByKey.set(chunkKey, chunk);
    missing.push({ chunk, worldChunkX, worldChunkZ, key: chunkKey });
  }
  // Any pool slots outside the active window are stale and must not remain as
  // stray visible patches. Assigned slots above retain valid old data until
  // their replacement is populated.
  for (const chunk of available) {
    chunk.visible = false;
    chunk.userData.pendingKey = null;
  }
  missing.sort((a, b) => {
    // Fill the outer preload ring first. Those chunks are beyond the fog fade
    // boundary, so they are ready before the rider can see their fade-in.
    const adx = a.worldChunkX * grassChunkSize + grassChunkSize * .5 - player.x;
    const adz = a.worldChunkZ * grassChunkSize + grassChunkSize * .5 - player.z;
    const bdx = b.worldChunkX * grassChunkSize + grassChunkSize * .5 - player.x;
    const bdz = b.worldChunkZ * grassChunkSize + grassChunkSize * .5 - player.z;
    return bdx * bdx + bdz * bdz - (adx * adx + adz * adz);
  });
  grassChunkByKey = nextChunkByKey;
  grassStreamingQueue = missing;
  grassGroup.userData.initialized = true;
  pruneGrassBirths();
  processGrassStreaming(immediate);
}

function updateGrassShader(time, dt) {
  grassUniforms.time.value = time;
  grassUniforms.playerPosition.value.set(player.x, heightAt(player.x, player.z), player.z);
  grassUniforms.playerVelocity.value.set(
    -Math.sin(player.heading) * player.speed,
    -Math.cos(player.heading) * player.speed
  );
  // Long calm intervals are interrupted by broad, soft gusts. Direction
  // wanders only slightly, so the wind reads as a real meadow breeze instead
  // of a synchronized animation or constant strong force.
  const gustPulse = Math.max(0, Math.sin(time * .18 - .8));
  const smallGust = Math.max(0, Math.sin(time * .43 + 1.7)) * .12;
  grassUniforms.windStrength.value = THREE.MathUtils.damp(
    grassUniforms.windStrength.value,
    .2 + gustPulse * gustPulse * .58 + smallGust,
    2.2,
    dt
  );
  const windAngle = .44 + Math.sin(time * .031) * .1 + Math.sin(time * .067 + 2.1) * .045;
  grassUniforms.windDirection.value.set(Math.cos(windAngle), Math.sin(windAngle));
  const fogColor = scene.fog?.color || scene.background;
  if (fogColor?.isColor) grassUniforms.fogColor.value.copy(fogColor);
  const maxChunkDistance = grassRenderDistance + grassChunkBoundsRadius;
  const maxChunkDistanceSq = maxChunkDistance * maxChunkDistance;
  for (const chunk of grassChunks) {
    if (!chunk.userData.loadedKey) {
      chunk.visible = false;
      continue;
    }
    const dx = chunk.boundingSphere.center.x - player.x;
    const dz = chunk.boundingSphere.center.z - player.z;
    chunk.visible = dx * dx + dz * dz <= maxChunkDistanceSq;
  }
  processGrassStreaming();
}

function heightAt(x, z) {
  const broad = Math.sin(x * .038) * 1.9 + Math.cos(z * .031) * 1.35;
  const waves = Math.sin((x + z) * .095) * .45 + Math.cos((x - z) * .075) * .35;
  const shelf = Math.sin(x * .012 + z * .008) * .55;
  return broad + waves + shelf - 1.1;
}

function terrainGeometry(worldX, worldZ) {
  const geo = new THREE.PlaneGeometry(tileSize, tileSize, 22, 22);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position;
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + worldX;
    const z = position.getZ(i) + worldZ;
    const y = heightAt(x, z);
    position.setY(i, y);
    color.setHSL(.075, .17, .33 + THREE.MathUtils.clamp((y + 4) / 8, 0, 1) * .12);
    colors.push(color.r, color.g, color.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

for (let i = 0; i < (tileRadius * 2 + 1) ** 2; i++) {
  const tile = new THREE.Mesh(new THREE.BufferGeometry(), terrainMaterial);
  tile.frustumCulled = true;
  tile.receiveShadow = true;
  terrainGroup.add(tile);
  terrainTiles.push(tile);
}

const player = { x: 0, z: 0, heading: 0, speed: 0, distance: 0 };
function updateTerrain(force = false) {
  const centerX = Math.floor(player.x / tileSize) * tileSize;
  const centerZ = Math.floor(player.z / tileSize) * tileSize;
  let index = 0;
  for (let ix = -tileRadius; ix <= tileRadius; ix++) {
    for (let iz = -tileRadius; iz <= tileRadius; iz++) {
      const x = centerX + ix * tileSize;
      const z = centerZ + iz * tileSize;
      const tile = terrainTiles[index++];
      const key = `${x}:${z}`;
      if (force || tile.userData.key !== key) {
        tile.userData.key = key;
        tile.position.set(x, 0, z);
        tile.geometry.dispose();
        tile.geometry = terrainGeometry(x, z);
      }
    }
  }
}

function updateShadowLight() {
  // Shadow maps are finite textures, so keep their high-detail volume centered
  // on the moving player. The light remains directional, but its usable shadow
  // range now travels with the streamed terrain instead of ending at spawn.
  const groundY = heightAt(player.x, player.z);
  sun.position.set(player.x - 25, groundY + 38, player.z + 18);
  sun.target.position.set(player.x, groundY, player.z);
  sun.target.updateMatrixWorld();
}

function enterRide() {
  const spawn = new THREE.Vector3(player.x, heightAt(player.x, player.z), player.z);
  const view = camera.position.clone().sub(cameraTarget);
  const viewDistance = Math.max(view.length(), .001);
  // Carry the creator's current camera angle, height, and zoom into the ride.
  // The values become the starting point for the live riding camera controls.
  rideCameraFollow = {
    heading: player.heading
  };
  rideCameraYaw = Math.atan2(view.x, view.z);
  rideCameraPitch = THREE.MathUtils.clamp(Math.asin(view.y / viewDistance), -.35, 1.05);
  rideCameraZoom = THREE.MathUtils.clamp(9.2 / viewDistance, .58, 1.8);
  rideCameraTargetHeight = cameraTarget.y - spawn.y;
  mode = "ride";
  document.body.classList.add("ride-mode");
  terrainGroup.visible = true;
  grassGroup.visible = true;
  scene.background = new THREE.Color(0x958c82);
  scene.fog = new THREE.Fog(0x958c82, grassFogNear, grassFogFar);
  // Keep the current selection position so the ride camera can inherit the
  // exact frame the player was already viewing.
  player.heading = 0;
  player.speed = 0;
  player.distance = 0;
  horseAnchor.position.set(player.x, heightAt(player.x, player.z), player.z);
  horseAnchor.rotation.y = 0;
  touchDrive.gallop = false;
  updateTerrain(true);
  updateGrassField(true);
  updateHorseGait();
  joystick?.classList.toggle("active", innerWidth < 761 || matchMedia("(pointer: coarse)").matches);
}

playButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (mode === "selection") enterRide();
});

function showSelection() {
  mode = "selection";
  document.body.classList.remove("ride-mode");
  terrainGroup.visible = true;
  grassGroup.visible = true;
  scene.background = new THREE.Color(0x958c82);
  scene.fog = new THREE.Fog(0x958c82, grassFogNear, grassFogFar);
  player.x = 0;
  player.z = 0;
  player.heading = 0;
  player.speed = 0;
  horseAnchor.position.set(player.x, heightAt(player.x, player.z), player.z);
  horseAnchor.rotation.y = 0;
  updateTerrain(true);
  // Build the initial field behind the loading/selection state; later streamed
  // regions use the frame-budgeted queue so riding never pays the full refill.
  updateGrassField(true, true);
  joystick?.classList.remove("active");
}

function updateAppearanceControl() {
  const look = horseLooks[selected];
  if (horseNameInput && document.activeElement !== horseNameInput) horseNameInput.value = horseNames[selected];
  appearanceTabs.forEach((tab) => {
    const active = tab.dataset.colorTab === activeAppearancePart;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  appearanceRows.forEach((row) => row.classList.toggle("active", row.dataset.colorRow === activeAppearancePart));
  if (activeColorInput) activeColorInput.value = look[activeAppearancePart];
  appearanceSliders.forEach((slider) => {
    const hsl = horseHsl[selected][slider.dataset.colorPart];
    const channel = slider.dataset.colorChannel;
    slider.value = channel === "h" ? Math.round(hsl.h * 360) : Math.round(hsl[channel] * 100);
    slider.style.setProperty("--color-value", look[slider.dataset.colorPart]);
    const hueColor = new THREE.Color().setHSL(hsl.h, 1, .5).getHexString();
    const lightColor = new THREE.Color().setHSL(hsl.h, hsl.s, .5).getHexString();
    slider.style.background = channel === "h"
      ? "linear-gradient(90deg, #f33, #ff0, #0f6, #0cf, #44f, #c2f, #f33)"
      : channel === "s"
        ? `linear-gradient(90deg, #888, #${hueColor})`
        : `linear-gradient(90deg, #000, #${lightColor}, #fff)`;
  });
  if (patternSelect) patternSelect.value = look.pattern;
}

horseNameInput?.addEventListener("input", (event) => {
  horseNames[selected] = event.target.value;
});

activeColorInput?.addEventListener("input", (event) => {
  const part = activeAppearancePart;
  horseLooks[selected][part] = event.target.value;
  horseHsl[selected][part] = new THREE.Color(event.target.value).getHSL({ h: 0, s: 0, l: 0 });
  updateAppearanceControl();
  if (horseModel) applyHorseAppearance(horseModel, horseLooks[selected]);
});
appearanceTabs.forEach((tab) => tab.addEventListener("click", () => {
  activeAppearancePart = tab.dataset.colorTab;
  updateAppearanceControl();
}));
appearanceSliders.forEach((slider) => slider.addEventListener("input", (event) => {
  const part = event.target.dataset.colorPart;
  const channel = event.target.dataset.colorChannel;
  const hsl = horseHsl[selected][part];
  hsl[channel] = Number(event.target.value) / (channel === "h" ? 360 : 100);
  const color = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  horseLooks[selected][part] = `#${color.getHexString()}`;
  updateAppearanceControl();
  if (horseModel) applyHorseAppearance(horseModel, horseLooks[selected]);
}));
patternSelect?.addEventListener("change", (event) => {
  horseLooks[selected].pattern = event.target.value;
  if (horseModel) applyHorseAppearance(horseModel, horseLooks[selected]);
});

function chooseHorse(index) {
  selected = (index + horses.length) % horses.length;
  updateAppearanceControl();
  loadHorse(selected);
}

// Creator and riding gestures control the camera; starting the ride is
// reserved for the explicit PLAY button. Joystick touches remain movement-only.
let pointer = { active: false, id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0 };
let touchDrive = { forward: 0, steer: 0, gallop: false };
let joystickPointerId = null;
const gesturePointers = new Map();
let pinch = { active: false, startDistance: 0, startZoom: 1 };
let suppressSelectionTap = false;
const joystickRadius = 48;

function touchDistance() {
  const [first, second] = [...gesturePointers.values()];
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
}

function updatePinchZoom() {
  if (!pinch.active || (mode !== "selection" && mode !== "ride")) return;
  const distance = touchDistance();
  if (!distance || !pinch.startDistance) return;
  // Fingers moving apart zoom in; fingers moving together zoom out.
  const zoom = THREE.MathUtils.clamp(pinch.startZoom * (distance / pinch.startDistance), .58, 1.8);
  if (mode === "selection") selectionZoom = zoom;
  else rideCameraZoom = zoom;
}

function resetJoystick() {
  joystickPointerId = null;
  touchDrive.forward = 0;
  touchDrive.steer = 0;
  if (joystickKnob) joystickKnob.style.transform = "translate3d(0, 0, 0)";
}
function moveJoystick(event) {
  if (!joystick || !joystickKnob) return;
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width * .5;
  const centerY = rect.top + rect.height * .5;
  const dx = THREE.MathUtils.clamp((event.clientX - centerX) / joystickRadius, -1, 1);
  const dy = THREE.MathUtils.clamp((event.clientY - centerY) / joystickRadius, -1, 1);
  // The world turn direction is opposite the screen-space joystick axis.
  touchDrive.steer = -dx;
  touchDrive.forward = -dy;
  joystickKnob.style.transform = `translate3d(${dx * joystickRadius}px, ${dy * joystickRadius}px, 0)`;
}
joystick?.addEventListener("pointerdown", (event) => {
  if (mode !== "ride") return;
  event.preventDefault();
  event.stopPropagation();
  joystickPointerId = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  moveJoystick(event);
});
joystick?.addEventListener("pointermove", (event) => {
  if (event.pointerId !== joystickPointerId) return;
  event.preventDefault();
  event.stopPropagation();
  moveJoystick(event);
});
joystick?.addEventListener("pointerup", (event) => {
  if (event.pointerId === joystickPointerId) resetJoystick();
});
joystick?.addEventListener("pointercancel", (event) => {
  if (event.pointerId === joystickPointerId) resetJoystick();
});
joystick?.addEventListener("lostpointercapture", resetJoystick);
canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  gesturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pointer = { active: true, id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, startTime: performance.now() };
  if (mode === "selection") {
    selectionOrbitStart = selectionOrbit;
    selectionPitchStart = selectionPitch;
  }
  try { canvas.setPointerCapture(event.pointerId); } catch (error) { console.warn("[Open Range input] pointer capture unavailable", error); }
  if ((mode === "selection" || mode === "ride") && gesturePointers.size === 2) {
    pinch = { active: true, startDistance: touchDistance(), startZoom: mode === "selection" ? selectionZoom : rideCameraZoom };
    suppressSelectionTap = true;
    pointer.active = false;
    return;
  }
  if (mode === "ride") {
    pointer.rideCameraYawStart = rideCameraYaw;
    pointer.rideCameraPitchStart = rideCameraPitch;
  }
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  const zoom = THREE.MathUtils.clamp(
    (mode === "selection" ? selectionZoom : rideCameraZoom) * Math.exp(-event.deltaY * .001),
    .58,
    1.8
  );
  if (mode === "selection") selectionZoom = zoom;
  else if (mode === "ride") rideCameraZoom = zoom;
}, { passive: false });
canvas.addEventListener("pointermove", (event) => {
  if (gesturePointers.has(event.pointerId)) {
    gesturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.active) {
      event.preventDefault();
      updatePinchZoom();
      return;
    }
  }
  if (!pointer.active || event.pointerId !== pointer.id) return;
  event.preventDefault();
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  if (mode === "selection") {
    // One-finger horizontal dragging orbits the camera around the horse.
    selectionOrbit = selectionOrbitStart + dx * .012;
    // Vertical dragging changes the camera elevation for overhead and
    // low-angle views without flipping the camera upside down.
    selectionPitch = THREE.MathUtils.clamp(selectionPitchStart + dy * .008, -.35, 1.05);
    event.preventDefault();
    return;
  }
  if (mode === "ride") {
    rideCameraYaw = pointer.rideCameraYawStart + dx * .012;
    rideCameraPitch = THREE.MathUtils.clamp(pointer.rideCameraPitchStart + dy * .008, -.35, 1.05);
    event.preventDefault();
  }
});
function finishPointer(event) {
  if (gesturePointers.has(event.pointerId)) gesturePointers.delete(event.pointerId);
  if (pinch.active || suppressSelectionTap) {
    if (gesturePointers.size < 2) pinch.active = false;
    pointer.active = false;
    if (!gesturePointers.size) suppressSelectionTap = false;
    return;
  }
  if (!pointer.active || event.pointerId !== pointer.id) return;
  const eventHasCoordinates = !["lostpointercapture", "pointercancel"].includes(event.type) && Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
  const endX = eventHasCoordinates ? event.clientX : pointer.lastX;
  const endY = eventHasCoordinates ? event.clientY : pointer.lastY;
  const dx = endX - pointer.startX;
  const dy = endY - pointer.startY;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointer.startTime;
  pointer.active = false;
  if (mode === "selection") {
    const swipeThreshold = Math.max(28, Math.min(64, innerWidth * .1));
    if (horses.length > 1 && Math.abs(dx) > swipeThreshold && Math.abs(dx) > Math.abs(dy) * 1.05) {
      chooseHorse(selected + (dx < 0 ? 1 : -1));
    }
  } else {
    if (distance < 24 && elapsed < 300) touchDrive.gallop = !touchDrive.gallop;
    if (joystickPointerId === null) {
      touchDrive.forward = 0;
      touchDrive.steer = 0;
    }
  }
}
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", (event) => {
  if (gesturePointers.has(event.pointerId)) gesturePointers.delete(event.pointerId);
  if (pinch.active || suppressSelectionTap) {
    pinch.active = false;
    pointer.active = false;
    if (!gesturePointers.size) suppressSelectionTap = false;
    return;
  }
  if (pointer.id !== event.pointerId) return;
  // A cancelled touch can still carry the final finger position. Treat it as
  // a completed selection gesture so leaving the canvas does not swallow a
  // valid swipe; riding input is simply released.
  if (mode === "selection") finishPointer(event);
  else {
    pointer.active = false;
    if (joystickPointerId === null) {
      touchDrive.forward = 0;
      touchDrive.steer = 0;
    }
  }
});
canvas.addEventListener("lostpointercapture", (event) => { if (pointer.active && pointer.id === event.pointerId) finishPointer(event); });
addEventListener("pointerup", finishPointer);

const keys = new Set();
addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(event.key.toLowerCase())) event.preventDefault();
});
addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

function updateRide(dt) {
  const keyForward = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const keySteer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
  const forward = keyForward || touchDrive.forward;
  const steer = keySteer || touchDrive.steer;
  const gallop = keys.has("shift") || touchDrive.gallop;
  const driveStrength = THREE.MathUtils.clamp(Math.abs(forward), 0, 1);
  const targetSpeed = driveStrength < .04 ? 0 : forward * (gallop ? 12 : 12 * driveStrength);
  player.speed = THREE.MathUtils.damp(player.speed, targetSpeed, forward ? 3.2 : 5.8, dt);
  player.heading += steer * dt * (Math.abs(player.speed) > 1 ? 1.45 : .8);
  const direction = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading));
  player.x += direction.x * player.speed * dt;
  player.z += direction.z * player.speed * dt;
  player.distance += Math.abs(player.speed) * dt;
  horseAnchor.position.set(player.x, heightAt(player.x, player.z), player.z);
  horseAnchor.rotation.y = player.heading;
  updateHorseGait();
  updateTerrain();
}

const selectionCutsceneSpeed = 1.15;
function updateSelection(dt) {
  // Let the preview horse travel forward continuously so the creation screen
  // feels like a small riding cutscene instead of a frozen turntable.
  player.speed = selectionCutsceneSpeed;
  const direction = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading));
  player.x += direction.x * player.speed * dt;
  player.z += direction.z * player.speed * dt;
  player.distance += player.speed * dt;
  horseAnchor.position.set(player.x, heightAt(player.x, player.z), player.z);
  horseAnchor.rotation.y = player.heading;
  updateTerrain();
}

const cameraTarget = new THREE.Vector3();
function updateCamera(dt) {
  if (mode === "selection") {
    const previewX = player.x;
    const previewZ = player.z;
    const radius = 9.2 / selectionZoom;
    const targetY = horseAnchor.position.y + (innerWidth < 761 ? .78 : .98);
    const horizontalRadius = Math.cos(selectionPitch) * radius;
    camera.position.lerp(new THREE.Vector3(
      previewX + Math.sin(selectionOrbit) * horizontalRadius,
      targetY + Math.sin(selectionPitch) * radius,
      previewZ + Math.cos(selectionOrbit) * horizontalRadius
    ), .035);
    cameraTarget.set(previewX, targetY, previewZ);
  } else {
    const horsePosition = new THREE.Vector3(player.x, heightAt(player.x, player.z), player.z);
    if (rideCameraFollow) {
      const radius = 9.2 / rideCameraZoom;
      const horizontalRadius = Math.cos(rideCameraPitch) * radius;
      const targetY = horsePosition.y + rideCameraTargetHeight;
      const yaw = player.heading + rideCameraYaw;
      const desired = new THREE.Vector3(
        horsePosition.x + Math.sin(yaw) * horizontalRadius,
        targetY + Math.sin(rideCameraPitch) * radius,
        horsePosition.z + Math.cos(yaw) * horizontalRadius
      );
      const target = new THREE.Vector3(horsePosition.x, targetY, horsePosition.z);
      camera.position.lerp(desired, 1 - Math.pow(.001, dt));
      cameraTarget.lerp(target, 1 - Math.pow(.001, dt));
    } else {
      const forward = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
      const desired = horsePosition.clone().addScaledVector(forward, -8.4).setY(horsePosition.y + 3.7);
      camera.position.lerp(desired, 1 - Math.pow(.001, dt));
      cameraTarget.copy(horsePosition).addScaledVector(forward, 4.2).setY(horsePosition.y + 1.15);
    }
  }
  camera.lookAt(cameraTarget);
}

let clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (mode === "ride") updateRide(dt);
  else updateSelection(dt);
  updateShadowLight();
  if (horseMixer) horseMixer.update(dt * (mode === "ride" ? 1 : .75));
  updateCamera(dt);
  // Plan and prioritize streaming against the camera pose that will actually
  // be rendered this frame, rather than the stale pose from the prior frame.
  updateGrassField();
  updateGrassShader(clock.elapsedTime, dt);
  updateHoofDust(dt);
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
});

terrainGroup.visible = false;
updateTerrain(true);
showSelection();
updateAppearanceControl();
loadHorse(0);
auditRuntimeAssets();
animate();
