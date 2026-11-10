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
// Controls (same as v1): gate opens on approach in a vehicle, only E on foot; front door E; store a vehicle in a slot
// with E (saved to localStorage 'nellutla.safehouse2'); bed E = sleep + save; wardrobe E.
(function () {
  'use strict';
  const SAVE_KEY = 'nellutla.safehouse2';

  // ---------------------------------------------------------------- frame
  // Same axes as the old v1 frame (a along the lane ENE, b into the plot SSE), origin moved 14 m along the lane from
  // v1's front-west corner (38.8,-272.2) so the plot (a -19.5 .. -1.1) now covers map building #317, the real house,
  // with the front wall facing lane east_diag.
  const UX = 13.2 / 14.857, UZ = 6.8 / 14.857;
  // the house sits 1.8 m further back than the first cut (more courtyard in front); the front wall stays on the lane
  const SET = 1.8;
  const O = { x: 38.8 + 14 * UX - SET * UZ, z: -272.2 + 14 * UZ + SET * UX };
  // the generic footprint #317 is also dropped by nellutla-map/tools/map_fixes.json; keep this for older map data
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 42.4, z: -263.0, r: 4 });
  (window.NELLUTLA_FLAT = window.NELLUTLA_FLAT || []).push({ x: 42.4, z: -263.0, r: 19 }, { x: 28, z: -243, r: 15 }, { x: 36, z: -247, r: 15 });   // the rolling land stays out of the plot
  const NX = -UZ, NZ = UX;
  const TH = Math.atan2(-UZ, UX);
  const W = (a, b) => ({ x: O.x + a * UX + b * NX, z: O.z + a * UZ + b * NZ });
  const L = (x, z) => { const dx = x - O.x, dz = z - O.z; return { a: dx * UX + dz * UZ, b: dx * NX + dz * NZ }; };
  const YARD = { a0: -19.5, a1: -1.1, b0: -2.8 - SET - 0.6, b1: 18.5 };   // front wall 0.6 m toward the road (more would stand in the lane at the east corner)
  // the back plot: gate in the middle of the back wall, steps down, a walled plot at ground level (sketch 86)
  const RG = [-11.4, -9.2], PLOT = { b1: 31.6 };
  const KIT = { a0: -12.8, a1: -8.2, b0: 12.91, b1: 16.38 }, KD = [-10.9, -9.9], RD = [-12.4, -11.2];   // kitchen in the rear wing, its door; door in the back plot's end wall
  const HK = [-10.5, -9.4];
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
  const tvTex = () => canvasTex(256, 144, (x) => { const gr = x.createLinearGradient(0, 0, 0, 144); gr.addColorStop(0, '#6fb2dc'); gr.addColorStop(0.55, '#f0d9a8'); gr.addColorStop(0.56, '#3f8a3e'); gr.addColorStop(1, '#2c6330'); x.fillStyle = gr; x.fillRect(0, 0, 256, 144);   // a cricket ground on the news
      x.fillStyle = '#c9a877'; x.fillRect(116, 92, 24, 46); x.fillStyle = '#b3261e'; x.fillRect(0, 124, 256, 20); x.fillStyle = '#fff'; x.font = 'bold 13px sans-serif'; x.fillText('LIVE  IND 212/3  (34.2)', 8, 139); });

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
    red: '#b8352a', yellow: '#e3b836', black: '#151515', glass: '#2a3238', plinth: '#efdcae', sheet: '#a9aca6',
    green: '#3f7a2c', green2: '#2f6324', croton: '#b6c43a', hib: '#d4202a', oleander: '#f08cb8', bougain: '#d2287a', floor: '#d8cfc0',
  };
  const YARD_H = 0.85;   // yard and house stand this far above the road: world.yardAt, all of root rides on it
  const FLOOR = 0.12, ROOF = 3.3, T = 0.23;

  function build() {
    root = new THREE.Group(); root.position.set(O.x, YARD_H, O.z); root.rotation.y = TH; root.name = 'safehouse2';
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
    const DOOR = [-8.95, -7.75];                      // 1.2 m clear: the walker (r 0.4) passes without scraping the frame
    wallA(3.0, -14, -6.8, [[-13.2, -12.0, 0.9, 2.1], [-11.2, -10.2, 0.9, 2.1], DOOR.concat([0, 2.2])], C.cream);
    wallA(12.8, -14, -6.8, [[-12, -11, 0.9, 2.1], [HK[0], HK[1], 0, 2.2], [-9, -8, 0.9, 2.1]], C.cream);   // HK: open doorway, hall to kitchen
    B.box(HK[0] - 0.08, HK[0], FLOOR, 2.28, 12.65, 12.95, C.woodDk); B.box(HK[1], HK[1] + 0.08, FLOOR, 2.28, 12.65, 12.95, C.woodDk); B.box(HK[0] - 0.08, HK[1] + 0.08, 2.2, 2.28, 12.65, 12.95, C.woodDk);
    wallB(-6.8, 3.0, 12.8, [[4.4, 5.4, 0.9, 2.1], [9.8, 10.8, 0.9, 2.1]], C.cream);
    wallA(8.0, -14, -6.9, [[-11, -9.9, 0, 2.2]], '#f3ead4');                         // partition: front room | bedroom
    // brown wooden windows (frame + shutters + bars)
    const winA = (b, g0, g1, sill, head, out) => {
      // a frame round the opening (not a plank over it), a centre mullion, a sill, and the two shutters folded back on the wall
      const f0 = b + out * 0.02, f1 = b + out * 0.16, w = Math.min((g1 - g0) / 2, 0.28);
      B.box(g0 - 0.08, g0, sill - 0.08, head + 0.08, f0, f1, C.wood); B.box(g1, g1 + 0.08, sill - 0.08, head + 0.08, f0, f1, C.wood);
      B.box(g0 - 0.08, g1 + 0.08, head, head + 0.08, f0, f1, C.wood); B.box(g0 - 0.08, g1 + 0.08, sill - 0.08, sill, f0, f1, C.wood);
      B.box(g0 - 0.14, g1 + 0.14, sill - 0.13, sill - 0.08, b, b + out * 0.24, C.creamDk);
      B.box(g0, g1, sill, head, b - 0.03, b + 0.03, C.glass);
      B.box((g0 + g1) / 2 - 0.03, (g0 + g1) / 2 + 0.03, sill, head, b + out * 0.1, b + out * 0.14, C.wood);
      for (const [s0, s1] of [[g0 - 0.1 - w, g0 - 0.1], [g1 + 0.1, g1 + 0.1 + w]]) {
        B.box(s0, s1, sill, head, b + out * 0.125, b + out * 0.155, C.wood);
        for (let y = sill + 0.12; y < head - 0.08; y += 0.3) B.box(s0 + 0.05, s1 - 0.05, y, y + 0.2, b + out * 0.155, b + out * 0.165, C.woodDk);
      }
      for (let a = g0 + 0.13; a < g1 - 0.05; a += 0.15) B.box(a, a + 0.025, sill, head, b + out * 0.06, b + out * 0.09, C.black);
    };
    const winB = (a, g0, g1, sill, head, out) => {
      const f0 = a + out * 0.02, f1 = a + out * 0.16, w = Math.min((g1 - g0) / 2, 0.28), lo = Math.min, hi = Math.max;
      const bx = (x0, x1, y0, y1, b0, b1, c) => B.box(lo(x0, x1), hi(x0, x1), y0, y1, b0, b1, c);
      bx(f0, f1, sill - 0.08, head + 0.08, g0 - 0.08, g0, C.wood); bx(f0, f1, sill - 0.08, head + 0.08, g1, g1 + 0.08, C.wood);
      bx(f0, f1, head, head + 0.08, g0 - 0.08, g1 + 0.08, C.wood); bx(f0, f1, sill - 0.08, sill, g0 - 0.08, g1 + 0.08, C.wood);
      bx(a, a + out * 0.24, sill - 0.13, sill - 0.08, g0 - 0.14, g1 + 0.14, C.creamDk);
      B.box(a - 0.03, a + 0.03, sill, head, g0, g1, C.glass);
      for (const [s0, s1] of [[g0 - 0.1 - w, g0 - 0.1], [g1 + 0.1, g1 + 0.1 + w]]) {
        bx(a + out * 0.125, a + out * 0.155, sill, head, s0, s1, C.wood);
        for (let y = sill + 0.12; y < head - 0.08; y += 0.3) bx(a + out * 0.155, a + out * 0.165, y, y + 0.2, s0 + 0.05, s1 - 0.05, C.woodDk);
      }
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
    const WB = YARD.b0, PG = [-10.2, -8.6], MG = [-6.3, -2.2]; MG_ = MG;
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
    // red plinth strip at the foot of the front wall, along the road (photo 40) and a dressed stone base at the corner (42)
    B.box(-19.4, MG[0] - 0.3, -YARD_H, -YARD_H + 0.11, WB - 0.36, WB - 0.14, '#a5392c');
    for (let b = WB; b < YARD.b1 - 0.5; b += 1.15) for (let r = 0; r < 2; r++) { const t = 0.5 + 0.07 * ((b * 7 + r * 3 | 0) % 3); B.box(YARD.a1 + 0.1, YARD.a1 + 0.16, r * 0.3, r * 0.3 + 0.29, b + (r ? 0.5 : 0), Math.min(b + 1.1 + (r ? 0.5 : 0), YARD.b1), `rgb(${t * 200 | 0},${t * 190 | 0},${t * 170 | 0})`); }
    lil(YARD.a0, RG[0] - 0.25, YARD.b1 - 0.11, YARD.b1 + 0.11, C.cream, C.creamDk); lil(RG[1] + 0.25, YARD.a1, YARD.b1 - 0.11, YARD.b1 + 0.11, C.cream, C.creamDk);
    // east side wall: the plot is fully enclosed, a car only gets in through the main gate
    lil(YARD.a1 - 0.11, YARD.a1 + 0.11, WB, YARD.b1, C.lilac, C.lilacDk);
    // rear wing: the house carries on to the back, same walls, windows and parapet; the bay behind the car porch stays open
    { const RW = { a0: -19.3, a1: -6.8, b0: 12.8, b1: 16.6 }; B.box(RW.a0, RW.a1, 0, FLOOR, RW.b0, RW.b1, C.cream); B.box(RW.a0, KIT.a0, FLOOR, ROOF, RW.b0, RW.b1, C.cream); col(RW.a0, KIT.a0, RW.b0, RW.b1); B.box(KIT.a1, RW.a1, FLOOR, ROOF, RW.b0, RW.b1, C.cream); col(KIT.a1, RW.a1, RW.b0, RW.b1);
      // the kitchen fills the middle of the wing; its door to the back yard stands where the window was
      for (const [a0, a1] of [[KIT.a0, KD[0]], [KD[1], KIT.a1]]) { B.box(a0, a1, FLOOR, ROOF, KIT.b1, RW.b1, C.cream); col(a0, a1, KIT.b1, RW.b1); }
      B.box(KD[0], KD[1], 2.25, ROOF, KIT.b1, RW.b1, C.cream);
      B.box(RW.a0 - 0.12, RW.a1 + 0.12, ROOF, ROOF + 0.15, RW.b0, RW.b1 + 0.12, '#c9c2b4'); B.box(RW.a0 - 0.12, RW.a1 + 0.12, ROOF + 0.15, ROOF + 0.75, RW.b1 - 0.03, RW.b1 + 0.12, C.white); B.box(RW.a1 - 0.03, RW.a1 + 0.12, ROOF + 0.15, ROOF + 0.75, RW.b0, RW.b1 + 0.12, C.white); B.box(RW.a0 - 0.12, RW.a0 + 0.03, ROOF + 0.15, ROOF + 0.75, RW.b0, RW.b1 + 0.12, C.white);
      edgeBox(RW.a0, RW.a1, 0, ROOF, RW.b0, RW.b1);
      for (const [a0, a1] of [[-18, -17], [-14.5, -13.5]]) winA(RW.b1, a0, a1, 0.9, 2.1, 1);
      B.box(KD[0] - 0.1, KD[0], FLOOR, 2.33, KIT.b1 - 0.02, RW.b1 + 0.03, C.woodDk); B.box(KD[1], KD[1] + 0.1, FLOOR, 2.33, KIT.b1 - 0.02, RW.b1 + 0.03, C.woodDk); B.box(KD[0] - 0.1, KD[1] + 0.1, 2.25, 2.33, KIT.b1 - 0.02, RW.b1 + 0.03, C.woodDk);
      B.box(KD[0] - 0.3, KD[1] + 0.3, 0, 0.07, RW.b1, RW.b1 + 0.6, '#b9ad98'); B.box(KD[0] - 0.4, KD[1] + 0.4, 2.42, 2.5, RW.b1, RW.b1 + 0.55, C.wood);
      winB(RW.a1, 13.6, 14.6, 0.9, 2.1, 1); B.box(-16, -15, FLOOR, 2.1, RW.b1, RW.b1 + 0.05, C.wood); B.box(-16.1, -14.9, ROOF - 1.05, ROOF - 0.98, RW.b1, RW.b1 + 0.6, C.wood); }
    // kitchen (photo 92's window became its door): tiled floor and dado, L-shaped granite counter, gas stove and cylinder, steel sink, shelf of vessels, fridge
    { const K = KIT, F = FLOOR, CE = -10.7, ct = '#2f2d2c', st = '#c9ccd0', top = 0.86, D = 0.6;
      for (let a = K.a0, i = 0; a < K.a1 - 0.01; a += 0.5, i++) for (let b = K.b0, j = 0; b < K.b1 - 0.01; b += 0.5, j++) B.box(a, Math.min(a + 0.49, K.a1), F, F + 0.012, b, Math.min(b + 0.49, K.b1), (i + j) & 1 ? '#d9d4c6' : '#b9b3a2');
      B.box(K.a0, K.a1, F, 1.5, K.b0 - 0.005, K.b0 + 0.008, '#e9efe9'); B.box(K.a0, K.a0 + 0.01, F, 1.5, K.b0, K.b1, '#e9efe9'); B.box(K.a1 - 0.01, K.a1, F, 1.5, K.b0, K.b1, '#e9efe9');
      B.box(K.a0 + D, CE, F, top, K.b0, K.b0 + D, '#7a5a3e'); B.box(K.a0, K.a0 + D, F, top, K.b0, K.b1 - 0.1, '#7a5a3e');          // cabinets
      B.box(K.a0, CE, top, top + 0.04, K.b0, K.b0 + D + 0.03, ct); B.box(K.a0, K.a0 + D + 0.03, top, top + 0.04, K.b0, K.b1 - 0.1, ct);   // granite top
      for (let a = K.a0 + D + 0.3; a < CE - 0.5; a += 0.6) B.box(a, a + 0.54, F + 0.1, top - 0.08, K.b0 + D, K.b0 + D + 0.01, '#8a6848');
      col(K.a0, CE, K.b0, K.b0 + D); col(K.a0, K.a0 + D, K.b0, K.b1 - 0.1);
      // gas stove on the west arm, red cylinder standing beside the counter
      { const a = K.a0 + 0.3, b = K.b0 + 1.7; B.box(a - 0.26, a + 0.26, top + 0.04, top + 0.1, b - 0.38, b + 0.38, '#1b1b1d'); for (const q of [-0.18, 0.18]) { B.geo(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12), a, top + 0.11, b + q, 0, 0, 0, '#3a3a3c'); } B.geo(new THREE.CylinderGeometry(0.11, 0.09, 0.14, 12), a, top + 0.19, b - 0.18, 0, 0, 0, st); B.geo(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), a, top + 0.17, b + 0.18, 0, 0, 0, '#3b3532'); }
      B.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 12), K.a0 + D + 0.2, F + 0.31, K.b1 - 0.3, 0, 0, 0, '#b3261e'); B.geo(new THREE.CylinderGeometry(0.05, 0.08, 0.1, 8), K.a0 + D + 0.2, F + 0.67, K.b1 - 0.3, 0, 0, 0, '#8f1c16');
      // steel sink and tap under the window on the north arm
      { const a = -11.5, b = K.b0 + 0.3; B.box(a - 0.32, a + 0.32, top + 0.04, top + 0.05, b - 0.2, b + 0.2, '#e0e2e4'); B.box(a - 0.26, a + 0.26, top + 0.046, top + 0.052, b - 0.15, b + 0.15, '#74787c'); B.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), a, top + 0.14, b - 0.17, 0, 0, 0, st); B.box(a - 0.012, a + 0.012, top + 0.23, top + 0.25, b - 0.17, b - 0.04, st); }
      // shelf with steel vessels on the west wall, plates rack, water pot
      B.box(K.a0, K.a0 + 0.26, 1.72, 1.76, K.b0 + 0.9, K.b1 - 0.2, '#7a5a3e');
      for (let i = 0; i < 6; i++) B.geo(new THREE.CylinderGeometry(0.09 - (i % 3) * 0.01, 0.1, 0.17 + (i % 3) * 0.05, 10), K.a0 + 0.13, 1.76 + (0.17 + (i % 3) * 0.05) / 2, K.b0 + 1.05 + i * 0.36, 0, 0, 0, st);
      B.geo(new THREE.SphereGeometry(0.15, 10, 8), -10.95, top + 0.19, K.b0 + 0.3, 0, 0, 0, '#a86b33');
      // fridge in the east corner
      B.box(K.a1 - 0.72, K.a1 - 0.04, F, 1.75, K.b0 + 0.05, K.b0 + 0.75, '#d8dadc'); B.box(K.a1 - 0.725, K.a1 - 0.7, 1.15, 1.16, K.b0 + 0.05, K.b0 + 0.75, '#70757a'); B.box(K.a1 - 0.74, K.a1 - 0.72, 0.75, 1.05, K.b0 + 0.66, K.b0 + 0.69, '#70757a'); col(K.a1 - 0.72, K.a1 - 0.04, K.b0 + 0.05, K.b0 + 0.75);
      B.box(K.a0 + 1.6, K.a0 + 2.4, ROOF - 0.05, ROOF - 0.03, 14.4, 14.5, '#fbfbf2'); }
    // car porch over the car bay: an RCC slab tied into the house roof at the same level, on the house side and on two
    // cream pillars along the east wall, so the whole width from the gate stays open to drive under
    { const CP = { a0: -6.6, a1: -1.2, b0: 4.9, b1: 11.9 };
      B.box(CP.a0, CP.a1, ROOF, ROOF + 0.15, CP.b0, CP.b1, '#c9c2b4'); edgeBox(CP.a0, CP.a1, ROOF, ROOF + 0.15, CP.b0, CP.b1);
      B.box(CP.a0, CP.a1, ROOF - 0.02, ROOF - 0.01, CP.b0, CP.b1, '#f6eed6');
      B.box(CP.a0, CP.a1, ROOF + 0.15, ROOF + 0.4, CP.b0 - 0.08, CP.b0 + 0.08, C.white);                         // parapet
      B.box(CP.a1 - 0.08, CP.a1 + 0.08, ROOF + 0.15, ROOF + 0.4, CP.b0, CP.b1, C.white); B.box(CP.a0, CP.a1, ROOF + 0.15, ROOF + 0.4, CP.b1 - 0.08, CP.b1 + 0.08, C.white);
      for (const b of [CP.b0 + 0.2, CP.b1 - 0.2]) { B.box(CP.a1 - 0.36, CP.a1 - 0.06, 0, ROOF, b - 0.15, b + 0.15, C.cream); B.box(CP.a1 - 0.42, CP.a1, 0, 0.32, b - 0.21, b + 0.21, C.plinth); col(CP.a1 - 0.36, CP.a1 - 0.06, b - 0.15, b + 0.15); edgeBox(CP.a1 - 0.36, CP.a1 - 0.06, 0.32, ROOF, b - 0.15, b + 0.15); }
      B.box(CP.a1 - 0.36, CP.a1 - 0.06, ROOF - 0.32, ROOF, CP.b0, CP.b1, C.cream);                               // beam between the pillars
      B.box(CP.a0, CP.a1, ROOF - 0.26, ROOF, CP.b0 - 0.06, CP.b0 + 0.06, C.cream); }
    // courtyard: red/yellow checkerboard tiles, apron to the lane
    for (let a = -6.65; a < YARD.a1 - 0.2; a += 0.6) for (let b = WB + 5.1; b < YARD.b1 - 0.2; b += 0.6) tile(a, b, 0.6, 0.03, ((Math.round(a / 0.6) + Math.round(b / 0.6)) & 1) ? C.red : C.yellow);
    // raised plot: earth slab, retaining walls, the ramp through the main gate (height = world.yardAt), steps at the pedestrian gate
    { const RA0 = -7.4, RA1 = YARD.a1, RB = WB + 5, RET = C.cream;
      B.box(YARD.a0, RA0, -YARD_H, 0.015, WB, YARD.b1, '#9c9077'); B.box(RA0, RA1, -YARD_H, 0.015, RB, YARD.b1, '#9c9077');
      for (const [a0, a1] of [[YARD.a0 - 0.12, PG[0] - 0.2], [PG[1] + 0.2, MG[0] - 0.25], [MG[1] + 0.25, YARD.a1 + 0.12]]) B.box(a0, a1, -YARD_H, 0, WB - 0.14, WB + 0.14, RET);
      for (const a of MG) B.box(a - 0.25, a + 0.25, -YARD_H, 0, WB - 0.25, WB + 0.25, C.cream);
      for (const a of PG) B.box(a - 0.2, a + 0.2, -YARD_H, 0, WB - 0.2, WB + 0.2, C.cream);
      for (const a of [YARD.a0, YARD.a1]) B.box(a - 0.13, a + 0.13, -YARD_H, 0, WB, YARD.b1 + 0.12, RET);
      B.box(YARD.a0, RG[0] - 0.25, -YARD_H, 0, YARD.b1 - 0.13, YARD.b1 + 0.13, RET); B.box(RG[1] + 0.25, YARD.a1, -YARD_H, 0, YARD.b1 - 0.13, YARD.b1 + 0.13, RET);
      const N = 11, M = 8, Rp = [], Rc = [], cc = new THREE.Color(); for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a0 = RA0 + (RA1 - RA0) * i / N, a1 = RA0 + (RA1 - RA0) * (i + 1) / N, b0 = WB + (RB - WB) * j / M, b1 = WB + (RB - WB) * (j + 1) / M;
        const y = (a, b) => { const q = W(a, b); return world.yardAt(q.x, q.z) - YARD_H + 0.012; }, P0 = [a0, y(a0, b0), b0], P1 = [a1, y(a1, b0), b0], P2 = [a1, y(a1, b1), b1], P3 = [a0, y(a0, b1), b1];
        for (const q of [P0, P2, P1, P0, P3, P2]) { Rp.push(q[0], q[1], q[2]); cc.set(((i + j) & 1) ? C.red : C.yellow); Rc.push(cc.r, cc.g, cc.b); } }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(Rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(Rc, 3)); rg.computeVertexNormals();
      root.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
      B.box(MG[0], MG[1], -YARD_H, -YARD_H + 0.075, WB - 1.0, WB + 0.02, '#bdb8ae');
      for (let i = 0; i < 3; i++) B.box(PG[0] + 0.02, PG[1] - 0.02, -YARD_H, -YARD_H + 0.2 * (i + 1), WB - 0.85 + i * 0.28, WB, '#b9ad98'); }
    // front path from the pedestrian gate to the porch + red/yellow step
    B.box(PG[0], PG[1], 0, 0.035, WB, -1.2, '#b9ad98');
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
    // TV hall (a -14 .. -6.8, b 3 .. 8): sofa set on a rug facing the TV wall, tiled floor skirting, fan, curtains, frames.
    // All merged into the house mesh: no extra draw calls, and only the sofa, tables and TV unit collide.
    { const F = FLOOR, wood = '#6a4128', dark = '#3f2a1c', fabric = '#7c5a3c', fabricDk = '#5f432b', cush = ['#a8452c', '#c98a2e', '#2d6b7a', '#a8452c'];
      B.box(-13.88, -6.92, F, 0.2, 3.13, 3.17, '#d8cdb4'); B.box(-13.88, -6.92, F, 0.2, 7.83, 7.87, '#d8cdb4'); B.box(-13.9, -13.86, F, 0.2, 3.15, 7.87, '#d8cdb4');
      B.box(-13.86, -6.94, F + 0.002, F + 0.004, 3.14, 7.86, '#d9d2c2');                                  // pale vitrified floor
      for (let a = -13.2; a < -7; a += 0.8) B.box(a, a + 0.012, F + 0.004, F + 0.006, 3.14, 7.86, '#b8b0a0');
      for (let b = 3.8; b < 7.8; b += 0.8) B.box(-13.86, -6.94, F + 0.004, F + 0.006, b, b + 0.012, '#b8b0a0');
      // rug
      B.box(-12.5, -8.8, F + 0.006, F + 0.02, 4.1, 7.1, '#7a2e2a'); B.box(-12.32, -8.98, F + 0.02, F + 0.024, 4.28, 6.92, '#c7a36a'); B.box(-12.18, -9.12, F + 0.024, F + 0.028, 4.42, 6.78, '#6c2a33');
      // three-seat sofa on the west wall
      B.box(-13.7, -12.8, F + 0.1, 0.42, 4.2, 7.0, fabricDk); B.box(-13.82, -13.5, F + 0.1, 0.98, 4.2, 7.0, fabric); B.box(-13.7, -12.8, 0.42, 0.56, 4.28, 6.92, fabric);
      for (const b of [4.08, 7.0]) B.box(-13.82, -12.75, F + 0.1, 0.68, b, b + 0.14, fabricDk);
      for (const b of [5.14, 6.06]) B.box(-13.45, -12.8, 0.56, 0.565, b - 0.005, b + 0.005, fabricDk);
      for (let i = 0; i < 4; i++) { const b = 4.6 + i * 0.68; B.geo(new THREE.BoxGeometry(0.1, 0.36, 0.36), -13.42, 0.74, b, 0, 0, -0.22, cush[i]); }
      for (const [a, b] of [[-13.7, 4.14], [-12.82, 4.14], [-13.7, 7.08], [-12.82, 7.08]]) B.box(a - 0.03, a + 0.03, F, F + 0.1, b - 0.03, b + 0.03, dark);
      col(-13.85, -12.75, 4.08, 7.14);
      // two-seat sofa on the partition side, facing the door wall
      B.box(-12.3, -10.9, F + 0.1, 0.42, 7.0, 7.68, fabricDk); B.box(-12.3, -10.9, F + 0.1, 0.92, 7.5, 7.74, fabric); B.box(-12.25, -10.95, 0.42, 0.55, 7.02, 7.5, fabric);
      B.geo(new THREE.BoxGeometry(0.36, 0.34, 0.1), -11.95, 0.72, 7.42, -0.22, 0, 0, cush[1]); B.geo(new THREE.BoxGeometry(0.36, 0.34, 0.1), -11.25, 0.72, 7.42, -0.22, 0, 0, cush[2]);
      col(-12.3, -10.9, 7.0, 7.74);
      // coffee table with a glass-look top, newspaper, steel tumblers and a fruit bowl
      B.box(-11.2, -9.9, 0.46, 0.5, 4.95, 5.95, wood); for (const [a, b] of [[-11.12, 5.03], [-9.98, 5.03], [-11.12, 5.87], [-9.98, 5.87]]) B.box(a - 0.03, a + 0.03, F, 0.46, b - 0.03, b + 0.03, dark);
      B.box(-11.15, -9.95, 0.22, 0.24, 5.0, 5.9, dark); B.box(-11.05, -10.7, 0.5, 0.507, 5.2, 5.65, '#ded9cc');
      B.geo(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), -10.3, 0.55, 5.25, 0, 0, 0, '#c9ccd0'); B.geo(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), -10.15, 0.55, 5.4, 0, 0, 0, '#c9ccd0');
      B.geo(new THREE.CylinderGeometry(0.13, 0.07, 0.07, 10), -10.3, 0.535, 5.65, 0, 0, 0, '#a86b33'); for (const [a, b, c] of [[-10.33, 5.63, '#d6a02c'], [-10.25, 5.68, '#c23c28'], [-10.32, 5.7, '#7fa33a']]) B.geo(new THREE.IcosahedronGeometry(0.05, 1), a, 0.59, b, 0, 0, 0, c);
      col(-11.2, -9.9, 4.95, 5.95);
      // TV unit on the east wall, between the window and the partition: low cabinet, tall side shelf, wall panel
      B.box(-7.0, -6.94, 0.6, 2.3, 5.55, 7.65, '#8a6243');
      B.box(-7.5, -6.94, F, 0.55, 5.6, 7.6, wood); for (const b of [5.95, 6.6, 7.25]) B.box(-7.505, -7.495, 0.18, 0.5, b - 0.3, b + 0.3, dark);
      for (const b of [6.2, 7.0]) B.box(-7.52, -7.5, 0.3, 0.36, b - 0.015, b + 0.015, '#c9b98a');
      B.box(-7.08, -7.0, 0.72, 1.56, 5.87, 7.33, '#0c0c0e'); B.box(-7.3, -7.08, 0.55, 0.58, 6.3, 6.9, '#1a1a1c');
      B.box(-7.42, -7.2, 0.55, 0.62, 5.72, 6.12, '#26262a'); B.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), -7.28, 0.72, 7.42, 0, 0, 0, '#1a1a1c');
      B.geo(new THREE.CylinderGeometry(0.1, 0.07, 0.2, 10), -7.25, 0.65, 5.82, 0, 0, 0, '#b08a52');
      col(-7.5, -6.94, 5.6, 7.6);
      // pooja shelf / framed photos on the west wall, clock over the partition, curtains on the door-wall windows
      for (const [b, w, c] of [[4.7, 0.42, '#c7a36a'], [5.6, 0.62, '#7a5a3a'], [6.5, 0.42, '#c7a36a']]) { B.box(-13.88, -13.86, 1.5, 2.0, b - w / 2, b + w / 2, c); B.box(-13.86, -13.85, 1.55, 1.95, b - w / 2 + 0.05, b + w / 2 - 0.05, '#8fa3ad'); }
      B.geo(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16), -8.6, 2.45, 7.87, Math.PI / 2, 0, 0, '#f2eee2'); B.box(-8.61, -8.59, 2.45, 2.57, 7.85, 7.86, '#111'); B.box(-8.6, -8.51, 2.44, 2.46, 7.85, 7.86, '#111');
      for (const [g0, g1] of [[-13.2, -12.0], [-11.2, -10.2]]) { B.box(g0 - 0.15, g1 + 0.15, 2.2, 2.24, 3.2, 3.24, '#6b4a2e'); for (const a of [g0 - 0.12, g1 - 0.12]) for (let k = 0; k < 4; k++) B.box(a + k * 0.07, a + k * 0.07 + 0.06, 0.8, 2.2, 3.17 + (k % 2) * 0.04, 3.2 + (k % 2) * 0.04, '#b5573c'); }
      // floor plant, standing fan-free corner, and a ceiling fan
      B.geo(new THREE.CylinderGeometry(0.17, 0.12, 0.34, 10), -13.5, F + 0.17, 7.6, 0, 0, 0, '#b0603a'); FO.blob(-13.5, 0.85, 7.6, 0.28, 0.5, 0.28, 26, GL, 0.24);
      B.geo(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), -10.4, ROOF - 0.22, 5.5, 0, 0, 0, '#ececec'); B.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 12), -10.4, ROOF - 0.44, 5.5, 0, 0, 0, '#ececec');
      for (let k = 0; k < 3; k++) { const t = k * 2.094 + 0.4; B.geo(new THREE.BoxGeometry(0.56, 0.012, 0.11), -10.4 + Math.cos(t) * 0.36, ROOF - 0.46, 5.5 + Math.sin(t) * 0.36, 0, -t, 0, '#e4e0d4'); }
      // tube light over the sofa
      B.box(-13.86, -13.82, 2.5, 2.54, 4.8, 6.0, '#fbfbf2'); }
    B.box(-13.7, -11.7, FLOOR, 0.5, 10.3, 12.6, C.wood); B.box(-13.7, -11.7, 0.5, 0.68, 10.35, 12.55, '#e6e0d0'); B.box(-13.65, -11.75, 0.68, 0.74, 10.5, 11.7, '#8e2a5a'); col(-13.7, -11.7, 10.3, 12.6);
    B.box(-7.65, -7.0, FLOOR, 2.1, 9.0, 10.6, '#7b5a3a'); col(-7.65, -7.0, 9.0, 10.6);

    // ================= the back plot, all at ground level (local y -YARD_H)
    { const Y = -YARD_H, Bb = YARD.b1, E = PLOT.b1, A0 = YARD.a0, A1 = YARD.a1, wall = C.creamDk;
      for (const a of RG) { B.box(a - 0.25, a + 0.25, Y, 2.2, Bb - 0.25, Bb + 0.25, C.cream); B.box(a - 0.3, a + 0.3, 2.2, 2.32, Bb - 0.3, Bb + 0.3, C.aub); col(a - 0.25, a + 0.25, Bb - 0.25, Bb + 0.25); }
      for (let i = 0; i < 5; i++) B.box(RG[0], RG[1], Y, Y + YARD_H * (5 - i) / 5, Bb + 0.05 + i * 0.32, Bb + 0.37 + i * 0.32, '#b9ad98');   // steps going down
      for (const [a0, a1, b0, b1] of [[A0 - 0.1, RD[0], E - 0.1, E + 0.1], [RD[1], A1 + 0.1, E - 0.1, E + 0.1], [A0 - 0.1, A0 + 0.1, Bb, E], [A1 - 0.1, A1 + 0.1, Bb, E]]) { B.box(a0, a1, Y, Y + 1.9, b0, b1, wall); B.box(a0 - 0.03, a1 + 0.03, Y + 1.9, Y + 1.98, b0 - 0.03, b1 + 0.03, C.cream); col(a0, a1, b0, b1); }
      // the back door in the end wall (photo 90): frame and lintel, the leaf is a moving part
      for (const a of RD) B.box(a - 0.09, a + 0.09, Y, Y + 2.1, E - 0.13, E + 0.13, C.cream); B.box(RD[0] - 0.09, RD[1] + 0.09, Y + 2.0, Y + 2.14, E - 0.13, E + 0.13, C.cream);
      // square concrete water tub for the buffaloes, under the shed edge within their reach: water, thick worn rim, a tap on a pipe
      { const T0 = { a0: -16, a1: -14.7, b0: 21.6, b1: 22.9 }, t = 0.13, h = 0.62, cc = '#a7a498', rim = '#c4c0b3';
        B.box(T0.a0, T0.a1, Y, Y + 0.12, T0.b0, T0.b1, cc); B.box(T0.a0, T0.a0 + t, Y, Y + h, T0.b0, T0.b1, cc); B.box(T0.a1 - t, T0.a1, Y, Y + h, T0.b0, T0.b1, cc); B.box(T0.a0, T0.a1, Y, Y + h, T0.b0, T0.b0 + t, cc); B.box(T0.a0, T0.a1, Y, Y + h, T0.b1 - t, T0.b1, cc);
        B.box(T0.a0 - 0.03, T0.a1 + 0.03, Y + h, Y + h + 0.05, T0.b0 - 0.03, T0.b0 + t, rim); B.box(T0.a0 - 0.03, T0.a1 + 0.03, Y + h, Y + h + 0.05, T0.b1 - t, T0.b1 + 0.03, rim); B.box(T0.a0 - 0.03, T0.a0 + t, Y + h, Y + h + 0.05, T0.b0, T0.b1, rim); B.box(T0.a1 - t, T0.a1 + 0.03, Y + h, Y + h + 0.05, T0.b0, T0.b1, rim);
        B.box(T0.a0 + t, T0.a1 - t, Y + 0.5, Y + 0.51, T0.b0 + t, T0.b1 - t, '#3f6f70');
        B.geo(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), T0.a1 + 0.1, Y + 0.5, T0.b1 - 0.3, 0, 0, 0, '#7d8a8c'); B.box(T0.a1 - 0.14, T0.a1 + 0.12, Y + 0.97, Y + 1.0, T0.b1 - 0.32, T0.b1 - 0.28, '#7d8a8c');
        col(T0.a0, T0.a1, T0.b0, T0.b1); }
      // buffalo shed: long sheet roof on posts along the west wall, stall floor, trough
      const S0 = { a0: A0 + 0.1, a1: -15, b0: Bb + 0.4, b1: 25.6 }; B.box(S0.a0, S0.a1, Y, Y + 0.06, S0.b0, S0.b1, '#8d8373');
      for (let b = S0.b0; b <= S0.b1 + 0.01; b += (S0.b1 - S0.b0) / 3) { B.box(S0.a1 - 0.08, S0.a1 + 0.08, Y, Y + 2.5, b - 0.08, b + 0.08, C.wood); col(S0.a1 - 0.08, S0.a1 + 0.08, b - 0.08, b + 0.08); }
      for (let b = S0.b0 - 0.2, i = 0; b < S0.b1 + 0.2; b += 0.45, i++) B.box(S0.a0 - 0.05, S0.a1 + 0.35, Y + 2.72, Y + 2.78, b, b + 0.42, (i & 1) ? '#9ea3a0' : '#8e9390');
      B.box(S0.a0, S0.a0 + 0.1, Y, Y + 2.74, S0.b0, S0.b1, C.greyMid); B.box(S0.a0 + 0.15, S0.a0 + 0.6, Y, Y + 0.4, S0.b0 + 0.3, S0.b1 - 0.3, '#7b6a55'); col(S0.a0 + 0.15, S0.a0 + 0.6, S0.b0 + 0.3, S0.b1 - 0.3);
      // hen enclosure in the bottom-left corner: posts and wire, a small door on its east side
      const H0 = { a0: A0 + 0.1, a1: -14.6, b0: 26.2, b1: E - 0.1 };
      for (let a = H0.a0; a <= H0.a1 + 0.01; a += 0.9) { B.box(a - 0.03, a + 0.03, Y, Y + 1.5, H0.b0 - 0.03, H0.b0 + 0.03, C.woodDk); }
      for (let b = H0.b0; b <= H0.b1; b += 0.9) B.box(H0.a1 - 0.03, H0.a1 + 0.03, Y, Y + 1.5, b - 0.03, b + 0.03, C.woodDk);
      for (const y of [0.4, 0.9, 1.45]) { B.box(H0.a0, H0.a1, Y + y, Y + y + 0.02, H0.b0 - 0.01, H0.b0 + 0.01, '#b8b8b0'); B.box(H0.a1 - 0.01, H0.a1 + 0.01, Y + y, Y + y + 0.02, H0.b0, H0.b1, '#b8b8b0'); }
      B.box(H0.a1 - 0.02, H0.a1 + 0.05, Y, Y + 0.75, 28.2, 28.95, C.wood); B.box(H0.a0 + 0.1, H0.a0 + 1.4, Y, Y + 1.1, H0.b1 - 1.5, H0.b1 - 0.1, C.wood);
      col(H0.a0, H0.a1, H0.b0 - 0.05, H0.b0 + 0.05); col(H0.a1 - 0.05, H0.a1 + 0.05, H0.b0, H0.b1);
      // soil patch and the yellow-flowering tree at the bottom wall
      const G0 = [[-12.6, 27.2], [-6.8, 26.8], [-6.2, E - 0.1], [-13.2, E - 0.1]]; { const sh = new THREE.Shape(); G0.forEach((q, i) => i ? sh.lineTo(q[0], -q[1]) : sh.moveTo(q[0], -q[1])); sh.closePath(); B.geo(new THREE.ShapeGeometry(sh), 0, Y + 0.03, 0, -Math.PI / 2, 0, 0, '#6e4a30'); }
      B.geo(new THREE.CylinderGeometry(0.14, 0.24, 2.2, 7), -9.6, Y + 1.1, E - 0.9, 0, 0, 0, '#5a4630'); col(-9.8, -9.4, E - 1.1, E - 0.7); PLOT_TREE = [-9.6, Y + 3.0, E - 0.9];
      // two washrooms stacked in the bottom-right corner, doors into the plot
      const WR = { a0: -5.4, a1: A1 - 0.1, b0: 25.0, b1: E - 0.1 }, mid = (WR.b0 + WR.b1) / 2; B.box(WR.a0, WR.a1, Y, Y + 2.4, WR.b0, WR.b1, C.cream); B.box(WR.a0 - 0.1, WR.a1 + 0.05, Y + 2.4, Y + 2.52, WR.b0 - 0.1, WR.b1, '#c9c2b4'); col(WR.a0, WR.a1, WR.b0, WR.b1); edgeBox(WR.a0, WR.a1, Y, Y + 2.4, WR.b0, WR.b1); B.box(WR.a0 - 0.02, WR.a0 + 0.02, Y, Y + 2.4, mid - 0.04, mid + 0.04, C.creamDk);
      for (const b of [(WR.b0 + mid) / 2, (mid + WR.b1) / 2]) { B.box(WR.a0 - 0.05, WR.a0, Y, Y + 2.0, b - 0.45, b + 0.45, C.wood); B.box(WR.a0 - 0.08, WR.a0 - 0.05, Y + 0.95, Y + 1.05, b + 0.25, b + 0.33, C.yellow); } }
    const mesh = B.mesh(); root.add(mesh);
    (window.WALKABLES = window.WALKABLES || []).push(mesh);
    // no jumping over the compound walls: an invisible guard to 6 m in the walkable set, so the jump test finds them solid
    { const gm = new THREE.MeshBasicMaterial(), H = 6, e = 0.16, g = new THREE.Group();
      for (const [a0, a1, b0, b1] of [[YARD.a0 - e, PG[0] - 0.2, WB - e, WB + e], [PG[1] + 0.2, MG[0] - 0.25, WB - e, WB + e], [MG[1] + 0.25, YARD.a1 + e, WB - e, WB + e], [YARD.a0 - e, YARD.a0 + e, WB, YARD.b1], [YARD.a1 - e, YARD.a1 + e, WB, YARD.b1], [YARD.a0, RG[0] - 0.25, YARD.b1 - e, YARD.b1 + e], [RG[1] + 0.25, YARD.a1, YARD.b1 - e, YARD.b1 + e]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0, H, b1 - b0), gm); m.position.set((a0 + a1) / 2, H / 2, (b0 + b1) / 2); g.add(m); }
      g.children.forEach(m => { m.material = gm; }); g.visible = false; root.add(g); root.updateMatrixWorld(true);
      window.WALKABLES.push(...g.children); }
    root.add(lines(edges, 0x3c3c3e));
    for (let i = 0; i < 7; i++) FO.blob(PLOT_TREE[0] + Math.cos(i * 2.1) * 1.1, PLOT_TREE[1] + Math.sin(i * 1.3) * 0.5, PLOT_TREE[2] - 0.2 + Math.sin(i * 2.1) * 0.6, 1.2, 0.9, 0.9, 70, [['#e6c22a', 4], ['#f2d84a', 3], ['#5d8a30', 3]], 0.3);
    root.add(FO.mesh());

    // ================= animated parts: gates, door, flag, pendant light
    const hM = 2.0, gw = (MG[1] - MG[0]) / 2 - 0.25;
    const gMat = new THREE.MeshLambertMaterial({ map: gateLeafTex(true, hM), alphaTest: 0.5, side: THREE.DoubleSide });
    const leaf = (hingeA, sign) => {
      const p = new THREE.Group(); p.position.set(hingeA, -YARD_H, WB);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, hM), gMat); m.position.set(sign * gw / 2, hM / 2 + 0.03, 0); if (sign < 0) m.scale.x = -1;
      p.add(m); root.add(p); return p;
    };
    parts.gateL = leaf(MG[0] + 0.25, 1); parts.gateR = leaf(MG[1] - 0.25, -1);
    { const bw = (RG[1] - RG[0]) / 2, rear = (h, sign) => { const p = new THREE.Group(); p.position.set(h, 0, YARD.b1); const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, hM), gMat); m.position.set(sign * bw / 2, hM / 2 + 0.03, 0); if (sign < 0) m.scale.x = -1; p.add(m); root.add(p); return p; }; parts.backL = rear(RG[0], 1); parts.backR = rear(RG[1], -1); }
    const pgw = PG[1] - PG[0] - 0.4;
    parts.ped = new THREE.Group(); parts.ped.position.set(PG[0] + 0.2, 0, WB);
    { const pm = new THREE.MeshLambertMaterial({ map: gateLeafTex(false, 1.7), alphaTest: 0.5, side: THREE.DoubleSide }); const m = new THREE.Mesh(new THREE.PlaneGeometry(pgw, 1.7), pm); m.position.set(pgw / 2, 0.88, 0); parts.ped.add(m); root.add(parts.ped); }
    parts.door = new THREE.Group(); parts.door.position.set(DOOR[0], FLOOR, 3.0);
    { const dw = DOOR[1] - DOOR[0], d = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.08, 0.06), new THREE.MeshLambertMaterial({ color: C.wood })); d.position.set(dw / 2, 1.04, 0); parts.door.add(d);
      // raised panels on both faces and a brass handle, so the leaf reads as a door and not a board
      const pm = new THREE.MeshLambertMaterial({ color: C.woodDk }), pw = dw / 2 - 0.16;
      for (const px of [0.11, dw / 2 + 0.05]) for (const [py, ph] of [[0.16, 0.62], [0.9, 0.62], [1.64, 0.3]]) { const q = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.075), pm); q.position.set(px + pw / 2, py + ph / 2, 0); parts.door.add(q); }
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.11), new THREE.MeshLambertMaterial({ color: 0xd4a82a })); hd.position.set(dw - 0.09, 1.05, 0); parts.door.add(hd);
      root.add(parts.door); }
    const leafDoor = (a0, a1, y, b, color) => { const g = new THREE.Group(), w = a1 - a0, m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.02, 0.05), new THREE.MeshLambertMaterial({ color })), hd = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.07), new THREE.MeshLambertMaterial({ color: 0xd4a82a })); g.position.set(a0, y, b); m.position.set(w / 2, 1.03, 0); hd.position.set(w - 0.12, 1.0, 0); g.add(m, hd); root.add(g); return g; };
    parts.kd = leafDoor(KD[0], KD[1], FLOOR, KIT.b1 + 0.11, C.wood); parts.rd = leafDoor(RD[0], RD[1], -YARD_H, PLOT.b1, '#5a6b4a');
    { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); pole.position.set(YARD.a0 + 0.05, 1.9 + 0.8, WB);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide })); fl.position.set(YARD.a0 + 0.3, 3.3, WB); root.add(pole, fl); }
    { const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c4 })); bulb.position.set(-8.1, ROOF - 0.55, 0.0);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), new THREE.MeshBasicMaterial({ color: 0x222222 })); wire.position.set(-8.1, ROOF - 0.25, 0.0); root.add(bulb, wire); }
    { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.8), new THREE.MeshBasicMaterial({ map: tvTex() })); s.position.set(-7.085, 1.14, 6.6); s.rotation.y = -Math.PI / 2; root.add(s); }
    parts.lamp = new THREE.PointLight(0xffe2b0, 0, 12, 1.6); parts.lamp.position.set(-10.4, ROOF - 0.4, 7.5); root.add(parts.lamp);

    scene.add(root);
    blockers.back = Blocker(RG[0], RG[1], YARD.b1 - 0.12, YARD.b1 + 0.12); blockers.back.set(true);
    blockers.gate = Blocker(MG[0] + 0.25, MG[1] - 0.25, WB - 0.12, WB + 0.12);
    blockers.ped = Blocker(PG[0] + 0.2, PG[1] - 0.2, WB - 0.12, WB + 0.12);
    blockers.door = Blocker(DOOR[0], DOOR[1], 2.88, 3.12);
    blockers.kd = Blocker(KD[0], KD[1], KIT.b1, 16.6); blockers.rd = Blocker(RD[0], RD[1], PLOT.b1 - 0.12, PLOT.b1 + 0.12);
    for (const k in blockers) blockers[k].set(true);
    MGc = { a: (MG[0] + MG[1]) / 2, b: WB }; PG_CLEAR = PG[1] - PG[0] - 0.4; PGc = { a: (PG[0] + PG[1]) / 2, b: WB }; DOORc = { a: (DOOR[0] + DOOR[1]) / 2, b: 3.0 };
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
  const parts = {}, blockers = {}; let PLOT_TREE = [0, 0, 0], penDone = false;
  let MGc, PGc, DOORc, PG_CLEAR = 0, MG_ = [-6.3, -2.2];
  const anim = { gate: 0, ped: 0, door: 0, back: 0, kd: 0, rd: 0 }, want = { gate: false, ped: false, door: false, back: false, kd: false, rd: false }, manual = { gate: null, door: false };
  let gateBlocked = '';     // why the gate cannot swing shut right now ('' = free)

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
      const p = W(s.a, s.b); v.g.position.set(p.x, groundY(p.x, p.z), p.z); v.g.rotation.y = slotRot(s); scene.add(v.g);
      const obj = { ...v, model: st.kind, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, wheels: v.wheels || [], tail: v.tail || [], _safeSlot: s.id, _waiting: true };
      live[s.id] = obj; P.addParked(obj);
    }
  }
  // ---------------------------------------------------------------- bike row in the front courtyard
  // The family's motorbikes stand at the side of the house along the east compound wall, in the courtyard strip between
  // the gate and the car porch: cross-parked at one angle (55 deg to the wall), back wheels to the wall, noses toward the
  // gate and clear of the driveway, each leaning a little on its side stand. Built with TrafficModels, registered with
  // Player.addParked so F mounts exactly that bike.
  // Fixed layout set by the player in the game (world x, z, heading): nine bikes plus the bicycle beside the Classic 350.
  const BIKE_LAYOUT = [
    ['classic', 38.254, -271.070, 1.7307], ['classic2', 39.671, -274.256, 1.1286], ['sport', 36.213, -271.227, -3.6911],
    ['faired', 35.624, -276.025, 0.1092], ['hayabusa', 37.866, -274.854, 0.2318], ['s1000rr', 36.767, -275.535, 0.0878],
    ['r1300gsa', 34.076, -272.918, 2.5163], ['r1250gsa', 35.209, -271.772, -3.6397], ['scooter', 42.311, -272.603, 4.1550],
    ['cycle', 38.111, -271.958, 1.7307]];
  const BIKE_ROW = BIKE_LAYOUT.map(q => q[0]);
  const rowBikes = [];
  function spawnBikeRow() {
    const P = PL(), TMs = TM(); if (!P || !TMs || !P.addParked || rowBikes.length) return;
    const ANG = 55 * Math.PI / 180, rot = TH + Math.PI + ANG;  // -b (toward the front wall) turned ANG toward -a (the house)
    BIKE_ROW.forEach((kind, i) => {
      if (!TMs[kind]) return;
      const v = TMs[kind](); v.g.name = 'safehouse-bike-' + kind;
      const L = BIKE_LAYOUT[i], p = { x: L[1], z: L[2] };
      v.g.position.set(p.x, groundY(p.x, p.z), p.z); v.g.rotation.order = 'YXZ'; v.g.rotation.set(0, L[3], 0);   // upright, as the player parked them
      const stand = { parent: null };
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
    if (mode === 'foot' && Math.hypot(l.a - (KD[0] + KD[1]) / 2, l.b - 16.5) < 1.7) return { t: want.kd ? 'close kitchen door' : 'open kitchen door', f: () => { want.kd = !want.kd; } };
    if (mode === 'foot' && Math.hypot(l.a - (RD[0] + RD[1]) / 2, l.b - PLOT.b1) < 1.8) return { t: want.rd ? 'close back door' : 'open back door', f: () => { want.rd = !want.rd; } };
    if (mode === 'foot' && Math.hypot(l.a - (RG[0] + RG[1]) / 2, l.b - YARD.b1) < 1.9) return { t: want.back ? 'close back gate' : 'open back gate', f: () => { want.back = !want.back; blockers.back.set(!want.back); } };
    if (mode === 'vehicle' || mode === 'crysta') {
      if (inYard(l)) { const s = slotAt(carPos.x, carPos.z, 2.0); if (s && mode === 'vehicle') return { t: 'store vehicle here', f: () => storeVehicle(s) }; }
      if (d(MGc) < 7) return gateAction();
      return null;
    }
    if (mode !== 'foot') return null;
    if (d(DOORc) < 1.7) return { t: want.door ? 'close door' : 'open door', f: () => { manual.door = !want.door; } };
    if (l.a > -13.9 && l.a < -11.5 && l.b > 9.8 && l.b < 12.7) return { t: 'sleep till morning & save', f: sleep };
    if (l.a > -8.6 && l.a < -7.6 && l.b > 8.8 && l.b < 10.8) return { t: 'wardrobe · change outfit', f: wardrobe };
    if (d(MGc) < 3.2) return gateAction();
    return null;
  }
  // E at the main gate: open / close it by hand (manual wins over the automatic opening until you walk / drive away)
  function gateAction() {
    if (gateBlocked) { const msg = 'gate blocked · ' + gateBlocked; return { t: msg, f: () => G.showPopup && G.showPopup(msg.toUpperCase()) }; }
    return { t: want.gate ? 'close gate' : 'open gate', f: () => { manual.gate = want.gate ? 'close' : 'open'; } };
  }
  // anything in the arc the two leaves sweep (a MG range, b from the wall 2.2 m into the yard)? Says what, for the prompt.
  function swingBlocked() {
    const inArc = (x, z, r) => { const q = L(x, z); return q.a > MG_[0] - r && q.a < MG_[1] + r && q.b > MGc.b - 0.4 - r && q.b < MGc.b + 2.25 + r; };
    const veh = v => { const g = v && v.g; if (!g || !g.parent) return false; const hl = (v.len2 || (v.len && v.len < 20 ? v.len / 2 : 2.1)), fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y);
      for (let t = -hl; t <= hl + 1e-3; t += hl / 2) if (inArc(g.position.x + fx * t, g.position.z + fz * t, v.hw || 0.9)) return true; return false; };
    const P = PL();
    if (G.playerMode === 'crysta' || G.playerMode === 'vehicle') { const fx = Math.sin(carRot), fz = Math.cos(carRot); for (let t = -2.2; t <= 2.2; t += 1.1) if (inArc(carPos.x + fx * t, carPos.z + fz * t, 0.9)) return 'your vehicle is in the way'; }
    else if (inArc(carPos.x, carPos.z, 0.4)) return 'you are in the way';
    try { if (P) { for (const v of P.parkedList || []) if (veh(v)) return 'a parked vehicle is in the way'; } } catch (e) {}
    try { for (const v of traffic) if (veh(v)) return 'a vehicle is in the way'; } catch (e) {}
    try { if (window.Crowd) for (const a of Crowd.agents) if (a.g.parent && inArc(a.g.position.x, a.g.position.z, a.r)) return 'someone is in the way'; } catch (e) {}
    try { const f = window.Visitors && Visitors.friendsGroup; if (f && f.car && veh({ g: f.car.g, hw: 0.95, len2: 2.1 })) return "a friend's car is in the way"; } catch (e) {}
    return '';
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
    window.SafeHouse2 = { dbg: () => ({ npcGate, npcPed, holdGate, gateBlocked }), W, L, slots: SLOTS, pedGate: { a: PGc.a, b: PGc.b, w: PG_CLEAR }, doorPt: { a: DOORc.a, b: DOORc.b }, yard: YARD, live, state: S, anim, want, manual, center: c, gate: W(MGc.a, MGc.b - 6), door: W(DOORc.a, DOORc.b) };
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
    try { if (window.RoadAnimals) for (const a of RoadAnimals) veh(a, 2.8); } catch (e) {}   // only an animal right in the gateway (a cat on the lane must not hold it open)
    try { if (world.people) for (const h of world.people) foot(h); } catch (e) {}
    try { if (window.Crowd) for (const a of Crowd.agents) foot(a); } catch (e) {}
    try { if (window.AutoRides && AutoRides.npcs) for (const n of AutoRides.npcs) foot(n.h || n); } catch (e) {}
  }
  let MGw = { x: 0, z: 0 };

  let cur = null;
  GameHooks.update.push((dt, game) => {
    if (!root) return;
    const mode = game.playerMode, l = L(carPos.x, carPos.z);
    const dG = Math.hypot(l.a - MGc.a, l.b - MGc.b);
    const driving = mode === 'vehicle' || mode === 'crysta';
    if (dG > 14) manual.gate = null;
    // automatic gates: the main gate opens for the player (driving or riding; on foot only with E) and for any NPC
    // vehicle / cart / herd / walker near it; the pedestrian gate for anyone on foot. Both stay open while somebody
    // is still in the gateway and close a moment after the last one has gone.
    if ((npcT -= dt) <= 0) { npcT = 0.25; scanNpcs(); }
    // the player's vehicle only holds the gate while it is actually moving near / through the gateway (a car parked in
    // the yard no longer keeps it open for ever)
    const moving = Math.abs(typeof carSpeed === 'number' ? carSpeed : 0) > 2;
    const pGate = (driving && moving && (dG < 10 || inYard(l) && dG < 12)) || (mode === 'passenger' && dG < 10);
    const pPed = mode === 'foot' && Math.hypot(l.a - PGc.a, l.b - PGc.b) < 3.0;
    holdGate = pGate || npcGate ? 1.2 : Math.max(0, holdGate - dt);
    holdPed = pPed || npcPed ? 1.0 : Math.max(0, holdPed - dt);
    // closed by hand stays closed for passers-by: once shut it is 'shut', when only the player's own approach reopens it
    // (traffic on the lane used to reopen it the moment it latched, which read as E not working). Reset at dG > 14.
    if (manual.gate === 'close' && anim.gate === 0 && !pGate) manual.gate = 'shut';
    want.gate = manual.gate === 'open' ? true : manual.gate === 'close' ? false : manual.gate === 'shut' ? pGate : mode === 'foot' && dG < 6 ? false : holdGate > 0;
    // never swing shut into a vehicle or a person standing in the leaves' arc
    gateBlocked = !want.gate && anim.gate > 0.02 ? swingBlocked() : '';
    if (gateBlocked) want.gate = true;
    want.ped = holdPed > 0;
    if (Math.hypot(l.a - DOORc.a, l.b - DOORc.b) > 3.2) manual.door = false;
    want.door = manual.door;
    // multiplayer: publish what this client wants, then open for whatever anyone else wants
    { const R = S.remote, lw = S.localWant || (S.localWant = {}); lw.gate = want.gate; lw.ped = want.ped; lw.door = want.door;
      if (R) { want.gate = want.gate || R.gate; want.ped = want.ped || R.ped; want.door = want.door || R.door; } }
    for (const k of ['gate', 'ped', 'door', 'kd', 'rd']) {
      const sp = k === 'gate' ? 0.6 : 1.2, t = want[k] ? 1 : 0;
      anim[k] += Math.sign(t - anim[k]) * Math.min(Math.abs(t - anim[k]), dt * sp);
      blockers[k].set(anim[k] < 0.05);
    }
    const e = x => x * x * (3 - 2 * x);
    parts.gateL.rotation.y = -e(anim.gate) * Math.PI * 0.5; parts.gateR.rotation.y = e(anim.gate) * Math.PI * 0.5;
    if (!penDone && window.PenAnimal) { const q = [W(-17.2, 20.6), W(-17.2, 22.4), W(-17.2, 24.2)], h = W(-17, 28.6); if (PenAnimal('buffalo', q[0].x, q[0].z, 0.5)) { penDone = true; q.slice(1).forEach(p => PenAnimal('buffalo', p.x, p.z, 0.5)); for (let i = 0; i < 6; i++) PenAnimal('hen', h.x + (i - 2.5) * 0.3, h.z + (i % 3 - 1) * 0.4, 1.6); } }
    anim.back += ((want.back ? 1 : 0) - anim.back) * Math.min(1, dt * 3); parts.backL.rotation.y = e(anim.back) * Math.PI * 0.5; parts.backR.rotation.y = -e(anim.back) * Math.PI * 0.5;
    parts.ped.rotation.y = -e(anim.ped) * Math.PI * 0.5;
    parts.door.rotation.y = -e(anim.door) * Math.PI * 0.55;
    parts.kd.rotation.y = e(anim.kd) * Math.PI * 0.55; parts.rd.rotation.y = -e(anim.rd) * Math.PI * 0.55;
    const inKit = l.a > KIT.a0 && l.a < KIT.a1 && l.b > KIT.b0 && l.b < KIT.b1;
    if (inKit) parts.lamp.position.set(-10.5, ROOF - 0.4, 14.7); else if (inHouse(l)) parts.lamp.position.set(-10.4, ROOF - 0.4, 7.5);
    parts.lamp.intensity += ((inHouse(l) || inKit ? 1.1 : 0) - parts.lamp.intensity) * Math.min(1, dt * 4);
    safeTag.style.display = inYard(l) ? 'block' : 'none';
    checkTaken();
    cur = propsPanelOpen() ? null : currentAction();
    setHint(cur ? cur.t : null);
  });

  // first in the queue: properties.js also takes E (any plot or bay in reach opens its panel) and would swallow the gate
  GameHooks.key.unshift((e) => {
    if (e.code !== 'KeyE' || e.repeat || !root || propsPanelOpen()) return false;
    const a = currentAction(); if (!a) return false;
    a.f(); return true;
  });
})();
