// Toyota Innova Crysta 2.4 V (TS 08 HN 1111): model, audio, animations and cameras.
// Extracted from innova_crysta_nellutla.html so it can run on the real Nellutla map.
let scene, camera, renderer, clock;
let isPlaying = false;
let playerCarGroup = null;

// Vehicle Physics
const wheelRadius = 0.38;
const wheelWidth = 0.24;
const carLength = 4.735;
const carWidth = 1.830;
const carHeight = 1.795;
const carPos = new THREE.Vector3(0, 0.44, 30);
let carRot = 0;
let carSpeed = 0;
let steerAngle = 0;
let engineRPM = 900;
let currentGear = 1;
let isReversing = false;
let fourWheelDriveLock = false;
let nosTank = 100;
let isNosActive = false;
let turboBoost = 0;
let skidMarks = [];
let maxSkidMarks = 400;

// Camera Modes
const CAMERA_MODES = ['CHASE', 'CLOSE_CHASE', 'COCKPIT', 'HOOD', 'BIRD_EYE'];
let cameraIndex = 0;

// Interactive Parts Animations
let doorStates = { FL: 0, FR: 0, RL: 0, RR: 0 };
let trunkState = 0;
let hoodState = 0;
let sunroofState = 0;
let mirrorState = 0;
let wipersActive = false;
let wiperAngle = 0;
let wiperDir = 1;
let headlightsOn = false;

// 3D Parts References
let doorMeshes = {};
let mirrorMeshes = {};
let wiperMeshes = [];
let trunkMesh, hoodMesh, sunroofMesh;
let wheelMeshes = [];
let frontHeadlights = [];
let rearBrakeLights = [];
let nosFlameJets = [];
let cockpitSpeedoNeedle = null;
let cockpitTachoNeedle = null;

// Weather & Atmosphere
const WEATHERS = ['CLEAR_DAY', 'GOLDEN_SUNSET', 'NIGHT', 'RAIN_STORM'];
let weatherIndex = 0;
let rainParticles = null;
let rainCount = 1500;
let hemiLight, sunLight;
let cloudsGroup = null;

// Missions

let currentMissionIndex = 0;
let checkpointHologram = null;
let playerCash = 999999;

// AI Traffic
let trafficCars = [];

// Input state
const inputState = {
  gas: false, brake: false, left: false, right: false, drift: false, nos: false
};

// WebAudio
let audioCtx = null;
let dieselOsc1, dieselOsc2, engineGain;
let turboOsc, turboGain;
let squealOsc, squealGain;
function createLicensePlateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#0f172a';
  ctx.strokeRect(4, 4, 504, 120);

  // Left Blue Bar
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(8, 8, 56, 112);

  // Indian Tricolor Ribbon
  ctx.fillStyle = '#ff9933';
  ctx.fillRect(14, 16, 44, 12);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(14, 28, 44, 12);
  ctx.fillStyle = '#138808';
  ctx.fillRect(14, 40, 44, 12);

  // Blue Ashoka Chakra Dot
  ctx.fillStyle = '#000080';
  ctx.beginPath();
  ctx.arc(36, 34, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('IND', 36, 84);

  // Main Registration Number: TS 08 HN 1111
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 68px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TS 08 HN 1111', 290, 80);

  // Subtext: S MANOHAR GOUD
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('S MANOHAR GOUD • TELANGANA', 290, 110);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

function initAudio() {
  if (audioCtx) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    dieselOsc1 = audioCtx.createOscillator();
    dieselOsc1.type = 'sawtooth';
    dieselOsc1.frequency.value = 42;

    dieselOsc2 = audioCtx.createOscillator();
    dieselOsc2.type = 'triangle';
    dieselOsc2.frequency.value = 84;

    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0.08;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;

    dieselOsc1.connect(filter);
    dieselOsc2.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioCtx.destination);

    dieselOsc1.start();
    dieselOsc2.start();

    turboOsc = audioCtx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = 1200;

    turboGain = audioCtx.createGain();
    turboGain.gain.value = 0;

    turboOsc.connect(turboGain);
    turboGain.connect(audioCtx.destination);
    turboOsc.start();

    squealOsc = audioCtx.createOscillator();
    squealOsc.type = 'sawtooth';
    squealOsc.frequency.value = 860;

    squealGain = audioCtx.createGain();
    squealGain.gain.value = 0;

    const sqFilter = audioCtx.createBiquadFilter();
    sqFilter.type = 'bandpass';
    sqFilter.frequency.value = 1400;

    squealOsc.connect(sqFilter);
    sqFilter.connect(squealGain);
    squealGain.connect(audioCtx.destination);
    squealOsc.start();
  } catch(e) {}
}

