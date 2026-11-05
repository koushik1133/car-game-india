// knock.js: loose street clutter that the player's vehicle can knock over (three.js r128, no physics library).
// The village pass in nellutla-world.js merges drums, buckets, pots and parked prop cycles into one mesh per 120 m cell
// and records each one in world.clutter.items. When the player's vehicle (Crysta or any driven vehicle) touches one
// above ~5 km/h, the prop is hidden in the merged mesh and replaced by a loose copy driven by a tiny rigid-body step:
// it is flung along the impact, topples about its leading base edge (cylinders then roll across their axis, cycles lie
// on their side), slides with ground friction, bounces off world colliders, and sleeps once at rest. A sleeping prop is
// shoved again if driven into. Loose props are hidden with the clutter LOD (cell mesh not visible) or beyond 120 m.
// Real bikes / scooters (traffic, parked.js lots and yards) are handled by player.js knockBike, which shares the 5 km/h
// threshold and the slide step style.
(function () {
  if (typeof GameHooks === 'undefined') return;
  const MIN_KMH = 5, FAR = 120, G = 9.81;
  // r: footprint radius, h: height, m: mass (kg), mu: sliding friction, roll: rolls when lying (cylinder)
  const SPEC = {
    bucket: { r: 0.17, h: 0.32, m: 1.5, mu: 0.45, roll: true },
    pot:    { r: 0.2,  h: 0.44, m: 4,   mu: 0.5,  roll: true },
    drum:   { r: 0.3,  h: 0.9,  m: 18,  mu: 0.55, roll: true },
    cycle:  { r: 0.45, h: 1.0,  m: 14,  mu: 0.7,  roll: false, len: 0.85 },
  };
  let C = null, grid = null, bodies = [], ready = false;
  const CELL = 10, key = (i, j) => i * 100003 + j;
  function init() {
    if (typeof world === 'undefined' || !world || !world.clutter || !world.clutter.items) return false;
    C = world.clutter; grid = new Map();
    for (const p of C.items) {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(p);
    }
    return (ready = true);
  }
  function makeBody(p, dirx, dirz) {
    const S = SPEC[p.k], mat = C.material.clone();
    if (p.tint) mat.color.copy(p.tint);
    const geo = C.protos[p.k];
    const g = new THREE.Group(), t = new THREE.Group(), m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(t); t.add(m); scene.add(g);
    const b = { p, S, g, t, m, x: p.x, z: p.z, vx: 0, vz: 0, ang: 0, angV: 0, spin: 0, sleep: false, still: 0 };
    if (S.roll) {
      // pivot about the base edge on the leading side: local -x is the push direction
      const yaw = Math.atan2(dirz, -dirx);
      g.rotation.y = yaw; t.position.x = -S.r; m.position.x = S.r;
      b.target = Math.PI / 2;
    } else {
      // cycle: keeps its parked heading, falls to the side the push comes from (lies on the far side)
      g.rotation.y = p.ang;
      const sx = Math.cos(p.ang), sz = -Math.sin(p.ang);                  // local +x in world (cycle's long axis)
      const side = -dirx * sz + dirz * sx;                                  // push component along local +z
      t.rotation.order = 'XYZ'; b.target = (side >= 0 ? 1 : -1) * 1.32; b.axisX = true;
    }
    g.position.set(p.x, typeof groundY === 'function' ? groundY(p.x, p.z) : 0, p.z);
    C.hide(p); p.body = b; bodies.push(b);
    return b;
  }
  // player's vehicle footprint (oriented box), velocity in m/s
  function vehicle() {
    const mode = typeof Player !== 'undefined' ? Player.mode : 'crysta';
    if (mode !== 'crysta' && mode !== 'vehicle') return null;
    const a = mode === 'vehicle' ? Player.active : null;
    const hl = mode === 'crysta' ? 2.35 : Math.max(0.8, (a && a.len || 4) / 2), hw = mode === 'crysta' ? 0.95 : (a && a.hw || 0.85);
    const fx = Math.sin(carRot), fz = Math.cos(carRot), v = carSpeed / 3.6;
    return { x: carPos.x, z: carPos.z, fx, fz, hl, hw, vx: fx * v, vz: fz * v, kmh: Math.abs(carSpeed), light: !!(a && a.model === 'bike') };
  }
  // overlap of a circle (x, z, r) with the vehicle box; returns the push-out normal and depth or null
  function overlap(V, x, z, r) {
    const dx = x - V.x, dz = z - V.z, lz = dx * V.fx + dz * V.fz, lx = dx * V.fz - dz * V.fx;
    const ox = V.hw + r - Math.abs(lx), oz = V.hl + r - Math.abs(lz);
    if (ox <= 0 || oz <= 0) return null;
    if (ox < oz) { const s = Math.sign(lx) || 1; return { nx: V.fz * s, nz: -V.fx * s, d: ox }; }
    const s = Math.sign(lz) || 1; return { nx: V.fx * s, nz: V.fz * s, d: oz };
  }
  const blocked = (x, z, r) => !!(world.insideBuilding && world.insideBuilding(x, z, r * 0.5));
  function hitBody(b, V, o) {
    // shove: out of the box, and at least the vehicle's speed along the contact normal (light things fly a bit faster)
    const px = b.x, pz = b.z;
    b.x += o.nx * o.d; b.z += o.nz * o.d;
    const wall = blocked(b.x, b.z, b.S.r) && !blocked(px, pz, b.S.r);
    if (wall) { b.x = px; b.z = pz; }                                   // pinned against a house: stays, falls over
    const vn = V.vx * o.nx + V.vz * o.nz, bn = b.vx * o.nx + b.vz * o.nz;
    const want = Math.max(0, vn) * (b.S.m < 5 ? 1.35 : 1.1) + 0.6;
    if (!wall) {
      if (bn < want) { b.vx += o.nx * (want - bn); b.vz += o.nz * (want - bn); }
      // a little of the vehicle's forward motion too (dragged along the bumper)
      b.vx += V.vx * 0.15; b.vz += V.vz * 0.15;
    }
    if (b.ang === 0 && !b.S.roll) b.angV = Math.sign(b.target) * 1.5;
    if (b.S.roll && b.ang < 0.05) b.angV = 2 + Math.min(6, Math.abs(vn) * 0.6);
    b.sleep = false; b.still = 0;
  }
  function step(b, dt) {
    const S = b.S;
    // topple: gravity torque about the edge grows as it tips; small bounce when it lands
    const tgt = b.target, sgn = Math.sign(tgt) || 1;
    if (Math.abs(b.ang) < Math.abs(tgt)) {
      b.angV += sgn * (2.5 + 10 * Math.abs(Math.sin(b.ang))) * dt; b.ang += b.angV * dt;
      if (Math.abs(b.ang) >= Math.abs(tgt)) { b.ang = tgt; b.angV = -b.angV * 0.2; if (Math.abs(b.angV) < 0.4) b.angV = 0; }
    } else if (b.angV) { b.ang += b.angV * dt; b.angV += sgn * 12 * dt; if (Math.abs(b.ang) >= Math.abs(tgt)) { b.ang = tgt; b.angV = 0; } }
    const lying = Math.abs(b.ang) >= Math.abs(tgt) * 0.98;
    // ground friction (rolling cylinders: low along the rolling direction, high along the axis)
    let sp = Math.hypot(b.vx, b.vz);
    if (sp > 1e-4) {
      if (S.roll && lying) {
        const yaw = b.g.rotation.y, ax = -Math.cos(yaw), az = Math.sin(yaw);   // cylinder axis (world) after the tip
        const va = b.vx * ax + b.vz * az, px = b.vx - ax * va, pz = b.vz - az * va;
        const pa = Math.max(0, Math.abs(va) - S.mu * G * dt) * Math.sign(va);
        const pp = Math.hypot(px, pz), kp = pp > 1e-4 ? Math.max(0, pp - 0.35 * dt * G * 0.1 - pp * 0.6 * dt) / pp : 0;
        b.vx = ax * pa + px * kp; b.vz = az * pa + pz * kp;
        b.spin += (px * kp * -az + pz * kp * ax) / S.r * dt;            // roll about the axis
      } else {
        const k = Math.max(0, sp - S.mu * G * dt) / sp; b.vx *= k; b.vz *= k;
      }
    }
    const ox = b.x, oz = b.z;
    b.x += b.vx * dt; b.z += b.vz * dt;
    // house footprints (not in the collider grid): stop at the wall and drop most of the speed
    if (blocked(b.x, b.z, S.r) && !blocked(ox, oz, S.r)) { b.x = ox; b.z = oz; b.vx *= -0.2; b.vz *= -0.2; }
    // world colliders: push out and lose most of the speed into the wall
    if (world.collide) {
      const q = { x: b.x, z: b.z }; world.collide(q, S.r);
      const nx = q.x - b.x, nz = q.z - b.z, d = Math.hypot(nx, nz);
      if (d > 1e-5) { const vn = (b.vx * nx + b.vz * nz) / d; if (vn < 0) { b.vx -= 1.3 * vn * nx / d; b.vz -= 1.3 * vn * nz / d; } b.vx *= 0.5; b.vz *= 0.5; b.x = q.x; b.z = q.z; }
    }
    // a fallen cycle rests on its pedal / handlebar end, not on its centre plane
    b.g.position.set(b.x, (typeof groundY === 'function' ? groundY(b.x, b.z) : 0) + (b.axisX ? Math.abs(Math.sin(b.ang)) * 0.2 : 0), b.z);
    if (b.axisX) b.t.rotation.x = b.ang; else b.t.rotation.z = b.ang;
    if (S.roll) b.m.rotation.y = b.spin;
    sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.05 && !b.angV && (lying || b.ang === 0)) { if ((b.still += dt) > 0.4) { b.sleep = true; b.vx = b.vz = 0; } } else b.still = 0;
  }
  GameHooks.update.push(function (dt) {
    if (!ready && !init()) return;
    dt = Math.min(dt, 1 / 20);
    const V = vehicle();
    if (V) {
      // wake / knock props inside the vehicle's reach (3x3 grid cells around it)
      const i0 = Math.floor(V.x / CELL), j0 = Math.floor(V.z / CELL);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        const l = grid.get(key(i, j)); if (!l) continue;
        for (const p of l) {
          const b = p.body, S = SPEC[p.k];
          const o = overlap(V, b ? b.x : p.x, b ? b.z : p.z, S.r);
          if (!o) continue;
          if (!b) {
            if (V.kmh < MIN_KMH) continue;
            const m = p.cell.meshes && p.cell.meshes.clutter; if (!m || !m.visible) continue;   // clutter LOD off: nothing to knock
            if (V.light && S.m > 10) continue;                     // a two-wheeler doesn't bowl over a full drum
            const nb = makeBody(p, o.nx, o.nz); hitBody(nb, V, o);
            if (typeof showComboPopup === 'function' && V.kmh > 15 && Math.random() < 0.3) showComboPopup(p.k === 'cycle' ? 'CYCLE KNOCKED OVER' : 'SMASH!');
            try { if (typeof SFX !== 'undefined' && SFX.thud) SFX.thud(p.x, p.z); } catch (e) {}
          } else if (V.kmh >= 1 || !b.sleep) hitBody(b, V, o);
        }
      }
    }
    const cx = camera.position.x, cz = camera.position.z;
    for (const b of bodies) {
      const m = b.p.cell.meshes && b.p.cell.meshes.clutter;
      b.g.visible = !!(m && m.visible) && Math.abs(b.x - cx) + Math.abs(b.z - cz) < FAR * 1.4;
      if (!b.sleep && b.g.visible) step(b, dt);
    }
  });
  window.Knock = { get bodies() { return bodies; }, get items() { return C ? C.items : []; }, SPEC, MIN_KMH };
})();
