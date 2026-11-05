// village-life.js: a Telangana village going about its day. Everything here follows the clock (timeOfDay) and stays near
// the player. Only cheap instanced meshes and the low-LOD HumanModel are used.
//   Riders   - existing traffic bikes get couples (husband riding, wife side-saddle); extra Activas carry girls in
//              salwar or kurta; extra couples and scooties go home at night (they leave the traffic list).
//   Villagers- nobody on the map stands idle any more, the crowd thins at night, and a small pool of workers walks the
//              lanes with what their hour calls for: hoe to the field at dawn, pot from the bore well, grass headload,
//              school bag, walking back at dusk.
//   Games    - kids at open spots: gilli danda, kabaddi, kho kho, goli, tyre cricket, bongaram, tokkudu billa. Daylight
//              only, nearest spots only, about 9 draw calls in all.
//   Farming  - real work on the parcels around the player, picked from the parcel's class, the month and the hour:
//              bullock and tractor ploughing, sowing, transplanting paddy, weeding, picking cotton, sickle harvest,
//              carrying sheaves, a rest at noon. Instanced: about 13 draw calls however many work; see stepFarm.
//   Birds    - crow, parrot, sparrow and pigeon flocks fly, perch on wires, feed on the ground and scatter from horns,
//              cars and people on foot. 2 draw calls. ambient.js reads VillageBirds for positional calls.
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
  let G = null, world = null, scene = null, T = 0, tier = 'high';
  const hour = () => { try { return typeof timeOfDay === 'number' ? timeOfDay : 12; } catch (e) { return 12; } };
  const gy = (x, z) => { try { return typeof groundY === 'function' ? groundY(x, z) || 0 : 0; } catch (e) { return 0; } };
  const tq = { x: 0, z: 0 };
  function blocked(x, z, r) { tq.x = x; tq.z = z; const c = world.collide(tq, r); return !!((c && c.hit) || Math.hypot(tq.x - x, tq.z - z) > 0.01 || (world.insideBuilding && world.insideBuilding(x, z, r * 0.5))); }

  // merged vertex-coloured geometry helper
  function merged(list) {
    const pos = [], nor = [], col = [], c = new THREE.Color();
    for (const [g0, hex, m] of list) {
      const g = g0.index ? g0.toNonIndexed() : g0.clone(); if (m) g.applyMatrix4(m);
      const P = g.attributes.position, N = g.attributes.normal; c.setHex(hex);
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere(); return g;
  }
  const M4 = (x, y, z, sx, sy, sz, rx, ry, rz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? sx === undefined ? 1 : sx : sy, sz === undefined ? sx === undefined ? 1 : sx : sz));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function IM(g, cap, shadow) {
    const m = new THREE.InstancedMesh(g, mat, cap); m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.count = 0; m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m;
  }
  const M = new THREE.Matrix4(), Mb = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Mr = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

  // ------------------------------------------------------------------ riders on the existing traffic
  const SKIN = [0x8d5a3b, 0x7a4c30, 0x9a6a48, 0x6e4228];
  const human = o => { let a; try { a = HumanModel.randomAppearance(o.gender); } catch (e) { a = {}; } return Object.assign(a, { lod: 'low' }, o); };
  function strip(v) { v.g.children.filter(c => c.userData && c.userData.human).forEach(c => v.g.remove(c)); }
  function seat(v, ap, pose, dy, dz, dx, ry) {
    const h = HumanModel.create(ap); HumanModel.sit(h.parts, pose);
    const s = v.seat || [0, 0.9, -0.3];
    h.group.position.set(s[0] + (dx || 0), s[1] + (dy || 0) - h.hipHeight, s[2] + (dz || 0)); h.group.rotation.y = ry || 0; v.g.add(h.group); return h;
  }
  function helmet(h) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: pick([0x222222, 0xb71c1c, 0xf5f5f5, 0x1565c0, 0xd98cb3]) })); m.position.set(0, 0.1, 0); m.scale.set(0.92, 0.95, 1.05); h.parts.head.add(m); }
  function couple(v) {
    strip(v);
    const him = seat(v, human({ gender: 'm', top: pick(['shirt', 'shirt', 'kurta']), bottom: pick(['trousers', 'trousers', 'lungi', 'jeans']) }), 'bike', 0, 0, 0, 0);
    if (Math.random() < 0.35) helmet(him);
    const sr = Math.random() < 0.72;
    seat(v, human({ gender: 'f', top: sr ? 'blouse' : 'kameez', bottom: sr ? 'saree' : 'salwar', hair: pick(['braid', 'bun']), acc: { bindi: true, bangles: true, earrings: true } }), 'sideSaddle', 0.03, -0.34, 0.07, 1.25);
    v.g.userData.lifeRole = 'couple';
  }
  function scootyGirl(v) {
    strip(v);
    const salwar = Math.random() < 0.7, g = seat(v, human({ gender: 'f', top: salwar ? 'kameez' : 'kurta', bottom: salwar ? 'salwar' : 'jeans', hair: pick(['braid', 'long', 'bun']), height: rnd(0.93, 1), acc: { bindi: Math.random() < 0.6, earrings: true, bangles: Math.random() < 0.5 } }), 'bike', 0, 0, 0, 0);
    if (Math.random() < 0.4) helmet(g);
    v.g.userData.lifeRole = 'scooty';
  }
  const extras = [];
  function extraTraffic(model, role, types, speed) {
    let R, S; try { R = TRAFFIC_ROUTES.bike; S = R && R.routes.filter(o => types.includes(o.r.t)); } catch (e) { return; }
    if (!S || !S.length) return;
    const v = TrafficModels[model](); if (role === 'couple') couple(v); else scootyGirl(v);
    const o = pick(S), drv = rnd(0.85, 1.1), sp = speed * drv;
    const t = Object.assign({}, v, { model: 'bike', r: o.r, len: o.len, s: Math.random() * o.len, dir: Math.random() < 0.5 ? 1 : -1, speed: sp, cur: sp, len2: v.len / 2, wheelR: 0.4, drv, K: TRAFFIC_KIND.bike, lat: null, latT: null, latV: 0, mode: 'drive', modeT: 0, stuckT: 0, tries: 0, followT: 0 });
    G.traffic.push(t); scene.add(v.g); extras.push({ t, role, on: true });
  }
  function buildRiders() {
    if (typeof TrafficModels === 'undefined') return;
    const bikes = G.traffic.filter(t => t.model === 'bike' && t.seat && !['sport', 'faired', 'cycle'].includes(t.type));
    bikes.forEach((t, i) => { if (i % 3 === 0) couple(t); });
    const n = tier === 'low' ? 1 : tier === 'medium' ? 2 : 3;
    for (let i = 0; i < n; i++) extraTraffic(pick(['splendor', 'starCity']), 'couple', ['cc', 'lane', 'tar', 'dirt'], 9);
    for (let i = 0; i < n * 2; i++) extraTraffic(pick(['activa', 'activa', 'scooter']), 'scooty', ['cc', 'lane', 'tar'], 8);
  }
  function scheduleRiders(h, game) {
    for (const e of extras) {
      const want = e.role === 'scooty' ? h > 7.5 && h < 19 : h > 6 && h < 21.5, g = e.t.g;
      if (want === e.on) continue;
      const P = g.position, cp = game.camera.position;
      if (Math.hypot(P.x - cp.x, P.z - cp.z) < 170) continue;      // nobody vanishes in view
      try { if (typeof Player !== 'undefined' && Player.active === e.t) continue; } catch (x) {}
      if (want) { game.traffic.push(e.t); scene.add(g); } else { const i = game.traffic.indexOf(e.t); if (i < 0) continue; game.traffic.splice(i, 1); scene.remove(g); }
      e.on = want;
    }
  }

  // ------------------------------------------------------------------ the map's crowd, by the clock
  function crowdFrac(h) { return h < 4.5 ? 0.04 : h < 6 ? 0.35 : h < 11 ? 1 : h < 15.5 ? 0.65 : h < 20 ? 1 : h < 22 ? 0.3 : 0.08; }
  function crowdInit() {
    const P = world.people; if (!P || !P.forEach) return;
    P.forEach(p => { p.idle = false; p._sc = p.scale; p._on = Math.random(); });
  }
  function crowdSchedule(h) {
    const P = world.people; if (!P || !P.forEach) return;
    const f = crowdFrac(h);
    P.forEach(p => { p.scale = p._on < f ? p._sc : 0.0001; });   // scaled away: their instance slots stay valid for the world's loop
  }

  // ------------------------------------------------------------------ workers
  const ROLES = [
    { id: 'farmer', when: [[5.2, 9], [16.5, 19.3]], ap: { gender: 'm', top: 'shirt', bottom: 'lungi', acc: { towel: true } }, types: ['dirt', 'lane'], prop: 'hoe', v: 1.15 },
    { id: 'herdboy', when: [[6.5, 18]], ap: { gender: 'm', top: 'vest', bottom: 'dhoti', acc: { turban: true } }, types: ['dirt'], prop: 'stick', v: 1.0 },
    { id: 'water', when: [[5.5, 9.5], [16, 19]], ap: { gender: 'f', top: 'blouse', bottom: 'saree', hair: 'bun' }, types: ['cc', 'lane'], prop: 'pot', v: 0.95 },
    { id: 'grass', when: [[9, 12], [15, 18.5]], ap: { gender: 'f', top: 'blouse', bottom: 'saree', hair: 'bun' }, types: ['dirt', 'lane'], prop: 'load', v: 1.0 },
    { id: 'labour', when: [[7.5, 18]], ap: { gender: 'm', top: 'shirt', bottom: 'trousers' }, types: ['cc', 'lane', 'tar'], prop: 'bag', v: 1.2 },
    { id: 'shop', when: [[8, 20.5]], ap: { gender: 'm', top: 'kurta', bottom: 'dhoti' }, types: ['cc', 'lane'], prop: 'bag', v: 0.95 },
    { id: 'school', when: [[8, 9.6], [15.8, 17]], ap: { gender: 'm', top: 'shirt', bottom: 'trousers', height: 0.74 }, types: ['cc', 'lane'], prop: 'school', v: 1.3 },
  ];
  const stuff = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  function prop(h, kind) {
    const P = h.parts, add = (geo, parent, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, stuffMat); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); parent.add(m); return m; };
    if (kind === 'pot') add(propGeo.pot, P.head, 0, 0.24, 0);
    else if (kind === 'load') add(propGeo.load, P.head, 0, 0.3, 0);
    else if (kind === 'hoe') add(propGeo.hoe, P.torso, 0.2, 0.46, -0.08, 0.5, -0.1);
    else if (kind === 'stick') add(propGeo.stick, P.foreR, 0, -0.26, 0.15, 1.2);
    else if (kind === 'school') add(propGeo.bag, P.torso, 0, 0.26, -0.14);
    else if (kind === 'bag') add(propGeo.bag2, P.foreR, 0, -0.42, 0);
  }
  let stuffMat = null, propGeo = null;
  function buildProps() {
    stuffMat = stuff();
    const cyl = (r1, r2, l, s) => new THREE.CylinderGeometry(r1, r2, l, s || 6), box = (a, b, c) => new THREE.BoxGeometry(a, b, c), sph = (r, s) => new THREE.SphereGeometry(r, s || 8, 6);
    propGeo = {
      pot: merged([[sph(0.12), 0xb98a3c, M4(0, 0, 0, 1, 0.85, 1)], [cyl(0.05, 0.07, 0.08), 0xb98a3c, M4(0, 0.12, 0)], [new THREE.TorusGeometry(0.1, 0.02, 5, 10), 0xc9b48a, M4(0, -0.1, 0, 1, 1, 1, Math.PI / 2)]]),
      load: merged([[sph(0.26, 8), 0x7f8f3a, M4(0, 0, 0, 1.3, 0.5, 0.8)], [sph(0.2, 7), 0x94a24a, M4(0.08, 0.08, 0.02, 1.2, 0.5, 0.8)]]),
      hoe: merged([[cyl(0.018, 0.018, 1.2), 0x6a4a2a, M4(0, 0, 0)], [box(0.2, 0.17, 0.02), 0x54575c, M4(0, 0.62, 0.06, 1, 1, 1, 0.5)]]),
      stick: merged([[cyl(0.012, 0.016, 1.4), 0x6a4a2a, M4(0, 0, 0)]]),
      bag: merged([[box(0.24, 0.3, 0.1), 0x234a8a, M4(0, 0, 0)]]),
      bag2: merged([[box(0.26, 0.26, 0.09), 0xd8cfa8, M4(0, 0, 0)], [box(0.02, 0.1, 0.02), 0xc4b88a, M4(0, 0.16, 0)]]),
    };
  }
  const workers = []; let roadList = [];
  function roadPolys() {
    for (const r of world.roads || []) {
      if (!r.p || r.p.length < 2) continue; let L = 0; const cum = [0];
      for (let i = 1; i < r.p.length; i++) { L += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]); cum.push(L); }
      if (L > 50) roadList.push({ r, L, cum, w: r.w || 4, t: r.t, x0: Math.min(...r.p.map(q => q[0])), x1: Math.max(...r.p.map(q => q[0])), z0: Math.min(...r.p.map(q => q[1])), z1: Math.max(...r.p.map(q => q[1])) });
    }
  }
  function roadAt(R, s, lat, out) {
    s = Math.max(0, Math.min(R.L - 0.01, s)); let i = 1; const C = R.cum, P = R.r.p; while (i < C.length - 1 && C[i] < s) i++;
    const a = P[i - 1], b = P[i], L = C[i] - C[i - 1] || 1, t = (s - C[i - 1]) / L, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    out.x = a[0] + (b[0] - a[0]) * t - uz * lat; out.z = a[1] + (b[1] - a[1]) * t + ux * lat; out.ux = ux; out.uz = uz; return out;
  }
  const q0 = { x: 0, z: 0, ux: 0, uz: 1 };
  function placeWorker(w, p, h) {
    const open = ROLES.filter(r => r.when.some(u => h >= u[0] && h < u[1]));
    if (!open.length) { w.off = true; w.h.group.visible = false; return; }
    const role = w.role && w.role.when.some(u => h >= u[0] && h < u[1]) ? w.role : pick(open);
    const close = roadList.filter(c => role.types.includes(c.t) && p.x > c.x0 - 130 && p.x < c.x1 + 130 && p.z > c.z0 - 130 && p.z < c.z1 + 130);
    for (let k = 0; k < 16 && close.length; k++) {
      const c = close[Math.random() * close.length | 0];
      const s = Math.random() * c.L, side = Math.random() < 0.5 ? 1 : -1; roadAt(c, s, (c.w / 2 + 0.5) * side, q0);
      const d = Math.hypot(q0.x - p.x, q0.z - p.z); if (d < 45 || d > 125 || blocked(q0.x, q0.z, 0.3)) continue;
      w.R = c; w.s = s; w.side = side; w.dir = Math.random() < 0.5 ? 1 : -1; w.off = false;
      if (w.role !== role) {
        const old = w.h; old.group.parent && old.group.parent.remove(old.group);
        w.h = HumanModel.create(human(Object.assign({}, role.ap, { skin: pick(SKIN), lod: 'low' }))); prop(w.h, role.prop); scene.add(w.h.group); w.role = role; w.v = role.v * rnd(0.9, 1.1);
      }
      w.h.group.visible = true; return;
    }
    w.off = true; w.h.group.visible = false;
  }
  function stepWorkers(dt, game, h) {
    const p = game.carPos, cp = game.camera.position, RA = window.RoadAnimals;
    for (const w of workers) {
      w.wait -= dt;
      if (w.off) { if (w.wait < 0) { w.wait = 4; placeWorker(w, p, h); } continue; }
      const d = Math.hypot(w.x - cp.x, w.z - cp.z);
      if (d > 170 || w.s < 1 || w.s > w.R.L - 1 || !w.role.when.some(u => h >= u[0] && h < u[1])) { if (d > 100 || w.s < 1 || w.s > w.R.L - 1) { placeWorker(w, p, h); if (!w.off) { roadAt(w.R, w.s, 0, q0); } } }
      if (w.off) continue;
      // cars approaching: step to the edge of the road
      let cur = w.v; const lat = (w.R.w / 2 + 0.5) * w.side;
      w.s += w.dir * cur * dt; roadAt(w.R, w.s, lat, q0); w.x = q0.x; w.z = q0.z;
      if (d > 130) { w.h.group.visible = false; continue; }
      w.h.group.visible = true;
      const g = w.h.group; g.position.set(w.x, gy(w.x, w.z), w.z); g.rotation.y = Math.atan2(q0.ux * w.dir, q0.uz * w.dir);
      w.ph += cur * dt * 3.2; HumanModel.animateWalk(w.h.parts, w.ph, cur);
      const P = w.h.parts;
      if (w.role.prop === 'pot' || w.role.prop === 'load') { P.armR.rotation.set(-2.9, 0, -0.2); P.foreR.rotation.x = -0.5; }
      else if (w.role.prop === 'hoe') { P.armL.rotation.x = -2.6; P.foreL.rotation.x = -1.5; }
      if (RA) RA.push({ x: w.x, z: w.z, r: 0.5, kind: 'walker' });
    }
  }
  function buildWorkers() {
    if (typeof HumanModel === 'undefined') return;
    roadPolys(); const n = tier === 'low' ? 4 : tier === 'medium' ? 6 : 9;
    for (let i = 0; i < n; i++) { const h = HumanModel.create(human({ gender: 'm' })); h.group.visible = false; scene.add(h.group); workers.push({ h, off: true, wait: i * 0.3, ph: Math.random() * 6, x: 1e5, z: 1e5, s: 0, dir: 1, side: 1, v: 1, role: null, R: null }); }
  }

  // ------------------------------------------------------------------ kids' games (instanced)
  const K = { H: 0.56 };   // hip height of a standing kid
  let kid = null, spots = [];
  function buildKidMeshes() {
    const s = new THREE.Matrix4();
    const sph = (r, a, b) => new THREE.SphereGeometry(r, a || 8, b || 6), cyl = (r1, r2, l, n) => { const g = new THREE.CylinderGeometry(r1, r2, l, n || 6); return g; };
    const hair = 0x151210, W = 0xffffff, dark = 0x444444;
    const head = merged([[sph(0.095), W, M4(0, 0.5, 0.01, 1, 1.08, 1)], [sph(0.1), hair, M4(0, 0.525, -0.012, 1, 0.92, 1)], [cyl(0.04, 0.045, 0.08), W, M4(0, 0.4, 0)]]);
    const shirt = merged([[cyl(0.12, 0.105, 0.3, 8), W, M4(0, 0.2, 0, 1, 1, 0.72)], [sph(0.125), W, M4(0, 0.34, 0, 1, 0.45, 0.72)], [cyl(0.1, 0.115, 0.16, 8), dark, M4(0, 0, 0, 1, 1, 0.8)]]);
    const frock = merged([[cyl(0.11, 0.1, 0.28, 8), W, M4(0, 0.2, 0, 1, 1, 0.72)], [sph(0.12), W, M4(0, 0.34, 0, 1, 0.45, 0.72)], [cyl(0.1, 0.24, 0.42, 9), 0xc8c8d8, M4(0, -0.1, 0, 1, 1, 0.9)], [cyl(0.018, 0.01, 0.32, 5), hair, M4(0, 0.42, -0.09)]]);
    const arm = merged([[cyl(0.036, 0.03, 0.42), W, M4(0, -0.2, 0)], [sph(0.04), 0xdddddd, M4(0, -0.42, 0)]]);
    const leg = merged([[cyl(0.05, 0.036, 0.52), W, M4(0, -0.26, 0)], [new THREE.BoxGeometry(0.07, 0.03, 0.15), 0x3a2a1c, M4(0, -0.53, 0.03)]]);
    const stick = merged([[new THREE.CylinderGeometry(0.75, 1, 1, 6), W, M4(0, 0.5, 0)]]), ball = merged([[sph(1, 7, 5), W]]), line = merged([[new THREE.BoxGeometry(1, 1, 1), W]]);
    const tyre = merged([[new THREE.TorusGeometry(0.3, 0.09, 6, 14), 0x1b1b1b]]);
    const n = tier === 'low' ? 10 : 20;
    kid = { head: IM(head, n, true), shirt: IM(shirt, n, true), frock: IM(frock, n, true), arm: IM(arm, n * 2), leg: IM(leg, n * 2), stick: IM(stick, 24), ball: IM(ball, 12), line: IM(line, 24), tyre: IM(tyre, 2), cap: n };
  }
  const SHIRTS = [0xd8d4c8, 0x3a6ea8, 0xc7402f, 0x2e8b57, 0xe0b030, 0xefefe8, 0x7a4fa0, 0xd06a30];
  const FROCKS = [0xd9486e, 0xe8a020, 0x7a3fa0, 0x2a9d8f, 0xc22f4a, 0xef7fb0];
  let nk = 0, nf = 0, na = 0, nl = 0, ns = 0, nb = 0, nline = 0, nt = 0;
  const yawOf = (dx, dz) => Math.atan2(dx, dz);
  // one kid. a,b are game-frame metres; o: {yaw, hip, pitch, aL, aR, lL, lR, sL, sR}
  function drawKid(g, i, a, b, o) {
    if (nk + nf >= kid.cap) return; o = o || {};
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw), x = g.x + a * c - b * s, z = g.z + a * s + b * c, yaw = (o.yaw || 0) - g.yaw;
    const hip = o.hip === undefined ? K.H : o.hip, y = gy(x, z) + hip + (o.up || 0), P = o.pitch || 0, skin = SKIN[(i + g.seed) % 4], girl = g.girls || (i + g.seed) % 5 === 4;
    _q.setFromAxisAngle(_p.set(0, 1, 0), yaw); Mb.compose(_p.set(x, y, z), _q, _s.set(0.9, 0.9, 0.9));
    M.copy(Mb).multiply(Mr.makeRotationX(P));
    const bi = kid.head.count = nk + nf; kid.head.setMatrixAt(bi, M); kid.head.setColorAt(bi, _c.setHex(skin));
    if (girl) { kid.frock.setMatrixAt(nf, M); kid.frock.setColorAt(nf, _c.setHex(FROCKS[(i + g.seed) % FROCKS.length])); nf++; }
    else { kid.shirt.setMatrixAt(nk, M); kid.shirt.setColorAt(nk, _c.setHex(SHIRTS[(i * 3 + g.seed) % SHIRTS.length])); nk++; }
    for (const [sx, ang, sp] of [[1, o.aL || 0, o.oL || 0], [-1, o.aR || 0, o.oR || 0]]) {
      Mt.copy(M).multiply(Mr.makeTranslation(sx * 0.15, 0.33, 0)).multiply(Mr.makeRotationX(ang)); if (sp) Mt.multiply(Mr.makeRotationZ(sx * sp));
      kid.arm.setMatrixAt(na, Mt); kid.arm.setColorAt(na, _c.setHex(skin)); na++;
    }
    for (const [sx, ang] of [[1, o.lL || 0], [-1, o.lR || 0]]) {
      Mt.copy(Mb).multiply(Mr.makeTranslation(sx * 0.065, 0, 0)).multiply(Mr.makeRotationX(ang));
      kid.leg.setMatrixAt(nl, Mt); kid.leg.setColorAt(nl, _c.setHex(skin)); nl++;
    }
  }
  const run = (ph, amp) => { const s = Math.sin(ph) * (amp || 0.9); return { lL: s, lR: -s, aL: -s * 0.8, aR: s * 0.8, up: Math.abs(Math.cos(ph)) * 0.04 }; };
  function gameXZ(g, a, b, r) { const c = Math.cos(g.yaw), s = Math.sin(g.yaw); r.x = g.x + a * c - b * s; r.z = g.z + a * s + b * c; return r; }
  const _r = { x: 0, z: 0 };
  function pStick(g, a, y, b, len, r, rx, ry, rz, hex) {   // tapered stick from (a,y,b) in the game frame
    if (ns >= 24) return; gameXZ(g, a, b, _r); _e.set(rx, ry, rz); _q.setFromEuler(_e); M.compose(_p.set(_r.x, gy(_r.x, _r.z) + y, _r.z), _q, _s.set(r, len, r)); kid.stick.setMatrixAt(ns, M); kid.stick.setColorAt(ns, _c.setHex(hex || 0x8a6236)); ns++;
  }
  function pBall(g, a, y, b, r, hex) { if (nb >= 12) return; gameXZ(g, a, b, _r); M.makeScale(r, r, r).setPosition(_r.x, gy(_r.x, _r.z) + y, _r.z); kid.ball.setMatrixAt(nb, M); kid.ball.setColorAt(nb, _c.setHex(hex)); nb++; }
  function pLine(g, a, b, len, wid, hex) {                  // ground line along the game's a axis (wid along b) scraped in the dust
    if (nline >= 24) return; gameXZ(g, a, b, _r); _q.setFromAxisAngle(_p.set(0, 1, 0), -g.yaw); M.compose(_p.set(_r.x, gy(_r.x, _r.z) + 0.025, _r.z), _q, _s.set(len, 0.012, wid)); kid.line.setMatrixAt(nline, M); kid.line.setColorAt(nline, _c.setHex(hex || 0xd9d2bf)); nline++;
  }
  const GAMES = {
    kabaddi(g, t) {
      pLine(g, 0, 0, 0.07, 6); pLine(g, 3.8, 0, 0.07, 6); pLine(g, -3.8, 0, 0.07, 6); pLine(g, 0, 3, 7.7, 0.07); pLine(g, 0, -3, 7.7, 0.07);
      const u = (t % 7) / 7, a = -0.6 + 3.6 * Math.sin(Math.PI * u), b = 1.5 * Math.sin(TAU * u), back = u > 0.5;
      const R = run(t * 12, 0.8); drawKid(g, 0, a, b, Object.assign(R, { yaw: back ? -Math.PI / 2 : Math.PI / 2, pitch: 0.25, aL: -1.4, aR: -1.4, oL: 0.3, oR: 0.3 }));
      for (let i = 0; i < 3; i++) {             // the chain crouches, arms out, and shuffles with the raider
        const bb = (i - 1) * 1.15 + b * 0.35, aa = 2.4 - (back ? 0.9 * Math.sin((u - 0.5) * TAU) : 0);
        drawKid(g, i + 1, aa, bb, { yaw: -Math.PI / 2, hip: 0.42, pitch: 0.55, aL: -1.2, aR: -1.2, oL: 0.2, oR: 0.2, lL: -0.7, lR: 0.4 });
      }
      for (let i = 0; i < 3; i++) drawKid(g, i + 4, -2.3, (i - 1) * 1.3, { yaw: Math.PI / 2, hip: 0.45, pitch: 0.45, aL: -0.9, aR: -0.9, lL: -0.5, lR: 0.3 });
    },
    khokho(g, t) {
      for (let i = 0; i < 6; i++) drawKid(g, i, -3.5 + i * 1.4, 0, { yaw: i % 2 ? Math.PI : 0, hip: 0.28, pitch: 0.5, lL: -1.35, lR: -1.35, aL: -1.1, aR: -1.1 });
      for (let i = 0; i < 2; i++) {             // chaser and runner round the row, weaving
        const th = t * 1.25 - i * 0.65, a = 5 * Math.cos(th), b = 1.5 * Math.sin(th) + 0.3 * Math.sin(th * 7), R = run(t * 11 + i, 0.95);
        drawKid(g, 6 + i, a, b, Object.assign(R, { yaw: yawOf(-5 * Math.sin(th), 1.5 * Math.cos(th)) + Math.PI / 2 * 0 , pitch: 0.2 }));
      }
    },
    gilli(g, t) {
      const u = (t % 6) / 6;
      const flick = u > 0.32 && u < 0.42, hit = u > 0.42 && u < 0.5, ang = hit ? -2.2 + (u - 0.42) * 30 : flick ? -1.2 : -1.6;
      drawKid(g, 0, 0, 0, { yaw: Math.PI / 2, hip: 0.5, pitch: 0.55, aR: ang, aL: 0.2, lL: -0.4, lR: 0.3 });
      pStick(g, 0.33, 0.6, -0.15, 0.75, 0.024, ang + Math.PI / 2 + 0.3, 0, -Math.PI / 2 * 0.9);          // danda
      pLine(g, 0.55, 0, 0.5, 0.1, 0x6c4a2c);                                                           // the slot
      const landing = 11 + Math.sin(Math.floor(t / 6) * 2.3) * 2.5, lb = Math.cos(Math.floor(t / 6) * 3.1) * 2.5;
      let ga = 0.55, gb = 0, gh = 0.04;
      if (flick) gh = 0.04 + Math.sin((u - 0.32) * 31) * 0.5;
      else if (u >= 0.42 && u < 0.8) { const q = (u - 0.42) / 0.38; ga = 0.55 + (landing - 0.55) * q; gb = lb * q; gh = 0.6 + 3.5 * Math.sin(q * Math.PI) - 0.55 * q; }
      else if (u >= 0.8) { const q = (u - 0.8) / 0.2; ga = landing + (0.55 - landing) * q; gb = lb * (1 - q); gh = 1.2 + 2 * Math.sin(q * Math.PI) - 1.2 * q; }
      pStick(g, ga, gh, gb, 0.14, 0.022, u * 80, 0, 1.4, 0xb98a55);
      for (let i = 0; i < 3; i++) {
        const a0 = 9 + i * 2, b0 = (i - 1) * 2.6, go = u > 0.46 && u < 0.8 && i === 1, f = go ? (u - 0.46) / 0.34 : u >= 0.8 && i === 1 ? 1 : 0, a = a0 + (landing - a0) * f, b = b0 + (lb - b0) * f;
        drawKid(g, i + 1, a, b, Object.assign(go ? run(t * 11 + i, 0.9) : { aL: i === 1 && u > 0.8 ? -2.6 : 0, aR: -0.3, hip: 0.54 }, { yaw: yawOf(lb - b0, -(a0)) * 0 + (-Math.PI / 2) }));
      }
    },
    goli(g, t) {
      const n = 4, cur = Math.floor(t / 3.5) % n, u = (t % 3.5) / 3.5;
      pLine(g, 0, 0.45, 0.9, 0.03); pLine(g, 0, -0.45, 0.9, 0.03); pLine(g, 0.45, 0, 0.03, 0.9); pLine(g, -0.45, 0, 0.03, 0.9);
      for (let i = 0; i < n; i++) {
        const th = i / n * TAU + 0.4, a = Math.cos(th) * 1.5, b = Math.sin(th) * 1.5, me = i === cur;
        drawKid(g, i, a, b, { yaw: Math.atan2(-a, -b) + 0 , hip: 0.27, pitch: me ? 0.95 : 0.55, lL: -1.4, lR: -1.4, aL: -0.9, aR: me ? -1.55 : -1 });
        if (me) { const q = Math.min(1, Math.max(0, (u - 0.45) / 0.14)); pBall(g, a * 0.62 * (1 - q), 0.05, b * 0.62 * (1 - q), 0.026, 0x4aa8e0); }
      }
      const kick = Math.max(0, (u - 0.59)) * 2;
      for (let i = 0; i < 5; i++) { const th = i * 1.26 + cur, r = 0.08 + 0.1 * (i % 3) + (i === cur % 5 ? kick * 0.5 : 0); pBall(g, Math.cos(th) * r, 0.05, Math.sin(th) * r, 0.024, [0xd64d4d, 0x4ad08a, 0xe8c34a, 0xe2e2e2, 0x8a5ae0][i]); }
    },
    cricket(g, t) {
      // tyre propped against stick stumps: the street wicket
      gameXZ(g, -0.1, 0, _r); _q.setFromAxisAngle(_p.set(0, 1, 0), -g.yaw + Math.PI / 2); M.compose(_p.set(_r.x, gy(_r.x, _r.z) + 0.38, _r.z), _q, _s.set(1, 1, 1)); kid.tyre.setMatrixAt(nt++, M); kid.tyre.setColorAt(0, _c.setHex(0xffffff));
      for (const b of [-0.1, 0.1, 0]) pStick(g, -0.3, 0, b, 0.7, 0.018, 0, 0, 0, 0xa98050);
      const u = (t % 5) / 5, hitT = 0.58, away = u > hitT;
      const ba = u < hitT * 0.5 ? 12 - 3.5 * u * 2 / hitT : 8.5;
      const ph = u < hitT * 0.5 ? run(t * 11, 0.85) : {}; const bw = (u - hitT * 0.5) / (hitT * 0.3);
      drawKid(g, 0, ba, 0.1, Object.assign(ph, { yaw: -Math.PI / 2, aR: u >= hitT * 0.5 && bw < 1 ? -bw * 5.5 : ph.aR || 0 }));
      const sw = u > hitT - 0.05 && u < hitT + 0.1 ? (u - hitT + 0.05) / 0.15 : 0;
      drawKid(g, 1, 0.75, 0.25, { yaw: Math.PI / 2, hip: 0.5, pitch: 0.3, aL: -1 - sw * 1.6, aR: -1 - sw * 1.6, lL: -0.25, lR: 0.2 });
      pStick(g, 1.05, 0.72, 0.15, 0.72, 0.03, 0, 0, -1.9 + sw * 2.4, 0xb98a55);                         // bat
      drawKid(g, 2, -1.5, 0, { yaw: Math.PI / 2, hip: 0.32, pitch: 0.6, lL: -1.2, lR: -1.2, aL: -1, aR: -1 });
      let a = 1, h = 0.4, b = 0.2;
      if (u >= hitT * 0.8 && !away) { const q = (u - hitT * 0.8) / (hitT * 0.2); a = 8.5 + (1 - 8.5) * q; h = 1.3 - 1.25 * q + Math.abs(Math.sin(q * Math.PI * 1)) * 0.2; b = 0.1; }
      else if (away) { const q = (u - hitT) / (1 - hitT), s = Math.floor(t / 5) % 2 ? 1 : -1; a = 1 + 8 * q; b = 0.2 + s * 5 * q; h = 0.5 + 2.2 * Math.sin(q * Math.PI); }
      else h = -1;
      pBall(g, a, h, b, 0.045, 0xc9352b);
      for (const [i, a0, b0] of [[3, 7, 5], [4, 7, -5], [5, 11, 2.8]]) { const look = Math.atan2(1 - a0, -b0); drawKid(g, i, a0 + Math.sin(t + i) * 0.2, b0, { yaw: -g.yaw * 0 + look * 0 - Math.PI / 2, aL: -0.2, aR: -0.2, hip: 0.54 }); }
    },
    bongaram(g, t) {
      const u = (t % 7) / 7, thr = u < 0.28, a = thr ? -1.4 + u * 4 : 0.5;
      drawKid(g, 0, -0.9, 0, { yaw: Math.PI / 2, aR: thr ? -0.3 - u * 12 : 0.3, pitch: thr ? 0.35 : 0.05, lL: -0.2, lR: 0.2 });
      const spin = u > 0.3 && u < 0.96, wob = spin ? Math.max(0, (u - 0.65) * 1.1) : 0.8, tl = wob * Math.sin(t * 9);
      if (u > 0.26) { pStick(g, 0.6, 0.015, 0, 0.12, 0.06, Math.PI + tl * 0.3, t * 30, tl, 0xd64d4d); pBall(g, 0.6 + tl * 0.02, 0.135, 0, 0.018, 0xe2c34a); }
      else pBall(g, -0.7, 0.75, -0.25, 0.05, 0xd64d4d);
      for (let i = 0; i < 3; i++) { const th = i * 1.1 - 1.1, x = 0.6 + Math.cos(th) * 1.1, z = Math.sin(th) * 1.1; drawKid(g, i + 1, x, z, { yaw: Math.atan2(0.6 - x, -z) * 1, hip: 0.3, pitch: 0.55, lL: -1.35, lR: -1.35, aL: -1.3 + Math.sin(t * 8 + i) * 0.25, aR: -1.3 - Math.sin(t * 8 + i) * 0.25 }); }
    },
    hopscotch(g, t) {
      for (let i = 0; i < 7; i++) { pLine(g, i * 0.6, 0.3, 0.05, 0.62, 0xeee7d4); pLine(g, i * 0.6, -0.3, 0.05, 0.62, 0xeee7d4); }
      for (let i = 0; i < 2; i++) for (const b of [-0.6, 0.6, 0]) pLine(g, i * 3.6 - 0.0, b, 0.05, 0.03, 0xeee7d4);
      pLine(g, 1.8, 0.6, 3.65, 0.05, 0xeee7d4); pLine(g, 1.8, -0.6, 3.65, 0.05, 0xeee7d4); pLine(g, 1.8, 0, 3.65, 0.04, 0xeee7d4);
      const per = 0.46, L = 6, c = (t / per) % (L * 2), n = Math.floor(c), f = c - n, fwd = n < L, cell = fwd ? n : L * 2 - n, nxt = fwd ? n + 1 : L * 2 - n - 1, a = (cell + (nxt - cell) * f) * 0.6 + 0.0;
      drawKid(g, 0, a, (n % 2 ? 0.14 : -0.14), { yaw: fwd ? Math.PI / 2 : -Math.PI / 2, up: Math.sin(f * Math.PI) * 0.22, lL: -0.1, lR: -1.1, aL: -0.7, aR: -0.5, oL: 0.5, oR: 0.5 });
      for (let i = 0; i < 3; i++) { drawKid(g, i + 1, i * 1.1 + 0.6, -1.5, { aL: -1.4 + Math.sin(t * 7 + i) * 0.3, aR: -1.4 - Math.sin(t * 7 + i) * 0.3, oL: -0.4, oR: -0.4 }); }
      pBall(g, 2.4, 0.03, 0.3, 0.05, 0xb0a890);       // the stone
    },
  };
  const ORDER = ['cricket', 'kabaddi', 'gilli', 'bongaram', 'hopscotch', 'goli', 'khokho'];
  const RADIUS = { cricket: 9, kabaddi: 6, gilli: 9, bongaram: 3, hopscotch: 4, goli: 2.5, khokho: 6 };
  function roady(x, z) { const s = world.surfaceAt ? world.surfaceAt(x, z) : ''; return ['highway', 'tar', 'cc', 'lane', 'dirt', 'water'].includes(s); }
  function inLake(x, z) {
    for (const lk of (window.NELLUTLA_MAP && NELLUTLA_MAP.lakes) || []) { let c = false; for (let i = 0, j = lk.length - 1; i < lk.length; j = i++) if ((lk[i][1] > z) !== (lk[j][1] > z) && x < (lk[j][0] - lk[i][0]) * (z - lk[i][1]) / (lk[j][1] - lk[i][1]) + lk[i][0]) c = !c; if (c) return true; }
    return false;
  }
  function openAt(x, z, R) {
    if (world.fieldAt && world.fieldAt(x, z)) return false; if (inLake(x, z)) return false;
    for (let i = 0; i < 9; i++) { const th = i / 8 * TAU, r = i === 8 ? 0 : R, px = x + Math.cos(th) * r, pz = z + Math.sin(th) * r; if (blocked(px, pz, 0.6) || roady(px, pz)) return false; }
    return true;
  }
  function findSpots() {
    // road verges, nearest to the village first; each candidate checked for a clear circle of the game's size
    const C = []; for (const c of roadList) if (['cc', 'lane', 'dirt'].includes(c.t)) for (let s = 10; s < c.L; s += 22) { roadAt(c, s, 0, q0); C.push([q0.x, q0.z, q0.ux, q0.uz, c.w]); }
    const fromVillage = c => Math.hypot(c[0] - 20, c[1] + 150) + Math.random() * 150; C.forEach(c => { c.k = fromVillage(c); }); C.sort((a, b) => a.k - b.k);
    for (const l of world.landmarks || []) if (['school', 'anganwadi', 'temple', 'village'].includes(l.k)) for (let i = 0; i < 10; i++) C.unshift([l.x + rnd(-40, 40), l.z + rnd(-40, 40), 1, 0, 0]);
    for (const [x, z, type, yaw] of [[16.5, -270, 'cricket', 0.4], [21.5, -266, 'kabaddi', 1.2]]) spots.push({ x, z, y: gy(x, z), yaw, type, seed: spots.length * 7 + 3, girls: false });   // the play ground west of the house
    let i = 0, probes = 0;
    for (const c of C) {
      if (spots.length >= 80 || probes > 4000) break;
      const type = ORDER[spots.length % ORDER.length], R = RADIUS[type], side = Math.random() < 0.5 ? 1 : -1, o = c[4] / 2 + R + 2, x = c[0] - c[3] * o * side, z = c[1] + c[2] * o * side; probes += 10;
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < 25) || !openAt(x, z, R)) continue;
      spots.push({ x, z, y: gy(x, z), yaw: Math.atan2(c[3], c[2]), type, seed: spots.length * 7 + 3, girls: type === 'hopscotch' }); i++;
    }
  }
  const active = [];
  function stepGames(dt, game, h) {
    nk = nf = na = nl = ns = nb = nline = nt = 0; kid.head.count = 0;
    const day = h > 6.8 && h < 18.4, cp = game.camera.position, max = tier === 'low' ? 1 : 2;
    active.length = 0;
    if (day) {
      let ranked = [];
      for (const s of spots) { const d = Math.hypot(s.x - cp.x, s.z - cp.z); if (d < 95) ranked.push([d, s]); }
      ranked.sort((a, b) => a[0] - b[0]); for (let i = 0; i < ranked.length && i < max; i++) active.push(ranked[i][1]);
    }
    for (const g of active) { try { GAMES[g.type](g, T + g.seed); } catch (e) { console.error('game', g.type, e); g.type = 'hopscotch'; } }
    const total = nk + nf;
    kid.head.count = total; kid.shirt.count = nk; kid.frock.count = nf; kid.arm.count = na; kid.leg.count = nl; kid.stick.count = ns; kid.ball.count = nb; kid.line.count = nline; kid.tyre.count = nt;
    for (const k of ['head', 'shirt', 'frock', 'arm', 'leg', 'stick', 'ball', 'line', 'tyre']) { kid[k].instanceMatrix.needsUpdate = true; if (kid[k].instanceColor) kid[k].instanceColor.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ farming on the field parcels
  const FM = { cap: 26, jobs: [], forceMonth: null, forceKind: null, rankT: 0, n: {} };
  const CLOTH_M = [0xd9d4c6, 0xa8a48e, 0x8fa8c0, 0x7c8a6a, 0xc7b79a], LUNGI = [0x2b4a73, 0x4a5f3a, 0xe8e2d2, 0x6b2f2f], SAREE = [0xb3123f, 0x0f766e, 0x7c2d92, 0xd9730d, 0x2f7d32, 0x1d4e9e], BLOUSE = [0xc98a10, 0x8a1538, 0xe8dcc8, 0x1e3a8a];
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _hand = new THREE.Vector3(), Mh = new THREE.Matrix4(), Ma = new THREE.Matrix4();
  function buildFarm() {
    const sph = (r, a, b) => new THREE.SphereGeometry(r, a || 8, b || 6), cyl = (a, b, l, n) => new THREE.CylinderGeometry(a, b, l, n || 7), hair = 0x151210, N = FM.cap, W = 0xffffff;
    FM.m = {
      head: IM(merged([[cyl(0.05, 0.058, 0.1), W, M4(0, 0.03, 0)], [sph(0.118, 9, 7), W, M4(0, 0.16, 0.012, 0.92, 1.1, 1)], [sph(0.122, 8, 6), hair, M4(0, 0.185, -0.018, 0.94, 0.96, 1)]]), N, true),
      wrap: IM(merged([[sph(0.13, 8, 5), W, M4(0, 0.23, -0.01, 1, 0.55, 1.08)], [new THREE.TorusGeometry(0.105, 0.035, 5, 10), W, M4(0, 0.2, -0.01, 1, 1, 0.75, Math.PI / 2 + 0.15)]]), N),
      torso: IM(merged([[cyl(0.178, 0.145, 0.46, 9), W, M4(0, 0.29, 0, 1, 1, 0.66)], [sph(0.18, 9, 5), W, M4(0, 0.5, 0, 1.02, 0.36, 0.64)], [cyl(0.15, 0.165, 0.14, 9), 0xdddddd, M4(0, 0.03, 0, 1, 1, 0.7)]]), N, true),
      skirt: IM(merged([[cyl(0.165, 0.2, 1, 9), W, M4(0, -0.5, 0, 1, 1, 0.8)], [cyl(0.2, 0.203, 0.05, 9), 0xc9a24a, M4(0, -0.975, 0, 1, 1, 0.8)]]), N),
      arm: IM(merged([[sph(0.052, 6, 5), W, M4(0, 0, 0)], [cyl(0.047, 0.036, 0.29, 6), W, M4(0, -0.145, 0)]]), N * 2),
      fore: IM(merged([[cyl(0.036, 0.027, 0.26, 6), W, M4(0, -0.13, 0)], [sph(0.037, 5, 4), W, M4(0, -0.28, 0, 0.75, 1.15, 1)]]), N * 2),
      thigh: IM(merged([[cyl(0.075, 0.052, 0.43, 6), W, M4(0, -0.215, 0)]]), N * 2),
      shin: IM(merged([[cyl(0.052, 0.033, 0.44, 6), W, M4(0, -0.22, 0)], [new THREE.BoxGeometry(0.08, 0.04, 0.2), W, M4(0, -0.45, 0.04)]]), N * 2),
      stick: IM(merged([[cyl(1, 1, 1, 5), W, M4(0, 0.5, 0)]]), 70),
      load: IM(merged([[sph(0.3, 7, 5), W, M4(0, 0, 0, 1.25, 0.55, 0.85)], [sph(0.22, 6, 4), 0xcccccc, M4(0.1, 0.09, 0.03, 1.2, 0.55, 0.8)]]), 40),
      strip: IM(merged([[new THREE.BoxGeometry(1, 1, 1), W]]), 40),
    };
    FM.bulls = []; const A = window.VillageAnimals;
    if (A && A.puppet) for (let i = 0; i < (tier === 'low' ? 2 : 4); i++) FM.bulls.push(A.puppet('bull'));
    if (typeof TrafficModels !== 'undefined' && TrafficModels.tractor && tier !== 'low') {
      const v = TrafficModels.tractor(); if (v.trailer) v.trailer.visible = false; v.g.visible = false;   // ploughs, so no trolley
      scene.add(v.g); FM.tractor = v;
      const h = seat(v, human({ gender: 'm', top: 'shirt', bottom: 'lungi', topColor: 0xc7b79a, bottomColor: 0x2b4a73, acc: { turban: true } }), 'car'); h.group.position.set(0, 1.42 - h.hipHeight, -0.5); FM.driver = h;
    }
  }
  const fset = (k, i, mtx, hex) => { const m = FM.m[k]; m.setMatrixAt(i, mtx); m.setColorAt(i, _c.setHex(hex)); };
  function stick(ax, ay, az, bx, by, bz, r, hex) {
    if (FM.n.stick >= 70) return;
    _v1.set(bx - ax, by - ay, bz - az); const L = _v1.length() || 0.01; _q.setFromUnitVectors(_up, _v1.divideScalar(L));
    M.compose(_p.set(ax, ay, az), _q, _s.set(r, L, r)); fset('stick', FM.n.stick++, M, hex);
  }
  function loadAt(x, y, z, yaw, sc, hex) { if (FM.n.load >= 40) return; _q.setFromAxisAngle(_up, yaw); M.compose(_p.set(x, y, z), _q, _s.set(sc, sc, sc)); fset('load', FM.n.load++, M, hex); }
  // one adult. hip = pelvis height; pitch leans forward; a/f shoulder and elbow, l/k hip and knee (negative a/l = forward)
  function farmer(x, z, o, near) {
    const n = FM.n; if (n.p >= FM.cap) return null;
    const hip = o.hip === undefined ? 0.9 : o.hip, g = gy(x, z), i = n.p++, P = o.pitch || 0, sk = o.skin;
    _q.setFromAxisAngle(_up, o.yaw || 0); Mb.compose(_p.set(x, g + hip, z), _q, _s.set(0.96, 0.96, 0.96));
    Mt.copy(Mb).multiply(Mr.makeRotationX(P));
    fset('torso', i, Mt, o.top);
    Ma.copy(Mt).multiply(Mr.makeTranslation(0, 0.55, 0.015)).multiply(Mr.makeRotationX(-P * 0.55)); fset('head', i, Ma, sk);
    if (o.wrap !== undefined) { fset('wrap', n.wrap, Ma, o.wrap); n.wrap++; }
    if (o.carry) { _p.setFromMatrixPosition(Ma); FM.top = FM.top || new THREE.Vector3(); FM.top.set(_p.x, _p.y + 0.4, _p.z); }
    const len = Math.min(o.female ? 0.82 : 0.46, hip + 0.02);
    Ma.copy(Mb).multiply(Mr.makeRotationX(P * 0.35)).multiply(Mr.makeScale(o.crouch ? 1.2 : 1, len, o.crouch ? 1.5 : 1)); fset('skirt', i, Ma, o.low);
    for (const sx of [1, -1]) {
      const L = sx > 0, j = n.limb;
      Ma.copy(Mb).multiply(Mr.makeTranslation(sx * 0.085, -0.03, 0)).multiply(Mr.makeRotationX((L ? o.lL : o.lR) || 0)); fset('thigh', j, Ma, o.female && !o.crouch ? o.low : sk);
      Ma.multiply(Mr.makeTranslation(0, -0.43, 0)).multiply(Mr.makeRotationX((L ? o.kL : o.kR) || 0)); fset('shin', j, Ma, sk);
      Ma.copy(Mt).multiply(Mr.makeTranslation(sx * 0.2, 0.47, 0)).multiply(Mr.makeRotationX(near ? (L ? o.aL : o.aR) || 0 : 0)); fset('arm', j, Ma, o.sleeve);
      Ma.multiply(Mr.makeTranslation(0, -0.29, 0)).multiply(Mr.makeRotationX(near ? (L ? o.fL : o.fR) || 0 : 0)); fset('fore', j, Ma, sk);
      if (!L) { Mh.copy(Ma).multiply(Mr.makeTranslation(0, -0.29, 0.02)); _hand.setFromMatrixPosition(Mh); }
      n.limb++;
    }
    return _hand;
  }
  const stride = (ph, amp) => { const s = Math.sin(ph) * (amp || 0.42), c = Math.sin(ph + 1.2); return { lL: -s, lR: s, kL: Math.max(0, c) * 0.75, kR: Math.max(0, -c) * 0.75, aL: s * 0.55, aR: -s * 0.55, fL: -0.3, fR: -0.3 }; };
  // rows along the parcel's long side, clipped to the polygon; the path snakes through them
  function lanesOf(f) {
    if (f._lanes) return f._lanes;
    const ux = Math.cos(f.ang), uz = Math.sin(f.ang), vx = -uz, vz = ux; let lo = 1e9, hi = -1e9, wlo = 1e9, whi = -1e9;
    for (const q of f.p) { const a = q[0] * ux + q[1] * uz, b = q[0] * vx + q[1] * vz; lo = Math.min(lo, a); hi = Math.max(hi, a); wlo = Math.min(wlo, b); whi = Math.max(whi, b); }
    const ax0 = f.cx * ux + f.cz * uz, b0 = f.cx * vx + f.cz * vz, step = 3.2, out = [];
    for (let i = 0; i < 12; i++) {
      const b = b0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * step; if (b < wlo + 2 || b > whi - 2) continue;
      let run = null, best = null;
      for (let a = lo; a <= hi + 1; a += 1.5) {
        const dx = ux * (a - ax0) + vx * (b - b0), dz = uz * (a - ax0) + vz * (b - b0), x = f.cx + dx, z = f.cz + dz;
        const ok = a <= hi && world.fieldAt(x, z) === f && !blocked(x, z, 0.8);
        if (ok) { if (!run) run = { a0: a, x0: x, z0: z }; run.a1 = a; run.x1 = x; run.z1 = z; } else { if (run && (!best || run.a1 - run.a0 > best.a1 - best.a0)) best = run; run = null; }
      }
      if (best && best.a1 - best.a0 > 14) out.push({ b, x0: best.x0 + ux * 2, z0: best.z0 + uz * 2, x1: best.x1 - ux * 2, z1: best.z1 - uz * 2, L: best.a1 - best.a0 - 4 });
    }
    out.sort((p, q) => p.b - q.b);
    return (f._lanes = out);
  }
  function snake(lanes) {
    const pts = []; lanes.forEach((l, i) => { if (i % 2) pts.push([l.x1, l.z1], [l.x0, l.z0]); else pts.push([l.x0, l.z0], [l.x1, l.z1]); });
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, L: cum[cum.length - 1] };
  }
  function pathPos(P, s, r) {
    s = ((s % P.L) + P.L) % P.L; let i = 1; while (i < P.cum.length - 1 && P.cum[i] < s) i++;
    const a = P.pts[i - 1], b = P.pts[i], L = P.cum[i] - P.cum[i - 1] || 1, t = (s - P.cum[i - 1]) / L;
    r.x = a[0] + (b[0] - a[0]) * t; r.z = a[1] + (b[1] - a[1]) * t; r.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); r.seg = i - 1; r.t = t; return r;
  }
  const monthNow = () => FM.forceMonth !== null ? FM.forceMonth : new Date().getMonth();
  // what this parcel needs now. Classes: 0 fallow 1 ploughed 2 paddy 3 flooded paddy 4 row crop 5 stubble (6 orchard, 7 scrub, 8 cloud: left alone)
  function kindFor(f, m) {
    if (FM.forceKind) return FM.forceKind;
    const h = f.h, kharifCut = m >= 9 && m <= 11, rabiCut = m === 2 || m === 3, sowT = m === 5 || m === 6 || m === 10 || m === 11;
    if (f.c === 3) return m >= 5 && m <= 7 || m === 11 || m === 0 ? 'transplant' : 'weed';
    if (f.c === 2) return kharifCut || rabiCut ? 'harvest' : 'weed';
    if (f.c === 4) return f.crop === 'cotton' && (m >= 9 || m === 0) ? 'pick' : (f.crop === 'maize' && m >= 9 && m <= 10) || (f.crop === 'chilli' && m <= 2) ? 'harvest' : 'weed';
    if (f.c === 5) return 'carry';
    if (f.c === 1) return sowT && h > 0.55 ? 'sow' : h > 0.3 ? 'plough' : 'tractor';
    if (f.c === 0) return (m >= 3 && m <= 6) || m >= 9 ? (h > 0.65 ? 'tractor' : h > 0.25 ? 'plough' : 'sow') : null;
    return null;
  }
  const CREW = { plough: 1, tractor: 0, sow: 3, transplant: 6, weed: 5, pick: 5, harvest: 5, carry: 3 };
  function dressCrew(j) {
    const k = j.kind, female = k === 'transplant' || k === 'weed' || k === 'pick' || k === 'harvest', count = Math.max(1, Math.round(CREW[k] * (tier === 'low' ? 0.5 : tier === 'medium' ? 0.75 : 1)));
    j.crew = [];
    for (let i = 0; i < count; i++) {
      const w = (female && i % 5 !== 4) || (k === 'carry' && i % 2), seed = j.f.i * 7 + i * 13;
      j.crew.push({ i, female: w, skin: SKIN[seed % 4], top: w ? BLOUSE[seed % 4] : CLOTH_M[seed % 5], sleeve: SKIN[seed % 4], low: w ? SAREE[seed % 6] : LUNGI[seed % 4], wrap: w ? (i % 2 ? 0xe9e1cc : SAREE[(seed + 2) % 6]) : (i % 2 ? 0xf1ede2 : undefined), s: rnd(0, j.P.L), lane: i % j.lanes.length, u: rnd(0.05, 0.3), ph: rnd(0, 6), dir: i % 2 ? 1 : -1 });
      if (!w) j.crew[i].sleeve = j.crew[i].top;
    }
    if (k === 'plough' || k === 'tractor') j.s = rnd(0, j.P.L * 0.5);
    if (k === 'harvest' || k === 'carry') { j.sheaf = []; for (let i = 0; i < 14; i++) { const l = j.lanes[i % j.lanes.length], t = (i * 0.37 + 0.1) % 1; j.sheaf.push([l.x0 + (l.x1 - l.x0) * t, l.z0 + (l.z1 - l.z0) * t, i * 1.3]); } }
  }
  function endJob(j) {
    if (j.bulls) { j.bulls.forEach(a => { a.vis = false; a.busy = false; }); j.bulls = null; }
    if (j.kind === 'tractor' && FM.tractor) { FM.tractor.g.visible = false; FM.tractorBusy = false; }
  }
  function rankFields(cp, m) {
    const max = tier === 'low' ? 1 : tier === 'medium' ? 2 : 4, R = 165;
    for (let i = FM.jobs.length - 1; i >= 0; i--) { const j = FM.jobs[i], f = j.f; if (f.playerFarm || Math.hypot(f.cx - cp.x, f.cz - cp.z) > R + 45 + Math.sqrt(f.area) / 2) { endJob(j); FM.jobs.splice(i, 1); } }
    if (FM.jobs.length >= max) return;
    const C = [];
    for (const f of world.fields) { if (f.area < 800 || f.c > 5 || f.playerFarm || FM.jobs.some(j => j.f === f)) continue;   // the player's own plots stay theirs
      const d = Math.hypot(f.cx - cp.x, f.cz - cp.z) - Math.sqrt(f.area) / 2; if (d < R) C.push([d, f]); }
    C.sort((a, b) => a[0] - b[0]);
    for (const [, f] of C) {
      if (FM.jobs.length >= max) break;
      // a quarter of the parcels are left quiet: not every field in view has people in it on the same day
      if (!FM.forceKind && ((f.i * 2654435761 >>> 0) + new Date().getDate() * 97) % 4 === 0) continue;
      let k = kindFor(f, m); if (!k) continue;
      if (k === 'plough' && FM.bulls.filter(a => !a.busy).length < 2) k = 'sow';
      if (k === 'tractor' && (!FM.tractor || FM.tractorBusy)) { k = FM.bulls.filter(a => !a.busy).length >= 2 ? 'plough' : 'sow'; }
      const lanes = lanesOf(f); if (lanes.length < 2) continue;
      const j = { f, kind: k, lanes, P: snake(lanes), s: 0 };
      if (k === 'plough') { j.bulls = FM.bulls.filter(a => !a.busy).slice(0, 2); j.bulls.forEach(a => { a.busy = true; }); }
      if (k === 'tractor') FM.tractorBusy = true;
      dressCrew(j); FM.jobs.push(j);
    }
  }
  function workState(h, m) {
    if (h < 6.4 || h > 17.9) return 'off';
    const hot = m === 3 || m === 4;                    // April and May: out of the sun by late morning, back near evening
    if (hot ? h > 10.8 && h < 15.6 : h > 11.8 && h < 14) return 'rest';
    return 'work';
  }
  // ploughed ground behind the team: a darker strip per finished row, a growing one on the current row
  function furrows(j, q, w, hex) {
    const n = FM.n, P = j.P;
    for (let i = 0; i <= q.seg && n.strip < 40; i += 2) {
      const a = P.pts[i], b = i === q.seg ? [q.x, q.z] : P.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.2) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      _q.setFromAxisAngle(_up, Math.atan2(dx, dz)); M.compose(_p.set(mx, gy(mx, mz) + 0.012, mz), _q, _s.set(w, 0.02, L)); fset('strip', n.strip++, M, hex);
    }
  }
  const qf = { x: 0, z: 0, yaw: 0, seg: 0, t: 0 }, qb = { x: 0, z: 0, yaw: 0, seg: 0, t: 0 };
  function jobStep(j, dt, t, cp, hold, state) {
    const f = j.f, near = Math.hypot(f.cx - cp.x, f.cz - cp.z) < 120 + Math.sqrt(f.area) / 2, k = j.kind, rest = state === 'rest';
    if (rest && (k === 'plough' || k === 'tractor' || j.crew.length)) {           // noon: the crew sits at the head of the first row and eats
      const L = j.lanes[0];
      j.crew.forEach((w, i) => { const x = L.x0 + i * 0.75, z = L.z0 + (i % 2) * 0.8, e = Math.sin(t * 1.4 + w.ph) > 0.4; farmer(x, z, Object.assign({}, w, { hip: 0.26, crouch: true, yaw: i * 2.1, pitch: 0.12, lL: -1.45, lR: -1.45, kL: 1.5, kR: 1.5, aR: e ? -1.1 : -0.5, fR: e ? -1.9 : -1, aL: -0.5, fL: -1 }), near); });
    }
    if (k === 'plough') {
      if (!rest && !hold) j.s += 1.05 * dt;
      pathPos(j.P, j.s, qf); pathPos(j.P, j.s - 3.6, qb);
      furrows(j, qb, 1.3, 0x75553c);
      const c = Math.cos(qf.yaw), sn = Math.sin(qf.yaw);
      j.bulls.forEach((a, i) => {
        const sx = i ? 0.55 : -0.55; a.x = qf.x + c * sx; a.z = qf.z - sn * sx; a.y = gy(a.x, a.z); a.yaw = qf.yaw; a.vis = true;
        if (rest || hold) { a.pose.legs.forEach(l => { l[0] = l[1] = 0; }); a.pose.headX = 0.3; } else window.VillageAnimals.puppetWalk(a, 1.05 * dt);
      });
      const g0 = gy(qf.x, qf.z), yx = qf.x + sn * 0.72, yz = qf.z + c * 0.72, px = qb.x + sn * 0.9, pz = qb.z + c * 0.9, gb = gy(qb.x, qb.z);
      stick(yx - c * 0.85, g0 + 1.24, yz + sn * 0.85, yx + c * 0.85, g0 + 1.24, yz - sn * 0.85, 0.045, 0x6a4a2a);    // yoke
      stick(yx, g0 + 1.2, yz, px, gb + 0.32, pz, 0.04, 0x7a5a36);                                                  // beam
      stick(px, gb + 0.34, pz, px - sn * 0.3, gb + 0.02, pz - c * 0.3, 0.05, 0x4a4a4e);                            // share
      stick(px, gb + 0.34, pz, px - sn * 0.42, gb + 1, pz - c * 0.42, 0.024, 0x6a4a2a);                            // handle
      if (!rest) { const w = j.crew[0]; w.ph += hold ? 0 : dt * 3.8; const x = qb.x - sn * 0.35, z = qb.z - c * 0.35, S = stride(w.ph, hold ? 0 : 0.42); S.aR = -0.75; S.fR = -0.55; S.aL = -0.2 + Math.sin(t * 2) * 0.5; S.fL = -0.8; const hd = farmer(x, z, Object.assign({}, w, S, { yaw: qb.yaw, pitch: 0.22, hip: 0.88 }), near); if (hd) stick(hd.x, hd.y, hd.z, hd.x + sn * 0.25, hd.y + 0.5, hd.z + c * 0.25, 0.01, 0x8a6a42); }
      return;
    }
    if (k === 'tractor') {
      const v = FM.tractor;
      if (!rest && !hold) { j.s += 2.3 * dt; v.wheels.forEach(w => { w.rotation.x += dt * 5; }); }
      pathPos(j.P, j.s, qf); pathPos(j.P, j.s - 3.8, qb); furrows(j, qb, 1.9, 0x6e4e36);
      v.g.visible = true; v.g.position.set(qf.x, gy(qf.x, qf.z), qf.z); v.g.rotation.y += ((qf.yaw - v.g.rotation.y + Math.PI * 3) % TAU - Math.PI) * Math.min(1, dt * 3);
      const r = v.g.rotation.y, sn = Math.sin(r), c = Math.cos(r), b = gy(qb.x, qb.z);
      stick(qf.x - sn * 1.3, b + 0.5, qf.z - c * 1.3, qb.x, b + 0.3, qb.z, 0.06, 0x7f2f22);
      stick(qb.x - c * 0.9, b + 0.2, qb.z + sn * 0.9, qb.x + c * 0.9, b + 0.2, qb.z - sn * 0.9, 0.09, 0x4a4a4e);
      return;
    }
    if (rest) return;
    if (j.sheaf) for (const q of j.sheaf) loadAt(q[0], gy(q[0], q[1]) + 0.1, q[1], q[2], 0.8, 0xc2a252);
    for (const w of j.crew) {
      const l = j.lanes[w.lane], ux = (l.x1 - l.x0) / l.L, uz = (l.z1 - l.z0) / l.L, yaw = Math.atan2(ux, uz); let o;
      const at = u => { w.x = l.x0 + (l.x1 - l.x0) * u; w.z = l.z0 + (l.z1 - l.z0) * u; };
      if (k === 'sow') {                                  // walk the row, a bag on the left arm, cast from the right
        if (!hold) { w.u += w.dir * 0.75 * dt / l.L; w.ph += dt * 3.4; } if (w.u > 0.97 || w.u < 0.03) { w.dir *= -1; w.lane = (w.lane + 1) % j.lanes.length; w.u = Math.max(0.03, Math.min(0.97, w.u)); }
        at(w.u); const c = (t * 0.9 + w.ph * 0.1) % 1; o = stride(w.ph, 0.3); o.aL = -0.7; o.fL = -1.2; o.aR = c < 0.5 ? -0.4 - c * 3 : -1.9 + (c - 0.5) * 3; o.fR = -0.4; o.yaw = w.dir > 0 ? yaw : yaw + Math.PI; o.hip = 0.89;
        const hd = farmer(w.x, w.z, Object.assign({}, w, o), near);
        if (hd && near) { const y = gy(w.x, w.z); loadAt(w.x + Math.cos(o.yaw) * 0.25, y + 1, w.z - Math.sin(o.yaw) * 0.25, o.yaw, 0.32, 0xd8cfa8); }
      } else if (k === 'transplant') {                    // a bent line stepping backwards, pressing seedlings in
        if (!hold) w.u -= 0.1 * dt / l.L; if (w.u < 0.04) w.u = 0.96;
        at(w.u); const c = Math.sin(t * 2.4 + w.ph);
        farmer(w.x, w.z, Object.assign({}, w, { yaw: yaw, pitch: 1.3, hip: 0.8, lL: -0.45, lR: 0.1, kL: 0.5, kR: 0.2, aL: -1.0, fL: -0.9, aR: -0.9 - c * 0.45, fR: -0.2 }), near);
      } else if (k === 'weed') {                          // squatting, short hoe chopping, shuffling on
        if (!hold) w.u += 0.09 * dt / l.L; if (w.u > 0.96) w.u = 0.04;
        at(w.u); const c = Math.sin(t * 3 + w.ph), hd = farmer(w.x, w.z, Object.assign({}, w, { crouch: true, yaw, hip: 0.38, pitch: 0.65, lL: -1.85, lR: -1.75, kL: 2.2, kR: 2.1, aR: -0.7 - c * 0.5, fR: -0.5, aL: -0.9, fL: -0.6 }), near);
        if (hd && near) { const fx = Math.sin(yaw), fz = Math.cos(yaw); stick(hd.x, hd.y, hd.z, hd.x + fx * 0.28, hd.y - 0.22, hd.z + fz * 0.28, 0.014, 0x6a4a2a); stick(hd.x + fx * 0.28, hd.y - 0.22, hd.z + fz * 0.28, hd.x + fx * 0.36, hd.y - 0.3, hd.z + fz * 0.36, 0.05, 0x54575c); }
      } else if (k === 'pick') {                          // standing among the plants, both hands picking into a shoulder sack
        if (!hold) w.u += 0.11 * dt / l.L; if (w.u > 0.96) w.u = 0.04;
        at(w.u); const c = Math.sin(t * 2.2 + w.ph);
        farmer(w.x, w.z, Object.assign({}, w, { yaw, hip: 0.88, pitch: 0.62, lL: -0.1, lR: 0.08, aL: -1.1 + c * 0.3, fL: -0.4, aR: -1.1 - c * 0.3, fR: -0.4 }), near);
        if (near) loadAt(w.x - Math.sin(yaw) * 0.26, gy(w.x, w.z) + 0.72, w.z - Math.cos(yaw) * 0.26, yaw, 0.55, 0xd8cfa8);
      } else if (k === 'harvest') {                       // bent, left hand gathers, sickle draws through, a step every few cuts
        if (!hold && (t * 0.3 + w.ph) % 1 < 0.2) w.u += 0.45 * dt / l.L; if (w.u > 0.96) w.u = 0.04;
        at(w.u); const c = Math.sin(t * 3.4 + w.ph), hd = farmer(w.x, w.z, Object.assign({}, w, { yaw, hip: 0.76, pitch: 1.2, lL: -0.5, lR: 0.2, kL: 0.65, kR: 0.3, aL: -0.9, fL: -0.5, aR: -0.75 + c * 0.45, fR: -0.3 }), near);
        if (hd && near) stick(hd.x, hd.y, hd.z, hd.x + Math.cos(yaw) * 0.22, hd.y - 0.04, hd.z - Math.sin(yaw) * 0.22, 0.012, 0x8a8d90);
      } else {                                            // carry: sheaves on the head to the row end, back empty
        const lden = w.dir > 0;
        if (!hold) { w.u += w.dir * 1.05 * dt / l.L; w.ph += dt * 3.6; } if (w.u > 0.97) { w.u = 0.97; w.dir = -1; } else if (w.u < 0.03) { w.u = 0.03; w.dir = 1; w.lane = (w.lane + 1) % j.lanes.length; }
        at(w.u); o = stride(w.ph, 0.36); o.yaw = w.dir > 0 ? yaw : yaw + Math.PI; o.hip = 0.89; o.carry = lden; if (lden) { o.aR = -2.9; o.fR = -0.5; }
        farmer(w.x, w.z, Object.assign({}, w, o), near);
        if (lden && FM.top) loadAt(FM.top.x, FM.top.y, FM.top.z, o.yaw, 1, 0xc2a252);
      }
    }
  }
  function stepFarm(dt, game, h) {
    const n = FM.n; n.p = n.limb = n.wrap = n.stick = n.load = n.strip = 0; FM.top = null;
    const cp = game.camera.position, m = monthNow(), state = workState(h, m);
    FM.rankT -= dt;
    if (FM.rankT < 0) { FM.rankT = 2; if (state === 'off') { FM.jobs.forEach(endJob); FM.jobs.length = 0; } else rankFields(cp, m); }
    if (state !== 'off') for (const j of FM.jobs) {
      // anyone driving or walking through the row: the work stops until they pass
      try { jobStep(j, dt, T, cp, nearWork(j, game.carPos), state); } catch (e) { console.error('farm', j.kind, e); j.kind = 'weed'; }
    }
    const c = { head: n.p, torso: n.p, skirt: n.p, wrap: n.wrap, arm: n.limb, fore: n.limb, thigh: n.limb, shin: n.limb, stick: n.stick, load: n.load, strip: n.strip };
    for (const k in c) { const q = FM.m[k]; q.count = c[k]; q.instanceMatrix.needsUpdate = true; if (q.instanceColor) q.instanceColor.needsUpdate = true; }
  }
  function nearWork(j, p) {
    if (j.kind === 'plough' || j.kind === 'tractor') { pathPos(j.P, j.s, qb); return Math.hypot(qb.x - p.x, qb.z - p.z) < 6; }
    return false;
  }
  window.VillageFarm = FM;

  // ------------------------------------------------------------------ birds
  const SPECIES = {
    crow: { col: [0x1b1b1f, 0x232327], sc: 1.05, speed: 9, flap: 9, perch: 'wire', n: 7, flocks: 3, cruise: 14, active: [5.5, 18.9] },
    parrot: { col: [0x35b34a, 0x46c55a, 0x2ea043], sc: 0.82, speed: 15, flap: 16, perch: 'wire', n: 8, flocks: 2, cruise: 16, active: [6, 18.6] },
    sparrow: { col: [0x8a6a45, 0x9c7a50, 0x75583a], sc: 0.5, speed: 7, flap: 24, perch: 'ground', n: 9, flocks: 2, cruise: 5, active: [5.6, 18.6] },
    pigeon: { col: [0x7d8896, 0x8e97a4, 0x6a7482], sc: 0.9, speed: 11, flap: 11, perch: 'ground', n: 8, flocks: 2, cruise: 11, active: [6, 18.8] },
  };
  let bird = null, flocks = []; const events = [];
  function buildBirds() {
    const body = merged([[new THREE.SphereGeometry(0.075, 7, 5), 0xffffff, M4(0, 0, 0, 0.85, 0.85, 1.75)], [new THREE.SphereGeometry(0.052, 6, 4), 0xffffff, M4(0, 0.045, 0.125)], [new THREE.ConeGeometry(0.016, 0.05, 4), 0xcfa070, M4(0, 0.038, 0.185, 1, 1, 1, Math.PI / 2)], [new THREE.BoxGeometry(0.075, 0.012, 0.17), 0xbbbbbb, M4(0, 0.005, -0.2, 1, 1, 1, 0.1)]]);
    const shape = new THREE.BufferGeometry();     // wing: a swept blade from the shoulder, +x outward
    shape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.07, 0.24, 0, -0.02, 0, 0, -0.08, 0, 0, -0.08, 0.24, 0, -0.02, 0, 0, 0.07], 3));
    shape.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    shape.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
    const wr = tier === 'low' ? 0.5 : tier === 'medium' ? 0.75 : 1;
    for (const id in SPECIES) { const S = SPECIES[id]; for (let f = 0; f < S.flocks; f++) { const m = []; const n = Math.max(3, Math.round(S.n * wr)); for (let i = 0; i < n; i++) m.push({ ox: rnd(-1, 1), oy: rnd(-0.5, 0.5), oz: rnd(-1, 1), ph: Math.random() * TAU, x: 0, y: 0, z: 0, yaw: 0, col: new THREE.Color(pick(S.col)), j: Math.random() }); flocks.push({ id, S, m, state: 'off', timer: rnd(1, 8), x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, sx: 0, sz: 0, flew: 0 }); } }
    const N = flocks.reduce((s, f) => s + f.m.length, 0);
    bird = { body: IM(body, N), wing: IM(shape, N * 2) }; bird.wing.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  }
  function perchFor(f, p, rMin, rMax) {
    const P = world.poles || [];
    if (f.S.perch === 'wire' && P.length) for (let k = 0; k < 25; k++) {
      const i = Math.random() * (P.length - 1) | 0, a = P[i], b = P[i + 1]; if (b[2] !== a[2]) continue; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 45) continue;
      const t = rnd(0.2, 0.8), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, d = Math.hypot(x - p.x, z - p.z); if (d < rMin || d > rMax) continue;
      f.tx = x; f.tz = z; f.ty = 7.0; f.wx = (b[0] - a[0]) / (L || 1); f.wz = (b[1] - a[1]) / (L || 1); f.ground = false; return true;
    }
    for (let k = 0; k < 20; k++) {
      const th = Math.random() * TAU, d = rnd(rMin, rMax), x = p.x + Math.cos(th) * d, z = p.z + Math.sin(th) * d;
      if (blocked(x, z, 1)) continue;
      f.tx = x; f.tz = z; f.ty = gy(x, z) + 0.04; f.wx = 1; f.wz = 0; f.ground = true; return true;
    }
    return false;
  }
  function scatter(f, x, z) {
    if (f.state !== 'perch') return;
    f.state = 'scatter'; f.timer = rnd(1.4, 2.2); f.sx = f.x - x; f.sz = f.z - z;
    for (const b of f.m) { b.vx = rnd(-3, 3); b.vy = rnd(3, 6); b.vz = rnd(-3, 3); }
    if (events.length < 6) events.push({ kind: f.id, x: f.x, y: f.y + 1, z: f.z });
  }
  let lastHorn = -1;
  function stepBirds(dt, game, h) {
    const cp = game.camera.position, pl = game.carPos, foot = game.playerMode === 'foot', sp = Math.abs(typeof carSpeed === 'number' ? carSpeed : 0);
    const he = window.HornEvent, horn = he && he.t !== lastHorn ? he : null; if (he) lastHorn = he.t;
    let nB = 0, nW = 0;
    for (const f of flocks) {
      const S = f.S, up = h >= S.active[0] && h < S.active[1];
      if (!up) { f.state = 'off'; continue; }
      if (f.state === 'off') { f.timer -= dt; if (f.timer > 0 || !perchFor(f, pl, 40, 170)) continue; f.x = f.tx; f.y = f.ty; f.z = f.tz; f.state = 'perch'; f.timer = rnd(8, 30); f.m.forEach((b, i) => { place(f, b, i); b.x = b.px; b.y = b.py; b.z = b.pz; }); }
      if (Math.hypot(f.x - pl.x, f.z - pl.z) > 300) { f.state = 'off'; f.timer = rnd(0, 4); continue; }
      f.timer -= dt;
      if (f.state === 'perch') {
        if (horn && Math.hypot(f.x - horn.x, f.z - horn.z) < (horn.r || 22) + 12) scatter(f, horn.x, horn.z);
        const d = Math.hypot(f.x - pl.x, f.z - pl.z);
        if (f.ground ? (foot ? d < 7 : d < 10 + sp * 0.2) : (foot ? false : d < 5 && sp > 25)) scatter(f, pl.x, pl.z);
        if (f.state === 'perch' && f.timer < 0) { const dusk = h > 16.8 || h < 8; perchFor(f, pl, 40, dusk ? 170 : 130); f.state = 'fly'; f.flew = 0; f.fromY = f.y; }
      }
      if (f.state === 'scatter' && f.timer < 0) { perchFor(f, pl, 50, 150); f.state = 'fly'; f.flew = 0; f.fromY = f.y; }
      if (f.state === 'fly') {
        const dx = f.tx - f.x, dz = f.tz - f.z, D = Math.hypot(dx, dz) || 1, v = S.speed;
        f.x += dx / D * v * dt; f.z += dz / D * v * dt; f.flew += v * dt;
        const cr = Math.max(f.ty + 2, gy(f.x, f.z) + S.cruise), yWant = D < 18 ? f.ty + (cr - f.ty) * (D / 18) ** 2 : cr;
        f.y += (yWant - f.y) * Math.min(1, dt * 1.4); f.head = Math.atan2(dx, dz);
        if (D < 1.5) { f.state = 'perch'; f.x = f.tx; f.y = f.ty; f.z = f.tz; f.timer = rnd(14, 55); }
      }
      if (Math.hypot(f.x - cp.x, f.z - cp.z) > 240) continue;
      for (let i = 0; i < f.m.length; i++) {
        const b = f.m[i]; let flap = 0, tuck = true;
        if (f.state === 'scatter') { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vy *= 1 - dt * 0.4; b.yaw = Math.atan2(b.vx, b.vz); tuck = false; flap = Math.sin(T * S.flap * 1.4 + b.ph); }
        else if (f.state === 'fly') {
          const sw = 2.2 + f.m.length * 0.2, tx = f.x + b.ox * sw + Math.sin(T * 0.9 + b.ph) * 0.8, ty = f.y + b.oy * sw * 0.7 + Math.sin(T * 1.3 + b.ph) * 0.3, tz = f.z + b.oz * sw + Math.cos(T * 0.8 + b.ph) * 0.8, k = Math.min(1, dt * 2.6);
          b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z += (tz - b.z) * k; b.yaw = f.head; tuck = false;
          flap = (id2glide(f.id) && Math.sin(T * 0.6 + b.ph) > 0.55) ? 0.3 : Math.sin(T * S.flap + b.ph);
        } else {
          place(f, b, i); const k = Math.min(1, dt * 3); b.x += (b.px - b.x) * k; b.y += (b.py - b.y) * k; b.z += (b.pz - b.z) * k;
          const settling = Math.hypot(b.x - b.px, b.z - b.pz) > 0.35; tuck = !settling; flap = settling ? Math.sin(T * S.flap + b.ph) : 0;
          if (tuck) b.yaw = f.ground ? b.ph + Math.sin(T * 0.7 + b.ph) * 0.8 : Math.atan2(f.wz, -f.wx) + (i % 2 ? Math.PI : 0);
        }
        const peck = f.ground && tuck && Math.sin(T * 3 + b.ph * 5) > 0.5 ? 0.6 : 0, s = S.sc;
        _e.set(peck, b.yaw, 0, 'YXZ'); _q.setFromEuler(_e); Mb.compose(_p.set(b.x, b.y + 0.09 * s, b.z), _q, _s.set(s, s, s));
        bird.body.setMatrixAt(nB, Mb); bird.body.setColorAt(nB, b.col); nB++;
        for (const sx of [1, -1]) {
          const fold = tuck ? 1 : 0, ang = tuck ? -1.45 : flap * 0.85 + 0.12;
          M.copy(Mb).multiply(Mr.makeTranslation(sx * 0.05, 0.03, 0.03));
          if (sx < 0) M.multiply(Mr.makeScale(-1, 1, 1));
          M.multiply(Mr.makeRotationZ(ang)); if (fold) M.multiply(Mr.makeRotationY(1.3)).multiply(Mr.makeScale(0.8, 1, 0.6));
          bird.wing.setMatrixAt(nW, M); bird.wing.setColorAt(nW, b.col); nW++;
        }
      }
    }
    bird.body.count = nB; bird.wing.count = nW;
    for (const k of ['body', 'wing']) { bird[k].instanceMatrix.needsUpdate = true; if (bird[k].instanceColor) bird[k].instanceColor.needsUpdate = true; }
  }
  const id2glide = id => id === 'pigeon' || id === 'crow';
  function place(f, b, i) {
    if (f.ground) { const hop = Math.floor(T * 0.5 + b.ph) * 1.7 + b.ph; b.px = f.x + b.ox * 2.2 + Math.sin(hop) * 0.5; b.pz = f.z + b.oz * 2.2 + Math.cos(hop) * 0.5; b.py = f.y; }
    else { const o = (i - f.m.length / 2) * 0.8 + b.ox * 0.2; b.px = f.x + f.wx * o; b.pz = f.z + f.wz * o; b.py = f.y; }
  }
  window.VillageBirds = {
    get events() { return events; }, get flocks() { return flocks; },
    near(id, x, z, R) { let best = null, bd = R; for (const f of flocks) { if (f.id !== id || f.state === 'off') continue; const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } } return best; },
  };

  // ------------------------------------------------------------------ hooks
  let slow = 0, ready = false;
  GameHooks.init.push(game => {
    try {
      G = game; world = game.world; scene = game.scene; tier = (window.Quality && Quality.tier) || 'high';
      try { buildFarm(); FM.ready = !!(world.fields && world.fields.length); } catch (e) { console.error('farm init failed', e); }
      buildProps(); buildRiders(); buildWorkers(); crowdInit(); buildKidMeshes(); findSpots(); buildBirds();
      scheduleRiders(hour(), game); crowdSchedule(hour()); ready = true;
      console.log('village-life:', spots.length, 'game spots,', workers.length, 'workers,', flocks.length, 'flocks,', extras.length, 'extra riders');
    } catch (e) { console.error('village-life init failed', e); }
  });
  GameHooks.update.push((dt, game) => {
    if (!ready) return; T += dt; const h = hour();
    slow -= dt; if (slow < 0) { slow = 5; scheduleRiders(h, game); crowdSchedule(h); }
    stepWorkers(dt, game, h); stepGames(dt, game, h); stepBirds(dt, game, h); if (FM.ready) stepFarm(dt, game, h);
  });
  window.VillageLife = { get spots() { return spots; }, get active() { return active; }, get workers() { return workers; }, get extras() { return extras; } };
})();