function updateAudio() {
  if (!dieselOsc1 || !audioCtx) return;

  const freq = 38 + (engineRPM / 5500) * 165;
  dieselOsc1.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  dieselOsc2.frequency.setTargetAtTime(freq * 1.5, audioCtx.currentTime, 0.05);

  const throttle = inputState.gas ? (isNosActive ? 0.22 : 0.15) : 0.05;
  engineGain.gain.setTargetAtTime(throttle, audioCtx.currentTime, 0.05);

  if (turboGain) {
    const turboFreq = 800 + turboBoost * 2200;
    turboOsc.frequency.setTargetAtTime(turboFreq, audioCtx.currentTime, 0.08);
    const targetTurboGain = (inputState.gas && carSpeed > 30) ? (turboBoost * 0.045) : 0;
    turboGain.gain.setTargetAtTime(targetTurboGain, audioCtx.currentTime, 0.08);
  }

  // tyre squeal is driven by the slip model in index.html
}

function playBlowOffValveSound() {
  if (!audioCtx) return;
  try {
    const bufSize = audioCtx.sampleRate * 0.35;
    const buffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.25));
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.35);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.16, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
  } catch(e) {}
}

function triggerHorn() {
  if (!audioCtx) initAudio();
  if (!audioCtx) return;
  [415, 520].forEach(freq => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(0.24, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.36);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.36);
  });
}

function playMechanicalClick() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, audioCtx.currentTime);
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch(e) {}
}

function playVictoryFanfare() {
  if (!audioCtx) return;
  [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.12);
    g.gain.setValueAtTime(0.22, audioCtx.currentTime + idx * 0.12);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + idx * 0.12 + 0.35);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + idx * 0.12);
    osc.stop(audioCtx.currentTime + idx * 0.12 + 0.35);
  });
}

function crystaEnvMap() {
  if (crystaEnvMap.tex) return crystaEnvMap.tex;
  const face = (top, bot, horizon) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 64);
    if (top === 'sky') { gr.addColorStop(0, '#6f9fd8'); gr.addColorStop(1, '#cfe2f3'); }
    else if (top === 'ground') { gr.addColorStop(0, '#6b5a45'); gr.addColorStop(1, '#4a3d2e'); }
    else { gr.addColorStop(0, '#8fb6e2'); gr.addColorStop(0.5, '#e4eef7'); gr.addColorStop(0.53, '#7d7158'); gr.addColorStop(1, '#4f4434'); }
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c;
  };
  const t = new THREE.CubeTexture([face('side'), face('side'), face('sky'), face('ground'), face('side'), face('side')]);
  t.needsUpdate = true; crystaEnvMap.tex = t; return t;
}

