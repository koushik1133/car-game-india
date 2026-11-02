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

  const bodyPaintMat = new THREE.MeshPhongMaterial({
    color: 0xffffff, specular: 0x94a3b8, shininess: 85
  });
  const pianoBlackMat = new THREE.MeshPhongMaterial({
    color: 0x090d16, specular: 0x334155, shininess: 80
  });
  const chromeMat = new THREE.MeshPhongMaterial({
    color: 0xf8fafc, specular: 0xffffff, shininess: 120
  });
  const darkGlassMat = new THREE.MeshPhongMaterial({
    color: 0x0f172a, specular: 0x8899aa, transparent: true, opacity: 0.82, shininess: 120
  });
  const hazelLeatherMat = new THREE.MeshLambertMaterial({ color: 0xa16207 });
  const darkTrimMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });

  const chassisMesh = new THREE.Group();

  // 1-8. Sculpted exterior shell (crysta-body.js)
  buildCrystaShell(chassisMesh, { paint: bodyPaintMat, pianoBlack: pianoBlackMat, chrome: chromeMat, glass: darkGlassMat }, createLicensePlateTexture());

  // 9. RHD cabin interior (crysta-detail.js)
  buildCrystaInterior(chassisMesh);

  playerCarGroup.add(chassisMesh);

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
    wheelMeshes.push({ anchor: wAnchor, tire: wTireGroup, isFront: wp.isFront });
  });

  scene.add(playerCarGroup);
}

// ======================================================================
// INTERACTIVE CAR CONTROLS
// ======================================================================
function toggleDoor(id) {
  doorStates[id] = doorStates[id] ? 0 : 1;
  playMechanicalClick();
}

function toggleTrunk() {
  trunkState = trunkState ? 0 : 1;
  playMechanicalClick();
}

function toggleHood() {
  hoodState = hoodState ? 0 : 1;
  playMechanicalClick();
}

function toggleSunroof() {
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
    const speedRatio = Math.min(1.0, Math.abs(carSpeed) / 200);
    cockpitSpeedoNeedle.rotation.z = 1.2 - speedRatio * 2.4;
  }
  if (cockpitTachoNeedle) {
    const rpmRatio = (engineRPM - 800) / 4700;
    cockpitTachoNeedle.rotation.z = 1.2 - rpmRatio * 2.4;
  }
}

// ======================================================================
// WEATHER ENGINE
// ======================================================================
function updateCamera(dt) {
  if (!playerCarGroup) return;

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
    const offset = new THREE.Vector3(-0.42, 1.35, 0.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), carRot);
    camera.position.copy(carPos).add(offset);
    const fwd = new THREE.Vector3(Math.sin(carRot) * 30, -0.1, Math.cos(carRot) * 30);
    camera.lookAt(camera.position.clone().add(fwd));

    const svgWheel = document.getElementById('cockpitWheel');
    if (svgWheel) svgWheel.style.transform = `rotate(${-steerAngle * 90}deg)`;
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
