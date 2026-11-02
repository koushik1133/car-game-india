// Indian village traffic models, built procedurally (three.js r128): Bajaj-RE-style auto-rickshaw,
// Splendor-style motorbike with rider, Swift-style hatchback, Bolero-style SUV, 575-style tractor with
// trolley, 1109-style lorry, Palle-Velugu-style village bus and a bullock cart.
// Each builder returns { g, wheels: [Group], head: [Mesh], tail: [Mesh], len, kind }. Vehicles face +z, sit on y = 0.
// Wheels spin on local x. head/tail meshes share one per-vehicle material whose colour the game switches.
// Geometries are cached and shared between instances; materials are cached by colour.
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
    const g = new THREE.Group(), wheels = [], head = [], tail = [];
    const headM = new THREE.MeshBasicMaterial({ color: 0x777766 }), tailM = new THREE.MeshBasicMaterial({ color: 0x661111 });
    const add = (geom, m, x, y, z, parent) => { const o = new THREE.Mesh(geom, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || g).add(o); return o; };
    // wheel: lathe tyre + dished rim; a spoke bar keeps rotation visible on plain rims
    const wheel = (r, w, x, y, z, opts) => {
      opts = opts || {};
      const wg = new THREE.Group(); wg.position.set(x, y, z);
      add(tyreGeo(r, w, opts.low), rubber, 0, 0, 0, wg);
      const side = Math.sign(x) || 1;
      const rim = add(rimGeo(r * (opts.low ? 0.66 : 0.56), w * 0.9), opts.rim || rimMat, 0, 0, 0, wg); rim.scale.x = side;
      if (!opts.noSpoke) for (let i = 0; i < (opts.spokes || 4); i++) {
        const sp = add(G('spk', () => new THREE.BoxGeometry(0.02, 1, 0.05)), opts.rim || rimMat, side * w * 0.42, 0, 0, wg);
        sp.scale.y = r * (opts.low ? 1.2 : 1.0); sp.rotation.x = i * Math.PI / (opts.spokes || 4);
      }
      g.add(wg); wheels.push(wg); return wg;
    };
    // lamp: shaped lens (rounded rectangle or circle) facing +z (front) or -z (rear)
    const lamp = (w, h, x, y, z, front, round) => {
      const key = round ? ['lc', w].join() : ['lr', w, h].join();
      const geom = G(key, () => round ? new THREE.CircleGeometry(w / 2, 14) : new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); roundRect(s, w, h, Math.min(w, h) * 0.3); return s; })(), 4));
      const m = add(geom, front ? headM : tailM, x, y, z); if (!front) m.rotation.y = Math.PI;
      const lens = add(G(key + 'L', () => { const gg = geom.clone(); return gg; }), lensMat, x, y, z + (front ? 0.008 : -0.008)); lens.rotation.y = m.rotation.y; lens.castShadow = false;
      (front ? head : tail).push(m); m.castShadow = false; return m;
    };
    return { g, wheels, head, tail, add, wheel, lamp };
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
    for (const x of xs) {
      const st = k.add(cyl(0.012, 0.012, 0.18, 5), plastic, x, y, z); st.rotation.z = Math.sign(x) * 1.0;
      const hd = k.add(rbox(0.16, 0.1, 0.05, 0.03), m || plastic, x + Math.sign(x) * 0.09, y + 0.06, z); hd.rotation.y = -Math.sign(x) * 0.2;
    }
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

  // ---------------------------------------------------------------- motorbike (Splendor style)
  function bike() {
    const k = kit(), body = paint([0xb71c1c, 0x111111, 0x1565c0, 0x6d6d6d, 0x5b2a86][Math.random() * 5 | 0]), black = M(0x161616);
    k.wheel(0.3, 0.085, 0.001, 0.3, 0.64, { low: true, spokes: 9, rim: chrome }); k.wheel(0.3, 0.085, 0.001, 0.3, -0.64, { low: true, spokes: 9, rim: chrome });
    // fuel tank: rounded side profile with heavy bevel
    k.add(sideGeo('bikeTank', s => { s.moveTo(-0.12, 0.82); s.quadraticCurveTo(-0.05, 0.98, 0.2, 0.98); s.quadraticCurveTo(0.38, 0.96, 0.42, 0.86); s.lineTo(0.36, 0.76); s.quadraticCurveTo(0.1, 0.72, -0.12, 0.82); }, 0.26, 0.09, 10), body);
    // side panels under the seat
    k.add(sideGeo('bikePanel', s => { s.moveTo(-0.15, 0.82); s.lineTo(-0.55, 0.84); s.quadraticCurveTo(-0.62, 0.72, -0.5, 0.62); s.lineTo(-0.15, 0.62); }, 0.22, 0.04), body);
    // seat
    k.add(sideGeo('bikeSeat', s => { s.moveTo(-0.08, 0.86); s.quadraticCurveTo(-0.12, 0.93, -0.25, 0.92); s.lineTo(-0.72, 0.92); s.quadraticCurveTo(-0.8, 0.9, -0.76, 0.84); s.lineTo(-0.1, 0.82); }, 0.24, 0.05), black);
    // rear mudguard + tail
    const rmg = k.add(tor(0.34, 0.04, 3, 10, Math.PI * 0.6), body, 0, 0.3, -0.64); rmg.rotation.y = Math.PI / 2; rmg.rotation.z = Math.PI * 0.35; rmg.scale.z = 1.6;
    const fmg = k.add(tor(0.33, 0.035, 3, 10, Math.PI * 0.5), body, 0, 0.3, 0.64); fmg.rotation.y = Math.PI / 2; fmg.rotation.z = Math.PI * 0.2; fmg.scale.z = 1.5;
    // engine block and cylinder fins
    k.add(rbox(0.22, 0.26, 0.34, 0.06), M(0x7a7d80), 0, 0.5, 0.08);
    for (let i = 0; i < 4; i++) k.add(rbox(0.24, 0.02, 0.2, 0.01), M(0x8a8d90), 0, 0.62 + i * 0.035, 0.24).rotation.x = -0.6;
    // frame tubes, fork, handlebar, headlamp nacelle
    const down = k.add(cyl(0.022, 0.022, 0.62, 6), black, 0, 0.62, 0.34); down.rotation.x = 0.75;
    for (const sx of [-1, 1]) {
      const f = k.add(cyl(0.02, 0.02, 0.7, 6), chrome, sx * 0.07, 0.62, 0.55); f.rotation.x = -0.4;
      const sw = k.add(cyl(0.016, 0.016, 0.66, 5), black, sx * 0.09, 0.42, -0.35); sw.rotation.x = Math.PI / 2 + 0.25;   // swingarm
      const sh = k.add(cyl(0.022, 0.022, 0.4, 6), chrome, sx * 0.12, 0.62, -0.55); sh.rotation.x = -0.3;            // shock
    }
    const hb = k.add(cyl(0.012, 0.012, 0.66, 6), chrome, 0, 1.0, 0.43); hb.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) k.add(cyl(0.02, 0.02, 0.1, 6), black, sx * 0.3, 1.0, 0.43).rotation.z = Math.PI / 2;
    const nac = k.add(sph(0.11, 10, 8), body, 0, 0.92, 0.62); nac.scale.set(1, 0.9, 0.8);
    k.lamp(0.13, 0.13, 0, 0.92, 0.705, true, true);
    mirrors(k, [-0.22, 0.22], 1.08, 0.42, chrome);
    for (const sx of [-1, 1]) { k.add(sph(0.025, 5, 4), amberMat, sx * 0.12, 0.92, 0.66); k.add(sph(0.025, 5, 4), amberMat, sx * 0.12, 0.78, -0.86); }
    k.lamp(0.1, 0.06, 0, 0.8, -0.86);
    // chain guard and silencer
    k.add(sideGeo('bikeChain', s => { s.moveTo(0.08, 0.36); s.lineTo(-0.6, 0.33); s.quadraticCurveTo(-0.7, 0.36, -0.6, 0.4); s.lineTo(0.08, 0.44); }, 0.03, 0.01), black).position.x = -0.12;
    const sil = k.add(cyl(0.05, 0.04, 0.6, 8), chrome, 0.16, 0.38, -0.4); sil.rotation.x = Math.PI / 2 - 0.12;
    plate(k, -0.87, 0.6, false);
    // rider (helmet sometimes), maybe a pillion
    const r = person(k, 0, 0.9, -0.28, { outfit: 'shirt' }, 'bike');
    if (r && Math.random() < 0.4) { const hl = new THREE.Mesh(sph(0.13, 10, 8), paint(0x222222)); hl.position.set(0, 0.1, 0); hl.scale.set(0.92, 0.95, 1.05); r.parts.head.add(hl); }
    if (Math.random() < 0.4) person(k, 0, 0.94, -0.62, Math.random() < 0.5 ? { gender: 'f', outfit: 'saree' } : { outfit: 'shirt' }, 'bike');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 2.0, kind: 'bike' };
  }

  // shared car body builder: lower body with arches, cabin, window glass, bumpers
  function carShell(k, o, p) {
    k.add(sideGeo(o.key + 'Low', o.low, o.W, 0.05), p);
    k.add(sideGeo(o.key + 'Cab', o.cab, o.W - 0.14, 0.07), p);
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

  // ---------------------------------------------------------------- hatchback (Swift style, 3.85 x 1.70 x 1.53)
  function hatch() {
    const k = kit(), p = paint([0xffffff, 0xc0c4c8, 0xb71c1c, 0x1565c0, 0x5d4037, 0x263238, 0xe65100][Math.random() * 7 | 0]);
    const W = 1.7, A = 0.36, FW = 1.215, RW = -1.215, AY = 0.3;
    carShell(k, {
      key: 'hatch', W, arch: A, archY: AY, wheelsZ: [FW, RW], pillars: [-0.18], handles: [0.15, -0.65], handleY: 0.92, roofY: 1.42,
      low: s => {
        s.moveTo(-1.86, 0.27); s.lineTo(RW - A, 0.27); s.lineTo(RW - A, AY); s.absarc(RW, AY, A, Math.PI, 0, true); s.lineTo(FW - A, 0.27);
        s.lineTo(FW - A, AY); s.absarc(FW, AY, A, Math.PI, 0, true); s.lineTo(1.85, 0.27);
        s.quadraticCurveTo(1.94, 0.32, 1.93, 0.5); s.lineTo(1.9, 0.7); s.quadraticCurveTo(1.84, 0.84, 1.6, 0.86); s.lineTo(0.75, 0.98); s.lineTo(-1.78, 1.0);
        s.quadraticCurveTo(-1.9, 0.98, -1.91, 0.8); s.lineTo(-1.92, 0.42); s.quadraticCurveTo(-1.92, 0.28, -1.86, 0.27);
      },
      cab: s => { s.moveTo(0.78, 0.96); s.lineTo(0.05, 1.42); s.quadraticCurveTo(-0.6, 1.47, -1.5, 1.43); s.quadraticCurveTo(-1.74, 1.4, -1.82, 1.2); s.lineTo(-1.84, 0.98); },
      ws: s => { s.moveTo(0.74, 0.99); s.lineTo(0.08, 1.41); s.lineTo(0.03, 1.4); s.lineTo(0.68, 0.98); },
      rw: s => { s.moveTo(-1.55, 1.42); s.quadraticCurveTo(-1.72, 1.38, -1.83, 1.12); s.lineTo(-1.86, 1.12); s.quadraticCurveTo(-1.76, 1.42, -1.58, 1.44); },
      win: [[0.64, 1.03], [0.06, 1.39], [-1.42, 1.39], [-1.66, 1.08]],
    }, p);
    // bumpers, grille, black lower lip
    k.add(sideGeo('hatchBumpF', s => { s.moveTo(1.7, 0.27); s.lineTo(1.9, 0.28); s.quadraticCurveTo(1.97, 0.35, 1.96, 0.46); s.lineTo(1.7, 0.46); }, W - 0.04, 0.04), M(0x222222));
    k.add(sideGeo('hatchBumpR', s => { s.moveTo(-1.7, 0.3); s.lineTo(-1.92, 0.3); s.quadraticCurveTo(-1.97, 0.38, -1.95, 0.5); s.lineTo(-1.7, 0.5); }, W - 0.04, 0.04), M(0x222222));
    const gr = k.add(G('hatchGr', () => { const s = new THREE.Shape(); roundRect(s, 0.72, 0.18, 0.07); return new THREE.ShapeGeometry(s, 4); }), grilleMat, 0, 0.6, 1.935); gr.rotation.x = -0.15;
    k.add(sph(0.04, 8, 6), badgeMat, 0, 0.62, 1.945).scale.z = 0.3;
    for (const sx of [-1, 1]) {
      const h = k.lamp(0.36, 0.13, sx * 0.58, 0.76, 1.875, true); h.rotation.y = sx * 0.35; h.rotation.x = -0.4;
      const t = k.lamp(0.14, 0.26, sx * 0.72, 0.84, -1.905); t.rotation.y = Math.PI - sx * 0.3;
    }
    mirrors(k, [-0.84, 0.84], 1.0, 0.62, p);
    for (const [x, z] of [[-0.74, FW], [0.74, FW], [-0.74, RW], [0.74, RW]]) k.wheel(0.29, 0.19, x, 0.29, z, { low: true, spokes: 2 });
    plate(k, 1.965, 0.38, true); plate(k, -1.96, 0.6, false);
    k.add(rbox(1.4, 0.08, 1.6, 0.03), M(0x2a2a2a), 0, 0.5, -0.3);          // floor / seats base visible through glass
    person(k, 0.36, 0.62, -0.25, { outfit: 'shirt' }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 3.8, kind: 'car' };
  }

  // ---------------------------------------------------------------- SUV (Bolero style, 3.99 x 1.75 x 1.88)
  function suv() {
    const k = kit(), p = paint([0xf5f5f5, 0x111111, 0x8d8d8d, 0x7b1f1f, 0xd9d4c5][Math.random() * 5 | 0]);
    const W = 1.75, A = 0.44, FW = 1.34, RW = -1.34, AY = 0.38;
    carShell(k, {
      key: 'suv', W, arch: A, archY: AY, wheelsZ: [FW, RW], pillars: [0.0, -1.0], handles: [0.3, -0.55], handleY: 1.12, roofY: 1.82,
      low: s => {
        s.moveTo(-1.98, 0.38); s.lineTo(RW - A, 0.38); s.absarc(RW, AY, A, Math.PI, 0, true); s.lineTo(FW - A, 0.38);
        s.absarc(FW, AY, A, Math.PI, 0, true); s.lineTo(1.98, 0.38); s.lineTo(2.0, 0.55); s.lineTo(1.99, 1.05); s.quadraticCurveTo(1.98, 1.12, 1.9, 1.13);
        s.lineTo(0.85, 1.16); s.lineTo(-1.95, 1.17); s.lineTo(-1.99, 1.1); s.lineTo(-1.99, 0.42);
      },
      cab: s => { s.moveTo(0.86, 1.14); s.lineTo(0.62, 1.82); s.lineTo(-1.92, 1.84); s.lineTo(-1.95, 1.15); },
      ws: s => { s.moveTo(0.85, 1.19); s.lineTo(0.645, 1.78); s.lineTo(0.6, 1.78); s.lineTo(0.8, 1.19); },
      rw: s => { s.moveTo(-1.95, 1.28); s.lineTo(-1.95, 1.74); s.lineTo(-1.97, 1.74); s.lineTo(-1.97, 1.28); },
      win: [[0.72, 1.22], [0.56, 1.74], [-1.85, 1.74], [-1.85, 1.22]],
    }, p);
    // black cladding, bumpers, upright grille with chrome slats, roof rails, spare wheel
    for (const sx of [-1, 1]) {
      k.add(rbox(0.03, 0.14, 1.9, 0.02), plastic, sx * (W / 2 + 0.01), 0.52, 0);
      const fl = k.add(tor(A + 0.03, 0.04, 4, 12, Math.PI), plastic, sx * (W / 2 - 0.01), AY, FW); fl.rotation.y = Math.PI / 2; fl.scale.z = 1.5;
      const fr = k.add(tor(A + 0.03, 0.04, 4, 12, Math.PI), plastic, sx * (W / 2 - 0.01), AY, RW); fr.rotation.y = Math.PI / 2; fr.scale.z = 1.5;
      k.add(cyl(0.02, 0.02, 2.3, 5), M(0x2a2a2a), sx * 0.7, 1.9, -0.6).rotation.x = Math.PI / 2;
      for (const z of [0.4, -0.6, -1.6]) k.add(cyl(0.02, 0.02, 0.07, 5), M(0x2a2a2a), sx * 0.7, 1.87, z);
      const step = k.add(rbox(0.12, 0.04, 1.3, 0.02), plastic, sx * (W / 2 + 0.05), 0.42, 0);
    }
    k.add(rbox(1.84, 0.2, 0.18, 0.06), M(0x2a2a2a), 0, 0.5, 2.02);
    k.add(rbox(1.84, 0.2, 0.18, 0.06), M(0x2a2a2a), 0, 0.5, -2.02);
    const gr = k.add(G('suvGr', () => { const s = new THREE.Shape(); roundRect(s, 0.85, 0.36, 0.06); return new THREE.ShapeGeometry(s, 3); }), grilleMat, 0, 0.88, 2.005);
    for (let i = 0; i < 5; i++) k.add(rbox(0.06, 0.32, 0.02, 0.01), chrome, -0.3 + i * 0.15, 0.88, 2.015);
    for (const sx of [-1, 1]) {
      const bez = k.add(rbox(0.32, 0.26, 0.04, 0.06), chrome, sx * 0.62, 0.92, 2.0);
      k.lamp(0.28, 0.2, sx * 0.62, 0.92, 2.025, true);
      k.add(rbox(0.12, 0.05, 0.02, 0.02), amberMat, sx * 0.62, 0.75, 2.0);
      k.lamp(0.12, 0.34, sx * 0.8, 1.05, -2.0);
    }
    const sp = new THREE.Group(); sp.position.set(0, 1.0, -2.12); k.g.add(sp);
    k.add(tyreGeo(0.36, 0.22, false), rubber, 0, 0, 0, sp).rotation.y = Math.PI / 2;
    k.add(cyl(0.38, 0.38, 0.06, 14), M(0x222222), 0, 0, -0.08, sp).rotation.x = Math.PI / 2;
    mirrors(k, [-0.92, 0.92], 1.2, 0.72);
    for (const [x, z] of [[-0.78, FW], [0.78, FW], [-0.78, RW], [0.78, RW]]) k.wheel(0.36, 0.23, x, 0.36, z, { spokes: 2 });
    plate(k, 2.115, 0.62, true); plate(k, -1.995, 0.68, false);
    k.add(rbox(1.5, 0.08, 2.4, 0.03), M(0x2a2a2a), 0, 0.72, -0.5);
    person(k, 0.38, 0.86, -0.2, { outfit: Math.random() < 0.6 ? 'shirt' : 'lungi', color: 0xffffff }, 'car');
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.1, kind: 'car' };
  }

  // tractor rear tyre: plain lathe carcass + chevron lugs (instanced so the whole tyre is 2 draw calls)
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
    const wg = new THREE.Group(); wg.position.set(x, y, z); k.g.add(wg); k.wheels.push(wg);
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
    return { g: k.g, wheels: k.wheels, head: k.head, tail: k.tail, len: 4.5, kind: 'cart' };
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
  function bake(v) {
    const lamps = new Set([...(v.head || []), ...(v.tail || [])]);
    mergeUnder(v.g, new Set([...(v.wheels || []), ...lamps]));          // body: everything static
    for (const w of v.wheels || []) mergeUnder(w, lamps);               // each wheel spins as one piece
    // seated people are small: no shadows from them (their joints stay intact for carjacking)
    v.g.children.forEach(c => { if (c.userData && c.userData.human) c.traverse(o => { if (o.isMesh) o.castShadow = false; }); });
    return v;
  }
  const baked = f => (...args) => bake(f(...args));
  return { auto: baked(auto), bike: baked(bike), hatch: baked(hatch), suv: baked(suv), tractor: baked(tractor), lorry: baked(lorry), bus: baked(bus), bullockCart: baked(bullockCart), bake };
})();