function buildToyotaInnovaCrysta() {
  if (playerCarGroup) scene.remove(playerCarGroup);
  playerCarGroup = new THREE.Group();

  wheelMeshes = [];
  rearBrakeLights = [];
  frontHeadlights = [];
  doorMeshes = {};
  mirrorMeshes = {};
  wiperMeshes = [];
  nosFlameJets = [];

  // Vehicle dimensions are defined globally

  // small generated environment (sky gradient over warm ground) for paint / glass / chrome reflections
  const envMap = crystaEnvMap();
  const bodyPaintMat = new THREE.MeshPhongMaterial({   // Super White: warm white base, crisp clearcoat highlight
    color: 0xf4f4f0, specular: 0xb8c2cc, shininess: 110, envMap, reflectivity: 0.16, combine: THREE.MixOperation
  });
  const pianoBlackMat = new THREE.MeshPhongMaterial({
    color: 0x07090d, specular: 0x5a6676, shininess: 110, envMap, reflectivity: 0.22, combine: THREE.MixOperation
  });
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xe8edf2, specular: 0xffffff, shininess: 160, envMap, reflectivity: 0.85, combine: THREE.MixOperation
  });
  const darkGlassMat = new THREE.MeshPhongMaterial({
    color: 0x0c131c, specular: 0xaabbcc, transparent: true, opacity: 0.86, shininess: 150, envMap, reflectivity: 0.35, combine: THREE.MixOperation
  });
  const hazelLeatherMat = new THREE.MeshLambertMaterial({ color: 0xa16207 });
  const darkTrimMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });

  const chassisMesh = new THREE.Group();

  // 1-8. Sculpted exterior shell (crysta-body.js)
  buildCrystaShell(chassisMesh, { paint: bodyPaintMat, pianoBlack: pianoBlackMat, chrome: chromeMat, glass: darkGlassMat }, createLicensePlateTexture());

  // 9. RHD cabin interior (crysta-detail.js)
  buildCrystaInterior(chassisMesh);

  playerCarGroup.add(chassisMesh);
  playerCarGroup.userData.body = chassisMesh;        // the sprung mass (suspension moves this, not the wheels)

  // 10. 17" TWO-TONE DIAMOND-CUT STAR ALLOY WHEELS
  const wheelPositions = [
    { x: -carWidth/2 - 0.02, z: 1.38, isFront: true },
    { x: carWidth/2 + 0.02,  z: 1.38, isFront: true },
    { x: -carWidth/2 - 0.02, z: -1.37, isFront: false },
    { x: carWidth/2 + 0.02,  z: -1.37, isFront: false }
  ];

  wheelPositions.forEach((wp) => {
    const wAnchor = new THREE.Group();
    wAnchor.position.set(wp.x, wheelRadius, wp.z);

    // 10. detailed alloy + tyre (crysta-detail.js)
    const wheel = buildCrystaWheel(wp.x > 0 ? 1 : -1, wheelRadius, wheelWidth);
    const wTireGroup = wheel.spin;
    wAnchor.add(wTireGroup);
    wAnchor.add(wheel.fixed);

    playerCarGroup.add(wAnchor);
    wheelMeshes.push({ anchor: wAnchor, tire: wTireGroup, isFront: wp.isFront, obj: wAnchor, x: wp.x, z: wp.z, baseY: wheelRadius });
  });

  mergeCrystaStatic(chassisMesh);
  scene.add(playerCarGroup);
}

