// Layered procedural engine + road audio (WebAudio, no samples).
// Layers: firing-pulse harmonics at the real crank rpm, combustion rumble (noise amplitude-modulated at firing
// frequency), intake roar (throttle-opened band-pass noise), exhaust body (low-passed, distorted),
// turbo whistle, gear-shift dip, lift-off crackle, and tyre/road noise that changes with the surface.
// Each vehicle type has its own engine character (cylinders, idle, redline, tone).
function EngineSound(ctx) {
  const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
  const ENGINES = {
    crysta:  { cyl: 4, idle: 800,  red: 4200, base: 1.0,  rough: 0.35, bright: 900,  turbo: 1,   vol: 0.55, thump: 0.25 },  // 2.4 diesel
    hatch:   { cyl: 4, idle: 850,  red: 6200, base: 1.0,  rough: 0.15, bright: 1600, turbo: 0,   vol: 0.45 },  // petrol
    suv:     { cyl: 4, idle: 750,  red: 4000, base: 0.95, rough: 0.45, bright: 800,  turbo: 0.6, vol: 0.55 },  // mHawk-style diesel
    tractor: { cyl: 3, idle: 650,  red: 2300, base: 0.9,  rough: 0.7,  bright: 520,  turbo: 0,   vol: 0.65, thump: 0.8 },
    lorry:   { cyl: 6, idle: 600,  red: 2800, base: 0.85, rough: 0.55, bright: 600,  turbo: 0.8, vol: 0.7, thump: 0.4 },
    bus:     { cyl: 6, idle: 600,  red: 2800, base: 0.85, rough: 0.5,  bright: 650,  turbo: 0.7, vol: 0.7 },
    auto:    { cyl: 2, idle: 1300, red: 5500, base: 1.0,  rough: 0.65, bright: 1300, turbo: 0,   vol: 0.45, thump: 0.35 },  // 2-stroke-ish putter (fires every rev)  // single-cylinder putter
    bike:    { cyl: 1, idle: 1400, red: 8000, base: 1.0,  rough: 0.4,  bright: 1800, turbo: 0,   vol: 0.45, thump: 0.2 },  // 100-125cc commuter
    bullet:  { cyl: 1, idle: 600,  red: 5000, base: 1.0,  rough: 0.55, bright: 420,  turbo: 0,   vol: 0.6,  thump: 0.9 },  // 350/500cc long-stroke dug-dug
    scooter: { cyl: 1, idle: 1800, red: 8500, base: 1.0,  rough: 0.12, bright: 2600, turbo: 0,   vol: 0.35, thump: 0,   whine: 1 },  // CVT whine
    ktm:     { cyl: 1, idle: 1500, red: 10500, base: 1.0, rough: 0.45, bright: 2800, turbo: 0,   vol: 0.55, thump: 0.3 },  // high-revving single, raspy
    bullockCart: null,
  };
  // --- shared noise
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
  const shaper = (k) => { const w = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } w.curve = c; return w; };

  // --- engine harmonics (firing frequency and multiples), shaped and low-passed
  const engBus = ctx.createGain(), engLP = ctx.createBiquadFilter(), engDist = shaper(4);
  engLP.type = 'lowpass'; engLP.Q.value = 2.5;
  engBus.connect(engDist); engDist.connect(engLP);
  const engOut = ctx.createGain(); engLP.connect(engOut); engOut.connect(out);
  const harm = [[1, 0.55, 'sawtooth'], [0.5, 0.35, 'triangle'], [2, 0.25, 'sawtooth'], [3, 0.1, 'square'], [1.5, 0.12, 'sine']].map(([mul, g, type]) => {
    const o = ctx.createOscillator(); o.type = type; const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(engBus); o.start(); return { o, mul };
  });
  // --- combustion rumble: noise gated at the firing frequency
  const rumbleSrc = noise(), rumbleBP = ctx.createBiquadFilter(), rumbleAM = ctx.createGain(), rumbleOut = ctx.createGain();
  rumbleBP.type = 'bandpass'; rumbleBP.Q.value = 0.8; rumbleAM.gain.value = 0.5;
  const firing = ctx.createOscillator(); firing.type = 'square'; const firingDepth = ctx.createGain(); firingDepth.gain.value = 0.5; firing.connect(firingDepth); firingDepth.connect(rumbleAM.gain); firing.start();
  rumbleSrc.connect(rumbleBP); rumbleBP.connect(rumbleAM); rumbleAM.connect(rumbleOut); rumbleOut.connect(out);
  // --- low-frequency combustion thump (single-cylinder bikes, tractors): the firing square low-passed hard
  const thumpLP = ctx.createBiquadFilter(), thumpOut = ctx.createGain(); thumpLP.type = 'lowpass'; thumpLP.frequency.value = 140; thumpLP.Q.value = 3; thumpOut.gain.value = 0;
  firing.connect(thumpLP); thumpLP.connect(thumpOut); thumpOut.connect(out);
  // --- CVT / belt whine (scooters)
  const whine = ctx.createOscillator(), whineOut = ctx.createGain(); whine.type = 'triangle'; whineOut.gain.value = 0; whine.connect(whineOut); whineOut.connect(out); whine.start();
  // --- intake roar
  const intakeSrc = noise(), intakeBP = ctx.createBiquadFilter(), intakeOut = ctx.createGain();
  intakeBP.type = 'bandpass'; intakeBP.Q.value = 1.2; intakeSrc.connect(intakeBP); intakeBP.connect(intakeOut); intakeOut.connect(out);
  // --- turbo whistle
  const turbo = ctx.createOscillator(), turboOut = ctx.createGain(); turbo.type = 'sine'; turboOut.gain.value = 0; turbo.connect(turboOut); turboOut.connect(out); turbo.start();
  // --- tyre / road noise
  const roadSrc = noise(), roadF = ctx.createBiquadFilter(), roadOut = ctx.createGain();
  roadF.type = 'bandpass'; roadSrc.connect(roadF); roadF.connect(roadOut); roadOut.connect(out);
  const gravelSrc = noise(), gravelHP = ctx.createBiquadFilter(), gravelAM = ctx.createGain(), gravelOut = ctx.createGain();
  gravelHP.type = 'highpass'; gravelHP.frequency.value = 1800; gravelAM.gain.value = 0;
  const gravelLFO = ctx.createOscillator(); gravelLFO.type = 'square'; gravelLFO.frequency.value = 23; const gDepth = ctx.createGain(); gDepth.gain.value = 0.6; gravelLFO.connect(gDepth); gDepth.connect(gravelAM.gain); gravelLFO.start();
  gravelSrc.connect(gravelHP); gravelHP.connect(gravelAM); gravelAM.connect(gravelOut); gravelOut.connect(out);

  let kind = 'crysta', lastRpm = 0, lastThrottle = 0, crackleT = 0, shiftDip = 0, smoothedRpm = 800;
  function crackle() {   // lift-off pops from the exhaust
    const t0 = ctx.currentTime, n = 2 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.04 + Math.random() * 0.07), s = ctx.createBufferSource(); s.buffer = nb;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 300 + Math.random() * 500; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.07);
    }
  }
  const set = (p, v, tc) => p.setTargetAtTime(v, ctx.currentTime, tc || 0.04);

  return {
    setKind(k) {
      // the player's bike keeps the sound identity sfx.js rolled for it in traffic (Bullet / scooter / KTM / commuter)
      try { if (k === 'bike' && typeof Player !== 'undefined' && Player.active && Player.active._snd) k = Player.active._snd.type; } catch (e) {}
      try { if (Player.active && Player.active.p && Player.active.p.pedal) k = 'bullockCart'; } catch (e) {}   // pedal cycle: no engine
      kind = k in ENGINES ? k : 'hatch';
    },
    // rpm: crank rpm; throttle 0..1; speedKmh; surface: world surface name; shifting: true during a gear change
    update({ rpm, throttle, speedKmh, surface, shifting, on }) {
      const E = ENGINES[kind];
      const sp = Math.abs(speedKmh || 0);
      // road noise always (even with no engine, e.g. bullock cart / walking off)
      const rough = surface === 'dirt' || surface === 'field' || surface === 'river';
      set(roadOut.gain, on ? Math.min(0.18, sp / 600) * (rough ? 0.6 : 1) : 0, 0.1);
      roadF.frequency.value = 300 + sp * 6; roadF.Q.value = 0.7;
      set(gravelOut.gain, on && rough ? Math.min(0.22, sp / 300) : 0, 0.1);
      gravelLFO.frequency.value = 12 + sp * 0.6;
      if (!E || !on) { set(out.gain, on ? 1 : 0, 0.15); [engOut, rumbleOut, intakeOut, turboOut, thumpOut, whineOut].forEach(g => set(g.gain, 0, 0.1)); return; }
      set(out.gain, 1, 0.15);
      // engine speed with a little inertia, plus the dip when the box changes gear
      if (shifting && !this._wasShifting) shiftDip = 1;
      this._wasShifting = shifting;
      shiftDip *= 0.9;
      const r = Math.max(E.idle, Math.min(E.red, rpm || E.idle)) * (1 - shiftDip * 0.08);
      smoothedRpm += (r - smoothedRpm) * 0.35;
      const fire = smoothedRpm / 60 * (E.cyl / 2) * E.base;       // firing pulses per second (4-stroke)
      const load = Math.min(1, throttle * 0.8 + 0.2), rr = (smoothedRpm - E.idle) / (E.red - E.idle);
      harm.forEach(h => set(h.o.frequency, Math.max(8, fire * h.mul), 0.03));
      firing.frequency.value = Math.max(4, fire);
      set(engLP.frequency, E.bright * (0.6 + throttle * 1.2 + rr * 1.5), 0.05);
      set(engOut.gain, E.vol * (0.18 + load * 0.35) * (1 - shiftDip * 0.5), 0.04);
      rumbleBP.frequency.value = 80 + rr * 220;
      set(rumbleOut.gain, E.vol * E.rough * (0.25 + load * 0.45), 0.05);
      intakeBP.frequency.value = 500 + rr * 2200;
      set(intakeOut.gain, E.vol * throttle * (0.05 + rr * 0.18), 0.06);
      set(turbo.frequency, 2500 + rr * 6000, 0.15);
      set(turboOut.gain, E.turbo * throttle * rr * 0.03, 0.2);
      set(thumpOut.gain, E.vol * (E.thump || 0) * (0.4 + load * 0.5) * (1 - rr * 0.5), 0.05);
      set(whine.frequency, 300 + sp * 22, 0.1); set(whineOut.gain, (E.whine || 0) * Math.min(0.05, sp / 900) * (0.4 + throttle), 0.1);
      // lift-off crackle at high revs
      crackleT -= 1 / 60;
      if (lastThrottle > 0.6 && throttle < 0.2 && rr > 0.55 && crackleT <= 0) { crackle(); crackleT = 0.8; }
      lastThrottle = throttle; lastRpm = r;
    },
  };
}
