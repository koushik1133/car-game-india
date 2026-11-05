// Jangaon street life, loaded with jangaon-net.json only when the town streams in: signals, street lamps, traffic on the full road
// graph (TrafficModels mix, OBB contact as in the village), people (HumanModel close up, one instanced crowd beyond), heights, humps.
(function () {
  'use strict';
  const J = window.Jangaon; if (!J) return;
  const cellM = new Map(); const kmNear = (x, z) => { let m = 0; const a = Math.floor(x / 100), b = Math.floor(z / 100); for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) m += cellM.get((a + i) * 100003 + b + j) || 0; return m / 1000; };
  let N = null, G = null, Hd = null, H = null, cells = new Map(), adj = new Map(), elen = [], humpGrid = new Map(), root = null;
  const frac = () => (window.Quality && Quality.TIERS[Quality.tier].peopleFrac) || 1;
  const h = (x, z) => { if (!H) return 0; const u = (x - H.x0) / 40, v = (z - H.z0) / 40, i = Math.floor(u), j = Math.floor(v); if (i < 0 || j < 0 || i >= H.nx - 1 || j >= H.nz - 1) return 0; const a = u - i, b = v - j, q = j * H.nx + i, d = Hd; return ((d[q] * (1 - a) + d[q + 1] * a) * (1 - b) + (d[q + H.nx] * (1 - a) + d[q + H.nx + 1] * a) * b) / 100; };
  function hump(x, z) { const l = humpGrid.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16)); if (!l) return 0;
    for (const q of l) { const dx = x - q[0], dz = z - q[1], sa = Math.sin(q[2]), ca = Math.cos(q[2]), al = dx * sa + dz * ca, si = dx * ca - dz * sa; if (Math.abs(al) >= q[4] / 2 || Math.abs(si) >= q[3] / 2) continue; const c = Math.cos(Math.PI * al / q[4]); return q[5] * c * c; } return 0; }
  function ptOn(e, s) { const P = e[4]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; if (s <= l || i === P.length - 1) { const t = Math.min(1, s / l); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l]; } s -= l; } return [P[0][0], P[0][1], 1, 0]; }
  function pick(px, pz, min, max, ok) { const R = Math.ceil(max / 100), c0 = Math.floor(px / 100), c1 = Math.floor(pz / 100);
    for (let t = 0; t < 30; t++) { const l = cells.get((c0 + Math.floor(Math.random() * (2 * R + 1)) - R) * 100003 + c1 + Math.floor(Math.random() * (2 * R + 1)) - R); if (!l) continue; const q = l[Math.random() * l.length | 0], e = N.edges[q[0]], p = e[4][q[1]], d = Math.hypot(p[0] - px, p[1] - pz); if (d > min && d < max && elen[q[0]] > 20 && (!ok || ok(e))) return q; } return null; }

  // ---------------------------------------------------------- signals
  const SIG = { green: 14, amber: 3, red: 1.5 }, CYC = 2 * (SIG.green + SIG.amber + SIG.red); let sigT = 0, sigAp = new Map(), lampM = null, lampCol = [];
  const sigState = (s, ph) => { const t = (sigT + s.off) % CYC, half = CYC / 2, q = ph ? (t + half) % CYC : t; return q < SIG.green ? 2 : q < SIG.green + SIG.amber ? 1 : 0; };   // 2 go, 1 amber, 0 stop
  const merge = (list) => { const P = [], Nn = []; for (const [g, m] of list) { g.applyMatrix4(m); const u = g.index ? g.toNonIndexed() : g; P.push(...u.attributes.position.array); Nn.push(...u.attributes.normal.array); } const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); b.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); return b; };
  const T = (x, y, z, ry) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry || 0), new THREE.Vector3(1, 1, 1));
  function makeSignals() {
    const body = merge([[new THREE.CylinderGeometry(.07, .09, 4.4, 6), T(0, 2.2, 0)], [new THREE.BoxGeometry(.34, 1, .2), T(0, 4.3, 0)]]);
    const apN = N.sig.reduce((a, s) => a + s.ap.length, 0), m = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ color: 0x2a2c30 }), apN), disc = new THREE.CircleGeometry(.1, 8);
    lampM = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff }), apN * 3); m.frustumCulled = lampM.frustumCulled = false; root.add(m, lampM);
    const o = new THREE.Object3D(), c = new THREE.Color(); let n = 0, l = 0;
    N.sig.forEach((s, si) => { s.off = si * 7.3; s.y0 = h(s.x, s.z); s.st = [-1, -1]; s.rows = []; s.ap.forEach(a => { const y = h(a[4], a[5]); sigAp.set(a[0] * 2 + a[1], [s, a[3]]);
      o.position.set(a[4], y, a[5]); o.rotation.set(0, a[2], 0); o.updateMatrix(); m.setMatrixAt(n++, o.matrix);       // heads look down the approach
      const fx = Math.sin(a[2]), fz = Math.cos(a[2]), base = l; [[4.62], [4.3], [3.98]].forEach(([yy]) => { o.position.set(a[4] + fx * .11, y + yy, a[5] + fz * .11); o.updateMatrix(); lampM.setMatrixAt(l, o.matrix); lampM.setColorAt(l, c.setHex(0x222222)); l++; }); s.rows.push([a[3], base]); }); });
    lampM.instanceMatrix.needsUpdate = true;
  }
  function stepSignals(dt) { sigT += dt; const c = new THREE.Color(); let ch = false;
    for (const s of N.sig) for (const ph of [0, 1]) { const st = sigState(s, ph); if (st === s.st[ph]) continue; s.st[ph] = st; ch = true; for (const r of s.rows) if (r[0] === ph) { lampM.setColorAt(r[1], c.setHex(st === 0 ? 0xff2a1a : 0x2a0a08)); lampM.setColorAt(r[1] + 1, c.setHex(st === 1 ? 0xffb000 : 0x2a2008)); lampM.setColorAt(r[1] + 2, c.setHex(st === 2 ? 0x18ff5a : 0x082a10)); } }
    if (ch) lampM.instanceColor.needsUpdate = true; }

  // ---------------------------------------------------------- street lamps: the village method, emissive bulb + halo Points + additive pool, nearest LN only
  const LN = 240; let poles, bulbs, halo, pools, haloMat, poolMat, bulbMat, lampAt = { x: 1e9, z: 0 }, active = [];
  function makeLamps() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const glow = new THREE.CanvasTexture(c);
    poles = new THREE.InstancedMesh(merge([[new THREE.CylinderGeometry(.06, .1, 7.5, 5), T(0, 3.75, 0)], [new THREE.BoxGeometry(.07, .07, 1.5), T(0, 7.5, .75)]]), new THREE.MeshLambertMaterial({ color: 0x8b8f92 }), LN);
    bulbMat = new THREE.MeshBasicMaterial({ color: 0x55504a }); bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(.18, .08, .5), bulbMat, LN);
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2); poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xd8904a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }); pools = new THREE.InstancedMesh(pg, poolMat, LN);
    const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LN * 3), 3)); haloMat = new THREE.PointsMaterial({ map: glow, color: 0xffc070, size: 2.6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }); halo = new THREE.Points(b, haloMat);
    poles.frustumCulled = bulbs.frustumCulled = pools.frustumCulled = halo.frustumCulled = false; pools.renderOrder = 2; root.add(poles, bulbs, pools, halo);
  }
  function placeLamps(px, pz) { active = N.lamps.map(l => [Math.abs(l[0] - px) + Math.abs(l[1] - pz), l]).sort((a, b) => a[0] - b[0]).slice(0, LN).map(q => q[1]);
    const o = new THREE.Object3D(), hp = halo.geometry.attributes.position; active.forEach((l, i) => { const y = h(l[0], l[1]), fx = Math.sin(l[2]), fz = Math.cos(l[2]); o.scale.set(1, 1, 1); o.position.set(l[0], y, l[1]); o.rotation.set(0, l[2], 0); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
      o.position.set(l[0] + fx * 1.45, y + 7.44, l[1] + fz * 1.45); o.updateMatrix(); bulbs.setMatrixAt(i, o.matrix); hp.setXYZ(i, l[0] + fx * 1.45, y + 7.3, l[1] + fz * 1.45);
      o.position.set(l[0] + fx * 2.6, y + .2, l[1] + fz * 2.6); o.scale.set(17, 1, 15); o.updateMatrix(); pools.setMatrixAt(i, o.matrix); });
    poles.count = bulbs.count = pools.count = active.length; halo.geometry.setDrawRange(0, active.length); hp.needsUpdate = poles.instanceMatrix.needsUpdate = bulbs.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true; lampAt = { x: px, z: pz }; }
  const isNight = () => typeof timeOfDay === 'number' && (timeOfDay > 18.3 || timeOfDay < 5.9);
  function stepLamps(px, pz) { if (Math.abs(px - lampAt.x) + Math.abs(pz - lampAt.z) > 60) placeLamps(px, pz); const n = isNight(); haloMat.opacity = n ? .95 : 0; poolMat.opacity = n ? .9 : 0; halo.visible = pools.visible = n; bulbMat.color.setHex(n ? 0xffe2b0 : 0x55504a); }

  // ---------------------------------------------------------- traffic
  const PLAN = [['auto', 9, 0], ['bike', 11, 0], ['splendor', 3, 0], ['scooter', 4, 0], ['hatch', 3, 0], ['swift', 2, 0], ['dzire', 3, 0], ['alto', 3, 0], ['suv', 1, 1], ['mpv', 2, 1], ['bolero', 2, 0], ['scorpio', 1, 1], ['tractor', 2, 0], ['lorry', 3, 2], ['bus', 3, 2], ['ace', 2, 1]];
  const SPEED = { auto: 8, bike: 11, splendor: 11, scooter: 9, tractor: 5, lorry: 10, bus: 10 }, cars = [], todo = []; PLAN.forEach(p => { for (let i = 0; i < p[1]; i++) todo.push(p); });
  for (let i = todo.length - 1; i > 0; i--) { const k = Math.random() * (i + 1) | 0, q = todo[i]; todo[i] = todo[k]; todo[k] = q; }
  const AI = () => window.TrafficAI;
  function addCar() { const p = todo.shift(), f = TrafficModels[p[0]] || TrafficModels.hatch, v = f(); v.g.visible = false; G.scene.add(v.g); const box = new THREE.Box3().setFromObject(v.g), sz = box.getSize(new THREE.Vector3());
    cars.push({ g: v.g, wheels: v.wheels || [], kind: p[0], cls: p[2], Ln: Math.min(13, Math.max(1.7, sz.z)), W: Math.min(2.6, Math.max(.7, sz.x)), sp: (SPEED[p[0]] || 12) * (.85 + Math.random() * .3), v: 0, x: 1e7, z: 0, e: -1, s: 0, dir: 1, box: null, hd: 0, red: 0 }); }
  function place(c, px, pz) { const q = pick(px, pz, 110, 340, e => c.cls === 2 ? e[3] !== 'cc' : c.cls === 1 ? e[2] >= 4.5 : true) ; if (!q) { c.e = -1; c.g.visible = false; return; }
    c.e = q[0]; c.dir = Math.random() < .5 ? 1 : -1; c.s = Math.random() * elen[c.e]; c.v = c.sp * .7; c.snap = true; c.g.visible = true; }
  function stepCars(dt, px, pz, on) {
    if (on && todo.length && Math.random() < .03 && typeof TrafficModels !== 'undefined' && cars.length < Math.round(55 * frac())) addCar();
    const A = AI(), plo = A && A.playerOBB(); let vis = 0, cap = Math.min(cars.length, Math.round(kmNear(px, pz) * 5));
    for (let ci = 0; ci < cars.length; ci++) { const c = cars[ci]; if (!on || ci >= cap && Math.hypot(c.x - px, c.z - pz) > 200) { c.g.visible = false; c.e = -1; c.x = 1e7; c.box = null; continue; }
      if (c.e < 0 || Math.hypot(c.x - px, c.z - pz) > 430) { c.box = null; place(c, px, pz); if (c.e < 0) continue; }
      const e = N.edges[c.e], L = elen[c.e]; let lim = Math.min(c.sp, e[3] === 'cc' ? 7.5 : 99); c.red = 0;
      const toEnd = L - c.s, node = c.dir > 0 ? 1 : 0, sg = sigAp.get(c.e * 2 + node);                                       // signal on the approach we are on
      if (sg && toEnd > 8.5) { const st = sigState(sg[0], sg[1]); if (st !== 2 && !(st === 1 && toEnd < 14)) { const gap = toEnd - 10 - c.Ln / 2; c.red = 1; if (gap < 40) lim = Math.min(lim, Math.max(0, gap * .55)); } }
      if (c.box && A) { const consider = (b, v) => { const dx = b.x - c.box.x, dz = b.z - c.box.z; if (dx * dx + dz * dz > 1600) return; const g = A.gapAhead(c.box, b, .25, 0); if (g !== Infinity) lim = Math.min(lim, Math.max(0, v * Math.max(0, b.fx * c.box.fx + b.fz * c.box.fz) + (g - 2.2) * .6)); };
        if (plo) consider(plo.box, plo.v); for (const o of cars) if (o !== c && o.box) consider(o.box, o.v); }
      if (c.box && world().collide && lim > .5) { const q = { x: c.box.x + c.box.fx * (c.box.hl + 2.5), z: c.box.z + c.box.fz * (c.box.hl + 2.5) }; if (J.wallAt && J.wallAt(q, c.W / 2)) lim = Math.min(lim, 2); }
      c.v += Math.max(-7 * dt, Math.min(2.4 * dt, lim - c.v)); if (c.v < .02) c.v = 0; c.s += c.v * dt;
      if (c.s >= L) { const end = e[node], opt = adj.get(end).filter(q => q !== c.e), n = opt.length ? opt[Math.random() * opt.length | 0] : -1; if (n < 0) { c.dir = -c.dir; } else { c.dir = N.edges[n][0] === end ? 1 : -1; c.e = n; } c.s = 0; }
      const E = N.edges[c.e], lat = Math.min(E[2] / 4 + (E[2] > 6 ? .2 : 0), 2.4), p = ptOn(E, c.dir > 0 ? c.s : elen[c.e] - c.s), hx = p[2] * c.dir, hz = p[3] * c.dir, tx = p[0] + hz * lat, tz = p[1] - hx * lat, th = Math.atan2(hx, hz), k = c.snap ? 1 : Math.min(1, dt * 5);
      c.x += (tx - c.x) * k; c.z += (tz - c.z) * k; c.hd += Math.atan2(Math.sin(th - c.hd), Math.cos(th - c.hd)) * k; c.snap = false;
      c.g.position.set(c.x, h(c.x, c.z) + hump(c.x, c.z) + (G.world.surfaceAt(c.x, c.z) === 'field' ? 0 : .09), c.z); c.g.rotation.y = c.hd; vis++;
      for (const w of c.wheels) w.rotation.x += c.v * dt / .3;
      if (A) { c.box = A.obb(c.x, c.z, c.hd, c.Ln, c.W);
        if (plo && plo.solid) { const hit = A.overlap(c.box, plo.box); if (hit) { contact(c, hit, plo); } } } }
    return vis; }
  function contact(c, hit, plo) { const g = window, tvx = c.box.fx * c.v, tvz = c.box.fz * c.v; if (performance.now() - (c.lastHit || 0) > 1500) J.Life.hits++; c.lastHit = performance.now(); G.carPos.x += hit.nx * hit.depth; G.carPos.z += hit.nz * hit.depth; plo.box.x = G.carPos.x; plo.box.z = G.carPos.z;
    if (Player.mode === 'crysta') { const rvn = (vel.x - tvx) * hit.nx + (vel.z - tvz) * hit.nz; if (rvn < 0) { vel.x -= 1.2 * rvn * hit.nx; vel.z -= 1.2 * rvn * hit.nz; if (-rvn > 7) showComboPopup('CRASH!'); } carSpeed = lastSpeed = (vel.x * Math.sin(carRot) + vel.z * Math.cos(carRot)) * 3.6; } else { if (Math.abs(carSpeed) > 25) showComboPopup('CRASH!'); carSpeed *= .6; } c.v *= .5; }

  // ---------------------------------------------------------- people: one instanced crowd + HumanModel up close
  const PN = 220, folk = [], NEAR = 10, humans = []; let pm = null, hot = [], ht = 0, _o = new THREE.Object3D();
  function makeFolk() {
    const P = [], Nn = [], Cc = [], add = (g, y, col) => { const u = g.toNonIndexed(), p = u.attributes.position, n = u.attributes.normal; for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i) + y, p.getZ(i)); Nn.push(n.getX(i), n.getY(i), n.getZ(i)); Cc.push(...col); } };
    add(new THREE.CylinderGeometry(.09, .13, .82, 6), .41, [.3, .3, .35]); add(new THREE.CylinderGeometry(.2, .15, .62, 7), 1.13, [1, 1, 1]); add(new THREE.SphereGeometry(.12, 7, 5), 1.58, [.62, .42, .3]); add(new THREE.SphereGeometry(.125, 7, 4, 0, 6.3, 0, 1.5), 1.6, [.1, .08, .07]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    pm = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), PN); pm.frustumCulled = false; root.add(pm);
    const pal = [0xe8e8e8, 0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xf5b7b1, 0xffffff, 0x34495e], c = new THREE.Color();
    for (let i = 0; i < PN; i++) { pm.setColorAt(i, c.setHex(pal[i % pal.length])); folk.push({ on: false, x: 1e7, z: 0, e: -1, s: 0, dir: 1, side: 1, sp: 1 + Math.random() * .5, ph: Math.random() * 6, idle: false, ry: 0, hu: null }); }
    hot = J.landmarks.filter(l => ['busstand', 'market', 'station', 'hospital', 'temple'].includes(l.k));
  }
  function spawnFolk(f, px, pz) { f.on = false; const near = hot.filter(l => { const d = Math.hypot(l.x - px, l.z - pz); return d < 240; });
    if (near.length && Math.random() < .55) { const l = near[Math.random() * near.length | 0], a = Math.random() * 6.3, r = 6 + Math.random() * 26, x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r, s = world().surfaceAt(x, z); if (Math.hypot(x - px, z - pz) > 45 && !world().insideBuilding(x, z, .3) && s !== 'tar' && s !== 'highway') { f.idle = true; f.x = x; f.z = z; f.ry = Math.random() * 6.3; f.on = true; return; } }
    const q = pick(px, pz, 45, 260, e => e[3] !== 'highway' || Math.random() < .3); if (!q) return; f.idle = false; f.e = q[0]; f.s = Math.random() * elen[q[0]]; f.dir = Math.random() < .5 ? 1 : -1; f.side = Math.random() < .5 ? 1 : -1; f.on = true; }
  function stepFolk(dt, px, pz, on) { if (!pm) makeFolk(); pm.visible = on; if (!on) { humans.forEach(u => { u.h.group.visible = false; if (u.f) u.f.hu = null; u.f = null; }); return; }
    pm.count = Math.min(Math.ceil(PN * frac()), Math.round(kmNear(px, pz) * 14)); ht += dt; const cx = G.carPos.x, cz = G.carPos.z;
    for (let i = 0; i < pm.count; i++) { const f = folk[i]; if (!f.on || Math.hypot(f.x - px, f.z - pz) > 300) spawnFolk(f, px, pz);
      if (!f.on) { _o.position.set(0, -50, 0); _o.updateMatrix(); pm.setMatrixAt(i, _o.matrix); continue; }
      if (!f.idle) { f.s += f.dir * f.sp * dt; const n = elen[f.e]; if (f.s < 0 || f.s > n) { f.dir = -f.dir; f.s = Math.max(0, Math.min(n, f.s)); } const E = N.edges[f.e], p = ptOn(E, f.s), o = (E[2] / 2 + 1.1) * f.side; f.x = p[0] - p[3] * o; f.z = p[1] + p[2] * o; f.ry = Math.atan2(p[2] * f.dir, p[3] * f.dir);
        if (Math.abs(f.x - px) + Math.abs(f.z - pz) < 45 && world().insideBuilding(f.x, f.z, .2)) { f.dir = -f.dir; f.side = -f.side; } }
      const dc = Math.hypot(f.x - cx, f.z - cz); if (dc < 3.2 && dc > .01) { f.x += (f.x - cx) / dc * (3.2 - dc); f.z += (f.z - cz) / dc * (3.2 - dc); }
      f.ph += dt * 7; const y = h(f.x, f.z) + .08;
      if (f.hu) { const q = f.hu.h; q.group.position.set(f.x, y, f.z); q.group.rotation.y = f.ry; if (f.idle) HumanModel.animateIdle(q.parts, ht + i); else HumanModel.animateWalk(q.parts, f.ph, f.sp); _o.position.set(0, -50, 0); }
      else { _o.position.set(f.x, y + (f.idle ? 0 : Math.abs(Math.sin(f.ph)) * .035), f.z); _o.rotation.y = f.ry; }
      _o.updateMatrix(); pm.setMatrixAt(i, _o.matrix); }
    pm.instanceMatrix.needsUpdate = true;
    if ((J.Life.fr = (J.Life.fr + 1) % 15) === 0 && typeof HumanModel !== 'undefined') {
      if (humans.length < Math.ceil(NEAR * frac())) { let a; try { a = HumanModel.randomAppearance(Math.random() < .5 ? 'm' : 'f'); } catch (e) { a = {}; } a.lod = 'low'; const u = HumanModel.create(a); u.group.visible = false; G.scene.add(u.group); humans.push({ h: u, f: null }); }
      for (const u of humans) if (u.f && Math.hypot(u.f.x - px, u.f.z - pz) > 42) { u.f.hu = null; u.f = null; u.h.group.visible = false; }
      const free = humans.filter(u => !u.f); if (free.length) { const c = []; for (let i = 0; i < pm.count; i++) { const f = folk[i]; if (f.on && !f.hu) { const d = Math.hypot(f.x - px, f.z - pz); if (d < 36) c.push([d, f]); } } c.sort((a, b) => a[0] - b[0]); for (const u of free) { const q = c.shift(); if (!q) break; u.f = q[1]; q[1].hu = u; u.h.group.visible = true; } } } }

  const world = () => G.world;
  J.Life = { hits: 0, fr: 0, h, hump, cars, folk, humans, sig: () => N && N.sig, sigState, sigAp, get net() { return N; },
    load(net, g) { if (N) return; N = net; G = g; H = net.H; Hd = new Int16Array(H.d); root = new THREE.Group(); root.name = 'JangaonLife'; g.scene.add(root);
      net.edges.forEach((e, n) => { let s = 0; for (let i = 1; i < e[4].length; i++) { s += Math.hypot(e[4][i][0] - e[4][i - 1][0], e[4][i][1] - e[4][i - 1][1]); } elen[n] = s; for (const q of [e[0], e[1]]) (adj.get(q) || adj.set(q, []).get(q)).push(n); const w = e[3] === 'cc' ? 1 : 3; for (let i = 0; i < e[4].length; i++) { const seg = i ? Math.hypot(e[4][i][0] - e[4][i - 1][0], e[4][i][1] - e[4][i - 1][1]) : 0, ck = Math.floor(e[4][i][0] / 100) * 100003 + Math.floor(e[4][i][1] / 100); cellM.set(ck, (cellM.get(ck) || 0) + seg); const k = Math.floor(e[4][i][0] / 100) * 100003 + Math.floor(e[4][i][1] / 100), l = cells.get(k) || cells.set(k, []).get(k); for (let u = 0; u < w; u++) l.push([n, i]); } });
      for (const q of net.humps) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = (Math.floor(q[0] / 16) + a) * 100003 + Math.floor(q[1] / 16) + b; (humpGrid.get(k) || humpGrid.set(k, []).get(k)).push(q); }
      makeSignals(); makeLamps(); },
    step(dt, px, pz, on) { if (!N) return; root.visible = on; if (on) { stepSignals(dt); stepLamps(px, pz); } stepCars(dt, px, pz, on); stepFolk(dt, px, pz, on); },
    collide(pos, radius, res) { if (!N) return; const foot = typeof Player !== 'undefined' && Player.mode === 'foot';
      const push = (x, z, r) => { const ex = pos.x - x, ez = pos.z - z, d = Math.hypot(ex, ez), R = radius + r; if (d < R && d > 1e-4) { pos.x += ex / d * (R - d); pos.z += ez / d * (R - d); res.hit = true; res.nx = ex / d; res.nz = ez / d; } };
      for (const l of active) if (Math.abs(l[0] - pos.x) < radius + 1 && Math.abs(l[1] - pos.z) < radius + 1) push(l[0], l[1], .12);
      for (const s of N.sig) if (Math.abs(s.x - pos.x) < 40 && Math.abs(s.z - pos.z) < 40) for (const a of s.ap) push(a[4], a[5], .12);
      if (foot) for (const c of cars) if (c.box && Math.abs(c.x - pos.x) + Math.abs(c.z - pos.z) < 8) push(c.x, c.z, c.W / 2); } };
})();
