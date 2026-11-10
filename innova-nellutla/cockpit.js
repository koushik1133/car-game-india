// cockpit.js: the first-person driving view (V) for every vehicle, and the mirrors.
// - Vehicles without a modelled cabin get a light procedural one, sized from their bounding box and seat: car,
//   truck/bus, auto, tractor or two-wheeler (bars, tank, clocks). Their closed exterior shell is hidden while seated,
//   because the eye would otherwise sit inside it. The Crysta keeps its own cabin and just gains hands and mirrors.
// - Cabin and camera ride the sprung body (crysta.js VehicleSuspension), plus a head spring driven by the body's
//   vertical acceleration and a surface rumble, so bumps show against the cabin as well as the horizon.
// - Mirrors: one atlas target with a true planar reflection per mirror, one region per pass, reduced scene, short far
//   plane, no shadow update and only while something displays it.
// - N toggles a rear-view strip in the chase views (a one-quad blit of the same target).
// Nothing is built until first used; the group is cached on the vehicle. Exposes window.Cockpit.
window.Cockpit = (function () {
  'use strict';
  const STD = { dash: 0x3e4148, soft: 0x55585f, lining: 0xcfc6b8, seat: 0x565a63, metal: 0xaab2bc, black: 0x24262b, skin: 0x8d5a3b, sleeve: 0x2f4858 };
  let M = null;
  const mats = () => M || (M = Object.fromEntries(Object.entries(STD).map(([k, c]) => [k, new THREE.MeshLambertMaterial({ color: c, emissive: k === 'skin' ? 0x241509 : 0x17140f })])));
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function beam(ax, ay, az, bx, by, bz, r, m) {           // a tube between two points
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const L = _a.distanceTo(_b), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 7), m);
    o.position.copy(_a).add(_b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
    return o;
  }
  // ---------------------------------------------------------------- mirror atlas
  // One target split into three regions: C inside mirror (or the chase-view strip), L and R the door mirrors. Each is a
  // true planar reflection: the camera is the eye reflected in the mirror plane, looking through the mirror rectangle
  // (off-axis frustum, near plane on the glass). k widens a mirror's view about its centre, like convex glass.
  // [w, h, frames between passes, far]. Only one region is drawn per pass, so the cost is one reduced scene.
  const QS = { low: [360, 212, 4, 90], medium: [512, 300, 3, 115] }, QHI = [720, 424, 2, 140];   // a mirror is a few centimetres of glass: past ~140 m nothing in it is a pixel tall
  const qual = () => QS[(window.Quality && Quality.tier) || 'high'] || QHI;
  const SLOT = { C: [0, 0.5, 1, 0.5], L: [0, 0, 0.495, 0.5], R: [0.505, 0, 0.495, 0.5] };
  let rt = null, rtRead = false, mirrorCam = null, turn = 0;
  const mirrorMats = [];
  function target() {
    if (rt) return rt;
    const q = qual(), C = THREE.WebGLMultisampleRenderTarget && q === QHI ? THREE.WebGLMultisampleRenderTarget : THREE.WebGLRenderTarget;
    rt = new C(q[0], q[1], { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
    if (rt.isWebGLMultisampleRenderTarget) rt.samples = 4;
    rt.scissorTest = true;
    mirrorCam = new THREE.PerspectiveCamera(48, 3.2, 1, q[3]);
    return rt;
  }
  // a mirror face showing an atlas region. The face's local +x is the reflected camera's -x, so u runs backwards
  function mirrorFace(w, h, slot) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, S = SLOT[slot];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, S[0] + (1 - uv.getX(i)) * S[2], S[1] + uv.getY(i) * S[3]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: target().texture, toneMapped: false }));
    m.userData.mirror = true; mirrorMats.push(m); return m;
  }
  // aim: the direction the glass sends the eye's ray, as a real driver sets a mirror (x outward a little on the doors)
  function mirror(S, group, slot, x, y, z, w, h, eye, m, stalk, k, clear) {
    const G = new THREE.Group(); G.position.set(x, y, z);
    G.add(box(w + 0.03, h + 0.03, 0.05, m.black, 0, 0, -0.03));
    G.add(mirrorFace(w, h, slot));
    const e = new THREE.Vector3(eye.x - x, eye.y - y, eye.z - z).normalize(), out = slot === 'C' ? 0 : (slot === 'L' ? 0.09 : -0.09);
    const a = new THREE.Vector3(out, slot === 'C' ? 0 : -0.015, -1).normalize();
    G.lookAt(e.add(a).normalize().add(G.position));   // group space == cockpit space == the body's local space
    group.add(G);
    if (stalk) group.add(beam(stalk[0], stalk[1], stalk[2], x, y, z, 0.008, m.metal));
    (S.mirrors || (S.mirrors = [])).push({ G, slot, w, h, k: k || (slot === 'C' ? 1.5 : 2.5), clear: clear || 0.05 });
    return G;
  }
  // dial face; the needle is a separate mesh turned about its hub
  // max: the scale's end value, red: where the red zone starts (same units), step: label every step
  const dialTexC = {};
  function dialTex(max, red, step) {
    const key = [max, red, step].join();
    if (dialTexC[key]) return dialTexC[key];
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), A0 = Math.PI * 0.75, SW = Math.PI * 1.5, at = v => A0 + v / max * SW;
    g.fillStyle = '#07090d'; g.beginPath(); g.arc(128, 128, 127, 0, 7); g.fill(); g.strokeStyle = '#dbe4ee'; g.fillStyle = '#eef2f6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 26px sans-serif';
    g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 112, A0, A0 + SW); g.stroke();
    if (red) { g.strokeStyle = '#e8362a'; g.lineWidth = 11; g.beginPath(); g.arc(128, 128, 106, at(red), A0 + SW); g.stroke(); g.strokeStyle = '#dbe4ee'; }
    for (let v = 0, i = 0; v <= max + 1e-6; v += step / 2, i++) {
      const a2 = at(v), big = i % 2 === 0; g.lineWidth = big ? 5 : 2; g.beginPath(); g.moveTo(128 + Math.cos(a2) * 112, 128 + Math.sin(a2) * 112); g.lineTo(128 + Math.cos(a2) * (big ? 92 : 100), 128 + Math.sin(a2) * (big ? 92 : 100)); g.stroke();
      if (big) g.fillText(String(max <= 12 ? v : Math.round(v)), 128 + Math.cos(a2) * 72, 128 + Math.sin(a2) * 72);
    }
    return dialTexC[key] = new THREE.CanvasTexture(c);
  }
  // fuel gauge: E at the left, F at the right
  let fuelTexC = null;
  function fuelTex() {
    if (fuelTexC) return fuelTexC;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#07090d'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill(); g.strokeStyle = '#dbe4ee'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 52, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.fillStyle = '#ff5a48'; g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.fillText('E', 20, 58); g.fillStyle = '#eef2f6'; g.fillText('F', 108, 58);
    return fuelTexC = new THREE.CanvasTexture(c);
  }
  function dial(group, x, y, z, r, tilt, tex) {
    const G = new THREE.Group(); G.position.set(x, y, z); G.rotation.set(tilt || 0, Math.PI, 0);
    G.add(new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ map: tex || dialTex(200, 0, 20) })));
    const n = new THREE.Mesh(new THREE.BoxGeometry(r * 0.09, r * 0.8, 0.003), new THREE.MeshBasicMaterial({ color: 0xff4a2e })); n.geometry.translate(0, r * 0.38, 0); n.position.z = 0.004;
    G.add(n); group.add(G); return n;
  }
  // forearm + hand reaching the grip at (x,y,z) of `parent` from an elbow given in the same space
  function arm(parent, x, y, z, ex, ey, ez, m) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), m.skin); hand.scale.set(1, 1.15, 0.8); hand.position.set(x, y, z); parent.add(hand);
    for (let i = -1.5; i <= 1.5; i++) { const fi = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 6, 5), m.skin); fi.position.set(x + i * 0.019, y + 0.012, z - 0.03); parent.add(fi); }
    parent.add(beam(x, y, z, ex, ey, ez, 0.034, m.skin));
    parent.add(beam(x + (ex - x) * 0.5, y + (ey - y) * 0.5, z + (ez - z) * 0.5, ex, ey, ez, 0.043, m.sleeve));
  }
  function wheelRim(R, m) {
    const G = new THREE.Group();
    G.add(new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.1, 8, 32), m.black));
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.32, R * 0.36, 0.05, 16), m.soft); boss.rotation.x = Math.PI / 2; G.add(boss);
    for (const a of [Math.PI, 0, -Math.PI / 2]) { const s = box(R * 0.8, 0.032, 0.02, m.soft, Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0); s.rotation.z = a; G.add(s); }
    return G;
  }
  // the most used saturated body colour: tints the cabin's bonnet, pillars and tank
  function paintOf(v) {
    const seen = new Map(); let best = 0x8a8f96, n = 0;
    v.g.traverse(o => {
      const c = o.isMesh && o.material && o.material.color; if (!c || o.material.map) return;
      const hsl = {}; c.getHSL(hsl); if (hsl.s < 0.12 && hsl.l < 0.25) return;
      const p = o.geometry.attributes.position, k = c.getHex(), w = (seen.get(k) || 0) + (p ? p.count : 1); seen.set(k, w); if (w > n) { n = w; best = k; }
    });
    return best;
  }
  // interior class per model: dash layout, trim colours, instrument type
  const CLS = {};
  [['budget', 'alto hatch wagonR swift dzire innova mpv'], ['modern', 'swiftNew hector scorpioN tharRoxx crysta'], ['utility', 'bolero sumo scorpio safari thar suv ace'], ['luxury', 'fortuner fortunerBlack landCruiser defender gclass'], ['sports', 'berlinetta muscle wedge coupe911'],
    ['commuter', 'bike splendor starCity cycle'], ['scoot', 'scooter activa'], ['cruiser', 'classic classic2'], ['super', 'sport faired hayabusa s1000rr'], ['adv', 'r1250gsa r1300gsa']].forEach(([c, l]) => l.split(' ').forEach(k => { CLS[k] = c; }));
  const typeKey = v => (v.g && v.g.userData && v.g.userData.type) || v._ty || v.model;
  const classOf = v => CLS[typeKey(v)] || 'budget';
  const TRIM = { budget: { dash: 0x45474b, soft: 0x5d5f63, seat: 0x6d6a66, accent: 0xa4a8ae }, utility: { dash: 0x2e2f31, soft: 0x3f4043, seat: 0x7a6a55, accent: 0x77797c }, modern: { dash: 0x202226, soft: 0xbab4a8, seat: 0x2f3136, accent: 0x4fb7ff },
    luxury: { dash: 0x3a2a20, soft: 0x241d19, seat: 0xa77b50, accent: 0x6b3f1f }, sports: { dash: 0x151618, soft: 0x24262a, seat: 0x121214, accent: 0xd8232a } };
  const palCache = {};
  function palette(cls, m) { const T = TRIM[cls] || TRIM.budget; return palCache[cls] || (palCache[cls] = Object.assign({}, m, Object.fromEntries(Object.entries(T).map(([k, c]) => [k, new THREE.MeshLambertMaterial({ color: c, emissive: 0x100e0b })])))); }
  function seatAt(G, m, x, y, z, w, bucket) {
    G.add(box(w, 0.13, 0.5, m.seat, x, y, z));                                     // cushion
    const B = box(w * 0.92, 0.62, 0.11, m.seat, x, y + 0.34, z - 0.27); B.rotation.x = -0.14; G.add(B);
    G.add(box(w * 0.46, 0.17, 0.09, m.seat, x, y + 0.74, z - 0.33));               // head restraint
    if (bucket) [-1, 1].forEach(s => { G.add(box(0.07, 0.18, 0.46, m.accent, x + s * w * 0.52, y + 0.06, z)); G.add(box(0.07, 0.5, 0.1, m.accent, x + s * w * 0.5, y + 0.34, z - 0.26)); });
  }
  function doorCard(G, m, sx, W, y, z0, z1) {
    const L = z1 - z0, z = (z0 + z1) / 2;
    G.add(box(0.03, 0.18, L * 0.9, m.soft, sx * (W - 0.03), y - 0.1, z));          // upper trim
    G.add(box(0.07, 0.04, L * 0.5, m.seat, sx * (W - 0.05), y - 0.24, z));         // armrest
    G.add(box(0.02, 0.05, 0.12, m.accent, sx * (W - 0.05), y - 0.1, z1 - L * 0.2)); // door pull
    G.add(box(0.02, 0.13, 0.2, m.black, sx * (W - 0.04), y - 0.44, z1 - L * 0.3)); // speaker grille
  }
  // a small canvas display, redrawn a few times a second from the live gauges
  function lcd(G, S, w, h, x, y, z, tilt) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 160;
    const t = new THREE.CanvasTexture(c), o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); o.position.set(x, y, z); o.rotation.set(tilt || 0, Math.PI, 0); G.add(o);
    S.lcd = { g: c.getContext('2d'), t, c, T: 0, accent: S.cls === 'sports' ? '#ff4136' : S.cls === 'luxury' ? '#ffcf80' : '#58c8ff' };
  }
  function drawLcd(L, sp, rpmN, gear, fuel, odo) {
    const g = L.g; g.fillStyle = '#04070b'; g.fillRect(0, 0, 320, 160);
    g.fillStyle = '#20262e'; g.fillRect(14, 14, 292, 22); g.fillStyle = rpmN > 0.9 ? '#ff3b30' : L.accent; g.fillRect(14, 14, 292 * Math.min(1, rpmN), 22);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 74px sans-serif'; g.fillText(String(Math.round(sp)), 120, 112); g.font = '20px sans-serif'; g.fillText('km/h', 120, 140);
    g.font = 'bold 52px sans-serif'; g.fillStyle = L.accent; g.fillText(gear, 262, 96);
    g.fillStyle = '#20262e'; g.fillRect(222, 122, 84, 12); g.fillStyle = fuel < 0.12 ? '#ff3b30' : '#8df08d'; g.fillRect(222, 122, 84 * fuel, 12);
    g.fillStyle = '#9aa6b4'; g.font = '15px sans-serif'; g.fillText('FUEL', 262, 150); g.textAlign = 'left'; g.fillText(odo.toFixed(1) + ' km', 14, 152);
    L.t.needsUpdate = true;
  }
  function scales(S, v) {
    const pt = window.VehicleDynamics && VehicleDynamics.ptSpec(typeKey(v)), top = (v.p && v.p.top) || 120, big = top > 160;
    S.spMax = Math.ceil(top * 1.12 / (big ? 40 : 20)) * (big ? 40 : 20); S.spStep = big ? 40 : 20;
    S.revK = pt ? Math.ceil(pt.red * 1.12 / 1000) : 8; S.redK = pt ? pt.red / 1000 : 0;
  }
  function kindOf(v) {
    const m = v.model, seat = Player.SEATS[m];
    if (m === 'bullockCart' || m === 'cart') return null;
    if (m === 'bike' || (seat && seat[3] === 'bike') || (v.p && v.p.lean)) return 'bike';
    if (m === 'auto') return 'auto'; if (m === 'tractor') return 'tractor'; if (m === 'lorry' || m === 'bus') return 'truck';
    return 'car';
  }
  // ---------------------------------------------------------------- procedural cabins
  function buildBike(G, S, m, paint) {
    const E = S.eye, bars = new THREE.Group(); bars.position.set(0, E.y - 0.5, E.z + 0.52); G.add(bars); S.steerObj = bars; S.steerK = v => v * 1.1; S.steerAxis = 'y';
    bars.add(beam(-0.34, 0.04, 0, 0.34, 0.04, 0, 0.012, m.metal));
    [-1, 1].forEach(s => {
      bars.add(beam(s * 0.25, 0.04, 0, s * 0.35, 0.04, 0, 0.018, m.black));
      arm(bars, s * 0.29, 0.06, 0, s * 0.33, 0.28, -0.42, m);
      bars.add(beam(s * 0.09, -0.32, 0.06, s * 0.09, 0.03, 0, 0.02, m.metal));      // fork legs
    });
    if (!S.noMirrors) { const bEye = { x: 0, y: 0.5, z: -0.52 }; mirror(S, bars, 'R', -0.3, 0.3, 0.02, 0.13, 0.09, bEye, m, [-0.26, 0.04, 0], 3); mirror(S, bars, 'L', 0.3, 0.3, 0.02, 0.13, 0.09, bEye, m, [0.26, 0.04, 0], 3); }
    if (!S.noMirrors) {
      const c = S.cls, spT = dialTex(S.spMax, 0, S.spStep), rvT = dialTex(S.revK, S.redK, S.revK > 10 ? 2 : 1);
      if (c === 'super' || c === 'adv' || c === 'scoot') { bars.add(box(0.2, 0.12, 0.05, m.black, 0, 0.11, 0.09)); lcd(bars, S, 0.17, 0.09, 0, 0.115, 0.06, -0.3); if (c === 'adv') { const sc = box(0.34, 0.3, 0.008, new THREE.MeshLambertMaterial({ color: 0xa8c4d4, transparent: true, opacity: 0.22 }), 0, 0.32, 0.14); sc.rotation.x = -0.4; bars.add(sc); } }
      else if (c === 'cruiser') { const b0 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 20), m.metal); b0.rotation.x = 1.3; b0.position.set(0, 0.11, 0.08); bars.add(b0); S.speedo = dial(bars, 0, 0.115, 0.05, 0.065, -0.25, spT); S.fuelN = dial(bars, 0.1, 0.11, 0.05, 0.03, -0.25, fuelTex()); }
      else { bars.add(box(0.26, 0.11, 0.06, m.black, 0, 0.1, 0.09)); S.speedo = dial(bars, -0.06, 0.11, 0.055, 0.046, -0.25, spT); S.tacho = dial(bars, 0.05, 0.11, 0.055, 0.04, -0.25, rvT); S.fuelN = dial(bars, 0.105, 0.11, 0.055, 0.02, -0.25, fuelTex()); }
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshLambertMaterial({ color: paint })); nose.scale.set(1, 0.8, 1.1); nose.position.set(0, -0.08, 0.17); bars.add(nose);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshLambertMaterial({ color: paint })); tank.scale.set(0.95, 0.72, 1.8); tank.position.set(0, E.y - 0.72, E.z + 0.2); G.add(tank);
  }
  function buildCabin(G, S, m0, paint, kind) {
    const cls = S.cls, m = palette(kind === 'car' ? cls : 'utility', m0);
    const E = S.eye, B = S.bx, P = new THREE.MeshLambertMaterial({ color: paint, side: THREE.DoubleSide }), truck = kind === 'truck', open = kind === 'tractor', auto = kind === 'auto';
    const W = Math.max(0.55, Math.min(B.max.x, -B.min.x) * 0.95), rearZ = B.min.z + 0.15, beltY = E.y - 0.36, roofY = truck ? E.y + 0.55 : Math.max(E.y + 0.27, B.max.y - 0.03);
    const dashZ = E.z + (truck ? 0.78 : auto ? 0.62 : 0.72), dashY = E.y - (truck ? 0.5 : auto ? 0.6 : 0.34), mid = (dashZ + 0.25 + rearZ) / 2;
    const dashW = W * 2 - 0.04;
    if (!open) {
      G.add(crystaRoundedBox(dashW, 0.3, 0.55, 0.06, m.dash).translateX(0).translateY(dashY - 0.15).translateZ(dashZ + 0.2));
      G.add(box(dashW - 0.1, 0.012, 0.012, m.metal, 0, dashY - 0.14, dashZ - 0.075));            // trim line
      [-W * 0.62, -0.13, 0.13, W * 0.62].forEach(x => G.add(box(0.13, 0.06, 0.012, m.black, x, dashY - 0.075, dashZ - 0.079)));   // vents
      G.add(box(0.26, 0.16, 0.015, m.black, 0, dashY - 0.23, dashZ - 0.08));                      // centre stack
      const scr = window.SparkPlay ? SparkPlay.mat : new THREE.MeshBasicMaterial({ color: 0x173a55 }); S.hasScreen = kind === 'car'; S.compactScreen = kind === 'car' && !(cls === 'modern' || cls === 'luxury');
      if (kind === 'car' && cls === 'budget') { G.add(box(0.2, 0.11, 0.02, m.black, 0, dashY + 0.06, dashZ - 0.05)); G.add(box(0.18, 0.09, 0.005, scr, 0, dashY + 0.06, dashZ - 0.063)); [-0.07, 0, 0.07].forEach(x => { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), m.metal); k.rotation.x = Math.PI / 2; k.position.set(x, dashY - 0.26, dashZ - 0.095); G.add(k); }); }
      else if (kind === 'car' && cls === 'utility') { G.add(box(0.18, 0.1, 0.02, m.black, 0, dashY + 0.055, dashZ - 0.05)); G.add(box(0.16, 0.08, 0.005, scr, 0, dashY + 0.055, dashZ - 0.063)); G.add(beam(W * 0.35, dashY - 0.03, dashZ - 0.1, W * 0.8, dashY - 0.03, dashZ - 0.1, 0.012, m.accent)); }   // passenger grab bar
      else if (kind === 'car' && cls === 'modern') { const t = box(0.3, 0.17, 0.02, m.black, 0, dashY + 0.09, dashZ - 0.06); t.rotation.x = -0.15; G.add(t); G.add(box(0.27, 0.14, 0.004, scr, 0, dashY + 0.09, dashZ - 0.073)); G.add(box(dashW - 0.2, 0.008, 0.006, new THREE.MeshBasicMaterial({ color: 0x4fb7ff }), 0, dashY - 0.14, dashZ - 0.085)); }   // floating screen, ambient strip
      else if (kind === 'car' && cls === 'luxury') { G.add(box(dashW - 0.14, 0.05, 0.012, m.accent, 0, dashY - 0.12, dashZ - 0.086)); G.add(box(0.32, 0.16, 0.012, scr, 0, dashY - 0.0, dashZ - 0.09)); }   // wood band, big screen
      else if (kind === 'car' && cls === 'sports') { G.add(box(0.22, 0.12, 0.02, m.black, 0, dashY + 0.065, dashZ - 0.05)); G.add(box(0.2, 0.1, 0.005, scr, 0, dashY + 0.065, dashZ - 0.063)); G.add(box(dashW - 0.2, 0.01, 0.008, m.accent, 0, dashY - 0.03, dashZ - 0.082)); }
      else if (truck) { G.add(box(0.5, 0.42, 0.8, m.soft, 0, Math.max(0.3, E.y - 0.95), dashZ - 0.5)); }   // engine hump
      // floor, seats, door cards
      G.add(box(dashW, 0.03, dashZ - rearZ, m.dash, 0, Math.max(0.2, E.y - 1.05), (dashZ + rearZ) / 2));
      const sy = E.y - 0.68, bucket = cls === 'sports' && kind === 'car';
      seatAt(G, m, E.x, sy, E.z, 0.46, bucket);
      if (!auto) seatAt(G, m, -E.x, sy, E.z, 0.46, bucket);
      if (kind === 'car' && !bucket) G.add(box(0.2, 0.2, 0.7, m.soft, 0, sy - 0.04, E.z + 0.05));   // centre console
      if (kind === 'car' || truck) { const lever = beam(0, sy + 0.06, E.z + 0.12, 0.02, sy + 0.26, E.z + 0.05, 0.009, m.metal); G.add(lever); const kn = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), m.black); kn.position.set(0.02, sy + 0.27, E.z + 0.05); G.add(kn); }
      if (kind === 'car' && rearZ < E.z - 1) { for (const x of [-E.x, 0, E.x]) G.add(box(0.44, 0.13, 0.46, m.seat, x, sy, E.z - 0.95)); G.add(box(dashW - 0.12, 0.6, 0.11, m.seat, 0, sy + 0.34, E.z - 1.2)); }
      if (kind === 'truck' && B.max.z - B.min.z > 8) for (let z = E.z - 1.2; z > rearZ + 0.5; z -= 0.85) for (const x of [-W * 0.6, W * 0.6]) { G.add(box(0.8, 0.12, 0.42, m.seat, x, sy, z)); G.add(box(0.8, 0.55, 0.09, m.seat, x, sy + 0.32, z - 0.24)); }
      if (!auto) [-1, 1].forEach(s => G.add(box(0.05, beltY - E.y + 0.95, dashZ - rearZ, m.soft, s * W, beltY - (beltY - E.y + 0.95) / 2, (dashZ + rearZ) / 2)));
      if (!auto) [-1, 1].forEach(s => { doorCard(G, m, s, W, beltY, E.z - 0.25, dashZ - 0.05); if (rearZ < E.z - 1) doorCard(G, m, s, W, beltY, E.z - 1.2, E.z - 0.3); });
      if (!auto) [-1, 1].forEach(s => G.add(box(0.07, 0.03, dashZ - rearZ, P, s * W, beltY, (dashZ + rearZ) / 2)));
      // roof, pillars, screen header
      G.add(box(dashW, 0.03, E.z + 0.62 - rearZ, m.lining, 0, roofY, (E.z + 0.62 + rearZ) / 2));
      G.add(box(dashW, 0.07, 0.08, P, 0, roofY - 0.02, E.z + 0.64));
      [-1, 1].forEach(s => {
        G.add(beam(s * W, dashY, dashZ + (truck ? 0.08 : 0.3), s * (W - 0.05), roofY, E.z + 0.62, 0.04, P));
        G.add(beam(s * W, beltY, E.z - 0.28, s * W, roofY, E.z - 0.28, 0.045, P));
        G.add(beam(s * W, beltY, rearZ + 0.05, s * W, roofY, rearZ + 0.25, 0.08, P));
      });
      G.add(box(dashW, 0.1, 0.05, P, 0, roofY - 0.05, rearZ)); G.add(box(dashW, 0.1, 0.05, P, 0, beltY, rearZ));
    } else {
      G.add(box(0.5, 0.28, 0.1, m.dash, 0, E.y - 0.48, E.z + 0.56));
      G.add(box(0.5, 0.5, 0.5, m.seat, 0, E.y - 0.9, E.z - 0.1));
    }
    // bonnet (long nose vehicles only)
    if (!truck && !auto) {
      const nx = open ? 0.28 : W * 0.97, z0 = open ? E.z + 0.5 : dashZ + 0.35, z1 = Math.max(z0 + 0.3, B.max.z - 0.15), y = open ? E.y - 0.5 : dashY - 0.08;
      const H = box(nx * 2, 0.06, z1 - z0, P, 0, y, (z0 + z1) / 2); H.rotation.x = open ? 0 : 0.05; G.add(H);
      if (!open) [-1, 1].forEach(s => G.add(box(0.03, 0.03, z1 - z0, m.black, s * nx * 0.8, y + 0.04, (z0 + z1) / 2)));
    }
    // binnacle, wheel or bars
    const dz = E.z + (truck ? 0.55 : 0.44);
    if (auto) {
      const bars = new THREE.Group(); bars.position.set(E.x, E.y - 0.4, E.z + 0.4); G.add(bars); S.steerObj = bars; S.steerK = v => v * 1.1; S.steerAxis = 'y';
      bars.add(beam(-0.28, 0, 0, 0.28, 0, 0, 0.014, m.metal)); bars.add(beam(0, -0.5, 0.1, 0, 0, 0, 0.02, m.black));
      [-1, 1].forEach(s => arm(bars, s * 0.25, 0.01, 0, s * 0.3, 0.2, -0.38, m));
      S.speedo = dial(G, E.x - 0.04, dashY - 0.09, dashZ - 0.083, 0.05, 0, dialTex(S.spMax, 0, S.spStep)); S.fuelN = dial(G, E.x + 0.06, dashY - 0.09, dashZ - 0.083, 0.03, 0, fuelTex());
    } else {
      const R = truck ? 0.23 : 0.185, sw = new THREE.Group(), tilt = truck ? -0.7 : -0.4;
      sw.position.set(E.x, E.y - (truck ? 0.42 : 0.35), dz); sw.rotation.x = tilt;
      const rim = wheelRim(R, m); sw.add(rim); G.add(sw); S.steerObj = rim; S.steerK = v => -v * 3; S.steerAxis = 'z';
      arm(rim, -R * 0.94, R * 0.25, -0.01, -0.3, -0.25, -0.42, m); arm(rim, R * 0.94, R * 0.25, -0.01, 0.3, -0.25, -0.42, m);
      G.add(beam(E.x, sw.position.y - 0.1, dz + 0.3, E.x, sw.position.y, dz, 0.04, m.black));
      if (!open) {
        G.add(crystaRoundedBox(0.42, 0.13, 0.16, 0.05, m.black).translateX(E.x).translateY(dashY + 0.0).translateZ(dashZ - 0.04));
        const spT = dialTex(S.spMax, 0, S.spStep), rvT = dialTex(S.revK, S.redK, S.revK > 10 ? 2 : 1), cy = dashY, cz = dashZ - 0.122;
        if (kind === 'car' && (cls === 'modern' || cls === 'sports')) { lcd(G, S, 0.3, 0.13, E.x, cy, cz); if (cls === 'sports') G.add(box(0.46, 0.03, 0.14, m.dash, E.x, cy + 0.085, cz + 0.05)); }   // full digital panel under a hood
        else {
          S.speedo = dial(G, E.x + 0.1, cy, cz, 0.058, 0, spT); S.tacho = dial(G, E.x - 0.1, cy, cz, 0.058, 0, rvT); S.fuelN = dial(G, E.x, cy + 0.005, cz, 0.032, 0, fuelTex());
        }
      } else { S.speedo = dial(G, E.x - 0.03, E.y - 0.34, E.z + 0.505, 0.05, 0, dialTex(S.spMax, 0, S.spStep)); S.fuelN = dial(G, E.x + 0.07, E.y - 0.34, E.z + 0.505, 0.03, 0, fuelTex()); }
    }
    // mirrors: inside (centre slice), both doors (outer slices)
    const eye = { x: E.x, y: E.y, z: E.z };
    const pastRear = E.z + 0.6 - B.min.z + 0.3;   // the inside mirror looks clean through the cabin and rear body
    if (!open && !auto) mirror(S, G, 'C', 0, roofY - 0.1, E.z + 0.6, 0.26, 0.075, eye, m, [0, roofY, E.z + 0.6], 0, pastRear);
    if (auto) mirror(S, G, 'C', 0.0, roofY - 0.14, E.z + 0.4, 0.2, 0.07, eye, m, [0, roofY, E.z + 0.4], 0, pastRear);
    const mx = W + (truck ? 0.2 : 0.14), mw = truck ? 0.16 : 0.15, mh = truck ? 0.3 : 0.1, my = truck ? E.y - 0.15 : E.y - 0.3, mz = dashZ + (truck ? 0.05 : 0.2);
    [-1, 1].forEach(s => mirror(S, G, s < 0 ? 'R' : 'L', s * mx, my, mz, mw, mh, eye, m, [s * (W - 0.02), my - 0.06, mz - 0.06], 0, 0.4));   // +x is the car's left
  }
  function build(v, kind) {
    if (v._ck) return v._ck;
    const bx = Player.boxOf(v), e = Player.seatEye(v), m = mats();
    const seatX = kind === 'bike' || kind === 'auto' || kind === 'tractor' ? 0 : -Math.max(0.3, Math.abs(e.x));   // Indian RHD
    const S = { kind, bx, eye: { x: seatX, y: Math.min(e.y, bx.max.y - (kind === 'bike' || kind === 'tractor' ? -9 : 0.24)), z: e.z + 0.08 }, group: new THREE.Group(), noMirrors: !!(v.p && v.p.pedal), cls: classOf(v) };
    scales(S, v);
    S.group.name = 'cockpit';
    const paint = paintOf(v);
    if (kind === 'bike') buildBike(S.group, S, m, paint); else buildCabin(S.group, S, m, paint, kind);
    S.group.traverse(o => { o.castShadow = o.receiveShadow = false; o.frustumCulled = false; o.userData.noLOD = true; });
    S.group.visible = false;
    return v._ck = S;
  }
  // the Crysta has its own cabin: add only what it lacks, once
  function buildCrysta(chassis) {
    if (chassis._ck) return chassis._ck;
    const S = chassis._ck = { kind: 'crysta', own: true, eye: { x: -0.4, y: 1.43, z: 0.0 }, group: new THREE.Group(), glass: [] }, G = S.group, m = mats();
    // the tinted glass reads near black from inside: it steps aside while seated
    chassis.traverse(o => { const q = o.isMesh && o.material; if (q && q.transparent && q.opacity > 0.5 && q.color && q.color.getHSL({}).l < 0.15) S.glass.push(o); });
    // each door's black window sash is a solid plate that fills the window: it steps aside too
    Object.values(doorMeshes).forEach(d => d.group.traverse(o => { if (o.isMesh && o.material.color && o.material.color.getHex() === 0x07090d) S.glass.push(o); }));
    const sw = chassis.userData.steeringWheel, R = 0.18;
    arm(sw, -R * 0.94, R * 0.25, -0.012, -0.3, -0.25, -0.42, m); arm(sw, R * 0.94, R * 0.25, -0.012, 0.3, -0.25, -0.42, m);
    const eye = S.eye;
    mirror(S, G, 'C', 0, 1.53, 0.36, 0.22, 0.06, eye, m, null, 0, 3.1);
    // the door mirrors sit behind the windscreen pillar's sightline, seen through the door glass; the body's own housings step aside
    [-1, 1].forEach(s => mirror(S, G, s < 0 ? 'R' : 'L', s * 1.07, 1.22, 0.72, 0.24, 0.15, eye, m, [s * 0.93, 1.13, 0.76], 0, 0.4));
    Object.values(mirrorMeshes).forEach(d => { d.group.userData.noMirror = true; S.glass.push(d.group); });   // never drawn into the mirror that replaces them
    chassis.add(G); G.traverse(o => { o.userData.noLOD = true; o.frustumCulled = false; }); G.visible = false;
    return S;
  }
  // ---------------------------------------------------------------- see-through windows (interior mapping)
  // The bodies are closed shells with glass laid on top, so nothing real can show behind it. The glass instead draws a
  // fake room: the view ray is traced from the pane through a box the size of the cabin, against a few seat and dash
  // boxes, plus a sky reflection. No extra geometry; past 20 m the box tests are skipped. Works with instancing.
  const GL_DAY = { value: 1 };
  const GL_VS = `varying vec3 vL, vC, vN; void main() { mat4 M = modelMatrix;
    #ifdef USE_INSTANCING
    M = M * instanceMatrix;
    #endif
    vL = position; vN = normal; vec3 d = cameraPosition - M[3].xyz; vC = vec3(dot(d, M[0].xyz), dot(d, M[1].xyz), dot(d, M[2].xyz));
    gl_Position = projectionMatrix * viewMatrix * M * vec4(position, 1.0); }`;
  const GL_FS = `varying vec3 vL, vC, vN; uniform vec3 bMin, bMax, sMin[6], sMax[6], sCol[6], trim; uniform float day, tintK; uniform vec4 crack;
    float zoneOf(vec3 n) { vec3 a = abs(n); if (a.z >= a.x) return n.z > 0.0 ? crack.x : crack.y; return n.x > 0.0 ? crack.z : crack.w; }
    void main() {
      vec3 n = normalize(vN), rd = normalize(vL - vC), ro = clamp(vL, bMin + 0.01, bMax - 0.01), c;
      vec3 t1 = (mix(bMin, bMax, step(0.0, rd)) - ro) / rd; float t = min(t1.x, min(t1.y, t1.z));
      vec3 h = ro + rd * t, q;
      if (t == t1.y) c = rd.y < 0.0 ? vec3(0.05) : vec3(0.62, 0.6, 0.55) ; else if (t == t1.x) c = trim * 0.55; else c = rd.z > 0.0 ? trim * 0.3 : trim * 0.7;
      if (dot(vL - vC, vL - vC) < 400.0) for (int i = 0; i < 6; i++) {
        vec3 a = (sMin[i] - ro) / rd, b = (sMax[i] - ro) / rd, lo = min(a, b), hi = max(a, b); float tn = max(lo.x, max(lo.y, lo.z)), tf = min(hi.x, min(hi.y, hi.z));
        if (tn < tf && tf > 0.0 && tn < t) { t = max(tn, 0.0); vec3 m = step(vec3(tn) - 0.0001, lo); c = sCol[i] * (0.55 + 0.45 * abs(dot(m * sign(rd), vec3(0.3, 0.8, 0.5)))); }
      }
      float lit = 0.22 + 0.78 * day, f = 0.1 + 0.65 * pow(1.0 - abs(dot(n, rd)), 3.0);
      vec3 r = reflect(rd, n), sky = mix(vec3(0.32, 0.34, 0.33), vec3(0.72, 0.84, 0.96), clamp(r.y * 0.5 + 0.5, 0.0, 1.0)) * (0.12 + 0.88 * day);
      vec3 col = mix(c * lit * tintK * 0.4, sky, f);
      float k = zoneOf(n);
      if (k > 0.0) col = mix(col, vec3(0.2, 0.21, 0.22) * (0.25 + 0.75 * day), 0.3 * k);   // damaged pane: a dull grey haze, no line pattern
      gl_FragColor = vec4(col, 1.0);
      #include <encodings_fragment>
    }`;
  const glCache = {};
  const isGlass = m => m && m.isMeshPhongMaterial && m.shininess >= 140 && m.color && !m.map && m.color.getHSL({}).l < 0.15;
  function glassMaterial(U) {
    const m = new THREE.ShaderMaterial({ vertexShader: GL_VS, fragmentShader: GL_FS, uniforms: U });
    m.color = new THREE.Color(0x0b1118); m.userData.interior = true; m.clone = function () { return this; };   // shared by design: see ownGlass
    return m;
  }
  function interiorGlass(v) {
    if (v.twoWheeler) return;
    const list = []; v.g.traverse(o => { if (o.isMesh && isGlass(o.material)) { let q = o; while (q) { if (q.userData && q.userData.human) return; q = q.parent; } list.push(o); } });
    if (!list.length) return;
    const b = new THREE.Box3(), t = new THREE.Box3(); v.g.updateMatrixWorld(true);
    list.forEach(o => { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); t.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); b.union(t); });
    const key = (v.type || v.kind) + [b.min.x, b.max.y, b.min.z, b.max.z].map(n => n.toFixed(1)).join();
    const trimC = TRIM[CLS[v.type]] || TRIM.budget, hx = Math.max(b.max.x, -b.min.x) * 0.98, y0 = b.min.y - 0.5, y1 = b.max.y + 0.02, z0 = b.min.z, z1 = b.max.z, seat = v.seat || [0.4, y0 + 0.5, (z0 + z1) / 2];
    const sy = y0 + 0.08, sz = seat[2] - 0.2, sx = Math.min(hx * 0.5, Math.abs(seat[0]) + 0.02), C = n => new THREE.Color(n), V = (x, y, z) => new THREE.Vector3(x, y, z), rear = z1 - z0 > 2.2;
    const S = [[-sx - 0.23, sy, sz - 0.1, -sx + 0.23, sy + 0.8, sz + 0.02, trimC.seat], [sx - 0.23, sy, sz - 0.1, sx + 0.23, sy + 0.8, sz + 0.02, trimC.seat], [-hx * 0.8, sy, sz - 1.0, hx * 0.8, rear ? sy + 0.7 : sy - 1, sz - 0.88, trimC.seat],
      [-hx, y0, z1 - 0.5, hx, y0 + 0.62, z1, trimC.dash], [-sx - 0.17, y0 + 0.48, z1 - 0.75, -sx + 0.17, y0 + 0.82, z1 - 0.68, 0x202226], [-sx - 0.13, sy + 0.82, sz - 0.11, -sx + 0.13, sy + 1.0, sz - 0.02, trimC.seat]];
    const make = () => ({ bMin: { value: V(-hx, y0, z0) }, bMax: { value: V(hx, y1, z1) }, sMin: { value: S.map(q => V(q[0], q[1], q[2])) }, sMax: { value: S.map(q => V(q[3], q[4], q[5])) }, sCol: { value: S.map(q => C(q[6])) }, trim: { value: C(trimC.soft) }, day: GL_DAY, tintK: { value: 0.75 }, crack: { value: new THREE.Vector4(0, 0, 0, 0) } });
    const m = glCache[key] || (glCache[key] = glassMaterial(make()));
    list.forEach(o => { o.material = m; o.castShadow = false; });
  }
  // a private copy for tint or broken glass: everything else stays shared
  function ownGlass(v) {
    if (v._glass) return v._glass; let src = null;
    v.g.traverse(o => { if (o.isMesh && o.material.userData && o.material.userData.interior) src = src || o.material; });
    if (!src) return null;
    const U = Object.assign({}, src.uniforms, { tintK: { value: src.uniforms.tintK.value }, crack: { value: new THREE.Vector4(0, 0, 0, 0) } }), m = glassMaterial(U);
    v.g.traverse(o => { if (o.isMesh && o.material === src) o.material = m; });
    return v._glass = m;
  }
  // ---------------------------------------------------------------- seating and release
  let seated = null;                                       // { S, spr, hid: [...] }
  let usedFrame = false, head = 0, headV = 0, rumT = 0, hudOn = false;
  hudOn = true;   // rear-view strip on in the chase views unless the player turned it off (N)
  try { hudOn = localStorage.getItem('sparkv.rearHud2') !== '0'; } catch (e) {}
  function release() {
    if (!seated) return;
    seated.S.group.visible = false;
    seated.hid.forEach(o => { o.visible = true; });
    seated = null;
  }
  function seat(v, S, spr) {
    if (seated && seated.S === S) return;
    release();
    const hid = [];
    if (!S.own) {
      if (S.group.parent !== spr) spr.add(S.group);
      const body = window.Player && Player.bodyRef, keep = new Set(v.wheels || []); if (v.trailer) keep.add(v.trailer);
      spr.children.forEach(c => { if (c !== S.group && c !== body && c.visible && !keep.has(c) && !(c.userData && c.userData.human && c === body)) { c.visible = false; hid.push(c); } });
    }
    if (S.glass) S.glass.forEach(o => { if (o.visible) { o.visible = false; hid.push(o); } });
    S.group.visible = true; seated = { S, spr, hid };
    head = headV = 0;
  }
  // the Crysta's meshes are merged after building, so the live screen material is found by its texture
  function crystaScreenMat(spr) {
    if (spr._scrMat) return spr._scrMat;
    const t = window.CrystaScreen.tex; let f = null;
    spr.traverse(o => { if (f || !o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.map === t) f = m; }); });
    return spr._scrMat = f || window.CrystaScreen.mesh.material;
  }
  // mouse look while seated: stays exactly where it is put until the player double-clicks to face forward again
  let lookYaw = 0, lookPitch = 0;
  function look(dx, dy) { lookYaw = THREE.MathUtils.clamp(lookYaw - dx, -2.9, 2.9); lookPitch = THREE.MathUtils.clamp(lookPitch + dy, -0.75, 1); }
  addEventListener('dblclick', () => { if (seated) lookYaw = lookPitch = 0; });
  const _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _e = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0);
  // place the camera at the driver's eye. Returns false when this vehicle has no cockpit (bullock cart).
  function camera_(dt) {
    let S, spr, st, steer, v = null;
    const crysta = Player.mode === 'crysta';
    if (crysta) {
      if (!playerCarGroup || !playerCarGroup.userData.body) return false;
      spr = playerCarGroup.userData.body; S = buildCrysta(spr); st = crystaSusp; steer = steerAngle;
    } else {
      v = Player.active; if (!v) return false;
      const kind = kindOf(v); if (!kind) return false;
      S = build(v, kind); spr = (v.susp && v.susp.body) || v.g; st = (v.susp && v.susp.st) || {}; steer = v.steer || 0;
      if (S.group.parent && S.group.parent !== spr) { release(); S.group.parent.remove(S.group); }
    }
    seat(v, S, spr); usedFrame = true;
    if (window.Drive && Drive.gear === 'R' && (crysta || S.hasScreen)) revWant = crysta ? crystaScreenMat(spr) : SparkPlay.mat;
    if (window.SparkPlay && (crysta || S.hasScreen)) { SparkPlay.tick(dt, S, crysta ? window.CrystaScreen : null); }
    if (S.steerObj) S.steerObj.rotation[S.steerAxis] = S.steerK(steer);
    const sp = Math.abs(carSpeed), rat = Math.min(1, sp / ((v && v.p && v.p.top) || 180));
    const pt = v && v._pt, D = window.Drive, rpmN = D.rpm / ((S.revK || 8) * 1000), fuelNow = pt ? pt.fuel : 1;
    if (S.speedo) S.speedo.rotation.z = 2.36 - (S.spMax ? Math.min(1, D.speed / S.spMax) : rat) * 4.71;
    if (S.tacho) S.tacho.rotation.z = 2.36 - Math.min(1, rpmN) * 4.71;
    if (S.fuelN) S.fuelN.rotation.z = 1.05 - fuelNow * 2.1;
    if (S.lcd && (S.lcd.T -= dt) <= 0) { S.lcd.T = 0.14; drawLcd(S.lcd, D.speed, D.red ? D.rpm / D.red : 0, D.gear, fuelNow, (v && v._odo) || 0); }
    // head on the neck: lags the body's vertical acceleration; rumble grows with roughness and speed
    const W = 15, A = THREE.MathUtils.clamp(st.acc || 0, -60, 60);
    const steps = 2, h = dt / steps;
    for (let i = 0; i < steps; i++) { headV += (-W * W * head - 2 * 0.45 * W * headV - A * 0.9) * h; head += headV * h; }
    head = THREE.MathUtils.clamp(head, -0.075, 0.075);
    rumT += dt * (14 + sp * 0.35);
    const rough = VehicleSuspension.roughAt(carPos.x, carPos.z), rum = rough * Math.min(1, sp / 40) * 0.22;
    const ry = (Math.sin(rumT) + Math.sin(rumT * 1.73 + 1)) * rum, rr = Math.sin(rumT * 0.71 + 2) * rum * 0.4;
    spr.updateWorldMatrix(true, false);
    _e.set(S.eye.x, S.eye.y + head + ry, S.eye.z).applyMatrix4(spr.matrixWorld);
    camera.position.copy(_e);
    spr.getWorldQuaternion(_q);
    const back = typeof lookBack !== 'undefined' && !!lookBack;
    _qy.setFromAxisAngle(_up, Math.PI + (back ? Math.PI : lookYaw) + THREE.MathUtils.clamp(steer, -0.6, 0.6) * 0.14 * (back ? 0 : 1));
    _qx.setFromAxisAngle(_ax, -0.1 + head * 0.7 + rr - (back ? 0 : lookPitch));
    camera.quaternion.copy(_q).multiply(_qy).multiply(_qx);
    const fov = S.kind === 'bike' ? 76 : 70;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return true;
  }
  // ---------------------------------------------------------------- mirror pass + HUD strip (after the main render)
  let hudScene = null, hudCam = null, frameEl = null, hudMesh = null;
  const _v = new THREE.Vector4(), _rp = new THREE.Vector3(), stats = { passes: 0, calls: 0, tris: 0, ms: 0 };
  function vehicleForMirror() {
    if (Player.mode === 'crysta') { return { spr: playerCarGroup.userData.body, y: 1.35, z: -2.45 }; }
    if (Player.mode !== 'vehicle' || !Player.active) return null;
    const v = Player.active, b = Player.boxOf(v);
    return { spr: (v.susp && v.susp.body) || v.g, y: Math.min(b.max.y + 0.1, 2.6), z: b.min.z - 0.2 };
  }
  // the reduced scene: detail dressing and high-poly instanced props are dropped, big merged world meshes count only
  // when near. Keeps roads, ground, low-poly buildings and every vehicle.
  let trimAlways = null, trimNear = null;
  const triCount = g => (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
  function prepareTrim(scene) {
    trimAlways = []; trimNear = [];
    const root = scene.children.find(c => c.name === 'Nellutla'); if (!root) return;
    for (const c of root.children) {
      if (c.name === 'villageDetail') trimAlways.push(c);
      else if (c.isInstancedMesh) { if (triCount(c.geometry) > 48) trimAlways.push(c); }
      else if (c.isMesh && triCount(c.geometry) > 3000) { c.geometry.computeBoundingSphere(); trimNear.push(c); }
      // a split mesh draws through its child chunks: the map-wide far stand-ins never belong in a mirror, the rest count only when near
      if (c.isMesh && c.children.length) for (const k of c.children) {
        if (!k.isMesh || k.isInstancedMesh || !k.geometry) continue;
        if (!k.geometry.boundingSphere) k.geometry.computeBoundingSphere();
        if (k.geometry.boundingSphere.radius > 300) trimAlways.push(k); else if (triCount(k.geometry) > 1500) trimNear.push(k);
      }
    }
    // heavy instanced props anywhere else (trees, dressing, crowds of small things); parked cars stay, they matter behind you
    const seen = new Set(trimAlways);
    scene.traverse(o => { if (!o.isInstancedMesh || seen.has(o) || triCount(o.geometry) * o.count < 4000) return; let p = o, keep = false; while (p) { if (/^parked/.test(p.name || '')) keep = true; p = p.parent; } if (!keep) trimAlways.push(o); });
  }
  const _E = new THREE.Vector3(), _P = new THREE.Vector3(), _X = new THREE.Vector3(), _U = new THREE.Vector3(), _N = new THREE.Vector3(), _M = new THREE.Matrix4();
  // true reflection for one seated mirror. Returns false when there is none to draw this turn
  function aimReflection(M, q) {
    const S = seated.S, spr = seated.spr;
    M.G.updateWorldMatrix(true, false); spr.updateWorldMatrix(true, false);
    _M.extractRotation(M.G.matrixWorld); _X.setFromMatrixColumn(_M, 0); _U.setFromMatrixColumn(_M, 1); _N.setFromMatrixColumn(_M, 2);
    _P.setFromMatrixPosition(M.G.matrixWorld); _E.set(S.eye.x, S.eye.y, S.eye.z).applyMatrix4(spr.matrixWorld);
    const d = _E.clone().sub(_P).dot(_N); if (d < 0.05) return false;
    _E.addScaledVector(_N, -2 * d);                  // virtual eye behind the glass
    const c = _P.clone().sub(_E), cx = -c.dot(_X), cy = c.dot(_U), near = d + M.clear, sc = near / d;
    _rp.copy(_E); mirrorCam.position.copy(_E);
    mirrorCam.quaternion.setFromRotationMatrix(_M.makeBasis(_X.clone().negate(), _U, _N.clone().negate()));
    const far = M.slot === 'C' ? q[3] : q[3] * 0.6; mirrorCam.far = far; mirrorCam.near = near;
    mirrorCam.projectionMatrix.makePerspective((cx - M.k * M.w / 2) * sc, (cx + M.k * M.w / 2) * sc, (cy + M.k * M.h / 2) * sc, (cy - M.k * M.h / 2) * sc, near, far);
    mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
    return true;
  }
  const _cc = new THREE.Color(), _cf = new THREE.Color(), _cn = new THREE.Color(0x070a12);
  function renderMirror(r, scene, hud) {
    const q = qual(); target();
    if (rt.width !== q[0]) rt.setSize(q[0], q[1]);
    let slot = 'C', list = null;
    if (hud) {
      const M_ = vehicleForMirror(); if (!M_) return;
      M_.spr.updateWorldMatrix(true, false);
      _rp.set(0, M_.y, M_.z).applyMatrix4(M_.spr.matrixWorld);
      mirrorCam.position.copy(_rp); M_.spr.getWorldQuaternion(mirrorCam.quaternion);
      mirrorCam.rotateX(-0.04); mirrorCam.far = Math.min(q[3], 140); mirrorCam.near = 1; mirrorCam.aspect = 3.2; mirrorCam.fov = 40; mirrorCam.updateProjectionMatrix();
    } else {
      // centre every other pass, the door mirrors share the rest
      const all = (seated && seated.S.mirrors) || []; if (!all.length) return;
      const C = all.find(m => m.slot === 'C'), D = all.filter(m => m.slot !== 'C');
      turn++;
      list = C && (turn % 2 || !D.length) ? C : (D[(turn >> 1) % (D.length || 1)] || C);
      slot = list.slot;
      if (!aimReflection(list, q)) return;
    }
    mirrorCam.layers.mask = camera.layers.mask;        // lod.js shows and hides by camera layer
    mirrorCam.updateMatrixWorld();
    const vis = mirrorMats.map(m => m.visible); mirrorMats.forEach(m => { m.visible = false; });  // no feedback
    if (!trimAlways || stats.passes % 300 === 0) prepareTrim(scene);
    const hidden = [], hide = o => { if (o.visible) { o.visible = false; hidden.push(o); } }, shown = [];
    trimAlways.forEach(hide);
    if (typeof sky !== 'undefined') hide(sky);        // the sky dome rides the main camera and reads wrong from here: the clear colour is the horizon
    for (const o of trimNear) { const b = o.geometry.boundingSphere; if (b && _rp.distanceTo(b.center) - b.radius > 35) hide(o); }
    // the cabin is ours, the exterior belongs in a door mirror (its shell is hidden from the eye while seated)
    if (seated && !hud) { hide(seated.S.group); if (slot !== 'C') seated.hid.forEach(o => { if (!o.visible && !o.userData.noMirror) { o.visible = true; shown.push(o); } }); }
    const auto = r.shadowMap.autoUpdate, nu = r.shadowMap.needsUpdate, t0 = performance.now(), bg = scene.background, A = SLOT[slot];
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false;
    const x = Math.round(A[0] * rt.width), y = Math.round(A[1] * rt.height), w = Math.round(A[2] * rt.width), h = Math.round(A[3] * rt.height);
    rt.viewport.set(x, y, w, h); rt.scissor.set(x, y, w, h);
    r.getClearColor(_cc); const ca = r.getClearAlpha(); _cf.set(scene.fog ? scene.fog.color : 0x9fb6d0); { const dk = typeof stars !== 'undefined' ? stars.material.opacity : 0; _cf.lerp(_cn, dk); } r.setClearColor(_cf, 1);   // beyond the short far plane: horizon, not the page's clear colour
    scene.background = null;
    r.setRenderTarget(rt); r.clear(); r.render(scene, mirrorCam); stats.calls = r.info.render.calls; stats.tris = r.info.render.triangles; r.setRenderTarget(null); r.setClearColor(_cc, ca);
    r.shadowMap.autoUpdate = auto; r.shadowMap.needsUpdate = nu; scene.background = bg;
    hidden.forEach(o => { o.visible = true; }); shown.forEach(o => { o.visible = false; });
    mirrorMats.forEach((m, i) => { m.visible = vis[i]; });
    stats.passes++; stats.ms += (performance.now() - t0 - stats.ms) * 0.1;
    rtRead = true;
  }
  // reverse camera: its own small target on the dash screen while in R, mirrored like a real one, with parking guides
  let revRT = null, revMat = null, revMap = null, revWant = null, revScene = null, revCam = null, revTurn = 0;
  function revGuides() {
    revScene = new THREE.Scene(); revCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    [[-0.86, 0x37d24a], [-0.42, 0xf6d21b], [-0.05, 0xe5342b]].forEach(([y, c], i) => {
      const inX = 0.72 - i * 0.14, m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false, depthTest: false });
      [-1, 1].forEach(s => { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.012 + 0.012 * (3 - i) / 3, 0.44), m); q.position.set(s * inX, y + 0.2, 0); q.rotation.z = -s * 0.24; revScene.add(q); });
      const t = new THREE.Mesh(new THREE.PlaneGeometry(2 * inX * 0.72, 0.02), m); t.position.set(0, y + 0.42, 0); revScene.add(t);
    });
  }
  function renderReverse(r, scene) {
    const M_ = vehicleForMirror(); if (!M_) return;
    if (!revRT) {
      revRT = new THREE.WebGLRenderTarget(384, 224, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true });
      revRT.texture.wrapS = THREE.RepeatWrapping; revRT.texture.repeat.set(-1, 1); revRT.texture.offset.set(1, 0); revGuides();
    }
    target(); const q = qual();
    M_.spr.updateWorldMatrix(true, false);
    _rp.set(0, Math.min(M_.y, 1.15), M_.z + 0.15).applyMatrix4(M_.spr.matrixWorld);
    mirrorCam.position.copy(_rp); M_.spr.getWorldQuaternion(mirrorCam.quaternion); mirrorCam.rotateX(-0.38);
    mirrorCam.far = Math.min(q[3], 120); mirrorCam.near = 0.15; mirrorCam.aspect = 384 / 224; mirrorCam.fov = 68; mirrorCam.updateProjectionMatrix();
    mirrorCam.layers.mask = camera.layers.mask; mirrorCam.updateMatrixWorld();
    if (!trimAlways || stats.passes % 300 === 0) prepareTrim(scene);
    const vis = mirrorMats.map(m => m.visible); mirrorMats.forEach(m => { m.visible = false; });
    const hidden = [], hide = o => { if (o.visible) { o.visible = false; hidden.push(o); } };
    trimAlways.forEach(hide); if (typeof sky !== 'undefined') hide(sky); if (seated) hide(seated.S.group);
    const auto = r.shadowMap.autoUpdate, nu = r.shadowMap.needsUpdate, bg = scene.background, ac = r.autoClear, ca = r.getClearAlpha(); r.getClearColor(_cc);
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; scene.background = null;
    _cf.set(scene.fog ? scene.fog.color : 0x9fb6d0); if (typeof stars !== 'undefined') _cf.lerp(_cn, stars.material.opacity); r.setClearColor(_cf, 1);
    r.setRenderTarget(revRT); r.clear(); r.render(scene, mirrorCam); r.autoClear = false; r.render(revScene, revCam); r.autoClear = ac; r.setRenderTarget(null); r.setClearColor(_cc, ca);
    r.shadowMap.autoUpdate = auto; r.shadowMap.needsUpdate = nu; scene.background = bg;
    hidden.forEach(o => { o.visible = true; }); mirrorMats.forEach((m, i) => { m.visible = vis[i]; });
  }
  function reverseFrame(r, scene) {
    if (revMat && revMat !== revWant) { revMat.map = revMap; revMat = null; }
    if (!revWant) return;
    if ((revTurn++ % 3) === 0 || !revRT) try { renderReverse(r, scene); } catch (e) { console.warn('reverse cam', e); r.setRenderTarget(null); }
    if (revRT && !revMat) { revMat = revWant; revMap = revMat.map; revMat.map = revRT.texture; }
    revWant = null;
  }
  function drawHud(r) {
    if (!hudScene) {
      hudScene = new THREE.Scene(); hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      hudMesh = mirrorFace(2, 2, 'C'); mirrorMats.pop(); hudScene.add(hudMesh);
      frameEl = document.createElement('div'); frameEl.id = 'rearHud';
      frameEl.style.cssText = 'position:fixed;top:calc(84px + var(--st,0px));left:50%;width:300px;max-width:50vw;aspect-ratio:3.2;transform:translateX(-50%);border:2px solid rgba(255,255,255,.45);border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.45);pointer-events:none;z-index:6;display:none';
      document.body.appendChild(frameEl);
    }
    frameEl.style.display = 'block';
    const tn = performance.now(); if (!drawHud.b || tn - drawHud.t > 400) { drawHud.b = frameEl.getBoundingClientRect(); drawHud.t = tn; }
    const b = drawHud.b, H = innerHeight, ac = r.autoClear;
    r.getViewport(_v); r.autoClear = false; r.setScissorTest(true);
    r.setViewport(b.left, H - b.bottom, b.width, b.height); r.setScissor(b.left, H - b.bottom, b.width, b.height);
    r.render(hudScene, hudCam);
    r.setScissorTest(false); r.setViewport(_v); r.autoClear = ac;
  }
  function afterRender(r, scene, frame) {
    if (typeof timeOfDay === 'number') GL_DAY.value = Math.max(0, Math.min(1, (timeOfDay - 5.5) / 2, (19 - timeOfDay) / 2));
    if (!usedFrame && seated) release();
    const drove = isPlaying && (Player.mode === 'crysta' || Player.mode === 'vehicle');
    const hud = hudOn && drove && !usedFrame && (typeof showMap === 'undefined' || !showMap);
    reverseFrame(r, scene);
    const showMirrors = usedFrame && !(seated && seated.S.noMirrors);
    usedFrame = false;
    if ((showMirrors || hud) && frame % (hud ? Math.max(3, qual()[2]) : qual()[2]) === 0) {   // the small chase strip refreshes at a third of the frame rate
      try { renderMirror(r, scene, hud); } catch (e) { console.warn('mirror', e); r.setRenderTarget(null); } }
    if (hud && rtRead) drawHud(r); else if (frameEl) frameEl.style.display = 'none';
  }
  function toggleHud() {
    hudOn = !hudOn; try { localStorage.setItem('sparkv.rearHud2', hudOn ? '1' : '0'); } catch (e) {}
    const c = document.getElementById('rearHudOpt'); if (c) c.checked = hudOn;
    return hudOn;
  }
  return { interiorGlass, ownGlass, classOf, paintOf, camera: camera_, afterRender, toggleHud, look, stats, get lookYaw() { return lookYaw; }, get lookPitch() { return lookPitch; }, get reverseOn() { return !!revMat; }, get hud() { return hudOn; }, get seated() { return seated; }, get rt() { return rt; } };
})();
