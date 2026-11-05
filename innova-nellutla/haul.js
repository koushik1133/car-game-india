// haul.js: farm logistics on top of the hinged tractor trolley (vehicle-dynamics.js trail()).
//  - J in a tractor hitches / unhitches a trolley; free trolleys stand beside the lanes with their sacks or cotton.
//  - NPC tractors, lorries and autos pull off the road, stop and rejoin. Near the camera a tractor also unhitches,
//    draws forward, two labourers unload the trolley, then it backs up and re-hitches.
// Cost: one InstancedMesh for sacks, two pooled low-LOD people, nothing while no site is near.
const Haul = (function () {
  const STOPPERS = { tractor: 1, lorry: 1, auto: 1 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  let G = null, sacks = null, sackN = 0, crew = [], site = null, acc = 0;
  const free = [];     // { g, wheels, handle, ax, az, th, load }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const WHITE = 0xf2f0ea, JUTE = 0xc4a26a;
  const under = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const gy = (x, z) => (typeof groundY === 'function' ? groundY(x, z) : 0);

  function dropSack(x, z, tint) {
    if (!sacks) return;
    const i = sackN++ % sacks.instanceMatrix.count;
    q.setFromAxisAngle(Y, Math.random() * 3);
    m4.compose(v3.set(x, gy(x, z) + 0.14, z), q, sc.set(1, 1, 1)); sacks.setMatrixAt(i, m4); sacks.instanceMatrix.needsUpdate = true;
    col.setHex(tint); sacks.setColorAt(i, col); if (sacks.instanceColor) sacks.instanceColor.needsUpdate = true;
    sacks.count = Math.min(sacks.instanceMatrix.count, sackN);
  }
  function register(g, th, wheels) {
    const load = g.getObjectByName('trolleyLoad'), hx = g.position.x, hz = g.position.z, ax = hx - Math.sin(th) * 2.55, az = hz - Math.cos(th) * 2.55;
    const cx = ax, cz = az;
    const rec = { g, th, wheels, load, ax, az, handle: G.world.addCollider ? G.world.addCollider(cx, cz, 1.1, 1.65, th) : null };
    free.push(rec); return rec;
  }
  // drop the trolley where it stands (front resting on its jack)
  function unhitch(v) {
    const T = VehicleDynamics.hitchState(v); if (!T) return null;
    const g = v.g, tg = v.trailer, rot = g.rotation.y, th = rot + T.rel, hx = g.position.x + Math.sin(rot) * T.hz, hz = g.position.z + Math.cos(rot) * T.hz;
    const wheels = (v.wheels || []).filter(w => under(w, tg));
    g.remove(tg); G.scene.add(tg); tg.position.set(hx, gy(hx, hz), hz); tg.rotation.set(0, th, 0);
    v.wheels = v.wheels.filter(w => !under(w, tg)); if (v._wh) v._wh = v._wh.filter(w => !under(w.obj, tg));
    const ud = g.userData; if (ud.solo) { v._dimsTowed = ud.dims; ud.dims = { length: ud.solo.length, width: ud.solo.width, cz: ud.solo.cz, cx: 0 }; v._dims = null; }
    v.trailer = null; v._tr = null;
    return register(tg, th, wheels);
  }
  function hitch(v, rec) {
    const i = free.indexOf(rec); if (i < 0) return false;
    free.splice(i, 1); if (G.world.removeCollider && rec.handle != null) G.world.removeCollider(rec.handle);
    const g = rec.g, wx = g.position.x, wz = g.position.z;
    G.scene.remove(g); v.g.add(g); g.position.set(0, 0, -1.35); g.rotation.set(0, 0, 0);
    v.trailer = g; v._tr = { hz: -1.35, bar: 2.55, ax: rec.ax, az: rec.az, rel: 0, jack: false };
    v.wheels = (v.wheels || []).concat(rec.wheels);
    if (v._wh) rec.wheels.forEach(w => v._wh.push({ obj: w, r: 0.5, front: false, ry0: 0 }));
    if (v._dimsTowed) { v.g.userData.dims = v._dimsTowed; v._dimsTowed = null; v._dims = null; }
    return true;
  }
  function eyeOf(v) { const r = v.g.rotation.y; return { x: v.g.position.x - Math.sin(r) * 1.35, z: v.g.position.z - Math.cos(r) * 1.35 }; }
  function nearestFree(v, reach) {
    const e = eyeOf(v); let best = null, bd = reach;
    for (const f of free) { const d = Math.hypot(f.g.position.x - e.x, f.g.position.z - e.z); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  // ---------------------------------------------------------------- unloading site: two labourers shuttle sacks to a heap
  function ensureCrew() {
    if (crew.length || typeof HumanModel === 'undefined') return;
    for (let i = 0; i < 2; i++) {
      const h = HumanModel.create(Object.assign(HumanModel.randomAppearance('m'), { lod: 'low', bottom: 'lungi', acc: {} }));
      const sack = new THREE.Mesh(sacks.geometry, new THREE.MeshLambertMaterial({ color: JUTE })); sack.position.set(0, 1.45, 0); sack.rotation.y = 1.2; h.group.add(sack);
      h.group.visible = false; G.scene.add(h.group); crew.push({ h, sack, t: i * 0.45, ph: 0 });
    }
  }
  function startSite(rec) {
    if (site || !rec.load || !rec.load.visible) return false;
    ensureCrew(); if (!crew.length) return false;
    const a = rec.th, sx = Math.cos(a), sz = -Math.sin(a), side = rec.side || 1;
    const fromX = rec.ax + sx * side * 1.2, fromZ = rec.az + sz * side * 1.2;
    site = { rec, fromX, fromZ, toX: fromX + sx * side * 3.2, toZ: fromZ + sz * side * 3.2, left: 12, n: 12, tint: rec.load.material.color.getHex() > 0xe00000 ? WHITE : JUTE };
    crew.forEach(c => { c.h.group.visible = true; }); return true;
  }
  function updateSite(dt) {
    if (!site) return;
    const S = site;
    for (const c of crew) {
      c.t += dt / 7;                              // 7 s round trip: 3.4 m each way at walking pace, a pause at each end
      if (c.t >= 1) { c.t -= 1; }
      const u = c.t, out = u < 0.45, back = u > 0.5 && u < 0.95, k = out ? u / 0.45 : back ? 1 - (u - 0.5) / 0.45 : u < 0.5 ? 1 : 0;
      const wasCarry = c.carry; c.carry = out; c.sack.visible = out;
      if (wasCarry && !out && S.left > 0) { dropSack(S.toX + rnd(-0.7, 0.7), S.toZ + rnd(-0.6, 0.6), S.tint); S.left--; S.rec.load.scale.y = 0.08 + 0.47 * S.left / S.n; S.rec.load.position.y = 1.15 + 0.5 * S.left / S.n; }
      const x = S.fromX + (S.toX - S.fromX) * k, z = S.fromZ + (S.toZ - S.fromZ) * k, g = c.h.group;
      g.position.set(x, gy(x, z), z); g.rotation.y = Math.atan2(S.toX - S.fromX, S.toZ - S.fromZ) + (back ? Math.PI : 0);
      c.ph += dt * 7; if (out || back) HumanModel.animateWalk(c.h.parts, c.ph, 1.3); else HumanModel.animateIdle(c.h.parts, c.ph, dt);
    }
    if (S.left <= 0) { S.rec.load.visible = false; crew.forEach(c => { c.h.group.visible = false; }); site = null; }
  }

  // ---------------------------------------------------------------- NPC stop plan, called from updateTraffic for 'drive' mode
  function shoulderClear(t, sl) {
    const B = t.box, w = G.world, dl = sl - t.lat, lx = B.fz, lz = -B.fx;
    for (const a of [-B.hl - 2, 0, B.hl + 2, B.hl + 10]) {
      const p = { x: B.x + B.fx * a + lx * dl, z: B.z + B.fz * a + lz * dl };
      const c = w.collide(p, B.hw + 0.2); if (c && c.hit) return false;
      if (w.insideBuilding(p.x, p.z, 0.3) || w.surfaceAt(p.x, p.z) === 'river') return false;
    }
    return true;
  }
  function plan(t, dt, off, far) {
    const S = t.stp || (t.stp = { st: 'run', T: rnd(20, 120) }), keep = { lat: S.sl, cruise: 0 };
    const camD = () => Math.hypot(t.g.position.x - G.camera.position.x, t.g.position.z - G.camera.position.z);
    switch (S.st) {
      case 'run':
        S.T -= dt;
        if (t.trailer && far) { const l = t.trailer.getObjectByName('trolleyLoad'); if (l && !l.visible) { l.visible = true; l.scale.y = 0.55; l.position.y = 1.65; } }   // re-loaded out of sight
        if (S.T > 0 || t.cur < 2 || t.s < 30 || t.s > t.len - 30 || t.r.t === 'highway') return null;
        S.sl = t.r.w / 2 + t.W / 2 + 0.35;
        if (!shoulderClear(t, S.sl)) { S.T = rnd(4, 12); return null; }
        S.st = 'pull'; return { lat: S.sl, cruise: 3 };
      case 'pull':
        if (Math.abs(t.lat - S.sl) < 0.25) S.st = 'halt';
        return { lat: S.sl, cruise: Math.min(t.speed, 3) };
      case 'halt':
        if (t.cur < 0.1) {
          if (t.trailer && !far && camD() < 140 && !site) {
            S.rec = unhitch(t); S.rec.side = 1; S.x0 = t.s; S.st = 'aside'; S.T = 30; return { lat: S.sl, cruise: 1.6 };
          }
          S.st = 'wait'; S.T = t.model === 'auto' ? rnd(10, 22) : t.model === 'lorry' ? rnd(25, 50) : rnd(20, 40);
        }
        return keep;
      case 'aside':
        if (Math.abs(t.s - S.x0) >= 7) { startSite(S.rec); S.st = 'wait'; S.T = 95; return keep; }
        return { lat: S.sl, cruise: 1.6 };
      case 'wait':
        S.T -= dt;
        if (S.T <= 0) { if (S.rec && free.includes(S.rec)) S.st = 'back'; else { S.rec = null; S.st = 'rejoin'; } }
        return keep;
      case 'back':
        t.s += Math.sign(S.x0 - t.s) * 1.2 * dt;
        if (Math.abs(t.s - S.x0) < 0.08) { t.s = S.x0; hitch(t, S.rec); S.rec = null; S.st = 'rejoin'; }
        return keep;
      case 'rejoin':
        if (Math.abs(t.lat - off) < 0.4) { S.st = 'run'; S.T = rnd(60, 200); return null; }
        return { lat: off, cruise: 3 };
    }
    return null;
  }

  function init(g) {
    G = g;
    const geo = new THREE.SphereGeometry(0.34, 8, 6); geo.scale(1.25, 0.62, 0.8);
    sacks = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 96); sacks.count = 0; sacks.castShadow = true; sacks.frustumCulled = false; sacks.name = 'sacks';
    sacks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(96 * 3).fill(1), 3); g.scene.add(sacks);   // setColorAt would size it from count, which is 0 here
    // free trolleys on the verge of dirt lanes, each with a finished heap beside it
    const roads = g.world.roads.filter(r => (r.t === 'dirt' || r.t === 'lane') && r.p.length >= 2);
    let made = 0, guard = 0, seed = 20261103; const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    while (made < 6 && guard++ < 200 && roads.length) {
      const r = roads[R() * roads.length | 0], i = R() * (r.p.length - 1) | 0, a = r.p[i], b = r.p[i + 1], t = R();
      const ang = Math.atan2(b[0] - a[0], b[1] - a[1]), lx = Math.cos(ang), lz = -Math.sin(ang), side = R() < 0.5 ? 1 : -1, off = r.w / 2 + 1.7;
      const hx = a[0] + (b[0] - a[0]) * t + lx * side * off, hz = a[1] + (b[1] - a[1]) * t + lz * side * off, ax = hx - Math.sin(ang) * 2.55, az = hz - Math.cos(ang) * 2.55;
      const ok = [[hx, hz], [ax, az], [ax - Math.sin(ang) * 1.6, az - Math.cos(ang) * 1.6]].every(([x, z]) => { const c = g.world.collide({ x, z }, 1.2); return !(c && c.hit) && !g.world.insideBuilding(x, z, 0.5) && g.world.surfaceAt(x, z) === 'field'; });
      if (!ok || free.some(f => Math.hypot(f.ax - ax, f.az - az) < 60)) continue;
      const v = TrafficModels.trolley(); v.g.position.set(hx, gy(hx, hz), hz); v.g.rotation.y = ang; v.g.userData.bar = 2.55; g.scene.add(v.g);
      const rec = register(v.g, ang, v.wheels); rec.side = side;
      const white = rec.load && rec.load.material.color.getHex() > 0xe00000;
      for (let k = 0; k < 7; k++) dropSack(ax + lx * side * (2.6 + R() * 1.2), az + lz * side * (2.6 + R() * 1.2) + (R() - 0.5) * 1.5, white ? WHITE : JUTE);
      if (rec.load) { rec.load.scale.y = 0.3; rec.load.position.y = 1.35; }
      made++;
    }
    console.log('haul.js:', made, 'free trolleys');
  }
  GameHooks.init.push(init);
  GameHooks.update.push((dt, g) => {
    updateSite(dt);
    if ((acc += dt) < 0.5) return; acc = 0;
    const c = g.camera.position;           // parked trolleys vanish at distance, like parked vehicles
    for (const f of free) f.g.visible = Math.abs(f.g.position.x - c.x) + Math.abs(f.g.position.z - c.z) < 260;
  });
  GameHooks.key.push((e) => {
    if (e.code !== 'KeyJ' || e.repeat) return false;
    const P = Player, a = P.active;
    if (P.mode !== 'vehicle' || !a || a.model !== 'tractor') return false;
    if (Math.abs(carSpeed) > 5) { showComboPopup('STOP TO HITCH'); return true; }
    if (a.trailer) { unhitch(a); showComboPopup('TROLLEY UNHITCHED'); }
    else { const f = nearestFree(a, 3); if (f && hitch(a, f)) showComboPopup('TROLLEY HITCHED'); else showComboPopup('BACK UP TO A TROLLEY'); }
    return true;
  });
  return { STOPPERS, plan, hitch, unhitch, free, get site() { return site; } };
})();
window.Haul = Haul;
