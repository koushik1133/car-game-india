// The drive to Secunderabad: NH-163 from Jangaon through Bhongir and Ghatkesar to Uppal, Habsiguda, Tarnaka and Secunderabad, at real scale.
// Streamed 640 m tiles (hyd/<i>_<j>.bin, tools/build_hyderabad.py, built by hyderabad-worker.js) and hyd-net.json (arterials for nav and traffic).
// Same approach as jangaon.js: world.surfaceAt / collide / insideBuilding / nearestRoad / landAt / bounds are wrapped, so every module sees one map.
// Nothing here costs a draw call, a texture or a byte of tile data until the player is within 700 m of the Jangaon west edge.
// Flyovers: decks are 2-D lookups with a height, so which level you are on is decided by your own height (see deckAt). Drive up the ramp to get on.
(function () {
  'use strict';
  const L = window.HYD_LITE; if (!L) return;
  const base = '../nellutla-map/', [HX0, HZ0, HX1, HZ1] = L.bounds, T = L.T, DATA_V = 27;
  const SURF = ['field', 'dirt', 'cc', 'tar', 'highway'], tiles = new Map(), want = new Set(), occ = new Set();
  for (const j in L.occ) for (const i of L.occ[j]) occ.add(i + ',' + j);
  const H = window.Hyd = { lite: L, tiles, net: null, stats: null, D: { y: 0, lost: 0 }, ready: false };
  const key = (i, j) => i + ',' + j, inHyd = (x, z) => x < HX1 && x >= HX0 && z >= HZ0 && z <= HZ1, tileAt = (x, z) => tiles.get(key(Math.floor((x - HX0) / T), Math.floor((z - HZ0) / T)));
  const range = () => Math.min(1300, ((window.Quality && Quality.TIERS[Quality.tier].fogFar) || 1500) * .95);
  let G, world, worker = null, busy = 0, group = null, matB = null, matG = null, matS = null, tex = [], plane = null, queue = [], ev = 0, ev2 = 0, stats = { built: 0, buildMs: 0, addMs: 0, maxAdd: 0, bytes: 0, failed: 0, fetchMs: 0 };

  // ---------------------------------------------------------- materials, made on first approach, freed when far away again
  function makeFacade() {   // 4 bays by 4 floors, repeats on every wall: one quad per wall, so a block of flats costs what a shed costs
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); const e = document.createElement('canvas'); e.width = e.height = 256; const q = e.getContext('2d'); q.fillStyle = '#000'; q.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512); let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { const x = a * 128, y = b * 128, r = R();   // plastered RCC: slab bands, not a grid of equal flats
      g.fillStyle = 'rgba(120,110,95,.22)'; g.fillRect(x, y + 112, 128, 16); g.fillStyle = 'rgba(70,60,50,.16)'; for (let k = 0; k < 5; k++) g.fillRect(x + R() * 118, y + 118, 2 + R() * 6, 10 + R() * 40);
      if (r < .22) continue;
      if (r < .4) { g.fillStyle = 'rgba(80,120,140,.75)'; g.fillRect(x + 6, y + 18, 116, 88); g.strokeStyle = 'rgba(40,50,55,.8)'; g.lineWidth = 3; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + 6 + k * 29, y + 18); g.lineTo(x + 6 + k * 29, y + 106); g.stroke(); } continue; }
      const wx = x + 24 + R() * 22, wy = y + 30, w = 52 + R() * 26, h = 54; g.fillStyle = '#2f353b'; g.fillRect(wx, wy, w, h); g.fillStyle = 'rgba(150,175,195,.5)'; g.fillRect(wx + 3, wy + 3, w - 6, h / 2 - 4); g.strokeStyle = '#6f6a60'; g.lineWidth = 4; g.strokeRect(wx, wy, w, h);
      if (r > .72) { g.fillStyle = 'rgba(90,85,80,.8)'; g.fillRect(x + 6, y + 88, 116, 6); g.fillStyle = 'rgba(60,60,60,.5)'; for (let k = 0; k < 7; k++) g.fillRect(x + 10 + k * 16, y + 94, 2, 18); }
      if (R() < .4) { q.fillStyle = R() < .5 ? '#d9a95a' : '#a9b9c9'; q.fillRect(wx / 2, wy / 2, w / 2, h / 2); } }
    const a = new THREE.CanvasTexture(c), b = new THREE.CanvasTexture(e); a.wrapS = a.wrapT = b.wrapS = b.wrapT = THREE.RepeatWrapping; a.anisotropy = 4; return [a, b];
  }
  function makeAtlas() {
    const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'), e = document.createElement('canvas'); e.width = e.height = 512; const q = e.getContext('2d'); q.fillStyle = '#000'; q.fillRect(0, 0, 512, 512); g.fillStyle = '#ddd'; g.fillRect(0, 0, 2048, 2048);
    const B = [['#c0392b', 'KIRANA', 'కిరాణా'], ['#1565c0', 'MOBILES', 'మొబైల్స్'], ['#2e7d32', 'MEDICAL', 'మెడికల్'], ['#f9a825', 'TIFFINS', 'టిఫిన్స్'], ['#6a1b9a', 'TEXTILES', 'వస్త్రాలు'], ['#00838f', 'HARDWARE', 'హార్డ్వేర్'], ['#ad1457', 'JEWELLERS', 'జ్యువెలర్స్'], ['#4e342e', 'BAKERY', 'బేకరీ']];
    B.forEach((b, i) => { const x = i * 256; g.fillStyle = b[0]; g.fillRect(x, 0, 256, 70); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 30px sans-serif'; g.fillText(b[1], x + 128, 32); g.font = 'bold 26px sans-serif'; g.fillText(b[2], x + 128, 62);
      const open = i % 2 === 0; g.fillStyle = open ? '#2a2622' : '#8f9499'; g.fillRect(x + 8, 74, 240, 182); if (open) { for (let k = 0; k < 40; k++) { g.fillStyle = `hsl(${Math.random() * 360},55%,${40 + Math.random() * 25}%)`; g.fillRect(x + 12 + Math.random() * 220, 80 + Math.floor(Math.random() * 5) * 34, 12, 26); } q.fillStyle = '#c99a50'; q.fillRect(x / 4 + 2, 18, 60, 46); } q.fillStyle = b[0]; q.fillRect(x / 4, 0, 64, 17); });
    L.signs.forEach((s, n) => { const x = (n % 4) * 512, y = 256 + Math.floor(n / 4) * 48, h = [['#14532d', '#fff'], ['#7f1d1d', '#fff'], ['#1e3a8a', '#fff'], ['#fbbf24', '#111']][n % 4]; g.fillStyle = h[0]; g.fillRect(x, y, 511, 47); g.fillStyle = h[1]; g.textAlign = 'center'; let f = 32; do { g.font = `bold ${f}px sans-serif`; f -= 2; } while (g.measureText(s).width > 490 && f > 11); g.fillText(s, x + 256, y + 35); });
    const a = new THREE.CanvasTexture(c), b = new THREE.CanvasTexture(e); a.anisotropy = 4; return [a, b];
  }
  function noise() { const n = document.createElement('canvas'); n.width = n.height = 256; const x = n.getContext('2d'), im = x.createImageData(256, 256); for (let i = 0; i < im.data.length; i += 4) { const v = 215 + Math.random() * 40 | 0; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
  function makeMats() {
    const [fa, fe] = makeFacade(), [aa, ae] = makeAtlas(), nt = noise(); tex = [fa, fe, aa, ae, nt];
    matB = new THREE.MeshLambertMaterial({ map: fa, vertexColors: true, emissiveMap: fe, emissive: 0xffffff, emissiveIntensity: 0 });
    matG = new THREE.MeshLambertMaterial({ map: nt, vertexColors: true });
    matS = new THREE.MeshLambertMaterial({ map: aa, vertexColors: true, emissiveMap: ae, emissive: 0xffffff, emissiveIntensity: 0 });
    group = new THREE.Group(); group.name = 'HydCorridor'; G.scene.add(group);
    const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); plane = new THREE.Mesh(p, new THREE.MeshLambertMaterial({ color: 0x9a8560 })); plane.scale.set(6400, 1, 6400); plane.position.y = -.02; plane.receiveShadow = true; plane.frustumCulled = false; plane.renderOrder = -1; group.add(plane);
  }
  function freeMats() { tex.forEach(t => t.dispose()); tex = []; matB.dispose(); matG.dispose(); matS.dispose(); plane.geometry.dispose(); plane.material.dispose(); G.scene.remove(group); group = matB = matG = matS = plane = null; }
  function startWorker() { worker = new Worker(base + 'hyderabad-worker.js?v=' + DATA_V); worker.postMessage({ base: new URL(base, location.href).href });
    worker.onmessage = e => { const m = e.data; busy--; if (m.fail) { stats.failed++; console.warn('hyd tile', m.i, m.j, m.msg); return; } stats.buildMs += m.ms; stats.fetchMs += m.fetchMs; stats.built++; stats.bytes += m.bytes; queue.push(m); };
    worker.onerror = e => console.error('hyd worker', e.message); if (!matB) makeMats(); }
  function stopWorker() { worker.terminate(); worker = null; busy = 0; queue = []; want.clear(); }
  function meshOf(g, mat, x0, z0, rad) { const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); b.setAttribute('normal', new THREE.BufferAttribute(g.nor, 4, true)); b.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2)); b.setAttribute('color', new THREE.BufferAttribute(g.col, 4, true));
    b.boundingSphere = new THREE.Sphere(new THREE.Vector3(T / 2, 6, T / 2), rad);
    const m = new THREE.Mesh(b, mat); m.position.set(x0, 0, z0); m.updateMatrix(); m.matrixAutoUpdate = false; m.receiveShadow = true; m.userData.r = g; return m; }
  const setLod = (t, l) => { if (t.lod === l) return; t.lod = l; const B = t.mB, r = B.userData.r, Gm = t.mG, g = Gm.userData.r; B.geometry.setDrawRange(0, l === 2 ? r.a + r.b + r.c : l === 1 ? r.a + r.b : r.a); l === 2 ? Gm.geometry.setDrawRange(g.a, g.b + g.c) : Gm.geometry.setDrawRange(0, g.a + g.b); if (t.mS) t.mS.visible = l === 2; };
  function gridOf(a, n, f) { const m = new Map(); for (let s = 0; s + n - 1 < a.length; s += n) { const [ax, az, bx, bz, p] = f(a, s), c = Math.floor((Math.min(ax, bx) - p) / 16), e = Math.floor((Math.max(ax, bx) + p) / 16), d = Math.floor((Math.min(az, bz) - p) / 16), h = Math.floor((Math.max(az, bz) + p) / 16); for (let u = c; u <= e; u++) for (let v = d; v <= h; v++) { const q = u * 100003 + v; (m.get(q) || m.set(q, []).get(q)).push(s); } } return m; }
  function addTile(m) { const k = key(m.i, m.j); want.delete(k); const old = tiles.get(k); if (old && !m.detail) return; if (!group) return; const t0 = performance.now();
    const t = { i: m.i, j: m.j, x0: m.x0, z0: m.z0, cx: m.x0 + T / 2, cz: m.z0 + T / 2, surf: m.surf, seg: m.seg, decks: m.decks, lod: -1, detail: !!m.detail, asked: !!m.detail, fp: [], mG: meshOf(m.G, matG, m.x0, m.z0, m.rad), mB: meshOf(m.B, matB, m.x0, m.z0, m.rad), mS: m.S.a ? meshOf(m.S, matS, m.x0, m.z0, m.rad) : null, verts: m.B.a + m.B.b + m.B.c + m.G.a + m.G.b + m.G.c };
    t.grid = gridOf(m.seg, 4, (a, s) => [a[s], a[s + 1], a[s + 2], a[s + 3], 0]); t.dg = gridOf(m.decks, 7, (a, s) => [a[s], a[s + 1], a[s + 3], a[s + 4], a[s + 6] + 1]);
    for (let q = 0, f = m.fp; q < f.length;) { const n = f[q++]; t.fp.push(f.subarray(q, q + n * 2)); q += n * 2; }
    pend.push(t.mG, t.mB); if (t.mS) pend.push(t.mS); if (old) { retire(old, t); } tiles.set(k, t);      // one buffer upload per step: a tile's meshes enter the scene on separate frames
    const ms = performance.now() - t0; stats.addMs += ms; stats.maxAdd = Math.max(stats.maxAdd, ms); }
  const pend = [], gone = [];
  function retire(t, by) { for (const m of [t.mG, t.mB, t.mS]) if (m) gone.push([m, by]); }
  function dropTile(k, t) { retire(t, null); tiles.delete(k); }
  function stepMeshes() { if (pend.length) { group.add(pend.shift()); return; } if (gone.length) { const [m, by] = gone[0]; if (m.parent === group || !m.parent) { gone.shift(); if (m.parent) group.remove(m); m.geometry.dispose(); } } }
  function stream(px, pz) {
    const d0 = px - HX1;
    if (!worker && d0 < 700 && pz > HZ0 - 800 && pz < HZ1 + 800) startWorker();
    if (!worker) return;
    if (queue.length) { queue.sort((a, b) => Math.hypot(a.x0 + T / 2 - px, a.z0 + T / 2 - pz) - Math.hypot(b.x0 + T / 2 - px, b.z0 + T / 2 - pz)); if ((ev2 = (ev2 + 1) % 4) === 0 && pend.length < 3) addTile(queue.shift()); }
    if (ev2 % 2 === 0 || !queue.length) stepMeshes();
    const vd = (px - lastPX), wd = (pz - lastPZ); lastPX = px; lastPZ = pz; if (Math.abs(vd) + Math.abs(wd) < 8) { velX += (vd - velX) * .05; velZ += (wd - velZ) * .05; } else { velX = velZ = 0; } const look = H.noPredict ? 0 : 120, ax = px + velX * look, az = pz + velZ * look;      // where the car will be in about 5 s: tiles ahead load first
    const R = range(), R0 = Math.min(R, d0 > 0 ? Math.max(0, R - d0 * .6) : R);
    for (const [k, t] of tiles) { const d = Math.hypot(t.cx - px, t.cz - pz); if (d > R + T + 260) { dropTile(k, t); continue; } if (!t.detail && !t.asked && d < 780 && busy < 3) { t.asked = true; busy++; worker.postMessage({ i: t.i, j: t.j, x0: t.x0, z0: t.z0, v: DATA_V, detail: 1 }); } setLod(t, d < 520 && t.detail ? 2 : d < 900 ? 1 : 0); t.mB.castShadow = d < 500; }
    if (plane) { plane.position.x = Math.round(px / 40) * 40; plane.position.z = Math.round(pz / 40) * 40; plane.visible = d0 < 1700; }
    if (busy < 3) { let best = null, bd = 1e9; const c0 = Math.max(0, Math.floor((Math.min(px, ax) - R0 - HX0) / T)), c1 = Math.min(L.NX - 1, Math.floor((Math.max(px, ax) + R0 - HX0) / T)), r0 = Math.max(0, Math.floor((Math.min(pz, az) - R0 - HZ0) / T)), r1 = Math.min(L.NZ - 1, Math.floor((Math.max(pz, az) + R0 - HZ0) / T));
      for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) { const k = key(i, j); if (!occ.has(k) || tiles.has(k) || want.has(k)) continue; const tx = HX0 + (i + .5) * T, tz = HZ0 + (j + .5) * T, d = Math.min(Math.hypot(tx - px, tz - pz), Math.hypot(tx - ax, tz - az)); if (d < R0 + T * .55 && d < bd) { bd = d; best = [i, j, k]; } }
      if (best) { busy++; want.add(best[2]); worker.postMessage({ i: best[0], j: best[1], x0: HX0 + best[0] * T, z0: HZ0 + best[1] * T, v: DATA_V, detail: Math.hypot(HX0 + (best[0] + .5) * T - px, HZ0 + (best[1] + .5) * T - pz) < 780 ? 1 : 0 }); } }
    if (d0 > 1800 && !tiles.size && !busy && !queue.length && !gone.length) { stopWorker(); freeMats(); }
  }

  // ---------------------------------------------------------- decks: which level are you on
  const _nt = []; function nearTiles(x, z, r) { _nt.length = 0; const a = Math.floor((x - r - HX0) / T), b = Math.floor((x + r - HX0) / T), c = Math.floor((z - r - HZ0) / T), d = Math.floor((z + r - HZ0) / T); for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) { const t = tiles.get(key(i, j)); if (t) _nt.push(t); } return _nt; }
  const FALL = 1.6, STEP = 1.0, CLEAR = 4.4, ONDECK = .8;   // from .8 m up the parapet holds: a ramp has no free edge
  function eachDeck(x, z, fn) { for (const t of nearTiles(x, z, 1)) { const lx = x - t.x0, lz = z - t.z0, l = t.dg.get(Math.floor(lx / 16) * 100003 + Math.floor(lz / 16)); if (!l) continue; const a = t.decks;
      for (const s of l) { const ax = a[s], az = a[s + 1], dx = a[s + 3] - ax, dz = a[s + 4] - az, L2 = dx * dx + dz * dz || 1e-6, u = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / L2)), ex = lx - ax - u * dx, ez = lz - az - u * dz, d = Math.hypot(ex, ez); fn(d, a[s + 2] + (a[s + 5] - a[s + 2]) * u, a[s + 6], ex, ez); } } }
  function deckAt(x, z, yRef, slack) { let best = null, bd = 1e9; const up = STEP + (slack || 0), dn = FALL + (slack || 0); eachDeck(x, z, (d, y, hw) => { if (d > hw + (yRef >= ONDECK ? .9 : .2) || y < yRef - dn || y > yRef + up) return; const q = Math.abs(y - yRef) * 2 + d; if (q < bd) { bd = q; best = y; } }); return best; }   // where a slip road forks off, the lane you are in wins   // null: no deck at this height here
  H.deckAt = deckAt;
  function townCollide(pos, radius) { let hit = false, nx = 0, nz = 0;
    for (const t of nearTiles(pos.x, pos.z, radius)) { const s = t.seg, lx = () => pos.x - t.x0, lz = () => pos.z - t.z0, i0 = Math.floor((lx() - radius) / 16), i1 = Math.floor((lx() + radius) / 16), j0 = Math.floor((lz() - radius) / 16), j1 = Math.floor((lz() + radius) / 16);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = t.grid.get(i * 100003 + j); if (!l) continue; for (const q of l) { const X = lx(), Z = lz(), ax = s[q], az = s[q + 1], dx = s[q + 2] - ax, dz = s[q + 3] - az, L2 = dx * dx + dz * dz || 1e-6, u = Math.max(0, Math.min(1, ((X - ax) * dx + (Z - az) * dz) / L2)), ex = X - ax - u * dx, ez = Z - az - u * dz, d = Math.hypot(ex, ez); if (d < radius && d > 1e-4) { const p = radius - d; pos.x += ex / d * p; pos.z += ez / d * p; hit = true; nx = ex / d; nz = ez / d; } } } }
    return { hit, nx, nz }; }
  function keepOnDeck(pos, radius) { const y = H.D.y; let out = 1e9, ex = 0, ez = 0; eachDeck(pos.x, pos.z, (d, yy, hw, x, z) => { if (Math.abs(yy - y) > 2.2) return; const o = d - (hw - radius * .5); if (o < out) { out = o; ex = x; ez = z; } });   // the parapets of every span at this level, joined: no wall lies across a slip road
    if (out <= 0) return { hit: false, nx: 0, nz: 0 }; if (out > 40) return { hit: false, nx: 0, nz: 0 }; const d = Math.hypot(ex, ez) || 1, nx = -ex / d, nz = -ez / d; pos.x += nx * out; pos.z += nz * out; return { hit: true, nx, nz }; }
  function rampWall(pos, radius) { const y = H.D.y; let hit = false, nx = 0, nz = 0; eachDeck(pos.x, pos.z, (d, yy, hw, ex, ez) => { if (yy < y + FALL || yy > y + CLEAR || d >= hw + radius) return; const k = (hw + radius - d) / (d || 1); pos.x += ex * k; pos.z += ez * k; hit = true; nx = ex / (d || 1); nz = ez / (d || 1); }); return { hit, nx, nz }; }
  function inside(x, z) { for (const t of nearTiles(x, z, 2)) for (const p of t.fp) { let c = false; const n = p.length / 2, X = x - t.x0, Z = z - t.z0; if (Math.abs(p[0] - X) > 120 || Math.abs(p[1] - Z) > 120) continue; for (let i = 0; i < n; i++) { const k = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[k * 2], bz = p[k * 2 + 1]; if ((az > Z) !== (bz > Z) && X < (bx - ax) * (Z - az) / (bz - az) + ax) c = !c; } if (c) { const pts = []; for (let i = 0; i < n; i++) pts.push([p[i * 2] + t.x0, p[i * 2 + 1] + t.z0]); return { town: true, p: pts }; } } return null; }
  let lastX = 0, lastZ = 0, lastPX = 0, lastPZ = 0, velX = 0, velZ = 0;
  function stepDeck() { const c = G.carPos, D = H.D; if (Math.hypot(c.x - lastX, c.z - lastZ) > 40 || !inHyd(c.x, c.z)) D.y = 0; lastX = c.x; lastZ = c.z; if (!inHyd(c.x, c.z)) return; let y = deckAt(c.x, c.z, D.y); if (y === null && D.y >= ONDECK) y = deckAt(c.x, c.z, D.y, 1.4); if (y !== null) { D.y = y; D.lost = 0; } else if (D.y < ONDECK || ++D.lost > 40) D.y = 0; }
  const nearCar = (x, z) => Math.abs(x - G.carPos.x) + Math.abs(z - G.carPos.z) < 18;

  // ---------------------------------------------------------- net: nearest road, traffic
  const cells = new Map(), adj = new Map(), elen = []; const CK = (x, z) => Math.floor(x / 200) * 100003 + Math.floor(z / 200);
  function netReady(n) { H.net = n; n.edges.forEach((e, q) => { let s = 0; const P = e[4]; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); elen[q] = s; for (const v of [e[0], e[1]]) (adj.get(v) || adj.set(v, []).get(v)).push(q);
      for (const p of P) { const k = CK(p[0], p[1]), l = cells.get(k) || cells.set(k, []).get(k); if (l[l.length - 1] !== q) l.push(q); } }); }
  H.loadNet = () => H._np || (H._np = fetch(base + 'hyd-net.json?v=' + DATA_V).then(r => r.json()).then(n => { netReady(n); return n; }));
  function nearestNet(x, z, f) { if (!H.net) return null; let b = null; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const q of cells.get((Math.floor(x / 200) + i) * 100003 + Math.floor(z / 200) + j) || []) { const e = H.net.edges[q], R = { w: e[2], t: e[3], p: e[4] }; if (f && !f(R)) continue; for (let k = 1; k < e[4].length; k++) { const A = e[4][k - 1], C = e[4][k]; if (Math.abs(A[0] - x) > 500) continue; const dx = C[0] - A[0], dz = C[1] - A[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[1]) * dz) / L2)), px = A[0] + u * dx, pz = A[1] + u * dz, d = Math.hypot(x - px, z - pz); if (!b || d < b.d) b = { d, x: px, z: pz, ang: Math.atan2(dx, dz), r: R }; } } return b; }
  const ptOn = (e, s) => { const P = e[4]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; if (s <= l || i === P.length - 1) { const t = Math.min(1, s / l); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t]; } s -= l; } return [P[0][0], P[0][1], 0, 1, 0]; };
  const PLAN = ['auto', 'bike', 'hatch', 'lorry', 'dzire', 'swift', 'bus', 'splendor', 'alto', 'suv', 'lorry', 'mpv', 'auto', 'bolero', 'scooter', 'hatch', 'scorpio', 'lorry', 'bike', 'dzire', 'bus', 'swift', 'auto', 'hatch', 'lorry', 'mpv', 'bike', 'alto'], cars = [], SP = { auto: 11, bike: 16, splendor: 15, scooter: 12, lorry: 15, bus: 16 };
  const frac = () => (window.Quality && Quality.TIERS[Quality.tier].peopleFrac) || 1;
  function addCar() { const k = PLAN[cars.length % PLAN.length], f = TrafficModels[k] || TrafficModels.hatch, v = f(); v.g.visible = false; G.scene.add(v.g); const b = new THREE.Box3().setFromObject(v.g), s = b.getSize(new THREE.Vector3()); cars.push({ g: v.g, wheels: v.wheels || [], kind: k, Ln: Math.min(13, Math.max(1.7, s.z)), W: Math.min(2.6, Math.max(.7, s.x)), sp: (SP[k] || 20) * (.85 + Math.random() * .3), v: 0, e: -1, s: 0, dir: 1, x: 1e7, z: 0, hd: 0, snap: true, box: null, lat: 0 }); }
  function place(c, px, pz, ahead) { for (let t = 0; t < 24; t++) { const a = Math.random() * 6.283, r = ahead ? 240 + Math.random() * 300 : 120 + Math.random() * 380, l = cells.get(CK(px + Math.cos(a) * r, pz + Math.sin(a) * r)); if (!l || !l.length) continue; const q = l[Math.random() * l.length | 0], e = H.net.edges[q], d = e[5] ? 1 : Math.random() < .5 ? 1 : -1, s = Math.random() * elen[q], p = ptOn(e, s); if (Math.hypot(p[0] - px, p[1] - pz) < 110) continue; c.e = q; c.s = d > 0 ? s : elen[q] - s; c.dir = d; c.v = c.sp * .8; c.snap = true; c.lat = (e[2] > 8 ? 1 + Math.floor(Math.random() * 2) * 2.2 : e[2] / 4); c.g.visible = true; return true; } c.e = -1; c.g.visible = false; return false; }
  function stepCars(dt, px, pz, on) { const A = window.TrafficAI, plo = A && A.playerOBB && A.playerOBB(), lim0 = Math.round(26 * frac());
    if (on && H.net && cars.length < lim0 && typeof TrafficModels !== 'undefined' && Math.random() < .05) addCar();
    for (const c of cars) { if (!on || !H.net) { c.g.visible = false; c.e = -1; c.x = 1e7; c.box = null; continue; }
      if (c.e < 0 || Math.hypot(c.x - px, c.z - pz) > 620) { c.box = null; if (!place(c, px, pz, true)) continue; }
      const e = H.net.edges[c.e], LL = elen[c.e]; let lim = c.sp;
      if (c.box && A) { const cons = (b, v) => { if ((b.x - c.box.x) ** 2 + (b.z - c.box.z) ** 2 > 2500) return; const g = A.gapAhead(c.box, b, .25, 0); if (g !== Infinity) lim = Math.min(lim, Math.max(0, g - 3) * .6 + (v || 0)); }; if (plo) cons(plo.box, plo.v); for (const o of cars) if (o !== c && o.box) cons(o.box, o.v); }
      c.v += Math.max(-7 * dt, Math.min(2.2 * dt, lim - c.v)); if (c.v < .02) c.v = 0; c.s += c.v * dt;
      if (c.s >= LL) { const end = c.dir > 0 ? e[1] : e[0], opt = (adj.get(end) || []).filter(q => { if (q === c.e) return false; const o = H.net.edges[q]; return !o[5] || o[0] === end; }), best = opt.length ? opt.reduce((a, q) => { const o = H.net.edges[q], d = o[0] === end ? 1 : -1, P = ptOn(o, d > 0 ? 0 : elen[q] - 1), hx = P[2] * d, hz = P[3] * d, sc = hx * Math.sin(c.hd) + hz * Math.cos(c.hd) + Math.random() * .5 + (o[3] === 'highway' ? .6 : 0); return !a || sc > a[0] ? [sc, q, d] : a; }, null) : null; if (!best) { c.e = -1; continue; } c.s -= LL; c.e = best[1]; c.dir = best[2]; }
      const E = H.net.edges[c.e], l = elen[c.e], p = ptOn(E, c.dir > 0 ? c.s : l - c.s), hx = p[2] * c.dir, hz = p[3] * c.dir, o = E[5] ? (c.lat - E[2] / 2 + .3) : Math.min(E[2] / 4, 2.8), tx = p[0] + hz * o, tz = p[1] - hx * o, th = Math.atan2(hx, hz), k = c.snap ? 1 : Math.min(1, dt * 3.5);
      if (c.snap) c.hd = th; c.x += (tx - c.x) * (c.snap ? 1 : k); c.z += (tz - c.z) * (c.snap ? 1 : k); c.hd += Math.atan2(Math.sin(th - c.hd), Math.cos(th - c.hd)) * k; c.snap = false;
      c.g.position.set(c.x, p[4] + .12, c.z); c.g.rotation.y = c.hd; for (const w of c.wheels) w.rotation.x += c.v * dt / .3;
      if (A) { c.box = A.obb(c.x, c.z, c.hd, c.Ln, c.W); if (plo && plo.solid && Math.abs(p[4] - H.D.y) < 2) { const hit = A.overlap(c.box, plo.box); if (hit) { G.carPos.x += hit.nx * hit.depth; G.carPos.z += hit.nz * hit.depth; c.v = 0; } } } }
  }
  H.cars = cars;

  // ---------------------------------------------------------- world wrappers, after jangaon.js so this sees its map
  function wrap() { const w = world, { surfaceAt: sf, collide: co, insideBuilding: ib, nearestRoad: nr, landAt: la, humpAt: hu, dipAt: di, bundAt: bu, undAt: un } = w;
    const zero = f => f ? (x, z) => inHyd(x, z) ? 0 : f(x, z) : f;
    w.humpAt = zero(hu); w.dipAt = zero(di); w.bundAt = zero(bu); w.undAt = zero(un);
    w.landAt = (x, z) => { if (!inHyd(x, z)) return la(x, z); if (!nearCar(x, z)) return 0; const y = deckAt(x, z, H.D.y); return y !== null ? y : H.D.y >= ONDECK ? H.D.y : 0; };
    w.surfaceAt = (x, z) => { if (!inHyd(x, z)) return sf(x, z); if (H.D.y > .5 && nearCar(x, z)) return 'highway'; const t = tileAt(x, z); return t ? SURF[t.surf[Math.min(319, (z - t.z0) / 2 | 0) * 320 + Math.min(319, (x - t.x0) / 2 | 0)]] : 'field'; };
    w.collide = (p, r) => { if (!inHyd(p.x, p.z)) return co(p, r); if (H.D.y >= ONDECK) return keepOnDeck(p, r); const a = rampWall(p, r), b = tiles.size ? townCollide(p, r) : a; return b.hit ? b : a; };
    w.insideBuilding = (x, z, m) => inHyd(x, z) ? (H.D.y >= FALL ? null : inside(x, z)) : ib(x, z, m);
    w.nearestRoad = (x, z, f) => { if (inHyd(x, z)) { const b = nearestNet(x, z, f); if (b) return b; } return nr(x, z, f); };
    w.bounds = [HX0, HZ0, w.bounds[2], HZ1];
  }
  // the map is a rectangle now, but the only land outside Jangaon and the village is west of the Jangaon edge
  const JB = window.JANGAON_LITE.bounds;
  function clampEast() { const c = G.carPos; if (c.x >= HX1) { if (c.z < JB[1] + 5) c.z = JB[1] + 5; if (c.z > JB[3] - 5) c.z = JB[3] - 5; } }
  const SHOW = new Set(['metro', 'stadium', 'station', 'busstand']);
  GameHooks.init.push(g => { G = g; world = g.world; wrap();
    if (window.GameLocations) { for (const t of L.towns) GameLocations.add('hyd-' + t[0].toLowerCase(), { name: t[0], x: t[1], z: t[2], kind: 'town' }); }
    for (const l of L.landmarks) if (SHOW.has(l.k) && (l.k !== 'station' || /Secunderabad|Bhongir|Ghatkesar|Bibinagar|Aler/.test(l.name))) world.landmarks.push({ name: l.name, k: l.k, x: l.x, z: l.z });
    H.stats = () => ({ tiles: tiles.size, queue: queue.length, busy, worker: !!worker, ...stats, avgBuildMs: stats.built ? +(stats.buildMs / stats.built).toFixed(1) : 0, avgAddMs: stats.built ? +(stats.addMs / stats.built).toFixed(2) : 0, verts: [...tiles.values()].reduce((a, t) => a + t.verts, 0), cars: cars.filter(c => c.g.visible).length, deckY: H.D.y }); H.ready = true; });
  let frz = 0; const frozen = new Set(), noop = () => {};
  function freezeFar(x, z) {     // 15,000 village objects were having their matrices rebuilt every frame 70 km away. Far top-level groups skip that; any that moves near comes back
    if ((frz = (frz + 1) % 30)) return; const on = x < HX1 - 2500;
    for (const c of frozen) if (!on || (c !== world.group && Math.hypot(c.position.x - x, c.position.z - z) < 3000)) { delete c.updateMatrixWorld; frozen.delete(c); }     // also the ones a module has taken out of the scene
    for (const c of G.scene.children) { if (!c.isGroup || c === group) continue; const far = c === world.group || (c.children.length && (c.position.x || c.position.z) && Math.hypot(c.position.x - x, c.position.z - z) > 3000); if (on && far && !frozen.has(c)) { c.updateMatrixWorld(true); c.updateMatrixWorld = noop; frozen.add(c); } } }
  H.frozen = frozen;
  GameHooks.update.push((dt, g) => { const x = g.carPos.x, z = g.carPos.z; clampEast(); stream(x, z); stepDeck(); freezeFar(x, z);
    if (matB && (ev = (ev + 1) % 30) === 0) matB.emissiveIntensity = matS.emissiveIntensity = (typeof timeOfDay === 'number' && (timeOfDay > 18.6 || timeOfDay < 5.8)) ? 1 : 0;
    if (x < HX1 + 400) { if (!H.net) H.loadNet(); stepCars(dt, x, z, true); } else if (cars.length) stepCars(dt, x, z, false); });
})();
