// player.js: GTA-style get out (F), walk around, take any vehicle.
// The Crysta keeps its own physics (updatePhysics in index.html); every other vehicle uses driveVehicle() below.
// carPos / carRot / carSpeed always describe whatever the player controls right now.
const Player = (function () {
  // per-kind tuning: top km/h, accel m/s², brake m/s², reverse m/s, turn (yaw gain), steerRate, offroad (1 = full grip anywhere), half width
  const PARAMS = {
    bike:        { name: 'BIKE',          top: 95,  accel: 6.0, brake: 9,   rev: 2.5, turn: 2.6, steerRate: 7,  turnFade: 14, offroad: 0.35, hw: 0.45, gears: 5, lean: true },
    auto:        { name: 'AUTO RICKSHAW', top: 60,  accel: 3.2, brake: 7,   rev: 3,   turn: 3.2, steerRate: 12, turnFade: 9,  offroad: 0.3,  hw: 0.75, gears: 4 },
    hatch:       { name: 'HATCHBACK',     top: 150, accel: 4.2, brake: 9,   rev: 4,   turn: 2.1, steerRate: 6,  turnFade: 18, offroad: 0.1,  hw: 0.85, gears: 5 },
    suv:         { name: 'SUV',           top: 160, accel: 3.8, brake: 8.5, rev: 4,   turn: 1.9, steerRate: 5,  turnFade: 18, offroad: 0.5,  hw: 0.95, gears: 5 },
    tractor:     { name: 'TRACTOR',       top: 30,  accel: 2.2, brake: 6,   rev: 2.5, turn: 1.5, steerRate: 4,  turnFade: 12, offroad: 1.0,  hw: 1.0,  gears: 3 },
    lorry:       { name: 'LORRY',         top: 85,  accel: 1.3, brake: 4.5, rev: 2.5, turn: 1.0, steerRate: 2.5, turnFade: 12, offroad: 0.4, hw: 1.2,  gears: 6 },
    bus:         { name: 'RTC BUS',       top: 90,  accel: 1.2, brake: 4.5, rev: 2.5, turn: 0.9, steerRate: 2.5, turnFade: 12, offroad: 0.3, hw: 1.3,  gears: 6 },
    bullockCart: { name: 'BULLOCK CART',  top: 8,   accel: 0.8, brake: 3,   rev: 0.8, turn: 1.0, steerRate: 3,  turnFade: 4,  offroad: 0.9,  hw: 0.9,  gears: 1 },
  };
  const CRYSTA_HW = 0.95, CRYSTA_LEN = 4.7;

  // where the driver sits in each TrafficModels vehicle (local x, seat height, local z, HumanModel.sit pose);
  // the same numbers traffic-models.js uses for its AI drivers
  const SEATS = {
    bike: [0, 0.9, -0.28, 'bike'], auto: [0, 0.9, 0.08, 'car'], hatch: [0.36, 0.62, -0.25, 'car'], suv: [0.38, 0.86, -0.2, 'car'],
    tractor: [0, 1.42, -0.5, 'car'], lorry: [-0.55, 1.5, 3.0, 'car'], bus: [-0.7, 1.3, 4.3, 'car'], bullockCart: [0, 1.1, 0.45, 'bench'],
  };
  const CAM_NAMES = ['CHASE', 'CLOSE CHASE', 'COCKPIT', 'HOOD', 'TOP-DOWN'];
  const FOOT_CAM_NAMES = ['SHOULDER', 'FAR', 'FIRST PERSON', 'LOW CLOSE', 'TOP-DOWN'];

  let mode = 'crysta';             // 'crysta' | 'vehicle' | 'foot' | 'passenger'
  let active = null;               // the non-Crysta vehicle being driven (or ridden in as a passenger)
  let lastLeft = null;             // the vehicle the player last got out of (lower priority for the next F)
  const parked = [];               // vehicles standing still with collision: { g, len, hw, rot, crysta?, wheels, tail, model }
  const crystaState = { rot: 0 };
  const fleeing = [];              // carjacked drivers running away: { h, t, vx, vz, phase }
  let passengerExit = null;        // auto-rides.js: called when the player leaves a ride with F / R

  // ---------------------------------------------------------------- on-foot villager
  const ped = { vy: 0, y: 0, phase: 0, speed: 0 };
  // villager built by people-models.js (HumanModel); parts are jointed groups we swing in walk()
  // Fixed default look (blue shirt, checked lungi, short hair, stubble, chappals). Only gender/outfit/colours used to
  // be passed, so normalize() re-rolled hair (incl. 'curly'), face, beard and lungi colour on every load; the look the
  // user liked is this one. A character saved in the creator still replaces it (character-creator.js).
  const human = HumanModel.create({ gender: 'm', top: 'shirt', bottom: 'lungi', topColor: 0x2f6fb3, bottomColor: 0xf4cccc, color: 0x2f6fb3,
    skin: 0x8d5a3b, hair: 'short', hairColor: 0x141210, facial: 'stubble', face: 'oval', brows: 'medium', eyes: 0x2a1a10,
    feet: 'chappals', feetColor: 0x5a3a24, acc: {}, height: 1, build: 1 });
  const body = human.group, hp = human.parts;
  body.visible = false;                                         // added to the scene on first exit

  // ---------------------------------------------------------------- helpers
  const fwdOf = r => ({ x: Math.sin(r), z: Math.cos(r) });
  // distance from point to a vehicle's long axis, and the closest axis point
  function axisDist(x, z, v) {
    const len = v.len2 ? v.len2 * 2 : v.len;       // traffic items reuse .len for the route length
    const f = fwdOf(v.g.rotation.y), half = Math.max(0, len / 2 - v.hw);
    const t = THREE.MathUtils.clamp((x - v.g.position.x) * f.x + (z - v.g.position.z) * f.z, -half, half);
    const cx = v.g.position.x + f.x * t, cz = v.g.position.z + f.z * t;
    return { d: Math.hypot(x - cx, z - cz), cx, cz };
  }
  // push a point {x,z} of radius r out of every parked vehicle; returns the push normal or null
  function pushOutParked(p, r) {
    let hit = null;
    for (const v of parked) {
      const a = axisDist(p.x, p.z, v), min = v.hw + r;
      if (a.d < min) {
        const nx = a.d > 0.001 ? (p.x - a.cx) / a.d : 1, nz = a.d > 0.001 ? (p.z - a.cz) / a.d : 0;
        p.x = a.cx + nx * min; p.z = a.cz + nz * min; hit = { nx, nz };
      }
    }
    return hit;
  }
  function setHud() {
    const el = document.getElementById('veh');
    if (el) el.textContent = mode === 'foot' ? 'ON FOOT' : mode === 'crysta' ? 'CRYSTA' : mode === 'passenger' ? 'PASSENGER' : (active.p || PARAMS[active.model] || PARAMS.hatch).name;
  }
  // the AI driver is the first HumanModel added to a TrafficModels group (driver before passengers)
  function driverOf(v) { return v.g.children.find(o => o.userData && o.userData.human && o !== body) || null; }

  // ---------------------------------------------------------------- the player's own body in a seat
  function seatBody(v, seat) {
    const s = seat || SEATS[v.model] || SEATS.hatch;
    if (body.parent) body.parent.remove(body);
    v.g.add(body);
    body.position.set(s[0], s[1] - human.hipHeight, s[2]); body.rotation.set(0, 0, 0);
    body.userData.pose = s[3];
    HumanModel.sit(hp, s[3]);
    body.visible = true;
  }
  function unseatBody() {
    if (body.parent && body.parent !== scene) { body.parent.remove(body); }
    if (!body.parent) scene.add(body);
    body.userData.pose = null; body.rotation.set(0, 0, 0);
    HumanModel.animateIdle(hp, 0);
  }

  // ---------------------------------------------------------------- carjacking: the AI driver gets out and runs
  function shout() { const w = ['అరే!', 'అరే! ఏంటిది?!', 'దొంగ! దొంగ!', 'అయ్యో!']; return w[Math.random() * w.length | 0]; }
  function ejectDriver(v, run) {
    const d = driverOf(v); if (!d) return false;
    const h = d.userData.humanRef;
    v.g.updateMatrixWorld(true);
    const rot = v.g.rotation.y, side = { x: -Math.cos(rot), z: Math.sin(rot) }, off = (v.hw || 0.9) + 0.5;
    v.g.remove(d);
    if (!run || !h) return true;                        // parked / stored vehicles: nobody to animate
    scene.add(d);
    const x = v.g.position.x + side.x * off, z = v.g.position.z + side.z * off;
    d.position.set(x, 0, z); d.rotation.set(0, 0, 0);
    // run away from the vehicle, a bit backwards, with some randomness
    const a = Math.atan2(side.x, side.z) + (Math.random() - 0.5) * 0.9;
    fleeing.push({ g: d, h, t: 0, a, phase: 0 });
    HumanModel.animateIdle(h.parts, 0);
    showComboPopup(shout());
    return true;
  }
  function updateFleeing(dt) {
    for (let i = fleeing.length - 1; i >= 0; i--) {
      const f = fleeing[i]; f.t += dt;
      const spd = f.t < 0.6 ? 0.8 : 4.4;                // step out, then run
      if (f.t > 0.6 && f.t < 0.75) f.a += (Math.random() - 0.5) * 0.4;
      const p = { x: f.g.position.x + Math.sin(f.a) * spd * dt, z: f.g.position.z + Math.cos(f.a) * spd * dt };
      const c = world.collide(p, 0.3); if (c && c.hit) f.a += 0.8;
      f.g.position.set(p.x, 0, p.z); f.g.rotation.y = f.a;
      f.phase += spd * dt * 3.2; HumanModel.animateWalk(f.h.parts, f.phase, spd);
      if (f.t > 7) { scene.remove(f.g); fleeing.splice(i, 1); }
    }
  }
  function setTail(v, on) { v.tail.forEach(m => m.material.color.setHex(on ? 0xff1a1a : 0x661111)); }

  // ---------------------------------------------------------------- get in / out
  // a spot where the walker (radius WALK_R) can stand: no wall within reach, not in a building footprint, not
  // in any vehicle, and reachable from the vehicle without crossing a wall (so never the far side of a compound wall)
  const WALK_R = 0.4;
  function vehicleAt(x, z, r, skip) {
    for (const v of parked) if (v !== skip && v.g && axisDist(x, z, v).d < v.hw + r) return v;
    for (const v of traffic) if (v !== skip && v.g && v.hw && axisDist(x, z, v).d < v.hw + r) return v;
    const P = window.Parked && Parked.vehicles;
    if (P) for (const it of P) { if (it.claimed || Math.abs(it.x - x) > 8 || Math.abs(it.z - z) > 8) continue; if (pkDist(x, z, it) < r) return it; }
    return null;
  }
  function spotFree(x, z, fx, fz, skip) {
    const q = { x, z }, c = world.collide(q, WALK_R);
    if (c && c.hit) return false;
    if (world.insideBuilding && world.insideBuilding(x, z, 0.25)) return false;
    if (vehicleAt(x, z, WALK_R, skip)) return false;
    // line of sight from the seat to the spot: no wall segment or building edge in between
    const L = Math.hypot(x - fx, z - fz), n = Math.max(2, Math.ceil(L / 0.2));
    for (let i = 1; i < n; i++) {
      const k = i / n, s2 = { x: fx + (x - fx) * k, z: fz + (z - fz) * k }, c2 = world.collide(s2, 0.06);
      if (c2 && c2.hit) return false;
      if (world.insideBuilding && world.insideBuilding(s2.x, s2.z, 0)) return false;
    }
    return true;
  }
  // GTA order: driver door (right-hand drive = right side), passenger door, behind, in front, then hop over
  // the roof / slide out further away. null = nowhere to stand.
  function findExit(cx, cz, rot, hw, len, self) {
    const f = fwdOf(rot), rt = { x: -Math.cos(rot), z: Math.sin(rot) }, side = hw + WALK_R + 0.2, end = len / 2 + WALK_R + 0.25;
    const C = [];
    for (const sd of [1, -1]) for (const t of [0, -0.6, 0.6, -1.2]) C.push([sd * side, t]);
    for (const t of [-end, end]) for (const l of [0, 0.6, -0.6]) C.push([l, t]);
    for (const sd of [1, -1]) for (const t of [0, -0.8, 0.8]) C.push([sd * (side + 1.0), t]);   // roof-hop / further out
    for (const [l, t] of C) {
      const x = cx + rt.x * l + f.x * t, z = cz + rt.z * l + f.z * t;
      if (Math.abs(t) > 0.01 && Math.abs(l) > 0.01 && Math.abs(t) > len / 2) continue;
      if (spotFree(x, z, cx, cz, self)) return { x, z };
    }
    return null;
  }
  function exitTo(rot, spot) {
    carPos.set(spot.x, 0, spot.z);
    carRot = rot; ped.dir = rot; carSpeed = 0; ped.vy = 0; ped.air = false; ped.jumpHeld = true;
    ped.y = groundAt(spot.x, spot.z); lastSafe.x = spot.x; lastSafe.z = spot.z;
    unseatBody();
    mode = 'foot'; body.visible = true; isReversing = false; currentGear = '-'; engineRPM = 800;
    camSnap = true;
    showComboPopup('ON FOOT');
  }
  function getOut() {
    if (mode === 'passenger') { const v = active; if (passengerExit) passengerExit(v); leavePassenger(); return; }
    if (Math.abs(carSpeed) > 15) { showComboPopup('SLOW DOWN TO GET OUT'); return; }
    if (mode === 'crysta') {
      const spot = findExit(playerCarGroup.position.x, playerCarGroup.position.z, carRot, CRYSTA_HW, CRYSTA_LEN, null);
      if (!spot) { showComboPopup('NO SPACE TO GET OUT'); return; }
      crystaState.rot = carRot; vel.x = vel.z = 0; yawRate = 0;
      const c = { g: playerCarGroup, len: CRYSTA_LEN, hw: CRYSTA_HW, crysta: true };
      parked.push(c); lastLeft = c;
      exitTo(carRot, spot);
    } else {
      const v = active, spot = findExit(v.g.position.x, v.g.position.z, v.g.rotation.y, v.hw, v.len || 4, v);
      if (!spot) { showComboPopup('NO SPACE TO GET OUT'); return; }
      setTail(v, false);
      v.g.rotation.z = 0;
      parked.push(v); active = null; lastLeft = v;
      exitTo(v.g.rotation.y, spot);
    }
    setHud();
  }
  // parked.js instanced vehicles (not yet in any list): distance from a point to their body
  function pkDist(x, z, it) {
    const fx = Math.sin(it.rot), fz = Math.cos(it.rot), half = Math.max(0, it.hl - it.hw);
    const t = THREE.MathUtils.clamp((x - it.x) * fx + (z - it.z) * fz, -half, half);
    return Math.hypot(x - it.x - fx * t, z - it.z - fz * t) - it.hw;
  }
  // ONE candidate search for both the on-screen hint and F: Player's parked list (Crysta, vehicles you left,
  // property garages), traffic (carjack) and parked.js's instanced vehicles. Anything within PICK_R of its
  // body counts; the one you face wins, the vehicle you just left only when nothing else is close.
  const PICK_R = 2.5;
  function pickVehicle() {
    let best = null;
    const fx = Math.sin(carRot), fz = Math.cos(carRot);
    const score = (d, cx, cz, extra) => {
      const dx = cx - carPos.x, dz = cz - carPos.z, n = Math.hypot(dx, dz) || 1;
      const facing = (dx * fx + dz * fz) / n;                 // 1 = straight ahead, -1 = behind
      return Math.max(0, d) + (1 - facing) * 0.6 + extra;
    };
    const consider = (v, list) => {
      if (!v || !v.g) return;
      const a = axisDist(carPos.x, carPos.z, v), d = a.d - v.hw; if (d > PICK_R) return;
      const sc = score(d, a.cx, a.cz, v === lastLeft ? 1.2 : 0);
      if (!best || sc < best.score) best = { v, d, list, score: sc };
    };
    parked.forEach(v => consider(v, parked));
    traffic.forEach(t => { if (!t.g) return; if (!t.hw) t.hw = (PARAMS[t.model] || PARAMS.hatch).hw; if (t.noJack) return; consider(t, traffic); });
    // parked.js claims its own nearest item by plain distance on F, so rank those by plain distance (+ a
    // constant): whichever of them wins here is exactly the one parked.js hands over
    const P = window.Parked && Parked.vehicles;
    if (P) {
      let pb = null;
      for (const it of P) { if (it.claimed || Math.abs(it.x - carPos.x) > 12 || Math.abs(it.z - carPos.z) > 12) continue;
        const d = pkDist(carPos.x, carPos.z, it); if (d < PICK_R && (!pb || d < pb.d)) pb = { it, d }; }
      if (pb) { const sc = Math.max(0, pb.d) + 0.3; if (!best || sc < best.score) best = { v: null, pk: pb.it, d: pb.d, list: null, score: sc }; }
    }
    return best;
  }
  // parked.js's F hook turns the instanced vehicle into a traffic item; find it (or run the hooks ourselves when
  // F came from the gamepad / another path that skipped them)
  function claimedParked(it) {
    const find = () => traffic.find(t => t.parked && t.g && Math.abs(t.g.position.x - it.x) < 0.01 && Math.abs(t.g.position.z - it.z) < 0.01);
    let t = find();
    if (!t && typeof GameHooks !== 'undefined') {
      const e = { code: 'KeyF', key: 'f', repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} };
      for (const f of GameHooks.key) { try { f(e, window.GAME); } catch (err) {} }
      t = find();
    }
    return t;
  }
  let hintPick = null, hintAt = 0;
  function getIn() {
    let best = pickVehicle();
    // the hint said a vehicle was there a moment ago: honour it (the player only shuffled a few cm since)
    if (!best && hintPick && performance.now() - hintAt < 1000) best = hintPick;
    if (best && best.pk) {
      const t = claimedParked(best.pk);
      best = t ? { v: t, list: traffic } : null;
    }
    if (!best || !best.v) { showComboPopup('NO VEHICLE NEARBY'); return; }
    hintPick = null;
    const v = best.v;
    // a vehicle can sit in both lists (properties.js stored vehicles): take it out of both
    for (const L of [parked, traffic]) { const i = L.indexOf(v); if (i >= 0) L.splice(i, 1); }
    lastLeft = null;
    if (v.crysta) {
      body.visible = false; unseatBody(); body.visible = false;
      mode = 'crysta';
      carPos.set(playerCarGroup.position.x, 0.44, playerCarGroup.position.z); carRot = crystaState.rot;
      vel.x = vel.z = 0; yawRate = 0; carSpeed = 0; lastSpeed = 0; gearIdx = 0; isReversing = false; currentGear = 1;
      snapCameraToCar();
    } else {
      // carjack: a traffic vehicle with an AI driver stops, the driver gets out and runs
      const jacked = best.list === traffic && !v.parked && !v._propSlot && !!driverOf(v);
      if (jacked) { ejectDriver(v, true); v.cur = 0; }
      else ejectDriver(v, false);                          // any leftover driver mesh goes; the player drives now
      mode = 'vehicle'; active = v;
      if (v.len2) { v.len = v.len2 * 2; delete v.len2; }               // body length, no longer the route length
      v.p = PARAMS[v.model] || PARAMS.hatch;
      v.vF = jacked ? 0 : (v.vF || 0); v.vL = 0; v.yawRate = 0; v.steer = 0;
      carPos.set(v.g.position.x, 0, v.g.position.z); carRot = v.g.rotation.y;
      carSpeed = v.lastSpeed = v.vF * 3.6;
      seatBody(v);
      camSnap = true;
      if (v.onTaken) try { v.onTaken(v); } catch (e) {}
    }
    showComboPopup(mode === 'crysta' ? 'INNOVA CRYSTA' : v.p.name);
    setHud();
  }
  function toggle() { if (mode === 'foot') getIn(); else getOut(); hintT = 1; if (hintEl && mode !== 'foot') hintEl.style.display = 'none'; }

  // ---------------------------------------------------------------- riding as a passenger (auto-rides.js drives)
  function enterPassenger(v, seat) {
    if (mode !== 'foot') return false;
    for (const L of [parked, traffic]) { const i = L.indexOf(v); if (i >= 0) L.splice(i, 1); }
    mode = 'passenger'; active = v; v.p = PARAMS[v.model] || PARAMS.auto;
    if (!v.len || v.len > 20) v.len = v.len2 ? v.len2 * 2 : 2.8;
    seatBody(v, seat || [0.3, 0.88, -0.85, 'bench']);
    carPos.set(v.g.position.x, 0, v.g.position.z); carRot = v.g.rotation.y; carSpeed = 0;
    camSnap = true; setHud();
    return true;
  }
  function leavePassenger() {
    if (mode !== 'passenger') return;
    const v = active; active = null;
    const x = v.g.position.x, z = v.g.position.z, r = v.g.rotation.y;
    // auto-rides.js has already let us go: take the best free spot, else the kerb side (the safety net in walk()
    // then pushes us clear of anything solid)
    const spot = findExit(x, z, r, v.hw || 0.75, v.len && v.len < 20 ? v.len : 2.8, v) || { x: x - Math.cos(r) * ((v.hw || 0.75) + 0.6), z: z + Math.sin(r) * ((v.hw || 0.75) + 0.6) };
    exitTo(r, spot);
    setHud();
  }

  // ---------------------------------------------------------------- generic vehicle dynamics (everything except the Crysta)
  function driveVehicle(dt, v) {
    const P = v.p;
    // traffic crashes scale carSpeed from outside; mirror that onto our speed
    if (Math.abs(carSpeed - v.lastSpeed) > 0.01) { const k = Math.abs(v.lastSpeed) > 0.1 ? carSpeed / v.lastSpeed : 0; v.vF *= k; v.vL *= k; }
    surface = world.surfaceAt(carPos.x, carPos.z);
    if (typeof bundY === 'function' && bundY(carPos.x, carPos.z) > 0.05) v.vF *= 1 - 1.5 * dt;   // bump and scrub speed crossing a field bund
    const mu = MU[surface] + (1 - MU[surface]) * P.offroad;
    const top = P.top / 3.6 * (0.45 + 0.55 * mu);
    const steerIn = (typeof padIn !== 'undefined' && Math.abs(padIn.steer) > 0.12) ? padIn.steer : (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    const centring = !steerIn || Math.sign(steerIn) !== Math.sign(v.steer);
    v.steer += (steerIn - v.steer) * Math.min(1, dt * P.steerRate * (centring ? 1.6 : 1));

    let braking = false;
    if (inputState.gas) {
      if (v.vF < -0.3) { v.vF = Math.min(0, v.vF + P.brake * dt); braking = true; }
      else v.vF = Math.min(top, v.vF + P.accel * mu * Math.max(0.15, 1 - v.vF / top) * dt);
    } else if (inputState.brake) {
      if (v.vF > 0.3) { v.vF = Math.max(0, v.vF - P.brake * mu * dt); braking = true; }
      else v.vF = Math.max(-P.rev, v.vF - P.accel * 0.6 * dt);
    } else {
      const coast = (0.8 + CRR[surface] * 20) * dt + v.vF * v.vF * 0.0008 * dt;
      v.vF -= Math.sign(v.vF) * Math.min(Math.abs(v.vF), coast);
    }
    if (v.vF > top) v.vF -= (v.vF - top) * Math.min(1, dt * 2);       // too fast for this surface
    if (inputState.drift) { v.vF -= Math.sign(v.vF) * Math.min(Math.abs(v.vF), P.brake * 0.5 * dt); braking = true; }

    // yaw: steering bites with speed, fades at high speed; handbrake swings the tail
    let targetYaw = v.steer * P.turn * THREE.MathUtils.clamp(v.vF / 5, -1, 1) / (1 + Math.abs(v.vF) / P.turnFade);
    if (inputState.drift && Math.abs(v.vF) > 6) targetYaw *= 1.6;
    v.yawRate += (targetYaw - v.yawRate) * Math.min(1, dt * 8 * mu);
    carRot += v.yawRate * dt;
    // sideways slip from collisions dies off with grip
    v.vL -= THREE.MathUtils.clamp(v.vL, -mu * 9.81 * dt, mu * 9.81 * dt);

    const f = fwdOf(carRot), l = { x: Math.cos(carRot), z: -Math.sin(carRot) };
    let vx = f.x * v.vF + l.x * v.vL, vz = f.z * v.vF + l.z * v.vL;
    carPos.x += vx * dt; carPos.z += vz * dt;
    const [x0, z0, x1, z1] = world.bounds;
    carPos.x = Math.max(x0 + 5, Math.min(x1 - 5, carPos.x)); carPos.z = Math.max(z0 + 5, Math.min(z1 - 5, carPos.z));

    // collisions at front and back of the body
    const o = Math.max(0, v.len / 2 - v.hw);
    for (const s of [o, -o]) {
      const p = { x: carPos.x + f.x * s, z: carPos.z + f.z * s }, px = p.x, pz = p.z;
      let c = typeof wallProbeRadius === 'function' ? (wallProbeRadius(p.x, p.z, v.hw + 0.1) ? world.collide(p, wallProbeRadius(p.x, p.z, v.hw + 0.1)) : { hit: false }) : world.collide(p, v.hw + 0.1);
      const pc = pushOutParked(p, v.hw * 0.8);
      if (!c.hit && pc) c = { hit: true, nx: pc.nx, nz: pc.nz };
      if (c.hit) {
        carPos.x += p.x - px; carPos.z += p.z - pz;
        const vn = vx * c.nx + vz * c.nz;
        if (vn < 0) {
          // remove only the push into the wall; keep sliding along it, nose follows the wall on glancing hits
          vx -= 1.2 * vn * c.nx; vz -= 1.2 * vn * c.nz;
          const keep = 1 - Math.min(0.35, -vn * 0.025); vx *= keep; vz *= keep;
          const sp = Math.hypot(vx, vz);
          if (sp > 3) {
            let want = Math.atan2(vx, vz); if (vx * f.x + vz * f.z < 0) want += Math.PI;
            let d = want - carRot; d = Math.atan2(Math.sin(d), Math.cos(d));
            if (Math.abs(d) < 0.9) carRot += d * Math.min(1, -vn * 0.08 + 0.15);
          }
          const f2 = fwdOf(carRot), l2 = { x: Math.cos(carRot), z: -Math.sin(carRot) };
          v.vF = vx * f2.x + vz * f2.z; v.vL = vx * l2.x + vz * l2.z; v.yawRate *= 0.6;
          if (-vn > 8) showComboPopup('BUMP!');
        }
      }
    }
    carSpeed = v.vF * 3.6; v.lastSpeed = carSpeed;

    // visuals: wheels, brake lights, bike lean
    v.g.position.set(carPos.x, typeof groundY === 'function' ? groundY(carPos.x, carPos.z) : 0, carPos.z);
    v.g.rotation.y = carRot;
    // bikes lean the whole machine about the tyre contact line (both wheels stay down); cars roll on springs
    const lean = P.lean ? THREE.MathUtils.clamp(-v.yawRate * v.vF * 0.05, -0.55, 0.55) : 0;
    v.g.rotation.z += (lean - v.g.rotation.z) * Math.min(1, dt * 6);
    suspend(v, dt, !!P.lean);
    for (const w of v.wheels) w.rotation.x += v.vF * dt / 0.4;
    setTail(v, braking || v.vF < -0.1);
    isReversing = v.vF < -0.1;
    currentGear = 1 + Math.floor(Math.min(0.99, Math.abs(v.vF) / (P.top / 3.6)) * P.gears);
    engineRPM = 800 + (Math.abs(v.vF) / (P.top / 3.6) * P.gears % 1) * 2600 + (inputState.gas ? 400 : 0);
  }

  // ---------------------------------------------------------------- walking
  // floors you can stand on: feature modules (safehouse.js interiors, steps, plinths) push meshes into
  // window.WALKABLES; the walker steps up to STEP_UP and falls down to anything lower. Ground is groundY().
  const STEP_UP = 0.25, rayDown = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), rayO = new THREE.Vector3();
  function floorAt(x, z, y) {
    const W = window.WALKABLES; if (!W || !W.length) return -1e9;
    const near = W.filter(m => m && m.parent && (!m.userData.bx || Math.abs(m.userData.bx - x) + Math.abs(m.userData.bz - z) < 60));
    if (!near.length) return -1e9;
    rayO.set(x, y + STEP_UP + 0.05, z); rayDown.set(rayO, DOWN); rayDown.far = y + STEP_UP + 0.6;
    const h = rayDown.intersectObjects(near, true)[0];
    return h ? h.point.y : -1e9;
  }
  function groundAt(x, z) { return typeof groundY === 'function' ? groundY(x, z) : 0; }

  // safety net: standing in a building footprint (bad exit, teleport, reload, glitch) -> out through the nearest
  // wall; otherwise remember the spot as the last good one
  const lastSafe = { x: 0, z: 0 };
  function unstick(p) {
    if (!world.insideBuilding) return false;
    let moved = false;
    for (let k = 0; k < 4; k++) {
      const b = world.insideBuilding(p.x, p.z, 0); if (!b || !b.p) break;
      // a walkable interior (safehouse) is meant to be walked in
      if (ped.y > groundAt(p.x, p.z) + 0.08 || floorAt(p.x, p.z, ped.y) > -1e8) break;
      let best = null;
      for (let i = 0; i < b.p.length; i++) {
        const A = b.p[i], B = b.p[(i + 1) % b.p.length], dx = B[0] - A[0], dz = B[1] - A[1], L2 = dx * dx + dz * dz || 1e-6;
        const t = Math.max(0, Math.min(1, ((p.x - A[0]) * dx + (p.z - A[1]) * dz) / L2));
        const ex = A[0] + dx * t, ez = A[1] + dz * t, d = Math.hypot(p.x - ex, p.z - ez);
        if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, ex, ez, nx: dz / L, nz: -dx / L }; }
      }
      // outward = away from the inside point; fall back to the edge normal pointing away from the centroid
      let ox = best.ex - p.x, oz = best.ez - p.z, ol = Math.hypot(ox, oz);
      if (ol < 1e-3) { let cx = 0, cz = 0; b.p.forEach(q => { cx += q[0]; cz += q[1]; }); cx /= b.p.length; cz /= b.p.length;
        ox = best.nx; oz = best.nz; if ((best.ex - cx) * ox + (best.ez - cz) * oz < 0) { ox = -ox; oz = -oz; } ol = 1; }
      p.x = best.ex + ox / ol * (WALK_R + 0.15); p.z = best.ez + oz / ol * (WALK_R + 0.15);
      world.collide(p, WALK_R); moved = true;
    }
    if (moved && (lastSafe.x || lastSafe.z) && world.insideBuilding(p.x, p.z, 0) && !(floorAt(p.x, p.z, ped.y) > -1e8)) { p.x = lastSafe.x; p.z = lastSafe.z; }
    return moved;
  }

  // jump: edge-triggered (holding Space doesn't bunny-hop), a short jump buffer and coyote time like GTA
  const JUMP_V = 4.6, GRAV = 11, COYOTE = 0.12, BUFFER = 0.12;
  // latch the key press itself, so a tap shorter than a frame still jumps (inputState only shows held keys)
  addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || mode !== 'foot') return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    ped.buffer = BUFFER; ped.jumpHeld = true;
  });
  // split a traffic-model vehicle into wheels + sprung body (once), then run the shared suspension
  function suspend(v, dt, bike) {
    if (typeof VehicleSuspension === 'undefined' || typeof groundY !== 'function') return;
    if (!v.susp) {
      const ws = (v.wheels || []).filter(w => w.parent === v.g);
      const sb = new THREE.Group(); sb.name = 'sprung';
      [...v.g.children].forEach(ch => { if (!ws.includes(ch)) sb.add(ch); });
      v.g.add(sb);
      v.susp = { body: sb, st: {}, lastV: v.vF || 0, acc: 0, wheels: ws.map(w => ({ obj: w, x: w.position.x, z: w.position.z, baseY: w.position.y })) };
    }
    const S = v.susp, a = ((v.vF || 0) - S.lastV) / Math.max(dt, 1e-4); S.lastV = v.vF || 0;
    S.acc += (THREE.MathUtils.clamp(a, -12, 12) - S.acc) * Math.min(1, dt * 10);
    if (!S.wheels.length) return;
    VehicleSuspension.step(S.st, v.g, S.body, S.wheels, { dt, speed: v.vF || 0, longAcc: S.acc, latAcc: (v.yawRate || 0) * (v.vF || 0),
      ground: groundY, rough: VehicleSuspension.roughAt, bike, pitchK: bike ? 0.003 : 0.005 });
  }
  function walk(dt) {
    surface = world.surfaceAt(carPos.x, carPos.z);
    const turn = (typeof padIn !== 'undefined' && Math.abs(padIn.steer) > 0.12) ? padIn.steer : (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    const move = (inputState.gas ? 1 : 0) - (inputState.brake ? 1 : 0);
    let want, f;
    if (rigView()) {
      // PUBG: W/A/S/D relative to the camera; the body turns smoothly to face where it's going
      // ix = LEFT component (A = +1): the camera's left is yaw + 90 deg (its right is (-cos, sin) = yaw - 90 deg),
      // so the world heading is yaw + atan2(left, forward). (Was -turn: A/D were mirrored.)
      const ix = turn, iz = move, m = Math.min(1, Math.hypot(ix, iz));
      if (m > 0.01) {
        ped.dir = wrap(moveYaw() + Math.atan2(ix, iz));
        // shortest arc; an exact 180 deg reversal picks one side and keeps it (no flip-flop at +-pi)
        let dd = wrap(ped.dir - carRot);
        if (Math.abs(dd) > Math.PI - 0.05) dd = (ped.turnSide || 1) * Math.abs(dd); else ped.turnSide = Math.sign(dd) || 1;
        carRot = wrap(carRot + dd * (1 - Math.exp(-dt * 12)));
      }
      want = m * (inputState.nos ? 5.6 : 2.2) * (ped.land > 0 ? 0.5 : 1);
      f = m > 0.01 ? fwdOf(ped.dir) : fwdOf(ped.dir !== undefined ? ped.dir : carRot);
    } else {
      // first person / low / top-down: tank controls
      ped.turn = (ped.turn || 0) + (turn - (ped.turn || 0)) * (1 - Math.exp(-dt * 12));
      carRot += ped.turn * 2.6 * dt; ped.dir = carRot;
      want = move * (inputState.nos ? 5.6 : 2.2) * (move < 0 ? 0.6 : 1) * (ped.land > 0 ? 0.5 : 1);
      f = fwdOf(carRot);
    }
    ped.speed += (want - ped.speed) * (1 - Math.exp(-dt * (ped.air ? 3 : want ? 10 : 12)));   // little air control
    // move in slices no longer than half the walker radius: a thin compound wall can never be skipped
    const sx = f.x * ped.speed * dt, sz = f.z * ped.speed * dt, n = Math.max(1, Math.ceil(Math.hypot(sx, sz) / (WALK_R * 0.5)));
    const p = { x: carPos.x, z: carPos.z };
    for (let i = 0; i < n; i++) { p.x += sx / n; p.z += sz / n; world.collide(p, WALK_R); pushOutParked(p, WALK_R); }
    unstick(p);
    if (!world.insideBuilding || !world.insideBuilding(p.x, p.z, 0)) { lastSafe.x = p.x; lastSafe.z = p.z; }
    // against a wall: keep only the actual movement so the walk cycle and camera don't jitter
    const moved = Math.hypot(p.x - carPos.x, p.z - carPos.z) / Math.max(dt, 1e-4);
    if (moved < Math.abs(ped.speed) * 0.5) ped.speed *= 0.8;
    carPos.x = p.x; carPos.z = p.z;

    // vertical: ground (road / bund height) or the highest walkable under the feet
    const floor = Math.max(groundAt(carPos.x, carPos.z), floorAt(carPos.x, carPos.z, ped.y));
    if (!ped.air && ped.y < floor && floor - ped.y <= STEP_UP + 0.02) ped.y = floor;          // step up onto plinths / stairs
    const grounded = !ped.air && ped.y <= floor + 0.03;
    ped.coyote = grounded ? COYOTE : (ped.coyote || 0) - dt;
    const jumpKey = !!inputState.drift;
    ped.buffer = jumpKey && !ped.jumpHeld ? BUFFER : (ped.buffer || 0) - dt;
    ped.jumpHeld = jumpKey;
    if (ped.buffer > 0 && ped.coyote > 0 && !(ped.land > 0.1)) { ped.vy = JUMP_V; ped.air = true; ped.coyote = 0; ped.buffer = 0; }
    if (grounded && !ped.air) { ped.y = floor; ped.vy = 0; }
    else {
      ped.vy -= GRAV * dt; ped.y += ped.vy * dt; ped.air = true;
      if (ped.y <= floor && ped.vy <= 0) {                                   // land (on the ground, a step, a roof)
        if (ped.vy < -2) ped.land = Math.min(0.3, 0.1 + -ped.vy * 0.03);
        ped.y = floor; ped.vy = 0; ped.air = false;
      } else if (ped.y < floor) ped.y = floor;                               // brushing a step edge on the way up
    }
    if (ped.land > 0) ped.land -= dt;
    carPos.y = ped.y;
    carSpeed = ped.speed * 3.6;
    // walk cycle, then the jump / landing pose on top
    ped.phase += Math.abs(ped.speed) * dt * 3.2;
    if (ped.air) jumpPose(ped.vy);
    else if (Math.abs(ped.speed) > 0.05) HumanModel.animateWalk(hp, ped.phase, ped.speed);
    else {
      // turning in place: shuffle the feet round with the body (rate from the heading change)
      const tr = wrap(carRot - (ped.lastRot === undefined ? carRot : ped.lastRot)) / Math.max(dt, 1e-4);
      if (Math.abs(tr) > 0.6 && HumanModel.animateTurn) HumanModel.animateTurn(hp, performance.now() / 1000, tr);
      else HumanModel.animateIdle(hp, performance.now() / 1000);
    }
    ped.lastRot = carRot;
    if (!ped.air && ped.land > 0) landPose(ped.land);
    body.position.set(carPos.x, ped.y + (ped.air ? 0 : Math.abs(Math.sin(ped.phase)) * 0.04 * Math.min(1, Math.abs(ped.speed))), carPos.z);
    body.rotation.y = carRot;
    engineRPM = 800; currentGear = '-'; isReversing = false;
  }
  // airborne: knees tucked on the way up, legs reaching for the ground on the way down, arms out for balance
  function jumpPose(vy) {
    const up = THREE.MathUtils.clamp(vy / JUMP_V, -1, 1), tuck = 0.5 + up * 0.35;
    hp.hips.position.set(0, 0.92, 0); hp.hips.rotation.set(0, 0, 0);
    hp.legL.rotation.set(-0.35 - tuck * 0.5, 0, 0.05); hp.legR.rotation.set(-0.1 - tuck * 0.2, 0, -0.05);
    hp.shinL.rotation.x = 0.5 + tuck * 0.9; hp.shinR.rotation.x = 0.3 + tuck * 0.6;
    hp.armL.rotation.set(-0.5 - up * 0.4, 0, 0.45); hp.armR.rotation.set(-0.3 - up * 0.3, 0, -0.45);
    hp.foreL.rotation.x = -0.6; hp.foreR.rotation.x = -0.6;
    hp.torso.rotation.set(0.12 - up * 0.08, 0, 0); hp.head.rotation.set(-0.08, 0, 0);
  }
  // landing: a short knee bend that springs back
  function landPose(t) {
    const k = Math.min(1, t / 0.15);
    hp.hips.position.y = 0.92 - 0.14 * k;
    hp.legL.rotation.x = -0.55 * k; hp.legR.rotation.x = -0.55 * k;
    hp.shinL.rotation.x = 1.0 * k; hp.shinR.rotation.x = 1.0 * k;
    hp.torso.rotation.x = 0.3 * k; hp.armL.rotation.x = -0.3 * k; hp.armR.rotation.x = -0.3 * k;
  }

  // ---------------------------------------------------------------- cameras for walking and non-Crysta vehicles
  // cameraIndex (V / gamepad Y) is shared with the Crysta: 0 chase, 1 close chase, 2 cockpit, 3 hood, 4 top-down.
  // On foot: 0 shoulder, 1 far, 2 first person, 3 low close, 4 top-down.
  let camSnap = false, lastCamIdx = -1;
  const camT = new THREE.Vector3(), look = new THREE.Vector3();
  function seatEye(v) {
    const s = body.userData.pose && body.parent === v.g ? [body.position.x, body.position.y + human.hipHeight, body.position.z] : (SEATS[v.model] || SEATS.hatch);
    return { x: s[0], y: s[1] + (s[3] === 'bike' ? 0.72 : 0.68), z: s[2] };
  }
  // local bounding box of a vehicle (without the player's body), cached
  const _bx = new THREE.Box3();
  function boxOf(v) {
    if (v._box) return v._box;
    const g = v.g, pos = g.position.clone(), rot = g.rotation.clone(), vis = body.visible, par = body.parent === g;
    if (par) g.remove(body);
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    _bx.setFromObject(g); v._box = _bx.clone();
    g.position.copy(pos); g.rotation.copy(rot); g.updateMatrixWorld(true);
    if (par) g.add(body); body.visible = vis;
    if (!isFinite(v._box.max.z)) v._box = new THREE.Box3(new THREE.Vector3(-1, 0, -2), new THREE.Vector3(1, 1.5, 2));
    return v._box;
  }
  function updateCam(dt) {
    if (rigView() && (mode === 'foot' || active)) { lastCamIdx = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; rig(dt, lastCamIdx === 1); return; }
    const f = fwdOf(carRot), r = { x: Math.cos(carRot), z: -Math.sin(carRot) };   // r = model local +x
    const idx = typeof cameraIndex === 'number' ? cameraIndex % 5 : 0;
    if (idx !== lastCamIdx) { lastCamIdx = idx; camSnap = true; }
    let firstPerson = false, smooth = mode === 'foot' ? 8 : 7;
    if (mode === 'foot') {
      const y = ped.y;
      if (idx === 1) { camT.set(carPos.x - f.x * 6.5, y + 3.2, carPos.z - f.z * 6.5); look.set(carPos.x + f.x * 2, y + 1.3, carPos.z + f.z * 2); }
      else if (idx === 2) { firstPerson = true; camT.set(carPos.x + f.x * 0.15, y + 1.58, carPos.z + f.z * 0.15); look.set(carPos.x + f.x * 10, y + 1.45, carPos.z + f.z * 10); smooth = 30; }
      else if (idx === 3) { camT.set(carPos.x - f.x * 2.0 - f.z * 0.4, y + 0.9, carPos.z - f.z * 2.0 + f.x * 0.4); look.set(carPos.x + f.x * 3, y + 1.5, carPos.z + f.z * 3); }
      else if (idx === 4) { camT.set(carPos.x, y + 32, carPos.z - 6); look.set(carPos.x, y, carPos.z); }
      else { camT.set(carPos.x - f.x * 3.4 - f.z * 0.5, y + 2.0, carPos.z - f.z * 3.4 + f.x * 0.5); look.set(carPos.x + f.x * 2, y + 1.4, carPos.z + f.z * 2); }
    } else {
      const L = active.len || 4, gy = active.g.position.y;
      if (idx === 1) {
        const d = 2.2 + L * 0.6, h = 1.2 + L * 0.2;
        camT.set(carPos.x - f.x * d, gy + h, carPos.z - f.z * d); look.set(carPos.x, gy + 1.0 + L * 0.07, carPos.z);
      } else if (idx === 2) {
        // driver's eye; passengers look out of their own seat
        const e = seatEye(active); firstPerson = true; smooth = 40;
        camT.set(carPos.x + r.x * e.x + f.x * (e.z + 0.12), gy + e.y, carPos.z + r.z * e.x + f.z * (e.z + 0.12));
        look.set(camT.x + f.x * 30, camT.y - 1.2, camT.z + f.z * 30);
      } else if (idx === 3) {
        // bike: over the handlebars at rider eye level; everything else: on the bonnet / front, scaled to its height
        const bx = boxOf(active), e = seatEye(active);
        const front = active.model === 'bike' ? e.z + 0.55 : bx.max.z - 0.25, h = active.model === 'bike' ? e.y - 0.05 : Math.max(1.0, bx.max.y * 0.62);
        camT.set(carPos.x + f.x * front, gy + h, carPos.z + f.z * front);
        look.set(camT.x + f.x * 30, camT.y - 1.6, camT.z + f.z * 30); smooth = 40;
      } else if (idx === 4) {
        camT.set(carPos.x, gy + 40 + L, carPos.z - 9); look.set(carPos.x, gy, carPos.z);
      } else {
        const d = 3.5 + L * 0.85, h = 1.6 + L * 0.28;
        camT.set(carPos.x - f.x * d, gy + h, carPos.z - f.z * d); look.set(carPos.x, gy + 1.2 + L * 0.08, carPos.z);
      }
    }
    // the player's own body would fill a first-person view
    body.visible = mode !== 'crysta' && !firstPerson;
    const back = typeof lookBack !== 'undefined' && !!lookBack;   // C / RB: look behind
    if (back) {
      if (firstPerson || idx === 3) { look.set(2 * camT.x - look.x, look.y, 2 * camT.z - look.z); }
      else { camT.set(2 * carPos.x - camT.x, camT.y, 2 * carPos.z - camT.z); look.set(2 * carPos.x - look.x, look.y, 2 * carPos.z - look.z); }
    }
    if (back !== !!updateCam.back) { updateCam.back = back; camSnap = true; }
    if (!firstPerson && idx !== 4) clipCam(mode === 'foot' ? carPos.x : carPos.x, (mode === 'foot' ? ped.y + 1.45 : look.y), carPos.z, camT, dt);
    if (camSnap) { camera.position.copy(camT); camSnap = false; }
    else camera.position.lerp(camT, 1 - Math.exp(-dt * smooth));
    if (camera.fov !== 65) { camera.fov = 65; camera.updateProjectionMatrix(); }
    camera.lookAt(look);
  }
  // camera collision: probe the ray pivot -> camera against wall segments (world.collide); pull the camera in
  // fast when something is in the way, ease it back out slowly, so it never jitters at a wall edge
  let clipK = 1;
  function clipCam(px, py, pz, cam, dt) {
    let lim = 1;
    const dx = cam.x - px, dz = cam.z - pz, L = Math.hypot(dx, dz);
    if (L > 0.5) for (let k = 0.08; k <= 1.0001; k += 0.08) {
      const q = { x: px + dx * k, z: pz + dz * k }, c = world.collide(q, 0.3);
      if (c && c.hit) { lim = Math.max(0.12, k - 0.1); break; }
    }
    clipK += (lim - clipK) * (1 - Math.exp(-dt * (lim < clipK ? 18 : 3)));
    if (clipK < 0.999) { cam.x = px + dx * clipK; cam.z = pz + dz * clipK; cam.y = py + (cam.y - py) * Math.max(clipK, 0.35); }
  }
  function cameraName() { const i = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; return (mode === 'foot' ? FOOT_CAM_NAMES : CAM_NAMES)[i]; }

  // ---------------------------------------------------------------- PUBG-style third-person camera rig (all modes)
  // R.yaw / R.pitch are the camera's own world angles (yaw = the direction the camera looks along, like carRot;
  // pitch > 0 = looking down from above). Mouse (pointer lock), drag fallback and touch drag set them directly.
  // On foot the camera sits over the right shoulder and WASD moves relative to it; in vehicles it orbits freely
  // and eases back behind the direction of travel 1.5 s after the last input. The pivot is the FINAL position
  // after physics (no lag, no jitter); only the jump height and collision distance are spring-smoothed.
  const DEG = Math.PI / 180, PITCH_MIN = -60 * DEG, PITCH_MAX = 70 * DEG, SENS = 0.0022;
  const R = { yaw: 0, pitch: 0.15, yv: 0, pv: 0, idle: 99, zoom: 1, altYaw: null, ret: false, init: false, py: 0, pyv: 0, dist: 0, dv: 0,
    lx: 0, lz: 0, vx: 0, vz: 0, fov: 65, key: '', ptrs: new Map(), pinch0: 0, zoom0: 1 };
  const FL = { get on() { return R.idle < 1.5; } };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  // critically damped spring (exact for constant target): x toward t with angular frequency w
  function spring(x, v, t, w, dt) { const d = x - t, e = Math.exp(-w * dt), nx = t + (d + (v + w * d) * dt) * e, nv = (v - w * (v + w * d) * dt) * e; return [nx, nv]; }
  function lookInput(dx, dy) { R.yaw -= dx; R.pitch = THREE.MathUtils.clamp(R.pitch + dy, PITCH_MIN, PITCH_MAX); R.idle = 0; R.yv = R.pv = 0; R.ret = false; }
  const canvasEl = () => (typeof renderer !== 'undefined' && renderer.domElement) || document.getElementById('gl');
  function isView(t) { return t && t.tagName === 'CANVAS' && (t === canvasEl() || t.id === 'gl'); }
  const playing = () => typeof isPlaying === 'undefined' || isPlaying;
  // anything that needs the cursor: map, help, settings, chat / creator / property panels (anything covering the
  // middle of the screen), a focused text field, the start menu
  function uiOpen() {
    if (!playing()) return true;
    if (document.body.classList.contains('map-open')) return true;
    const ae = document.activeElement; if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
    for (const id of ['info', 'settings']) { const el = document.getElementById(id); if (el && el.classList.contains('open')) return true; }
    const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!c && !isView(c) && c !== document.body && c !== document.documentElement;
  }
  const locked = () => document.pointerLockElement === canvasEl();
  addEventListener('pointerdown', e => {
    if (!isView(e.target) || !playing()) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0 && e.button !== 2) return;                          // middle = multiplayer ping
      if (!locked() && !uiOpen() && e.target.requestPointerLock) { try { const r = e.target.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} }
    }
    R.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    if (R.ptrs.size === 2) { const [a, b] = [...R.ptrs.values()]; R.pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; R.zoom0 = R.zoom; }
  });
  addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && locked()) { lookInput(e.movementX * SENS, e.movementY * SENS); return; }   // no drag needed
    const p = R.ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (R.ptrs.size >= 2) { const [a, b] = [...R.ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; R.zoom = THREE.MathUtils.clamp(R.zoom0 * R.pinch0 / d, 0.5, 2.5); R.idle = 0; return; }
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    const k = e.pointerType === 'touch' ? 0.009 : 0.005;                       // drag fallback / touch
    lookInput(dx * k, dy * k * 0.8);
  });
  const flUp = e => { R.ptrs.delete(e.pointerId); };
  addEventListener('pointerup', flUp); addEventListener('pointercancel', flUp);
  addEventListener('wheel', e => {
    if (!isView(e.target) || !playing()) return;
    e.preventDefault(); R.zoom = THREE.MathUtils.clamp(R.zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.5, 2.5);
  }, { passive: false });
  addEventListener('contextmenu', e => { if (isView(e.target)) e.preventDefault(); });
  // Alt: free-look that doesn't steer the walker; on release the view swings back
  addEventListener('keydown', e => { if ((e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat) { e.preventDefault(); if (R.altYaw === null) R.altYaw = R.yaw; } });
  addEventListener('keyup', e => { if ((e.code === 'AltLeft' || e.code === 'AltRight') && R.altYaw !== null) { e.preventDefault(); R.ret = R.altYaw; R.altYaw = null; } });
  addEventListener('blur', () => { if (R.altYaw !== null) { R.ret = R.altYaw; R.altYaw = null; } });

  // the direction WASD moves toward (camera yaw, or the held yaw during Alt free-look)
  function moveYaw() { return R.altYaw !== null ? R.altYaw : (typeof R.ret === 'number' ? R.ret : R.yaw); }
  // which views use the rig: chase (0) and close chase (1) everywhere
  const rigView = () => { const i = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; return i === 0 || i === 1; };

  // the rig itself: called after physics with the final position
  function rig(dt, close) {
    dt = Math.min(dt, 0.1);
    let px, gy, L, h, dist, side, sprint = false, roof = 1.6, cr = 0;
    if (mode === 'foot') {
      px = { x: carPos.x, z: carPos.z }; gy = ped.y; L = 0; h = 1.55;
      sprint = !!inputState.nos && Math.abs(ped.speed) > 3;
      dist = (close ? 1.9 : 2.55) + (sprint ? 0.35 : 0); side = close ? 0.45 : 0.55;
    } else {
      const g = mode === 'crysta' ? playerCarGroup : active.g;
      px = { x: g.position.x, z: g.position.z }; gy = g.position.y;
      const bx = mode === 'crysta' ? null : boxOf(active);
      L = mode === 'crysta' ? CRYSTA_LEN : Math.max(1.8, (active.len && active.len < 30 ? active.len : 4));
      roof = bx ? bx.max.y : 1.85; cr = mode === 'crysta' ? CRYSTA_LEN / 2 : Math.max(bx.max.z, -bx.min.z, 1);
      h = roof * 0.55 + 0.9 + L * 0.06; dist = (close ? 0.7 : 1) * (3.2 + L * 0.85); side = 0;
    }
    const key = mode + ':' + (active ? active.model : '');
    if (key !== R.key || !R.init) {                                            // entered / left something: start behind it
      R.key = key; R.init = true; R.yaw = carRot; R.pitch = mode === 'foot' ? 0.12 : 0.2; R.yv = R.pv = 0; R.idle = 99; R.ret = false; R.altYaw = null;
      R.py = gy + h; R.pyv = 0; R.dist = dist; R.dv = 0; R.lx = px.x; R.lz = px.z; R.vx = R.vz = 0;
    }
    R.idle += dt;
    // travel velocity: the Crysta's physics velocity directly; other vehicles from the final positions (smoothed,
    // and reset on a teleport / respawn so a jump never swings the view)
    if (mode === 'crysta' && typeof vel !== 'undefined') { R.vx = vel.x; R.vz = vel.z; }
    else if (dt > 0) {
      const ix = (px.x - R.lx) / dt, iz = (px.z - R.lz) / dt;
      if (Math.hypot(px.x - R.lx, px.z - R.lz) > 15) { R.vx = R.vz = 0; }
      else { const k = 1 - Math.exp(-dt * 12); R.vx += (ix - R.vx) * k; R.vz += (iz - R.vz) * k; }
    }
    R.lx = px.x; R.lz = px.z;
    const spd = Math.hypot(R.vx, R.vz);
    if (typeof R.ret === 'number') {                                           // Alt released: swing back
      [R.yaw, R.yv] = spring(R.yaw, R.yv, R.yaw + wrap(R.ret - R.yaw), 14, dt);
      if (Math.abs(wrap(R.ret - R.yaw)) < 0.01) { R.yaw = R.ret; R.ret = false; R.yv = 0; }
    } else if (mode !== 'foot' && R.idle > 1.0 && R.ptrs.size === 0) {
      // follow behind the direction of travel (velocity, so a drift shows the slide) with a slight, constant lag:
      // steady-state lag of a critically damped spring = 2 * turn rate / w, i.e. ~6 deg at 30 deg/s.
      // Reversing / crawling keeps the current angle (no swing). The pull fades in over 0.6 s after mouse input.
      const fx = Math.sin(carRot), fz = Math.cos(carRot), fwdV = R.vx * fx + R.vz * fz;
      const ease = Math.min(1, (R.idle - 1.0) / 0.6);
      if (fwdV > 1.0) {
        // heading at walking pace, velocity direction once moving; a slide is followed up to 50 deg off the nose
        const a = Math.min(1, Math.max(0, (spd - 2) / 4));
        const slip = THREE.MathUtils.clamp(wrap(Math.atan2(R.vx, R.vz) - carRot), -0.87, 0.87);
        const tgt = carRot + slip * a, w = (7 + Math.min(3, spd * 0.12)) * ease;
        [R.yaw, R.yv] = spring(R.yaw, R.yv, R.yaw + wrap(tgt - R.yaw), w, dt);
        [R.pitch, R.pv] = spring(R.pitch, R.pv, 0.2, w * 0.6, dt);
      } else { R.yv *= Math.exp(-dt * 8); R.pv *= Math.exp(-dt * 8); }
    }
    R.yaw = wrap(R.yaw);
    const back = typeof lookBack !== 'undefined' && !!lookBack;
    const yaw = R.yaw + (back ? Math.PI : 0), pitch = back ? 0.2 : R.pitch;
    // only the vertical (jumps, kerbs) is smoothed; horizontal follows exactly
    [R.py, R.pyv] = spring(R.py, R.pyv, gy + h, mode === 'foot' ? 14 : 10, dt);
    [R.dist, R.dv] = spring(R.dist, R.dv, dist * R.zoom, 6, dt);
    const fwd = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    const rt = { x: -Math.cos(yaw), z: Math.sin(yaw) };                       // camera right
    const pv = { x: px.x + rt.x * side, y: R.py, z: px.z + rt.z * side };     // over the right shoulder
    const cam = new THREE.Vector3(pv.x - fwd.x * R.dist, pv.y - fwd.y * R.dist, pv.z - fwd.z * R.dist);
    clipCam(pv.x, pv.y, pv.z, cam, dt);
    cam.y = Math.max(cam.y, gy + 0.3, (typeof groundY === 'function' ? groundY(cam.x, cam.z) : 0) + 0.25);
    // never inside the vehicle body: pulled in closer than its half length -> go over the roof
    if (mode !== 'foot') { const dh = Math.hypot(cam.x - px.x, cam.z - px.z); if (dh < cr + 0.4) cam.y = Math.max(cam.y, gy + roof + 0.5); }
    camera.position.copy(cam);
    camera.lookAt(cam.x + fwd.x * 10, cam.y + fwd.y * 10, cam.z + fwd.z * 10);
    // FOV: a little wider with speed / sprint
    const kmh = Math.abs(carSpeed), fovT = 65 + (mode === 'foot' ? (sprint ? 5 : 0) : Math.min(12, kmh * 0.07)) + (typeof isNosActive !== 'undefined' && isNosActive && mode === 'crysta' ? 6 : 0);
    R.fov += (fovT - R.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(camera.fov - R.fov) > 0.01) { camera.fov = R.fov; camera.updateProjectionMatrix(); }
    if (mode !== 'crysta') body.visible = true;
    if (typeof updateCamera !== 'undefined') updateCamera.yaw = yaw;
    camSnap = false;
  }
  // per frame (after the camera): release the pointer when a menu / map / chat opens
  function freeLook(dt) {
    if (locked() && uiOpen()) { try { document.exitPointerLock(); } catch (e) {} }
  }
  // the Crysta's chase views (crysta.js updateCamera) use the same rig
  function crystaRig(dt) { if (mode !== 'crysta' || !rigView()) return false; rig(dt, ((typeof cameraIndex === 'number' ? cameraIndex : 0) % 5) === 1); return true; }

  function update(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120) - 1e-6)), h = dt / n;   // sub-steps: frame-rate independent, no tunnelling
    for (let i = 0; i < n; i++) { if (mode === 'foot') walk(h); else if (mode === 'vehicle') driveVehicle(h, active); }
    if (mode === 'passenger' && active) {
      // auto-rides.js moves the auto; the player just goes along
      carPos.set(active.g.position.x, 0, active.g.position.z); carRot = active.g.rotation.y;
      carSpeed = active.kmh || 0; isReversing = false; currentGear = '-'; engineRPM = 800;
    }
    if ((mode === 'vehicle' || mode === 'passenger') && body.userData.pose) {
      // re-apply the seated pose (the character creator can rebuild the body), lean into the steering
      HumanModel.sit(hp, body.userData.pose);
      if (mode === 'vehicle' && active) { const s = active.steer || 0; hp.torso.rotation.y = s * 0.12; hp.head.rotation.y = s * 0.25; }
    }
  }
  // every frame, whatever the mode: carjacked drivers keep running
  let hintT = 0, hintEl = null;
  function tick(dt) {
    if (fleeing.length) updateFleeing(dt);
    // on foot: say which vehicle F will take
    if ((hintT += dt) < 0.25) return; hintT = 0;
    if (!hintEl) { hintEl = document.createElement('div'); hintEl.id = 'enterHint'; hintEl.style.cssText = 'position:fixed;left:50%;bottom:calc(120px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:8px;background:rgba(10,15,25,.75);color:#e5e7eb;font:600 13px system-ui,sans-serif;pointer-events:none;display:none;white-space:nowrap'; document.body.appendChild(hintEl); }
    const b = mode === 'foot' && (typeof isPlaying === 'undefined' || isPlaying) ? pickVehicle() : null;
    hintPick = b; hintAt = performance.now();
    if (!b) { hintEl.style.display = 'none'; return; }
    const v = b.v, name = b.pk ? (PARAMS[b.pk.kind] || PARAMS.hatch).name : v.crysta ? 'INNOVA CRYSTA' : (PARAMS[v.model] || PARAMS.hatch).name;
    const jack = !!v && traffic.includes(v) && !v.parked && !v._propSlot && !!driverOf(v);
    hintEl.innerHTML = '<b style="color:#fbbf24">F</b> ' + (jack ? 'Take' : 'Get in') + ' · ' + name;
    hintEl.style.display = 'block';
  }
  // R key: whatever you are doing, go back to the Crysta (respawnCar then moves it)
  function resetToCrysta() {
    if (mode === 'crysta') return;
    if (mode === 'passenger') { if (passengerExit) passengerExit(active); unseatBody(); active = null; }
    if (mode === 'vehicle') { active.g.rotation.z = 0; setTail(active, false); unseatBody(); parked.push(active); active = null; }
    const i = parked.findIndex(v => v.crysta); if (i >= 0) parked.splice(i, 1);
    body.visible = false; mode = 'crysta'; lastLeft = null; setHud();
  }
  // the Crysta also bumps into parked vehicles
  function crystaCollide() {
    const p = { x: carPos.x, z: carPos.z };
    const h = pushOutParked(p, 1.1);
    if (h) {
      carPos.x = p.x; carPos.z = p.z;
      // remove only the velocity into the parked vehicle (old code halved carSpeed every frame = stuck)
      const vn = vel.x * h.nx + vel.z * h.nz;
      if (vn < 0) { vel.x -= 1.2 * vn * h.nx; vel.z -= 1.2 * vn * h.nz; if (-vn > 6) showComboPopup('BUMP!'); }
      carSpeed = lastSpeed = (vel.x * Math.sin(carRot) + vel.z * Math.cos(carRot)) * 3.6;
    }
  }

  // external modules (properties.js garages) register a parked vehicle: collision + enterable with F
  function addParked(v) {
    if (!v || !v.g || parked.includes(v)) return;
    if (v.len2) { v.len = v.len2 * 2; delete v.len2; }
    if (!v.len) v.len = 4;
    if (!v.hw) v.hw = (PARAMS[v.model] || PARAMS.hatch).hw;
    if (!v.wheels) v.wheels = [];
    if (!v.tail) v.tail = [];
    parked.push(v);
  }
  return { addParked, toggle, crystaRig, update, updateCam, resetToCrysta, crystaCollide, setHud, tick, freeLook, cameraName, enterPassenger, leavePassenger, PARAMS, SEATS,
    set onPassengerExit(f) { passengerExit = f; }, get freeLookOn() { return FL.on; }, get fleeing() { return fleeing; }, get body() { return human; }, get mode() { return mode; }, get active() { return active; } };
})();