// The shell + cabin are ~400 small meshes (400 draw calls, again in the shadow pass). Merge the static ones
// into one mesh per material; every animated / recoloured handle (doors, mirrors, hood, trunk, sunroof,
// wipers, lamps, NOS flames, steering wheel) stays its own object, each merged internally.
function mergeCrystaStatic(chassis) {
  if (typeof TrafficModels === 'undefined' || !TrafficModels.mergeUnder) return;
  const handles = [hoodMesh, trunkMesh, sunroofMesh, chassis.userData.steeringWheel, ...wiperMeshes, ...nosFlameJets,
    ...Object.values(doorMeshes).map(d => d.group), ...Object.values(mirrorMeshes).map(d => d.group)].filter(Boolean);
  const lamps = [...rearBrakeLights, ...frontHeadlights];
  const keep = new Set([...handles, ...lamps]);
  // many parts build their own identical material: share them so the merge yields fewer buckets
  const canon = new Map(), hex = c => (c && c.isColor ? c.getHexString() : '');
  chassis.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material) || lamps.includes(o)) return;
    const m = o.material;
    const k = [m.type, hex(m.color), hex(m.emissive), hex(m.specular), m.shininess, m.opacity, m.transparent, m.side, m.depthWrite,
      m.map && m.map.uuid, m.envMap && m.envMap.uuid, m.reflectivity, m.combine, m.vertexColors, m.polygonOffset, m.polygonOffsetFactor].join('|');
    if (!canon.has(k)) canon.set(k, m); else o.material = canon.get(k);
  });
  TrafficModels.mergeUnder(chassis, keep);
  for (const h of handles) if (h.isObject3D && !h.isMesh) TrafficModels.mergeUnder(h, new Set([...handles, ...lamps].filter(x => x !== h)));
  for (const w of wheelMeshes) { TrafficModels.mergeUnder(w.tire, new Set()); TrafficModels.mergeUnder(w.anchor, new Set([w.tire])); }
}

// ======================================================================
// INTERACTIVE CAR CONTROLS
// ======================================================================
function toggleDoor(id) {
  if (typeof Player !== 'undefined' && Player.vehiclePart && Player.vehiclePart('door', id)) return;   // driving something else: its doors, not the Crysta's
  doorStates[id] = doorStates[id] ? 0 : 1;
  playMechanicalClick();
}

function toggleTrunk() {
  if (typeof Player !== 'undefined' && Player.vehiclePart && Player.vehiclePart('boot')) return;
  trunkState = trunkState ? 0 : 1;
  playMechanicalClick();
}

function toggleHood() {
  if (typeof Player !== 'undefined' && Player.vehiclePart && Player.vehiclePart('hood')) return;
  hoodState = hoodState ? 0 : 1;
  playMechanicalClick();
}

function toggleSunroof() {
  if (typeof Player !== 'undefined' && Player.vehiclePart && Player.vehiclePart('sunroof')) return;
  sunroofState = sunroofState ? 0 : 1;
  playMechanicalClick();
}

function toggleMirrors() {
  mirrorState = mirrorState ? 0 : 1;
  playMechanicalClick();
}

function toggleWipers() {
  wipersActive = !wipersActive;
  playMechanicalClick();
}

function toggle4WD() {
  fourWheelDriveLock = !fourWheelDriveLock;
  document.getElementById('btn4wd').textContent = fourWheelDriveLock ? '4WD: LOCKED' : '4WD: HIGH';
  document.getElementById('btn4wd').style.background = fourWheelDriveLock ? '#22c55e' : '';
  showComboPopup(fourWheelDriveLock ? '4WD CRAWL LOCKED' : '4WD STANDARD');
}

