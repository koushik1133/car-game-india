// streetscape.js: the real street around the safe houses (Nellutla), from the Street View photos + Esri mosaic.
// The CC lane "east_diag" runs WNW-ESE past both safe houses and opens into a wide earth/concrete junction at
// ~(64,-268) where east_ns3 / se_ns branch off (Street View points 1 and 2 stand at its west edge).
// Adds: covered drain with stone slabs + kerb, expansion joints, the open plaza, tree-guard saplings, mature neem/mango,
// granite dry-stone wall further west, concrete poles with wires, the overgrown empty plot west of the house and the
// green bushes / empty overgrown plot OPPOSITE the house (Street View 17.70398 N 79.19688 E, heading 275).
// Removed after the Google Earth check: Pochamma shrine, hand pump,
// flex banners, bunting and the parked bikes - none of them stand on this lane.
(function () {
  'use strict';
  // generic building #467 sits on the junction (it overlaps the Street View camera positions)
  (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 69.7, z: -269.0, r: 3 });
  // villagers keep off the lane in front of the safe house (nellutla-world.js people loop)
  (window.NELLUTLA_QUIET = window.NELLUTLA_QUIET || []).push({ x: 42, z: -272, r: 16 });
  // the open earth plaza at the junction is drivable: world poles/trees/walls keep out of it (nellutla-world.js roadHit)
  (window.NELLUTLA_CLEAR = window.NELLUTLA_CLEAR || []).push({ x: 64, z: -268, r: 10.5 });
  // replaced by the photographed houses built below: pink #319 -> weathered white houses, #461 -> blue house, #314 -> brick rubble
  (window.NELLUTLA_EXCLUDE).push({ x: 58.9, z: -289.3, r: 3 }, { x: 81.9, z: -263.6, r: 3 }, { x: 62.7, z: -260.1, r: 3 }, { x: 69.4, z: -252.9, r: 3 }, { x: 72, z: -300.8, r: 3 });
  (window.NELLUTLA_EXCLUDE).push({ x: 37.5, z: -297.6, r: 3 });   // generic house where the gabled house of photo 83 stands
  // the new houses, ad blocks and the raised plot west of the mud lane stay free of generated plants, poles and walls
  window.NELLUTLA_CLEAR.push({ x: 84, z: -270, r: 12 }, { x: 80, z: -284, r: 11 }, { x: 62, z: -290, r: 11 }, { x: 40, z: -282, r: 12 }, { x: 62, z: -262, r: 8 }, { x: 66, z: -303, r: 11 });
  // keep the safe-house parking spots (Fortuner, MPV) free of roadside plants
  window.NELLUTLA_CLEAR.push({ x: 48.2, z: -281.2, r: 3.2 }, { x: 58.0, z: -275.6, r: 3.2 });
  // raised land opposite the house (height field in nellutla-world.js): generated plants, poles, trees and walkers keep off
  window.NELLUTLA_CLEAR.push({ x: 64.5, z: -277, r: 8 }, { x: 72, z: -274, r: 8 });
  // the rolling land stays flat under the street furniture built here
  (window.NELLUTLA_FLAT = window.NELLUTLA_FLAT || []).push({ x: 36, z: -280, r: 22 }, { x: 53, z: -250, r: 17 }, { x: 64, z: -277, r: 13 }, { x: 18.5, z: -268, r: 12 }, { x: 29, z: -273, r: 11 });
  window.NELLUTLA_QUIET.push({ x: 67, z: -275, r: 14 }, { x: 53, z: -250, r: 14 });
  // the milk cooperative's plot on the CC road
  window.NELLUTLA_CLEAR.push({ x: 33, z: -306, r: 10 }); window.NELLUTLA_FLAT.push({ x: 33, z: -306, r: 11 });
  // the shrub land carried on to the red-tile house
  window.NELLUTLA_CLEAR.push({ x: 64, z: -287, r: 11 }); window.NELLUTLA_FLAT.push({ x: 64, z: -287, r: 12 }); window.NELLUTLA_QUIET.push({ x: 64, z: -287, r: 10 });
  window.NELLUTLA_CLEAR.push({ x: 69.6, z: -251.5, r: 6 });
  // third raised plot, past the brick heap
  window.NELLUTLA_CLEAR.push({ x: 53, z: -250, r: 14 }, { x: 18.5, z: -268, r: 10 }, { x: 29, z: -273, r: 9 }, { x: 46, z: -301, r: 8 });

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
  const turfTex = () => { const t = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#d8d8d0'; x.fillRect(0, 0, w, h); let sd = 41; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 5200; i++) { const X = rnd() * w, Y = rnd() * h, l = 3 + rnd() * 7, g = 195 + rnd() * 50; x.strokeStyle = `rgba(${g * 0.93 | 0},${g | 0},${g * 0.86 | 0},0.3)`; x.lineWidth = 1; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + (rnd() - 0.5) * 4, Y - l); x.stroke(); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const guardTex = () => canvasTex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = '#2f8f3a'; x.lineWidth = 3; for (let i = -64; i < 128; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); } });

  function build(game) {
    world = game.world; scene = game.scene;
    const root = new THREE.Group(); root.name = 'streetscape';
    const B = Builder();
    let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const ico = (r, d) => new THREE.IcosahedronGeometry(r, d == null ? 1 : d);
    const FO = window.LeafCards();

    // the plaza stops at the lane's north edge: the grass bank runs down to the road there
    const offBank = (x, z) => { const dx = x - 53.3, dz = z + 270.7, d = dx * 0.446 - dz * 0.895; if (d < -2.6) { const e = -2.6 - d; return [x + e * 0.446, z - e * 0.895]; } return d > 2 ? [x - (d - 2) * 0.446, z + (d - 2) * 0.895] : [x, z]; };   // ...and stops at the road's south edge too: no red ground past it
    // ---------- open junction / plaza: packed red earth with a concrete patch (under the lanes, y < 0.06)
    { const sh = new THREE.Shape(), cx = 64, cz = -268;
      for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2, r = 9 + 2 * Math.sin(t * 3 + 1) + rnd(); const q = offBank(cx + Math.cos(t) * r, cz + Math.sin(t) * r * 0.8); i ? sh.lineTo(q[0], -q[1]) : sh.moveTo(q[0], -q[1]); }
      B.geo(new THREE.ShapeGeometry(sh), 0, 0.035, 0, -Math.PI / 2, 0, 0, '#a58a6c');
      const s2 = new THREE.Shape(); [[56, -270], [66, -273], [70, -266], [60, -263]].map(p => offBank(p[0], p[1])).forEach((p, i) => i ? s2.lineTo(p[0], -p[1]) : s2.moveTo(p[0], -p[1]));
      B.geo(new THREE.ShapeGeometry(s2), 0, 0.045, 0, -Math.PI / 2, 0, 0, '#c4bfb3'); }

    // ---------- the street's open channel (world.drainRuns): north edge, end to end, under the breaker (photos 57-61). No holes in the
    // ground: an interior-mapped strip laid on the surface; the shader traces the view ray into the recess (dark sides, flowing water).
    // groundY dips with it, so wheels drop in; nothing here collides. Low worn kerb on the outer side, dark culvert mouths at the breaker.
    const slabs = [], DRR = world.drainRuns || [], DRW = world.drainW || 0.55;
    if (DRR.length) { const P = [], UV = [], AC = [], ALG = []; let S = 0;
      const surf = (x, z) => groundY(x, z) - world.dipAt(x, z) + 0.02;
      for (const R of DRR) for (let i = 0; i < R.length - 1; i++) { const [ax, az] = R[i], [bx, bz] = R[i + 1], l = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / l, dz = (bz - az) / l, nx = -dz, nz = dx, ang = Math.atan2(-dz, dx), N = Math.max(1, Math.ceil(l / 2)), out = -1, q = (s, o) => [ax + dx * s + nx * o, az + dz * s + nz * o];
        for (let k = 0; k < N; k++) { const s0 = l * k / N, s1 = l * (k + 1) / N, mc = q((s0 + s1) / 2, 0); if (world.insideBuilding(mc[0], mc[1], 0.2)) continue;   // passes behind a house built on the road edge
          const a = q(s0, -DRW / 2), b = q(s0, DRW / 2), c = q(s1, -DRW / 2), d = q(s1, DRW / 2);
          for (const [p, u, v] of [[a, 0, S + s0], [c, 0, S + s1], [b, 1, S + s0], [b, 1, S + s0], [c, 0, S + s1], [d, 1, S + s1]]) { P.push(p[0], surf(p[0], p[1]), p[1]); UV.push(u, v); AC.push(nx, nz); ALG.push(dx, dz); }
          const kb = q((s0 + s1) / 2, out * (DRW / 2 + 0.08)), y = surf(kb[0], kb[1]), g2 = 130 + (k * 37 % 30); B.obox(kb[0], kb[1], ang, s1 - s0 + 0.04, y - 0.1, y + 0.09, 0.16, `rgb(${g2},${g2 - 5},${g2 - 16})`); }
        S += l; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('across', new THREE.Float32BufferAttribute(AC, 2)); g.setAttribute('along', new THREE.Float32BufferAttribute(ALG, 2));
      const U = { t: { value: 0 }, sun: { value: 1 } };
      const dm2 = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, vertexShader: `attribute vec2 across, along; varying vec2 vU; varying vec3 vR;
        void main() { vU = vec2((uv.x - 0.5) * ${DRW.toFixed(2)}, uv.y); vec4 w = modelMatrix * vec4(position, 1.0); vec3 r = w.xyz - cameraPosition; vR = vec3(dot(r.xz, across), r.y, dot(r.xz, along)); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float t, sun; varying vec2 vU; varying vec3 vR; const float W = ${(DRW / 2).toFixed(3)}, W0 = 0.3;
        void main() { vec3 d = normalize(vR); float dn = max(-d.y, 0.02), tF = W0 / dn, tW = 1e3; if (abs(d.x) > 1e-4) tW = ((d.x > 0.0 ? W : -W) - vU.x) / d.x;
          vec3 c; if (tW < tF) { float y = -d.y * tW, s = vU.y + d.z * tW; float n = sin(s * 9.0) * sin(s * 3.1 + y * 21.0) * 0.5 + 0.5; c = mix(vec3(0.42, 0.4, 0.34), vec3(0.08, 0.09, 0.07), smoothstep(0.03, 0.26, y)); c *= 0.85 + 0.2 * n; }
          else { float x = vU.x + d.x * tF, s = vU.y + d.z * tF; float e = 1.0 - smoothstep(0.0, W, abs(x)) * 0.5, f = s + t * 0.75 * (0.6 + e);
            float r = sin(f * 7.0 + sin(x * 19.0) * 1.4) * sin(f * 2.3 - x * 11.0), g = sin(f * 15.0 + x * 31.0 + sin(f * 3.0)); c = mix(vec3(0.07, 0.1, 0.07), vec3(0.17, 0.2, 0.14), 0.5 + 0.5 * r); c += vec3(0.42, 0.48, 0.46) * pow(max(0.0, 0.5 + 0.5 * r * g), 6.0); }
          gl_FragColor = vec4(c * sun, 1.0); }` }));
      dm2.frustumCulled = false; root.add(dm2);
      const sky = (typeof sunLight !== 'undefined') ? sunLight : null; GameHooks.update.push(dt => { U.t.value = (U.t.value + dt) % 600; if (sky) U.sun.value = Math.min(1, 0.22 + sky.intensity * 0.9); });
      // culvert mouths in the hump's edges: dark rectangle under a thin concrete lintel, no wing walls
      const mouth = (x, z, ux, uz) => { const ang = Math.atan2(-uz, ux), y = surf(x, z), d = [x + ux * 0.16, z + uz * 0.16], h = [x + ux * 0.05, z + uz * 0.05]; B.obox(d[0], d[1], ang, 0.32, y - 0.1, y + 0.14, DRW, '#0e100c'); B.obox(h[0], h[1], ang, 0.14, y + 0.14, y + 0.26, DRW + 0.3, '#9a958a'); };
      const W0 = DRR[0], E0 = DRR[1], w = W0[W0.length - 1], w1 = W0[W0.length - 2], e = E0[0], e1 = E0[1], lw = Math.hypot(w[0] - w1[0], w[1] - w1[1]), le = Math.hypot(e[0] - e1[0], e[1] - e1[1]);
      mouth(w[0], w[1], (w[0] - w1[0]) / lw, (w[1] - w1[1]) / lw); mouth(e[0], e[1], (e[0] - e1[0]) / le, (e[1] - e1[1]) / le); }

    // expansion joints across the concrete lane (narrower along the house, where the road is 3.2 m)
    const joints = []; for (let d = 1; d < TOT - 2; d += 3.0) joints.push(Object.assign(at(d, 0), { sz: d < 37.7 ? 0.8 : 1 }));

    // ---------- walls on the north side of the lane
    // granite dry-stacked blocks
    if (0) alongWall(B, 0, 11, -4.4, 0.5, 0.62, (p, l) => { for (let y = 0; y < 1.5; y += 0.32) { const g = 0.38 + rnd() * 0.15; B.obox(p.x + (rnd() - 0.5) * 0.04, p.z, p.ang + (rnd() - 0.5) * 0.06, l - 0.03, y, y + 0.3, 0.5, `rgb(${g * 255 | 0},${g * 250 | 0},${g * 240 | 0})`); } });
    // ---------- opposite the house (north side, d 16..46): no wall, an empty overgrown plot with green bushes
    // (parked.js ran first: no bush grows through a parked vehicle)
    const carSpots = ((window.Parked && Parked.safeHouse) || []).map(s => s.split('@')[1].split(',').map(Number));
    const byCar = (x, z, r) => carSpots.some(c => Math.hypot(c[0] - x, c[1] - z) < 3 + r) || Math.hypot(x - 52, z + 274.4) < 5 + r || (world.landAt && world.landAt(x, z) > 0);   // ...nor over the breaker or the raised land
    // bushes stand well back from the road and are solid (a car stops at one instead of sinking through it)
    // (the loose bushes became the shrub cards on the raised land, below)

    // ---------- trees: mature neem/mango + saplings in green mesh guards
    const trunkCol = [];
    // real trees from the world's instanced near pool (no extra draw calls): mango, neem or tamarind by position
    const bigTree = (x, z, s, leaf) => { game.world.addHeroTree(x, z, 5 * s + 1.5, leaf === '#3f6e2c' ? 2 : leaf === '#456f2a' ? 0 : 1); trunkCol.push([x, z, 0.28 * s]); };
    { let p = at(10, -6.5); bigTree(p.x, p.z, 1.1, '#3f6e2c'); for (const [x, z, s, c] of [[38, -288.8, 1.3, '#456f2a'], [26.5, -292.5, 1.2, '#3f6e2c'], [91, -278, 1.3, '#3f6e2c'], [96, -272, 1.1, '#456f2a']]) bigTree(x, z, s, c); }
    for (const [x, z, s2, c] of [[3.5, -276.6, 1.0, '#3f6e2c'], [10.8, -277.2, 1.1, '#4a7a2f'], [15.8, -279.6, 0.95, '#456f2a']]) bigTree(x, z, s2, c);   // close by the green house (71)
    const guards = []; for (const [x0, z0] of [[69.2, -317.5], [65.8, -314.9], [62.6, -314], [59.4, -313.3], [66, -308.7], [62.5, -307.7], [59, -306.8], [73.8, -320]]) { const p = { x: x0, z: z0 }; guards.push(p); B.geo(new THREE.CylinderGeometry(0.05, 0.09, 3.2, 5), p.x, 1.6, p.z, 0, 0, 0, '#5b4630'); FO.blob(p.x, 3.7, p.z, 1.25, 1.5, 1.25, 120, [['#4e8a33', 2], ['#6aa040', 1], ['#3a6e28', 1]], 0.6); trunkCol.push([p.x, p.z, 0.32]); }

    // ================= the photographed surroundings (Street View 38-47). Painted ad text is invented placeholder text.
    // decal atlas, one draw: rows of 1/8 height (ads, weathered plaster, tiles, red stripes, pole plate)
    const ROW = { adA: 0, adB: 1, adC: 2, plaster: 3, tile: 4, brick: 5, plate: 6, stripe: 7 };
    const atlas = canvasTex(1024, 1024, (x, w, h) => {
      const H = h / 8; let sd2 = 11; const r = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;
      const ad = (row, a, b) => { x.fillStyle = '#e9e6dc'; x.fillRect(0, row * H, w, H); x.fillStyle = '#17150f'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 50px "Noto Sans Telugu","Kohinoor Telugu","Telugu Sangam MN",sans-serif'; x.fillText(a, w / 2, row * H + H * 0.3, w - 40); x.font = 'bold 44px "Noto Sans Telugu","Kohinoor Telugu","Telugu Sangam MN",sans-serif'; x.fillText(b, w / 2, row * H + H * 0.72, w - 40); for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,110,95,${r() * 0.12})`; x.fillRect(r() * w, row * H + r() * H, 3 + r() * 20, 2 + r() * 8); } };
      ad(0, 'శ్రీ గణేష్ పెయింట్స్', '00000 11111  వాల్ పెయింటింగ్');
      ad(1, 'కొత్తపల్లి బోర్‌వెల్స్', '00000 22222  సెల్');
      ad(2, 'లక్ష్మీ ట్రేడర్స్', '00000 33333');
      x.fillStyle = '#d9d6cc'; x.fillRect(0, 3 * H, w, H);                                         // weathered plaster: grey run-off from the top, damp foot
      for (let i = 0; i < 70; i++) { const X = r() * w, l = 10 + r() * H * 0.75, g = x.createLinearGradient(0, 3 * H, 0, 3 * H + l); g.addColorStop(0, `rgba(70,70,62,${0.08 + r() * 0.2})`); g.addColorStop(1, 'rgba(70,70,62,0)'); x.fillStyle = g; x.fillRect(X, 3 * H, 14 + r() * 60, l); }
      for (let i = 0; i < 130; i++) { x.fillStyle = `rgba(88,84,70,${r() * 0.28})`; x.fillRect(r() * w, 4 * H - r() * H * 0.28 - 6, 8 + r() * 42, 3 + r() * 16); }
      x.fillStyle = '#a4502f'; x.fillRect(0, 4 * H, w, H);                                         // country tiles
      for (let j = 0; j < 12; j++) for (let i = 0; i < 90; i++) { const c = 110 + r() * 75; x.fillStyle = `rgb(${c + 30 | 0},${c * 0.5 | 0},${c * 0.32 | 0})`; x.fillRect(i * w / 90 + (j % 2) * 5, 4 * H + j * H / 12, w / 90 - 1, H / 12 - 1); }
      x.fillStyle = '#6f4a33'; x.fillRect(0, 5 * H, w, H);                                         // limewashed brick
      for (let j = 0; j < 12; j++) for (let i = 0; i < 44; i++) { const c = 120 + r() * 90, l = r() < 0.4 ? 215 : 0; x.fillStyle = l ? `rgb(${l},${l - 6},${l - 18})` : `rgb(${c | 0},${c * 0.65 | 0},${c * 0.45 | 0})`; x.fillRect(i * w / 44 + (j % 2) * 11, 5 * H + j * H / 12, w / 44 - 2, H / 12 - 2); }
      x.fillStyle = '#16161a'; x.fillRect(0, 6 * H, w, H); x.fillStyle = '#ddd'; x.textAlign = 'center'; x.font = 'bold 56px sans-serif'; x.fillText('GPR 12/1', w / 2, 6.5 * H, w - 30);
      x.fillStyle = '#ededE4'; x.fillRect(0, 7 * H, w, H); x.fillStyle = '#b23a24'; for (let i = 0; i < 7; i++) x.fillRect((i + 0.35) * w / 7, 7 * H, w / 7 * 0.22, H);
    });
    const DP = [], DN = [], DU = [], dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), dv = new THREE.Vector3(), ds = new THREE.Vector3(1, 1, 1);
    // a flat decal w x h at (x,y,z); uRep repeats nothing: u0..u1 picks part of the row
    function decal(x, y, z, w, h, ry, rx, row, u0, u1) {
      const g = new THREE.PlaneGeometry(w, h).toNonIndexed(); de.set(rx || 0, ry, 0, 'YXZ'); dq.setFromEuler(de); dm.compose(dv.set(x, y, z), dq, ds); g.applyMatrix4(dm);
      const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array, a = u0 == null ? 0 : u0, b = u1 == null ? 1 : u1;
      for (let i = 0; i < p.length; i++) { DP.push(p[i]); DN.push(n[i]); }
      for (let i = 0; i < u.length; i += 2) DU.push(a + (b - a) * u[i], 1 - (row + 1 - u[i + 1]) / 8);
    }
    function stainMesh() {
      const tx = canvasTex(1024, 96, (x, w, h) => { x.clearRect(0, 0, w, h); let sd2 = 31; const r = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 70; i++) { const X = r() * w, Y = r() * h, R2 = 18 + r() * 60, g = x.createRadialGradient(X, Y, 0, X, Y, R2); g.addColorStop(0, `rgba(150,92,58,${0.08 + r() * 0.2})`); g.addColorStop(1, 'rgba(150,92,58,0)'); x.fillStyle = g; x.fillRect(X - R2, Y - R2, R2 * 2, R2 * 2); } });
      const P = [], U = [], rib = (d0, d1) => { const a = at(d0, 0), b = at(d1, 0), n = [-a.dz * 1.58, a.dx * 1.58], y = 0.0705; P.push(a.x + n[0], y, a.z + n[1], b.x + n[0], y, b.z + n[1], a.x - n[0], y, a.z - n[1], a.x - n[0], y, a.z - n[1], b.x + n[0], y, b.z + n[1], b.x - n[0], y, b.z - n[1]); const u = (d1 - d0) / 45; U.push(0, 1, u, 1, 0, 0, 0, 0, u, 1, u, 0); };
      rib(1, 37); rib(38, 45); rib(45, 86);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
      tx.wrapS = THREE.RepeatWrapping; const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tx, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); m.receiveShadow = true; return m; }
    function decalMesh() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(DP, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(DN, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(DU, 2)); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); m.receiveShadow = true; return m; }
    const face = (cx, cz, ang, off, w, y0, y1, row, u0, u1) => decal(cx + Math.sin(ang) * off, (y0 + y1) / 2, cz + Math.cos(ang) * off, w, y1 - y0, off < 0 ? ang + Math.PI : ang, 0, row, u0, u1);
    function block(x, z, ang, len, dep, h, c) { B.obox(x, z, ang, len, 0, h, dep, c); collider(x, z, ang, len, dep); }
    const flag = (x, y, z, c) => { B.obox(x, z, 0, 0.04, y, y + 1.3, 0.04, '#6b5b42'); B.obox(x + 0.34, z, 0, 0.64, y + 0.82, y + 1.3, 0.03, c); };
    // red-tile or asbestos pitched roof: two tilted slabs + gable ends
    function roof(x, z, ang, len, dep, y, rise, row) {
      const t = Math.atan2(rise, dep / 2), s = Math.hypot(rise, dep / 2) + 0.35, sa = Math.sin(ang), ca = Math.cos(ang);
      for (const k of [1, -1]) decal(x + sa * k * dep / 4, y + rise / 2, z + ca * k * dep / 4, len + 0.5, s, ang, k > 0 ? -Math.PI / 2 + t : Math.PI / 2 - t, row, 0, 0.5);
      const sh = new THREE.Shape(); sh.moveTo(-dep / 2, 0); sh.lineTo(dep / 2, 0); sh.lineTo(0, rise); sh.closePath();
      for (const k of [-1, 1]) B.geo(new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false }), x + ca * (k * len / 2 - 0.09), y, z - sa * (k * len / 2 - 0.09), 0, ang - Math.PI / 2, 0, '#d8d4c8');
    }
    const WHITE = '#dedbd0', BLUE = '#3f9fc4';

    // ---------- blue house with flags (40, 41, 46, 47): long west wall, porch slab facing the lane
    { const c = at(64, -12.8), a = c.ang, sa = Math.sin(a), ca = Math.cos(a), L = (u, v) => [c.x + ca * u + sa * v, c.z - sa * u + ca * v];
      block(c.x, c.z, a, 7.6, 12, 3.1, BLUE); B.obox(c.x, c.z, a, 7.8, 3.1, 3.3, 12.2, '#3a93b6');
      for (const u of [-3.6, 3.6]) { const q = L(u, 7.3); B.obox(q[0], q[1], a, 0.3, 0, 2.7, 0.3, BLUE); }
      { const q = L(0, 7.4); B.obox(q[0], q[1], a, 8.1, 2.7, 3.0, 2.6, '#6d675a'); B.obox(q[0], q[1], a, 8.1, 3.0, 3.1, 2.7, '#3f3a31'); }
      { const q = L(1.4, 6.04); B.obox(q[0], q[1], a, 1, 0, 2.1, 0.06, '#3a2c1e'); }
      for (const [u, v, f] of [[-3.5, -5, '#c42a25'], [-3.5, 0, '#e8b72c'], [-3.5, 4.5, '#ea8a1c'], [2.5, 7.5, '#2e8a3a']]) { const q = L(u, v); flag(q[0], 3.3, q[1], f); } }

    // ---------- timber + tarpaulin pile at the blue house, west of the porch (47)
    { const c = at(55.5, -6.6);
      const col2 = ['#6b4a2f', '#4f7a55', '#7d5b3a', '#3e8ca8', '#8c6a42'];
      for (let i = 0; i < 26; i++) { const u = (rnd() - 0.5) * 5.5, v = (rnd() - 0.5) * 2.4, y = 0.08 + rnd() * 0.5; B.geo(new THREE.BoxGeometry(2.6 + rnd() * 1.6, 0.07, 0.2), c.x + u * 0.9 + v * 0.44, y, c.z + u * 0.44 - v * 0.9, 0, c.ang + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.25, col2[i % 5]); }
      B.geo(new THREE.SphereGeometry(1, 8, 5), c.x - 3.2, 0.25, c.z + 0.2, 0, 0, 0, '#d8c4cc');  // tarpaulin bundle, scaled below by its own clone
      const t = at(49.8, -7); B.geo(new THREE.SphereGeometry(1, 8, 4).scale(2.1, 0.55, 1.1), t.x, 0.42, t.z, 0, c.ang, 0, '#cfc6c0');
      collider(c.x, c.z, c.ang, 5, 2.2); }

    // ---------- brick rubble heap and white compound on the south side (47)
    { const a0 = at(52, 5); B.geo(new THREE.SphereGeometry(1, 10, 5).scale(5, 0.6, 1.6), a0.x, 0.0, a0.z, 0, a0.ang, 0, '#7a5a48');   // a small tidy heap by the road, nothing loose around it
      for (let i = 0; i < 70; i++) { const e = Math.sqrt(rnd()) * 0.92, t = rnd() * 6.283, d = 52 + Math.cos(t) * e * 5, o = 5 + Math.sin(t) * e * 1.6, p = at(d, o), g = 90 + rnd() * 80; B.geo(new THREE.BoxGeometry(0.24, 0.09, 0.13), p.x, Math.max(0.05, 0.6 * Math.sqrt(Math.max(0, 1 - e * e))), p.z, rnd(), rnd() * 6, rnd(), `rgb(${g + 40 | 0},${g * 0.6 | 0},${g * 0.42 | 0})`); }
      for (let d = 68; d < 92; d += 5) { const p = at(d + 2.5, 4.3);   // the mud lane south passes where the first panel stood
        B.obox(p.x, p.z, p.ang, 5, 0, 1.6, 0.2, d < 73 ? WHITE : '#a8c4bc'); collider(p.x, p.z, p.ang, 5, 0.25); if (d % 2 == 1) B.obox(p.x, p.z, p.ang, 1.2, 0, 1.9, 0.26, '#8d8f8b'); }
      { const p = at(77, 11); block(p.x, p.z, p.ang, 14, 8, 3.1, '#e6e3da'); B.obox(p.x, p.z, p.ang, 14.4, 3.1, 3.3, 8.4, '#8f8a7e'); B.obox(p.x + p.dz * 4.05, p.z - p.dx * 4.05, p.ang, 13, 1.9, 2.0, 0.5, '#c9c5b8'); for (const u of [-4, 0, 4]) { B.obox(p.x + p.dx * u + p.dz * 4.03, p.z + p.dz * u - p.dx * 4.03, p.ang, 1.1, 1.1, 1.8, 0.04, '#6f6a60'); } }
      for (const f of [[73, 11, "#2e8a3a"], [74.5, 11, "#ea8a1c"]]) { const p = at(f[0], f[1]); flag(p.x, 3.3, p.z, f[2]); } }

    // ---------- the lane opposite the house (83), west side: weathered grey-white gabled end wall, then the yellow house with the blue base,
    // dish and paved slab; earth track with bare patches, a dark wet rut and grass tufts along its edges
    { const c = { x: 43.5, z: -295.5, a: 1.47 }, s2 = Math.sin(c.a), k = Math.cos(c.a); block(c.x, c.z, c.a, 8, 5, 2.7, '#cfcdc3'); roof(c.x, c.z, c.a, 8, 5, 2.7, 1.25, ROW.plaster); face(c.x, c.z, c.a, 2.54, 7.9, 0.05, 2.65, ROW.plaster); face(c.x, c.z, c.a, -2.54, 7.9, 0.05, 2.65, ROW.plaster);
      // the end wall: mottled black-grey run-off over old limewash, gable included
      const tx = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#c9c8c0'; x.fillRect(0, 0, w, h); let q = 73; const r = () => (q = (q * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 260; i++) { const X = r() * w, Y = r() * h * 0.5, l = 60 + r() * 330, W2 = 3 + r() * 16, g = x.createLinearGradient(0, Y, 0, Y + l); g.addColorStop(0, `rgba(24,24,22,${0.25 + r() * 0.45})`); g.addColorStop(1, 'rgba(30,30,28,0)'); x.fillStyle = g; x.fillRect(X, Y, W2, l); }
        for (let i = 0; i < 90; i++) { const X = r() * w, Y = h * 0.55 + r() * h * 0.45, R3 = 8 + r() * 42; x.fillStyle = `rgba(${r() < 0.5 ? '235,233,225' : '60,60,55'},${0.2 + r() * 0.35})`; x.beginPath(); x.ellipse(X, Y, R3, R3 * 0.55, r() * 3, 0, 6.3); x.fill(); }
        for (let i = 0; i < 2500; i++) { const v = r() * 255; x.fillStyle = `rgba(${v},${v},${v},0.12)`; x.fillRect(r() * w, r() * h, 2, 3); } });
      const sh = new THREE.Shape(); sh.moveTo(-2.6, 0); sh.lineTo(2.6, 0); sh.lineTo(2.6, 2.7); sh.lineTo(0, 3.98); sh.lineTo(-2.6, 2.7); sh.closePath();
      const gg = new THREE.ShapeGeometry(sh), ua = gg.attributes.uv, pa = gg.attributes.position; for (let i = 0; i < pa.count; i++) ua.setXY(i, (pa.getX(i) + 2.6) / 5.2, pa.getY(i) / 3.98);
      const em = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide })); em.position.set(c.x - k * 4.07, 0, c.z + s2 * 4.07); em.rotation.y = c.a - Math.PI / 2; em.receiveShadow = true; root.add(em);
      bigTree(54.6, -296.4, 1.5, '#456f2a');   // the tree beside the wall and the red-tile house, on the lane's east edge
      const x = 44.6, z = -305, a = 0.05, S = Math.sin(a), K = Math.cos(a); block(x, z, a, 5.2, 4.2, 2.9, '#e6d26e'); B.obox(x, z, a, 5.24, 0, 0.45, 4.24, '#2f6f9a'); B.obox(x, z, a, 5.5, 2.9, 3.05, 4.5, '#c4bfae');
      B.obox(x - 0.6, z + 2.13, a, 1.0, 1.0, 2.0, 0.06, '#6e3f26'); B.geo(new THREE.CylinderGeometry(0.42, 0.05, 0.14, 12), x - 2.0, 3.5, z + 0.6, 0.9, 0.8, 0, '#e6e6e0'); B.geo(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), x - 2.0, 3.25, z + 0.6, 0, 0, 0, '#777');
      B.obox(x + 1.0, z + 3.1, a, 4.0, 0, 0.09, 1.8, '#c2bfb4');
      // one big round dense tree closing the lane (83)
      const tr = [46.8, -316.5]; game.world.addHeroTree(tr[0], tr[1], 11, 2); trunkCol.push([tr[0], tr[1], 0.5]);
      // the lane is a plain mud road now: only a small stone pile at the edge
      if (0) for (let i = 0; i < 46; i++) { const t = rnd() * 6.28, u = Math.sqrt(rnd()), px = 52.1 + Math.cos(t) * u * 1.3, pz = -282.5 + Math.sin(t) * u * 2.8, g2 = 55 + rnd() * 75; B.geo(ico(0.03 + rnd() * 0.06, 0), px, 0.09, pz, rnd(), rnd(), 0, `rgb(${g2 + 18 | 0},${g2 | 0},${g2 * 0.8 | 0})`); }
      for (let i = 0; i < 34; i++) { const u = rnd(), v = rnd(), g2 = 150 + rnd() * 70, hh = (1 - Math.hypot(u - 0.5, v - 0.5) * 1.7); B.geo(ico(0.06 + rnd() * 0.07, 0), 54.9 + u * 1.5, 0.08 + hh * rnd() * 0.42, -291 + v * 1.1, rnd(), rnd(), 0, `rgb(${g2 | 0},${g2 * 0.95 | 0},${g2 * 0.88 | 0})`); } }

    // ---------- third white house at the end of the fork, with a brown window
    { const x = 82, z = -296, a = 0.1; block(x, z, a, 9, 6, 3.0, '#e4e1d8'); B.obox(x, z, a, 9.2, 3.0, 3.35, 6.2, '#a7a498'); B.obox(x + 0.6, z, a, 1.2, 1.0, 2.1, 6.05, '#6e3f26'); }

    // ---------- red-tile old house (40, 41, 46): long, low, blue door
    { const x = 63.5, z = -297.5, a = 0.1; block(x, z, a, 15, 5.6, 2.2, '#dfddd4'); roof(x, z, a, 15, 5.6, 2.2, 1.35, ROW.tile);
      const c = Math.cos(a), s = Math.sin(a); B.obox(x + c * -1 + s * 2.83, z - s * -1 + c * 2.83, a, 1.05, 0, 1.9, 0.06, '#2a7fa6'); B.obox(x + c * 3 + s * 2.83, z - s * 3 + c * 2.83, a, 0.7, 0.9, 1.5, 0.06, '#2a7fa6'); }

    // ---------- free-standing painted ad blocks (40, 41, 44, 45, 46) with stones in front
    const adBlock = (x, z, a, w, row) => { B.obox(x, z, a, w, 0, 1.45, 0.3, '#d9d5c8'); B.obox(x, z, a, w + 0.1, 1.45, 1.6, 0.36, '#5f5a4e'); B.obox(x, z, a, w + 0.04, 0, 0.3, 0.34, '#6e675a'); face(x, z, a, 0.17, w, 0.32, 1.42, row, 0, 1); collider(x, z, a, w, 0.35); };
    adBlock(71.2, -280.2, 0.05, 4.2, ROW.adA); adBlock(66.6, -280.0, -0.06, 2.6, ROW.adB);
    for (let i = 0; i < 9; i++) B.geo(ico(0.16 + rnd() * 0.16, 0), 70 - rnd() * 5, 0.12, -278.7 + rnd() * 0.9, rnd(), rnd(), 0, '#b5ae9e');

    // ---------- brick wall with painted ads behind the drain on the first stretch of the lane (39)
    { const A = [21.4, -292.6], Z = [33.2, -286.2], x = (A[0] + Z[0]) / 2, z = (A[1] + Z[1]) / 2, a = Math.atan2(-(Z[1] - A[1]), Z[0] - A[0]), len = Math.hypot(Z[0] - A[0], Z[1] - A[1]); B.obox(x, z, a, len, 0, 2.0, 0.28, '#7b5a42'); B.obox(x, z, a, len + 0.1, 2.0, 2.14, 0.34, '#8b6a50');
      face(x, z, a, 0.15, len, 0.02, 2.0, ROW.brick, 0, 1); collider(x, z, a, len, 0.3);
      const c = Math.cos(a), s = Math.sin(a); [[-4, ROW.adA], [0, ROW.adB], [4, ROW.adC]].forEach(([u, r]) => face(x + c * u, z - s * u, a, 0.17, 3.8, 0.75, 1.95, r, 0, 1)); }

    // ---------- mud forks, drawn as dirt strips + rain gully; drivable as open ground
    { const track = (pts, w, col2, y) => { for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az) + 0.5, an = Math.atan2(-(bz - az), bx - ax); B.obox((ax + bx) / 2, (az + bz) / 2, an, l, 0, y, w, col2); } };
      track([[56, -271.5], [64, -269.5], [72.5, -272], [75, -277]], 2.6, '#a57a58', 0.05);
      track([[73, -274], [76.5, -276.5], [74, -279]], 0.28, '#7a4d33', 0.06);
}

    // ---------- cement lane: curved tongue where the slabs stop (41, 43), reddish stains on the slabs (38, 42, 47)
    { const sh = new THREE.Shape(); sh.moveTo(53.2, 271.8); sh.quadraticCurveTo(57.6, 273.3, 59.2, 269.1); sh.lineTo(55, 267.2); sh.closePath();
      B.geo(new THREE.ShapeGeometry(sh), 0, 0.058, 0, -Math.PI / 2, 0, 0, '#b4ae9f'); }

    // ---------- temple street (38): white wall on the south, Shivalayam compound with red stripes + pink shrine plinth on the north
    {
      // the compound's east wall (lm.face 1.325) either side of the gate, outside face on the road, pink plinth just south of the gate (Street View, heading 340)
      const ta = 1.325, tsa = Math.sin(ta), tca = Math.cos(ta), lmx = 34.7, lmz = -351.5, W = (a, b) => [lmx + a * tca + b * tsa, lmz - a * tsa + b * tca];
      for (const a of [-6.1, 6.1]) { const [tx, tz] = W(a, 11.7);
        B.obox(tx, tz, ta, 7.8, 0, 2.3, 0.22, '#e9e8e0'); B.obox(tx, tz, ta, 8, 0, 0.3, 0.32, '#c4c0b2'); face(tx, tz, ta, 0.13, 7.8, 0.05, 2.28, ROW.stripe, 0, 0.34); }
      { const [px, pz] = W(-3.8, 13.2); B.obox(px, pz, ta, 2.2, 0, 1.0, 1.5, '#d98a90'); collider(px, pz, ta, 2.2, 1.5);
        B.geo(new THREE.SphereGeometry(0.34, 7, 5), px - 0.15, 1.3, pz + 0.35, 0, 0, 0, '#d78428'); B.geo(new THREE.SphereGeometry(0.28, 7, 5), px + 0.2, 1.25, pz - 0.5, 0, 0, 0, '#e0a02c'); }
      // the real overhead tank is the map landmark at (10.6,-335): the copy that stood here is gone. The Shivalayam stays out of
      // sight from the house lane: the grey house at (40,-313) on the imagery and the big trees along the compound close the view.
      for (const [x, z, s] of [[68, -314.6, 2], [62.5, -313.9, 1.9]]) bigTree(x, z, s, '#3f6e2c'); }

    // ---------- milk cooperative (Street View photo 97): stands where the map's house #(31,-295) was dropped for the gable house, facing the CC road.
    { const c = { x: 35.4, z: -302.9 }, A = 0.6435, U = (u, v) => [c.x + 0.8 * u + 0.6 * v, c.z - 0.6 * u + 0.8 * v], WH = '#e8e6de', LOW = '#7f9bb8', W2 = 9, D2 = 4.4;
      const ob = (u, v, len, y0, y1, dep, col2) => { const q = U(u, v); B.obox(q[0], q[1], A, len, y0, y1, dep, col2); };
      // red earth yard out to the road, with a thin stone edge
      { const s3 = new THREE.Shape(); [[-5.6, -8.4], [6.2, -8.4], [6.2, -2.3], [-5.6, -2.3]].map(q => U(q[0], q[1])).forEach((q, i) => i ? s3.lineTo(q[0], -q[1]) : s3.moveTo(q[0], -q[1])); B.geo(new THREE.ShapeGeometry(s3), 0, 0.04, 0, -Math.PI / 2, 0, 0, '#b0694a'); }
      block(c.x, c.z, A, W2, D2, 3.0, WH); ob(0, 0, W2 + 0.04, 0, 1.75, D2 + 0.04, LOW); ob(0, 0, W2 + 0.3, 3.0, 3.09, D2 + 0.3, '#5c5a54');
      // veranda: floor, slab, sign band, pillars on the open front (the east end stays open as in the photo)
      ob(0, -2.95, W2, 0, 0.1, 1.5, '#b5b1a6'); ob(0, -2.95, W2 + 0.1, 2.72, 2.84, 1.56, '#d9d6cc'); ob(0, -3.72, W2 + 0.3, 2.56, 3.34, 0.1, WH); ob(0, -3.72, W2 + 0.36, 3.34, 3.42, 0.16, '#5c5a54');
      for (const u of [-4.2, 0.1]) { ob(u, -3.5, 0.28, 0, 2.6, 0.28, WH); ob(u, -3.5, 0.3, 0, 1.0, 0.3, '#7fa0c0'); const q = U(u, -3.5); collider(q[0], q[1], A, 0.3, 0.3); }
      // front wall: blue door, notice board, louvred windows, stained patch, brown door, small high vents
      const F2 = -2.23, door = (u, w, col2) => { ob(u, F2, w + 0.12, 0, 2.08, 0.04, '#5f7a95'); ob(u, F2 - 0.02, w, 0, 2.0, 0.05, col2); };
      door(-3.5, 1.0, '#6f8fae'); ob(-2.35, F2 - 0.02, 0.62, 0.95, 1.8, 0.04, '#2c2b2a'); door(3.6, 0.9, '#6e3f26');
      for (const u of [-0.9, 2.05]) { ob(u, F2, 1.3, 0.8, 1.75, 0.04, '#4d5a68'); for (let y = 0.86; y < 1.72; y += 0.11) ob(u, F2 - 0.03, 1.22, y, y + 0.055, 0.03, '#a5b3bf'); }
      ob(0.75, F2 - 0.02, 0.8, 0.9, 1.65, 0.03, '#c9c3b2');
      for (const u of [-3.4, -1.6, 0.4, 2.3]) ob(u, F2 - 0.02, 0.8, 2.08, 2.34, 0.03, '#5a2e22');
      // small round marker: green base, white drum, orange cap
      { const q = U(0.1, -5); B.geo(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 18), q[0], 0.08, q[1], 0, 0, 0, '#3f8a5a'); B.geo(new THREE.CylinderGeometry(0.34, 0.4, 0.3, 18), q[0], 0.27, q[1], 0, 0, 0, '#eeeee6'); B.geo(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16), q[0], 0.49, q[1], 0, 0, 0, '#e8761c'); collider(q[0], q[1], A, 0.7, 0.7); }
      // broken stone-kerbed tree guard, and two young trees in green mesh guards
      { let i = 0; for (const [u0, v0, u1, v1] of [[3.2, -7.4, 5.8, -7.4], [5.8, -7.4, 5.8, -5.6], [3.2, -5.6, 5.8, -5.6], [3.2, -7.4, 3.2, -5.6]]) for (let t = 0; t < 1; t += 0.2, i++) { if (i % 7 === 5) continue; const q = U(u0 + (u1 - u0) * (t + 0.1), v0 + (v1 - v0) * (t + 0.1)), g2 = 140 + (i * 53 % 50); B.obox(q[0], q[1], A + (u1 === u0 ? Math.PI / 2 : 0) + (i % 3 - 1) * 0.08, 0.5, 0, 0.2 + (i % 3) * 0.04, 0.22, `rgb(${g2},${g2 - 6},${g2 - 18})`); }
        for (const [u, v, r] of [[4.5, -6.5, 1.5], [-5.2, -7.2, 1.25], [6.3, -3.2, 1.35]]) { const q = U(u, v), p = { x: q[0], z: q[1] }; guards.push(p); B.geo(new THREE.CylinderGeometry(0.05, 0.09, 3.2, 5), p.x, 1.6, p.z, 0, 0, 0, '#5b4630'); FO.blob(p.x, 3.3 + r * 0.3, p.z, r, r * 1.2, r, 120, [['#4e8a33', 2], ['#6aa040', 1], ['#3a6e28', 1]], 0.6); trunkCol.push([p.x, p.z, 0.3]); } }
      // the sign, painted on the band
      const sg = canvasTex(1024, 96, (x, w, h) => { x.fillStyle = '#efeee8'; x.fillRect(0, 0, w, h); x.fillStyle = '#1f3f9a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 66px "Noto Sans Telugu","Kohinoor Telugu","Telugu Sangam MN",sans-serif'; x.fillText('పాల ఉత్పత్తిదారుల సహకార సంఘం', w / 2, h * 0.54, w - 30); });
      const sm2 = new THREE.Mesh(new THREE.PlaneGeometry(W2 + 0.2, 0.74), new THREE.MeshLambertMaterial({ map: sg })), sq = U(0, -3.78); sm2.position.set(sq[0], 2.95, sq[1]); sm2.rotation.y = A + Math.PI; root.add(sm2); }

    // ---------- a plain village house on the corner of the CC lane and the mud lane south (102), door to the lane side
    { const x = 69.6, z = -251.5, a = 0; block(x, z, a, 7, 6, 3.0, '#e3d3bf'); B.obox(x, z, a, 7.04, 0, 0.5, 6.04, '#8f8476'); B.obox(x, z, a, 7.3, 3.0, 3.12, 6.3, '#a9a498'); for (const [dx, dz, l, d2] of [[0, -3.05, 7.3, 0.12], [0, 3.05, 7.3, 0.12], [-3.6, 0, 0.12, 6.2], [3.6, 0, 0.12, 6.2]]) B.obox(x + dx, z + dz, a, l, 3.12, 3.55, d2, '#d9d6cc');
      B.obox(x - 1.4, z - 3.03, a, 1.0, 0, 2.05, 0.06, '#2f6f7f'); B.obox(x + 1.5, z - 3.03, a, 1.2, 1.0, 2.0, 0.06, '#5a3a26'); B.obox(x - 1.4, z - 3.6, a, 1.8, 2.2, 2.28, 1.2, '#b7b3a6'); B.obox(x + 3.53, z - 0.8, a, 0.06, 0.95, 1.95, 1.1, '#5a3a26'); B.obox(x - 1.4, z - 3.4, a, 1.5, 0, 0.14, 0.8, '#b9b4a6');
      B.geo(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12), x + 2, 3.67, z + 1.5, 0, 0, 0, '#1b1b1b'); }

    for (const [x, z, r] of trunkCol) collider(x, z, 0, r * 2, r * 2);

    // ---------- dense low shrubs on both raised plots: big cards from one clump texture, one instanced draw
    const SH = []; { const shrubOK = (x, z) => { for (const q of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) { const f = world.surfaceAt(x + q[0], z + q[1]); if (f !== 'field') return false; } return !carSpots.some(c => Math.hypot(c[0] - x, c[1] - z) < 3); };
      for (let x = 22; x < 78; x += 0.8) for (let z = -296; z < -236; z += 0.8) {
        const px = x + (rnd() - 0.5) * 0.8, pz = z + (rnd() - 0.5) * 0.8, h = world.landRaw(px, pz); if (h < 0.03 || world.land4At(px, pz) > 0 || world.yardAt(px, pz) > 0 || (!(h >= 0.07 && world.surfaceAt(px, pz) === 'field' && px < 37) && !shrubOK(px, pz))) continue;
        const dd = Math.abs(Math.sin(px * 0.31 + pz * 0.17) + Math.sin(pz * 0.43 - px * 0.2));   // clumps and thin patches
        for (let k = 0; k < (dd > 0.55 ? 2 : 1); k++) { const s = (0.7 + rnd() * 0.55) * (0.72 + 0.3 * Math.min(1, h)); SH.push({ x: px + (rnd() - 0.5) * 0.5, y: h + s * 0.33, z: pz + (rnd() - 0.5) * 0.5, s, a: rnd() * 3.14, g: rnd() }); }
      } }
    for (const R of (world.drainRuns || [])) for (let i = 0; i < R.length - 1; i++) { const l = Math.hypot(R[i + 1][0] - R[i][0], R[i + 1][1] - R[i][1]), ux = (R[i + 1][0] - R[i][0]) / l, uz = (R[i + 1][1] - R[i][1]) / l;
      for (let d = 0; d < l && R[i][0] + ux * d < 125; d += 1.1) { const o = 0.75 + rnd() * 0.9, px = R[i][0] + ux * d + uz * o, pz = R[i][1] + uz * d - ux * o, f = world.surfaceAt(px, pz); if (f !== 'field' || carSpots.some(c => Math.hypot(c[0] - px, c[1] - pz) < 2.4) || (world.insideBuilding && world.insideBuilding(px, pz, 0.3))) continue; const s = 0.6 + rnd() * 0.5; SH.push({ x: px, y: world.landRaw(px, pz) + s * 0.33, z: pz, s, a: rnd() * 3.14, g: rnd() }); } }
    { const tuft = (x, z, s) => { if (world.surfaceAt(x, z) !== 'field' || world.insideBuilding(x, z, 0.25)) return; SH.push({ x, y: world.landRaw(x, z) + s * 0.33, z, s, a: rnd() * 3.14, g: rnd() }); };
      for (let x = 11; x < 27; x += 1.5) for (let z = -277; z < -259; z += 1.5) { const px = x + rnd(), pz = z + rnd(); if (world.land4At(px, pz) > 0 && Math.sin(px * 0.9 + pz * 0.4) * Math.sin(pz * 0.8 - px * 0.3) > 0.2) tuft(px, pz, 0.28 + rnd() * 0.2); }   // sparse grass on the play ground
      for (let x = 0; x < 20; x += 0.7) for (let z = -281; z < -275; z += 0.7) if (world.land4At(x, z) <= 0) tuft(x + rnd() * 0.5, z + rnd() * 0.5, 0.42 + rnd() * 0.3); }   // green right beside the green house
    // the mud road: leaves the lane on the slope, winds up along the green house (79); bare earth on the land, no height of its own
    const mudD = (x, z) => { let b = 1e9; const R = world.mudRoad; for (let i = 0; i < R.length - 1; i++) { const a = R[i], c = R[i + 1], vx = c[0] - a[0], vz = c[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz))); b = Math.min(b, Math.hypot(a[0] + vx * t - x, a[1] + vz * t - z)); } return b; };
    for (let i = SH.length - 1; i >= 0; i--) if (mudD(SH[i].x, SH[i].z) < 2.1) SH.splice(i, 1);
    { const R = world.mudRoad, P = [], Co = [], Ix = [], col = new THREE.Color(); let s = 0, n = 0; const pts = []; for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < 8; k++) { const t = k / 8, p0 = R[Math.max(0, i - 1)], p1 = R[i], p2 = R[i + 1], p3 = R[Math.min(R.length - 1, i + 2)], u = t, c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u); pts.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]); } pts.push(R[R.length - 1]);
      pts.forEach((q, i) => { const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, nx = -(c[1] - a[1]) / l, nz = (c[0] - a[0]) / l; for (const o of [-1.5, -0.75, 0, 0.75, 1.5]) { const x = q[0] + nx * o, z = q[1] + nz * o; P.push(x, Math.max(world.landRaw(x, z), groundY(x, z)) + 0.03, z); const m = Math.abs(o) > 1 ? 0.92 : 1; col.set('#a57a58').multiplyScalar(m * (0.94 + 0.08 * Math.sin(i * 1.7 + o * 3))); Co.push(col.r, col.g, col.b); } });
      for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < 4; j++) { const q = i * 5 + j, r = q + 5; Ix.push(q, q + 1, r, q + 1, r + 1, r); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Co, 3)); g.setIndex(Ix); g.computeVertexNormals(); root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))); }
    for (let z = -303; z < -277; z += 0.27) for (const sd2 of [-1, 1]) { if (Math.sin(z * 0.8 + sd2 * 1.7) + Math.sin(z * 0.31 + 2 * sd2) + Math.sin(z * 1.9 - sd2) < 0.2) continue; const wd = 1.0 + rnd() * 0.9, px = 52.1 + 1.2 * (z + 283.1) / 12.4 + sd2 * (1.75 + wd * rnd()), pz = z + rnd() * 0.4; if (!world.insideBuilding(px, pz, 0.3)) { const s = 0.3 + rnd() * 0.22; SH.push({ x: px, y: world.landRaw(px, pz) + s * 0.33, z: pz, s, a: rnd() * 3.14, g: rnd() * 0.6 }); } }   // grass strips along the lane with bare gaps (83)
    function shrubMesh() {
      const tx = canvasTex(256, 256, (x, w, h) => { x.clearRect(0, 0, w, h); let sd2 = 77; const r = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 1500; i++) { const t = r() * 6.28, q = Math.sqrt(r()) * 0.47, X = w / 2 + Math.cos(t) * q * w, Y = h * 0.56 + Math.sin(t) * q * h * 0.85; if (Y > h - 2) continue; const c = 150 + r() * 105; x.fillStyle = `rgb(${c | 0},${c | 0},${c | 0})`; x.save(); x.translate(X, Y); x.rotate(r() * 6.28); x.beginPath(); x.ellipse(0, 0, 6, 3, 0, 0, 6.3); x.fill(); x.restore(); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, .5, 0, -.5, -.5, 0, .5, .5, 0, .5, -.5, 0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 0], 2)); g.setIndex([0, 1, 2, 2, 1, 3, 2, 1, 0, 3, 1, 2]);   // both windings, one lighting: a back face must not go dark
      const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ map: tx, alphaTest: 0.5 }), SH.length), d = new THREE.Object3D(), c = new THREE.Color();
      SH.forEach((q, i) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, q.a, 0); d.scale.set(q.s * 1.3, q.s * 0.9, 1); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, c.setRGB(0.27 + q.g * 0.24, 0.47 + q.g * 0.22, 0.11 + q.g * 0.1)); });
      m.instanceColor.needsUpdate = true; return m;
    }
    // pole plate GPR 12/1
    { decal(48.4, 3.0, -276.88, 0.3, 0.46, 0.45, 0, ROW.plate, 0.25, 0.75); }


    // ---------- concrete electric poles, sagging wires
    // keep every pole off the open plaza at the junction (it is driven across): slide along the lane until clear
    const offPlaza = (d, o) => { let p = at(d, o); for (let k = 0; k < 40 && Math.hypot((p.x - 64) / 11.5, (p.z + 268) / 9.4) < 1; k++) p = at(d += (d < 50 ? -0.5 : 0.5), o); return p; };
    const G12 = { x: 48.3, z: -277.0, ang: 0.45, dx: 0.88, dz: 0.47 };   // GPR 12/1: the pole at the corner where the cement ends
    const poleN = [at(2, -3.6), at(26, -3.2), G12, at(64, -3.4), at(86, -3.4)], poleS = [at(14, 3.4)];
    for (const p of [...poleN, ...poleS]) { B.obox(p.x, p.z, p.ang, 0.18, 0, 8, 0.24, '#a9a69c'); B.obox(p.x, p.z, p.ang + Math.PI / 2, 1.2, 7.3, 7.4, 0.1, '#6b6b6b'); collider(p.x, p.z, p.ang, 0.25, 0.3); B.obox(p.x - p.dz * 0.75, p.z + p.dx * 0.75 , p.ang + Math.PI / 2, 1.4, 6.3, 6.36, 0.06, '#77776f'); B.obox(p.x - p.dz * 1.4, p.z + p.dx * 1.4, p.ang, 0.45, 6.22, 6.3, 0.14, '#d9d6c8'); }
    const wire = [], sag = (a, b, y, s, n, cb) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, Y = t => y - s * 4 * t * (1 - t); wire.push(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, Y(t1), a.z + (b.z - a.z) * t1); if (cb) cb(a.x + (b.x - a.x) * t0, Y(t0), a.z + (b.z - a.z) * t0, Math.atan2(-(b.z - a.z), b.x - a.x)); } };
    for (let i = 0; i < poleN.length - 1; i++) for (const off of [-0.5, 0, 0.5]) sag({ x: poleN[i].x + poleN[i].dz * off, z: poleN[i].z - poleN[i].dx * off }, { x: poleN[i + 1].x + poleN[i + 1].dz * off, z: poleN[i + 1].z - poleN[i + 1].dx * off }, 7.35, 0.7, 12);

    // ---------- raised land opposite the house: grassy plateau, smooth sides fading into the ground, a car high
    if (world.land) { const P = [], Co = [], UV = [], Ix = [], col = new THREE.Color(); let base = 0; for (const L0 of [world.land, world.land2, world.land3, world.land4, world.land5, world.land6]) { const N = L0.area ? 70 : 44, M = 46, A0 = L0.a - L0.ha - L0.slope - 0.5, A1 = L0.a + L0.ha + L0.slope + 0.5, D0 = L0.patchy || L0.area ? L0.d - L0.hd - L0.slope - 0.5 : 0.5, D1 = L0.d + L0.hd + L0.slope + 0.5;
      const noi = (x, z) => Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.1 - x * 0.4) * 0.5 + Math.sin(x * 3.1) * Math.sin(z * 2.7) * 0.25;
      for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) {
        const a = A0 + (A1 - A0) * i / N, d = D0 + (D1 - D0) * j / M, x = L0.x + a * L0.ux + d * L0.nx, z = L0.z + a * L0.uz + d * L0.nz, h = world.landRaw(x, z);
        P.push(x, h > 0 ? h + 0.005 : -0.05, z); UV.push(x / 6, z / 6);
        const t = h / L0.h, n = noi(x, z); col.setRGB(0.33 + 0.10 * (1 - t) + n * 0.05, 0.47 + 0.05 * t + n * 0.07, 0.18 - 0.03 * t + n * 0.03); if (L0.patchy) { const m = Math.max(0, Math.min(1, n * 0.7 + 0.55)); col.setRGB(0.5 - 0.12 * m, 0.46 + 0.01 * m, 0.28 - 0.07 * m); } Co.push(col.r, col.g, col.b);
      }
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const q = base + j * (N + 1) + i, r = q + N + 1; Ix.push(q, r, q + 1, q + 1, r, r + 1); }
      base += (N + 1) * (M + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Co, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(Ix); g.computeVertexNormals();
      // short grass is painted on: nothing stands proud of the surface here, so wheels stay on top of the bank (groundY = this mesh)
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: turfTex() })); m.receiveShadow = true; root.add(m);
    }

    // ---------- assemble
    // earth look of the mud lane (83): pale bare patches, gravel and one dark wet rutted patch over the road surface
    { const tx = canvasTex(160, 800, (x, w, h) => { x.clearRect(0, 0, w, h); let q = 19; const r = () => (q = (q * 16807) % 2147483647) / 2147483647, blob = (X, Y, R2, c) => { const g = x.createRadialGradient(X, Y, 0, X, Y, R2); g.addColorStop(0, c); g.addColorStop(1, c.replace(/[0-9.]+\)$/, '0)')); x.fillStyle = g; x.save(); x.translate(X, Y); x.scale(0.6 + r() * 0.6, 1.2); x.translate(-X, -Y); x.fillRect(X - R2, Y - R2, R2 * 2, R2 * 2); x.restore(); };
        for (let i = 0; i < 40; i++) blob(r() * w, r() * h, 25 + r() * 50, `rgba(201,176,142,${0.35 + r() * 0.3})`);
        for (let i = 0; i < 1500; i++) { const g2 = 120 + r() * 90; x.fillStyle = `rgba(${g2},${g2 * 0.86 | 0},${g2 * 0.7 | 0},${0.3 + r() * 0.3})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
        const cy = h * 0.25; if (0) for (let i = 0; i < 46; i++) blob(w * 0.45 + (r() - 0.5) * 62, cy + (r() - 0.5) * 150, 22 + r() * 34, `rgba(38,29,22,${0.5 + r() * 0.35})`);
        x.strokeStyle = 'rgba(16,12,9,0.75)'; for (let i = 0; i < 0; i++) { x.lineWidth = 1 + r() * 4; x.beginPath(); let X = w * 0.45 + (r() - 0.5) * 60, Y = cy + (r() - 0.5) * 130; x.moveTo(X, Y); for (let k = 0; k < 4; k++) { X += (r() - 0.5) * 14; Y += 8 + r() * 24; x.lineTo(X, Y); } x.stroke(); } });
      const a = [50.4, -299.8], b = [52.7, -276.6], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L * 2.15, nz = (b[0] - a[0]) / L * 2.15, y = 0.071, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a[0] + nx, y, a[1] + nz, a[0] - nx, y, a[1] - nz, b[0] + nx, y, b[1] + nz, a[0] - nx, y, a[1] - nz, b[0] - nx, y, b[1] - nz, b[0] + nx, y, b[1] + nz], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], 2)); g.computeVertexNormals();
      root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tx, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5 }))); }

    // tyre ruts on the mud road: two worn tracks with churned edges, following the road
    { const rutTex = canvasTex(64, 512, (x, w, h) => {
        x.clearRect(0, 0, w, h);
        for (const c of [0.3, 0.7]) for (let i = 0; i < 900; i++) { const u = c + (rnd() - 0.5) * 0.17 * (0.6 + rnd()), v = rnd(), e = Math.abs(u - c) / 0.11, a = Math.max(0, 0.2 * (1 - e)) + 0.03; x.fillStyle = e > 0.75 ? `rgba(190,160,120,${a})` : `rgba(58,40,26,${a})`; x.fillRect(u * w - 1, v * h, 1.5 + rnd() * 2, 4 + rnd() * 16); }
      });
      rutTex.wrapT = THREE.RepeatWrapping;
      const P = [], U = [], rib = (a, b, w) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L * w / 2, nz = (b[0] - a[0]) / L * w / 2, v = L / 8, y = 0.064; P.push(a[0] + nx, y, a[1] + nz, a[0] - nx, y, a[1] - nz, b[0] + nx, y, b[1] + nz, a[0] - nx, y, a[1] - nz, b[0] - nx, y, b[1] - nz, b[0] + nx, y, b[1] + nz); U.push(0, 0, 1, 0, 0, v, 1, 0, 1, v, 0, v); };
      rib([50.3, -300.5], [52.1, -283.1], 3.0); rib([52.1, -283.1], [52.87, -275.1], 3.0);   // mud side only, stopping at the breaker
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: rutTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); m.receiveShadow = true; root.add(m); }

    const mesh = B.mesh(); root.add(mesh); root.add(FO.mesh()); root.add(decalMesh()); root.add(stainMesh()); root.add(shrubMesh());
    root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x222222 })));
    const dummy = new THREE.Object3D();
    const inst = (geo, mat, list, set) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { set(p, i); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); }); root.add(m); return m; };
    inst(new THREE.BoxGeometry(0.58, 0.08, 0.75), new THREE.MeshLambertMaterial({ color: 0x77736a }), slabs, p => { dummy.position.set(p.x, 0.06, p.z); dummy.rotation.set(0, p.ang, 0); dummy.scale.set(1, 1, 1); });
    inst(new THREE.BoxGeometry(0.03, 0.01, 3.9), new THREE.MeshBasicMaterial({ color: 0x7f7a70 }), joints, p => { dummy.position.set(p.x, 0.068, p.z); dummy.rotation.set(0, p.ang, 0); dummy.scale.set(1, 1, p.sz); });
    const gt = guardTex(); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(3, 2);
    inst(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 10, 1, true), new THREE.MeshLambertMaterial({ map: gt, alphaTest: 0.4, side: THREE.DoubleSide }), guards, p => { dummy.position.set(p.x, 0.5, p.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(0.7, 0.67, 0.7); });
    
    scene.add(root);
    if (world.sitOnLand) world.sitOnLand(root);
    (window.WALKABLES = window.WALKABLES || []);
    // vehicles parked at y = 0 stand on the rolling land (parked.js places them once; they only move when taken)
    setTimeout(() => { try { for (const v of Player.parkedList) if (v.g && v.g.position.y === 0) v.g.position.y = groundY(v.g.position.x, v.g.position.z); } catch (e) {} }, 1500);
    // loose props dropped in the yard by other modules at y = 0 stand on the raised yard and ramp
    setTimeout(() => { try { for (const o of scene.children) if (o.isGroup && o !== root && o.position.y === 0 && world.yardAt(o.position.x, o.position.z) > 0) o.position.y = groundY(o.position.x, o.position.z); } catch (e) {} }, 2500);

    window.Streetscape = { at, root };
  }

  GameHooks.init.push(game => { try { build(game); } catch (e) { console.error('streetscape build failed', e); } });
})();
