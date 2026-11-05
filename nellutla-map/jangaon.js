// Jangaon town: streamed from jangaon-data.json by jangaon-worker.js, only when the player comes near.
// Nothing here touches nellutla-world.js: world.surfaceAt / collide / insideBuilding / nearestRoad / drawMap / bounds are wrapped,
// so every module sees one continuous map. Near the village none of this costs a draw call or a byte of geometry.
// Per tile: 1 building mesh + 1 ground/road mesh, each with a near and a far draw range (see jangaon-worker.js).
(function () {
  'use strict';
  const L = window.JANGAON_LITE, J = window.Jangaon; if (!L) return;
  const base = '../nellutla-map/', [RX0, RZ0, RX1, RZ1] = L.bounds, T = L.T, VB = L.v;
  let ev2 = 0;
  const inVillage = (x, z) => x > VB[0] && x < VB[2] && z > VB[1] && z < VB[3];
  const inRegion = (x, z) => x >= RX0 && x <= RX1 && z >= RZ0 && z <= RZ1 && !inVillage(x, z);
  const SURF = ['field', 'dirt', 'cc', 'tar', 'highway'], tiles = new Map(), want = new Set();
  let net = null, undPatch, G, world, worker = null, ready = false, busy = 0, group = null, matB = null, matG = null, tex = [], queue = [], stats = { buildMs: 0, built: 0, addMs: 0, maxAdd: 0 }, ev = 0;
  const key = (i, j) => i + ',' + j, tileAt = (x, z) => tiles.get(key(Math.floor((x - RX0) / T), Math.floor((z - RZ0) / T)));
  const range = () => Math.min(1300, ((window.Quality && Quality.TIERS[Quality.tier].fogFar) || 1500) * .9);

  // ---------------------------------------------------------- materials (made when the town first streams in, freed when left)
  function makeAtlas() {
    const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 2048, 2048);
    const e = document.createElement('canvas'); e.width = e.height = 512; const q = e.getContext('2d'); q.fillStyle = '#000'; q.fillRect(0, 0, 512, 512);
    const win = (x, y, w, h, lit) => { g.fillStyle = '#3b3f46'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(140,175,205,.5)'; g.fillRect(x + 6, y + 6, w - 12, h / 2 - 8); g.strokeStyle = '#222'; g.lineWidth = 4; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + w * k / 4, y); g.lineTo(x + w * k / 4, y + h); g.stroke(); } g.strokeStyle = '#ddd8cc'; g.lineWidth = 9; g.strokeRect(x, y, w, h); if (lit) { q.fillStyle = '#d9a95a'; q.fillRect(x / 4, y / 4, w / 4, h / 4); } };
    const noise = (x, y, w, h) => { for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(90,80,60,${Math.random() * .05})`; g.fillRect(x + Math.random() * w, y + Math.random() * h, 3 + Math.random() * 14, 2 + Math.random() * 10); } g.fillStyle = 'rgba(70,60,50,.18)'; g.fillRect(x, y + h - 14, w, 14); };
    for (let i = 0; i < 7; i++) noise(i * 256, 0, 256, 256);
    win(58, 58, 140, 120, true); win(30, 62, 84, 116, false); win(142, 62, 84, 116, true);
    // 2 door + window
    g.fillStyle = '#6b3f22'; g.fillRect(2 * 256 + 34, 54, 84, 202); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(2 * 256 + 42, 66, 68, 180); win(2 * 256 + 146, 70, 84, 92, false);
    // 4 showroom glass
    g.fillStyle = '#8fb2c6'; g.fillRect(4 * 256, 0, 256, 256); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(4 * 256 + 30, 0); g.lineTo(4 * 256 + 110, 0); g.lineTo(4 * 256 + 40, 256); g.lineTo(4 * 256, 256); g.fill(); g.fillStyle = '#c8ccd0'; g.fillRect(4 * 256, 0, 8, 256); q.fillStyle = '#cfd9df'; q.fillRect(256, 0, 64, 64);
    // 5 godown shutter
    g.fillStyle = '#8f9499'; g.fillRect(5 * 256 + 20, 40, 216, 216); g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 2; for (let y = 46; y < 256; y += 7) { g.beginPath(); g.moveTo(5 * 256 + 20, y); g.lineTo(5 * 256 + 236, y); g.stroke(); }
    // row 1: shop fronts with boards (generic trades: inferred, real names only on landmark signs)
    const B = [['#c0392b', 'KIRANA', 'కిరాణా'], ['#1565c0', 'MOBILES', 'మొబైల్స్'], ['#2e7d32', 'MEDICAL', 'మెడికల్'], ['#f9a825', 'TIFFINS', 'టిఫిన్స్'], ['#6a1b9a', 'TEXTILES', 'వస్త్రాలు'], ['#00838f', 'HARDWARE', 'హార్డ్వేర్'], ['#ad1457', 'JEWELLERS', 'జ్యువెలర్స్'], ['#4e342e', 'BAKERY', 'బేకరీ']];
    B.forEach((b, i) => { const x = i * 256, y = 256; g.fillStyle = b[0]; g.fillRect(x, y, 256, 70); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 30px sans-serif'; g.fillText(b[1], x + 128, y + 32); g.font = 'bold 26px sans-serif'; g.fillText(b[2], x + 128, y + 62);
      const open = i % 2 === 0; g.fillStyle = open ? '#2a2622' : '#8f9499'; g.fillRect(x + 8, y + 74, 240, 182);
      if (open) { for (let k = 0; k < 40; k++) { g.fillStyle = `hsl(${Math.random() * 360},55%,${40 + Math.random() * 25}%)`; g.fillRect(x + 12 + Math.random() * 220, y + 80 + Math.floor(Math.random() * 5) * 34, 12, 26); } q.fillStyle = '#c99a50'; q.fillRect(x / 4 + 2, 64 + 18, 60, 46); }
      else { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; for (let k = y + 78; k < y + 256; k += 6) { g.beginPath(); g.moveTo(x + 8, k); g.lineTo(x + 248, k); g.stroke(); } }
      q.fillStyle = b[0]; q.fillRect(x / 4, 64, 64, 17); });
    // landmark boards
    L.signs.forEach((s, n) => { const x = (n % 3) * 682, y = 512 + Math.floor(n / 3) * 48, h = [['#14532d', '#fff'], ['#7f1d1d', '#fff'], ['#1e3a8a', '#fff'], ['#fbbf24', '#111']][n % 4]; g.fillStyle = h[0]; g.fillRect(x, y, 682, 47); g.fillStyle = h[1]; g.textAlign = 'center'; let f = 34; do { g.font = `bold ${f}px sans-serif`; f -= 2; } while (g.measureText(s).width > 650 && f > 12); g.fillText(s, x + 341, y + 36); });
    const a = new THREE.CanvasTexture(c); a.anisotropy = 4; a.encoding = THREE.LinearEncoding;
    const b = new THREE.CanvasTexture(e);
    const ns = document.createElement('canvas'); ns.width = ns.height = 256; const n = ns.getContext('2d'); const im = n.createImageData(256, 256); for (let i = 0; i < im.data.length; i += 4) { const v = 215 + Math.random() * 40 | 0; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } n.putImageData(im, 0, 0);
    const gt = new THREE.CanvasTexture(ns); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.anisotropy = 4;
    tex = [a, b, gt];
    matB = new THREE.MeshLambertMaterial({ map: a, vertexColors: true, emissiveMap: b, emissive: 0xffffff, emissiveIntensity: 0 });
    matG = new THREE.MeshLambertMaterial({ map: gt, vertexColors: true });
    group = new THREE.Group(); group.name = 'Jangaon'; G.scene.add(group);
  }
  function freeAtlas() { tex.forEach(t => t.dispose()); tex = []; matB.dispose(); matG.dispose(); matB = matG = null; G.scene.remove(group); group = null; }

  // ---------------------------------------------------------- worker + tile lifecycle
  function startWorker() {
    worker = new Worker(base + 'jangaon-worker.js?v=7');
    worker.onmessage = e => { const m = e.data; if (m.ready) { ready = true; return; } busy--; stats.buildMs += m.ms; stats.built++; queue.push(m); };
    worker.onerror = e => console.error('jangaon worker', e.message);
    const go = n => { J.Life.load(n, G); if (worker) worker.postMessage({ init: new URL(base + 'jangaon-data.json?v=1', location.href).href, H: n.H, humps: n.humps, sites: ['showroom','showroom2','showroom3','bikeShowroom','bikeShowroom2','autoShowroom','upgrade'].filter(k => L.sites[k]).map(k => { const q = L.sites[k], a = q.entry ? Math.atan2(q.entry[0]-q.x, q.entry[1]-q.z) : q.rot || 0; return { x: q.x, z: q.z, w: q.w, d: q.d, c: Math.cos(a), s: Math.sin(a) }; }) }); };
    if (net) go(net); else fetch(base + 'jangaon-net.json?v=1').then(r => r.json()).then(n => { net = n; go(n); });
    if (!matB) makeAtlas();
  }
  function stopWorker() { worker.terminate(); worker = null; ready = false; busy = 0; queue = []; want.clear(); }
  function meshOf(g, mat, mid) {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); b.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3));
    b.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2)); b.setAttribute('color', new THREE.BufferAttribute(g.col, 3));
    b.boundingSphere = new THREE.Sphere(mid, T * .78);
    const m = new THREE.Mesh(b, mat); m.matrixAutoUpdate = false; m.receiveShadow = true; m.userData.r = g; return m;
  }
  const setLod = (t, near) => { if (t.near === near) return; t.near = near; for (const m of t.meshes) { const r = m.userData.r; near ? m.geometry.setDrawRange(r.a, r.b + r.c) : m.geometry.setDrawRange(0, r.a + r.b); } };
  function addTile(m) {
    const k = key(m.i, m.j); want.delete(k); if (tiles.has(k) || !group) return;
    const t0 = performance.now(), mid = new THREE.Vector3(m.x0 + T / 2, 5, m.z0 + T / 2);
    const t = { i: m.i, j: m.j, x0: m.x0, z0: m.z0, cx: mid.x, cz: mid.z, surf: m.surf, near: null, grid: new Map(), fp: [], meshes: [meshOf(m.G, matG, mid), meshOf(m.B, matB, mid)] };
    const seg = m.seg; for (let s = 0; s + 3 < seg.length; s += 4) { const a = Math.floor(Math.min(seg[s], seg[s + 2]) / 16), b = Math.floor(Math.max(seg[s], seg[s + 2]) / 16), c = Math.floor(Math.min(seg[s + 1], seg[s + 3]) / 16), d = Math.floor(Math.max(seg[s + 1], seg[s + 3]) / 16);
      for (let u = a; u <= b; u++) for (let v = c; v <= d; v++) { const q = u * 100003 + v; (t.grid.get(q) || t.grid.set(q, []).get(q)).push(s); } }
    t.seg = seg;
    for (let q = 0, f = m.fp; q < f.length;) { const n = f[q++]; t.fp.push(f.subarray(q, q + n * 2)); q += n * 2; }
    t.meshes[1].castShadow = true; t.meshes.forEach(x => group.add(x));
    tiles.set(k, t); const ms = performance.now() - t0; stats.addMs += ms; stats.maxAdd = Math.max(stats.maxAdd, ms);
  }
  function dropTile(k, t) { for (const m of t.meshes) { group.remove(m); m.geometry.dispose(); } tiles.delete(k); }
  function stream(px, pz) {
    const dr = Math.hypot(Math.max(RX0 - px, 0, px - RX1), Math.max(RZ0 - pz, 0, pz - RZ1)), outerV = !inVillage(px, pz);
    const edge = outerV ? 0 : Math.min(px - VB[0], pz - VB[1]), R = outerV ? range() : Math.min(range(), 420);   // from inside the village only the rim streams
    if (!worker && edge + dr < 650) startWorker();                       // nothing at all loads deeper in the village than this
    if (!worker) return;
    if (queue.length && (ev2 = (ev2 + 1) % 6) === 0) addTile(queue.shift());   // one tile every 6th frame: each upload is a hitch of its own
    for (const [k, t] of tiles) {
      const d = Math.hypot(t.cx - px, t.cz - pz); if (d > R + T + 300) { dropTile(k, t); continue; }
      setLod(t, d < 460);
      t.meshes[1].castShadow = d < 300;
    }
    if (!ready) return;
    if (busy < 2) {
      let best = null, bd = 1e9; const c0 = Math.max(0, Math.floor((px - R - RX0) / T)), c1 = Math.min(L.NX - 1, Math.floor((px + R - RX0) / T)), r0 = Math.max(0, Math.floor((pz - R - RZ0) / T)), r1 = Math.min(L.NZ - 1, Math.floor((pz + R - RZ0) / T));
      for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) { if (i >= 15 && j >= 9) continue; const k = key(i, j); if (tiles.has(k) || want.has(k)) continue; const d = Math.hypot(RX0 + (i + .5) * T - px, RZ0 + (j + .5) * T - pz); if (d < R + T * .5 && d < bd) { bd = d; best = [i, j, k]; } }
      if (best) { busy++; want.add(best[2]); worker.postMessage({ i: best[0], j: best[1] }); }
    }
    if (edge + dr > 900 && !tiles.size && !busy) { stopWorker(); freeAtlas(); }
  }

  // ---------------------------------------------------------- extended world queries
  function townCollide(pos, radius) {
    let hit = false, nx = 0, nz = 0;
    for (const t of nearTiles(pos.x, pos.z, radius)) { const s = t.seg, i0 = Math.floor((pos.x - radius) / 16), i1 = Math.floor((pos.x + radius) / 16), j0 = Math.floor((pos.z - radius) / 16), j1 = Math.floor((pos.z + radius) / 16);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = t.grid.get(i * 100003 + j); if (!l) continue;
        for (const q of l) { const ax = s[q], az = s[q + 1], dx = s[q + 2] - ax, dz = s[q + 3] - az, L2 = dx * dx + dz * dz || 1e-6, u = Math.max(0, Math.min(1, ((pos.x - ax) * dx + (pos.z - az) * dz) / L2)), ex = pos.x - ax - u * dx, ez = pos.z - az - u * dz, d = Math.hypot(ex, ez);
          if (d < radius && d > 1e-4) { const p = radius - d; pos.x += ex / d * p; pos.z += ez / d * p; hit = true; nx = ex / d; nz = ez / d; } } } }
    if (J.Life) { const r = { hit, nx, nz }; J.Life.collide(pos, radius, r); hit = r.hit; nx = r.nx; nz = r.nz; }
    return { hit, nx, nz };
  }
  const _nt = []; function nearTiles(x, z, r) { _nt.length = 0; const a = Math.floor((x - r - RX0) / T), b = Math.floor((x + r - RX0) / T), c = Math.floor((z - r - RZ0) / T), d = Math.floor((z + r - RZ0) / T); for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) { const t = tiles.get(key(i, j)); if (t) _nt.push(t); } return _nt; }
  /* returns the same [[x,z]] shape as a village building: player.js unstick reads it */ function townInside(x, z) { for (const t of nearTiles(x, z, 2)) for (const p of t.fp) { let c = false, n = p.length / 2; if (Math.abs(p[0] - x) > 90 || Math.abs(p[1] - z) > 90) continue; for (let i = 0; i < n; i++) { const k = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[k * 2], bz = p[k * 2 + 1]; if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c; } if (c) { const pts = []; for (let i = 0; i < n; i++) pts.push([p[i * 2], p[i * 2 + 1]]); return { town: true, p: pts }; } } return null; }
  function wrap() {
    const w = world, { surfaceAt: sf, collide: co, insideBuilding: ib, nearestRoad: nr, drawMap: dm, landAt: la, humpAt: hu } = w;
    w.landAt = (x, z) => inRegion(x, z) && J.Life ? J.Life.h(x, z) : la(x, z);
    w.humpAt = (x, z) => inRegion(x, z) && J.Life ? J.Life.hump(x, z) : hu(x, z);
    J.wallAt = (p, r) => { const q = { x: p.x, z: p.z }; for (const t of nearTiles(q.x, q.z, r)) { const s = t.seg, l = t.grid.get(Math.floor(q.x / 16) * 100003 + Math.floor(q.z / 16)); if (l) for (const k of l) { const ax = s[k], az = s[k + 1], dx = s[k + 2] - ax, dz = s[k + 3] - az, u = Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.z - az) * dz) / (dx * dx + dz * dz || 1e-6))); if (Math.hypot(q.x - ax - u * dx, q.z - az - u * dz) < r) return true; } } return false; };
    w.surfaceAt = (x, z) => { if (!inRegion(x, z)) return sf(x, z); const t = tileAt(x, z); if (!t) return 'field'; return SURF[t.surf[Math.min(159, (z - t.z0) / 2 | 0) * 160 + Math.min(159, (x - t.x0) / 2 | 0)]]; };
    w.collide = (p, r) => { const a = co(p, r); if (inRegion(p.x, p.z) && tiles.size) { const b = townCollide(p, r); return b.hit ? b : a; } return a; };   // addCollider shells (showroom.js) live in the village grid
    w.insideBuilding = (x, z, m) => inRegion(x, z) ? townInside(x, z) : ib(x, z, m);
    w.nearestRoad = (x, z, f) => { if (inRegion(x, z)) { let b = null; for (const e of L.net.edges) { const R = { w: e[2], t: 'tar', p: e[3] }; if (f && !f(R)) continue; for (let i = 1; i < e[3].length; i++) { const A = e[3][i - 1], C = e[3][i]; if (Math.abs(A[0] - x) > 400) continue; const dx = C[0] - A[0], dz = C[1] - A[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[1]) * dz) / L2)), px = A[0] + u * dx, pz = A[1] + u * dz, d = Math.hypot(x - px, z - pz); if (!b || d < b.d) b = { d, x: px, z: pz, ang: Math.atan2(dx, dz), r: R }; } } if (b) return b; } return nr(x, z, f); };
    w.bounds = [RX0, RZ0, VB[2], VB[3]];
    const lo = new Image(), hi = new Image(); let hiOn = false; lo.src = base + 'jangaon-map-lo.png?v=1';
    w.drawMap = (ctx, cx, cz, s, W, H, rot) => {
      if (!hiOn && s > .25 && Math.hypot(cx - -3900, cz - -2000) < 3500) { hiOn = true; hi.src = base + 'jangaon-map.png?v=1'; }
      const im = hi.complete && hi.naturalWidth && s > .2 ? hi : lo;
      if (im.complete && im.naturalWidth) { ctx.save(); ctx.translate(W / 2, H / 2); if (rot) ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-cx, -cz); ctx.drawImage(im, RX0, RZ0, RX1 - RX0, RZ1 - RZ0); ctx.restore(); }
      dm(ctx, cx, cz, s, W, H, rot);
    };
  }

  // ---------------------------------------------------------- hooks
  const KIND = { car_showroom: 'showroom', bike_showroom: 'showroom', auto_showroom: 'showroom', upgrade_shop: 'garage', bus_stand: 'transport', taxi_stand: 'transport', market_yard: 'market', market: 'market', seed_shop: 'shop', hospital: 'hospital', railway_station: 'transport' };
  function registerLocations() {
    for (const k in L.sites) { const s = L.sites[k]; if (window.GameLocations) GameLocations.add('jangaon-' + k, { name: s.name + ', Jangaon', x: s.x, z: s.z, kind: KIND[s.type] || 'town' }); }
    if (window.GameLocations) GameLocations.add('jangaon-town', { name: 'Jangaon town', x: -3900, z: -2000, kind: 'town' });
    const show = ['station', 'busstand', 'market']; for (const l of L.landmarks) if (show.includes(l.k)) world.landmarks.push({ name: l.name, k: l.k, x: l.x, z: l.z });
    for (const k of ['showroom', 'bikeShowroom', 'autoShowroom', 'areaHospital']) world.landmarks.push({ name: L.sites[k].name, k, x: L.sites[k].x, z: L.sites[k].z });
    for (const k of ['showroom', 'bikeShowroom', 'autoShowroom', 'upgrade', 'seedShop', 'taxiStand']) if (world.addMapIcon) world.addMapIcon(L.sites[k].x, L.sites[k].z, 'S', L.sites[k].name);
  }
  GameHooks.init.push(g => { G = g; world = g.world; wrap(); registerLocations(); J.ready = true; J.stats = () => ({ tiles: tiles.size, ...stats, avgBuildMs: stats.built ? +(stats.buildMs / stats.built).toFixed(1) : 0, avgAddMs: stats.built ? +(stats.addMs / stats.built).toFixed(2) : 0, worker: !!worker, cars: J.Life ? J.Life.cars.filter(c => c.g.visible).length : 0, folk: J.Life ? J.Life.folk.filter(f => f.on).length : 0, humans: J.Life ? J.Life.humans.filter(u => u.f).length : 0 });  J.tiles = tiles; });
  GameHooks.update.push((dt, g) => {
    const c = g.camera.position, x = g.carPos.x, z = g.carPos.z; stream(x, z);
    // the village's camera-following terrain patch clamps its ground texture beyond the map edge: off while over the town
    if (undPatch === undefined) undPatch = world.group.children.find(m => m.isMesh && !m.frustumCulled && m.geometry.attributes.position && m.geometry.attributes.position.count === 131 * 131) || null;
    if (undPatch) undPatch.visible = !(c.x < VB[0] - 250 || c.z < VB[1] - 250);
    const town = !!matB && x < -1900 && x > -6100 && z < 0 && z > -4100;
    if (J.Life) J.Life.step(dt, x, z, town);
    if (matB && (ev = (ev + 1) % 30) === 0) { matB.emissiveIntensity = (typeof timeOfDay === 'number' && (timeOfDay > 18.6 || timeOfDay < 5.8)) ? 1 : 0; }
  });
})();