function updateCarAnimations(dt) {
  for (let id in doorStates) {
    if (doorMeshes[id]) {
      const target = doorStates[id] * (doorMeshes[id].isLeft ? 0.95 : -0.95);
      doorMeshes[id].group.rotation.y += (target - doorMeshes[id].group.rotation.y) * dt * 8.0;
    }
  }

  if (trunkMesh) {
    const targetTrunk = trunkState * 1.1;
    trunkMesh.rotation.x += (targetTrunk - trunkMesh.rotation.x) * dt * 6.0;
  }

  if (hoodMesh) {
    const targetHood = hoodState * -0.85;
    hoodMesh.rotation.x += (targetHood - hoodMesh.rotation.x) * dt * 6.0;
  }

  if (sunroofMesh) {
    const targetSunroofZ = sunroofState ? -0.6 : -0.2;
    sunroofMesh.position.z += (targetSunroofZ - sunroofMesh.position.z) * dt * 5.0;
  }

  for (let side in mirrorMeshes) {
    if (mirrorMeshes[side]) {
      const isL = mirrorMeshes[side].isLeft;
      const targetM = mirrorState * (isL ? 1.2 : -1.2);
      mirrorMeshes[side].group.rotation.y += (targetM - mirrorMeshes[side].group.rotation.y) * dt * 7.0;
    }
  }

  if (wipersActive) {
    wiperAngle += wiperDir * dt * 5.0;
    if (wiperAngle > 1.2) { wiperAngle = 1.2; wiperDir = -1; }
    if (wiperAngle < 0.0) { wiperAngle = 0.0; wiperDir = 1; }
    wiperMeshes.forEach(w => w.rotation.z = -wiperAngle);
  }

  nosFlameJets.forEach(flame => {
    flame.visible = isNosActive;
    if (isNosActive) {
      flame.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.6, 0.8 + Math.random() * 0.4);
    }
  });

  if (cockpitSpeedoNeedle) {
    const speedRatio = Math.min(1.0, window.Drive.speed / 200);
    cockpitSpeedoNeedle.rotation.z = 1.2 - speedRatio * 2.4;
  }
  if (cockpitTachoNeedle) {
    const rpmRatio = (window.Drive.rpm - window.Drive.idle) / Math.max(1, window.Drive.red - window.Drive.idle);
    cockpitTachoNeedle.rotation.z = 1.2 - rpmRatio * 2.4;
  }
}

// ======================================================================
// WEATHER ENGINE
// ======================================================================
function updateCamera(dt) {
  if (!playerCarGroup) return;
  // PUBG-style chase rig shared with every other vehicle and on foot (player.js)
  if (typeof isPlaying !== 'undefined' && isPlaying && typeof Player !== 'undefined' && Player.crystaRig && Player.crystaRig(dt)) return;

  if (cameraIndex === 0) {
    // chase cam: follows a smoothed heading (not the raw body yaw), so steering wobble and collision
    // nudges don't shake the view; exponential smoothing keeps it identical at any frame rate
    const speedRatio = Math.min(1.0, Math.abs(carSpeed) / 195);
    const fovT = 65 + (isNosActive ? 14 : speedRatio * 8);
    if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix(); }
    if (updateCamera.yaw === undefined) updateCamera.yaw = carRot;
    let dy = carRot - updateCamera.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    updateCamera.yaw += dy * (1 - Math.exp(-dt * (4 + speedRatio * 3)));
    const back = (typeof lookBack !== 'undefined' && lookBack);
    const yaw = updateCamera.yaw + (back ? Math.PI : 0);
    const chaseDist = 6.4 + speedRatio * 1.4;
    const chaseHeight = 2.1;
    const targetX = carPos.x - Math.sin(yaw) * chaseDist;
    const targetZ = carPos.z - Math.cos(yaw) * chaseDist;
    const targetY = carPos.y + chaseHeight;
    if (back !== updateCamera.back) { camera.position.set(targetX, targetY, targetZ); updateCamera.back = back; }
    const k = 1 - Math.exp(-dt * 14);
    camera.position.x += (targetX - camera.position.x) * k;
    camera.position.y += (targetY - camera.position.y) * k;
    camera.position.z += (targetZ - camera.position.z) * k;
    camera.lookAt(carPos.x + Math.sin(yaw) * 2, carPos.y + 1.25, carPos.z + Math.cos(yaw) * 2);
  } else if (cameraIndex === 1) {
    const chaseDist = 4.8;
    const targetX = carPos.x - Math.sin(carRot) * chaseDist;
    const targetZ = carPos.z - Math.cos(carRot) * chaseDist;
    const targetY = carPos.y + 1.4;

    camera.position.x += (targetX - camera.position.x) * dt * 12.0;
    camera.position.y += (targetY - camera.position.y) * dt * 12.0;
    camera.position.z += (targetZ - camera.position.z) * dt * 12.0;

    camera.lookAt(carPos.x, carPos.y + 1.1, carPos.z);
  } else if (cameraIndex === 2) {
    if (window.Cockpit && Cockpit.camera(dt)) return;     // shared cockpit camera, seated in the sprung body
    const offset = new THREE.Vector3(-0.42, 1.35, 0.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), carRot);
    camera.position.copy(carPos).add(offset);
    camera.lookAt(camera.position.x + Math.sin(carRot) * 30, camera.position.y - 0.1, camera.position.z + Math.cos(carRot) * 30);
  } else if (cameraIndex === 3) {
    const offset = new THREE.Vector3(0, 1.20, 1.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), carRot);
    camera.position.copy(carPos).add(offset);
    const fwd = new THREE.Vector3(Math.sin(carRot) * 30, -0.2, Math.cos(carRot) * 30);
    camera.lookAt(camera.position.clone().add(fwd));
  } else {
    camera.position.set(carPos.x, carPos.y + 55, carPos.z + 12);
    camera.lookAt(carPos.x, carPos.y, carPos.z);
  }
}

