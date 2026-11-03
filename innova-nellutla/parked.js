// parked.js: parked vehicles at homes / along roads, and marked parking lots with numbered bays.
// Parked vehicles are drawn as instanced, baked meshes (one draw call per colour variant), with a
// box proxy for the far range. When the player presses F on foot near one, a real TrafficModels
// vehicle replaces the instance and is handed to player.js through the global `traffic` array.
// Exposes window.Parked = { lots: [{ name, x, z, rot, bays: [{ x, z, rot, taken }] }], vehicles, count }.
const Parked = (function () {
  const api = { lots: [], vehicles: [], count: 0 };
  // Variant kinds (it.vk) pick the TrafficModels builder; the kind handed to player.js (it.kind / t.model) is what its
  // PARAMS / SEATS know: every two-wheeler drives as 'bike', the Innova-style MPV and Fortuner-style 4x4 as 'suv'.
  const KINDS = ['bike', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'hatch', 'suv', 'swift', 'dzire', 'alto', 'bolero', 'scorpio', 'ace', 'mpv', 'fortuner', 'fortunerBlack', 'auto', 'tractor', 'lorry', 'bus', 'bullockCart'];
  const VARIANTS = { bike: 3, scooter: 3, classic: 2, classic2: 2, sport: 2, faired: 2, cycle: 2, hatch: 1, suv: 1, swift: 3, dzire: 2, alto: 3, bolero: 2, scorpio: 2, ace: 1, mpv: 1, fortuner: 1, fortunerBlack: 1, auto: 3, tractor: 2, lorry: 2, bus: 1, bullockCart: 1 };
  const HW = { bike: 0.45, scooter: 0.42, classic: 0.45, classic2: 0.45, sport: 0.45, faired: 0.42, cycle: 0.38, auto: 0.75, hatch: 0.85, suv: 0.95, swift: 0.86, dzire: 0.88, alto: 0.76, bolero: 0.92, scorpio: 0.98, ace: 0.8, mpv: 0.95, fortuner: 0.98, fortunerBlack: 0.98, tractor: 1.0, lorry: 1.2, bus: 1.3, bullockCart: 0.9 };
  const PLAYER_KIND = { scooter: 'bike', classic: 'bike', classic2: 'bike', sport: 'bike', faired: 'bike', cycle: 'bike', mpv: 'suv', fortuner: 'suv', fortunerBlack: 'suv',
    swift: 'hatch', dzire: 'hatch', alto: 'hatch', bolero: 'suv', scorpio: 'suv', ace: 'suv' };
  const pk = vk => PLAYER_KIND[vk] || vk;
  const HOME_BIKES = ['bike', 'bike', 'bike', 'scooter', 'scooter', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle'];
  const HOME_CARS = ['swift', 'swift', 'alto', 'alto', 'alto', 'dzire', 'bolero', 'bolero', 'scorpio', 'ace', 'mpv'];
  const NEAR = 130, FAR = 520;         // full detail inside NEAR, box proxy inside FAR, nothing beyond

  // seeded random so the village looks the same every load
  let seed = 20261102;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = a => a[Math.floor(rnd() * a.length)];

  // ---------------------------------------------------------------- baking a model into one vertex-coloured geometry
  const avgCol = new Map();
  function texColour(map) {
    if (avgCol.has(map)) return avgCol.get(map);
    let c = new THREE.Color(0x808080);
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d');
      g.drawImage(map.image, 0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; c = new THREE.Color(d[0] / 255, d[1] / 255, d[2] / 255);
    } catch (e) { /* not drawable */ }
    avgCol.set(map, c); return c;
  }
  function stripPeople(g) {
    const dead = []; g.traverse(o => { if (o.userData && o.userData.human) dead.push(o); });
    dead.forEach(o => o.parent && o.parent.remove(o));
  }
  function bake(g) {
    g.updateMatrixWorld(true);
    const pos = [], nor = [], col = [], c = new THREE.Color(), nm = new THREE.Matrix3();
    let sum = new THREE.Color(0, 0, 0), wsum = 0;
    g.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m.transparent && m.opacity < 0.45) return;
      c.copy(m.color || new THREE.Color(1, 1, 1));
      if (m.map && m.map.image) c.multiply(texColour(m.map));
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
        if (C) col.push(c.r * C.getX(i), c.g * C.getY(i), c.b * C.getZ(i)); else col.push(c.r, c.g, c.b);
      }
      // body colour estimate for the far proxy: big upper surfaces dominate
      if (m.color && !m.map && P.count > 60) { const w = P.count; sum.r += c.r * w; sum.g += c.g * w; sum.b += c.b * w; wsum += w; }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const proxy = wsum ? new THREE.Color(sum.r / wsum, sum.g / wsum, sum.b / wsum) : new THREE.Color(0x777777);
    return { geo, proxy };
  }
  // deep clone of a template model with its own materials, keeping wheels / head / tail references
  function cloneModel(t) {
    const src = [], dst = [];
    const g2 = t.g.clone(true);
    t.g.traverse(o => src.push(o)); g2.traverse(o => dst.push(o));
    dst.forEach(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
    const map = o => dst[src.indexOf(o)];
    const ud = t.userData || {}, steer = (t.steer || []).map(map);
    const userData = Object.assign({}, ud, { wheels: (ud.wheels || []).map(w => ({ mesh: map(w.mesh), radius: w.radius, front: w.front })),
      steer, fork: ud.fork ? map(ud.fork) : null, dims: ud.dims && { ...ud.dims }, center: ud.center && { ...ud.center } });
    return { g: g2, wheels: t.wheels.map(map), head: t.head.map(map), tail: t.tail.map(map), steer, len: t.len, kind: t.kind, type: t.type, seat: t.seat, userData };
  }

  // ---------------------------------------------------------------- state
  let game = null, world = null, scene = null;
  const variants = {};        // kind -> [{ tpl, geo, im, proxyCol }]
  let proxyIM = null;
  const items = [];           // { kind, vi, x, z, rot, hw, hl, col, handle, claimed }
  const occupied = [];        // [x, z, r] circles of everything placed (vehicles, lots)

  function overlaps(x, z, r) { for (const o of occupied) if (Math.hypot(o[0] - x, o[1] - z) < o[2] + r) return true; return false; }
  // footprint test: rectangle (hw, hl) at x, z, rot must avoid buildings, walls, other vehicles and (optionally) roads
  function fits(x, z, rot, hw, hl, allowRoad) {
    const fx = Math.sin(rot), fz = Math.cos(rot), rx = Math.cos(rot), rz = -Math.sin(rot);
    if (overlaps(x, z, Math.max(hw, hl) * 0.8)) return false;
    const tmp = { x: 0, z: 0 };
    for (const a of [-1, -0.5, 0, 0.5, 1]) for (const b of [-1, 0, 1]) {
      const px = x + fx * hl * a + rx * hw * b, pz = z + fz * hl * a + rz * hw * b;
      if (world.insideBuilding(px, pz, 0.3)) return false;
      tmp.x = px; tmp.z = pz; world.collide(tmp, 0.35); if (Math.hypot(tmp.x - px, tmp.z - pz) > 0.001) return false;
      if (!allowRoad && world.surfaceAt(px, pz) !== 'field') return false;
    }
    return true;
  }
  function addItem(kind, x, z, rot, opts) {
    opts = opts || {};
    const vi = opts.vi != null ? opts.vi : Math.floor(rnd() * variants[kind].length);
    const tpl = variants[kind][vi].tpl, hl = tpl.len / 2, hw = HW[kind];
    const it = { kind: pk(kind), vk: kind, vi, x, z, rot, hw, hl, handle: world.addCollider ? world.addCollider(x, z, hw, hl, rot) : null, where: opts.where || 'road' };
    items.push(it); occupied.push([x, z, Math.max(hw, hl) * 0.9]);
    return it;
  }
  function tryPlace(kind, x, z, rot, opts) {
    const tpl = variants[kind][0].tpl;
    if (!fits(x, z, rot, HW[kind] + 0.15, tpl.len / 2 + 0.15, opts && opts.allowRoad)) return null;
    return addItem(kind, x, z, rot, opts);
  }

  // ---------------------------------------------------------------- placement: homes
  function placeAtHomes(maxBikes, maxCars) {
    const B = world.buildings.slice();
    for (let i = B.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [B[i], B[j]] = [B[j], B[i]]; }
    let bikes = 0, cars = 0;
    for (const b of B) {
      if (bikes >= maxBikes && cars >= maxCars) break;
      if (b.paint) continue;                                  // civic buildings handled by lots
      const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length, cz = b.p.reduce((s, p) => s + p[1], 0) / b.p.length;
      const nr = world.nearestRoad(cx, cz, r => r.t !== 'highway'); if (!nr || nr.d > 28 || nr.d < 2) continue;
      const ux = (nr.x - cx) / nr.d, uz = (nr.z - cz) / nr.d;
      // walk from the centroid to the façade facing the road
      let t = 0; while (t < nr.d && world.insideBuilding(cx + ux * t, cz + uz * t, 0)) t += 0.25;
      const bb = b.bb || [0, 0, 0, 0], area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      const wantCar = area > 120 && cars < maxCars && rnd() < 0.55;
      if (!wantCar && bikes >= maxBikes) continue;
      if (!wantCar && rnd() < 0.35) continue;              // not every house has a bike out front
      const kind = wantCar ? pick(HOME_CARS) : pick(HOME_BIKES);
      const along = nr.ang, side = (rnd() - 0.5) * 3;
      let done = false;
      for (const gap of wantCar ? [1.6, 2.2, 2.8] : [0.9, 1.3, 1.8]) {
        const d = t + gap + HW[kind];
        const x = cx + ux * d + Math.sin(along) * side, z = cz + uz * d + Math.cos(along) * side;
        // keep off the carriageway: at least the road half-width from the road centre line
        const n2 = world.nearestRoad(x, z); if (n2 && n2.d < n2.r.w / 2 + HW[kind] + 0.3) break;
        const rot = wantCar ? along + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.12
                            : Math.atan2(-ux, -uz) + (rnd() - 0.5) * 0.5 + (rnd() < 0.3 ? Math.PI / 2 : 0);
        if (tryPlace(kind, x, z, rot, { where: 'home' })) { done = true; break; }
      }
      if (done) { if (wantCar) cars++; else bikes++; }
    }
    return { bikes, cars };
  }

  // ---------------------------------------------------------------- placement: along roads
  // line up `n` vehicles on the verge of the road nearest (x, z), starting at that point
  function lineUp(kind, x, z, n, spacing, filter, where) {
    const nr = world.nearestRoad(x, z, filter); if (!nr) return 0;
    const fx = Math.sin(nr.ang), fz = Math.cos(nr.ang), lx = Math.cos(nr.ang), lz = -Math.sin(nr.ang);
    const tpl = variants[kind][0].tpl;
    let placed = 0;
    for (const side of [1, -1]) for (let k = 0; k < n * 4 && placed < n; k++) {
      const s = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * spacing;
      const off = nr.r.w / 2 + HW[kind] + 0.5;
      const px = nr.x + fx * s + lx * off * side, pz = nr.z + fz * s + lz * off * side;
      const rot = nr.ang + (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.08;
      if (fits(px, pz, rot, HW[kind] + 0.1, tpl.len / 2 + 0.1, true) && world.surfaceAt(px, pz) === 'field') { addItem(kind, px, pz, rot, { where }); placed++; }
    }
    return placed;
  }
  // a free spot for a single vehicle near (x, z): rings of candidates
  function nearSpot(kind, x, z, rMax, where) {
    for (let r = 4; r < rMax; r += 3) for (let a = 0; a < 12; a++) {
      const an = a / 12 * Math.PI * 2 + r, px = x + Math.sin(an) * r, pz = z + Math.cos(an) * r;
      const nr = world.nearestRoad(px, pz); const rot = nr ? nr.ang + (rnd() < 0.5 ? 0 : Math.PI) : an;
      if (tryPlace(kind, px, pz, rot, { where })) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- safe house: an Innova-style MPV, a BLACK Fortuner-style 4x4, a Swift 2010,
  // the faired sports bike and one of each other bike
  // Just outside the safe-house gate, on free ground (never on the road, inside walls/buildings, or within 3.5 m of
  // the gate so the gate stays clear). Candidates must be farther from the house than the gate is (outside the
  // compound) and are tried on rings of growing radius around the gate; orientation follows the nearest road.
  const SAFE = { hx: 38.9, hz: -264.8, gx: 51.49, gz: -275.56 };
  function safeHouseParking() {
    const gateR = Math.hypot(SAFE.gx - SAFE.hx, SAFE.gz - SAFE.hz);
    const want = ['mpv', 'fortunerBlack', 'swift', 'faired', 'scooter', 'classic', 'classic2', 'sport', 'cycle', 'bike'];
    const placed = [];
    for (const kind of want) {
      const car = kind === 'mpv' || kind === 'fortunerBlack' || kind === 'swift';
      let ok = null;
      for (let r = car ? 5 : 4; r < 26 && !ok; r += 0.75) for (let a = 0; a < 24 && !ok; a++) {
        const an = a / 24 * Math.PI * 2, x = SAFE.gx + Math.sin(an) * r, z = SAFE.gz + Math.cos(an) * r;
        if (Math.hypot(x - SAFE.hx, z - SAFE.hz) < gateR + 1.5) continue;
        if (Math.hypot(x - SAFE.gx, z - SAFE.gz) < 3.5 + (car ? 2.4 : 1)) continue;
        const nr = world.nearestRoad(x, z);
        if (nr && nr.d < nr.r.w / 2 + HW[kind] + 0.4) continue;
        const rot = nr ? (car ? nr.ang + (a % 2 ? 0 : Math.PI) : nr.ang + Math.PI / 2 + (a % 2 ? 0 : Math.PI) + 0.25) : an;
        ok = tryPlace(kind, x, z, rot, { where: 'safehouse', vi: 0 });
      }
      if (ok) placed.push(kind + '@' + ok.x.toFixed(1) + ',' + ok.z.toFixed(1)); else console.warn('parked.js: no room by the safe house for', kind);
    }
    api.safeHouse = placed;
  }

  // ---------------------------------------------------------------- parking lots
  function lotTexture(L) {
    const PX = 22, w = Math.round(L.w * PX), h = Math.round(L.d * PX);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = L.surface === 'gravel' ? '#8f877a' : '#a3a097'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 30; i++) { const v = 120 + Math.random() * 90 | 0; g.fillStyle = `rgba(${v},${v},${v - 8},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(40,36,30,0.12)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 6 + Math.random() * 14, Math.random() * 3, 0, 7); g.fill(); }
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.14 * PX; g.strokeRect(0.12 * PX, 0.12 * PX, w - 0.24 * PX, h - 0.24 * PX);
    g.fillStyle = '#f4f4f0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    L.baysLocal.forEach((b, i) => {
      // bay outline (open towards the aisle), in canvas pixels; canvas x = local x, canvas y = local -z (top = back)
      const x0 = (b.x - L.bw / 2 + L.w / 2) * PX, x1 = (b.x + L.bw / 2 + L.w / 2) * PX;
      const zBack = b.z - b.dir * L.bd / 2, zFront = b.z + b.dir * L.bd / 2;
      const yB = (L.d / 2 - zBack) * PX, yF = (L.d / 2 - zFront) * PX;
      g.lineWidth = 0.12 * PX; g.beginPath();
      g.moveTo(x0, yF); g.lineTo(x0, yB); g.lineTo(x1, yB); g.lineTo(x1, yF); g.stroke();
      g.font = `bold ${0.7 * PX}px sans-serif`;
      g.save(); g.translate((x0 + x1) / 2, yF + (yB - yF) * 0.18); if (b.dir < 0) g.rotate(Math.PI); g.fillText(String(i + 1), 0, 0); g.restore();
    });
    // aisle arrows and a big painted P
    g.font = `bold ${2.2 * PX}px sans-serif`; g.fillStyle = 'rgba(244,244,240,0.85)';
    g.fillText('P', 1.6 * PX, (L.d / 2 - L.aisleZ) * PX);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function signBoard(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d');
    g.fillStyle = '#1565c0'; g.fillRect(0, 0, 256, 320); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(10, 10, 236, 300);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 190px sans-serif'; g.fillText('P', 128, 200);
    g.font = 'bold 26px sans-serif'; g.fillText(text.toUpperCase(), 128, 268, 220);
    return new THREE.CanvasTexture(c);
  }
  // rows: 1 = single row of bays off an aisle, 2 = two rows facing each other across an aisle
  function makeLot(name, nBays, rows, surface, aisle) {
    aisle = aisle || 6.0;
    const bw = 2.7, bd = 5.2, per = Math.ceil(nBays / rows);
    const w = per * bw + 1.2, d = rows * bd + aisle + 0.6;
    const baysLocal = [];
    for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
      // row 0 at the back (far from the road, local -z), nose pointing back; row 1 at the front
      const dir = r === 0 ? 1 : -1;     // +1: bay opens towards +z (the aisle)
      const z = r === 0 ? -d / 2 + 0.3 + bd / 2 : d / 2 - 0.3 - bd / 2;
      baysLocal.push({ x: -w / 2 + 0.6 + bw * (i + 0.5), z, dir });
    }
    const aisleZ = rows === 1 ? d / 2 - 0.3 - aisle / 2 : 0;
    return { name, w, d, bw, bd, rows, baysLocal, aisleZ, surface: surface || 'concrete' };
  }
  function lotFits(L, x, z, rot) {
    const fx = Math.sin(rot), fz = Math.cos(rot), rx = Math.cos(rot), rz = -Math.sin(rot), tmp = { x: 0, z: 0 };
    if (overlaps(x, z, Math.hypot(L.w, L.d) / 2)) return false;
    for (let a = -L.w / 2; a <= L.w / 2 + 0.01; a += L.w / Math.ceil(L.w / 2)) for (let b = -L.d / 2; b <= L.d / 2 + 0.01; b += L.d / Math.ceil(L.d / 2)) {
      const px = x + rx * a + fx * b, pz = z + rz * a + fz * b;
      if (world.surfaceAt(px, pz) !== 'field') return false;
      if (world.insideBuilding(px, pz, 0.6)) return false;
      tmp.x = px; tmp.z = pz; world.collide(tmp, 0.9); if (Math.hypot(tmp.x - px, tmp.z - pz) > 0.001) return false;
      for (const l of world.landmarks) { const R = { fuel: 19, temple: 14, tank: 7, busstop: 6, school: 5, hospital: 5, factory: 9 }[l.k] || 0; if (R && Math.hypot(l.x - px, l.z - pz) < R) return false; }
    }
    return true;
  }
  // slide along the road nearest (x0, z0) and drop the lot on its verge
  function siteLot(L, x0, z0, filter, maxSlide) {
    const nr = world.nearestRoad(x0, z0, filter); if (!nr) return null;
    const fx = Math.sin(nr.ang), fz = Math.cos(nr.ang);
    const toward = Math.sign((x0 - nr.x) * Math.cos(nr.ang) - (z0 - nr.z) * Math.sin(nr.ang)) || 1;
    for (let k = 0; k < (maxSlide || 90) / 3; k++) {
      const s = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3;
      for (const side of [toward, -toward]) for (const extra of [1.0, 2.5, 4.5, 8, 12]) {
        const lx = Math.cos(nr.ang) * side, lz = -Math.sin(nr.ang) * side;            // unit normal away from the road
        const off = nr.r.w / 2 + extra + L.d / 2;
        const x = nr.x + fx * s + lx * off, z = nr.z + fz * s + lz * off;
        const rot = Math.atan2(-lx, -lz);                                                 // local +z points at the road
        if (lotFits(L, x, z, rot)) return { x, z, rot };
      }
    }
    return null;
  }
  function buildLot(L, at, fillKinds) {
    const { x, z, rot } = at, fx = Math.sin(rot), fz = Math.cos(rot), rx = Math.cos(rot), rz = -Math.sin(rot);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.d), new THREE.MeshLambertMaterial({ map: lotTexture(L), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = rot; pad.position.set(x, 0.045, z); pad.receiveShadow = true; scene.add(pad);
    // kerb stones along the back edge
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(L.w, 0.18, 0.25), new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }));
    kerb.position.set(x - fx * (L.d / 2 - 0.12), 0.09, z - fz * (L.d / 2 - 0.12)); kerb.rotation.y = rot; kerb.receiveShadow = true; scene.add(kerb);
    // P sign at the road-side corner
    const sx = x + rx * (L.w / 2 - 0.3) + fx * (L.d / 2 - 0.3), sz = z + rz * (L.w / 2 - 0.3) + fz * (L.d / 2 - 0.3);
    const sg = new THREE.Group(); sg.position.set(sx, 0, sz); sg.rotation.y = rot;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), new THREE.MeshLambertMaterial({ color: 0x8a8f94 })); pole.position.y = 1.6; pole.castShadow = true; sg.add(pole);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), new THREE.MeshBasicMaterial({ map: signBoard(L.name) })); board.position.set(0, 3.0, 0.07); sg.add(board);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), new THREE.MeshLambertMaterial({ color: 0x8a8f94 })); back.position.set(0, 3.0, 0.05); back.rotation.y = Math.PI; sg.add(back);
    scene.add(sg); if (world.addCollider) world.addCollider(sx, sz, 0.15, 0.15, 0);
    occupied.push([x, z, Math.hypot(L.w, L.d) / 2]);
    world.addMapIcon && world.addMapIcon(x, z, 'P', L.name);
    // bays in world space; fill about half
    const lot = { name: L.name, x, z, rot, bays: [] };
    // vehicles go in after the lot circle is registered, so the occupancy test must ignore the lot itself
    const lotCircle = occupied.pop();
    L.baysLocal.forEach((b, bi) => {
      const bx = x + rx * b.x + fx * b.z, bz = z + rz * b.x + fz * b.z;
      const brot = rot + (b.dir > 0 ? Math.PI : 0);      // nose into the bay (towards its back line)
      const bay = { x: bx, z: bz, rot: brot, taken: false };
      if ((bi % 2 === 0) !== (rnd() < 0.2)) {
        const kind = pick(fillKinds);
        const it = addItem(kind, bx + (rnd() - 0.5) * 0.2, bz + (rnd() - 0.5) * 0.2, brot + (rnd() - 0.5) * 0.06, { where: 'lot' });
        it.bay = bay; bay.taken = true;
      }
      lot.bays.push(bay);
    });
    occupied.push(lotCircle);
    api.lots.push(lot);
    return lot;
  }

  // ---------------------------------------------------------------- auto stand
  // Autos wait in one neat row on the NH shoulder next to the bus stop shelter, angled 60 degrees to the kerb
  // (nose out towards the carriageway), on the bus stop's own side of the road. Only shoulder space is used:
  // every auto must clear the carriageway edge, buildings, walls and the shelter. Registered as a lot so the
  // map shows it and player/property code sees its bays.
  function autoStand(stop) {
    if (!stop || !stop.x) return null;
    const nr = world.nearestRoad(stop.x, stop.z, r => r.t === 'highway'); if (!nr) return null;
    const fx = Math.sin(nr.ang), fz = Math.cos(nr.ang);
    const side = Math.sign((stop.x - nr.x) * Math.cos(nr.ang) - (stop.z - nr.z) * Math.sin(nr.ang)) || 1;
    const lx = Math.cos(nr.ang) * side, lz = -Math.sin(nr.ang) * side;          // unit normal, road -> stop side
    const tpl = variants.auto[0].tpl, hl = tpl.len / 2, hw = HW.auto, A = Math.PI / 3;
    const depth = hl * Math.sin(A) + hw * Math.cos(A);                          // half-extent across the kerb
    const off = nr.r.w / 2 + 0.6 + depth;                                        // inner corner 0.6 m off the edge
    // which way along the road has room: start past the shelter (half width 3.5 m + gap) on each side
    const lot = { name: 'Auto Stand', x: 0, z: 0, rot: 0, bays: [] };
    let best = null;
    for (const dir of [1, -1]) {
      const bays = [];
      for (let k = 0; k < 14 && bays.length < 7; k++) {
        const s = dir * (6.0 + k * 2.1);
        const x = nr.x + fx * s + lx * off, z = nr.z + fz * s + lz * off;
        // nose points out towards the road and in the direction of travel on that side
        const rot = Math.atan2(-lx, -lz) + dir * side * (Math.PI / 2 - A);
        const ok = fits(x, z, rot, hw + 0.05, hl + 0.05, true) && world.surfaceAt(x, z) === 'field';
        const n2 = world.nearestRoad(x, z);
        if (!ok || (n2 && n2.d < n2.r.w / 2 + hw)) { if (bays.length) break; continue; }
        bays.push({ x, z, rot });
        occupied.push([x, z, 0.9]);                       // reserve while testing the next one
      }
      for (let i = 0; i < bays.length; i++) occupied.pop();
      if (!best || bays.length > best.length) best = bays;
    }
    if (!best || !best.length) { console.warn('parked.js: no room for the auto stand'); return null; }
    best.forEach((b, i) => {
      const bay = { x: b.x, z: b.z, rot: b.rot, taken: false };
      if (i < best.length - 1 || best.length < 3) {        // leave the last slot free for the player
        const it = addItem('auto', b.x, b.z, b.rot, { where: 'autostand' }); it.bay = bay; bay.taken = true;
      }
      lot.bays.push(bay);
    });
    lot.x = best.reduce((s, b) => s + b.x, 0) / best.length; lot.z = best.reduce((s, b) => s + b.z, 0) / best.length;
    lot.rot = Math.atan2(-lx, -lz);
    world.addMapIcon && world.addMapIcon(lot.x, lot.z, 'P', 'Auto Stand');
    api.lots.push(lot);
    return lot;
  }

  // ---------------------------------------------------------------- instancing / LOD
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
  function buildMeshes() {
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 50, specular: 0x333333, side: THREE.DoubleSide });
    for (const k of KINDS) for (const vr of variants[k]) {
      const n = items.filter(it => it.vk === k && variants[k][it.vi] === vr).length;
      vr.im = new THREE.InstancedMesh(vr.geo, mat, Math.max(1, n)); vr.im.count = 0; vr.im.castShadow = true; vr.im.receiveShadow = true;
      vr.im.frustumCulled = false; vr.im.name = 'parked-' + k; scene.add(vr.im);
    }
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    proxyIM = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), Math.max(1, items.length));
    proxyIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3);
    proxyIM.count = 0; proxyIM.frustumCulled = false; proxyIM.name = 'parked-far'; scene.add(proxyIM);
  }
  const PROXY_H = { bike: 1.1, scooter: 1.1, classic: 1.15, classic2: 1.1, sport: 1.15, faired: 1.15, cycle: 1.05, mpv: 1.8, fortuner: 1.84, fortunerBlack: 1.84,
    swift: 1.52, dzire: 1.52, alto: 1.45, bolero: 1.9, scorpio: 2.0, ace: 1.86, auto: 1.75, hatch: 1.45, suv: 1.75, tractor: 2.2, lorry: 3.2, bus: 3.1, bullockCart: 1.8 };
  function refreshInstances() {
    const cam = game.camera.position;
    for (const k of KINDS) for (const vr of variants[k]) vr.im.count = 0;
    proxyIM.count = 0;
    for (const it of items) {
      if (it.claimed) continue;
      const d = Math.hypot(it.x - cam.x, it.z - cam.z);
      if (d > FAR) continue;
      q.setFromAxisAngle(yAxis, it.rot);
      const vr = variants[it.vk][it.vi];
      if (d < NEAR) { m4.compose(v3.set(it.x, 0, it.z), q, sc.set(1, 1, 1)); vr.im.setMatrixAt(vr.im.count++, m4); }
      else {
        const i = proxyIM.count++;
        m4.compose(v3.set(it.x, 0.08, it.z), q, sc.set(it.hw * 1.9, PROXY_H[it.vk], it.hl * 1.9)); proxyIM.setMatrixAt(i, m4);
        proxyIM.setColorAt(i, vr.proxy);
      }
    }
    for (const k of KINDS) for (const vr of variants[k]) vr.im.instanceMatrix.needsUpdate = true;
    proxyIM.instanceMatrix.needsUpdate = true; if (proxyIM.instanceColor) proxyIM.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- get in: hand the vehicle to player.js through `traffic`
  function axisDist(x, z, it) {
    const fx = Math.sin(it.rot), fz = Math.cos(it.rot), half = Math.max(0, it.hl - it.hw);
    const t = THREE.MathUtils.clamp((x - it.x) * fx + (z - it.z) * fz, -half, half);
    return Math.hypot(x - it.x - fx * t, z - it.z - fz * t) - it.hw;
  }
  function claimNearest(g) {
    const p = g.carPos;
    let best = null;
    for (const it of items) { if (it.claimed) continue; if (Math.abs(it.x - p.x) > 12 || Math.abs(it.z - p.z) > 12) continue;
      const d = axisDist(p.x, p.z, it); if (d < 3 && (!best || d < best.d)) best = { it, d }; }
    if (!best) return;
    const it = best.it, model = cloneModel(variants[it.vk][it.vi].tpl);
    model.g.position.set(it.x, 0, it.z); model.g.rotation.y = it.rot; scene.add(model.g);
    const t = { ...model, model: it.kind, type: it.vk, parked: true, len2: model.len / 2, r: null, speed: 0, cur: 0, s: 0, dir: 1, len: 0, hw: it.hw, wheelR: 0.4 };
    g.traffic.push(t);
    it.claimed = true; refreshInstances();
    // player.js runs right after this hook in the same keydown; if it took something else, undo
    queueMicrotask(() => {
      const i = g.traffic.indexOf(t);
      if (i >= 0) { g.traffic.splice(i, 1); scene.remove(model.g); it.claimed = false; refreshInstances(); return; }
      // taken: the collider leaves with it, the bay frees up
      if (world.removeCollider) world.removeCollider(it.handle);
      const k = occupied.findIndex(o => o[0] === it.x && o[1] === it.z); if (k >= 0) occupied.splice(k, 1);
      if (it.bay) it.bay.taken = false;
      items.splice(items.indexOf(it), 1); api.count = items.length;
    });
  }

  // ---------------------------------------------------------------- init
  function init(g) {
    game = g; world = g.world; scene = g.scene;
    if (!world.nearestRoad || !world.insideBuilding) { console.warn('parked.js: world API missing'); return; }
    for (const k of KINDS) {
      variants[k] = [];
      for (let i = 0; i < VARIANTS[k]; i++) {
        const tpl = k === 'bike' ? TrafficModels.bike('splendor') : TrafficModels[k](); stripPeople(tpl.g);
        tpl.head.forEach(m => m.material.color && m.material.color.setHex(0x8a8a80));
        const b = bake(tpl.g); variants[k].push({ tpl, geo: b.geo, proxy: b.proxy });
      }
    }
    const LM = (k, name) => world.landmarks.find(l => l.k === k && (!name || l.name.startsWith(name)));
    const junction = LM('busstop') || { x: 0, z: 0 };

    // Parking follows the real layout (Esri z18 imagery): no lot invents paved space over fields, plots or
    // houses. Only two small lots sit on ground that is open in the imagery, and the autos line the NH verge.
    //  - ZPSS School: the bare playground inside the school compound (mosaic px ~2480-2515, 2368-2390),
    //    its long axis runs WNW-ESE, so the bay row is laid along it.
    //  - Govt Hospital: a 4-bay row on open ground right beside the hospital, only if it fits within 25 m.
    const LOTS = [
      { name: 'ZPSS School', at: { x: -31.5, z: 43.5, rot: -0.452 }, n: 4, aisle: 4.5, kinds: ['bike', 'bike', 'bike', 'auto'] },
      { name: 'Govt Hospital', near: LM('hospital'), n: 4, aisle: 5.0, kinds: ['hatch', 'auto', 'bike', 'bike'], slide: 25 },
    ];
    for (const D of LOTS) {
      let done = false;
      for (const nn of [D.n, D.n - 1, 3]) {
        const L = makeLot(D.name, nn, 1, 'concrete', D.aisle);
        if (D.at) {
          // nudge around the measured spot (never more than 4 m), keeping the measured orientation
          for (const [dx, dz] of [[0, 0], [1.5, 0.7], [-1.5, -0.7], [3, 1.4], [0.7, -1.5], [-0.7, 1.5], [3.7, -0.1]]) {
            if (lotFits(L, D.at.x + dx, D.at.z + dz, D.at.rot)) { buildLot(L, { x: D.at.x + dx, z: D.at.z + dz, rot: D.at.rot }, D.kinds); done = true; break; }
          }
        } else if (D.near) {
          const at = siteLot(L, D.near.x, D.near.z, r => r.t !== 'dirt' && r.t !== 'highway', D.slide);
          if (at && Math.hypot(at.x - D.near.x, at.z - D.near.z) < D.slide + 8) { buildLot(L, at, D.kinds); done = true; }
        }
        if (done) break;
      }
      if (!done) console.warn('parked.js: no room for lot', D.name);
    }
    autoStand(junction);
    // one bus pulled over at the stop
    lineUp('bus', junction.x, junction.z, 1, 12, r => r.t === 'highway', 'busstop');
    const fac = LM('factory'); if (fac) { for (let i = 0; i < 4; i++) nearSpot('lorry', fac.x, fac.z, 70, 'factory'); }
    // tractors (with trolleys) and carts where the village meets the fields
    const edgeRoads = world.roads.filter(r => r.t === 'dirt' && r.p.length >= 2);
    let tractors = 0, carts = 0, guard = 0;
    while ((tractors < 8 || carts < 3) && guard++ < 300) {
      const r = pick(edgeRoads), p = pick(r.p), d = Math.hypot(p[0] - junction.x, p[1] - junction.z);
      if (d < 250 || d > 1100) continue;
      if (tractors < 8) tractors += lineUp('tractor', p[0], p[1], 1, 8, rr => rr === r, 'field');
      else carts += lineUp('bullockCart', p[0], p[1], 1, 6, rr => rr === r, 'field');
    }
    safeHouseParking();
    // homes: bikes at doors and gates, cars at the bigger houses (all two-wheeler types mixed in)
    const target = 200 - items.length;
    placeAtHomes(Math.round(target * 0.74), Math.round(target * 0.26));
    api.count = items.length;
    api.vehicles = items;
    buildMeshes(); refreshInstances();
    console.log('parked.js:', items.length, 'parked vehicles,', api.lots.length, 'lots');
  }

  let acc = 0, lastX = 1e9, lastZ = 1e9;
  GameHooks.init.push(init);
  GameHooks.update.push((dt, g) => {
    if (!proxyIM) return;
    acc += dt; const c = g.camera.position;
    if (acc > 0.4 || Math.abs(c.x - lastX) + Math.abs(c.z - lastZ) > 25) { acc = 0; lastX = c.x; lastZ = c.z; refreshInstances(); }
  });
  GameHooks.key.push((e, g) => {
    if (e.code === 'KeyF' && !e.repeat && g.playerMode === 'foot' && proxyIM) claimNearest(g);
    return false;          // never consume: player.js does the actual get-in
  });
  return api;
})();
window.Parked = Parked;
