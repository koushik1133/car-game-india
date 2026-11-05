// sfx.js: procedural (WebAudio, no sample files) game sound effects for Nellutla.
// - 3D traffic engines: a small pool of voices (tiered by Quality.tier) is handed to the nearest traffic vehicles each
//   frame; each voice is a firing-pulse oscillator pair + combustion noise gated at the firing rate, low-passed by
//   load, through a PannerNode (inverse distance, equal-power pan). Every type has its own recipe; bikes are rolled
//   per vehicle into commuter / Bullet (slow 500cc thump) / scooter (CVT whine) / KTM (raspy, high revving).
// - Lorry / bus air-brake hiss when they stop, horns distinct per type (car disc horns, bike buzzers, auto "paa-paa",
//   lorry air horns), tyre skid on hard braking, impact sounds scaled by speed change, bike fall clatter,
//   doors on get in/out, footsteps that depend on the surface, positional dog barks and cow moos.
// Exposes window.SFX and window.HornEvent ({x, z, t, r}: animals.js scatters animals near the latest horn).
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;
  let ctx = null, master = null, nb = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function ok() {
    if (!ctx) { try { ctx = typeof audioCtx !== 'undefined' ? audioCtx : null; } catch (e) { ctx = null; } }
    if (!ctx) return false;
    if (!master) {
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      if (window.GameAudio) { const lv = () => master.gain.setTargetAtTime(0.9 * GameAudio.fxGain, ctx.currentTime, 0.03); master.gain.value = 0.9 * GameAudio.fxGain; GameAudio.listeners.push(lv); }
      nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx.state === 'running';
  }
  const noise = (loop) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = !!loop; return s; };
  // destination at a world position (null x = non-positional, "in the player's head")
  function dest(x, z, vol, ref) {
    const g = ctx.createGain(); g.gain.value = vol;
    if (x == null) { g.connect(master); return g; }
    const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref || 6; p.maxDistance = 300; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = 1; p.positionZ.value = z; } else p.setPosition(x, 1, z);
    g.connect(p); p.connect(master); g._panner = p; return g;
  }
  function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  function burst(out, t0, { type = 'bandpass', f = 1000, q = 1, a = 0.003, peak = 0.5, d = 0.1, f2 }) {
    const s = noise(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    fl.type = type; fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + a + d); fl.Q.value = q;
    env(g, t0, a, peak, d); s.connect(fl); fl.connect(g); g.connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + a + d + 0.05);
  }
  function tone(out, t0, { type = 'sine', f = 100, f2, a = 0.005, peak = 0.5, d = 0.2, lp }) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
    env(g, t0, a, peak, d);
    if (lp) { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp; o.connect(l); l.connect(g); } else o.connect(g);
    g.connect(out); o.start(t0); o.stop(t0 + a + d + 0.05);
  }

  // ------------------------------------------------------------------ horns, distinct per vehicle type
  // [frequencies, waveform, band centre, length s, beeps, attack]
  const HORNS = {
    crysta: [[415, 523], 'sawtooth', 2200, 0.42, 1, 0.01],     // twin disc horns
    hatch: [[460, 560], 'square', 2400, 0.3, 1, 0.008],
    suv: [[370, 465], 'sawtooth', 1900, 0.45, 1, 0.01],
    bike: [[590], 'square', 2600, 0.22, 2, 0.005],             // weak electromagnetic buzzer, two taps
    scooter: [[720], 'square', 2800, 0.18, 2, 0.005],
    bullet: [[440, 470], 'square', 2000, 0.3, 1, 0.006],
    ktm: [[520, 650], 'square', 2600, 0.25, 1, 0.005],
    auto: [[480, 600], 'square', 1800, 0.15, 2, 0.01],          // the classic paa-paa
    tractor: [[310], 'sawtooth', 1400, 0.4, 1, 0.01],
    lorry: [[233, 294, 349], 'sawtooth', 1200, 1.0, 1, 0.08],   // air horn chord
    i4sport: [[510, 640], 'square', 2700, 0.26, 1, 0.005], boxer: [[400, 500], 'sawtooth', 2200, 0.34, 1, 0.008],   // superbike / GS twin horns
    bus: [[262, 330], 'sawtooth', 1300, 0.8, 1, 0.06],
  };
  // Every horn in the game comes through here, and every one but the player's own must come from a real vehicle within
  // HORN_R of the listener: anything further is dropped, and the level fades to nothing at that range. src names the
  // caller, tc (optional) lets the sound travel with the vehicle. SFX.hornLog keeps the last 50 calls for testing.
  const HORN_R = 60, hornLog = [], following = [];
  function horn(kind, x, z, local, src, tc) {
    let d = 0;
    if (!local) { const c = (window.GAME && GAME.camera && GAME.camera.position) || { x, z }; d = Math.hypot(x - c.x, z - c.z); }
    const played = local || d <= HORN_R;
    hornLog.push({ src: src || (local ? 'player' : 'unknown'), kind, d: Math.round(d), played, t: performance.now() }); if (hornLog.length > 50) hornLog.shift();
    if (!played || !ok()) return;
    const H = HORNS[kind] || HORNS.hatch, far = d / HORN_R, out = dest(local ? null : x, z, local ? 0.32 : 0.45 * (1 - far * far), 10);
    if (tc && out._panner) following.push({ p: out._panner, tc, until: ctx.currentTime + H[4] * (H[3] + 0.1) });
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = H[2]; bp.Q.value = 1; bp.gain.value = 8;
    const sh = ctx.createWaveShaper(), c = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 128 - 1; c[i] = Math.tanh(v * 2.5); } sh.curve = c;
    bp.connect(sh); sh.connect(out);
    for (let b = 0; b < H[4]; b++) {
      const t0 = ctx.currentTime + b * (H[3] + 0.08), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35 / H[0].length + 0.1, t0 + H[5]);
      g.gain.setValueAtTime(0.35 / H[0].length + 0.1, t0 + H[3]); g.gain.exponentialRampToValueAtTime(0.0001, t0 + H[3] + 0.05);
      g.connect(bp);
      for (const f of H[0]) {
        const o = ctx.createOscillator(); o.type = H[1]; o.frequency.value = f * rnd(0.995, 1.005);
        if (kind === 'auto') { o.frequency.setValueAtTime(f * 0.9, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.04); }
        o.connect(g); o.start(t0); o.stop(t0 + H[3] + 0.08);
      }
    }
    window.HornEvent = { x, z, t: performance.now(), r: kind === 'lorry' || kind === 'bus' ? 35 : 24 };
  }
  // suspension strike: a dull thud through the floor, scaled by how hard a wheel was hit (m/s)
  let bumpT = 0;
  function bump(v) {
    const now = performance.now(); if (now - bumpT < 160 || !ok()) return; bumpT = now;
    const k = Math.min(1, v / 5), out = dest(null, 0, 0.3 + k * 0.5), t0 = ctx.currentTime;
    tone(out, t0, { f: 74, f2: 38, peak: 0.25 + k * 0.5, d: 0.16 });
    burst(out, t0, { type: 'lowpass', f: 420, peak: 0.12 + k * 0.25, d: 0.09 });
    if (k > 0.6) burst(out, t0 + 0.02, { f: 1500, q: 3, peak: 0.05 * k, d: 0.07 });     // loose bits in the cabin rattle
  }

  // ------------------------------------------------------------------ impacts, skids, falls, doors, footsteps
  function impact(strength, x, z, local) {            // strength 0..1 (from speed lost in the hit)
    if (!ok()) return;
    const s = Math.max(0.05, Math.min(1, strength)), out = dest(local ? null : x, z, 0.4 + s * 0.6, 8), t0 = ctx.currentTime;
    tone(out, t0, { f: 90, f2: 35, peak: 0.6 * s + 0.2, d: 0.25 + s * 0.3 });                       // body thump
    burst(out, t0, { type: 'lowpass', f: 900 + s * 1500, peak: 0.5 * s + 0.15, d: 0.15 + s * 0.2 });  // crunch
    burst(out, t0 + 0.01, { f: 2600, q: 3, peak: 0.25 * s, d: 0.25 + s * 0.4 });                      // sheet metal
    if (s > 0.55) for (let i = 0; i < 8; i++) tone(out, t0 + 0.05 + Math.random() * 0.35, { type: 'triangle', f: rnd(3000, 7000), peak: 0.06, d: rnd(0.05, 0.15) });   // glass
  }
  function bikeFall(x, z, local) {
    if (!ok()) return;
    const out = dest(local ? null : x, z, 0.7, 8), t0 = ctx.currentTime;
    tone(out, t0, { f: 120, f2: 50, peak: 0.6, d: 0.25 });
    burst(out, t0 + 0.05, { type: 'highpass', f: 2500, peak: 0.3, a: 0.02, d: 0.9 });                 // scrape along the road
    for (let i = 0; i < 5; i++) tone(out, t0 + 0.08 + i * rnd(0.08, 0.18), { type: 'square', f: rnd(700, 1600), peak: 0.08, d: 0.06, lp: 3000 });   // clatter of bits
  }
  function door(close, x, z, local) {
    if (!ok()) return;
    const out = dest(local ? null : x, z, 0.5, 4), t0 = ctx.currentTime;
    if (close) { tone(out, t0, { f: 110, f2: 60, peak: 0.5, d: 0.12 }); burst(out, t0, { type: 'lowpass', f: 700, peak: 0.4, d: 0.1 }); burst(out, t0 + 0.005, { f: 3000, q: 4, peak: 0.12, d: 0.03 }); }
    else { burst(out, t0, { f: 2500, q: 5, peak: 0.2, d: 0.03 }); burst(out, t0 + 0.05, { f: 1200, q: 3, peak: 0.1, d: 0.08 }); }
  }
  function kickstand(local) { if (!ok()) return; const out = dest(null, 0, 0.35); tone(out, ctx.currentTime, { type: 'triangle', f: 1400, f2: 1100, peak: 0.2, d: 0.12 }); }
  const HARD = { cc: 1, tar: 1, highway: 1, lane: 1, plinth: 1 };
  function footstep(surface, run, x, z) {
    if (!ok()) return;
    const out = dest(null, 0, run ? 0.32 : 0.22), t0 = ctx.currentTime, hard = HARD[surface];
    if (hard) { tone(out, t0, { f: 140, f2: 70, peak: 0.25, d: 0.05 }); burst(out, t0, { f: 2200, q: 1.5, peak: 0.18, d: 0.04 }); burst(out, t0 + 0.03, { f: 3500, q: 2, peak: 0.06, d: 0.03 }); }   // chappal slap on concrete
    else { for (let i = 0; i < 3; i++) burst(out, t0 + i * 0.012, { f: rnd(500, 1300), q: 0.8, peak: 0.16, d: 0.05 }); tone(out, t0, { f: 90, f2: 50, peak: 0.15, d: 0.06 }); }   // gritty dirt crunch
  }
  function bark(x, z, small) {
    if (!ok()) return;
    const out = dest(x, z, 0.6, 5), n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * rnd(0.22, 0.38), f0 = small ? 560 : 420;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.8, t0); o.frequency.linearRampToValueAtTime(f0, t0 + 0.03); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t0 + 0.14);
      o2.type = 'square'; o2.frequency.setValueAtTime(f0 * 0.5, t0); o2.frequency.exponentialRampToValueAtTime(f0 * 0.3, t0 + 0.14);
      f.type = 'bandpass'; f.frequency.setValueAtTime(1100, t0); f.frequency.linearRampToValueAtTime(700, t0 + 0.14); f.Q.value = 1.6;
      env(g, t0, 0.008, 0.6, 0.13); o.connect(f); o2.connect(f); f.connect(g); g.connect(out);
      burst(out, t0, { f: 1500, q: 1, peak: 0.25, d: 0.08 });
      o.start(t0); o2.start(t0); o.stop(t0 + 0.2); o2.stop(t0 + 0.2);
    }
  }
  function moo(x, z) {
    if (!ok()) return;
    const out = dest(x, z, 0.7, 8), t0 = ctx.currentTime, L = rnd(1.1, 1.8);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    for (const [osc, m] of [[o, 1], [o2, 1.01]]) { osc.frequency.setValueAtTime(110 * m, t0); osc.frequency.linearRampToValueAtTime(150 * m, t0 + L * 0.3); osc.frequency.linearRampToValueAtTime(95 * m, t0 + L); }
    // "mm" -> "ooo" formant sweep
    f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.setValueAtTime(250, t0); f1.frequency.linearRampToValueAtTime(450, t0 + L * 0.35); f1.frequency.linearRampToValueAtTime(320, t0 + L);
    f2.type = 'lowpass'; f2.frequency.value = 1200;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.2); g.gain.setValueAtTime(0.9, t0 + L * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + L);
    o.connect(f1); o2.connect(f1); f1.connect(f2); f2.connect(g); g.connect(out); o.start(t0); o2.start(t0); o.stop(t0 + L + 0.05); o2.stop(t0 + L + 0.05);
  }
  function airBrake(x, z, local) {
    if (!ok()) return;
    const out = dest(local ? null : x, z, 0.6, 8), t0 = ctx.currentTime;
    burst(out, t0, { type: 'highpass', f: 3000, a: 0.01, peak: 0.45, d: 0.9 });
    burst(out, t0, { f: 5000, q: 2, a: 0.01, peak: 0.2, d: 0.5 });
  }

  // continuous skid voice (player)
  let skidG = null, skidBP = null, skidTone = null;
  function skidSet(level) {
    if (!ok()) return;
    if (!skidG) {
      const s = noise(true); skidBP = ctx.createBiquadFilter(); skidBP.type = 'bandpass'; skidBP.frequency.value = 1100; skidBP.Q.value = 4;
      skidG = ctx.createGain(); skidG.gain.value = 0; s.connect(skidBP); skidBP.connect(skidG); skidG.connect(master); s.start();
      skidTone = ctx.createOscillator(); skidTone.type = 'triangle'; skidTone.frequency.value = 950; const tg = ctx.createGain(); tg.gain.value = 0.15; skidTone.connect(tg); tg.connect(skidBP); skidTone.start();
    }
    skidG.gain.setTargetAtTime(Math.min(0.35, level), ctx.currentTime, level > 0 ? 0.03 : 0.1);
    skidTone.frequency.setTargetAtTime(850 + Math.random() * 200, ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ 3D traffic engine voices
  // fire0/fire1: firing pulse Hz at rest / top speed; vs: speed (m/s) for fire1; bright: low-pass Hz; rough: noise share
  const TV = {
    auto: { fire0: 22, fire1: 55, vs: 12, bright: 1500, rough: 0.7, vol: 0.5, w: 'sawtooth' },
    bike: { fire0: 14, fire1: 48, vs: 16, bright: 1200, rough: 0.45, vol: 0.4, w: 'sawtooth' },
    bullet: { fire0: 9, fire1: 24, vs: 16, bright: 450, rough: 0.6, vol: 0.6, w: 'square' },
    scooter: { fire0: 30, fire1: 75, vs: 13, bright: 2200, rough: 0.15, vol: 0.3, w: 'triangle' },
    ktm: { fire0: 18, fire1: 95, vs: 20, bright: 2600, rough: 0.5, vol: 0.5, w: 'sawtooth' },
    i4sport: { vs: 30 }, boxer: { vs: 26 },
    hatch: { fire0: 27, fire1: 90, vs: 20, bright: 1100, rough: 0.2, vol: 0.35, w: 'sawtooth' },
    suv: { fire0: 25, fire1: 75, vs: 22, bright: 800, rough: 0.4, vol: 0.45, w: 'sawtooth' },
    safari: { fire0: 25, fire1: 72, vs: 22, bright: 760, rough: 0.45, vol: 0.45, w: 'sawtooth' }, sumo: { fire0: 23, fire1: 62, vs: 18, bright: 620, rough: 0.6, vol: 0.5, w: 'sawtooth' }, scorpioN: { fire0: 25, fire1: 78, vs: 24, bright: 850, rough: 0.3, vol: 0.4, w: 'sawtooth' },
    tractor: { fire0: 16, fire1: 32, vs: 6, bright: 380, rough: 0.8, vol: 0.75, w: 'square' },
    lorry: { fire0: 30, fire1: 65, vs: 18, bright: 520, rough: 0.6, vol: 0.85, w: 'sawtooth' },
    bus: { fire0: 30, fire1: 65, vs: 18, bright: 560, rough: 0.55, vol: 0.8, w: 'sawtooth' },
    v8: { vs: 30 }, v8flat: { vs: 34 }, v10: { vs: 34 }, flat6: { vs: 32 },
  };
  function sndOf(tc) {      // per-vehicle sound identity, rolled once
    if (!tc._snd) {
      let type = tc.model;
      const sk = tc.snd || (tc.g && tc.g.userData && (tc.g.userData.snd || tc.g.userData.sndKind));
      const ut = tc.g && tc.g.userData && tc.g.userData.type, UT = { activa: 'scooter', starCity: 'bike', splendor: 'bike', scooter: 'scooter', classic: 'bullet', classic2: 'jawa', sport: 'ktm', cycle: 'cycle', mpv: 'innova', fortuner: 'fortuner' };
      if (sk) type = sk;
      else if (ut && UT[ut]) type = UT[ut];
      else if (type === 'bike') { const r = Math.random(); type = r < 0.25 ? 'bullet' : r < 0.32 ? 'bullet500' : r < 0.55 ? 'scooter' : r < 0.64 ? 'ktm' : r < 0.68 ? 'jawa' : 'bike'; }
      tc._snd = { type, pitch: rnd(0.92, 1.08), lastV: 0, stopT: 0 };
    }
    return tc._snd;
  }
  const voices = [];
  // one voice = the engine's exhaust pulse-train oscillator (EngineProfiles PeriodicWave at the cycle rate, so the
  // firing frequency is rpm/60*cyl/2) + noise gated by the same pulses, low-passed, through a panner
  function makeVoice() {
    const o = ctx.createOscillator(), og = ctx.createGain();
    const n = noise(true), nBP = ctx.createBiquadFilter(), nAM = ctx.createGain(), fd = ctx.createGain();
    const lp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createPanner();
    nBP.type = 'bandpass'; nBP.Q.value = 0.8; nAM.gain.value = 0; fd.gain.value = 0;
    lp.type = 'lowpass'; lp.Q.value = 1.2; g.gain.value = 0;
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 5; p.maxDistance = 200; p.rolloffFactor = 1.3;
    o.connect(og); og.connect(lp); o.connect(fd); fd.connect(nAM.gain); n.connect(nBP); nBP.connect(nAM); nAM.connect(lp);
    lp.connect(g); g.connect(p); p.connect(master);
    o.start(); n.start(0, Math.random() * 1.9);
    return { o, og, nBP, nAM, fd, lp, g, p, tc: null, type: null };
  }
  function setPos(p, x, z) { if (p.positionX) { p.positionX.setTargetAtTime(x, ctx.currentTime, 0.03); p.positionY.value = 0.8; p.positionZ.setTargetAtTime(z, ctx.currentTime, 0.03); } else p.setPosition(x, 0.8, z); }
  function voiceCount() { const t = (window.Quality && Quality.tier) || 'high'; return t === 'low' ? 2 : t === 'medium' ? 4 : 6; }
  function updateTraffic(dt, game) {
    const T = (game.traffic || []).concat((window.MP && MP.audioList) || []), cp = game.camera.position;   // other players' engines share the pool
    while (voices.length < voiceCount()) voices.push(makeVoice());
    // nearest vehicles with an engine
    const near = [];
    for (const tc of T) {
      if (!tc.g || tc.model === 'bullockCart' || tc.model === 'cart' || tc.g.visible === false) continue;
      const d = Math.hypot(tc.g.position.x - cp.x, tc.g.position.z - cp.z);
      if (d < 90) near.push([d, tc]);
      // air brakes: lorry / bus coming to a stop
      if (tc.model === 'lorry' || tc.model === 'bus') {
        const S = sndOf(tc), v = Math.abs(tc.cur != null ? tc.cur : tc.speed || 0);
        if (S.lastV > 3 && v < 0.5 && d < 120 && performance.now() - S.stopT > 6000) { S.stopT = performance.now(); airBrake(tc.g.position.x, tc.g.position.z); }
        S.lastV = v;
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    const pick = near.slice(0, voices.length).map(n => n[1]);
    // keep voices on vehicles that are still picked (no clicks), hand the free ones to new vehicles
    for (const v of voices) if (v.tc && !pick.includes(v.tc)) v.tc = null;
    for (const tc of pick) if (!voices.some(v => v.tc === tc)) { const v = voices.find(q => !q.tc); if (v) { v.tc = tc; v.fresh = true; } }
    const now = ctx.currentTime;
    for (const v of voices) {
      if (!v.tc) { v.g.gain.setTargetAtTime(0, now, 0.15); continue; }
      const S = sndOf(v.tc), EP = window.EngineProfiles, name = EP ? EP.resolve(S.type) : null, E = name && EP.P[name], sp = Math.abs(v.tc.cur != null ? v.tc.cur : v.tc.speed || 0);
      if (!E) { v.g.gain.setTargetAtTime(0, now, 0.15); continue; }
      const T = TV[S.type] || TV.hatch, r = Math.min(1, sp / T.vs);
      // a pretend gearbox: rpm sweeps up through 4 gears (two-wheelers 5), CVT scooters hold rpm
      const ng = name === 'scooter' ? 1 : 4, gi = Math.min(ng - 1, Math.floor(r * ng)), gf = r * ng - gi;
      const rpm = (E.idle + (E.red * 0.62 - E.idle) * (name === 'scooter' ? Math.min(1, r * 1.6) : (r < 0.02 ? 0 : 0.3 + 0.7 * gf))) * S.pitch;
      const acc = sp - (v.lastSp || 0); v.lastSp = sp; const load = Math.max(0.2, Math.min(1, 0.5 + acc * 20));
      if (v.type !== name) { const W = EP.waves(ctx, name); v.o.setPeriodicWave(W.load); v.nBP.frequency.value = E.muff * 3; v.type = name; }
      setPos(v.p, v.tc.g.position.x, v.tc.g.position.z); v.fresh = false;
      v.o.frequency.setTargetAtTime(EP.cycleHz(E, rpm), now, 0.08);
      if (E.jitter && Math.random() < 0.15) v.o.detune.setTargetAtTime((Math.random() * 2 - 1) * E.jitter, now, 0.03);
      v.og.gain.value = 0.5;
      v.nAM.gain.value = 0.25 * E.rough; v.fd.gain.value = 0.25 * E.rough;
      v.lp.frequency.setTargetAtTime(E.bright * (0.8 + load * 0.6 + r * 1.5), now, 0.1);
      v.g.gain.setTargetAtTime(E.vol * 1.1 * (0.6 + 0.4 * load) * (window.GameAudio ? GameAudio.engineGain / GameAudio.fxGain : 0.5), now, 0.15);
    }
  }

  // ------------------------------------------------------------------ player-side events
  let lastMode = null, lastSpd = 0, lastPos = null, stepAcc = 0, lastStopV = 0, fallT = 0;
  function playerKind() {
    const P = typeof Player !== 'undefined' ? Player : null; if (!P) return 'crysta';
    if (P.mode === 'crysta') return 'crysta';
    const a = P.active; if (!a) return 'crysta';
    const sk = a.snd || (a.g && a.g.userData && (a.g.userData.snd || a.g.userData.sndKind)); if (sk) return sk;
    if (a.model === 'bike') return (a._snd && a._snd.type) || 'bike';
    return a.model || 'hatch';
  }
  function update(dt, game) {
    if (!ok() || dt <= 0) return;
    const P = typeof Player !== 'undefined' ? Player : null, mode = P ? P.mode : 'crysta', pos = game.carPos;
    const spd = typeof carSpeed === 'number' ? Math.abs(carSpeed) : 0;            // km/h
    const jumped = lastPos && Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) > 6;   // respawn / teleport
    // doors when getting in / out (bikes: just the stand)
    if (lastMode && mode !== lastMode && !jumped) {
      const veh = mode === 'foot' ? lastKindCache : playerKind();
      const two = TWO.test(veh);
      if ((mode === 'foot' && (lastMode === 'crysta' || lastMode === 'vehicle')) || (lastMode === 'foot' && (mode === 'crysta' || mode === 'vehicle'))) {
        if (two) kickstand(); else if (veh !== 'tractor') { door(false, 0, 0, true); setTimeout(() => door(true, 0, 0, true), 550); }
      }
    }
    if (mode !== 'foot') lastKindCache = playerKind();
    // driving: skid on hard braking, impacts on sudden speed loss, air brakes
    if (mode === 'crysta' || mode === 'vehicle') {
      const decel = (lastSpd - spd) / 3.6 / dt;                                     // m/s^2
      const braking = typeof inputState !== 'undefined' && inputState.brake;
      const k = playerKind(), two = TWO.test(k);
      const sus = mode === 'crysta' ? (typeof crystaSusp !== 'undefined' ? crystaSusp : null) : (P.active && P.active.susp && P.active.susp.st);
      if (sus) { if (sus.hit > 1.1 && spd > 6) bump(sus.hit); sus.hit = 0; }
      skidSet(!jumped && braking && spd > 15 && decel > 5 ? Math.min(1, (decel - 5) / 8) * (two ? 0.5 : 1) * Math.min(1, spd / 40) * (mode === 'crysta' ? 0.6 : 1) : 0);
      if (!jumped && decel > 35 && lastSpd > 8) {
        const s = Math.min(1, (lastSpd - spd) / 70);
        impact(s, 0, 0, true);
        if (two && lastSpd > 18 && performance.now() - fallT > 3000) { fallT = performance.now(); setTimeout(() => bikeFall(0, 0, true), 120); }
      }
      if ((k === 'lorry' || k === 'bus') && lastStopV > 12 && spd < 1) airBrake(0, 0, true);
      lastStopV = spd < 1 ? 0 : Math.max(lastStopV * 0.995, spd);
    } else skidSet(0);
    // on foot: footsteps from distance walked
    if (mode === 'foot' && lastPos && !jumped && Math.abs(pos.y - (lastPos.y || 0)) < 0.5) {
      const d = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z), run = spd > 12;
      stepAcc += d;
      const stride = run ? 1.25 : 0.75;
      if (stepAcc > stride) { stepAcc = 0; const surf = game.world && game.world.surfaceAt ? game.world.surfaceAt(pos.x, pos.z) : 'dirt'; footstep(pos.y > 0.3 ? 'plinth' : surf, run); }
    }
    lastMode = mode; lastSpd = spd; lastPos = { x: pos.x, y: pos.y, z: pos.z };
    updateTraffic(dt, game);
    for (let i = following.length - 1; i >= 0; i--) {              // a sounding horn stays with its vehicle
      const f = following[i]; if (ctx.currentTime > f.until || !f.tc.g) following.splice(i, 1); else setPos(f.p, f.tc.g.position.x, f.tc.g.position.z);
    }
  }
  let lastKindCache = 'crysta';

  // the player's horn: replace crysta.js's single recipe with the per-vehicle one
  function playerHorn() {
    try { if (typeof audioCtx === 'undefined' || !audioCtx) initAudio(); } catch (e) {}
    const p = (window.GAME && GAME.carPos) || { x: 0, z: 0 };
    horn(playerKind(), p.x, p.z, true, 'player');
  }
  window.triggerHorn = playerHorn;
  try { triggerHorn = playerHorn; } catch (e) {}

  // ------------------------------------------------------------------ ambient traffic horns: ONLY from a real, visible
  // traffic vehicle within maxD of the listener, spatialised at that vehicle. Returns the vehicle or null (no horn).
  function hornCandidates(cx, cz, maxD) {
    const T = (window.GAME && GAME.traffic) || [], out = [], R = Math.min(maxD || HORN_R, HORN_R), own = typeof Player !== 'undefined' ? Player.active : null;
    for (const tc of T) {
      const g = tc && tc.g; if (!g || !g.visible || g.parent == null) continue;
      if (tc === own || tc.parked || tc.mode === 'respawn' || g.scale.x < 0.9) continue;       // not the car you are in, nor one fading out
      if (/cart|cycle/i.test(tc.model || '') || (tc.g.userData && tc.g.userData.type === 'cycle')) continue;
      const dx = g.position.x - cx, dz = g.position.z - cz, d = Math.hypot(dx, dz); if (d >= R) continue;
      // a building in the way hides the source: a horn you can't place is the phantom this rule exists to prevent
      let clear = true;
      try { for (let k = 1; k < 6 && clear; k++) { const c = GAME.world.collide({ x: cx + dx * k / 6, z: cz + dz * k / 6 }, 0.3); if (c && c.hit) clear = false; } } catch (e) {}
      if (clear) out.push(tc);
    }
    return out;
  }
  function ambientHorn(cx, cz, maxD) {
    const near = hornCandidates(cx, cz, maxD);
    if (!near.length) { hornLog.push({ src: 'ambient', kind: null, d: 0, played: false, t: performance.now() }); if (hornLog.length > 50) hornLog.shift(); return null; }
    const tc = near[Math.floor(Math.random() * near.length)];
    horn(sndOf(tc).type, tc.g.position.x, tc.g.position.z, false, 'ambient', tc);
    return tc;
  }

  // ------------------------------------------------------------------ engine start / stop (called by player.js)
  let muteUntil = 0;
  const TWO = /bike|bullet|scooter|ktm|jawa|splendor|sport|i4sport|boxer/;
  const DIESEL = /safari|sumo|crysta|innova|fortuner|bolero|scorpio|suv|tractor|lorry|bus|truck|mpv/;
  function kindOf(k) { return k || playerKind(); }
  function engineStart(k) {
    k = kindOf(k);
    if (/cycle|cart/.test(k)) return;
    const two = TWO.test(k), dsl = DIESEL.test(k);
    // starter (cars) ~0.5-0.9 s of cranking, self-start (bikes) ~0.35 s, Bullet / 500 sometimes kick-started
    const kick = (k === 'bullet' || k === 'bullet500' || k === 'jawa') && Math.random() < 0.5;
    const crank = two ? (kick ? 0.55 : 0.35) : dsl ? 0.75 + Math.random() * 0.3 : 0.5 + Math.random() * 0.25;
    muteUntil = performance.now() + crank * 1000 + 60;
    if (!ok()) return;
    const out = dest(null, 0, 0.5), t0 = ctx.currentTime + 0.05;
    if (kick) {
      burst(out, t0, { type: 'bandpass', f: 900, q: 2, peak: 0.25, d: 0.08 });          // lever clack
      for (let i = 0; i < 3; i++) tone(out, t0 + 0.1 + i * 0.12, { type: 'sawtooth', f: 60 - i * 6, peak: 0.25, d: 0.08, lp: 400 });
    } else {
      // starter motor whine (geared, rising slightly) + compression chug: the crank slows on each compression stroke
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), am = ctx.createOscillator(), amG = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(two ? 260 : 150, t0); o.frequency.linearRampToValueAtTime(two ? 340 : 210, t0 + crank);
      lp.type = 'lowpass'; lp.frequency.value = two ? 1600 : 1100;
      am.type = 'square'; am.frequency.setValueAtTime(two ? 9 : dsl ? 5.5 : 7, t0); am.frequency.linearRampToValueAtTime(two ? 13 : dsl ? 8 : 10, t0 + crank);
      amG.gain.value = 0.35; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(two ? 0.12 : 0.18, t0 + 0.03);
      g.gain.setValueAtTime(two ? 0.12 : 0.18, t0 + crank - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + crank + 0.08);
      am.connect(amG); amG.connect(g.gain); o.connect(lp); lp.connect(g); g.connect(out);
      o.start(t0); am.start(t0); o.stop(t0 + crank + 0.1); am.stop(t0 + crank + 0.1);
      burst(out, t0, { type: 'highpass', f: 2500, peak: 0.12, d: 0.04 });                // solenoid click
    }
    // catch: a few hard first firings, then the engine voice fades in (EngineSound un-mutes at muteUntil)
    const tc = t0 + crank;
    for (let i = 0; i < 3; i++) tone(out, tc + i * (dsl ? 0.07 : 0.05), { type: 'square', f: dsl ? 55 : two ? 90 : 75, f2: dsl ? 40 : 60, peak: 0.3 - i * 0.07, d: 0.06, lp: dsl ? 500 : 900 });
    if (dsl) burst(out, tc, { type: 'bandpass', f: 3000, q: 2, peak: 0.08, d: 0.4 });   // cold diesel clatter on catch
  }
  function engineOff(k) {
    k = kindOf(k);
    if (/cycle|cart/.test(k) || !ok()) { muteUntil = performance.now() + 400; return; }
    muteUntil = performance.now() + 400;
    const two = TWO.test(k), dsl = DIESEL.test(k), out = dest(null, 0, 0.5), t0 = ctx.currentTime;
    // run-down: a few slowing firings; diesels shudder (big low thump + body rattle)
    const n = dsl ? 5 : 3;
    for (let i = 0; i < n; i++) tone(out, t0 + i * (0.06 + i * 0.03), { type: 'sawtooth', f: (dsl ? 45 : two ? 80 : 60) * (1 - i * 0.1), peak: 0.22 * (1 - i / n), d: 0.08, lp: 450 });
    if (dsl) { tone(out, t0 + 0.35, { type: 'sine', f: 28, f2: 18, peak: 0.35, d: 0.35 }); burst(out, t0 + 0.38, { type: 'bandpass', f: 600, q: 1.5, peak: 0.12, d: 0.25 }); }
    if (!two) burst(out, t0 + 0.6, { type: 'highpass', f: 4000, peak: 0.03, d: 0.15 });      // fan / relay tick
  }

  window.SFX = { hornLog, bump, HORN_R, ambientHorn, hornCandidates, engineStart, engineOff, engineMuted: () => performance.now() < muteUntil, get engineOn() { try { return Player.mode !== 'foot' && performance.now() >= muteUntil; } catch (e) { return true; } }, horn, impact, bikeFall, door, footstep, bark, moo, airBrake, skid: skidSet, playerHorn, voices };
  GameHooks.update.push((dt, game) => { try { update(dt, game); } catch (e) { console.warn('sfx', e); } });
})();