function snapCameraToCar() {
  const chaseDist = 6.4;
  const chaseHeight = 2.1;
  camera.position.x = carPos.x - Math.sin(carRot) * chaseDist;
  camera.position.z = carPos.z - Math.cos(carRot) * chaseDist;
  camera.position.y = carPos.y + chaseHeight;
  updateCamera.yaw = carRot;
  camera.lookAt(carPos.x + Math.sin(carRot) * 2, carPos.y + 1.25, carPos.z + Math.cos(carRot) * 2);
}

// ======================================================================

// ======================================================================
// SUSPENSION (visual; physics untouched): every wheel samples the ground on its own, and a corner spring/damper
// joins each wheel to a sprung body with heave, pitch and roll. Heights are tracked in WORLD space, so the group's own
// y (ground under the centre, which jumps as the centre crosses a hump) never kicks the body.
// s: persistent state; g: vehicle group (rotation.y = heading); body: sprung Object3D; wheels: [{ obj, x, z, baseY }].
// o: { dt, speed (m/s), longAcc, latAcc, ground(x,z), rough(x,z), bike, pitchK, rollK, w (rad/s), zeta, travel (m) }
// Results for the cameras and audio: s.dh (body height over the group), s.p, s.r, s.acc (vertical m/s2 of the body),
// s.comp (0..1 worst corner compression), s.hit (strongest wheel strike since last read, m/s).
// ======================================================================
window.VehicleSuspension = (function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // chatter (short wavelengths) + slow undulation (5-9 m), both fixed to the ground
  const noise = (x, z) => Math.sin(x * 3.1 + z * 1.7) * 0.32 + Math.sin(x * 7.3 - z * 5.9) * 0.2 + Math.sin(x * 13.7 + z * 11.1) * 0.12
    + Math.sin(x * 0.83 - z * 1.1) * 0.75 + Math.sin(x * 1.37 + z * 0.71) * 0.55;
  const BUMP = 1.25, REBOUND = 1.35, STOP = 7, SUB = 1 / 150;          // dampers: a sharp edge kicks the body (felt, more than a soft real damper would), firm rebound; bump stop
  // stiffer vehicles get more damping and less travel, so a new row in the player.js table needs only its w
  const zetaOf = w => clamp(0.22 + (w - 6) * 0.03, 0.22, 0.46), travelOf = (w, bike) => clamp((bike ? 0.19 : 0.17) - w * 0.0065, 0.06, 0.13);
  function init(s, g, wheels, base) {
    let n = wheels.length, zm = 0, xm = 0; wheels.forEach(w => { zm += w.z; xm += w.x; }); zm /= n; xm /= n;
    let zz = 0, xx = 0; wheels.forEach(w => { w.dz = w.z - zm; w.dx = w.x - xm; zz += w.dz * w.dz; xx += w.dx * w.dx; w.wy = undefined; });
    s.zz = Math.max(zz, 0.2); s.xx = xx; s.h = base; s.hv = 0; s.p = 0; s.pv = 0; s.r = 0; s.rv = 0; s.ok = true; s.hit = 0; s.acc = 0; s.dh = 0; s.comp = 0;
  }
  function step(s, g, body, wheels, o) {
    const dt = Math.min(o.dt, 1 / 30); if (dt <= 0 || !wheels.length) return;
    const yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), base = g.position.y, n = wheels.length;
    if (!s.ok || Math.abs(base - s.h) > 1.2) init(s, g, wheels, base);          // first frame / teleport
    const sp = Math.abs(o.speed || 0), w0 = o.w || 9, zeta = o.zeta || zetaOf(w0), trav = o.travel || travelOf(w0, o.bike);
    const pT = clamp(-(o.longAcc || 0) * (o.pitchK || 0.005), -0.05, 0.05), rT = o.bike ? 0 : clamp((o.latAcc || 0) * (o.rollK || 0.008), -0.07, 0.07);
    const fade = Math.min(1, sp / 5);
    for (const w of wheels) {
      const wx = g.position.x + w.x * c + w.z * sn, wz = g.position.z - w.x * sn + w.z * c;
      let h = o.ground(wx, wz);
      const amp = o.rough ? o.rough(wx, wz) : 0;
      if (amp) h += noise(wx, wz) * amp * fade;
      if (w.wy === undefined) { w.wy = h; w.wv = 0; }
      // unsprung mass: the tyre tracks the ground closely but not instantly, so a kerb reads as a hop
      const prev = w.wy; w.wy += (h - w.wy) * Math.min(1, dt * 60);
      w.wv = (w.wy - prev) / dt;
      if (Math.abs(w.wv) > (s.hit || 0)) s.hit = Math.abs(w.wv);
      if (w.obj) w.obj.position.y = w.baseY + clamp(w.wy - base, -0.4, 0.5);
    }
    const hv0 = s.hv;
    const steps = Math.min(5, Math.ceil(dt / SUB)), h = dt / steps, W2 = w0 * w0, C = 2 * zeta * w0;
    let comp = 0;
    for (let k = 0; k < steps; k++) {
      let aH = 0, aP = 0, aR = 0;
      for (const w of wheels) {
        // spring deflection at this corner: + = compressed
        const d = w.wy - (s.h - (s.p - pT) * w.dz + (s.r - rT) * w.dx), dv = w.wv - (s.hv - s.pv * w.dz + s.rv * w.dx);
        let F = W2 * d + C * dv * (dv > 0 ? BUMP : REBOUND);
        if (Math.abs(d) > trav) F += W2 * STOP * (d - Math.sign(d) * trav);   // run out of travel: the stop bites
        if (d > comp) comp = d;
        aH += F; aP -= F * w.dz; aR += F * w.dx;
      }
      s.hv += aH / n * h; s.pv += aP / s.zz * h; if (s.xx > 0.01 && !o.bike) s.rv += aR / s.xx * h;
      s.h += s.hv * h; s.p += s.pv * h; s.r += s.rv * h;
    }
    s.p = clamp(s.p, -0.16, 0.16); s.r = clamp(s.r, -0.14, 0.14); s.h = clamp(s.h, base - 0.3, base + 0.35);
    s.acc = (s.hv - hv0) / dt; s.dh = s.h - base; s.comp = clamp(comp / trav, 0, 1);
    body.position.y = (body.userData.baseY || 0) + s.dh;
    body.rotation.x = s.p; body.rotation.z = s.r;
  }
  // which surfaces shake the tyres, and how much (m): rutted earth and mud most, good tar barely
  const ROUGH = { dirt: 0.04, field: 0.06, river: 0.05, lane: 0.014, cc: 0.008, tar: 0.005, highway: 0.002 };
  function roughAt(x, z) { try { return ROUGH[world.surfaceAt(x, z)] || 0; } catch (e) { return 0; } }
  return { step, roughAt, zetaOf, travelOf };
})();
