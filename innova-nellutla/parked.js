// parked.js: parked vehicles at homes / along roads, and marked parking lots with numbered bays.
// Parked vehicles are drawn as instanced, baked meshes (one draw call per colour variant), with a
// box proxy for the far range. When the player presses F on foot near one, a real TrafficModels
// vehicle replaces the instance and is handed to player.js through the global `traffic` array.
// Exposes window.Parked = { lots: [{ name, x, z, rot, bays: [{ x, z, rot, taken }] }], vehicles, count, layout() }.
const Parked = (function () {
  const api = { lots: [], vehicles: [], count: 0 };
  // Variant kinds (it.vk) pick the TrafficModels builder; the kind handed to player.js (it.kind / t.model) is what its
  // PARAMS / SEATS know: every two-wheeler drives as 'bike', the Innova-style MPV and Fortuner-style 4x4 as 'suv'.
  const KINDS = ['bike', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'hatch', 'suv', 'activa', 'starCity', 'swift', 'swiftNew', 'dzire', 'alto', 'bolero', 'scorpio', 'scorpioN', 'safari', 'sumo', 'ace', 'mpv', 'fortuner', 'fortunerBlack', 'crysta', 'wagonR', 'innova', 'landCruiser', 'defender', 'gclass', 'tharRoxx', 'thar', 'hector', 'hayabusa', 's1000rr', 'r1250gsa', 'r1300gsa', 'berlinetta', 'muscle', 'wedge', 'coupe911', 'auto', 'tractor', 'lorry', 'bus', 'bullockCart'];
  const VARIANTS = { defender: 1, gclass: 1, thar: 2, hector: 2, wagonR: 2, innova: 1, landCruiser: 1, tharRoxx: 2, hayabusa: 1, s1000rr: 1, r1250gsa: 1, r1300gsa: 1, activa: 2, starCity: 2, swiftNew: 2, scorpioN: 2, safari: 2, sumo: 2, bike: 3, scooter: 3, classic: 2, classic2: 2, sport: 2, faired: 2, cycle: 2, hatch: 1, suv: 1, swift: 3, dzire: 2, alto: 3, bolero: 2, scorpio: 2, ace: 1, mpv: 1, fortuner: 1, fortunerBlack: 1, crysta: 1, berlinetta: 1, muscle: 1, wedge: 1, coupe911: 1, auto: 3, tractor: 2, lorry: 2, bus: 1, bullockCart: 1 };
  const HW = { defender: 1.0, gclass: 0.99, thar: 0.91, hector: 0.92, wagonR: 0.81, innova: 0.88, landCruiser: 0.99, tharRoxx: 0.94, hayabusa: 0.42, s1000rr: 0.42, r1250gsa: 0.5, r1300gsa: 0.5, activa: 0.36, starCity: 0.38, swiftNew: 0.88, scorpioN: 0.98, safari: 1.0, sumo: 0.87, bike: 0.45, scooter: 0.42, classic: 0.45, classic2: 0.45, sport: 0.45, faired: 0.42, cycle: 0.38, auto: 0.75, hatch: 0.85, suv: 0.95, swift: 0.86, dzire: 0.88, alto: 0.76, bolero: 0.92, scorpio: 0.98, ace: 0.8, mpv: 0.95, fortuner: 0.98, fortunerBlack: 0.98, crysta: 0.95, berlinetta: 1.0, muscle: 0.97, wedge: 0.99, coupe911: 0.93, tractor: 1.0, lorry: 1.2, bus: 1.3, bullockCart: 0.9 };
  const PLAYER_KIND = { defender: 'suv', gclass: 'suv', thar: 'suv', hector: 'suv', wagonR: 'hatch', innova: 'suv', landCruiser: 'suv', tharRoxx: 'suv', hayabusa: 'bike', s1000rr: 'bike', r1250gsa: 'bike', r1300gsa: 'bike', activa: 'bike', starCity: 'bike', swiftNew: 'hatch', scorpioN: 'suv', safari: 'suv', sumo: 'suv', scooter: 'bike', classic: 'bike', classic2: 'bike', sport: 'bike', faired: 'bike', cycle: 'bike', mpv: 'suv', fortuner: 'suv', fortunerBlack: 'suv', crysta: 'suv',
    // sports cars: the player kind is the engine-audio.js voice key (PARAMS come from userData.type)
    berlinetta: 'ferrari', muscle: 'muscle', wedge: 'lambo', coupe911: 'porsche',
    swift: 'hatch', dzire: 'hatch', alto: 'hatch', bolero: 'suv', scorpio: 'suv', ace: 'suv' };
  const pk = vk => PLAYER_KIND[vk] || vk;
  // big bikes are rare finds in a village: about 1 in 20
  const HOME_BIKES = ['bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle', 'bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle', 'bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle', 'bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle', 'bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle', 'bike', 'starCity', 'starCity', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'cycle'];
  const HOME_CARS = ['swift', 'swiftNew', 'alto', 'alto', 'alto', 'wagonR', 'wagonR', 'wagonR', 'innova', 'innova', 'tharRoxx', 'thar', 'hector', 'fortuner', 'landCruiser', 'dzire', 'bolero', 'sumo', 'safari', 'scorpio', 'scorpioN', 'ace', 'mpv'];
  const NEAR = 130, FAR = ({ efficient: 240, low: 300, medium: 380 }[window.Quality && Quality.level]) || 520;       // full detail inside NEAR, box proxy inside FAR, nothing beyond

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
    const gp = [], gn = []; let gMat = null;     // interior-mapped glass stays a separate instanced mesh, drawn near only
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
      if (m.userData && m.userData.interior) { gMat = m; for (let i = 0; i < P.count; i++) { gp.push(P.getX(i), P.getY(i), P.getZ(i)); gn.push(N.getX(i), N.getY(i), N.getZ(i)); } }
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
    let glass = null; if (gMat) { glass = new THREE.BufferGeometry(); glass.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); glass.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3)); glass.computeBoundingSphere(); }
    return { geo, proxy, glass, gMat };
  }
  // deep clone of a template model with its own materials, keeping wheels / head / tail references
  function cloneModel(t) {
    const src = [], dst = [];
    const g2 = t.g.clone(true);
    t.g.traverse(o => src.push(o)); g2.traverse(o => dst.push(o));
    dst.forEach(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
    const map = o => dst[src.indexOf(o)];
    const mp = p => p ? { ...p, mesh: map(p.mesh), ap: p.ap ? map(p.ap) : undefined } : null;
    const ud = t.userData || {}, steer = (t.steer || []).map(map);
    const userData = Object.assign({}, ud, { wheels: (ud.wheels || []).map(w => ({ mesh: map(w.mesh), radius: w.radius, front: w.front })),
      steer, fork: ud.fork ? map(ud.fork) : null, doors: (ud.doors || []).map(mp), hood: mp(ud.hood), boot: mp(ud.boot), sunroof: mp(ud.sunroof), top: mp(ud.top), dims: ud.dims && { ...ud.dims }, center: ud.center && { ...ud.center } });
    return { g: g2, trailer: t.trailer ? map(t.trailer) : undefined, wheels: t.wheels.map(map), head: t.head.map(map), tail: t.tail.map(map), steer, len: t.len, kind: t.kind, type: t.type, seat: t.seat, userData };
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
    const it = { kind: pk(kind), vk: kind, vi, x, z, y: typeof groundY === 'function' ? groundY(x, z) : 0, rot, hw, hl, handle: world.addCollider ? world.addCollider(x, z, hw, hl, rot) : null, where: opts.where || 'road' };
    items.push(it); occupied.push([x, z, Math.max(hw, hl) * 0.9]);
    return it;
  }
  function tryPlace(kind, x, z, rot, opts) {
    const tpl = variants[kind][0].tpl;
    if (world.landAt && [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].some(o => world.landAt(x + o[0], z + o[1]) > 0.02)) return null;   // nothing parks on the raised land
    if (!fits(x, z, rot, HW[kind] + 0.15, tpl.len / 2 + 0.15, opts && opts.allowRoad)) return null;
    return addItem(kind, x, z, rot, opts);
  }

  // ---------------------------------------------------------------- placement: straight rows along the road edge
  // Interim layout until the user gives fixed positions (fill FIXED_SPOTS below and it replaces all of this).
  // Every vehicle is aligned exactly with its straight stretch of road, on the kerb line. A car straddles the edge,
  // inner tyres on the paved edge and outer tyres on the flat shoulder: traffic lanes (off = min(2.2, w/4) from the centre)
  // stay clear, since none of these roads is wide enough to hold a lane and a car wholly on the tarmac. Two-wheelers
  // are narrow enough to stand wholly on the edge of the road. Nothing goes on a hump, a bund or the raised land,
  // near a junction, or across a gate.
  const FIXED_SPOTS = [];   // [{ kind, x, z, rot, where? }]
  const SAFE = { gx: 51.49, gz: -275.56 };
  const ROWS = { stretches: null };
  // straight stretches: runs of a road's polyline within 2 degrees of the first segment's bearing
  function stretches(minLen) {
    const out = [];
    for (const r of world.roads) {
      const P = r.p; let i = 0;
      while (i < P.length - 1) {
        const ang = Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); let j = i + 1;
        while (j < P.length - 1) { const a2 = Math.atan2(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]), d = Math.atan2(Math.sin(a2 - ang), Math.cos(a2 - ang)); if (Math.abs(d) > 0.035) break; j++; }
        const ax = P[i][0], az = P[i][1], bx = P[j][0], bz = P[j][1], L = Math.hypot(bx - ax, bz - az), bear = Math.atan2(bx - ax, bz - az);
        if (L >= minLen) out.push({ r, x: ax, z: az, ang: bear, L, used: {} });
        i = j;
      }
    }
    return out;
  }
  const isBike = k => HW[k] < 0.55;
  // a spot on the kerb line is good when the body is clear of everything solid, level, and away from side roads
  function kerbOK(st, kind, x, z, rot, hw, hl) {
    if (!fits(x, z, rot, hw + 0.05, hl + 0.05, true)) return false;
    if (world.nearestRoad(x, z, q => q !== st.r && q.t !== 'dirt' && Math.abs(Math.sin(q.p && q.p[1] ? Math.atan2(q.p[1][0] - q.p[0][0], q.p[1][1] - q.p[0][1]) - st.ang : 0)) > 0.3)) {
      const o = world.nearestRoad(x, z, q => q !== st.r); if (o && o.d < o.r.w / 2 + hl + 1.2 && Math.abs(Math.sin(o.ang - st.ang)) > 0.3) return false;
    }
    if (ROWS.clearHouse && !isBike(kind) && Math.hypot(x - 45, z + 270) < 125) return false;   // one of each car model near the house: residents park further out
    if (Math.hypot(x - SAFE.gx, z - SAFE.gz) < 6.5) return false;                   // the safe-house gate stays clear
    const fx = Math.sin(rot), fz = Math.cos(rot), rx = Math.cos(rot), rz = -Math.sin(rot);
    if (world.dipAt) for (const a of [-1, -0.5, 0, 0.5, 1]) for (const b of [-1, -0.5, 0, 0.5, 1]) if (world.dipAt(x + fx * hl * a + rx * hw * b, z + fz * hl * a + rz * hw * b) < -0.005) return false;   // nothing parks on the channel
    for (const a of [-1, 0, 1]) for (const b of [-1, 1]) {
      const px = x + fx * hl * a + rx * hw * b, pz = z + fz * hl * a + rz * hw * b;
      if ((world.landAt && world.landAt(px, pz) > 0.02) || (world.humpAt && world.humpAt(px, pz) > 0.005) || (world.dipAt && world.dipAt(px, pz) < -0.005) || (world.bundAt && world.bundAt(px, pz) > 0.02) || (world.undAt && Math.abs(world.undAt(px, pz)) > 0.02)) return false;
      if (world.surfaceAt(px, pz) === 'river') return false;
    }
    return true;
  }
  // lay `kinds` nose to tail from distance s0 along the stretch, keep-left: the row faces the way traffic runs on that side
  function fillRow(st, side, s0, kinds, where, gap) {
    const fx = Math.sin(st.ang), fz = Math.cos(st.ang), lx = Math.cos(st.ang), lz = -Math.sin(st.ang);
    const rot = st.ang + (side > 0 ? 0 : Math.PI), bike = isBike(kinds[0]);
    const off = bike ? st.r.w / 2 - 0.5 : st.r.w / 2;           // one centre line per row, so the row is dead straight
    let s = s0, placed = 0; const got = [];
    for (const kind of kinds) {
      const hl = variants[kind][0].tpl.len / 2, hw = HW[kind];
      for (; s + hl * 2 < st.L - 3; s += 1) {
        const c = s + hl, x = st.x + fx * c + lx * off * side, z = st.z + fz * c + lz * off * side;
        if (s > 2 && !(st.r.drainRoad && side < 0 && x > 32.5 && x < 53) && kerbOK(st, kind, x, z, rot, hw, hl)) { const it = addItem(kind, x, z, rot, { where, vi: placed % VARIANTS[kind] }); got.push(it); s += hl * 2 + (gap || 1.1); placed++; break; }
      }
    }
    st.used[side] = Math.max(st.used[side] || 0, s + 8);
    return got;
  }
  // best row site for a list near (x, z): tries the nearest stretches, both sides; keeps the fullest row
  function rowNear(x, z, kinds, where, filter, sideFirst) {
    const list = ROWS.stretches.filter(st => !filter || filter(st.r)).map(st => {
      const t = THREE.MathUtils.clamp((x - st.x) * Math.sin(st.ang) + (z - st.z) * Math.cos(st.ang), 0, st.L);
      return { st, t, d: Math.hypot(st.x + Math.sin(st.ang) * t - x, st.z + Math.cos(st.ang) * t - z) };
    }).sort((a, b) => a.d - b.d).slice(0, 8);
    let left = kinds.slice(); const got = [];
    for (const q of list) for (const side of sideFirst ? [sideFirst, -sideFirst] : [1, -1]) {
      if (!left.length) break;
      const from = Math.max(q.st.used[side] || 0, Math.max(0, q.t - 12));
      const it = fillRow(q.st, side, from, left, where); it.forEach(i => { got.push(i); left.splice(left.indexOf(i.vk), 1); });
    }
    return got;
  }
  // the village: rows of up to six, cars on one stretch and bikes on the next, working outwards from the junction
  function villageRows(junction, cars, bikes) {
    ROWS.clearHouse = true;
    const near = ROWS.stretches.filter(st => st.r.t !== 'dirt' && st.r.t !== 'lane').map(st => ({ st, d: Math.hypot(st.x + Math.sin(st.ang) * st.L / 2 - junction.x, st.z + Math.cos(st.ang) * st.L / 2 - junction.z) })).filter(q => q.d < 1000).sort((a, b) => a.d - b.d);
    const lanes = ROWS.stretches.filter(st => st.r.t === 'lane');
    for (let pass = 0; pass < 4 && (cars.length || bikes.length); pass++) for (const { st } of near) {
      for (const side of [1, -1]) {
        const s0 = st.used[side] || 6 + pass * 3; if (s0 + 14 > st.L) continue;
        const bikesHere = !cars.length || (bikes.length && (Math.round(st.x + st.z) + side + pass) % 3 === 0), src = bikesHere ? bikes : cars;
        if (!src.length) continue;
        const row = src.slice(0, 6), got = fillRow(st, side, s0, row, 'road');
        got.forEach(i => src.splice(src.indexOf(i.vk), 1));
        st.used[side] = (st.used[side] || 0) + 22;
      }
    }
    for (const st of lanes) { if (!bikes.length) break; const got = fillRow(st, 1, st.used[1] || 4, bikes.slice(0, 4), 'road'); got.forEach(i => bikes.splice(bikes.indexOf(i.vk), 1)); }
  }
  function safeHouseRow() {
    // six cars side by side on the level tops of the two raised plots beside the mud lane, noses to the lane; each spot is checked level.
    // Two-wheelers live in the yard (safehouse2.js); the Innova is only the player's own car. The other models go to the south road.
    // one each near the house, on the south road edge east of it; every other free car goes out into the village, singly or in twos, far apart
    const got = []; let home = ['landCruiser', 'safari', 'scorpio', 'swift', 'thar', 'ace'];
    let free = ['hector', 'fortuner', 'defender', 'gclass', 'tharRoxx', 'berlinetta', 'swiftNew', 'dzire', 'alto', 'wagonR', 'mpv', 'bolero', 'scorpioN', 'sumo', 'muscle', 'wedge', 'coupe911'];
    for (const st of ROWS.stretches.filter(q => q.r.drainRoad && q.x > 50 && q.x < 115).sort((p, q) => p.x - q.x)) { if (!home.length) break; const row = fillRow(st, -1, 2, home, 'free', 1.1); got.push(...row); home = home.filter(k => !row.some(i => i.vk === k)); }
    // what the south edge could not hold takes the nearest other road, still by the house
    for (const q of ROWS.stretches.filter(st => !st.r.drainRoad && st.r.n !== 'east_ns3' && st.r.n !== 'heap_ns' && st.r.t !== 'dirt').map(st => { const t = THREE.MathUtils.clamp((45 - st.x) * Math.sin(st.ang) + (-262 - st.z) * Math.cos(st.ang), 0, st.L); return { st, t, d: Math.hypot(st.x + Math.sin(st.ang) * t - 45, st.z + Math.cos(st.ang) * t + 262) }; }).sort((p, q) => p.d - q.d)) { if (!home.length || q.d > 90) break; const row = fillRow(q.st, -1, Math.max(2, q.t - 20), home, 'free', 1.1); got.push(...row); home = home.filter(k => !row.some(i => i.vk === k)); }
    if (home.length) console.warn('parked.js: no room near the house for', home.join(','));
    const hx = 45, hz = -262, mid = st => [st.x + Math.sin(st.ang) * st.L / 2, st.z + Math.cos(st.ang) * st.L / 2], mine = [];
    const sites = ROWS.stretches.filter(st => st.r.t !== 'highway' && st.r.t !== 'dirt' && st.r.n !== 'heap_ns' && !st.r.drainRoad && st.L >= 22).map(st => ({ st, m: mid(st), d: Math.hypot(mid(st)[0] - hx, mid(st)[1] - hz) })).filter(q => q.d > 135 && q.d < 480).sort((p, q) => (p.m[0] * 7.3 + p.m[1] * 3.1) % 97 - (q.m[0] * 7.3 + q.m[1] * 3.1) % 97);
    ROWS.clearHouse = true;
    for (let i = 0; i < sites.length && free.length; i++) { const q = sites[i]; if (mine.some(m => Math.hypot(m[0] - q.m[0], m[1] - q.m[1]) < 70)) continue;
      const take = free.slice(0, mine.length % 3 === 2 ? 2 : 1), row = fillRow(q.st, q.st.r.w >= 6 && i % 2 ? 1 : -1, Math.max(3, q.st.L * 0.35), take, 'scatter', 3 + i % 4); if (!row.length) continue;
      got.push(...row); mine.push(q.m); free = free.filter(k => !row.some(c => c.vk === k)); }
    ROWS.clearHouse = false;
    if (free.length) console.warn('parked.js: no room for', free.join(','));
    api.safeHouse = got.map(it => it.vk + '@' + it.x.toFixed(1) + ',' + it.z.toFixed(1));
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
      if (fillKinds && fillKinds.length && (bi % 2 === 0) !== (rnd() < 0.2)) {
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
  // Autos wait nose to tail on the NH kerb line by the bus stop. Registered as a lot so the map shows it and
  // auto-rides.js / properties.js see its bays; the last bay stays free for the player.
  function autoStand(stop) {
    if (!stop || !stop.x) return null;
    const got = rowNear(stop.x + 6, stop.z + 6, Array(6).fill('auto'), 'autostand', r => r.t === 'highway');
    if (!got.length) { console.warn('parked.js: no room for the auto stand'); return null; }
    const lot = { name: 'Auto Stand', x: 0, z: 0, rot: got[0].rot, bays: [] };
    got.forEach(it => { const bay = { x: it.x, z: it.z, rot: it.rot, taken: true }; it.bay = bay; lot.bays.push(bay); });
    const a = got[got.length - 1], b = got[Math.max(0, got.length - 2)], ex = 2 * a.x - b.x, ez = 2 * a.z - b.z;
    lot.bays.push({ x: ex, z: ez, rot: a.rot, taken: false });
    lot.x = got.reduce((s, b2) => s + b2.x, 0) / got.length; lot.z = got.reduce((s, b2) => s + b2.z, 0) / got.length;
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
      vr.im = new THREE.InstancedMesh(boundsGeo(vr.geo), mat, Math.max(1, n)); vr.im.count = 0; vr.im.castShadow = true; vr.im.receiveShadow = true;
      vr.im.frustumCulled = true; vr.im.name = 'parked-' + k; scene.add(vr.im);
      if (vr.glass) { vr.gim = new THREE.InstancedMesh(boundsGeo(vr.glass), vr.gMat, Math.max(1, n)); vr.gim.count = 0; vr.gim.name = 'parked-glass-' + k; scene.add(vr.gim); }
    }
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    proxyIM = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), Math.max(1, items.length));
    proxyIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3);
    proxyIM.geometry = boundsGeo(box); proxyIM.count = 0; proxyIM.frustumCulled = true; proxyIM.name = 'parked-far'; scene.add(proxyIM);
  }
  // each InstancedMesh gets its own geometry wrapper (shared GPU buffers) whose bounding sphere is refitted to the
  // live instances in refreshInstances(), so camera / shadow frustum culling works (r128 culls by the base sphere)
  function boundsGeo(base) {
    const g = new THREE.BufferGeometry(); g.index = base.index;
    for (const n in base.attributes) g.attributes[n] = base.attributes[n];
    g.groups = base.groups; if (!base.boundingSphere) base.computeBoundingSphere();
    g.userData.baseR = base.boundingSphere.radius + base.boundingSphere.center.length(); g.boundingSphere = new THREE.Sphere(); return g;
  }
  function fitSphere(im, b) {
    const sp = im.geometry.boundingSphere;
    if (!im.count) { sp.center.set(0, -1e5, 0); sp.radius = 0; return; }
    sp.center.set((b[0] + b[2]) / 2, 1, (b[1] + b[3]) / 2); sp.radius = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + (im === proxyIM ? 8 : im.geometry.userData.baseR) + 1;
  }
  const PROXY_H = { defender: 1.97, gclass: 1.97, thar: 1.86, hector: 1.76, wagonR: 1.68, innova: 1.75, landCruiser: 1.95, tharRoxx: 1.92, hayabusa: 1.16, s1000rr: 1.2, r1250gsa: 1.5, r1300gsa: 1.55, activa: 1.15, starCity: 1.08, swiftNew: 1.52, scorpioN: 1.86, safari: 1.92, sumo: 1.92, bike: 1.1, scooter: 1.1, classic: 1.15, classic2: 1.1, sport: 1.15, faired: 1.15, cycle: 1.05, mpv: 1.8, fortuner: 1.84, fortunerBlack: 1.84, crysta: 1.8, berlinetta: 1.2, muscle: 1.38, wedge: 1.15, coupe911: 1.3,
    swift: 1.52, dzire: 1.52, alto: 1.45, bolero: 1.9, scorpio: 2.0, ace: 1.86, auto: 1.75, hatch: 1.45, suv: 1.75, tractor: 2.2, lorry: 3.2, bus: 3.1, bullockCart: 1.8 };
  function refreshInstances() {
    const cam = game.camera.position;
    for (const k of KINDS) for (const vr of variants[k]) { vr.im.count = 0; if (vr.gim) vr.gim.count = 0; }
    proxyIM.count = 0;
    const bx = new Map(), grow = (im, x, z) => { let b = bx.get(im); if (!b) bx.set(im, b = [x, z, x, z]); if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (z < b[1]) b[1] = z; if (z > b[3]) b[3] = z; };
    for (const it of items) {
      if (it.claimed) continue;
      const d = Math.hypot(it.x - cam.x, it.z - cam.z);
      if (d > FAR) continue;
      q.setFromAxisAngle(yAxis, it.rot);
      const vr = variants[it.vk][it.vi];
      if (d < NEAR) { m4.compose(v3.set(it.x, it.y, it.z), q, sc.set(1, 1, 1)); vr.im.setMatrixAt(vr.im.count++, m4); grow(vr.im, it.x, it.z); if (vr.gim) { vr.gim.setMatrixAt(vr.gim.count++, m4); grow(vr.gim, it.x, it.z); } }
      else {
        grow(proxyIM, it.x, it.z);
        const i = proxyIM.count++;
        m4.compose(v3.set(it.x, it.y + 0.08, it.z), q, sc.set(it.hw * 1.9, PROXY_H[it.vk], it.hl * 1.9)); proxyIM.setMatrixAt(i, m4);
        proxyIM.setColorAt(i, vr.proxy);
      }
    }
    for (const k of KINDS) for (const vr of variants[k]) { vr.im.instanceMatrix.needsUpdate = true; fitSphere(vr.im, bx.get(vr.im)); if (vr.gim) { vr.gim.instanceMatrix.needsUpdate = true; fitSphere(vr.gim, bx.get(vr.gim)); } }
    fitSphere(proxyIM, bx.get(proxyIM));
    proxyIM.instanceMatrix.needsUpdate = true; if (proxyIM.instanceColor) proxyIM.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- get in: hand the vehicle to player.js through `traffic`
  function axisDist(x, z, it) {
    const fx = Math.sin(it.rot), fz = Math.cos(it.rot), half = Math.max(0, it.hl - it.hw);
    const t = THREE.MathUtils.clamp((x - it.x) * fx + (z - it.z) * fz, -half, half);
    return Math.hypot(x - it.x - fx * t, z - it.z - fz * t) - it.hw;
  }
  // the item leaves the world: taken here, or by another player (multiplayer)
  function remove(it) {
    if (world.removeCollider) world.removeCollider(it.handle);
    const k = occupied.findIndex(o => o[0] === it.x && o[1] === it.z); if (k >= 0) occupied.splice(k, 1);
    if (it.bay) it.bay.taken = false;
    const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); api.count = items.length;
    it.claimed = true; refreshInstances();
  }
  api.remove = remove;
  api.playerKind = pk;
  api.layout = () => items.map(it => ({ kind: it.vk, x: +it.x.toFixed(2), z: +it.z.toFixed(2), rot: +it.rot.toFixed(4), where: it.where }));   // paste-ready for FIXED_SPOTS
  function claimNearest(g) {
    const p = g.carPos;
    let best = null;
    for (const it of items) { if (it.claimed) continue; if (Math.abs(it.x - p.x) > 12 || Math.abs(it.z - p.z) > 12) continue;
      const d = axisDist(p.x, p.z, it); if (d < 3 && (!best || d < best.d)) best = { it, d }; }
    if (!best) return;
    const it = best.it, model = cloneModel(variants[it.vk][it.vi].tpl);
    model.g.position.set(it.x, it.y, it.z); model.g.rotation.y = it.rot; scene.add(model.g);
    const t = { ...model, model: it.kind, type: it.vk, parked: true, len2: model.len / 2, r: null, speed: 0, cur: 0, s: 0, dir: 1, len: 0, hw: it.hw, wheelR: 0.4 };
    g.traffic.push(t);
    it.claimed = true; refreshInstances();
    // player.js runs right after this hook in the same keydown; if it took something else, undo
    queueMicrotask(() => {
      const i = g.traffic.indexOf(t);
      if (i >= 0) { g.traffic.splice(i, 1); scene.remove(model.g); it.claimed = false; refreshInstances(); return; }
      remove(it);
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
        const b = bake(tpl.g); variants[k].push({ tpl, geo: b.geo, proxy: b.proxy, glass: b.glass, gMat: b.gMat });
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
      { name: 'ZPSS School', at: { x: -31.5, z: 43.5, rot: -0.452 }, n: 4, aisle: 4.5, kinds: [] },
      { name: 'Govt Hospital', near: LM('hospital'), n: 4, aisle: 5.0, kinds: [], slide: 25 },
    ].filter(D => D.at || D.near);   // the hospital landmark was removed from the map (it sat on houses)
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
    ROWS.stretches = stretches(16);
    if (FIXED_SPOTS.length) for (const q of FIXED_SPOTS) { if (variants[q.kind]) addItem(q.kind, q.x, q.z, q.rot, { where: q.where || 'road', vi: 0 }); }
    else {
      safeHouseRow();
      autoStand(junction);
      rowNear(junction.x - 20, junction.z - 20, ['bus'], 'busstop', r => r.t === 'highway');
      const fac = LM('factory'); if (fac) rowNear(fac.x, fac.z, ['lorry', 'lorry', 'lorry', 'lorry'], 'factory', r => r.t !== 'dirt' && r.t !== 'lane');
      // tractors (with trolleys) and carts on the dirt roads where the village meets the fields
      const edge = ROWS.stretches.filter(st => st.r.t === 'dirt').map(st => ({ st, d: Math.hypot(st.x - junction.x, st.z - junction.z) })).filter(q => q.d > 250 && q.d < 1100).sort((a, b) => a.st.x + a.st.z - b.st.x - b.st.z);
      const farm = ['tractor', 'tractor', 'bullockCart', 'tractor', 'tractor', 'bullockCart', 'tractor', 'tractor', 'bullockCart', 'tractor', 'tractor'];
      for (let i = 0; i < edge.length && farm.length; i += Math.max(1, edge.length / 14 | 0)) { const got = fillRow(edge[i].st, 1, edge[i].st.used[1] || 4, farm.slice(0, 1), 'field'); if (got.length) farm.shift(); }
      const target = 200 - items.length, nCars = Math.round(target * 0.42), cars = [], bikes = [];
      for (let i = 0; i < nCars; i++) cars.push(HOME_CARS[i % HOME_CARS.length]);
      cars.push('muscle', 'coupe911');
      for (let i = 0; i < target - nCars; i++) bikes.push(pick(HOME_BIKES));
      villageRows(junction, cars, bikes);
    }
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
