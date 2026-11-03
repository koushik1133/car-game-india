// safehouse2.js: version 2 of the player's home, rebuilt from the user's Street View photos (Nellutla, Oct 2022).
// Stands on map building #317 (the real house, ~17.70398 N 79.19688 E) and replaces version 1 (safehouse.js is now
// empty). Local frame: a along the CC lane east_diag (ENE), b into the plot (SSE); plot a = -19.5 .. -1.1, b = -2.8 .. 14.
// The plot is reserved in nellutla-map/tools/map_fixes.json (no generic buildings, walls or trees inside).
//
// What is reproduced: long single-storey front wing with a stepped parapet of 6 OPEN LOUVRE ziggurat merlons,
// a 3-bay scalloped (multifoil) arcade outlined in dark grey, a tall aubergine feature wall with 3 stacked square
// windows, a dark grey louvre screen beside it, a tall cream block, a lower flat wing with a thick grey cornice and
// brown wooden windows, grey stair room with a sloped asbestos roof, satellite dish, black tank on a stand, brown
// sunshade, porch with a pointed-crown scalloped arch, cream ceiling + pendant light, red/yellow checkerboard
// courtyard, cream front wall with wavy scalloped top + black iron rods, lilac side wall, black wrought-iron gates
// with gold fleur-de-lis / scrolls / rosettes and an arched top, cream piers with purple caps, pedestrian gate with a
// red/yellow step, hibiscus, croton, oleander, bougainvillea arch, small Indian flag at the corner.
//
// Controls (same as v1): gate opens on approach in a vehicle or E on foot; front door E; store a vehicle in a slot
// with E (saved to localStorage 'nellutla.safehouse2'); bed E = sleep + save; wardrobe E.
(function () {
  'use strict';
  const SAVE_KEY = 'nellutla.safehouse2';

  // ---------------------------------------------------------------- frame
  // Same axes as the old v1 frame (a along the lane ENE, b into the plot SSE), origin moved 14 m along the lane from
  // v1's front-west corner (38.8,-272.2) so the plot (a -19.5 .. -1.1) now covers map building #317, the real house,
  // with its east wall 0.5 m clear of lane se_ns and the front wall facing lane east_diag.
  const UX = 13.2 / 14.857, UZ = 6.8 / 14.857;
  // the house sits 1.5 m further back than the first cut (more courtyard in front); the front wall stays on the lane
  const SET = 1.5;
  const O = { x: 38.8 + 14 * UX - SET * UZ, z: -272.2 + 14 * UZ + SET * UX };
  // the generic footprint #317 is also dropped by nellutla-map/tools/map_fixes.json; keep this for older map data
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 42.4, z: -263.0, r: 4 });
  const NX = -UZ, NZ = UX;
  const TH = Math.atan2(-UZ, UX);
  const W = (a, b) => ({ x: O.x + a * UX + b * NX, z: O.z + a * UZ + b * NZ });
  const L = (x, z) => { const dx = x - O.x, dz = z - O.z; return { a: dx * UX + dz * UZ, b: dx * NX + dz * NZ }; };
  const YARD = { a0: -19.5, a1: -1.1, b0: -2.8 - SET, b1: 14 };
  const HALL = { a0: -14, a1: -6.8, b0: 3.0, b1: 12.8 };

  // ---------------------------------------------------------------- state
  let G = null, world = null, scene = null, root = null;
  const S = { stored: [] };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && Array.isArray(s.stored)) S.stored = s.stored; } catch (e) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, stored: S.stored.map(s => ({ kind: s.kind, slot: s.slot, color: s.color })) })); } catch (e) {} }
  const live = {};
  const PL = () => { try { return Player; } catch (e) { return null; } };
  const TM = () => { try { return TrafficModels; } catch (e) { return null; } };

  // ---------------------------------------------------------------- leaf-card foliage (shared; one instanced draw per caller)
  window.LeafCards = window.LeafCards || (function () {
    let tex = null;
    function leafTex() {
      if (tex) return tex;
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
      x.clearRect(0, 0, 64, 64);
      const leaf = (cx, cy, a, l, w, s) => { x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = s; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(w, -l * 0.5, 0, -l); x.quadraticCurveTo(-w, -l * 0.5, 0, 0); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -l * 0.9); x.stroke(); x.restore(); };
      const sh = ['#ffffff', '#e6e6e6', '#cfcfcf'];
      for (let i = 0; i < 9; i++) { const a = -2.4 + i * 0.6; leaf(32 + Math.cos(a + 1.57) * 4, 34 + Math.sin(a + 1.57) * 4, a, 22 + (i % 3) * 4, 7, sh[i % 3]); }
      tex = new THREE.CanvasTexture(cv); return tex;
    }
    return function make() {
      const L = [];      // [x,y,z, rx,ry,rz, size, hex]
      let sd = 97; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      return {
        // a shrub/canopy: n cards in an ellipsoid; cols = [[hex, weight], ...]
        blob(x, y, z, rx, ry, rz, n, cols, size) {
          const tot = cols.reduce((s, c) => s + c[1], 0);
          for (let i = 0; i < n; i++) {
            let u = rnd() * tot, c = cols[0][0]; for (const [h, w] of cols) { if ((u -= w) <= 0) { c = h; break; } }
            const t = rnd() * 6.283, p = Math.acos(2 * rnd() - 1), r = Math.cbrt(0.35 + 0.65 * rnd());
            L.push([x + Math.sin(p) * Math.cos(t) * rx * r, y + Math.cos(p) * ry * r, z + Math.sin(p) * Math.sin(t) * rz * r, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, (size || 0.35) * (0.7 + rnd() * 0.6), c]);
          }
        },
        mesh() {
          const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: leafTex(), alphaTest: 0.5, side: THREE.DoubleSide }), L.length);
          const d = new THREE.Object3D(), c = new THREE.Color();
          L.forEach((q, i) => { d.position.set(q[0], q[1], q[2]); d.rotation.set(q[3], q[4], q[5]); d.scale.setScalar(q[6]); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, c.set(q[7])); });
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          return m;
        },
      };
    };
  })();

  // ---------------------------------------------------------------- merged vertex-coloured builder
  function Builder() {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    function addGeo(geo, m, color) {
      const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m);
      const p = g.attributes.position.array, n = g.attributes.normal.array; c.set(color);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
      geo.dispose && geo.dispose();
    }
    const m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    return {
      box(a0, a1, y0, y1, b0, b1, color) { m4.makeTranslation((a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2); addGeo(new THREE.BoxGeometry(Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(b1 - b0)), m4, color); },
      geo(geo, x, y, z, rx, ry, rz, color) { e.set(rx || 0, ry || 0, rz || 0); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, sc); addGeo(geo, m4, color); },
      mesh(mat) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        return new THREE.Mesh(g, mat || new THREE.MeshLambertMaterial({ vertexColors: true }));
      },
    };
  }
  function lines(segs, color) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color })); }
  function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t; }

  // ---------------------------------------------------------------- textures
  const GOLD = '#d4a82a';
  function fleur(x, cx, y, s) {          // gold fleur-de-lis spear tip, point at y
    x.fillStyle = GOLD; x.beginPath(); x.moveTo(cx, y); x.quadraticCurveTo(cx + s * 0.55, y + s * 0.6, cx, y + s * 1.1); x.quadraticCurveTo(cx - s * 0.55, y + s * 0.6, cx, y); x.fill();
    x.beginPath(); x.arc(cx - s * 0.5, y + s * 0.95, s * 0.3, 0, Math.PI * 2); x.arc(cx + s * 0.5, y + s * 0.95, s * 0.3, 0, Math.PI * 2); x.fill();
    x.fillRect(cx - s * 0.6, y + s * 1.15, s * 1.2, s * 0.22);
  }
  // one leaf of the main gate: hinge on the left, free edge on the right; top arches up toward the free edge
  const gateLeafTex = (arched, hM) => canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.lineCap = 'round';
    const top = t => arched ? h - h * (1.55 + 0.45 * Math.sin(t * Math.PI / 2)) / hM : h * 0.12;
    const yb = h - 4;
    // frame
    x.strokeStyle = '#111'; x.lineWidth = 7;
    x.beginPath(); x.moveTo(4, yb); x.lineTo(4, top(0)); x.stroke(); x.beginPath(); x.moveTo(w - 4, yb); x.lineTo(w - 4, top(1)); x.stroke();
    x.beginPath(); x.moveTo(0, yb); x.lineTo(w, yb); x.stroke();
    x.beginPath(); for (let i = 0; i <= 20; i++) { const t = i / 20, y = top(t) + 18; i ? x.lineTo(t * w, y) : x.moveTo(0, y); } x.stroke();
    const yMid0 = h - h * 0.95 / hM, yMid1 = h - h * 1.25 / hM;
    x.beginPath(); x.moveTo(0, yMid0); x.lineTo(w, yMid0); x.moveTo(0, yMid1); x.lineTo(w, yMid1); x.moveTo(0, h - h * 0.2 / hM); x.lineTo(w, h - h * 0.2 / hM); x.stroke();
    // bars with fleur-de-lis tips
    x.lineWidth = 4;
    for (let bx = 16; bx < w - 8; bx += 17) { const t = bx / w, ty = top(t); x.strokeStyle = '#111'; x.beginPath(); x.moveTo(bx, yb); x.lineTo(bx, ty + 10); x.stroke(); fleur(x, bx, ty - 2, 8); }
    // scroll band: S scrolls (black) with gold rosettes
    x.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const cx = 26 + i * 50, cy = (yMid0 + yMid1) / 2, r = (yMid0 - yMid1) / 2 - 3;
      x.strokeStyle = '#111'; x.beginPath(); x.arc(cx - r, cy, r, -Math.PI / 2, Math.PI / 2); x.stroke(); x.beginPath(); x.arc(cx + r, cy, r, Math.PI / 2, Math.PI * 1.5); x.stroke();
      x.strokeStyle = GOLD; x.beginPath(); x.arc(cx, cy, r * 0.75, 0, Math.PI * 2); x.stroke();
      x.fillStyle = GOLD; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; x.beginPath(); x.arc(cx + Math.cos(a) * r * 0.38, cy + Math.sin(a) * r * 0.38, r * 0.22, 0, Math.PI * 2); x.fill(); }
    }
    // gold C-scrolls at the bottom
    x.strokeStyle = GOLD; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const cx = 22 + i * 42, cy = h - h * 0.45 / hM; x.beginPath(); x.arc(cx, cy, 10, 0.3, Math.PI * 1.7); x.stroke(); x.beginPath(); x.arc(cx + 20, cy, 10, Math.PI + 0.3, Math.PI * 2.7); x.stroke(); }
  });
  const flagTex = () => canvasTex(96, 64, (x) => {
    x.fillStyle = '#ff9933'; x.fillRect(0, 0, 96, 22); x.fillStyle = '#ffffff'; x.fillRect(0, 21, 96, 22); x.fillStyle = '#138808'; x.fillRect(0, 42, 96, 22);
    x.strokeStyle = '#000080'; x.lineWidth = 1.5; x.beginPath(); x.arc(48, 32, 8, 0, Math.PI * 2); x.stroke();
  });
  const tvTex = () => canvasTex(64, 36, (x) => { const gr = x.createLinearGradient(0, 0, 64, 36); gr.addColorStop(0, '#1d3d6b'); gr.addColorStop(1, '#5a2a68'); x.fillStyle = gr; x.fillRect(0, 0, 64, 36); });

  // ---------------------------------------------------------------- colliders
  const cols = [];
  function col(a0, a1, b0, b1) {
    if (!world.addCollider) return null;
    const c = W((a0 + a1) / 2, (b0 + b1) / 2), h = world.addCollider(c.x, c.z, Math.abs(a1 - a0) / 2, Math.abs(b1 - b0) / 2, TH);
    cols.push(h); return h;
  }
  function Blocker(a0, a1, b0, b1) { let h = null; return { set(on) { if (on && !h) h = col(a0, a1, b0, b1); else if (!on && h) { world.removeCollider(h); h = null; } } }; }

  // ---------------------------------------------------------------- colours (photos)
  const C = {
    cream: '#efdcae', creamDk: '#d9c48f', white: '#f6f4ec', grey: '#4b4b4d', greyMid: '#8a8b88', cornice: '#9a9b97',
    aub: '#4e2340', aubDk: '#3a1830', lilac: '#b9a2c9', lilacDk: '#9e86b0', wood: '#6b3f22', woodDk: '#43281a',
    red: '#b8352a', yellow: '#e3b836', black: '#151515', glass: '#2a3238', plinth: '#8c8478', sheet: '#a9aca6',
    green: '#3f7a2c', green2: '#2f6324', croton: '#b6c43a', hib: '#d4202a', oleander: '#f08cb8', bougain: '#d2287a', floor: '#d8cfc0',
  };
  const FLOOR = 0.12, ROOF = 3.3, T = 0.23;

  function build() {
    root = new THREE.Group(); root.position.set(O.x, 0, O.z); root.rotation.y = TH; root.name = 'safehouse2';
    const B = Builder(), edges = [];
    const E = (a0, y0, b0, a1, y1, b1) => edges.push(a0, y0, b0, a1, y1, b1);
    const edgeBox = (a0, a1, y0, y1, b0, b1) => {
      const P = [[a0, y0, b0], [a1, y0, b0], [a1, y0, b1], [a0, y0, b1], [a0, y1, b0], [a1, y1, b0], [a1, y1, b1], [a0, y1, b1]];
      for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) edges.push(...P[i], ...P[j]);
    };
    const tile = (a, b, s, y, color) => B.geo(new THREE.PlaneGeometry(s, s), a, y, b, -Math.PI / 2, 0, 0, color);

    // ================= front wing (single storey, a -14 .. -6.8)
    // plinth + floors
    B.box(-14.1, -6.6, 0, FLOOR, 0.5, 12.9, C.plinth);
    B.box(-14, -6.8, FLOOR, FLOOR + 0.01, 3.0, 12.8, C.floor);
    // veranda floor: red/yellow checker
    for (let a = -13.85; a < -9.4; a += 0.5) for (let b = 0.85; b < 3.0; b += 0.5) tile(a, b, 0.5, FLOOR + 0.012, ((Math.round(a * 2) + Math.round(b * 2)) & 1) ? C.red : C.yellow);
    // porch (projects in front, a -9.4 .. -6.8, b -0.6 .. 3.0)
    B.box(-9.6, -6.6, 0, FLOOR, -0.8, 0.5, C.plinth);
    for (let a = -9.15; a < -6.8; a += 0.5) for (let b = -0.55; b < 3.0; b += 0.5) tile(a, b, 0.5, FLOOR + 0.012, ((Math.round(a * 2) + Math.round(b * 2)) & 1) ? C.red : C.yellow);
    B.box(-9.0, -7.2, 0, 0.06, -1.2, -0.8, C.red); // porch step

    // walls with openings (wallA along a at depth b, wallB along b at a)
    const wallA = (b, a0, a1, gaps, color, H) => {
      H = H || ROOF; let a = a0;
      for (const [g0, g1, sill, head] of [...gaps, [a1, a1, 0, 0]]) {
        if (g0 > a) { B.box(a, g0, FLOOR, H, b - T / 2, b + T / 2, color); col(a, g0, b - T / 2, b + T / 2); }
        if (g1 > g0) { if (sill > 0) B.box(g0, g1, FLOOR, sill, b - T / 2, b + T / 2, color); if (head < H) B.box(g0, g1, head, H, b - T / 2, b + T / 2, color); if (sill > 0.5) col(g0, g1, b - T / 2, b + T / 2); }
        a = g1;
      }
    };
    const wallB = (a, b0, b1, gaps, color, H) => {
      H = H || ROOF; let b = b0;
      for (const [g0, g1, sill, head] of [...gaps, [b1, b1, 0, 0]]) {
        if (g0 > b) { B.box(a - T / 2, a + T / 2, FLOOR, H, b, g0, color); col(a - T / 2, a + T / 2, b, g0); }
        if (g1 > g0) { if (sill > 0) B.box(a - T / 2, a + T / 2, FLOOR, sill, g0, g1, color); if (head < H) B.box(a - T / 2, a + T / 2, head, H, g0, g1, color); if (sill > 0.5) col(a - T / 2, a + T / 2, g0, g1); }
        b = g1;
      }
    };
    const DOOR = [-8.8, -7.8];
    wallA(3.0, -14, -6.8, [[-13.2, -12.0, 0.9, 2.1], [-11.2, -10.2, 0.9, 2.1], DOOR.concat([0, 2.2])], C.cream);
    wallA(12.8, -14, -6.8, [[-12, -11, 0.9, 2.1], [-9, -8, 0.9, 2.1]], C.cream);
    wallB(-6.8, 3.0, 12.8, [[4.4, 5.4, 0.9, 2.1], [9.8, 10.8, 0.9, 2.1]], C.cream);
    wallA(8.0, -14, -6.9, [[-11, -9.9, 0, 2.2]], '#f3ead4');                         // partition: front room | bedroom
    // brown wooden windows (frame + shutters + bars)
    const winA = (b, g0, g1, sill, head, out) => {
      B.box(g0 - 0.08, g1 + 0.08, sill - 0.08, head + 0.08, b + out * 0.12, b + out * 0.16, C.wood);
      B.box(g0, g1, sill, head, b - 0.03, b + 0.03, C.glass);
      B.box((g0 + g1) / 2 - 0.03, (g0 + g1) / 2 + 0.03, sill, head, b + out * 0.1, b + out * 0.14, C.wood);
      for (let a = g0 + 0.13; a < g1 - 0.05; a += 0.15) B.box(a, a + 0.025, sill, head, b + out * 0.06, b + out * 0.09, C.black);
    };
    const winB = (a, g0, g1, sill, head, out) => {
      B.box(a + out * 0.12, a + out * 0.16, sill - 0.08, head + 0.08, g0 - 0.08, g1 + 0.08, C.wood);
      B.box(a - 0.03, a + 0.03, sill, head, g0, g1, C.glass);
      for (let b = g0 + 0.13; b < g1 - 0.05; b += 0.15) B.box(a + out * 0.06, a + out * 0.09, sill, head, b, b + 0.025, C.black);
    };
    winA(3.0, -13.2, -12.0, 0.9, 2.1, -1); winA(3.0, -11.2, -10.2, 0.9, 2.1, -1); winA(12.8, -12, -11, 0.9, 2.1, 1); winA(12.8, -9, -8, 0.9, 2.1, 1);
    winB(-6.8, 4.4, 5.4, 0.9, 2.1, 1); winB(-6.8, 9.8, 10.8, 0.9, 2.1, 1);
    // door frame + brown sunshade (chajja) over the door
    B.box(DOOR[0] - 0.1, DOOR[0], FLOOR, 2.3, 2.85, 3.15, C.woodDk); B.box(DOOR[1], DOOR[1] + 0.1, FLOOR, 2.3, 2.85, 3.15, C.woodDk); B.box(DOOR[0] - 0.1, DOOR[1] + 0.1, 2.2, 2.3, 2.85, 3.15, C.woodDk);
    // roof slab + ceiling (cream), grey slab edge
    B.box(-14.2, -6.6, ROOF, ROOF + 0.15, 0.4, 13.0, '#c9c2b4');
    B.box(-9.6, -6.6, ROOF, ROOF + 0.15, -0.8, 0.4, '#c9c2b4');
    B.box(-14, -6.8, ROOF - 0.02, ROOF - 0.01, 0.5, 12.8, '#f6eed6');
    B.box(-9.4, -6.8, ROOF - 0.02, ROOF - 0.01, -0.7, 0.5, '#f6eed6');
    B.box(-14.2, -9.6, ROOF - 0.1, ROOF, 0.4, 0.55, C.greyMid);

    // ================= arcade: 3 scalloped (multifoil) arches, cream, outlined dark grey
    const spring = 2.0;
    function foilArch(s0, s1, at, pointed, top) {
      const n = 28, w = s1 - s0, mid = (s0 + s1) / 2, R = w / 2;
      let prev = null;
      for (let i = 0; i < n; i++) {
        const x0 = s0 + w * i / n, x1 = s0 + w * (i + 1) / n, sm = (x0 + x1) / 2 - mid, u = Math.min(1, Math.abs(sm) / R);
        const th = Math.acos(Math.max(-1, Math.min(1, sm / R)));
        const lobe = 0.1 * Math.abs(Math.sin(th * 3.5));
        const rise = pointed ? 1.05 * Math.sqrt(Math.max(0, 1 - u)) : 0.85 * Math.sqrt(Math.max(0, 1 - u * u));
        const yb = Math.min(top - 0.05, spring + rise - lobe);
        B.box(x0, x1, yb, top, at - 0.12, at + 0.12, C.cream);
        E(x0, yb, at - 0.13, x1, yb, at - 0.13);
        if (prev != null) E(x0, prev, at - 0.13, x0, yb, at - 0.13);
        prev = yb;
      }
      E(s0, FLOOR, at - 0.13, s0, prev, at - 0.13);
    }
    const cols4 = [-14.0, -12.47, -10.93, -9.4];
    for (const a of cols4) { B.box(a - 0.15, a + 0.15, FLOOR, ROOF, 0.45, 0.75, C.cream); col(a - 0.15, a + 0.15, 0.45, 0.75); edgeBox(a - 0.15, a + 0.15, FLOOR, spring, 0.44, 0.76); }
    for (let i = 0; i < 3; i++) foilArch(cols4[i] + 0.15, cols4[i + 1] - 0.15, 0.6, false, ROOF);
    // low rail between arcade columns (open at the porch end)
    for (let i = 0; i < 2; i++) { B.box(cols4[i] + 0.15, cols4[i + 1] - 0.15, FLOOR, 0.7, 0.52, 0.68, C.cream); col(cols4[i] + 0.15, cols4[i + 1] - 0.15, 0.52, 0.68); }

    // ================= porch: pointed-crown scalloped arch, pendant light, brown sunshade
    for (const a of [-9.4, -6.8]) { B.box(a - 0.17, a + 0.17, FLOOR, ROOF, -0.77, -0.43, C.cream); col(a - 0.17, a + 0.17, -0.77, -0.43); edgeBox(a - 0.17, a + 0.17, FLOOR, 1.9, -0.78, -0.42); }
    foilArch(-9.23, -6.97, -0.6, true, ROOF);
    // porch side toward the courtyard is open (walk in from the yard too): one end pillar + a beam under the roof
    B.box(-6.97, -6.63, FLOOR, ROOF, 2.55, 2.9, C.cream); col(-6.97, -6.63, 2.55, 2.9);
    B.box(-6.97, -6.63, ROOF - 0.35, ROOF, -0.43, 2.55, C.cream);
    B.box(-9.9, -6.3, ROOF + 0.15, ROOF + 0.25, -1.4, 0.4, C.wood);                         // brown sunshade slab over the porch
    edgeBox(-9.9, -6.3, ROOF + 0.15, ROOF + 0.25, -1.4, 0.4);
    // little crown above the porch arch
    for (let k = 0; k < 3; k++) { const w = 1.0 - k * 0.3; B.box(-8.1 - w, -8.1 + w, ROOF + 0.25 + k * 0.18, ROOF + 0.43 + k * 0.18, -1.3, -1.1, C.white); edgeBox(-8.1 - w, -8.1 + w, ROOF + 0.25 + k * 0.18, ROOF + 0.43 + k * 0.18, -1.31, -1.09); }

    // ================= stepped parapet: 6 open-louvre ziggurat merlons (dark grey slats with gaps, white frames)
    const PY = ROOF + 0.15, FB = 0.5;
    B.box(-13.9, -9.7, PY, PY + 0.2, FB - 0.07, FB + 0.07, C.white); edgeBox(-13.9, -9.7, PY, PY + 0.2, FB - 0.08, FB + 0.08);
    function merlon(c) {
      const steps = [[0.95, 0.2, 0.5], [0.66, 0.5, 0.78], [0.38, 0.78, 1.04]];
      for (const [w, y0, y1] of steps) {
        const a0 = c - w / 2, a1 = c + w / 2;
        B.box(a0, a0 + 0.06, PY + y0, PY + y1, FB - 0.07, FB + 0.07, C.white); B.box(a1 - 0.06, a1, PY + y0, PY + y1, FB - 0.07, FB + 0.07, C.white);
        B.box(a0, a1, PY + y1 - 0.04, PY + y1, FB - 0.08, FB + 0.08, C.white);
        for (let y = y0 + 0.05; y < y1 - 0.06; y += 0.1) B.box(a0 + 0.06, a1 - 0.06, PY + y, PY + y + 0.045, FB - 0.05, FB + 0.05, C.grey);
        edgeBox(a0, a1, PY + y0, PY + y1, FB - 0.08, FB + 0.08);
      }
    }
    for (let i = 0; i < 6; i++) merlon(-13.45 + i * 0.75);
    // low parapet along the sides and back of the wing
    B.box(-6.75, -6.6, PY, PY + 0.6, 0.4, 13.0, C.white); B.box(-14.2, -6.6, PY, PY + 0.6, 12.85, 13.0, C.white);

    // ================= tall block: aubergine feature wall + louvre screen + tall cream block + lower flat wing
    const AUB = { a0: -15.3, a1: -14.0, b0: 0.35, b1: 1.45, h: 8.3 };
    B.box(AUB.a0, AUB.a1, 0, AUB.h, AUB.b0, AUB.b1, C.aub); B.box(AUB.a0 - 0.05, AUB.a1 + 0.05, AUB.h, AUB.h + 0.12, AUB.b0 - 0.05, AUB.b1 + 0.05, C.grey);
    col(AUB.a0, AUB.a1, AUB.b0, AUB.b1);
    for (const y of [4.3, 5.4, 6.5]) {        // 3 small square windows framed in dark grey
      const c = (AUB.a0 + AUB.a1) / 2, s = 0.3;
      B.box(c - s - 0.08, c + s + 0.08, y - s - 0.08, y + s + 0.08, AUB.b0 - 0.06, AUB.b0, C.grey);
      B.box(c - s, c + s, y - s, y + s, AUB.b0 - 0.08, AUB.b0 - 0.02, C.glass);
      B.box(c - 0.02, c + 0.02, y - s, y + s, AUB.b0 - 0.1, AUB.b0 - 0.07, C.grey);
    }
    // louvre screen: vertical stack of dark grey horizontal bars between the parapet and the purple wall
    B.box(-14.0, -13.94, ROOF, 7.4, 0.55, 0.75, C.grey); B.box(-13.2, -13.14, ROOF, 7.4, 0.55, 0.75, C.grey);
    for (let y = ROOF + 0.3; y < 7.35; y += 0.2) B.box(-13.94, -13.2, y, y + 0.08, 0.58, 0.72, C.grey);
    // tall cream block (two storeys) behind the purple wall
    const TB = { a0: -17.6, a1: -14.0, b0: 1.45, b1: 12.8, h: 7.0 };
    B.box(TB.a0, TB.a1, 0, TB.h, TB.b0, TB.b1, C.cream); col(TB.a0, TB.a1, TB.b0, TB.b1);
    B.box(TB.a0 - 0.1, TB.a1 + 0.05, TB.h, TB.h + 0.5, TB.b0 - 0.1, TB.b1 + 0.1, C.white);
    winA(TB.b0, -17.1, -15.8, 1.0, 2.2, -1); winA(TB.b0, -17.1, -15.8, 4.3, 5.5, -1);
    B.box(-17.3, -15.6, 2.4, 2.48, TB.b0 - 0.6, TB.b0, C.wood); B.box(-17.3, -15.6, 5.7, 5.78, TB.b0 - 0.6, TB.b0, C.wood);  // brown sunshades
    // lower flat-roofed wing with a thick grey cornice band and brown windows (one wide, high up)
    const LW = { a0: -19.3, a1: -17.6, b0: 1.0, b1: 12.8, h: 4.3 };
    B.box(LW.a0, LW.a1, 0, LW.h, LW.b0, LW.b1, C.cream); col(LW.a0, LW.a1, LW.b0, LW.b1);
    B.box(LW.a0 - 0.28, LW.a1, LW.h - 0.05, LW.h + 0.38, LW.b0 - 0.28, LW.b1 + 0.1, C.cornice);
    edgeBox(LW.a0 - 0.28, LW.a1, LW.h - 0.05, LW.h + 0.38, LW.b0 - 0.28, LW.b1 + 0.1);
    winA(LW.b0, -19.05, -17.85, 2.6, 3.6, -1); winA(LW.b0, -18.9, -18.0, 0.9, 2.0, -1);
    for (const b of [3.5, 7, 10.5]) { winB(LW.a0, b, b + 1.6, 2.7, 3.6, -1); }
    for (const b of [4, 9]) { winB(TB.a0, b, b + 1.1, 4.6, 5.6, -1); }

    // ================= roof: grey stair room with sloped asbestos sheet, satellite dish, black tank on a stand
    const SR = { a0: -9.9, a1: -7.2, b0: 9.0, b1: 12.6 };
    B.box(SR.a0, SR.a1, PY, PY + 2.3, SR.b0, SR.b1, C.greyMid);
    B.box(SR.a0 + 0.8, SR.a0 + 1.7, PY, PY + 2.0, SR.b0 - 0.03, SR.b0, C.wood);
    B.geo(new THREE.BoxGeometry(SR.a1 - SR.a0 + 0.5, 0.06, SR.b1 - SR.b0 + 0.6), (SR.a0 + SR.a1) / 2, PY + 2.55, (SR.b0 + SR.b1) / 2, 0.14, 0, 0, C.sheet);
    for (let a = SR.a0 - 0.2; a < SR.a1 + 0.2; a += 0.3) B.geo(new THREE.BoxGeometry(0.06, 0.05, SR.b1 - SR.b0 + 0.6), a, PY + 2.6, (SR.b0 + SR.b1) / 2, 0.14, 0, 0, '#8f938c');
    B.geo(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, 1.0), SR.a1 - 0.5, PY + 2.2, SR.b0 - 0.1, -1.2, 0.4, 0, '#e8e8e4');
    B.geo(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), SR.a1 - 0.5, PY + 1.95, SR.b0 + 0.1, 0, 0, 0, C.grey);
    for (const [da, db] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) B.box(-12.5 + da - 0.04, -12.5 + da + 0.04, PY, PY + 1.3, 11.2 + db - 0.04, 11.2 + db + 0.04, C.grey);
    B.box(-13.1, -11.9, PY + 1.3, PY + 1.36, 10.6, 11.8, C.grey);
    B.geo(new THREE.CylinderGeometry(0.55, 0.55, 1.05, 16), -12.5, PY + 1.9, 11.2, 0, 0, 0, '#1b1b1b');

    // ================= compound wall: front (cream, wavy scalloped top + black iron rods), lilac side wall
    const WB = YARD.b0, PG = [-9.7, -8.6], MG = [-6.3, -2.2];
    function pier(a, w, h, capColor) { B.box(a - w, a + w, 0, h, WB - w, WB + w, C.cream); B.box(a - w - 0.05, a + w + 0.05, h, h + 0.12, WB - w - 0.05, WB + w + 0.05, capColor); col(a - w, a + w, WB - w, WB + w); }
    function wavy(a0, a1) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const s0 = a0 + (a1 - a0) * i / n, s1 = a0 + (a1 - a0) * (i + 1) / n, t = (i + 0.5) / n, h = 1.0 + 0.62 * Math.pow(2 * t - 1, 2);
        B.box(s0, s1, 0, h, WB - 0.1, WB + 0.1, C.cream);
        if (i % 1 === 0) B.box((s0 + s1) / 2 - 0.012, (s0 + s1) / 2 + 0.012, h, 1.66, WB - 0.012, WB + 0.012, C.black);
      }
      B.box(a0, a1, 1.64, 1.68, WB - 0.015, WB + 0.015, C.black);
      B.box(a0, a1, 0, 0.3, WB - 0.12, WB + 0.12, C.plinth);
      col(a0, a1, WB - 0.12, WB + 0.12);
    }
    const piersA = [-19.5, -17.0, -14.5, -12.1, PG[0]];
    for (let i = 0; i < piersA.length - 1; i++) wavy(piersA[i] + 0.18, piersA[i + 1] - 0.18);
    wavy(PG[1] + 0.2, MG[0] - 0.25); wavy(MG[1] + 0.25, YARD.a1);
    for (const a of piersA.slice(0, 4)) pier(a, 0.18, 1.9, C.cream);
    for (const a of [PG[0], PG[1]]) pier(a, 0.2, 2.0, C.aub);
    for (const a of MG) pier(a, 0.25, 2.2, C.aub);
    // lilac side walls (west + east) and plain back wall
    const lil = (a0, a1, b0, b1, color, colDk) => { B.box(a0, a1, 0, 0.3, b0 - 0.02, b1 + 0.02, '#7d766c'); B.box(a0, a1, 0.3, 1.8, b0, b1, color); B.box(a0 - 0.03, a1 + 0.03, 1.8, 1.88, b0 - 0.03, b1 + 0.03, colDk); col(a0, a1, b0, b1); };
    lil(YARD.a0 - 0.11, YARD.a0 + 0.11, WB, YARD.b1, C.lilac, C.lilacDk);
    lil(YARD.a0, YARD.a1, YARD.b1 - 0.11, YARD.b1 + 0.11, C.cream, C.creamDk);
    // east side wall (along lane se_ns): the plot is fully enclosed, a car only gets in through the main gate
    lil(YARD.a1 - 0.11, YARD.a1 + 0.11, WB, YARD.b1, C.lilac, C.lilacDk);
    // courtyard: red/yellow checkerboard tiles, apron to the lane
    for (let a = -6.65; a < YARD.a1 - 0.2; a += 0.6) for (let b = WB + 0.25; b < YARD.b1 - 0.2; b += 0.6) tile(a, b, 0.6, 0.03, ((Math.round(a / 0.6) + Math.round(b / 0.6)) & 1) ? C.red : C.yellow);
    B.box(MG[0], MG[1], 0, 0.04, WB - 1.5, WB + 0.1, '#bdb8ae');
    // front path from the pedestrian gate to the porch + red/yellow step
    B.box(PG[0], PG[1], 0, 0.035, WB, -1.2, '#b9ad98');
    B.box(PG[0], PG[1], 0, 0.09, WB - 0.75, WB - 0.15, C.yellow); B.box(PG[0], PG[1], 0.09, 0.16, WB - 0.45, WB - 0.15, C.red);
    // slot markings
    SLOTS.forEach(s => {
      const hw = s.w / 2, hl = s.l / 2, q = (a0, a1, b0, b1) => B.box(a0, a1, 0.035, 0.045, b0, b1, '#f4f4f4');
      if (s.alongA) { q(s.a - hl, s.a + hl, s.b - hw - 0.04, s.b - hw + 0.04); q(s.a - hl, s.a + hl, s.b + hw - 0.04, s.b + hw + 0.04); }
      else { q(s.a - hw - 0.04, s.a - hw + 0.04, s.b - hl, s.b + hl); q(s.a + hw - 0.04, s.a + hw + 0.04, s.b - hl, s.b + hl); q(s.a - hw, s.a + hw, s.b + hl - 0.08, s.b + hl); }
    });

    // ================= plants
    const ico = r => new THREE.IcosahedronGeometry(r, 1);
    let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const FO = window.LeafCards();
    const GL = [['#2f6324', 3], ['#3f7a2c', 3], ['#4f8a34', 2]];
    // hibiscus: dark glossy green with red flowers
    for (let a = -18.9; a < -14.8; a += 1.0) { const r = 0.5 + rnd() * 0.15; FO.blob(a, r, WB + 0.7, r, r, r * 0.8, 70, GL.concat([[C.hib, 0.7]]), 0.3); B.geo(new THREE.CylinderGeometry(0.03, 0.04, r, 5), a, r / 2, WB + 0.7, 0, 0, 0, '#5b4630'); }
    // croton: variegated yellow-green
    for (let a = -14.4; a < -10.3; a += 0.9) FO.blob(a, 0.4, WB + 0.6, 0.38, 0.4, 0.32, 45, [['#b6c43a', 3], ['#d8c23a', 2], ['#6f8f2a', 2], ['#c0612a', 0.5]], 0.28);
    for (let a = -5.9; a < -2.6; a += 1.6) FO.blob(a, 0.38, YARD.b1 - 0.5, 0.36, 0.38, 0.3, 40, [['#b6c43a', 3], ['#d8c23a', 2], ['#6f8f2a', 2]], 0.28);
    // oleander along the lilac wall: narrow leaves, pink flowers
    for (let b = 1.5; b < 13; b += 1.2) { FO.blob(YARD.a0 + 0.6, 0.9, b, 0.55, 0.8, 0.6, 80, [['#3d6e2e', 4], ['#4c7d35', 3], [C.oleander, 1]], 0.32); }
    // bougainvillea: green leaves with magenta bract clusters, draped over the arch and down both posts and along the wall
    const BG = [['#3f7a2c', 2], ['#2f6324', 1.5], [C.bougain, 3], ['#e0409a', 1.5]];
    for (let i = 0; i <= 16; i++) { const t = i / 16 * Math.PI, a = (PG[0] + PG[1]) / 2 - Math.cos(t) * 0.8, y = 2.05 + Math.sin(t) * 0.75; FO.blob(a, y, WB + 0.1, 0.3, 0.26, 0.3, 30, BG, 0.22); }
    for (const a of [PG[0] - 0.05, PG[1] + 0.05]) for (let y = 0.5; y < 2.1; y += 0.3) FO.blob(a, y, WB + 0.25, 0.22, 0.2, 0.2, 14, BG, 0.22);
    for (let a = PG[0] - 2.2; a < PG[0] - 0.3; a += 0.4) FO.blob(a, 1.55 + rnd() * 0.2, WB + 0.05, 0.3, 0.3, 0.28, 18, BG, 0.22);
    // arch frame (thin black steel) the creeper grows on
    for (let i = 0; i < 12; i++) { const t0 = i / 12 * Math.PI, t1 = (i + 1) / 12 * Math.PI, c = (PG[0] + PG[1]) / 2; const ax = c - Math.cos(t0) * 0.8, ay = 2.05 + Math.sin(t0) * 0.75, bx = c - Math.cos(t1) * 0.8, by = 2.05 + Math.sin(t1) * 0.75; B.geo(new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(bx - ax, by - ay), 4), (ax + bx) / 2, (ay + by) / 2, WB + 0.1, 0, 0, Math.atan2(-(bx - ax), by - ay), C.black); }

    // ================= interior furniture (front room + bedroom)
    B.box(-13.7, -13.0, FLOOR, 0.55, 4.0, 6.6, '#7a4b2a'); B.box(-13.85, -13.55, 0.55, 1.05, 4.0, 6.6, '#7a4b2a'); B.box(-13.6, -13.05, 0.45, 0.62, 4.05, 6.55, '#2d6b8a'); col(-13.85, -13.0, 4.0, 6.6);
    B.box(-7.5, -7.0, FLOOR, 0.6, 4.4, 6.0, C.woodDk); col(-7.5, -7.0, 4.4, 6.0); B.box(-7.3, -7.2, 0.75, 1.4, 4.6, 5.8, '#111');
    B.box(-13.7, -11.7, FLOOR, 0.5, 10.3, 12.6, C.wood); B.box(-13.7, -11.7, 0.5, 0.68, 10.35, 12.55, '#e6e0d0'); B.box(-13.65, -11.75, 0.68, 0.74, 10.5, 11.7, '#8e2a5a'); col(-13.7, -11.7, 10.3, 12.6);
    B.box(-7.65, -7.0, FLOOR, 2.1, 9.0, 10.6, '#7b5a3a'); col(-7.65, -7.0, 9.0, 10.6);
    B.box(-11.6, -10.4, FLOOR, 0.75, 5.0, 6.0, '#8d6a48'); col(-11.6, -10.4, 5.0, 6.0);   // dining table

    const mesh = B.mesh(); root.add(mesh);
    (window.WALKABLES = window.WALKABLES || []).push(mesh);
    root.add(lines(edges, 0x3c3c3e));
    root.add(FO.mesh());

    // ================= animated parts: gates, door, flag, pendant light
    const hM = 2.0, gw = (MG[1] - MG[0]) / 2 - 0.25;
    const gMat = new THREE.MeshLambertMaterial({ map: gateLeafTex(true, hM), alphaTest: 0.5, side: THREE.DoubleSide });
    const leaf = (hingeA, sign) => {
      const p = new THREE.Group(); p.position.set(hingeA, 0, WB);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, hM), gMat); m.position.set(sign * gw / 2, hM / 2 + 0.03, 0); if (sign < 0) m.scale.x = -1;
      p.add(m); root.add(p); return p;
    };
    parts.gateL = leaf(MG[0] + 0.25, 1); parts.gateR = leaf(MG[1] - 0.25, -1);
    const pgw = PG[1] - PG[0] - 0.4;
    parts.ped = new THREE.Group(); parts.ped.position.set(PG[0] + 0.2, 0, WB);
    { const pm = new THREE.MeshLambertMaterial({ map: gateLeafTex(false, 1.7), alphaTest: 0.5, side: THREE.DoubleSide }); const m = new THREE.Mesh(new THREE.PlaneGeometry(pgw, 1.7), pm); m.position.set(pgw / 2, 0.88, 0); parts.ped.add(m); root.add(parts.ped); }
    parts.door = new THREE.Group(); parts.door.position.set(DOOR[0], FLOOR, 3.0);
    { const dw = DOOR[1] - DOOR[0], d = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.08, 0.06), new THREE.MeshLambertMaterial({ color: C.wood })); d.position.set(dw / 2, 1.04, 0); parts.door.add(d); root.add(parts.door); }
    { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); pole.position.set(YARD.a0 + 0.05, 1.9 + 0.8, WB);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide })); fl.position.set(YARD.a0 + 0.3, 3.3, WB); root.add(pole, fl); }
    { const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c4 })); bulb.position.set(-8.1, ROOF - 0.55, 0.0);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), new THREE.MeshBasicMaterial({ color: 0x222222 })); wire.position.set(-8.1, ROOF - 0.25, 0.0); root.add(bulb, wire); }
    { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshBasicMaterial({ map: tvTex() })); s.position.set(-7.33, 1.08, 5.2); s.rotation.y = -Math.PI / 2; root.add(s); }
    parts.lamp = new THREE.PointLight(0xffe2b0, 0, 12, 1.6); parts.lamp.position.set(-10.4, ROOF - 0.4, 7.5); root.add(parts.lamp);

    scene.add(root);
    blockers.gate = Blocker(MG[0] + 0.25, MG[1] - 0.25, WB - 0.12, WB + 0.12);
    blockers.ped = Blocker(PG[0] + 0.2, PG[1] - 0.2, WB - 0.12, WB + 0.12);
    blockers.door = Blocker(DOOR[0], DOOR[1], 2.88, 3.12);
    for (const k in blockers) blockers[k].set(true);
    MGc = { a: (MG[0] + MG[1]) / 2, b: WB }; PGc = { a: (PG[0] + PG[1]) / 2, b: WB }; DOORc = { a: (DOOR[0] + DOOR[1]) / 2, b: 3.0 };
  }

  const SLOTS = [
    { id: 'car1', a: -4.25, b: 8.4, w: 3.0, l: 5.4, car: true },
    { id: 'bike1', a: -3.0, b: 12.9, w: 1.1, l: 2.2, alongA: true },
    { id: 'bike2', a: -5.4, b: 12.9, w: 1.1, l: 2.2, alongA: true },
  ];
  const slotRot = s => s.alongA ? TH + Math.PI / 2 : TH;
  // where the player's Innova Crysta starts (index.html respawnCar): parked in the car bay, nose to the main gate;
  // if a stored vehicle holds the bay, in the front courtyard right behind the gate instead
  window.SafeHouse2Home = function () {
    const s = SLOTS[0], busy = S.stored.some(q => q.slot === s.id);
    const p = busy ? W(-4.25, 0.6) : W(s.a, s.b + 0.3);
    return { x: p.x, z: p.z, rot: TH + Math.PI, slot: busy ? null : s.id };
  };
  const parts = {}, blockers = {};
  let MGc, PGc, DOORc;
  const anim = { gate: 0, ped: 0, door: 0 }, want = { gate: false, ped: false, door: false }, manual = { gate: false, door: false };

  // ---------------------------------------------------------------- storage (same scheme as v1)
  const isPaint = o => o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85;
  function paintOf(g) { let c = null; g.traverse(o => { if (!c && isPaint(o)) c = o.material.color.getHex(); }); return c; }
  const paintCache = {};
  function spawnStored() {
    const P = PL(), TMs = TM(); if (!P || !TMs) return;
    for (const st of S.stored) {
      if (live[st.slot] || !TMs[st.kind]) continue;
      const s = SLOTS.find(q => q.id === st.slot); if (!s) continue;
      const v = TMs[st.kind]();
      if (st.color != null) v.g.traverse(o => { if (isPaint(o)) o.material = paintCache[st.color] || (paintCache[st.color] = new THREE.MeshPhongMaterial({ color: st.color, specular: 0x8a8a8a, shininess: 85 })); });
      const p = W(s.a, s.b); v.g.position.set(p.x, 0, p.z); v.g.rotation.y = slotRot(s); scene.add(v.g);
      const obj = { ...v, model: st.kind, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, wheels: v.wheels || [], tail: v.tail || [], _safeSlot: s.id, _waiting: true };
      live[s.id] = obj; P.addParked(obj);
    }
  }
  // ---------------------------------------------------------------- bike row in the front courtyard
  // The family's motorbikes stand side by side in front of the veranda (west of the porch path, clear of the car
  // lane from the main gate to the car bay), all nose to the gate, each leaning a little on its side stand, like an
  // Indian home courtyard. Built with TrafficModels, registered with Player.addParked so F mounts exactly that bike.
  // (The scooter and the bicycle stay outside the gate: parked.js.)
  const BIKE_ROW = ['classic', 'classic2', 'sport', 'faired', 'bike'];
  const rowBikes = [];
  function spawnBikeRow() {
    const P = PL(), TMs = TM(); if (!P || !TMs || !P.addParked || rowBikes.length) return;
    const rot = TH + Math.PI;                                  // facing -b: nose toward the front wall / gate
    BIKE_ROW.forEach((kind, i) => {
      if (!TMs[kind]) return;
      const v = TMs[kind](); v.g.name = 'safehouse-bike-' + kind;
      const p = W(-13.55 + i * 0.85, -0.75);
      v.g.position.set(p.x, 0, p.z); v.g.rotation.order = 'YXZ'; v.g.rotation.set(0, rot, 0.13);   // leaning left on the side stand
      // side stand: a short black rod from under the footrest to the floor on the left
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5), new THREE.MeshLambertMaterial({ color: 0x151515 }));
      stand.position.set(0.17, 0.16, -0.05); stand.rotation.z = -0.55; v.g.add(stand);
      v.g.traverse(o => { if (o.userData && o.userData.human) o.visible = false; });
      scene.add(v.g);
      const obj = { ...v, model: 'bike', type: kind, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: (v.len || 2.1) / 2, hw: 0.36,
        wheelR: 0.33, wheels: v.wheels || [], tail: v.tail || [], head: v.head || [], parked: true, _yardBike: kind,
        onTaken: (o) => { o.g.rotation.z = 0; if (stand.parent) stand.parent.remove(stand); } };
      rowBikes.push(obj); P.addParked(obj);
    });
  }
  window.SafeHouse2Bikes = () => rowBikes;
  function slotAt(x, z, maxD) { const l = L(x, z); let best = null; for (const s of SLOTS) { const d = Math.hypot(l.a - s.a, l.b - s.b); if (d < (maxD || 2.2) && (!best || d < best.d)) best = { s, d }; } return best && best.s; }
  function storeVehicle(s) {
    const P = PL(), v = P && P.active;
    if (!v) return G.showPopup('THE CRYSTA STAYS OUTSIDE · STORE BIKES & OTHER VEHICLES');
    if (!TM()[v.model]) return G.showPopup('CANNOT STORE THIS VEHICLE');
    let spd = 0; try { spd = Math.abs(carSpeed); } catch (e) {}
    if (spd > 6) return G.showPopup('STOP TO STORE THE VEHICLE');
    if (live[s.id] && live[s.id] !== v) return G.showPopup('SLOT TAKEN');
    try { const p0 = W(s.a, s.b); if (Math.hypot(playerCarGroup.position.x - p0.x, playerCarGroup.position.z - p0.z) < 3) return G.showPopup('SLOT TAKEN · THE CRYSTA IS PARKED HERE'); } catch (e) {}
    if (!s.car && v.model !== 'bike') return G.showPopup('BIKE BAY · PARK CARS IN THE CAR BAY');
    const p = W(s.a, s.b); carPos.x = p.x; carPos.z = p.z; carRot = slotRot(s);
    v.g.position.set(p.x, v.g.position.y, p.z); v.g.rotation.y = carRot; v.vF = 0; v.vL = 0;
    S.stored = S.stored.filter(q => q.slot !== s.id); S.stored.push({ kind: v.model, slot: s.id, color: paintOf(v.g) });
    live[s.id] = v; v._safeSlot = s.id;
    P.toggle();
    persist(); G.showPopup('VEHICLE STORED · SAFE HOUSE 2');
  }
  function checkTaken() {
    const P = PL(); if (!P) return;
    for (const id in live) { const v = live[id]; if (P.active === v || !v.g.parent) { delete live[id]; S.stored = S.stored.filter(q => q.slot !== id); persist(); } }
  }

  // ---------------------------------------------------------------- UI
  let hint = null, safeTag = null, fade = null;
  function ui() {
    const css = document.createElement('style');
    css.textContent = '#sh2Hint{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);background:rgba(0,0,0,.72);color:#fff;font:600 14px system-ui,sans-serif;padding:7px 14px;border-radius:6px;pointer-events:none;display:none;z-index:40}' +
      '#sh2Hint b{background:#fff;color:#000;border-radius:3px;padding:0 6px;margin-right:6px}' +
      '#sh2Safe{position:fixed;top:64px;left:50%;transform:translateX(-50%);background:#5a2a6b;color:#fff;font:700 12px system-ui,sans-serif;letter-spacing:.12em;padding:4px 12px;border-radius:12px;display:none;z-index:40;pointer-events:none}' +
      '#sh2Fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .6s;z-index:60;display:flex;align-items:center;justify-content:center;color:#fff;font:700 22px system-ui,sans-serif}';
    hint = document.createElement('div'); hint.id = 'sh2Hint';
    safeTag = document.createElement('div'); safeTag.id = 'sh2Safe'; safeTag.textContent = '⌂ SAFE · HOME 2';
    fade = document.createElement('div'); fade.id = 'sh2Fade';
    document.head.appendChild(css); document.body.append(hint, safeTag, fade);
  }
  function setHint(t) { if (!hint) return; if (t) { hint.innerHTML = '<b>E</b>' + t; hint.style.display = 'block'; } else hint.style.display = 'none'; }

  const propsPanelOpen = () => { const p = document.getElementById('propPanel'); return !!(p && p.style.display === 'block'); };
  const inYard = l => l.a > YARD.a0 && l.a < YARD.a1 && l.b > YARD.b0 && l.b < YARD.b1;
  const inHouse = l => l.a > HALL.a0 && l.a < HALL.a1 && l.b > HALL.b0 && l.b < HALL.b1;
  function currentAction() {
    const mode = G.playerMode, l = L(carPos.x, carPos.z);
    const d = q => Math.hypot(l.a - q.a, l.b - q.b);
    if (mode === 'vehicle' || mode === 'crysta') {
      if (inYard(l)) { const s = slotAt(carPos.x, carPos.z, 2.0); if (s && mode === 'vehicle') return { t: 'store vehicle here', f: () => storeVehicle(s) }; }
      if (d(MGc) < 7) return { t: want.gate ? 'close gate' : 'open gate', f: () => { manual.gate = !want.gate; } };
      return null;
    }
    if (mode !== 'foot') return null;
    if (d(DOORc) < 1.7) return { t: want.door ? 'close door' : 'open door', f: () => { manual.door = !want.door; } };
    if (l.a > -13.9 && l.a < -11.5 && l.b > 9.8 && l.b < 12.7) return { t: 'sleep till morning & save', f: sleep };
    if (l.a > -8.6 && l.a < -7.6 && l.b > 8.8 && l.b < 10.8) return { t: 'wardrobe · change outfit', f: wardrobe };
    if (d(MGc) < 2.6) return { t: want.gate ? 'close gate' : 'open gate', f: () => { manual.gate = !want.gate; } };
    return null;
  }
  function sleep() {
    fade.textContent = ''; fade.style.opacity = '1';
    setTimeout(() => {
      try { timeOfDay = 7.0; } catch (e) {}
      persist(); try { window.Properties && Properties.persist && Properties.persist(); } catch (e) {}
      fade.textContent = 'GAME SAVED · 7:00 AM';
      setTimeout(() => { fade.style.opacity = '0'; G.showPopup('GOOD MORNING · GAME SAVED'); }, 1200);
    }, 650);
  }
  function wardrobe() { let cc = null; try { cc = CharacterCreator; } catch (e) {} if (cc && cc.open) cc.open(); else G.showPopup('WARDROBE NOT AVAILABLE'); }

  // ---------------------------------------------------------------- hooks
  GameHooks.init.push(game => {
    G = game; world = game.world; scene = game.scene;
    try { build(); } catch (e) { console.error('safehouse2 build failed', e); return; }
    ui();
    const c = W(-10.5, 6.5);
    if (world.addMapIcon) world.addMapIcon(c.x, c.z, '⌂', 'Safe House 2');
    MGw = W(MGc.a, MGc.b);
    window.SafeHouse2 = { W, L, slots: SLOTS, live, state: S, anim, want, manual, center: c, gate: W(MGc.a, MGc.b - 6), door: W(DOORc.a, DOORc.b) };
    setTimeout(spawnStored, 0); setTimeout(() => { try { spawnBikeRow(); } catch (e) { console.error("safehouse2 bikes", e); } }, 0);
  });

  // ---------------------------------------------------------------- NPCs near the gates (traffic, carts, herds, walkers)
  let npcT = 0, npcGate = false, npcPed = false, holdGate = 0, holdPed = 0;
  function scanNpcs() {
    npcGate = npcPed = false;
    const pos = o => o && (o.g && o.g.position ? o.g.position : o.group && o.group.position ? o.group.position : (typeof o.x === 'number' ? o : null));
    const gateD = q => { const l = L(q.x, q.z); return Math.hypot(l.a - MGc.a, l.b - MGc.b); };
    const pedD = q => { const l = L(q.x, q.z); return Math.hypot(l.a - PGc.a, l.b - PGc.b); };
    const veh = (o, r) => { const q = pos(o); if (q && Math.abs(q.x - MGw.x) + Math.abs(q.z - MGw.z) < 30 && gateD(q) < r) npcGate = true; };
    const foot = o => { const q = pos(o); if (!q || Math.abs(q.x - MGw.x) + Math.abs(q.z - MGw.z) > 30) return; if (pedD(q) < 2.6) npcPed = true; if (gateD(q) < 3.5) npcGate = true; };
    const P = PL();
    try { for (const t of traffic) if (!P || t !== P.active) veh(t, 9); } catch (e) {}
    try { if (window.VillageProcessions) for (const it of VillageProcessions.items) it.kind === 'walker' ? foot(it) : veh(it, 8); } catch (e) {}
    try { if (window.RoadAnimals) for (const a of RoadAnimals) veh(a, 5); } catch (e) {}
    try { if (world.people) for (const h of world.people) foot(h); } catch (e) {}
    try { if (window.AutoRides && AutoRides.npcs) for (const n of AutoRides.npcs) foot(n.h || n); } catch (e) {}
  }
  let MGw = { x: 0, z: 0 };

  let cur = null;
  GameHooks.update.push((dt, game) => {
    if (!root) return;
    const mode = game.playerMode, l = L(carPos.x, carPos.z);
    const dG = Math.hypot(l.a - MGc.a, l.b - MGc.b);
    const driving = mode === 'vehicle' || mode === 'crysta';
    if (dG > 14) manual.gate = false;
    // automatic gates: the main gate opens for the player (driving, riding or walking up to it) and for any NPC
    // vehicle / cart / herd / walker near it; the pedestrian gate for anyone on foot. Both stay open while somebody
    // is still in the gateway and close a moment after the last one has gone.
    if ((npcT -= dt) <= 0) { npcT = 0.25; scanNpcs(); }
    const pGate = (driving && (dG < 10 || inYard(l) && dG < 16)) || (mode === 'foot' && dG < 4.5) || (mode === 'passenger' && dG < 10);
    const pPed = mode === 'foot' && Math.hypot(l.a - PGc.a, l.b - PGc.b) < 3.0;
    holdGate = pGate || npcGate ? 1.2 : Math.max(0, holdGate - dt);
    holdPed = pPed || npcPed ? 1.0 : Math.max(0, holdPed - dt);
    want.gate = holdGate > 0 || manual.gate;
    want.ped = holdPed > 0;
    if (Math.hypot(l.a - DOORc.a, l.b - DOORc.b) > 3.2) manual.door = false;
    want.door = manual.door;
    for (const k of ['gate', 'ped', 'door']) {
      const sp = k === 'gate' ? 0.6 : 1.2, t = want[k] ? 1 : 0;
      anim[k] += Math.sign(t - anim[k]) * Math.min(Math.abs(t - anim[k]), dt * sp);
      blockers[k].set(anim[k] < 0.05);
    }
    const e = x => x * x * (3 - 2 * x);
    parts.gateL.rotation.y = -e(anim.gate) * Math.PI * 0.5; parts.gateR.rotation.y = e(anim.gate) * Math.PI * 0.5;
    parts.ped.rotation.y = -e(anim.ped) * Math.PI * 0.5;
    parts.door.rotation.y = -e(anim.door) * Math.PI * 0.55;
    parts.lamp.intensity += ((inHouse(l) ? 1.1 : 0) - parts.lamp.intensity) * Math.min(1, dt * 4);
    safeTag.style.display = inYard(l) ? 'block' : 'none';
    checkTaken();
    cur = propsPanelOpen() ? null : currentAction();
    setHint(cur ? cur.t : null);
  });

  GameHooks.key.push((e) => {
    if (e.code !== 'KeyE' || e.repeat || !root || propsPanelOpen()) return false;
    const a = currentAction(); if (!a) return false;
    a.f(); return true;
  });
})();
