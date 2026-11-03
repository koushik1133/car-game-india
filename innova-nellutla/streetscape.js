// streetscape.js: the real street around the safe houses (Nellutla), from the Street View photos + Esri mosaic.
// The CC lane "east_diag" runs WNW-ESE past both safe houses and opens into a wide earth/concrete junction at
// ~(64,-268) where east_ns3 / se_ns branch off (Street View points 1 and 2 stand at its west edge).
// Adds: covered drain with stone slabs + kerb, expansion joints, the open plaza, tree-guard saplings, mature neem/mango,
// granite dry-stone wall further west, concrete poles with wires, the overgrown empty plot west of the house and the
// green bushes / empty overgrown plot OPPOSITE the house (Street View 17.70398 N 79.19688 E, heading 275).
// Removed after the Google Earth check: temple compound, Pochamma shrine, plinth, hand pump, brick wall, painted ad
// wall, flex banners, bunting and the parked bikes - none of them stand on this lane.
(function () {
  'use strict';
  // generic building #467 sits on the junction (it overlaps the Street View camera positions)
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 69.7, z: -269.0, r: 3 });
  // villagers keep off the lane in front of the safe house (nellutla-world.js people loop)
  (window.NELLUTLA_QUIET = window.NELLUTLA_QUIET || []).push({ x: 42, z: -272, r: 16 });
  // the open earth plaza at the junction is drivable: world poles/trees/walls keep out of it (nellutla-world.js roadHit)
  (window.NELLUTLA_CLEAR = window.NELLUTLA_CLEAR || []).push({ x: 64, z: -268, r: 10.5 });
  // keep the safe-house parking spots (Fortuner, MPV) free of roadside plants
  window.NELLUTLA_CLEAR.push({ x: 48.2, z: -281.2, r: 3.2 }, { x: 58.0, z: -275.6, r: 3.2 });

  const LANE = [[20.3, -288.8], [53.3, -270.7], [79.4, -257.9], [110.2, -248.1]];   // = east_diag in nellutla-map/tools/traced.json
  const SEG = []; let TOT = 0;
  for (let i = 0; i < LANE.length - 1; i++) { const [ax, az] = LANE[i], [bx, bz] = LANE[i + 1], l = Math.hypot(bx - ax, bz - az); SEG.push({ ax, az, dx: (bx - ax) / l, dz: (bz - az) / l, d0: TOT, l }); TOT += l; }
  // point at distance d along the lane, offset o to the south side (+) / north side (-)
  function at(d, o) {
    let s = SEG[SEG.length - 1]; for (const q of SEG) if (d <= q.d0 + q.l) { s = q; break; }
    const t = d - s.d0, sx = -s.dz, sz = s.dx;
    return { x: s.ax + s.dx * t + sx * (o || 0), z: s.az + s.dz * t + sz * (o || 0), ang: Math.atan2(-s.dz, s.dx), dx: s.dx, dz: s.dz };
  }

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

  function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t; }
  function Builder() {
    const pos = [], nor = [], col = [], c = new THREE.Color();
    const m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    function add(geo, color) { const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m4); const p = g.attributes.position.array, n = g.attributes.normal.array; c.set(color); for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b); }
    return {
      geo(geo, x, y, z, rx, ry, rz, color) { e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, sc); add(geo, color); },
      // oriented box: centre (x,z), yaw ang, length along lane, height y0..y1, depth
      obox(x, z, ang, len, y0, y1, dep, color) { e.set(0, ang, 0); q.setFromEuler(e); m4.compose(v.set(x, (y0 + y1) / 2, z), q, sc); add(new THREE.BoxGeometry(len, y1 - y0, dep), color); },
      mesh() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); },
    };
  }

  let world, scene;
  function collider(x, z, ang, len, dep) { if (world.addCollider) world.addCollider(x, z, len / 2, dep / 2, ang); }
  // a wall running along the lane from d0 to d1 at offset o, built from pieces by fn(B, p, len)
  function alongWall(B, d0, d1, o, dep, piece, fn, noCol) {
    for (let d = d0; d < d1 - 0.01; d += piece) { const l = Math.min(piece, d1 - d), p = at(d + l / 2, o); fn(p, l); }
    if (noCol) return;
    const a = at(d0, o), b = at(d1, o), m = at((d0 + d1) / 2, o);
    if (Math.abs(a.ang - b.ang) < 1e-3) collider(m.x, m.z, m.ang, d1 - d0, dep);
    else for (let d = d0; d < d1; d += 2) { const l = Math.min(2, d1 - d), p = at(d + l / 2, o); collider(p.x, p.z, p.ang, l, dep); }
  }
  // a wall from world point A to B (for side walls)
  function segWall(B, ax, az, bx, bz, h, dep, color) { const l = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax); B.obox((ax + bx) / 2, (az + bz) / 2, ang, l, 0, h, dep, color); collider((ax + bx) / 2, (az + bz) / 2, ang, l, dep); }

  // ---------------------------------------------------------------- textures
  const guardTex = () => canvasTex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = '#2f8f3a'; x.lineWidth = 3; for (let i = -64; i < 128; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); } });

  function build(game) {
    world = game.world; scene = game.scene;
    const root = new THREE.Group(); root.name = 'streetscape';
    const B = Builder();
    let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const ico = (r, d) => new THREE.IcosahedronGeometry(r, d == null ? 1 : d);
    const FO = window.LeafCards();

    // ---------- open junction / plaza: packed red earth with a concrete patch (under the lanes, y < 0.06)
    { const sh = new THREE.Shape(), cx = 64, cz = -268;
      for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2, r = 9 + 2 * Math.sin(t * 3 + 1) + rnd(); const px = cx + Math.cos(t) * r, pz = cz + Math.sin(t) * r * 0.8; i ? sh.lineTo(px, -pz) : sh.moveTo(px, -pz); }
      B.geo(new THREE.ShapeGeometry(sh), 0, 0.035, 0, -Math.PI / 2, 0, 0, '#a8694a');
      const s2 = new THREE.Shape(); [[56, -270], [66, -273], [70, -266], [60, -263]].forEach((p, i) => i ? s2.lineTo(p[0], -p[1]) : s2.moveTo(p[0], -p[1]));
      B.geo(new THREE.ShapeGeometry(s2), 0, 0.045, 0, -Math.PI / 2, 0, 0, '#c4bfb3'); }

    // ---------- covered drain + kerb (south side), skipping the plaza
    const slabs = [];
    for (const [d0, d1] of [[0, 36], [52, 88]]) {
      for (let d = d0; d < d1; d += 0.62) slabs.push(at(d, 2.55));
      alongWall(B, d0, d1, 2.95, 0.18, 4, (p, l) => B.obox(p.x, p.z, p.ang, l, 0, 0.18, 0.18, '#8a857b'), true);   // kerb: drivable (gates open onto it)
      for (let d = d0; d < d1; d += 4) { const p = at(d + 2, 2.55); B.obox(p.x, p.z, p.ang, 4, 0, 0.04, 0.75, '#3a3a34'); }   // channel shadow
    }
    // expansion joints across the CC lane
    const joints = []; for (let d = 1; d < TOT - 2; d += 3.2) joints.push(at(d, 0));

    // ---------- walls on the north side of the lane
    // granite dry-stacked blocks
    alongWall(B, 0, 16, -4.4, 0.5, 0.62, (p, l) => { for (let y = 0; y < 1.5; y += 0.32) { const g = 0.38 + rnd() * 0.15; B.obox(p.x + (rnd() - 0.5) * 0.04, p.z, p.ang + (rnd() - 0.5) * 0.06, l - 0.03, y, y + 0.3, 0.5, `rgb(${g * 255 | 0},${g * 250 | 0},${g * 240 | 0})`); } });
    // ---------- opposite the house (north side, d 16..46): no wall, an empty overgrown plot with green bushes
    for (let i = 0; i < 34; i++) { const d = 16 + rnd() * 30, o = -4.2 - rnd() * 9, p = at(d, o), r = 0.5 + rnd() * 0.7; FO.blob(p.x, r * 0.75, p.z, r, r * 0.75, r, 50, [['#3f7a2c', 2], ['#4d8a2e', 2], ['#6a9a35', 1.5], ['#8a9a45', 0.6]], 0.36); }
    for (let i = 0; i < 60; i++) { const d = 16 + rnd() * 30, o = -3.9 - rnd() * 9, p = at(d, o); FO.blob(p.x, 0.18, p.z, 0.3, 0.18, 0.3, 8, [['#7a8f3a', 1], ['#9a9a4a', 1], ['#5c7f2a', 1]], 0.22); }

    // ---------- trees: mature neem/mango + saplings in green mesh guards
    const trunkCol = [];
    const bigTree = (x, z, s, leaf) => { B.geo(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 3.2 * s, 7), x, 1.6 * s, z, 0, 0, 0, '#4f3f2e'); for (let k = 0; k < 3; k++) B.geo(new THREE.CylinderGeometry(0.06 * s, 0.14 * s, 2.2 * s, 5), x + (k - 1) * 0.7 * s, 3.6 * s, z + (rnd() - 0.5) * s, (rnd() - 0.5) * 0.6, 0, (k - 1) * 0.5, '#4f3f2e'); for (let k = 0; k < 6; k++) FO.blob(x + (rnd() - 0.5) * 3.4 * s, (4.0 + rnd() * 1.4) * s, z + (rnd() - 0.5) * 3.4 * s, (1.5 + rnd() * 0.6) * s, 0.9 * s, (1.5 + rnd() * 0.6) * s, 160, [[leaf, 3], ['#2f5e25', 3], ['#5a8a3a', 1.5]], 0.45); trunkCol.push([x, z, 0.4 * s]); };
    { let p = at(10, -6.5); bigTree(p.x, p.z, 1.1, '#3f6e2c'); p = at(24, -6.8); bigTree(p.x, p.z, 1.25, '#456f2a'); p = at(66, 6.2); bigTree(p.x, p.z, 1.15, '#3a6a30'); p = at(80, -7.5); bigTree(p.x, p.z, 1.0, '#4a7a2f'); }
    const guards = []; for (const [d, o] of [[56, 3.5], [60, 3.5], [70, 3.5], [74, 3.5], [78, 3.5], [84, 3.5]]) { const p = at(d, o); guards.push(p); B.geo(new THREE.CylinderGeometry(0.04, 0.06, 2.0, 5), p.x, 1.0, p.z, 0, 0, 0, '#5b4630'); FO.blob(p.x, 2.35, p.z, 0.6, 0.55, 0.6, 70, [['#4e8a33', 2], ['#6aa040', 1], ['#3a6e28', 1]], 0.3); trunkCol.push([p.x, p.z, 0.32]); }
    for (const [x, z, r] of trunkCol) collider(x, z, 0, r * 2, r * 2);

    // ---------- overgrown empty plot west of safe house 2 (where the v2 house stood before it moved onto #317)
    { const SH2 = window.SafeHouse2Frame || null; const O = { x: 38.8, z: -272.2 }, UX = 13.2 / 14.857, UZ = 6.8 / 14.857;
      for (let i = 0; i < 26; i++) { const a = -26 + rnd() * 18, b = -1.5 + rnd() * 14.5; const r = 0.5 + rnd() * 0.5; FO.blob(O.x + a * UX - b * UZ, r * 0.8, O.z + a * UZ + b * UX, r, r * 0.8, r, 45, [['#4d8a2e', 2], ['#6a9a35', 2], ['#8a9a45', 1]], 0.35); } }

    // ---------- concrete electric poles, sagging wires
    // keep every pole off the open plaza at the junction (it is driven across): slide along the lane until clear
    const offPlaza = (d, o) => { let p = at(d, o); for (let k = 0; k < 40 && Math.hypot((p.x - 64) / 11.5, (p.z + 268) / 9.4) < 1; k++) p = at(d += (d < 50 ? -0.5 : 0.5), o); return p; };
    const poleN = [2, 26, 46, 70, 90].map(d => offPlaza(d, -3.6)), poleS = [14, 46, 58, 80].map(d => offPlaza(d, 3.4));
    for (const p of [...poleN, ...poleS]) { B.obox(p.x, p.z, p.ang, 0.18, 0, 8, 0.24, '#a9a69c'); B.obox(p.x, p.z, p.ang + Math.PI / 2, 1.2, 7.3, 7.4, 0.1, '#6b6b6b'); collider(p.x, p.z, p.ang, 0.25, 0.3); }
    const wire = [], sag = (a, b, y, s, n, cb) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, Y = t => y - s * 4 * t * (1 - t); wire.push(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, Y(t1), a.z + (b.z - a.z) * t1); if (cb) cb(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, Math.atan2(-(b.z - a.z), b.x - a.x)); } };
    for (let i = 0; i < poleN.length - 1; i++) for (const off of [-0.5, 0, 0.5]) sag({ x: poleN[i].x + poleN[i].dz * off, z: poleN[i].z - poleN[i].dx * off }, { x: poleN[i + 1].x + poleN[i + 1].dz * off, z: poleN[i + 1].z - poleN[i + 1].dx * off }, 7.35, 0.7, 12);

    // ---------- assemble
    const mesh = B.mesh(); root.add(mesh); root.add(FO.mesh());
    root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x222222 })));
    const dummy = new THREE.Object3D();
    const inst = (geo, mat, list, set) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { set(p, i); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); }); root.add(m); return m; };
    inst(new THREE.BoxGeometry(0.58, 0.08, 0.75), new THREE.MeshLambertMaterial({ color: 0x77736a }), slabs, p => { dummy.position.set(p.x, 0.06, p.z); dummy.rotation.set(0, p.ang, 0); dummy.scale.set(1, 1, 1); });
    inst(new THREE.BoxGeometry(0.03, 0.01, 3.9), new THREE.MeshBasicMaterial({ color: 0x7f7a70 }), joints, p => { dummy.position.set(p.x, 0.068, p.z); dummy.rotation.set(0, p.ang, 0); });
    const gt = guardTex(); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(3, 2);
    inst(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 10, 1, true), new THREE.MeshLambertMaterial({ map: gt, alphaTest: 0.4, side: THREE.DoubleSide }), guards, p => { dummy.position.set(p.x, 0.75, p.z); dummy.rotation.set(0, 0, 0); });
    
    scene.add(root);
    (window.WALKABLES = window.WALKABLES || []);

    window.Streetscape = { at, root };
  }

  GameHooks.init.push(game => { try { build(game); } catch (e) { console.error('streetscape build failed', e); } });
})();
