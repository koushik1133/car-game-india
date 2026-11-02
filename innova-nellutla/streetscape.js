// streetscape.js: the real street around the safe houses (Nellutla), from the Street View photos + Esri mosaic.
// The CC lane "east_diag" runs WNW-ESE past both safe houses and opens into a wide earth/concrete junction at
// ~(64,-268) where east_ns3 / se_ns branch off (Street View points 1 and 2 stand at its west edge).
// Adds: covered drain with stone slabs + kerb, expansion joints, the open plaza, tree-guard saplings, mature neem/mango,
// granite dry-stone wall, old brick wall with weeds, whitewashed wall with Telugu ads, blue Pochamma shrine, white plinth
// with saffron cloth, striped temple compound with gopuram gate + deity on pink pedestal, hand pump, flex banners
// (generic silhouettes only), concrete poles with sagging wires + bunting, parked bikes, overgrown empty plot.
(function () {
  'use strict';
  // generic building #467 sits on the junction (it overlaps the Street View camera positions)
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 69.7, z: -269.0, r: 3 });

  const LANE = [[20.3, -288.8], [53.3, -270.7], [79.4, -260.5], [110.2, -248.1]];
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
  const adTex = () => canvasTex(1024, 192, (x, w, h) => {
    x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#111'; x.font = 'bold 44px "Kohinoor Telugu","Noto Sans Telugu",sans-serif';
    x.fillText('శ్రీ సాయి ఫర్నిచర్స్', 30, 62); x.font = 'bold 30px "Kohinoor Telugu",sans-serif'; x.fillText('ఇక్కడ అన్ని రకాల సిమెంట్ పనులు చేయబడును', 30, 110);
    x.font = 'bold 34px sans-serif'; x.fillText('Cell: 9XXXX XXXXX', 30, 160);
    x.fillStyle = '#b8261c'; x.font = 'bold 40px "Kohinoor Telugu",sans-serif'; x.fillText('ఇటుకలు అమ్మబడును', 600, 70);
    x.fillStyle = '#111'; x.font = 'bold 32px sans-serif'; x.fillText('Ph: 8XXXX XXXXX', 640, 140);
  });
  function bannerTex(bg1, bg2, ink) {
    return canvasTex(1024, 384, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, bg1); g.addColorStop(1, bg2); x.fillStyle = g; x.fillRect(0, 0, w, h);
      // generic illustrated silhouettes (no real likeness)
      for (const [cx, s] of [[110, 1], [250, 0.8], [880, 1], [760, 0.75]]) {
        x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(cx, 200 - 30 * s, 62 * s, 0, 7); x.fill();
        x.fillStyle = '#5a3b2a'; x.beginPath(); x.arc(cx, 200 - 30 * s, 52 * s, 0, 7); x.fill();
        x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, 384, 95 * s, 120 * s, 0, Math.PI, 0); x.fill();
      }
      x.fillStyle = ink; x.textAlign = 'center';
      x.font = 'bold 46px "Kohinoor Telugu","Noto Sans Telugu",sans-serif'; x.fillText('నెల్లుట్ల గ్రామ ప్రజలకు', w / 2, 110);
      x.font = 'bold 40px "Kohinoor Telugu","Noto Sans Telugu",sans-serif'; x.fillText('బతుకమ్మ, దసరా & దీపావళి', w / 2, 190); x.fillText('శుభాకాంక్షలు', w / 2, 260);
      x.font = 'bold 26px sans-serif'; x.fillText('— శుభాకాంక్షలతో గ్రామ యువజన సంఘం —', w / 2, 330);
    });
  }
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
    // old red brick wall with weeds on top
    alongWall(B, 18, 30, -4.4, 0.25, 0.48, (p, l) => { for (let y = 0, k = 0; y < 1.7; y += 0.09, k++) B.obox(p.x + p.dx * (k & 1) * 0.12, p.z + p.dz * (k & 1) * 0.12, p.ang, l - 0.02, y, y + 0.08, 0.24, rnd() > 0.5 ? '#9c4a32' : '#87402c'); if (rnd() > 0.35) FO.blob(p.x, 1.82, p.z, 0.2, 0.15, 0.2, 8, [['#5c7f2a', 1], ['#7a8f3a', 1], ['#9a9a4a', 0.4]], 0.2); });
    // whitewashed wall with Telugu painted ads
    alongWall(B, 62, 74, -4.6, 0.25, 12, (p, l) => { B.obox(p.x, p.z, p.ang, l, 0, 2.0, 0.25, '#efeee6'); B.obox(p.x, p.z, p.ang, l + 0.05, 0, 0.35, 0.27, '#4d4a44'); });

    // ---------- temple compound: red/white vertical stripes, gopuram gate with blue door, deity on pink pedestal
    { const d0 = 44, d1 = 58, o = -4.5, D = 6;
      const gate = [50, 52];
      for (const [a, b] of [[d0, gate[0]], [gate[1], d1]]) alongWall(B, a, b, o, 0.25, 0.3, (p, l) => B.obox(p.x, p.z, p.ang, l, 0, 1.8, 0.25, (Math.round((p.x + p.z) * 3.3) & 1) ? '#c0262a' : '#f6f3ea'));
      const A = at(d0, o), Bp = at(d1, o), sx = A.dz, sz = -A.dx; // north direction
      segWall(B, A.x, A.z, A.x + sx * D, A.z + sz * D, 1.8, 0.25, '#e9e4d8');
      segWall(B, Bp.x, Bp.z, Bp.x + sx * D, Bp.z + sz * D, 1.8, 0.25, '#e9e4d8');
      segWall(B, A.x + sx * D, A.z + sz * D, Bp.x + sx * D, Bp.z + sz * D, 1.8, 0.25, '#e9e4d8');
      const g = at((gate[0] + gate[1]) / 2, o);
      for (const s of [-1, 1]) { const p = at((gate[0] + gate[1]) / 2 + s * 1.15, o); B.obox(p.x, p.z, p.ang, 0.4, 0, 2.6, 0.5, '#f2efe4'); collider(p.x, p.z, p.ang, 0.4, 0.5); }
      const tiers = [['#f2efe4', 2.8, 2.6], ['#e5a52a', 2.2, 3.15], ['#d24a3a', 1.6, 3.6], ['#3c8fd0', 1.0, 4.0]];
      let y = 2.6; for (const [c, w, y1] of tiers) { B.obox(g.x, g.z, g.ang, w, y, y1, 0.6, c); y = y1; }
      B.geo(new THREE.ConeGeometry(0.25, 0.5, 6), g.x, 4.25, g.z, 0, 0, 0, '#d4a82a');
      B.obox(g.x, g.z, g.ang, 1.9, 0, 2.3, 0.08, '#2c5fb8');                  // blue iron door
      for (let k = -4; k <= 4; k++) { const p = at((gate[0] + gate[1]) / 2 + k * 0.2, o - 0.05); B.obox(p.x, p.z, p.ang, 0.03, 0.1, 2.25, 0.12, '#1f478f'); }
      collider(g.x, g.z, g.ang, 1.9, 0.3);
      const c = at((d0 + d1) / 2, o - 3.2);
      B.obox(c.x, c.z, c.ang, 1.2, 0, 1.0, 1.2, '#e98bb4'); collider(c.x, c.z, c.ang, 1.2, 1.2);         // pink pedestal
      B.geo(new THREE.CylinderGeometry(0.25, 0.35, 1.3, 10), c.x, 1.65, c.z, 0, 0, 0, '#3b3b46');         // deity
      B.geo(new THREE.SphereGeometry(0.22, 10, 8), c.x, 2.5, c.z, 0, 0, 0, '#3b3b46');
      B.geo(new THREE.ConeGeometry(0.18, 0.35, 8), c.x, 2.85, c.z, 0, 0, 0, '#d4a82a');
      for (let i = 0; i < 14; i++) { const t = i / 13 * Math.PI; B.geo(ico(0.07, 0), c.x + Math.cos(t) * 0.32 * c.dx, 2.2 - Math.sin(t) * 0.45, c.z + Math.cos(t) * 0.32 * c.dz, 0, 0, 0, i & 1 ? '#ff8c1a' : '#ffc21a'); }
    }

    // ---------- blue Pochamma shrine, white plinth with saffron cloth, hand pump (west edge of the plaza)
    { const p = at(31, -5.6);
      B.obox(p.x, p.z, p.ang, 1.1, 0, 0.45, 1.1, '#1a1a1a'); B.obox(p.x, p.z, p.ang, 0.9, 0.45, 1.45, 0.9, '#2f6fd0');
      B.obox(p.x, p.z, p.ang, 1.0, 1.45, 1.55, 1.0, '#2458a8');
      const f = at(31, -5.15); B.obox(f.x, f.z, f.ang, 0.55, 0.65, 1.25, 0.06, '#e7c14a'); B.obox(f.x, f.z, f.ang, 0.42, 0.72, 1.18, 0.07, '#7a1e1e');
      B.geo(ico(0.1, 0), f.x, 0.85, f.z, 0, 0, 0, '#ff8c1a'); collider(p.x, p.z, p.ang, 1.1, 1.1);
      const w = at(28.6, -5.4); B.obox(w.x, w.z, w.ang, 0.8, 0, 0.7, 0.8, '#f3f1ea'); B.obox(w.x, w.z, w.ang, 0.84, 0.55, 0.72, 0.84, '#f08a1c'); B.obox(w.x, w.z, w.ang, 0.3, 0.72, 1.0, 0.3, '#e2b93b'); collider(w.x, w.z, w.ang, 0.8, 0.8);
      const h = at(36.5, -5.2); B.obox(h.x, h.z, h.ang, 1.6, 0, 0.25, 1.6, '#b9b4a8'); collider(h.x, h.z, h.ang, 1.6, 1.6);
      B.geo(new THREE.CylinderGeometry(0.09, 0.09, 1.0, 10), h.x, 0.75, h.z, 0, 0, 0, '#2b5a3a');
      B.geo(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), h.x + h.dx * 0.12, 1.0, h.z + h.dz * 0.12, 0, 0, Math.PI / 2 - 0.3, '#2b5a3a');
      B.geo(new THREE.BoxGeometry(0.9, 0.05, 0.05), h.x, 1.3, h.z, 0, h.ang, 0.25, '#2b5a3a'); }

    // ---------- trees: mature neem/mango + saplings in green mesh guards
    const trunkCol = [];
    const bigTree = (x, z, s, leaf) => { B.geo(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 3.2 * s, 7), x, 1.6 * s, z, 0, 0, 0, '#4f3f2e'); for (let k = 0; k < 3; k++) B.geo(new THREE.CylinderGeometry(0.06 * s, 0.14 * s, 2.2 * s, 5), x + (k - 1) * 0.7 * s, 3.6 * s, z + (rnd() - 0.5) * s, (rnd() - 0.5) * 0.6, 0, (k - 1) * 0.5, '#4f3f2e'); for (let k = 0; k < 6; k++) FO.blob(x + (rnd() - 0.5) * 3.4 * s, (4.0 + rnd() * 1.4) * s, z + (rnd() - 0.5) * 3.4 * s, (1.5 + rnd() * 0.6) * s, 0.9 * s, (1.5 + rnd() * 0.6) * s, 160, [[leaf, 3], ['#2f5e25', 3], ['#5a8a3a', 1.5]], 0.45); trunkCol.push([x, z, 0.4 * s]); };
    { let p = at(10, -6.5); bigTree(p.x, p.z, 1.1, '#3f6e2c'); p = at(24, -6.8); bigTree(p.x, p.z, 1.25, '#456f2a'); p = at(66, 6.2); bigTree(p.x, p.z, 1.15, '#3a6a30'); p = at(80, -7.5); bigTree(p.x, p.z, 1.0, '#4a7a2f'); }
    const guards = []; for (const [d, o] of [[3, -3.5], [7, -3.5], [13.5, -3.5], [56, 3.5], [60, 3.5], [70, 3.5], [74, 3.5], [78, 3.5], [84, 3.5]]) { const p = at(d, o); guards.push(p); B.geo(new THREE.CylinderGeometry(0.04, 0.06, 2.0, 5), p.x, 1.0, p.z, 0, 0, 0, '#5b4630'); FO.blob(p.x, 2.35, p.z, 0.6, 0.55, 0.6, 70, [['#4e8a33', 2], ['#6aa040', 1], ['#3a6e28', 1]], 0.3); trunkCol.push([p.x, p.z, 0.32]); }
    for (const [x, z, r] of trunkCol) collider(x, z, 0, r * 2, r * 2);

    // ---------- overgrown empty plot beside the lilac wall (west of safe house 2)
    { const SH2 = window.SafeHouse2Frame || null; const O = { x: 38.8, z: -272.2 }, UX = 13.2 / 14.857, UZ = 6.8 / 14.857;
      for (let i = 0; i < 26; i++) { const a = -26 + rnd() * 6, b = -1.5 + rnd() * 14.5; const r = 0.5 + rnd() * 0.5; FO.blob(O.x + a * UX - b * UZ, r * 0.8, O.z + a * UZ + b * UX, r, r * 0.8, r, 45, [['#4d8a2e', 2], ['#6a9a35', 2], ['#8a9a45', 1]], 0.35); } }

    // ---------- concrete electric poles, sagging wires, bunting zig-zag across the lane
    const poleN = [2, 26, 46, 70, 90].map(d => at(d, -3.6)), poleS = [14, 40, 58, 80].map(d => at(d, 3.4));
    for (const p of [...poleN, ...poleS]) { B.obox(p.x, p.z, p.ang, 0.18, 0, 8, 0.24, '#a9a69c'); B.obox(p.x, p.z, p.ang + Math.PI / 2, 1.2, 7.3, 7.4, 0.1, '#6b6b6b'); collider(p.x, p.z, p.ang, 0.25, 0.3); }
    const wire = [], sag = (a, b, y, s, n, cb) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, Y = t => y - s * 4 * t * (1 - t); wire.push(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, Y(t1), a.z + (b.z - a.z) * t1); if (cb) cb(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, Math.atan2(-(b.z - a.z), b.x - a.x)); } };
    for (let i = 0; i < poleN.length - 1; i++) for (const off of [-0.5, 0, 0.5]) sag({ x: poleN[i].x + poleN[i].dz * off, z: poleN[i].z - poleN[i].dx * off }, { x: poleN[i + 1].x + poleN[i + 1].dz * off, z: poleN[i + 1].z - poleN[i + 1].dx * off }, 7.35, 0.7, 12);
    const flags = [], zig = []; for (let i = 0; i < poleS.length; i++) { zig.push(poleN[i], poleS[i]); } zig.push(poleN[poleN.length - 1]);
    for (let i = 0; i < zig.length - 1; i++) sag(zig[i], zig[i + 1], 5.6, 0.9, 40, (x, y, z, ang) => flags.push([x, y, z, ang]));

    // ---------- flex banners (wall-mounted on the brick wall + one between two bamboo poles on the plaza)
    const ban = [];
    { const p = at(24, -4.25); ban.push([bannerTex('#e94f9b', '#2f9a4a', '#fff'), p.x, 1.0, p.z, p.ang, 4.2, 1.55]); }
    { const p = at(62.5, 4.8); ban.push([bannerTex('#f28a1c', '#f7d23a', '#5a1a00'), p.x, 2.4, p.z, p.ang + Math.PI, 4.0, 1.5]);
      for (const s of [-2.05, 2.05]) { const q = at(62.5 + s, 4.85); B.geo(new THREE.CylinderGeometry(0.05, 0.06, 3.4, 6), q.x, 1.7, q.z, 0, 0, 0, '#9b7a45'); collider(q.x, q.z, 0, 0.15, 0.15); } }
    { const p = at(68, -4.45); ban.push([adTex(), p.x, 1.0, p.z, p.ang, 6.4, 1.2]); }

    // ---------- assemble
    const mesh = B.mesh(); root.add(mesh); root.add(FO.mesh());
    root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x222222 })));
    const dummy = new THREE.Object3D();
    const inst = (geo, mat, list, set) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { set(p, i); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); }); root.add(m); return m; };
    inst(new THREE.BoxGeometry(0.58, 0.08, 0.75), new THREE.MeshLambertMaterial({ color: 0x77736a }), slabs, p => { dummy.position.set(p.x, 0.06, p.z); dummy.rotation.set(0, p.ang, 0); dummy.scale.set(1, 1, 1); });
    inst(new THREE.BoxGeometry(0.03, 0.01, 3.9), new THREE.MeshBasicMaterial({ color: 0x7f7a70 }), joints, p => { dummy.position.set(p.x, 0.068, p.z); dummy.rotation.set(0, p.ang, 0); });
    const gt = guardTex(); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(3, 2);
    inst(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 10, 1, true), new THREE.MeshLambertMaterial({ map: gt, alphaTest: 0.4, side: THREE.DoubleSide }), guards, p => { dummy.position.set(p.x, 0.75, p.z); dummy.rotation.set(0, 0, 0); });
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.32, 0], 3)); tri.computeVertexNormals();
    const fm = inst(tri, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), flags, p => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(0, p[3], 0); });
    const pal = [0xff3b30, 0xffcc00, 0x34c759, 0x007aff, 0xff2d92, 0xff9500, 0xffffff], cc = new THREE.Color(); flags.forEach((_, i) => fm.setColorAt(i, cc.setHex(pal[i % pal.length]))); fm.instanceColor.needsUpdate = true;
    for (const [tex, x, y, z, ang, w, h] of ban) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })); m.position.set(x, y + h / 2, z); m.rotation.y = ang; root.add(m); }
    scene.add(root);
    (window.WALKABLES = window.WALKABLES || []);

    // ---------- parked bikes under the trees
    setTimeout(() => {
      let TMs = null, P = null; try { TMs = TrafficModels; P = Player; } catch (e) { return; }
      if (!TMs || !TMs.bike) return;
      for (const [d, o, r] of [[22.5, -3.0, 0.3], [24.2, -3.1, 0.2], [64, 6.0, 2.6]]) {
        const p = at(d, o), v = TMs.bike(); v.g.position.set(p.x, 0, p.z); v.g.rotation.y = p.ang + Math.PI / 2 + r; scene.add(v.g);
        const obj = { ...v, model: 'bike', r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, wheels: v.wheels || [], tail: v.tail || [], _waiting: true };
        try { P.addParked && P.addParked(obj); } catch (e) {}
      }
    }, 0);
    window.Streetscape = { at, root };
  }

  GameHooks.init.push(game => { try { build(game); } catch (e) { console.error('streetscape build failed', e); } });
})();
