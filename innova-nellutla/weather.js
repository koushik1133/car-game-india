// weather.js: weather and time-of-day control. Exposes window.Weather.
//   Weather.set('clear'|'cloudy'|'rain'|'storm'|'fog'|'snow'|'auto'), Weather.get(), Weather.options
//   Weather.setTimeMode('auto'|'day'|'night'), Weather.timeMode, Weather.timeModes, Weather.jump('morning'|'noon'|'evening'|'night')
// How it stays reversible: index.html's updateDayNight() rewrites sky, sun, hemisphere light, stars and fog colour from the
// clock every frame, and quality.js owns fog near/far per tier. Weather.frame() runs right after updateDayNight and only
// modifies those freshly written values, so with weather Clear nothing is touched and the look is exactly the original.
// Material tints (wet roads, snow wash) keep the original colours and put them back.
// Particles: ONE THREE.Points that rides the camera; all motion is in the vertex shader (no per-frame buffer writes).
(function () {
  'use strict';
  const K_W = 'sparkv.weather', K_T = 'sparkv.timeMode';
  const OPTIONS = [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['storm', 'Storm'], ['fog', 'Fog'], ['snow', 'Snow'], ['auto', 'Auto']];
  const TIME_MODES = [['auto', 'Auto cycle'], ['day', 'Always day'], ['night', 'Always night']];
  const PICKS = [['morning', 'Morning', 7.5], ['noon', 'Noon', 12], ['evening', 'Evening', 17.4], ['night', 'Night', 22]];
  // cloud: how far the sky goes to overcast grey; sun/hemi: light multipliers; fog: [near, far] caps in metres (never above the tier's own)
  const PRESET = {
    clear:  { cloud: 0,    sun: 1,    hemi: 1,    fog: null,       rain: 0,    snow: 0, wet: 0, white: 0, grey: 0x9aa3ab },
    cloudy: { cloud: 0.75, sun: 0.45, hemi: 0.92, fog: [220, 1100], rain: 0,    snow: 0, wet: 0, white: 0, grey: 0xa3abb2 },
    rain:   { cloud: 0.92, sun: 0.22, hemi: 0.8,  fog: [70, 620],  rain: 0.55, snow: 0, wet: 1, white: 0, grey: 0x7f8a94 },
    storm:  { cloud: 1,    sun: 0.08, hemi: 0.72, fog: [40, 360],  rain: 1,    snow: 0, wet: 1, white: 0, grey: 0x56606b },
    fog:    { cloud: 0.9,  sun: 0.3,  hemi: 0.95, fog: [4, 150],   rain: 0,    snow: 0, wet: 0.25, white: 0, grey: 0xb9bfc2 },
    snow:   { cloud: 0.92, sun: 0.35, hemi: 1.05, fog: [20, 400],  rain: 0,    snow: 1, wet: 0, white: 1, grey: 0xc9d0d6 },
  };
  const AUTO_WEIGHTS = [['clear', 52], ['cloudy', 20], ['rain', 12], ['fog', 7], ['storm', 5], ['snow', 4]];
  // day cycle: daylight (06:00-18:30) takes DAY_REAL seconds, the night NIGHT_REAL
  const DAY_A = 6, DAY_B = 18.5, DAY_REAL = 24 * 60, NIGHT_REAL = 8 * 60;

  const load = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok(v) ? v : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let choice = load(K_W, v => !!PRESET[v] || v === 'auto', 'clear');
  let timeMode = load(K_T, v => v === 'auto' || v === 'day' || v === 'night', 'auto');
  let active = choice === 'auto' ? 'clear' : choice, autoT = 120 + Math.random() * 120;

  // current blended parameters and their targets
  const cur = { cloud: 0, sun: 1, hemi: 1, fogK: 0, capN: 250, capF: 1500, rain: 0, snow: 0, wet: 0, white: 0, gr: 0.6, gg: 0.64, gb: 0.67 };
  const tgt = Object.assign({}, cur), KEYS = Object.keys(cur);
  let neutral = true, first = true;
  function retarget() {
    const p = PRESET[active], c = p.grey;
    tgt.cloud = p.cloud; tgt.sun = p.sun; tgt.hemi = p.hemi; tgt.rain = p.rain; tgt.snow = p.snow; tgt.wet = p.wet; tgt.white = p.white;
    tgt.fogK = p.fog ? 1 : 0; if (p.fog) { tgt.capN = p.fog[0]; tgt.capF = p.fog[1]; if (cur.fogK < 0.01) { cur.capN = tgt.capN; cur.capF = tgt.capF; } }
    if (p.cloud > 0) { tgt.gr = (c >> 16 & 255) / 255; tgt.gg = (c >> 8 & 255) / 255; tgt.gb = (c & 255) / 255; if (cur.cloud < 0.01) { cur.gr = tgt.gr; cur.gg = tgt.gg; cur.gb = tgt.gb; } }
    if (first) { for (const k of KEYS) cur[k] = tgt[k]; }                 // restored from a save: no fade-in
    neutral = false;
  }

  // ------------------------------------------------------------------ scene handles (lazy: the scene is built after this file loads)
  let G = null, pts = null, U = null, mats = null, flash = 0, flash2 = 0, boltT = 8, indoor = 0, indoorT = 0, tSec = 0, maxPts = 0;
  let col = null, colN = null, colF = null;
  const MAXN = { low: 1200, medium: 2400, high: 4000 };   // fallback when quality.js is absent; the tier's weatherPts otherwise
  function ready() {
    if (G) return true;
    try { if (typeof scene === 'undefined' || !scene || typeof skyU === 'undefined' || !sunLight || !hemiLight || !camera) return false; } catch (e) { return false; }
    G = { scene, camera, skyU, sunLight, hemiLight, stars: typeof stars !== 'undefined' ? stars : null };
    col = new THREE.Color(); colN = new THREE.Color(); colF = new THREE.Color(0xd4dcff);
    buildParticles(); collectMats();
    if (window.Quality) Quality.onChange.push(() => { setCount(); neutral = false; });   // re-apply our fog after a tier change
    return true;
  }
  function buildParticles() {
    const N = MAXN.high, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    U = { uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(36, 26, 36) }, uVel: { value: new THREE.Vector3(1.5, -17, 0.8) },
      uT: { value: 0 }, uPx: { value: 900 }, uLen: { value: 0.6 }, uMax: { value: 64 }, uSnow: { value: 0 }, uNear: { value: 0.6 }, uHide: { value: 0 },
      uCol: { value: new THREE.Color(0xc4cfdc) }, uAlpha: { value: 0.5 } };
    const m = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform vec3 uCam, uBox, uVel; uniform float uT, uPx, uLen, uMax, uSnow, uNear, uHide; attribute float aSeed; varying float vA; varying float vS;
        void main() {
          vec3 p = position * uBox + uVel * (0.75 + 0.5 * aSeed) * uT;
          p.x += uSnow * sin(uT * 0.9 + aSeed * 40.0) * 0.7; p.z += uSnow * cos(uT * 0.7 + aSeed * 31.0) * 0.7;
          p = mod(p - uCam, uBox) - 0.5 * uBox;
          vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
          float d = -mv.z;
          float s = clamp(uLen * (0.7 + 0.6 * aSeed) * uPx / max(d, 0.4), 1.5, uMax);
          vS = s; gl_PointSize = s;
          vA = smoothstep(uNear, uNear + 1.2, d) * (1.0 - smoothstep(0.40, 0.5, length(p.xz) / uBox.x));
          gl_Position = uHide > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uCol; uniform float uAlpha, uSnow; varying float vA; varying float vS;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float line = 1.0 - smoothstep(0.0, max(0.05, 0.9 / vS), abs(q.x + q.y * 0.14));
          float streak = line * (1.0 - smoothstep(0.3, 0.5, abs(q.y)));
          float dotA = 1.0 - smoothstep(0.15, 0.5, length(q));
          float a = mix(streak, dotA, uSnow) * vA * uAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uCol, a);
        }` });
    pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 5; pts.name = 'weatherParticles';
    pts.userData.noLOD = true; pts.matrixAutoUpdate = false;
    // mirrors and the reverse camera (cockpit.js) render the scene with their own camera: draw nothing there
    pts.onBeforeRender = function (r, s, cam) { const h = cam === G.camera ? 0 : 1; if (U.uHide.value !== h) { U.uHide.value = h; m.uniformsNeedUpdate = true; } };
    G.scene.add(pts); setCount();
  }
  function setCount() { maxPts = (window.Quality && Quality.T && Quality.T.weatherPts) || MAXN[(window.Quality && Quality.tier) || 'medium'] || 2400; }
  // road, ground and outer-field materials: remembered with their original colours
  function collectMats() {
    mats = []; const seen = new Set();
    G.scene.traverse(o => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const m = o.material; if (seen.has(m) || !m.isMeshLambertMaterial) return;
      const gp = o.geometry && o.geometry.parameters || {};
      let kind = null;
      if (m.polygonOffset && m.vertexColors && m.map) kind = 'road';
      else if (o.geometry.type === 'PlaneGeometry' && gp.width > 1500 && m.map && m.map.isCanvasTexture) kind = 'ground';
      else if (!m.map && ((o.geometry.type === 'RingGeometry' && gp.outerRadius > 1500) || (o.geometry.type === 'PlaneGeometry' && gp.width > 1500))) kind = 'ground';
      if (kind) { seen.add(m); mats.push({ m, road: kind === 'road', c: m.color.clone(), e: m.emissive.clone(), tint: -1 }); }
    });
  }
  function tintMats(wet, white, dayK) {
    const key = Math.round(wet * 40) + Math.round(white * 40) * 100 + Math.round(dayK * 20) * 10000;
    for (let i = 0; i < mats.length; i++) {
      const o = mats[i]; if (o.tint === key) continue; o.tint = key;
      const dark = 1 - wet * (o.road ? 0.4 : 0.2), w = white * (o.road ? 0.16 : 0.34) * (0.12 + 0.88 * dayK);
      o.m.color.copy(o.c).multiplyScalar(dark); o.m.emissive.setRGB(o.e.r + w, o.e.g + w, o.e.b + w * 1.04);
    }
  }
  function restoreMats() { if (mats) for (const o of mats) { o.m.color.copy(o.c); o.m.emissive.copy(o.e); o.tint = -1; } }
  function baseFog() { const T = window.Quality && Quality.TIERS[Quality.level]; return T || { fogNear: 250, fogFar: 1500 }; }

  // ------------------------------------------------------------------ sound: rain bed and thunder, synthesised
  let ac = null, aOut = null, aRain = null, aLow = null, aSrc = null, aBuf = null, aLast = -1, aT = 0;
  function audio() {
    if (!ac) { try { ac = typeof audioCtx !== 'undefined' ? audioCtx : null; } catch (e) { ac = null; } }
    if (!ac) return false;
    if (!aOut) {
      aOut = ac.createGain(); aOut.connect(ac.destination);
      const lv = () => aOut.gain.setTargetAtTime(window.GameAudio ? GameAudio.fxGain : 1, ac.currentTime, 0.05);
      aOut.gain.value = window.GameAudio ? GameAudio.fxGain : 1; if (window.GameAudio) GameAudio.listeners.push(lv);
      aBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = aBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ac.state === 'running';
  }
  function rainSound(level, inside) {
    if (level < 0.02) {
      if (aSrc && aLast !== 0) { aLast = 0; aRain.gain.setTargetAtTime(0, ac.currentTime, 0.4); aLow.gain.setTargetAtTime(0, ac.currentTime, 0.4); const s = aSrc; aSrc = null; setTimeout(() => { try { s.stop(); s.disconnect(); } catch (e) {} }, 2500); }
      return;
    }
    if (!audio()) return;
    if (!aSrc) {
      aSrc = ac.createBufferSource(); aSrc.buffer = aBuf; aSrc.loop = true;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
      aRain = ac.createGain(); aRain.gain.value = 0; aSrc.connect(hp); hp.connect(lp); lp.connect(aRain); aRain.connect(aOut);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.5;   // drumming on the roof / ground
      aLow = ac.createGain(); aLow.gain.value = 0; aSrc.connect(bp); bp.connect(aLow); aLow.connect(aOut);
      aSrc.start(); aLast = -1;
    }
    const key = Math.round(level * 20) + (inside ? 100 : 0);
    if (key !== aLast) { aLast = key; aRain.gain.setTargetAtTime(level * (inside ? 0.05 : 0.11), ac.currentTime, 0.5); aLow.gain.setTargetAtTime(level * level * (inside ? 0.22 : 0.12), ac.currentTime, 0.5); }
  }
  function thunder(delay, near) {
    if (!audio()) return;
    const t0 = ac.currentTime + delay, s = ac.createBufferSource(); s.buffer = aBuf; s.loop = true; s.playbackRate.value = 0.5;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(near ? 900 : 260, t0); lp.frequency.exponentialRampToValueAtTime(70, t0 + 2.6);
    const g = ac.createGain(), pk = near ? 0.75 : 0.4;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(pk, t0 + 0.05); g.gain.exponentialRampToValueAtTime(pk * 0.35, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(pk * 0.5, t0 + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
    s.connect(lp); lp.connect(g); g.connect(aOut); s.start(t0); s.stop(t0 + 3.8);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) {} };
  }

  // ------------------------------------------------------------------ per frame (after updateDayNight, before the render)
  let wipeWant = false, wipeAuto = false;
  const rainProxy = { visible: false };                                   // mud.js reads the global rainParticles.visible
  try { rainParticles = rainProxy; } catch (e) {}
  function frame(dt) {
    if (!ready()) return;
    if (first) { retarget(); first = false; }
    if (choice === 'auto') { autoT -= dt; if (autoT <= 0) { autoT = 150 + Math.random() * 210; let r = Math.random() * 100, pick = 'clear'; for (const [n, w] of AUTO_WEIGHTS) { if ((r -= w) < 0) { pick = n; break; } } if (pick !== active) { active = pick; retarget(); syncUI(); } } }
    if (neutral) return;
    // ease towards the target; when it is Clear and we have arrived, put everything back and stop touching the scene
    const k = Math.min(1, dt * 0.7); let moving = false;
    for (let i = 0; i < KEYS.length; i++) { const n = KEYS[i], d = tgt[n] - cur[n]; if (Math.abs(d) < 0.002) cur[n] = tgt[n]; else { cur[n] += d * k; moving = true; } }
    const fog = G.scene.fog, B = baseFog();
    if (!moving && active === 'clear') {
      neutral = true; restoreMats(); if (fog) { fog.near = B.fogNear; fog.far = B.fogFar; }
      pts.visible = false; rainProxy.visible = false; rainSound(0); wipers(false); flash = flash2 = 0; return;
    }
    const sk = G.skyU, hemi0 = G.hemiLight.intensity, dayK = Math.max(0, Math.min(1, (hemi0 - 0.2) / 0.5));
    // lightning: a short double flash, thunder a moment later
    if (cur.rain > 0.85 && active === 'storm') {
      boltT -= dt;
      if (boltT <= 0) { boltT = 5 + Math.random() * 13; const near = Math.random() < 0.35; flash = near ? 1 : 0.6; flash2 = 0.12 + Math.random() * 0.1; thunder(near ? 0.25 + Math.random() * 0.4 : 1 + Math.random() * 2, near); }
    }
    if (flash2 > 0) { flash2 -= dt; if (flash2 <= 0) flash = Math.max(flash, 0.8); }
    if (flash > 0.003) flash *= Math.exp(-dt * 9); else flash = 0;
    // sky, fog colour, lights
    const lum = 0.06 + 0.94 * dayK, c = cur.cloud;
    col.setRGB(cur.gr * lum, cur.gg * lum, cur.gb * lum);
    colN.copy(col).multiplyScalar(0.8);
    sk.top.value.lerp(colN, c); sk.hor.value.lerp(col, c); sk.sunCol.value.multiplyScalar(1 - c);
    if (flash) { sk.top.value.lerp(colF, flash * 0.55); sk.hor.value.lerp(colF, flash * 0.45); }
    if (fog) {
      fog.color.copy(sk.hor.value);
      fog.near = B.fogNear + (Math.min(B.fogNear, cur.capN) - B.fogNear) * cur.fogK;
      fog.far = B.fogFar + (Math.min(B.fogFar, cur.capF) - B.fogFar) * cur.fogK;
    }
    G.sunLight.intensity *= cur.sun;
    G.hemiLight.intensity = hemi0 * cur.hemi + flash * 1.7;
    if (G.stars) G.stars.material.opacity *= 1 - c;
    tintMats(cur.wet, cur.white, dayK);
    // particles
    const amount = Math.max(cur.rain, cur.snow);
    indoorT -= dt;
    if (indoorT <= 0) { indoorT = 0.3; let inb = false; try { const w = window.GAME && GAME.world; inb = !!(w && w.insideBuilding && w.insideBuilding(G.camera.position.x, G.camera.position.z, 0)); } catch (e) {} indoor = inb ? 1 : 0; }
    if (amount > 0.01 && !indoor) {
      const sn = cur.snow / (cur.rain + cur.snow), cam = G.camera;
      tSec += dt; if (tSec > 600) tSec -= 600;
      U.uT.value = tSec; U.uCam.value.copy(cam.position); U.uSnow.value = sn;
      U.uBox.value.set(36 - 8 * sn, 26 - 10 * sn, 36 - 8 * sn);
      U.uVel.value.set(1.5 - 1.0 * sn, -17 + 15.6 * sn, 0.8 - 0.5 * sn);
      U.uLen.value = 0.6 - 0.52 * sn; U.uMax.value = 64 - 46 * sn;
      const el = G.renderer || (G.renderer = (typeof renderer !== 'undefined' ? renderer : null));
      U.uPx.value = (el ? el.domElement.height : 800) * 0.5 / Math.tan(cam.fov * 0.008726646);
      let cab = false; try { cab = cameraIndex === 2 && Player.mode !== 'foot'; } catch (e) {}
      U.uNear.value = cab ? 2.6 : 0.6;
      const b = 0.22 + 0.78 * dayK + flash;
      U.uCol.value.setRGB((0.74 + 0.26 * sn) * b, (0.8 + 0.2 * sn) * b, (0.88 + 0.12 * sn) * b);
      U.uAlpha.value = 0.42 + 0.48 * sn;
      pts.geometry.setDrawRange(0, Math.max(1, Math.round(maxPts * (sn > 0.5 ? 0.75 * cur.snow : 0.35 + 0.65 * cur.rain) * Math.min(1, amount * 3))));
      pts.visible = true;
    } else pts.visible = false;
    rainProxy.visible = cur.rain > 0.2;
    aT -= dt; if (aT <= 0) { aT = 0.25; let cab = false; try { cab = (cameraIndex === 2 && Player.mode !== 'foot') || !!indoor; } catch (e) {} rainSound(cur.rain, cab); }
    wipers(cur.rain > 0.2);
  }
  // wipers on in the rain while driving the Crysta (only switched back off if we switched them on)
  function wipers(rain) {
    let want = false; try { want = rain && Player.mode === 'crysta' && isPlaying; } catch (e) {}
    if (want === wipeWant) return; wipeWant = want;
    try { if (want && !wipersActive) { wipersActive = true; wipeAuto = true; } else if (!want && wipeAuto) { wipersActive = false; wipeAuto = false; } } catch (e) {}
  }

  // ------------------------------------------------------------------ clock
  const inNight = h => h >= 4.5 && h < 19.5, inDayLock = h => h >= 6.5 && h < 17.5;
  function advance(h, dt) {
    const day = h >= DAY_A && h < DAY_B;
    h = (h + dt * (day ? (DAY_B - DAY_A) / DAY_REAL : (24 - DAY_B + DAY_A) / NIGHT_REAL)) % 24;
    if (timeMode === 'day' && !inDayLock(h)) h = 6.5;                    // loops 06:30 -> 17:30
    else if (timeMode === 'night' && inNight(h)) h = 19.5;                // loops 19:30 -> 04:30
    return h;
  }
  const getH = () => { try { return timeOfDay; } catch (e) { return 12; } };
  const setH = h => { try { timeOfDay = h; } catch (e) {} };
  function setTimeMode(m, quiet) {
    if (m !== 'auto' && m !== 'day' && m !== 'night') return;
    timeMode = m; save(K_T, m);
    if (m === 'day' && !inDayLock(getH())) setH(9); if (m === 'night' && inNight(getH())) setH(21);
    syncUI(); if (!quiet) pop(m === 'auto' ? 'TIME · AUTO CYCLE' : m === 'day' ? 'ALWAYS DAY' : 'ALWAYS NIGHT');
  }
  function jump(name) {
    const p = PICKS.find(q => q[0] === name); if (!p) return;
    if ((timeMode === 'day' && !inDayLock(p[2])) || (timeMode === 'night' && inNight(p[2]))) { timeMode = 'auto'; save(K_T, 'auto'); }
    setH(p[2]); syncUI(); pop('TIME · ' + p[1].toUpperCase());
  }
  function set(w, quiet) {
    if (w !== 'auto' && !PRESET[w]) return;
    choice = w; save(K_W, w);
    if (w === 'auto') autoT = 60 + Math.random() * 120; else active = w;
    if (!first) retarget(); syncUI();
    if (!quiet) pop('WEATHER · ' + (OPTIONS.find(o => o[0] === w)[1]).toUpperCase());
  }
  function cycle() { const i = OPTIONS.findIndex(o => o[0] === choice); set(OPTIONS[(i + 1) % OPTIONS.length][0]); }
  function pop(t) { try { if (window.GAME && GAME.showPopup) GAME.showPopup(t); } catch (e) {} }

  // ------------------------------------------------------------------ Settings rows
  let ui = null;
  function buildUI() {
    const host = document.getElementById('settings'); if (!host || ui) return;
    ui = document.createElement('div'); ui.id = 'wxSet';
    const seg = (id, list, attr, wrap) => `<div class="seg" id="${id}"${wrap ? ' style="flex-wrap:wrap"' : ''}>` + list.map(o => `<button data-${attr}="${o[0]}"${wrap ? ' style="flex:1 0 22%"' : ''}>${o[1]}</button>`).join('') + '</div>';
    ui.innerHTML = '<div class="sf">Time of day <span class="muted" id="wxClock"></span></div>' + seg('wxTime', TIME_MODES.map(o => [o[0], o[1].replace('Always ', 'Always ')]), 't')
      + seg('wxPick', PICKS, 'p') + '<div class="sf">Weather <span class="muted" id="wxNow"></span></div>' + seg('wxSeg', OPTIONS, 'w', true)
      + '<div class="muted">Shift + T cycles the weather. Auto changes on its own, mostly clear.</div>';
    const after = document.getElementById('batterySaver'); const ref = after && after.closest('label');
    if (ref && ref.parentNode === host) host.insertBefore(ui, ref.nextSibling); else host.appendChild(ui);
    ui.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) setTimeMode(b.dataset.t); else if (b.dataset.p) jump(b.dataset.p); else if (b.dataset.w) set(b.dataset.w);
      b.blur();
    });
    syncUI(); setInterval(() => { if (host.classList.contains('open')) syncUI(); }, 1000);
  }
  function syncUI() {
    if (!ui) return;
    ui.querySelectorAll('#wxTime button').forEach(b => b.classList.toggle('on', b.dataset.t === timeMode));
    ui.querySelectorAll('#wxSeg button').forEach(b => b.classList.toggle('on', b.dataset.w === choice));
    const h = getH(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    ui.querySelector('#wxClock').textContent = '· ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    ui.querySelector('#wxNow').textContent = choice === 'auto' ? '· now ' + OPTIONS.find(o => o[0] === active)[1].toLowerCase() : '';
  }

  window.Weather = {
    options: OPTIONS.map(o => ({ id: o[0], name: o[1] })), timeModes: TIME_MODES.map(o => ({ id: o[0], name: o[1] })), picks: PICKS.map(o => ({ id: o[0], name: o[1], hour: o[2] })),
    set, get: () => choice, get active() { return active; }, cycle,
    setTimeMode, getTimeMode: () => timeMode, get timeMode() { return timeMode; }, jump,
    advance, frame, get state() { return cur; }, get particles() { return pts; }, get neutral() { return neutral; },
    dayRealSeconds: DAY_REAL, nightRealSeconds: NIGHT_REAL,
  };
  if (window.GameHooks) {
    GameHooks.init.push(() => { ready(); if (timeMode !== 'auto') setTimeMode(timeMode, true); buildUI(); });
    GameHooks.key.unshift(e => { if (e.code === 'KeyT' && e.shiftKey && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) { cycle(); return true; } return false; });
  }
  if (document.readyState !== 'loading') buildUI(); else addEventListener('DOMContentLoaded', buildUI);
})();
