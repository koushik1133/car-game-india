// Indian village traffic models, built procedurally (three.js r128): Bajaj-RE-style auto-rickshaw,
// two-wheelers (Splendor-style commuter, Activa-style scooter, Bullet-style and Jawa-style classics, Duke-style
// naked sport, R15-style fully-faired sport, hardtail mountain bicycle), cars (first-gen Swift-style hatch, Dzire-style
// sedan, Alto-style small hatch, four generic sports cars (mid-engine V8 berlinetta, muscle fastback, wedge supercar,
// rear-engine flat-six coupe), a parkable copy of the real Crysta, Bolero-style utility, classic Scorpio-style SUV, Ace-style mini truck, Innova-style
// MPV, Fortuner-style 4x4 in white or black), 575-style tractor with trolley, 1109-style lorry, Palle-Velugu-style
// village bus and a bullock cart. All generic, unbranded.
//
// Builders: TrafficModels.auto | bike | splendor | scooter | classic | classic2 | sport | faired | cycle | hatch | suv |
//           swift | dzire | alto | bolero | scorpio | ace | mpv | fortuner | fortunerBlack | tractor | lorry | bus | bullockCart.
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
  const WHEELS = {
    swift:   { n: 8, wIn: 0.026, wOut: 0.022, dish: 0.012, hubR: 0.07 },                           // 8 slim straight spokes
    dzire:   { n: 5, twin: 0.3, wIn: 0.024, wOut: 0.02, dish: 0.018, hubR: 0.07 },                // 5 split twin spokes
    scorpio: { n: 6, wIn: 0.06, wOut: 0.075, dish: 0.035, hubR: 0.085, nuts: 6 },                 // 6 broad dished spokes
    mpv:     { n: 10, wIn: 0.022, wOut: 0.026, dish: 0.022, hubR: 0.08 },                          // 10 thin spokes
    fortuner:{ n: 6, y: true, wIn: 0.03, wOut: 0.024, dish: 0.04, hubR: 0.09, nuts: 6, twoTone: true },   // 6 Y-split, gunmetal windows
    berlinetta: { n: 5, wIn: 0.06, wOut: 0.032, dish: 0.055, hubR: 0.07, bend: 0.012 },            // 5-arm star, deep concave
    muscle:  { n: 10, wIn: 0.02, wOut: 0.028, dish: 0.03, hubR: 0.085 },                           // 10 straight spokes
    wedge:   { n: 5, y: true, wIn: 0.034, wOut: 0.026, dish: 0.04, hubR: 0.07, dark: true },     // 5 Y spokes, dark finish
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
    return { g, wheels, head, tail, steer, add, wheel, lamp, headM, tailM };
  }
  function plate(k, z, y, front, x) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32; const t = c.getContext('2d');
    t.fillStyle = front ? '#fff' : '#ffd400'; t.fillRect(0, 0, 128, 32); t.strokeStyle = '#222'; t.lineWidth = 2; t.strokeRect(2, 2, 124, 28);
    t.fillStyle = '#111'; t.font = 'bold 17px sans-serif'; t.textAlign = 'center';
    t.fillText('TS 27 ' + String.fromCharCode(65 + Math.random() * 26 | 0, 65 + Math.random() * 26 | 0) + ' ' + (1000 + Math.random() * 8999 | 0), 64, 23);
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
  function splendor() {
    const k = kit(), add = k.add, PI = Math.PI;
    const body = paint(pickR([0x111111, 0x111111, 0x111111, 0x5d6166, 0x8b1a1a, 0x1a2f6b]));
    const stripe = paint(pickR([0xd8262d, 0xc0c4c8, 0x2f8fd8, 0x52b04a, 0xe8b72a])), stripe2 = paint(0xe8e8e8);
    const black = M(0x161616), alloy = M(0xb4b8bc), R = 0.3, ZF = 0.64, ZR = -0.62;
    const fw = bikeWheel(k, R, 0.068, ZF, { style: 'spoke', n: 18 }); fw.userData.front = true;
    bikeWheel(k, R, 0.08, ZR, { style: 'spoke', n: 18, hubR: 0.075 });
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
    return two(k, 1.97, 'bike', 'splendor', [0, 0.9, -0.28, 'bike']);
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
  function scooter() {
    const k = kit(), body = paint(pickR([0xa9dcc9, 0xb9d6ee, 0xf3e6c4, 0xf4c9c0, 0xd8cdea, 0xf6f6f2, 0xf6f6f2, 0xc9d7a6])), black = M(0x161616), dark = M(0x26282b);
    const fw = bikeWheel(k, 0.25, 0.1, 0.62, { style: 'alloy', n: 5, rim: M(0x4a4d52) }); fw.userData.front = true;
    bikeWheel(k, 0.25, 0.11, -0.6, { style: 'alloy', n: 5, rim: M(0x4a4d52) });
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
    return two(k, 1.85, 'scooter', 'scooter', [0, 0.86, -0.36, 'bike']);
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
  const TWO = { splendor, scooter, classic, classic2, sport, faired, cycle };
  const BIKE_MIX = ['splendor', 'splendor', 'splendor', 'scooter', 'scooter', 'scooter', 'classic', 'classic2', 'sport', 'faired'];
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
    for (const wz of zs) { const ln = k.add(G('lnr' + A + W, () => new THREE.CylinderGeometry(A - 0.01, A - 0.01, W * 0.86, 12, 1, true, -Math.PI / 2, Math.PI)), plasticIn, 0, AY, wz); ln.rotation.z = Math.PI / 2; ln.rotation.x = Math.PI; ln.castShadow = false; }
  }
  // dark cabin box with head rests, so glass reads as a real interior
  function cabin(k, F, W, y, z, L, rows, hy) {
    k.add(rbox(W - 0.32, 0.42, L, 0.05), F.cabin, 0, y, z);
    for (const sx of [-1, 1]) for (const hz of rows) k.add(rbox(0.22, 0.15, 0.08, 0.04), M(0x26272b), sx * 0.36, hy, hz);
  }
  const headMesh = (k, geom, x, y, z, parent) => { const m = k.add(geom, k.headM, x, y, z, parent); m.castShadow = false; k.head.push(m); return m; };
  const tailMesh = (k, geom, x, y, z, parent) => { const m = k.add(geom, k.tailM, x, y, z, parent); m.castShadow = false; k.tail.push(m); return m; };

  // ---------------------------------------------------------------- Swift 2010 hatch / Dzire-style sedan (first generation)
  // 3850 x 1695 x 1530 mm (sedan 4160), wheelbase 2380 (2430), 185/65 R14. Bubbly body, big swept-back headlamps
  // running up the fenders, blacked A and B pillars (the floating roof), thick body-colour C pillar, tall vertical tail
  // lamps on the hatch. The sedan shares the nose and adds a short boot with horizontal lamps.
  function swiftFam(sedan) {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI;
    const p = cPaint(pickR(sedan ? [0xf2f2f0, 0xf2f2f0, 0xb9bec4, 0x5a5f66, 0x6e1a1e, 0x2a3550, 0xbfae8e]
                                 : [0xc8102e, 0xc8102e, 0xf2f2f0, 0xb9bec4, 0x1d4e9e, 0x141518, 0xe0a21a, 0x5a5f66]));
    const W = 1.69, R = 0.29, A = 0.345, FW = 1.19, RW = sedan ? -1.24 : -1.19, SY = 0.3;
    const ZF = 1.93, ZR = sedan ? -2.22 : -1.92, key = sedan ? 'dz' : 'sw', GW = W - 0.2;
    add(sideHQ(key + 'Low', s => {
      s.moveTo(ZR + 0.1, SY); s.lineTo(RW - A, SY); s.absarc(RW, SY, A, PI, 0, true);
      s.lineTo(FW - A, SY); s.absarc(FW, SY, A, PI, 0, true); s.lineTo(ZF - 0.12, SY);
      s.bezierCurveTo(ZF - 0.02, SY, ZF + 0.01, 0.4, ZF, 0.52);                 // chin
      s.bezierCurveTo(ZF - 0.01, 0.66, ZF - 0.05, 0.76, ZF - 0.18, 0.8);        // round nose
      s.bezierCurveTo(1.45, 0.87, 1.05, 0.95, 0.84, 0.97);                      // short bubbly bonnet
      if (!sedan) {
        s.lineTo(-1.3, 1.03);
        s.bezierCurveTo(-1.62, 1.05, -1.84, 1.05, ZR + 0.03, 0.97);             // round hatch shoulder
        s.lineTo(ZR, 0.84); s.bezierCurveTo(ZR - 0.02, 0.6, ZR, 0.4, ZR + 0.1, SY);
      } else {
        s.lineTo(-1.5, 1.02);
        s.bezierCurveTo(-1.9, 1.03, -2.16, 1.02, ZR + 0.02, 0.95);              // short boot deck
        s.lineTo(ZR, 0.78); s.bezierCurveTo(ZR - 0.02, 0.55, ZR, 0.4, ZR + 0.1, SY);
      }
    }, W, 0.08), p);
    // greenhouse glass all round (pillars laid on top), roof
    add(sideHQ(key + 'Gl', s => {
      s.moveTo(0.88, 0.96); s.bezierCurveTo(0.55, 1.18, 0.25, 1.38, 0.02, 1.46);
      if (!sedan) { s.bezierCurveTo(-0.5, 1.5, -1.2, 1.5, -1.42, 1.48); s.bezierCurveTo(-1.6, 1.4, -1.78, 1.2, -1.85, 1.04); s.lineTo(-1.86, 0.98); }
      else { s.bezierCurveTo(-0.4, 1.49, -0.85, 1.48, -1.05, 1.44); s.bezierCurveTo(-1.3, 1.3, -1.5, 1.1, -1.66, 0.98); }
    }, GW, 0.03), F.glass);
    add(sideHQ(key + 'Roof', s => {
      s.moveTo(0.12, 1.43); s.bezierCurveTo(-0.1, 1.505, -0.4, 1.515, -0.6, 1.515);
      if (!sedan) { s.lineTo(-1.36, 1.51); s.bezierCurveTo(-1.5, 1.505, -1.6, 1.49, -1.64, 1.43); s.lineTo(-1.44, 1.465); }
      else { s.lineTo(-0.88, 1.5); s.bezierCurveTo(-0.98, 1.49, -1.06, 1.47, -1.09, 1.43); }
      s.lineTo(-0.6, 1.48); s.lineTo(0.04, 1.45);
    }, W - 0.15, 0.04), p);
    cabin(k, F, W, 1.0, sedan ? -0.35 : -0.45, sedan ? 2.0 : 2.3, [-0.25, -1.15], 1.3);
    for (const sx of [-1, 1]) {
      const gx = sx * (GW / 2 + 0.006);
      // floating roof: piano-black A and B pillars and a black band under the roof edge
      slab(k, F.black, gx, [0.88, 0.97], [0.03, 1.46], 0.08, 0.02);
      slab(k, F.black, gx, [-0.33, 0.99], [-0.39, 1.49], 0.1, 0.02);
      slab(k, F.black, gx, [0.03, 1.455], [sedan ? -1.0 : -1.38, sedan ? 1.46 : 1.485], 0.035, 0.02);
      // thick body-colour C pillar
      if (!sedan) sidePanel(k, 'swC', [[-0.98, 1.0], [-1.2, 1.49], [-1.46, 1.482], [-1.66, 1.3], [-1.85, 1.03], [-1.85, 0.99]], p, gx + sx * 0.002, 0.02);
      else sidePanel(k, 'dzC', [[-0.92, 1.0], [-0.98, 1.465], [-1.08, 1.44], [-1.3, 1.26], [-1.62, 1.0]], p, gx + sx * 0.002, 0.02);
      slab(k, F.clad, gx, [0.88, 0.985], [sedan ? -1.5 : -1.2, 1.025], 0.02, 0.022);           // window seal
      // door shut lines, body-colour handles, black rubbing strip
      for (const z of [0.84, -0.34, sedan ? -1.3 : -1.18]) add(rbox(0.008, 0.6, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 - 0.005), 0.72, z);
      for (const z of [0.18, -0.92]) add(rbox(0.03, 0.035, 0.15, 0.012), p, sx * (W / 2 + 0.005), 0.9, z);
      add(rbox(0.025, 0.05, 1.5, 0.012), F.clad, sx * (W / 2 + 0.004), 0.5, (FW + RW) / 2);
      carMirror(k, F, p, sx * (W / 2 - 0.02), 1.0, 0.78);
      // big swept-back headlamp: teardrop lens climbing back up the fender
      const hg = new THREE.Group(); hg.position.set(sx * 0.27, 0.68, ZF - 0.02); hg.rotation.order = 'YXZ'; hg.rotation.y = sx * 0.6; hg.rotation.x = -0.55; hg.scale.setScalar(1.22); k.g.add(hg);
      const hp = [[0, 0], [0.12, -0.035], [0.3, -0.015], [0.44, 0.07], [0.48, 0.17], [0.38, 0.19], [0.14, 0.1]].map(q => [sx * q[0], q[1]]);
      add(facePoly(key + 'HLh' + sx, hp, 0.14, 0.012), F.black, 0, 0, -0.03, hg);
      const inner = add(facePoly(key + 'HLi' + sx, hp.map(q => [q[0] * 0.94 + sx * 0.012, q[1] * 0.8 + 0.012]), 0.01), F.silver, 0, 0, 0.042, hg);
      for (const [px, py, r] of [[0.13, 0.035, 0.05], [0.3, 0.07, 0.06]]) {
        headMesh(k, G('hlD' + r, () => new THREE.CircleGeometry(r, 16)), sx * px, py, 0.05, hg);
        add(tor(r + 0.006, 0.007, 4, 16), F.chrome, sx * px, py, 0.05, hg);
      }
      add(rbox(0.07, 0.03, 0.01, 0.01), F.amber, sx * 0.42, 0.13, 0.048, hg);
      const lens = add(facePoly(key + 'HLl' + sx, hp, 0.02), lensMat, 0, 0, 0.065, hg); lens.castShadow = false;
      // fog lamps in the bumper corners
      add(G('fogD', () => new THREE.CircleGeometry(0.045, 14)), F.drl, sx * 0.6, 0.42, ZF - 0.025);
      add(tor(0.05, 0.01, 4, 14), F.black, sx * 0.6, 0.42, ZF - 0.025);
      // rear lamps
      if (!sedan) {
        k.lamp(0.17, 0.32, sx * 0.62, 0.86, ZR - 0.012, false);                               // tall vertical tail lamps
        add(rbox(0.2, 0.35, 0.02, 0.03), F.black, sx * 0.62, 0.86, ZR - 0.002);
        add(rbox(0.13, 0.05, 0.01, 0.01), M(0xdddddd), sx * 0.62, 0.76, ZR - 0.016);         // reversing lens
      } else {
        const t = k.lamp(0.34, 0.13, sx * 0.58, 0.86, ZR - 0.004, false); t.rotation.y = PI - sx * 0.12; t.lens.rotation.copy(t.rotation);
        add(rbox(0.36, 0.15, 0.04, 0.03), F.black, sx * 0.58, 0.86, ZR + 0.018).rotation.y = -sx * 0.12;
      }
      add(rbox(0.12, 0.025, 0.02, 0.01), F.redLens, sx * 0.62, 0.45, ZR - 0.01);
    }
    liners(k, A, SY, W, [FW, RW]);
    // front: small smiling grille with chrome bar and badge, wide lower air dam
    add(facePoly(key + 'Gr', [[-0.3, 0.62], [0.3, 0.62], [0.36, 0.735], [-0.36, 0.735]], 0.05, 0.01), F.black, 0, 0, ZF - 0.03);
    add(rbox(0.68, 0.022, 0.03, 0.01), F.chrome, 0, 0.705, ZF - 0.005);
    add(sph(0.05, 12, 8), F.chrome, 0, 0.678, ZF - 0.0).scale.set(1.3, 0.85, 0.3);
    add(facePoly(key + 'Int', [[-0.46, 0.35], [0.46, 0.35], [0.52, 0.48], [-0.52, 0.48]], 0.06, 0.01), F.black, 0, 0, ZF - 0.02);
    for (let i = 0; i < 2; i++) add(rbox(0.9, 0.012, 0.012, 0.004), F.gun, 0, 0.39 + i * 0.045, ZF + 0.012);
    // rear
    add(rbox(1.3, 0.12, 0.06, 0.03), F.clad, 0, 0.36, ZR + 0.04);
    if (!sedan) {
      add(rbox(0.5, 0.03, 0.03, 0.01), k.tailM, 0, 1.475, -1.64);                         // high-mount stop lamp
      const wp = add(rbox(0.42, 0.015, 0.015, 0.005), F.black, 0.04, 1.2, -1.82); wp.rotation.z = 0.3; wp.rotation.x = -0.6;
      add(sph(0.045, 12, 8), F.chrome, 0, 0.98, ZR + 0.01).scale.set(1.3, 0.85, 0.3);
    } else {
      add(rbox(0.7, 0.025, 0.02, 0.008), F.chrome, 0, 0.85, ZR - 0.004);
      add(sph(0.045, 12, 8), F.chrome, 0, 0.92, ZR + 0.01).scale.set(1.3, 0.85, 0.3);
    }
    const wl = add(rbox(0.45, 0.012, 0.015, 0.005), F.black, 0.25, 0.99, 0.84); wl.rotation.x = -0.5;
    const wr = add(rbox(0.45, 0.012, 0.015, 0.005), F.black, -0.32, 0.99, 0.84); wr.rotation.x = -0.5;
    plate(k, ZF + 0.02, 0.45, true); plate(k, ZR - 0.012, sedan ? 0.62 : 0.6, false);
    add(rbox(W * 0.84, 0.12, ZF - ZR - 0.6, 0.04), F.clad, 0, 0.28, (ZF + ZR) / 2);
    for (const [x, z] of [[-0.73, FW], [0.73, FW], [-0.73, RW], [0.73, RW]]) carWheel(k, F, R, 0.185, x, z, sedan ? WHEELS.dzire : WHEELS.swift);
    person(k, 0.36, 0.64, -0.2, { outfit: 'shirt', color: pickR([0xffffff, 0x8fa9c4, 0x2e4a7a]) }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: Math.round((ZF - ZR) * 100) / 100, kind: 'car', type: sedan ? 'dzire' : 'swift', seat: [0.36, 0.64, -0.2, 'car'] };
  }
  const swift = () => swiftFam(false), dzire = () => swiftFam(true);

  // ---------------------------------------------------------------- Alto-style small hatch (3445 x 1490 x 1475, 145/80 R12)
  // Tall narrow box, short sloping bonnet, near-upright hatch, body-colour A / C pillars, small lamps, steel wheels.
  function alto() {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI;
    const p = cPaint(pickR([0xf2f2f0, 0xf2f2f0, 0xb9bec4, 0xb9bec4, 0xb3121b, 0x2b4f8f, 0x9c8a6a]));
    const W = 1.49, R = 0.265, A = 0.315, FW = 1.13, RW = -1.23, SY = 0.29, ZF = 1.74, ZR = -1.7, GW = W - 0.18;
    add(sideHQ('altLow', s => {
      s.moveTo(ZR + 0.08, SY); s.lineTo(RW - A, SY); s.absarc(RW, SY, A, PI, 0, true);
      s.lineTo(FW - A, SY); s.absarc(FW, SY, A, PI, 0, true); s.lineTo(ZF - 0.1, SY);
      s.quadraticCurveTo(ZF + 0.01, SY, ZF, 0.45); s.lineTo(ZF - 0.02, 0.66);
      s.quadraticCurveTo(ZF - 0.04, 0.74, ZF - 0.16, 0.76);
      s.lineTo(0.88, 0.9); s.lineTo(-1.35, 0.95);
      s.quadraticCurveTo(-1.62, 0.96, ZR + 0.02, 0.93); s.lineTo(ZR, 0.5); s.quadraticCurveTo(ZR, SY, ZR + 0.08, SY);
    }, W, 0.06), p);
    add(sideHQ('altGl', s => { s.moveTo(0.9, 0.89); s.lineTo(0.16, 1.38); s.lineTo(-1.42, 1.41); s.lineTo(-1.66, 1.0); s.lineTo(-1.67, 0.93); }, GW, 0.025), F.glass);
    add(sideHQ('altRoof', s => { s.moveTo(0.22, 1.36); s.quadraticCurveTo(0.12, 1.44, -0.05, 1.445); s.lineTo(-1.4, 1.45); s.quadraticCurveTo(-1.5, 1.45, -1.52, 1.4); s.lineTo(-1.4, 1.41); s.lineTo(0.14, 1.39); }, W - 0.13, 0.035), p);
    cabin(k, F, W, 0.95, -0.35, 2.0, [-0.2, -1.05], 1.25);
    for (const sx of [-1, 1]) {
      const gx = sx * (GW / 2 + 0.006);
      slab(k, p, gx, [0.9, 0.9], [0.15, 1.39], 0.08, 0.02);                                 // body-colour A pillar
      slab(k, F.black, gx, [-0.3, 0.93], [-0.32, 1.41], 0.09, 0.02);                        // black B pillar
      sidePanel(k, 'altC', [[-1.12, 0.95], [-1.3, 1.41], [-1.44, 1.41], [-1.67, 1.0], [-1.67, 0.94]], p, gx + sx * 0.002, 0.02);
      slab(k, F.clad, gx, [0.9, 0.91], [-1.12, 0.955], 0.02, 0.022);
      for (const z of [0.86, -0.3]) add(rbox(0.008, 0.56, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 - 0.004), 0.68, z);
      add(rbox(0.03, 0.035, 0.14, 0.012), F.clad, sx * (W / 2 + 0.005), 0.84, 0.15);
      add(rbox(0.03, 0.035, 0.14, 0.012), F.clad, sx * (W / 2 + 0.005), 0.84, -0.85);
      carMirror(k, F, F.clad, sx * (W / 2 - 0.02), 0.93, 0.8);
      // small trapezoid headlamps, round-cornered vertical tail lamps
      const h = k.lamp(0.34, 0.16, sx * 0.47, 0.69, ZF - 0.005, true); h.rotation.y = sx * 0.22; h.lens.rotation.copy(h.rotation);
      add(rbox(0.37, 0.19, 0.05, 0.03), F.black, sx * 0.47, 0.69, ZF - 0.035).rotation.y = sx * 0.22;
      add(rbox(0.07, 0.035, 0.02, 0.01), F.amber, sx * 0.66, 0.66, ZF - 0.1).rotation.y = sx * 0.5;
      const t = k.lamp(0.13, 0.27, sx * 0.6, 0.78, ZR - 0.004, false); t.lens.rotation.copy(t.rotation);
      add(rbox(0.15, 0.29, 0.04, 0.03), F.black, sx * 0.6, 0.78, ZR + 0.018);
    }
    liners(k, A, SY, W, [FW, RW]);
    add(facePoly('altGr', [[-0.26, 0.6], [0.26, 0.6], [0.3, 0.7], [-0.3, 0.7]], 0.04, 0.008), F.black, 0, 0, ZF - 0.02);
    add(rbox(0.5, 0.018, 0.02, 0.008), F.chrome, 0, 0.665, ZF);
    add(sph(0.04, 12, 8), F.chrome, 0, 0.665, ZF + 0.005).scale.set(1.3, 0.85, 0.3);
    add(rbox(1.3, 0.16, 0.08, 0.04), F.clad, 0, 0.38, ZF - 0.02);
    add(rbox(0.6, 0.06, 0.02, 0.02), F.black, 0, 0.4, ZF + 0.025);
    add(rbox(1.3, 0.16, 0.08, 0.04), F.clad, 0, 0.4, ZR + 0.02);
    const wp = add(rbox(0.38, 0.015, 0.015, 0.005), F.black, 0.03, 1.1, -1.63); wp.rotation.z = 0.3;
    const wl = add(rbox(0.4, 0.012, 0.015, 0.005), F.black, 0.22, 0.92, 0.86); wl.rotation.x = -0.5;
    plate(k, ZF + 0.03, 0.47, true); plate(k, ZR - 0.012, 0.62, false);
    add(rbox(W * 0.84, 0.12, ZF - ZR - 0.6, 0.04), F.clad, 0, 0.27, 0);
    for (const [x, z] of [[-0.64, FW], [0.64, FW], [-0.64, RW], [0.64, RW]]) carWheel(k, F, R, 0.145, x, z, 'steel', 0, M(0x6a6e73));
    person(k, 0.33, 0.6, -0.15, { outfit: Math.random() < 0.7 ? 'shirt' : 'lungi', color: 0xffffff }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR, kind: 'car', type: 'alto', seat: [0.33, 0.6, -0.15, 'car'] };
  }

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
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR + 0.2, kind: 'car', type: 'bolero', seat: [0.38, 0.88, -0.1, 'car'] };
  }

  // ---------------------------------------------------------------- Scorpio-style SUV, classic shape (4460 x 1820 x 1995)
  // Tall, raked nose with a bonnet scoop, toothy chrome grille, big clear lamps, rising beltline, very tall vertical
  // tail lamps running up the D pillar, ladder on the tail door, heavy cladding and side step, 6-spoke alloys.
  function scorpio() {
    const k = kit(), F = fortunerMats(), add = k.add, PI = Math.PI;
    const p = cPaint(pickR([0xf4f4f1, 0xf4f4f1, 0x141518, 0x141518, 0xb9bec4, 0x5d1218, 0x4a4f55]));
    const W = 1.82, R = 0.37, A = 0.45, FW = 1.4, RW = -1.28, SY = 0.46, ZF = 2.2, ZR = -2.26, GW = W - 0.16;
    add(sideHQ('scpLow', s => {
      s.moveTo(ZR + 0.05, SY); s.lineTo(RW - A, SY); s.absarc(RW, SY, A, PI, 0, true);
      s.lineTo(FW - A, SY); s.absarc(FW, SY, A, PI, 0, true); s.lineTo(ZF - 0.08, SY);
      s.lineTo(ZF, 0.56); s.lineTo(ZF - 0.04, 1.06); s.quadraticCurveTo(ZF - 0.06, 1.14, ZF - 0.16, 1.15);  // raked face
      s.bezierCurveTo(1.7, 1.17, 1.3, 1.22, 1.0, 1.25);                                                  // bonnet rising to the screen
      s.lineTo(-1.5, 1.3); s.lineTo(ZR + 0.05, 1.34); s.quadraticCurveTo(ZR, 1.34, ZR, 1.28); s.lineTo(ZR, SY + 0.05);
    }, W, 0.07), p);
    add(sideHQ('scpGl', s => { s.moveTo(1.04, 1.24); s.lineTo(0.42, 1.88); s.lineTo(-2.12, 1.92); s.lineTo(-2.2, 1.36); s.lineTo(-2.2, 1.3); }, GW, 0.025), F.glass);
    add(sideHQ('scpRoof', s => { s.moveTo(0.5, 1.86); s.quadraticCurveTo(0.38, 1.94, 0.2, 1.95); s.lineTo(-2.08, 1.985); s.quadraticCurveTo(-2.2, 1.98, -2.22, 1.9); s.lineTo(-2.0, 1.91); s.lineTo(0.42, 1.875); }, W - 0.12, 0.04), p);
    cabin(k, F, W, 1.25, -0.5, 2.9, [-0.1, -1.0, -1.75], 1.6);
    for (const sx of [-1, 1]) {
      const gx = sx * (GW / 2 + 0.006);
      slab(k, p, gx, [1.04, 1.25], [0.42, 1.88], 0.09, 0.02);
      slab(k, F.black, gx, [-0.18, 1.27], [-0.2, 1.9], 0.1, 0.02);
      slab(k, F.black, gx, [-1.2, 1.29], [-1.22, 1.92], 0.1, 0.02);
      // broad body-colour D pillar carrying the tall tail lamp
      sidePanel(k, 'scpD', [[-1.78, 1.32], [-1.86, 1.94], [-2.22, 1.94], [-2.22, 1.32]], p, gx + sx * 0.002, 0.02);
      const t = k.lamp(0.14, 0.5, sx * 0.79, 1.58, ZR - 0.012, false); t.lens.rotation.copy(t.rotation);
      add(rbox(0.17, 0.54, 0.04, 0.03), F.chrome, sx * 0.79, 1.58, ZR + 0.008);
      const ts = new THREE.Mesh(G('scpTs', () => new THREE.PlaneGeometry(0.12, 0.46)), t.material); ts.position.set(sx * (W / 2 - 0.035), 1.58, ZR + 0.08); ts.rotation.y = sx * PI / 2; k.g.add(ts); k.tail.push(ts);
      // cladding, flared arches, side step
      add(rbox(0.04, 0.22, FW - RW - 2 * A - 0.06, 0.02), F.clad, sx * (W / 2 + 0.01), 0.58, (FW + RW) / 2);
      for (const wz of [FW, RW]) { const fl = add(tor(A + 0.04, 0.06, 5, 18, PI), F.clad, sx * (W / 2 + 0.005), SY, wz); fl.rotation.y = PI / 2; fl.scale.z = 0.8; }
      add(rbox(0.2, 0.05, FW - RW - 2 * A - 0.1, 0.02), F.silver, sx * (W / 2 + 0.07), 0.44, (FW + RW) / 2);
      for (const z of [1.0, -0.2, -1.2]) add(rbox(0.008, 0.66, 0.012, 0.003), M(0x3d3f44), sx * (W / 2 - 0.003), 0.98, z);
      for (const z of [0.38, -0.82]) add(rbox(0.03, 0.035, 0.16, 0.012), F.chrome, sx * (W / 2 + 0.008), 1.18, z);
      add(rbox(0.05, 0.04, 2.5, 0.015), F.silver, sx * 0.74, 2.02, -0.85);
      for (const z of [0.2, -0.85, -1.95]) add(rbox(0.06, 0.05, 0.1, 0.015), F.clad, sx * 0.74, 2.0, z);
      carMirror(k, F, F.clad, sx * (W / 2 - 0.02), 1.32, 0.95);
      // big clear headlamps with chrome reflectors, amber corner, fogs
      const hg = new THREE.Group(); hg.position.set(sx * 0.62, 0.98, ZF - 0.03); hg.rotation.y = sx * 0.2; hg.rotation.x = -0.08; k.g.add(hg);
      add(rbox(0.4, 0.24, 0.05, 0.04), F.chrome, 0, 0, 0, hg);
      const h = k.lamp(0.34, 0.2, 0, 0, 0, true); hg.add(h); h.position.set(-sx * 0.02, 0, 0.03); hg.add(h.lens); h.lens.position.set(-sx * 0.02, 0, 0.038);
      add(rbox(0.07, 0.17, 0.02, 0.01), F.amber, sx * 0.17, 0, 0.032, hg);
      add(G('fogD', () => new THREE.CircleGeometry(0.045, 14)), F.drl, sx * 0.66, 0.6, ZF + 0.08);
      add(tor(0.05, 0.01, 4, 14), F.chrome, sx * 0.66, 0.6, ZF + 0.08);
    }
    liners(k, A, SY, W, [FW, RW]);
    // toothy grille: chrome frame, six fat vertical chrome teeth
    add(facePoly('scpGrC', [[-0.44, 0.82], [0.44, 0.82], [0.4, 1.1], [-0.4, 1.1]], 0.05, 0.01), F.chrome, 0, 0, ZF - 0.02);
    add(facePoly('scpGrB', [[-0.4, 0.85], [0.4, 0.85], [0.37, 1.07], [-0.37, 1.07]], 0.02), F.black, 0, 0, ZF + 0.005);
    for (let i = 0; i < 6; i++) { const tth = add(rbox(0.06, 0.21, 0.04, 0.02), F.chrome, -0.3 + i * 0.12, 0.96, ZF + 0.012); tth.rotation.x = -0.08; }
    add(sph(0.05, 12, 8), F.chrome, 0, 1.0, ZF + 0.035).scale.set(1.3, 0.85, 0.3);
    // bonnet scoop: raised black-mouthed intake on the centre line
    add(sideHQ('scpScoop', s => { s.moveTo(1.68, 1.18); s.lineTo(1.6, 1.27); s.lineTo(1.2, 1.29); s.lineTo(1.05, 1.24); s.lineTo(1.4, 1.2); }, 0.62, 0.03), p);
    add(rbox(0.5, 0.06, 0.02, 0.01), F.black, 0, 1.235, 1.6);
    // bumpers, skid plate, plates
    add(rbox(1.86, 0.26, 0.2, 0.06), F.clad, 0, 0.6, ZF - 0.02);
    add(rbox(0.9, 0.06, 0.12, 0.02), F.silver, 0, 0.47, ZF + 0.02);
    add(rbox(1.86, 0.26, 0.2, 0.06), F.clad, 0, 0.62, ZR - 0.02);
    plate(k, ZF + 0.085, 0.66, true); plate(k, ZR - 0.012, 1.0, false);
    // ladder on the tail door (one side), spare wheel under, wiper
    const LX = -0.5;
    for (const dx of [-0.13, 0.13]) add(rbox(0.03, 1.1, 0.03, 0.01), F.silver, LX + dx, 1.32, ZR - 0.08);
    for (let i = 0; i < 7; i++) add(rbox(0.26, 0.022, 0.022, 0.008), F.silver, LX, 0.84 + i * 0.16, ZR - 0.08);
    for (const y of [0.9, 1.8]) add(rbox(0.03, 0.03, 0.08, 0.01), F.silver, LX, y, ZR - 0.04);
    const sp = add(tyreGeo(0.36, 0.22, false), rubber, 0, 0.5, ZR + 0.3); sp.rotation.z = PI / 2;
    const wp = add(rbox(0.45, 0.015, 0.015, 0.005), F.black, 0.1, 1.42, ZR - 0.01); wp.rotation.z = 0.25;
    const wl = add(rbox(0.55, 0.012, 0.015, 0.005), F.black, 0.27, 1.28, 1.02); wl.rotation.x = -0.6;
    const wr = add(rbox(0.55, 0.012, 0.015, 0.005), F.black, -0.33, 1.28, 1.02); wr.rotation.x = -0.6;
    add(rbox(W * 0.86, 0.16, 4.0, 0.04), F.clad, 0, 0.4, 0);
    for (const [x, z] of [[-0.8, FW], [0.8, FW], [-0.8, RW], [0.8, RW]]) carWheel(k, F, R, 0.235, x, z, WHEELS.scorpio);
    person(k, 0.4, 0.95, -0.05, { outfit: 'shirt', color: pickR([0xffffff, 0x222222, 0x8fa9c4]) }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: ZF - ZR, kind: 'car', type: 'scorpio', seat: [0.4, 0.95, -0.05, 'car'] };
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
  function crysta() {
    if (typeof buildCrystaShell !== 'function' || typeof buildCrystaWheel !== 'function') return mpv();
    const k = kit(), F = fortunerMats();
    const save = { hoodMesh, trunkMesh, sunroofMesh, doorMeshes, mirrorMeshes, wiperMeshes, frontHeadlights, rearBrakeLights, nosFlameJets };
    let chassis = new THREE.Group();
    try {
      doorMeshes = {}; mirrorMeshes = {}; wiperMeshes = []; frontHeadlights = []; rearBrakeLights = []; nosFlameJets = [];
      const env = crystaEnvMap();
      const Mx = { paint: new THREE.MeshPhongMaterial({ color: pickR([0xf4f4f0, 0xf4f4f0, 0x9aa0a6, 0x2b2d31, 0x6e1a1e]), specular: 0xb8c2cc, shininess: 110, envMap: env, reflectivity: 0.16, combine: THREE.MixOperation }),
        pianoBlack: F.black, chrome: F.chrome, glass: F.glass };
      buildCrystaShell(chassis, Mx, typeof createLicensePlateTexture === 'function' ? createLicensePlateTexture() : null);
      for (const f of nosFlameJets) if (f.parent) f.parent.remove(f);
      frontHeadlights.forEach(m => { if (m.isMesh) k.head.push(m); });
      rearBrakeLights.forEach(m => { if (m.isMesh) k.tail.push(m); });
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
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.735, kind: 'car', type: 'crysta', seat: [0.4, 0.86, 0.0, 'car'] };
  }
  // traffic 'hatch' / 'suv' are a mix of the models above (kind stays 'car'; userData.type names the model)
  const CARS = { swift, dzire, alto, bolero, scorpio, ace };
  const SPORTS = { berlinetta, muscle, wedge, coupe911 };
  // ~4 % of traffic hatches are one of the sports cars (rare sightings)
  function hatch(type) { if (CARS[type]) return CARS[type](); if (SPORTS[type]) return SPORTS[type]();
    if (Math.random() < 0.04) return SPORTS[pickR(Object.keys(SPORTS))]();
    return CARS[pickR(['swift', 'swift', 'alto', 'alto', 'dzire', 'dzire'])](); }
  function suv(type) { return CARS[type] ? CARS[type]() : CARS[pickR(['bolero', 'bolero', 'scorpio', 'scorpio', 'ace'])](); }

  // ---------------------------------------------------------------- MPV (Innova-style people mover, 4.73 x 1.83 x 1.80)
  function mpv() {
    const k = kit(), p = paint([0xf2f2f0, 0xb8bcc0, 0x3c3f44, 0x6b1f1f, 0x8a7a5e][Math.random() * 5 | 0]);
    const W = 1.83, A = 0.4, FW = 1.45, RW = -1.3, AY = 0.35;
    carShell(k, {
      key: 'mpv', W, arch: A, archY: AY, wheelsZ: [FW, RW], pillars: [0.32, -0.62, -1.62], handles: [0.5, -0.4], handleY: 1.02, roofY: 1.76,
      low: s => {
        s.moveTo(-2.3, 0.32); s.lineTo(RW - A, 0.32); s.lineTo(RW - A, AY); s.absarc(RW, AY, A, Math.PI, 0, true); s.lineTo(FW - A, 0.32);
        s.lineTo(FW - A, AY); s.absarc(FW, AY, A, Math.PI, 0, true); s.lineTo(2.3, 0.32);
        s.quadraticCurveTo(2.38, 0.38, 2.37, 0.6); s.lineTo(2.33, 0.84); s.quadraticCurveTo(2.25, 0.98, 2.0, 1.0); s.lineTo(1.2, 1.1); s.lineTo(-2.25, 1.12);
        s.quadraticCurveTo(-2.36, 1.1, -2.36, 0.95); s.lineTo(-2.36, 0.4); s.quadraticCurveTo(-2.35, 0.32, -2.3, 0.32);
      },
      cab: s => { s.moveTo(1.22, 1.08); s.lineTo(0.42, 1.74); s.quadraticCurveTo(0.2, 1.78, -0.2, 1.78); s.lineTo(-2.1, 1.76); s.quadraticCurveTo(-2.3, 1.74, -2.32, 1.5); s.lineTo(-2.34, 1.1); },
      ws: s => { s.moveTo(1.18, 1.12); s.lineTo(0.44, 1.72); s.lineTo(0.39, 1.71); s.lineTo(1.12, 1.11); },
      rw: s => { s.moveTo(-2.12, 1.72); s.quadraticCurveTo(-2.29, 1.7, -2.31, 1.48); s.lineTo(-2.33, 1.2); s.lineTo(-2.35, 1.2); s.lineTo(-2.33, 1.5); s.quadraticCurveTo(-2.31, 1.74, -2.12, 1.75); },
      win: [[1.06, 1.15], [0.4, 1.7], [-2.05, 1.7], [-2.22, 1.18]],
    }, p);
    // bumpers, big trapezoid chrome grille, sweptback lamps, roof rails, side cladding
    k.add(sideGeo('mpvBumpF', s => { s.moveTo(2.1, 0.32); s.lineTo(2.36, 0.33); s.quadraticCurveTo(2.43, 0.42, 2.41, 0.58); s.lineTo(2.1, 0.58); }, W - 0.04, 0.05), M(0x2a2a2a));
    k.add(sideGeo('mpvBumpR', s => { s.moveTo(-2.1, 0.34); s.lineTo(-2.38, 0.34); s.quadraticCurveTo(-2.43, 0.42, -2.41, 0.6); s.lineTo(-2.1, 0.6); }, W - 0.04, 0.05), M(0x2a2a2a));
    const gr = k.add(G('mpvGr', () => { const s = new THREE.Shape(); s.moveTo(-0.5, -0.2); s.lineTo(0.5, -0.2); s.lineTo(0.42, 0.18); s.lineTo(-0.42, 0.18); return new THREE.ShapeGeometry(s); }), grilleMat, 0, 0.74, 2.37); gr.rotation.x = -0.15;
    for (let i = 0; i < 3; i++) k.add(rbox(0.86 - i * 0.06, 0.025, 0.02, 0.01), chrome, 0, 0.64 + i * 0.1, 2.385 - i * 0.012);
    for (const sx of [-1, 1]) {
      const h = k.lamp(0.42, 0.14, sx * 0.62, 0.9, 2.28, true); h.rotation.y = sx * 0.4; h.rotation.x = -0.35; h.lens.rotation.copy(h.rotation);
      const t = k.lamp(0.12, 0.42, sx * 0.84, 1.0, -2.36); t.rotation.y = Math.PI - sx * 0.25; t.lens.rotation.copy(t.rotation);
      k.add(rbox(0.03, 0.1, 3.0, 0.02), plastic, sx * (W / 2 + 0.01), 0.45, 0.05);
      k.add(cyl(0.02, 0.02, 2.4, 5), M(0x2a2a2a), sx * 0.7, 1.83, -0.8).rotation.x = Math.PI / 2;
      for (const z of [0.3, -0.8, -1.9]) k.add(cyl(0.02, 0.02, 0.07, 5), M(0x2a2a2a), sx * 0.7, 1.8, z);
    }
    k.add(sph(0.05, 8, 6), badgeMat, 0, 0.76, 2.39).scale.z = 0.3;
    mirrors(k, [-0.93, 0.93], 1.15, 0.95, p);
    for (const [x, z] of [[-0.79, FW], [0.79, FW], [-0.79, RW], [0.79, RW]]) carWheel(k, fortunerMats(), 0.34, 0.21, x, z, WHEELS.mpv);
    plate(k, 2.42, 0.48, true); plate(k, -2.42, 0.68, false);
    k.add(rbox(1.5, 0.08, 3.4, 0.03), M(0x2a2a2a), 0, 0.62, -0.4);
    person(k, 0.4, 0.8, 0.0, { outfit: 'shirt', color: 0xffffff }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.75, kind: 'car', seat: [0.4, 0.8, 0.0, 'car'] };
  }

  // ---------------------------------------------------------------- Fortuner-style 4x4 SUV (2022 facelift, white)
  // 4795 x 1855 x 1835 mm, wheelbase 2745, 225 mm ground clearance, 265/60 R18 alloys. Generic badge, no logos.
  // Hi-res bezier side profiles (same technique as crysta-body.js), env-mapped paint / chrome / piano black.
  const fMatsC = {}; let fMats = null;
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
      amber: new THREE.MeshBasicMaterial({ color: 0xe08a12 }),
      redLens: new THREE.MeshPhongMaterial({ color: 0x7a0c0c, specular: 0xffffff, shininess: 120 }),
      cabin: new THREE.MeshLambertMaterial({ color: 0x121316 }),
      mesh: new THREE.MeshPhongMaterial({ map: canvasTex('fGrille', 128, 64, (x, w, h) => {
        x.fillStyle = '#0a0b0c'; x.fillRect(0, 0, w, h); x.strokeStyle = '#3c4044'; x.lineWidth = 2;
        for (let r = 0; r < 9; r++) for (let c = 0; c < 12; c++) {     // hexagonal mesh
          const cx = c * 11 + (r % 2) * 5.5, cy = r * 8 + 4; x.beginPath();
          for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; x.lineTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 4.2); }
          x.closePath(); x.stroke();
        }
      }), specular: 0x333333, shininess: 50 }),
    });
  }
  // high-quality side extrusion (more bevel / curve segments than sideGeo)
  // car body / glass / roof pieces: lofted rounded sections (see loftGeo), options chosen by the piece's key
  function sideHQ(key, draw, width, b) { return loftGeo(key, draw, width, loftOpts(key, draw, width)); }
  // flat polygon in the (x, y) face plane, extruded `d` along z
  const facePoly = (key, pts, d, b) => faceGeo(key, s => { s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); }, d, b || 0);
  // 18" six twin-spoke machined alloy on a 265/60 tyre; spins about local x, outer face at +x * side
  function fortunerWheel(k, F, R, x, y, z) {
    const side = Math.sign(x), wg = new THREE.Group(); wg.position.set(x, y, z); wg.userData.radius = R; wg.name = 'wheel';
    const Wd = 0.265, rimR = R * 0.59;
    k.add(tyreGeo(R, Wd, false), rubber, 0, 0, 0, wg);
    const barrel = k.add(cyl(rimR, rimR, Wd * 0.86, 24, true), F.gun, 0, 0, 0, wg); barrel.rotation.z = Math.PI / 2;
    const dish = k.add(G('fDish', () => new THREE.CircleGeometry(rimR * 0.97, 24)), F.gun, side * Wd * 0.2, 0, 0, wg); dish.rotation.y = side * Math.PI / 2;
    const lip = k.add(tor(rimR, 0.011, 5, 28), F.alloy, side * Wd * 0.42, 0, 0, wg); lip.rotation.y = Math.PI / 2;
    const spokeG = G('fSpoke', () => { const s = new THREE.Shape(); s.moveTo(-0.014, 0.06); s.lineTo(0.014, 0.06); s.lineTo(0.019, rimR * 0.96); s.lineTo(-0.019, rimR * 0.96);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 1 }); g.translate(0, 0, -0.02); return g; });
    for (let i = 0; i < 6; i++) for (const off of [-0.13, 0.13]) {
      const sp = new THREE.Mesh(spokeG, F.alloy); sp.rotation.order = 'YXZ'; sp.rotation.y = side * Math.PI / 2; sp.rotation.z = i / 6 * Math.PI * 2 + off;
      sp.position.x = side * Wd * 0.36; sp.castShadow = true; wg.add(sp);
    }
    const hub = k.add(cyl(0.075, 0.085, 0.05, 16), F.alloy, side * Wd * 0.38, 0, 0, wg); hub.rotation.z = Math.PI / 2;
    const cap = k.add(cyl(0.04, 0.04, 0.012, 16), F.black, side * Wd * 0.42, 0, 0, wg); cap.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const n = k.add(cyl(0.01, 0.01, 0.025, 6), F.chrome, side * Wd * 0.41, Math.sin(a) * 0.055, Math.cos(a) * 0.055, wg); n.rotation.z = Math.PI / 2; }
    const disc = k.add(cyl(rimR * 0.8, rimR * 0.8, 0.025, 20), M(0x8d9298), -side * 0.02, 0, 0, wg); disc.rotation.z = Math.PI / 2;
    k.g.add(wg); k.wheels.push(wg); return wg;
  }
  function fortuner(black) {
    const k = kit(), F = fortunerMats(black === true), p = F.paint, add = k.add;
    const W = 1.8, R = 0.3875, FW = 1.4, RW = -1.345, AR = 0.475, AY = 0.43, WX = 0.79;
    // ---- lower body: arches, sculpted nose with high flat hood, beltline rising to a kick at the C-pillar
    add(sideHQ('fLow', s => {
      s.moveTo(-2.26, 0.44); s.lineTo(RW - AR, 0.44); s.lineTo(RW - AR, AY); s.absarc(RW, AY, AR, Math.PI, 0, true);
      s.lineTo(RW + AR, 0.44); s.lineTo(FW - AR, 0.44); s.lineTo(FW - AR, AY); s.absarc(FW, AY, AR, Math.PI, 0, true);
      s.lineTo(FW + AR, 0.44); s.lineTo(2.2, 0.44);
      s.bezierCurveTo(2.31, 0.44, 2.37, 0.48, 2.385, 0.56);        // chin
      s.lineTo(2.4, 0.98);                                         // upright, slab-fronted face
      s.bezierCurveTo(2.4, 1.045, 2.37, 1.077, 2.28, 1.082);       // nose / hood leading edge
      s.lineTo(2.15, 1.085);
      s.bezierCurveTo(1.7, 1.11, 1.25, 1.15, 0.98, 1.165);         // high flat hood
      s.lineTo(-1.12, 1.235);                                      // rising beltline
      s.bezierCurveTo(-1.22, 1.24, -1.3, 1.33, -1.42, 1.355);      // the kick at the C-pillar
      s.lineTo(-2.12, 1.375);
      s.quadraticCurveTo(-2.33, 1.37, -2.35, 1.3);                 // tailgate shoulder
      s.lineTo(-2.36, 0.98); s.lineTo(-2.395, 0.95);               // tailgate / bumper step
      s.lineTo(-2.395, 0.56); s.quadraticCurveTo(-2.39, 0.45, -2.26, 0.44);
    }, W, 0.07), p);
    // ---- greenhouse (glass all round = floating roof), roof, rails
    add(sideHQ('fGlass', s => {
      s.moveTo(1.0, 1.12); s.lineTo(0.06, 1.735); s.lineTo(-2.02, 1.755); s.lineTo(-2.31, 1.33); s.lineTo(-2.31, 1.12);
    }, W - 0.17, 0.03), F.glass);
    add(sideHQ('fRoof', s => {
      s.moveTo(0.16, 1.71); s.quadraticCurveTo(0.05, 1.775, -0.12, 1.785); s.lineTo(-1.9, 1.795);
      s.quadraticCurveTo(-2.12, 1.79, -2.16, 1.73); s.lineTo(-2.0, 1.745); s.lineTo(0.06, 1.725);
    }, W - 0.13, 0.04), p);
    // roof spoiler with stop lamp
    add(sideHQ('fSpoil', s => { s.moveTo(-1.95, 1.78); s.lineTo(-2.2, 1.765); s.lineTo(-2.22, 1.72); s.lineTo(-2.02, 1.75); }, W - 0.2, 0.015), p);
    add(rbox(0.42, 0.022, 0.02, 0.008), F.redLens, 0, 1.735, -2.215);
    // cabin dark interior so the glass reads as a real cabin
    add(rbox(W - 0.3, 0.45, 2.45, 0.05), F.cabin, 0, 1.15, -0.95);
    for (const sx of [-1, 1]) for (const hz of [-0.2, -1.1]) add(rbox(0.22, 0.16, 0.08, 0.04), M(0x26272b), sx * 0.4, 1.55, hz);
    for (const sx of [-1, 1]) {
      const xs = sx * (W / 2 - 0.08);
      // piano-black A / B / C pillars over the glass
      const aP = add(rbox(0.02, 0.07, 1.12, 0.01), F.black, xs + sx * 0.012, 1.43, 0.53); aP.rotation.x = 0.585 * 1.0;
      add(rbox(0.02, 0.52, 0.1, 0.01), F.black, xs + sx * 0.012, 1.47, -0.04);
      const cP = add(rbox(0.02, 0.44, 0.1, 0.01), F.black, xs + sx * 0.012, 1.53, -1.2); cP.rotation.x = -0.12;
      // Fortuner DLO (not the Crysta's big rear quarter): the belt kicks up at the C pillar, and a broad body-colour
      // D pillar rakes forward so the quarter glass is a short trapezoid that narrows towards its top rear corner
      sidePanel(k, 'fDpil', [[-1.84, 1.34], [-1.98, 1.765], [-2.34, 1.765], [-2.34, 1.1], [-1.9, 1.2]], p, sx * ((W - 0.17) / 2 + 0.008), 0.02);
      add(rbox(0.02, 0.012, 0.75, 0.005), F.chrome, sx * ((W - 0.17) / 2 + 0.02), 1.355, -1.52).rotation.x = 0.02;
      // chrome window-line trim along the rising belt
      const bl = add(rbox(0.022, 0.018, 2.1, 0.006), F.chrome, sx * (W / 2 - 0.075), 1.205, -0.07); bl.rotation.x = 0.0333;
      add(rbox(0.022, 0.018, 0.72, 0.006), F.chrome, sx * (W / 2 - 0.075), 1.37, -1.78);
      // roof rails on three feet
      add(rbox(0.05, 0.035, 2.05, 0.015), F.silver, sx * 0.7, 1.817, -0.92);
      for (const z of [0.05, -0.92, -1.9]) add(rbox(0.06, 0.04, 0.12, 0.015), F.clad, sx * 0.7, 1.8, z);
      // flared arches: body-colour flare, black cladding lip, arch liner
      for (const wz of [FW, RW]) {
        const fl = add(tor(AR + 0.04, 0.05, 5, 22, Math.PI), F.clad, sx * (W / 2 + 0.0), AY, wz); fl.rotation.y = Math.PI / 2; fl.scale.z = 0.9;
        const pf = add(tor(AR + 0.12, 0.045, 5, 22, Math.PI * 0.8), p, sx * (W / 2 - 0.035), AY, wz); pf.rotation.y = Math.PI / 2; pf.rotation.x = Math.PI * 0.1; pf.scale.z = 0.7;
        if (sx > 0) { const ln = add(G('fLiner', () => new THREE.CylinderGeometry(AR - 0.01, AR - 0.01, W * 0.86, 14, 1, true, -Math.PI / 2, Math.PI)), plasticIn, 0, AY, wz); ln.rotation.z = Math.PI / 2; ln.rotation.x = Math.PI; ln.castShadow = false; }
      }
      // lower black cladding, side step with silver edge
      add(rbox(0.04, 0.13, FW - RW - 2 * AR - 0.12, 0.02), F.clad, sx * (W / 2 + 0.005), 0.5, (FW + RW) / 2);
      add(rbox(0.16, 0.045, FW - RW - 2 * AR - 0.2, 0.02), F.clad, sx * (W / 2 + 0.03), 0.39, (FW + RW) / 2);
      add(rbox(0.02, 0.03, FW - RW - 2 * AR - 0.2, 0.01), F.silver, sx * (W / 2 + 0.11), 0.395, (FW + RW) / 2);
      for (const z of [-0.6, 0.5]) add(rbox(0.12, 0.08, 0.06, 0.01), F.clad, sx * (W / 2 - 0.02), 0.36, z);
      // door shut lines, chrome handles
      for (const z of [0.97, -0.07, -1.16]) add(rbox(0.008, 0.66, 0.012, 0.003), M(0x55575b), sx * (W / 2 + 0.001), 0.89 + (z < -1 ? 0.04 : 0), z);
      for (const z of [0.3, -0.78]) add(rbox(0.03, 0.035, 0.16, 0.012), F.chrome, sx * (W / 2 + 0.01), 1.07 + (z < 0 ? 0.03 : 0), z);
      // body-side character line over the rear arch
      const cl = add(rbox(0.012, 0.012, 1.4, 0.005), p, sx * (W / 2 + 0.003), 0.86, -0.75); cl.rotation.x = -0.05;
      // mirrors: black base, body cap, amber repeater
      const mg = new THREE.Group(); mg.position.set(sx * (W / 2 + 0.02), 1.22, 0.86); k.g.add(mg);
      add(rbox(0.08, 0.06, 0.16, 0.02), F.clad, sx * 0.02, -0.02, 0, mg);
      add(rbox(0.22, 0.15, 0.1, 0.04), p, sx * 0.13, 0.04, -0.01, mg);
      add(rbox(0.12, 0.016, 0.02, 0.006), F.amber, sx * 0.17, 0.0, 0.04, mg);
      add(rbox(0.19, 0.12, 0.01, 0.03), F.glass, sx * 0.13, 0.04, -0.065, mg);
    }
    // under-body, hood bulge, cowl, washer jets
    add(rbox(W * 0.86, 0.14, 4.3, 0.04), F.clad, 0, 0.37, 0);
    add(rbox(W * 0.88, 0.03, 0.12, 0.012), F.clad, 0, 1.17, 0.96);
    // ---- front face: slim upper grille with chrome bar, big trapezoid lower grille with chrome surround
    const FZ = 2.4;
    add(facePoly('fUGrC', [[-0.48, 0.86], [0.48, 0.86], [0.5, 1.0], [-0.5, 1.0]], 0.05, 0.008), F.chrome, 0, 0, FZ - 0.025);
    add(G('fUGr', () => new THREE.ShapeGeometry(new THREE.Shape([[-0.45, 0.875], [0.45, 0.875], [0.47, 0.985], [-0.47, 0.985]].map(q => new THREE.Vector2(q[0], q[1]))))), F.mesh, 0, 0, FZ + 0.006);
    add(rbox(1.34, 0.03, 0.03, 0.01), F.chrome, 0, 0.93, FZ + 0.015);                  // thin chrome bar into the lamps
    add(facePoly('fLGrC', [[-0.38, 0.47], [0.38, 0.47], [0.52, 0.83], [-0.52, 0.83]], 0.06, 0.01), F.chrome, 0, 0, FZ - 0.02);
    add(G('fLGr', () => new THREE.ShapeGeometry(new THREE.Shape([[-0.355, 0.495], [0.355, 0.495], [0.485, 0.81], [-0.485, 0.81]].map(q => new THREE.Vector2(q[0], q[1]))))), F.mesh, 0, 0, FZ + 0.012);
    for (let i = 0; i < 3; i++) add(rbox(0.86 - i * 0.1, 0.012, 0.012, 0.004), F.black, 0, 0.73 - i * 0.09, FZ + 0.018);
    add(sph(0.06, 14, 8), F.chrome, 0, 0.93, FZ + 0.025).scale.set(1.25, 0.8, 0.3);           // generic oval badge
    // silver skid plate, black lower lip, plate
    add(facePoly('fSkid', [[-0.42, 0.4], [0.42, 0.4], [0.36, 0.47], [-0.36, 0.47]], 0.08, 0.008), F.silver, 0, 0, FZ - 0.05);
    add(rbox(1.5, 0.05, 0.1, 0.02), F.clad, 0, 0.43, FZ - 0.07);
    for (const sx of [-1, 1]) {
      // headlamp: slim swept piano-black housing, twin projectors (head lamps), LED DRL strip under them
      const hg = new THREE.Group(); hg.position.set(sx * 0.48, 0, FZ - 0.018); hg.rotation.y = sx * 0.06; k.g.add(hg);
      const hx = pts => pts.map(q => [sx * q[0], q[1]]);
      add(facePoly('fHL' + sx, hx([[0, 0.845], [0.28, 0.885], [0.39, 0.95], [0.4, 1.06], [0.28, 1.07], [0, 1.02]]), 0.05, 0.006), F.black, 0, 0, 0, hg);
      add(facePoly('fHLi' + sx, hx([[0.02, 0.9], [0.28, 0.925], [0.37, 0.975], [0.375, 1.04], [0.28, 1.05], [0.02, 1.005]]), 0.01), F.silver, 0, 0, 0.026, hg);
      for (const [px, py] of [[0.13, 0.965], [0.27, 0.99]]) {
        const l = k.lamp(0.085, 0.085, 0, 0, 0, true, true); hg.add(l); l.position.set(sx * px, py, 0.034); hg.add(l.lens); l.lens.position.set(sx * px, py, 0.042);
        add(tor(0.047, 0.008, 4, 14), F.black, sx * px, py, 0.033, hg);
      }
      // LED DRL: a crisp strip along the lower edge, turning up the outer end
      const drl = add(rbox(0.34, 0.018, 0.012, 0.005), F.drl, sx * 0.17, 0.882, 0.034, hg); drl.rotation.z = sx * 0.135;
      const drl2 = add(rbox(0.018, 0.1, 0.012, 0.005), F.drl, sx * 0.365, 0.975, 0.034, hg);
      add(rbox(0.06, 0.025, 0.01, 0.008), F.amber, sx * 0.33, 1.045, 0.032, hg);
      // fog-lamp pocket: black angular housing, round lamp, chrome accent
      add(facePoly('fFog' + sx, [[0, 0.5], [0.2, 0.5], [0.22, 0.62], [0.06, 0.72], [-0.02, 0.62]].map(q => [sx * q[0], q[1]]), 0.04, 0.005), F.black, sx * 0.6, 0, FZ - 0.015);
      const fog = add(G('fFogL', () => new THREE.CircleGeometry(0.05, 16)), F.drl, sx * 0.7, 0.58, FZ + 0.01);
      add(tor(0.055, 0.008, 4, 16), F.chrome, sx * 0.7, 0.58, FZ + 0.01);
      const ca = add(rbox(0.025, 0.2, 0.02, 0.008), F.chrome, sx * 0.565, 0.6, FZ + 0.012); ca.rotation.z = sx * 0.35;
      // ---- rear: wraparound LED tail lamps
      const t = k.lamp(0.3, 0.09, sx * 0.72, 1.2, -2.37, false); t.rotation.z = sx * 0.05; t.lens.rotation.copy(t.rotation);
      add(rbox(0.32, 0.12, 0.03, 0.02), F.black, sx * 0.72, 1.2, -2.35);
      const side = new THREE.Mesh(G('fTailSide', () => new THREE.PlaneGeometry(0.16, 0.08)), t.material);
      side.position.set(sx * (W / 2 - 0.005), 1.22, -2.27); side.rotation.y = sx * Math.PI / 2; k.g.add(side); k.tail.push(side);
      add(rbox(0.2, 0.025, 0.02, 0.01), F.redLens, sx * 0.62, 0.62, -2.405);                 // bumper reflectors
      add(rbox(0.03, 0.16, 0.12, 0.012), F.clad, sx * 0.82, 0.62, -2.37);
    }
    add(rbox(0.9, 0.035, 0.025, 0.012), F.chrome, 0, 1.2, -2.37);                           // tailgate chrome strip
    add(sph(0.05, 12, 8), F.chrome, 0, 1.12, -2.375).scale.set(1.25, 0.8, 0.3);
    add(rbox(1.62, 0.16, 0.08, 0.03), F.clad, 0, 0.5, -2.37);                                // rear lower bumper
    add(rbox(0.7, 0.04, 0.06, 0.015), F.silver, 0, 0.45, -2.4);
    const wip = add(rbox(0.5, 0.015, 0.015, 0.005), F.black, 0.05, 1.37, -2.33); wip.rotation.z = 0.25;
    plate(k, FZ + 0.03, 0.62, true); plate(k, -2.375, 0.98, false);
    const wl = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, 0.25, 1.2, 1.0); wl.rotation.x = -0.6;
    const wr = add(rbox(0.5, 0.012, 0.015, 0.005), F.black, -0.35, 1.2, 1.0); wr.rotation.x = -0.6;
    for (const [x, z] of [[-WX, FW], [WX, FW], [-WX, RW], [WX, RW]]) carWheel(k, F, R, 0.265, x, z, WHEELS.fortuner);
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.795, kind: 'car', type: 'fortuner', seat: [0.4, 0.92, -0.05, 'car'] };
  }

  // tractor rear tyre: plain lathe carcass + chevron lugs (instanced so the whole tyre is 2 draw calls)
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
    // trolley: drawbar, chassis, planked sideboards, load
    k.add(cyl(0.05, 0.05, 1.3, 6), grey, 0, 0.75, -1.7).rotation.x = Math.PI / 2;
    const tg = new THREE.Group(); tg.position.set(0, 0, -3.9); k.g.add(tg);
    const green = paint(0x2e7d32);
    k.add(rbox(2.1, 0.1, 3.2, 0.03), M(0x3a3a3a), 0, 0.88, 0, tg);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.add(rbox(0.05, 0.22, 3.2, 0.03), green, sx * 1.03, 1.05 + i * 0.25, 0, tg);
    for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) k.add(rbox(2.1, 0.22, 0.05, 0.03), green, 0, 1.05 + i * 0.25, sz * 1.58, tg);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) k.add(rbox(0.08, 0.8, 0.08, 0.02), M(0x3a3a3a), sx * 1.05, 1.3, sz * 1.55, tg);
    const load = k.add(sph(1, 12, 8), M(Math.random() < 0.5 ? 0xf2f0ea : 0xd4b26a), 0, 1.65, 0, tg); load.scale.set(1.0, 0.55, 1.55);
    k.wheel(0.5, 0.24, -1.0, 0.5, -3.9, { spokes: 3 }); k.wheel(0.5, 0.24, 1.0, 0.5, -3.9, { spokes: 3 });
    for (const sx of [-1, 1]) {
      const h = k.lamp(0.17, 0.17, sx * 0.2, 1.2, 1.97, true, true);
      k.lamp(0.18, 0.09, sx * 0.85, 0.95, -5.52);
    }
    plate(k, -5.52, 0.8, false);
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 6.8, kind: 'tractor' };
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
    ud.dims = { length: r2(_sz.z), width: r2(_sz.x), height: r2(_sz.y) };
    ud.center = { x: r2(_c.x), y: r2(_c.y), z: r2(_c.z) };
    ud.wheels = v.wheels.map(w => ({ mesh: w, radius: w.userData.radius || 0.4, front: !!w.userData.front }));
    ud.steer = steer;
    ud.fork = v.twoWheeler ? steer[0] || null : null;
    ud.type = v.type || v.kind;
    ud.twoWheeler = !!v.twoWheeler;
    if (v.seat) ud.seat = v.seat;
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
    mergeUnder(v.g, new Set([...(v.wheels || []), ...lamps, ...forks]));  // body: everything static
    for (const f of forks) mergeUnder(f, new Set([...(v.wheels || []), ...lamps]));   // bike fork/bars turn as one piece
    for (const w of v.wheels || []) mergeUnder(w, lamps);               // each wheel spins as one piece
    // seated people are small: no shadows from them (their joints stay intact for carjacking)
    v.g.children.forEach(c => { if (c.userData && c.userData.human) c.traverse(o => { if (o.isMesh) o.castShadow = false; }); });
    return v;
  }
  const baked = f => (...args) => { const v = f(...args); if (!v.type) v.type = f.name; return bake(v); };
  return { auto: baked(auto), bike: baked(bike), splendor: baked(splendor), scooter: baked(scooter), classic: baked(classic), classic2: baked(classic2),
    sport: baked(sport), faired: baked(faired), cycle: baked(cycle), mpv: baked(mpv), fortuner: baked(fortuner), fortunerBlack: baked(fortunerBlack),
    berlinetta: baked(berlinetta), muscle: baked(muscle), wedge: baked(wedge), coupe911: baked(coupe911), crysta: baked(crysta), SPORTS: ['berlinetta', 'muscle', 'wedge', 'coupe911'],
    swift: baked(swift), dzire: baked(dzire), alto: baked(alto), bolero: baked(bolero), scorpio: baked(scorpio), ace: baked(ace),
    TWO_WHEELERS: ['bike', 'splendor', 'scooter', 'classic', 'classic2', 'sport', 'faired', 'cycle'], hatch: baked(hatch), suv: baked(suv), tractor: baked(tractor), lorry: baked(lorry), bus: baked(bus), bullockCart: baked(bullockCart), bake, mergeUnder };
})();
