// Indian village traffic models, built procedurally (three.js r128): Bajaj-RE-style auto-rickshaw,
// two-wheelers (Splendor-style commuter, Activa-style scooter, Bullet-style and Jawa-style classics, Duke-style
// naked sport, R15-style fully-faired sport, hardtail mountain bicycle), cars (first-gen Swift-style hatch, Dzire-style
// sedan, Alto-style small hatch, four generic sports cars (mid-engine V8 berlinetta, muscle fastback, wedge supercar,
// rear-engine flat-six coupe), a parkable copy of the real Crysta, Bolero-style utility, classic Scorpio-style SUV, Ace-style mini truck, Innova-style
// MPV, Fortuner-style 4x4 in white or black), 575-style tractor with trolley, 1109-style lorry, Palle-Velugu-style
// village bus and a bullock cart. All generic, unbranded.
//
// Builders: TrafficModels.auto | bike | splendor | scooter | classic | classic2 | sport | faired | cycle | hatch | suv |
//           swift | swiftNew | dzire | alto | wagonR | bolero | scorpio | ace | mpv | innova | fortuner | fortunerBlack | hilux | landCruiser | tharRoxx |
//           thar (3-door convertible) | hector | hayabusa | s1000rr | r1250gsa | r1300gsa | tractor | lorry | bus | bullockCart.
//           bike() is a random mix of the motor two-wheelers (kind stays 'bike'); bike('scooter') forces one type.
//           hatch() is a random swift / alto / dzire, suv() a random bolero / scorpio / ace (kind 'car'; hatch('alto')
//           forces one). TrafficModels.TWO_WHEELERS lists the two-wheeler builder names.
// Each returns v = { g, wheels: [Group], head: [Mesh], tail: [Mesh], len, kind, steer: [Group], userData }.
// Vehicles face +z, sit on y = 0. Wheels spin on local x (w.rotation.x += dist / radius). head/tail meshes share one
// per-vehicle material whose colour the game switches. Geometries are cached; materials are cached by colour.
//
// userData contract (on the returned object v, NOT on v.g, because it holds object references):
//   v.userData.wheels = [{ mesh: Group, radius: metres, front: bool }]  - every wheel; spin mesh.rotation.x.
//                       Tractor: front r 0.38, rear r 0.72 (lugged); trolley/rear wheels front:false.
//   v.userData.steer  = [Group]  - steering pivots; set .rotation.y (radians, + = left) to steer.
//                       Cars/lorries/buses/tractor/auto: one vertical pivot per front wheel (wheel is its child).
//                       Two-wheelers: ONE raked pivot 'fork_0' holding fork legs, bars, headlamp, front guard and
//                       the front wheel (rotation.y turns about the real raked steering axis). Bullock cart: [].
//   v.userData.fork   = the two-wheeler fork pivot (same object as steer[0]) or null.
//   v.userData.dims   = { length, width, height }  - true bounding size (m) of the vehicle, people excluded.
//   v.userData.center = { x, y, z }  - centre of that box in the vehicle frame (models are NOT all centred on 0:
//                       e.g. the tractor+trolley extends far back). Oriented box = position + rot * center, half dims.
//   v.userData.type   = specific model ('splendor', 'scooter', 'classic', 'classic2', 'sport', 'cycle', 'mpv', ...).
//   v.userData.doors = [{ mesh, hingeSide, side, axis, open }], .hood, .boot, .sunroof, .top = same kind of part or null.
//                       Plain data: TrafficModels.setPart(part, t) moves any of them, t 0 = shut, 1 = open.
//   v.userData.twoWheeler = bool; v.userData.seat = [x, y, z, pose] rider seat (two-wheelers, mpv) when known.
// v.g.userData.dims / .center / .type hold plain-number copies (these survive Object3D.clone()).
// Wheel groups are named 'wheel_<i>[_front]', steering pivots 'steer_<i>' / 'fork_0'.
const TrafficModels = (function () {
  const geo = {}, mats = {};
  const G = (key, fn) => geo[key] || (geo[key] = fn());
  const paint = hex => mats['p' + hex] || (mats['p' + hex] = new THREE.MeshPhongMaterial({ color: hex, specular: 0x8a8a8a, shininess: 85 }));
  const M = hex => mats['l' + hex] || (mats['l' + hex] = new THREE.MeshLambertMaterial({ color: hex }));
  const glass = new THREE.MeshPhongMaterial({ color: 0x18222c, specular: 0xb8c8d8, shininess: 120, side: THREE.DoubleSide });
  const chrome = new THREE.MeshPhongMaterial({ color: 0xc8ccd0, specular: 0xffffff, shininess: 120 });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x161616 });
  const plastic = new THREE.MeshLambertMaterial({ color: 0x1e1f22 });
  const plasticIn = new THREE.MeshLambertMaterial({ color: 0x1e1f22, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshPhongMaterial({ color: 0xa9afb5, specular: 0xdddddd, shininess: 70 });
  const lensMat = new THREE.MeshPhongMaterial({ color: 0xe8eef2, specular: 0xffffff, shininess: 150, transparent: true, opacity: 0.35 });
  const amberMat = new THREE.MeshBasicMaterial({ color: 0xd98a10 });

  // ---------------------------------------------------------------- geometry helpers
  // Extrude a side profile drawn in (z, y) across width, centred on x = 0 (same technique as crysta-body.js).
  function sideGeo(key, draw, width, bevel, curve) {
    return G(key, () => {
      const s = new THREE.Shape(); draw(s);
      const b = bevel === undefined ? 0.04 : bevel;
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, width - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: b >= 0.08 ? 2 : 1, curveSegments: curve || 5 });
      g.rotateY(-Math.PI / 2); g.translate((width - 2 * b) / 2, 0, 0); return g;
    });
  }
  // Extrude a face shape drawn in (x, y) along +z, centred on z.
  function faceGeo(key, draw, depth, bevel, curve) {
    return G(key, () => {
      const s = new THREE.Shape(); draw(s); const b = bevel || 0;
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.5, bevelSegments: 1, curveSegments: curve || 1 });
      g.translate(0, 0, -(depth - 2 * b) / 2); return g;
    });
  }
  // Flat shape in the (z, y) side plane, for window glass and decals on vehicle flanks.
  function sideShape(key, pts) {
    return G(key, () => { const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])))); g.rotateY(-Math.PI / 2); return g; });
  }

  // ---------------------------------------------------------------- rounded bodies (the fix for "everything is boxy")
  // ROOT CAUSE: every car body was a 2D side silhouette extruded straight across the width (ExtrudeGeometry):
  // that makes a slab whose cross-section is a RECTANGLE everywhere - flat vertical sides, a dead-flat roof and
  // bonnet, 90 degree shoulders softened only by a 4-8 cm bevel, square corners in plan view and flat side glass.
  // loftGeo() keeps the same side silhouettes as data but sweeps a ROUNDED section along the length instead:
  //  - every station's section spans the silhouette's bottom..top at that z, as a rounded rectangle with its own
  //    bottom radius (rocker / arch lip) and top radius (shoulder / roof edge),
  //  - crowned top (sides drop by `crown`; a negative crown raises the fenders above the bonnet, 911 / F8 style),
  //  - side bulge (body sides fall in towards sill and shoulder), tumblehome (`lean`: the greenhouse leans inwards
  //    above `leanY`), plan-view rounding of the nose and tail corners (`plan` radius) and an optional plan
  //    taper `hwz(z)` (narrow nose, wide hips), smooth computed normals.
  // The arches stay real cut-outs (the section bottom follows the arch), and the rounded bottom edge gives the lip.
  const LOFT_DEF = { rt: 0.1, rb: 0.07, plan: 0.24, crown: 0.035, bulge: 0.035, lean: 0, leanY: 0, drop: 0, step: 0.11, curve: 8, hwz: null };
  function loftGeo(key, draw, width, opt) {
    return G('loft' + key, () => {
      const o = Object.assign({}, LOFT_DEF, opt || {});
      const s = new THREE.Shape(); draw(s);
      const P = s.getPoints(o.curve); if (P.length > 2 && P[0].distanceTo(P[P.length - 1]) < 1e-6) P.pop();
      const n = P.length; let z0 = Infinity, z1 = -Infinity;
      for (const p of P) { z0 = Math.min(z0, p.x); z1 = Math.max(z1, p.x); }
      const span = z => {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n; i++) {
          const a = P[i], b = P[(i + 1) % n];
          if ((a.x - z) * (b.x - z) > 0) continue;
          if (Math.abs(b.x - a.x) < 1e-9) { lo = Math.min(lo, a.y, b.y); hi = Math.max(hi, a.y, b.y); continue; }
          const y = a.y + (z - a.x) / (b.x - a.x) * (b.y - a.y); lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
        return lo <= hi ? [lo, hi] : [0, 0];
      };
      const e = Math.min(0.004, (z1 - z0) * 0.01), pr = Math.min(o.plan, (z1 - z0) * 0.45);
      let zs = P.map(p => p.x);
      for (let z = z0; z < z1; z += o.step) zs.push(z);
      for (let i = 1; i <= 5; i++) { const d = pr * (1 - Math.cos(i / 5 * Math.PI / 2)); zs.push(z0 + d, z1 - d); }
      zs = zs.map(z => Math.min(z1 - e, Math.max(z0 + e, z))).sort((a, b) => a - b);
      const Z = [];
      for (const z of zs) if (!Z.length || z - Z[Z.length - 1] > 0.018) Z.push(z);
      if (z1 - e - Z[Z.length - 1] > 0.005) Z.push(z1 - e); else Z[Z.length - 1] = z1 - e;
      const hw0 = width / 2;
      const ring = z => {
        let [lo, hi] = span(z); lo -= o.drop;
        const d = Math.min(z - z0, z1 - z);
        let hw = hw0 * (o.hwz ? o.hwz(z) : 1);
        if (d < pr) hw -= pr - Math.sqrt(Math.max(0, pr * pr - (pr - d) * (pr - d)));
        const h = Math.max(hi - lo, 1e-4), rb = Math.min(o.rb, h * 0.45, hw * 0.8), rt = Math.min(o.rt, h * 0.45, hw * 0.8);
        const half = [[0, lo], [(hw - rb) * 0.5, lo]];
        for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + i / 3 * Math.PI / 2; half.push([hw - rb + Math.cos(a) * rb, lo + rb + Math.sin(a) * rb]); }
        for (let i = 1; i <= 2; i++) half.push([hw, lo + rb + (h - rb - rt) * i / 3]);
        for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; half.push([hw - rt + Math.cos(a) * rt, hi - rt + Math.sin(a) * rt]); }
        half.push([(hw - rt) * 0.5, hi], [0, hi]);
        const mid = (lo + hi) / 2;
        const out = half.map(([x, y], i) => {
          const t = (y - mid) / (h / 2);
          x *= 1 - o.bulge * t * t;
          y -= o.crown * (x / hw0) * (x / hw0) * Math.max(0, (y - lo) / h);
          if (o.lean) x -= Math.max(0, y - o.leanY) * o.lean;
          return [i === 0 || i === half.length - 1 ? 0 : Math.max(0.001, x), y];
        });
        const full = out.slice();
        for (let i = out.length - 2; i >= 1; i--) full.push([-out[i][0], out[i][1]]);
        return full;
      };
      const pos = [], idx = [];
      let m = 0;
      Z.forEach(z => { const r = ring(z); m = r.length; for (const [x, y] of r) pos.push(x, y, z); });
      for (let i = 0; i < Z.length - 1; i++) for (let j = 0; j < m; j++) {
        const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + (j + 1) % m, d = (i + 1) * m + j;
        idx.push(a, b, c, a, c, d);
      }
      // end caps (own vertices so the rim stays crisp)
      for (const [si, dir] of [[0, -1], [Z.length - 1, 1]]) {
        const base = pos.length / 3; let cx = 0, cy = 0;
        for (let j = 0; j < m; j++) { const q = (si * m + j) * 3; pos.push(pos[q], pos[q + 1], pos[q + 2]); cx += pos[q]; cy += pos[q + 1]; }
        pos.push(cx / m, cy / m, Z[si]);
        for (let j = 0; j < m; j++) { const a = base + j, b = base + (j + 1) % m; if (dir > 0) idx.push(base + m, a, b); else idx.push(base + m, b, a); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    });
  }
  // tumblehome: the glass / roof lofts lean in above the belt, and pillar trims / seals that sit on the glass
  // (thin side meshes above the belt) are rotated with it when the vehicle is baked
  let pendingLean = null;
  const LEAN = { hatch: 0.14, suv: 0.1, box: 0.06, sports: 0.3 };
  const leanOf = key => /^(bol|ace)/.test(key) ? LEAN.box : /^(scp|f[A-Z]|mpv)/.test(key) ? LEAN.suv : LEAN.hatch;
  function shapeMinY(draw) { const s = new THREE.Shape(); draw(s); return Math.min(...s.getPoints(4).map(p => p.y)); }
  function loftOpts(key, draw, width) {
    if (/(Gl|Glass)$/.test(key)) {
      const y = shapeMinY(draw), lean = leanOf(key);
      pendingLean = { y, hx: width / 2, lean };
      return { rt: 0.045, rb: 0.01, plan: 0.14, crown: 0.012, bulge: 0, lean, leanY: y, drop: 0.035, step: 0.12 };
    }
    if (/Roof$/.test(key)) return { rt: 0.07, rb: 0.012, plan: 0.16, crown: 0.03, bulge: 0, lean: pendingLean ? pendingLean.lean : leanOf(key), leanY: pendingLean ? pendingLean.y : 1, step: 0.12 };
    if (/(Low|Cab)$/.test(key)) {
      if (/^(bol|ace)/.test(key)) return { rt: 0.07, rb: 0.05, plan: 0.13, crown: 0.02, bulge: 0.02, step: 0.11 };
      if (/^(scp|f[A-Z])/.test(key)) return { rt: 0.1, rb: 0.07, plan: 0.2, crown: 0.03, bulge: 0.03, step: 0.11 };
      return { rt: 0.13, rb: 0.08, plan: 0.2, crown: 0.04, bulge: 0.045, step: 0.1 };
    }
    return { rt: 0.04, rb: 0.02, plan: 0.06, crown: 0.01, bulge: 0, step: 0.1 };
  }
  // rotate the thin side trims above the belt (pillars, seals, C-pillar panels) with the glass tumblehome
  const _lm = new THREE.Matrix4(), _lt = new THREE.Matrix4(), _lb = new THREE.Box3(), _lc = new THREE.Vector3();
  function applyLean(g, L) {
    const a = Math.atan(L.lean);
    for (const o of g.children.slice()) {
      if (!o.isMesh || o.userData.noLean) continue;
      o.updateMatrix(); if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _lb.copy(o.geometry.boundingBox).applyMatrix4(o.matrix); _lb.getCenter(_lc);
      if (_lb.min.y < L.y - 0.08 || Math.abs(_lc.x) < L.hx - 0.07 || _lb.max.x - _lb.min.x > 0.16) continue;
      const sx = Math.sign(_lc.x);
      _lm.makeTranslation(sx * L.hx, L.y, 0).multiply(_lt.makeRotationZ(sx * a)).multiply(new THREE.Matrix4().makeTranslation(-sx * L.hx, -L.y, 0));
      o.applyMatrix4(_lm);
    }
  }
  // ---------------------------------------------------------------- alloy wheels: per-model spoke designs
  // spec: n spokes, twin (angular offset of a spoke pair), y (Y-split spokes), wIn / wOut (spoke width at hub / rim),
  // t (thickness), dish (how far the hub sits recessed behind the rim lip: concave face), hubR, mat, win (dark
  // window colour behind the spokes), lip (machined lip material), nuts
  function spokeGeo(rimR, sp, side) {
    return G(['spk2', rimR, sp.wIn, sp.wOut, sp.t, sp.dish, sp.hubR, sp.bend || 0, side].join(), () => {
      const r0 = sp.hubR * 0.8, r1 = rimR * 0.97, s = new THREE.Shape();
      s.moveTo(-sp.wIn / 2, r0); s.lineTo(sp.wIn / 2, r0);
      s.quadraticCurveTo(sp.wOut * 0.5 + (sp.bend || 0), (r0 + r1) / 2, sp.wOut / 2, r1); s.lineTo(-sp.wOut / 2, r1);
      s.quadraticCurveTo(-sp.wOut * 0.5 + (sp.bend || 0), (r0 + r1) / 2, -sp.wIn / 2, r0);
      const g = new THREE.ExtrudeGeometry(s, { depth: sp.t, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 3 });
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const u = P.getX(i), v = P.getY(i), w = P.getZ(i), f = 1 - Math.min(1, Math.max(0, (v - r0) / (r1 - r0)));
        P.setXYZ(i, side * (w - sp.t - sp.dish * f * f), v, u);      // spoke face toward +x*side, hub recessed (dish)
      }
      if (side > 0) for (let i = 0; i < P.count; i += 3) {          // the u/w swap mirrors: restore winding
        const x = P.getX(i + 1), y = P.getY(i + 1), z = P.getZ(i + 1);
        P.setXYZ(i + 1, P.getX(i + 2), P.getY(i + 2), P.getZ(i + 2)); P.setXYZ(i + 2, x, y, z);
      }
      g.deleteAttribute('normal'); g.computeVertexNormals(); return g;
    });
  }
  function alloyFace(k, F, wg, rimR, Wd, side, sp) {
    sp = Object.assign({ n: 5, twin: 0, y: false, wIn: 0.045, wOut: 0.03, t: 0.022, dish: 0.02, hubR: 0.075, nuts: 5 }, sp);
    const mat = sp.mat || F.alloy, face = side * Wd * 0.4;
    const win = k.add(G('awWin' + rimR, () => new THREE.CircleGeometry(rimR * 0.97, 20)), sp.win || F.gun, face - side * (sp.dish + 0.05), 0, 0, wg); win.rotation.y = side * Math.PI / 2;
    const lip = k.add(tor(rimR, 0.012, 5, 28), sp.lip || F.alloy, face, 0, 0, wg); lip.rotation.y = Math.PI / 2;
    const geo = spokeGeo(rimR, sp, side);
    const angs = [];
    for (let i = 0; i < sp.n; i++) {
      const a = i / sp.n * Math.PI * 2;
      if (sp.twin) angs.push(a - sp.twin / 2, a + sp.twin / 2); else angs.push(a);
    }
    for (const a of angs) {
      if (sp.y) {          // Y spoke: a stem that forks into two arms
        const st = new THREE.Mesh(spokeGeo(rimR * 0.62, Object.assign({}, sp, { dish: sp.dish * 0.6 }), side), mat); st.position.x = face; st.rotation.x = a; wg.add(st);
        for (const off of [-0.2, 0.2]) { const arm = new THREE.Mesh(geo, mat); arm.position.x = face; arm.rotation.x = a + off; arm.scale.set(1, 1, 0.75); wg.add(arm); }
      } else { const m = new THREE.Mesh(geo, mat); m.position.x = face; m.rotation.x = a; m.castShadow = true; wg.add(m); }
    }
    const hub = k.add(cyl(sp.hubR, sp.hubR * 1.08, 0.04, 18), mat, face - side * (sp.dish + 0.01), 0, 0, wg); hub.rotation.z = Math.PI / 2;
    const cap = k.add(cyl(sp.hubR * 0.5, sp.hubR * 0.5, 0.012, 16), sp.cap || F.black, face - side * (sp.dish - 0.012), 0, 0, wg); cap.rotation.z = Math.PI / 2;
    for (let i = 0; i < sp.nuts; i++) { const a = i / sp.nuts * Math.PI * 2 + 0.3, nt = k.add(cyl(0.009, 0.009, 0.02, 6), F.chrome, face - side * (sp.dish - 0.006), Math.sin(a) * sp.hubR * 0.72, Math.cos(a) * sp.hubR * 0.72, wg); nt.rotation.z = Math.PI / 2; }
  }
  const PI05 = Math.PI / 2;
  const WHEELS = {
    swift:   { n: 8, wIn: 0.026, wOut: 0.022, dish: 0.012, hubR: 0.07 },                           // 8 slim straight spokes
    dzire:   { n: 5, twin: 0.3, wIn: 0.024, wOut: 0.02, dish: 0.018, hubR: 0.07 },                // 5 split twin spokes
    scorpio: { n: 6, wIn: 0.06, wOut: 0.075, dish: 0.035, hubR: 0.085, nuts: 6 },                 // 6 broad dished spokes
    mpv:     { n: 10, wIn: 0.022, wOut: 0.026, dish: 0.022, hubR: 0.08 },                          // 10 thin spokes
    fortuner:{ n: 6, y: true, wIn: 0.03, wOut: 0.024, dish: 0.04, hubR: 0.09, nuts: 6, twoTone: true },   // 6 Y-split, gunmetal windows
    berlinetta: { n: 5, wIn: 0.06, wOut: 0.032, dish: 0.055, hubR: 0.07, bend: 0.012 },            // 5-arm star, deep concave
    muscle:  { n: 10, wIn: 0.02, wOut: 0.028, dish: 0.03, hubR: 0.085 },                           // 10 straight spokes
    wedge:   { n: 5, y: true, wIn: 0.034, wOut: 0.026, dish: 0.04, hubR: 0.07, dark: true },     // 5 Y spokes, dark finish
    wagonR:  { n: 8, twin: 0.2, wIn: 0.02, wOut: 0.018, dish: 0.014, hubR: 0.065, nuts: 4 },       // 8 twin-line black-and-silver
    landCruiser: { n: 6, wIn: 0.05, wOut: 0.05, dish: 0.045, hubR: 0.1, nuts: 6, twoTone: true },   // 6 broad machined spokes
    hilux:   { n: 6, twin: 0.24, wIn: 0.03, wOut: 0.028, dish: 0.045, hubR: 0.095, nuts: 6, twoTone: true },   // 6 twin spokes, machined faces over dark windows
    defender:{ n: 5, twin: 0.3, wIn: 0.05, wOut: 0.04, dish: 0.05, hubR: 0.1, nuts: 6, dark: true },   // 5 twin spokes, gloss dark
    gclass:  { n: 5, wIn: 0.06, wOut: 0.07, dish: 0.05, hubR: 0.095, nuts: 5, twoTone: true },        // 5 broad machined spokes
    tharRoxx:{ n: 5, y: true, wIn: 0.045, wOut: 0.036, dish: 0.05, hubR: 0.095, nuts: 6, dark: true },   // dark 5 Y spokes
    swiftNew:{ n: 5, twin: 0.34, wIn: 0.03, wOut: 0.022, dish: 0.024, hubR: 0.07, dark: true },    // 5 twin spokes, dark machined
    safari:  { n: 7, wIn: 0.05, wOut: 0.06, dish: 0.04, hubR: 0.09, nuts: 6 },                    // 7 broad spokes
    scorpioN:{ n: 5, y: true, wIn: 0.04, wOut: 0.03, dish: 0.04, hubR: 0.09, nuts: 6, twoTone: true },   // 5 diamond-cut Y spokes
    hector:  { n: 5, twin: 0.26, wIn: 0.04, wOut: 0.032, dish: 0.03, hubR: 0.08, nuts: 5, twoTone: true },   // 5 split spokes, machined faces on black
    coupe911:{ n: 5, wIn: 0.085, wOut: 0.11, dish: 0.03, hubR: 0.075, t: 0.03, twoTone: true },  // 5 forged petals
  };
  const roundRect = (s, w, h, r) => { s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); };
  const rbox = (w, h, d, r) => faceGeo(['rb', w, h, d, r].join(), s => roundRect(s, w, h, Math.min(r, w / 2 - 0.001, h / 2 - 0.001)), d, Math.min(r, d / 3) * 0.6);
  // Tyre cross-section revolved about the axle (x).
  function tyreGeo(r, w, lowProfile) {
    return G(['ty', r, w, lowProfile].join(), () => {
      const ri = r * (lowProfile ? 0.68 : 0.58), hw = w / 2, pts = [];
      pts.push([ri, -hw * 0.85], [ri + (r - ri) * 0.3, -hw], [r, -hw * 0.6], [r, hw * 0.6], [ri + (r - ri) * 0.3, hw], [ri, hw * 0.85]);
      const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 12); g.rotateZ(Math.PI / 2); return g;
    });
  }
  // Pressed steel / alloy rim: dished disc with a hub, revolved about x.
  function rimGeo(r, w) {
    return G(['rim', r, w].join(), () => {
      const pts = [[0.001, w * 0.5], [r * 0.25, w * 0.45], [r * 0.4, w * 0.3], [r * 0.9, w * 0.4], [r, w * 0.3], [r, -w * 0.3]];
      const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 10); g.rotateZ(-Math.PI / 2); return g;
    });
  }
  const cyl = (rt, rb, h, seg, open) => G(['cy', rt, rb, h, seg, open].join(), () => new THREE.CylinderGeometry(rt, rb, h, seg || 10, 1, !!open));
  const sph = (r, ws, hs) => G(['sp', r, ws, hs].join(), () => new THREE.SphereGeometry(r, ws || 8, hs || 6));
  const tor = (r, t, rs, ts, arc) => G(['to', r, t, rs, ts, arc].join(), () => new THREE.TorusGeometry(r, t, rs, ts, arc));

  function kit() {
    const g = new THREE.Group(), wheels = [], head = [], tail = [], steer = [];
    const headM = new THREE.MeshBasicMaterial({ color: 0x777766 }), tailM = new THREE.MeshBasicMaterial({ color: 0x661111 });
    const add = (geom, m, x, y, z, parent) => { const o = new THREE.Mesh(geom, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || g).add(o); return o; };
    // wheel: lathe tyre + dished rim; a spoke bar keeps rotation visible on plain rims
    const wheel = (r, w, x, y, z, opts) => {
      opts = opts || {};
      const wg = new THREE.Group(); wg.position.set(x, y, z); wg.userData.radius = r; wg.name = 'wheel';
      add(tyreGeo(r, w, opts.low), rubber, 0, 0, 0, wg);
      const side = Math.sign(x) || 1;
      const rim = add(rimGeo(r * (opts.low ? 0.66 : 0.56), w * 0.9), opts.rim || rimMat, 0, 0, 0, wg); rim.scale.x = side;
      if (!opts.noSpoke) for (let i = 0; i < (opts.spokes || 4); i++) {
        const sp = opts.thin ? add(G('spkT', () => new THREE.BoxGeometry(0.008, 1, 0.008)), opts.spokeMat || opts.rim || rimMat, 0, 0, 0, wg)
                             : add(G('spk', () => new THREE.BoxGeometry(0.02, 1, 0.05)), opts.rim || rimMat, side * w * 0.42, 0, 0, wg);
        sp.scale.y = opts.thin ? r * 1.9 : r * (opts.low ? 1.2 : 1.0); sp.rotation.x = i * Math.PI / (opts.spokes || 4);
      }
      g.add(wg); wheels.push(wg); return wg;
    };
    // lamp: shaped lens (rounded rectangle or circle) facing +z (front) or -z (rear)
    const lamp = (w, h, x, y, z, front, round) => {
      const key = round ? ['lc', w].join() : ['lr', w, h].join();
      const geom = G(key, () => round ? new THREE.CircleGeometry(w / 2, 14) : new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); roundRect(s, w, h, Math.min(w, h) * 0.3); return s; })(), 4));
      const m = add(geom, front ? headM : tailM, x, y, z); if (!front) m.rotation.y = Math.PI;
      const lens = add(G(key + 'L', () => { const gg = geom.clone(); return gg; }), lensMat, x, y, z + (front ? 0.008 : -0.008)); lens.rotation.y = m.rotation.y; lens.castShadow = false;
      (front ? head : tail).push(m); m.castShadow = false; m.lens = lens; return m;
    };
    g._parts = { doors: [], hood: null, boot: null, sunroof: null, top: null };
    return { g, wheels, head, tail, steer, add, wheel, lamp, headM, tailM, parts: g._parts, grabbed: new Set(), apertures: [] };
  }
  let plateText = null;   // set while building a car with a fixed registration (the player's)
  function plate(k, z, y, front, x) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32; const t = c.getContext('2d');
    t.fillStyle = front || plateText ? '#fff' : '#ffd400'; t.fillRect(0, 0, 128, 32); t.strokeStyle = '#222'; t.lineWidth = 2; t.strokeRect(2, 2, 124, 28);
    t.fillStyle = '#111'; t.font = 'bold 17px sans-serif'; t.textAlign = 'center';
    t.fillText(plateText || ('TS 27 ' + String.fromCharCode(65 + Math.random() * 26 | 0, 65 + Math.random() * 26 | 0) + ' ' + (1000 + Math.random() * 8999 | 0)), 64, 23);
    const m = new THREE.Mesh(G('plate', () => new THREE.PlaneGeometry(0.42, 0.11)), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
    m.position.set(x || 0, y, z); if (!front) m.rotation.y = Math.PI; k.g.add(m); return m;
  }
  const texCache = {};
  function canvasTex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return (texCache[key] = t);
  }
  const grilleTex = canvasTex('grille', 64, 32, (x, w, h) => { x.fillStyle = '#121314'; x.fillRect(0, 0, w, h); x.fillStyle = '#3a3d40'; for (let i = 3; i < h; i += 6) x.fillRect(2, i, w - 4, 2); });
  const grilleMat = new THREE.MeshPhongMaterial({ map: grilleTex, shininess: 40 });
  const badgeMat = chrome;
  // how far a seated figure must drop so its head (hat included) stays under the roof at seat (x, z); 0 when it fits or there is no roof
  const _hb = new THREE.Box3(), _hr = new THREE.Raycaster(), _ho = new THREE.Vector3(), _hd = new THREE.Vector3(), _hq = new THREE.Quaternion();
  function headLift(g, human, x, z) {
    g.updateMatrixWorld(true);
    const hide = m => { for (let q = m; q; q = q.parent) { if (q.userData && q.userData.human) return true; if (!q.visible) return true; if (q === g) break; } return false; }, list = [];
    g.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !hide(o)) list.push(o); });
    g.localToWorld(_ho.set(x, 6, z)); g.getWorldQuaternion(_hq); _hr.set(_ho, _hd.set(0, -1, 0).applyQuaternion(_hq)); _hr.far = 7;
    const hit = _hr.intersectObjects(list, false)[0]; if (!hit) return 0;
    const roof = 6 - hit.distance, wasV = human.visible; human.visible = true; _hb.setFromObject(human); human.visible = wasV;
    const top = _hb.max.y - g.getWorldPosition(_ho).y; return Math.min(0, roof - 0.05 - top);
  }
  // seated person; returns the human so callers can tweak
  function person(k, x, y, z, opts, pose) {
    if (typeof HumanModel === 'undefined') return null;
    const h = HumanModel.create(Object.assign({ lod: 'low' }, opts));
    HumanModel.sit(h.parts, pose || 'car');
    h.group.position.set(x, y - h.hipHeight, z); k.g.add(h.group); return h;
  }
  // mirrors on stalks
  function mirrors(k, xs, y, z, m) {
    const out = [];
    for (const x of xs) {
      const st = k.add(cyl(0.012, 0.012, 0.18, 5), plastic, x, y, z); st.rotation.z = Math.sign(x) * 1.0;
      const hd = k.add(rbox(0.16, 0.1, 0.05, 0.03), m || plastic, x + Math.sign(x) * 0.09, y + 0.06, z); hd.rotation.y = -Math.sign(x) * 0.2;
      out.push(st, hd);
    }
    return out;
  }

  // ---------------------------------------------------------------- auto-rickshaw (Bajaj RE style, 2.63 x 1.30 x 1.70)
  function auto() {
    const k = kit(), yellow = paint(0xf2c200), green = paint(0x1f7a3a), canvas = M(0x1b1b1b);
    // passenger tub: low side profile with rear wheel arch
    k.add(sideGeo('autoTub', s => {
      s.moveTo(-1.25, 0.32); s.lineTo(-1.2, 0.3); s.lineTo(-0.88, 0.3); s.absarc(-0.62, 0.3, 0.26, Math.PI, 0, true); s.lineTo(0.15, 0.3);
      s.lineTo(0.45, 0.35); s.lineTo(0.45, 0.62); s.lineTo(0.05, 0.62); s.lineTo(-0.15, 1.02); s.lineTo(-1.18, 1.02); s.quadraticCurveTo(-1.3, 1.0, -1.3, 0.85); s.lineTo(-1.28, 0.4);
    }, 1.3, 0.05), yellow);
    // front cowl: curved nose sweeping down to the front wheel
    k.add(sideGeo('autoCowl', s => {
      s.moveTo(0.4, 0.62); s.lineTo(0.4, 1.12); s.quadraticCurveTo(0.95, 1.16, 1.14, 0.95); s.quadraticCurveTo(1.27, 0.75, 1.22, 0.58); s.lineTo(0.9, 0.5); s.quadraticCurveTo(0.6, 0.48, 0.4, 0.62);
    }, 0.92, 0.12, 10), green);
    k.add(sideGeo('autoFloor', s => { s.moveTo(0.42, 0.35); s.lineTo(0.42, 0.42); s.lineTo(-0.2, 0.42); s.lineTo(-0.2, 0.35); }, 1.2, 0.02), M(0x222222));
    // canvas hood: arched shell (cross-section in x/y) extruded front to back
    k.add(G('autoHood', () => {
      const s = new THREE.Shape(), ro = 0.68, ri = 0.64, h = 0.28;
      s.moveTo(-ro, 0); s.lineTo(-ro, h); s.quadraticCurveTo(-ro, h + 0.24, 0, h + 0.26); s.quadraticCurveTo(ro, h + 0.24, ro, h); s.lineTo(ro, 0);
      s.lineTo(ri, 0); s.lineTo(ri, h); s.quadraticCurveTo(ri, h + 0.2, 0, h + 0.22); s.quadraticCurveTo(-ri, h + 0.2, -ri, h); s.lineTo(-ri, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 1.75, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2, curveSegments: 6 });
      g.translate(0, 0, -1.23); return g;
    }), canvas, 0, 1.4, 0);
    // rear canvas back panel and side curtains behind the passenger seat
    k.add(G('autoBack', () => new THREE.PlaneGeometry(1.3, 0.62)), M(0x222222), 0, 1.72, -1.25).material = M(0x222222);
    for (const sx of [-1, 1]) {
      const sc = k.add(sideShape('autoCurt', [[-1.25, 1.02], [-1.25, 1.68], [-0.6, 1.68], [-0.5, 1.02]]), new THREE.MeshLambertMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide }), sx * 0.67, 0, 0);
      const post = k.add(cyl(0.018, 0.018, 0.75, 6), chrome, sx * 0.62, 1.35, 0.45);
      const post2 = k.add(cyl(0.018, 0.018, 0.75, 6), chrome, sx * 0.62, 1.35, -0.2);
    }
    // windscreen and wiper
    const ws = k.add(G('autoWS', () => new THREE.PlaneGeometry(1.0, 0.48)), glass, 0, 1.6, 0.47); ws.rotation.x = -0.12;
    const wp = k.add(G('autoWiper', () => new THREE.BoxGeometry(0.4, 0.015, 0.015)), plastic, 0.1, 1.42, 0.5); wp.rotation.z = 0.5;
    // fork, mudguard, handlebar
    const fork = k.add(cyl(0.025, 0.025, 0.8, 6), chrome, 0, 0.7, 1.12); fork.rotation.x = -0.2;
    const mg = k.add(tor(0.3, 0.06, 4, 10, Math.PI * 0.9), green, 0, 0.26, 1.12); mg.rotation.y = Math.PI / 2; mg.scale.set(1, 1, 1.4);
    const bar = k.add(cyl(0.016, 0.016, 0.62, 6), chrome, 0, 1.18, 0.4); bar.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) k.add(cyl(0.025, 0.025, 0.1, 6), plastic, sx * 0.33, 1.18, 0.4).rotation.z = Math.PI / 2;
    mirrors(k, [-0.5, 0.5], 1.32, 0.62);
    k.wheel(0.26, 0.12, 0.001, 0.26, 1.12, { low: false }); k.wheel(0.26, 0.13, -0.6, 0.26, -0.62); k.wheel(0.26, 0.13, 0.6, 0.26, -0.62);
    k.lamp(0.16, 0.16, 0, 1.0, 1.25, true, true);
    for (const sx of [-1, 1]) { k.add(sph(0.035, 6, 4), amberMat, sx * 0.4, 1.32, 1.06); k.lamp(0.12, 0.08, sx * 0.55, 0.72, -1.31); }
    plate(k, -1.31, 0.52, false);
    const sign = canvasTex('autoSign', 128, 32, (s) => { s.fillStyle = '#111'; s.fillRect(0, 0, 128, 32); s.fillStyle = '#ffd400'; s.font = 'bold 15px sans-serif'; s.textAlign = 'center'; s.fillText('JAI SRI RAM', 64, 22); });
    const sm = k.add(G('autoSignG', () => new THREE.PlaneGeometry(0.9, 0.22)), new THREE.MeshBasicMaterial({ map: sign }), 0, 1.25, -1.3); sm.rotation.y = Math.PI;
    // driver on the front bench, two seats of passengers at the back
    k.add(rbox(0.5, 0.1, 0.4, 0.04), M(0x2b2b2b), 0, 0.82, 0.12);
    k.add(rbox(1.15, 0.12, 0.5, 0.05), M(0x2b2b2b), 0, 0.8, -0.85);
    person(k, 0, 0.9, 0.08, { outfit: Math.random() < 0.5 ? 'shirt' : 'lungi', color: 0x8fa9c4 }, 'car');
    if (Math.random() < 0.5) { const p = person(k, -0.3, 0.88, -0.85, { gender: 'f', outfit: Math.random() < 0.5 ? 'saree' : 'salwar' }, 'bench'); }
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 2.8, kind: 'auto' };
  }

  // ---------------------------------------------------------------- two-wheeler helpers
  const _up = new THREE.Vector3(0, 1, 0);
  // straight tube between two points a, b = [x, y, z]
  function tube(k, a, b, r, m, parent) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    const o = k.add(cyl(r, r, 1, 6), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, parent);
    o.scale.y = L; o.quaternion.setFromUnitVectors(_up, d.normalize()); return o;
  }
  // Steering head pivot of a two-wheeler: a group at the steering head (y, z), tilted back by `rake` so that
  // rotation.y turns the bars, fork and front wheel together about the real (raked) steering axis.
  function forkPivot(k, hy, hz, rake, parts) {
    const p = new THREE.Group(); p.name = 'fork'; p.position.set(0, hy, hz); p.rotation.x = -rake; k.g.add(p);
    k.g.updateMatrixWorld(true);
    for (const o of parts) if (o) p.attach(o);
    k.steer.push(p); return p;
  }
  const lampParts = m => [m, m.lens];
  // rider astride (helmet sometimes), maybe a pillion
  function riders(k, y, z, pz, helmetP, pillionP) {
    const r = person(k, 0, y, z, { outfit: Math.random() < 0.7 ? 'shirt' : 'lungi', color: [0xffffff, 0x8fa9c4, 0x2e4a7a, 0xb0a080][Math.random() * 4 | 0] }, 'bike');
    if (r && Math.random() < helmetP) { const hl = new THREE.Mesh(sph(0.13, 10, 8), paint([0x222222, 0xb71c1c, 0xf5f5f5, 0x1565c0][Math.random() * 4 | 0])); hl.position.set(0, 0.1, 0); hl.scale.set(0.92, 0.95, 1.05); r.parts.head.add(hl); }
    if (pz != null && Math.random() < pillionP) person(k, 0, y + 0.04, pz, Math.random() < 0.5 ? { gender: 'f', outfit: Math.random() < 0.5 ? 'saree' : 'salwar' } : { outfit: 'shirt' }, 'bike');
  }
  // front / rear mudguard arcs over a wheel at (y = r, z)
  function guard(k, r, z, m, arc, tilt, fat) {
    const o = k.add(tor(r + 0.03, 0.035 * (fat || 1), 3, 12, Math.PI * arc), m, 0, r, z); o.rotation.y = Math.PI / 2; o.rotation.z = Math.PI * tilt; o.scale.z = 1.6 * (fat || 1); return o;
  }
  const two = (k, len, kind, type, seat, extra) => Object.assign({ g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, steer: k.steer, len, kind, type, seat, twoWheeler: true }, extra || {});

  // two-wheeler wheel: round-section tyre (torus), rim, hub. o.style 'spoke' (wire spokes + drum hub) or 'alloy'
  // (o.n cast spokes in o.rim colour); o.disc = brake disc radius on side o.discX.
  function bikeWheel(k, R, tw, z, o) {
    o = o || {};
    const wg = new THREE.Group(); wg.position.set(0, R, z); wg.userData.radius = R; wg.name = 'wheel';
    const spoke = o.style === 'spoke';
    const ty = k.add(tor(R - tw / 2, tw / 2, 8, 30), rubber, 0, 0, 0, wg); ty.rotation.y = Math.PI / 2;
    const rr = R - tw * 0.9;
    const rim = k.add(tor(rr, spoke ? 0.013 : 0.016, 4, 30), spoke ? chrome : (o.rim || chrome), 0, 0, 0, wg); rim.rotation.y = Math.PI / 2; rim.scale.z = spoke ? 2.2 : 2.6;
    const hubR = spoke ? (o.hubR || 0.065) : 0.045;
    const hub = k.add(cyl(hubR, hubR, spoke ? 0.12 : 0.09, 12), o.hub || M(0xb4b8bc), 0, 0, 0, wg); hub.rotation.z = Math.PI / 2;
    if (spoke) {
      const n = o.n || 18, sg = G('bspk' + rr, () => new THREE.BoxGeometry(0.005, rr * 2, 0.005));
      for (let i = 0; i < n; i++) { const s = k.add(sg, chrome, (i % 2 ? 1 : -1) * 0.03, 0, 0, wg); s.rotation.x = i / n * Math.PI + (i % 2 ? 0.07 : -0.07); }
    } else {
      const n = o.n || 5, sg = G('bAl' + rr, () => { const g = new THREE.BoxGeometry(0.02, rr - hubR, 0.034); g.translate(0, hubR + (rr - hubR) / 2, 0); return g; });
      for (let i = 0; i < n; i++) for (const off of o.split ? [-0.09, 0.09] : [0]) { const s = k.add(sg, o.rim || chrome, 0, 0, 0, wg); s.rotation.x = i / n * Math.PI * 2 + off; }
    }
    if (o.disc) { const d = k.add(cyl(o.disc, o.disc, 0.006, 20), M(0x8c9196), o.discX || 0.06, 0, 0, wg); d.rotation.z = Math.PI / 2;
      const cal = k.add(rbox(0.03, 0.08, 0.06, 0.012), M(0x2a2a2a), (o.discX || 0.06) + Math.sign(o.discX || 1) * 0.012, o.disc * 0.75, -o.disc * 0.35);  wg.add(cal); }
    k.g.add(wg); k.wheels.push(wg); return wg;
  }
  const chainLoop = (k, key, zf, zr, R, x) => k.add(sideGeo(key, s => {
    s.moveTo(zf, 0.48); s.lineTo(zr, R + 0.09); s.quadraticCurveTo(zr - 0.11, R, zr, R - 0.09); s.lineTo(zf, 0.36); s.quadraticCurveTo(zf + 0.07, 0.42, zf, 0.48);
  }, 0.025, 0.006), M(0x2a2a2a), x, 0, 0);

  // ---------------------------------------------------------------- commuter motorbike (Splendor style, 1.97 x 0.72 x 1.07)
  // Black (sometimes grey / red / blue) with bright tank and side-panel stripes, wire-spoked 18" wheels on thin tyres,
  // rounded tank, long flat seat, fully enclosed chain case, fork covers, small headlamp cowl, long chrome silencer
  // with a black heat shield, saree guard over the rear wheel.
  // TVS Star City+ variant (real: 1984 x 750 x 1080, wb 1260, 115 kg, 109.7 cc 8.1 PS): 5-spoke alloys, dual-tone paint
  function splendor(star) {
    const k = kit(), add = k.add, PI = Math.PI;
    const body = paint(star === true ? pickR([0x1a1c20, 0x7c1d22, 0x123d7a, 0x4a4f55, 0xd6d8da]) : pickR([0x111111, 0x111111, 0x111111, 0x5d6166, 0x8b1a1a, 0x1a2f6b]));
    const stripe = paint(pickR([0xd8262d, 0xc0c4c8, 0x2f8fd8, 0x52b04a, 0xe8b72a])), stripe2 = paint(0xe8e8e8);
    const black = M(0x161616), alloy = M(0xb4b8bc), R = 0.3, ZF = 0.64, ZR = -0.62;
    const wo = star === true ? { style: 'alloy', n: 5, rim: M(0x24262a) } : { style: 'spoke', n: 18 };
    const fw = bikeWheel(k, R, 0.068, ZF, wo); fw.userData.front = true;
    bikeWheel(k, R, 0.08, ZR, Object.assign({ hubR: 0.075 }, wo));
    // frame: backbone under the tank, downtube, swingarm, twin chrome shocks with black springs
    tube(k, [0, 0.98, 0.45], [0, 0.8, -0.1], 0.03, black); tube(k, [0, 0.95, 0.46], [0, 0.5, 0.3], 0.026, black);
    for (const sx of [-1, 1]) {
      tube(k, [sx * 0.09, 0.42, -0.08], [sx * 0.09, R, ZR], 0.02, black);
      tube(k, [sx * 0.12, 0.9, -0.44], [sx * 0.12, R + 0.06, ZR + 0.05], 0.014, chrome);
      tube(k, [sx * 0.12, 0.84, -0.46], [sx * 0.12, 0.55, -0.55], 0.03, black);
      add(cyl(0.012, 0.012, 0.15, 5), black, sx * 0.15, 0.38, -0.04).rotation.z = PI / 2;          // foot pegs
      tube(k, [sx * 0.1, 0.9, -0.55], [sx * 0.12, 0.92, -0.82], 0.012, chrome);                     // grab rail
    }
    tube(k, [-0.12, 0.92, -0.82], [0.12, 0.92, -0.82], 0.012, chrome);
    // engine: crankcase, round magneto cover, forward-inclined finned cylinder
    add(rbox(0.22, 0.24, 0.32, 0.06), alloy, 0, 0.44, 0.04);
    add(cyl(0.11, 0.11, 0.05, 14), alloy, -0.12, 0.44, 0.02).rotation.z = PI / 2;
    add(cyl(0.07, 0.07, 0.05, 12), M(0x8c9196), 0.12, 0.42, 0.08).rotation.z = PI / 2;
    const cg = new THREE.Group(); cg.position.set(0, 0.55, 0.2); cg.rotation.x = 1.05; k.g.add(cg);
    for (let i = 0; i < 6; i++) add(rbox(0.2 - i * 0.006, 0.014, 0.18, 0.006), alloy, 0, i * 0.03, 0, cg);
    add(rbox(0.13, 0.07, 0.12, 0.03), black, 0, 0.2, 0, cg);
    // rounded commuter tank with knee recesses and stripes
    add(sideGeo('splTank', s => { s.moveTo(-0.1, 0.84); s.quadraticCurveTo(-0.06, 1.0, 0.12, 1.01); s.quadraticCurveTo(0.34, 1.01, 0.43, 0.9); s.lineTo(0.38, 0.8); s.quadraticCurveTo(0.12, 0.75, -0.1, 0.84); }, 0.3, 0.1, 10), body);
    add(rbox(0.07, 0.03, 0.08, 0.02), chrome, 0, 1.01, 0.1);                                         // fuel cap
    for (const sx of [-1, 1]) {
      sidePanel(k, 'splStr', [[0.39, 0.93], [0.41, 0.885], [-0.02, 0.86], [-0.05, 0.9]], stripe, sx * 0.151, 0.006);
      sidePanel(k, 'splStr2', [[0.36, 0.95], [0.37, 0.935], [-0.02, 0.915], [-0.03, 0.93]], stripe2, sx * 0.151, 0.006);
      sidePanel(k, 'splPStr', [[-0.18, 0.79], [-0.5, 0.81], [-0.52, 0.77], [-0.18, 0.75]], stripe, sx * 0.121, 0.006);
    }
    // side panels, tail cowl, long flat seat
    add(sideGeo('splPanel', s => { s.moveTo(-0.14, 0.84); s.lineTo(-0.52, 0.86); s.quadraticCurveTo(-0.6, 0.76, -0.5, 0.64); s.lineTo(-0.16, 0.64); }, 0.24, 0.05), body);
    add(sideGeo('splTail', s => { s.moveTo(-0.5, 0.86); s.lineTo(-0.84, 0.88); s.quadraticCurveTo(-0.9, 0.84, -0.86, 0.78); s.lineTo(-0.52, 0.74); }, 0.2, 0.04), body);
    add(sideGeo('splSeat', s => { s.moveTo(-0.06, 0.89); s.quadraticCurveTo(-0.1, 0.96, -0.22, 0.96); s.lineTo(-0.78, 0.95); s.quadraticCurveTo(-0.86, 0.94, -0.84, 0.88); s.lineTo(-0.1, 0.85); }, 0.25, 0.05), black);
    // fully enclosed chain case on the left, saree guard, rear guard
    add(sideGeo('splCase', s => { s.moveTo(0.06, 0.5); s.lineTo(ZR - 0.02, R + 0.11); s.quadraticCurveTo(ZR - 0.16, R, ZR - 0.02, R - 0.11); s.lineTo(0.04, 0.34); s.quadraticCurveTo(0.14, 0.42, 0.06, 0.5); }, 0.06, 0.02), black).position.x = -0.11;
    tube(k, [-0.17, 0.38, -0.42], [-0.17, 0.7, -0.62], 0.01, chrome); tube(k, [-0.17, 0.7, -0.62], [-0.17, 0.42, -0.9], 0.01, chrome);
    tube(k, [-0.17, 0.38, -0.42], [-0.17, 0.42, -0.9], 0.01, chrome);
    guard(k, R, ZR, body, 0.55, 0.36, 1.0);
    // long chrome silencer with black heat shield, chrome header
    tube(k, [0.04, 0.5, 0.3], [0.1, 0.3, 0.05], 0.022, chrome); tube(k, [0.1, 0.3, 0.05], [0.15, 0.33, -0.12], 0.022, chrome);
    const sil = add(cyl(0.04, 0.05, 0.6, 10), chrome, 0.15, 0.36, -0.42); sil.rotation.x = PI / 2 - 0.1;
    const hs = add(rbox(0.025, 0.08, 0.3, 0.02), black, 0.2, 0.37, -0.32); hs.rotation.x = -0.1;
    // rear: small tail lamp, indicators on stalks, plate
    k.lamp(0.12, 0.06, 0, 0.83, -0.9);
    for (const sx of [-1, 1]) { tube(k, [sx * 0.05, 0.8, -0.86], [sx * 0.15, 0.8, -0.87], 0.007, black); add(sph(0.025, 6, 4), amberMat, sx * 0.16, 0.8, -0.87).scale.z = 1.5; }
    plate(k, -0.9, 0.62, false);
    // front: black guard, chrome fork with body-colour covers, headlamp cowl with visor, chrome bars
    const fork = [fw, guard(k, R, ZF, black, 0.45, 0.18, 1.0)];
    for (const sx of [-1, 1]) {
      fork.push(tube(k, [sx * 0.075, R, ZF], [sx * 0.075, 0.95, 0.47], 0.019, chrome));
      fork.push(tube(k, [sx * 0.075, 0.72, 0.56], [sx * 0.075, 0.97, 0.47], 0.032, body));
    }
    fork.push(add(sideGeo('splCowl', s => { s.moveTo(0.47, 0.84); s.lineTo(0.66, 0.86); s.quadraticCurveTo(0.71, 0.96, 0.65, 1.04); s.lineTo(0.5, 1.06); s.quadraticCurveTo(0.44, 0.98, 0.47, 0.84); }, 0.24, 0.07, 8), body));
    const hl = k.lamp(0.15, 0.12, 0, 0.95, 0.705, true); hl.rotation.x = -0.15; hl.lens.rotation.x = -0.15; fork.push(...lampParts(hl));
    const vis = add(rbox(0.2, 0.05, 0.015, 0.01), black, 0, 1.05, 0.66); vis.rotation.x = -0.6; fork.push(vis);
    fork.push(tube(k, [-0.33, 1.07, 0.42], [0.33, 1.07, 0.42], 0.012, chrome));
    for (const sx of [-1, 1]) {
      const gp = add(cyl(0.02, 0.02, 0.11, 6), black, sx * 0.3, 1.07, 0.42); gp.rotation.z = PI / 2; fork.push(gp);
      fork.push(tube(k, [sx * 0.08, 0.92, 0.6], [sx * 0.17, 0.92, 0.6], 0.007, black), add(sph(0.025, 6, 4), amberMat, sx * 0.18, 0.92, 0.6));
    }
    const spd = add(cyl(0.065, 0.06, 0.04, 12), black, 0, 1.08, 0.53); spd.rotation.x = 0.7; fork.push(spd);
    fork.push(...mirrors(k, [-0.22, 0.22], 1.13, 0.42, chrome));
    forkPivot(k, 0.97, 0.47, 0.26, fork);
    riders(k, 0.9, -0.28, -0.62, 0.4, 0.4);
    return two(k, star === true ? 1.98 : 1.97, 'bike', star === true ? 'starCity' : 'splendor', [0, 0.9, -0.28, 'bike']);
  }

  // ---------------------------------------------------------------- fully-faired sports bike (R15 style, 1.99 x 0.73 x 1.14)
  // Racing blue (or black) with white / cyan graphics, sharp twin-lamp nose with a centre intake, smoked screen,
  // low clip-ons, silver deltabox frame and alloy swingarm, gold USD fork, upswept split tail, short angular can,
  // 17" 5-spoke alloys on fat radials.
  function faired() {
    const k = kit(), add = k.add, PI = Math.PI;
    const [main, sec, gfx] = pickR([[0x1846b8, 0x0e0e10, 0xf2f2f2], [0x1846b8, 0x0e0e10, 0x29c4e8], [0x1846b8, 0xf2f2f2, 0x0e0e10], [0x17181b, 0x0e0e10, 0x29c4e8]]);
    const body = paint(main), dark = paint(sec), deco = paint(gfx), black = M(0x141414), alu = M(0xa8adb3);
    const rimM = main === 0x1846b8 ? body : paint(0x29c4e8);
    const ZF = 0.69, ZR = -0.66;
    const fw = bikeWheel(k, 0.3, 0.1, ZF, { style: 'alloy', n: 5, split: true, rim: rimM, disc: 0.14, discX: 0.065 }); fw.userData.front = true;
    bikeWheel(k, 0.31, 0.15, ZR, { style: 'alloy', n: 5, split: true, rim: rimM, disc: 0.1, discX: -0.085 });
    // deltabox spars, alloy swingarm, subframe, monoshock
    for (const sx of [-1, 1]) {
      const sp = tube(k, [sx * 0.09, 0.92, 0.44], [sx * 0.14, 0.56, -0.16], 0.045, alu); sp.scale.z = 0.5;
      tube(k, [sx * 0.12, 0.5, -0.18], [sx * 0.1, 0.31, ZR], 0.035, alu);
      tube(k, [sx * 0.1, 0.82, -0.2], [sx * 0.07, 0.94, -0.75], 0.015, black);
      add(rbox(0.04, 0.03, 0.14, 0.01), alu, sx * 0.15, 0.58, -0.16);                              // rearset pegs
    }
    tube(k, [0, 0.5, -0.18], [0, 0.82, -0.3], 0.03, paint(0xc62828));
    add(rbox(0.26, 0.3, 0.38, 0.06), black, 0, 0.47, 0.08);
    chainLoop(k, 'frChain', 0.06, ZR, 0.31, -0.12);
    // lower fairing (wide), upper cowl (narrower), belly pan, graphics, vents
    add(sideGeo('frLow', s => { s.moveTo(0.5, 0.82); s.lineTo(0.56, 0.66); s.lineTo(0.4, 0.5); s.quadraticCurveTo(0.34, 0.3, 0.18, 0.27); s.lineTo(-0.1, 0.29); s.lineTo(-0.06, 0.46); s.lineTo(0.08, 0.62); s.lineTo(0.08, 0.84); s.lineTo(0.3, 0.9); }, 0.42, 0.09, 10), body);
    add(sideGeo('frCowl', s => { s.moveTo(0.42, 0.98); s.lineTo(0.58, 1.06); s.lineTo(0.81, 0.92); s.quadraticCurveTo(0.83, 0.82, 0.73, 0.76); s.lineTo(0.5, 0.7); s.lineTo(0.4, 0.8); }, 0.34, 0.09, 10), body);
    for (const sx of [-1, 1]) {
      sidePanel(k, 'frBelly', [[0.37, 0.44], [0.3, 0.31], [-0.06, 0.31], [-0.03, 0.44]], dark, sx * 0.212, 0.008);
      sidePanel(k, 'frStripe', [[0.5, 0.78], [0.54, 0.72], [0.1, 0.46], [0.04, 0.5]], deco, sx * 0.212, 0.008);
      sidePanel(k, 'frStripe2', [[0.76, 0.88], [0.79, 0.84], [0.5, 0.74], [0.46, 0.78]], deco, sx * 0.172, 0.008);
      for (let i = 0; i < 3; i++) sidePanel(k, 'frVent', [[0.3 - i * 0.06, 0.74], [0.26 - i * 0.06, 0.74], [0.14 - i * 0.06, 0.6], [0.18 - i * 0.06, 0.6]], black, sx * 0.214, 0.008);
      // fairing-mounted mirrors
      tube(k, [sx * 0.15, 1.0, 0.6], [sx * 0.24, 1.07, 0.56], 0.008, black);
      add(rbox(0.1, 0.05, 0.04, 0.02), body, sx * 0.27, 1.08, 0.55);
      // twin slanted headlamps with DRL brows
      const h = k.lamp(0.11, 0.045, sx * 0.075, 0.885, 0.795, true); h.rotation.set(-0.35, sx * 0.35, -sx * 0.25); h.lens.rotation.copy(h.rotation);
      const drl = add(rbox(0.1, 0.012, 0.012, 0.004), fortunerMats().drl, sx * 0.08, 0.925, 0.785); drl.rotation.set(-0.35, sx * 0.35, -sx * 0.3);
      add(rbox(0.06, 0.02, 0.02, 0.005), amberMat, sx * 0.165, 0.86, 0.74).rotation.y = sx * 0.5;
    }
    add(rbox(0.07, 0.07, 0.04, 0.02), black, 0, 0.85, 0.79);                                       // centre ram-air intake
    add(sideGeo('frScreen', s => { s.moveTo(0.57, 1.05); s.lineTo(0.37, 1.19); s.lineTo(0.4, 1.21); s.lineTo(0.61, 1.07); }, 0.27, 0.01), glass);
    // tank, split seats, upswept tail
    add(sideGeo('frTank', s => { s.moveTo(0.42, 0.97); s.lineTo(0.3, 1.1); s.quadraticCurveTo(0.1, 1.13, -0.08, 1.06); s.lineTo(-0.16, 0.95); s.lineTo(0.06, 0.86); s.lineTo(0.42, 0.88); }, 0.38, 0.1, 10), body);
    for (const sx of [-1, 1]) sidePanel(k, 'frTankS', [[0.36, 1.0], [0.38, 0.96], [-0.04, 0.96], [-0.08, 1.0]], deco, sx * 0.181, 0.006);
    add(sideGeo('frSeat', s => { s.moveTo(-0.12, 0.97); s.quadraticCurveTo(-0.25, 0.92, -0.44, 0.93); s.lineTo(-0.5, 0.99); s.lineTo(-0.52, 0.89); s.lineTo(-0.14, 0.87); }, 0.26, 0.04), black);
    add(sideGeo('frTail', s => { s.moveTo(-0.4, 0.84); s.lineTo(-0.5, 0.98); s.lineTo(-0.82, 1.1); s.lineTo(-0.99, 1.13); s.lineTo(-0.97, 1.07); s.lineTo(-0.7, 0.92); s.lineTo(-0.5, 0.79); }, 0.24, 0.06, 8), body);
    add(sideGeo('frPill', s => { s.moveTo(-0.54, 1.0); s.lineTo(-0.8, 1.1); s.lineTo(-0.82, 1.06); s.lineTo(-0.56, 0.96); }, 0.17, 0.02), black);
    for (const sx of [-1, 1]) sidePanel(k, 'frTailS', [[-0.6, 0.96], [-0.96, 1.1], [-0.96, 1.08], [-0.62, 0.93]], deco, sx * 0.121, 0.006);
    const tl = k.lamp(0.1, 0.035, 0, 1.085, -0.99); tl.rotation.x = 0.4; tl.lens.rotation.copy(tl.rotation); tl.rotation.y = PI; tl.lens.rotation.y = PI;
    tube(k, [0, 0.98, -0.82], [0, 0.72, -0.98], 0.022, black);                                      // tail tidy
    for (const sx of [-1, 1]) add(rbox(0.05, 0.02, 0.02, 0.005), amberMat, sx * 0.1, 0.76, -0.98);
    plate(k, -1.0, 0.64, false);
    // short angular can with a chrome tip, under the right footpeg
    const can = add(rbox(0.1, 0.13, 0.36, 0.04), M(0x2b2d30), 0.17, 0.42, -0.32); can.rotation.x = -0.35;
    const tip = add(cyl(0.035, 0.035, 0.04, 10), chrome, 0.17, 0.49, -0.49); tip.rotation.x = PI / 2 - 0.35;
    tube(k, [0.06, 0.32, 0.2], [0.15, 0.35, -0.16], 0.025, M(0x5a5d60));
    guard(k, 0.31, ZR, black, 0.22, 0.3, 0.8);
    // front: gold USD fork, black sliders, clip-ons below the top yoke, body-colour fender
    const fork = [fw, guard(k, 0.3, ZF, body, 0.3, 0.14, 0.9)];
    for (const sx of [-1, 1]) {
      fork.push(tube(k, [sx * 0.08, 0.3, ZF], [sx * 0.08, 0.66, 0.565], 0.026, M(0x2a2a2a)));
      fork.push(tube(k, [sx * 0.08, 0.6, 0.585], [sx * 0.08, 1.02, 0.44], 0.036, gold2));
      fork.push(tube(k, [sx * 0.085, 0.96, 0.46], [sx * 0.29, 0.93, 0.36], 0.013, black));
      const gp = add(cyl(0.02, 0.02, 0.11, 6), black, sx * 0.29, 0.93, 0.36); gp.rotation.z = PI / 2; gp.rotation.y = -sx * 0.4; fork.push(gp);
    }
    fork.push(add(rbox(0.22, 0.03, 0.1, 0.01), alu, 0, 1.02, 0.44));
    fork.push(add(rbox(0.14, 0.1, 0.03, 0.01), black, 0, 1.08, 0.5));                               // TFT dash
    forkPivot(k, 1.02, 0.44, 0.33, fork);
    riders(k, 1.0, -0.3, -0.7, 0.85, 0.15);
    return two(k, 2.0, 'bike', 'faired', [0, 1.0, -0.3, 'bike']);
  }

  // ---------------------------------------------------------------- scooter (Activa-style gearless step-through, 1.80 x 0.70 x 1.15)
  // Honda Activa variant (real: 1833 x 697 x 1156, wb 1260, 105 kg, 109.5 cc 7.8 PS): 12"/10" wheels, darker metallics
  function scooter(act) {
    act = act === true;
    const k = kit(), body = paint(act ? pickR([0x20242a, 0x6d1a1f, 0x1d3f75, 0x8c8f93, 0xe9e7df]) : pickR([0xa9dcc9, 0xb9d6ee, 0xf3e6c4, 0xf4c9c0, 0xd8cdea, 0xf6f6f2, 0xf6f6f2, 0xc9d7a6])), black = M(0x161616), dark = M(0x26282b);
    const fw = bikeWheel(k, act ? 0.27 : 0.25, 0.1, act ? 0.63 : 0.62, { style: 'alloy', n: act ? 4 : 5, rim: M(act ? 0x8a8d90 : 0x4a4d52) }); fw.userData.front = true;
    bikeWheel(k, act ? 0.24 : 0.25, 0.11, act ? -0.63 : -0.6, { style: 'alloy', n: act ? 4 : 5, rim: M(act ? 0x8a8d90 : 0x4a4d52) });
    // chrome V garnish down the apron, two-tone inner panel
    for (const sx of [-1, 1]) { const gz = k.add(rbox(0.025, 0.36, 0.02, 0.008), chrome, sx * 0.07, 0.74, 0.585); gz.rotation.x = -0.25; gz.rotation.z = -sx * 0.3; }
    // leg shield / front apron, floorboard, swoopy rear body, seat
    k.add(sideGeo('scApron', s => { s.moveTo(0.3, 0.34); s.lineTo(0.48, 0.38); s.quadraticCurveTo(0.6, 0.62, 0.56, 0.9); s.lineTo(0.48, 1.0); s.lineTo(0.38, 0.99); s.quadraticCurveTo(0.33, 0.7, 0.26, 0.38); }, 0.46, 0.07, 10), body);
    const inner = k.add(rbox(0.38, 0.56, 0.03, 0.05), dark, 0, 0.66, 0.29); inner.rotation.x = -0.2;
    k.add(rbox(0.34, 0.05, 0.56, 0.02), dark, 0, 0.36, 0.0);
    k.add(sideGeo('scRear', s => { s.moveTo(-0.2, 0.36); s.lineTo(-0.16, 0.62); s.quadraticCurveTo(-0.16, 0.8, -0.32, 0.8); s.lineTo(-0.8, 0.79); s.quadraticCurveTo(-0.98, 0.76, -0.94, 0.6); s.quadraticCurveTo(-0.88, 0.42, -0.62, 0.38); s.lineTo(-0.2, 0.36); }, 0.44, 0.1, 12), body);
    k.add(sideGeo('scSeat', s => { s.moveTo(-0.17, 0.79); s.quadraticCurveTo(-0.2, 0.89, -0.32, 0.9); s.lineTo(-0.66, 0.9); s.quadraticCurveTo(-0.72, 0.95, -0.86, 0.93); s.quadraticCurveTo(-0.92, 0.88, -0.86, 0.8); s.lineTo(-0.2, 0.78); }, 0.34, 0.06, 8), black);
    for (const sx of [-1, 1]) k.add(cyl(0.014, 0.014, 0.42, 5), M(0x3a3c40), sx * 0.2, 0.84, -0.66).rotation.x = Math.PI / 2;   // grab rail
    // CVT / engine unit on the left (acts as swingarm), muffler on the right, centre stand
    k.add(rbox(0.12, 0.2, 0.6, 0.05), M(0x6e7276), -0.15, 0.32, -0.38);
    const muf = k.add(cyl(0.055, 0.05, 0.38, 8), M(0x3a3c40), 0.16, 0.3, -0.55); muf.rotation.x = Math.PI / 2 - 0.1;
    k.add(rbox(0.04, 0.12, 0.28, 0.02), M(0x8a8d90), 0.2, 0.32, -0.55);
    guard(k, 0.25, -0.6, dark, 0.45, 0.45);
    // front: mudguard, telescopic fork legs, handlebar cover with the headlamp, indicators
    const fork = [fw, guard(k, 0.25, 0.62, body, 0.45, 0.2, 1.2)];
    for (const sx of [-1, 1]) fork.push(tube(k, [sx * 0.07, 0.25, 0.62], [sx * 0.06, 0.82, 0.42], 0.022, M(0x55595e)));
    fork.push(k.add(sideGeo('scBars', s => { s.moveTo(0.3, 0.98); s.lineTo(0.55, 1.0); s.quadraticCurveTo(0.6, 1.06, 0.52, 1.12); s.lineTo(0.32, 1.12); s.quadraticCurveTo(0.26, 1.05, 0.3, 0.98); }, 0.36, 0.05), body));
    for (const sx of [-1, 1]) { const gp = k.add(cyl(0.022, 0.022, 0.13, 6), black, sx * 0.26, 1.07, 0.4); gp.rotation.z = Math.PI / 2; fork.push(gp); }
    fork.push(...lampParts(k.lamp(0.2, 0.08, 0, 1.06, 0.6, true)));
    fork.push(...mirrors(k, [-0.2, 0.2], 1.14, 0.4, black));
    for (const sx of [-1, 1]) { k.add(rbox(0.06, 0.04, 0.03, 0.01), amberMat, sx * 0.16, 0.86, 0.58); k.add(rbox(0.06, 0.04, 0.03, 0.01), amberMat, sx * 0.15, 0.72, -0.95); }
    k.add(sph(0.05, 8, 6), body, 0, 0.84, 0.6).scale.set(1.4, 1, 0.6);          // front cowl "nose"
    k.lamp(0.18, 0.07, 0, 0.72, -0.96);
    plate(k, -0.93, 0.52, false);
    forkPivot(k, 0.95, 0.43, 0.45, fork);
    riders(k, 0.86, -0.36, -0.7, 0.3, 0.45);
    return two(k, act ? 1.83 : 1.85, 'scooter', act ? 'activa' : 'scooter', [0, 0.86, -0.36, 'bike']);
  }

  // ---------------------------------------------------------------- retro singles: Bullet-style classic and Jawa-style classic
  // jawa = false: long teardrop tank with pinstripes, sprung saddle + pillion pad, casquette headlamp with pilot
  // lamps, deep valanced guards, single peashooter. jawa = true: slimmer tank with chrome knee panels, flat
  // bench seat, fork gaiters, twin peashooters.
  function retro(jawa) {
    const k = kit(), black = M(0x161616);
    const body = paint(jawa ? [0x5c0f17, 0x5c0f17, 0x5c0f17, 0x111111][Math.random() * 4 | 0] : [0x0d0d0d, 0x0d0d0d, 0x4a0d12, 0x4a0d12][Math.random() * 4 | 0]);
    const gold = paint(0xc9a14a), alloy = M(0xb9bcc0);
    const R = jawa ? 0.32 : 0.34, ZF = jawa ? 0.68 : 0.72, ZR = jawa ? -0.64 : -0.68;
    const fw = bikeWheel(k, R, 0.095, ZF, { style: 'spoke', n: 20, hubR: 0.08, hub: alloy }); fw.userData.front = true;
    bikeWheel(k, R, 0.12, ZR, { style: 'spoke', n: 20, hubR: 0.085, hub: alloy });
    // frame: single downtube cradle, backbone, rear subframe
    tube(k, [0, 1.0, 0.46], [0, 0.42, 0.3], 0.024, black); tube(k, [0, 0.42, 0.3], [0, 0.34, -0.2], 0.024, black);
    tube(k, [0, 1.0, 0.46], [0, 0.9, -0.3], 0.026, black);
    for (const sx of [-1, 1]) {
      tube(k, [sx * 0.1, 0.44, -0.2], [sx * 0.1, R, ZR], 0.02, black);                          // swingarm
      tube(k, [sx * 0.11, 0.95, -0.35], [sx * 0.11, R + 0.08, ZR + 0.06], 0.028, chrome);       // twin shocks
      tube(k, [sx * 0.11, 0.88, -0.25], [sx * 0.11, 0.88, -0.95], 0.016, black);                 // seat rails
      k.add(cyl(0.012, 0.012, 0.16, 5), chrome, sx * 0.16, 0.36, 0.05).rotation.z = Math.PI / 2;
    }
    // tall finned engine with timing cover, gearbox
    k.add(rbox(0.24, 0.28, 0.4, 0.08), alloy, 0, 0.48, 0.05);
    for (let i = 0; i < 6; i++) k.add(rbox(0.22 - i * 0.008, 0.018, 0.22, 0.008), alloy, 0, 0.64 + i * 0.04, 0.16).rotation.x = -0.25;
    k.add(cyl(0.12, 0.12, 0.05, 14), chrome, -0.14, 0.46, 0.08).rotation.z = Math.PI / 2;
    k.add(rbox(0.2, 0.2, 0.22, 0.05), alloy, 0, 0.42, -0.2);
    tube(k, [0, 0.95, 0.12], [0, 1.0, 0.0], 0.02, black);
    if (!jawa) {
      k.add(sideGeo('bulTank', s => { s.moveTo(0.44, 0.86); s.quadraticCurveTo(0.46, 1.06, 0.24, 1.08); s.quadraticCurveTo(-0.02, 1.08, -0.12, 0.98); s.lineTo(-0.1, 0.88); s.quadraticCurveTo(0.16, 0.8, 0.44, 0.86); }, 0.32, 0.11, 12), body);
      for (const sx of [-1, 1]) {
        sidePanel(k, 'bulStripe', [[0.36, 0.95], [0.38, 0.97], [0.0, 1.03], [-0.04, 1.01]], gold, sx * 0.162, 0.006);
        k.add(G('bulBadge', () => new THREE.CircleGeometry(0.045, 12)), chrome, sx * 0.163, 0.96, 0.2).rotation.y = sx * Math.PI / 2;
        k.add(rbox(0.06, 0.2, 0.3, 0.03), body, sx * 0.15, 0.68, -0.35);                         // tool box / battery box
      }
      // long, thick dual seat (Bullet-style) with a chrome grab strap rail behind
      k.add(sideGeo('bulSeat', s => { s.moveTo(-0.1, 0.94); s.quadraticCurveTo(-0.13, 1.04, -0.26, 1.05); s.lineTo(-0.86, 1.03); s.quadraticCurveTo(-0.94, 1.0, -0.9, 0.93); s.lineTo(-0.12, 0.91); }, 0.3, 0.06, 8), M(0x1a1412));
      tube(k, [-0.15, 0.97, -0.92], [0.15, 0.97, -0.92], 0.014, chrome);
      guard(k, R, ZR, body, 0.6, 0.38, 1.6);
      const ex = k.add(cyl(0.045, 0.045, 0.95, 10), chrome, 0.17, 0.4, -0.38); ex.rotation.x = Math.PI / 2 - 0.08;
      tube(k, [0.06, 0.62, 0.28], [0.17, 0.4, 0.1], 0.025, chrome);
      for (const sx of [-1, 1]) tube(k, [sx * 0.08, 0.42, 0.36], [sx * 0.24, 0.62, 0.32], 0.016, chrome);         // crash guard
      tube(k, [-0.24, 0.62, 0.32], [0.24, 0.62, 0.32], 0.016, chrome);
    } else {
      k.add(sideGeo('jawTank', s => { s.moveTo(0.42, 0.88); s.quadraticCurveTo(0.44, 1.03, 0.25, 1.05); s.lineTo(0.0, 1.03); s.quadraticCurveTo(-0.08, 1.0, -0.08, 0.92); s.quadraticCurveTo(0.16, 0.84, 0.42, 0.88); }, 0.28, 0.09, 12), body);
      for (const sx of [-1, 1]) {
        sidePanel(k, 'jawPanel', [[0.3, 0.92], [0.32, 0.99], [0.05, 0.99], [0.02, 0.92]], chrome, sx * 0.142, 0.008);
        k.add(sideGeo('jawSide', s => { s.moveTo(-0.15, 0.86); s.lineTo(-0.45, 0.86); s.quadraticCurveTo(-0.48, 0.7, -0.38, 0.62); s.lineTo(-0.15, 0.64); }, 0.04, 0.01), body).position.x = sx * 0.13;
        const ex = k.add(cyl(0.04, 0.04, 0.9, 10), chrome, sx * 0.17, 0.42, -0.42); ex.rotation.x = Math.PI / 2 - 0.1;
        tube(k, [sx * 0.05, 0.62, 0.28], [sx * 0.17, 0.42, 0.06], 0.024, chrome);
      }
      k.add(sideGeo('jawSeat', s => { s.moveTo(-0.08, 0.92); s.quadraticCurveTo(-0.1, 1.0, -0.2, 1.0); s.lineTo(-0.82, 0.99); s.quadraticCurveTo(-0.88, 0.96, -0.84, 0.9); s.lineTo(-0.1, 0.9); }, 0.28, 0.05), M(0x3a2618));
      k.add(rbox(0.3, 0.02, 0.02, 0.008), chrome, 0, 0.93, -0.84);
      guard(k, R, ZR, body, 0.45, 0.38, 1.2);
    }
    // front: fork, guard, headlamp (with pilot lamps on the Bullet), bars with chrome levers
    const fork = [fw, guard(k, R, ZF, body, jawa ? 0.4 : 0.55, 0.18, jawa ? 1.1 : 1.5)];
    for (const sx of [-1, 1]) {
      fork.push(tube(k, [sx * 0.08, R, ZF], [sx * 0.08, 0.95, 0.5], 0.024, chrome));
      if (jawa) fork.push(tube(k, [sx * 0.08, R + 0.22, ZF - 0.08], [sx * 0.08, R + 0.42, ZF - 0.13], 0.034, black));      // gaiters
      else fork.push(tube(k, [sx * 0.085, 0.82, 0.55], [sx * 0.085, 1.0, 0.5], 0.04, body));                                  // fork covers
    }
    const hl = k.add(cyl(0.11, 0.09, 0.14, 14), jawa ? chrome : body, 0, 0.95, 0.6); hl.rotation.x = Math.PI / 2; fork.push(hl);
    fork.push(...lampParts(k.lamp(0.19, 0.19, 0, 0.95, 0.672, true, true)));
    if (!jawa) for (const sx of [-1, 1]) { const pl = k.add(cyl(0.035, 0.03, 0.06, 8), chrome, sx * 0.13, 0.98, 0.58); pl.rotation.x = Math.PI / 2; fork.push(pl, k.add(sph(0.026, 6, 4), amberMat, sx * 0.13, 0.98, 0.615)); }
    else for (const sx of [-1, 1]) fork.push(k.add(sph(0.028, 6, 4), amberMat, sx * 0.14, 0.95, 0.56));
    const hb = tube(k, [-0.36, 1.12, 0.38], [0.36, 1.12, 0.38], 0.013, chrome); fork.push(hb);
    for (const sx of [-1, 1]) { fork.push(tube(k, [sx * 0.07, 1.0, 0.48], [sx * 0.12, 1.12, 0.4], 0.014, chrome)); const gp = k.add(cyl(0.021, 0.021, 0.11, 6), black, sx * 0.32, 1.12, 0.38); gp.rotation.z = Math.PI / 2; fork.push(gp); }
    fork.push(...mirrors(k, [-0.26, 0.26], 1.18, 0.38, chrome));
    const spd = k.add(cyl(0.04, 0.04, 0.03, 10), chrome, 0, 1.06, 0.5); spd.rotation.x = 0.6; fork.push(spd);
    for (const sx of [-1, 1]) k.add(sph(0.026, 6, 4), amberMat, sx * 0.14, 0.78, ZR - 0.3);
    k.lamp(0.1, 0.06, 0, 0.82, ZR - 0.32);
    plate(k, ZR - 0.33, 0.66, false);
    forkPivot(k, 1.0, 0.5, 0.48, fork);
    riders(k, 0.98, -0.28, jawa ? -0.66 : -0.68, 0.55, 0.3);
    const L = ZF - ZR + 2 * R + 0.12;
    return two(k, Math.round(L * 100) / 100, jawa ? 'classic2' : 'classic', jawa ? 'classic2' : 'classic', [0, 0.98, -0.28, 'bike']);
  }
  const classic = () => retro(false), classic2 = () => retro(true);

  // ---------------------------------------------------------------- naked sport (Duke-style: trellis frame, angular shrouds, 2.0 x 0.84 x 1.1)
  function sport() {
    const k = kit(), black = M(0x141414);
    const [main, accent] = [[0xf0640a, 0x141414], [0xf0640a, 0x141414], [0xf0640a, 0xf5f5f5], [0x1c1c1c, 0xf0640a]][Math.random() * 4 | 0];
    const body = paint(main), acc = paint(accent), frameM = paint(0xf0640a), steel = M(0x8c9196);
    const fw = bikeWheel(k, 0.3, 0.11, 0.7, { style: 'alloy', n: 6, rim: frameM, disc: 0.15, discX: 0.07 }); fw.userData.front = true;
    bikeWheel(k, 0.31, 0.165, -0.66, { style: 'alloy', n: 6, rim: frameM, disc: 0.11, discX: -0.09 });
    // trellis frame
    for (const sx of [-1, 1]) {
      tube(k, [sx * 0.05, 1.0, 0.46], [sx * 0.13, 0.52, -0.18], 0.017, frameM);
      tube(k, [sx * 0.05, 0.9, 0.5], [sx * 0.13, 0.7, 0.05], 0.017, frameM);
      tube(k, [sx * 0.13, 0.7, 0.05], [sx * 0.13, 0.85, -0.25], 0.017, frameM);
      tube(k, [sx * 0.13, 0.52, -0.18], [sx * 0.13, 0.85, -0.25], 0.017, frameM);
      tube(k, [sx * 0.13, 0.85, -0.25], [sx * 0.09, 0.95, -0.75], 0.014, frameM);
      tube(k, [sx * 0.1, 0.5, -0.18], [sx * 0.1, 0.31, -0.66], 0.03, steel);               // swingarm
      k.add(cyl(0.012, 0.012, 0.14, 5), steel, sx * 0.18, 0.5, -0.22).rotation.z = Math.PI / 2;
    }
    tube(k, [0, 0.55, -0.15], [0, 0.85, -0.3], 0.03, frameM);                                 // mono shock spring
    // engine, radiator, belly exhaust with a short end can
    k.add(rbox(0.26, 0.32, 0.38, 0.06), black, 0, 0.5, 0.06);
    k.add(rbox(0.22, 0.14, 0.16, 0.04), M(0x2a2a2a), 0, 0.72, 0.12);
    const rad = k.add(rbox(0.34, 0.26, 0.05, 0.02), black, 0, 0.66, 0.34); rad.rotation.x = -0.25;
    k.add(rbox(0.16, 0.1, 0.42, 0.04), M(0x3a3a3a), 0.02, 0.26, -0.1);
    const can = k.add(cyl(0.06, 0.06, 0.24, 10), M(0x3a3a3a), 0.12, 0.3, -0.38); can.rotation.x = Math.PI / 2;
    // angular tank + shrouds, split seat, sharp tail with tail-tidy
    k.add(sideGeo('spTank', s => { s.moveTo(0.4, 0.84); s.lineTo(0.5, 0.98); s.lineTo(0.3, 1.1); s.lineTo(-0.02, 1.07); s.lineTo(-0.14, 0.95); s.lineTo(0.04, 0.82); }, 0.36, 0.05), body);
    for (const sx of [-1, 1]) {
      k.add(sideGeo('spShroud', s => { s.moveTo(0.52, 0.92); s.lineTo(0.62, 0.86); s.lineTo(0.42, 0.66); s.lineTo(0.2, 0.74); s.lineTo(0.3, 0.92); }, 0.03, 0.008), acc).position.x = sx * 0.2;
      sidePanel(k, 'spDecal', [[0.36, 0.95], [0.46, 0.97], [0.18, 1.05], [0.1, 1.02]], acc, sx * 0.181, 0.006);
    }
    k.add(sideGeo('spSeat', s => { s.moveTo(-0.12, 0.94); s.lineTo(-0.5, 0.97); s.lineTo(-0.56, 1.05); s.lineTo(-0.86, 1.09); s.lineTo(-0.88, 1.04); s.lineTo(-0.52, 0.92); s.lineTo(-0.12, 0.88); }, 0.26, 0.03), black);
    k.add(sideGeo('spTail', s => { s.moveTo(-0.4, 0.86); s.lineTo(-0.98, 1.06); s.lineTo(-0.95, 1.0); s.lineTo(-0.5, 0.78); }, 0.22, 0.02), body);
    tube(k, [0, 0.9, -0.85], [0, 0.66, -1.0], 0.025, black);
    k.add(rbox(0.3, 0.03, 0.08, 0.01), black, 0, 0.66, -1.0);
    k.lamp(0.12, 0.04, 0, 1.03, -0.975);
    for (const sx of [-1, 1]) k.add(rbox(0.05, 0.02, 0.02, 0.005), amberMat, sx * 0.12, 0.7, -1.0);
    plate(k, -1.03, 0.56, false);
    // front: USD fork, flat bar, compact angular headlamp mask, short fender
    const fork = [fw, guard(k, 0.3, 0.7, body, 0.28, 0.12, 0.9)];
    for (const sx of [-1, 1]) { fork.push(tube(k, [sx * 0.085, 0.3, 0.7], [sx * 0.085, 0.72, 0.56], 0.03, M(0x2a2a2a))); fork.push(tube(k, [sx * 0.085, 0.72, 0.56], [sx * 0.085, 1.02, 0.46], 0.038, gold2)); }
    fork.push(tube(k, [-0.38, 1.13, 0.4], [0.38, 1.13, 0.4], 0.014, black));
    for (const sx of [-1, 1]) { const gp = k.add(cyl(0.022, 0.022, 0.12, 6), black, sx * 0.34, 1.13, 0.4); gp.rotation.z = Math.PI / 2; fork.push(gp); }
    const mask = k.add(sideGeo('spMask', s => { s.moveTo(0.52, 0.8); s.lineTo(0.66, 0.9); s.lineTo(0.62, 1.04); s.lineTo(0.5, 1.07); s.lineTo(0.48, 0.86); }, 0.22, 0.03), black); fork.push(mask);
    const hlm = k.lamp(0.14, 0.11, 0, 0.94, 0.665, true); hlm.rotation.x = -0.4; hlm.lens.rotation.x = -0.4; fork.push(...lampParts(hlm));
    fork.push(...mirrors(k, [-0.28, 0.28], 1.2, 0.4, black));
    for (const sx of [-1, 1]) fork.push(k.add(rbox(0.05, 0.02, 0.02, 0.005), amberMat, sx * 0.12, 0.98, 0.62));
    const dash = k.add(rbox(0.14, 0.09, 0.03, 0.01), black, 0, 1.12, 0.5); dash.rotation.x = -0.6; fork.push(dash);
    forkPivot(k, 1.02, 0.46, 0.42, fork);
    riders(k, 1.0, -0.32, -0.72, 0.8, 0.2);
    return two(k, 2.05, 'sport', 'sport', [0, 1.0, -0.32, 'bike']);
  }
  const gold2 = paint(0xd4a017);

  // ---------------------------------------------------------------- mountain bicycle (hardtail, 27.5", 1.75 x 0.66 x 1.1)
  function cycle() {
    const k = kit(), frameM = paint([0xd32f2f, 0x1976d2, 0x111111, 0x2e7d32, 0xf9a825, 0xeceff1][Math.random() * 6 | 0]), black = M(0x161616), alloy = M(0x9ea3a8);
    const R = 0.35, ZF = 0.56, ZR = -0.52;
    const fw = k.wheel(R, 0.055, 0.001, R, ZF, { low: true, spokes: 12, rim: M(0x2a2a2a), thin: true, spokeMat: alloy }); fw.userData.front = true;
    const rw = k.wheel(R, 0.055, 0.001, R, ZR, { low: true, spokes: 12, rim: M(0x2a2a2a), thin: true, spokeMat: alloy });
    for (const w of [fw, rw]) { const hub = k.add(cyl(0.025, 0.025, 0.1, 8), alloy, 0, 0, 0, w); hub.rotation.z = Math.PI / 2; }
    const d = k.add(cyl(0.08, 0.08, 0.005, 12), alloy, 0.04, 0, 0, fw); d.rotation.z = Math.PI / 2;          // disc rotors
    const d2 = k.add(cyl(0.08, 0.08, 0.005, 12), alloy, 0.04, 0, 0, rw); d2.rotation.z = Math.PI / 2;
    const BB = [0, 0.3, 0.0], HT = [0, 0.92, 0.38], HB = [0, 0.78, 0.43], ST = [0, 0.86, -0.14];
    tube(k, HT, ST, 0.022, frameM); tube(k, HB, BB, 0.026, frameM); tube(k, BB, ST, 0.02, frameM); tube(k, HB, HT, 0.03, frameM);
    for (const sx of [-1, 1]) { tube(k, [sx * 0.02, 0.3, 0], [sx * 0.06, R, ZR], 0.012, frameM); tube(k, [sx * 0.015, 0.85, -0.13], [sx * 0.06, R, ZR], 0.011, frameM); }
    tube(k, ST, [0, 1.04, -0.21], 0.014, alloy);                                                     // seat post
    k.add(sideGeo('cySaddle', s => { s.moveTo(-0.08, 1.04); s.quadraticCurveTo(-0.12, 1.08, -0.2, 1.08); s.lineTo(-0.32, 1.07); s.quadraticCurveTo(-0.34, 1.03, -0.3, 1.02); s.lineTo(-0.08, 1.02); }, 0.13, 0.025), black);
    // drivetrain: chainring, cranks, pedals, chain, rear cassette
    const ring = k.add(tor(0.09, 0.012, 4, 18), black, 0.06, 0.3, 0); ring.rotation.y = Math.PI / 2;
    for (const sx of [-1, 1]) { tube(k, [sx * 0.07, 0.3, 0], [sx * 0.08, 0.3 - sx * 0.16, sx * 0.04], 0.012, alloy); k.add(rbox(0.09, 0.02, 0.07, 0.008), black, sx * 0.13, 0.3 - sx * 0.16, sx * 0.04); }
    tube(k, [0.06, 0.39, 0], [0.06, R + 0.05, ZR], 0.006, M(0x3a3a3a)); tube(k, [0.06, 0.21, 0], [0.06, R - 0.05, ZR], 0.006, M(0x3a3a3a));
    const cas = k.add(cyl(0.05, 0.05, 0.03, 10), alloy, 0.05, 0, 0, rw); cas.rotation.z = Math.PI / 2;
    k.lamp(0.05, 0.03, 0, 0.82, -0.2);                                                              // rear reflector
    // front: suspension fork, stem, riser bar, grips
    const fork = [fw];
    for (const sx of [-1, 1]) { fork.push(tube(k, [sx * 0.055, R, ZF], [sx * 0.055, 0.6, 0.5], 0.016, black)); fork.push(tube(k, [sx * 0.055, 0.6, 0.5], [sx * 0.05, 0.78, 0.44], 0.022, alloy)); }
    fork.push(k.add(rbox(0.15, 0.04, 0.06, 0.015), black, 0, 0.78, 0.44));
    fork.push(tube(k, [0, 0.92, 0.38], [0, 0.98, 0.43], 0.016, black));
    fork.push(tube(k, [-0.34, 1.0, 0.42], [0.34, 1.0, 0.42], 0.011, black));
    for (const sx of [-1, 1]) { const gp = k.add(cyl(0.018, 0.018, 0.1, 6), black, sx * 0.3, 1.0, 0.42); gp.rotation.z = Math.PI / 2; fork.push(gp); }
    forkPivot(k, 0.92, 0.38, 0.3, fork);
    riders(k, 1.02, -0.22, null, 0.15, 0);
    return two(k, 1.8, 'cycle', 'cycle', [0, 1.02, -0.22, 'bike']);
  }

  // Traffic 'bike' is a mix of the motorbike types (kind stays 'bike' so existing PARAMS / SEATS keep working);
  // bike('scooter') etc. builds one specific type. Pedal cycles are never mixed in (too slow for bike traffic).
  const TWO = { splendor, starCity, activa, scooter, classic, classic2, sport, faired, cycle, hayabusa, s1000rr, r1250gsa, r1300gsa };
  const BIKE_MIX = [...Array(5)].flatMap(() => ['splendor', 'splendor', 'starCity', 'starCity', 'scooter', 'activa', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired']).concat(['hayabusa', 's1000rr', 'r1250gsa', 'r1300gsa']);
  function activa() { return scooter(true); }
  function starCity() { return splendor(true); }
  function bike(type) {
    const t = TWO[type] ? type : BIKE_MIX[Math.random() * BIKE_MIX.length | 0];
    const v = TWO[t](); v.kind = 'bike'; return v;
  }

  // shared car body builder: lower body with arches, cabin, window glass, bumpers
  function carShell(k, o, p) {
    k.add(sideHQ(o.key + 'Low', o.low, o.W, 0.05), p);
    const cy = shapeMinY(o.cab);
    pendingLean = { y: cy, hx: (o.W - 0.14) / 2, lean: LEAN.suv };
    k.add(loftGeo(o.key + 'Cab', o.cab, o.W - 0.14, { rt: 0.09, rb: 0.01, plan: 0.16, crown: 0.03, bulge: 0, lean: LEAN.suv, leanY: cy, step: 0.11 }), p);
    k.add(sideGeo(o.key + 'WS', o.ws, o.W - 0.26, 0.012), glass, 0, 0.05, 0.05);
    k.add(sideGeo(o.key + 'RW', o.rw, o.W - 0.3, 0.012), glass, 0, 0.03, -0.06);
    for (const sx of [-1, 1]) {
      const gl = k.add(sideShape(o.key + 'Win', o.win), glass, sx * ((o.W - 0.14) / 2 + 0.004), 0, 0);
      for (const bz of o.pillars) { const pl = k.add(sideShape(o.key + 'Pil' + bz, [[bz - 0.05, o.win[0][1] - 0.02], [bz + 0.05, o.win[0][1] - 0.02], [bz + 0.04, o.roofY], [bz - 0.06, o.roofY]]), M(0x111111), sx * ((o.W - 0.14) / 2 + 0.006), 0, 0); }
      // wheel-arch liners
      if (sx > 0) for (const wz of o.wheelsZ) { const ln = k.add(G('liner' + o.arch + o.W, () => new THREE.CylinderGeometry(o.arch - 0.01, o.arch - 0.01, o.W * 0.84, 10, 1, true, -Math.PI / 2, Math.PI)), plasticIn, 0, o.archY, wz); ln.rotation.z = Math.PI / 2; ln.rotation.x = Math.PI; ln.castShadow = false; }
      // door shut lines and handles
      for (const hz of o.handles) k.add(rbox(0.12, 0.03, 0.03, 0.012), chrome, sx * (o.W / 2 + 0.005), o.handleY, hz);
    }
  }

  // ---------------------------------------------------------------- Indian car range: shared helpers
  // Shared env-mapped materials come from fortunerMats() (chrome, piano black, glass, cladding, cabin ...);
  // body paint is cached per colour, so every car of one colour shares one material.
  const pickR = a => a[Math.random() * a.length | 0];
  function cPaint(hex) {
    const key = 'cp' + hex; if (mats[key]) return mats[key];
    const env = fortunerMats().paint.envMap;
    return (mats[key] = new THREE.MeshPhongMaterial(Object.assign({ color: hex, specular: 0x9aa4ae, shininess: 95 },
      env ? { envMap: env, reflectivity: 0.15, combine: THREE.MixOperation } : {})));
  }
  // flat strip on a vehicle flank (plane x = const) from a = [z, y] to b = [z, y]: pillars, trims, seals
  function slab(k, m, x, a, b, w, t) {
    const dz = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dz, dy);
    const o = k.add(rbox(t, w, L, Math.min(w, t) * 0.45), m, x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
    o.rotation.x = -Math.atan2(dy, dz); return o;
  }
  // thin panel / decal in the side plane (z, y), visible from both sides
  const sidePanel = (k, key, pts, m, x, t) => k.add(sideGeo(key, s => { s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); }, t || 0.012, 0), m, x, 0, 0);
  // car wheel: tyre + rim. style 'alloy' (n spokes, machined lip) or 'steel' (painted disc + hub cap)
  function carWheel(k, F, R, Wd, x, z, style, n, rimM) {
    const side = Math.sign(x), wg = new THREE.Group(); wg.position.set(x, R, z); wg.userData.radius = R; wg.name = 'wheel';
    const low = style !== 'steel', rimR = R * (low ? 0.67 : 0.57), face = side * Wd * 0.36;
    k.add(tyreGeo(R, Wd, low), rubber, 0, 0, 0, wg);
    const barrel = k.add(cyl(rimR, rimR, Wd * 0.8, 16, true), F.gun, 0, 0, 0, wg); barrel.rotation.z = Math.PI / 2;
    if (style === 'steel') {
      const d = k.add(G('cwDisc' + rimR, () => new THREE.CircleGeometry(rimR, 16)), rimM || F.silver, face * 0.5, 0, 0, wg); d.rotation.y = side * Math.PI / 2;
      const cap = k.add(cyl(rimR * 0.78, rimR * 0.84, 0.035, 16), rimM || F.silver, face, 0, 0, wg); cap.rotation.z = Math.PI / 2;
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, sl = k.add(rbox(0.012, 0.03, 0.06, 0.008), F.gun, face + side * 0.014, Math.sin(a) * rimR * 0.55, Math.cos(a) * rimR * 0.55, wg); sl.rotation.x = -a; }
      const ctr = k.add(cyl(0.045, 0.045, 0.012, 12), F.black, face + side * 0.018, 0, 0, wg); ctr.rotation.z = Math.PI / 2;
    } else if (typeof style === 'object') {
      alloyFace(k, F, wg, rimR, Wd, side, Object.assign({}, style, style.dark ? { mat: F.gun, lip: F.alloy, win: F.black } : {}));
    } else {
      const dish = k.add(G('cwDish' + rimR, () => new THREE.CircleGeometry(rimR * 0.97, 16)), F.gun, face * 0.4, 0, 0, wg); dish.rotation.y = side * Math.PI / 2;
      const lip = k.add(tor(rimR, 0.01, 4, 24), F.alloy, face * 1.1, 0, 0, wg); lip.rotation.y = Math.PI / 2;
      const sg = G('cwSp' + rimR, () => { const g = new THREE.BoxGeometry(0.022, rimR * 0.86, 0.05); g.translate(0, rimR * 0.5, 0); return g; });
      for (let i = 0; i < (n || 5); i++) { const sp = k.add(sg, rimM || F.alloy, face, 0, 0, wg); sp.rotation.x = i / (n || 5) * Math.PI * 2; }
      const hub = k.add(cyl(0.07, 0.08, 0.04, 14), rimM || F.alloy, face, 0, 0, wg); hub.rotation.z = Math.PI / 2;
      const cap = k.add(cyl(0.035, 0.035, 0.012, 12), F.black, face + side * 0.022, 0, 0, wg); cap.rotation.z = Math.PI / 2;
    }
    const disc = k.add(cyl(rimR * 0.78, rimR * 0.78, 0.02, 16), M(0x8d9298), -side * 0.03, 0, 0, wg); disc.rotation.z = Math.PI / 2;
    k.g.add(wg); k.wheels.push(wg); return wg;
  }
  // door mirror: black base on the door, body-colour cap, glass
  function carMirror(k, F, p, sx, y, z) {
    const mg = new THREE.Group(); mg.position.set(sx, y, z); k.g.add(mg); const s = Math.sign(sx);
    k.add(rbox(0.06, 0.05, 0.12, 0.02), F.clad, s * 0.02, -0.02, 0, mg);
    k.add(rbox(0.18, 0.12, 0.09, 0.035), p, s * 0.11, 0.03, -0.01, mg);
    k.add(rbox(0.15, 0.1, 0.01, 0.025), F.glass, s * 0.11, 0.03, -0.06, mg);
  }
  // wheel-arch liners (dark inside of the arches)
  function liners(k, A, AY, W, zs) {
    for (const wz of zs) { const ln = k.add(G('lnr' + A + W, () => new THREE.CylinderGeometry(A - 0.01, A - 0.01, W * 0.97, 12, 1, true, -Math.PI / 2, Math.PI)), plasticIn, 0, AY, wz); ln.rotation.z = Math.PI / 2; ln.rotation.x = Math.PI; ln.castShadow = false; }
  }
  // dark cabin box with head rests, so glass reads as a real interior
  function cabin(k, F, W, y, z, L, rows, hy) {
    k.add(rbox(W - 0.32, 0.42, L, 0.05), F.cabin, 0, y - 0.17, z);
    for (const sx of [-1, 1]) for (const hz of rows) k.add(rbox(0.22, 0.15, 0.08, 0.04), M(0x26272b), sx * 0.36, hy, hz);
  }
  const headMesh = (k, geom, x, y, z, parent) => { const m = k.add(geom, k.headM, x, y, z, parent); m.castShadow = false; k.head.push(m); return m; };
  const tailMesh = (k, geom, x, y, z, parent) => { const m = k.add(geom, k.tailM, x, y, z, parent); m.castShadow = false; k.tail.push(m); return m; };

  // ---------------------------------------------------------------- Bolero-style utility (3995 x 1745 x 1880, 215/75 R15)
  // Slab sides, flat bonnet, upright screen, body-colour pillars, black cladding band and squared arch flares,
  // vertical chrome grille slats between rectangular lamps, spare wheel on the side-hinged tail door.
  function bolero() {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI;
    const p = cPaint(pickR([0xf4f4f1, 0xf4f4f1, 0xf4f4f1, 0xb9bec4, 0x141518, 0x7a7d80, 0x5d1218]));
    const W = 1.745, R = 0.36, A = 0.43, FW = 1.34, RW = -1.34, SY = 0.42, ZF = 1.99, ZR = -2.0, GW = W - 0.14;
    add(sideHQ('bolLow', s => {
      s.moveTo(ZR + 0.04, SY); s.lineTo(RW - A, SY); s.absarc(RW, SY, A, PI, 0, true);
      s.lineTo(FW - A, SY); s.absarc(FW, SY, A, PI, 0, true); s.lineTo(ZF - 0.03, SY);
      s.lineTo(ZF, 0.48); s.lineTo(ZF, 1.06); s.quadraticCurveTo(ZF, 1.12, ZF - 0.07, 1.125);   // upright slab face
      s.lineTo(0.92, 1.165);                                                                    // flat bonnet
      s.lineTo(ZR + 0.04, 1.19); s.quadraticCurveTo(ZR, 1.19, ZR, 1.14); s.lineTo(ZR, SY + 0.04);
    }, W, 0.04), p);
    add(sideHQ('bolGl', s => { s.moveTo(0.93, 1.16); s.lineTo(0.68, 1.79); s.lineTo(-1.93, 1.8); s.lineTo(-1.96, 1.2); s.lineTo(-1.96, 1.16); }, GW, 0.02), F.glass);
    add(rbox(W - 0.1, 0.07, 2.66, 0.03), p, 0, 1.825, -0.65);                                  // flat roof with gutter overhang
    add(rbox(W - 0.06, 0.02, 2.62, 0.01), p, 0, 1.79, -0.65);
    cabin(k, F, W, 1.15, -0.5, 2.6, [-0.2, -1.1], 1.48);
    for (const sx of [-1, 1]) {
      const gx = sx * (GW / 2 + 0.006);
      slab(k, p, gx, [0.93, 1.17], [0.68, 1.8], 0.09, 0.02);                 // body-colour A, B, C, D pillars
      slab(k, p, gx, [-0.08, 1.17], [-0.08, 1.8], 0.12, 0.02);
      slab(k, p, gx, [-1.05, 1.17], [-1.05, 1.8], 0.12, 0.02);
      slab(k, p, gx, [-1.88, 1.17], [-1.88, 1.8], 0.16, 0.02);
      // black cladding band, squared arch flares, side step
      add(rbox(0.035, 0.2, FW - RW - 2 * A - 0.02, 0.02), F.clad, sx * (W / 2 + 0.008), 0.55, 0);
      add(rbox(0.035, 0.2, 0.42, 0.02), F.clad, sx * (W / 2 + 0.008), 0.55, ZR + 0.25);
      add(rbox(0.035, 0.2, 0.22, 0.02), F.clad, sx * (W / 2 + 0.008), 0.55, ZF - 0.15);
      for (const wz of [FW, RW]) {
        add(rbox(0.06, 0.06, 2 * A + 0.14, 0.02), F.clad, sx * (W / 2 + 0.02), SY + A + 0.02, wz);
        for (const dz of [-1, 1]) add(rbox(0.06, A + 0.06, 0.07, 0.02), F.clad, sx * (W / 2 + 0.02), SY + A / 2 - 0.02, wz + dz * (A + 0.04));
      }
      add(rbox(0.16, 0.04, 1.3, 0.015), F.clad, sx * (W / 2 + 0.06), 0.4, 0);
      for (const z of [0.9, -0.08, -1.05]) add(rbox(0.008, 0.6, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 - 0.002), 0.88, z);
      for (const z of [0.3, -0.7]) add(rbox(0.03, 0.035, 0.15, 0.012), F.clad, sx * (W / 2 + 0.005), 1.08, z);
      // roof rails, black mirrors on the doors
      add(rbox(0.04, 0.04, 2.3, 0.015), F.clad, sx * 0.72, 1.89, -0.7);
      for (const z of [0.3, -0.7, -1.75]) add(rbox(0.05, 0.05, 0.08, 0.015), F.clad, sx * 0.72, 1.87, z);
      carMirror(k, F, F.clad, sx * (W / 2 - 0.02), 1.22, 0.8);
      // rectangular headlamps with chrome bezel, indicator under, vertical tail lamps
      add(rbox(0.36, 0.24, 0.05, 0.03), F.chrome, sx * 0.64, 0.93, ZF - 0.01);
      const h = k.lamp(0.31, 0.19, sx * 0.64, 0.93, ZF + 0.02, true); h.lens.rotation.copy(h.rotation);
      add(rbox(0.16, 0.05, 0.02, 0.012), F.amber, sx * 0.64, 0.76, ZF + 0.005);
      const t = k.lamp(0.13, 0.4, sx * 0.79, 1.0, ZR - 0.005, false); t.lens.rotation.copy(t.rotation);
      add(rbox(0.15, 0.42, 0.04, 0.02), F.black, sx * 0.79, 1.0, ZR + 0.015);
    }
    liners(k, A, SY, W, [FW, RW]);
    // signature grille: chrome surround, seven vertical chrome slats on black
    add(facePoly('bolGrC', [[-0.43, 0.8], [0.43, 0.8], [0.43, 1.06], [-0.43, 1.06]], 0.04, 0.01), F.chrome, 0, 0, ZF);
    add(facePoly('bolGrB', [[-0.39, 0.83], [0.39, 0.83], [0.39, 1.03], [-0.39, 1.03]], 0.02), F.black, 0, 0, ZF + 0.02);
    for (let i = 0; i < 7; i++) add(rbox(0.035, 0.19, 0.03, 0.01), F.chrome, -0.33 + i * 0.11, 0.93, ZF + 0.03);
    add(sph(0.045, 12, 8), F.chrome, 0, 1.0, ZF + 0.04).scale.set(1.3, 0.85, 0.3);
    add(rbox(0.9, 0.035, 0.7, 0.02), p, 0, 1.165, 1.45);                                      // bonnet bulge
    // black bumpers, plate, tow hook
    add(rbox(1.84, 0.22, 0.16, 0.05), F.clad, 0, 0.53, ZF + 0.05);
    add(rbox(1.84, 0.22, 0.16, 0.05), F.clad, 0, 0.53, ZR - 0.05);
    for (const sx of [-1, 1]) add(G('fogD', () => new THREE.CircleGeometry(0.045, 14)), F.drl, sx * 0.72, 0.54, ZF + 0.135);
    plate(k, ZF + 0.135, 0.58, true); plate(k, ZR - 0.005, 0.8, false);
    // tail door: hinge, handle, spare wheel with black cover
    add(rbox(0.04, 0.6, 0.03, 0.01), F.chrome, -0.2, 0.86, ZR - 0.02);
    const sp = new THREE.Group(); sp.position.set(0.1, 1.08, ZR - 0.13); k.g.add(sp);
    k.add(tyreGeo(0.36, 0.215, false), rubber, 0, 0, 0, sp).rotation.y = PI / 2;
    k.add(cyl(0.37, 0.37, 0.07, 18), F.clad, 0, 0, -0.08, sp).rotation.x = PI / 2;
    k.add(cyl(0.12, 0.12, 0.08, 12), F.chrome, 0, 0, -0.1, sp).rotation.x = PI / 2;
    const wl = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, 0.25, 1.2, 0.95); wl.rotation.x = -0.3;
    const wr = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, -0.35, 1.2, 0.95); wr.rotation.x = -0.3;
    add(rbox(W * 0.86, 0.16, 3.6, 0.04), F.clad, 0, 0.36, 0);
    for (const [x, z] of [[-0.77, FW], [0.77, FW], [-0.77, RW], [0.77, RW]]) carWheel(k, F, R, 0.215, x, z, 'steel', 0, F.silver);
    person(k, 0.38, 0.88, -0.1, { outfit: Math.random() < 0.6 ? 'shirt' : 'lungi', color: 0xffffff }, 'car');
    openBody(k, F, p, 'bol', ZR, { W, belt: 1.15, doors: [[[0.9, 1.13], [0.9, 0.62], [-0.02, 0.62], [-0.02, 1.13]], [[-0.02, 1.13], [-0.02, 0.62], [-0.95, 0.62], [-0.95, 1.13]]], yTop: 1.8, pane: [(W - 0.12) / 2, 1.58], hoodY: 0.8, hood: [1.02, ZF - 0.16, W / 2 - 0.2], boot: { hw: 0.6, y0: 0.75, y1: 1.14, side: true } });
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR + 0.2, kind: 'car', type: 'bolero', seat: [0.38, 0.88, -0.1, 'car'] };
  }

  // ---------------------------------------------------------------- Ace-style mini truck (3800 x 1500 x 1850, 145 R12)
  // Cab-forward box cab over the front wheels, flat steel deck with drop sides, often a few sacks on board.
  function ace() {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI;
    const p = cPaint(0xf4f4f1), deck = cPaint(pickR([0x9aa0a6, 0xf4f4f1, 0x2c5aa0, 0xd1b21c])), band = cPaint(pickR([0x1d4e9e, 0xc8102e, 0x2e7d32]));
    const W = 1.5, R = 0.27, A = 0.33, FW = 1.05, RW = -1.05, ZF = 1.6, ZR = -2.2, GW = W - 0.1;
    add(sideHQ('aceCab', s => {
      s.moveTo(0.2, 0.55); s.lineTo(FW - A, 0.55); s.lineTo(FW - A, R + 0.04); s.absarc(FW, R + 0.04, A, PI, 0, true);
      s.lineTo(ZF - 0.04, 0.42); s.quadraticCurveTo(ZF, 0.42, ZF, 0.48); s.lineTo(ZF, 1.06);
      s.lineTo(ZF - 0.06, 1.12); s.lineTo(ZF - 0.3, 1.78); s.quadraticCurveTo(ZF - 0.36, 1.86, ZF - 0.5, 1.86);
      s.lineTo(0.3, 1.86); s.quadraticCurveTo(0.2, 1.86, 0.2, 1.76); s.lineTo(0.2, 0.55);
    }, W, 0.06), p);
    const ws = add(rbox(GW - 0.08, 0.66, 0.02, 0.02), F.glass, 0, 1.45, ZF - 0.18 + 0.012); ws.rotation.x = -Math.atan2(0.24, 0.66);
    const rwin = add(rbox(GW - 0.3, 0.4, 0.02, 0.02), F.glass, 0, 1.55, 0.195);
    for (const sx of [-1, 1]) {
      sidePanel(k, 'aceWin', [[0.36, 1.16], [ZF - 0.14, 1.16], [ZF - 0.36, 1.74], [0.36, 1.74]], F.glass, sx * (W / 2 + 0.004), 0.01);
      for (const z of [0.3, ZF - 0.14]) add(rbox(0.01, 0.62, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 + 0.002), 0.85, z);
      sidePanel(k, 'aceBand', [[0.22, 0.95], [ZF - 0.02, 0.95], [ZF - 0.02, 1.03], [0.22, 1.03]], band, sx * (W / 2 + 0.003), 0.008);
      add(rbox(0.03, 0.035, 0.12, 0.012), F.clad, sx * (W / 2 + 0.006), 1.05, 0.45);
      // square lamps in the cab corners, indicator, mirrors on stalks
      const h = k.lamp(0.2, 0.15, sx * 0.55, 0.8, ZF + 0.012, true); h.lens.rotation.copy(h.rotation);
      add(rbox(0.23, 0.18, 0.03, 0.02), F.black, sx * 0.55, 0.8, ZF);
      add(rbox(0.08, 0.05, 0.02, 0.01), F.amber, sx * 0.55, 0.66, ZF + 0.008);
      const st = add(cyl(0.012, 0.012, 0.3, 5), F.clad, sx * (W / 2 + 0.1), 1.35, ZF - 0.3); st.rotation.z = sx * 1.1;
      add(rbox(0.04, 0.24, 0.13, 0.02), F.clad, sx * (W / 2 + 0.22), 1.35, ZF - 0.3);
      // deck sides, rear lamps on the tail bar
      add(rbox(0.04, 0.36, 2.36, 0.01), deck, sx * (W / 2 - 0.02), 0.98, (ZR + 0.16) / 2);
      for (const z of [-0.2, -1.0, -1.8]) add(rbox(0.05, 0.36, 0.04, 0.005), deck, sx * (W / 2 - 0.005), 0.98, z);
      const t = k.lamp(0.14, 0.09, sx * 0.55, 0.62, ZR - 0.03, false); t.lens.rotation.copy(t.rotation);
      add(rbox(0.04, 0.16, 0.4, 0.01), rubber, sx * 0.62, 0.36, RW - 0.35);                   // mud flaps
    }
    // deck floor, headboard with guard bars, tailgate, chassis rails, rear bar
    add(rbox(W, 0.06, 2.4, 0.01), deck, 0, 0.78, (ZR + 0.16) / 2 + 0.02);
    add(rbox(W, 0.36, 0.04, 0.01), deck, 0, 0.98, ZR + 0.02);
    for (let i = 0; i < 5; i++) add(rbox(0.03, 0.7, 0.03, 0.01), F.clad, -0.6 + i * 0.3, 1.2, 0.12);
    add(rbox(W, 0.04, 0.04, 0.01), F.clad, 0, 1.55, 0.12);
    for (const sx of [-1, 1]) add(rbox(0.08, 0.12, 3.4, 0.01), F.clad, sx * 0.4, 0.62, -0.5);
    add(rbox(1.3, 0.1, 0.08, 0.01), F.clad, 0, 0.62, ZR - 0.02);
    // face: black grille slot, bumper, wipers, plates
    add(rbox(0.6, 0.1, 0.02, 0.02), F.black, 0, 0.82, ZF + 0.01);
    for (let i = 0; i < 3; i++) add(rbox(0.56, 0.012, 0.01, 0.004), F.gun, 0, 0.79 + i * 0.03, ZF + 0.022);
    add(sph(0.04, 12, 8), F.chrome, 0, 0.95, ZF + 0.01).scale.set(1.3, 0.85, 0.3);
    add(rbox(1.5, 0.14, 0.1, 0.03), F.clad, 0, 0.5, ZF + 0.03);
    const wl = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, 0.25, 1.17, ZF - 0.05); wl.rotation.z = 0.15;
    const wr = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, -0.32, 1.17, ZF - 0.05); wr.rotation.z = 0.15;
    plate(k, ZF + 0.085, 0.5, true); plate(k, ZR - 0.07, 0.62, false);
    liners(k, A, R + 0.04, W, [FW]);
    // load: a few jute sacks
    if (Math.random() < 0.6) for (let i = 0; i < 4 + (Math.random() * 4 | 0); i++) {
      const s = add(rbox(0.5, 0.26, 0.7, 0.12), M(0xc8b48a), (i % 2 ? 0.32 : -0.32), 0.94 + (i >= 4 ? 0.24 : 0), -0.35 - Math.floor(i % 4 / 2) * 0.8); s.rotation.y = (Math.random() - 0.5) * 0.3;
    }
    for (const [x, z] of [[-0.62, FW], [0.62, FW], [-0.62, RW], [0.62, RW]]) carWheel(k, F, R, 0.15, x, z, 'steel', 0, F.silver);
    person(k, 0.32, 1.02, 0.8, { outfit: Math.random() < 0.5 ? 'shirt' : 'lungi', color: 0x8fa9c4 }, 'car');
    openBody(k, F, p, 'ace', ZR, { W, belt: 1.25, doors: [[[ZF - 0.5, 1.24], [ZF - 0.5, 0.62], [.32, 0.62], [.32, 1.24]]] });
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR + 0.1, kind: 'car', type: 'ace', seat: [0.32, 1.02, 0.8, 'car'] };
  }


  // ---------------------------------------------------------------- sports cars (generic, unbranded: silhouettes only)
  // Built straight from lofted rounded sections (loftGeo): body, glass canopy and roof each one smooth mesh.
  // arches: centred on the axle, the body bottom follows them (real cut-outs) and the rounded bottom edge is the lip.
  const arches = (s, ZR, ZF, SY, FW, AF, RF, RW, AR, RR) => {
    s.moveTo(ZR + 0.14, SY); s.lineTo(RW - AR, SY); s.lineTo(RW - AR, RR); s.absarc(RW, RR, AR, Math.PI, 0, true); s.lineTo(RW + AR, SY);
    s.lineTo(FW - AF, SY); s.lineTo(FW - AF, RF); s.absarc(FW, RF, AF, Math.PI, 0, true); s.lineTo(FW + AF, SY);
  };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function sportsCar(S) {
    const k = kit(), F = fortunerMats(), add = k.add;
    const p = cPaint(pickR(S.colours));
    const { W, RF, RR, FW, RW, ZF, ZR, GW } = S;
    add(loftGeo(S.key + 'Body', S.low, W, Object.assign({ rt: 0.15, rb: 0.07, plan: 0.34, crown: S.crown || 0, bulge: 0.07, step: 0.09, hwz: S.hwz }, S.lowOpt || {})), p);
    const gy = shapeMinY(S.gl);
    pendingLean = { y: gy, hx: GW / 2, lean: S.lean };
    add(loftGeo(S.key + 'Glass', S.gl, GW, { rt: 0.07, rb: 0.01, plan: 0.22, crown: 0.015, bulge: 0, lean: S.lean, leanY: gy, drop: 0.06, step: 0.1 }), F.glass);
    add(loftGeo(S.key + 'Top', S.roof, GW + 0.02, { rt: 0.09, rb: 0.01, plan: 0.22, crown: 0.03, bulge: 0, lean: S.lean, leanY: gy, step: 0.1 }), p);
    add(rbox(GW - 0.25, 0.3, S.cabL, 0.05), F.cabin, 0, gy + 0.04, S.cabZ);
    for (const sx of [-1, 1]) for (const hz of S.heads) add(rbox(0.22, 0.2, 0.08, 0.05), M(0x202124), sx * 0.36, gy + 0.22, hz);
    liners(k, S.AF, RF, W, [FW]); liners(k, S.AR, RR, W, [RW]);
    add(rbox(W * 0.8, 0.08, ZF - ZR - 0.7, 0.03), F.clad, 0, 0.17, (ZF + ZR) / 2);        // flat floor
    for (const sx of [-1, 1]) {
      carMirror(k, F, p, sx * (GW / 2 + 0.02), gy + 0.06, S.mirrorZ);
      add(rbox(0.03, 0.06, FW - RW - S.AF - S.AR - 0.1, 0.02), F.black, sx * (W / 2 - 0.035), SYof(S) + 0.06, (FW - S.AF + RW + S.AR) / 2);   // sill blade
    }
    S.details(k, F, p, add);
    plate(k, ZR - 0.012, S.plateY, false); plate(k, ZF + 0.005, S.platefY || 0.3, true);
    const wd = S.key === 'mus' ? [0.255, 0.275] : [0.245, 0.305];
    for (const sx of [-1, 1]) { carWheel(k, F, RF, wd[0], sx * (W / 2 - 0.13), FW, WHEELS[S.type]); carWheel(k, F, RR, wd[1], sx * (W / 2 - 0.15), RW, WHEELS[S.type]); }
    { const z1 = FW - S.AF - 0.06, z0 = z1 - 1.0; openBody(k, F, p, S.key, ZR, { W, belt: gy, doors: [[[z1, gy - 0.02], [z1, 0.3], [z0, 0.3], [z0, gy - 0.02]]], hoodY: 0.3, hood: [FW - 0.1, ZF - 0.2, W * 0.32] }); }
    person(k, S.seat[0], S.seat[1], S.seat[2], { outfit: 'shirt', color: pickR([0xffffff, 0x1b1b1b, 0x8fa9c4]) }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: Math.round((ZF - ZR) * 100) / 100, kind: 'car', type: S.type, seat: S.seat, snd: S.snd };
  }
  const SYof = S => S.SY || 0.18;
  const sideScoop = (k, F, key, pts, W) => { for (const sx of [-1, 1]) sidePanel(k, key, pts, F.black, sx * (W / 2 - 0.03), 0.05).userData.noLean = true; };
  // Italian mid-engine V8 berlinetta (F8-style): 4.61 x 1.98 x 1.21 m, wb 2.65, cab-forward canopy, short nose,
  // long engine deck, side intakes ahead of the rear wheels, twin round tail lamps each side, quad exhausts
  function berlinetta() {
    const W = 1.98, RF = 0.335, RR = 0.35, FW = 1.37, RW = -1.28, ZF = 2.28, ZR = -2.32, AF = 0.37, AR = 0.39, SY = 0.17;
    return sportsCar({ key: 'brl', type: 'berlinetta', snd: 'v8flat', W, RF, RR, FW, RW, ZF, ZR, AF, AR, SY, GW: 1.5, lean: 0.3, crown: -0.035,
      colours: [0xc4060f, 0xc4060f, 0xc4060f, 0xf5c400, 0xf2f2f0, 0x1a1c20, 0x23408e],
      hwz: z => 1 - 0.09 * smooth(1.4, ZF, z) - 0.03 * smooth(-0.2, 1.0, z) * (1 - smooth(1.4, ZF, z)),
      low: s => {
        arches(s, ZR, ZF, SY, FW, AF, RF, RW, AR, RR); s.lineTo(ZF - 0.2, 0.15);
        s.bezierCurveTo(ZF - 0.02, 0.15, ZF + 0.02, 0.3, ZF, 0.4);
        s.bezierCurveTo(ZF - 0.06, 0.58, ZF - 0.4, 0.66, 1.5, 0.71);
        s.bezierCurveTo(1.2, 0.76, 1.0, 0.82, 0.85, 0.86); s.lineTo(-0.6, 0.9);
        s.bezierCurveTo(-1.0, 0.92, -1.2, 1.0, -1.5, 1.0); s.bezierCurveTo(-1.9, 1.0, -2.2, 0.99, ZR + 0.02, 0.98);
        s.lineTo(ZR, 0.86); s.bezierCurveTo(ZR + 0.02, 0.6, ZR + 0.04, 0.4, ZR + 0.14, 0.3); s.lineTo(ZR + 0.14, SY);
      },
      gl: s => { s.moveTo(0.92, 0.84); s.bezierCurveTo(0.55, 1.02, 0.25, 1.17, -0.05, 1.19); s.bezierCurveTo(-0.5, 1.2, -0.9, 1.12, -1.38, 0.98); s.lineTo(-1.38, 0.86); },
      roof: s => { s.moveTo(0.3, 1.13); s.bezierCurveTo(0.1, 1.2, -0.3, 1.21, -0.55, 1.19); s.bezierCurveTo(-0.8, 1.16, -1.0, 1.1, -1.12, 1.06); s.lineTo(-0.5, 1.15); s.lineTo(0.28, 1.11); },
      cabL: 1.3, cabZ: -0.1, heads: [-0.45], mirrorZ: 0.55, plateY: 0.52, platefY: 0.3, seat: [0.38, 0.36, -0.3, 'car'],
      details: (k, F, p, add) => {
        sideScoop(k, F, 'brlScoop', [[-0.52, 0.46], [-0.8, 0.82], [-0.92, 0.8], [-0.88, 0.42]], W);
        add(facePoly('brlIntake', [[-0.62, 0.2], [0.62, 0.2], [0.7, 0.36], [-0.7, 0.36]], 0.06, 0.01), F.black, 0, 0, ZF - 0.04);
        for (const sx of [-1, 1]) {
          const h = k.lamp(0.34, 0.07, sx * 0.62, 0.6, ZF - 0.2, true); h.rotation.set(-0.75, sx * 0.55, 0); h.lens.rotation.copy(h.rotation);
          for (const lx of [0.52, 0.76]) { k.lamp(0.11, 0.11, sx * lx, 0.8, ZR - 0.006, false, true); add(tor(0.06, 0.012, 5, 16), F.black, sx * lx, 0.8, ZR - 0.004); }
          for (const ex of [0.12, 0.26]) { const e = add(cyl(0.045, 0.045, 0.1, 14, true), F.chrome, sx * ex, 0.36, ZR - 0.02); e.rotation.x = Math.PI / 2; }
        }
        add(rbox(1.5, 0.16, 0.12, 0.03), F.black, 0, 0.28, ZR + 0.05);                        // diffuser
        add(rbox(1.2, 0.03, 0.5, 0.012), F.black, 0, 1.0, -1.85).rotation.x = 0.03;          // engine-cover louvres
      } });
  }
  // American muscle fastback (Mustang-style): 4.79 x 1.92 x 1.38 m, wb 2.72, long bonnet with a forward-leaning shark
  // nose, fastback roof, short deck, three vertical tail-lamp bars a side, twin exhausts each side
  function muscle() {
    const W = 1.92, RF = 0.345, RR = 0.35, FW = 1.5, RW = -1.22, ZF = 2.36, ZR = -2.43, AF = 0.39, AR = 0.395, SY = 0.21;
    return sportsCar({ key: 'mus', type: 'muscle', snd: 'v8', W, RF, RR, FW, RW, ZF, ZR, AF, AR, SY, GW: 1.56, lean: 0.2, crown: 0.01,
      colours: [0x1d4e9e, 0xe2620f, 0x141518, 0xf2f2f0, 0xc8102e, 0x6b7a3a],
      hwz: z => 1 - 0.06 * smooth(1.6, ZF, z), lowOpt: { rt: 0.11, plan: 0.26 },
      low: s => {
        arches(s, ZR, ZF, SY, FW, AF, RF, RW, AR, RR); s.lineTo(ZF - 0.15, 0.22);
        s.bezierCurveTo(ZF - 0.05, 0.24, ZF - 0.02, 0.4, ZF - 0.04, 0.5); s.lineTo(ZF, 0.78);
        s.bezierCurveTo(ZF - 0.05, 0.87, ZF - 0.25, 0.9, 1.9, 0.92); s.lineTo(0.62, 1.0); s.lineTo(-1.7, 1.03);
        s.bezierCurveTo(-2.1, 1.045, -2.35, 1.04, ZR + 0.01, 1.02); s.lineTo(ZR, 0.78);
        s.bezierCurveTo(ZR, 0.5, ZR + 0.04, 0.3, ZR + 0.14, 0.24); s.lineTo(ZR + 0.14, SY);
      },
      gl: s => { s.moveTo(0.64, 0.98); s.bezierCurveTo(0.35, 1.15, 0.1, 1.33, -0.25, 1.37); s.bezierCurveTo(-0.7, 1.39, -1.0, 1.33, -1.25, 1.22); s.bezierCurveTo(-1.45, 1.14, -1.65, 1.06, -1.8, 1.02); s.lineTo(-1.8, 0.97); },
      roof: s => { s.moveTo(0.05, 1.32); s.bezierCurveTo(-0.15, 1.385, -0.5, 1.395, -0.8, 1.37); s.bezierCurveTo(-1.0, 1.35, -1.15, 1.28, -1.3, 1.21); s.lineTo(-0.8, 1.33); s.lineTo(0.04, 1.3); },
      cabL: 1.8, cabZ: -0.45, heads: [-0.3, -1.0], mirrorZ: 0.4, plateY: 0.55, platefY: 0.36, seat: [0.38, 0.48, -0.35, 'car'],
      details: (k, F, p, add) => {
        add(facePoly('musGr', [[-0.5, 0.44], [0.5, 0.44], [0.6, 0.75], [-0.6, 0.75]], 0.06, 0.012), F.black, 0, 0, ZF - 0.05);
        add(rbox(0.75, 0.05, 1.2, 0.025), p, 0, 0.965, 1.3).rotation.x = 0.06;                 // bonnet power bulge
        for (const sx of [-1, 1]) {
          const h = k.lamp(0.34, 0.1, sx * 0.64, 0.76, ZF - 0.06, true); h.rotation.set(-0.3, sx * 0.3, 0); h.lens.rotation.copy(h.rotation);
          add(rbox(0.36, 0.13, 0.04, 0.03), F.black, sx * 0.64, 0.76, ZF - 0.08).rotation.y = sx * 0.3;
          for (let i = 0; i < 3; i++) k.lamp(0.06, 0.2, sx * (0.46 + i * 0.1), 0.86, ZR - 0.006, false);
          add(rbox(0.36, 0.26, 0.03, 0.03), F.black, sx * 0.56, 0.86, ZR + 0.008);
          for (const ex of [0.55, 0.68]) { const e = add(cyl(0.045, 0.045, 0.12, 14, true), F.chrome, sx * ex, 0.3, ZR); e.rotation.x = Math.PI / 2; }
          sideScoop(k, F, 'musSide', [[-0.75, 0.56], [-0.95, 0.7], [-0.95, 0.55]], W);
        }
        add(rbox(1.3, 0.04, 0.18, 0.012), p, 0, 1.06, ZR + 0.1).rotation.x = -0.2;           // deck-lid spoiler lip
      } });
  }
  // wedge supercar (Lamborghini-style): 4.52 x 1.95 x 1.165 m, wb 2.62, one straight line from splitter to roof,
  // crisp creases (small radii), big triangular side intakes, Y-shaped lamps, centre exhausts
  function wedge() {
    const W = 1.95, RF = 0.34, RR = 0.355, FW = 1.36, RW = -1.26, ZF = 2.25, ZR = -2.27, AF = 0.38, AR = 0.4, SY = 0.15;
    return sportsCar({ key: 'wdg', type: 'wedge', snd: 'v10', W, RF, RR, FW, RW, ZF, ZR, AF, AR, SY, GW: 1.46, lean: 0.34, crown: -0.02,
      colours: [0x7dc242, 0xf5a300, 0xf2f2f0, 0x5a5f66, 0xe2620f, 0x141518],
      hwz: z => 1 - 0.13 * smooth(1.1, ZF, z), lowOpt: { rt: 0.08, rb: 0.05, plan: 0.22, bulge: 0.05 },
      low: s => {
        arches(s, ZR, ZF, SY, FW, AF, RF, RW, AR, RR); s.lineTo(ZF - 0.25, 0.13); s.lineTo(ZF, 0.28); s.lineTo(ZF - 0.03, 0.4);
        s.lineTo(0.85, 0.8); s.lineTo(-0.7, 0.86); s.lineTo(-1.5, 0.95); s.lineTo(ZR + 0.02, 0.98); s.lineTo(ZR, 0.5); s.lineTo(ZR + 0.14, 0.24); s.lineTo(ZR + 0.14, SY);
      },
      gl: s => { s.moveTo(0.9, 0.79); s.lineTo(-0.15, 1.15); s.lineTo(-0.65, 1.155); s.lineTo(-1.55, 0.95); s.lineTo(-1.55, 0.85); },
      roof: s => { s.moveTo(0.02, 1.1); s.lineTo(-0.15, 1.165); s.lineTo(-0.65, 1.17); s.lineTo(-0.95, 1.1); s.lineTo(-0.6, 1.14); s.lineTo(-0.15, 1.14); },
      cabL: 1.2, cabZ: -0.25, heads: [-0.55], mirrorZ: 0.5, plateY: 0.55, platefY: 0.24, seat: [0.38, 0.34, -0.35, 'car'],
      details: (k, F, p, add) => {
        sideScoop(k, F, 'wdgScoop', [[-0.25, 0.42], [-0.85, 0.86], [-0.88, 0.4]], W);
        add(facePoly('wdgIntake', [[-0.78, 0.15], [0.78, 0.15], [0.66, 0.3], [-0.66, 0.3]], 0.06, 0.008), F.black, 0, 0, ZF - 0.08);
        add(facePoly('wdgRear', [[-0.85, 0.25], [0.85, 0.25], [0.8, 0.7], [-0.8, 0.7]], 0.04, 0.008), F.black, 0, 0, ZR + 0.005);
        for (const sx of [-1, 1]) {
          const h = k.lamp(0.36, 0.05, sx * 0.6, 0.47, 1.95, true); h.rotation.set(-1.15, sx * 0.4, 0); h.lens.rotation.copy(h.rotation);
          for (const r of [0.5, -0.5]) { const t = k.lamp(0.28, 0.04, sx * 0.6, 0.8 + r * 0.08, ZR - 0.006, false); t.rotation.z = r * sx; t.lens.rotation.copy(t.rotation); }
          const t2 = k.lamp(0.2, 0.04, sx * 0.38, 0.8, ZR - 0.006, false); t2.lens.rotation.copy(t2.rotation);
        }
        for (const ex of [-0.1, 0.1]) { const e = add(cyl(0.06, 0.06, 0.1, 6, true), F.chrome, ex, 0.55, ZR - 0.01); e.rotation.x = Math.PI / 2; }
        add(rbox(1.4, 0.03, 0.4, 0.01), F.black, 0, 0.99, -1.95);                               // engine slats
      } });
  }
  // rear-engine flat-six coupe (911-style): 4.52 x 1.85 x 1.30 m, wb 2.45, frog-eye round lamps on raised front
  // fenders, low bonnet between them, one continuous flyline roof falling to a ducktail, wide rear hips, full-width tail bar
  function coupe911() {
    const W = 1.85, RF = 0.33, RR = 0.35, FW = 1.25, RW = -1.2, ZF = 2.12, ZR = -2.4, AF = 0.37, AR = 0.39, SY = 0.19;
    return sportsCar({ key: 'p91', type: 'coupe911', snd: 'flat6', W, RF, RR, FW, RW, ZF, ZR, AF, AR, SY, GW: 1.42, lean: 0.24, crown: -0.06,
      colours: [0xf2f2f0, 0xb9bec4, 0x141518, 0xe0a21a, 0x2f6fb5, 0x8a1520, 0x4c7a63],
      hwz: z => (0.94 + 0.06 * smooth(0.4, -0.9, z)) * (1 - 0.06 * smooth(1.5, ZF, z)), lowOpt: { rt: 0.16, plan: 0.4, bulge: 0.08 },
      low: s => {
        arches(s, ZR, ZF, SY, FW, AF, RF, RW, AR, RR); s.lineTo(ZF - 0.15, 0.2);
        s.bezierCurveTo(ZF - 0.03, 0.21, ZF + 0.01, 0.32, ZF, 0.45); s.bezierCurveTo(ZF - 0.02, 0.58, ZF - 0.12, 0.66, 1.8, 0.71);
        s.bezierCurveTo(1.3, 0.77, 0.9, 0.84, 0.55, 0.88); s.lineTo(-0.9, 0.93);
        s.bezierCurveTo(-1.4, 0.95, -1.9, 0.98, -2.25, 0.98); s.bezierCurveTo(-2.36, 0.975, ZR, 0.95, ZR, 0.88);
        s.lineTo(ZR, 0.6); s.bezierCurveTo(ZR, 0.35, ZR + 0.05, 0.25, ZR + 0.14, 0.22); s.lineTo(ZR + 0.14, SY);
      },
      gl: s => { s.moveTo(0.58, 0.87); s.bezierCurveTo(0.35, 1.05, 0.15, 1.24, -0.15, 1.29); s.bezierCurveTo(-0.6, 1.31, -1.0, 1.24, -1.4, 1.12); s.bezierCurveTo(-1.7, 1.03, -1.95, 0.99, -2.1, 0.96); s.lineTo(-2.1, 0.9); },
      roof: s => { s.moveTo(0.1, 1.25); s.bezierCurveTo(-0.1, 1.3, -0.5, 1.315, -0.8, 1.29); s.bezierCurveTo(-1.1, 1.26, -1.3, 1.19, -1.45, 1.12); s.lineTo(-0.8, 1.27); s.lineTo(0.08, 1.23); },
      cabL: 1.7, cabZ: -0.5, heads: [-0.2, -0.95], mirrorZ: 0.35, plateY: 0.55, platefY: 0.32, seat: [0.37, 0.44, -0.25, 'car'],
      details: (k, F, p, add) => {
        for (const sx of [-1, 1]) {
          const h = k.lamp(0.2, 0.2, sx * 0.6, 0.665, 1.9, true, true); h.rotation.x = -0.95; h.lens.rotation.copy(h.rotation);
          const ring = add(tor(0.105, 0.016, 6, 22), F.black, sx * 0.6, 0.665, 1.9); ring.rotation.x = -0.95;
          add(facePoly('p91Int' + sx, [[0, 0.24], [0.3, 0.24], [0.3, 0.36], [0.02, 0.38]].map(q => [sx * q[0], q[1]]), 0.05, 0.008), F.black, sx * 0.4, 0, ZF - 0.06);
          const e = add(cyl(0.05, 0.05, 0.1, 14, true), F.chrome, sx * 0.2, 0.3, ZR); e.rotation.x = Math.PI / 2; e.scale.z = 0.7;
        }
        k.lamp(1.5, 0.045, 0, 0.84, ZR - 0.006, false);                                          // full-width tail bar
        for (const sx of [-1, 1]) k.lamp(0.22, 0.08, sx * 0.62, 0.78, ZR - 0.005, false);
        add(rbox(1.1, 0.025, 0.36, 0.01), F.black, 0, 0.995, -2.1).rotation.x = 0.05;          // engine-lid grille
        add(rbox(1.2, 0.03, 0.2, 0.012), p, 0, 1.0, ZR + 0.14).rotation.x = -0.25;              // ducktail
      } });
  }

  // ---------------------------------------------------------------- the REAL Crysta (crysta.js / crysta-body.js) as a second, parkable instance
  // buildCrystaShell writes its animated handles into crysta.js globals; swap fresh ones in for the build and restore
  // the player's afterwards. No interior (dark cabin box instead), no NOS flames.
  // shellFn: buildCrystaShell (the player's car shape) or buildCrystaShell2023; type names the model; cols: paint choices
  function crystaWith(shellFn, type, cols) {
    if (typeof shellFn !== 'function' || typeof buildCrystaWheel !== 'function') return mpv();
    const k = kit(), F = fortunerMats();
    const save = { hoodMesh, trunkMesh, sunroofMesh, doorMeshes, mirrorMeshes, wiperMeshes, frontHeadlights, rearBrakeLights, nosFlameJets };
    let chassis = new THREE.Group();
    try {
      doorMeshes = {}; mirrorMeshes = {}; wiperMeshes = []; frontHeadlights = []; rearBrakeLights = []; nosFlameJets = [];
      const env = crystaEnvMap();
      const Mx = { paint: new THREE.MeshPhongMaterial({ color: pickR(cols), specular: 0xb8c2cc, shininess: 110, envMap: env, reflectivity: 0.16, combine: THREE.MixOperation }),
        pianoBlack: F.black, chrome: F.chrome, glass: F.glass };
      shellFn(chassis, Mx, typeof createLicensePlateTexture === 'function' ? createLicensePlateTexture() : null);
      for (const f of nosFlameJets) if (f.parent) f.parent.remove(f);
      frontHeadlights.forEach(m => { if (m.isMesh) k.head.push(m); });
      rearBrakeLights.forEach(m => { if (m.isMesh) k.tail.push(m); });
      for (const dm of Object.values(doorMeshes)) k.parts.doors.push({ mesh: dm.group, hingeSide: 'front', side: dm.isLeft ? -1 : 1, axis: 'y', open: dm.isLeft ? 0.95 : -0.95 });
      if (hoodMesh) k.parts.hood = { mesh: hoodMesh, axis: 'x', open: -0.85 }; if (trunkMesh) k.parts.boot = { mesh: trunkMesh, hingeSide: 'top', axis: 'x', open: 1.1 };
      if (sunroofMesh) k.parts.sunroof = { mesh: sunroofMesh, slide: -0.5, z0: sunroofMesh.position.z, y0: sunroofMesh.position.y, lift: 0.03 };
    } finally { hoodMesh = save.hoodMesh; trunkMesh = save.trunkMesh; sunroofMesh = save.sunroofMesh; doorMeshes = save.doorMeshes; mirrorMeshes = save.mirrorMeshes;
      wiperMeshes = save.wiperMeshes; frontHeadlights = save.frontHeadlights; rearBrakeLights = save.rearBrakeLights; nosFlameJets = save.nosFlameJets; }
    k.g.add(chassis);
    k.add(rbox(1.5, 0.45, 2.6, 0.05), F.cabin, 0, 1.05, -0.4);
    const R = typeof wheelRadius === 'number' ? wheelRadius : 0.38, Wd = typeof wheelWidth === 'number' ? wheelWidth : 0.24, CW = typeof carWidth === 'number' ? carWidth : 1.83;
    for (const [x, z] of [[-CW / 2 - 0.02, 1.38], [CW / 2 + 0.02, 1.38], [-CW / 2 - 0.02, -1.37], [CW / 2 + 0.02, -1.37]]) {
      const w = buildCrystaWheel(x > 0 ? 1 : -1, R, Wd), wg = w.spin;
      wg.position.set(x, R, z); wg.userData.radius = R; wg.name = 'wheel'; k.g.add(wg); k.wheels.push(wg);
      w.fixed.position.set(x, R, z); k.g.add(w.fixed);
    }
    person(k, 0.4, 0.86, 0.0, { outfit: 'shirt', color: 0xffffff }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.735, kind: 'car', type, seat: [0.4, 0.86, 0.0, 'car'] };
  }
  const CRYSTA_COLS = [0xf4f4f0, 0xf4f4f0, 0x9aa0a6, 0x2b2d31, 0x6e1a1e];
  function crysta() { return crystaWith(typeof buildCrystaShell === 'function' ? buildCrystaShell : null, 'crysta', CRYSTA_COLS); }
  // 2023 facelift shell (crysta-body-2023.js); the old shell if that file is not loaded. col: a paint hex, default white
  function crysta2023(col) { return crystaWith(typeof buildCrystaShell2023 === 'function' ? buildCrystaShell2023 : typeof buildCrystaShell === 'function' ? buildCrystaShell : null, 'crysta2023', typeof col === 'number' ? [col] : [0xf4f4f0, 0xf4f4f0, 0xf4f4f0].concat(CRYSTA_COLS)); }
  // ---------------------------------------------------------------- ladder-frame Indian utilities on one builder
  // Dimensions are the published ones: length, width, height, wheelbase (mm in each comment).
  function utility(o) {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI, p = cPaint(pickR(o.cols));
    const { key, W, R, A, FW, RW, SY, ZF, ZR, H, belt } = o, GW = W - 0.16, wx = W / 2 - 0.13;
    const low = sideHQ(key + 'Low', s => {
      s.moveTo(ZR + 0.06, SY); s.lineTo(RW - A, SY); s.absarc(RW, SY, A, PI, 0, true);
      s.lineTo(FW - A, SY); s.absarc(FW, SY, A, PI, 0, true); s.lineTo(ZF - 0.08, SY);
      o.nose(s); s.lineTo(ZR + 0.04, belt + 0.03); s.quadraticCurveTo(ZR, belt + 0.03, ZR, belt - 0.03); s.lineTo(ZR, SY + 0.05);
    }, W, 0.08); add(low, p); const c = { k, F, p, d: decals(k, key, [low]), add, key, ZR };
    add(sideHQ(key + 'Gl', o.glass, GW, 0.025), F.glass);
    add(sideHQ(key + 'Roof', o.roof, W - 0.12, 0.04), o.blackRoof ? F.black : p);
    cabin(k, F, W, belt, o.cz, o.cl, o.rows, belt + 0.35);
    for (const sx of [-1, 1]) {
      const gx = sx * (GW / 2 + 0.006);
      for (const q of o.pillars) slab(k, q[2] ? p : F.black, gx, q[0], q[1], 0.09, 0.02);
      for (const z of o.shuts) add(rbox(0.008, 0.66, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 - 0.003), belt - 0.3, z);
      for (const z of o.handles) add(rbox(0.03, 0.035, 0.16, 0.012), o.chromeH ? F.chrome : F.black, sx * (W / 2 + 0.008), belt - 0.08, z);
      add(rbox(0.04, 0.2, FW - RW - 2 * A - 0.06, 0.02), F.clad, sx * (W / 2 + 0.01), SY + 0.12, (FW + RW) / 2);
      for (const wz of [FW, RW]) { const fl = add(tor(A + 0.03, o.flare, 5, 18, PI), F.clad, sx * (W / 2 + 0.002), SY, wz); fl.rotation.y = PI / 2; fl.scale.z = 0.8; }
      carMirror(k, F, o.mirrorP ? p : F.clad, sx * (W / 2 - 0.02), belt + 0.05, o.mirrorZ);
      if (o.rails) add(rbox(0.05, 0.04, o.rails, 0.015), o.railM === 'black' ? F.black : F.silver, sx * (W / 2 - 0.2), H + 0.01, -0.75);
      o.side(k, F, sx, p);
    }
    liners(k, A, SY, W, [FW, RW]); o.ends(k, F, p);
    add(rbox(W * 0.86, 0.16, ZF - ZR - 0.5, 0.04), F.clad, 0, SY - 0.06, 0);
    plate(k, ZF + 0.01, 0.62, true); plate(k, ZR - 0.01, o.plateY || 0.95, false); if (o.rear) o.rear(c);
    const sh = o.shuts; openParts(c, { W, ZR, belt, doors: sh.slice(0, -1).map((z, i) => [[z - 0.01, belt - 0.03], [z - 0.01, SY + 0.12], [sh[i + 1] + 0.01, SY + 0.12], [sh[i + 1] + 0.01, belt - 0.03]]), yTop: H, pane: [GW / 2 + 0.014, belt + 0.42], hoodY: belt - 0.35, hood: [sh[0] + 0.12, ZF - 0.14, W / 2 - 0.2], boot: { hw: W / 2 - 0.22, y0: 0.82, y1: belt - 0.02, side: o.bootSide } });
    for (const [x, z] of [[-wx, FW], [wx, FW], [-wx, RW], [wx, RW]]) carWheel(k, F, R, o.wd, x, z, o.wheel);
    person(k, 0.42, 0.95, -0.05, { outfit: 'shirt', color: pickR([0xffffff, 0x222222, 0x8fa9c4]) }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR, kind: 'car', type: o.type, snd: o.type, seat: [0.42, 0.95, -0.05, 'car'] };
  }
  // shared front lamp: chrome or black housing + lens, set in a pod turned out to the corner
  function podLamp(k, F, sx, x, y, z, w, h, housing, turn) {
    const hg = new THREE.Group(); hg.position.set(sx * x, y, z); hg.rotation.y = sx * (turn === undefined ? 0.2 : turn); k.g.add(hg);
    k.add(rbox(w + 0.04, h + 0.04, 0.05, 0.03), housing, 0, 0, 0, hg);
    const l = k.lamp(w, h, 0, 0, 0, true); hg.add(l); l.position.z = 0.03; hg.add(l.lens); l.lens.position.set(0, 0, 0.038);
  }
  // Tata Safari (Storme, 4655 x 1965 x 1922, wb 2650, 235/70 R16): stepped raised rear roof, flared arches, tail-door spare
  const safari = () => utility({ key: 'saf', type: 'safari', cols: [0xf0f0ec, 0xf0f0ec, 0x1b1d20, 0x8f949a, 0x6b1c20, 0x2c4030],
    W: 1.9, R: 0.375, A: 0.47, FW: 1.37, RW: -1.28, SY: 0.5, ZF: 2.3, ZR: -2.355, H: 1.922, belt: 1.3, wd: 0.235, flare: 0.075, wheel: WHEELS.safari, plateY: 0.62, bootSide: true,
    rear: c => { const { F, add } = c; for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.66, 0.9], [0.9, 0.92], [0.92, 1.26], [0.7, 1.26]]), { led: [MIR(sx, [[0.7, 1.2], [0.89, 1.2]]), MIR(sx, [[0.7, 1.12], [0.89, 1.12]])], amber: [MIR(sx, [[0.72, 1.04], [0.87, 1.04]])], clear: [MIR(sx, [[0.72, 0.97], [0.86, 0.97]])], cw: 0.04 });
      const sp = add(tyreGeo(0.36, 0.2), rubber, 0, 1.08, -2.46); sp.rotation.y = Math.PI / 2; const cv = add(cyl(0.34, 0.37, 0.06, 26), c.p, 0, 1.08, -2.54); cv.rotation.x = Math.PI / 2; add(cyl(0.12, 0.12, 0.02, 16), F.silver, 0, 1.08, -2.575).rotation.x = Math.PI / 2;
      rearKit(c, { refl: [0.56, 0.72, 0.3] }); add(rbox(0.3, 0.02, 0.014, 0.005), F.tailLed, 0, 1.895, -2.31).castShadow = false; for (const [x, w] of [[-0.62, 0.12], [-0.46, 0.08]]) add(rbox(w, 0.03, 0.01, 0.004), F.chrome, x, 0.86, -2.363); const ch = add(rbox(0.05, 0.05, 0.01, 0.004), F.chrome, -0.36, 0.86, -2.363); ch.rotation.z = Math.PI / 4; },
    nose: s => { s.lineTo(2.3, 0.62); s.lineTo(2.27, 1.1); s.quadraticCurveTo(2.25, 1.18, 2.12, 1.2); s.bezierCurveTo(1.7, 1.24, 1.3, 1.28, 1.02, 1.3); },
    glass: s => { s.moveTo(1.04, 1.3); s.lineTo(0.42, 1.76); s.lineTo(-0.72, 1.78); s.lineTo(-0.82, 1.88); s.lineTo(-2.2, 1.88); s.lineTo(-2.28, 1.34); },
    roof: s => { s.moveTo(0.5, 1.75); s.quadraticCurveTo(0.34, 1.81, 0.1, 1.81); s.lineTo(-0.66, 1.815); s.lineTo(-0.82, 1.915); s.lineTo(-2.2, 1.922); s.quadraticCurveTo(-2.3, 1.91, -2.3, 1.85); s.lineTo(-0.84, 1.87); s.lineTo(-0.72, 1.76); s.lineTo(0.42, 1.74); },
    cz: -0.5, cl: 2.9, rows: [-0.1, -1.0, -1.8], pillars: [[[1.04, 1.3], [0.42, 1.76], 1], [[-0.15, 1.31], [-0.17, 1.78]], [[-1.25, 1.31], [-1.27, 1.88]], [[-2.1, 1.32], [-2.14, 1.88], 1]],
    shuts: [1.0, -0.18, -1.24], handles: [0.3, -0.9], chromeH: true, mirrorZ: 0.95, rails: 2.4,
    side: (k, F, sx) => { k.add(rbox(0.16, 0.05, 1.3, 0.02), F.silver, sx * 1.02, 0.44, 0.05); podLamp(k, F, sx, 0.66, 1.0, 2.26, 0.42, 0.2, F.chrome); k.add(rbox(0.12, 0.09, 0.02, 0.02), F.amber, sx * 0.88, 0.86, 2.27); },
    ends: (k, F) => { k.add(facePoly('safGr', [[-0.42, 0.86], [0.42, 0.86], [0.38, 1.12], [-0.38, 1.12]], 0.05, 0.015), F.chrome, 0, 0, 2.27); k.add(facePoly('safGrB', [[-0.38, 0.89], [0.38, 0.89], [0.35, 1.09], [-0.35, 1.09]], 0.02), F.black, 0, 0, 2.295);
      for (let i = 0; i < 5; i++) k.add(rbox(0.72, 0.012, 0.012, 0.004), F.chrome, 0, 0.92 + i * 0.038, 2.31);
      k.add(rbox(1.92, 0.24, 0.2, 0.06), F.clad, 0, 0.68, 2.2); k.add(rbox(1.92, 0.24, 0.2, 0.06), F.clad, 0, 0.68, -2.25); } });
  // Tata Sumo Gold (4258 x 1700 x 1925, wb 2425, 215/75 R15, 1820 kg): tall slab sides, short square bonnet, steel wheels
  const sumo = () => utility({ key: 'sum', type: 'sumo', cols: [0xf4f4ef, 0xf4f4ef, 0xf4f4ef, 0x9fa5ab, 0x7a1d20, 0x24354f],
    W: 1.7, R: 0.36, A: 0.44, FW: 1.27, RW: -1.155, SY: 0.48, ZF: 2.1, ZR: -2.158, H: 1.925, belt: 1.32, wd: 0.215, flare: 0.03, wheel: 'steel', plateY: 0.72, mirrorP: 0, bootSide: true,
    rear: c => { for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.56, 0.9], [0.72, 0.9], [0.72, 1.22], [0.56, 1.22]]), { amber: [MIR(sx, [[0.58, 1.14], [0.7, 1.14]])], clear: [MIR(sx, [[0.58, 0.96], [0.7, 0.96]])] }); rearKit(c, { badge: [[-0.45, 1.0, 0.2, 0.02]] }); },
    nose: s => { s.lineTo(2.1, 0.6); s.lineTo(2.08, 1.16); s.lineTo(2.02, 1.2); s.lineTo(1.1, 1.3); },
    glass: s => { s.moveTo(1.1, 1.3); s.lineTo(0.62, 1.84); s.lineTo(-2.06, 1.86); s.lineTo(-2.12, 1.34); },
    roof: s => { s.moveTo(0.7, 1.84); s.quadraticCurveTo(0.6, 1.92, 0.44, 1.92); s.lineTo(-2.04, 1.925); s.quadraticCurveTo(-2.14, 1.92, -2.14, 1.84); s.lineTo(-2.0, 1.86); s.lineTo(0.6, 1.84); },
    cz: -0.5, cl: 2.8, rows: [0.0, -0.9, -1.6], pillars: [[[1.1, 1.3], [0.62, 1.84], 1], [[0.0, 1.32], [0.0, 1.86], 1], [[-0.92, 1.32], [-0.92, 1.86], 1], [[-1.98, 1.32], [-2.0, 1.86], 1]],
    shuts: [1.0, -0.02, -0.94], handles: [0.15, -0.8], mirrorZ: 0.98,
    side: (k, F, sx) => { k.add(rbox(0.06, 0.05, 1.6, 0.02), M(0x222427), sx * 0.87, 0.92, 0.05); podLamp(k, F, sx, 0.62, 1.0, 2.07, 0.3, 0.2, F.black, 0.05); k.add(rbox(0.1, 0.2, 0.02, 0.01), F.amber, sx * 0.8, 1.0, 2.06); },
    ends: (k, F) => { k.add(facePoly('sumGr', [[-0.42, 0.88], [0.42, 0.88], [0.42, 1.12], [-0.42, 1.12]], 0.03, 0.01), F.black, 0, 0, 2.09);
      for (let i = 0; i < 3; i++) k.add(rbox(0.8, 0.03, 0.012, 0.006), F.silver, 0, 0.93 + i * 0.07, 2.115);
      k.add(rbox(1.72, 0.2, 0.14, 0.04), M(0x26282b), 0, 0.68, 2.03); k.add(rbox(1.72, 0.2, 0.14, 0.04), M(0x26282b), 0, 0.68, -2.09); } });
  // Mahindra Scorpio-N (4662 x 1917 x 1857, wb 2750, 255/60 R18): rounded shoulders, twin-peak grille, C-shaped DRLs, black roof
  const scorpioN = () => utility({ key: 'spn', type: 'scorpioN', cols: [0x161719, 0xf1f1ee, 0x6d1a1e, 0xb9bec4, 0x2f3a33], blackRoof: true,
    W: 1.91, R: 0.385, A: 0.48, FW: 1.4, RW: -1.35, SY: 0.5, ZF: 2.29, ZR: -2.372, H: 1.857, belt: 1.29, wd: 0.25, flare: 0.05, wheel: WHEELS.scorpioN, plateY: 0.68, mirrorP: 1, bootSide: true,
    rear: c => { for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.76, 0.86], [0.9, 0.88], [0.9, 1.26], [0.8, 1.26]]), { led: [MIR(sx, [[0.8, 1.2], [0.8, 0.92]])], clear: [MIR(sx, [[0.86, 1.0], [0.86, 0.92]])] }); rearKit(c, { refl: [0.6, 0.76, 0.3], badge: [[0.5, 0.9, 0.18, 0.018], [0.5, 0.94, 0.1, 0.018]] }); },
    nose: s => { s.lineTo(2.29, 0.66); s.quadraticCurveTo(2.31, 0.98, 2.2, 1.17); s.bezierCurveTo(1.8, 1.25, 1.35, 1.27, 1.06, 1.29); },
    glass: s => { s.moveTo(1.1, 1.29); s.bezierCurveTo(0.8, 1.5, 0.6, 1.72, 0.36, 1.78); s.lineTo(-1.9, 1.74); s.lineTo(-2.2, 1.34); },
    roof: s => { s.moveTo(0.46, 1.76); s.quadraticCurveTo(0.2, 1.84, -0.2, 1.857); s.lineTo(-1.8, 1.84); s.quadraticCurveTo(-2.05, 1.8, -2.14, 1.68); s.lineTo(-1.9, 1.75); s.lineTo(0.36, 1.77); },
    cz: -0.5, cl: 3.0, rows: [-0.1, -1.0, -1.8], pillars: [[[1.1, 1.29], [0.36, 1.78]], [[-0.2, 1.3], [-0.24, 1.78]], [[-1.3, 1.3], [-1.34, 1.76]], [[-1.72, 1.3], [-2.0, 1.72], 1]],
    shuts: [1.02, -0.22, -1.32], handles: [0.3, -0.95], chromeH: true, mirrorZ: 0.98, rails: 2.2, railM: 'black',
    side: (k, F, sx) => { slab(k, F.chrome, sx * (1.75 / 2 + 0.01), [1.0, 1.27], [-1.95, 1.3], 0.02, 0.02); 
      podLamp(k, F, sx, 0.68, 1.04, 2.2, 0.3, 0.13, F.black, 0.35);
      for (const y of [0.92, 1.18]) k.add(rbox(0.02, 0.02, 0.02, 0.005), F.drl, sx * 0.9, y, 2.1).scale.x = 16;
      k.add(rbox(0.02, 0.28, 0.02, 0.005), F.drl, sx * 0.76, 0.76, 2.24); },
    ends: (k, F) => { for (const sx of [-1, 1]) { k.add(facePoly('spnGr', [[0.03, 0.84], [0.42, 0.84], [0.36, 1.13], [0.08, 1.13]], 0.04, 0.012), F.black, sx * 0.0 + (sx < 0 ? -0.45 : 0), 0, 2.26); for (let i = 0; i < 4; i++) k.add(rbox(0.03, 0.26, 0.01, 0.005), F.chrome, sx * (0.12 + i * 0.075), 0.98, 2.3); }
      k.add(sph(0.06, 12, 8), F.chrome, 0, 1.0, 2.31).scale.set(1.2, 1, 0.3); k.add(rbox(1.5, 0.24, 0.22, 0.06), F.clad, 0, 0.58, 2.17); k.add(rbox(1.0, 0.05, 0.1, 0.02), F.silver, 0, 0.46, 2.23); k.add(rbox(1.92, 0.22, 0.2, 0.06), F.clad, 0, 0.62, -2.27); } });

  // traffic 'hatch' / 'suv' are a mix of the models above (kind stays 'car'; userData.type names the model)
  const CARS = { swift, swiftNew, dzire, alto, wagonR, bolero, scorpio, scorpioN, safari, sumo, ace, tharRoxx, thar, hector, fortuner, landCruiser, innova, defender, gclass, hilux };
  const SPORTS = { berlinetta, muscle, wedge, coupe911 };
  // ~4 % of traffic hatches are one of the sports cars (rare sightings)
  function hatch(type) { if (CARS[type]) return CARS[type](); if (SPORTS[type]) return SPORTS[type]();
    if (Math.random() < 0.04) return SPORTS[pickR(Object.keys(SPORTS))]();
    return CARS[pickR(['swift', 'swiftNew', 'alto', 'alto', 'dzire', 'dzire', 'wagonR', 'wagonR', 'wagonR'])](); }
  function suv(type) { return CARS[type] ? CARS[type]() : CARS[pickR(['bolero', 'bolero', 'scorpio', 'scorpio', 'scorpioN', 'safari', 'sumo', 'ace', 'innova', 'innova', 'tharRoxx', 'thar', 'hector', 'fortuner', 'landCruiser'])](); }

  // ---------------------------------------------------------------- Fortuner-style 4x4 SUV (2022 facelift, white)
  // 4795 x 1855 x 1835 mm, wheelbase 2745, 225 mm ground clearance, 265/60 R18 alloys. Generic badge, no logos.
  // Hi-res bezier side profiles (same technique as crysta-body.js), env-mapped paint / chrome / piano black.
  const fMatsC = {}; let fMats = null;
  const wrapTex = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  function fortunerMats(black) {
    if (fMatsC[black ? 'b' : 'w']) return fMatsC[black ? 'b' : 'w'];
    const env = typeof crystaEnvMap === 'function' ? crystaEnvMap() : null;
    const ph = (color, specular, shininess, refl, extra) => new THREE.MeshPhongMaterial(Object.assign({ color, specular, shininess },
      env ? { envMap: env, reflectivity: refl, combine: THREE.MixOperation } : {}, extra || {}));
    return (fMatsC[black ? 'b' : 'w'] = {
      paint: black ? ph(0x08090b, 0x8090a4, 130, 0.3) : ph(0xf3f3ef, 0xb8c2cc, 110, 0.16),   // black / white pearl
      black: ph(0x07090d, 0x5a6676, 110, 0.22),                       // piano black pillars / lamp housings
      chrome: ph(0xe8edf2, 0xffffff, 160, 0.85),
      glass: ph(0x0c131c, 0xaabbcc, 150, 0.35, { transparent: true, opacity: 0.84 }),
      clad: new THREE.MeshPhongMaterial({ color: 0x1b1c1f, specular: 0x222222, shininess: 12 }),
      silver: ph(0xb9bec4, 0xdddddd, 80, 0.3),
      gun: new THREE.MeshPhongMaterial({ color: 0x2c3036, specular: 0x667085, shininess: 60 }),
      alloy: ph(0xdfe4ea, 0xffffff, 140, 0.4),
      drl: new THREE.MeshBasicMaterial({ color: 0xf4f8ff }),
      tailLed: new THREE.MeshBasicMaterial({ color: 0xe3262b }),      // tail-lamp LED lines stay readable in daylight
      lensClear: ph(0xd9e0e6, 0xffffff, 150, 0.5),                    // clear reverse-lamp segment
      fabric: new THREE.MeshLambertMaterial({ color: 0x17181a }),     // soft-top canvas
      matte: new THREE.MeshPhongMaterial({ color: 0x0b0c0e, specular: 0x24262a, shininess: 10 }),
      argyle: new THREE.MeshPhongMaterial({ map: wrapTex(canvasTex('hArgyle', 96, 96, (x, w, h) => { x.fillStyle = '#101214'; x.fillRect(0, 0, w, h); x.fillStyle = '#c9cfd6';
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const cx = c * 32 + (r % 2) * 16, cy = r * 32; x.beginPath(); x.moveTo(cx, cy - 11); x.lineTo(cx + 13, cy); x.lineTo(cx, cy + 11); x.lineTo(cx - 13, cy); x.closePath(); x.fill(); } })), specular: 0xffffff, shininess: 90 }),
      amber: new THREE.MeshBasicMaterial({ color: 0xe08a12 }),
      redLens: new THREE.MeshPhongMaterial({ color: 0x7a0c0c, specular: 0xffffff, shininess: 120 }),
      cabin: new THREE.MeshLambertMaterial({ color: 0x121316 }),
      mesh: new THREE.MeshPhongMaterial({ map: wrapTex(canvasTex('fGrille', 128, 64, (x, w, h) => {
        x.fillStyle = '#0a0b0c'; x.fillRect(0, 0, w, h); x.strokeStyle = '#3c4044'; x.lineWidth = 2;
        for (let r = 0; r < 9; r++) for (let c = 0; c < 12; c++) {     // hexagonal mesh
          const cx = c * 11 + (r % 2) * 5.5, cy = r * 8 + 4; x.beginPath();
          for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; x.lineTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 4.2); }
          x.closePath(); x.stroke();
        }
      })), specular: 0x333333, shininess: 50 }),
    });
  }
  // high-quality side extrusion (more bevel / curve segments than sideGeo)
  // car body / glass / roof pieces: lofted rounded sections (see loftGeo), options chosen by the piece's key
  function sideHQ(key, draw, width, b) { const o = loftOpts(key, draw, width); if (/^(saf|sum|spn|swN)/.test(key)) o.step = 0.2; return loftGeo(key, draw, width, o); }   // newer models: coarser stations keep them near 15k tris
  // flat polygon in the (x, y) face plane, extruded `d` along z
  const facePoly = (key, pts, d, b) => faceGeo(key, s => { s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); }, d, b || 0);
  const fortunerBlack = () => fortuner(true);
  function lugTyre(k, r, w, x, y, z, nLugs) {
    const wg = k.wheel(r, w, x, y, z, { spokes: 3, rim: paint(0xd9a514) });
    const lugGeo = G('lug' + r, () => new THREE.BoxGeometry(w * 0.48, r * 0.09, r * 0.12));
    const im = new THREE.InstancedMesh(lugGeo, rubber, nLugs * 2), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < nLugs * 2; i++) {
      const side = i % 2 ? 1 : -1, a = (Math.floor(i / 2) + (side > 0 ? 0.5 : 0)) / nLugs * Math.PI * 2;
      e.set(a, side * 0.45, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(side * w * 0.24, Math.cos(a) * r, -Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      // place the lug on the tread (rotate its local y outward along the radius)
      const rot = new THREE.Matrix4().makeRotationX(a), ang = new THREE.Matrix4().makeRotationY(side * 0.5);
      m.copy(rot).multiply(new THREE.Matrix4().makeTranslation(side * w * 0.24, r * 1.0, 0)).multiply(ang);
      im.setMatrixAt(i, m);
    }
    im.castShadow = true; wg.add(im); return wg;
  }

  // ---------------------------------------------------------------- tractor (575 style) + trolley
  function tractor() {
    const k = kit(), red = paint(0xc62828), grey = M(0x4d4f52), cream = paint(0xe9e2cf);
    // rounded bonnet with grille nose
    k.add(sideGeo('trBonnet', s => { s.moveTo(1.85, 0.8); s.lineTo(1.88, 1.25); s.quadraticCurveTo(1.86, 1.42, 1.65, 1.45); s.lineTo(0.2, 1.52); s.lineTo(0.2, 0.85); }, 0.72, 0.13, 10), red);
    k.add(sideGeo('trSide', s => { s.moveTo(1.8, 0.82); s.lineTo(0.2, 0.85); s.lineTo(0.2, 1.05); s.lineTo(1.8, 1.02); }, 0.76, 0.03), cream);
    const gr = k.add(G('trGr', () => { const s = new THREE.Shape(); roundRect(s, 0.52, 0.42, 0.1); return new THREE.ShapeGeometry(s, 4); }), grilleMat, 0, 1.1, 1.96);
    // engine/transmission casting, footplates
    k.add(rbox(0.6, 0.45, 1.6, 0.12), grey, 0, 0.72, 0.9);
    k.add(rbox(0.9, 0.6, 0.8, 0.15), grey, 0, 0.9, -0.3);
    for (const sx of [-1, 1]) k.add(rbox(0.32, 0.05, 0.7, 0.02), M(0x333333), sx * 0.5, 0.75, 0.15);
    // front axle and steering
    k.add(cyl(0.05, 0.05, 1.3, 6), grey, 0, 0.4, 1.3).rotation.z = Math.PI / 2;
    const col = k.add(cyl(0.03, 0.03, 0.7, 6), M(0x222222), 0, 1.5, 0.25); col.rotation.x = 0.55;
    const sw = k.add(tor(0.19, 0.022, 5, 16), M(0x111111), 0, 1.78, 0.05); sw.rotation.x = Math.PI / 2 - 0.55;
    // exhaust stack and air cleaner
    k.add(cyl(0.045, 0.045, 0.9, 8), M(0x2a2a2a), 0.25, 1.85, 1.15);
    k.add(cyl(0.065, 0.065, 0.2, 8), chrome, 0.25, 1.55, 1.15);
    // seat and rear mudguards (curved shells over the big tyres)
    k.add(sideGeo('trSeat', s => { s.moveTo(-0.25, 1.32); s.lineTo(-0.7, 1.32); s.quadraticCurveTo(-0.8, 1.45, -0.72, 1.62); s.lineTo(-0.66, 1.62); s.lineTo(-0.66, 1.4); s.lineTo(-0.25, 1.4); }, 0.45, 0.04), M(0x1b1b1b));
    for (const sx of [-1, 1]) k.add(sideGeo('trFender', s => { s.absarc(-0.45, 0.75, 0.86, 0.05 * Math.PI, 0.95 * Math.PI, false); s.absarc(-0.45, 0.75, 0.8, 0.95 * Math.PI, 0.05 * Math.PI, true); }, 0.5, 0.02, 6), red).position.x = sx * 0.92;
    k.wheel(0.38, 0.17, -0.58, 0.38, 1.3, { spokes: 3, rim: paint(0xd9a514) }); k.wheel(0.38, 0.17, 0.58, 0.38, 1.3, { spokes: 3, rim: paint(0xd9a514) });
    lugTyre(k, 0.72, 0.38, -0.92, 0.72, -0.45, 14); lugTyre(k, 0.72, 0.38, 0.92, 0.72, -0.45, 14);
    person(k, 0, 1.42, -0.5, { outfit: Math.random() < 0.5 ? 'lungi' : 'shirt', color: 0xffffff }, 'car');
    // hitch pin on the drawbar behind the rear axle; the trolley hangs off it as a hinged child (rotation.y = articulation)
    k.add(rbox(0.16, 0.06, 0.5, 0.02), grey, 0, 0.68, -1.15);
    const tg = trolleyBody(k); tg.position.z = -1.35; k.g.add(tg);
    for (const sx of [-1, 1]) k.lamp(0.17, 0.17, sx * 0.2, 1.2, 1.97, true, true);
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 6.8, kind: 'tractor', trailer: tg };
  }
  // two-wheel farm trolley (about 3.2 x 2.1 m). Origin = the hitch eye; axle 2.55 m behind it, so it can be towed or stand alone.
  function trolleyBody(k) {
    const tg = new THREE.Group(); tg.name = 'trolley'; tg.userData.bar = 2.55;
    const green = paint(pickR([0x2e7d32, 0x1f5fa8, 0xa83a1f])), steel = M(0x3a3a3a), C = -2.55;
    for (const sx of [-1, 1]) tube(k, [0, 0.68, 0], [sx * 0.45, 0.85, -0.95], 0.04, steel, tg);
    k.add(cyl(0.05, 0.05, 0.42, 6), steel, 0, 0.42, -0.3, tg);                      // parking jack leg
    k.add(rbox(2.1, 0.1, 3.2, 0.03), steel, 0, 0.88, C, tg);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.add(rbox(0.05, 0.22, 3.2, 0.03), green, sx * 1.03, 1.05 + i * 0.25, C, tg);
    for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) k.add(rbox(2.1, 0.22, 0.05, 0.03), green, 0, 1.05 + i * 0.25, C + sz * 1.58, tg);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) k.add(rbox(0.08, 0.8, 0.08, 0.02), steel, sx * 1.05, 1.3, C + sz * 1.55, tg);
    const load = k.add(sph(1, 12, 8), M(Math.random() < 0.5 ? 0xf2f0ea : 0xd4b26a), 0, 1.65, C, tg); load.scale.set(1.0, 0.55, 1.55); load.name = 'trolleyLoad';
    for (const sx of [-1, 1]) { const w = k.wheel(0.5, 0.24, sx, 0.5, C, { spokes: 3 }); tg.add(w); const t = k.lamp(0.18, 0.09, sx * 0.85, 0.95, C - 1.62); tg.add(t); tg.add(t.lens); }
    const pl = plate(k, C - 1.62, 0.8, false); tg.add(pl);
    return tg;
  }
  function trolley() {
    const k = kit(), tg = trolleyBody(k); k.g.add(tg); k.g.userData.bar = 2.55;
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.3, kind: 'trolley', type: 'trolley', noSteer: true };
  }

  // ---------------------------------------------------------------- lorry (1109 style): classic cab + decorated wooden body
  const lorryArt = canvasTex('lorryArt', 512, 128, (x, w, h) => {
    x.fillStyle = '#8e2a1e'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f1c40f'; x.fillRect(0, 0, w, 14); x.fillStyle = '#27ae60'; x.fillRect(0, h - 16, w, 16);
    x.fillStyle = '#1565c0'; x.fillRect(0, 14, w, 6);
    for (let i = 0; i < 8; i++) {                                   // painted flowers and panels
      const cx = 32 + i * 64; x.strokeStyle = '#f1c40f'; x.lineWidth = 3; x.strokeRect(cx - 28, 26, 56, 76);
      x.fillStyle = ['#e91e63', '#ffeb3b', '#4caf50', '#ff9800'][i % 4];
      for (let p = 0; p < 6; p++) { const a = p / 6 * Math.PI * 2; x.beginPath(); x.arc(cx + Math.cos(a) * 11, 64 + Math.sin(a) * 11, 7, 0, 7); x.fill(); }
      x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, 64, 6, 0, 7); x.fill();
    }
  });
  const lorryRear = canvasTex('lorryRear', 256, 128, (x, w, h) => {
    x.fillStyle = '#8e2a1e'; x.fillRect(0, 0, w, h); x.fillStyle = '#f1c40f'; x.fillRect(0, 34, w, 54);
    x.fillStyle = '#b71c1c'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText('HORN OK PLEASE', 128, 70);
    x.fillStyle = '#fff'; x.font = 'bold 14px sans-serif'; x.fillText('USE DIPPER AT NIGHT', 128, 112);
  });
  const lorryRearMat = new THREE.MeshLambertMaterial({ map: lorryRear });
  const lorryArtMat = new THREE.MeshLambertMaterial({ map: lorryArt });
  function lorry() {
    const k = kit(), cab = paint([0xf39c12, 0x1e88e5, 0xe8e2d0][Math.random() * 3 | 0]), wood = lorryArtMat;
    const W = 2.25;
    k.add(sideGeo('lorryCab', s => {
      s.moveTo(2.2, 0.75); s.lineTo(3.88, 0.75); s.quadraticCurveTo(3.98, 0.8, 3.97, 1.2); s.lineTo(3.95, 1.6);
      s.lineTo(3.8, 2.5); s.quadraticCurveTo(3.72, 2.82, 3.4, 2.84); s.lineTo(2.35, 2.86); s.quadraticCurveTo(2.2, 2.85, 2.2, 2.6);
    }, W, 0.1, 10), cab);
    k.add(sideGeo('lorryWS', s => { s.moveTo(3.94, 1.72); s.lineTo(3.79, 2.5); s.lineTo(3.74, 2.5); s.lineTo(3.89, 1.72); }, W - 0.3, 0.01), glass, 0, 0.02, 0.1);
    for (const sx of [-1, 1]) k.add(sideShape('lorryDoorWin', [[3.55, 1.75], [3.7, 1.75], [3.58, 2.45], [2.75, 2.45], [2.75, 1.75]]), glass, sx * (W / 2 + 0.004), 0, 0);
    // big grille, bumper, steps, mudguards, fuel tank
    const gr = k.add(G('lorryGr', () => { const s = new THREE.Shape(); roundRect(s, 1.3, 0.6, 0.12); return new THREE.ShapeGeometry(s, 4); }), grilleMat, 0, 1.25, 3.975);
    k.add(rbox(2.35, 0.25, 0.2, 0.06), M(0x222222), 0, 0.7, 4.0);
    for (const sx of [-1, 1]) {
      const mg = k.add(tor(0.6, 0.05, 4, 12, Math.PI), M(0x1b1b1b), sx * 1.0, 0.5, 3.0); mg.rotation.y = Math.PI / 2; mg.scale.z = 3;
      k.add(rbox(0.3, 0.05, 0.4, 0.02), chrome, sx * 1.2, 0.55, 2.5);
      k.lamp(0.26, 0.26, sx * 0.85, 1.28, 3.99, true, true);
      k.add(sph(0.04, 6, 4), amberMat, sx * 1.05, 1.6, 3.95);
    }
    k.add(cyl(0.22, 0.22, 0.9, 10), chrome, -1.0, 0.65, 1.6).rotation.x = Math.PI / 2;
    mirrors(k, [-1.25, 1.25], 2.2, 3.6);
    // "topa" crown over the cab and the wooden cargo body
    k.add(sideGeo('lorryTopa', s => { s.moveTo(1.9, 2.4); s.lineTo(2.2, 2.4); s.lineTo(2.2, 2.9); s.quadraticCurveTo(3.4, 3.0, 3.55, 3.2); s.lineTo(1.9, 3.2); }, 2.35, 0.04), paint(0x8e2a1e));
    k.add(rbox(2.3, 0.2, 5.6, 0.04), M(0x2b2b2b), 0, 1.05, -0.9);            // chassis
    for (const sx of [-1, 1]) { k.add(rbox(0.06, 1.5, 5.6, 0.03), M(0x8e2a1e), sx * 1.18, 1.9, -0.9); k.add(G('lorryArtP', () => new THREE.PlaneGeometry(5.6, 1.5)), wood, sx * 1.215, 1.9, -0.9).rotation.y = sx * Math.PI / 2; }
    k.add(rbox(2.4, 1.5, 0.06, 0.03), wood, 0, 1.9, 1.9);
    k.add(rbox(2.4, 1.5, 0.06, 0.03), M(0x8e2a1e), 0, 1.9, -3.7); k.add(G('lorryRearP', () => new THREE.PlaneGeometry(2.4, 1.5)), lorryRearMat, 0, 1.9, -3.735).rotation.y = Math.PI;
    for (const z of [1.5, -0.2, -1.9, -3.6]) for (const sx of [-1, 1]) k.add(rbox(0.1, 1.55, 0.1, 0.02), M(0x5a3a1e), sx * 1.21, 1.9, z);
    k.add(rbox(2.42, 0.08, 5.65, 0.02), M(0xf1c40f), 0, 2.67, -0.9);
    for (const [xx, z, d] of [[-1.0, 3.0, 0], [1.0, 3.0, 0], [-0.95, -1.6, 1], [0.95, -1.6, 1], [-0.95, -2.75, 1], [0.95, -2.75, 1]]) {
      k.wheel(0.5, 0.28, xx, 0.5, z, { spokes: 3 });
      if (d) k.wheel(0.5, 0.26, xx * 0.7, 0.5, z, { spokes: 3, noSpoke: true });
    }
    for (const sx of [-1, 1]) k.lamp(0.25, 0.15, sx * 0.95, 0.95, -3.74);
    plate(k, 4.11, 0.7, true); plate(k, -3.75, 0.85, false);
    person(k, -0.55, 1.5, 3.0, { outfit: 'shirt', color: 0xffffff }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 7.8, kind: 'lorry' };
  }

  // ---------------------------------------------------------------- village bus (Palle Velugu style)
  const busDest = canvasTex('busDest', 256, 48, (x) => { x.fillStyle = '#111'; x.fillRect(0, 0, 256, 48); x.fillStyle = '#ffb300'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillText('JANGAON - NELLUTLA', 128, 32); });
  function bus() {
    const k = kit(), body = paint(0x2e8b3e), cream = paint(0xf2efe2), yellow = paint(0xf4c20d);
    const W = 2.5, L2 = 5.2;
    k.add(sideGeo('busLow', s => {
      s.moveTo(-L2, 0.45); s.lineTo(-3.55, 0.45); s.absarc(-3.0, 0.52, 0.6, Math.PI, 0, true); s.lineTo(2.8, 0.45); s.absarc(3.4, 0.52, 0.6, Math.PI, 0, true);
      s.lineTo(L2 - 0.1, 0.45); s.quadraticCurveTo(L2, 0.5, L2, 0.65); s.lineTo(L2, 1.55); s.lineTo(-L2, 1.55);
    }, W, 0.06), body);
    k.add(sideGeo('busStripe', s => { s.moveTo(-L2, 1.55); s.lineTo(L2, 1.55); s.lineTo(L2, 1.65); s.lineTo(-L2, 1.65); }, W + 0.01, 0.02), yellow);
    // upper body with rounded roof (curved profile + heavy bevel)
    k.add(sideGeo('busUp', s => {
      s.moveTo(-L2, 1.65); s.lineTo(L2, 1.65); s.lineTo(L2 - 0.02, 2.75); s.quadraticCurveTo(L2 - 0.05, 3.05, L2 - 0.4, 3.08); s.lineTo(-L2 + 0.3, 3.08); s.quadraticCurveTo(-L2, 3.05, -L2, 2.8);
    }, W, 0.16, 10), cream);
    // side window band with frames
    for (const sx of [-1, 1]) {
      k.add(sideShape('busWin', [[-4.7, 1.85], [3.3, 1.85], [3.3, 2.7], [-4.7, 2.7]]), glass, sx * (W / 2 + 0.003), 0, 0);
      for (let i = 0; i <= 8; i++) k.add(rbox(0.012, 0.92, 0.07, 0.005), M(0x9aa0a6), sx * (W / 2 + 0.008), 2.27, -4.7 + i * 1.0);
      k.add(rbox(0.015, 0.05, 8.1, 0.01), M(0x9aa0a6), sx * (W / 2 + 0.008), 2.25, -0.7);
      // door at the front
      k.add(sideShape('busDoor', [[3.55, 0.6], [4.45, 0.6], [4.45, 2.7], [3.55, 2.7]]), glass, sx * (W / 2 + 0.004), 0, 0);
      for (const z of [-3.0, 3.4]) { const fl = k.add(tor(0.65, 0.05, 4, 12, Math.PI), M(0x1b1b1b), sx * (W / 2 - 0.02), 0.52, z); fl.rotation.y = Math.PI / 2; fl.scale.z = 1.5; }
    }
    // windscreen, destination board, rear window, bumpers, grille
    k.add(G('busWS', () => { const s = new THREE.Shape(); roundRect(s, 2.2, 1.0, 0.12); return new THREE.ShapeGeometry(s, 4); }), glass, 0, 2.2, L2 + 0.005);
    const dest = k.add(G('busDestG', () => new THREE.PlaneGeometry(1.8, 0.32)), new THREE.MeshBasicMaterial({ map: busDest }), 0, 2.88, L2 - 0.01); dest.position.z = L2 - 0.04 + 0.05;
    k.add(G('busRW', () => { const s = new THREE.Shape(); roundRect(s, 2.0, 0.6, 0.1); return new THREE.ShapeGeometry(s, 4); }), glass, 0, 2.45, -L2 - 0.005).rotation.y = Math.PI;
    k.add(rbox(2.55, 0.28, 0.2, 0.08), M(0x222222), 0, 0.55, L2 + 0.05);
    k.add(rbox(2.55, 0.28, 0.2, 0.08), M(0x222222), 0, 0.6, -L2 - 0.05);
    k.add(G('busGr', () => { const s = new THREE.Shape(); roundRect(s, 1.2, 0.35, 0.06); return new THREE.ShapeGeometry(s, 3); }), grilleMat, 0, 1.0, L2 + 0.006);
    for (const sx of [-1, 1]) {
      k.lamp(0.24, 0.24, sx * 0.9, 1.0, L2 + 0.008, true, true);
      k.lamp(0.18, 0.3, sx * 1.05, 1.0, -L2 - 0.008);
      k.add(sph(0.05, 6, 4), amberMat, sx * 1.1, 1.35, L2);
    }
    mirrors(k, [-1.35, 1.35], 2.5, L2 - 0.1);
    k.add(rbox(2.2, 0.08, 7.5, 0.03), M(0xa8a8a8), 0, 3.12, -0.6);             // roof carrier
    for (const [xx, z] of [[-1.05, 3.4], [1.05, 3.4], [-1.05, -3.0], [1.05, -3.0]]) k.wheel(0.52, 0.3, xx, 0.52, z, { spokes: 3 });
    plate(k, L2 + 0.16, 0.75, true); plate(k, -L2 - 0.16, 0.85, false);
    person(k, -0.7, 1.3, 4.3, { outfit: 'shirt', color: 0x9aa7c7 }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 10.4, kind: 'bus' };
  }

  // ---------------------------------------------------------------- bullock cart with two zebu bulls
  function zebu(k, x, z, coat) {
    const b = new THREE.Group(); b.position.set(x, 0, z); k.g.add(b);
    const body = k.add(G('zBody', () => new THREE.LatheGeometry([[0.001, -0.75], [0.17, -0.7], [0.26, -0.45], [0.28, 0], [0.27, 0.35], [0.22, 0.65], [0.001, 0.75]].map(p => new THREE.Vector2(p[0], p[1])), 10)), coat, 0, 1.05, 0, b);
    body.rotation.x = Math.PI / 2; body.scale.set(0.85, 1, 1.1);
    const hump = k.add(sph(0.16, 8, 6), coat, 0, 1.37, 0.42, b); hump.scale.set(0.8, 1.1, 1.1);
    const neck = k.add(cyl(0.12, 0.17, 0.45, 8), coat, 0, 1.2, 0.8, b); neck.rotation.x = 1.0;
    const dew = k.add(sph(0.14, 8, 6), coat, 0, 0.95, 0.72, b); dew.scale.set(0.35, 1.0, 1.1);   // dewlap
    const head = k.add(G('zHead', () => new THREE.CylinderGeometry(0.07, 0.11, 0.42, 8)), coat, 0, 1.2, 1.12, b); head.rotation.x = 2.0;
    k.add(sph(0.075, 8, 6), M(0x3a3430), 0, 1.04, 1.3, b).scale.set(1, 0.8, 0.9);                 // muzzle
    for (const sx of [-1, 1]) {
      const horn = k.add(G('zHorn', () => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.14, 0.08, 0), new THREE.Vector3(0.12, 0.28, -0.04)), 6, 0.025, 5)), M(0x5a4632), sx * 0.06, 1.38, 1.0, b);
      horn.scale.x = sx;
      const ear = k.add(sph(0.05, 5, 4), coat, sx * 0.12, 1.3, 1.0, b); ear.scale.set(1.6, 0.4, 0.8);
      for (const lz of [0.5, -0.5]) {
        const up = k.add(cyl(0.075, 0.05, 0.42, 6), coat, sx * 0.15, 0.73, lz, b); up.rotation.x = lz > 0 ? 0.05 : -0.1;
        const lo = k.add(cyl(0.045, 0.035, 0.42, 6), coat, sx * 0.15, 0.3, lz + 0.02, b);
        k.add(sph(0.045, 5, 4), M(0x2a2420), sx * 0.15, 0.06, lz + 0.03, b).scale.y = 0.8;          // hoof
      }
    }
    const tail = k.add(cyl(0.015, 0.01, 0.75, 4), coat, 0, 0.82, -0.82, b); tail.rotation.x = 0.15;
    k.add(sph(0.04, 5, 4), M(0x222222), 0, 0.45, -0.88, b).scale.y = 2;
    return b;
  }
  function cartWheel(k, x, y, z) {
    const wg = new THREE.Group(); wg.position.set(x, y, z); wg.userData.radius = 0.77; k.g.add(wg); k.wheels.push(wg);
    const wood = M(0x6b4a2c);
    const rim = k.add(tor(0.72, 0.05, 4, 16), wood, 0, 0, 0, wg); rim.rotation.y = Math.PI / 2; rim.scale.z = 1.6;
    k.add(tor(0.77, 0.012, 3, 16), M(0x3a3a3a), 0, 0, 0, wg).rotation.y = Math.PI / 2;            // iron tyre
    const hub = k.add(cyl(0.1, 0.12, 0.26, 6), wood, 0, 0, 0, wg); hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) { const sp = k.add(cyl(0.025, 0.03, 0.64, 5), wood, 0, 0, 0, wg); sp.rotation.x = i * Math.PI / 6; sp.geometry = cyl(0.025, 0.03, 1.4, 5); }
    return wg;
  }
  function bullockCart() {
    const k = kit(), wood = M(0x7a5230);
    const coats = [M(0xe6dfd2), M(0xd8cfc0), M(0xbfb3a0)];
    zebu(k, -0.42, 1.95, coats[Math.random() * 3 | 0]); zebu(k, 0.42, 1.95, coats[Math.random() * 3 | 0]);
    k.add(cyl(0.05, 0.05, 1.5, 6), wood, 0, 1.38, 2.75).rotation.z = Math.PI / 2;             // yoke over the necks
    k.add(cyl(0.06, 0.05, 2.6, 6), wood, 0, 1.15, 1.3).rotation.x = Math.PI / 2 - 0.1;        // pole
    // planked bed with low sides, hay load
    for (let i = 0; i < 5; i++) k.add(rbox(1.5, 0.05, 0.42, 0.02), wood, 0, 0.98, -1.45 + i * 0.44);
    for (const sx of [-1, 1]) { k.add(rbox(0.06, 0.08, 2.3, 0.02), wood, sx * 0.75, 1.3, -0.55); for (let i = 0; i < 6; i++) k.add(cyl(0.02, 0.02, 0.32, 4), wood, sx * 0.75, 1.15, -1.6 + i * 0.42); }
    const hay = k.add(sph(1, 10, 7), M(0xd4b26a), 0, 1.35, -0.85); hay.scale.set(0.68, 0.38, 0.75);
    k.add(cyl(0.05, 0.05, 1.9, 6), M(0x3a3a3a), 0, 0.75, -0.6).rotation.z = Math.PI / 2;      // axle
    cartWheel(k, -0.88, 0.78, -0.6); cartWheel(k, 0.88, 0.78, -0.6);
    for (const sx of [-1, 1]) k.lamp(0.1, 0.06, sx * 0.7, 1.0, -1.7);
    person(k, 0, 1.1, 0.45, { outfit: 'lungi', color: 0xffffff }, 'bench');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.5, kind: 'cart', noSteer: true };
  }
  // ---------------------------------------------------------------- conformed bodies (car2 / Surf)
  // WHY: the older cars pile boxes on a loft, so lamps stick out as shards, pillars float off the glass and shut lines
  // cross the wheel arches. Here the whole car is ONE loft (nose to tail, tumblehome above the belt) and every lamp,
  // window, grille, shut line and trim is a thin patch PROJECTED onto that surface along an axis, so it hugs the body.
  // Surf.hit needs only a 2D point-in-triangle test because the rays are axis-aligned.
  function Surf(geos) {
    const T = [];
    for (const g of geos) {
      const P = g.attributes.position, N = g.attributes.normal, I = g.index;
      const n = I ? I.count : P.count;
      for (let i = 0; i < n; i += 3) {
        const q = [0, 1, 2].map(j => I ? I.getX(i + j) : i + j);
        T.push(q.map(a => [P.getX(a), P.getY(a), P.getZ(a), N.getX(a), N.getY(a), N.getZ(a)]));
      }
    }
    const AX = { z: [0, 1, 2], x: [2, 1, 0], y: [0, 2, 1] };       // [u, v, depth] component indices for each axis
    const hit = (ax, sg, u, v, list) => {
      const [iu, iv, id] = AX[ax]; let best = null, bd = -Infinity;
      for (const t of list) {
        const a = t[0], b = t[1], c = t[2], d0 = (b[iv] - c[iv]) * (a[iu] - c[iu]) + (c[iu] - b[iu]) * (a[iv] - c[iv]);
        if (Math.abs(d0) < 1e-10) continue;
        const l1 = ((b[iv] - c[iv]) * (u - c[iu]) + (c[iu] - b[iu]) * (v - c[iv])) / d0, l2 = ((c[iv] - a[iv]) * (u - c[iu]) + (a[iu] - c[iu]) * (v - c[iv])) / d0, l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const dp = sg * (l1 * a[id] + l2 * b[id] + l3 * c[id]);
        if (dp > bd) { bd = dp; best = [0, 1, 2, 3, 4, 5].map(i => l1 * a[i] + l2 * b[i] + l3 * c[i]); }
      }
      return best;
    };
    const near = (ax, u0, u1, v0, v1) => { const [iu, iv] = AX[ax]; return T.filter(t => {
      const us = t.map(p => p[iu]), vs = t.map(p => p[iv]);
      return Math.max(...us) >= u0 && Math.min(...us) <= u1 && Math.max(...vs) >= v0 && Math.min(...vs) <= v1; }); };
    return { hit, near };
  }
  // rounded polygon corners with a fixed radius, so a window stays a window and does not turn into an octagon
  const roundPoly = (p, r) => { const o = []; p.forEach((q, i) => { const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length], la = Math.hypot(a[0] - q[0], a[1] - q[1]), lb = Math.hypot(b[0] - q[0], b[1] - q[1]), ra = Math.min(r, la * 0.45) / (la || 1), rb = Math.min(r, lb * 0.45) / (lb || 1);
    const s0 = [q[0] + (a[0] - q[0]) * ra, q[1] + (a[1] - q[1]) * ra], s1 = [q[0] + (b[0] - q[0]) * rb, q[1] + (b[1] - q[1]) * rb];
    for (let t = 0; t <= 2; t++) { const u = t / 2, v = 1 - u; o.push([v * v * s0[0] + 2 * u * v * q[0] + u * u * s1[0], v * v * s0[1] + 2 * u * v * q[1] + u * u * s1[1]]); } }); return o; };
  const dens = (p, step, closed) => { const o = []; const n = closed ? p.length : p.length - 1;
    for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % p.length], c = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let j = 0; j < c; j++) o.push([a[0] + (b[0] - a[0]) * j / c, a[1] + (b[1] - a[1]) * j / c]); }
    if (!closed) o.push(p[p.length - 1]); return o; };
  const AXES = { f: ['z', 1], r: ['z', -1], L: ['x', 1], R: ['x', -1], t: ['y', 1] };
  // decal factory bound to one model's body: d.p polygon patch, d.r ribbon along a polyline. Geometry is cached by key.
  function decals(k, key, geos) {
    let S = null; const surf = () => S || (S = Surf(geos));
    const build = (pos, nor, uv, idx) => { const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g; };
    const place = (g, m, role) => { const o = role === 'head' ? headMesh(k, g, 0, 0, 0) : role === 'tail' ? tailMesh(k, g, 0, 0, 0) : k.add(g, m); o.castShadow = false; return o; };
    const emit = (ax, sg, list, pts, off, pos, nor, uv) => { const s = surf(), out = pts.map(([u, v]) => { const h = s.hit(ax, sg, u, v, list); if (!h) return -1;
        const i = pos.length / 3; pos.push(h[0] + h[3] * off, h[1] + h[4] * off, h[2] + h[5] * off); nor.push(h[3], h[4], h[5]); uv.push(u * 4, v * 8); return i; }); return out; };
    const tri = (idx, pos, nor, a, b, c) => { if (a < 0 || b < 0 || c < 0) return;
      const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], A = P(a), B = P(b), C = P(c), e = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], f = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nx = e[1] * f[2] - e[2] * f[1], ny = e[2] * f[0] - e[0] * f[2], nz = e[0] * f[1] - e[1] * f[0];
      if (nx * nor[a * 3] + ny * nor[a * 3 + 1] + nz * nor[a * 3 + 2] >= 0) idx.push(a, b, c); else idx.push(a, c, b); };
    return {
      // star-shaped polygon: rings shrinking to the centroid. opt.round: Chaikin corner passes (1), opt.role 'head' | 'tail'
      p(name, axis, pts, m, opt) { opt = opt || {}; const role = opt.role;
        const g = G('dc' + key + name + axis, () => { const [ax, sg] = AXES[axis], off = opt.off === undefined ? 0.006 : opt.off;
          let B = opt.round === 0 ? pts : roundPoly(pts, opt.round === undefined ? 0.03 : opt.round); B = dens(B, opt.step || 0.06, true);
          const cx = B.reduce((a, q) => a + q[0], 0) / B.length, cy = B.reduce((a, q) => a + q[1], 0) / B.length;
          const rings = opt.rings || [0.34, 0.67, 1], u = B.map(q => q[0]), v = B.map(q => q[1]);
          const list = surf().near(ax, Math.min(...u) - 0.02, Math.max(...u) + 0.02, Math.min(...v) - 0.02, Math.max(...v) + 0.02);
          const pos = [], nor = [], uv = [], idx = [], n = B.length;
          const c0 = emit(ax, sg, list, [[cx, cy]], off, pos, nor, uv)[0];
          const R = rings.map(t => emit(ax, sg, list, B.map(q => [cx + (q[0] - cx) * t, cy + (q[1] - cy) * t]), off, pos, nor, uv));
          for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(idx, pos, nor, c0, R[0][i], R[0][j]);
            for (let r = 1; r < R.length; r++) { tri(idx, pos, nor, R[r - 1][i], R[r][i], R[r][j]); tri(idx, pos, nor, R[r - 1][i], R[r][j], R[r - 1][j]); } }
          return build(pos, nor, uv, idx); });
        return place(g, m, role); },
      // constant-width line on the surface (shut lines, trims, DRLs)
      r(name, axis, pts, w, m, opt) { opt = opt || {}; const role = opt.role;
        const g = G('dc' + key + name + axis, () => { const [ax, sg] = AXES[axis], off = opt.off === undefined ? 0.005 : opt.off, L = dens(pts, opt.step || 0.1, false);
          const A = [], Bb = []; L.forEach((q, i) => { const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], h = Math.hypot(dx, dy) || 1, nx = -dy / h * w / 2, ny = dx / h * w / 2; A.push([q[0] + nx, q[1] + ny]); Bb.push([q[0] - nx, q[1] - ny]); });
          const all = A.concat(Bb), u = all.map(q => q[0]), v = all.map(q => q[1]), list = surf().near(ax, Math.min(...u) - 0.02, Math.max(...u) + 0.02, Math.min(...v) - 0.02, Math.max(...v) + 0.02);
          const pos = [], nor = [], uv = [], idx = [], a = emit(ax, sg, list, A, off, pos, nor, uv), b = emit(ax, sg, list, Bb, off, pos, nor, uv);
          for (let i = 0; i < L.length - 1; i++) { tri(idx, pos, nor, a[i], b[i], b[i + 1]); tri(idx, pos, nor, a[i], b[i + 1], a[i + 1]); }
          return build(pos, nor, uv, idx); });
        return place(g, m, role); },
      x(z, y) { const s = surf(); const h = s.hit('x', 1, z, y, s.near('x', z - 0.03, z + 0.03, y - 0.03, y + 0.03)); return h ? h[0] : 0; },    // body half width at z, y
    };
  }
  const MIR = (sx, pts) => pts.map(q => [sx * q[0], q[1]]);
  const SIDES = [[-1, 'R'], [1, 'L']];
  function glass2() { return mats.gl2 || (mats.gl2 = (() => { const env = fortunerMats().paint.envMap; return new THREE.MeshPhongMaterial(Object.assign({ color: 0x0b1118, specular: 0xb0c4d8, shininess: 140 }, env ? { envMap: env, reflectivity: 0.42, combine: THREE.MixOperation } : {})); })()); }
  const gapM = () => M(0x17181a);
  // ---------------------------------------------------------------- opening parts. Each is a pivot Group holding a skin of the
  // body surface; a dark patch underneath reads as the opening once it swings away. A part is plain data (see setPart), so it
  // survives parked.js cloneModel: { mesh, axis, open } hinged, { mesh, slide, z0, y0, lift } sliding, { mesh, fold } folding.
  const _gb = new THREE.Box3();
  function grab(k, test) { const out = [];
    for (const o of k.g.children.slice()) { if (!o.isMesh || k.grabbed.has(o)) continue;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); o.updateMatrix(); _gb.copy(o.geometry.boundingBox).applyMatrix4(o.matrix);
      if (test(_gb)) { out.push(o); k.grabbed.add(o); } }
    return out; }
  function pivot(k, name, pos, meshes) { const g = new THREE.Group(); g.name = name; g.position.set(pos[0], pos[1], pos[2]); k.g.add(g);
    meshes.forEach(m => { k.g.remove(m); m.position.sub(g.position); g.add(m); }); return g; }
  function panel(c, name, ax, pts) { const { d, F, p, k } = c, o = { step: 0.09, round: 0.02, rings: [0.25, 0.5, 0.75, 1] };
    const ap = d.p(name + 'A', ax, pts, mats.apM || (mats.apM = new THREE.MeshLambertMaterial({ color: 0x0c0d0f, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 })), Object.assign({ off: 0.003 }, o)); ap.visible = false; ap.castShadow = false; k.apertures.push(ap); k.g.remove(ap); (k.apRoot || (k.apRoot = (() => { const g = new THREE.Group(); g.name = 'apertures'; k.g.add(g); return g; })())).add(ap); c.ap = ap;
    const s = d.p(name + 'S', ax, pts, p, Object.assign({ off: 0.0065 }, o)); s.castShadow = false;
    const bg = G('bk' + c.key + name + ax, () => { const g = s.geometry.clone(), I = g.index.array.slice(), N = g.attributes.normal; for (let i = 0; i < I.length; i += 3) { const t = I[i]; I[i] = I[i + 1]; I[i + 1] = t; } g.setIndex(Array.from(I)); for (let i = 0; i < N.array.length; i++) N.array[i] *= -1; return g; });
    const b = k.add(bg, M(0x34353a)); b.castShadow = false; return [s, b]; }
  // s: doors [polygon z,y], yTop, pane, hood [z0, z1, hw], boot { hw, y0, y1, side }, sunroof { hw, z0, z1 }
  function openParts(c, s) { const { k, d, F } = c, W = s.W;
    (s.doors || []).forEach((l, i) => { const zs = l.map(q => q[0]), ys = l.map(q => q[1]), z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(s.yTop || 0, ...ys);
      for (const [sx, sn] of SIDES) {
        if (s.pane) { const pz1 = i ? z1 : z1 - 0.62, pn = k.add(rbox(0.012, s.pane[1] - s.belt, pz1 - z0 - 0.08, 0.008), F.glass, sx * s.pane[0], (s.pane[1] + s.belt) / 2, (z0 + pz1) / 2); pn.castShadow = false; }
        const m = grab(k, b => sx * (b.min.x + b.max.x) > 0.6 && b.max.x - b.min.x < 0.35 && b.min.z >= z0 - 0.03 && b.max.z <= z1 + 0.03 && b.min.y >= y0 - 0.06 && b.max.y <= y1 + 0.06);
        m.push(...panel(c, 'dr' + i, sn, l));
        k.parts.doors.push({ ap: c.ap, mesh: pivot(k, 'door_' + i + '_' + sn, [sx * (W / 2 - 0.02), (y0 + y1) / 2, z1], m), hingeSide: 'front', side: sx, axis: 'y', open: -sx * 1.05 });
      } });
    if (s.hood) { const [z0, z1, hw] = s.hood, m = grab(k, b => b.min.y > (s.hoodY || 0.8) && b.min.z >= z0 - 0.05 && b.max.z <= z1 + 0.05 && b.min.x > -hw && b.max.x < hw);
      const pts = [[-hw, z0], [hw, z0], [hw * 0.93, z1], [-hw * 0.93, z1]]; m.push(...panel(c, 'hd', 't', pts));
      pts.forEach((q, i) => m.push(d.r('hdl' + i, 't', [q, pts[(i + 1) % 4]], 0.009, gapM(), { off: 0.0085, step: 0.14 })));
      k.parts.hood = { ap: c.ap, mesh: pivot(k, 'hood', [0, s.belt, z0], m), axis: 'x', open: -1.05 }; }
    if (s.boot) { const { hw, y0, y1, side } = s.boot, ZR = s.ZR, m = grab(k, b => b.max.z < ZR + 0.45 && b.min.x > -hw - 0.02 && b.max.x < hw + 0.02 && b.min.y > y0 - 0.02 && b.max.y < y1 + 0.18);
      const pts = [[-hw, y0], [hw, y0], [hw * 0.92, y1], [-hw * 0.92, y1]]; m.push(...panel(c, 'bt', 'r', pts));
      pts.forEach((q, i) => m.push(d.r('btl' + i, 'r', [q, pts[(i + 1) % 4]], 0.009, gapM(), { off: 0.0085, step: 0.14 })));
      k.parts.boot = side ? { ap: c.ap, mesh: pivot(k, 'boot', [hw, (y0 + y1) / 2, ZR + 0.04], m), hingeSide: 'left', axis: 'y', open: -1.45 } : { ap: c.ap, mesh: pivot(k, 'boot', [0, y1, ZR + 0.04], m), hingeSide: 'top', axis: 'x', open: 1.15 }; }
    if (s.sunroof) { const { hw, z0, z1 } = s.sunroof, pts = [[-hw, z0], [hw, z0], [hw, z1], [-hw, z1]]; d.p('srA', 't', pts, F.cabin, { off: 0.012, step: 0.2, round: 0.04 });
      const g = d.p('sr', 't', pts, glass2(), { off: 0.018, step: 0.2, round: 0.04 }), pv = pivot(k, 'sunroof', [0, 0, 0], [g]);
      k.parts.sunroof = { mesh: pv, slide: z0 - z1, z0: 0, y0: 0, lift: 0.035 }; }
  }
  function openBody(k, F, p, key, ZR, spec) { openParts({ k, F, p, d: decals(k, key, [k.g.children[0].geometry]), add: k.add, key, ZR }, Object.assign({ ZR }, spec)); }
  // t 0 = shut, 1 = fully open
  function setPart(part, t) { if (!part || !part.mesh) return; const m = part.mesh; t = Math.max(0, Math.min(1, t)); if (part.ap) part.ap.visible = t > 0.001;
    if (part.fold) { m.scale.z = 1 - part.fold[0] * t; m.scale.y = 1 - part.fold[1] * t; }
    else if (part.slide !== undefined) { m.position.z = part.z0 + part.slide * t; m.position.y = part.y0 + part.lift * Math.min(1, t * 6); }
    else m.rotation[part.axis] = part.open * t; }
  // tail lamp in layers: black bezel, lens that lights with the brakes, LED lines, clear reverse and amber segments
  function tailUnit(c, n, ax, pts, o) { o = o || {}; const { d, F } = c, xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), cx = xs.reduce((a, b) => a + b) / xs.length, cy = ys.reduce((a, b) => a + b) / ys.length;
    d.p(n + 'B', ax, pts.map(q => [cx + (q[0] - cx) * 1.06 + Math.sign(q[0] - cx) * 0.008, cy + (q[1] - cy) * 1.06 + Math.sign(q[1] - cy) * 0.008]), F.black, { off: 0.0075, step: 0.09, round: 0.02 });
    d.p(n, ax, pts, null, { role: 'tail', off: 0.0105, step: 0.09, round: 0.016 });
    (o.led || []).forEach((l, i) => d.r(n + 'l' + i, ax, l, o.lw || 0.016, F.tailLed, { off: 0.0135, step: 0.1 }));
    (o.clear || []).forEach((l, i) => d.r(n + 'c' + i, ax, l, o.cw || 0.04, F.lensClear, { off: 0.0135, step: 0.1 }));
    (o.amber || []).forEach((l, i) => d.r(n + 'a' + i, ax, l, o.cw || 0.04, F.amber, { off: 0.0135, step: 0.1 })); }
  // back of the car: wiper [x, y, len], spoiler [w, y, z, len], reflectors [x, y, w], plate recess [hw, y], text-free model badge (bars [[x, y, w, h]])
  function rearKit(c, o) { const { d, F, k, add, p } = c, Rz = c.ZR;
    if (o.wiper) { const [x, y, l] = o.wiper; d.r('wpa', 'r', [[x, y], [x - l * 0.5, y + 0.05]], 0.012, F.black, { off: 0.021, step: 0.1 }); d.r('wpb', 'r', [[x - l * 0.06, y + 0.03], [x - l * 0.95, y + 0.07]], 0.014, F.black, { off: 0.021, step: 0.1 }); }
    if (o.spoiler) { const [w, y, z, l] = o.spoiler, s = add(rbox(w, 0.05, l, 0.022), o.spoilerM || p, 0, y, z); s.rotation.x = 0.12; add(rbox(w * 0.42, 0.018, 0.012, 0.005), F.tailLed, 0, y - 0.03, z - l / 2 - 0.004).castShadow = false; }
    if (o.refl) { const [x, y, w] = o.refl; for (const sx of [-1, 1]) d.r('rfl' + sx, 'r', [[sx * (x - w / 2), y], [sx * (x + w / 2), y]], 0.036, F.redLens, { off: 0.012, step: 0.3 }); }
    if (o.recess) d.p('plr', 'r', [[-o.recess[0], o.recess[1] - 0.09], [o.recess[0], o.recess[1] - 0.09], [o.recess[0] - 0.03, o.recess[1] + 0.09], [-o.recess[0] + 0.03, o.recess[1] + 0.09]], F.black, { off: 0.0085, step: 0.2, round: 0.02 });
    (o.badge || []).forEach((b, i) => d.r('bdg' + i, 'r', [[b[0] - b[2] / 2, b[1]], [b[0] + b[2] / 2, b[1]]], b[3], F.chrome, { off: 0.0125, step: 0.3 })); }
  // o: key, type, cols | paint, W, H, R, wd, A, AY, FW, RW, ZF, ZR, SY, top(s), belt, lean, opts (loft), wheel, win [poly],
  // ws, bs (x,y polygons in front / rear projection), doors [polyline], handles [[z, y]], mirror [z, y], front(c), rear(c), side(c, sx, sn), seat
  function car2(o) {
    const k = kit(), F = fortunerMats(o.black), p = o.paint || cPaint(pickR(o.cols)), PI = Math.PI;
    const { key, W, A, AY, FW, RW, ZF, ZR, SY } = o;
    const geo = loftGeo('c2' + key, s => {
      s.moveTo(ZR + 0.08, SY); s.lineTo(RW - A, SY); s.absarc(RW, AY, A, PI, 0, true); s.lineTo(FW - A, SY); s.absarc(FW, AY, A, PI, 0, true); s.lineTo(ZF - 0.08, SY);
      o.top(s); }, W, Object.assign({ rt: 0.1, rb: 0.05, plan: 0.2, crown: 0.03, bulge: 0.03, lean: o.lean === undefined ? 0.2 : o.lean, leanY: o.belt, step: 0.11, curve: 7 }, o.opts));
    const body = k.add(geo, p), d = decals(k, key, [geo]), Gl = glass2(), c = { k, F, p, d, add: k.add, Gl, key, ZR };
    (o.win || []).forEach((w, i) => { for (const [sx, sn] of SIDES) { const cz = w.reduce((a, q) => a + q[0], 0) / w.length, cy = w.reduce((a, q) => a + q[1], 0) / w.length; d.p('wb' + i, sn, w.map(q => [cz + (q[0] - cz) * 1.04, cy + (q[1] - cy) * 1.05]), F.black, { off: 0.009, step: 0.09, round: 0.04 }); d.p('w' + i, sn, w, Gl, { off: 0.014, step: 0.09, round: 0.035 }); } });
    if (o.ws) { d.p('wsb', 'f', o.ws, F.black, { off: 0.005, step: 0.12, round: 0.06 }); d.p('ws', 'f', o.ws.map(q => [q[0] * 0.97, q[1] * 0.992 + 0.006]), Gl, { off: 0.01, step: 0.12, round: 0.05 }); }
    if (o.bs) { d.p('bsb', 'r', o.bs, F.black, { off: 0.005, step: 0.12, round: 0.06 }); d.p('bs', 'r', o.bs.map(q => [q[0] * 0.97, q[1]]), Gl, { off: 0.01, step: 0.12, round: 0.05 }); }
    for (const [sx, sn] of SIDES) {
      (o.doors || []).forEach((l, i) => d.r('sh' + i, sn, l.map(q => [q[0], q[1] < SY + 0.2 ? SY + 0.1 : q[1]]), 0.009, gapM(), { step: 0.12, off: 0.0085 }));
      (o.handles || []).forEach(([z, y]) => { const m = k.add(rbox(0.025, 0.03, 0.14, 0.01), o.chromeH ? F.chrome : (o.handleP ? p : F.black), sx * (d.x(z, y) + 0.008), y, z); });
      if (o.mirror) carMirror(k, F, o.mirrorBlack ? F.clad : p, sx * (d.x(o.mirror[0], o.mirror[1] - 0.04) - 0.01), o.mirror[1], o.mirror[0]);
      if (o.side) o.side(c, sx, sn);
    }
    liners(k, A, AY, W, [FW, RW]);
    k.add(rbox(W * 0.84, 0.14, ZF - ZR - 0.5, 0.04), F.clad, 0, SY - 0.03, 0);
    if (o.front) o.front(c); if (o.rear) o.rear(c);
    const bsY = (o.bs || [[0, o.belt], [0, o.belt + 0.4]]).map(q => q[1]), bsX = Math.max(...(o.bs || [[W * 0.33, 0]]).map(q => Math.abs(q[0])));
    openParts(c, { W, ZR, belt: o.belt, doors: (o.doors || []).map(l => l.map(q => [q[0], q[1] < SY + 0.2 ? SY + 0.1 : q[1]])), yTop: o.doorTop, hoodY: o.belt - 0.35,
      hood: o.noHood ? null : [o.doors[0][0][0] + 0.1, ZF - 0.14, W / 2 - 0.16], boot: o.boot || { hw: bsX + 0.08, y0: Math.min(...bsY) - 0.45, y1: Math.max(...bsY) + 0.06 }, sunroof: o.sunroof });
    if (o.after) o.after(c);
    const wx = W / 2 - o.wd / 2 - 0.015;
    if (!o.noWheels) for (const [x, z] of [[-wx, FW], [wx, FW], [-wx, RW], [wx, RW]]) carWheel(k, F, o.R, o.wd, x, z, o.wheel);
    const seat = o.seat || [0.38, o.belt - 0.3, 0, 'car'];
    if (!o.noPerson) person(k, seat[0], seat[1], seat[2], { outfit: 'shirt', color: pickR([0xffffff, 0x222222, 0x8fa9c4]) }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR, kind: 'car', type: o.type, snd: o.type, seat };
  }
  // round projector: dark bezel, lit lens, glossy cover
  function proj(c, name, axis, cx, y, r, role) { const n = 14, circle = R => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * R, y + Math.sin(i / n * 6.283) * R]);
    c.d.p(name + 'b', axis, circle(r * 1.25), c.F.chrome, { off: 0.011, round: 0, rings: [1], step: 0.2 });
    c.d.p(name, axis, circle(r), null, { off: 0.014, round: 0, rings: [1], step: 0.2, role: role || 'head' }); }
  function slats(c, name, n, x0, x1, y0, y1, m, off) { for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0.5, y = y0 + (y1 - y0) * t; c.d.r(name + i, 'f', [[x0, y], [x1, y]], Math.abs(y1 - y0) / n * 0.5, m, { off: off || 0.014, step: 0.3 }); } }

  // Maruti Wagon R, third generation (2019): 3655 x 1620 x 1675, wb 2435, 165/70 R14, turning radius 4.7 m.
  // Tallboy box: stubby bonnet, upright screen and tail, tall lamps running up the D pillars, black pillars
  function wagonR() {
    return car2({ key: 'wgr', type: 'wagonR', cols: [0xf2f2ee, 0xf2f2ee, 0xaeb3b8, 0x2d4f7c, 0x7a1d24, 0x3c4045, 0xc9b58f], W: 1.62, H: 1.675, R: 0.294, wd: 0.165, A: 0.345, AY: 0.3, FW: 1.2175, RW: -1.2175, ZF: 1.83, ZR: -1.825, SY: 0.3, belt: 1.02, lean: 0.11,
      opts: { plan: 0.26, rt: 0.09, crown: 0.025 }, wheel: WHEELS.wagonR, seat: [0.34, 0.8, 0.02, 'car'], mirror: [0.8, 1.06], handles: [[0.12, 0.98], [-0.72, 0.98]],
      top: s => { s.lineTo(1.83, 0.5); s.quadraticCurveTo(1.86, 0.7, 1.8, 0.82); s.quadraticCurveTo(1.74, 0.93, 1.56, 0.96); s.lineTo(0.98, 1.05); s.lineTo(0.36, 1.61); s.quadraticCurveTo(0.24, 1.672, 0.02, 1.675); s.lineTo(-1.5, 1.665); s.quadraticCurveTo(-1.7, 1.66, -1.74, 1.56); s.lineTo(-1.82, 1.0); s.lineTo(-1.825, 0.42); s.quadraticCurveTo(-1.82, 0.3, -1.745, 0.3); },
      win: [[[0.84, 1.08], [0.36, 1.53], [-0.1, 1.54], [-0.1, 1.06]], [[-0.17, 1.06], [-0.17, 1.54], [-1.02, 1.53], [-1.02, 1.05]], [[-1.09, 1.05], [-1.09, 1.53], [-1.5, 1.52], [-1.42, 1.1]]],
      ws: [[-0.62, 1.09], [0.62, 1.09], [0.53, 1.58], [-0.53, 1.58]], bs: [[-0.56, 1.12], [0.56, 1.12], [0.52, 1.56], [-0.52, 1.56]],
      doors: [[[0.9, 1.1], [0.92, 0.72], [0.82, 0.42], [-0.14, 0.34], [-0.14, 1.56]], [[-0.14, 1.56], [-1.05, 1.56], [-1.1, 1.05], [-0.92, 0.72], [-0.82, 0.4], [-0.14, 0.34]]],
      front: c => { const { d, F, add } = c;
        d.p('gr', 'f', [[-0.42, 0.74], [0.42, 0.74], [0.38, 0.84], [-0.38, 0.84]], F.black, {}); d.r('grc', 'f', [[-0.46, 0.85], [0, 0.875], [0.46, 0.85]], 0.03, F.chrome, { off: 0.012 });
        d.p('low', 'f', [[-0.5, 0.42], [0.5, 0.42], [0.42, 0.6], [-0.42, 0.6]], F.black, {});
        for (const sx of [-1, 1]) { d.p('hl' + sx, 'f', MIR(sx, [[0.42, 0.72], [0.72, 0.74], [0.77, 0.92], [0.6, 0.93], [0.44, 0.84]]), F.black, { off: 0.006 }); proj(c, 'hp' + sx, 'f', sx * 0.6, 0.83, 0.055); d.r('hdrl' + sx, 'f', MIR(sx, [[0.45, 0.76], [0.72, 0.77]]), 0.016, F.amber, { off: 0.011 });
          d.p('fog' + sx, 'f', MIR(sx, [[0.56, 0.46], [0.72, 0.46], [0.72, 0.58], [0.58, 0.58]]), F.black); }
        plate(c.k, 1.875, 0.52, true); },
      rear: c => { const { d, F } = c;
        for (const [sx, sn] of SIDES) { d.p('tb' + sx, 'r', MIR(sx, [[0.53, 0.94], [0.66, 0.94], [0.62, 1.54], [0.55, 1.54]]), null, { role: 'tail', off: 0.007, step: 0.12 }); d.r('ta' + sx, 'r', MIR(sx, [[0.53, 1.08], [0.65, 1.08]]), 0.08, F.amber, { off: 0.01, step: 0.3 }); }
        d.p('rb', 'r', [[-0.72, 0.36], [0.72, 0.36], [0.76, 0.5], [-0.76, 0.5]], F.clad, { round: 0 }); d.r('rrb', 'r', [[-0.45, 0.46], [0.45, 0.46]], 0.018, F.redLens, { off: 0.01 }); plate(c.k, -1.84, 0.8, false); } });
  }

  // Toyota Innova first generation (2005-15): 4555 x 1770 x 1750, wb 2750, 2KD-FTV 102 hp, turning circle 10.8 m.
  // Soft one-box MPV: sloping bonnet flowing into the screen, big triple-window side, swept lamps, wide chrome grille
  const innovaDef = () => ({ key: 'inv', type: 'innova', cols: [0xefefea, 0xefefea, 0xefefea, 0xb8bcc0, 0x3c3f44, 0x6b1f1f, 0x8a7a5e], W: 1.77, H: 1.75, R: 0.32, wd: 0.205, A: 0.385, AY: 0.33, FW: 1.32, RW: -1.43, ZF: 2.28, ZR: -2.275, SY: 0.33, belt: 1.08, lean: 0.14,
      opts: { plan: 0.34, rt: 0.11, crown: 0.04, bulge: 0.04 }, wheel: WHEELS.mpv, seat: [0.4, 0.86, 0.12, 'car'], mirror: [0.92, 1.12], handles: [[0.26, 1.04], [-0.62, 1.04]], chromeH: true,
      top: s => { s.lineTo(2.28, 0.5); s.quadraticCurveTo(2.3, 0.68, 2.22, 0.84); s.quadraticCurveTo(2.14, 0.95, 1.92, 0.99); s.lineTo(1.1, 1.13); s.lineTo(0.4, 1.68); s.quadraticCurveTo(0.26, 1.74, 0, 1.75); s.lineTo(-1.9, 1.73); s.quadraticCurveTo(-2.1, 1.72, -2.15, 1.6); s.lineTo(-2.26, 1.06); s.lineTo(-2.275, 0.44); s.quadraticCurveTo(-2.27, 0.33, -2.19, 0.33); },
      boot: { hw: 0.66, y0: 0.56, y1: 1.64 }, win: [[[0.98, 1.14], [0.42, 1.6], [-0.1, 1.61], [-0.1, 1.12]], [[-0.18, 1.12], [-0.18, 1.61], [-1.0, 1.6], [-1.0, 1.12]], [[-1.08, 1.12], [-1.08, 1.6], [-2.0, 1.56], [-2.1, 1.14]]],
      ws: [[-0.68, 1.17], [0.68, 1.17], [0.56, 1.64], [-0.56, 1.64]], bs: [[-0.62, 1.12], [0.62, 1.12], [0.55, 1.6], [-0.55, 1.6]],
      doors: [[[1.03, 1.16], [1.04, 0.72], [0.9, 0.42], [-0.14, 0.36], [-0.14, 1.64]], [[-0.14, 1.64], [-1.04, 1.64], [-1.04, 0.96], [-0.98, 0.5], [-0.14, 0.36]]],
      side: (c, sx, sn) => { c.d.r('rub', sn, [[0.9, 0.56], [-0.98, 0.56]], 0.05, c.F.clad, { off: 0.01 }); },
      front: c => { const { d, F, k } = c;
        d.p('gr', 'f', [[-0.46, 0.62], [0.46, 0.62], [0.54, 0.84], [-0.54, 0.84]], F.black, {});
        for (let i = 0; i < 3; i++) d.r('gb' + i, 'f', [[-0.5 + i * 0.03, 0.82 - i * 0.075], [0.5 - i * 0.03, 0.82 - i * 0.075]], 0.026, F.chrome, { off: 0.012, step: 0.3 });
        d.r('gt', 'f', [[-0.54, 0.86], [0.54, 0.86]], 0.02, F.chrome, { off: 0.014 }); k.add(sph(0.05, 12, 8), F.chrome, 0, 0.74, 2.3).scale.set(1.25, 0.8, 0.3);
        d.p('low', 'f', [[-0.6, 0.38], [0.6, 0.38], [0.5, 0.52], [-0.5, 0.52]], F.black);
        for (const [sx, sn] of SIDES) { d.p('hl' + sx, 'f', MIR(sx, [[0.56, 0.72], [0.84, 0.74], [0.87, 0.9], [0.78, 0.95], [0.56, 0.87]]), F.gun, { off: 0.006, step: 0.05 });
          proj(c, 'hp' + sx, 'f', sx * 0.68, 0.81, 0.06); d.p('hs' + sx, sn, [[1.86, 0.84], [2.12, 0.78], [2.16, 0.9], [1.94, 0.96]], F.gun, { step: 0.08 }); d.r('hta' + sx, 'f', MIR(sx, [[0.79, 0.74], [0.84, 0.74]]), 0.04, F.amber, { off: 0.012, step: 0.2 }); d.p('fog' + sx, 'f', MIR(sx, [[0.62, 0.46], [0.76, 0.46], [0.76, 0.56], [0.62, 0.56]]), F.black); }
        plate(k, 2.32, 0.5, true); },
      rear: c => { const { d, F, k } = c;
        for (const [sx, sn] of SIDES) { tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.62, 0.9], [0.75, 0.9], [0.72, 1.32], [0.66, 1.32]]), { led: [MIR(sx, [[0.69, 1.24], [0.69, 1.12]])], amber: [MIR(sx, [[0.66, 1.06], [0.71, 1.06]])], clear: [MIR(sx, [[0.65, 0.97], [0.72, 0.97]])], cw: 0.05 });
          tailUnit(c, 'ts' + sx, sn, [[-2.16, 0.92], [-2.24, 0.9], [-2.19, 1.3], [-2.16, 1.3]], {}); }
        d.p('tgc', 'r', [[-0.56, 0.99], [0.56, 0.99], [0.56, 1.05], [-0.56, 1.05]], F.chrome, { off: 0.0095, step: 0.2, round: 0.012 });
        d.p('rb', 'r', [[-0.84, 0.36], [0.84, 0.36], [0.86, 0.5], [-0.86, 0.5]], F.clad, { round: 0 }); plate(k, -2.29, 0.8, false); k.add(sph(0.045, 12, 8), F.chrome, 0, 0.94, -2.29).scale.set(1.25, 0.8, 0.3);
        rearKit(c, { recess: [0.26, 0.8], wiper: [0, 1.16, 0.6], spoiler: [1.04, 1.66, -2.03, 0.2], refl: [0.6, 0.54, 0.26], badge: [[0.44, 0.92, 0.2, 0.016], [0.58, 0.92, 0.03, 0.03]] }); } });
  function innova() { return car2(innovaDef()); }
  // Innova Crysta on the same lofted body: 4735 x 1830 x 1795, wheelbase 2750. Built at the Innova's size with the
  // arches moved to the Crysta's axles, then scaled, so every decal and lamp rides along. opts: { paint, bare } - bare
  // leaves out wheels and driver (the player's car brings its own).
  const CRY = [1.034, 1.026, 1.04];
  function crystaShell(opts) {
    opts = opts || {};
    const o = innovaDef(); o.key = 'cry'; o.type = 'crysta';
    o.FW = 1.38 / CRY[2]; o.RW = -1.37 / CRY[2]; o.A = 0.445; o.AY = 0.39; o.R = 0.37; o.wd = 0.215;
    o.doors = [[[1.03, 1.16], [1.04, 0.92], [0.9, 0.7], [0.82, 0.42], [-0.14, 0.36], [-0.14, 1.64]], [[-0.14, 1.64], [-1.0, 1.64], [-1.0, 1.02], [-0.9, 0.78], [-0.84, 0.5], [-0.14, 0.36]]];
    o.handles = [[0.26, 1.04], [-0.6, 1.04]];
    if (opts.paint) o.paint = opts.paint; else o.cols = [0xf4f4f0, 0xf4f4f0, 0x9aa0a6, 0x2b2d31, 0x6e1a1e];
    if (opts.bare) { o.noWheels = true; o.noPerson = true; }
    plateText = opts.plate || null; let v; try { v = car2(o); } finally { plateText = null; } v.g.scale.set(CRY[0], CRY[1], CRY[2]); v.len = (o.ZF - o.ZR) * CRY[2];
    return v;
  }

  // Toyota Fortuner, second generation: 4795 x 1855 x 1835, wb 2745, 265/60 R18. High flat bonnet, slim upper grille into
  // the lamps, big trapezoid lower grille, belt that kicks up at the C pillar, broad body-colour D pillar
  function fortuner(black) { const isB = black === true;
    return car2({ key: 'fo2', type: 'fortuner', black: isB, paint: fortunerMats(isB).paint, W: 1.855, H: 1.835, R: 0.388, wd: 0.265, A: 0.46, AY: 0.44, FW: 1.4, RW: -1.345, ZF: 2.4, ZR: -2.395, SY: 0.44, belt: 1.2, lean: 0.14,
      opts: { plan: 0.26, rt: 0.09, crown: 0.03, bulge: 0.025 }, wheel: WHEELS.fortuner, seat: [0.42, 0.95, 0.0, 'car'], mirror: [0.92, 1.24], handles: [[0.24, 1.08], [-0.72, 1.1]], chromeH: true,
      top: s => { s.lineTo(2.385, 0.56); s.lineTo(2.4, 0.98); s.bezierCurveTo(2.4, 1.05, 2.37, 1.08, 2.28, 1.085); s.bezierCurveTo(1.7, 1.12, 1.25, 1.15, 1.0, 1.18); s.lineTo(0.18, 1.76); s.quadraticCurveTo(0.04, 1.825, -0.2, 1.835); s.lineTo(-1.92, 1.82); s.quadraticCurveTo(-2.14, 1.81, -2.2, 1.72); s.lineTo(-2.34, 1.36); s.lineTo(-2.37, 0.98); s.lineTo(-2.395, 0.95); s.lineTo(-2.395, 0.56); s.quadraticCurveTo(-2.39, 0.44, -2.3, 0.44); },
      win: [[[0.88, 1.24], [0.2, 1.71], [-0.12, 1.72], [-0.12, 1.24]], [[-0.2, 1.24], [-0.2, 1.72], [-1.12, 1.72], [-1.14, 1.28]], [[-1.22, 1.33], [-1.22, 1.72], [-1.86, 1.72], [-1.62, 1.39]]],
      ws: [[-0.74, 1.24], [0.74, 1.24], [0.6, 1.73], [-0.6, 1.73]], bs: [[-0.66, 1.4], [0.66, 1.4], [0.56, 1.68], [-0.56, 1.68]],
      doors: [[[0.94, 1.2], [0.94, 0.86], [0.8, 0.52], [-0.14, 0.5], [-0.14, 1.76]], [[-0.14, 1.76], [-1.18, 1.76], [-1.18, 1.3], [-0.98, 0.9], [-0.88, 0.5], [-0.14, 0.5]]],
      side: (c, sx, sn) => { const { d, F, add } = c;
        d.r('belt', sn, [[0.88, 1.21], [-1.14, 1.25], [-1.28, 1.34], [-1.74, 1.37]], 0.02, F.chrome, { off: 0.008 });
        d.p('cladS', sn, [[0.92, 0.46], [-0.88, 0.46], [-0.88, 0.62], [0.92, 0.62]], F.clad, { round: 0 });
        for (const z of [1.4, -1.345]) { const fl = add(tor(0.49, 0.03, 4, 18, Math.PI), F.clad, sx * 0.915, 0.44, z); fl.rotation.y = Math.PI / 2; fl.scale.z = 1.1; }
        add(rbox(0.13, 0.04, 1.75, 0.015), F.clad, sx * 1.0, 0.4, 0.03); add(rbox(0.018, 0.024, 1.7, 0.008), F.silver, sx * 1.066, 0.4, 0.03);
        add(rbox(0.05, 0.035, 2.0, 0.015), F.silver, sx * 0.66, 1.86, -0.95); for (const z of [0.0, -1.9]) add(rbox(0.06, 0.05, 0.1, 0.015), F.clad, sx * 0.66, 1.84, z); },
      front: c => { const { d, F, k } = c;
        d.p('ug', 'f', [[-0.5, 0.88], [0.5, 0.88], [0.5, 1.0], [-0.5, 1.0]], F.mesh, { round: 0, off: 0.008 }); d.r('ub', 'f', [[-0.82, 0.86], [-0.5, 0.92], [0.5, 0.92], [0.82, 0.86]], 0.03, F.chrome, { off: 0.014 });
        d.p('lg', 'f', [[-0.38, 0.47], [0.38, 0.47], [0.54, 0.83], [-0.54, 0.83]], F.mesh, { round: 0, off: 0.008 }); d.r('lgc', 'f', [[-0.54, 0.84], [0.54, 0.84]], 0.024, F.chrome, { off: 0.012 });
        for (const sx of [-1, 1]) { d.r('lgs' + sx, 'f', MIR(sx, [[0.54, 0.84], [0.38, 0.47]]), 0.024, F.chrome, { off: 0.012 });
          d.p('hl' + sx, 'f', MIR(sx, [[0.5, 0.875], [0.8, 0.87], [0.905, 0.95], [0.89, 1.0], [0.55, 0.995]]), F.black, { step: 0.05 }); proj(c, 'p1' + sx, 'f', sx * 0.615, 0.94, 0.03); proj(c, 'p2' + sx, 'f', sx * 0.715, 0.942, 0.03);   // slim swept-back units, small twin projectors
          d.r('dr' + sx, 'f', MIR(sx, [[0.52, 0.887], [0.8, 0.884], [0.885, 0.955]]), 0.014, F.drl, { off: 0.012, step: 0.05 }); d.r('dr2' + sx, 'f', MIR(sx, [[0.78, 0.975], [0.875, 0.985]]), 0.014, F.amber, { off: 0.012, step: 0.05 });
          d.p('fg' + sx, 'f', MIR(sx, [[0.62, 0.49], [0.84, 0.49], [0.87, 0.6], [0.82, 0.79], [0.7, 0.79], [0.6, 0.62]]), F.black);   // tall corner housing
          d.r('fgl' + sx, 'f', MIR(sx, [[0.66, 0.57], [0.81, 0.57]]), 0.028, F.drl, { off: 0.01, step: 0.05 }); d.r('fgc' + sx, 'f', MIR(sx, [[0.6, 0.62], [0.7, 0.79]]), 0.016, F.chrome, { off: 0.011, step: 0.05 }); }
        k.add(sph(0.06, 14, 8), F.chrome, 0, 0.94, 2.43).scale.set(1.25, 0.8, 0.3);
        d.p('sk', 'f', [[-0.42, 0.45], [0.42, 0.45], [0.36, 0.5], [-0.36, 0.5]], F.silver, { round: 0, off: 0.012 }); plate(k, 2.43, 0.55, true); },
      boot: { hw: 0.74, y0: 0.66, y1: 1.74 },
      rear: c => { const { d, F, k, add } = c;
        for (const [sx, sn] of SIDES) { tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.48, 1.21], [0.91, 1.12], [0.93, 1.34], [0.7, 1.35]]), { led: [MIR(sx, [[0.53, 1.215], [0.89, 1.16]]), MIR(sx, [[0.72, 1.315], [0.9, 1.315]])], clear: [MIR(sx, [[0.76, 1.235], [0.87, 1.22]])] });
          tailUnit(c, 'ts' + sx, sn, [[-2.16, 1.21], [-2.385, 1.12], [-2.375, 1.34], [-2.22, 1.35]], { led: [[[-2.2, 1.22], [-2.37, 1.16]], [[-2.24, 1.315], [-2.37, 1.315]]] }); }
        d.p('tgc', 'r', [[-0.5, 1.175], [0.5, 1.175], [0.5, 1.245], [-0.5, 1.245]], F.chrome, { off: 0.0095, step: 0.2, round: 0.012 });
        d.p('rb', 'r', [[-0.8, 0.46], [0.8, 0.46], [0.86, 0.6], [-0.86, 0.6]], F.clad, { round: 0 }); d.r('rs', 'r', [[-0.42, 0.49], [0.42, 0.49]], 0.05, F.silver, { off: 0.01 });
        k.add(sph(0.05, 12, 8), F.chrome, 0, 1.1, -2.415).scale.set(1.25, 0.8, 0.3); plate(k, -2.41, 0.96, false);
        rearKit(c, { recess: [0.26, 0.96], wiper: [0, 1.42, 0.62], spoiler: [1.14, 1.73, -2.1, 0.26], refl: [0.62, 0.66, 0.3], badge: [[0.5, 1.08, 0.24, 0.02]] }); } });
  }

  // Double-cab pickup in the style of the 2021+ Hilux: 5325 x 1855 x 1815, wb 3085, 265/60 R18. High flat bonnet, upright
  // four-door cab, then a separate load bed whose rails sit at window-sill height under a flat black tonneau, with a black
  // tubular sports bar behind the cab. The loft drops to the bed height behind the cab; cover, bar, step bumper are added on top.
  const HILUX_COLS = [0x7f8060, 0x7f8060, 0x7f8060, 0xf2f2ee, 0xb9bdc2, 0x5c6066, 0x111214];   // matte olive bronze (as photographed), white, silver, grey, black
  function hiluxPaint(hex) { if (hex !== 0x7f8060 && hex !== 0x8a8a68) return cPaint(hex); hex = 0x7f8060;
    return mats.hlxOlive || (mats.hlxOlive = (() => { const env = fortunerMats().paint.envMap; return new THREE.MeshPhongMaterial(Object.assign({ color: hex, specular: 0x4a4c3c, shininess: 28 }, env ? { envMap: env, reflectivity: 0.05, combine: THREE.MixOperation } : {})); })()); }
  function hilux(col) { const hex = typeof col === 'number' ? col : pickR(HILUX_COLS), FW = 1.56, RW = -1.525, ZF = 2.56, ZR = -2.765, BED = 1.24, CAB = -1.1;
    const crease = M(new THREE.Color(hex).multiplyScalar(0.7).getHex());
    return car2({ key: 'hlx', type: 'hilux', paint: hiluxPaint(hex), W: 1.855, H: 1.815, R: 0.388, wd: 0.265, A: 0.47, AY: 0.44, FW, RW, ZF, ZR, SY: 0.44, belt: 1.22, lean: 0.14,
      opts: { plan: 0.13, rt: 0.075, crown: 0.018, bulge: 0.022, hwz: z => z > 2.0 ? 1 - 0.13 * Math.pow((z - 2.0) / 0.56, 2) : 1 }, wheel: WHEELS.hilux, seat: [0.42, 0.95, 0.15, 'car'], mirror: [1.02, 1.28], mirrorBlack: true, handles: [[0.24, 1.1], [-0.78, 1.1]],
      top: s => { s.lineTo(2.545, 0.56); s.lineTo(2.56, 1.0); s.bezierCurveTo(2.56, 1.08, 2.52, 1.115, 2.42, 1.12); s.bezierCurveTo(1.9, 1.15, 1.45, 1.18, 1.14, 1.2); s.lineTo(0.36, 1.75); s.quadraticCurveTo(0.22, 1.812, 0.0, 1.815); s.lineTo(-0.82, 1.805); s.quadraticCurveTo(-1.02, 1.8, -1.05, 1.7);
        s.lineTo(CAB, BED); s.lineTo(-2.74, BED); s.lineTo(ZR, 1.21); s.lineTo(ZR, 0.6); s.quadraticCurveTo(-2.76, 0.44, -2.675, 0.44); },
      win: [[[1.0, 1.27], [0.38, 1.7], [0.1, 1.71], [0.1, 1.27]], [[0.02, 1.27], [0.02, 1.71], [-0.78, 1.7], [-0.9, 1.5], [-0.9, 1.29]]],
      ws: [[-0.74, 1.27], [0.74, 1.27], [0.6, 1.72], [-0.6, 1.72]], bs: [[-0.6, 1.36], [0.6, 1.36], [0.54, 1.68], [-0.54, 1.68]],
      doors: [[[1.1, 1.22], [1.1, 0.88], [0.96, 0.52], [0.08, 0.5], [0.08, 1.76]], [[0.08, 1.76], [-0.96, 1.76], [-1.0, 1.3], [-1.0, 1.0], [-0.88, 0.62], [-0.84, 0.5], [0.08, 0.5]]],
      boot: { hw: 0.73, y0: 0.64, y1: 1.21 },
      side: (c, sx, sn) => { const { d, F, add, p } = c;
        d.p('cladS', sn, [[1.0, 0.46], [-0.92, 0.46], [-0.92, 0.6], [1.0, 0.6]], F.clad, { round: 0 });
        for (const z of [FW, RW]) { const fl = add(tor(0.5, 0.05, 6, 20, Math.PI), F.clad, sx * 0.905, 0.44, z); fl.rotation.y = Math.PI / 2; fl.scale.z = 1.3;   // heavy black arch flare
          add(rbox(0.02, 0.03, 0.24, 0.008), F.silver, sx * 0.968, 0.972, z); }                                                                              // silver insert on its crown
        add(rbox(0.16, 0.045, 1.85, 0.015), F.clad, sx * 1.0, 0.4, 0.05);                                                                                    // side step
        [[[2.3, 1.07], [1.16, 1.135]], [[1.05, 1.14], [0.11, 1.15]], [[0.05, 1.15], [-0.97, 1.15]], [[-1.13, 1.15], [-2.72, 1.13]]].forEach((l, i) => d.r('crs' + i, sn, l, 0.012, crease, { off: 0.006 }));   // shoulder crease, one piece per panel
        d.r('cbg', sn, [[CAB + 0.015, 0.5], [CAB + 0.015, BED - 0.02]], 0.022, gapM(), { off: 0.006 });                                                      // gap between cab and bed
        if (sx > 0) { d.p('ffo', sn, [[-1.2, 0.985], [-1.36, 0.985], [-1.36, 1.12], [-1.2, 1.12]], gapM(), { off: 0.005, round: 0.03 }); d.p('ff', sn, [[-1.212, 0.997], [-1.348, 0.997], [-1.348, 1.108], [-1.212, 1.108]], p, { off: 0.0075, round: 0.025 }); }   // fuel flap, left of the bed
        for (const [z, h] of [[FW - 0.52, 0.2], [RW - 0.53, 0.28]]) add(rbox(0.3, h, 0.02, 0.008), F.clad, sx * 0.78, 0.47 - h / 2, z); },                   // mud flaps
      front: c => { const { d, F, k } = c;
        d.p('gr', 'f', [[-0.46, 0.6], [0.46, 0.6], [0.64, 0.82], [0.56, 1.02], [-0.56, 1.02], [-0.64, 0.82]], F.mesh, { round: 0, off: 0.008 });               // hexagonal grille
        d.r('gbar', 'f', [[-0.62, 0.74], [0.62, 0.74]], 0.11, F.black, { off: 0.011 });
        d.r('uf', 'f', [[-0.61, 1.035], [-0.7, 0.82], [-0.5, 0.585], [0.5, 0.585], [0.7, 0.82], [0.61, 1.035]], 0.06, F.chrome, { off: 0.013, step: 0.06 });  // thick U frame down from the lamps
        d.p('lb', 'f', [[-0.7, 0.46], [0.7, 0.46], [0.7, 0.57], [-0.7, 0.57]], F.clad, { round: 0, off: 0.007 });
        for (const [sx, sn] of SIDES) {
          d.p('hl' + sx, 'f', MIR(sx, [[0.63, 0.955], [0.84, 0.95], [0.915, 1.01], [0.9, 1.065], [0.64, 1.055]]), F.black, { step: 0.05 }); proj(c, 'p1' + sx, 'f', sx * 0.7, 1.012, 0.028); proj(c, 'p2' + sx, 'f', sx * 0.785, 1.014, 0.028);
          d.r('dr' + sx, 'f', MIR(sx, [[0.65, 1.045], [0.65, 0.972], [0.86, 0.968]]), 0.014, F.drl, { off: 0.012, step: 0.04 }); d.r('dr2' + sx, 'f', MIR(sx, [[0.83, 1.045], [0.89, 1.045]]), 0.014, F.amber, { off: 0.012, step: 0.05 });   // L-shaped signature
          d.p('hs' + sx, sn, [[2.2, 1.0], [2.47, 0.97], [2.47, 1.05], [2.16, 1.07]], F.black, { step: 0.06 });
          d.p('fg' + sx, 'f', MIR(sx, [[0.66, 0.48], [0.88, 0.48], [0.9, 0.6], [0.86, 0.8], [0.74, 0.8], [0.66, 0.64]]), F.clad, { off: 0.008 });               // corner of the black lower bumper
          d.p('fgt' + sx, 'f', MIR(sx, [[0.71, 0.6], [0.85, 0.6], [0.85, 0.735], [0.71, 0.735]]), F.silver, { off: 0.011, round: 0.015 }); d.p('fgb' + sx, 'f', MIR(sx, [[0.727, 0.617], [0.833, 0.617], [0.833, 0.718], [0.727, 0.718]]), F.black, { off: 0.0125, round: 0.01 });
          d.p('fgl' + sx, 'f', MIR(sx, [[0.75, 0.637], [0.81, 0.637], [0.81, 0.698], [0.75, 0.698]]), F.lensClear, { off: 0.014, round: 0.01 }); }               // square fog lamp, silver surround
        k.add(sph(0.06, 14, 8), F.chrome, 0, 0.91, ZF + 0.03).scale.set(1.25, 0.8, 0.3);
        d.p('sk', 'f', [[-0.5, 0.445], [0.5, 0.445], [0.42, 0.52], [-0.42, 0.52]], F.silver, { round: 0, off: 0.012 }); plate(k, ZF + 0.03, 0.735, true); },
      rear: c => { const { d, F, k, add } = c;
        for (const [sx, sn] of SIDES) {
          tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.74, 0.84], [0.87, 0.84], [0.87, 1.17], [0.74, 1.17]]), { led: [MIR(sx, [[0.765, 1.14], [0.847, 1.14], [0.847, 0.87], [0.765, 0.87]])], clear: [MIR(sx, [[0.785, 1.08], [0.785, 0.93]])], cw: 0.045 });   // tall lamp, C signature, clear inner strip
          tailUnit(c, 'ts' + sx, sn, [[-2.58, 0.84], [-2.72, 0.84], [-2.72, 1.17], [-2.58, 1.17]], { led: [[[-2.61, 1.14], [-2.61, 0.87]]] }); }
        d.p('hh', 'r', [[-0.21, 1.1], [-0.17, 1.035], [0.17, 1.035], [0.21, 1.1], [0.17, 1.165], [-0.17, 1.165]], F.black, { round: 0.01, off: 0.009 });       // handle housing with the high brake light
        d.r('hbl', 'r', [[-0.13, 1.138], [0.13, 1.138]], 0.022, F.tailLed, { off: 0.012 }); d.r('hhr', 'r', [[-0.08, 1.075], [0.08, 1.075]], 0.034, F.gun, { off: 0.012 });
        add(rbox(1.84, 0.15, 0.2, 0.04), F.chrome, 0, 0.585, ZR - 0.03); add(rbox(0.72, 0.035, 0.22, 0.01), F.clad, 0, 0.665, ZR - 0.035); add(rbox(0.62, 0.13, 0.03, 0.01), F.clad, 0, 0.585, ZR - 0.125);   // chrome step bumper, black tread and centre
        plate(k, ZR - 0.145, 0.585, false); rearKit(c, { badge: [[-0.5, 0.78, 0.2, 0.022], [0.52, 0.78, 0.14, 0.022]] }); },
      after: c => { const { F, k, add } = c, up = new THREE.Vector3(0, 1, 0), a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
        const tube = (a, b, r) => { a3.fromArray(a); b3.fromArray(b); const L = a3.distanceTo(b3), m = add(cyl(r, r, 1, 8), F.matte, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.scale.y = L; m.quaternion.setFromUnitVectors(up, b3.sub(a3).normalize()); return m; };
        const bt = k.parts.boot; if (bt && bt.mesh) { const dy = 1.21 - 0.64; bt.mesh.position.y -= dy; bt.mesh.children.forEach(m => { m.position.y += dy; }); bt.hingeSide = 'bottom'; bt.open = -1.45; }   // a tailgate drops down
        add(rbox(1.7, 0.036, 1.57, 0.012), F.fabric, 0, BED + 0.012, (CAB - 0.05 + ZR + 0.04) / 2);                                                         // tonneau cover
        for (const sx of [-1, 1]) add(rbox(0.035, 0.022, 1.57, 0.008), F.matte, sx * 0.85, BED + 0.006, (CAB - 0.05 + ZR + 0.04) / 2);                        // its side rails
        const T = [0.76, 1.75, CAB - 0.2], r = 0.032;                                                                                                        // sports bar: hoop behind the cab, stays sloping back onto the rails
        for (const sx of [-1, 1]) { tube([sx * 0.84, BED, CAB - 0.1], [sx * T[0], T[1], T[2]], r); tube([sx * T[0], T[1], T[2]], [sx * 0.84, BED, CAB - 1.05], r); tube([sx * 0.8, BED + 0.26, CAB - 0.153], [sx * 0.8, BED + 0.26, CAB - 0.62], r * 0.8);
          add(sph(r * 1.05, 8, 6), F.matte, sx * T[0], T[1], T[2]); for (const z of [CAB - 0.1, CAB - 1.05]) add(rbox(0.09, 0.03, 0.14, 0.01), F.matte, sx * 0.84, BED + 0.02, z); }
        tube([-T[0], T[1], T[2]], [T[0], T[1], T[2]], r);
        const an = add(cyl(0.004, 0.007, 0.34, 5), F.matte, 0.52, 1.93, 0.14); an.rotation.x = -0.45; add(cyl(0.016, 0.02, 0.03, 8), F.matte, 0.52, 1.795, 0.215); } });   // short whip antenna on the front of the roof
  }

  // Toyota Land Cruiser 300: 4985 x 1980 x 1945, wb 2850, 265/65 R18. Very wide flat front with a huge bar grille between
  // deep stepped lamps, long upright flanks with a straight belt, big quarter glass, horizontal tail lamps over a chrome bar
  function landCruiser() {
    return car2({ key: 'lc3', type: 'landCruiser', cols: [0xf0efe9, 0xf0efe9, 0x101114, 0x101114, 0x8d9196, 0x3a3226], W: 1.98, H: 1.945, R: 0.395, wd: 0.265, A: 0.47, AY: 0.45, FW: 1.46, RW: -1.39, ZF: 2.49, ZR: -2.495, SY: 0.46, belt: 1.3, lean: 0.11,
      opts: { plan: 0.3, rt: 0.09, crown: 0.022, bulge: 0.02 }, wheel: WHEELS.landCruiser, seat: [0.45, 1.0, 0, 'car'], mirror: [0.94, 1.34], handles: [[0.2, 1.18], [-0.84, 1.18]], chromeH: true,
      top: s => { s.lineTo(2.47, 0.6); s.lineTo(2.49, 1.08); s.quadraticCurveTo(2.48, 1.2, 2.34, 1.22); s.lineTo(1.08, 1.3); s.lineTo(0.3, 1.86); s.quadraticCurveTo(0.14, 1.94, -0.1, 1.945); s.lineTo(-2.14, 1.92); s.quadraticCurveTo(-2.3, 1.9, -2.34, 1.8); s.lineTo(-2.46, 1.3); s.lineTo(-2.495, 1.06); s.lineTo(-2.495, 0.58); s.quadraticCurveTo(-2.49, 0.46, -2.4, 0.46); },
      boot: { hw: 0.78, y0: 0.7, y1: 1.84 }, win: [[[0.98, 1.34], [0.32, 1.81], [-0.2, 1.82], [-0.2, 1.33]], [[-0.28, 1.33], [-0.28, 1.82], [-1.26, 1.82], [-1.26, 1.33]], [[-1.34, 1.33], [-1.34, 1.82], [-2.14, 1.8], [-2.28, 1.36]]],
      ws: [[-0.8, 1.35], [0.8, 1.35], [0.68, 1.83], [-0.68, 1.83]], bs: [[-0.74, 1.36], [0.74, 1.36], [0.64, 1.78], [-0.64, 1.78]],
      doors: [[[1.02, 1.3], [1.02, 0.94], [0.92, 0.54], [-0.24, 0.5], [-0.24, 1.88]], [[-0.24, 1.88], [-1.3, 1.88], [-1.3, 1.3], [-1.02, 0.96], [-0.92, 0.5], [-0.24, 0.5]]],
      side: (c, sx, sn) => { const { d, F, add } = c;
        d.r('cr', sn, [[2.2, 1.14], [-2.3, 1.14]], 0.012, F.black, { off: 0.003 }); d.p('cl', sn, [[1.0, 0.48], [-0.92, 0.48], [-0.92, 0.66], [1.0, 0.66]], F.clad, { round: 0 });
        add(rbox(0.15, 0.04, 1.75, 0.015), F.clad, sx * 1.04, 0.42, 0.04); add(rbox(0.05, 0.035, 2.4, 0.015), F.silver, sx * 0.76, 1.97, -1.0); for (const z of [0.1, -2.1]) add(rbox(0.06, 0.05, 0.1, 0.015), F.clad, sx * 0.76, 1.95, z); },
      front: c => { const { d, F, k } = c;
        d.p('gs', 'f', [[-0.62, 0.72], [0.62, 0.72], [0.66, 1.14], [-0.66, 1.14]], F.chrome, { round: 0, off: 0.007 }); d.p('gb', 'f', [[-0.58, 0.75], [0.58, 0.75], [0.62, 1.11], [-0.62, 1.11]], F.black, { round: 0, off: 0.01 });
        slats(c, 'gv', 5, -0.6, 0.6, 0.79, 1.07, F.chrome, 0.015); d.r('gm', 'f', [[0, 0.76], [0, 1.1]], 0.05, F.chrome, { off: 0.016, step: 0.3 }); k.add(sph(0.07, 14, 8), F.chrome, 0, 0.93, 2.52).scale.set(1.25, 0.85, 0.3);
        for (const sx of [-1, 1]) { d.p('hl' + sx, 'f', MIR(sx, [[0.68, 0.84], [0.96, 0.82], [0.98, 1.14], [0.68, 1.14]]), F.black, { step: 0.05 }); proj(c, 'p1' + sx, 'f', sx * 0.76, 1.03, 0.05); proj(c, 'p2' + sx, 'f', sx * 0.89, 1.03, 0.05); d.r('dr' + sx, 'f', MIR(sx, [[0.7, 0.9], [0.94, 0.88]]), 0.02, F.drl, { off: 0.012, step: 0.05 });
          d.p('fg' + sx, 'f', MIR(sx, [[0.66, 0.52], [0.9, 0.52], [0.9, 0.66], [0.66, 0.66]]), F.black, { round: 0 }); d.r('fl' + sx, 'f', MIR(sx, [[0.7, 0.59], [0.86, 0.59]]), 0.02, F.drl, { off: 0.01, step: 0.3 }); }
        d.p('lg', 'f', [[-0.56, 0.5], [0.56, 0.5], [0.6, 0.68], [-0.6, 0.68]], F.black, { round: 0 }); d.p('sk', 'f', [[-0.5, 0.46], [0.5, 0.46], [0.42, 0.53], [-0.42, 0.53]], F.silver, { round: 0, off: 0.012 }); plate(k, 2.52, 0.6, true); },
      rear: c => { const { d, F, k } = c;
        for (const [sx, sn] of SIDES) { tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.44, 1.15], [0.97, 1.13], [0.97, 1.31], [0.44, 1.27]]), { led: [MIR(sx, [[0.48, 1.24], [0.95, 1.27]]), MIR(sx, [[0.48, 1.18], [0.95, 1.17]])], clear: [MIR(sx, [[0.5, 1.21], [0.62, 1.21]])], cw: 0.03 });
          tailUnit(c, 'ts' + sx, sn, [[-2.24, 1.2], [-2.485, 1.13], [-2.47, 1.31], [-2.28, 1.33]], { led: [[[-2.28, 1.24], [-2.46, 1.27]], [[-2.3, 1.19], [-2.46, 1.17]]] }); }
        d.r('tb', 'r', [[-0.42, 1.2], [0.42, 1.2]], 0.075, F.chrome, { off: 0.008, step: 0.3 }); k.add(sph(0.06, 12, 8), F.chrome, 0, 1.08, -2.52).scale.set(1.25, 0.85, 0.3);
        d.p('rb', 'r', [[-0.92, 0.48], [0.92, 0.48], [0.96, 0.64], [-0.96, 0.64]], F.clad, { round: 0 }); d.r('rs', 'r', [[-0.5, 0.5], [0.5, 0.5]], 0.05, F.silver, { off: 0.01 }); plate(k, -2.51, 0.94, false); rearKit(c, { recess: [0.27, 0.94], wiper: [0, 1.4, 0.7], spoiler: [1.24, 1.85, -2.25, 0.24], refl: [0.74, 0.7, 0.3] }); } });
  }

  // Mahindra Thar Roxx: 4428 x 1870 x 1923, wb 2850, 255/65 R18 or 255/60 R19. Upright slab screen, flat bonnet, six slots
  // in the grille, round lamps in C rings, square black arches, door handle up in the C pillar, tail-gate spare
  function tharRoxx() {
    return car2({ key: 'trx', type: 'tharRoxx', cols: [0x101114, 0x101114, 0xe9e7df, 0x7a2028, 0x4c5a3e, 0xa3845c], W: 1.87, H: 1.923, R: 0.395, wd: 0.255, A: 0.46, AY: 0.48, FW: 1.42, RW: -1.43, ZF: 2.21, ZR: -2.218, SY: 0.5, belt: 1.32, lean: 0.05,
      opts: { plan: 0.14, rt: 0.06, crown: 0.012, bulge: 0.01, rb: 0.03 }, wheel: WHEELS.tharRoxx, seat: [0.42, 1.02, 0, 'car'], mirror: [0.82, 1.36], handles: [[0.2, 1.24], [-1.14, 1.42]],
      top: s => { s.lineTo(2.21, 0.72); s.lineTo(2.21, 1.2); s.quadraticCurveTo(2.2, 1.28, 2.12, 1.285); s.lineTo(0.98, 1.34); s.lineTo(0.6, 1.88); s.quadraticCurveTo(0.54, 1.923, 0.44, 1.923); s.lineTo(-2.04, 1.92); s.quadraticCurveTo(-2.14, 1.92, -2.16, 1.84); s.lineTo(-2.2, 1.32); s.lineTo(-2.218, 0.7); s.lineTo(-2.2, 0.5); },
      boot: { hw: 0.66, y0: 0.82, y1: 1.86, side: true }, win: [[[0.86, 1.38], [0.56, 1.8], [-0.2, 1.81], [-0.2, 1.37]], [[-0.28, 1.37], [-0.28, 1.81], [-1.02, 1.81], [-1.02, 1.37]], [[-1.42, 1.38], [-1.42, 1.8], [-2.0, 1.79], [-2.04, 1.4]]],
      ws: [[-0.74, 1.39], [0.74, 1.39], [0.72, 1.84], [-0.72, 1.84]], bs: [[-0.62, 1.42], [0.62, 1.42], [0.6, 1.78], [-0.6, 1.78]],
      doors: [[[0.92, 1.36], [0.92, 0.96], [0.86, 0.56], [-0.24, 0.54], [-0.24, 1.86]], [[-0.24, 1.86], [-1.2, 1.86], [-1.2, 1.1], [-0.96, 0.96], [-0.9, 0.54], [-0.24, 0.54]]],
      side: (c, sx, sn) => { const { d, F, add } = c;
        d.r('rft', sn, [[0.5, 1.86], [-2.1, 1.86]], 0.03, F.black, { off: 0.006 });
        d.r('cant', sn, [[0.92, 1.34], [-2.1, 1.34]], 0.012, F.clad, { off: 0.004 });
        for (const z of [1.42, -1.43]) { const r = 0.57; for (const [a, b] of [[[z - r, 0.5], [z - r, 0.84]], [[z - r, 0.84], [z - r + 0.2, 1.04]], [[z - r + 0.2, 1.04], [z + r - 0.2, 1.04]], [[z + r - 0.2, 1.04], [z + r, 0.84]], [[z + r, 0.84], [z + r, 0.5]]]) slab(c.k, F.clad, sx * 0.945, a, b, 0.11, 0.05); }
        add(rbox(0.12, 0.04, 1.7, 0.015), F.clad, sx * 0.98, 0.44, -0.005); },
      front: c => { const { d, F, k } = c;
        for (let i = 0; i < 6; i++) { const x = -0.375 + i * 0.15; d.p('sl' + i, 'f', [[x - 0.05, 0.84], [x + 0.05, 0.84], [x + 0.05, 1.18], [x - 0.05, 1.18]], F.gun, { off: 0.01, step: 0.1, round: 0.03 }); for (const e of [-1, 1]) d.r('slc' + i + e, 'f', [[x + e * 0.052, 0.86], [x + e * 0.052, 1.16]], 0.008, F.silver, { off: 0.013, step: 0.3 }); }
        for (const sx of [-1, 1]) { const n = 16, cx = sx * 0.69, ring = R => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * R, 1.02 + Math.sin(i / n * 6.283) * R]);
          d.p('hb' + sx, 'f', ring(0.165), F.black, { round: 0, rings: [1], step: 0.2 }); proj(c, 'hp' + sx, 'f', cx, 1.02, 0.09);
          d.r('cdrl' + sx, 'f', Array.from({ length: 9 }, (_, i) => { const a = (sx > 0 ? -1.4 : 1.74) + i / 8 * 3.0; return [cx + Math.cos(a) * 0.135, 1.02 + Math.sin(a) * 0.135]; }), 0.018, F.drl, { off: 0.013, step: 0.05 }); }
        c.add(rbox(1.92, 0.26, 0.2, 0.05), F.clad, 0, 0.62, 2.16); c.add(rbox(0.9, 0.05, 0.1, 0.02), F.silver, 0, 0.54, 2.22); for (const sx of [-1, 1]) { const f = c.add(cyl(0.05, 0.05, 0.02, 12), F.drl, sx * 0.68, 0.68, 2.262); f.rotation.x = Math.PI / 2; const hk = c.add(rbox(0.05, 0.1, 0.06, 0.01), M(0xc21c1c), sx * 0.34, 0.74, 2.27); }
        plate(k, 2.27, 0.66, true); },
      rear: c => { const { d, F, k, add } = c;
        for (const [sx, sn] of SIDES) { tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.74, 0.9], [0.9, 0.9], [0.9, 1.3], [0.74, 1.3]]), { led: [MIR(sx, [[0.78, 1.26], [0.86, 1.26]]), MIR(sx, [[0.78, 1.18], [0.86, 1.18]])], clear: [MIR(sx, [[0.76, 0.96], [0.88, 0.96]])], cw: 0.05 }); }
        const sp = add(tyreGeo(0.39, 0.25), rubber, 0.1, 1.1, -2.36); sp.rotation.y = Math.PI / 2; const hub = add(cyl(0.2, 0.22, 0.1, 16), F.gun, 0.1, 1.1, -2.42); hub.rotation.x = Math.PI / 2; add(rbox(1.9, 0.3, 0.2, 0.05), F.clad, 0, 0.64, -2.16); plate(k, -2.27, 0.64, false); } });
  }

  // Boxy long-wheelbase off-roader, unbranded: 4758 x 1996 x 1967 (5018 over the spare), wb 3022, 255/60 R20; rear door hinged at the side, spare on it
  function defender() {
    return car2({ key: 'df1', type: 'defender', cols: [0xdcdcd4, 0x24282a, 0x4e5a4c, 0x7d8285, 0x9c8a68], W: 1.996, H: 1.967, R: 0.39, wd: 0.255, A: 0.47, AY: 0.47, FW: 1.46, RW: -1.56, ZF: 2.37, ZR: -2.39, SY: 0.5, belt: 1.32, lean: 0.06,
      opts: { plan: 0.16, rt: 0.08, crown: 0.012, bulge: 0.012, rb: 0.03 }, wheel: WHEELS.defender, seat: [0.45, 1.0, 0, 'car'], mirror: [0.94, 1.36], handles: [[0.2, 1.2], [-0.86, 1.2]],
      top: s => { s.lineTo(2.35, 0.6); s.lineTo(2.37, 1.1); s.quadraticCurveTo(2.36, 1.2, 2.24, 1.22); s.lineTo(1.0, 1.31); s.lineTo(0.42, 1.9); s.quadraticCurveTo(0.3, 1.96, 0.1, 1.967); s.lineTo(-2.25, 1.95); s.quadraticCurveTo(-2.36, 1.93, -2.38, 1.82); s.lineTo(-2.39, 1.06); s.lineTo(-2.39, 0.58); s.quadraticCurveTo(-2.385, 0.46, -2.3, 0.46); },
      boot: { hw: 0.82, y0: 0.62, y1: 1.86, side: true }, win: [[[0.94, 1.35], [0.42, 1.84], [-0.2, 1.85], [-0.2, 1.35]], [[-0.28, 1.35], [-0.28, 1.85], [-1.26, 1.85], [-1.26, 1.35]], [[-1.42, 1.5], [-1.42, 1.84], [-2.2, 1.84], [-2.2, 1.5]]],
      ws: [[-0.84, 1.36], [0.84, 1.36], [0.74, 1.86], [-0.74, 1.86]], bs: [[-0.5, 1.4], [0.5, 1.4], [0.5, 1.82], [-0.5, 1.82]],
      doors: [[[0.98, 1.31], [0.98, 0.96], [0.88, 0.54], [-0.24, 0.5], [-0.24, 1.9]], [[-0.24, 1.9], [-1.32, 1.9], [-1.32, 1.3], [-1.06, 0.96], [-0.96, 0.5], [-0.24, 0.5]]],
      side: (c, sx, sn) => { const { d, F, add } = c;
        for (const z of [1.46, -1.56]) { const r = 0.56; for (const [a, b] of [[[z - r, 0.5], [z - r, 0.92]], [[z - r, 0.92], [z - r + 0.14, 1.04]], [[z - r + 0.14, 1.04], [z + r - 0.14, 1.04]], [[z + r - 0.14, 1.04], [z + r, 0.92]], [[z + r, 0.92], [z + r, 0.5]]]) slab(c.k, F.clad, sx * 0.97, a, b, 0.09, 0.04); }
        d.p('cl', sn, [[0.9, 0.48], [-0.96, 0.48], [-0.96, 0.62], [0.9, 0.62]], F.clad, { round: 0 }); add(rbox(0.12, 0.04, 1.75, 0.015), F.clad, sx * 1.02, 0.44, -0.05);
        d.p('alp', sn, [[-1.42, 1.86], [-2.2, 1.86], [-2.2, 1.9], [-1.42, 1.9]], F.black, { round: 0, off: 0.004 }); add(rbox(0.05, 0.035, 2.3, 0.015), F.black, sx * 0.8, 1.985, -1.0); },
      front: c => { const { d, F, k } = c;
        d.p('gb', 'f', [[-0.72, 0.8], [0.72, 0.8], [0.72, 1.14], [-0.72, 1.14]], F.black, { round: 0, off: 0.006 }); slats(c, 'gv', 3, -0.68, 0.68, 0.84, 1.1, F.silver, 0.016);
        for (const sx of [-1, 1]) { d.p('hl' + sx, 'f', MIR(sx, [[0.72, 0.84], [0.97, 0.84], [0.97, 1.14], [0.72, 1.14]]), F.black, { step: 0.05, off: 0.006 }); proj(c, 'p1' + sx, 'f', sx * 0.845, 0.99, 0.085); d.r('dr' + sx, 'f', Array.from({ length: 9 }, (_, i) => { const a = i / 8 * 6.283; return [sx * 0.845 + Math.cos(a) * 0.1, 0.99 + Math.sin(a) * 0.1]; }), 0.016, F.drl, { off: 0.012, step: 0.05 }); }
        d.p('lg', 'f', [[-0.8, 0.5], [0.8, 0.5], [0.84, 0.76], [-0.84, 0.76]], F.clad, { round: 0, off: 0.008 }); d.p('sk', 'f', [[-0.58, 0.46], [0.58, 0.46], [0.5, 0.54], [-0.5, 0.54]], F.silver, { round: 0, off: 0.012 }); plate(k, 2.4, 0.64, true); },
      rear: c => { const { F, k, add } = c;
        for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.78, 1.0], [0.95, 1.0], [0.95, 1.44], [0.78, 1.44]]), { led: [MIR(sx, [[0.8, 1.38], [0.93, 1.38]]), MIR(sx, [[0.8, 1.28], [0.93, 1.28]])], clear: [MIR(sx, [[0.82, 1.08], [0.91, 1.08]])], cw: 0.05 });
        const sp = add(tyreGeo(0.39, 0.25), rubber, 0.05, 1.12, -2.54); sp.rotation.y = Math.PI / 2; const hub = add(cyl(0.21, 0.23, 0.1, 18), F.gun, 0.05, 1.12, -2.67); hub.rotation.x = Math.PI / 2;
        add(rbox(1.9, 0.2, 0.16, 0.04), F.clad, 0, 0.6, -2.36); plate(k, -2.45, 0.68, false); } });
  }

  // Boxy luxury off-roader, unbranded: 4663 x 1984 x 1966 (4873 over the spare), wb 2890, 275/50 R20; upright screen, round lamps, indicators on the wings, exposed hinges
  function gclass() {
    return car2({ key: 'gw1', type: 'gclass', cols: [0x0f1012, 0xe6e6e0, 0x5e6468, 0x2e3a2e, 0x7a1820], W: 1.984, H: 1.966, R: 0.385, wd: 0.275, A: 0.47, AY: 0.47, FW: 1.46, RW: -1.43, ZF: 2.26, ZR: -2.39, SY: 0.5, belt: 1.28, lean: 0.03,
      opts: { plan: 0.1, rt: 0.05, crown: 0.008, bulge: 0.008, rb: 0.03 }, wheel: WHEELS.gclass, seat: [0.45, 1.0, 0, 'car'], mirror: [0.92, 1.36], handles: [[0.16, 1.2], [-0.8, 1.2]], chromeH: true,
      top: s => { s.lineTo(2.24, 0.6); s.lineTo(2.26, 1.12); s.lineTo(2.2, 1.2); s.lineTo(0.95, 1.27); s.lineTo(0.7, 1.92); s.quadraticCurveTo(0.68, 1.96, 0.6, 1.966); s.lineTo(-2.3, 1.96); s.quadraticCurveTo(-2.37, 1.95, -2.38, 1.88); s.lineTo(-2.39, 0.58); s.quadraticCurveTo(-2.385, 0.46, -2.3, 0.46); },
      boot: { hw: 0.82, y0: 0.62, y1: 1.88, side: true }, win: [[[0.9, 1.32], [0.66, 1.86], [-0.2, 1.87], [-0.2, 1.32]], [[-0.28, 1.32], [-0.28, 1.87], [-1.2, 1.87], [-1.2, 1.32]], [[-1.32, 1.32], [-1.32, 1.87], [-2.22, 1.87], [-2.22, 1.32]]],
      ws: [[-0.84, 1.3], [0.84, 1.3], [0.8, 1.88], [-0.8, 1.88]], bs: [[-0.56, 1.36], [0.56, 1.36], [0.56, 1.84], [-0.56, 1.84]],
      doors: [[[0.94, 1.27], [0.94, 0.96], [0.86, 0.54], [-0.24, 0.5], [-0.24, 1.9]], [[-0.24, 1.9], [-1.26, 1.9], [-1.26, 1.3], [-1.02, 0.96], [-0.92, 0.5], [-0.24, 0.5]]],
      side: (c, sx, sn) => { const { d, F, add } = c;
        d.r('rl', sn, [[0.6, 1.9], [-2.3, 1.9]], 0.022, F.chrome, { off: 0.006 }); d.r('cr', sn, [[2.2, 1.06], [-2.35, 1.06]], 0.03, F.black, { off: 0.005 }); d.p('cl', sn, [[0.9, 0.48], [-0.9, 0.48], [-0.9, 0.62], [0.9, 0.62]], F.clad, { round: 0 });
        add(rbox(0.13, 0.04, 1.7, 0.015), F.silver, sx * 1.02, 0.46, -0.0);
        for (const z of [0.88, -0.2]) for (const y of [0.78, 1.14]) add(rbox(0.03, 0.09, 0.05, 0.01), F.chrome, sx * 0.995, y, z);
        add(rbox(0.05, 0.05, 0.2, 0.012), F.drl, sx * 0.89, 1.25, 1.84); add(rbox(0.1, 0.42, 0.04, 0.012), F.black, sx * 0.99, 0.82, 1.98); },
      front: c => { const { d, F, k } = c;
        d.p('gb', 'f', [[-0.58, 0.78], [0.58, 0.78], [0.58, 1.14], [-0.58, 1.14]], F.black, { round: 0, off: 0.006 }); slats(c, 'gv', 3, -0.55, 0.55, 0.82, 1.1, F.chrome, 0.018);
        for (const sx of [-1, 1]) { const n = 18, cx = sx * 0.77, ring = R => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * R, 0.97 + Math.sin(i / n * 6.283) * R]); d.p('hb' + sx, 'f', ring(0.17), F.chrome, { round: 0, rings: [1], step: 0.2 }); d.p('hc' + sx, 'f', ring(0.15), F.black, { round: 0, rings: [1], step: 0.2, off: 0.008 }); proj(c, 'hp' + sx, 'f', cx, 0.97, 0.085); d.r('cdrl' + sx, 'f', Array.from({ length: 19 }, (_, i) => [cx + Math.cos(i / 18 * 6.283) * 0.125, 0.97 + Math.sin(i / 18 * 6.283) * 0.125]), 0.014, F.drl, { off: 0.013, step: 0.05 }); }
        c.add(rbox(1.9, 0.24, 0.16, 0.04), F.black, 0, 0.62, 2.24); c.add(rbox(1.0, 0.05, 0.08, 0.02), F.chrome, 0, 0.52, 2.29); plate(k, 2.33, 0.66, true); },
      rear: c => { const { F, k, add } = c;
        for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.78, 0.92], [0.96, 0.92], [0.96, 1.3], [0.78, 1.3]]), { led: [MIR(sx, [[0.8, 1.24], [0.94, 1.24]]), MIR(sx, [[0.8, 1.14], [0.94, 1.14]])], clear: [MIR(sx, [[0.82, 1.0], [0.92, 1.0]])], cw: 0.05 });
        const sp = add(tyreGeo(0.385, 0.27), rubber, 0.08, 1.14, -2.54); sp.rotation.y = Math.PI / 2; const hub = add(cyl(0.4, 0.4, 0.27, 28), F.black, 0.08, 1.14, -2.54); hub.rotation.x = Math.PI / 2; const rim = add(cyl(0.34, 0.34, 0.02, 28), F.chrome, 0.08, 1.14, -2.68); rim.rotation.x = Math.PI / 2;
        add(rbox(1.92, 0.22, 0.16, 0.04), F.black, 0, 0.62, -2.36); plate(k, -2.45, 0.7, false); } });
  }

  // Mahindra Thar, second generation, three-door convertible: 3985 x 1820 x 1855, wb 2450, 255/65 R18. Open tub behind a fixed screen
  // frame; userData.top is the canvas top (setPart folds it down behind the rear seat), the doors keep their framed windows
  function thar() { const belt = 1.32, topY = 1.84;
    return car2({ key: 'th3', type: 'thar', cols: [0x7a2028, 0x101114, 0xe9e7df, 0xa3845c, 0x4c5a3e], W: 1.82, H: 1.855, R: 0.39, wd: 0.255, A: 0.46, AY: 0.48, FW: 1.25, RW: -1.2, ZF: 1.94, ZR: -1.72, SY: 0.5, belt, lean: 0.04,
      opts: { plan: 0.12, rt: 0.06, crown: 0.01, bulge: 0.01, rb: 0.03 }, wheel: WHEELS.tharRoxx, seat: [0.4, 1.02, -0.1, 'car'], mirror: [0.72, 1.38], handles: [[-0.08, 1.2]], doorTop: 1.9,
      top: s => { s.lineTo(1.94, 0.72); s.lineTo(1.94, 1.2); s.quadraticCurveTo(1.93, 1.28, 1.86, 1.285); s.lineTo(0.92, 1.33); s.lineTo(-1.67, belt); s.quadraticCurveTo(-1.72, belt, -1.72, 1.28); s.lineTo(-1.72, 0.7); s.lineTo(-1.7, 0.5); },
      doors: [[[0.86, 1.31], [0.86, 0.92], [0.78, 0.56], [-0.22, 0.54], [-0.22, 1.31]]], boot: { hw: 0.66, y0: 0.82, y1: 1.3, side: true },
      side: (c, sx) => { const { F, add } = c; for (const z of [1.25, -1.2]) { const r = 0.5; for (const [a, b] of [[[z - r, 0.5], [z - r, 0.84]], [[z - r, 0.84], [z - r + 0.2, 1.04]], [[z - r + 0.2, 1.04], [z + r - 0.2, 1.04]], [[z + r - 0.2, 1.04], [z + r, 0.84]], [[z + r, 0.84], [z + r, 0.5]]]) slab(c.k, F.clad, sx * 0.92, a, b, 0.11, 0.05); }
        add(rbox(0.12, 0.04, 1.1, 0.015), F.clad, sx * 0.96, 0.44, -0.1);
        for (const [y, h, zc, l] of [[1.85, 0.04, 0.26, 0.98], [1.34, 0.04, 0.26, 0.98]]) add(rbox(0.04, h, l, 0.012), F.black, sx * 0.885, y, zc); for (const z of [-0.2, 0.72]) add(rbox(0.04, 0.5, 0.04, 0.012), F.black, sx * 0.885, 1.6, z);
        add(rbox(0.012, 0.48, 0.9, 0.006), glass2(), sx * 0.885, 1.6, 0.26); },
      front: c => { const { d, F, k, add } = c;
        for (let i = 0; i < 7; i++) { const x = -0.39 + i * 0.13; d.p('sl' + i, 'f', [[x - 0.045, 0.84], [x + 0.045, 0.84], [x + 0.045, 1.18], [x - 0.045, 1.18]], F.gun, { off: 0.01, step: 0.1, round: 0.03 }); }
        for (const sx of [-1, 1]) { const n = 16, cx = sx * 0.67, ring = R => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * R, 1.02 + Math.sin(i / n * 6.283) * R]); d.p('hb' + sx, 'f', ring(0.15), F.black, { round: 0, rings: [1], step: 0.2 }); proj(c, 'hp' + sx, 'f', cx, 1.02, 0.095); }
        add(rbox(1.84, 0.26, 0.16, 0.05), F.clad, 0, 0.64, 1.91); add(rbox(0.8, 0.05, 0.08, 0.02), F.silver, 0, 0.54, 1.95); for (const sx of [-1, 1]) add(rbox(0.05, 0.1, 0.06, 0.01), M(0xc21c1c), sx * 0.32, 0.74, 1.97); plate(k, 1.995, 0.66, true);
        const scr = add(rbox(1.5, 0.54, 0.018, 0.01), glass2(), 0, 1.6, 0.74); scr.rotation.x = -0.14; for (const sx of [-1, 1]) { const a = add(rbox(0.06, 0.62, 0.05, 0.02), F.black, sx * 0.8, 1.6, 0.74); a.rotation.x = -0.14; } const h = add(rbox(1.66, 0.07, 0.07, 0.02), F.black, 0, 1.89, 0.7); },
      rear: c => { const { d, F, k, add } = c;
        for (const sx of [-1, 1]) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.72, 0.88], [0.88, 0.88], [0.88, 1.26], [0.72, 1.26]]), { led: [MIR(sx, [[0.76, 1.22], [0.84, 1.22]]), MIR(sx, [[0.76, 1.14], [0.84, 1.14]])], clear: [MIR(sx, [[0.74, 0.94], [0.86, 0.94]])], cw: 0.05 });
        const sp = add(tyreGeo(0.39, 0.25), rubber, 0, 1.16, -1.85); sp.rotation.y = Math.PI / 2; const hub = add(cyl(0.22, 0.24, 0.08, 18), F.gun, 0, 1.16, -1.93); hub.rotation.x = Math.PI / 2; add(rbox(1.86, 0.28, 0.16, 0.05), F.clad, 0, 0.64, -1.68); plate(k, -1.765, 0.64, false); rearKit(c, { refl: [0.72, 0.8, 0.2] }); },
      after: c => { const { F, k, add, d, p } = c, seatM = M(0x2a2118);
        d.p('tub', 't', [[-0.74, 0.8], [0.74, 0.8], [0.74, -1.62], [-0.74, -1.62]], F.cabin, { off: 0.01, step: 0.3, round: 0.04 });
        for (const sx of [-1, 1]) { add(rbox(0.46, 0.14, 0.46, 0.05), seatM, sx * 0.4, 1.4, 0.02); add(rbox(0.44, 0.42, 0.12, 0.05), seatM, sx * 0.4, 1.58, -0.24).rotation.x = -0.12; add(rbox(0.22, 0.13, 0.09, 0.03), seatM, sx * 0.4, 1.76, -0.27); }
        add(rbox(1.3, 0.14, 0.42, 0.05), seatM, 0, 1.4, -0.98); add(rbox(1.3, 0.38, 0.12, 0.05), seatM, 0, 1.58, -1.2);
        add(rbox(1.54, 0.2, 0.3, 0.05), F.clad, 0, 1.42, 0.68); const sw = add(tor(0.17, 0.02, 6, 20), F.black, 0.4, 1.56, 0.42); sw.rotation.x = 0.3;
        for (const sx of [-1, 1]) add(rbox(0.05, 0.54, 0.05, 0.02), F.black, sx * 0.8, 1.58, -0.52); add(rbox(1.64, 0.05, 0.05, 0.02), F.black, 0, 1.84, -0.52);
        const P = [add(rbox(1.72, 0.05, 2.34, 0.022), F.fabric, 0, topY, -0.46)];
        for (const sx of [-1, 1]) { P.push(add(rbox(0.03, 0.5, 1.3, 0.012), F.fabric, sx * 0.87, 1.59, -0.98)); const wn = add(rbox(0.012, 0.28, 0.8, 0.01), glass2(), sx * 0.888, 1.63, -1.04); wn.castShadow = false; P.push(wn); }
        P.push(add(rbox(1.72, 0.5, 0.03, 0.012), F.fabric, 0, 1.59, -1.62)); const bw = add(rbox(1.2, 0.26, 0.012, 0.01), glass2(), 0, 1.64, -1.64); bw.castShadow = false; P.push(bw);
        k.parts.top = { mesh: pivot(k, 'softTop', [0, belt + 0.02, -1.56], P), fold: [0.8, 0.72] }; } });
  }

  // MG Hector (first generation): 4655 x 1835 x 1760, wb 2750, 215/55 R18. Black roof and pillars, big silver diamond-mesh grille, split lamps:
  // slim LED DRLs up under the bonnet edge, main clusters low in the bumper; panoramic sunroof, slim tail lamps linked by a red strip
  function hector() {
    return car2({ key: 'hc1', type: 'hector', cols: [0xf0f0ec, 0xf0f0ec, 0xb4141e, 0x8e9398, 0x4a4f54], W: 1.835, H: 1.76, R: 0.345, wd: 0.215, A: 0.41, AY: 0.355, FW: 1.39, RW: -1.36, ZF: 2.33, ZR: -2.325, SY: 0.37, belt: 1.13, lean: 0.14,
      opts: { plan: 0.3, rt: 0.1, crown: 0.035, bulge: 0.035 }, wheel: WHEELS.hector, seat: [0.4, 0.92, 0.0, 'car'], mirror: [0.9, 1.17], mirrorBlack: true, handles: [[0.22, 1.05], [-0.72, 1.07]], chromeH: true,
      sunroof: { hw: 0.5, z0: -0.72, z1: 0.0 }, boot: { hw: 0.72, y0: 0.62, y1: 1.64 },
      top: s => { s.lineTo(2.32, 0.5); s.quadraticCurveTo(2.35, 0.8, 2.33, 0.98); s.quadraticCurveTo(2.3, 1.1, 2.12, 1.125); s.lineTo(1.04, 1.19); s.lineTo(0.14, 1.69); s.quadraticCurveTo(0.0, 1.75, -0.3, 1.76); s.lineTo(-1.8, 1.73); s.quadraticCurveTo(-2.08, 1.71, -2.14, 1.6); s.lineTo(-2.29, 1.16); s.lineTo(-2.325, 0.98); s.lineTo(-2.325, 0.5); s.quadraticCurveTo(-2.32, 0.37, -2.24, 0.37); },
      win: [[[0.92, 1.18], [0.18, 1.63], [-0.14, 1.65], [-0.14, 1.15]], [[-0.22, 1.15], [-0.22, 1.65], [-1.12, 1.64], [-1.16, 1.18]], [[-1.24, 1.2], [-1.24, 1.64], [-1.84, 1.6], [-1.94, 1.27]]],
      ws: [[-0.72, 1.2], [0.72, 1.2], [0.58, 1.66], [-0.58, 1.66]], bs: [[-0.62, 1.2], [0.62, 1.2], [0.54, 1.6], [-0.54, 1.6]],
      doors: [[[0.98, 1.17], [0.98, 0.8], [0.86, 0.44], [-0.18, 0.42], [-0.18, 1.69]], [[-0.18, 1.69], [-1.2, 1.69], [-1.2, 1.2], [-0.98, 0.84], [-0.9, 0.42], [-0.18, 0.42]]],
      side: (c, sx, sn) => { const { d, F, add } = c; d.r('dloC', sn, [[0.92, 1.135], [-1.16, 1.145], [-1.94, 1.24]], 0.02, F.chrome, { off: 0.009 }); d.r('rfP', sn, [[0.2, 1.68], [-1.86, 1.66]], 0.09, F.black, { off: 0.01 }); d.r('aP', sn, [[0.96, 1.16], [0.2, 1.67]], 0.06, F.black, { off: 0.0088 }); d.p('cl', sn, [[0.92, 0.4], [-0.86, 0.4], [-0.86, 0.56], [0.92, 0.56]], F.clad, { round: 0 });
        add(rbox(0.05, 0.035, 2.2, 0.015), F.silver, sx * 0.72, 1.78, -0.95); },
      front: c => { const { d, F, k } = c; const gp = [[-0.56, 0.56], [0.56, 0.56], [0.72, 1.0], [-0.72, 1.0]];
        d.p('gc', 'f', gp.map(q => [q[0] * 1.06, q[1] < 0.8 ? q[1] - 0.03 : q[1] + 0.03]), F.chrome, { off: 0.007, step: 0.1, round: 0.04 }); d.p('gm', 'f', gp, F.argyle, { off: 0.0105, step: 0.1, round: 0.03 });
        for (const sx of [-1, 1]) { d.p('drb' + sx, 'f', MIR(sx, [[0.62, 1.0], [0.9, 1.0], [0.9, 1.07], [0.66, 1.06]]), F.black, { step: 0.06 }); d.r('drl' + sx, 'f', MIR(sx, [[0.66, 1.03], [0.89, 1.04]]), 0.022, F.drl, { off: 0.012, step: 0.06 });
          d.p('hb' + sx, 'f', MIR(sx, [[0.62, 0.62], [0.88, 0.62], [0.91, 0.84], [0.74, 0.86]]), F.black, { step: 0.06 }); proj(c, 'p1' + sx, 'f', sx * 0.74, 0.74, 0.052); proj(c, 'p2' + sx, 'f', sx * 0.84, 0.74, 0.042); d.r('fl' + sx, 'f', MIR(sx, [[0.66, 0.65], [0.88, 0.65]]), 0.016, F.drl, { off: 0.012, step: 0.1 }); }
        d.p('low', 'f', [[-0.56, 0.42], [0.56, 0.42], [0.62, 0.52], [-0.62, 0.52]], F.black, {}); d.p('sk', 'f', [[-0.46, 0.38], [0.46, 0.38], [0.38, 0.44], [-0.38, 0.44]], F.silver, { round: 0, off: 0.012 }); plate(k, 2.37, 0.48, true); },
      rear: c => { const { d, F, k } = c;
        for (const [sx, sn] of SIDES) { tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.4, 1.06], [0.9, 1.04], [0.91, 1.17], [0.4, 1.14]]), { led: [MIR(sx, [[0.44, 1.1], [0.89, 1.11]])], clear: [MIR(sx, [[0.74, 1.07], [0.86, 1.07]])], cw: 0.025 }); tailUnit(c, 'ts' + sx, sn, [[-2.1, 1.1], [-2.32, 1.04], [-2.3, 1.17], [-2.14, 1.18]], { led: [[[-2.14, 1.13], [-2.3, 1.1]]] }); }
        d.r('lnk', 'r', [[-0.4, 1.1], [0.4, 1.1]], 0.03, F.tailLed, { off: 0.0105, step: 0.3 }); d.r('lnc', 'r', [[-0.62, 1.0], [0.62, 1.0]], 0.022, F.chrome, { off: 0.0095, step: 0.3 });
        d.p('rb', 'r', [[-0.82, 0.38], [0.82, 0.38], [0.86, 0.56], [-0.86, 0.56]], F.clad, { round: 0 }); d.r('rs', 'r', [[-0.44, 0.42], [0.44, 0.42]], 0.05, F.silver, { off: 0.01 }); plate(k, -2.34, 0.8, false);
        rearKit(c, { recess: [0.26, 0.8], wiper: [0, 1.26, 0.6], spoiler: [1.1, 1.67, -1.98, 0.24], spoilerM: F.black, refl: [0.64, 0.6, 0.28], badge: [[0.5, 0.92, 0.2, 0.016], [0.5, 0.95, 0.12, 0.016]] }); },
      after: c => { const { d, F } = c; d.p('rfB', 't', [[-0.76, 0.1], [0.76, 0.1], [0.74, -2.0], [-0.74, -2.0]], F.black, { off: 0.008, step: 0.25, round: 0.06 }); d.p('srR', 't', [[-0.5, -0.8], [0.5, -0.8], [0.5, -1.45], [-0.5, -1.45]], glass2(), { off: 0.018, step: 0.2, round: 0.04 }); } });
  }

  // Mahindra Scorpio classic: 4456 x 1820 x 1995, wb 2680, 235/65 R17. Tall flat-sided wagon, bonnet scoop, upright lamps,
  // chrome seven-slat grille, long vertical tail lamps up the D pillars, roof rails, ladder and rear step
  function scorpio() {
    return car2({ key: 'sc2', type: 'scorpio', cols: [0xf4f4f1, 0xf4f4f1, 0x141518, 0x141518, 0xb9bec4, 0x5d1218, 0x4a4f55], W: 1.82, H: 1.995, R: 0.37, wd: 0.235, A: 0.44, AY: 0.46, FW: 1.34, RW: -1.34, ZF: 2.228, ZR: -2.228, SY: 0.48, belt: 1.32, lean: 0.09,
      opts: { plan: 0.22, rt: 0.08, crown: 0.022, bulge: 0.02 }, wheel: WHEELS.scorpio, seat: [0.4, 1.0, 0.0, 'car'], mirror: [0.85, 1.36], handles: [[0.2, 1.2], [-0.75, 1.2]], chromeH: true,
      top: s => { s.lineTo(2.2, 0.62); s.lineTo(2.228, 1.1); s.quadraticCurveTo(2.22, 1.2, 2.08, 1.22); s.lineTo(1.0, 1.32); s.lineTo(0.42, 1.9); s.quadraticCurveTo(0.3, 1.97, 0.1, 1.975); s.lineTo(-2.0, 1.95); s.quadraticCurveTo(-2.14, 1.94, -2.16, 1.84); s.lineTo(-2.228, 1.32); s.lineTo(-2.228, 0.6); s.quadraticCurveTo(-2.22, 0.48, -2.14, 0.48); },
      boot: { hw: 0.62, y0: 0.82, y1: 1.88, side: true }, win: [[[0.88, 1.36], [0.42, 1.84], [-0.16, 1.84], [-0.16, 1.35]], [[-0.24, 1.35], [-0.24, 1.84], [-1.14, 1.83], [-1.14, 1.35]], [[-1.22, 1.35], [-1.22, 1.83], [-1.86, 1.82], [-1.86, 1.36]]],
      ws: [[-0.68, 1.37], [0.68, 1.37], [0.6, 1.87], [-0.6, 1.87]], bs: [[-0.56, 1.36], [0.56, 1.36], [0.54, 1.84], [-0.54, 1.84]],
      doors: [[[0.94, 1.32], [0.94, 0.9], [0.84, 0.54], [-0.2, 0.52], [-0.2, 1.9]], [[-0.2, 1.9], [-1.18, 1.9], [-1.18, 1.3], [-0.96, 0.92], [-0.88, 0.52], [-0.2, 0.52]]],
      side: (c, sx, sn) => { const { d, F, add } = c; d.p('cl', sn, [[0.88, 0.5], [-0.88, 0.5], [-0.88, 0.68], [0.88, 0.68]], F.clad, { round: 0, step: 0.12 });
        for (const z of [1.34, -1.34]) { const fl = add(tor(0.46, 0.04, 4, 18, Math.PI), F.clad, sx * 0.905, 0.46, z); fl.rotation.y = Math.PI / 2; }
        add(rbox(0.13, 0.04, 1.6, 0.015), F.silver, sx * 0.98, 0.42, 0); add(rbox(0.05, 0.035, 2.5, 0.015), F.silver, sx * 0.72, 2.0, -0.85); for (const z of [0.25, -0.85, -1.95]) add(rbox(0.05, 0.05, 0.08, 0.015), F.clad, sx * 0.72, 1.975, z); },
      front: c => { const { d, F, k, add } = c;
        add(rbox(0.74, 0.06, 0.34, 0.03), c.p, 0, 1.28, 1.56).rotation.x = 0.06; add(rbox(0.5, 0.03, 0.02, 0.01), F.black, 0, 1.285, 1.74);
        d.p('gr', 'f', [[-0.48, 0.84], [0.48, 0.84], [0.44, 1.18], [-0.44, 1.18]], F.black, { off: 0.008 });
        for (let i = 0; i < 7; i++) { const x = -0.39 + i * 0.13; d.r('gs' + i, 'f', [[x, 0.87], [x, 1.13]], 0.07, F.chrome, { off: 0.014, step: 0.05 }); }
        for (const [sx, sn] of SIDES) { d.p('hl' + sx, 'f', MIR(sx, [[0.5, 0.84], [0.84, 0.86], [0.86, 1.16], [0.5, 1.16]]), F.silver, { step: 0.06 }); proj(c, 'hp' + sx, 'f', sx * 0.6, 1.0, 0.075); proj(c, 'hq' + sx, 'f', sx * 0.74, 1.0, 0.06); d.r('hta' + sx, 'f', MIR(sx, [[0.82, 0.9], [0.84, 1.12]]), 0.03, F.amber, { off: 0.012, step: 0.3 }); }
        add(rbox(1.84, 0.28, 0.24, 0.06), F.clad, 0, 0.68, 2.16); add(rbox(1.0, 0.05, 0.08, 0.02), F.silver, 0, 0.52, 2.27); for (const sx of [-1, 1]) { const f = add(cyl(0.055, 0.055, 0.02, 12), F.drl, sx * 0.68, 0.68, 2.285); f.rotation.x = Math.PI / 2; } plate(k, 2.29, 0.72, true); },
      rear: c => { const { d, F, k, add } = c;
        for (const [sx, sn] of SIDES) tailUnit(c, 't' + sx, 'r', MIR(sx, [[0.66, 0.98], [0.8, 0.98], [0.76, 1.84], [0.66, 1.84]]), { led: [MIR(sx, [[0.7, 1.74], [0.71, 1.52]])], amber: [MIR(sx, [[0.69, 1.36], [0.74, 1.36]])], clear: [MIR(sx, [[0.69, 1.14], [0.75, 1.14]])], cw: 0.08 });
        for (const x of [0.6, 0.48]) add(rbox(0.018, 0.86, 0.018, 0.006), F.silver, x, 1.5, -2.28); for (let i = 0; i < 6; i++) add(rbox(0.13, 0.018, 0.018, 0.006), F.silver, 0.54, 1.12 + i * 0.14, -2.28);
        add(rbox(1.86, 0.26, 0.2, 0.05), F.clad, 0, 0.66, -2.18); add(rbox(0.8, 0.05, 0.3, 0.02), F.silver, 0, 0.5, -2.2); plate(k, -2.245, 1.02, false); rearKit(c, { recess: [0.26, 1.02], wiper: [0, 1.42, 0.6], refl: [0.66, 0.84, 0.2], badge: [[-0.44, 1.2, 0.05, 0.02], [-0.37, 1.2, 0.05, 0.02], [-0.3, 1.2, 0.05, 0.02]] }); } });
  }

  // small hatch family on the same pipeline
  // Alto 3445 x 1490 x 1475, Swift 2010 3850 x 1695 x 1530, Swift 2024 3860 x 1735 x 1520, Dzire 4160 long as before
  function alto() {
    return car2({ key: 'al2', type: 'alto', cols: [0xf1f1ee, 0xf1f1ee, 0xb9bdc2, 0x9a1c1c, 0x24406e], W: 1.49, H: 1.475, R: 0.275, wd: 0.145, A: 0.325, AY: 0.285, FW: 1.13, RW: -1.23, ZF: 1.72, ZR: -1.725, SY: 0.28, belt: 0.93, lean: 0.14,
      opts: { plan: 0.24, rt: 0.09, crown: 0.03 }, wheel: 'steel', seat: [0.32, 0.72, 0, 'car'], mirror: [0.68, 0.97], handles: [[0.06, 0.92], [-0.76, 0.92]],
      top: s => { s.lineTo(1.72, 0.44); s.quadraticCurveTo(1.74, 0.62, 1.68, 0.74); s.quadraticCurveTo(1.6, 0.84, 1.42, 0.87); s.lineTo(0.9, 0.95); s.lineTo(0.3, 1.41); s.quadraticCurveTo(0.18, 1.47, 0, 1.475); s.lineTo(-1.26, 1.45); s.quadraticCurveTo(-1.44, 1.43, -1.5, 1.32); s.lineTo(-1.7, 0.92); s.lineTo(-1.725, 0.42); s.quadraticCurveTo(-1.72, 0.28, -1.65, 0.28); },
      win: [[[0.72, 0.99], [0.32, 1.34], [-0.1, 1.35], [-0.1, 0.97]], [[-0.18, 0.97], [-0.18, 1.35], [-0.94, 1.33], [-0.94, 0.97]], [[-1.02, 0.97], [-1.02, 1.32], [-1.22, 1.31], [-1.3, 1.0]]],
      ws: [[-0.56, 1.0], [0.56, 1.0], [0.46, 1.37], [-0.46, 1.37]], bs: [[-0.5, 1.0], [0.5, 1.0], [0.43, 1.33], [-0.43, 1.33]],
      doors: [[[0.78, 0.96], [0.78, 0.66], [0.7, 0.36], [-0.14, 0.32], [-0.14, 1.38]], [[-0.14, 1.38], [-0.98, 1.38], [-0.98, 0.9], [-0.84, 0.66], [-0.78, 0.36], [-0.14, 0.32]]],
      front: c => { const { d, F, k } = c; d.p('gr', 'f', [[-0.3, 0.66], [0.3, 0.66], [0.34, 0.76], [-0.34, 0.76]], F.black); d.r('grc', 'f', [[-0.34, 0.78], [0.34, 0.78]], 0.016, F.chrome, { off: 0.012 }); d.p('low', 'f', [[-0.4, 0.36], [0.4, 0.36], [0.34, 0.5], [-0.34, 0.5]], F.black);
        for (const sx of [-1, 1]) { d.p('hl' + sx, 'f', MIR(sx, [[0.36, 0.66], [0.62, 0.66], [0.64, 0.8], [0.4, 0.8]]), F.gun, { step: 0.05 }); proj(c, 'hp' + sx, 'f', sx * 0.48, 0.73, 0.05); d.r('ta' + sx, 'f', MIR(sx, [[0.6, 0.67], [0.67, 0.67]]), 0.03, F.amber, { off: 0.012, step: 0.2 }); } plate(k, 1.75, 0.44, true); },
      rear: c => { const { d, F, k } = c; for (const [sx] of SIDES) d.p('t' + sx, 'r', MIR(sx, [[0.5, 0.72], [0.7, 0.72], [0.7, 0.98], [0.56, 0.98]]), null, { role: 'tail', step: 0.1 }); d.p('rb', 'r', [[-0.64, 0.3], [0.64, 0.3], [0.68, 0.46], [-0.68, 0.46]], F.clad, { round: 0 }); plate(k, -1.74, 0.72, false); } });
  }
  function swiftFam2(mode) {      // 0 Swift 2010, 1 Swift 2024, 2 Dzire
    const nw = mode === 1, dz = mode === 2, W = nw ? 1.735 : 1.695, H = nw ? 1.52 : 1.53, ZF = nw ? 1.93 : 1.925, ZR = dz ? -2.235 : -1.925, FW = nw ? 1.2 : 1.2, RW = FW - (nw ? 2.45 : 2.43), key = ['sf0', 'sf1', 'sf2'][mode];
    return car2({ key, type: ['swift', 'swiftNew', 'dzire'][mode], cols: nw ? [0xc8102e, 0x1e5fbf, 0xf1f1ee, 0x34373c, 0xb4b8bd] : [0xf1f1ee, 0xb4b8bd, 0xa3121e, 0x173a78, 0x2e3136], W, H, R: nw ? 0.3 : 0.295, wd: 0.185, A: 0.35, AY: 0.3, FW, RW, ZF, ZR, SY: 0.3, belt: 0.99, lean: 0.17,
      opts: { plan: 0.34, rt: 0.13, crown: 0.045, bulge: 0.05, hwz: z => 1 - 0.07 * Math.pow(Math.max(0, (z - 1.2) / 0.75), 2) }, boot: dz ? { hw: 0.6, y0: 0.72, y1: 0.98 } : undefined, wheel: nw ? WHEELS.swiftNew : dz ? WHEELS.dzire : WHEELS.swift, seat: [0.36, 0.76, 0, 'car'], mirror: [0.62, 1.02], handles: [[0, 0.98], [-0.86, 1.0]], chromeH: dz,
      top: s => { s.lineTo(ZF, 0.48); s.quadraticCurveTo(ZF + 0.03, 0.66, ZF - 0.08, 0.78); s.quadraticCurveTo(ZF - 0.2, 0.88, 1.5, 0.92); s.lineTo(0.92, 1.03); s.lineTo(0.22, H - 0.09); s.quadraticCurveTo(0.08, H - 0.01, -0.14, H); if (dz) { s.lineTo(-0.9, H - 0.04); s.lineTo(-1.62, 1.1); s.quadraticCurveTo(-1.72, 1.06, -2.0, 1.04); s.quadraticCurveTo(-2.2, 1.03, -2.22, 0.95); } else { s.lineTo(-1.34, H - 0.05); s.quadraticCurveTo(-1.56, H - 0.07, -1.62, H - 0.18); s.lineTo(-1.88, 1.04); } s.lineTo(ZR, 0.8); s.lineTo(ZR, 0.44); s.quadraticCurveTo(ZR + 0.01, 0.3, ZR + 0.08, 0.3); },
      win: dz ? [[[0.68, 1.06], [0.24, 1.4], [-0.14, 1.42], [-0.14, 1.04]], [[-0.22, 1.04], [-0.22, 1.42], [-0.86, 1.4], [-1.22, 1.08]]] : [[[0.68, 1.06], [0.24, 1.4], [-0.14, 1.42], [-0.14, 1.04]], [[-0.22, 1.04], [-0.22, 1.42], [-0.92, 1.4], [-1.06, 1.1]]],
      ws: [[-0.62, 1.08], [0.62, 1.08], [0.47, 1.43], [-0.47, 1.43]], bs: dz ? [[-0.5, 1.14], [0.5, 1.14], [0.42, 1.4], [-0.42, 1.4]] : [[-0.52, 1.08], [0.52, 1.08], [0.42, 1.38], [-0.42, 1.38]],
      doors: [[[0.74, 1.02], [0.76, 0.7], [0.8, 0.36], [-0.18, 0.33], [-0.18, 1.46]], [[-0.18, 1.46], [-0.96, 1.46], [-1.1, 1.02], [-0.92, 0.7], [-0.86, 0.36], [-0.18, 0.33]]].concat(dz ? [[[-1.66, 1.09], [-2.2, 1.0]]] : []),
      side: (c, sx, sn) => { c.d.r('sl', sn, [[1.3, 0.86], [-1.5, 0.9]], 0.012, c.F.black, { off: 0.002 }); if (nw) c.d.r('sk', sn, [[0.8, 0.4], [-0.82, 0.4]], 0.05, c.F.clad, { off: 0.008 }); },
      front: c => { const { d, F, k } = c, zp = ZF + 0.05;
        if (nw) { d.p('gr', 'f', [[-0.46, 0.5], [0.46, 0.5], [0.56, 0.72], [-0.56, 0.72]], F.mesh, { off: 0.008 }); d.r('grc', 'f', [[-0.58, 0.74], [0.58, 0.74]], 0.018, F.black, { off: 0.012 }); }
        else { d.p('gu', 'f', [[-0.3, 0.72], [0.3, 0.72], [0.36, 0.82], [-0.36, 0.82]], F.black); d.r('guc', 'f', [[-0.38, 0.83], [0.38, 0.83]], 0.02, F.chrome, { off: 0.012 }); d.p('lg', 'f', [[-0.38, 0.38], [0.38, 0.38], [0.44, 0.54], [-0.44, 0.54]], F.black); }
        for (const [sx, sn] of SIDES) { d.p('hl' + sx, 'f', MIR(sx, nw ? [[0.42, 0.72], [0.68, 0.72], [0.68, 0.84], [0.5, 0.82]] : [[0.38, 0.72], [0.68, 0.7], [0.68, 0.84], [0.54, 0.84]]), F.black, { step: 0.04, off: 0.012 }); d.p('hsw' + sx, 't', MIR(sx, [[0.42, 1.84], [0.68, 1.8], [0.7, 1.46], [0.6, 1.56]]), F.black, { step: 0.05, off: 0.012 });
          proj(c, 'hp' + sx, 'f', sx * 0.56, 0.78, 0.05); if (nw) d.r('dr' + sx, 'f', MIR(sx, [[0.44, 0.73], [0.67, 0.73]]), 0.014, F.drl, { off: 0.016, step: 0.05 }); else d.r('ta' + sx, 'f', MIR(sx, [[0.6, 0.73], [0.67, 0.73]]), 0.03, F.amber, { off: 0.016, step: 0.03 });
          d.p('fg' + sx, 'f', MIR(sx, [[0.56, 0.42], [0.7, 0.42], [0.72, 0.54], [0.58, 0.54]]), F.black); }
        k.add(sph(0.05, 12, 8), F.chrome, 0, nw ? 0.66 : 0.77, ZF + 0.03).scale.set(1.2, 0.9, 0.3); plate(k, zp, 0.46, true); },
      rear: c => { const { d, F, k } = c;
        for (const [sx, sn] of SIDES) { if (dz) { d.p('t' + sx, 'r', MIR(sx, [[0.38, 0.8], [0.68, 0.78], [0.68, 0.92], [0.42, 0.92]]), null, { role: 'tail', step: 0.05 }); }
          else { d.p('t' + sx, 'r', MIR(sx, [[0.5, 0.74], [0.68, 0.74], [0.62, 1.04], [0.54, 1.04]]), null, { role: 'tail', step: 0.05 }); } }
        d.r('tgc', 'r', dz ? [[-0.36, 0.86], [0.36, 0.86]] : [[-0.4, 0.82], [0.4, 0.82]], 0.03, F.chrome, { off: 0.008, step: 0.3 }); d.p('rb', 'r', [[-0.7, 0.32], [0.7, 0.32], [0.74, 0.46], [-0.74, 0.46]], F.clad, { round: 0 }); d.r('rf', 'r', [[-0.5, 0.5], [0.5, 0.5]], 0.012, F.redLens, { off: 0.009 }); plate(k, ZR - 0.02, 0.66, false); } });
  }
  function swift() { return swiftFam2(0); }
  function swiftNew() { return swiftFam2(1); }
  function dzire() { return swiftFam2(2); }

  // ---------------------------------------------------------------- big bikes
  // shared rounded bodywork: one loft from nose to tail, narrower at the ends (hwz)
  function bikeLoft(k, key, draw, width, m, opt) { return k.add(loftGeo(key, draw, width, Object.assign({ rt: 0.13, rb: 0.09, plan: 0.06, crown: 0, bulge: 0.08, step: 0.08, curve: 8 }, opt)), m); }
  function usdFork(k, parts, ZF, R, xg, ytop, ztop, upper, lower, r) { for (const sx of [-1, 1]) {
      parts.push(tube(k, [sx * xg, R, ZF], [sx * xg, R + (ytop - R) * 0.55, ZF + (ztop - ZF) * 0.55], r * 0.75, lower));
      parts.push(tube(k, [sx * xg, R + (ytop - R) * 0.5, ZF + (ztop - ZF) * 0.5], [sx * xg, ytop, ztop], r, upper)); } }
  // Suzuki Hayabusa, third generation: 2180 x 735 x 1165, wb 1480, 264 kg, 1340 cc 190 hp 150 Nm, 120/70-190/50 ZR17.
  // Bulbous beak, stacked headlamp, huge side scoops, humped tail, twin long silencers
  function hayabusa() {
    const k = kit(), add = k.add, PI = Math.PI, [mainC, ac] = pickR([[0x14171c, 0xd8c070], [0xdedfe0, 0x101114], [0x2a3a52, 0xc23a2a], [0x7a7f86, 0xd2562a]]);
    const body = paint(mainC), acc = paint(ac), black = M(0x101114), alu = M(0x9a9ea3), ZF = 0.74, ZR = -0.74;
    const fw = bikeWheel(k, 0.305, 0.12, ZF, { style: 'alloy', n: 6, split: true, rim: black, disc: 0.16, discX: 0.075 }); fw.userData.front = true;
    bikeWheel(k, 0.325, 0.19, ZR, { style: 'alloy', n: 6, split: true, rim: black, disc: 0.12, discX: -0.1 });
    add(rbox(0.36, 0.34, 0.5, 0.08), M(0x24262a), 0, 0.46, 0.06); add(rbox(0.34, 0.08, 0.34, 0.03), black, 0, 0.27, 0.1);
    for (const sx of [-1, 1]) { tube(k, [sx * 0.11, 0.5, -0.2], [sx * 0.11, 0.325, ZR], 0.03, alu);
      tube(k, [sx * 0.15, 0.3, 0.1], [sx * 0.18, 0.36, -0.5], 0.035, alu); const can = tube(k, [sx * 0.19, 0.38, -0.46], [sx * 0.23, 0.56, -1.06], 0.078, alu); const tp = add(cyl(0.08, 0.08, 0.05, 12), black, sx * 0.232, 0.565, -1.08); tp.rotation.x = PI / 2 - 0.29; }
    chainLoop(k, 'hbChain', 0.0, ZR, 0.325, -0.14);
    const low = bikeLoft(k, 'hbB', s => { s.moveTo(0.26, 0.28); s.lineTo(-0.16, 0.34); s.lineTo(-0.2, 0.62); s.lineTo(-0.52, 0.72); s.lineTo(-0.72, 0.8); s.lineTo(-1.0, 0.92); s.quadraticCurveTo(-1.08, 1.0, -1.02, 1.04);
      s.quadraticCurveTo(-0.72, 1.1, -0.5, 0.92); s.quadraticCurveTo(-0.4, 0.86, -0.22, 0.9); s.quadraticCurveTo(-0.14, 1.12, 0.14, 1.12); s.quadraticCurveTo(0.3, 1.1, 0.42, 1.03); s.lineTo(0.72, 1.0); s.quadraticCurveTo(0.96, 0.9, 0.98, 0.8); s.quadraticCurveTo(0.96, 0.66, 0.72, 0.6); s.lineTo(0.5, 0.46); s.lineTo(0.42, 0.3); }, 0.54, body, { hwz: z => z > 0.3 ? 1 - 0.55 * Math.pow((z - 0.3) / 0.68, 1.6) : z < -0.2 ? 1 - 0.68 * Math.pow((-z - 0.2) / 0.88, 1.2) : 1 });
    const d = decals(k, 'hb', [low.geometry]), Gl = glass2(), F = fortunerMats();
    d.p('hl', 'f', [[-0.075, 0.72], [0.075, 0.72], [0.09, 0.88], [0, 0.94], [-0.09, 0.88]], black, { off: 0.005, step: 0.04 });
    d.p('hu', 'f', [[-0.06, 0.84], [0.06, 0.84], [0.05, 0.9], [-0.05, 0.9]], null, { role: 'head', off: 0.01, step: 0.03 }); d.p('hd', 'f', [[-0.06, 0.74], [0.06, 0.74], [0.06, 0.8], [-0.06, 0.8]], null, { role: 'head', off: 0.01, step: 0.03 });
    d.r('hk', 'f', [[-0.1, 0.92], [-0.13, 0.72]], 0.016, F.drl, { off: 0.009, step: 0.04 }); d.r('hk2', 'f', [[0.1, 0.92], [0.13, 0.72]], 0.016, F.drl, { off: 0.009, step: 0.04 });
    d.p('ram', 'f', [[-0.1, 0.62], [0.1, 0.62], [0.13, 0.68], [-0.13, 0.68]], black, { step: 0.04 });
    for (const [sx, sn] of SIDES) { d.p('sc' + sx, sn, [[0.32, 0.56], [0.5, 0.82], [0.14, 0.8], [0.0, 0.64], [0.12, 0.56]], black, { step: 0.08, off: 0.008 });
      for (let i = 0; i < 3; i++) d.r('fin' + sx + i, sn, [[0.36 - i * 0.12, 0.6], [0.28 - i * 0.12, 0.78]], 0.018, alu, { off: 0.012, step: 0.1 });
      d.r('st' + sx, sn, [[0.7, 0.95], [0.12, 1.04], [-0.3, 0.86], [-0.96, 0.98]], 0.022, acc, { off: 0.008 }); d.p('tw' + sx, sn, [[-0.1, 0.52], [-0.4, 0.74], [-0.56, 0.74], [-0.22, 0.42]], acc, { off: 0.007, step: 0.1 });
      add(rbox(0.1, 0.05, 0.03, 0.02), black, sx * 0.24, 1.0, 0.56); tube(k, [sx * 0.15, 0.98, 0.58], [sx * 0.24, 1.0, 0.56], 0.008, black); add(rbox(0.06, 0.018, 0.02, 0.006), amberMat, sx * 0.21, 0.98, 0.6);
      add(rbox(0.04, 0.03, 0.14, 0.01), alu, sx * 0.17, 0.46, -0.24); }
    add(sideGeo('hbScreen', s => { s.moveTo(0.74, 1.0); s.quadraticCurveTo(0.56, 1.14, 0.4, 1.16); s.lineTo(0.4, 1.1); s.lineTo(0.66, 0.98); }, 0.26, 0.015), glass);
    add(sideGeo('hbSeat', s => { s.moveTo(-0.14, 1.0); s.quadraticCurveTo(-0.3, 0.86, -0.56, 0.9); s.lineTo(-0.72, 0.98); s.lineTo(-0.6, 0.82); s.lineTo(-0.16, 0.86); }, 0.3, 0.04), black);
    const tl = k.lamp(0.13, 0.05, 0, 0.95, -1.075); tl.rotation.y = PI; tl.lens.rotation.y = PI;
    for (const sx of [-1, 1]) add(rbox(0.05, 0.02, 0.02, 0.006), amberMat, sx * 0.11, 0.76, -0.98); tube(k, [0, 0.9, -0.9], [0, 0.72, -1.02], 0.022, black); plate(k, -1.03, 0.66, false);
    guard(k, 0.325, ZR, black, 0.2, 0.3, 0.8);
    const fork = [fw, guard(k, 0.305, ZF, body, 0.3, 0.14, 0.9)]; usdFork(k, fork, ZF, 0.305, 0.085, 1.0, 0.44, M(0xc9a24a), black, 0.028);
    for (const sx of [-1, 1]) { fork.push(tube(k, [sx * 0.085, 0.98, 0.44], [sx * 0.32, 1.02, 0.36], 0.013, black)); const gp = add(cyl(0.02, 0.02, 0.11, 6), black, sx * 0.34, 1.02, 0.35); gp.rotation.z = PI / 2; fork.push(gp); }
    fork.push(add(rbox(0.24, 0.03, 0.1, 0.01), alu, 0, 1.0, 0.44)); forkPivot(k, 1.0, 0.44, 0.42, fork);
    riders(k, 1.0, -0.34, -0.72, 0.9, 0.1);
    return two(k, 2.18, 'bike', 'hayabusa', [0, 1.0, -0.34, 'bike']);
  }
  // BMW S1000RR style: 2073 x 848 x 1205, wb 1457, 210 hp 999 cc, 120/70-190/55 ZR17. Asymmetric big / small headlamps,
  // white / blue / red motorsport split, silver twin-spar frame, side-slit fairing, stubby tail, short side can
  function s1000rr() {
    const k = kit(), add = k.add, PI = Math.PI, [w, b, r] = pickR([[0xeeeff0, 0x1b4fb0, 0xc81e2a], [0xeeeff0, 0x1b4fb0, 0xc81e2a], [0x111316, 0x6f7377, 0xc81e2a], [0xc81e2a, 0xeeeff0, 0x111316]]);
    const body = paint(w), blue = paint(b), red = paint(r), black = M(0x101114), alu = M(0xb4b8bc), ZF = 0.73, ZR = -0.727;
    const fw = bikeWheel(k, 0.3, 0.12, ZF, { style: 'alloy', n: 5, split: true, rim: black, disc: 0.16, discX: 0.075 }); fw.userData.front = true;
    bikeWheel(k, 0.325, 0.19, ZR, { style: 'alloy', n: 5, split: true, rim: black, disc: 0.11, discX: -0.1 });
    add(rbox(0.32, 0.32, 0.44, 0.07), M(0x24262a), 0, 0.46, 0.08);
    for (const sx of [-1, 1]) { const sp = tube(k, [sx * 0.12, 0.96, 0.42], [sx * 0.16, 0.56, -0.16], 0.04, alu); sp.scale.z = 0.5; tube(k, [sx * 0.11, 0.5, -0.2], [sx * 0.11, 0.325, ZR], 0.032, alu); add(rbox(0.04, 0.03, 0.12, 0.01), alu, sx * 0.17, 0.56, -0.22); }
    chainLoop(k, 'srChain', 0.0, ZR, 0.325, -0.14);
    add(rbox(0.13, 0.15, 0.4, 0.05), alu, 0.19, 0.44, -0.4).rotation.x = -0.3; tube(k, [0.1, 0.28, 0.2], [0.17, 0.32, -0.24], 0.024, M(0x5a5d60));
    const low = bikeLoft(k, 'srB', s => { s.moveTo(0.3, 0.3); s.lineTo(-0.02, 0.3); s.lineTo(-0.22, 0.64); s.lineTo(-0.5, 0.84); s.lineTo(-1.04, 1.1); s.lineTo(-1.02, 1.16); s.lineTo(-0.5, 0.97); s.lineTo(-0.26, 0.93); s.quadraticCurveTo(-0.14, 1.12, 0.12, 1.14); s.lineTo(0.42, 1.08); s.lineTo(0.62, 1.1); s.lineTo(0.92, 0.94); s.lineTo(0.9, 0.78); s.lineTo(0.62, 0.66); s.lineTo(0.5, 0.42); }, 0.5, body, { rt: 0.1, rb: 0.07, hwz: z => z > 0.4 ? 1 - 0.5 * Math.pow((z - 0.4) / 0.5, 1.4) : z < -0.2 ? Math.max(0.3, 1 - 0.75 * ((-z - 0.2) / 0.84)) : 1 });
    const d = decals(k, 'sr', [low.geometry]), F = fortunerMats();
    // asymmetric lamps: big one on the rider's right (-x), small one on the left (+x), black mask between
    d.p('mask', 'f', [[-0.115, 0.8], [0.1, 0.8], [0.1, 0.95], [-0.115, 0.98]], black, { off: 0.005, step: 0.03 });
    d.p('hR', 'f', [[-0.105, 0.82], [-0.015, 0.82], [-0.015, 0.95], [-0.105, 0.95]], null, { role: 'head', off: 0.01, step: 0.03 });
    d.p('hL', 'f', [[0.02, 0.84], [0.09, 0.84], [0.09, 0.9], [0.02, 0.9]], null, { role: 'head', off: 0.01, step: 0.03 });
    d.r('dl', 'f', [[0.02, 0.925], [0.09, 0.935]], 0.012, F.drl, { off: 0.01, step: 0.04 });
    for (const [sx, sn] of SIDES) { d.p('blu' + sx, sn, [[0.56, 0.68], [0.84, 0.82], [0.56, 1.0], [0.12, 0.68]], blue, { step: 0.08 }); d.p('red' + sx, sn, [[0.1, 0.34], [0.4, 0.42], [0.54, 0.66], [0.1, 0.66]], red, { step: 0.08 }); d.p('sl' + sx, sn, [[0.34, 0.6], [0.42, 0.6], [0.18, 0.84], [0.1, 0.84]], black, { step: 0.08, off: 0.01 }); d.p('sl2' + sx, sn, [[0.2, 0.52], [0.3, 0.52], [0.1, 0.66], [0.06, 0.6]], black, { step: 0.08, off: 0.01 });
      d.r('tl' + sx, sn, [[-0.36, 0.87], [-0.98, 1.13]], 0.05, blue, { off: 0.007 }); d.r('tr' + sx, sn, [[-0.36, 0.82], [-0.9, 1.06]], 0.024, red, { off: 0.007 });
      tube(k, [sx * 0.15, 1.0, 0.6], [sx * 0.24, 1.05, 0.56], 0.008, black); add(rbox(0.1, 0.05, 0.04, 0.02), black, sx * 0.27, 1.06, 0.55); }
    add(sideGeo('srScreen', s => { s.moveTo(0.64, 1.09); s.lineTo(0.42, 1.21); s.lineTo(0.4, 1.17); s.lineTo(0.6, 1.07); }, 0.25, 0.012), glass);
    add(sideGeo('srSeat', s => { s.moveTo(-0.16, 0.95); s.quadraticCurveTo(-0.32, 0.9, -0.5, 0.96); s.lineTo(-0.56, 0.9); s.lineTo(-0.16, 0.88); }, 0.26, 0.03), black);
    const tl = k.lamp(0.12, 0.03, 0, 1.11, -1.045); tl.rotation.y = PI; tl.lens.rotation.y = PI;
    tube(k, [0, 1.0, -0.86], [0, 0.72, -1.02], 0.02, black); for (const sx of [-1, 1]) add(rbox(0.05, 0.02, 0.02, 0.006), amberMat, sx * 0.1, 0.76, -1.0); plate(k, -1.03, 0.66, false); guard(k, 0.325, ZR, black, 0.2, 0.3, 0.8);
    const fork = [fw, guard(k, 0.3, ZF, black, 0.3, 0.14, 0.85)]; usdFork(k, fork, ZF, 0.3, 0.085, 1.02, 0.42, M(0xc9a24a), black, 0.027);
    for (const sx of [-1, 1]) { fork.push(tube(k, [sx * 0.085, 0.96, 0.44], [sx * 0.3, 0.97, 0.34], 0.013, black)); const gp = add(cyl(0.02, 0.02, 0.11, 6), black, sx * 0.32, 0.97, 0.33); gp.rotation.z = PI / 2; fork.push(gp); }
    fork.push(add(rbox(0.22, 0.03, 0.1, 0.01), alu, 0, 1.02, 0.42), add(rbox(0.14, 0.1, 0.02, 0.01), black, 0, 1.1, 0.48)); forkPivot(k, 1.02, 0.42, 0.42, fork);
    riders(k, 0.98, -0.3, -0.7, 0.95, 0.05);
    return two(k, 2.08, 'bike', 's1000rr', [0, 0.98, -0.3, 'bike']);
  }
  // BMW R 1250 / R 1300 GS Adventure style: 30 l tank, 269 kg. Boxer cylinders out both sides, tall screen, beak, crash
  // bars, shaft drive on one side, 19/17 spoked wheels, aluminium panniers and top case
  function gsAdv(nw) {
    const k = kit(), add = k.add, PI = Math.PI, key = nw ? 'g3' : 'g2', [m, a] = pickR(nw ? [[0xe6e2d6, 0x1b4fb0], [0x1a1c1f, 0xd9b23c], [0x4a5a3c, 0x111316]] : [[0x20252b, 0xc8102e], [0xe6e2d6, 0x1b4fb0], [0x46505a, 0xd9b23c]]);
    const body = paint(m), acc = paint(a), black = M(0x141517), alu = M(0xb9bcc0), silv = paint(0x8f9398), ZF = 0.8, ZR = nw ? -0.73 : -0.71, RF = 0.37, RR = 0.345;
    const fw = bikeWheel(k, RF, 0.12, ZF, { style: 'spoke', n: 24, hub: alu, disc: 0.15, discX: 0.075 }); fw.userData.front = true;
    bikeWheel(k, RR, 0.17, ZR, { style: 'spoke', n: 24, hub: alu, disc: 0.13, discX: 0.09 });
    // boxer: two finned cylinders with rocker covers sticking out sideways, sump guard, engine block, final-drive arm
    add(rbox(0.3, 0.3, 0.36, 0.08), M(0x2c2e31), 0, 0.5, 0.12); add(rbox(0.3, 0.05, 0.44, 0.02), alu, 0, 0.3, 0.14);
    for (const sx of [-1, 1]) { const zc = sx > 0 ? 0.17 : 0.09, cy = add(cyl(0.095, 0.1, 0.24, 14), M(0x7a7e83), sx * 0.26, 0.48, zc); cy.rotation.z = PI / 2;
      for (let i = 0; i < 4; i++) { const f = add(cyl(0.112, 0.112, 0.008, 14), M(0x8c9196), sx * (0.18 + i * 0.04), 0.48, zc); f.rotation.z = PI / 2; }
      add(rbox(0.09, 0.2, 0.22, 0.05), nw ? black : M(0x5a5d62), sx * 0.41, 0.48, zc); add(rbox(0.02, 0.1, 0.1, 0.02), acc, sx * 0.458, 0.48, zc);
      tube(k, [sx * 0.15, 0.82, 0.46], [sx * 0.37, 0.56, 0.32], 0.016, black); tube(k, [sx * 0.37, 0.56, 0.32], [sx * 0.37, 0.34, 0.1], 0.016, black); tube(k, [sx * 0.37, 0.56, 0.32], [sx * 0.17, 0.74, -0.12], 0.016, black); }
    tube(k, [-0.1, 0.5, -0.14], [-0.1, RR, ZR], 0.04, alu); const fd = add(sph(0.075, 10, 8), alu, -0.1, RR, ZR); tube(k, [0.1, 0.5, -0.14], [0.1, RR + 0.12, ZR + 0.2], 0.02, black); tube(k, [0, 0.55, -0.1], [0, 0.88, -0.4], 0.028, M(0xc9a24a));
    tube(k, [0.1, 0.34, -0.1], [0.22, 0.56, -0.86], 0.05, alu); const can = tube(k, [0.2, 0.5, -0.56], [0.24, 0.6, -0.96], 0.08, nw ? black : alu);
    // big tank, beak, seat, rack
    const tankG = bikeLoft(k, key + 'T', s => { s.moveTo(0.52, 0.8); s.lineTo(-0.08, 0.72); s.lineTo(-0.16, 0.98); s.lineTo(-0.04, 1.14); s.quadraticCurveTo(0.2, 1.24, 0.42, 1.2); s.lineTo(0.6, 1.1); }, nw ? 0.5 : 0.54, body, { rt: 0.1, rb: 0.1 });
    const d = decals(k, key, [tankG.geometry]);
    for (const [sx, sn] of SIDES) { if (nw) { d.p('g' + sx, sn, [[0.48, 0.84], [0.5, 1.02], [0.02, 1.06], [0.02, 0.84]], silv, { step: 0.09 }); d.r('gs' + sx, sn, [[0.5, 1.08], [-0.02, 1.1]], 0.05, acc, { step: 0.1 }); } else { d.p('g' + sx, sn, [[0.5, 0.86], [0.24, 1.08], [-0.02, 1.04], [-0.02, 0.84]], black, { step: 0.09 }); d.p('s' + sx, sn, [[0.42, 0.9], [0.24, 1.02], [0.1, 1.0], [0.2, 0.88]], acc, { step: 0.06, off: 0.009 }); }
      }
    add(sideGeo(key + 'Seat', s => { s.moveTo(-0.04, 1.02); s.quadraticCurveTo(-0.2, 0.96, -0.42, 1.03); s.lineTo(-0.72, 1.06); s.lineTo(-0.72, 0.98); s.lineTo(-0.1, 0.9); }, 0.34, 0.05), black);
    add(sideGeo(key + 'Tail', s => { s.moveTo(-0.7, 1.06); s.lineTo(-0.94, 1.04); s.lineTo(-0.9, 0.96); s.lineTo(-0.7, 0.96); }, 0.2, 0.03), M(0x26282b));
    add(rbox(0.3, 0.02, 0.36, 0.01), alu, 0, 1.08, -0.86);
    const topC = add(rbox(0.32, 0.24, 0.36, 0.03), silv, 0, 1.21, -0.86); add(rbox(0.33, 0.025, 0.37, 0.01), black, 0, 1.26, -0.86);
    for (const sx of [-1, 1]) { const px = sx * (nw ? 0.34 : 0.33), pw = sx > 0 ? 0.2 : 0.3; add(rbox(pw, 0.4, 0.5, 0.03), silv, px + sx * (pw / 2 - 0.1), 0.78, -0.62); add(rbox(pw + 0.01, 0.03, 0.51, 0.01), black, px + sx * (pw / 2 - 0.1), 0.94, -0.62); for (const y of [0.64, 0.86]) add(rbox(0.01, 0.024, 0.03, 0.004), black, px + sx * (pw - 0.095), y, -0.62);
      tube(k, [sx * 0.12, 1.0, -0.4], [sx * 0.3, 0.95, -0.5], 0.012, black); tube(k, [sx * 0.2, 0.62, -0.32], [sx * 0.3, 0.62, -0.42], 0.012, black); add(rbox(0.11, 0.03, 0.05, 0.01), alu, sx * 0.2, 0.42, -0.14); }
    const tl = k.lamp(0.14, 0.06, 0, 1.02, -0.92); tl.rotation.y = PI; tl.lens.rotation.y = PI; plate(k, -0.96, 0.78, false); guard(k, RR + 0.02, ZR, black, 0.2, 0.34, 0.8);
    // fork: beak, cowl, lamp, tall screen, wide bars (telelever-style shown as a fork)
    const fork = [fw]; const beak = add(sideGeo(key + 'Bk', s => { s.moveTo(0.9, 0.78); s.lineTo(0.56, 0.92); s.lineTo(0.5, 0.86); s.lineTo(0.88, 0.72); }, 0.17, 0.03), body); fork.push(beak);
    fork.push(guard(k, RF + 0.01, ZF, body, 0.2, 0.08, 0.7));
    fork.push(...[-1, 1].map(sx => tube(k, [sx * 0.1, RF, ZF], [sx * 0.1, 1.04, 0.52], 0.022, alu)));
    const cowl = add(sideGeo(key + 'Cw', s => { s.moveTo(0.54, 1.3); s.lineTo(0.72, 1.14); s.lineTo(0.74, 0.96); s.lineTo(0.56, 0.9); s.lineTo(0.46, 1.06); }, 0.34, 0.04), body); fork.push(cowl);
    const sc = add(sideGeo(key + 'Sc', s => { s.moveTo(0.7, 1.16); s.lineTo(0.5, nw ? 1.6 : 1.56); s.lineTo(0.46, nw ? 1.6 : 1.56); s.lineTo(0.64, 1.14); }, nw ? 0.34 : 0.3, 0.01), glass); fork.push(sc);
    const fM = fortunerMats().drl;
    if (nw) { // cross-shaped LED signature
      for (const a of [0.6, -0.6]) { const b = add(rbox(0.22, 0.03, 0.02, 0.008), fM, 0, 1.04, 0.745); b.rotation.z = a; fork.push(b); }
      const h1 = k.lamp(0.07, 0.07, -0.0, 1.11, 0.74, true); const h2 = k.lamp(0.07, 0.07, 0, 0.97, 0.75, true); fork.push(...lampParts(h1), ...lampParts(h2));
    } else { const h1 = k.lamp(0.12, 0.13, -0.05, 1.04, 0.745, true); const h2 = k.lamp(0.07, 0.09, 0.075, 1.04, 0.74, true); fork.push(...lampParts(h1), ...lampParts(h2)); const e = add(tor(0.075, 0.01, 4, 16), fM, -0.05, 1.04, 0.752); fork.push(e); }
    for (const sx of [-1, 1]) { fork.push(tube(k, [0, 1.3, 0.44], [sx * 0.42, 1.34, 0.36], 0.014, black), add(rbox(0.16, 0.05, 0.1, 0.02), M(0x26282b), sx * 0.46, 1.34, 0.42), add(rbox(0.11, 0.08, 0.02, 0.02), black, sx * 0.3, 1.42, 0.42)); fork.push(tube(k, [sx * 0.2, 1.32, 0.42], [sx * 0.3, 1.42, 0.42], 0.007, black)); add(rbox(0.05, 0.02, 0.02, 0.006), amberMat, sx * 0.14, 0.92, -0.97); }
    forkPivot(k, 1.28, 0.42, 0.45, fork);
    riders(k, 1.1, -0.28, -0.6, 0.95, 0.15);
    return two(k, nw ? 2.28 : 2.27, 'bike', nw ? 'r1300gsa' : 'r1250gsa', [0, 1.1, -0.28, 'bike']);
  }
  function r1250gsa() { return gsAdv(false); }
  function r1300gsa() { return gsAdv(true); }

  function mpv() { const v = innova(); v.type = 'mpv'; v.snd = 'mpv'; return v; }

  // ---------------------------------------------------------------- performance: merge static parts
  // A vehicle is built from ~100 small meshes; 52 of them were 5,000+ draw calls (twice, with the shadow pass).
  // Merge every static mesh into one mesh per material. Wheels (spin), head/tail lamps (colour changes) and
  // seated people (carjacking) stay separate objects so the game can still animate them.
  const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
  // merge static meshes under `root` (skipping anything in `keep` or inside a seated person) into one mesh per material
  function mergeUnder(root, keep) {
    root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert();
    const buckets = new Map(), victims = [];
    root.traverse(o => {
      if (!o.isMesh || Array.isArray(o.material) || o.isInstancedMesh) return;
      for (let q = o; q && q !== root; q = q.parent) if (keep.has(q) || (q.userData && q.userData.human)) return;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
      const b = buckets.get(o.material) || buckets.set(o.material, { geos: [], shadow: false }).get(o.material);
      b.geos.push(geo); b.shadow = b.shadow || o.castShadow; victims.push(o);
    });
    if (victims.length < 2) { victims.length = 0; return; }
    for (const o of victims) o.parent.remove(o);
    for (const [mat, b] of buckets) {
      const names = ['position', 'normal', 'uv', 'color'].filter(n => b.geos.some(g => g.attributes[n]));
      const total = b.geos.reduce((s2, g) => s2 + g.attributes.position.count, 0);
      const out = new THREE.BufferGeometry();
      for (const n of names) {
        const size = n === 'uv' ? 2 : 3, arr = new Float32Array(total * size); let off = 0;
        for (const g of b.geos) {
          const at = g.attributes[n], c = g.attributes.position.count;
          if (at) arr.set(at.array.subarray(0, c * size), off * size);
          else if (n === 'color') arr.fill(1, off * size, (off + c) * size);
          off += c;
        }
        out.setAttribute(n, new THREE.BufferAttribute(arr, size));
      }
      if (!out.attributes.normal) out.computeVertexNormals();
      out.computeBoundingSphere();
      const mesh = new THREE.Mesh(out, mat); mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      root.add(mesh);
      b.geos.forEach(g => g.dispose());
    }
  }
  // userData contract (see the header): steering pivots, wheel list, true bounding box
  const _box = new THREE.Box3(), _tb = new THREE.Box3(), _sz = new THREE.Vector3(), _c = new THREE.Vector3();
  function finalize(v) {
    const ud = v.userData = v.userData || {};
    let steer = v.steer || [];
    // real axle positions (front = largest z, rear = smallest z, a towed trolley's wheels excluded): vehicle-dynamics.js
    v.g.updateMatrixWorld(true);
    { const zs = v.wheels.filter(w => { for (let q = w; q; q = q.parent) if (q === v.trailer) return false; return true; }).map(w => w.getWorldPosition(_c).z);
      if (zs.length >= 2) v.g.userData.axles = { zf: Math.max(...zs), zr: Math.min(...zs) }; }
    // 3+ wheeled vehicles: wrap each wheel on the front axle in a vertical steering pivot
    if (!steer.length && !v.noSteer && v.wheels.length >= 3) {
      const zmax = Math.max(...v.wheels.map(w => w.position.z));
      for (const w of v.wheels) if (w.parent === v.g && w.position.z > zmax - 0.05) {
        const p = new THREE.Group(); p.name = 'steer'; p.position.copy(w.position); v.g.add(p);
        w.position.set(0, 0, 0); p.add(w); w.userData.front = true; steer.push(p);
      }
    }
    v.steer = steer;
    v.wheels.forEach((w, i) => { if (!w.name || w.name === 'wheel') w.name = 'wheel_' + i + (w.userData.front ? '_front' : ''); });
    steer.forEach((p, i) => { p.name = (p.name || 'steer') + '_' + i; });
    // bounding box of the vehicle itself (people excluded), in the vehicle's local frame (v.g is at identity here)
    v.g.updateMatrixWorld(true); _box.makeEmpty();
    v.g.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (let q = o; q; q = q.parent) if (q.userData && q.userData.human) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); _box.union(_tb);
    });
    _box.getSize(_sz); _box.getCenter(_c);
    const r2 = n => Math.round(n * 100) / 100;
    if (v.trailer) {      // what the player's collision uses: the tractor alone; the trolley has its own probes
      const b = new THREE.Box3();
      v.g.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; for (let q = o; q; q = q.parent) if (q === v.trailer || (q.userData && q.userData.human)) return;
        _tb.copy(o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox)).applyMatrix4(o.matrixWorld); b.union(_tb); });
      const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      v.g.userData.solo = { length: r2(sz.z), width: r2(sz.x), cz: r2(c.z) };
    }
    ud.dims = { length: r2(_sz.z), width: r2(_sz.x), height: r2(_sz.y) };
    ud.center = { x: r2(_c.x), y: r2(_c.y), z: r2(_c.z) };
    ud.wheels = v.wheels.map(w => ({ mesh: w, radius: w.userData.radius || 0.4, front: !!w.userData.front }));
    ud.steer = steer;
    ud.fork = v.twoWheeler ? steer[0] || null : null;
    ud.type = v.type || v.kind;
    ud.twoWheeler = !!v.twoWheeler;
    const P = v.g._parts || {}; ud.doors = P.doors || []; ud.hood = P.hood || null; ud.boot = P.boot || null; ud.sunroof = P.sunroof || null; ud.top = P.top || null;
    if (v.seat) { ud.seat = v.seat; if (!v.twoWheeler) v.g.children.forEach(c => { if (c.userData && c.userData.human) { const lift = headLift(v.g, c, v.seat[0], v.seat[2]); if (lift < 0) c.position.y += lift; } }); }   // no head through the roof
    if (v.snd) { ud.snd = v.snd; v.g.userData.snd = v.snd; }      // engine-audio.js voice ('v8', 'v8flat', 'v10', 'flat6')
    // plain-number copy on the group survives Object3D.clone()
    v.g.userData.dims = Object.assign({}, ud.dims); v.g.userData.center = Object.assign({}, ud.center); v.g.userData.type = ud.type;
    return v;
  }
  function bake(v) {
    if (pendingLean && v.kind !== 'bike' && !v.twoWheeler) applyLean(v.g, pendingLean);
    pendingLean = null;
    finalize(v);
    const lamps = new Set([...(v.head || []), ...(v.tail || [])]);
    const forks = (v.steer || []).filter(p => p.name.startsWith('fork'));
    const loads = []; v.g.traverse(o => { if (o.name === 'trolleyLoad') loads.push(o); });
    const ud = v.userData, parts = [...ud.doors, ud.hood, ud.boot, ud.sunroof, ud.top].filter(Boolean).map(q => q.mesh);
    const hold = [...(v.wheels || []), ...lamps, ...forks, ...loads, ...parts]; v.g.traverse(o => { if (o.name === 'apertures') hold.push(o); });
    mergeUnder(v.g, new Set(v.trailer ? [...hold, v.trailer] : hold));  // body: everything static
    if (v.trailer) mergeUnder(v.trailer, new Set(hold));                // the hinged trolley is one more merged piece
    for (const f of forks) mergeUnder(f, new Set([...(v.wheels || []), ...lamps]));   // bike fork/bars turn as one piece
    for (const q of parts) if (!q.isMesh) mergeUnder(q, lamps);                    // each opening part is one piece
    for (const w of v.wheels || []) mergeUnder(w, lamps);               // each wheel spins as one piece
    // seated people are small: no shadows from them (their joints stay intact for carjacking)
    v.g.children.forEach(c => { if (c.userData && c.userData.human) c.traverse(o => { if (o.isMesh) o.castShadow = false; }); });
    if (window.Cockpit && Cockpit.interiorGlass) Cockpit.interiorGlass(v);   // see-through windows: cabin drawn by interior mapping
    return v;
  }
  const baked = f => (...args) => { const v = f(...args); if (!v.type) v.type = f.name; return bake(v); };
  return { setPart, thar: baked(thar), hector: baked(hector), auto: baked(auto), bike: baked(bike), splendor: baked(splendor), scooter: baked(scooter), classic: baked(classic), classic2: baked(classic2),
    sport: baked(sport), faired: baked(faired), cycle: baked(cycle), mpv: baked(mpv), innova: baked(innova), wagonR: baked(wagonR), landCruiser: baked(landCruiser), defender: baked(defender), gclass: baked(gclass), tharRoxx: baked(tharRoxx), hayabusa: baked(hayabusa), s1000rr: baked(s1000rr), r1250gsa: baked(r1250gsa), r1300gsa: baked(r1300gsa), fortuner: baked(fortuner), fortunerBlack: baked(fortunerBlack), hilux: baked(hilux),
    berlinetta: baked(berlinetta), muscle: baked(muscle), wedge: baked(wedge), coupe911: baked(coupe911), crysta: baked(crysta), crysta2023: baked(crysta2023), SPORTS: ['berlinetta', 'muscle', 'wedge', 'coupe911'],
    swift: baked(swift), swiftNew: baked(swiftNew), safari: baked(safari), sumo: baked(sumo), scorpioN: baked(scorpioN), activa: baked(activa), starCity: baked(starCity), trolley: baked(trolley), dzire: baked(dzire), alto: baked(alto), bolero: baked(bolero), scorpio: baked(scorpio), ace: baked(ace),
    headLift, TWO_WHEELERS: ['bike', 'splendor', 'starCity', 'activa', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle', 'hayabusa', 's1000rr', 'r1250gsa', 'r1300gsa'], hatch: baked(hatch), suv: baked(suv), tractor: baked(tractor), lorry: baked(lorry), bus: baked(bus), bullockCart: baked(bullockCart), bake, mergeUnder };
})();
