// visitors.js: life at Safe House 2 (safehouse2.js). Grandma (ammamma) sits on a chair on the porch or takes a slow
// walk round the front courtyard; every few minutes a villager walks in through the pedestrian gate, greets her, they
// chat (face each other, nods, hand gestures, speech bubbles) and the villager walks back out. She turns to greet the
// player when they come near on foot.
// Optional (default OFF): friends arrive in a car, park it on the lane shoulder west of the pedestrian gate, walk in,
// hang out in the courtyard and chat with the player. Toggle: window.Visitors.setFriends(true/false) or the checkbox
// this file adds to the Settings panel. Needs HumanModel (people-models.js) and window.SafeHouse2 (set in its init hook).
(function () {
  'use strict';
  let G = null, world = null, scene = null, SH = null, root = null, ready = false;
  const LS_KEY = 'nellutla.friends';
  let friendsOn = false;
  try { friendsOn = localStorage.getItem(LS_KEY) === '1'; } catch (e) {}

  // ---------------------------------------------------------------- house-local spots (a along the lane, b into the plot)
  const CHAIR = { a: -7.75, b: 0.55 };               // on the porch, facing the gate
  const TALK = { a: -8.25, b: -0.95 };               // where a visitor stands to talk to her (on the porch step)
  const GATE_OUT = { a: -9.15, b: -6.2 }, GATE_IN = { a: -9.15, b: -3.4 };
  const STROLL = [{ a: -7.6, b: -1.7 }, { a: -5.6, b: -2.6 }, { a: -3.4, b: -1.6 }, { a: -2.6, b: 0.6 }, { a: -4.6, b: -0.6 }, { a: -6.9, b: -1.8 }];
  const PARK = { a: -15.5, b: -6.9 };                // lane shoulder, well clear of both gates
  const HANG = [{ a: -5.2, b: -2.3 }, { a: -4.2, b: -1.5 }];
  const lanePt = (a) => ({ a, b: -6.6 });

  const VILLAGER_LINES = [
    [['v', 'Namaskaram, ammamma!'], ['g', 'Raa nanna, baagunnava?'], ['v', 'Baagunnanu ammamma. Meeru?'], ['g', 'Ee vayasulo inka emundi ra... baagane unna.'], ['v', 'Pantalu baagunnayi ee saari!'], ['g', 'Manchidi. Tea taagi vellu.'], ['v', 'Malli vastanu, ammamma!']],
    [['v', 'Ammamma, namaskaram!'], ['g', 'Ochhava amma! Pillalu ela unnaru?'], ['v', 'Andaru baagunnaru, school ki vellaru.'], ['g', 'Sare sare. Jaagratha ga undandi.'], ['v', 'Untanu ammamma, vastanu!']],
    [['v', 'Ammamma, paalu thechanu!'], ['g', 'Ayyo, enduku ra antha shrama?'], ['v', 'Emi ledu ammamma, maa aavu baaga istondi.'], ['g', 'Devudu chalaga choodali nee kutumbanni.'], ['v', 'Vastanu ammamma, jaagratha!']],
  ];
  const GRANDMA_PLAYER = ['Vachava nanna! Annam tinnava?', 'Bandi jaagratha ga nadupu ra!', 'Raa kanna, koncham koorcho.', 'Inta varaku ekkada tirigav ra?'];
  const FRIEND_LINES = ['Ey mama! Ela unnav ra?', 'Bandi super ga undi ra!', 'Saayantram cinema ki veldama?', 'Ammamma chesina pulihora adhirindi!', 'Chalo, oka round kodadam ra!'];

  // ---------------------------------------------------------------- helpers
  const W = (p) => SH.W(p.a, p.b);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  const faceAngle = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  function turnTo(obj, ang, dt, rate) {
    let d = ang - obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    obj.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * (rate || 3));
    return Math.abs(d);
  }
  function groundY(p) {            // porch plinth / step heights (house-local)
    const l = SH.L(p.x, p.z);
    if (l.a > -9.4 && l.a < -6.8 && l.b > -0.6 && l.b < 3.0) return 0.12;
    if (l.a > -9.0 && l.a < -7.2 && l.b > -1.25 && l.b <= -0.6) return 0.06;
    return 0;
  }

  // speech bubble: canvas sprite above the head
  function bubble() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(1.9, 0.475, 1); s.renderOrder = 999; s.visible = false;
    s.userData = { c, t, life: 0, text: '' };
    return s;
  }
  function say(who, text, secs) {
    const b = who.bubble, u = b.userData;
    if (u.text !== text) {
      const x = u.c.getContext('2d'), W2 = 512, H2 = 128;
      x.clearRect(0, 0, W2, H2);
      x.font = '600 30px system-ui, sans-serif';
      const tw = Math.min(W2 - 30, x.measureText(text).width + 36), x0 = (W2 - tw) / 2;
      x.fillStyle = 'rgba(255,255,255,0.94)'; x.strokeStyle = 'rgba(40,30,20,0.55)'; x.lineWidth = 3;
      x.beginPath(); if (x.roundRect) x.roundRect(x0, 8, tw, 76, 22); else x.rect(x0, 8, tw, 76); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(W2 / 2 - 14, 83); x.lineTo(W2 / 2, 112); x.lineTo(W2 / 2 + 14, 83); x.closePath(); x.fill();
      x.fillStyle = '#2a1d12'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let fs = 30; while (x.measureText(text).width > tw - 24 && fs > 16) { fs -= 2; x.font = `600 ${fs}px system-ui, sans-serif`; }
      x.fillText(text, W2 / 2, 46);
      u.t.needsUpdate = true; u.text = text;
    }
    u.life = secs || 3.2; b.visible = true;
  }

  // a person: HumanModel + bubble + simple steering
  function person(ap, speed) {
    const h = HumanModel.create(ap);
    const p = { h, g: h.group, bubble: bubble(), speed: speed || 1.2, phase: Math.random() * 6, t: Math.random() * 10, path: null, pi: 0, state: 'idle', talk: 0, nod: 0, gest: 0 };
    p.g.add(p.bubble); p.bubble.position.y = 1.9 * h.scale / 0.95 + 0.1;
    scene.add(p.g);                                   // top-level, so lod.js handles each figure on its own
    return p;
  }
  function remove(p) { if (p && p.g.parent) p.g.parent.remove(p.g); }
  // walk along p.path (house-local points); returns true when the end is reached
  const tmp = { x: 0, z: 0 };
  function stepPath(p, dt) {
    if (!p.path || p.pi >= p.path.length) return true;
    const tgt = W(p.path[p.pi]), pos = p.g.position;
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.18) { p.pi++; return p.pi >= p.path.length; }
    const ang = Math.atan2(dx, dz);
    turnTo(p.g, ang, dt, 4);
    const v = Math.min(d / Math.max(dt, 1e-3), p.speed);
    tmp.x = pos.x + Math.sin(p.g.rotation.y) * v * dt; tmp.z = pos.z + Math.cos(p.g.rotation.y) * v * dt;
    if (world.collide) world.collide(tmp, 0.28);              // slide along walls / piers / parked cars
    pos.x = tmp.x; pos.z = tmp.z; pos.y += (groundY(pos) - pos.y) * Math.min(1, dt * 8);
    p.phase += dt * v * 4.2;
    HumanModel.animateWalk(p.h.parts, p.phase, v);
    return false;
  }
  function go(p, pts) { p.path = pts; p.pi = 0; }

  // talking gestures layered on top of the idle pose
  function talkPose(p, dt, speaking) {
    p.t += dt; HumanModel.animateIdle(p.h.parts, p.t);
    const P = p.h.parts;
    p.nod += dt * (speaking ? 7 : 3.5);
    P.head.rotation.x += Math.sin(p.nod) * (speaking ? 0.08 : 0.05);
    if (speaking) {
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

  // ---------------------------------------------------------------- grandma
  let gm = null, chairObj = null, gmTimer = 60, greetCd = 0;
  function seatGrandma() {
    const c = W(CHAIR), ang = SH.L ? Math.atan2(-(SH.W(0, 1).x - SH.W(0, 0).x), -(SH.W(0, 1).z - SH.W(0, 0).z)) : 0;
    gm.g.position.set(c.x, 0.12, c.z); gm.g.rotation.y = ang;
    sitOnChair(gm);
  }
  // chair seat at 0.40 (+ porch 0.12): thighs level on the seat, shins down to the floor, saree draped over the knees
  function sitOnChair(p) {
    const P = p.h.parts, s = p.h.scale;
    HumanModel.sit(P, 'bench');
    const knee = 0.5 * s;                                // shin + ankle + sole
    p.g.position.y = 0.12 + Math.max(0.42, knee) - 0.89 * s;
    P.legL.rotation.set(-1.5, 0, 0.06); P.legR.rotation.set(-1.5, 0, -0.06);
    P.shinL.rotation.x = P.shinR.rotation.x = 1.5;
    P.torso.rotation.x = 0.1; P.armL.rotation.set(-0.5, 0, 0.1); P.armR.rotation.set(-0.5, 0, -0.1); P.foreL.rotation.x = P.foreR.rotation.x = -0.75;
    if (P.skirt) { P.skirt.rotation.set(-0.8, 0, 0); P.skirt.scale.set(1.2, 0.72, 2.0); }
  }
  function updateGrandma(dt, player) {
    const p = gm; if (!p) return;
    greetCd -= dt;
    if (p.bubble.userData.life > 0 && (p.bubble.userData.life -= dt) <= 0) p.bubble.visible = false;
    const nearPlayer = player && dist(player, p.g.position) < 4.2;
    if (p.state === 'sit') {
      if (visitor && visitor.state === 'talk') { faceSeated(p, visitor.g.position, dt); seatedTalk(p, dt, visitor.speaker === 'g'); return; }
      if (nearPlayer) { faceSeated(p, player, dt); if (greetCd <= 0) { say(p, GRANDMA_PLAYER[Math.random() * GRANDMA_PLAYER.length | 0], 3.5); greetCd = 22; } seatedTalk(p, dt, p.bubble.visible); return; }
      faceSeated(p, null, dt); seatedTalk(p, dt, false);
      if ((gmTimer -= dt) <= 0 && !visitor) { p.state = 'stroll'; go(p, [{ a: CHAIR.a, b: CHAIR.b - 0.6 }].concat(STROLL, [{ a: CHAIR.a, b: CHAIR.b - 0.6 }, CHAIR])); p.g.position.y = groundY(p.g.position); }
    } else if (p.state === 'stroll') {
      if (nearPlayer) {                                  // stop and turn to the player
        turnTo(p.g, faceAngle(p.g.position, player), dt, 2);
        if (greetCd <= 0) { say(p, GRANDMA_PLAYER[Math.random() * GRANDMA_PLAYER.length | 0], 3.5); greetCd = 22; }
        talkPose(p, dt, p.bubble.visible); return;
      }
      if (stepPath(p, dt)) { p.state = 'sit'; gmTimer = 100 + Math.random() * 80; seatGrandma(); }
    }
  }
  // seated: the body stays square to the chair, the head (and a little of the torso) turns to look
  let gmLook = 0;
  function faceSeated(p, target, dt) {
    let want = 0;
    if (target) { let d = faceAngle(p.g.position, target) - p.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); want = Math.max(-1.1, Math.min(1.1, d)); }
    gmLook += (want - gmLook) * Math.min(1, dt * 2.5);
  }
  function seatedTalk(p, dt, speaking) {
    sitOnChair(p);
    const P = p.h.parts; p.t += dt; p.nod += dt * (speaking ? 6 : 2.2);
    P.torso.rotation.y = gmLook * 0.35; P.head.rotation.set(-0.15 + Math.sin(p.nod) * (speaking ? 0.08 : 0.03), gmLook * 0.65, 0);
    P.torso.scale.set(1 + Math.sin(p.t * 1.5) * 0.008, 1, 1 + Math.sin(p.t * 1.5) * 0.012);
    if (speaking) { p.gest += dt * 2.6; P.armR.rotation.x = -0.75 - Math.sin(p.gest) * 0.15; P.foreR.rotation.x = -1.0 - Math.sin(p.gest * 1.4) * 0.25; }
  }

  // ---------------------------------------------------------------- villager visits
  let visitor = null, visitT = 25;
  function spawnVisitor() {
    if (visitor || !ready) return false;
    const ap = HumanModel.randomAppearance(Math.random() < 0.5 ? 'f' : 'm');
    if (ap.gender === 'm' && Math.random() < 0.6) { ap.top = 'shirt'; ap.bottom = Math.random() < 0.5 ? 'lungi' : 'dhoti'; ap.bottomColor = Math.random() < 0.5 ? 0xf4f1ea : 0x9fc5e8; }
    if (ap.gender === 'f') { ap.top = 'blouse'; ap.bottom = 'saree'; }
    const v = person(ap, 1.15);
    const fromWest = Math.random() < 0.5, start = lanePt(fromWest ? -30 : 4);
    const s = W(start); v.g.position.set(s.x, 0, s.z);
    go(v, [lanePt(GATE_OUT.a + (fromWest ? -1.5 : 1.5)), GATE_OUT, GATE_IN, { a: -8.6, b: -2.0 }, TALK]);
    v.state = 'arrive'; v.fromWest = fromWest; v.lines = VILLAGER_LINES[Math.random() * VILLAGER_LINES.length | 0]; v.li = -1; v.lt = 0;
    visitor = v; return true;
  }
  function updateVisitor(dt) {
    const v = visitor; if (!v) { if ((visitT -= dt) <= 0) { visitT = 150 + Math.random() * 120; spawnVisitor(); } return; }
    if (v.bubble.userData.life > 0 && (v.bubble.userData.life -= dt) <= 0) v.bubble.visible = false;
    if (v.state === 'arrive') {
      if (stepPath(v, dt)) {
        if (gm.state !== 'sit') { v.t += dt; HumanModel.animateIdle(v.h.parts, v.t); turnTo(v.g, faceAngle(v.g.position, gm.g.position), dt); return; }   // wait for her to sit
        v.state = 'talk'; v.li = -1; v.lt = 0.4;
      }
    } else if (v.state === 'talk') {
      turnTo(v.g, faceAngle(v.g.position, gm.g.position), dt);
      if ((v.lt -= dt) <= 0) {
        v.li++;
        if (v.li >= v.lines.length) { v.state = 'leave'; go(v, [{ a: -8.6, b: -2.0 }, GATE_IN, GATE_OUT, lanePt(GATE_OUT.a + (v.fromWest ? -1.5 : 1.5)), lanePt(v.fromWest ? -32 : 6)]); v.speaker = null; return; }
        const [who, text] = v.lines[v.li]; v.speaker = who;
        say(who === 'v' ? v : gm, text, 3.4); v.lt = 3.7;
      }
      if (v.li === 0) { v.t += dt; HumanModel.animateIdle(v.h.parts, v.t); namaste(v); }
      else talkPose(v, dt, v.speaker === 'v');
    } else if (v.state === 'leave') {
      if (stepPath(v, dt)) { remove(v); visitor = null; }
    }
    openPedGate(v.g.position, dt);
  }
  // the pedestrian gate in safehouse2.js only opens for the player / known NPC lists: nudge its animation open while
  // one of our walkers is in the gateway (our update hook runs after safehouse2's every frame)
  function openPedGate(pos, dt) {
    if (!SH.anim) return;
    const l = SH.L(pos.x, pos.z);
    if (Math.abs(l.a - GATE_IN.a) < 1.6 && l.b > -7.6 && l.b < -2.0) SH.anim.ped = Math.min(1, SH.anim.ped + dt * 2.5);
  }

  // ---------------------------------------------------------------- friends (optional)
  let fr = null;   // { car, col, crew: [person], state, t }
  function carFactory() {
    const T = typeof TrafficModels !== 'undefined' ? TrafficModels : null; if (!T) return null;   // top-level const, not on window
    for (const k of ['swift', 'dzire', 'alto', 'bolero']) if (typeof T[k] === 'function') { try { const v = T[k](); if (v && v.g) return v; } catch (e) {} }
    return null;
  }
  const alongA = () => { const p0 = SH.W(0, 0), p1 = SH.W(1, 0); return Math.atan2(p1.x - p0.x, p1.z - p0.z); };
  function friendsArrive() {
    if (fr || !ready) return;
    const car = carFactory(); if (!car) { console.warn('visitors: no car model for friends'); return; }
    scene.add(car.g);
    fr = { car, col: null, crew: [], state: 'drive', t: 0, from: -55 };
    const s = W(lanePt(fr.from)); car.g.position.set(s.x, 0, s.z); car.g.rotation.y = alongA();
  }
  function friendsLeave() { if (fr && (fr.state === 'hang' || fr.state === 'walkin')) { fr.state = 'walkout'; for (const p of fr.crew) go(p, [GATE_IN, GATE_OUT, { a: PARK.a + 2.2, b: PARK.b + 0.9 }]); } else if (fr && fr.state === 'drive') { remove({ g: fr.car.g }); fr = null; } }
  function updateFriends(dt, player) {
    if (!fr) return;
    const car = fr.car;
    if (fr.state === 'drive' || fr.state === 'driveoff') {
      fr.t += dt;
      const to = fr.state === 'drive' ? PARK.a : 30, l = SH.L(car.g.position.x, car.g.position.z);
      const rem = to - l.a, v = Math.min(8, Math.max(1.2, Math.abs(rem) * 0.9)) * Math.sign(rem);
      const b = fr.state === 'drive' ? lanePt(0).b + (PARK.b - lanePt(0).b) * Math.min(1, Math.max(0, 1 - Math.abs(rem) / 10)) : PARK.b;
      const p = W({ a: l.a + v * dt, b }); car.g.position.set(p.x, 0, p.z);
      (car.wheels || []).forEach(w => { w.rotation.x += v * dt / 0.3; });
      if (fr.state === 'drive' && Math.abs(rem) < 0.15) {
        fr.state = 'park'; fr.t = 0;
        const c = car.g.position, hw = 0.9, hl = (car.len || 3.9) / 2;
        if (world.addCollider) fr.col = world.addCollider(c.x, c.z, hw, hl, car.g.rotation.y);
      }
      if (fr.state === 'driveoff' && l.a > 28) { remove({ g: car.g }); fr = null; }
      return;
    }
    if (fr.state === 'park' && (fr.t += dt) > 1.2) {
      const looks = [{ gender: 'm', top: 'tshirt', bottom: 'jeans', topColor: 0xc62828, hair: 'sidepart', acc: { watch: true } },
        { gender: 'm', top: 'shirt', bottom: 'trousers', topColor: 0xf3efe6, bottomColor: 0x2b2b2b, hair: 'curly', acc: { sunglasses: true } }];
      looks.forEach((ap, i) => {
        const p = person(Object.assign(HumanModel.randomAppearance('m'), ap), 1.3), s = W({ a: PARK.a + 1.6 - i * 0.9, b: PARK.b + 1.1 });
        p.g.position.set(s.x, 0, s.z); go(p, [{ a: GATE_OUT.a - 1.2 - i * 1.1, b: GATE_OUT.b - 0.2 }, GATE_OUT, GATE_IN, HANG[i]]);   // single file through the 1.1 m gate
        fr.crew.push(p);
      });
      fr.state = 'walkin';
    }
    let allDone = true; fr.greetCd = (fr.greetCd || 0) - dt;
    for (const [i, p] of fr.crew.entries()) {
      if (p.bubble.userData.life > 0 && (p.bubble.userData.life -= dt) <= 0) p.bubble.visible = false;
      openPedGate(p.g.position, dt);
      if (fr.state === 'walkin' || fr.state === 'walkout') { if (!stepPath(p, dt)) allDone = false; else { p.t += dt; HumanModel.animateIdle(p.h.parts, p.t); } continue; }
      // hang out: face the player when near (and chat), otherwise face each other
      const near = player && dist(player, p.g.position) < 5;
      const other = fr.crew[1 - i] || p;
      turnTo(p.g, faceAngle(p.g.position, near ? player : other.g.position), dt, 2.5);
      if (near && fr.greetCd <= 0 && i === ((fr.turn || 0) & 1)) { say(p, FRIEND_LINES[(fr.line = ((fr.line || 0) + 1)) % FRIEND_LINES.length], 3.2); fr.greetCd = 4.5; fr.turn = (fr.turn || 0) + 1; }
      talkPose(p, dt, p.bubble.visible);
    }
    if (fr.state === 'walkin' && allDone) fr.state = 'hang';
    if (fr.state === 'walkout' && allDone) {
      fr.crew.forEach(remove); fr.crew = [];
      if (fr.col && world.removeCollider) world.removeCollider(fr.col); fr.col = null;
      fr.state = 'driveoff';
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
    lab.innerHTML = '<input type="checkbox" id="friendsVisit"> Friends visit the safe house (arrive by car)';
    set.appendChild(lab);
    const cb = lab.querySelector('input'); cb.checked = friendsOn;
    cb.addEventListener('change', e => setFriends(e.target.checked));
  }

  // ---------------------------------------------------------------- hooks
  GameHooks.init.push(game => {
    G = game; world = game.world; scene = game.scene;
    addSettingsToggle();
    // SafeHouse2 is published from its own init hook (runs before ours); wait a tick if it is not there yet
    const start = () => {
      SH = window.SafeHouse2;
      if (!SH || typeof HumanModel === 'undefined') { if ((start.n = (start.n || 0) + 1) < 50) setTimeout(start, 200); return; }
      root = new THREE.Group(); root.name = 'visitors'; scene.add(root);
      chairObj = chair(); const c = W(CHAIR); chairObj.position.set(c.x, 0.12, c.z);
      chairObj.rotation.y = Math.atan2(-(SH.W(0, 1).x - SH.W(0, 0).x), -(SH.W(0, 1).z - SH.W(0, 0).z)); root.add(chairObj);
      gm = person({ elder: true, gender: 'f', skin: 0x9a6a48, face: 'oval', brows: 'thin', feet: 'chappals', feetColor: 0x6b4a2e }, 0.42);
      gm.state = 'sit'; gm.name = 'ammamma'; seatGrandma();
      ready = true;
      if (friendsOn) friendsArrive();
    };
    start();
  });
  GameHooks.update.push((dt, game) => {
    if (!ready) return;
    const cp = game.carPos, foot = game.playerMode === 'foot';
    if (SH.center && cp && Math.hypot(cp.x - SH.center.x, cp.z - SH.center.z) > 160) return;   // far away: freeze (lod.js stops drawing them)
    const player = foot && cp ? { x: cp.x, z: cp.z } : null;
    updateGrandma(dt, player);
    updateVisitor(dt);
    updateFriends(dt, player);
  });

  window.Visitors = {
    setFriends, get friends() { return friendsOn; },
    spawnVisitor, get grandma() { return gm; }, get visitor() { return visitor; }, get friendsState() { return fr && fr.state; }, get friendsGroup() { return fr; },
    strollNow() { if (gm && gm.state === 'sit') gmTimer = 0; },
  };
})();
