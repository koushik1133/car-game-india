// farm.js: the player's own farming on real world.fields parcels. A crop runs in strict order:
//   buy or lease a plot > buy seed and fertiliser (Jangaon seed shop) > plough (tractor with the cultivator, a driven
//   bullock cart, or a hired bullock team) > sow > irrigate > fertilise > weed / spray as they appear > harvest >
//   load the hitched tractor trolley (haul.js) > sell at the market (or cotton at the Cotton Factory) through Economy.
// Crops are the area's: cotton and paddy lead the Jangaon district acreage, maize is smaller; chilli is a game choice.
// Prices start from the 2025-26 MSP and move daily. Crop time is compressed: one crop takes 4 to 6 game days.
// Field work is real coverage: a grid of 3 m cells over the parcel, marked as the player (or hired help) passes, drawn
// as a vertex-coloured ground skin plus one instanced plant per cell. Built only for plots the player holds.
// Saved in localStorage 'nellutla.farm'. Exposes window.Farm. Key: E (near a plot, shop or market), Y farm status.
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;
  const T = THREE, KEY = 'nellutla.farm', ACRE = 4047, CELL = 3, TROLLEY_KG = 2500;
  const CROPS = {
    cotton: { name: 'Cotton', te: 'పత్తి', days: 6, yield: 800, price: 7710, water: 0.24, seed: 870, col: 0xf2f0ea },
    paddy: { name: 'Paddy', te: 'వరి', days: 5, yield: 2200, price: 2369, water: 0.42, seed: 500, col: 0xc4a26a },
    maize: { name: 'Maize', te: 'మొక్కజొన్న', days: 4, yield: 2500, price: 2400, water: 0.3, seed: 900, col: 0xd8b24a },
    chilli: { name: 'Chilli', te: 'మిర్చి', days: 6, yield: 1800, price: 13000, water: 0.28, seed: 1200, col: 0xa8281c },
  };
  const FERT_PRICE = 600, SPRAY_PRICE = 450, DIESEL_K = 120, HIRE = { plough: 700, sow: 350, fert: 250, weed: 400, spray: 300, harvest: 600 };
  const OPS = { plough: 'Plough', sow: 'Sow', irrigate: 'Irrigate', fert: 'Fertilise', weed: 'Weed', spray: 'Spray pests', harvest: 'Harvest' };
  const PLANNED = { market: { x: -1312, z: -668, name: 'Jangaon Market Yard' }, seedShop: { x: -1250, z: -664, name: 'Jangaon Seed Shop' } };
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const Y = new T.Vector3(0, 1, 0), M4 = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3(), COL = new T.Color();
  let G = null, world = null, plots = [], byId = {}, acc = 0, panelEl = null, pill = null, lastHour = null, near = null, kiosks = {};
  let state = { v: 1, day: 0, seeds: {}, fert: 0, spray: 0, plots: {}, cargo: null, earned: 0, spent: 0 };
  const gy = (x, z) => (typeof groundY === 'function' ? groundY(x, z) : 0);
  const pop = t => G && G.showPopup(t);
  const dayInt = () => Math.floor(state.day);

  function save() { try { const o = Object.assign({}, state, { plots: {} }); for (const k in state.plots) { const p = Object.assign({}, state.plots[k]); o.plots[k] = p; } localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function load() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) state = Object.assign(state, s); } catch (e) {} }
  const notify = t => { try { window.Phone && Phone.notify(t); } catch (e) {} };

  // ---------------------------------------------------------------- prices: a slow swing plus a daily change, fixed by the day number
  function hash(a, b) { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); }
  function priceOn(crop, day) { const i = Object.keys(CROPS).indexOf(crop); return Math.round(CROPS[crop].price * (1 + 0.1 * Math.sin(day * 0.8 + i * 1.7) + 0.07 * (hash(day, i) - 0.5)) / 5) * 5; }
  const price = crop => priceOn(crop, dayInt());

  // ---------------------------------------------------------------- places
  function site(k) {
    const J = window.Jangaon && Jangaon.sites && Jangaon.sites[k];
    if (J && typeof J.x === 'number') {
      const p = J.entry ? { x: J.entry[0], z: J.entry[1] } : J, b = world && world.bounds;
      // the town lies beyond today's playable bounds until the streaming module widens them: stay on the planned stand-in till then
      if (!b || (p.x > b[0] && p.x < b[2] && p.z > b[1] && p.z < b[3])) return { x: p.x, z: p.z, name: J.name || PLANNED[k].name, real: true };
    }
    return PLANNED[k];
  }
  function factory() { return world.landmarks.find(l => l.k === 'factory'); }
  function kiosk(k, col, label) {
    const s = site(k); if (s.real) return;
    const g = new T.Group(), m = new T.MeshLambertMaterial({ color: col });
    const roof = new T.Mesh(new T.BoxGeometry(7, 0.2, 4.5), m); roof.position.y = 2.9; g.add(roof);
    for (const [x, z] of [[-3.2, -2], [3.2, -2], [-3.2, 2], [3.2, 2]]) { const p = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 2.9, 6), new T.MeshLambertMaterial({ color: 0x777777 })); p.position.set(x, 1.45, z); g.add(p); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#fff8e0'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#7a1420'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText(label, 128, 42);
    const sign = new T.Mesh(new T.PlaneGeometry(4, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), side: T.DoubleSide })); sign.position.set(0, 3.5, 0); g.add(sign);
    const stall = new T.Mesh(new T.BoxGeometry(5, 0.9, 1.2), new T.MeshLambertMaterial({ color: 0x8a6a3c })); stall.position.set(0, 0.45, 0.8); g.add(stall);
    g.position.set(s.x, gy(s.x, s.z), s.z); G.scene.add(g); kiosks[k] = g;
  }

  // ---------------------------------------------------------------- which parcels are on offer
  function pickPlots() {
    const C = (world.fields || []).filter(f => f.area >= 1200 && f.area <= 5000 && f.c <= 5 && !f.wooded && Math.abs(f.cx) < 1350 && Math.abs(f.cz) < 1200)
      .map(f => ({ f, d: Math.hypot(f.cx, f.cz) })).sort((a, b) => a.d - b.d), out = [];
    for (const { f } of C) {
      if (out.length >= 14 && !state.plots[f.i]) continue;
      const nr = world.nearestRoad(f.cx, f.cz); if (!nr || nr.d > 70) continue;
      if (!state.plots[f.i] && out.some(o => Math.hypot(o.f.cx - f.cx, o.f.cz - f.cz) < 90)) continue;
      out.push({ id: f.i, f, name: 'Plot ' + (out.length + 1), buy: Math.round(f.area * 60 / 100) * 100, lease: Math.round(f.area * 3 / 10) * 10, nr });
    }
    return out;
  }
  const inPoly = (x, z, p) => { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
  function signFor(P) {
    const f = P.f; let bx = f.p[0][0], bz = f.p[0][1], bd = 1e9;
    for (const q of f.p) { const d = Math.hypot(q[0] - P.nr.x, q[1] - P.nr.z); if (d < bd) { bd = d; bx = q[0]; bz = q[1]; } }
    const dx = f.cx - bx, dz = f.cz - bz, d = Math.hypot(dx, dz) || 1; P.sx = bx + dx / d * 3; P.sz = bz + dz / d * 3;
    const g = new T.Group(), post = new T.Mesh(signGeo.post, signGeo.pm); post.position.y = 0.9; g.add(post);
    P.board = new T.Mesh(signGeo.board, signGeo.bm); P.board.position.y = 1.7; g.add(P.board);
    g.position.set(P.sx, gy(P.sx, P.sz), P.sz); g.rotation.y = Math.atan2(P.nr.x - bx, P.nr.z - bz); G.scene.add(g); P.sign = g;
  }
  let signGeo = null;
  function initSign() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#f7e27a'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#222'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.fillText('LAND', 128, 48); x.font = 'bold 26px sans-serif'; x.fillText('SALE / LEASE', 128, 98);
    signGeo = { post: new T.CylinderGeometry(0.05, 0.05, 1.8, 5), pm: new T.MeshLambertMaterial({ color: 0x5a4632 }), board: new T.PlaneGeometry(1.3, 0.65), bm: new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), side: T.DoubleSide }) };
  }

  // ---------------------------------------------------------------- ground skin and plants of a held plot
  function buildGrid(P) {
    if (P.cells) return;
    const f = P.f, ca = Math.cos(f.ang), sa = Math.sin(f.ang), hr = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / 2 + CELL, cells = [];
    for (let u = -hr; u <= hr; u += CELL) for (let w = -hr; w <= hr; w += CELL) {
      const x = f.cx + ca * u - sa * w, z = f.cz + sa * u + ca * w;
      if (inPoly(x, z, f.p)) cells.push({ x, z, u, w });
    }
    P.cells = cells; const n = cells.length, pos = new Float32Array(n * 18), col = new Float32Array(n * 18), uv = new Float32Array(n * 12), h = CELL / 2 + 0.02;
    const cn = [[-h, -h], [h, -h], [h, h], [-h, -h], [h, h], [-h, h]];
    cells.forEach((c, i) => cn.forEach(([a, b], k) => {
      const x = c.x + ca * a - sa * b, z = c.z + sa * a + ca * b, o = i * 18 + k * 3;
      pos[o] = x; pos[o + 1] = gy(x, z) + 0.06; pos[o + 2] = z;
      uv[i * 12 + k * 2] = (c.w + b) / 1.5; uv[i * 12 + k * 2 + 1] = (c.u + a) / 6;
    }));
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.computeVertexNormals(); P.pos0 = pos.slice(); P.geo = g;
    P.mesh = new T.Mesh(g, skinMat()); P.mesh.receiveShadow = true; P.mesh.name = 'farmSkin' + P.id; G.scene.add(P.mesh);
    P.scratch = cells.map((_, i) => hash(i, 3));
  }
  let _skin = null;
  function skinMat() {
    if (_skin) return _skin;
    const c = document.createElement('canvas'); c.width = 8; c.height = 32; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 8, 32); x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, 0, 8, 11); x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(0, 11, 8, 3);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.rotation = Math.PI / 2;
    return _skin = new T.MeshLambertMaterial({ map: t, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  function setCell(P, i, on, r, g, b) {
    const a = P.geo.attributes.position.array, c = P.geo.attributes.color.array, o = i * 18;
    for (let k = 0; k < 18; k++) a[o + k] = on ? P.pos0[o + k] : P.pos0[o + k % 3];
    for (let k = 0; k < 6; k++) { c[o + k * 3] = r; c[o + k * 3 + 1] = g; c[o + k * 3 + 2] = b; }
  }
  const cropGeo = {};
  function worldGeo(kind) {
    if (cropGeo[kind] !== undefined) return cropGeo[kind];
    const ims = (world.fieldGroup ? world.fieldGroup.children : []).filter(o => o.isInstancedMesh && o.material && o.material.map && o.material.alphaTest > 0.4);
    const big = ims.filter(o => o.instanceMatrix.count === 2600), K = { paddy: ims.find(o => o.instanceMatrix.count === 6000), cotton: big[0], maize: big[1], chilli: big[2], tuft: ims.find(o => o.instanceMatrix.count === 3000) }[kind];
    return cropGeo[kind] = K ? { geo: K.geometry, mat: K.material } : null;
  }
  function plantMesh(P, S0) {
    if (P.plants && P.plantKind === S0.crop) return;
    dropPlants(P); P.plantKind = S0.crop;
    const w = worldGeo(S0.crop) || { geo: new T.BoxGeometry(1, 1, 1), mat: new T.MeshLambertMaterial({ color: 0x4a8a3a }) };
    P.plants = new T.InstancedMesh(w.geo, w.mat.clone ? w.mat : w.mat, P.cells.length); P.plants.frustumCulled = false; P.plants.name = 'farmPlants' + P.id;
    P.plants.setColorAt(0, COL.setHex(0xffffff)); G.scene.add(P.plants);
    const W = worldGeo('tuft'); if (W) { P.weeds = new T.InstancedMesh(W.geo, W.mat, Math.min(P.cells.length, 200)); P.weeds.frustumCulled = false; P.weeds.count = 0; G.scene.add(P.weeds); }
  }
  function dropPlants(P) { for (const k of ['plants', 'weeds']) if (P[k]) { G.scene.remove(P[k]); P[k].dispose && P[k].dispose(); P[k] = null; } P.plantKind = null; }
  // redraw soil, water, plants, weeds and the heap from the saved state
  function repaint(P) {
    const s = state.plots[P.id]; if (!s) return; buildGrid(P);
    const run = s.run, cov = run ? run.cov : null, N = P.cells.length, tilled = s.soil === 'tilled', flooded = s.crop === 'paddy' && s.water > 0.45 && tilled;
    const stub = s.stage === 'stubble' || s.stage === 'failed';
    for (let i = 0; i < N; i++) {
      const cv = cov && cov[i] === '1', j = 0.9 + P.scratch[i] * 0.16;
      let on = tilled || stub, r = 0.36, g = 0.23, b = 0.14;
      if (run && run.kind === 'plough') on = cv || tilled && s.stage !== 'stubble';
      if (run && run.kind === 'plough' && cv) { r = 0.32; g = 0.2; b = 0.12; on = true; }
      else if (stub) { r = 0.62; g = 0.53; b = 0.34; }
      if (tilled && !stub) {
        const wet = run && run.kind === 'irrigate' ? (cv ? 1 : s.water) : s.water;
        if (flooded || (s.crop === 'paddy' && wet > 0.6)) { r = 0.26; g = 0.36; b = 0.38; }
        else { const d = 1 - 0.38 * clamp(wet, 0, 1); r *= d; g *= d; b *= d; }
      }
      setCell(P, i, on, r * j, g * j, b * j);
    }
    P.geo.attributes.position.needsUpdate = P.geo.attributes.color.needsUpdate = true; P.geo.computeVertexNormals();
    const grown = s.crop && (s.stage === 'growing' || s.stage === 'ready' || (run && (run.kind === 'sow' || run.kind === 'harvest')));
    if (grown) {
      plantMesh(P, s);
      const f = P.f, g = s.stage === 'ready' ? 1 : clamp(s.grown || 0, 0.03, 1), sy = 0.16 + 0.84 * g, sxz = (0.55 + 0.45 * g) * (s.crop === 'paddy' ? 1.5 : 1);
      Q.setFromAxisAngle(Y, -f.ang);
      const yel = clamp(1 - s.health, 0, 0.8) + (s.pest > 0.3 ? 0.25 : 0), ripe = s.crop === 'paddy' ? clamp((g - 0.72) * 3.5, 0, 1) : 0;
      COL.setRGB(clamp(0.55 + 0.45 * g + yel * 0.5 + ripe * 0.6, 0, 1.3), clamp(0.95 + ripe * 0.05 - yel * 0.3, 0, 1), clamp(0.6 + 0.3 * g - yel * 0.5 - ripe * 0.4, 0, 1));
      let n = 0;
      for (let i = 0; i < N; i++) {
        const c = P.cells[i], cv = cov && cov[i] === '1';
        if (run && run.kind === 'sow' && !cv) continue;
        if (run && run.kind === 'harvest' && cv) continue;
        M4.compose(V.set(c.x, gy(c.x, c.z) - (flooded ? 0.05 : 0), c.z), Q, S.set(sxz, sy * (0.9 + 0.2 * P.scratch[i]), sxz)); P.plants.setMatrixAt(n, M4); P.plants.setColorAt(n, COL); n++;
      }
      P.plants.count = n; P.plants.instanceMatrix.needsUpdate = true; if (P.plants.instanceColor) P.plants.instanceColor.needsUpdate = true;
      if (P.weeds) {
        const wc = Math.min(P.weeds.instanceMatrix.count, Math.floor(s.weed * N * 0.7)); let m = 0;
        for (let i = 0; i < N && m < wc; i += 1) { if (P.scratch[i] > s.weed) continue; const c = P.cells[i]; M4.compose(V.set(c.x + 1.1, gy(c.x, c.z), c.z - 0.9), Q, S.set(1.3, 1.5, 1.3)); P.weeds.setMatrixAt(m++, M4); }
        P.weeds.count = m; P.weeds.instanceMatrix.needsUpdate = true;
      }
    } else dropPlants(P);
    heap(P, s);
  }
  let sackGeo = null, sackMats = {};
  function heap(P, s) {
    const n = s.heap ? Math.min(40, Math.ceil(s.heap.kg / 60)) : 0;
    if (!n) { if (P.sacks) P.sacks.count = 0; return; }
    if (!sackGeo) { sackGeo = new T.SphereGeometry(0.34, 7, 5); sackGeo.scale(1.25, 0.62, 0.8); }
    const col = s.heap.crop === 'cotton' ? 0xf2f0ea : 0xc4a26a, mt = sackMats[col] || (sackMats[col] = new T.MeshLambertMaterial({ color: col }));
    if (!P.sacks) { P.sacks = new T.InstancedMesh(sackGeo, mt, 40); P.sacks.frustumCulled = false; P.sacks.name = 'farmSacks' + P.id; G.scene.add(P.sacks); }
    P.sacks.material = mt;
    for (let i = 0; i < n; i++) { const r = i % 8, l = (i / 8) | 0, x = P.sx + (r - 3.5) * 0.75, z = P.sz + 1.4 + ((i / 3) | 0) % 2 * 0.7; M4.compose(V.set(x, gy(x, z) + 0.2 + l * 0.38, z), Q.identity(), S.set(1, 1, 1)); P.sacks.setMatrixAt(i, M4); }
    P.sacks.count = n; P.sacks.instanceMatrix.needsUpdate = true;
  }
  function claimField(P, on) {
    const f = P.f; f.playerFarm = on;
    if (on) { P.c0 = P.c0 === undefined ? f.c : P.c0; P.crop0 = P.crop0 === undefined ? f.crop : P.crop0; f.c = 1; f.crop = null; }
    else if (P.c0 !== undefined) { f.c = P.c0; f.crop = P.crop0; }
    if (P.sign) P.sign.visible = true; if (P.board) P.board.visible = !on;
    try { world.setDetail(window.Quality ? Quality.level : 'high'); } catch (e) {}
  }

  // ---------------------------------------------------------------- rules
  const seedPacks = P => Math.max(1, Math.ceil(P.f.area / 1000));
  const fertBags = P => Math.max(1, Math.ceil(P.f.area / 1500));
  const sprayNeed = P => Math.max(1, Math.ceil(P.f.area / 2500));
  function take(P, how) {
    if (state.plots[P.id]) return false;
    const c = how === 'own' ? P.buy : P.lease;
    if (!Economy.spend(c, (how === 'own' ? 'Bought ' : 'Leased ') + P.name)) { pop('NOT ENOUGH CASH · NEED ' + fmt(c)); return false; }
    state.spent += c;
    state.plots[P.id] = { tenure: how, soil: 'raw', stage: 'fallow', crop: null, grown: 0, water: 0.2, weed: 0, pest: 0, health: 1, ferts: 0, heap: null, run: null, sowDay: 0 };
    claimField(P, true); buildGrid(P); repaint(P); locs(); save(); pop((how === 'own' ? 'LAND BOUGHT · ' : 'LEASED FOR ONE CROP · ') + P.name.toUpperCase()); return true;
  }
  function release(P) {
    const s = state.plots[P.id]; if (!s) return;
    delete state.plots[P.id]; dropPlants(P); if (P.mesh) { G.scene.remove(P.mesh); P.mesh.geometry.dispose(); P.mesh = null; P.cells = null; P.geo = null; } if (P.sacks) P.sacks.count = 0;
    claimField(P, false); locs(); save();
  }
  // what stands in the way of an operation; null when it can start now
  function blocked(P, op, crop) {
    const s = state.plots[P.id]; if (!s) return 'Not your plot';
    if (s.run) return 'Busy: ' + OPS[s.run.kind];
    switch (op) {
      case 'plough': if (s.stage === 'growing' || s.stage === 'ready') return 'Crop is standing'; if (s.soil === 'tilled' && s.stage === 'fallow') return 'Already ploughed'; if (s.heap) return 'Move the harvest first'; return null;
      case 'sow': if (s.soil !== 'tilled' || s.stage !== 'fallow') return 'Plough first'; if (!crop || !CROPS[crop]) return 'Pick a crop'; if ((state.seeds[crop] || 0) < seedPacks(P)) return 'Need ' + seedPacks(P) + ' packets of ' + CROPS[crop].name + ' seed'; return null;
      case 'irrigate': if (s.soil !== 'tilled' || s.stage === 'stubble') return 'Plough first'; if (s.water > 0.85) return 'Field is wet enough'; return null;
      case 'fert': if (s.stage !== 'growing') return 'Sow first'; if (s.water < 0.15) return 'Irrigate first: dry soil burns the crop'; if (s.ferts >= 2) return 'Enough fertiliser'; if (state.fert < fertBags(P)) return 'Need ' + fertBags(P) + ' fertiliser bags'; return null;
      case 'weed': if (s.stage !== 'growing' && s.stage !== 'ready') return 'No crop'; if (s.weed < 0.15) return 'No weeds yet'; return null;
      case 'spray': if (s.stage !== 'growing' && s.stage !== 'ready') return 'No crop'; if (s.pest < 0.1) return 'No pests seen'; if (state.spray < sprayNeed(P)) return 'Need ' + sprayNeed(P) + ' bottles of pesticide'; return null;
      case 'harvest': if (s.stage !== 'ready') return 'Not ready yet'; return null;
    }
    return 'Unknown';
  }
  function act(id, op, o) {
    o = o || {}; const P = byId[id], s = P && state.plots[id]; if (!s) return false;
    const why = blocked(P, op, o.crop); if (why) { pop(why.toUpperCase()); return false; }
    buildGrid(P);
    const hire = !!o.hire, N = P.cells.length;
    if (hire && !HIRE[op]) return false;
    const hc = hire ? Math.round(HIRE[op] * Math.max(1, P.f.area / 2000)) : 0;
    const diesel = op === 'irrigate' ? Math.round(DIESEL_K * Math.max(1, P.f.area / 1000)) : 0;
    if (!Economy.spend(hc + diesel, (hire ? 'Hired help: ' : 'Pump diesel: ') + OPS[op] + ' ' + P.name)) { pop('NOT ENOUGH CASH · NEED ' + fmt(hc + diesel)); return false; }
    state.spent += hc + diesel;
    if (op === 'sow') { state.seeds[o.crop] -= seedPacks(P); s.pendingCrop = o.crop; s.crop = o.crop; }
    if (op === 'fert') state.fert -= fertBags(P);
    if (op === 'spray') state.spray -= sprayNeed(P);
    s.run = { kind: op, cov: '0'.repeat(N), hire, t: 0, auto: op === 'irrigate' };
    if (op === 'plough' && s.stage !== 'fallow') { s.stage = 'fallow'; s.crop = null; s.heap = null; s.soil = 'raw'; }
    if (hire) startMover(P, s); else if (op !== 'irrigate') pop(hint(op));
    repaint(P); save(); return true;
  }
  function hint(op) {
    if (op === 'plough') return 'DRIVE THE TRACTOR (U: CULTIVATOR) OR BULLOCK CART OVER THE FIELD';
    return 'WALK OR DRIVE THE TRACTOR OVER THE FIELD: ' + OPS[op].toUpperCase();
  }
  function finish(P, s) {
    const k = s.run.kind; s.run = null;
    if (k === 'plough') { s.soil = 'tilled'; s.stage = 'fallow'; s.weed = 0; s.pest = 0; s.ferts = 0; s.health = 1; s.grown = 0; }
    if (k === 'sow') { s.stage = 'growing'; s.grown = 0; s.sowDay = state.day; s.health = 1; s.weed = 0; s.pest = 0; s.crop = s.pendingCrop || s.crop; delete s.pendingCrop; }
    if (k === 'irrigate') s.water = 1;
    if (k === 'fert') s.ferts++;
    if (k === 'weed') s.weed = 0;
    if (k === 'spray') s.pest = 0;
    if (k === 'harvest') {
      const C = CROPS[s.crop], kg = Math.round(P.f.area / ACRE * C.yield * s.health * (0.7 + 0.15 * Math.min(2, s.ferts)));
      s.heap = { crop: s.crop, kg, grade: s.health > 0.75 ? 'A' : 'B' }; s.stage = 'stubble'; s.soil = 'stubble'; s.crop = null;
      notify(P.name + ': harvested ' + (kg / 100).toFixed(1) + ' quintals of ' + C.name);
    }
    stopMover(P); repaint(P); pop(OPS[k].toUpperCase() + ' DONE · ' + P.name.toUpperCase()); save();
  }
  function coverAt(P, s, x, z, R) {
    const run = s.run; let cov = null, ch = false;
    for (let i = 0; i < P.cells.length; i++) {
      const c = P.cells[i]; if (run.cov[i] === '1') continue;
      if (Math.abs(c.x - x) > R || Math.abs(c.z - z) > R || Math.hypot(c.x - x, c.z - z) > R) continue;
      cov = cov || run.cov.split(''); cov[i] = '1'; ch = true;
    }
    if (ch) { run.cov = cov.join(''); run.dirty = true; }
    return ch;
  }
  const covered = s => { const c = s.run.cov; let n = 0; for (let i = 0; i < c.length; i++) if (c[i] === '1') n++; return n / (c.length || 1); };

  // hired help: a labourer, or the bullock team for ploughing, walks lanes over the parcel
  function startMover(P, s) {
    const lanes = {}; P.cells.forEach(c => { const l = Math.round(c.w / 9); if (Math.abs(c.w - l * 9) <= CELL / 2 + 0.01) (lanes[l] = lanes[l] || []).push(c); });
    const path = Object.keys(lanes).map(Number).sort((a, b) => a - b).flatMap((l, i) => lanes[l].sort((a, b) => (i % 2 ? b.u - a.u : a.u - b.u)));
    let g, h = null;
    if (s.run.kind === 'plough' && TrafficModels.bullockCart) g = TrafficModels.bullockCart().g;
    else { h = HumanModel.create(Object.assign(HumanModel.randomAppearance('m'), { lod: 'low', bottom: 'lungi', acc: {} })); g = h.group; }
    G.scene.add(g); P.mover = { g, h, path, i: 0, k: 0, ph: 0 };
  }
  function stopMover(P) { if (P.mover) { G.scene.remove(P.mover.g); P.mover = null; } }
  function moveHelp(P, s, dt) {
    const m = P.mover; if (!m) { startMover(P, s); return; }
    const a = m.path[m.i], b = m.path[Math.min(m.i + 1, m.path.length - 1)]; if (!a) return;
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; m.k += dt * 2.6 / L;
    while (m.k >= 1 && m.i < m.path.length - 1) { m.k -= 1; m.i++; }
    const x = a.x + (b.x - a.x) * Math.min(1, m.k), z = a.z + (b.z - a.z) * Math.min(1, m.k);
    m.g.position.set(x, gy(x, z), z); if (L > 0.1) m.g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    if (m.h) { m.ph += dt * 7; HumanModel.animateWalk(m.h.parts, m.ph, 1.3); }
    coverAt(P, s, x, z, 5.2);
    if (m.i >= m.path.length - 1) { s.run.cov = '1'.repeat(P.cells.length); }
  }
  // the cultivator on the tractor
  function implement(v, on) {
    if (on && !v._plough) {
      const g = new T.Group(), m = new T.MeshLambertMaterial({ color: 0x8a2a1c }), bar = new T.Mesh(new T.BoxGeometry(2.2, 0.12, 0.14), m); bar.position.set(0, 0.5, -1.9); g.add(bar);
      for (let i = -2; i <= 2; i++) { const t = new T.Mesh(new T.BoxGeometry(0.07, 0.5, 0.1), new T.MeshLambertMaterial({ color: 0x444444 })); t.position.set(i * 0.5, 0.25, -1.95); t.rotation.x = 0.3; g.add(t); }
      const arm = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.9), m); arm.position.set(0, 0.6, -1.5); g.add(arm); g.name = 'cultivator'; v.g.add(g); v._plough = g;
    } else if (!on && v._plough) { v.g.remove(v._plough); v._plough = null; }
  }
  function toggleImplement() {
    const v = Player.active;
    if (Player.mode !== 'vehicle' || !v || v.model !== 'tractor') { pop('NEEDS A TRACTOR'); return false; }
    if (v.trailer) { pop('UNHITCH THE TROLLEY FIRST (J)'); return false; }
    if (Math.abs(carSpeed) > 5) { pop('STOP TO FIT THE CULTIVATOR'); return false; }
    implement(v, !v._plough); pop(v._plough ? 'CULTIVATOR FITTED' : 'CULTIVATOR OFF'); return true;
  }

  // ---------------------------------------------------------------- daily life of the crop
  function grow(days) {
    state.day += days;
    for (const id in state.plots) {
      const s = state.plots[id], P = byId[id]; if (!P) continue;
      if (s.stage !== 'growing' && s.stage !== 'ready') { if (s.soil === 'tilled') s.water = Math.max(0, s.water - 0.1 * days); continue; }
      const C = CROPS[s.crop] || CROPS[s.pendingCrop]; if (!C) continue;
      s.water = Math.max(0, s.water - C.water * days);
      const dry = s.water < 0.12;
      if (s.stage === 'growing') {
        s.grown = Math.min(1, s.grown + days / C.days * (dry ? 0.3 : 1));
        s.weed = Math.min(1, s.weed + 0.2 * days);
        if (Math.floor(state.day * 3) !== Math.floor((state.day - days) * 3) && !s.pest && s.grown > 0.2 && s.grown < 0.9 && Math.random() < (Farm._pestChance !== undefined ? Farm._pestChance : 0.12)) { s.pest = 0.15; notify(P.name + ': pests on the ' + C.name); }
        if (s.pest) s.pest = Math.min(1, s.pest + 0.25 * days);
        if (s.grown >= 1) { s.stage = 'ready'; notify(P.name + ': ' + C.name + ' is ready to harvest'); }
      }
      s.health = clamp(s.health - days * ((dry ? 0.22 : 0) + (s.weed > 0.6 ? 0.1 : 0) + (s.pest > 0.5 ? 0.22 : 0)), 0, 1);
      if (dry && !s.warned) { s.warned = 1; notify(P.name + ': field is dry, irrigate'); } else if (!dry) s.warned = 0;
      if (s.health <= 0.05) { s.stage = 'failed'; s.soil = 'stubble'; s.crop = null; s.run = null; stopMover(P); notify(P.name + ': the crop failed'); }
    }
  }

  // ---------------------------------------------------------------- shop, trolley, market
  function buy(item, n) {
    n = n || 1; const c = item === 'fert' ? FERT_PRICE : item === 'spray' ? SPRAY_PRICE : CROPS[item] ? CROPS[item].seed : 0; if (!c) return false;
    if (!atSite('seedShop') && !Farm._anywhere) { pop('GO TO THE SEED SHOP'); return false; }
    if (!Economy.spend(c * n, 'Farm supplies: ' + (CROPS[item] ? CROPS[item].name + ' seed' : item))) { pop('NOT ENOUGH CASH'); return false; }
    state.spent += c * n; if (item === 'fert') state.fert += n; else if (item === 'spray') state.spray += n; else state.seeds[item] = (state.seeds[item] || 0) + n; save(); return true;
  }
  function atSite(k, R) { const s = site(k); return Math.hypot(s.x - carPos.x, s.z - carPos.z) < (R || 28); }
  function atFactory() { const f = factory(); return f && Math.hypot(f.x - carPos.x, f.z - carPos.z) < 60; }
  function myTrolley() { const v = Player.active; return Player.mode === 'vehicle' && v && v.model === 'tractor' && v.trailer ? v : null; }
  function showLoad(v) {
    const l = v && v.trailer && v.trailer.getObjectByName('trolleyLoad'); if (!l) return;
    const c = state.cargo; l.visible = !!c;
    if (c) { const k = clamp(c.kg / TROLLEY_KG, 0.12, 1); l.scale.y = 0.55 * k + 0.02; l.position.y = 1.15 + 0.5 * k; if (l.material && l.material.color) { l.material = l.material.clone(); l.material.color.setHex(c.crop === 'cotton' ? 0xf2f0ea : CROPS[c.crop].col); } }
  }
  function loadTrolley(id) {
    const P = byId[id], s = P && state.plots[id], v = myTrolley();
    if (!s || !s.heap) { pop('NOTHING TO LOAD'); return false; }
    if (!v) { pop('BRING A TRACTOR WITH A TROLLEY'); return false; }
    if (Math.abs(carSpeed) > 5) { pop('STOP TO LOAD'); return false; }
    if (Math.hypot(P.sx - carPos.x, P.sz - carPos.z) > 45) { pop('PARK NEAR THE SACKS'); return false; }
    const c = state.cargo; if (c && c.crop !== s.heap.crop) { pop('TROLLEY HAS ANOTHER CROP'); return false; }
    const room = TROLLEY_KG - (c ? c.kg : 0), kg = Math.min(room, s.heap.kg); if (kg <= 0) { pop('TROLLEY FULL · SELL FIRST'); return false; }
    state.cargo = { crop: s.heap.crop, kg: (c ? c.kg : 0) + kg, grade: c && c.grade === 'B' ? 'B' : s.heap.grade };
    s.heap.kg -= kg; if (s.heap.kg <= 0) s.heap = null;
    heap(P, s); showLoad(v); pop('LOADED ' + (kg / 100).toFixed(1) + ' QUINTALS');
    if (!s.heap && s.tenure === 'lease') { pop('LEASE ENDED · ' + P.name.toUpperCase()); release(P); }
    save(); return true;
  }
  function sellValue() {
    const c = state.cargo; if (!c) return 0;
    return Math.round(c.kg / 100 * price(c.crop) * (c.grade === 'A' ? 1 : 0.92) * (c.crop === 'cotton' && atFactory() ? 1.03 : 1) * 0.99);
  }
  function sell() {
    const c = state.cargo; if (!c) { pop('NOTHING LOADED'); return 0; }
    const v = myTrolley(); if (!v) { pop('COME WITH THE LOADED TROLLEY'); return 0; }
    if (!(atSite('market', 45) || (c.crop === 'cotton' && atFactory()))) { pop('GO TO THE MARKET YARD'); return 0; }
    if (Math.abs(carSpeed) > 5) { pop('STOP TO SELL'); return 0; }
    const amt = sellValue(); Economy.earn(amt, 'Farm sale: ' + (c.kg / 100).toFixed(1) + ' q ' + CROPS[c.crop].name); state.earned += amt; state.cargo = null; showLoad(v); save();
    pop('SOLD ' + CROPS[c.crop].name.toUpperCase() + ' +' + fmt(amt)); notify('Sold ' + CROPS[c.crop].name + ' for ' + fmt(amt)); return amt;
  }

  // ---------------------------------------------------------------- UI
  const css = `#farmPanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:41;width:min(440px,94vw);max-height:84vh;overflow:auto;background:rgba(14,20,16,.97);color:#e8efe4;border:1px solid #3f5a3a;border-radius:14px;padding:14px;font:13px/1.4 system-ui,"Noto Sans Telugu",sans-serif}
#farmPanel h3{margin:0 0 2px;color:#a3e635;font-size:16px}#farmPanel .sub{color:#94a39a;font-size:12px;margin-bottom:8px}#farmPanel button{display:block;width:100%;min-height:40px;margin:5px 0;padding:8px 10px;border-radius:9px;border:1px solid #446;background:#1c2a20;color:#f0f6ec;font:600 13px system-ui;cursor:pointer;text-align:left}
#farmPanel button[disabled]{opacity:.45;cursor:default}#farmPanel button.go{background:#3f6212;border-color:#65a30d}#farmPanel .row{display:flex;gap:6px}#farmPanel .row button{flex:1}#farmPanel .bar{height:7px;background:#26322a;border-radius:4px;overflow:hidden;margin:2px 0 6px}#farmPanel .bar i{display:block;height:100%}
#farmPill{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 150px);transform:translateX(-50%);z-index:9;display:none;padding:9px 16px;min-height:40px;border-radius:20px;border:1px solid #65a30d;background:rgba(20,40,16,.9);color:#ecfccb;font:700 13px system-ui;cursor:pointer}
#farmJob{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 62px);transform:translateX(-50%);z-index:7;display:none;padding:5px 12px;border-radius:9px;background:rgba(14,20,16,.82);color:#d9f99d;font:600 12px system-ui;pointer-events:none;white-space:nowrap}`;
  function initUI() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    pill = document.createElement('button'); pill.id = 'farmPill'; pill.addEventListener('click', e => { e.stopPropagation(); openNear(); }); document.body.appendChild(pill);
    Farm._job = document.createElement('div'); Farm._job.id = 'farmJob'; document.body.appendChild(Farm._job);
  }
  const close = () => { if (panelEl) { panelEl.remove(); panelEl = null; } };
  function panel(html, onClick) {
    close(); panelEl = document.createElement('div'); panelEl.id = 'farmPanel'; panelEl.innerHTML = html + '<button data-a="x">Close</button>';
    panelEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; e.stopPropagation(); if (b.dataset.a === 'x') return close(); onClick(b.dataset); });
    document.body.appendChild(panelEl);
  }
  const bar = (v, c) => `<div class="bar"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%;background:${c}"></i></div>`;
  const stageName = s => s.run ? OPS[s.run.kind] + ' in progress' : ({ fallow: s.soil === 'tilled' ? 'Ploughed, ready to sow' : 'Unploughed', stubble: 'Harvested', failed: 'Crop failed, plough it in', ready: 'Ready to harvest' }[s.stage] || growthName(s));
  const growthName = s => { const g = s.grown; return (CROPS[s.crop] || {}).name + ': ' + (g < 0.15 ? 'sprouting' : g < 0.5 ? 'vegetative' : g < 0.8 ? 'flowering' : 'maturing') + ' ' + Math.round(g * 100) + '%'; };
  function plotPanel(P) {
    const s = state.plots[P.id], ac = (P.f.area / ACRE).toFixed(2);
    if (!s) return panel(`<h3>${P.name} · ${ac} acre</h3><div class="sub">${Math.round(P.f.area)} m², open field</div><button class="go" data-a="own">Buy ${fmt(P.buy)}</button><button data-a="lease">Lease one crop ${fmt(P.lease)}</button>`, d => { if (take(P, d.a === 'own' ? 'own' : 'lease')) plotPanel(P); });
    const btn = (op, extra) => { const w = blocked(P, op, extra && extra.crop); return `<button ${w ? 'disabled title="' + w + '"' : ''} data-a="op" data-op="${op}"${extra && extra.crop ? ` data-crop="${extra.crop}"` : ''}>${extra && extra.label || OPS[op]}${w ? ' · ' + w : ''}</button>`; };
    const hireBtn = op => blocked(P, op) ? '' : `<button data-a="op" data-op="${op}" data-hire="1">Hire for ${OPS[op]} ${fmt(HIRE[op] * Math.max(1, P.f.area / 2000))}</button>`;
    let h = `<h3>${P.name} · ${ac} acre · ${s.tenure === 'own' ? 'owned' : 'leased'}</h3><div class="sub">${stageName(s)}${s.run ? ' ' + Math.round(covered(s) * 100) + '%' : ''}</div>
Water${bar(s.water, '#38bdf8')}Weeds${bar(s.weed, '#a16207')}Pests${bar(s.pest, '#dc2626')}Health${bar(s.health, '#84cc16')}`;
    if (s.stage === 'fallow' && s.soil === 'tilled') { h += '<div class="sub">Seed: ' + Object.keys(CROPS).map(c => CROPS[c].name + ' ' + (state.seeds[c] || 0)).join(' · ') + ' · needs ' + seedPacks(P) + '</div>' + Object.keys(CROPS).map(c => btn('sow', { crop: c, label: 'Sow ' + CROPS[c].name + ' ' + CROPS[c].te })).join('') + `<button data-a="op" data-op="irrigate">Irrigate</button>`; }
    else h += ['plough', 'irrigate', 'fert', 'weed', 'spray', 'harvest'].map(o => btn(o)).join('') + hireBtn('plough') + hireBtn('harvest') + hireBtn('weed');
    if (s.heap) h += `<button class="go" data-a="load">Load trolley · ${(s.heap.kg / 100).toFixed(1)} q ${CROPS[s.heap.crop].name}</button>`;
    panel(h, d => { if (d.a === 'load') loadTrolley(P.id); else act(P.id, d.op, { crop: d.crop, hire: !!d.hire }); if (state.plots[P.id]) plotPanel(P); else close(); });
  }
  function shopPanel() {
    const item = (k, n, c, have) => `<button data-a="${k}">${n} ${fmt(c)} · have ${have}</button>`;
    panel(`<h3>${site('seedShop').name}</h3><div class="sub">One packet sows 1000 m²; one bag covers 1500 m²</div>` + Object.keys(CROPS).map(c => item(c, CROPS[c].name + ' seed', CROPS[c].seed, state.seeds[c] || 0)).join('') + item('fert', 'Fertiliser bag', FERT_PRICE, state.fert) + item('spray', 'Pesticide', SPRAY_PRICE, state.spray), d => { buy(d.a); shopPanel(); });
  }
  function marketPanel() {
    const c = state.cargo, rows = Object.keys(CROPS).map(k => `${CROPS[k].name} ${fmt(price(k))}/q ${price(k) >= priceOn(k, dayInt() - 1) ? '▲' : '▼'}`).join('<br>');
    panel(`<h3>${atFactory() ? 'Cotton Factory' : site('market').name}</h3><div class="sub">${rows}</div>${c ? `<button class="go" data-a="sell">Sell ${(c.kg / 100).toFixed(1)} q ${CROPS[c.crop].name} grade ${c.grade} for ${fmt(sellValue())}</button>` : '<div class="sub">Nothing on the trolley</div>'}`, () => { sell(); marketPanel(); });
  }
  function context() {
    if (atSite('seedShop')) return { kind: 'shop', label: 'Seed shop' };
    if (atSite('market', 45) || (atFactory() && state.cargo)) return { kind: 'market', label: 'Market' };
    if (Player.mode === 'passenger') return null;
    const fa = world.fieldAt && world.fieldAt(carPos.x, carPos.z); let P = fa && byId[fa.i];
    if (!P) for (const q of plots) if (Math.hypot(q.sx - carPos.x, q.sz - carPos.z) < 14 || (state.plots[q.id] && state.plots[q.id].heap && Math.hypot(q.sx - carPos.x, q.sz - carPos.z) < 40)) { P = q; break; }
    return P ? { kind: 'plot', P, label: P.name } : null;
  }
  function openNear() { const c = context(); if (!c) return false; if (c.kind === 'shop') shopPanel(); else if (c.kind === 'market') marketPanel(); else plotPanel(c.P); return true; }

  function appHtml() {
    const held = plots.filter(P => state.plots[P.id]), c = state.cargo;
    return `<div style="font:13px/1.4 system-ui;padding:6px"><b>Day ${dayInt() + 1}</b> · Prices: ${Object.keys(CROPS).map(k => CROPS[k].name + ' ' + fmt(price(k))).join(', ')}<br>Stock: seed ${Object.keys(CROPS).map(k => state.seeds[k] || 0).join('/')} · fert ${state.fert} · spray ${state.spray}<br>${c ? 'On trolley: ' + (c.kg / 100).toFixed(1) + ' q ' + CROPS[c.crop].name + '<br>' : ''}Earned ${fmt(state.earned)} · spent ${fmt(state.spent)}<hr>` +
      (held.length ? held.map(P => { const s = state.plots[P.id]; return `<div class="ph-item" data-id="${P.id}" style="padding:7px;border-bottom:1px solid #4445;cursor:pointer"><b>${P.name}</b> ${stageName(s)}<br>water ${Math.round(s.water * 100)}% · weeds ${Math.round(s.weed * 100)}% · pests ${Math.round(s.pest * 100)}% · health ${Math.round(s.health * 100)}%${nextTask(s) ? '<br>Next: ' + nextTask(s) : ''}</div>`; }).join('') : '<div>No land yet. Look for yellow LAND boards.</div>') +
      plots.filter(P => !state.plots[P.id]).slice(0, 4).map(P => `<div class="ph-item" data-id="${P.id}" style="padding:7px;cursor:pointer">${P.name} for sale ${fmt(P.buy)} · lease ${fmt(P.lease)}</div>`).join('') + '</div>';
  }
  function nextTask(s) {
    if (s.run) return OPS[s.run.kind]; if (s.heap) return 'Load the trolley and sell'; if (s.stage === 'stubble' || s.stage === 'failed' || s.soil === 'raw') return 'Plough'; if (s.stage === 'fallow') return 'Sow';
    if (s.stage === 'ready') return 'Harvest'; if (s.water < 0.3) return 'Irrigate'; if (s.pest > 0.1) return 'Spray'; if (s.weed > 0.4) return 'Weed'; if (s.ferts < 1) return 'Fertilise'; return '';
  }
  function openApp(c) { c.innerHTML = appHtml(); c.querySelectorAll('.ph-item').forEach(el => el.addEventListener('click', () => { const P = byId[el.dataset.id]; if (P) { setWay(P.sx, P.sz, P.name); pop('GPS SET · ' + P.name.toUpperCase()); } })); }
  const setWay = (x, z, l) => { try { window.Properties && Properties.setWaypoint && Properties.setWaypoint(x, z, l); } catch (e) {} };
  function locs() {
    try {
      const L = window.GameLocations; if (!L) return;
      L.add('farm-market', Object.assign({ kind: 'market' }, site('market'))); L.add('farm-seedshop', Object.assign({ kind: 'shop' }, site('seedShop')));
      plots.forEach(P => { if (state.plots[P.id]) L.add('farm-' + P.id, { name: P.name, x: P.sx, z: P.sz, kind: 'farm' }); else L.remove('farm-' + P.id); });
    } catch (e) {}
  }

  // ---------------------------------------------------------------- hooks
  function init(g) {
    G = g; world = g.world; load(); initSign(); initUI();
    try { plots = pickPlots(); } catch (e) { console.error('farm plots', e); plots = []; }
    byId = {}; plots.forEach(P => { byId[P.id] = P; signFor(P); });
    for (const id in state.plots) { const P = byId[id]; if (!P) { delete state.plots[id]; continue; } claimField(P, true); buildGrid(P); const s = state.plots[id]; if (s.run && s.run.cov.length !== P.cells.length) s.run = null; if (s.run && s.run.hire) startMover(P, s); repaint(P); }
    kiosk('market', 0x7a4a1c, 'MARKET YARD'); kiosk('seedShop', 0x2e7a3a, 'SEEDS'); locs();
    try { Phone.addApp({ id: 'farm', name: 'Farm', icon: 'wheat', open: openApp }); } catch (e) {}
    console.log('farm.js:', plots.length, 'plots on offer');
  }
  function update(dt) {
    if (!G) return;
    if (typeof timeOfDay === 'number') { if (lastHour !== null) { const d = (timeOfDay - lastHour + 24) % 24; if (d > 0) grow(d / 24); } lastHour = timeOfDay; }
    const speed = Math.abs(carSpeed), mode = Player.mode, a = Player.active;
    let job = '';
    for (const id in state.plots) {
      const s = state.plots[id], P = byId[id]; if (!P || !s.run) continue;
      const k = s.run.kind;
      if (s.run.auto) {                                           // the pump: water spreads from the sign over 25 s
        s.run.t += dt; const n = Math.floor(P.cells.length * clamp(s.run.t / 25, 0, 1)); s.run.cov = '1'.repeat(n) + '0'.repeat(P.cells.length - n); s.run.dirty = true;
        if (Math.hypot(P.sx - carPos.x, P.sz - carPos.z) < 120) job = 'Pump running · ' + P.name + ' ' + Math.round(s.run.t * 4) + '%';
      } else if (s.run.hire) { moveHelp(P, s, dt); job = job || 'Hired help · ' + OPS[k] + ' · ' + P.name + ' ' + Math.round(covered(s) * 100) + '%'; }
      else {
        const hereF = Math.hypot(carPos.x - P.f.cx, carPos.z - P.f.cz) < Math.hypot(P.f.x1 - P.f.x0, P.f.z1 - P.f.z0) / 2 + 8;
        let R = 0;
        if (hereF) {
          if (k === 'plough') { if (mode === 'vehicle' && a && ((a.model === 'tractor' && a._plough) || a.model === 'bullockCart') && speed > 1.5) R = a.model === 'tractor' ? 4 : 3; }
          else if (mode === 'foot' ? true : (mode === 'vehicle' && a && a.model === 'tractor' && speed > 1.5)) R = mode === 'foot' ? 3.6 : 4.5;
        }
        const mv = Farm._lp ? Math.hypot(carPos.x - Farm._lp.x, carPos.z - Farm._lp.z) : 1;
        if (R && mv > 0.02) coverAt(P, s, carPos.x, carPos.z, R);
        if (hereF) job = OPS[k] + ' · ' + Math.round(covered(s) * 100) + '%' + (k === 'plough' && !R ? ' · ' + (a && a.model === 'tractor' && !a._plough ? 'press U for the cultivator' : 'needs tractor or bullock cart, moving') : '');
      }
      if (s.run.dirty) { s.run.dirty = false; if ((P._rp = (P._rp || 0) + 1) % 3 === 0 || covered(s) >= 0.9) repaint(P); }
      if (covered(s) >= 0.9) finish(P, s);
    }
    Farm._lp = { x: carPos.x, z: carPos.z };
    if (Farm._job) { Farm._job.textContent = job; Farm._job.style.display = job ? 'block' : 'none'; }
    if ((acc += dt) < 0.4) return; acc = 0;
    if ((Farm._rt = (Farm._rt || 0) + 1) % 15 === 0) { for (const id in state.plots) if (byId[id]) repaint(byId[id]); if (Object.keys(state.plots).length || state.cargo) save(); }   // an idle second tab must not overwrite a real farm
    for (const k in kiosks) if (site(k).real && kiosks[k].visible) { kiosks[k].visible = false; locs(); }   // the real town arrived
    near = (typeof isPlaying === 'undefined' || isPlaying) ? context() : null;
    pill.style.display = near && !panelEl ? 'block' : 'none'; if (near) pill.textContent = 'E · ' + near.label;
    if (panelEl && near === null) close();
    const v = myTrolley(); if (v && state.cargo && !v._cargoShown) { v._cargoShown = true; showLoad(v); }
  }
  const Farm = window.Farm = {
    CROPS, OPS, get state() { return state; }, get plots() { return plots; }, take, release, act, blocked, buy, loadTrolley, sell, sellValue, price, priceOn, site, grow, repaint, plotPanel, shopPanel, marketPanel, openNear, context, toggleImplement, implement, covered, appHtml, openApp, save, seedPacks, fertBags, sprayNeed, nextTask,
    reset() { Object.keys(state.plots).forEach(id => byId[id] && release(byId[id])); state = { v: 1, day: 0, seeds: {}, fert: 0, spray: 0, plots: {}, cargo: null, earned: 0, spent: 0 }; save(); },
  };
  GameHooks.init.push(init);
  GameHooks.update.push(update);
  GameHooks.key.push(e => {
    if (e.repeat) return false;
    if (e.code === 'Escape' && panelEl) { close(); return true; }
    if (e.code === 'KeyE') { if (panelEl) { close(); return true; } return openNear(); }
    if (e.code === 'KeyU' && typeof Player !== 'undefined' && Player.mode === 'vehicle' && Player.active && Player.active.model === 'tractor') { toggleImplement(); return true; }
    if (e.code === 'KeyY') { if (panelEl) { close(); return true; } panel('<h3>' + UI.icon('wheat') + ' Farm</h3><div id="farmApp"></div>', () => {}); openApp(panelEl.querySelector('#farmApp')); return true; }
    return false;
  });
})();
