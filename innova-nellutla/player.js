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
  const human = HumanModel.create({ gender: 'm', outfit: 'lungi', color: 0x2f6fb3, skin: 0x8d5a3b });
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
  function exitTo(rot, hw) {
    // stand beside the driver's door: right-hand drive, so the right of the heading
    const rx = -Math.cos(rot), rz = Math.sin(rot), off = hw + 0.7;
    carPos.set(carPos.x + rx * off, 0, carPos.z + rz * off);
    const p = { x: carPos.x, z: carPos.z }; world.collide(p, 0.35); carPos.x = p.x; carPos.z = p.z;
    carRot = rot; carSpeed = 0; ped.y = 0; ped.vy = 0;
    unseatBody();
    mode = 'foot'; body.visible = true; isReversing = false; currentGear = '-'; engineRPM = 800;
    camSnap = true;
    showComboPopup('ON FOOT');
  }
  function getOut() {
    if (mode === 'passenger') { const v = active; if (passengerExit) passengerExit(v); leavePassenger(); return; }
    if (Math.abs(carSpeed) > 15) { showComboPopup('SLOW DOWN TO GET OUT'); return; }
    if (mode === 'crysta') {
      crystaState.rot = carRot; vel.x = vel.z = 0; yawRate = 0;
      const c = { g: playerCarGroup, len: CRYSTA_LEN, hw: CRYSTA_HW, crysta: true };
      parked.push(c); lastLeft = c;
      exitTo(carRot, CRYSTA_HW);
    } else {
      setTail(active, false);
      active.g.rotation.z = 0;
      parked.push(active); const v = active; active = null; lastLeft = v;
      exitTo(v.g.rotation.y, v.hw);
    }
    setHud();
  }
  // candidates within ~3 m of their body; the one you face wins, and the vehicle you just left only wins when
  // nothing else is close (so stepping out of the Crysta next to a bike and pressing F takes the bike)
  function pickVehicle() {
    let best = null;
    const fx = Math.sin(carRot), fz = Math.cos(carRot);
    const consider = (v, list) => {
      const a = axisDist(carPos.x, carPos.z, v), d = a.d - v.hw; if (d > 3) return;
      const dx = a.cx - carPos.x, dz = a.cz - carPos.z, n = Math.hypot(dx, dz) || 1;
      const facing = (dx * fx + dz * fz) / n;                 // 1 = straight ahead, -1 = behind
      const score = Math.max(0, d) + (1 - facing) * 0.6 + (v === lastLeft ? 1.2 : 0);
      if (!best || score < best.score) best = { v, d, list, score };
    };
    parked.forEach(v => consider(v, parked));
    traffic.forEach(t => { if (!t.hw) t.hw = (PARAMS[t.model] || PARAMS.hatch).hw; if (t.noJack) return; consider(t, traffic); });
    return best;
  }
  function getIn() {
    const best = pickVehicle();
    if (!best) { showComboPopup('NO VEHICLE NEARBY'); return; }
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
  function toggle() { if (mode === 'foot') getIn(); else getOut(); }

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
    carPos.set(v.g.position.x, 0, v.g.position.z);
    exitTo(v.g.rotation.y, v.hw || 0.75);
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
    const lean = P.lean ? THREE.MathUtils.clamp(-v.yawRate * v.vF * 0.05, -0.55, 0.55) : THREE.MathUtils.clamp(v.yawRate * v.vF * 0.006, -0.05, 0.05);
    v.g.rotation.z += (lean - v.g.rotation.z) * Math.min(1, dt * 6);
    for (const w of v.wheels) w.rotation.x += v.vF * dt / 0.4;
    setTail(v, braking || v.vF < -0.1);
    isReversing = v.vF < -0.1;
    currentGear = 1 + Math.floor(Math.min(0.99, Math.abs(v.vF) / (P.top / 3.6)) * P.gears);
    engineRPM = 800 + (Math.abs(v.vF) / (P.top / 3.6) * P.gears % 1) * 2600 + (inputState.gas ? 400 : 0);
  }

  // ---------------------------------------------------------------- walking
  // floors you can stand on: feature modules (safehouse.js interiors, steps, plinths) push meshes into
  // window.WALKABLES; the walker steps up to STEP_UP and falls down to anything lower. Ground is 0.
  const STEP_UP = 0.25, rayDown = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), rayO = new THREE.Vector3();
  function floorAt(x, z, y) {
    const W = window.WALKABLES; if (!W || !W.length) return 0;
    const near = W.filter(m => m && m.parent && (!m.userData.bx || Math.abs(m.userData.bx - x) + Math.abs(m.userData.bz - z) < 60));
    if (!near.length) return 0;
    rayO.set(x, y + STEP_UP + 0.05, z); rayDown.set(rayO, DOWN); rayDown.far = y + STEP_UP + 0.1;
    const h = rayDown.intersectObjects(near, true)[0];
    return h ? Math.max(0, h.point.y) : 0;
  }
  function walk(dt) {
    surface = world.surfaceAt(carPos.x, carPos.z);
    const turn = (typeof padIn !== 'undefined' && Math.abs(padIn.steer) > 0.12) ? padIn.steer : (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    ped.turn = (ped.turn || 0) + (turn - (ped.turn || 0)) * (1 - Math.exp(-dt * 12));   // eased turning, no snap
    carRot += ped.turn * 2.6 * dt;
    const move = (inputState.gas ? 1 : 0) - (inputState.brake ? 1 : 0);
    const want = move * (inputState.nos ? 5.6 : 2.2) * (move < 0 ? 0.6 : 1);
    ped.speed += (want - ped.speed) * (1 - Math.exp(-dt * (want ? 8 : 12)));
    const f = fwdOf(carRot);
    const p = { x: carPos.x + f.x * ped.speed * dt, z: carPos.z + f.z * ped.speed * dt };
    world.collide(p, 0.35); pushOutParked(p, 0.35);
    // against a wall: keep only the actual movement so the walk cycle and camera don't jitter
    const moved = Math.hypot(p.x - carPos.x, p.z - carPos.z) / Math.max(dt, 1e-4);
    if (moved < Math.abs(ped.speed) * 0.5) ped.speed *= 0.8;
    carPos.x = p.x; carPos.z = p.z;
    // jump: small hop with gravity
    const floor = floorAt(carPos.x, carPos.z, ped.y);
    if (floor > ped.y && floor - ped.y <= STEP_UP) ped.y = floor;      // step up onto plinths / stairs
    if (inputState.drift && ped.y <= floor + 1e-3) ped.vy = 4.2;
    ped.vy -= 14 * dt; ped.y = Math.max(floor, ped.y + ped.vy * dt); if (ped.y <= floor + 1e-4 && ped.vy < 0) ped.vy = 0;
    carPos.y = ped.y;
    carSpeed = ped.speed * 3.6;
    // walk cycle
    ped.phase += Math.abs(ped.speed) * dt * 3.2;
    if (Math.abs(ped.speed) > 0.05 || ped.y > floor + 0.01) HumanModel.animateWalk(hp, ped.phase, ped.y > floor + 0.01 ? Math.abs(ped.speed) * 0.4 : ped.speed);
    else HumanModel.animateIdle(hp, performance.now() / 1000);
    body.position.set(carPos.x, ped.y + Math.abs(Math.sin(ped.phase)) * 0.04 * Math.min(1, Math.abs(ped.speed)), carPos.z);
    body.rotation.y = carRot;
    engineRPM = 800; currentGear = '-'; isReversing = false;
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
  function updateCam(dt) {
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
        const front = L / 2 * 0.85, h = active.model === 'bike' ? 1.05 : active.model === 'bus' || active.model === 'lorry' ? 2.6 : active.model === 'tractor' ? 1.9 : 1.25;
        camT.set(carPos.x + f.x * (front - (active.model === 'bike' ? 0.6 : 0.2)), gy + h, carPos.z + f.z * (front - (active.model === 'bike' ? 0.6 : 0.2)));
        look.set(camT.x + f.x * 30, camT.y - 1.6, camT.z + f.z * 30); smooth = 40;
      } else if (idx === 4) {
        camT.set(carPos.x, gy + 40 + L, carPos.z - 9); look.set(carPos.x, gy, carPos.z);
      } else {
        const d = 3.5 + L * 0.85, h = 1.6 + L * 0.28;
        camT.set(carPos.x - f.x * d, gy + h, carPos.z - f.z * d); look.set(carPos.x, gy + 1.2 + L * 0.08, carPos.z);
      }
    }
    // the player's own body would fill a first-person view
    body.visible = mode !== 'crysta' && !(firstPerson && !FL.on);
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

  // ---------------------------------------------------------------- GTA-style free-look orbit (all modes)
  // Left- or right-drag on the 3D view (mouse), one-finger drag on the view (touch) orbits 360° around the
  // player; wheel / pinch zooms. Driving, it eases back behind the vehicle 2 s after the last input; on foot
  // it stays where you left it. Middle-click stays the multiplayer ping; the big map and touch buttons are
  // separate elements so they never reach this.
  const FL = { yaw: 0, pitch: 0, zoom: 1, idle: 99, on: false, ptrs: new Map(), pinch0: 0, zoom0: 1 };
  function isView(t) { return t && t.tagName === 'CANVAS' && (t === (typeof renderer !== 'undefined' && renderer.domElement) || t.id === 'gl'); }
  function flInput() { FL.idle = 0; FL.on = true; }
  addEventListener('pointerdown', e => {
    if (!isView(e.target) || (typeof isPlaying !== 'undefined' && !isPlaying)) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;     // middle = ping
    FL.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    if (FL.ptrs.size === 2) { const [a, b] = [...FL.ptrs.values()]; FL.pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; FL.zoom0 = FL.zoom; }
  });
  addEventListener('pointermove', e => {
    const p = FL.ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (FL.ptrs.size >= 2) {
      const [a, b] = [...FL.ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      FL.zoom = THREE.MathUtils.clamp(FL.zoom0 * FL.pinch0 / d, 0.4, 3); flInput(); return;
    }
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    const k = e.pointerType === 'touch' ? 0.009 : 0.006;
    FL.yaw -= dx * k; FL.pitch = THREE.MathUtils.clamp(FL.pitch + dy * k * 0.7, -0.45, 1.15); flInput();
  });
  const flUp = e => { FL.ptrs.delete(e.pointerId); };
  addEventListener('pointerup', flUp); addEventListener('pointercancel', flUp);
  addEventListener('wheel', e => {
    if (!isView(e.target) || (typeof isPlaying !== 'undefined' && !isPlaying)) return;
    e.preventDefault();
    FL.zoom = THREE.MathUtils.clamp(FL.zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.4, 3); flInput();
  }, { passive: false });
  addEventListener('contextmenu', e => { if (isView(e.target)) e.preventDefault(); });
  function freeLook(dt) {
    FL.idle += dt;
    if (!FL.on) return;
    const driving = mode !== 'foot';
    if (driving && FL.idle > 2 && !FL.ptrs.size) {
      // ease back behind the vehicle
      const k = 1 - Math.exp(-dt * 2.2);
      FL.yaw = Math.atan2(Math.sin(FL.yaw), Math.cos(FL.yaw)); FL.yaw -= FL.yaw * k; FL.pitch -= FL.pitch * k; FL.zoom += (1 - FL.zoom) * k;
      if (Math.abs(FL.yaw) < 0.01 && Math.abs(FL.pitch) < 0.01 && Math.abs(FL.zoom - 1) < 0.01) { FL.yaw = FL.pitch = 0; FL.zoom = 1; FL.on = false; camSnap = false; return; }
    }
    let dist, h, p0;
    if (mode === 'crysta') { dist = 6.6; h = 1.25; p0 = 0.15; }
    else if (mode === 'foot') { dist = 3.6; h = 1.45; p0 = 0.15; }
    else { const L = active.len || 4; dist = 3.8 + L * 0.85; h = 0.9 + L * 0.12; p0 = 0.2; }
    const yaw = carRot + Math.PI + FL.yaw, pitch = THREE.MathUtils.clamp(p0 + FL.pitch, -0.3, 1.35), d = dist * FL.zoom;
    const px = carPos.x, py = (mode === 'foot' ? ped.y : mode === 'crysta' ? carPos.y - 0.44 : (active ? active.g.position.y : 0)) + h, pz = carPos.z;
    const oc = new THREE.Vector3(px + Math.sin(yaw) * Math.cos(pitch) * d, Math.max(0.35, py + Math.sin(pitch) * d), pz + Math.cos(yaw) * Math.cos(pitch) * d);
    clipCam(px, py, pz, oc, dt); camera.position.copy(oc);
    camera.lookAt(px, py, pz);
    if (mode !== 'crysta') body.visible = true;
    if (typeof updateCamera !== 'undefined') updateCamera.yaw = carRot;   // Crysta chase picks up from behind
  }

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
    if (!b) { hintEl.style.display = 'none'; return; }
    const v = b.v, name = v.crysta ? 'INNOVA CRYSTA' : (PARAMS[v.model] || PARAMS.hatch).name;
    const jack = traffic.includes(v) && !v.parked && !v._propSlot && !!driverOf(v);
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
  return { addParked, toggle, update, updateCam, resetToCrysta, crystaCollide, setHud, tick, freeLook, cameraName, enterPassenger, leavePassenger, PARAMS, SEATS,
    set onPassengerExit(f) { passengerExit = f; }, get freeLookOn() { return FL.on; }, get fleeing() { return fleeing; }, get body() { return human; }, get mode() { return mode; }, get active() { return active; } };
})();
