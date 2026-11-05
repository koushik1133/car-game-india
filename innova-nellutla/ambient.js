// Procedural 3D village ambience (WebAudio, no sound files).
// Day: birds, crows, cattle, temple bells, horns from real nearby traffic. Night: crickets, dogs, frogs near water.
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
  function crow(x, y, z) {           // house crow "kaa kaa": hoarse, nasal, falling; a saw through two formants with a rough flutter
    const out = at(x, y, z, 0.4), k = 2 + Math.floor(Math.random() * 3), b = 480 + Math.random() * 120;
    for (let i = 0; i < k; i++) {
      const t0 = ctx.currentTime + i * (0.36 + Math.random() * 0.1), d = 0.2 + Math.random() * 0.1, o = ctx.createOscillator(), rough = ctx.createOscillator(), rg = ctx.createGain(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(b * 1.2, t0); o.frequency.linearRampToValueAtTime(b * 0.82, t0 + d);
      rough.frequency.value = 75; rg.gain.value = 70; rough.connect(rg); rg.connect(o.frequency);
      for (const [fq, q] of [[1050, 5], [2300, 7]]) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q; o.connect(f); f.connect(g); }
      env(g, t0, 0.015, 1.1, d); g.connect(out); o.start(t0); rough.start(t0); o.stop(t0 + d + 0.05); rough.stop(t0 + d + 0.05);
    }
  }
  function sparrow(x, y, z) {        // house sparrow: dry repeated "chirrup" notes with a quick drop
    const out = at(x, y, z, 0.2), n = 3 + Math.floor(Math.random() * 6), b = 3400 + Math.random() * 900;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * (0.14 + Math.random() * 0.1), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(b * 1.22, t0); o.frequency.exponentialRampToValueAtTime(b * 0.8, t0 + 0.05); o.frequency.exponentialRampToValueAtTime(b, t0 + 0.09);
      env(g, t0, 0.006, 0.6, 0.085); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.12);
    }
  }
  function parrot(x, y, z) {         // rose-ringed parakeet: loud rising "kee-ak" screeches, fast and grating
    const out = at(x, y, z, 0.3), n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * (0.2 + Math.random() * 0.1), b = 2000 + Math.random() * 500, o = ctx.createOscillator(), fm = ctx.createOscillator(), fg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(b, t0); o.frequency.linearRampToValueAtTime(b * 1.5, t0 + 0.09); o.frequency.linearRampToValueAtTime(b * 1.15, t0 + 0.16);
      fm.frequency.value = 260; fg.gain.value = 420; fm.connect(fg); fg.connect(o.frequency); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 1.6;
      env(g, t0, 0.01, 0.6, 0.15); o.connect(f); f.connect(g); g.connect(out); o.start(t0); fm.start(t0); o.stop(t0 + 0.19); fm.stop(t0 + 0.19);
    }
  }
  function pigeon(x, y, z) {         // rock pigeon: soft throaty "gu-ru-goo", low and round
    const out = at(x, y, z, 0.3), syl = [[0, 0.16, 430], [0.2, 0.14, 500], [0.4, 0.46, 470]];
    for (const [o0, d, b] of syl) {
      const t0 = ctx.currentTime + o0, o = ctx.createOscillator(), am = ctx.createOscillator(), ag = ctx.createGain(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(b * 0.92, t0); o.frequency.linearRampToValueAtTime(b, t0 + d * 0.4); o.frequency.linearRampToValueAtTime(b * 0.86, t0 + d);
      am.frequency.value = 34; ag.gain.value = 0.22; am.connect(ag); ag.connect(g.gain);
      env(g, t0, 0.03, 0.55, d); o.connect(g); g.connect(out); o.start(t0); am.start(t0); o.stop(t0 + d + 0.06); am.stop(t0 + d + 0.06);
    }
  }
  function flutter(x, y, z) {        // a flock lifting off: a burst of wing beats
    const t0 = ctx.currentTime, out = at(x, y, z, 0.5), s = noise(), f = ctx.createBiquadFilter(), am = ctx.createOscillator(), ag = ctx.createGain(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.7; am.type = 'square'; am.frequency.value = 17; ag.gain.value = 0.3; am.connect(ag); ag.connect(g.gain);
    env(g, t0, 0.03, 0.55, 0.9); s.connect(f); f.connect(g); g.connect(out); s.start(t0); am.start(t0); s.stop(t0 + 1); am.stop(t0 + 1);
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
  function frog(x, y, z) {
    const out = at(x, y, z, 0.3), t0 = ctx.currentTime, o = ctx.createOscillator(), am = ctx.createOscillator(), amG = ctx.createGain(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 180 + Math.random() * 60; am.frequency.value = 40; amG.gain.value = 0.5;
    am.connect(amG); amG.connect(g.gain); env(g, t0, 0.02, 0.5, 0.25); o.connect(g); g.connect(out);
    o.start(t0); am.start(t0); o.stop(t0 + 0.3); am.stop(t0 + 0.3);
  }

  // ---------------- farm animals (positional, tied to the animals in animals.js: window.VillageAnimals.all)
  function rooster(x, y, z, vol) {   // "ko-ko-ro-koooo": 4 syllables, strained harmonic voice, last one long and falling
    const out = at(x, y, z, vol || 0.45), t0 = ctx.currentTime, syl = [[0, 0.12, 620, 700], [0.16, 0.12, 700, 780], [0.32, 0.14, 760, 900], [0.5, 0.75, 900, 640]];
    for (const [o0, d, f1, f2] of syl) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = t0 + o0;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f1, t); o.frequency.linearRampToValueAtTime(f2 * 1.04, t + d * 0.3); o.frequency.linearRampToValueAtTime(f2, t + d);
      o2.type = 'square'; o2.frequency.setValueAtTime(f1 * 1.5, t); o2.frequency.linearRampToValueAtTime(f2 * 1.5, t + d);
      f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.4;
      env(g, t, 0.02, 0.6, d); o.connect(f); o2.connect(f); f.connect(g); g.connect(out);
      [o, o2].forEach(n => { n.start(t); n.stop(t + d + 0.05); });
    }
  }
  function cluck(x, y, z) {          // hen: sharp "buk-buk-buk" with a noisy attack, sometimes climbing into "bu-KAAAK"
    const out = at(x, y, z, 0.32), k = 3 + Math.floor(Math.random() * 4), long = Math.random() < 0.3;
    for (let i = 0; i < k; i++) {
      const t = ctx.currentTime + i * (0.13 + Math.random() * 0.07), last = long && i === k - 1, d = last ? 0.42 : 0.055, b = 640 + Math.random() * 130;
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(last ? b : b * 1.15, t); o.frequency.linearRampToValueAtTime(last ? b * 1.75 : b * 0.72, t + (last ? d * 0.45 : d)); if (last) o.frequency.linearRampToValueAtTime(b * 1.3, t + d);
      f.type = 'bandpass'; f.frequency.value = 1250; f.Q.value = 4; f2.type = 'bandpass'; f2.frequency.value = 2700; f2.Q.value = 6;
      env(g, t, 0.004, 0.75, d); o.connect(f); o.connect(f2); f.connect(g); f2.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    }
  }
  function cattleMoo(x, y, z, buffalo) {   // buffalo: lower, shorter, rougher grunt-moo
    const t0 = ctx.currentTime, out = at(x, y, z, buffalo ? 0.55 : 0.5), o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    const b = buffalo ? 78 : 125 + Math.random() * 25, d = buffalo ? 0.9 : 1.4 + Math.random() * 0.6;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(b * 0.9, t0); o.frequency.linearRampToValueAtTime(b * 1.25, t0 + d * 0.3); o.frequency.linearRampToValueAtTime(b * 0.85, t0 + d);
    o2.type = 'sawtooth'; o2.frequency.setValueAtTime(b * 0.905, t0); o2.frequency.linearRampToValueAtTime(b * 1.26, t0 + d * 0.3); o2.frequency.linearRampToValueAtTime(b * 0.86, t0 + d);
    f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t0); f.frequency.linearRampToValueAtTime(buffalo ? 600 : 950, t0 + d * 0.35); f.frequency.linearRampToValueAtTime(300, t0 + d);
    env(g, t0, 0.15, 0.7, d); o.connect(f); o2.connect(f); f.connect(g); g.connect(out);
    [o, o2].forEach(n => { n.start(t0); n.stop(t0 + d + 0.3); });
  }
  function cowBell(x, y, z) {        // small brass neck bell: 2-4 dull clonks (inharmonic partials, short)
    const out = at(x, y, z, 0.18), k = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < k; i++) {
      const t = ctx.currentTime + i * (0.25 + Math.random() * 0.2);
      for (const [m, a] of [[1, 1], [2.3, 0.5], [3.9, 0.3]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880 * m;
        env(g, t, 0.003, a * 0.35, 0.25 / m); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
      }
    }
  }
  function bleat(x, y, z) {          // goat "me-e-e-eh": strained, voice-like, a slow shake of the whole note through vowel formants
    const t0 = ctx.currentTime, out = at(x, y, z, 0.42), o = ctx.createOscillator(), o2 = ctx.createOscillator(), trem = ctx.createOscillator(), tg = ctx.createGain(), vib = ctx.createGain(), mix = ctx.createGain(), g = ctx.createGain();
    const b = 230 + Math.random() * 140, d = 0.7 + Math.random() * 0.5;
    o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.setValueAtTime(b, t0); o.frequency.linearRampToValueAtTime(b * 1.12, t0 + d * 0.2); o.frequency.linearRampToValueAtTime(b * 0.9, t0 + d); o2.frequency.setValueAtTime(b * 1.008, t0); o2.frequency.linearRampToValueAtTime(b * 0.905, t0 + d);
    trem.frequency.value = 6 + Math.random() * 3; tg.gain.value = 0.4; vib.gain.value = b * 0.05; trem.connect(tg); tg.connect(mix.gain); trem.connect(vib); vib.connect(o.frequency); vib.connect(o2.frequency); mix.gain.value = 0.65;
    for (const [fq, q] of [[720, 6], [1750, 8], [2900, 7]]) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q; o.connect(f); o2.connect(f); f.connect(mix); }
    env(g, t0, 0.06, 1.2, d); mix.connect(g); g.connect(out);
    [o, o2, trem].forEach(n => { n.start(t0); n.stop(t0 + d + 0.15); });
  }
  function loudspeaker(x, y, z) {    // distant temple loudspeaker at dawn: a faint, band-limited devotional melody line
    const out = at(x, y, z, 0.12), notes = [0, 2, 4, 5, 4, 2, 0, -1, 0], base = 330, bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.9; bp.connect(out);
    let t = ctx.currentTime;
    for (const n of notes) {
      const d = 0.35 + Math.random() * 0.35, o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = base * Math.pow(2, n / 12); vib.frequency.value = 5.5; vg.gain.value = 4; vib.connect(vg); vg.connect(o.frequency);
      env(g, t, 0.06, 0.4, d); o.connect(g); g.connect(bp); [o, vib].forEach(q => { q.start(t); q.stop(t + d + 0.1); }); t += d * 0.9;
    }
  }
  const nearestOf = (p, test, maxD) => {
    const A = window.VillageAnimals && VillageAnimals.all; if (!A) return [];
    const r = [];
    for (const a of A) if (a && test(a) && Math.hypot(a.x - p.x, a.z - p.z) < maxD) r.push(a);
    return r;
  };
  const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rooster0 = { x: 0, z: 0 };
  function villageAnimals(p, hour, night, dawn, due) {
    const crowHour = hour >= 5 && hour < 7;
    // roosters: lots at 5-7 am, the odd one later in the day; from a real rooster when one is near, else a distant one
    if ((crowHour && due('rooster', 6, 16)) || (!night && !crowHour && due('roosterDay', 60, 180))) {
      const R = nearestOf(p, a => a.kind === 'hen' && a.rooster, 150);
      if (R.length) { const a = pickOne(R); rooster(a.x, 1, a.z); }
      else if (crowHour) { const q = around(p, 220); rooster(q[0], 3, q[2], 0.3); }
    }
    if (!night && due('cluck', 2, 6)) { const H = nearestOf(p, a => a.kind === 'hen' && !a.rooster, 35); if (H.length) { const a = pickOne(H); cluck(a.x, 0.3, a.z); } }
    if (!night && due('moo', 10, 28)) { const C = nearestOf(p, a => a.kind === 'cow' || a.kind === 'bull' || a.kind === 'buffalo', 90); if (C.length) { const a = pickOne(C); cattleMoo(a.x, 1.4, a.z, a.kind === 'buffalo'); } }
    if (due('cowbell', 3, 9)) { const C = nearestOf(p, a => (a.kind === 'cow' || a.kind === 'bull') && a.state !== 'lie', 30); if (C.length) { const a = pickOne(C); cowBell(a.x, 1, a.z); } }
    if (!night && due('bleat', 6, 18)) { const G = nearestOf(p, a => a.kind === 'goat', 60); if (G.length) { const a = pickOne(G); bleat(a.x, 0.7, a.z); } }
    if (hour > 5 && hour < 6.6 && due('speaker', 40, 90)) {
      const tp = temples.map(tl => [Math.hypot(tl.x - p.x, tl.z - p.z), tl]).sort((a, b) => a[0] - b[0])[0];
      if (tp && tp[0] < 900) loudspeaker(tp[1].x, 8, tp[1].z);
    }
  }

  // ---------------- scheduler
  const temples = world.landmarks.filter(l => l.k === 'temple');
  const lakes = (window.NELLUTLA_MAP.lakes || []).map(lk => [lk.reduce((s, p) => s + p[0], 0) / lk.length, lk.reduce((s, p) => s + p[1], 0) / lk.length]);
  const next = { sparrow: 3, parrot: 9, pigeon: 11, koel: 6, bird: 1, crow: 4, moo: 12, bark: 8, bell: 5, horn: 6, frog: 3, rooster: 2, roosterDay: 90, cluck: 3, cowbell: 4, bleat: 8, speaker: 10 };
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
    cricketG.gain.setTargetAtTime(night ? 0.025 : dusk ? 0.01 : 0, ctx.currentTime, 2);
    windG.gain.setTargetAtTime(0.03 + Math.min(0.12, Math.abs(carSpeed) / 900), ctx.currentTime, 0.5);
    windF.frequency.setTargetAtTime(380 + Math.abs(carSpeed) * 6, ctx.currentTime, 0.5);

    const due = (k, min, max) => { if ((next[k] -= dt) > 0) return false; next[k] = min + Math.random() * (max - min); return true; };
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
    rustleG.gain.setTargetAtTime((inVillage ? 0.012 : 0.03) * gust, ctx.currentTime, 0.8);
    cicadaG.gain.setTargetAtTime(hour > 10.5 && hour < 16.5 && !inVillage ? 0.006 : 0, ctx.currentTime, 3);
    if ((dawn || (hour > 8 && hour < 11)) && due('koel', 8, 20)) koel(...around(p, 80));
    if (!night && due('bird', dawn ? 0.4 : 1.2, dawn ? 1.5 : 4)) bird(...around(p, 60));
    // each species calls from its real flock when one is near (village-life.js), mostly mornings and evenings; else a far-off one
    const VB = window.VillageBirds, flock = (id, R) => VB ? VB.near(id, p.x, p.z, R) : null, busy = dawn || dusk;
    if (!night && due('crow', hour < 10 ? 3 : 7, hour < 10 ? 9 : 18)) { const f = flock('crow', 120); f ? crow(f.x, f.y, f.z) : crow(...around(p, 90)); }
    if (!night && due('sparrow', busy ? 2 : 5, busy ? 6 : 14)) { const f = flock('sparrow', 70); f ? sparrow(f.x, f.y + 1, f.z) : (inVillage && sparrow(...around(p, 40))); }
    if (!night && due('parrot', busy ? 7 : 16, busy ? 16 : 40)) { const f = flock('parrot', 200); if (f) parrot(f.x, f.y, f.z); }
    if (!night && hour > 6 && hour < 17 && due('pigeon', 7, 20)) { const f = flock('pigeon', 80); if (f) pigeon(f.x, f.y + 1, f.z); }
    if (VB && VB.events.length) for (const e of VB.events.splice(0)) { flutter(e.x, e.y, e.z); if (e.kind === 'crow') crow(e.x, e.y + 3, e.z); else if (e.kind === 'parrot') parrot(e.x, e.y + 3, e.z); }
    if (due('bark', night ? 5 : 18, night ? 16 : 45)) { const D = nearestOf(p, a => a.kind === 'dog', 120); if (D.length) { const a = pickOne(D); bark(a.x, 0.5, a.z); } else bark(...around(p, inVillage ? 60 : 160).map((v, i) => i === 1 ? 0.5 : v)); }
    // temple bells at prayer times, louder when close
    if ((dawn || dusk || Math.random() < 0.2) && due('bell', dawn || dusk ? 3 : 10, dawn || dusk ? 7 : 25)) {
      const tp = temples.map(tl => [Math.hypot(tl.x - p.x, tl.z - p.z), tl]).sort((a, b) => a[0] - b[0])[0];
      if (tp && tp[0] < 300) bell(tp[1].x, 4, tp[1].z);
    }
    // ambient horns ONLY from a real traffic vehicle in plain reach within 60 m (sfx.js picks and spatialises it); none otherwise
    if (!night && due('horn', 14, 32) && window.SFX && SFX.ambientHorn) SFX.ambientHorn(p.x, p.z, 60);
    villageAnimals(p, hour, night, dawn, due);
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
