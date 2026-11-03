// Procedural engine + exhaust audio (WebAudio, no samples).
//
// Model (after the usual physically-informed approach used in procedural engine synths, e.g. Baldan et al.
// "Physically informed car engine sound synthesis", A. Farnell "Designing Sound" ch. on engines):
//  1. Exhaust pulse train. One engine CYCLE (720 deg crank for a 4-stroke, 360 deg for a 2-stroke) is drawn in
//     the time domain: each cylinder adds an asymmetric exhaust-valve pressure pulse (fast rise, exponential decay,
//     small rarefaction undershoot) at its real firing angle, with a fixed per-cylinder amplitude imbalance. That
//     cycle is DFT'd once into a PeriodicWave, so ONE OscillatorNode running at the cycle rate plays the exact pulse
//     train: firing frequency = rpm/60 * cyl/2 (4-stroke) or rpm/60 * cyl (2-stroke). Uneven firing (singles, a
//     3-cyl tractor, a 2-stroke twin) comes out naturally, as do the sub-harmonics of the cycle (the "lope").
//     Two waves per engine: LOAD (sharp, unequal pulses) and OVERRUN (wider, weaker pulses), cross-faded by throttle.
//  2. Exhaust pipe: a feedback comb filter (delay = 2 L / c for header + pipe length L, damped by a low-pass in the
//     loop) gives the pipe resonances; a peaking filter stands in for the muffler/silencer body formant; a soft
//     waveshaper adds the non-linear "bark" under load; a final load- and rpm-dependent low-pass sets brightness.
//  3. Combustion/flow noise amplitude-modulated by the same pulse oscillator (so the hiss "puffs" with each
//     firing), mechanical/diesel clatter (high-passed noise gated by the pulses, bypassing the exhaust), intake
//     roar (throttle), turbo whistle (spools with rpm*load, lags), CVT belt whine (scooters), random cycle-to-cycle
//     jitter (detune) for big singles and tractors, and overrun burble/pops when the throttle is shut at high rpm.
//  4. Tyre/road noise by surface.
// CPU: ~30 nodes for the player voice, waves are built once per profile and cached per AudioContext.
// Traffic voices in sfx.js reuse EngineProfiles (same waves) with 1 oscillator + gated noise each.
// NOTE: written without being able to listen; the maths (firing rates, angles, pipe delays) is right, the mix
// levels are educated guesses.
const EngineProfiles = (function () {
  // stroke: 4 | 2; ang: firing angles as a fraction of one cycle; imb: per-cylinder pulse amplitude;
  // idle/red: rpm; pulseMs: exhaust pulse length at idle; pipe: header+pipe length (m); fb: comb feedback;
  // muff: silencer formant Hz; drive: shaper amount; bright: low-pass Hz at idle; rough: combustion noise;
  // clatter: diesel/mechanical tick; turbo; whine (CVT); jitter: cycle-to-cycle cents; pops: overrun burble.
  const P = {
    innova:   { diesel: 1, stroke: 4, ang: [0, .25, .5, .75], imb: [1, .93, 1.04, .96], idle: 740, red: 4200, pulseMs: 9, pipe: 3.4, fb: .45, muff: 95, drive: 2.8, bright: 640, rough: .4, clatter: .75, turbo: 1.3, vol: .55 },
    fortuner: { diesel: 1, stroke: 4, ang: [0, .25, .5, .75], imb: [1, .9, 1.05, .95], idle: 690, red: 3800, pulseMs: 12, pipe: 3.8, fb: .5, muff: 80, drive: 3.2, bright: 580, rough: .45, clatter: .7, turbo: 1.5, vol: .62 },
    bolero:   { diesel: 1, stroke: 4, ang: [0, 1 / 3, 2 / 3], imb: [1, .9, 1.06], idle: 720, red: 3800, pulseMs: 13, pipe: 3.2, fb: .45, muff: 85, drive: 3.2, bright: 560, rough: .55, clatter: .9, turbo: .8, vol: .58, jitter: 6 },   // 1.5 3-cyl mHawk75
    scorpio:  { diesel: 1, stroke: 4, ang: [0, .25, .5, .75], imb: [1, .92, 1.05, .97], idle: 730, red: 4000, pulseMs: 11, pipe: 3.5, fb: .5, muff: 88, drive: 3.3, bright: 620, rough: .45, clatter: .75, turbo: 1.3, vol: .6 },
    swift:    { stroke: 4, ang: [0, .25, .5, .75], imb: [1, .98, 1.01, .99], idle: 850, red: 6200, pulseMs: 5, pipe: 3.0, fb: .4, muff: 140, drive: 1.5, bright: 1100, rough: .15, clatter: .08, turbo: 0, vol: .45 },
    tractor:  { stroke: 4, ang: [0, 1 / 3, 2 / 3], imb: [1, .82, 1.1], idle: 650, red: 2200, pulseMs: 22, pipe: 1.1, fb: .35, muff: 70, drive: 4, bright: 420, rough: .7, clatter: .8, turbo: 0, vol: .7, jitter: 12 },   // vertical exhaust, short stack
    // sports engines (pops scaled down via popVol so the crackle stays tasteful)
    v8:       { stroke: 4, ang: [0, .115, .25, .385, .5, .61, .75, .87], imb: [1, .82, 1.08, .86, 1.04, .8, 1.1, .84], idle: 700, red: 6800, pulseMs: 6, pipe: 3.0, fb: .55, muff: 85, drive: 3.5, bright: 650, rough: .3, clatter: .1, turbo: 0, vol: .7, jitter: 8, pops: .8, popVol: .45 },   // cross-plane: uneven per-bank pulses -> lumpy burble
    v8flat:   { stroke: 4, ang: [0, .125, .25, .375, .5, .625, .75, .875], imb: [1, .97, 1.02, .98, 1, .96, 1.03, .99], idle: 1000, red: 9000, pulseMs: 3, pipe: 2.4, fb: .45, muff: 240, drive: 4, bright: 1600, rough: .2, clatter: .08, turbo: 0, vol: .62, pops: .7, popVol: .4 },   // flat-plane: even, screaming
    v10:      { stroke: 4, ang: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9], imb: [1, .95, 1.03, .97, 1.02, .96, 1.04, .98, 1.01, .95], idle: 950, red: 8700, pulseMs: 3, pipe: 2.6, fb: .48, muff: 210, drive: 4.2, bright: 1500, rough: .22, clatter: .08, turbo: 0, vol: .65, pops: .9, popVol: .45 },
    flat6:    { stroke: 4, ang: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], imb: [1, .93, 1.04, .95, 1.03, .92], idle: 900, red: 9000, pulseMs: 4, pipe: 2.2, fb: .5, muff: 180, drive: 3.6, bright: 1300, rough: .25, clatter: .15, turbo: 0, vol: .6, pops: .7, popVol: .4 },   // boxer: metallic howl
    lorry:    { stroke: 4, ang: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], imb: [1, .95, 1.03, .97, 1.02, .94], idle: 600, red: 2600, pulseMs: 14, pipe: 4.5, fb: .5, muff: 75, drive: 3.5, bright: 520, rough: .55, clatter: .6, turbo: .9, vol: .75 },
    bus:      { stroke: 4, ang: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], imb: [1, .96, 1.02, .97, 1.03, .95], idle: 620, red: 2600, pulseMs: 13, pipe: 5.5, fb: .5, muff: 80, drive: 3, bright: 560, rough: .5, clatter: .5, turbo: .8, vol: .72 },
    auto:     { stroke: 4, ang: [0], imb: [1], idle: 1150, red: 5200, pulseMs: 10, pipe: 0.9, fb: .35, muff: 160, drive: 4, bright: 1100, rough: .7, clatter: .55, turbo: 0, vol: .5, jitter: 10 },   // RE-style single, rattly
    bullet:   { stroke: 4, ang: [0], imb: [1], idle: 600, red: 5000, pulseMs: 24, pipe: 1.6, fb: .55, muff: 85, drive: 3.5, bright: 420, rough: .45, clatter: .25, turbo: 0, vol: .65, jitter: 14, pops: .5 },   // 350 long-stroke "dug-dug"
    bullet500:{ stroke: 4, ang: [0], imb: [1], idle: 560, red: 4800, pulseMs: 28, pipe: 1.6, fb: .58, muff: 75, drive: 4, bright: 380, rough: .5, clatter: .25, turbo: 0, vol: .7, jitter: 16, pops: .6 },
    splendor: { stroke: 4, ang: [0], imb: [1], idle: 1400, red: 8000, pulseMs: 6, pipe: 1.3, fb: .4, muff: 190, drive: 2, bright: 1300, rough: .35, clatter: .2, turbo: 0, vol: .42, jitter: 5 },   // 100cc putter
    scooter:  { stroke: 4, ang: [0], imb: [1], idle: 1700, red: 8000, pulseMs: 4, pipe: 0.8, fb: .3, muff: 260, drive: 1.2, bright: 1500, rough: .2, clatter: .1, turbo: 0, vol: .32, whine: 1, jitter: 3 },
    ktm:      { stroke: 4, ang: [0], imb: [1], idle: 1500, red: 10500, pulseMs: 5, pipe: 1.1, fb: .5, muff: 200, drive: 5, bright: 2200, rough: .45, clatter: .25, turbo: 0, vol: .55, jitter: 6, pops: 1 },   // 390 single, raspy
    sportbike:{ stroke: 4, ang: [0], imb: [1], idle: 1600, red: 11500, pulseMs: 4, pipe: 1.0, fb: .5, muff: 230, drive: 5, bright: 2600, rough: .4, clatter: .2, turbo: 0, vol: .55, jitter: 5, pops: 1 },
    jawa:     { stroke: 2, ang: [0, .5], imb: [1, .9], idle: 1300, red: 6500, pulseMs: 4, pipe: 1.3, fb: .55, muff: 170, drive: 3, bright: 1500, rough: .5, clatter: .15, turbo: 0, vol: .5, jitter: 6, pops: .7 },   // 2-stroke parallel twin, twin pipes (2nd pipe: +12%)
  };
  const ALIAS = { crysta: 'innova', mpv: 'innova', innova: 'innova', fortuner: 'fortuner', suv: 'bolero', bolero: 'bolero', scorpio: 'scorpio',
    hatch: 'swift', swift: 'swift', car: 'swift', tractor: 'tractor', lorry: 'lorry', truck: 'lorry', bus: 'bus', auto: 'auto',
    bike: 'splendor', splendor: 'splendor', bullet: 'bullet', classic: 'bullet', classic2: 'bullet500', bullet500: 'bullet500',
    scooter: 'scooter', ktm: 'ktm', sport: 'ktm', sportbike: 'sportbike', jawa: 'jawa', v8: 'v8', muscle: 'v8', v8flat: 'v8flat', ferrari: 'v8flat', v10: 'v10', lambo: 'v10', flat6: 'flat6', porsche: 'flat6', cycle: null, bullockCart: null, cart: null, none: null };
  function resolve(k) {
    if (k in ALIAS) return ALIAS[k];
    if (k in P) return k;
    const s = String(k || '').toLowerCase();
    if (/cycle|cart|walk|foot/.test(s)) return null;
    if (/bike|moto|scoot/.test(s)) return 'splendor';
    if (/truck|lorry|tipper/.test(s)) return 'lorry';
    return 'swift';
  }
  const cycleHz = (p, rpm) => rpm / 60 / (p.stroke === 4 ? 2 : 1);
  const firingHz = (p, rpm) => cycleHz(p, rpm) * p.ang.length;
  // one cycle -> PeriodicWave
  function buildWave(ctx, p, coast) {
    const N = 1024, x = new Float32Array(N), H = 256;
    const w = Math.max(0.004, p.pulseMs / 1000 * cycleHz(p, p.idle)) * (coast ? 1.9 : 1);   // pulse width as a fraction of the cycle
    for (let c = 0; c < p.ang.length; c++) {
      const a = (coast ? 0.45 + 0.1 * p.imb[c] : p.imb[c]);
      for (let i = 0; i < N; i++) {
        let u = i / N - p.ang[c]; if (u < 0) u += 1;
        const t = u / w;
        // fast rise / exponential fall (gamma-like), then a broader rarefaction dip
        x[i] += a * (t * t * Math.exp(2 - 2 * t) - 0.28 * Math.exp(-((t - 3.2) * (t - 3.2)) / 2.5));
      }
      if (p.stroke === 2 && p.ang.length === 2 && c === 1) {}   // second pipe handled by the comb's second tap
    }
    const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) {
      let sr = 0, si = 0; const wk = 2 * Math.PI * k / N;
      for (let i = 0; i < N; i++) { sr += x[i] * Math.cos(wk * i); si += x[i] * Math.sin(wk * i); }
      re[k] = sr / N; im[k] = si / N;
    }
    return ctx.createPeriodicWave(re, im);
  }
  const cache = new WeakMap();
  function waves(ctx, name) {
    let m = cache.get(ctx); if (!m) cache.set(ctx, m = {});
    if (!m[name]) m[name] = { load: buildWave(ctx, P[name], false), coast: buildWave(ctx, P[name], true) };
    return m[name];
  }
  // build the remaining waves in idle time so a vehicle switch never stalls a frame
  function prewarm(ctx) {
    const names = Object.keys(P), idle = window.requestIdleCallback || (f => setTimeout(f, 50));
    const step = () => { const n = names.shift(); if (!n) return; waves(ctx, n); idle(step); };
    idle(step);
  }
  return { P, ALIAS, resolve, waves, cycleHz, firingHz, prewarm };
})();
window.EngineProfiles = EngineProfiles;

