// safehouse.js: the player's home, cloned from Google Street View (17.70398 N, 79.19688 E, heading ~275, Oct 2022).
// Single-storey cream RCC house with a stepped white parapet, veranda on slim pillars, scalloped-arch porch at the
// west corner, Indian flag, mauve compound wall with black wrought-iron gates, courtyard + shed with rolling shutter.
// Footprint = map building #317 (Esri z18 mosaic): 14.85 x 13.1 m, front face parallel to the CC lane, lane ~5.7 m off.
// The courtyard is the open plot east of the house (between it and building #316), where the main gate opens to the lane.
//
// Owned from the start (it is the player's home). Controls, all non-conflicting with properties.js:
//   gate: opens by itself when you arrive in a vehicle; on foot E at the gate
//   shutter: rises by itself when a vehicle is in front of the shed; on foot E at it
//   store: stop in a marked slot and press E (stays there, saved; F to take it out again)
//   front door: E on the veranda (closes behind you); bed: E = save + sleep till 7 AM; wardrobe: E = outfit
(function () {
  'use strict';
  const SAVE_KEY = 'nellutla.safehouse';

  // ---------------------------------------------------------------- frame: local (a along the lane, b into the plot)
  const O = { x: 38.8, z: -272.2 };                       // front-west corner of the house footprint
  const UX = 13.2 / 14.857, UZ = 6.8 / 14.857;            // along the front face (ENE)
  const NX = -UZ, NZ = UX;                                // into the plot (SSE)
  const TH = Math.atan2(-UZ, UX);                         // group / collider rotation: local +x -> u, local +z -> n
  const W = (a, b) => ({ x: O.x + a * UX + b * NX, z: O.z + a * UZ + b * NZ });
  const L = (x, z) => { const dx = x - O.x, dz = z - O.z; return { a: dx * UX + dz * UZ, b: dx * NX + dz * NZ }; };
  const HOUSE = { a0: 0, a1: 14.85, b0: 0, b1: 13.1 }, YARD = { a0: -1, a1: 23.4, b0: -2.8, b1: 13.6 };

  // remove the generic footprint (#317, centroid 42.4,-263.0); runs before the world is built
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 42.4, z: -263.0, r: 4 });
  window.NELLUTLA_EXCLUDE.push({ x: 61.35, z: -264.4, r: 1.5, walls: true });   // old generic wall #50 just outside the new front wall

  // ---------------------------------------------------------------- state
  let G = null, world = null, scene = null, root = null;
  const S = { stored: [] };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && Array.isArray(s.stored)) S.stored = s.stored; } catch (e) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, stored: S.stored.map(s => ({ kind: s.kind, slot: s.slot, color: s.color })) })); } catch (e) {} }
  const live = {};                                         // slot id -> vehicle object
  const PL = () => { try { return Player; } catch (e) { return null; } };
  const TM = () => { try { return TrafficModels; } catch (e) { return null; } };

  // ---------------------------------------------------------------- geometry builder (merged, vertex coloured)
  function Builder() {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    function addGeo(geo, m, color) {
      const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m);
      const p = g.attributes.position.array, n = g.attributes.normal.array; c.set(color);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
    }
    const m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    return {
      // box from a0..a1, y0..y1, b0..b1 (local frame)
      box(a0, a1, y0, y1, b0, b1, color) { m4.makeTranslation((a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2); addGeo(new THREE.BoxGeometry(Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(b1 - b0)), m4, color); },
      geo(geo, x, y, z, rx, ry, rz, color) { e.set(rx || 0, ry || 0, rz || 0); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, sc); addGeo(geo, m4, color); },
      mesh(mat) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        return new THREE.Mesh(g, mat || new THREE.MeshLambertMaterial({ vertexColors: true }));
      },
    };
  }
  function lines(segs, color) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
  }
  function boxEdges(out, a0, a1, y0, y1, b0, b1) {
    const P = [[a0, y0, b0], [a1, y0, b0], [a1, y0, b1], [a0, y0, b1], [a0, y1, b0], [a1, y1, b0], [a1, y1, b1], [a0, y1, b1]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of E) out.push(...P[i], ...P[j]);
  }

  // ---------------------------------------------------------------- textures
  function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t; }
  const gateTex = () => canvasTex(256, 128, (x, w, h) => {
    x.strokeStyle = '#141414'; x.lineCap = 'round';
    x.lineWidth = 7; x.strokeRect(4, 4, w - 8, h - 8); x.beginPath(); x.moveTo(0, 46); x.lineTo(w, 46); x.stroke();
    x.lineWidth = 4; for (let i = 18; i < w - 8; i += 16) { x.beginPath(); x.moveTo(i, 46); x.lineTo(i, h - 4); x.stroke(); }
    // ornamental top panel: S-scrolls and circles
    x.lineWidth = 3;
    for (let i = 0; i < 8; i++) { const cx = 16 + i * 32; x.beginPath(); x.arc(cx, 26, 11, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(cx + 16, 18, 6, Math.PI, 0); x.stroke(); x.beginPath(); x.arc(cx + 16, 34, 6, 0, Math.PI); x.stroke(); }
    // spear tips along the bottom rail band and diamond
    for (let i = 18; i < w - 8; i += 16) { x.beginPath(); x.moveTo(i - 4, 92); x.lineTo(i, 84); x.lineTo(i + 4, 92); x.stroke(); }
  });
  const flagTex = () => canvasTex(96, 64, (x) => {
    x.fillStyle = '#ff9933'; x.fillRect(0, 0, 96, 22); x.fillStyle = '#ffffff'; x.fillRect(0, 21, 96, 22); x.fillStyle = '#138808'; x.fillRect(0, 42, 96, 22);
    x.strokeStyle = '#000080'; x.lineWidth = 1.5; x.beginPath(); x.arc(48, 32, 8, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; x.beginPath(); x.moveTo(48, 32); x.lineTo(48 + Math.cos(a) * 8, 32 + Math.sin(a) * 8); x.stroke(); }
  });
  const shutterTex = () => canvasTex(64, 128, (x, w, h) => { x.fillStyle = '#9aa0a3'; x.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { x.fillStyle = '#7d8386'; x.fillRect(0, y, w, 2); x.fillStyle = '#b6bbbd'; x.fillRect(0, y + 3, w, 1); } });
  const tvTex = () => canvasTex(64, 36, (x) => { const gr = x.createLinearGradient(0, 0, 64, 36); gr.addColorStop(0, '#1d3d6b'); gr.addColorStop(1, '#5a2a68'); x.fillStyle = gr; x.fillRect(0, 0, 64, 36); x.fillStyle = '#ffd34d'; x.font = 'bold 9px sans-serif'; x.fillText('TV9', 4, 12); });

  // ---------------------------------------------------------------- colliders
  const cols = [];
  function col(a0, a1, b0, b1) {
    if (!world.addCollider) return null;
    const c = W((a0 + a1) / 2, (b0 + b1) / 2), h = world.addCollider(c.x, c.z, Math.abs(a1 - a0) / 2, Math.abs(b1 - b0) / 2, TH);
    cols.push(h); return h;
  }
  // a door / gate collider that can be toggled
  function Blocker(a0, a1, b0, b1) { let h = null; return { set(on) { if (on && !h) h = col(a0, a1, b0, b1); else if (!on && h) { world.removeCollider(h); h = null; } } }; }

  // ---------------------------------------------------------------- colours (from the Street View photo)
  const C = {
    cream: '#f2dc8e', creamDk: '#d8c070', white: '#f7f5ee', grey: '#4a4a4a', plinth: '#8c8478', mauve: '#b79cc4', mauveDk: '#9a7fa8',
    stone: '#7d766c', wood: '#5a3520', woodDk: '#3d2414', red: '#b8382c', yellow: '#e2b93b', floor: '#d8cfc0', slab: '#c9c2b4',
    cc: '#bdb8ae', mark: '#f2f2f2', green: '#3f7a2c', green2: '#2f6324', bougain: '#d2287a', steel: '#c4c8cc', sheet: '#8d969b',
  };
  const FLOOR = 0.12;            // floor slab top (low so the walker doesn't sink; steps are shallow)
  const WALLH = 3.25, ROOF = 3.25;

  // ---------------------------------------------------------------- build
  function build() {
    root = new THREE.Group(); root.position.set(O.x, 0, O.z); root.rotation.y = TH; root.name = 'safehouse';
    const B = Builder(), edges = [];
    const { a0: h0, a1: h1, b1: hb1 } = HOUSE;
    const VB = 2.4;                                  // veranda depth: front wall of the rooms at b = 2.4

    // plinth + floor
    B.box(-0.3, h1 + 0.2, 0, FLOOR, -1.0, hb1 + 0.2, C.plinth);
    B.box(0, h1, FLOOR, FLOOR + 0.01, VB, hb1, C.floor);
    B.box(-0.3, h1 + 0.2, FLOOR, FLOOR + 0.01, -1.0, VB, '#c7b9a3');            // veranda / porch floor (red oxide-ish)
    // steps up to the porch (red / yellow)
    B.box(0.6, 2.8, 0, 0.06, -1.6, -1.0, C.red); B.box(0.6, 2.8, 0.06, 0.09, -1.6, -1.3, C.yellow);

    // ------ exterior walls of the rooms (b 2.4..13.1), 0.23 thick, with openings
    const T = 0.23;
    const wallA = (b, a0, a1, gaps, color) => {    // wall running along a at depth b
      let a = a0; for (const [g0, g1, sill, head] of [...gaps, [a1, a1, 0, 0]]) {
        if (g0 > a) { B.box(a, g0, FLOOR, WALLH, b - T / 2, b + T / 2, color); col(a, g0, b - T / 2, b + T / 2); }
        if (g1 > g0) { if (sill > 0) B.box(g0, g1, FLOOR, sill, b - T / 2, b + T / 2, color); if (head < WALLH) B.box(g0, g1, head, WALLH, b - T / 2, b + T / 2, color); if (sill > 0.5) col(g0, g1, b - T / 2, b + T / 2); }
        a = g1;
      }
    };
    const wallB = (a, b0, b1, gaps, color) => {
      let b = b0; for (const [g0, g1, sill, head] of [...gaps, [b1, b1, 0, 0]]) {
        if (g0 > b) { B.box(a - T / 2, a + T / 2, FLOOR, WALLH, b, g0, color); col(a - T / 2, a + T / 2, b, g0); }
        if (g1 > g0) { if (sill > 0) B.box(a - T / 2, a + T / 2, FLOOR, sill, g0, g1, color); if (head < WALLH) B.box(a - T / 2, a + T / 2, head, WALLH, g0, g1, color); if (sill > 0.5) col(a - T / 2, a + T / 2, g0, g1); }
        b = g1;
      }
    };
    // front (veranda) wall: main door 5.5..6.6, two side doors (fixed, closed), windows
    const DOOR = [5.5, 6.6];
    wallA(VB, h0, h1, [[1.4, 2.4, 0.9, 2.1], [3.4, 4.2, 0.9, 2.1], DOOR.concat([0, 2.2]), [8.3, 9.3, 0, 2.2], [10.6, 11.6, 0.9, 2.1], [12.7, 13.5, 0.9, 2.1]], C.cream);
    wallA(hb1, h0, h1, [[2.5, 3.5, 0.9, 2.1], [10.5, 11.5, 0.9, 2.1]], C.cream);
    wallB(h0, VB, hb1, [[5, 6, 0.9, 2.1], [10, 11, 0.9, 2.1]], C.cream);
    wallB(h1, VB, hb1, [[4, 5, 0.9, 2.1], [10, 11, 0.9, 2.1]], C.cream);
    // interior partitions (cream inside too) with open doorways
    wallB(8, VB, hb1, [[4.0, 5.2, 0, 2.2]], '#f2ead2');           // hall | kitchen + back room
    wallA(8.2, h0, 8, [[3.0, 4.2, 0, 2.2]], '#f2ead2');           // hall | bedroom
    wallA(7.2, 8, h1, [[10.0, 11.2, 0, 2.2]], '#f2ead2');         // kitchen | store
    // dark wooden doors / windows (on the facade, closed ones)
    const winA = (b, g0, g1, sill, head) => { B.box(g0, g1, sill, head, b - 0.04, b + 0.04, C.woodDk); for (let a = g0 + 0.12; a < g1; a += 0.14) B.box(a, a + 0.03, sill, head, b - 0.09, b + 0.09, '#222'); };
    const winB = (a, g0, g1, sill, head) => { B.box(a - 0.04, a + 0.04, sill, head, g0, g1, C.woodDk); for (let b = g0 + 0.12; b < g1; b += 0.14) B.box(a - 0.09, a + 0.09, sill, head, b, b + 0.03, '#222'); };
    winA(VB, 1.4, 2.4, 0.9, 2.1); winA(VB, 3.4, 4.2, 0.9, 2.1); winA(VB, 10.6, 11.6, 0.9, 2.1); winA(VB, 12.7, 13.5, 0.9, 2.1);
    winA(hb1, 2.5, 3.5, 0.9, 2.1); winA(hb1, 10.5, 11.5, 0.9, 2.1);
    winB(h0, 5, 6, 0.9, 2.1); winB(h0, 10, 11, 0.9, 2.1); winB(h1, 4, 5, 0.9, 2.1); winB(h1, 10, 11, 0.9, 2.1);
    // second veranda door (fixed shut, dark brown panelled)
    B.box(8.3, 9.3, FLOOR, 2.2, VB - 0.05, VB + 0.05, C.wood); B.box(8.35, 9.25, 1.0, 1.1, VB - 0.08, VB - 0.05, C.woodDk); col(8.3, 9.3, VB - 0.1, VB + 0.1);
    // door frames
    for (const [g0, g1] of [DOOR, [8.3, 9.3]]) { B.box(g0 - 0.08, g0, FLOOR, 2.28, VB - 0.15, VB + 0.15, C.woodDk); B.box(g1, g1 + 0.08, FLOOR, 2.28, VB - 0.15, VB + 0.15, C.woodDk); B.box(g0 - 0.08, g1 + 0.08, 2.2, 2.28, VB - 0.15, VB + 0.15, C.woodDk); }

    // ------ veranda: slim square pillars along the front, roof slab over everything
    for (let a = 3.6; a <= h1 - 0.1; a += 2.24) { B.box(a - 0.12, a + 0.12, FLOOR, ROOF, -0.12, 0.12, C.white); col(a - 0.12, a + 0.12, -0.12, 0.12); }
    B.box(h1 - 0.3, h1, FLOOR, ROOF, -0.15, 0.15, C.white); col(h1 - 0.3, h1, -0.15, 0.15);
    B.box(3.5, h1, ROOF - 0.35, ROOF, -0.15, 0.15, C.creamDk);                 // beam
    B.box(-0.35, h1 + 0.2, ROOF, ROOF + 0.15, -1.0, hb1 + 0.2, C.slab);        // roof slab (porch projects to -1.0)
    B.box(-0.35, h1 + 0.2, ROOF - 0.08, ROOF, -1.0, hb1 + 0.2, C.creamDk);     // drip band
    B.box(0, h1, ROOF - 0.02, ROOF - 0.01, 0, hb1, '#f6f2e6');                 // ceiling
    // half-wall rail between the veranda pillars (low, leaves the porch open)
    B.box(14.0, h1, FLOOR, 0.75, -0.1, 0.1, C.cream); col(14.0, h1, -0.1, 0.1);

    // ------ arched porch at the west corner: scalloped (multi-foil) arches on the front and the west side
    const porch = { a0: -0.3, a1: 3.5, b0: -1.0, b1: VB };
    const piers = [[porch.a0, porch.b0], [porch.a1, porch.b0], [porch.a0, VB - 0.2]];
    for (const [a, b] of piers) { B.box(a - 0.2, a + 0.2, FLOOR, ROOF, b - 0.2, b + 0.2, C.white); col(a - 0.2, a + 0.2, b - 0.2, b + 0.2); }
    function foilArch(span0, span1, along, at, axisA) {
      // spandrel: fills from springing (2.25) to beam (3.25), minus 5 lobes along a semicircle
      const n = 26, w = span1 - span0, mid = (span0 + span1) / 2, R = w / 2 - 0.05;
      for (let i = 0; i < n; i++) {
        const s0 = span0 + w * i / n, s1 = span0 + w * (i + 1) / n, sm = (s0 + s1) / 2 - mid;
        const r = Math.abs(sm) < R ? Math.sqrt(R * R - sm * sm) : 0;
        const th = Math.acos(Math.max(-1, Math.min(1, sm / R)));
        const lobe = 0.09 * Math.abs(Math.sin(th * 5 / 2 * 2));               // multi-foil scallops
        const yb = Math.min(ROOF, 2.1 + r * 0.82 - lobe);
        if (axisA) B.box(s0, s1, yb, ROOF, at - 0.13, at + 0.13, C.white); else B.box(at - 0.13, at + 0.13, yb, ROOF, s0, s1, C.white);
        if (axisA) { edges.push(s0, yb, at - 0.14, s1, yb, at - 0.14); } else { edges.push(at - 0.14, yb, s0, at - 0.14, yb, s1); }
      }
    }
    foilArch(porch.a0 + 0.2, porch.a1 - 0.2, 'a', porch.b0, true);
    foilArch(porch.b0 + 0.2, VB - 0.4, 'b', porch.a0, false);
    // little dome-ish crown above the porch
    B.box(porch.a0 - 0.2, porch.a1 + 0.2, ROOF + 0.15, ROOF + 0.4, porch.b0 - 0.2, porch.b0 + 0.25, C.white);
    boxEdges(edges, porch.a0 - 0.2, porch.a1 + 0.2, ROOF + 0.15, ROOF + 0.4, porch.b0 - 0.2, porch.b0 + 0.25);

    // ------ stepped "ziggurat" parapet: white merlons ~0.6 m tall, 1.2 m apart, dark grey outlines
    const PY = ROOF + 0.15;
    const runA = (b, a0, a1) => { B.box(a0, a1, PY, PY + 0.22, b - 0.08, b + 0.08, C.white); boxEdges(edges, a0, a1, PY, PY + 0.22, b - 0.09, b + 0.09); for (let a = a0 + 0.6; a < a1 - 0.3; a += 1.2) merlon(a, b, true); };
    const runB = (a, b0, b1) => { B.box(a - 0.08, a + 0.08, PY, PY + 0.22, b0, b1, C.white); boxEdges(edges, a - 0.09, a + 0.09, PY, PY + 0.22, b0, b1); for (let b = b0 + 0.6; b < b1 - 0.3; b += 1.2) merlon(a, b, false); };
    function merlon(c, at, axisA) {
      const steps = [[0.78, 0.22, 0.36], [0.5, 0.36, 0.5], [0.24, 0.5, 0.62]];
      for (const [w, y0, y1] of steps) {
        const A0 = c - w / 2, A1 = c + w / 2;
        if (axisA) { B.box(A0, A1, PY + y0, PY + y1, at - 0.08, at + 0.08, C.white); boxEdges(edges, A0, A1, PY + y0, PY + y1, at - 0.09, at + 0.09); }
        else { B.box(at - 0.08, at + 0.08, PY + y0, PY + y1, A0, A1, C.white); boxEdges(edges, at - 0.09, at + 0.09, PY + y0, PY + y1, A0, A1); }
      }
    }
    runA(-0.95, porch.a1 + 0.3, h1 + 0.15);  // front edge (porch has its crown)
    runB(-0.3, -0.95, hb1 + 0.15); runB(h1 + 0.15, -0.95, hb1 + 0.15); runA(hb1 + 0.15, -0.3, h1 + 0.15);

    // ------ compound wall: mauve plaster 1.5 m on a stone plinth, gaps for the gates
    const WT = 0.22, WH = 1.5, Y0 = YARD.b0, Y1 = YARD.b1, X0 = YARD.a0, X1 = YARD.a1;
    const PG = [0.9, 2.3], MG = [16.4, 20.6];
    const cwall = (a0, a1, b0, b1) => { B.box(a0, a1, 0, 0.35, b0 - 0.03, b1 + 0.03, C.stone); B.box(a0, a1, 0.35, WH, b0, b1, C.mauve); B.box(a0 - 0.02, a1 + 0.02, WH, WH + 0.07, b0 - 0.04, b1 + 0.04, C.mauveDk); col(a0, a1, b0, b1); };
    cwall(X0, PG[0], Y0 - WT / 2, Y0 + WT / 2); cwall(PG[1], MG[0], Y0 - WT / 2, Y0 + WT / 2); cwall(MG[1], X1, Y0 - WT / 2, Y0 + WT / 2);
    cwall(X0 - WT / 2, X0 + WT / 2, Y0, Y1); cwall(X1 - WT / 2, X1 + WT / 2, Y0, Y1); cwall(X0, X1, Y1 - WT / 2, Y1 + WT / 2);
    // gate piers with caps
    for (const a of [PG[0], PG[1], MG[0], MG[1]]) { const w = a === MG[0] || a === MG[1] ? 0.25 : 0.18; B.box(a - w, a + w, 0, 1.85, Y0 - 0.25, Y0 + 0.25, C.mauve); B.box(a - w - 0.05, a + w + 0.05, 1.85, 1.95, Y0 - 0.3, Y0 + 0.3, C.white); col(a - w, a + w, Y0 - 0.25, Y0 + 0.25); }
    // red/yellow steps at the pedestrian gate
    B.box(PG[0], PG[1], 0, 0.08, Y0 - 0.7, Y0 - 0.15, C.yellow); B.box(PG[0], PG[1], 0.08, 0.14, Y0 - 0.45, Y0 - 0.15, C.red);
    // front path from pedestrian gate to porch steps
    B.box(0.7, 2.7, 0, 0.04, Y0 + 0.1, -1.6, '#b9ad98');

    // ------ courtyard: concrete pad, slots, shed
    B.box(h1 + 0.2, X1 - 0.1, 0, 0.04, Y0 + 0.1, Y1 - 0.1, C.cc);
    B.box(MG[0], MG[1], 0, 0.04, Y0 - 1.6, Y0 + 0.1, C.cc);                    // apron over the drain to the lane
    // shed: corrugated sheet roof on steel posts, rear and side walls, rolling shutter at b = 7.4
    const SH = { a0: 15.1, a1: 23.2, b0: 7.4, b1: 13.4, h: 3.0 };
    B.box(SH.a0 - 0.12, SH.a0 + 0.12, 0, SH.h, SH.b0, SH.b1, C.cream); col(SH.a0 - 0.12, SH.a0 + 0.12, SH.b0, SH.b1);
    B.box(SH.a0, SH.a1, SH.h, SH.h + 0.06, SH.b0 - 0.3, SH.b1 + 0.1, C.sheet);
    for (let a = SH.a0; a < SH.a1; a += 0.25) B.box(a, a + 0.08, SH.h + 0.06, SH.h + 0.1, SH.b0 - 0.3, SH.b1 + 0.1, '#7a8388');
    B.box(SH.a0, SH.a1, SH.h - 0.5, SH.h, SH.b0 - 0.12, SH.b0 + 0.12, C.cream);  // lintel / shutter box
    B.box(SH.a1 - 0.12, SH.a1 + 0.12, 0, SH.h, SH.b0, SH.b1, C.cream); col(SH.a1 - 0.12, SH.a1 + 0.12, SH.b0, SH.b1);
    B.box(SH.a0, SH.a1, 0.04, 0.05, SH.b0, SH.b1, '#a7a196');
    // slots: 2 car bays in the shed, 3 bike bays along the east wall
    SLOTS.forEach(s => {
      const hw = s.w / 2, hl = s.l / 2, q = (a0, a1, b0, b1) => B.box(a0, a1, 0.05, 0.065, b0, b1, C.mark);
      if (s.alongA) { q(s.a - hl, s.a + hl, s.b - hw - 0.05, s.b - hw + 0.05); q(s.a - hl, s.a + hl, s.b + hw - 0.05, s.b + hw + 0.05); q(s.a + hl - 0.1, s.a + hl, s.b - hw, s.b + hw); }
      else { q(s.a - hw - 0.05, s.a - hw + 0.05, s.b - hl, s.b + hl); q(s.a + hw - 0.05, s.a + hw + 0.05, s.b - hl, s.b + hl); q(s.a - hw, s.a + hw, s.b + hl - 0.1, s.b + hl); }
    });

    // ------ interior furniture
    const IN = '#f2ead2';
    // hall: sofa, TV, charpai cot, pooja shelf
    B.box(2.6, 3.4, FLOOR, 0.55, 3.2, 5.6, '#7a4b2a'); B.box(3.1, 3.4, 0.55, 1.05, 3.2, 5.6, '#7a4b2a'); B.box(2.65, 3.1, 0.45, 0.62, 3.25, 5.55, '#b34a3a'); col(2.6, 3.4, 3.2, 5.6);
    B.box(0.12, 0.6, FLOOR, 0.6, 3.6, 5.2, C.woodDk); col(0.12, 0.6, 3.6, 5.2);                   // TV table
    B.box(0.15, 0.25, 0.75, 1.4, 3.8, 5.0, '#111');                                                // TV body
    // cot (charpai): wooden frame, woven top
    B.box(4.6, 6.6, 0.45, 0.52, 6.6, 7.6, '#c9a466'); for (const [a, b] of [[4.65, 6.65], [6.55, 6.65], [4.65, 7.55], [6.55, 7.55]]) B.box(a - 0.05, a + 0.05, FLOOR, 0.5, b - 0.05, b + 0.05, C.wood); col(4.6, 6.6, 6.6, 7.6);
    // pooja shelf on the hall partition (a = 8), facing west: wooden niche, lamp, frames
    B.box(7.55, 7.88, 1.0, 1.06, 6.0, 7.2, C.wood); B.box(7.55, 7.88, 1.8, 1.86, 6.0, 7.2, C.wood); B.box(7.82, 7.88, 1.0, 1.86, 6.0, 7.2, '#a8262a');
    B.box(7.7, 7.8, 1.06, 1.45, 6.2, 6.5, '#e0a020'); B.box(7.7, 7.8, 1.06, 1.45, 6.7, 7.0, '#ff7f2a'); B.box(7.62, 7.72, 1.06, 1.14, 6.55, 6.65, '#d4af37');
    // kitchen corner: platform along front wall, stove, vessels, fridge
    B.box(8.3, 14.6, FLOOR, 0.9, 2.55, 3.15, '#6f6a62'); B.box(8.3, 14.6, 0.9, 0.95, 2.52, 3.18, '#2b2b2b'); col(8.3, 14.6, 2.55, 3.15);
    B.box(10.2, 10.9, 0.95, 1.05, 2.65, 3.05, '#1a1a1a');
    for (let i = 0; i < 5; i++) B.geo(new THREE.CylinderGeometry(0.12, 0.1, 0.18 + (i % 2) * 0.1, 10), 11.6 + i * 0.4, 1.05, 2.85, 0, 0, 0, C.steel);
    B.box(14.0, 14.6, FLOOR, 1.75, 5.6, 6.3, '#d8dde0'); col(14.0, 14.6, 5.6, 6.3);
    // bedroom: bed (save), wardrobe (character creator)
    B.box(0.2, 2.2, FLOOR, 0.5, 10.6, 12.9, C.wood); B.box(0.2, 2.2, 0.5, 0.68, 10.65, 12.85, '#e6e0d0'); B.box(0.25, 2.15, 0.68, 0.74, 10.8, 12.0, '#c0392b');
    B.box(0.5, 1.9, 0.68, 0.82, 12.35, 12.8, '#ffffff'); B.box(0.2, 2.2, FLOOR, 1.1, 12.85, 12.98, C.woodDk); col(0.2, 2.2, 10.6, 12.95);
    B.box(7.2, 7.85, FLOOR, 2.1, 9.4, 11.0, '#7b5a3a'); B.box(7.18, 7.2, 0.2, 2.0, 9.45, 10.18, '#8d6a48'); B.box(7.18, 7.2, 0.2, 2.0, 10.22, 10.95, '#8d6a48'); col(7.2, 7.85, 9.4, 11.0);
    // store room: drums and sacks
    for (let i = 0; i < 3; i++) B.geo(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), 13.8, FLOOR + 0.45, 8.0 + i * 0.75, 0, 0, 0, '#2a5fa8');
    col(13.4, 14.4, 7.6, 10.4);

    // ------ plants: shrubs along the wall, bougainvillea over the east wall, a tree in the front yard
    const ico = r => new THREE.IcosahedronGeometry(r, 1);
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let a = 3.3; a < 15.5; a += 1.1) B.geo(ico(0.45 + rnd() * 0.25), a, 0.4, Y0 + 0.75, 0, rnd() * 3, 0, rnd() > 0.5 ? C.green : C.green2);
    for (let b = Y0 + 0.6; b < 6.5; b += 1.0) B.geo(ico(0.5 + rnd() * 0.3), X1 - 0.6, 1.2 + rnd() * 0.6, b, 0, 0, 0, rnd() > 0.35 ? C.bougain : C.green);
    for (let a = 21.2; a < X1; a += 0.9) B.geo(ico(0.5), a, 1.75, Y0 + 0.1, 0, 0, 0, C.bougain);
    for (let b = 2; b < 12; b += 1.3) B.geo(ico(0.55 + rnd() * 0.3), X0 + 0.5, 0.6, b, 0, 0, 0, C.green2);
    B.geo(new THREE.CylinderGeometry(0.12, 0.16, 2.6, 8), -0.5 + 0.1, 1.3, Y0 + 1.0, 0, 0, 0, '#5b4630');
    B.geo(ico(1.3), -0.4, 3.0, Y0 + 1.0, 0, 0, 0, C.green);
    // drain cover slabs outside the front wall + open drain stretch (the lane's own drain is drawn by the world)
    B.box(X0, X1, -0.05, 0.02, Y0 - 1.0, Y0 - 0.5, '#5d5a52');

    const mesh = B.mesh(); root.add(mesh);
    (window.WALKABLES = window.WALKABLES || []).push(mesh);   // floors, porch and gate steps: player.js steps up onto these (walls are too tall to climb)
    root.add(lines(edges, 0x4a4a4a));

    // ------ animated parts
    // main gate leaves (canvas bars, alpha tested), hinges at MG[0] and MG[1], swing inward
    const gTex = gateTex(), gMat = new THREE.MeshLambertMaterial({ map: gTex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, color: 0x222222 });
    const gw = (MG[1] - MG[0]) / 2;
    const leaf = (hingeA, sign) => {
      const p = new THREE.Group(); p.position.set(hingeA, 0, Y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, 1.6), gMat); m.position.set(sign * gw / 2, 0.95, 0); if (sign < 0) m.scale.x = -1;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.05), new THREE.MeshLambertMaterial({ color: 0x151515 })); bar.position.set(0, 0.9, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc9a227 })); knob.position.set(sign * (gw - 0.05), 1.75, 0);
      p.add(m, bar, knob); root.add(p); return p;
    };
    parts.gateL = leaf(MG[0], 1); parts.gateR = leaf(MG[1], -1);
    // pedestrian gate (single leaf)
    const pgw = PG[1] - PG[0];
    parts.ped = new THREE.Group(); parts.ped.position.set(PG[0], 0, Y0);
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(pgw, 1.4), gMat); m.position.set(pgw / 2, 0.85, 0); parts.ped.add(m); root.add(parts.ped); }
    // front door: dark brown wood, two panels, hinge at DOOR[0]
    parts.door = new THREE.Group(); parts.door.position.set(DOOR[0], FLOOR, VB);
    { const dm = new THREE.MeshLambertMaterial({ color: C.wood }), dw = DOOR[1] - DOOR[0];
      const d = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.08, 0.06), dm); d.position.set(dw / 2, 1.04, 0);
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.75, 0.75, 0.08), new THREE.MeshLambertMaterial({ color: C.woodDk })); p1.position.set(dw / 2, 1.5, 0);
      const p2 = p1.clone(); p2.position.y = 0.6;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc9a227 })); h.position.set(dw - 0.1, 1.05, -0.06);
      parts.door.add(d, p1, p2, h); root.add(parts.door); }
    // rolling shutter
    { const t = shutterTex(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 1);
      const w = SH.a1 - SH.a0 - 0.24, sm = new THREE.Mesh(new THREE.PlaneGeometry(w, SH.h - 0.5), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
      parts.shutterH = SH.h - 0.5; sm.position.set((SH.a0 + SH.a1) / 2, (SH.h - 0.5) / 2, SH.b0 - 0.02); parts.shutter = sm; root.add(sm); }
    // flag pole at the porch corner, on the roof, with the tiranga
    { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 3.2, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      pole.position.set(-0.15, ROOF + 0.15 + 1.6, -0.8); root.add(pole);
      const fg = new THREE.PlaneGeometry(1.2, 0.8, 8, 1);
      const flag = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide }));
      parts.flagPivot = new THREE.Group(); parts.flagPivot.position.set(-0.15, ROOF + 0.15 + 2.75, -0.8); flag.position.set(0.6, 0, 0); parts.flagPivot.add(flag); parts.flag = flag; root.add(parts.flagPivot);
      parts.flagBase = fg.attributes.position.array.slice(); }
    // TV screen
    { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.6), new THREE.MeshBasicMaterial({ map: tvTex() })); s.position.set(0.255, 1.08, 4.4); s.rotation.y = Math.PI / 2; root.add(s); }
    // interior light (switched on while the player is inside)
    parts.lamp = new THREE.PointLight(0xffe2b0, 0, 14, 1.6); parts.lamp.position.set(5, ROOF - 0.4, 7); root.add(parts.lamp);
    { const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff })); tube.position.set(4, ROOF - 0.15, 2.6); root.add(tube); }

    scene.add(root);

    blockers.gate = Blocker(MG[0], MG[1], Y0 - 0.12, Y0 + 0.12);
    blockers.ped = Blocker(PG[0] + 0.15, PG[1] - 0.15, Y0 - 0.12, Y0 + 0.12);
    blockers.door = Blocker(DOOR[0], DOOR[1], VB - 0.12, VB + 0.12);
    blockers.shutter = Blocker(SH.a0, SH.a1, SH.b0 - 0.1, SH.b0 + 0.1);
    for (const k in blockers) blockers[k].set(true);
    // inner-shed wall stubs where the house side meets the courtyard are covered by the house's own east wall
    MGc = { a: (MG[0] + MG[1]) / 2, b: Y0 }; PGc = { a: (PG[0] + PG[1]) / 2, b: Y0 }; SHc = { a: (SH.a0 + SH.a1) / 2, b: SH.b0 }; DOORc = { a: (DOOR[0] + DOOR[1]) / 2, b: VB };
  }

  // slots in local coords (a, b); alongA = vehicle lies along the lane direction
  const SLOTS = [
    { id: 'car1', a: 17.15, b: 10.4, w: 3.0, l: 5.4, rot: 0, car: true },
    { id: 'car2', a: 21.15, b: 10.4, w: 3.0, l: 5.4, rot: 0, car: true },
    { id: 'bike1', a: 22.1, b: -1.3, w: 1.1, l: 2.2, alongA: true },
    { id: 'bike2', a: 22.1, b: 0.1, w: 1.1, l: 2.2, alongA: true },
    { id: 'bike3', a: 22.1, b: 1.5, w: 1.1, l: 2.2, alongA: true },
  ];
  // world rotation of a parked vehicle in a slot (fwd = (sin r, cos r)): car nose into the shed (+b), bikes nose east (+a)
  const slotRot = s => s.alongA ? TH + Math.PI / 2 : TH;
  const parts = {}, blockers = {};
  let MGc, PGc, SHc, DOORc;
  const anim = { gate: 0, ped: 0, door: 0, shutter: 0 }, want = { gate: false, ped: false, door: false, shutter: false }, manual = { gate: false, shutter: false, door: false };

  // ---------------------------------------------------------------- vehicles in the slots
  function paintOf(g) { let c = null; g.traverse(o => { if (!c && o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) c = o.material.color.getHex(); }); return c; }
  const paintCache = {};
  function spawnStored() {
    const P = PL(), TMs = TM(); if (!P || !TMs) return;
    for (const st of S.stored) {
      if (live[st.slot] || !TMs[st.kind]) continue;
      const s = SLOTS.find(q => q.id === st.slot); if (!s) continue;
      const v = TMs[st.kind]();
      if (st.color != null) v.g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) o.material = paintCache[st.color] || (paintCache[st.color] = new THREE.MeshPhongMaterial({ color: st.color, specular: 0x8a8a8a, shininess: 85 })); });
      const p = W(s.a, s.b); v.g.position.set(p.x, 0, p.z); v.g.rotation.y = slotRot(s); scene.add(v.g);
      const obj = { ...v, model: st.kind, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, wheels: v.wheels || [], tail: v.tail || [], _safeSlot: s.id, _waiting: true };
      live[s.id] = obj; P.addParked(obj);
    }
  }
  function slotAt(x, z, maxD) {
    const l = L(x, z); let best = null;
    for (const s of SLOTS) { const d = Math.hypot(l.a - s.a, l.b - s.b); if (d < (maxD || 2.2) && (!best || d < best.d)) best = { s, d }; }
    return best && best.s;
  }
  function storeVehicle(s) {
    const P = PL(), v = P && P.active;
    if (!v) return G.showPopup('THE CRYSTA STAYS OUTSIDE · STORE BIKES & OTHER VEHICLES');
    if (!TM()[v.model]) return G.showPopup('CANNOT STORE THIS VEHICLE');
    let spd = 0; try { spd = Math.abs(carSpeed); } catch (e) {}
    if (spd > 6) return G.showPopup('STOP TO STORE THE VEHICLE');
    if (live[s.id] && live[s.id] !== v) return G.showPopup('SLOT TAKEN');
    if (s.car === true && v.model === 'bike') {}                               // bikes may use car bays too
    if (!s.car && v.model !== 'bike') return G.showPopup('BIKE BAY · PARK CARS IN THE SHED');
    // straighten it into the bay
    const p = W(s.a, s.b); carPos.x = p.x; carPos.z = p.z; carRot = slotRot(s);
    v.g.position.set(p.x, v.g.position.y, p.z); v.g.rotation.y = carRot; v.vF = 0; v.vL = 0;
    S.stored = S.stored.filter(q => q.slot !== s.id); S.stored.push({ kind: v.model, slot: s.id, color: paintOf(v.g) });
    live[s.id] = v; v._safeSlot = s.id;
    P.toggle();                                     // get out: the vehicle stays parked (collision + F to enter)
    persist(); G.showPopup('VEHICLE STORED · SAFE HOUSE');
  }
  function checkTaken() {
    const P = PL(); if (!P) return;
    for (const id in live) {
      const v = live[id];
      if (P.active === v || !v.g.parent) {           // driven away (or removed): free the slot
        delete live[id]; S.stored = S.stored.filter(q => q.slot !== id); persist();
      }
    }
  }

  // ---------------------------------------------------------------- UI
  let hint = null, safeTag = null, fade = null;
  function ui() {
    const css = document.createElement('style');
    css.textContent = '#shHint{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(0,0,0,.72);color:#fff;font:600 14px system-ui,sans-serif;padding:7px 14px;border-radius:6px;pointer-events:none;display:none;z-index:40}' +
      '#shHint b{background:#fff;color:#000;border-radius:3px;padding:0 6px;margin-right:6px}' +
      '#shSafe{position:fixed;top:64px;left:50%;transform:translateX(-50%);background:#1b7a3a;color:#fff;font:700 12px system-ui,sans-serif;letter-spacing:.12em;padding:4px 12px;border-radius:12px;display:none;z-index:40;pointer-events:none}' +
      '#shFade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .6s;z-index:60;display:flex;align-items:center;justify-content:center;color:#fff;font:700 22px system-ui,sans-serif}';
    hint = document.createElement('div'); hint.id = 'shHint';
    safeTag = document.createElement('div'); safeTag.id = 'shSafe'; safeTag.textContent = '⌂ SAFE · HOME';
    fade = document.createElement('div'); fade.id = 'shFade';
    document.head.appendChild(css); document.body.append(hint, safeTag, fade);
  }
  function setHint(t) { if (!hint) return; if (t) { hint.innerHTML = '<b>E</b>' + t; hint.style.display = 'block'; } else hint.style.display = 'none'; }

  // ---------------------------------------------------------------- interactions
  const propsPanelOpen = () => { const p = document.getElementById('propPanel'); return !!(p && p.style.display === 'block'); };
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
    if (l.a > 0.2 && l.a < 2.6 && l.b > 10 && l.b < 13.2) return { t: 'sleep till morning & save', f: sleep };
    if (l.a > 6.3 && l.a < 7.2 && l.b > 9.2 && l.b < 11.2) return { t: 'wardrobe · change outfit', f: wardrobe };
    if (d(MGc) < 2.6) return { t: want.gate ? 'close gate' : 'open gate', f: () => { manual.gate = !want.gate; } };
    if (d(SHc) < 3.2 && Math.abs(l.b - SHc.b) < 2.5) return { t: want.shutter ? 'lower shutter' : 'raise shutter', f: () => { manual.shutter = !want.shutter; } };
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
  function wardrobe() {
    let cc = null; try { cc = CharacterCreator; } catch (e) {}
    if (cc && cc.open) cc.open(); else G.showPopup('WARDROBE NOT AVAILABLE');
  }
  const inYard = l => l.a > YARD.a0 && l.a < YARD.a1 && l.b > YARD.b0 && l.b < YARD.b1;
  const inHouse = l => l.a > 0 && l.a < HOUSE.a1 && l.b > 2.4 && l.b < HOUSE.b1;

  // ---------------------------------------------------------------- hooks
  GameHooks.init.push(game => {
    G = game; world = game.world; scene = game.scene;
    try { build(); } catch (e) { console.error('safehouse build failed', e); return; }
    ui();
    const c = W(7.4, 6.5);
    if (world.addMapIcon) world.addMapIcon(c.x, c.z, '⌂', 'Safe House');
    else console.warn('safehouse: world.addMapIcon missing');
    window.SafeHouse = { W, L, slots: SLOTS, live, state: S, anim, want, manual, center: c, gate: W(MGc.a, MGc.b - 6), door: W(DOORc.a, DOORc.b) };
    // TrafficModels / Player are ready at init time; spawn a beat later so parked.js etc. have settled
    setTimeout(spawnStored, 0);
  });

  let flagT = 0, cur = null;
  GameHooks.update.push((dt, game) => {
    if (!root) return;
    const mode = game.playerMode, l = L(carPos.x, carPos.z);
    const dG = Math.hypot(l.a - MGc.a, l.b - MGc.b), dS = Math.hypot(l.a - SHc.a, l.b - SHc.b);
    const driving = mode === 'vehicle' || mode === 'crysta';
    // gate: open while a player vehicle is near (either side); a manual open lasts until you wander off
    if (dG > 14) manual.gate = false;
    want.gate = (driving && dG < 11) || manual.gate;
    // shutter: rises for a vehicle in front of / inside the shed
    if (dS > 12) manual.shutter = false;
    want.shutter = (driving && dS < 8 && l.a > 14 && l.b > YARD.b0) || manual.shutter;
    // pedestrian gate: swings for the walker
    want.ped = mode === 'foot' && Math.hypot(l.a - PGc.a, l.b - PGc.b) < 2.2;
    // front door: closes behind you
    if (Math.hypot(l.a - DOORc.a, l.b - DOORc.b) > 3.2) manual.door = false;
    want.door = manual.door;

    for (const k of ['gate', 'ped', 'door', 'shutter']) {
      const sp = k === 'shutter' ? 0.45 : k === 'gate' ? 0.6 : 1.2;
      const t = want[k] ? 1 : 0; anim[k] += Math.sign(t - anim[k]) * Math.min(Math.abs(t - anim[k]), dt * sp);
      blockers[k].set(anim[k] < 0.05);
    }
    const e = x => x * x * (3 - 2 * x);
    parts.gateL.rotation.y = -e(anim.gate) * Math.PI * 0.5; parts.gateR.rotation.y = e(anim.gate) * Math.PI * 0.5;
    parts.ped.rotation.y = -e(anim.ped) * Math.PI * 0.5;
    parts.door.rotation.y = -e(anim.door) * Math.PI * 0.55;
    const sh = e(anim.shutter); parts.shutter.scale.y = Math.max(0.02, 1 - sh); parts.shutter.position.y = 3.0 - 0.5 - parts.shutterH * (1 - sh) / 2;

    // flag wave
    flagT += dt; const pa = parts.flag.geometry.attributes.position, base = parts.flagBase;
    for (let i = 0; i < pa.count; i++) { const x = base[i * 3] + 0.6; pa.array[i * 3 + 2] = Math.sin(flagT * 5 + x * 4) * 0.08 * x; }
    pa.needsUpdate = true; parts.flagPivot.rotation.y = Math.sin(flagT * 0.4) * 0.3;

    // interior light while inside
    parts.lamp.intensity += ((inHouse(l) ? 1.1 : 0) - parts.lamp.intensity) * Math.min(1, dt * 4);

    safeTag.style.display = inYard(l) ? 'block' : 'none';
    checkTaken();
    cur = propsPanelOpen() ? null : currentAction();
    let ccOpen = false; try { ccOpen = !!document.querySelector('.on[id*="cc"], #ccRoot.on'); } catch (er) {}
    setHint(cur && !ccOpen ? cur.t : null);
  });

  GameHooks.key.push((e, game) => {
    if (e.code !== 'KeyE' || e.repeat || !root) return false;
    if (propsPanelOpen()) return false;
    const a = currentAction(); if (!a) return false;
    a.f(); return true;
  });
})();
