// Procedural 3D village ambience (WebAudio, no sound files).
// Day: birds, crows, cattle, temple bells, distant auto horns. Night: crickets, dogs, frogs near water.
// Usage: const amb = VillageAmbience(audioCtx, world); each frame amb.update(dt, camera, timeOfDay, traffic, carSpeed)
function VillageAmbience(ctx, world) {
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  const L = ctx.listener;
  let enabled = true, t = 0;

  // shared noise buffer
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };

  // positional output: returns a node to connect a sound into, placed at (x, y, z)
  function at(x, y, z, vol) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 8; p.maxDistance = 400; p.rolloffFactor = 1.2;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    const g = ctx.createGain(); g.gain.value = vol; g.connect(p); p.connect(master);
    return g;
  }
  const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); };

  // ---------------- beds: wind (always) and crickets (night)
  const wind = noise(), windF = ctx.createBiquadFilter(), windG = ctx.createGain();
  windF.type = 'lowpass'; windF.frequency.value = 420; windG.gain.value = 0.05;
  wind.connect(windF); windF.connect(windG); windG.connect(master); wind.start();
  const cricketG = ctx.createGain(); cricketG.gain.value = 0; cricketG.connect(master);
  const crickets = [];
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4200 + i * 380;
    const am = ctx.createOscillator(); am.frequency.value = 28 + i * 7; const amG = ctx.createGain(); amG.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.5; am.connect(amG); amG.connect(g.gain);
    const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 1.6 + i * 0.5; const pG = ctx.createGain(); pG.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.5; pulse.connect(pG); pG.connect(g2.gain);
    o.connect(g); g.connect(g2); g2.connect(cricketG);
    o.start(); am.start(); pulse.start(); crickets.push(o);
  }

  // leaf rustle: wind gusts through neem trees (band-passed noise with a slow random swell)
  const rustle = noise(), rustleF = ctx.createBiquadFilter(), rustleG = ctx.createGain();
  rustleF.type = 'bandpass'; rustleF.frequency.value = 3200; rustleF.Q.value = 0.5; rustleG.gain.value = 0;
  rustle.connect(rustleF); rustleF.connect(rustleG); rustleG.connect(master); rustle.start();
  // cicadas: midday summer drone, two detuned buzzing voices
  const cicadaG = ctx.createGain(); cicadaG.gain.value = 0; cicadaG.connect(master);
  for (const f of [6100, 6650]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    const am = ctx.createOscillator(); am.frequency.value = 180 + Math.random() * 40; const amG = ctx.createGain(); amG.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.5; am.connect(amG); amG.connect(g.gain);
    o.connect(bp); bp.connect(g); g.connect(cicadaG); o.start(); am.start();
  }
  function koel(x, y, z) {          // Asian koel "ku-oo" rising call, the classic Telangana summer morning sound
    const out = at(x, y, z, 0.4), k = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < k; i++) {
      const t0 = ctx.currentTime + i * 0.7, o = ctx.createOscillator(), g = ctx.createGain(), base = 700 + i * 90;
      o.type = 'sine'; o.frequency.setValueAtTime(base, t0); o.frequency.linearRampToValueAtTime(base * 1.45, t0 + 0.32);
      env(g, t0, 0.04, 0.7, 0.4); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.5);
    }
  }

  // ---------------- one-shot calls
  function bird(x, y, z) {
    const n = 2 + Math.floor(Math.random() * 5), base = 2200 + Math.random() * 2400, out = at(x, y, z, 0.25);
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * (0.09 + Math.random() * 0.08), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t0); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t0 + 0.06);
      env(g, t0, 0.01, 0.6, 0.07); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.12);
    }
  }
  function crow(x, y, z) {
    const out = at(x, y, z, 0.35), k = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < k; i++) {
      const t0 = ctx.currentTime + i * 0.42, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(620, t0); o.frequency.linearRampToValueAtTime(480, t0 + 0.3);
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 4;
      env(g, t0, 0.02, 0.8, 0.28); o.connect(f); f.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.35);
    }
  }
  function moo(x, y, z) {
    const t0 = ctx.currentTime, out = at(x, y, z, 0.5), o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(130, t0); o.frequency.linearRampToValueAtTime(165, t0 + 0.4); o.frequency.linearRampToValueAtTime(110, t0 + 1.4);
    f.type = 'lowpass'; f.frequency.setValueAtTime(400, t0); f.frequency.linearRampToValueAtTime(900, t0 + 0.5); f.frequency.linearRampToValueAtTime(350, t0 + 1.4);
    env(g, t0, 0.15, 0.7, 1.3); o.connect(f); f.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 1.6);
  }
  function bark(x, y, z) {
    const out = at(x, y, z, 0.45), k = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) {
      const t0 = ctx.currentTime + i * (0.28 + Math.random() * 0.15), s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(420, t0); o.frequency.exponentialRampToValueAtTime(260, t0 + 0.12);
      f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 2;
      env(g, t0, 0.01, 0.8, 0.14); s.connect(f); o.connect(f); f.connect(g); g.connect(out);
      s.start(t0); s.stop(t0 + 0.18); o.start(t0); o.stop(t0 + 0.18);
    }
  }
  function bell(x, y, z) {
    const out = at(x, y, z, 0.5), t0 = ctx.currentTime;
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 520 * m;
      env(g, t0, 0.005, a * 0.5, 3.2 / Math.sqrt(m)); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 3.5);
    }
  }
  function autoHorn(x, y, z) {
    const out = at(x, y, z, 0.35);
    for (let i = 0; i < 2; i++) {
      const t0 = ctx.currentTime + i * 0.22, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 480; o2.type = 'square'; o2.frequency.value = 600;
      env(g, t0, 0.01, 0.3, 0.14); o.connect(g); o2.connect(g); g.connect(out); o.start(t0); o2.start(t0); o.stop(t0 + 0.17); o2.stop(t0 + 0.17);
    }
  }
  function frog(x, y, z) {
    const out = at(x, y, z, 0.3), t0 = ctx.currentTime, o = ctx.createOscillator(), am = ctx.createOscillator(), amG = ctx.createGain(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 180 + Math.random() * 60; am.frequency.value = 40; amG.gain.value = 0.5;
    am.connect(amG); amG.connect(g.gain); env(g, t0, 0.02, 0.5, 0.25); o.connect(g); g.connect(out);
    o.start(t0); am.start(t0); o.stop(t0 + 0.3); am.stop(t0 + 0.3);
  }

  // ---------------- scheduler
  const temples = world.landmarks.filter(l => l.k === 'temple');
  const lakes = (window.NELLUTLA_MAP.lakes || []).map(lk => [lk.reduce((s, p) => s + p[0], 0) / lk.length, lk.reduce((s, p) => s + p[1], 0) / lk.length]);
  const next = { koel: 6, bird: 1, crow: 4, moo: 12, bark: 8, bell: 5, horn: 6, frog: 3 };
  const around = (c, r) => [c.x + (Math.random() - 0.5) * 2 * r, 2 + Math.random() * 8, c.z + (Math.random() - 0.5) * 2 * r];

  function update(dt, camera, hour, traffic, carSpeed) {
    if (!enabled) return;
    t += dt;
    // listener follows the camera
    const p = camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }

    const night = hour < 5.5 || hour > 19, dawn = hour > 5 && hour < 8.5, dusk = hour > 17.5 && hour < 19.5;
    const surf = world.surfaceAt(p.x, p.z), inVillage = ['cc', 'lane'].includes(surf);
    cricketG.gain.setTargetAtTime(night ? 0.02 : 0, ctx.currentTime, 2);
    windG.gain.setTargetAtTime(0.03 + Math.min(0.12, Math.abs(carSpeed) / 900), ctx.currentTime, 0.5);
    windF.frequency.setTargetAtTime(380 + Math.abs(carSpeed) * 6, ctx.currentTime, 0.5);

    const due = (k, min, max) => { if ((next[k] -= dt) > 0) return false; next[k] = min + Math.random() * (max - min); return true; };
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
    rustleG.gain.setTargetAtTime((inVillage ? 0.012 : 0.03) * gust, ctx.currentTime, 0.8);
    cicadaG.gain.setTargetAtTime(hour > 10.5 && hour < 16.5 && !inVillage ? 0.006 : 0, ctx.currentTime, 3);
    if ((dawn || (hour > 8 && hour < 11)) && due('koel', 8, 20)) koel(...around(p, 80));
    if (!night && due('bird', dawn ? 0.4 : 1.2, dawn ? 1.5 : 4)) bird(...around(p, 60));
    if (!night && due('crow', 4, 12)) crow(...around(p, 90));
    if (!night && due('moo', 15, 40)) { const q = around(p, 70); if (window.SFX) SFX.moo(q[0], q[2]); else moo(q[0], 1, q[2]); }
    if (due('bark', night ? 5 : 18, night ? 16 : 45)) bark(...around(p, inVillage ? 50 : 120).map((v, i) => i === 1 ? 0.5 : v));
    // temple bells at prayer times, louder when close
    if ((dawn || dusk || Math.random() < 0.2) && due('bell', dawn || dusk ? 3 : 10, dawn || dusk ? 7 : 25)) {
      const tp = temples.map(tl => [Math.hypot(tl.x - p.x, tl.z - p.z), tl]).sort((a, b) => a[0] - b[0])[0];
      if (tp && tp[0] < 300) bell(tp[1].x, 4, tp[1].z);
    }
    if (!night && traffic && traffic.length && due('horn', 5, 14)) {
      const near = traffic.filter(tc => tc.model !== 'bullockCart' && Math.hypot(tc.g.position.x - p.x, tc.g.position.z - p.z) < 150);
      if (near.length) { const tc = near[Math.floor(Math.random() * near.length)]; if (window.SFX) SFX.horn(tc._snd ? tc._snd.type : tc.model, tc.g.position.x, tc.g.position.z); else autoHorn(tc.g.position.x, 1, tc.g.position.z); }
    }
    if (night && lakes.length && due('frog', 0.6, 2.5)) {
      const lk = lakes.find(c => Math.hypot(c[0] - p.x, c[1] - p.z) < 400);
      if (lk) frog(lk[0] + (Math.random() - 0.5) * 60, 0.5, lk[1] + (Math.random() - 0.5) * 60);
    }
  }
  return {
    update,
    toggle() { enabled = !enabled; master.gain.setTargetAtTime(enabled ? 0.55 : 0, ctx.currentTime, 0.2); return enabled; },
  };
}
