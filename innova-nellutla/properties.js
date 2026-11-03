// properties.js: buy houses / shops / plots, build on plots, parking bays and garages, daily income, save/load.
// Registers on window.GameHooks. Everything is overlays: the world's building meshes are merged and never touched.
(function () {
  'use strict';
  const SAVE_KEY = 'nellutla.properties';
  const SELL_BACK = 0.7;
  const T = window.THREE;

  // ------------------------------------------------------------------ helpers
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const lakh = n => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 1 : 2).replace(/\.?0+$/, '') + ' L' : fmt(n);
  const lakhTe = n => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 1 : 2).replace(/\.?0+$/, '') + ' లక్షలు' : fmt(n);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const PL = () => { try { return Player; } catch (e) { return null; } };
  const TM = () => { try { return TrafficModels; } catch (e) { return null; } };
  const gTime = () => { try { return timeOfDay; } catch (e) { return 12; } };            // global let in index.html
  const gRot = () => { try { return carRot; } catch (e) { return 0; } };
  const playerName = () => { try { if (window.MP && MP.myName) return MP.myName(); } catch (e) {} try { return localStorage.getItem('nellutla.name') || 'You'; } catch (e) { return 'You'; } };
  const gridRef = (x, z) => { try { return MP.gridRef(x, z); } catch (e) { return '?'; } };
  const latLon = (x, z) => { try { return MP.latLon(x, z); } catch (e) { return [17.7016 - z / 110574, 79.1963 + x / 106080]; } };

  // ------------------------------------------------------------------ designs for empty plots
  const DESIGNS = {
    village: { name: 'Village house (1 floor)', te: 'పల్లె ఇల్లు', cost: 320000, time: 50, income: 0 },
    rcc2:    { name: '2-floor RCC house with balcony', te: 'రెండంతస్తుల ఇల్లు', cost: 950000, time: 70, income: 0 },
    shop:    { name: 'House with shop below', te: 'కింద దుకాణం', cost: 780000, time: 65, income: 2500 },
    farm:    { name: 'Farmhouse, tiled roof', te: 'పెంకుటిల్లు', cost: 480000, time: 55, income: 0 },
    garage:  { name: 'Garage', te: 'గ్యారేజ్', cost: 140000, time: 30, income: 0, garage: true },
  };
  const PAINTS = [['Lime white', 0xf1ede0], ['Sky blue', 0x8fc3e6], ['Mint', 0xa8dcc0], ['Pista green', 0xc6dc8a], ['Pink', 0xf2b6c6], ['Saffron', 0xf3c17a], ['Lavender', 0xc5b6e6]];
  const WALL_COST = 60000;

  // ------------------------------------------------------------------ state
  const props = [];             // { id, type: small|big|shop|garage|plot, x, z (marker), nx, nz, price, income, area, floors, b?, plot?, board, marker, ... }
  const byId = {};
  let save = { owned: {}, bays: {}, stored: {}, cash: null };
  let G = null, panel = null, hud = null, mapCv = null, radCv = null, waypoint = null, lastTod = null, saveTimer = 0, lotsTried = 0;
  const lots = [];              // from Parked.lots
  const garageSpots = [];       // { id, x, z, rot, label, kind: bay|garage }
  const spawned = {};           // slotId -> vehicle object waiting to be entered / driven
  const built = {};             // propId -> { group, cons, design }

  // ------------------------------------------------------------------ geometry merger (vertex colours)
  function Merger() { this.pos = []; this.nor = []; this.col = []; }
  Merger.prototype.add = function (geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = new T.Color(color);
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) this.col.push(c.r, c.g, c.b);
    return this;
  };
  Merger.prototype.box = function (w, h, d, x, y, z, color, ry) {
    const m = new T.Matrix4().makeRotationY(ry || 0).setPosition(x, y + h / 2, z);
    return this.add(new T.BoxGeometry(w, h, d), color, m);
  };
  Merger.prototype.cyl = function (r, h, x, y, z, color, seg) { return this.add(new T.CylinderGeometry(r, r, h, seg || 12), color, new T.Matrix4().setPosition(x, y + h / 2, z)); };
  Merger.prototype.mesh = function (mat) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    const ms = new T.Mesh(g, mat || new T.MeshLambertMaterial({ vertexColors: true })); ms.castShadow = ms.receiveShadow = true; return ms;
  };

  // ------------------------------------------------------------------ road / building lookups
  let roadSegs = [];
  function nearestRoad(x, z, types) {
    let best = { d: 1e9 };
    for (const s of roadSegs) {
      if (types && !types.includes(s.t)) continue;
      if (Math.abs(s.cx - x) > s.hl + 300 || Math.abs(s.cz - z) > s.hl + 300) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const px = s.ax + t * dx, pz = s.az + t * dz, d = Math.hypot(x - px, z - pz) - s.w / 2;
      if (d < best.d) best = { d, px, pz, t: s.t, dir: Math.atan2(dx, dz) };
    }
    return best;
  }
  const centroid = b => [b.p.reduce((s, q) => s + q[0], 0) / b.p.length, b.p.reduce((s, q) => s + q[1], 0) / b.p.length];
  function doorOf(b) {
    const [cx, cz] = centroid(b); let best = null;
    for (let i = 0; i < b.p.length; i++) {
      const a = b.p[i], c = b.p[(i + 1) % b.p.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]); if (len < 1.5) continue;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
      const r = nearestRoad(mx + nx * 3, mz + nz * 3), score = r.d - len * 0.3;
      if (!best || score < best.score) best = { score, mx, mz, nx, nz, len };
    }
    return best;
  }

  // ------------------------------------------------------------------ 3D overlays
  function fit(g, text, x, y, px, font, max) { let s = px; do { g.font = font.replace('#', s); s -= 2; } while (g.measureText(text).width > max && s > 14); g.fillText(text, x, y); }
  function boardTexture(lines) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320; const g = c.getContext('2d');
    const { head, headCol, te, price, sub } = lines;
    g.fillStyle = '#fbf7ec'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = headCol; g.fillRect(0, 0, 512, 110);
    g.fillStyle = '#fff'; g.textAlign = 'center'; fit(g, head, 256, 80, 66, 'bold #px Arial, sans-serif', 480);
    g.fillStyle = '#1f2937'; fit(g, te, 256, 170, 44, 'bold #px "Noto Sans Telugu", "Telugu Sangam MN", "Kohinoor Telugu", sans-serif', 470);
    g.fillStyle = headCol; fit(g, price, 256, 238, 54, 'bold #px Arial, sans-serif', 470);
    g.fillStyle = '#475569'; fit(g, sub, 256, 290, 28, '#px Arial, sans-serif', 480);
    g.strokeStyle = '#1f2937'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 310);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  const postMat = new T.MeshLambertMaterial({ color: 0x5b4632 }), backMat = new T.MeshLambertMaterial({ color: 0xd9d4c4 });
  function makeBoard(x, z, ang) {
    const grp = new T.Group(); grp.position.set(x, 0, z); grp.rotation.y = ang;
    const post = new T.BoxGeometry(0.1, 2.9, 0.1);
    [-1.05, 1.05].forEach(px => { const m = new T.Mesh(post, postMat); m.position.set(px, 1.45, -0.03); m.castShadow = true; grp.add(m); });
    const face = new T.Mesh(new T.PlaneGeometry(2.4, 1.5), new T.MeshBasicMaterial({ color: 0xffffff }));
    face.position.set(0, 2.05, 0.01); grp.add(face);
    const back = new T.Mesh(new T.PlaneGeometry(2.4, 1.5), backMat); back.rotation.y = Math.PI; back.position.set(0, 2.05, -0.01); grp.add(back);
    grp.userData.face = face; G.scene.add(grp); return grp;
  }
  function setBoard(grp, lines) {
    const f = grp.userData.face; if (f.material.map) f.material.map.dispose();
    f.material.map = boardTexture(lines); f.material.needsUpdate = true;
  }
  const ringGeo = new T.RingGeometry(0.85, 1.15, 48).rotateX(-Math.PI / 2), discGeo = new T.CircleGeometry(0.85, 40).rotateX(-Math.PI / 2);
  const beamGeo = new T.CylinderGeometry(1.0, 1.0, 2.2, 32, 1, true).translate(0, 1.1, 0);
  function makeMarker(x, z, color) {
    const grp = new T.Group(); grp.position.set(x, 0.07, z);
    const mk = o => new T.MeshBasicMaterial(Object.assign({ color, transparent: true, depthWrite: false, side: T.DoubleSide }, o));
    const ring = new T.Mesh(ringGeo, mk({ opacity: 0.9 })), disc = new T.Mesh(discGeo, mk({ opacity: 0.18 }));
    const beam = new T.Mesh(beamGeo, mk({ opacity: 0.16, blending: T.AdditiveBlending }));
    grp.add(ring, disc, beam); grp.userData = { ring, disc, beam }; G.scene.add(grp); return grp;
  }
  function setMarkerColor(m, c) { Object.values(m.userData).forEach(o => o.material.color.setHex(c)); }
  function roofCap(b) {
    const s = new T.Shape(b.p.map(q => new T.Vector2(q[0], q[1])));
    const g = new T.ShapeGeometry(s); g.rotateX(Math.PI / 2);     // shape (x,y) -> (x, 0, y)
    const m = new T.Mesh(g, new T.MeshLambertMaterial({ color: 0x22c55e, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.position.y = b.h + (b.r === 'rcc' ? 0.12 : 1.4); m.renderOrder = 2; G.scene.add(m); return m;
  }

  // ------------------------------------------------------------------ picking real houses and empty plots
  function pickProperties() {
    const D = window.NELLUTLA_MAP, R = rng(20261102);
    const CLEAR_R = { temple: 9, fuel: 16, busstop: 5, tank: 6 };
    const blds = D.buildings.filter(b => { const [x, z] = centroid(b); return !D.landmarks.some(l => Math.hypot(l.x - x, l.z - z) < (CLEAR_R[l.k] || 0) + 25); });
    const shuffled = blds.map(b => [R(), b]).sort((a, b) => a[0] - b[0]).map(a => a[1]);
    const taken = [];
    const farEnough = (x, z, d) => taken.every(t => Math.hypot(t[0] - x, t[1] - z) > d);
    const want = { shop: 9, big: 13, small: 16, garage: 3 };
    for (const b of shuffled) {
      const [cx, cz] = centroid(b);
      let type = null;
      if (want.shop && b.a >= 25 && b.a <= 160 && nearestRoad(cx, cz, ['highway']).d < 22) type = 'shop';
      else if (want.big && b.h >= 6 && b.a >= 60 && b.a <= 260) type = 'big';
      else if (want.small && b.h < 4 && b.a >= 35 && b.a <= 130) type = 'small';
      else if (want.garage && b.h < 4 && b.a >= 15 && b.a < 35 && nearestRoad(cx, cz).d < 15) type = 'garage';
      if (!type || !farEnough(cx, cz, 35)) continue;
      const door = doorOf(b); if (!door) continue;
      want[type]--; taken.push([cx, cz]);
      const mx = door.mx + door.nx * 1.7, mz = door.mz + door.nz * 1.7;
      const floors = b.h >= 6 ? 2 : 1, area = Math.round(b.a * floors);
      let price, income = 0;
      if (type === 'small') price = Math.round((200000 + (b.a - 35) / 95 * 400000 + R() * 30000) / 5000) * 5000;
      if (type === 'big') price = Math.round((1000000 + Math.min(1, (b.a - 60) / 200) * 1500000) / 25000) * 25000;
      if (type === 'shop') { price = Math.round((800000 + Math.min(1, (b.a - 25) / 135) * 700000) / 25000) * 25000; income = Math.round(price * 0.0022 / 100) * 100; }
      if (type === 'garage') price = Math.round((120000 + b.a * 2000) / 5000) * 5000;
      addProp({ id: 'H' + (props.length + 1), type, b, x: mx, z: mz, nx: door.nx, nz: door.nz, price, income, area, floors, plotArea: Math.round(b.a) });
      if (!want.shop && !want.big && !want.small && !want.garage) break;
    }
    // empty plots: open fields at the village edge, off the roads, close enough to a road to drive in
    const cell = 30, hash = new Map();
    D.buildings.forEach(b => { const [x, z] = centroid(b), k = Math.floor(x / cell) + ',' + Math.floor(z / cell); (hash.get(k) || hash.set(k, []).get(k)).push([x, z]); });
    const near = (x, z, r) => { let n = 0, dmin = 1e9; const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const q of hash.get(i + ',' + j) || []) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < r) n++; if (d < dmin) dmin = d; } return { n, dmin }; };
    const cands = [];
    const [x0, z0, x1, z1] = D.bounds;
    for (let x = x0 + 60; x < x1 - 60; x += 17) for (let z = z0 + 60; z < z1 - 60; z += 17) {
      const nb = near(x, z, 160); if (nb.n < 6 || nb.n > 45 || nb.dmin < 24) continue;
      const rd = nearestRoad(x, z); if (rd.d < 12 || rd.d > 40) continue;
      if (D.landmarks.some(l => Math.hypot(l.x - x, l.z - z) < 40)) continue;
      let ok = true; for (const [ox, oz] of [[0, 0], [9, 9], [-9, 9], [9, -9], [-9, -9]]) if (G.world.surfaceAt(x + ox, z + oz) !== 'field') { ok = false; break; }
      if (ok) cands.push({ x, z, rd, k: R() });
    }
    cands.sort((a, b) => a.k - b.k);
    let nPlots = 0;
    for (const c of cands) {
      if (nPlots >= 15) break;
      if (!farEnough(c.x, c.z, 90)) continue;
      taken.push([c.x, c.z]); nPlots++;
      let nx = c.rd.px - c.x, nz = c.rd.pz - c.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const W = 16, Dp = 18, size = W * Dp, price = Math.round((150000 + R() * 250000) / 10000) * 10000;
      addProp({ id: 'P' + (nPlots), type: 'plot', plot: { x: c.x, z: c.z, rot: Math.atan2(nx, nz), W, D: Dp }, x: c.x + nx * (Dp / 2 + 1.2), z: c.z + nz * (Dp / 2 + 1.2), nx, nz, price, income: 0, area: size, floors: 0, plotArea: size });
    }
  }
  const TYPE_INFO = {
    small: { en: 'Village home', te: 'చిన్న ఇల్లు', col: 0x22c55e },
    big:   { en: '2-floor house', te: 'రెండంతస్తుల ఇల్లు', col: 0x22c55e },
    shop:  { en: 'NH shop', te: 'దుకాణం', col: 0xf59e0b },
    garage:{ en: 'Garage', te: 'గ్యారేజ్', col: 0x60a5fa },
    plot:  { en: 'Open plot', te: 'ఖాళీ స్థలం', col: 0xa3e635 },
  };
  function addProp(p) {
    const ti = TYPE_INFO[p.type];
    p.boardPos = [p.x + p.nx * 2.2 - p.nz * 2.2, p.z + p.nz * 2.2 + p.nx * 2.2];
    p.board = makeBoard(p.boardPos[0], p.boardPos[1], Math.atan2(p.nx, p.nz));
    p.marker = makeMarker(p.x, p.z, ti.col);
    if (p.plot) p.plotMesh = plotOutline(p.plot);
    props.push(p); byId[p.id] = p;
  }
  function plotOutline(pl) {
    const grp = new T.Group(); grp.position.set(pl.x, 0, pl.z); grp.rotation.y = pl.rot;
    const m = new Merger(), hw = pl.W / 2, hd = pl.D / 2;
    [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].forEach(([x, z]) => m.box(0.18, 0.8, 0.18, x, 0, z, 0xd6d3c9));
    [[0, -hd, pl.W, 0.06], [0, hd, pl.W, 0.06], [-hw, 0, 0.06, pl.D], [hw, 0, 0.06, pl.D]].forEach(([x, z, w, d]) => m.box(w, 0.04, d, x, 0.02, z, 0xf8f6ef));
    grp.add(m.mesh()); G.scene.add(grp); return grp;
  }
  const isOwned = p => !!save.owned[p.id];
  function refreshProp(p) {
    const o = save.owned[p.id], ti = TYPE_INFO[p.type];
    if (o) {
      setBoard(p.board, { head: 'SOLD', headCol: '#b91c1c', te: 'యజమాని: ' + playerName(), price: o.build && o.build.done ? DESIGNS[o.build.design].name.split(' (')[0].split(',')[0] : ti.en, sub: p.id + ' · ' + gridRef(p.x, p.z) });
      setMarkerColor(p.marker, 0x38bdf8);
      if (p.b && !p.cap) p.cap = roofCap(p.b);
    } else {
      setBoard(p.board, { head: 'FOR SALE', headCol: '#15803d', te: 'అమ్మకానికి · ' + lakhTe(p.price), price: lakh(p.price), sub: ti.en + (p.income ? ' · ' + fmt(p.income) + '/day' : '') + ' · ' + p.id });
      setMarkerColor(p.marker, ti.col);
      if (p.cap) { G.scene.remove(p.cap); p.cap.geometry.dispose(); p.cap = null; }
    }
  }

  // ------------------------------------------------------------------ procedural Telangana houses on plots
  function buildHouse(design, paint, wall) {
    const m = new Merger(), grp = new T.Group();
    const trim = 0xffffff, slab = 0xbdb8ac, door = 0x6b3f1f, win = 0x2a3b4c, grill = 0x3d4a52, tank = 0x1d1d1d, floorH = 3.1;
    const winAt = (x, y, z, ry) => { m.box(1.1, 1.2, 0.08, x, y, z, win, ry); m.box(1.3, 0.12, 0.25, x + (ry ? 0 : 0), y + 1.22, z, slab, ry); m.box(1.1, 0.05, 0.1, x, y + 0.6, z, grill, ry); };
    // footprint centred at local (0, zc) facing +z
    const house = (w, d, zc, floors, opts) => {
      for (let f = 0; f < floors; f++) {
        const y = f * floorH, shopFloor = opts.shop && f === 0;
        m.box(w, floorH - 0.15, d, 0, y, zc, shopFloor ? 0xe8e2d2 : paint);
        m.box(w + 0.3, 0.15, d + 0.3, 0, y + floorH - 0.15, zc, slab);                 // slab band
        const fz = zc + d / 2 + 0.05;
        if (shopFloor) {
          m.box(w * 0.42, 2.4, 0.1, -w * 0.24, y + 0.1, fz, 0x8a9399); m.box(w * 0.42, 2.4, 0.1, w * 0.24, y + 0.1, fz, 0x8a9399);   // rolling shutters
          for (let i = 0; i < 10; i++) { m.box(w * 0.42, 0.03, 0.12, -w * 0.24, y + 0.2 + i * 0.23, fz, 0x6b7378); m.box(w * 0.42, 0.03, 0.12, w * 0.24, y + 0.2 + i * 0.23, fz, 0x6b7378); }
          m.box(w + 0.6, 0.12, 1.2, 0, y + 2.75, fz + 0.55, slab);                       // chajja
          m.box(w * 0.9, 0.55, 0.06, 0, y + 2.9, fz + 0.15, 0xc2410c);                     // shop name board
        } else {
          m.box(1.0, 2.15, 0.1, f === 0 ? 0 : -w / 2 + 1.2, y, fz, door);
          m.box(1.2, 0.1, 0.5, f === 0 ? 0 : -w / 2 + 1.2, y + 2.2, fz + 0.2, slab);
          winAt(-w / 2 + 1.4 + (f ? 1.6 : 0), y + 0.9, fz, 0); winAt(w / 2 - 1.4, y + 0.9, fz, 0);
          winAt(w / 2 + 0.05, y + 0.9, zc, Math.PI / 2); winAt(-w / 2 - 0.05, y + 0.9, zc, Math.PI / 2);
        }
        if (f === 0 && !opts.shop) { m.box(1.6, 0.15, 0.6, 0, 0, fz + 0.3, 0x9a958a); m.box(1.6, 0.15, 0.35, 0, 0.15, fz + 0.2, 0x9a958a); }   // steps
      }
      return floors * floorH;
    };
    const parapet = (w, d, zc, y) => { m.box(w + 0.3, 0.9, 0.15, 0, y, zc + d / 2 + 0.07, paint); m.box(w + 0.3, 0.9, 0.15, 0, y, zc - d / 2 - 0.07, paint); m.box(0.15, 0.9, d, w / 2 + 0.07, y, zc, paint); m.box(0.15, 0.9, d, -w / 2 - 0.07, y, zc, paint);
      m.box(w + 0.4, 0.08, 0.25, 0, y + 0.9, zc + d / 2 + 0.07, trim); };
    const waterTank = (x, y, z) => { m.box(1.6, 0.9, 1.6, x, y, z, 0xa8a398); m.cyl(0.62, 1.15, x, y + 0.9, z, tank, 16); m.cyl(0.25, 0.12, x, y + 2.05, z, tank, 10); };
    if (design === 'village') {
      const top = house(9, 8, -2.5, 1, {}); parapet(9, 8, -2.5, top); waterTank(2.8, top, -4.6);
    } else if (design === 'rcc2') {
      const top = house(10, 9, -2.5, 2, {}); parapet(10, 9, -2.5, top);
      m.box(5, 0.15, 1.4, 1.8, floorH - 0.15, 2.7, slab);                                  // balcony slab
      m.box(5, 0.9, 0.08, 1.8, floorH, 3.36, grill); m.box(0.08, 0.9, 1.4, 4.26, floorH, 2.7, grill); m.box(0.08, 0.9, 1.4, -0.66, floorH, 2.7, grill);
      for (let i = 0; i < 4; i++) m.box(0.2, floorH - 0.15, 0.2, -0.5 + i * 1.6, 0, 3.2, paint);
      m.box(1.6, 2.6, 1.6, -3.6, top, -5.2, paint); m.box(1.8, 0.12, 1.8, -3.6, top + 2.6, -5.2, slab);   // stair headroom
      waterTank(2.8, top, -5.2);
    } else if (design === 'shop') {
      const top = house(10, 9, -2.5, 2, { shop: true }); parapet(10, 9, -2.5, top); waterTank(-3, top, -5);
      m.box(1.1, floorH, 2.6, 5.6, 0, -1, 0x9a958a);                                       // outside stair to upper house
    } else if (design === 'farm') {
      house(10, 7, -3, 1, {});
      const roof = new T.CylinderGeometry(4.6, 4.6, 11.4, 3, 1).rotateZ(Math.PI / 2);       // prism roof, ridge along x
      roof.scale(1, 0.42, 1);
      m.add(roof, 0xb5532f, new T.Matrix4().setPosition(0, floorH + 0.8, -3));
      for (let i = 0; i < 4; i++) m.box(0.22, floorH - 0.2, 0.22, -4.5 + i * 3, 0, 1.6, 0x7a5432);   // veranda posts
      m.box(10.6, 0.12, 2.6, 0, floorH - 0.3, 0.9, 0xb5532f);
      m.box(10, 0.25, 2.4, 0, 0, 0.9, 0xc9c1ad);
    } else if (design === 'garage') {
      m.box(5, 3, 0.2, 0, 0, -3.4, paint); m.box(0.2, 3, 7, -2.5, 0, 0, paint); m.box(0.2, 3, 7, 2.5, 0, 0, paint);
      m.box(5.4, 0.18, 7.4, 0, 3, 0, slab); m.box(4.6, 0.6, 0.12, 0, 2.4, 3.45, 0x8a9399);  // rolled-up shutter
      m.box(4.8, 0.05, 6.8, 0, 0.01, 0, 0x9c978d);
    }
    if (wall) {
      const hw = 7.6, hd = 8.6, wc = 0xd8d1bf;
      m.box(15.2, 1.4, 0.2, 0, 0, -hd, wc); m.box(0.2, 1.4, 17.2, -hw, 0, 0, wc); m.box(0.2, 1.4, 17.2, hw, 0, 0, wc);
      m.box(5.4, 1.4, 0.2, -4.9, 0, hd, wc); m.box(5.4, 1.4, 0.2, 4.9, 0, hd, wc);
      m.box(0.5, 1.9, 0.5, -2.1, 0, hd, 0xb5aa92); m.box(0.5, 1.9, 0.5, 2.1, 0, hd, 0xb5aa92);
      for (let i = 0; i < 9; i++) m.box(0.05, 1.3, 0.05, -1.7 + i * 0.42, 0.1, hd + 0.3, 0x2b2f33);   // iron gate bars
      m.box(3.6, 0.08, 0.08, 0, 1.3, hd + 0.3, 0x2b2f33); m.box(3.6, 0.08, 0.08, 0, 0.3, hd + 0.3, 0x2b2f33);
    }
    grp.add(m.mesh()); return grp;
  }
  function constructionSite(design) {
    const grp = new T.Group(), m = new Merger(), H = design === 'rcc2' || design === 'shop' ? 6.4 : 3.3, w = design === 'garage' ? 5 : 10.5, d = design === 'garage' ? 7.4 : 9.5, zc = design === 'garage' ? 0 : -2.5;
    for (let x = -w / 2 - 0.6; x <= w / 2 + 0.7; x += 2.1) for (const z of [zc - d / 2 - 0.6, zc + d / 2 + 0.6]) m.cyl(0.04, H + 1.2, x, 0, z, 0x8b7d6b, 6);
    for (let z = zc - d / 2 - 0.6; z <= zc + d / 2 + 0.7; z += 2.1) for (const x of [-w / 2 - 0.6, w / 2 + 0.6]) m.cyl(0.04, H + 1.2, x, 0, z, 0x8b7d6b, 6);
    for (let y = 1; y < H + 1.2; y += 1.5) {
      m.box(w + 1.2, 0.05, 0.05, 0, y, zc - d / 2 - 0.6, 0x8b7d6b); m.box(w + 1.2, 0.05, 0.05, 0, y, zc + d / 2 + 0.6, 0x8b7d6b);
      m.box(0.05, 0.05, d + 1.2, -w / 2 - 0.6, y, zc, 0x8b7d6b); m.box(0.05, 0.05, d + 1.2, w / 2 + 0.6, y, zc, 0x8b7d6b);
      m.box(w + 1.2, 0.04, 0.5, 0, y - 0.05, zc + d / 2 + 0.85, 0x9c7a4f);                 // planks
    }
    for (let i = 0; i < 4; i++) for (let l = 0; l < 4; l++) m.box(1.0, 0.22, 0.6, 5.5 + (i % 2) * 1.1, l * 0.23, 5 + Math.floor(i / 2) * 0.7, l % 2 ? 0xb4532a : 0xa94c26);   // brick stacks
    const sand = new T.ConeGeometry(1.4, 1.0, 14); m.add(sand, 0xd9b77e, new T.Matrix4().setPosition(-5.2, 0.5, 5.5));
    for (let i = 0; i < 3; i++) m.box(0.5, 0.25, 0.8, -3.4 + i * 0.55, 0, 6.4, 0xe5e1d6);   // cement bags
    grp.add(m.mesh());
    const shell = new T.Mesh(new T.BoxGeometry(w - 0.4, 1, d - 0.4).translate(0, 0.5, zc), new T.MeshLambertMaterial({ color: 0xb05a35 }));
    shell.castShadow = true; grp.add(shell); grp.userData = { shell, H };
    return grp;
  }
  function placeOnPlot(p, obj) { obj.position.set(p.plot.x, 0, p.plot.z); obj.rotation.y = p.plot.rot; G.scene.add(obj); }
  function syncBuilt(p) {
    const o = save.owned[p.id], cur = built[p.id];
    if (cur) { G.scene.remove(cur.group); if (cur.cons) G.scene.remove(cur.cons); delete built[p.id]; }
    if (!o || !o.build) return;
    const b = o.build, ent = built[p.id] = { design: b.design };
    if (b.done) { ent.group = buildHouse(b.design, b.paint, b.wall); placeOnPlot(p, ent.group); if (p.plotMesh) p.plotMesh.visible = false; }
    else { ent.group = ent.cons = constructionSite(b.design); placeOnPlot(p, ent.cons); if (p.plotMesh) p.plotMesh.visible = true; }
    rebuildSpots();
  }
  const local = (p, x, z) => { const c = Math.cos(p.plot.rot), s = Math.sin(p.plot.rot); return [p.plot.x + x * c + z * s, p.plot.z - x * s + z * c]; };

  // ------------------------------------------------------------------ garages / bays
  function rebuildSpots() {
    garageSpots.length = 0;
    for (const p of props) {
      const o = save.owned[p.id]; if (!o) continue;
      if (p.type === 'garage') garageSpots.push({ id: p.id, x: p.x + p.nx * 2.8, z: p.z + p.nz * 2.8, rot: Math.atan2(-p.nx, -p.nz), label: 'Garage ' + p.id });
      if (p.type === 'plot' && o.build && o.build.done && o.build.design === 'garage') { const [x, z] = local(p, 0, 0); garageSpots.push({ id: p.id, x, z, rot: p.plot.rot + Math.PI, label: 'Garage ' + p.id }); }
    }
    for (const L of lots) L.bays.forEach((b, i) => { const id = L.id + '#' + i; if (save.bays[id]) garageSpots.push({ id, x: b.x, z: b.z, rot: b.rot || 0, label: (save.bays[id].rent ? 'Rented bay ' : 'Bay ') + (i + 1) + ' · ' + L.name, bay: true }); });
  }
  function initLots() {
    const P = window.Parked; if (!P || !Array.isArray(P.lots) || !P.lots.length) return false;
    P.lots.forEach((L, k) => {
      const lot = { id: 'L' + k, name: L.name || 'Parking ' + (k + 1), x: L.x, z: L.z, bays: L.bays || [], src: L };
      lot.marker = makeMarker(L.x, L.z, 0x60a5fa); lots.push(lot);
      lot.bayMarks = lot.bays.map(() => null);
    });
    rebuildSpots(); refreshBays(); spawnStored(); return true;
  }
  const bayMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, depthWrite: false });
  function refreshBays() {
    for (const L of lots) L.bays.forEach((b, i) => {
      const own = !!save.bays[L.id + '#' + i];
      if (own && !L.bayMarks[i]) { const m = new T.Mesh(new T.PlaneGeometry(2.6, 5).rotateX(-Math.PI / 2), bayMat); m.position.set(b.x, 0.09, b.z); m.rotation.y = b.rot || 0; G.scene.add(m); L.bayMarks[i] = m; }
      if (!own && L.bayMarks[i]) { G.scene.remove(L.bayMarks[i]); L.bayMarks[i] = null; }
    });
  }
  function paintOf(g) { let c = null; g.traverse(o => { if (!c && o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) c = o.material.color.getHex(); }); return c; }
  function storeVehicle(spot) {
    const v = PL() && PL().active; if (!v) return G.showPopup('ONLY CARS, BIKES AND OTHER VEHICLES · NOT THE CRYSTA');
    const kind = v.model; if (!kind || !TM() || !TM()[kind]) return G.showPopup('CANNOT STORE THIS VEHICLE');
    let spd = 0; try { spd = Math.abs(carSpeed); } catch (e) {}
    if (spd > 8) return G.showPopup('STOP TO STORE THE VEHICLE');
    save.stored[spot.id] = { kind, color: paintOf(v.g), label: spot.label };
    spawned[spot.id] = v; v._propSlot = spot.id;
    PL().toggle();                                          // get out; the vehicle stays parked in the bay
    persist(); G.showPopup('VEHICLE STORED · ' + spot.label.toUpperCase());
  }
  const paintCache = {};
  function spawnStored() {
    for (const id in save.stored) {
      if (spawned[id]) continue;
      const spot = garageSpots.find(s => s.id === id); if (!spot) continue;
      const st = save.stored[id]; if (!TM() || !TM()[st.kind]) continue;
      const v = TM()[st.kind]();
      { const dead = []; v.g.traverse(o => { if (o.userData && o.userData.human) dead.push(o); }); dead.forEach(o => o.parent && o.parent.remove(o)); }
      if (st.color != null) v.g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) o.material = paintCache[st.color] || (paintCache[st.color] = new T.MeshPhongMaterial({ color: st.color, specular: 0x8a8a8a, shininess: 85 })); });
      v.g.position.set(spot.x, 0, spot.z); v.g.rotation.y = spot.rot; G.scene.add(v.g);
      const obj = { ...v, model: st.kind, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, _propSlot: id, _waiting: true };
      spawned[id] = obj;
      // give it the same collision and F-to-enter as any vehicle the player parked
      if (PL() && PL().addParked) PL().addParked(obj);
    }
  }

  // ------------------------------------------------------------------ UI
  function css() {
    const s = document.createElement('style'); s.textContent = `
#propPanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);max-height:84vh;overflow:auto;z-index:60;display:none;
 background:linear-gradient(160deg,rgba(20,26,36,.97),rgba(12,16,24,.97));color:#e8e4d8;border-radius:14px;border:1px solid rgba(255,214,140,.25);
 box-shadow:0 18px 60px rgba(0,0,0,.6);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
#propPanel .hd{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);background:repeating-linear-gradient(135deg,rgba(255,180,60,.07) 0 10px,transparent 10px 20px)}
#propPanel .tag{display:inline-block;font:700 11px system-ui;letter-spacing:.12em;padding:3px 8px;border-radius:4px;background:#15803d;color:#fff}
#propPanel .tag.sold{background:#b91c1c}#propPanel h2{margin:8px 0 2px;font:700 21px system-ui;color:#fff}#propPanel .te{color:#f6c56f;font-size:15px}
#propPanel .bd{padding:12px 18px}#propPanel table{width:100%;border-collapse:collapse}#propPanel td{padding:5px 0;border-bottom:1px dashed rgba(255,255,255,.07)}
#propPanel td:first-child{color:#94a3b8;width:42%}#propPanel .price{font:800 26px system-ui;color:#4ade80;margin:10px 0 2px}
#propPanel .ft{display:flex;gap:8px;padding:12px 18px 16px;flex-wrap:wrap}#propPanel button{flex:1;min-width:110px;padding:10px 12px;border-radius:9px;border:0;font:700 14px system-ui;cursor:pointer;background:#334155;color:#e2e8f0}
#propPanel button.go{background:#f59e0b;color:#1a1204}#propPanel button.go:disabled{background:#4b5563;color:#9ca3af;cursor:not-allowed}#propPanel button.warn{background:#7f1d1d;color:#fecaca}
#propPanel .opts{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}#propPanel .opt{padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.14);cursor:pointer;font-size:13px}
#propPanel .opt.on{border-color:#f59e0b;background:rgba(245,158,11,.16)}#propPanel .sw{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer}
#propPanel .sw.on{border-color:#f59e0b;box-shadow:0 0 0 2px #f59e0b}#propPanel .lbl{color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-top:6px}
#propPanel .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:8px}
#propPanel .row button{flex:0 0 auto;min-width:0;padding:6px 10px;font-size:12px}#propPanel .muted{color:#94a3b8;font-size:12px}
#propPanel .x{position:absolute;right:12px;top:10px;background:none;border:0;color:#94a3b8;font-size:20px;cursor:pointer;min-width:0;flex:none}
#propHud{position:fixed;right:14px;bottom:246px;text-align:right;z-index:20;padding:7px 11px;border-radius:9px;background:rgba(10,14,22,.72);color:#e5e7eb;font:12px/1.35 system-ui;border-left:3px solid #f59e0b;pointer-events:none}
#propHud b{color:#fbbf24}#propHint{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:21;padding:8px 14px;border-radius:20px;background:rgba(10,14,22,.8);color:#fff;font:600 14px system-ui;display:none;pointer-events:none}
#propHint kbd{background:#f59e0b;color:#111;border-radius:4px;padding:1px 7px;margin-right:6px;font:800 13px system-ui}`;
    document.head.appendChild(s);
  }
  function openPanel(html) { panel.innerHTML = '<button class="x" data-a="close">×</button>' + html; panel.style.display = 'block'; }
  function closePanel() { panel.style.display = 'none'; panel.dataset.kind = ''; }
  const panelOpen = () => panel.style.display === 'block';
  function propPanel(p) {
    const o = save.owned[p.id], ti = TYPE_INFO[p.type], [la, lo] = latLon(p.x, p.z), cash = cashNow();
    const b = o && o.build, d = b && DESIGNS[b.design];
    const rows = [
      ['Address', `${p.id}, Nellutla village, Lingala Ghanpur mdl., Jangaon dist.`],
      ['Grid ref', gridRef(p.x, p.z)], ['Lat / Lon', `${la.toFixed(5)}° N, ${lo.toFixed(5)}° E`],
      [p.type === 'plot' ? 'Plot size' : 'Built-up area', `${p.area} m² (${Math.round(p.area * 10.764).toLocaleString('en-IN')} sq ft)` + (p.plot ? ` · ${p.plot.W}×${p.plot.D} m` : '')],
      ['Floors', p.type === 'plot' ? (b ? (b.done ? d.name : 'Under construction') : 'Empty land') : p.floors],
      ['Income', (p.income || (b && b.done && d.income)) ? fmt(p.income || d.income) + ' / day' : '—'],
    ];
    let foot;
    if (!o) foot = `<button class="go" data-a="buy" ${canAfford(p.price) ? '' : 'disabled title="Not enough cash"'}>${canAfford(p.price) ? 'Buy · ' + lakh(p.price) : 'Not enough cash · ' + lakh(p.price)}</button><button data-a="close">Close</button>`;
    else {
      const val = sellValue(p);
      foot = (p.type === 'plot' && !b ? '<button class="go" data-a="builder">Build here…</button>' : '') + `<button class="warn" data-a="sell">Sell · ${lakh(val)}</button><button data-a="wp">Waypoint</button><button data-a="close">Close</button>`;
    }
    openPanel(`<div class="hd"><span class="tag ${o ? 'sold' : ''}">${o ? 'OWNED · మీ ఆస్తి' : 'FOR SALE · అమ్మకానికి'}</span><h2>${ti.en}</h2><div class="te">${ti.te}</div></div>
<div class="bd"><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>
<div class="price">${lakh(p.price)}</div><div class="muted">${fmt(p.price)} · your cash ${fmt(cash)}</div>${o ? '' : short(p.price)}</div><div class="ft">${foot}</div>`);
    panel.dataset.kind = 'prop'; panel.dataset.id = p.id;
  }
  function sellValue(p) { const o = save.owned[p.id]; let v = p.price; if (o && o.build) v += DESIGNS[o.build.design].cost + (o.build.wall ? WALL_COST : 0); return Math.round(v * SELL_BACK / 1000) * 1000; }
  const bsel = { design: 'village', paint: 0, wall: true };
  function builderPanel(p) {
    const d = DESIGNS[bsel.design], cost = d.cost + (bsel.wall ? WALL_COST : 0);
    openPanel(`<div class="hd"><span class="tag">BUILDER · నిర్మాణం</span><h2>Build on ${p.id}</h2><div class="te">${p.plot.W}×${p.plot.D} m · ${gridRef(p.x, p.z)}</div></div><div class="bd">
<div class="lbl">Design</div><div class="opts">${Object.entries(DESIGNS).map(([k, v]) => `<div class="opt ${k === bsel.design ? 'on' : ''}" data-d="${k}">${v.name}<br><span class="muted">${v.te} · ${lakh(v.cost)}</span></div>`).join('')}</div>
<div class="lbl">Paint</div><div class="opts">${PAINTS.map((c, i) => `<div class="sw ${i === bsel.paint ? 'on' : ''}" title="${c[0]}" data-p="${i}" style="background:#${c[1].toString(16).padStart(6, '0')}"></div>`).join('')}</div>
<div class="lbl">Compound wall &amp; gate</div><div class="opts"><div class="opt ${bsel.wall ? 'on' : ''}" data-w="1">Yes (+${lakh(WALL_COST)})</div><div class="opt ${bsel.wall ? '' : 'on'}" data-w="0">No</div></div>
<table><tr><td>Cost</td><td><b style="color:#fbbf24">${fmt(cost)}</b></td></tr><tr><td>Build time</td><td>${d.time} s</td></tr>${d.income ? `<tr><td>Shop income</td><td>${fmt(d.income)} / day</td></tr>` : ''}${d.garage ? '<tr><td>Parking</td><td>Stores 1 vehicle</td></tr>' : ''}</table>${short(cost)}</div><div class="ft"><button class="go" data-a="build" ${canAfford(cost) ? '' : 'disabled title="Not enough cash"'}>${canAfford(cost) ? 'Start building' : 'Not enough cash'} · ${lakh(cost)}</button><button data-a="back">Back</button></div>`);
    panel.dataset.kind = 'builder'; panel.dataset.id = p.id;
  }
  function lotPanel(L) {
    const rows = L.bays.map((b, i) => {
      const id = L.id + '#' + i, o = save.bays[id], st = save.stored[id];
      return `<div class="row"><span>Bay ${i + 1} ${o ? `<span style="color:#38bdf8">· ${o.rent ? 'rented' : 'owned'}</span>` : b.taken ? '<span class="muted">· occupied</span>' : ''}${st ? `<br><span class="muted">${st.kind} stored</span>` : ''}</span>
<span>${o ? `<button data-a="relbay" data-b="${id}">${o.rent ? 'End rent' : 'Sell ' + lakh(BAY_PRICE * SELL_BACK)}</button>` : b.taken ? '' : `<button class="go" data-a="buybay" data-b="${id}" ${canAfford(BAY_PRICE) ? '' : 'disabled title="Not enough cash"'}>Buy ${lakh(BAY_PRICE)}</button> <button data-a="rentbay" data-b="${id}" ${canAfford(BAY_RENT) ? '' : 'disabled title="Not enough cash"'}>Rent ${fmt(BAY_RENT)}/day</button>`}</span></div>`;
    }).join('');
    openPanel(`<div class="hd"><span class="tag" style="background:#2563eb">PARKING · పార్కింగ్</span><h2>${esc(L.name)}</h2><div class="te">${gridRef(L.x, L.z)} · ${L.bays.length} bays</div></div>
<div class="bd">${rows || '<div class="muted">No bays here.</div>'}<div class="muted" style="margin-top:6px">Your cash ${fmt(cashNow())}</div>${canAfford(BAY_PRICE) ? '' : '<div class="muted" style="color:#f87171">Not enough cash to buy a bay.</div>'}<div class="muted" style="margin-top:8px">Drive into your bay and press E to store the vehicle. It will be waiting here next time.</div></div><div class="ft"><button data-a="close">Close</button></div>`);
    panel.dataset.kind = 'lot'; panel.dataset.id = L.id;
  }
  const BAY_PRICE = 50000, BAY_RENT = 300;
  // every purchase goes through here: a non-number or short cash balance never buys anything
  const cashNow = () => { const c = G && G.cash; return typeof c === 'number' && isFinite(c) ? c : 0; };
  const canAfford = price => cashNow() >= price;
  function refuse(price) { G.showPopup('NOT ENOUGH CASH · NEED ' + fmt(price - cashNow()) + ' MORE'); return false; }
  function pay(price) { if (!canAfford(price)) return refuse(price); G.cash = cashNow() - price; return true; }
  const short = price => canAfford(price) ? '' : `<div class="muted" style="color:#f87171;margin-top:6px">Not enough cash: you have ${fmt(cashNow())}, need ${fmt(price - cashNow())} more.</div>`;
  function listPanel() {
    const mine = props.filter(isOwned), bays = Object.keys(save.bays);
    const rows = mine.map(p => { const o = save.owned[p.id], b = o.build; return `<div class="row"><span><b>${p.id}</b> · ${TYPE_INFO[p.type].en}${b ? ` <span class="muted">(${b.done ? DESIGNS[b.design].name : 'building ' + Math.round((1 - b.left / DESIGNS[b.design].time) * 100) + '%'})</span>` : ''}<br><span class="muted">${gridRef(p.x, p.z)} · ${Math.round(Math.hypot(p.x - G.carPos.x, p.z - G.carPos.z))} m${incomeOf(p) ? ' · ' + fmt(incomeOf(p)) + '/day' : ''}</span></span><button data-a="wpid" data-id="${p.id}">Set waypoint</button></div>`; }).join('')
      + bays.map(id => { const s = garageSpots.find(g => g.id === id); return s ? `<div class="row"><span><b>${esc(s.label)}</b>${save.stored[id] ? `<br><span class="muted">${save.stored[id].kind} stored</span>` : ''}</span><button data-a="wpxy" data-x="${s.x}" data-z="${s.z}" data-l="${esc(s.label)}">Set waypoint</button></div>` : ''; }).join('');
    const forSale = props.filter(p => !isOwned(p)).map(p => [p, Math.hypot(p.x - G.carPos.x, p.z - G.carPos.z)]).sort((a, b) => a[1] - b[1]).slice(0, 5);
    openPanel(`<div class="hd"><span class="tag" style="background:#a16207">MY PROPERTIES · నా ఆస్తులు</span><h2>${mine.length} owned · ${fmt(dailyIncome())}/day</h2><div class="te">Cash ${fmt(G.cash)}</div></div>
<div class="bd">${rows || '<div class="muted">You don\'t own anything yet. Look for the green FOR SALE boards.</div>'}
<div class="lbl" style="margin-top:12px">Nearest for sale</div>${forSale.map(([p, d]) => `<div class="row"><span>${p.id} · ${TYPE_INFO[p.type].en} · <b style="color:#4ade80">${lakh(p.price)}</b><br><span class="muted">${gridRef(p.x, p.z)} · ${Math.round(d)} m</span></span><button data-a="wpid" data-id="${p.id}">Waypoint</button></div>`).join('')}</div>
<div class="ft">${waypoint ? '<button data-a="wpclear">Clear waypoint</button>' : ''}<button data-a="close">Close (P)</button></div>`);
    panel.dataset.kind = 'list';
  }
  function onPanelClick(e) {
    const t = e.target.closest('[data-a],[data-d],[data-p],[data-w]'); if (!t) return;
    const p = byId[panel.dataset.id];
    if (t.dataset.d) { bsel.design = t.dataset.d; return builderPanel(p); }
    if (t.dataset.p) { bsel.paint = +t.dataset.p; return builderPanel(p); }
    if (t.dataset.w) { bsel.wall = t.dataset.w === '1'; return builderPanel(p); }
    const a = t.dataset.a;
    if (a === 'close') return closePanel();
    if (a === 'buy') return buy(p);
    if (a === 'sell') return sell(p);
    if (a === 'builder') return builderPanel(p);
    if (a === 'back') return propPanel(p);
    if (a === 'build') return startBuild(p);
    if (a === 'wp') { setWaypoint(p.x, p.z, p.id); return closePanel(); }
    if (a === 'wpid') { const q = byId[t.dataset.id]; setWaypoint(q.x, q.z, q.id); return closePanel(); }
    if (a === 'wpxy') { setWaypoint(+t.dataset.x, +t.dataset.z, t.dataset.l); return closePanel(); }
    if (a === 'wpclear') { waypoint = null; return listPanel(); }
    const L = lots.find(l => l.id === panel.dataset.id), bid = t.dataset.b;
    const free = bid && !save.bays[bid] && L && !L.bays[+bid.split('#')[1]].taken;
    if (a === 'buybay' && free && pay(BAY_PRICE)) { save.bays[bid] = { rent: false }; G.showPopup('PARKING BAY BOUGHT'); }
    if (a === 'rentbay' && free) { if (canAfford(BAY_RENT)) { save.bays[bid] = { rent: true }; G.showPopup('BAY RENTED · ' + fmt(BAY_RENT) + '/DAY'); } else refuse(BAY_RENT); }
    if (a === 'relbay' && save.bays[bid]) { if (!save.bays[bid].rent) G.cash = cashNow() + BAY_PRICE * SELL_BACK; delete save.bays[bid]; releaseStored(bid); }
    if (L) { rebuildSpots(); refreshBays(); persist(); lotPanel(L); }
  }
  // a stored vehicle stays where it is as an ordinary parked vehicle once its bay / garage is gone
  function releaseStored(id) { delete save.stored[id]; const v = spawned[id]; if (v) { delete v._propSlot; v._waiting = false; delete spawned[id]; } }
  function buy(p) {
    if (!p || isOwned(p)) return;
    if (!pay(p.price)) { propPanel(p); return; }
    save.owned[p.id] = { t: Date.now() };
    refreshProp(p); rebuildSpots(); persist();
    G.showPopup('PROPERTY BOUGHT · ' + p.id + ' · ' + lakh(p.price)); propPanel(p);
  }
  function sell(p) {
    if (!isOwned(p)) return;
    const v = sellValue(p); G.cash = cashNow() + v;
    delete save.owned[p.id]; releaseStored(p.id);
    syncBuilt(p); refreshProp(p); rebuildSpots(); persist();
    G.showPopup('SOLD ' + p.id + ' FOR ' + lakh(v)); propPanel(p);
  }
  function startBuild(p) {
    const d = DESIGNS[bsel.design], cost = d.cost + (bsel.wall ? WALL_COST : 0);
    if (!isOwned(p) || save.owned[p.id].build) return;
    if (!pay(cost)) { builderPanel(p); return; }
    save.owned[p.id].build = { design: bsel.design, paint: PAINTS[bsel.paint][1], wall: bsel.wall, left: d.time, done: false };
    syncBuilt(p); persist(); closePanel(); G.showPopup('CONSTRUCTION STARTED · ' + d.name.toUpperCase());
  }
  function setWaypoint(x, z, label) { waypoint = { x, z, label }; G.showPopup('WAYPOINT SET · ' + label); }
  const incomeOf = p => { const o = save.owned[p.id]; if (!o) return 0; return p.income + (o.build && o.build.done ? DESIGNS[o.build.design].income : 0); };
  const dailyIncome = () => props.reduce((s, p) => s + incomeOf(p), 0) - Object.values(save.bays).filter(b => b.rent).length * BAY_RENT;

  // ------------------------------------------------------------------ save / load
  function persist() { try { save.cash = G.cash; localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, owned: save.owned, bays: save.bays, stored: save.stored, cash: save.cash })); } catch (e) {} updateHud(); }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.v === 1) save = { owned: s.owned || {}, bays: s.bays || {}, stored: s.stored || {}, cash: s.cash }; } catch (e) {}
    for (const id in save.owned) if (!byId[id]) delete save.owned[id];
    // an empty save left behind with ₹0 (nothing owned yet) shouldn't wipe out the new-player starting money
    const ownsSomething = Object.keys(save.owned).length || Object.keys(save.bays).length || Object.keys(save.stored).length;
    if (typeof save.cash === 'number' && isFinite(save.cash) && (save.cash > 0 || ownsSomething)) G.cash = save.cash;
  }

  // ------------------------------------------------------------------ map overlays
  function overlayCanvases() {
    mapCv = document.createElement('canvas'); mapCv.id = 'propMapOverlay';
    mapCv.style.cssText = 'position:fixed;pointer-events:none;z-index:31;display:none;border-radius:12px';
    radCv = document.createElement('canvas'); radCv.id = 'propRadar'; radCv.width = radCv.height = 220;
    radCv.style.cssText = 'position:fixed;right:17px;bottom:17px;width:220px;height:220px;border-radius:50%;pointer-events:none;z-index:12;display:none';
    document.body.append(mapCv, radCv);
  }
  function icon(g, x, y, kind, col, s) {
    s = s || 1; g.save(); g.translate(x, y); g.scale(s, s); g.lineWidth = 1.6; g.strokeStyle = '#0b1220';
    if (kind === 'home') { g.fillStyle = col; g.beginPath(); g.moveTo(0, -8); g.lineTo(8, -1); g.lineTo(6, -1); g.lineTo(6, 7); g.lineTo(-6, 7); g.lineTo(-6, -1); g.lineTo(-8, -1); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#0b1220'; g.fillRect(-1.6, 2, 3.2, 5); }
    else { g.fillStyle = col; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#0b1220'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(kind, 0, 0.5); }
    g.restore();
  }
  function markerList() {
    const out = [];
    for (const p of props) {
      const o = save.owned[p.id];
      if (o) out.push({ x: p.x, z: p.z, kind: (p.type === 'garage' || (o.build && o.build.design === 'garage')) ? 'G' : 'home', col: '#38bdf8', label: p.id });
      else out.push({ x: p.x, z: p.z, kind: p.type === 'plot' ? 'P' : p.type === 'shop' ? 'S' : p.type === 'garage' ? 'G' : '₹', col: p.type === 'shop' ? '#f59e0b' : p.type === 'plot' ? '#a3e635' : p.type === 'garage' ? '#93c5fd' : '#4ade80', label: lakh(p.price) });
    }
    for (const L of lots) out.push({ x: L.x, z: L.z, kind: 'P', col: '#60a5fa', label: L.name, lot: true });
    for (const s of garageSpots) if (s.bay) out.push({ x: s.x, z: s.z, kind: 'G', col: '#38bdf8', label: 'My Garage' });
    return out;
  }
  function drawBig() {
    const big = document.getElementById('bigmap'), on = big && big.style.display === 'block';
    mapCv.style.display = on ? 'block' : 'none'; if (!on) return;
    const r = big.getBoundingClientRect(); Object.assign(mapCv.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const W = big.width || big.clientWidth, H = big.height || big.clientHeight;
    if (mapCv.width !== W || mapCv.height !== H) { mapCv.width = W; mapCv.height = H; }
    // same projection as MP.bigMap; uses MP.mapView if mp.js exposes it, else the default (zoom 1, centred)
    const [x0, z0, x1, z1] = G.world.bounds, v = (window.MP && MP.mapView) || null;
    const cx = v ? v.cx : (x0 + x1) / 2, cz = v ? v.cz : (z0 + z1) / 2, s = Math.min(W / (x1 - x0), H / (z1 - z0)) * (v ? v.zoom : 1);
    const P = (x, z) => [W / 2 + (x - cx) * s, H / 2 + (z - cz) * s];
    const g = mapCv.getContext('2d'); g.clearRect(0, 0, W, H);
    const sc = Math.max(0.8, Math.min(1.4, s * 1.5));
    for (const m of markerList()) { const [px, py] = P(m.x, m.z); icon(g, px, py, m.kind, m.col, sc); if (m.label === 'My Garage' || m.kind === 'home') { g.fillStyle = '#e0f2fe'; g.font = 'bold 11px system-ui'; g.fillText(m.label, px + 10, py + 4); } }
    if (waypoint) { const [px, py] = P(waypoint.x, waypoint.z), [cx2, cy2] = P(G.carPos.x, G.carPos.z);
      g.strokeStyle = '#e879f9'; g.setLineDash([6, 5]); g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx2, cy2); g.lineTo(px, py); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#e879f9'; g.beginPath(); g.arc(px, py, 7, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.fillText(waypoint.label, px + 10, py - 8); }
    g.fillStyle = 'rgba(10,15,25,.8)'; g.fillRect(W - 300, H - 30, 290, 22); g.fillStyle = '#cbd5e1'; g.font = '12px system-ui';
    g.fillText('₹ house · S shop · P plot/parking · blue house = yours · G garage', W - 292, H - 14);
  }
  function drawRadarOverlay() {
    const rad = document.getElementById('radar'), st = document.getElementById('start'); const on = rad && getComputedStyle(rad).display !== 'none' && !(st && getComputedStyle(st).display !== 'none');
    radCv.style.display = on ? 'block' : 'none'; if (hud) hud.style.display = on ? '' : 'none'; if (!on) return;
    const r = rad.getBoundingClientRect(); radCv.style.left = r.left + 3 + 'px'; radCv.style.top = r.top + 3 + 'px'; radCv.style.right = radCv.style.bottom = 'auto';
    const g = radCv.getContext('2d'); g.clearRect(0, 0, 220, 220); g.save(); g.beginPath(); g.arc(110, 110, 108, 0, 7); g.clip();
    const a = Math.PI + gRot(), c = Math.cos(a), s = Math.sin(a), K = 0.9, cp = G.carPos;
    const pr = (x, z) => { const dx = x - cp.x, dz = z - cp.z; return [(dx * c - dz * s) * K, (dx * s + dz * c) * K]; };
    for (const m of markerList()) {
      let [rx, rz] = pr(m.x, m.z); const d = Math.hypot(rx, rz);
      if (d > 100) { if (m.kind !== 'home' && m.label !== 'My Garage') continue; rx *= 100 / d; rz *= 100 / d; }
      icon(g, 110 + rx, 110 + rz, m.kind, m.col, 0.75);
    }
    if (waypoint) {
      const [rx, rz] = pr(waypoint.x, waypoint.z), d = Math.hypot(rx, rz), k = Math.min(1, 100 / (d || 1));
      g.strokeStyle = '#e879f9'; g.lineWidth = 3; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(110, 110); g.lineTo(110 + rx * k, 110 + rz * k); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#e879f9'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(110 + rx * k, 110 + rz * k, 6, 0, 7); g.fill(); g.stroke();
    }
    g.restore();
  }
  function updateHud() {
    if (!hud) return;
    const n = props.filter(isOwned).length, bays = Object.keys(save.bays).length;
    hud.innerHTML = `<b>Properties</b> ${n}${bays ? ' · bays ' + bays : ''} · ${fmt(dailyIncome())}/day<br><span style="color:#94a3b8">P: my properties${waypoint ? ' · ⟶ ' + esc(waypoint.label) + ' ' + Math.round(Math.hypot(waypoint.x - G.carPos.x, waypoint.z - G.carPos.z)) + ' m' : ''}</span>`;
  }

  // ------------------------------------------------------------------ interaction
  function nearestInteract() {
    const cp = G.carPos, mode = G.playerMode;
    if (mode === 'vehicle') { for (const s of garageSpots) if (Math.hypot(s.x - cp.x, s.z - cp.z) < 4) return { spot: s }; return null; }
    if (mode !== 'foot') return null;
    for (const p of props) if (Math.hypot(p.x - cp.x, p.z - cp.z) < 1.4) return { p };
    for (const L of lots) if (Math.hypot(L.x - cp.x, L.z - cp.z) < 1.6) return { L };
    return null;
  }
  let hint = null, cur = null;
  function interact() {
    cur = nearestInteract(); if (!cur) return false;
    if (cur.p) { const o = save.owned[cur.p.id]; if (o && cur.p.type === 'plot' && !o.build) builderPanel(cur.p); else propPanel(cur.p); }
    else if (cur.L) lotPanel(cur.L);
    else if (cur.spot) { if (save.stored[cur.spot.id] && spawned[cur.spot.id] && spawned[cur.spot.id] !== (PL() && PL().active)) G.showPopup('BAY ALREADY HAS A VEHICLE'); else storeVehicle(cur.spot); }
    return true;
  }

  // ------------------------------------------------------------------ hooks
  GameHooks.init.push(game => {
    G = game; css();
    panel = document.createElement('div'); panel.id = 'propPanel'; panel.addEventListener('click', onPanelClick);
    hud = document.createElement('div'); hud.id = 'propHud'; hint = document.createElement('div'); hint.id = 'propHint';
    document.body.append(panel, hud, hint); overlayCanvases();
    for (const r of G.world.roads) for (let i = 1; i < r.p.length; i++) { const a = r.p[i - 1], b = r.p[i]; roadSegs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, hl: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, w: r.w || 4, t: r.t }); }
    pickProperties(); load();
    props.forEach(p => { refreshProp(p); if (save.owned[p.id]) syncBuilt(p); });
    rebuildSpots(); initLots(); spawnStored(); lastTod = gTime(); updateHud();
    window.Properties = { props, get save() { return save; }, markers: markerList, buy: id => buy(byId[id]), sell: id => sell(byId[id]), byId, garageSpots, spawned, persist, setWaypoint, lots };
  });

  let t = 0;
  GameHooks.update.push((dt, game) => {
    if (!G) return; t += dt;
    if (!lots.length && lotsTried < 30 && (t > lotsTried * 2)) { lotsTried++; initLots(); }
    // markers pulse; hide far ones
    const cp = G.carPos, pulse = 0.55 + 0.45 * Math.sin(t * 3);
    for (const p of props) { const d = Math.hypot(p.x - cp.x, p.z - cp.z), m = p.marker; m.visible = d < 140; if (m.visible) { m.userData.ring.material.opacity = 0.5 + 0.45 * pulse; m.userData.beam.material.opacity = 0.08 + 0.1 * pulse; m.userData.ring.rotation.y = t; } p.board.visible = d < 170; }
    for (const L of lots) L.marker.visible = Math.hypot(L.x - cp.x, L.z - cp.z) < 140;
    // construction
    for (const p of props) {
      const o = save.owned[p.id]; if (!o || !o.build || o.build.done) continue;
      const b = o.build, D = DESIGNS[b.design]; b.left -= dt;
      const ent = built[p.id]; if (ent && ent.cons) { const k = Math.max(0.02, 1 - b.left / D.time); ent.cons.userData.shell.scale.y = k * ent.cons.userData.H; }
      const pct = Math.floor((1 - Math.max(0, b.left) / D.time) * 20) * 5;
      if (p._pct !== pct) { p._pct = pct; setBoard(p.board, { head: 'BUILDING', headCol: '#c2410c', te: 'నిర్మాణంలో ఉంది · ' + pct + '%', price: D.name.split(' (')[0].split(',')[0], sub: 'Owner: ' + playerName() + ' · ' + p.id }); }
      if (b.left <= 0) { b.done = true; delete b.left; p._pct = null; syncBuilt(p); refreshProp(p); persist(); G.showPopup('HOUSE READY · ' + D.name.toUpperCase()); }
    }
    // daily income at midnight
    const tod = gTime();
    if (lastTod != null && tod < lastTod - 12) {
      const inc = dailyIncome();
      if (inc < 0 && !canAfford(-inc)) {
        // can't pay the parking rent: the rented bays go back, cash never goes negative
        for (const id in save.bays) if (save.bays[id].rent) { delete save.bays[id]; releaseStored(id); }
        rebuildSpots(); refreshBays(); G.showPopup('RENT UNPAID · RENTED BAYS RETURNED');
        const inc2 = dailyIncome(); if (inc2 > 0) G.cash = cashNow() + inc2;
      } else if (inc) { G.cash = cashNow() + inc; G.showPopup((inc > 0 ? 'PROPERTY INCOME +' : 'PARKING RENT ') + fmt(Math.abs(inc))); }
      persist();
    }
    lastTod = tod;
    // stored vehicles: once one is driven away from its bay it is no longer stored
    for (const id in spawned) { const v = spawned[id], s = garageSpots.find(q => q.id === id); if (!s) continue;
      if (Math.hypot(v.g.position.x - s.x, v.g.position.z - s.z) > 15 && (!PL() || PL().active !== v)) { delete spawned[id]; delete save.stored[id]; persist(); }
      else if (v._waiting && G.playerMode === 'foot') { const dx = cp.x - v.g.position.x, dz = cp.z - v.g.position.z, dd = Math.hypot(dx, dz), r = 1.6; if (dd < r && dd > 0.01) { cp.x = v.g.position.x + dx / dd * r; cp.z = v.g.position.z + dz / dd * r; } } }
    // built houses push the player out (they are not in world.collide)
    if (G.playerMode === 'foot' || G.playerMode === 'vehicle') for (const id in built) {
      const p = byId[id], e = built[id]; if (e.design === 'garage') continue;
      const c = Math.cos(p.plot.rot), s = Math.sin(p.plot.rot), dx = cp.x - p.plot.x, dz = cp.z - p.plot.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c, hw = 5.6, z0 = -7.6, z1 = 2.6;
      if (Math.abs(lx) < hw && lz > z0 && lz < z1) { const pushX = hw - Math.abs(lx), pushZ = Math.min(lz - z0, z1 - lz); let nlx = lx, nlz = lz;
        if (pushX < pushZ) nlx = Math.sign(lx || 1) * hw; else nlz = lz - z0 < z1 - lz ? z0 : z1;
        cp.x = p.plot.x + nlx * c + nlz * s; cp.z = p.plot.z - nlx * s + nlz * c; }
    }
    // waypoint arrival
    if (waypoint && Math.hypot(waypoint.x - cp.x, waypoint.z - cp.z) < 6) { G.showPopup('ARRIVED · ' + waypoint.label); waypoint = null; }
    // prompt
    cur = panelOpen() ? null : nearestInteract();
    if (cur) { hint.style.display = 'block'; hint.innerHTML = '<kbd>E</kbd>' + (cur.spot ? 'Store vehicle in ' + esc(cur.spot.label) : cur.L ? esc(cur.L.name) + ' · parking bays' : isOwned(cur.p) ? (cur.p.type === 'plot' && !save.owned[cur.p.id].build ? 'Build on your plot' : 'Manage ' + cur.p.id) : TYPE_INFO[cur.p.type].en + ' for sale · ' + lakh(cur.p.price)); }
    else hint.style.display = 'none';
    if (panelOpen() && G.playerMode !== 'foot' && panel.dataset.kind !== 'list') closePanel();
    // cash changed while a buy panel is open (mission reward, income): redraw so Buy enables / disables
    if (panelOpen() && panel._cash !== cashNow()) {
      const k = panel.dataset.kind, id = panel.dataset.id;
      if (k === 'prop' && byId[id]) propPanel(byId[id]); else if (k === 'builder' && byId[id]) builderPanel(byId[id]);
      else if (k === 'lot') { const L = lots.find(l => l.id === id); if (L) lotPanel(L); }
    }
    if (panelOpen()) panel._cash = cashNow();
    drawBig(); drawRadarOverlay();
    saveTimer += dt; if (saveTimer > 5) { saveTimer = 0; if (save.cash !== G.cash) persist(); else updateHud(); }
  });

  GameHooks.key.push((e, game) => {
    if (!G) return false;
    if (e.code === 'KeyE' && !e.repeat) { if (panelOpen()) { closePanel(); return true; } return interact(); }
    if (e.code === 'KeyP' && !e.repeat) { if (panelOpen() && panel.dataset.kind === 'list') closePanel(); else listPanel(); return true; }
    if (e.code === 'Escape' && panelOpen()) { closePanel(); return true; }
    if (e.code === 'KeyF' && !e.repeat && G.playerMode === 'foot') {
      // stored vehicles enter the traffic list only now, so Player.getIn can find and take them
      for (const id in spawned) { const v = spawned[id]; if (v._waiting && Math.hypot(v.g.position.x - G.carPos.x, v.g.position.z - G.carPos.z) < 5 && !G.traffic.includes(v)) { v._waiting = false; G.traffic.push(v);
        queueMicrotask(() => { const i = G.traffic.indexOf(v); if (i >= 0) { G.traffic.splice(i, 1); v._waiting = true; } }); } }   // not taken: back out before traffic.update sees it
    }
    return false;
  });
})();