function EngineSound(ctx) {
  const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
  const ENGINES = EngineProfiles.P;
  try { EngineProfiles.prewarm(ctx); } catch (e) {}
  // --- shared noise
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, Math.random() * 1.9); return s; };
  const shaperCurve = (k) => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; };
  const shaper = ctx.createWaveShaper(); shaper.oversample = 'none';
  const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // --- pulse oscillators (load / overrun) -> pre-gain -> shaper -> exhaust comb -> muffler -> brightness LP
  const oscL = ctx.createOscillator(), oscC = ctx.createOscillator(), gL = gain(0), gC = gain(0), pre = gain(1);
  oscL.connect(gL); oscC.connect(gC); gL.connect(pre); gC.connect(pre); pre.connect(shaper);
  const combIn = gain(1), dly = ctx.createDelay(0.1), dly2 = ctx.createDelay(0.1), fbLP = bq('lowpass', 1800, 0.5), fbG = gain(0.4), tap2 = gain(0);
  shaper.connect(combIn); combIn.connect(dly); dly.connect(fbLP); fbLP.connect(fbG); fbG.connect(dly);
  combIn.connect(dly2); dly2.connect(tap2);                              // second exhaust pipe (twin pipes): slightly longer
  const muff = bq('peaking', 100, 1.2), engLP = bq('lowpass', 800, 0.9), engOut = gain(0);
  muff.gain.value = 9;
  combIn.connect(muff); fbLP.connect(muff); tap2.connect(muff); muff.connect(engLP); engLP.connect(engOut); engOut.connect(out);
  // --- combustion / gas-flow noise puffing with each pulse, through the same pipe
  const nSrc = noise(), nBP = bq('bandpass', 400, 0.7), nAM = gain(0), nDepth = gain(0);
  nSrc.connect(nBP); nBP.connect(nAM); oscL.connect(nDepth); nDepth.connect(nAM.gain); nAM.connect(combIn);
  // --- mechanical / diesel clatter: high-passed noise gated by the pulses (engine bay, not exhaust)
  const cSrc = noise(), cHP = bq('bandpass', 2600, 1.4), cAM = gain(0), cDepth = gain(0), cOut = gain(0);
  cSrc.connect(cHP); cHP.connect(cAM); oscL.connect(cDepth); cDepth.connect(cAM.gain); cAM.connect(cOut); cOut.connect(out);
  // --- intake roar
  const iSrc = noise(), iBP = bq('bandpass', 600, 1.1), iOut = gain(0); iSrc.connect(iBP); iBP.connect(iOut); iOut.connect(out);
  // --- turbo whistle + CVT whine (one oscillator each)
  const turbo = ctx.createOscillator(), turboOut = gain(0); turbo.type = 'sine'; turbo.connect(turboOut); turboOut.connect(out);
  const whine = ctx.createOscillator(), whineOut = gain(0); whine.type = 'triangle'; whine.connect(whineOut); whineOut.connect(out);
  // --- tyre / road noise
  const roadSrc = noise(), roadF = bq('bandpass', 300, 0.7), roadOut = gain(0); roadSrc.connect(roadF); roadF.connect(roadOut); roadOut.connect(out);
  const gravelSrc = noise(), gravelHP = bq('highpass', 1800), gravelAM = gain(0), gravelOut = gain(0);
  const gravelLFO = ctx.createOscillator(); gravelLFO.type = 'square'; gravelLFO.frequency.value = 23; const gDepth = gain(0.6); gravelLFO.connect(gDepth); gDepth.connect(gravelAM.gain);
  gravelSrc.connect(gravelHP); gravelHP.connect(gravelAM); gravelAM.connect(gravelOut); gravelOut.connect(out);
  [oscL, oscC, turbo, whine, gravelLFO].forEach(o => o.start());

  let kind = null, prof = null, lastThrottle = 0, crackleT = 0, shiftDip = 0, smoothedRpm = 800, spool = 0, wasShifting = false, jitT = 0;
  function applyProfile(name) {
    prof = name ? ENGINES[name] : null; kind = name;
    if (!prof) return;
    const W = EngineProfiles.waves(ctx, name);
    oscL.setPeriodicWave(W.load); oscC.setPeriodicWave(W.coast);
    shaper.curve = shaperCurve(prof.drive);
    dly.delayTime.value = 2 * prof.pipe / 343; dly2.delayTime.value = 2 * prof.pipe * 1.12 / 343;
    tap2.gain.value = name === 'jawa' ? 0.8 : 0;
    fbG.gain.value = prof.fb; fbLP.frequency.value = 900 + prof.bright;
    muff.frequency.value = prof.muff;
    nBP.frequency.value = prof.muff * 3;
    smoothedRpm = prof.idle;
  }
  function pop(strength) {
    strength *= (prof && prof.popVol) || 1;   // overrun burble / lift-off crackle out of the exhaust
    const t0 = ctx.currentTime, n = 1 + (Math.random() * 3 * strength | 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.03 + Math.random() * 0.08), s = ctx.createBufferSource(); s.buffer = nb;
      const f = bq('bandpass', 250 + Math.random() * 600, 2.5), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.07);
    }
  }
  function blowoff(s) {   // diesel wastegate / turbo "chuff" on lift (soft: Indian-market diesels have no dump valve)
    const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = nb;
    const f = bq('bandpass', 2400, 1.2), g = ctx.createGain();
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * s, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, Math.random()); n.stop(t + 0.45);
  }
  const set = (p, v, tc) => p.setTargetAtTime(v, ctx.currentTime, tc || 0.04);
  const silence = () => [engOut, cOut, iOut, turboOut, whineOut, gL, gC, nAM].forEach(g => set(g.gain, 0, 0.1));

  return {
    profiles: EngineProfiles,
    setKind(k) {
      // the player's bike keeps the sound identity sfx.js rolled for it in traffic (Bullet / scooter / KTM / commuter)
      try { if (k === 'bike' && typeof Player !== 'undefined' && Player.active && Player.active._snd) k = Player.active._snd.type; } catch (e) {}
      try { const A = Player.active; if (A && Player.mode !== 'crysta') { const sk = A.snd || (A.g && A.g.userData && (A.g.userData.snd || A.g.userData.sndKind)); if (sk) k = sk; } } catch (e) {}
      try { if (Player.active && Player.active.p && Player.active.p.pedal) k = 'cycle'; } catch (e) {}   // pedal cycle: no engine
      const name = EngineProfiles.resolve(k);
      if (name !== kind || (name && !prof)) applyProfile(name);
    },
    // rpm: crank rpm; throttle 0..1; speedKmh; surface: world surface name; shifting: true during a gear change
    update({ rpm, throttle, speedKmh, surface, shifting, on }) {
      // engine voice only while the engine runs: off on foot, and muted while sfx.js plays a crank / shutdown
      let engOn = on;
      try { if (Player.mode === 'foot') engOn = on = false; } catch (e) {}
      if (window.SFX && SFX.engineMuted && SFX.engineMuted()) engOn = false;
      const E = prof, sp = Math.abs(speedKmh || 0); throttle = Math.max(0, Math.min(1, throttle || 0));
      const rough = surface === 'dirt' || surface === 'field' || surface === 'river';
      set(roadOut.gain, on ? Math.min(0.18, sp / 600) * (rough ? 0.6 : 1) : 0, 0.1);
      roadF.frequency.value = 300 + sp * 6;
      set(gravelOut.gain, on && rough ? Math.min(0.22, sp / 300) : 0, 0.1);
      gravelLFO.frequency.value = 12 + sp * 0.6;
      if (!E || !engOn) { set(out.gain, on ? 1 : 0, 0.15); silence(); return; }
      set(out.gain, 1, 0.15);
      if (shifting && !wasShifting) shiftDip = 1;
      wasShifting = shifting; shiftDip *= 0.9;
      // map the caller's rpm range onto this engine (callers fake 800..3500/7500 for non-Crysta vehicles)
      let r = rpm || E.idle; if (r > E.red) r = E.red; if (r < E.idle) r = E.idle;
      r *= 1 - shiftDip * 0.08;
      smoothedRpm += (r - smoothedRpm) * 0.3;
      const rr = (smoothedRpm - E.idle) / (E.red - E.idle);
      const load = Math.min(1, throttle * 0.85 + 0.15 + (rr < 0.05 ? 0.1 : 0));
      const cyc = EngineProfiles.cycleHz(E, smoothedRpm), fire = cyc * E.ang.length;
      // cycle-to-cycle variation: random detune, bigger at idle
      jitT -= 1 / 60;
      if (jitT <= 0 && E.jitter) { jitT = 0.05 + Math.random() * 0.15; const c = (Math.random() * 2 - 1) * E.jitter * (1 - rr * 0.7); oscL.detune.setTargetAtTime(c, ctx.currentTime, 0.03); oscC.detune.setTargetAtTime(c, ctx.currentTime, 0.03); }
      set(oscL.frequency, cyc, 0.025); set(oscC.frequency, cyc, 0.025);
      const lw = 0.25 + 0.75 * load;
      set(gL.gain, lw, 0.06); set(gC.gain, (1 - lw) * 0.9, 0.06);
      set(pre.gain, 0.6 + load * 0.9, 0.05);                          // harder into the shaper under load: bark
      set(engLP.frequency, E.bright * (0.7 + load * 0.9 + rr * 2.2), 0.05);
      set(engOut.gain, E.vol * 0.55 * (0.45 + load * 0.55) * (1 - shiftDip * 0.5), 0.04);
      nBP.frequency.value = E.muff * 3 + rr * 900;
      set(nAM.gain, E.rough * 0.25 * (0.3 + load), 0.05); set(nDepth.gain, E.rough * 0.25 * (0.3 + load), 0.05);
      set(cAM.gain, 0.15, 0.1); set(cDepth.gain, E.diesel ? 0.9 : 0.6, 0.1);
      cHP.frequency.value = E.diesel ? 3200 - rr * 900 : 2600; cHP.Q.value = E.diesel ? 2.2 : 1.4;
      set(cOut.gain, E.vol * E.clatter * (E.diesel ? 0.2 : 0.12) * (1 - rr * (E.diesel ? 0.6 : 0.4)) * (0.6 + load * 0.4), 0.06);
      iBP.frequency.value = 400 + rr * 2000 + fire * 2;
      set(iOut.gain, E.vol * throttle * (0.03 + rr * 0.12), 0.06);
      spool += ((E.turbo ? rr * throttle : 0) - spool) * (throttle > spool ? 0.02 : 0.06);
      set(turbo.frequency, 1800 + spool * 7000, 0.1);
      set(turboOut.gain, (E.turbo || 0) * spool * (E.diesel ? 0.05 : 0.035), 0.1);
      if (E.diesel && lastThrottle > 0.5 && throttle < 0.1 && spool > 0.35 && crackleT <= 0) { blowoff(spool); crackleT = 0.8; }
      set(whine.frequency, 250 + sp * 20, 0.1); set(whineOut.gain, (E.whine || 0) * Math.min(0.05, sp / 900) * (0.4 + throttle), 0.1);
      // overrun: pops (diesels never pop) on a sharp lift at high rpm, light burble while coasting down from revs
      crackleT -= 1 / 60;
      if (crackleT <= 0 && throttle < 0.15 && !E.diesel) {
        if (lastThrottle > 0.6 && rr > 0.5) { pop(0.8 + (E.pops || 0) * 0.4); crackleT = 0.6; }
        else if (E.pops && rr > 0.35 && Math.random() < 0.06 * E.pops) { pop(0.4 * E.pops); crackleT = 0.15; }
      }
      lastThrottle = throttle;
    },
  };
}
