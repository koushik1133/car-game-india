// visitors.js: life at Safe House 2 (safehouse2.js). Grandma (ammamma) sits on a chair on the porch or takes a slow
// walk round the front courtyard; every few minutes a villager walks in through the pedestrian gate, greets her, they
// chat (face each other, nods, hand gestures, speech bubbles, spoken lines via voice.js) and the villager walks back out.
// Talking: grandma greets the player on foot when they come near (time-of-day lines, the vehicle they came in), T or
// the TALK button talks to whoever is closest (grandma or a friend), she says 'jagratha ga vellu' when they leave.
// Optional (default OFF): friends come to the PLAYER wherever he is: they drive along the nearest road, park on a free
// off-road spot beside it near him, get out and walk with him; if he outruns them they catch up the same way.
// (never on a road, never in front of a gate or another parked vehicle), drive in slowly, park aligned with the lane,
// walk in through the pedestrian gate and hang out in the courtyard, greeting / teasing the player.
// Toggle: window.Visitors.setFriends(true/false) or the checkbox this file adds to the Settings panel.
// Crowd (window.Crowd): every walker here steers round other people, walls, vehicles and furniture (separation +
// probe-ahead detours + wall sliding with world.collide) and never overlaps anyone; player.js asks Crowd.pushPlayer so
// the player bumps into people (nudging movable ones aside) instead of walking through them. Villagers on the map
// (world.people) and procession walkers wait for whoever stands in their way.
// Needs HumanModel (people-models.js) and window.SafeHouse2 (set in its init hook).
(function () {
  'use strict';
  let G = null, world = null, scene = null, SH = null, root = null, ready = false;
  const LS_KEY = 'nellutla.friends';
  let friendsOn = false;
  try { friendsOn = localStorage.getItem(LS_KEY) === '1'; } catch (e) {}

  // ---------------------------------------------------------------- house-local spots (a along the lane, b into the plot)
  const CHAIR = { a: -7.75, b: 0.55 };               // on the porch, facing the gate
  const TALK = { a: -8.25, b: -1.05 };               // where a visitor stands to talk to her (on the porch step)
  let GATE_OUT = { a: -9.4, b: -6.0 }, GATE_IN = { a: -9.4, b: -3.3 }, GATE_MID = { a: -9.4, b: -4.3 };  // set from SafeHouse2.pedGate
  const STROLL = [{ a: -7.6, b: -1.7 }, { a: -5.6, b: -1.4 }, { a: -3.6, b: -0.9 }, { a: -2.6, b: 0.6 }, { a: -4.6, b: -0.2 }, { a: -6.9, b: -1.6 }];
  const HANG = [{ a: -11.2, b: -2.6 }, { a: -12.3, b: -2.2 }];   // west courtyard, clear of the car lane and the main gate's swing
  const LANE_B = -6.9;
  const lanePt = (a) => ({ a, b: LANE_B });

  const CONVOS = [['v1_', 'vgvgvgv'], ['v2_', 'vgvgv'], ['v3_', 'vgvgv']];

  // ---------------------------------------------------------------- helpers
  const W = (p) => SH.W(p.a, p.b);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  const faceAngle = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  function turnTo(obj, ang, dt, rate) {
    const d = wrapA(ang - obj.rotation.y);
    obj.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * (rate || 3));
    return Math.abs(d);
  }
  function groundY(p) {            // porch plinth / step heights (house-local)
    const l = SH.L(p.x, p.z);
    if (l.a > -9.4 && l.a < -6.8 && l.b > -0.6 && l.b < 3.0) return 0.97;     // yard 0.85 + porch 0.12
    if (l.a > -9.0 && l.a < -7.2 && l.b > -1.25 && l.b <= -0.6) return 0.91;
    try { return typeof window.groundY === 'function' ? window.groundY(p.x, p.z) || 0 : 0; } catch (e) { return 0; }
  }
  const hour = () => { try { return typeof timeOfDay === 'number' ? timeOfDay : 12; } catch (e) { return 12; } };
  const trafficList = () => { try { return typeof traffic !== 'undefined' ? traffic : []; } catch (e) { return []; } };
  const PL = () => { try { return typeof Player !== 'undefined' ? Player : null; } catch (e) { return null; } };

  // ---------------------------------------------------------------- speech bubble: Telugu script + romanised line
  function bubble() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(1.9, 0.594, 1); s.renderOrder = 999; s.visible = false;
    s.userData = { c, t, life: 0, text: '' };
    return s;
  }
  function drawBubble(b, top, sub) {
    const u = b.userData, key = top + '|' + sub; if (u.text === key) return;
    const x = u.c.getContext('2d'), W2 = 512, H2 = 160;
    x.clearRect(0, 0, W2, H2);
    const fTop = s => `600 ${s}px "Kohinoor Telugu", "Telugu Sangam MN", "Noto Sans Telugu", system-ui, sans-serif`, fSub = s => `500 ${s}px system-ui, sans-serif`;
    let ft = 30, fs = 21;
    x.font = fTop(ft); while (x.measureText(top).width > W2 - 50 && ft > 15) { ft -= 2; x.font = fTop(ft); }
    const wt = x.measureText(top).width;
    let ws = 0; if (sub) { x.font = fSub(fs); while (x.measureText(sub).width > W2 - 50 && fs > 12) { fs -= 1; x.font = fSub(fs); } ws = x.measureText(sub).width; }
    const tw = Math.min(W2 - 20, Math.max(wt, ws) + 40), x0 = (W2 - tw) / 2, bh = sub ? 104 : 76;
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.strokeStyle = 'rgba(40,30,20,0.55)'; x.lineWidth = 3;
    x.beginPath(); if (x.roundRect) x.roundRect(x0, 8, tw, bh, 22); else x.rect(x0, 8, tw, bh); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(W2 / 2 - 14, 7 + bh); x.lineTo(W2 / 2, 36 + bh); x.lineTo(W2 / 2 + 14, 7 + bh); x.closePath(); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#2a1d12'; x.font = fTop(ft); x.fillText(top, W2 / 2, sub ? 44 : 46);
    if (sub) { x.fillStyle = '#6b5a48'; x.font = fSub(fs); x.fillText(sub, W2 / 2, 86); }
    u.t.needsUpdate = true; u.text = key;
  }
  function showBubble(who, top, sub, secs) { drawBubble(who.bubble, top, sub); who.bubble.userData.life = secs || 3.2; who.bubble.visible = true; }
  function tickBubble(p, dt) { const u = p.bubble.userData; if (u.life > 0 && (u.life -= dt) <= 0) p.bubble.visible = false; }
  // speak a line (voice.js) with the bubble synced: shown when the voice starts, hidden after it ends
  function speak(p, id, done, prio) {
    const V = window.Voice, line = V && V.LINES[id];
    if (!line) { if (done) setTimeout(done, 1500); return; }
    p.talking = true;
    V.say(p.voiceKey, id, {
      pos: () => p.g.position, prio,
      onStart: () => showBubble(p, line.te, line.tr, 60),
      onEnd: () => { p.talking = false; p.bubble.userData.life = 0.6; if (done) done(); },
    });
  }
  const isSpeaking = p => !!(p.talking && window.Voice && (Voice.speaking(p.voiceKey) || p.bubble.visible));

  // ---------------------------------------------------------------- mouth / jaw while speaking
  // HumanModel has no jaw joint: find the lower lip (small sphere on the head's centre line, lowest of the two) and add a
  // dark mouth slit behind the lips; both move with Voice.level().
  function rigMouth(p) {
    const head = p.h.parts && p.h.parts.head; if (!head) return;
    if (p.h.parts.jaw) {            // sculpted body (sculpt-people.js): real jaw joint; dark cavity behind the lips
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 5), new THREE.MeshBasicMaterial({ color: 0x2a0f0c }));
      m.scale.set(1.1, 0.05, 0.5); m.position.set(0, 0.053, 0.084); m.visible = false; head.add(m);
      p.mouth = { jaw: p.h.parts.jaw, slit: m, ymid: 0.053 }; return;
    }
    const lips = [];
    head.children.forEach(o => { const g = o.geometry; if (o.isMesh && g && g.parameters && Math.abs(o.position.x) < 1e-3 && (g.parameters.radius === 0.018 || g.parameters.radius === 0.02) && g.type === 'SphereGeometry') lips.push(o); });
    let lo = null, y, z;
    if (lips.length >= 2) {
      lips.sort((a, b) => a.position.y - b.position.y); lo = lips[0];
      y = (lips[0].position.y + lips[1].position.y) / 2; z = Math.min(lips[0].position.z, lips[1].position.z) - 0.004;
    } else {
      // merged head (one skin mesh): find the face's front surface at mouth height on the centre line
      const skin = head.children.find(o => o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position.count > 1000);
      if (!skin) return;
      const P = skin.geometry.attributes.position; let y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < P.count; i++) { const yy = P.getY(i); if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      y = y0 + (y1 - y0) * 0.24; z = -1e9;
      for (let i = 0; i < P.count; i++) if (Math.abs(P.getX(i)) < 0.012 && Math.abs(P.getY(i) - y) < 0.012) z = Math.max(z, P.getZ(i));
      if (z < -1e8) return;
      y += skin.position.y; z += skin.position.z - 0.003;
    }
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 5), new THREE.MeshBasicMaterial({ color: 0x2a0f0c }));
    m.scale.set(1, 0.05, 0.35); m.position.set(0, y, z);
    m.visible = false; head.add(m);
    p.mouth = { lo, y0: lo ? lo.position.y : 0, slit: m, ymid: y };
  }
  function animMouth(p, dt) {
    const J = p.h.parts && p.h.parts.jaw;
    if (J) {                                   // sculpt-people.js jaw joint: chin + lower lip hinge open
      const lv = window.Voice && p.voiceKey ? Voice.level(p.voiceKey) : 0;
      p.jaw = (p.jaw || 0) + (lv - (p.jaw || 0)) * Math.min(1, dt * 22);
      J.rotation.x = p.jaw * 0.28;
      if (p.mouth) p.mouth.slit.visible = false;
      return;
    }
    if (!p.mouth) return;
    const lv = window.Voice && p.voiceKey ? Voice.level(p.voiceKey) : 0;
    p.jaw = (p.jaw || 0) + (lv - (p.jaw || 0)) * Math.min(1, dt * 18);
    if (p.mouth.jaw) p.mouth.jaw.rotation.x = p.jaw * 0.22;
    const mi = p.h.sculpt && p.h.sculpt.mesh.morphTargetInfluences;      // lip shapes: open / round / wide cycling with the syllables
    if (mi) { p.lipT = (p.lipT || 0) + dt * 9; const sy = Math.sin(p.lipT), sy2 = Math.sin(p.lipT * 0.61 + 1.3);
      mi[0] = p.jaw; mi[1] = p.jaw * Math.max(0, sy) * 0.9; mi[2] = p.jaw * Math.max(0, sy2) * 0.8; }
    if (p.mouth.lo) p.mouth.lo.position.y = p.mouth.y0 - p.jaw * 0.011;
    p.mouth.slit.visible = p.jaw > 0.04;
    p.mouth.slit.scale.y = 0.05 + p.jaw * 0.7; p.mouth.slit.position.y = p.mouth.ymid - p.jaw * 0.005;
    // a little jaw drop: the chin follows (the whole head tilts back a hair while the mouth opens)
    if (p.h.parts.head) p.h.parts.head.rotation.x -= p.jaw * 0.05;
  }

  // ================================================================ Crowd: avoidance for everyone on foot
  const Crowd = window.Crowd = {
    agents: [],                     // our walkers: { g, r, state, ... }
    statics: [],                    // furniture discs { x, z, r, owner }
    add(p) { if (!this.agents.includes(p)) this.agents.push(p); },
    del(p) { const i = this.agents.indexOf(p); if (i >= 0) this.agents.splice(i, 1); },
    // people and solid things within R of (x, z): [{ x, z, r, d, kind, ref }]
    near(x, z, R, self, withVehicles) {
      const out = [];
      const add = (px, pz, r, kind, ref) => { const dx = px - x, dz = pz - z; if (Math.abs(dx) > R + r || Math.abs(dz) > R + r) return; const d = Math.hypot(dx, dz); if (d < R + r) out.push({ x: px, z: pz, r, d, kind, ref }); };
      for (const a of this.agents) if (a !== self && a.g.parent) add(a.g.position.x, a.g.position.z, a.state === 'sit' ? 0.42 : a.r, 'agent', a);
      for (const s of this.statics) if (!(self && s.owner === self)) add(s.x, s.z, s.r, 'static', s);
      if (self && G && G.playerMode === 'foot' && G.carPos) add(G.carPos.x, G.carPos.z, 0.4, 'player', null);
      try { if (world && world.people) for (const v of world.people) if (v.x !== 0) add(v.x, v.z, 0.26, 'villager', v); } catch (e) {}
      try { if (window.VillageProcessions) for (const it of VillageProcessions.items) if (it.kind === 'walker' && it.g) add(it.g.position.x, it.g.position.z, 0.3, 'walker', it); } catch (e) {}
      try { if (window.AutoRides && AutoRides.npcs) for (const n of AutoRides.npcs) { const g = n.g || (n.h && n.h.group); if (g && g.parent === scene) add(g.position.x, g.position.z, 0.3, 'static', n); } } catch (e) {}
      if (withVehicles) eachVehicleDisc(x, z, R + 3, (px, pz, r, v) => add(px, pz, r, 'vehicle', v));
      return out;
    },
    // player.js: push the walker's point p (radius r) out of everyone; movable walkers of ours give way a little
    pushPlayer(p, r) {
      for (const o of this.near(p.x, p.z, r + 0.5, null, false)) {
        const min = r + o.r; if (o.d >= min) continue;
        const nx = o.d > 1e-3 ? (p.x - o.x) / o.d : 1, nz = o.d > 1e-3 ? (p.z - o.z) / o.d : 0, ov = min - o.d;
        if (o.kind === 'agent' && o.ref.state !== 'sit') {
          const a = o.ref.g.position, k = 0.35;
          const q = { x: a.x - nx * ov * k, z: a.z - nz * ov * k }; if (world.collide) world.collide(q, o.ref.r); a.x = q.x; a.z = q.z;
          o.ref.bumped = 0.6;
          p.x += nx * ov * (1 - k); p.z += nz * ov * (1 - k);
        } else { p.x += nx * ov; p.z += nz * ov; }
      }
    },
  };
  // vehicles as rows of discs along their long axis (moving traffic, parked ones, the friends' car)
  function eachVehicleDisc(x, z, R, cb) {
    const one = (v) => {
      const g = v && v.g; if (!g || !g.parent) return;
      const px = g.position.x, pz = g.position.z; if (Math.abs(px - x) > R + 4 || Math.abs(pz - z) > R + 4) return;
      const hw = v.hw || (v.model === 'bike' ? 0.36 : 0.9), half = (v.len2 || (v.len && v.len < 20 ? v.len / 2 : 0) || (v.model === 'bike' ? 1.05 : 2.1));
      const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y), n = Math.max(1, Math.ceil(half * 2 / (hw * 1.4)));
      for (let i = 0; i <= n; i++) { const t = -half + hw * 0.7 + (half * 2 - hw * 1.4) * i / n; cb(px + fx * t, pz + fz * t, hw, v); }
    };
    for (const v of trafficList()) one(v);
    const P = PL(); if (P) { try { for (const v of P.parkedList || []) one(v); } catch (e) {} if (P.active && G && G.playerMode !== 'foot') one(P.active); }
    if (fr && fr.car) one({ g: fr.car.g, hw: 0.95, len2: (fr.car.len || 3.9) / 2 });
  }

  // a person: HumanModel + bubble + steering state
  function person(ap, speed, voiceKey) {
    const h = HumanModel.create(ap);
    const p = { h, g: h.group, bubble: bubble(), speed: speed || 1.2, r: 0.27, phase: Math.random() * 6, t: Math.random() * 10, path: null, pi: 0, state: 'idle', talk: 0, nod: 0, gest: 0, voiceKey, stuck: 0 };
    p.g.add(p.bubble); p.bubble.position.y = 1.9 * h.scale / 0.95 + 0.25;
    scene.add(p.g);                                   // top-level, so lod.js handles each figure on its own
    try { rigMouth(p); } catch (e) {}
    Crowd.add(p);
    return p;
  }
  function remove(p) { if (p && p.g.parent) p.g.parent.remove(p.g); if (p) Crowd.del(p); }

  // free to stand at (x, z)? (no wall, no person / vehicle disc overlapping)
  const probe = { x: 0, z: 0 };
  function freeAt(x, z, p, nb) {
    probe.x = x; probe.z = z;
    if (world.collide && world.collide(probe, p.r).hit) return false;
    for (const o of nb) if (Math.hypot(o.x - x, o.z - z) < p.r + o.r + 0.05) return false;
    return true;
  }
  // steer toward a world point: arrive -> true. Separation from neighbours, slow down / queue behind someone right
  // ahead (one at a time through the gate), probe ahead and detour round walls / cars, slide along walls, never overlap.
  const tmp = { x: 0, z: 0 };
  function steerTo(p, tgt, dt, arriveR, speedMul) {
    const pos = p.g.position;
    let dx = tgt.x - pos.x, dz = tgt.z - pos.z; const d = Math.hypot(dx, dz);
    if (d < (arriveR || 0.2)) return true;
    dx /= d; dz /= d;
    const nb = Crowd.near(pos.x, pos.z, 2.2, p, true);
    let sx = 0, sz = 0, slow = 1;
    for (const o of nb) {
      const ox = pos.x - o.x, oz = pos.z - o.z, od = Math.max(0.01, Math.hypot(ox, oz)), clear = od - (p.r + o.r);
      if (clear < 0.7) { const w = (0.7 - Math.max(0, clear)) / 0.7 * (o.kind === 'vehicle' ? 1.2 : 0.9); sx += ox / od * w; sz += oz / od * w; }
      const ahead = (-ox * dx - oz * dz) / od;
      if (ahead > 0.55 && clear < 0.6 && o.kind !== 'vehicle') slow = Math.min(slow, Math.max(o.kind === 'agent' && o.ref.path && o.ref.pi < (o.ref.path.length || 0) ? 0.25 : 0.0, clear / 0.6));
    }
    // a little sideways bias on head-on encounters so two walkers pass on their left instead of dancing
    const hx = dx + sx - dz * Math.min(0.4, Math.hypot(sx, sz) * 0.5), hz = dz + sz + dx * Math.min(0.4, Math.hypot(sx, sz) * 0.5);
    const base = Math.atan2(hx, hz), look = Math.min(0.75, d);
    let ang = base, found = false;
    for (const o of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.45, -1.45, 1.9, -1.9]) {
      const a = base + o;
      if (freeAt(pos.x + Math.sin(a) * look, pos.z + Math.cos(a) * look, p, nb) && freeAt(pos.x + Math.sin(a) * look * 0.5, pos.z + Math.cos(a) * look * 0.5, p, nb)) { ang = a; found = true; break; }
    }
    if (!found) slow = 0;
    turnTo(p.g, ang, dt, 6);
    const v = Math.min(d / Math.max(dt, 1e-3), p.speed * (speedMul || 1) * slow * (p.bumped > 0 ? 0.4 : 1));
    tmp.x = pos.x + Math.sin(ang) * v * dt; tmp.z = pos.z + Math.cos(ang) * v * dt;
    if (world.collide) world.collide(tmp, p.r);              // slide along walls / piers / parked cars
    // hard non-overlap with people / vehicles: push our walker out
    for (const o of nb) { const ox = tmp.x - o.x, oz = tmp.z - o.z, od = Math.hypot(ox, oz), min = p.r + o.r; if (od < min && od > 1e-4) { tmp.x = o.x + ox / od * min; tmp.z = o.z + oz / od * min; } }
    if (world.collide) world.collide(tmp, p.r);
    const moved = Math.hypot(tmp.x - pos.x, tmp.z - pos.z);
    pos.x = tmp.x; pos.z = tmp.z; pos.y += (groundY(pos) - pos.y) * Math.min(1, dt * 8);
    p.stuck = moved < p.speed * dt * 0.15 ? p.stuck + dt : Math.max(0, p.stuck - dt * 2);
    const vs = moved / Math.max(dt, 1e-3);
    if (vs > 0.05) { p.phase += dt * vs * 4.2; HumanModel.animateWalk(p.h.parts, p.phase, vs); }
    else { p.t += dt; HumanModel.animateIdle(p.h.parts, p.t); }
    return false;
  }
  // walk along p.path (house-local waypoints); returns true when the end is reached
  function stepPath(p, dt) {
    if (p.bumped > 0) p.bumped -= dt;
    if (!p.path || p.pi >= p.path.length) return true;
    const last = p.pi === p.path.length - 1, tgt = W(p.path[p.pi]);
    if (steerTo(p, tgt, dt, last ? 0.25 : 0.4)) { p.pi++; p.prog = null; return p.pi >= p.path.length; }
    // no progress toward the waypoint for a while (someone standing on it, a shrub): the next one / close enough
    const d = dist(tgt, p.g.position);
    if (!p.prog || p.prog.i !== p.pi || d < p.prog.d - 0.1) p.prog = { i: p.pi, d, t: 0 };
    else if ((p.prog.t += dt) > (last ? (d < 1.2 ? 1.5 : 7) : 3.5)) { p.pi++; p.prog = null; return p.pi >= p.path.length; }
    return false;
  }
  function go(p, pts) { p.path = pts; p.pi = 0; p.stuck = 0; p.prog = null; }
  // standing still at a spot: drift back if someone pushed us off it
  function holdSpot(p, spot, dt) { const w = W(spot); if (dist(w, p.g.position) > 0.6) steerTo(p, w, dt, 0.25, 0.6); }

  // villagers on map paths (world.people) and procession walkers don't steer: they wait while somebody (the player or
  // one of ours) stands right in front of them, and turn back if it lasts
  // Villagers on map paths (world.people) and procession walkers follow fixed paths, so they sidestep instead of
  // steering: when the player, one of ours or another villager is in their lane ahead, they ease sideways (villagers
  // via p.dodge, read by nellutla-world.js as an extra lateral offset; walkers via their lateral slot it.lat) to the
  // side away from it, slow down while passing, and only stop / turn back when it is right on top of them.
  function sidestepPathWalkers(dt) {
    const pc = G && G.carPos; if (!pc) return;
    const obst = [];
    if (G.playerMode === 'foot') obst.push({ x: pc.x, z: pc.z, r: 0.4 });
    for (const a of Crowd.agents) if (a.g.parent) obst.push({ x: a.g.position.x, z: a.g.position.z, r: a.r });
    const near = [];
    try { if (world.people) for (const v of world.people) if (v.x !== 0 && Math.abs(v.x - pc.x) < 40 && Math.abs(v.z - pc.z) < 40) near.push(v); } catch (e) {}
    const walkers = [];
    try { if (window.VillageProcessions) for (const it of VillageProcessions.items) if (it.kind === 'walker' && it.g && Math.abs(it.g.position.x - pc.x) < 40 && Math.abs(it.g.position.z - pc.z) < 40) walkers.push(it); } catch (e) {}
    // look ahead along (fx, fz) with lateral axis (lx, lz): nearest thing in the corridor -> { ahead, lat }
    const scan = (x, z, fx, fz, lx, lz, self, list) => {
      let best = null;
      for (const o of list) {
        if (o === self) continue;
        const dx = o.x - x, dz = o.z - z, ah = dx * fx + dz * fz; if (ah < -0.2 || ah > 2.6) continue;
        const la = dx * lx + dz * lz; if (Math.abs(la) > 1.0) continue;
        if (!best || ah < best.ah) best = { ah, la };
      }
      return best;
    };
    const others = obst.concat(near.map(v => ({ x: v.x, z: v.z, r: 0.26, ref: v })), walkers.map(w => ({ x: w.g.position.x, z: w.g.position.z, r: 0.3, ref: w })));
    for (const v of near) {
      if (v.idle) continue;
      const fx = Math.sin(v.rot), fz = Math.cos(v.rot), h = v.dir > 0 ? v.rot : v.rot - Math.PI;
      const ox = Math.cos(h) * v.side, oz = -Math.sin(h) * v.side;              // +dodge moves this way (outward)
      const b = scan(v.x, v.z, fx, fz, ox, oz, null, others.filter(o => o.ref !== v));
      const want = b ? (b.la > 0 ? -1 : 1) * Math.min(1.0, 1.1 - Math.abs(b.la) * 0.3) : 0;
      v.dodge = (v.dodge || 0) + (want - (v.dodge || 0)) * Math.min(1, dt * 2.5);
      if (b && b.ah < 0.55 && Math.abs(b.la) < 0.5) { v.s -= v.dir * v.speed * dt; v._wait = (v._wait || 0) + dt; if (v._wait > 4) { v.dir = -v.dir; v._wait = 0; } }
      else if (b && b.ah < 1.4) { v.s -= v.dir * v.speed * dt * 0.5; v._wait = Math.max(0, (v._wait || 0) - dt); }   // slow while squeezing past
      else v._wait = Math.max(0, (v._wait || 0) - dt);
    }
    for (const it of walkers) {
      const y = it.g.rotation.y, fx = Math.sin(y), fz = Math.cos(y), lx = -fz, lz = fx;  // +lat axis (animals.js pathAt)
      if (it._lat0 === undefined) it._lat0 = it.lat;
      const b = scan(it.g.position.x, it.g.position.z, fx, fz, lx, lz, null, others.filter(o => o.ref !== it));
      const want = it._lat0 + (b ? (b.la > 0 ? -1 : 1) * 1.6 : 0);
      it.lat += (want - it.lat) * Math.min(1, dt * 2);
      if (b && b.ah < 0.6 && Math.abs(b.la) < 0.5) it.s -= it.dir * it.speed * dt;
    }
  }

  // talking gestures layered on top of the idle pose
  function talkPose(p, dt, speaking) {
    p.t += dt; HumanModel.animateIdle(p.h.parts, p.t);
    const P = p.h.parts;
    p.nod += dt * (speaking ? 7 : 3.5);
    P.head.rotation.x += Math.sin(p.nod) * (speaking ? 0.09 : 0.04);
    if (speaking) {
      P.head.rotation.y += Math.sin(p.nod * 0.37) * 0.08;      // the Telugu side-to-side head wobble
      p.gest += dt * 3.2;
      P.armR.rotation.x -= 0.45 + Math.sin(p.gest) * 0.18; P.armR.rotation.z -= 0.12;
      P.foreR.rotation.x = -1.05 - Math.sin(p.gest * 1.3) * 0.3;
      if (Math.sin(p.gest * 0.5) > 0.3) { P.armL.rotation.x -= 0.3; P.foreL.rotation.x = -0.8; }
    }
  }
  function namaste(p) {
    const P = p.h.parts;
    P.armL.rotation.set(-0.35, 0, -0.35); P.armR.rotation.set(-0.35, 0, 0.35);
    P.foreL.rotation.set(-1.75, 0.6, 0); P.foreR.rotation.set(-1.75, -0.6, 0);
    P.head.rotation.x += 0.15;
  }

  // ---------------------------------------------------------------- furniture
  function chair() {
    const g = new THREE.Group(), wood = new THREE.MeshPhongMaterial({ color: 0x7a4a26, shininess: 20, specular: 0x222222 });
    const weave = new THREE.MeshPhongMaterial({ color: 0xc9a36a, shininess: 4 });
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || wood); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.37, 0.05, sx * 0.23, 0.185, sz * 0.21);
    box(0.52, 0.04, 0.48, 0, 0.38, 0, weave);
    for (const sx of [-1, 1]) box(0.05, 0.52, 0.05, sx * 0.23, 0.64, -0.21);
    box(0.5, 0.28, 0.03, 0, 0.72, -0.22, weave);
    for (const sx of [-1, 1]) { box(0.05, 0.03, 0.46, sx * 0.25, 0.6, 0); box(0.04, 0.2, 0.04, sx * 0.25, 0.5, 0.2); }
    return g;
  }

  // ---------------------------------------------------------------- what the player is up to (for grandma's lines)
  const ctx = { lastRide: null, rideT: -1e9, now: 0, inYard: false, wasNear: false, byeDone: true, greeted: false, talkI: 0, prevMode: null };
  // recent events the people react to: a crash (sudden big speed loss while driving), the horn, arriving at night
  function trackEvents(dt) {
    const mode = G.playerMode, sp = Math.abs(typeof carSpeed === 'number' ? carSpeed : 0);
    if ((mode === 'vehicle' || mode === 'crysta') && ctx.prevSpeed !== undefined && ctx.prevSpeed - sp > 22 && dt < 0.2) {
      ctx.crashT = ctx.now;
      if (fr && fr.state === 'hang' && fr.crew[0] && dist(G.carPos, fr.crew[0].g.position) < 15) speak(fr.crew[0], 'fr_crash');
    }
    ctx.prevSpeed = sp;
    if ((mode === 'vehicle' || mode === 'crysta') && sp > 70 && gm && dist(G.carPos, gm.g.position) < 60) ctx.fastT = ctx.now;
    if ((mode === 'vehicle' || mode === 'crysta') && (hour() >= 21 || hour() < 5)) ctx.nightDriveT = ctx.now;
  }
  function onHorn() {
    ctx.hornT = ctx.now;
    if (!ready || !G) return;
    if (gm && dist(G.carPos, gm.g.position) < 12 && !gm.talking && (ctx.hornCd || 0) < ctx.now) { ctx.hornCd = ctx.now + 25; gmSay(nx('horn', 'gm_horn')); }
    else if (fr && fr.state === 'hang' && fr.crew[1] && dist(G.carPos, fr.crew[1].g.position) < 12 && !fr.crew[1].talking && (ctx.hornCd || 0) < ctx.now) { ctx.hornCd = ctx.now + 25; speak(fr.crew[1], 'fr_horn'); }
  }
  const recent = (t, s) => t !== undefined && ctx.now - t < s;
  const missionText = () => { const el = document.querySelector('#mission .d') || document.getElementById('mission'); return el ? el.textContent || '' : ''; };

  function trackPlayer(dt) {
    ctx.now += dt;
    trackEvents(dt);
    const mode = G.playerMode, P = PL();
    if (mode !== ctx.prevMode) {
      if ((ctx.prevMode === 'vehicle' || ctx.prevMode === 'crysta') && mode === 'foot') {
        const a = P && P.active; ctx.lastRide = ctx.prevMode === 'crysta' ? 'innova' : a && (a.model === 'bike' || a.model === 'scooter') ? 'bike' : a && /tractor/i.test(a.model + ' ' + (a.type || '')) ? 'tractor' : 'car'; ctx.rideT = ctx.now;
      }
      // got into a vehicle near the house: grandma sees them off
      if (ctx.prevMode === 'foot' && (mode === 'vehicle' || mode === 'crysta') && gm && dist(G.carPos, gm.g.position) < 14 && !ctx.byeDone) { ctx.byeDone = true; gmSay(byeLine(), true); friendBye(); }
      ctx.prevMode = mode;
    }
    const l = SH.L(G.carPos.x, G.carPos.z), y = SH.yard || { a0: -19.5, a1: -1.1, b0: -4.3, b1: 14 };
    const inYard = l.a > y.a0 && l.a < y.a1 && l.b > y.b0 && l.b < y.b1;
    // walked out of the gate after spending time inside
    if (ctx.inYard && !inYard && mode === 'foot' && !ctx.byeDone) { ctx.byeDone = true; gmSay(byeLine(), true); friendBye(); }
    if (inYard && !ctx.inYard) { ctx.byeDone = false; ctx.greeted = false; }
    ctx.inYard = inYard;
  }
  // Every line comes from a Voice pool, so nothing repeats until its pool is used up (memory survives reloads).
  const nx = (k, fb) => (window.Voice && Voice.next(k)) || fb;
  const nowH = () => hour();
  function dayPool() { const h = nowH(); return h >= 21 || h < 4.5 ? 'night' : h < 6.5 ? 'dawn' : h < 11 ? 'morn' : h < 15.5 ? 'noon' : h < 18 ? 'aftn' : 'eve'; }
  function seasonPool() { const m = new Date().getMonth(); return m >= 5 && m <= 8 ? 'rain' : m >= 2 && m <= 4 ? 'summer' : 'cold'; }
  function byeLine() { const h = nowH(); return nx(h >= 20 || h < 5 ? 'bye_n' : 'bye_d', 'gm_bye'); }
  function greetLine() {
    // back after hours away (real time, kept across sessions): she says so first, once
    if (!ctx.awayDone) {
      ctx.awayDone = true; let last = 0;
      try { last = +localStorage.getItem('nellutla.gm.seen') || 0; localStorage.setItem('nellutla.gm.seen', Date.now()); } catch (e) {}
      if (last && Date.now() - last > 6 * 3600e3) return nx('away', 'gm_hello');
    }
    return nx(dayPool(), 'gm_hello');
  }
  function rideLine() {
    if (recent(ctx.crashT, 120)) return nx('crash', 'gm_crash');
    if (recent(ctx.fastT, 40)) return nx('speed', 'gm_car');
    if (recent(ctx.nightDriveT, 90) && ctx.now - ctx.rideT < 90) return nx('bye_n', 'gm_nightdrive');
    if (ctx.now - ctx.rideT < 90) return nx({ bike: 'bike', tractor: 'tractor', innova: 'innova' }[ctx.lastRide] || 'car', 'gm_car');
    return nx('walk', 'gm_walk');
  }
  function timeLine() { return nx(Math.random() < 0.3 ? seasonPool() : dayPool(), 'gm_bless'); }
  // replies when the player talks to her (T): context first, then the general ones
  function gmReplyList() {
    const L = [greetLine(), rideLine(), nx('general', 'gm_sit')];
    if (fr && fr.state === 'hang') L.push('gm_friends');
    return L;
  }

  // ---------------------------------------------------------------- grandma
  let gm = null, chairObj = null, gmTimer = 60, greetCd = 0, gmQueue = [];
  function gmSay(id, prio) { if (!gm) return; if (gm.talking) { if (gmQueue.length < 2) gmQueue.push(id); return; } speak(gm, id, () => { const n = gmQueue.shift(); if (n) setTimeout(() => gmSay(n), 400); }, prio); }
  function seatGrandma() {
    const c = W(CHAIR), ang = Math.atan2(-(SH.W(0, 1).x - SH.W(0, 0).x), -(SH.W(0, 1).z - SH.W(0, 0).z));
    gm.g.position.set(c.x, 0.97, c.z); gm.g.rotation.y = ang;
    sitOnChair(gm);
  }
  // chair seat at 0.40 (+ porch 0.12): thighs level on the seat, shins down to the floor, saree draped over the knees
  function sitOnChair(p) {
    const P = p.h.parts, s = p.h.scale;
    HumanModel.sit(P, 'bench');
    const knee = 0.5 * s;                                // shin + ankle + sole
    p.g.position.y = 0.97 + Math.max(0.42, knee) - 0.89 * s;
    P.legL.rotation.set(-1.5, 0, 0.06); P.legR.rotation.set(-1.5, 0, -0.06);
    P.shinL.rotation.x = P.shinR.rotation.x = 1.5;
    P.torso.rotation.x = 0.1; P.armL.rotation.set(-0.5, 0, 0.1); P.armR.rotation.set(-0.5, 0, -0.1); P.foreL.rotation.x = P.foreR.rotation.x = -0.75;
    if (P.skirt) { P.skirt.rotation.set(-0.8, 0, 0); P.skirt.scale.set(1.2, 0.72, 2.0); }
  }
  function updateGrandma(dt, player) {
    const p = gm; if (!p) return;
    greetCd -= dt;
    tickBubble(p, dt); animMouth(p, dt);
    const dP = player ? dist(player, p.g.position) : 1e9;
    const nearPlayer = dP < 4.5;
    // greet once per visit when the player walks up (and again after a long while)
    if (nearPlayer && !ctx.greeted && greetCd <= 0 && !(visitor && visitor.state === 'talk')) {
      ctx.greeted = true; greetCd = 40;
      gmSay(greetLine(), true);
      if (Math.random() < 0.8) gmQueue.push(rideLine());
    }
    const speaking = isSpeaking(p);
    if (p.state === 'sit') {
      if (visitor && visitor.state === 'talk') { faceSeated(p, visitor.g.position, dt); seatedTalk(p, dt, speaking); return; }
      if (nearPlayer || speaking) { faceSeated(p, player || null, dt); seatedTalk(p, dt, speaking); return; }
      faceSeated(p, null, dt); seatedTalk(p, dt, false);
      if ((gmTimer -= dt) <= 0 && !visitor) { p.state = 'stroll'; go(p, [{ a: CHAIR.a, b: CHAIR.b - 0.7 }].concat(STROLL, [{ a: CHAIR.a, b: CHAIR.b - 0.7 }, CHAIR])); p.g.position.y = groundY(p.g.position); }
    } else if (p.state === 'stroll') {
      if (nearPlayer && (speaking || dP < 2.2)) {        // stop and turn to the player
        turnTo(p.g, faceAngle(p.g.position, player), dt, 2);
        talkPose(p, dt, speaking); return;
      }
      if (stepPath(p, dt)) { p.state = 'sit'; gmTimer = 100 + Math.random() * 80; seatGrandma(); }
    }
  }
  // seated: the body stays square to the chair, the head (and a little of the torso) turns to look
  let gmLook = 0;
  function faceSeated(p, target, dt) {
    let want = 0;
    if (target) { const d = wrapA(faceAngle(p.g.position, target) - p.g.rotation.y); want = Math.max(-1.1, Math.min(1.1, d)); }
    gmLook += (want - gmLook) * Math.min(1, dt * 2.5);
  }
  function seatedTalk(p, dt, speaking) {
    sitOnChair(p);
    const P = p.h.parts; p.t += dt; p.nod += dt * (speaking ? 6 : 2.2);
    P.torso.rotation.y = gmLook * 0.35;
    P.head.rotation.set(-0.15 + Math.sin(p.nod) * (speaking ? 0.09 : 0.03), gmLook * 0.65 + (speaking ? Math.sin(p.nod * 0.37) * 0.09 : 0), 0);
    P.torso.scale.set(1 + Math.sin(p.t * 1.5) * 0.008, 1, 1 + Math.sin(p.t * 1.5) * 0.012);
    if (speaking) { p.gest += dt * 2.6; P.armR.rotation.x = -0.75 - Math.sin(p.gest) * 0.15; P.foreR.rotation.x = -1.0 - Math.sin(p.gest * 1.4) * 0.25; }
  }

  // ---------------------------------------------------------------- villager visits
  let visitor = null, visitT = 25;
  const gateIn = (side) => [lanePt(GATE_OUT.a + side * 1.5), GATE_OUT, GATE_MID, GATE_IN];
  const gateOut = (side) => [GATE_IN, GATE_MID, GATE_OUT, lanePt(GATE_OUT.a + side * 1.5)];
  function spawnVisitor() {
    if (visitor || !ready) return false;
    const ap = HumanModel.randomAppearance(Math.random() < 0.5 ? 'f' : 'm');
    if (ap.gender === 'm' && Math.random() < 0.6) { ap.top = 'shirt'; ap.bottom = Math.random() < 0.5 ? 'lungi' : 'dhoti'; ap.bottomColor = Math.random() < 0.5 ? 0xf4f1ea : 0x9fc5e8; }
    if (ap.gender === 'f') { ap.top = 'blouse'; ap.bottom = 'saree'; }
    const v = person(ap, 1.15, ap.gender === 'f' ? 'villager_f' : 'villager_m');
    const fromWest = Math.random() < 0.5, start = lanePt(fromWest ? -30 : 4), side = fromWest ? -1 : 1;
    const s = W(start); v.g.position.set(s.x, 0, s.z);
    go(v, gateIn(side).concat([{ a: -8.7, b: -2.0 }, TALK]));
    const cv = CONVOS[Math.random() * CONVOS.length | 0];
    v.state = 'arrive'; v.side = side; v.lines = cv[1].split('').map((w, i) => [w, cv[0] + i]); v.li = -1; v.lt = 0;
    visitor = v; return true;
  }
  function updateVisitor(dt) {
    const v = visitor; if (!v) { if ((visitT -= dt) <= 0) { visitT = 150 + Math.random() * 120; spawnVisitor(); } return; }
    tickBubble(v, dt); animMouth(v, dt);
    if (v.state === 'arrive') {
      if (stepPath(v, dt)) {
        if (gm.state !== 'sit') { v.t += dt; HumanModel.animateIdle(v.h.parts, v.t); turnTo(v.g, faceAngle(v.g.position, gm.g.position), dt); return; }   // wait for her to sit
        v.state = 'talk'; v.li = -1; v.lt = 0.4; v.waitLine = false;
      }
    } else if (v.state === 'talk') {
      turnTo(v.g, faceAngle(v.g.position, gm.g.position), dt);
      holdSpot(v, TALK, dt);
      if (!v.waitLine && (v.lt -= dt) <= 0) {
        v.li++;
        if (v.li >= v.lines.length) { v.state = 'leave'; go(v, [{ a: -8.7, b: -2.0 }].concat(gateOut(v.side), [lanePt(v.side < 0 ? -32 : 6)])); v.speaker = null; return; }
        const [who, id] = v.lines[v.li]; v.speaker = who; v.waitLine = true;
        speak(who === 'v' ? v : gm, id, () => { v.waitLine = false; v.lt = 0.35; });
      }
      if (v.li === 0) { v.t += dt; HumanModel.animateIdle(v.h.parts, v.t); namaste(v); }
      else talkPose(v, dt, v.speaker === 'v' && isSpeaking(v));
    } else if (v.state === 'leave') {
      if (stepPath(v, dt)) { remove(v); visitor = null; }
    }
    openPedGate(v.g.position, dt);
  }
  // the pedestrian gate: safehouse2 opens it for Crowd agents too; this keeps it open while one of ours is in it
  function openPedGate(pos, dt) {
    if (!SH.anim) return;
    const l = SH.L(pos.x, pos.z);
    if (Math.abs(l.a - GATE_MID.a) < 1.8 && l.b > GATE_MID.b - 3.2 && l.b < GATE_MID.b + 2.2) SH.anim.ped = Math.min(1, SH.anim.ped + dt * 2.5);
  }

  // ---------------------------------------------------------------- friends (optional)
  let fr = null;   // { car, col, crew: [person], state, t, spot, route, s }
  function carFactory() {
    const T = typeof TrafficModels !== 'undefined' ? TrafficModels : null; if (!T) return null;   // top-level const, not on window
    for (const k of ['swift', 'dzire', 'alto', 'bolero']) if (typeof T[k] === 'function') { try { const v = T[k](); if (v && v.g) return v; } catch (e) {} }
    return null;
  }
  const ROADS = ['highway', 'tar', 'cc', 'lane'];
  // a free off-road spot beside the lane near the house for a car (half length hl, half width hw):
  // never on a road surface / within a road's width, nowhere near either gate, not overlapping walls, buildings or
  // anything parked, close enough to the lane to drive onto. Returns { a, b, side, rot, x, z } in house frame + world.
  function findParkSpot(hl, hw) {
    const gA = [GATE_MID.a, -4.25], cands = [];
    const P = PL(), parkedL = (P && P.parkedList) || [];
    for (let a = -34; a <= 12; a += 0.5) {
      for (const side of [-1, 1]) {
        for (let off = 2.6; off <= 5.6; off += 0.3) {
          const b = LANE_B + side * off;
          if (side > 0 && b > (SH.yard ? SH.yard.b0 : -4.3) - hw - 0.3 && a > -20 && a < 0) continue;    // in front of the plot wall
          if (gA.some(ga => Math.abs(a - ga) < hl + (ga === GATE_MID.a ? 2.0 : 3.6))) continue;          // keep both gates clear
          const ok = (() => {
            for (const [da, db] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) {
              const w = SH.W(a + da, b + db);
              if (world.surfaceAt && ROADS.includes(world.surfaceAt(w.x, w.z))) return false;
              if (world.nearestRoad) { const r = world.nearestRoad(w.x, w.z); if (r && r.d < ((r.r && r.r.w) || 4) / 2 + 0.25) return false; }
              if (world.insideBuilding && world.insideBuilding(w.x, w.z, 0.4)) return false;
              if (world.landAt && world.landAt(w.x, w.z) > 0.02) return false;        // not on the raised land's slope
            }
            for (const da of [-hl + hw, 0, hl - hw]) { const w = SH.W(a + da, b), q = { x: w.x, z: w.z }; if (world.collide && world.collide(q, hw + 0.35).hit) return false; }
            // the turn-in from the lane (driveRoute's S-curve) must cross open ground too
            for (let i = 1; i < 8; i++) { const t = i / 8, e = t * t * (3 - 2 * t), w = SH.W(a - 8 + 8 * t, LANE_B + (b - LANE_B) * e), q = { x: w.x, z: w.z }; if (world.collide && world.collide(q, hw + 0.2).hit) return false; if (world.insideBuilding && world.insideBuilding(w.x, w.z, 0.5)) return false; }
            const c = SH.W(a, b);
            for (const v of parkedL) if (v.g && Math.hypot(v.g.position.x - c.x, v.g.position.z - c.z) < hl + 2.8) return false;
            for (const v of trafficList()) if (v.g && Math.hypot(v.g.position.x - c.x, v.g.position.z - c.z) < hl + 2.8) return false;
            return true;
          })();
          if (ok) { cands.push({ a, b, side, off, score: Math.abs(a - GATE_MID.a) + off * 1.5 }); break; }   // nearest offset at this a
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((p, q) => p.score - q.score);
    const s = cands[0], w = SH.W(s.a, s.b);
    return Object.assign(s, { x: w.x, z: w.z, all: cands.length });
  }
  const alongA = () => { const p0 = SH.W(0, 0), p1 = SH.W(1, 0); return Math.atan2(p1.x - p0.x, p1.z - p0.z); };
  // dense polyline (house frame) for driving: along the lane, then a smooth S onto the spot, nose along +a
  function driveRoute(spot) {
    const pts = [], from = spot.a - 45, turnLen = 8;
    for (let a = from; a < spot.a - turnLen; a += 1) pts.push({ a, b: LANE_B });
    for (let i = 0; i <= 24; i++) { const t = i / 24, e = t * t * (3 - 2 * t); pts.push({ a: spot.a - turnLen + turnLen * t, b: LANE_B + (spot.b - LANE_B) * e }); }
    return pts;
  }
  function leaveRoute(spot) {
    const pts = [], turnLen = 8;
    for (let i = 0; i <= 24; i++) { const t = i / 24, e = t * t * (3 - 2 * t); pts.push({ a: spot.a + turnLen * t, b: spot.b + (LANE_B - spot.b) * e }); }
    for (let a = spot.a + turnLen + 1; a < spot.a + 50; a += 1) pts.push({ a, b: LANE_B });
    return pts;
  }
  const RP = q => q.x !== undefined ? q : W(q);      // routes hold world points {x,z} or house-frame {a,b}
  // move the car s metres along its route; heading from the local tangent
  function placeOnRoute(car, route, s) {
    let acc = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const p = RP(route[i]), q = RP(route[i + 1]), L = Math.hypot(q.x - p.x, q.z - p.z);
      if (acc + L >= s || i === route.length - 2) {
        const t = Math.min(1, (s - acc) / (L || 1));
        const cx = p.x + (q.x - p.x) * t, cz = p.z + (q.z - p.z) * t; car.g.position.set(cx, groundY({ x: cx, z: cz }), cz);
        car.g.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
        return acc + L - s;            // remaining on this segment (for the end test)
      }
      acc += L;
    }
    return 0;
  }
  const routeLen = route => { let L = 0; for (let i = 0; i < route.length - 1; i++) { const p = RP(route[i]), q = RP(route[i + 1]); L += Math.hypot(q.x - p.x, q.z - p.z); } return L; };
  // ---- meeting the player anywhere: sample the road nearest him, pick the closest free off-road spot beside it
  function roadSamples(pts) {          // even 1 m samples of a polyline [[x,z],...]
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d < L; d += 1) out.push({ x: a[0] + (b[0] - a[0]) * d / L, z: a[1] + (b[1] - a[1]) * d / L }); }
    return out;
  }
  function clearForCar(c, ang, hl, hw, player) {
    const fx = Math.sin(ang), fz = Math.cos(ang), sx = fz, sz = -fx;
    for (const [da, db] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) {
      const x = c.x + fx * da + sx * db, z = c.z + fz * da + sz * db;
      if (world.surfaceAt && (ROADS.includes(world.surfaceAt(x, z)) || world.surfaceAt(x, z) === 'river')) return false;
      if (world.nearestRoad) { const r = world.nearestRoad(x, z); if (r && r.d < ((r.r && r.r.w) || 4) / 2 + 0.25) return false; }
      if (world.insideBuilding && world.insideBuilding(x, z, 0.4)) return false;
      if (world.landAt && world.landAt(x, z) > 0.02) return false;
    }
    for (const da of [-hl + hw, 0, hl - hw]) { const q = { x: c.x + fx * da, z: c.z + fz * da }; if (world.collide && world.collide(q, hw + 0.35).hit) return false; }
    if (SH) { const l = SH.L(c.x, c.z); if (Math.abs(l.b - GATE_MID.b) < 7 && [GATE_MID.a, -4.25].some(g => Math.abs(l.a - g) < hl + 3.6)) return false; }   // never across the house gates
    const P = PL(); for (const v of (P && P.parkedList) || []) if (v.g && Math.hypot(v.g.position.x - c.x, v.g.position.z - c.z) < hl + 2.8) return false;
    for (const v of trafficList()) if (v.g && Math.hypot(v.g.position.x - c.x, v.g.position.z - c.z) < hl + 2.8) return false;
    let hit = false;                                     // long vehicles (a parked bus): their whole length, not just their centre
    for (const da of [-hl, 0, hl]) { const x = c.x + fx * da, z = c.z + fz * da; eachVehicleDisc(x, z, 3, (vx, vz, r) => { if (Math.hypot(vx - x, vz - z) < r + hw + 0.9) hit = true; }); }
    if (hit) return false;
    return !player || dist(c, player) > 3.5;
  }
  function planMeet(player, hl, hw) {
    if (!world.nearestRoad) return null;
    const nr = world.nearestRoad(player.x, player.z, r => r.t !== 'river'); if (!nr || nr.d > 200) return null;
    let best = null;
    for (const pts of [nr.r.p, nr.r.p.slice().reverse()]) {
      const S = roadSamples(pts), rw = (nr.r.w || 4) / 2; let s0 = 0, bd = 1e9;
      S.forEach((q, i) => { const d = dist(q, nr); if (d < bd) { bd = d; s0 = i; } });
      for (const step of [0, 3, -3, 6, -6, 9, -9, 12, -12, 16, -16, 20, -20, 26, -26, 32, -32]) {
        const i = s0 + step; if (i < 28 || i >= S.length - 2) continue;
        const a = S[i], b = S[Math.min(S.length - 1, i + 2)], ang = Math.atan2(b.x - a.x, b.z - a.z), nx = Math.cos(ang), nz = -Math.sin(ang);
        for (const side of [1, -1]) for (let off = rw + hw + 0.5; off <= rw + hw + 4; off += 0.5) {
          const c = { x: a.x + nx * side * off, z: a.z + nz * side * off }; if (!clearForCar(c, ang, hl, hw, player)) continue;
          const ok = [0.25, 0.5, 0.75].every(t => { const k = S[i - Math.round(8 * (1 - t))], q = { x: k.x + nx * side * off * t, z: k.z + nz * side * off * t }; return !(world.collide && world.collide(q, hw + 0.2).hit) && !(world.insideBuilding && world.insideBuilding(q.x, q.z, 0.5)); });
          if (!ok) continue;
          const score = dist(c, player) + off * 0.3;
          if (!best || score < best.score) best = { x: c.x, z: c.z, score, S, i, side, off, nx, nz, ang };
          break;
        }
      }
    }
    if (!best) return null;
    const { S, i, side, off, nx, nz } = best, pts = [], from = Math.max(0, i - 55);
    for (let k = from; k < i - 8; k++) pts.push(S[k]);
    for (let n = 0; n <= 24; n++) { const t = n / 24, e = t * t * (3 - 2 * t), k = S[i - 8 + Math.round(8 * t)]; pts.push({ x: k.x + nx * side * off * e, z: k.z + nz * side * off * e }); }
    const back = []; for (let n = 0; n <= 24; n++) { const t = n / 24, e = t * t * (3 - 2 * t), k = S[Math.min(S.length - 1, i + Math.round(8 * t))]; back.push({ x: k.x + nx * side * off * (1 - e), z: k.z + nz * side * off * (1 - e) }); }
    for (let k = i + 9; k < Math.min(S.length, i + 60); k++) back.push(S[k]);
    return Object.assign(best, { route: pts, leave: back });
  }
  const playerPos = () => (G && G.carPos ? { x: G.carPos.x, z: G.carPos.z } : null);
  function friendsArrive() {
    if (fr || !ready) return;
    const car = carFactory(); if (!car) { console.warn('visitors: no car model for friends'); return; }
    const plan = planMeet(playerPos(), (car.len || 3.9) / 2 + 0.15, 0.95);
    if (!plan) { fr = { car: null, col: null, crew: [], state: 'away', t: 0 }; return; }    // nowhere safe here yet: try again when he moves on
    scene.add(car.g);
    fr = { car, col: null, crew: [], state: 'drive', t: 0, spot: plan, route: plan.route, s: 0, v: 7 };
    fr.L = routeLen(fr.route);
    placeOnRoute(car, fr.route, 0);
  }
  function friendBye() { if (fr && fr.state === 'hang' && fr.crew[0]) speak(fr.crew[0], 'fr_bye'); }
  function dropFriends() {          // everyone and the car off the map (only when far from the player, or switched off)
    if (!fr) return;
    fr.crew.forEach(remove); fr.crew = [];
    if (fr.col && world.removeCollider) world.removeCollider(fr.col); fr.col = null;
    if (fr.car) remove({ g: fr.car.g });
    fr = null;
  }
  function friendsLeave() {
    if (!fr) return;
    if (fr.state === 'hang' || fr.state === 'walkin') {
      const c = fr.car.g.position;
      if (fr.crew.some(p => dist(p.g.position, c) > 45)) { dropFriends(); return; }
      fr.state = 'walkout';
      const fx = Math.sin(fr.car.g.rotation.y), fz = Math.cos(fr.car.g.rotation.y);
      fr.crew.forEach((p, i) => { const d = SH.L(c.x + fz * 1.5 - fx * i, c.z - fx * 1.5 - fz * i); go(p, [{ a: d.a, b: d.b }]); });
    } else dropFriends();
  }
  function updateFriends(dt, player) {
    if (!fr) return;
    const pp = playerPos();
    if (fr.state === 'away') {                     // wait for him to slow down somewhere, then come over
      fr.t += dt;
      const sp = Math.abs(typeof carSpeed === 'number' ? carSpeed : 0);
      if (sp < 8 && fr.t > 3) { fr = null; if (friendsOn) friendsArrive(); if (fr && !fr.car) fr.t = 0; }
      return;
    }
    const car = fr.car;
    if (fr.state === 'drive' || fr.state === 'driveoff') {
      // slow on the lane, crawl onto the spot, ease to a stop; yield to anyone (people / player) in front
      const rem = fr.L - fr.s;
      let vt = fr.state === 'drive' ? Math.min(7, Math.max(0.8, rem * 0.45)) : Math.min(8, 1.2 + fr.s * 0.5);
      const fx = Math.sin(car.g.rotation.y), fz = Math.cos(car.g.rotation.y), cp = car.g.position;
      if (fr.state === 'drive' && pp && dist(pp, fr.spot) > Math.max(90, fr.spot.score + 40) && fr.s < fr.L * 0.7) { dropFriends(); fr = { car: null, col: null, crew: [], state: 'away', t: 0 }; return; }   // he left before they got there
      // only someone actually in the car's path stops it, not a person standing at the roadside
      const inPath = o => { const dx = o.x - cp.x, dz = o.z - cp.z, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx); return along > 1 && along < 6.5 && lat < 1.15 + (o.r || 0.3); };
      const ahead = Crowd.near(cp.x + fx * 3.5, cp.z + fz * 3.5, 3.2, null, false).some(inPath) || (G.playerMode === 'foot' && inPath({ x: G.carPos.x, z: G.carPos.z, r: 0.3 }));
      fr.wait = ahead ? (fr.wait || 0) + dt : 0;
      if (ahead) vt = fr.wait > 6 ? 0.7 : 0;      // nudges forward if somebody will not move: they step aside for a crawling car
      fr.v += (vt - fr.v) * Math.min(1, dt * (vt < fr.v ? 3 : 1.2));
      fr.s = Math.min(fr.L, fr.s + fr.v * dt);
      placeOnRoute(car, fr.route, fr.s);
      (car.wheels || []).forEach(w => { w.rotation.x += fr.v * dt / 0.3; });
      if (fr.state === 'drive' && rem < 0.05) {
        fr.state = 'park'; fr.t = 0;
        const c = car.g.position, hw = 0.95, hl = (car.len || 3.9) / 2 + 0.1;
        if (world.addCollider) fr.col = world.addCollider(c.x, c.z, hw, hl, car.g.rotation.y);
      }
      if (fr.state === 'driveoff' && fr.s >= fr.L - 0.1) { remove({ g: car.g }); fr = null; }
      return;
    }
    if (fr.state === 'park' && (fr.t += dt) > 1.2) {
      const looks = [{ gender: 'm', top: 'tshirt', bottom: 'jeans', topColor: 0xc62828, hair: 'sidepart', acc: { watch: true } },
        { gender: 'm', top: 'shirt', bottom: 'trousers', topColor: 0xf3efe6, bottomColor: 0x2b2b2b, hair: 'curly', acc: { sunglasses: true } }];
      const c = car.g.position, nx = Math.cos(car.g.rotation.y), nz = -Math.sin(car.g.rotation.y), fx = -nz, fz = nx;
      const toP = pp && (pp.x - c.x) * nx + (pp.z - c.z) * nz > 0 ? 1 : -1;     // get out on the side he is on
      looks.forEach((ap, i) => {
        const p = person(Object.assign(HumanModel.randomAppearance('m'), ap), 1.35, 'friend' + (i + 1));
        p.g.position.set(c.x + nx * toP * 1.5 + fx * (0.6 - i * 1.3), groundY(c), c.z + nz * toP * 1.5 + fz * (0.6 - i * 1.3));
        p.path = null; p.delay = 0.4 + i * 0.9;
        fr.crew.push(p);
      });
      fr.state = 'hang'; fr.cd = 2; fr.farLimit = Math.max(90, (pp ? dist(pp, c) : 0) + 60);
    }
    if (fr.state === 'park') return;
    let allDone = true; fr.cd = (fr.cd || 0) - dt;
    const nearAny = player && fr.crew.some(p => dist(player, p.g.position) < 6);
    // greet when the player walks up, then banter every ~8-12 s while they stay near
    if (fr.state === 'hang' && nearAny && fr.cd <= 0 && !fr.crew.some(p => p.talking)) {
      const i = (fr.turn = (fr.turn || 0) + 1) & 1, p = fr.crew[i];
      let id;
      if (!fr.greeted) { id = Math.random() < 0.6 ? 'fr_hello' : 'fr_hey'; fr.greeted = true; p.reply = ctx.now - ctx.rideT < 90 ? 'fr_car' : 'fr_cricket'; }
      else { const L = ['fr_cinema', 'fr_pulihora', 'fr_round', 'fr_cricket', 'fr_tease']; id = L[(fr.line = ((fr.line || 0) + 1)) % L.length]; }
      speak(p, id, () => { const o = fr && fr.crew[1 - i]; if (o && (p.reply || Math.random() < 0.4)) { const r = p.reply || 'fr_yes'; p.reply = null; setTimeout(() => o.g.parent && speak(o, r), 300); } });
      fr.cd = 8 + Math.random() * 4;
    }
    if (fr.state === 'hang' && !nearAny) fr.greeted = fr.greeted && fr.cd > -60;
    // react: player sprinting right past them, or driving into the yard
    if (fr.state === 'hang' && (fr.reactCd || 0) <= 0) {
      const sp = typeof carSpeed === 'number' ? carSpeed : 0;
      if (G.playerMode === 'foot' && sp > 16 && nearAny && !fr.crew[0].talking) { speak(fr.crew[0], 'fr_slow'); fr.reactCd = 15; }
      else if ((G.playerMode === 'vehicle' || G.playerMode === 'crysta') && SH.L(G.carPos.x, G.carPos.z).b > -4 && fr.crew.some(p => dist(G.carPos, p.g.position) < 12) && !fr.wowDone) { fr.wowDone = true; speak(fr.crew[1], 'fr_wow'); fr.reactCd = 15; }
    }
    fr.reactCd = (fr.reactCd || 0) - dt;
    for (const [i, p] of fr.crew.entries()) {
      tickBubble(p, dt); animMouth(p, dt);
      openPedGate(p.g.position, dt);
      if (fr.state === 'walkin' || fr.state === 'walkout') {
        if (p.delay > 0) { p.delay -= dt; p.t += dt; HumanModel.animateIdle(p.h.parts, p.t); allDone = false; continue; }
        if (!stepPath(p, dt)) allDone = false; else { p.t += dt; HumanModel.animateIdle(p.h.parts, p.t); }
        continue;
      }
      // with him: a loose pair a step behind his shoulders, side by side. Jog when he has got ahead, stop and chat when he stops.
      if (p.delay > 0) { p.delay -= dt; p.t += dt; HumanModel.animateIdle(p.h.parts, p.t); continue; }
      if (p.bumped > 0) p.bumped -= dt;
      const d = pp ? dist(pp, p.g.position) : 0, sd = i ? -1 : 1, fa = fr.heading || 0;
      const slot = pp ? { x: pp.x - Math.sin(fa) * 1.5 + Math.cos(fa) * sd * 0.95, z: pp.z - Math.cos(fa) * 1.5 - Math.sin(fa) * sd * 0.95 } : p.g.position;
      const moving = (fr.pv || 0) > 0.4, sl = dist(slot, p.g.position), close = sl < (moving ? 0.45 : 1.6) && d < 3.4;
      if (!close) steerTo(p, slot, dt, 0.3, d > 14 ? 2.6 : d > 5 ? 1.9 : Math.max(0.8, Math.min(1.5, (fr.pv || 1.2) / p.speed)));
      else { turnTo(p.g, moving ? fa : faceAngle(p.g.position, pp), dt, 2.5); talkPose(p, dt, isSpeaking(p)); }
    }
    if (fr.state === 'hang' && pp) {
      // his walking direction and speed; if he has gone (car, bike) they vanish out of sight and catch up by road
      if (fr.last) { const dx = pp.x - fr.last.x, dz = pp.z - fr.last.z, sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3); fr.pv = (fr.pv || 0) + (sp - (fr.pv || 0)) * Math.min(1, dt * 4); if (sp > 0.3) fr.heading = fr.heading === undefined ? Math.atan2(dx, dz) : fr.heading + wrapA(Math.atan2(dx, dz) - fr.heading) * Math.min(1, dt * 3); }
      fr.last = pp;
      const far = fr.crew.length && fr.crew.every(p => dist(pp, p.g.position) > fr.farLimit);
      if (far && dist(pp, car.g.position) > fr.farLimit) { dropFriends(); fr = { car: null, col: null, crew: [], state: 'away', t: 0 }; return; }
    }
    if (fr.state === 'walkout' && allDone) {
      fr.crew.forEach(remove); fr.crew = [];
      if (fr.col && world.removeCollider) world.removeCollider(fr.col); fr.col = null;
      fr.state = 'driveoff'; fr.route = fr.spot.leave; fr.L = routeLen(fr.route); fr.s = 0; fr.v = 0;
    }
  }
  function setFriends(on) {
    friendsOn = !!on;
    try { localStorage.setItem(LS_KEY, friendsOn ? '1' : '0'); } catch (e) {}
    const cb = document.getElementById('friendsVisit'); if (cb) cb.checked = friendsOn;
    if (!ready) return friendsOn;
    if (friendsOn) friendsArrive(); else friendsLeave();
    return friendsOn;
  }
  function addSettingsToggle() {
    const set = document.getElementById('settings'); if (!set || document.getElementById('friendsVisit')) return;
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:10px;cursor:pointer';
    lab.innerHTML = '<input type="checkbox" id="friendsVisit"> Friends come to you (arrive by car, walk with you)';
    set.appendChild(lab);
    const cb = lab.querySelector('input'); cb.checked = friendsOn;
    cb.addEventListener('change', e => setFriends(e.target.checked));
    const lab2 = document.createElement('label');
    lab2.style.cssText = lab.style.cssText;
    lab2.innerHTML = '<input type="checkbox" id="peopleVoices"> People speak (Telugu voices)';
    set.appendChild(lab2);
    const cb2 = lab2.querySelector('input'); cb2.checked = !(window.Voice && Voice.muted);
    cb2.addEventListener('change', e => { if (window.Voice) Voice.setMuted(!e.target.checked); });
  }

  // ---------------------------------------------------------------- talking to people (T / TALK button)
  function talkTarget() {
    if (!ready || !G || G.playerMode !== 'foot') return null;
    let best = null, bd = 3.2;
    const cand = [gm].concat(fr && fr.state === 'hang' ? fr.crew : []);
    for (const p of cand) { if (!p) continue; const d = dist(G.carPos, p.g.position); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // ---- two-way talk: some lines are questions; the player answers with one of 2-3 replies (buttons, 1/2/3 keys,
  // T cycles the highlighted one, Enter picks it). Each answer gets its own reply and sometimes a little prompt.
  const ANS = { yes: ['అవును', 'Avunu'], no: ['లేదు', 'Ledu'], later: ['తర్వాత', 'Taruvatha'] };
  const QUESTIONS = {
    gm_q_tea: { yes: ['gm_ok_tea', 'AMMAMMA MADE YOU TEA ☕'], no: ['gm_no'], later: ['gm_later'] },
    gm_q_food: { yes: ['gm_ok_food', 'LUNCH WITH AMMAMMA 🍛 · ENERGY FULL'], no: ['gm_no'], later: ['gm_later'] },
    gm_q_water: { yes: ['gm_ok_water', 'COOL WATER FROM THE KUNDA'], no: ['gm_no'] },
    gm_q_temple: { yes: ['gm_temple_go', 'MISSION: DRIVE TO SHIVALAYAM TEMPLE 🛕'], no: ['gm_temple_no'], later: ['gm_later'] },
    fr_q_race: { yes: ['fr_go', 'RACE: FIRST TO THE HIGHWAY WINS 🏁'], no: ['fr_no'], later: ['fr_later'] },
    fr_q_tank: { yes: ['fr_go', 'RIDE: TAKE A BIKE TO THE CHERUVU (TANK) 🏍'], no: ['fr_no'], later: ['fr_later'] },
    fr_q_cricket: { yes: ['fr_go', 'CRICKET THIS EVENING AT THE GROUND 🏏'], no: ['fr_no'], later: ['fr_later'] },
  };
  let choice = null, choiceEl = null;
  function choiceUi() {
    choiceEl = document.createElement('div'); choiceEl.id = 'talkChoices';
    choiceEl.style.cssText = 'position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:31;display:none;gap:10px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px)';
    document.body.appendChild(choiceEl);
  }
  function showChoices(p, qid) {
    const Q = QUESTIONS[qid]; if (!Q || !choiceEl) return;
    const keys = Object.keys(Q);
    choice = { p, qid, keys, sel: 0, until: ctx.now + 12 };
    choiceEl.innerHTML = '';
    keys.forEach((k, i) => {
      const b = document.createElement('button');
      b.innerHTML = '<span style="opacity:.6;font-size:11px;margin-right:6px">' + (i + 1) + '</span>' + ANS[k][0] + ' <span style="opacity:.75;font-weight:500">· ' + ANS[k][1] + '</span>';
      b.style.cssText = 'padding:10px 16px;border-radius:20px;border:1px solid rgba(251,191,36,.6);background:rgba(20,16,10,.82);color:#fde68a;font:700 15px "Kohinoor Telugu",system-ui,sans-serif;touch-action:manipulation';
      const pick = e => { e.preventDefault(); e.stopPropagation(); answer(i); };
      b.addEventListener('touchstart', pick, { passive: false }); b.addEventListener('click', pick);
      choiceEl.appendChild(b);
    });
    choiceEl.style.display = 'flex'; markChoice();
  }
  function markChoice() { if (!choice) return; Array.from(choiceEl.children).forEach((b, i) => { b.style.background = i === choice.sel ? 'rgba(180,120,20,.92)' : 'rgba(20,16,10,.82)'; }); }
  function closeChoices() { choice = null; if (choiceEl) choiceEl.style.display = 'none'; }
  function answer(i) {
    if (!choice) return;
    const c = choice, k = c.keys[i], r = QUESTIONS[c.qid][k]; closeChoices();
    if (!r || !c.p.g.parent) return;
    const after = () => { if (r[1] && G.showPopup) G.showPopup(r[1]); };
    if (c.p === gm) gmSay(r[0], true); else speak(c.p, r[0], null, true);
    setTimeout(after, 600);
    if (k === 'yes' && c.p !== gm && fr) { const o = fr.crew[1 - fr.crew.indexOf(c.p)]; if (o) setTimeout(() => o.g.parent && speak(o, 'fr_yes'), 2600); }
  }
  // what she says when talked to: recent events first, then a question (offer food / tea / water, the temple), then
  // time-of-day and general lines
  function gmNext() {
    const h = hour(), L = [];
    if (recent(ctx.crashT, 120) && !ctx.saidCrash) { ctx.saidCrash = true; return nx('crash', 'gm_crash'); }
    if (recent(ctx.hornT, 30) && !ctx.saidHorn) { ctx.saidHorn = true; return nx('horn', 'gm_horn'); }
    if (!recent(ctx.hornT, 30)) ctx.saidHorn = false;
    if (!recent(ctx.crashT, 120)) ctx.saidCrash = false;
    if (h >= 21 || h < 5) return ctx.talkI++ % 3 === 2 ? nx('general', 'gm_bless') : nx('night', 'gm_night');   // worried at night
    const meal = (h >= 12 && h < 14.5) || (h >= 19.5 && h < 22);
    const qs = [meal ? 'gm_q_food' : (h >= 15.5 && h < 18.5) || (h >= 6 && h < 9) ? 'gm_q_tea' : 'gm_q_water'];
    if (/temple|shiva|alayam|darshan/i.test(missionText())) qs.push('gm_q_temple');
    // a repeating rhythm of KINDS of line (the words come from the pools): she offers something only now and then
    const kind = ctx.talkI++ % 6;
    if (kind === 0) { const q = qs[ctx.qi = ((ctx.qi || 0) + 1) % qs.length]; Voice.mark(q); return q; }
    if (kind === 1) return timeLine();
    if (kind === 2) return rideLine();
    if (kind === 3) return fr && fr.state === 'hang' && !ctx.saidFriends && (ctx.saidFriends = true) ? 'gm_friends' : nx('general', 'gm_sit');
    if (kind === 4) return nx(seasonPool(), 'gm_bless');
    return nx('general', 'gm_bless');
  }
  function frNext() {
    const h = hour();
    if (recent(ctx.crashT, 120) && !fr.saidCrash) { fr.saidCrash = true; return 'fr_crash'; }
    if (!fr.helloDone) { fr.helloDone = true; return 'fr_hello'; }
    const L = [['fr_q_race', 'fr_q_tank', 'fr_q_cricket'][(fr.qi = ((fr.qi || 0) + 1)) % 3]];
    L.push(ctx.now - ctx.rideT < 120 ? 'fr_car' : nx('fr', 'fr_round'), h >= 21 || h < 5 ? 'fr_night' : h < 9 ? 'fr_morning' : nx('fr', 'fr_hungry'), nx('fr', 'fr_cinema'));
    fr.ti = (fr.ti || 0) + 1;
    return L[fr.ti % L.length];
  }
  function talk() {
    if (choice) { choice.sel = (choice.sel + 1) % choice.keys.length; markChoice(); return true; }   // T cycles the replies
    const p = talkTarget(); if (!p) return false;
    if (p.talking) return true;
    const id = p === gm ? gmNext() : frNext();
    const q = QUESTIONS[id] ? id : null;
    if (p === gm) { ctx.greeted = true; if (gm.talking) return true; speak(gm, id, () => { if (q) showChoices(gm, q); }, true); }
    else {
      const i = fr.crew.indexOf(p);
      speak(p, id, () => { if (q) showChoices(p, q); else { const o = fr && fr.crew[1 - i]; if (o && Math.random() < 0.5) setTimeout(() => o.g.parent && speak(o, 'fr_yes'), 250); } }, true);
      fr.cd = Math.max(fr.cd || 0, 8);
    }
    return true;
  }
  let talkBtn = null;
  function talkUi() {
    talkBtn = document.createElement('button');
    talkBtn.id = 'talkBtn'; talkBtn.textContent = 'Talk';
    talkBtn.style.cssText = 'position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(230px + env(safe-area-inset-bottom,0px));z-index:30;display:none;padding:12px 18px;border-radius:24px;border:1px solid rgba(251,191,36,.6);background:rgba(20,16,10,.78);color:#fde68a;font:700 15px system-ui,sans-serif;touch-action:manipulation';
    const fire = e => { e.preventDefault(); e.stopPropagation(); talk(); };
    talkBtn.addEventListener('touchstart', fire, { passive: false }); talkBtn.addEventListener('click', fire);
    document.body.appendChild(talkBtn);
  }

  // ---------------------------------------------------------------- hooks
  GameHooks.init.push(game => {
    G = game; world = game.world; scene = game.scene;
    addSettingsToggle();
    // SafeHouse2 is published from its own init hook (runs before ours); wait a tick if it is not there yet
    const start = () => {
      SH = window.SafeHouse2;
      if (!SH || typeof HumanModel === 'undefined') { if ((start.n = (start.n || 0) + 1) < 50) setTimeout(start, 200); return; }
      if (SH.pedGate) { const a = SH.pedGate.a, b = SH.pedGate.b; GATE_MID = { a, b }; GATE_OUT = { a, b: b - 1.7 }; GATE_IN = { a, b: b + 1.0 }; }
      root = new THREE.Group(); root.name = 'visitors'; scene.add(root);
      chairObj = chair(); const c = W(CHAIR); chairObj.position.set(c.x, 0.97, c.z);
      chairObj.rotation.y = Math.atan2(-(SH.W(0, 1).x - SH.W(0, 0).x), -(SH.W(0, 1).z - SH.W(0, 0).z)); root.add(chairObj);
      gm = person({ elder: true, gender: 'f', bottomColor: 0x1f4c9c, topColor: 0x7a2632, skin: 0x9a6a48, face: 'oval', brows: 'thin', feet: 'chappals', feetColor: 0x6b4a2e }, 0.42, 'ammamma');
      gm.state = 'sit'; gm.name = 'ammamma'; gm.r = 0.3; seatGrandma();
      Crowd.statics.push({ x: c.x, z: c.z, r: 0.36, owner: gm });            // the chair (grandma herself sits in it)
      talkUi(); choiceUi();
      try { if (typeof window.triggerHorn === 'function' && !window.triggerHorn._visitors) { const h0 = window.triggerHorn; window.triggerHorn = function () { try { onHorn(); } catch (e) {} return h0.apply(this, arguments); }; window.triggerHorn._visitors = true; } } catch (e) {}
      ready = true;
      if (friendsOn) friendsArrive();
    };
    start();
  });
  GameHooks.update.push((dt, game) => {
    if (!ready) return;
    const cp = game.carPos, foot = game.playerMode === 'foot';
    if (SH.center && cp && Math.hypot(cp.x - SH.center.x, cp.z - SH.center.z) > 160) { updateFriends(dt, foot && cp ? { x: cp.x, z: cp.z } : null); window.NELLUTLA_ON_FOOT = game.playerMode === 'foot'; sidestepPathWalkers(dt); if (talkBtn) talkBtn.style.display = 'none'; return; }   // far away: freeze (lod.js stops drawing them)
    const player = foot && cp ? { x: cp.x, z: cp.z } : null;
    trackPlayer(dt);
    updateGrandma(dt, player);
    updateVisitor(dt);
    updateFriends(dt, player);
    window.NELLUTLA_ON_FOOT = game.playerMode === 'foot';
    sidestepPathWalkers(dt);
    if (talkBtn) talkBtn.style.display = talkTarget() ? 'block' : 'none';
    if (choice && (ctx.now > choice.until || !talkTarget())) closeChoices();     // walked off / no answer
  });
  GameHooks.key.push((e) => {
    if (choice && !e.repeat) {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
      if (n !== undefined && n < choice.keys.length) { answer(n); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { answer(choice.sel); return true; }
    }
    if (e.code !== 'KeyT' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
    return talk();                                 // only consumed when somebody is close enough to talk to
  });

  window.Visitors = {
    setFriends, get friends() { return friendsOn; }, talk, findParkSpot,
    spawnVisitor, get grandma() { return gm; }, get visitor() { return visitor; }, get friendsState() { return fr && fr.state; }, get friendsGroup() { return fr; },
    strollNow() { if (gm && gm.state === 'sit') gmTimer = 0; },
  };
})();
