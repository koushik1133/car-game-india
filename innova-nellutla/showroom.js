// showroom.js: vehicle showrooms and the upgrade shop, all in Jangaon (window.Jangaon.sites, planned coordinates if
// absent). None in Nellutla. Walk in, press E: browse, colour, test drive, buy or finance, TR plate then a permanent
// number, delivered to the forecourt and saved. Upgrades change the real powertrain numbers and the model, per vehicle.
// Prices are approximate, recent ex-showroom-like figures in rupees, not quotes. Signage is generic: no real dealer
// names or logos, whatever the site's map name says. Also: fuel filling at petrol bunks, repair, EMI collection.
// Exposes window.Showroom.
window.Showroom = (function () {
  'use strict';
  const KEY = 'sparkv.garage', RTO = 0.1, RATE = 9.5, DOWN = 0.2, EMI_EVERY = 960 * 3, REG_AFTER = 960;   // seconds of play: 3 game days, 1 game day
  // approximate ex-showroom rupees; "cat" picks the shop
  const PRICE = { alto: 420000, hatch: 490000, wagonR: 560000, swift: 600000, swiftNew: 650000, dzire: 680000, bolero: 980000, sumo: 900000, thar: 1150000, scorpio: 1360000, safari: 1500000, scorpioN: 1550000, hector: 1400000, tharRoxx: 1400000, innova: 1450000, fortuner: 3400000, fortunerBlack: 3600000, landCruiser: 22000000, defender: 11000000, gclass: 37000000, muscle: 7500000, coupe911: 19000000, berlinetta: 40000000, wedge: 40000000,
    bike: 78000, starCity: 78000, activa: 78000, scooter: 76000, cycle: 6500, sport: 140000, faired: 185000, classic: 193000, classic2: 180000, hayabusa: 1690000, s1000rr: 2100000, r1250gsa: 2300000, r1300gsa: 2300000,
    auto: 230000, ace: 500000, tractor: 800000, lorry: 2200000 };
  const SITE_CAT = { showroom: ['Budget Cars', ['alto', 'hatch', 'wagonR', 'swift', 'swiftNew', 'dzire', 'innova']], showroom2: ['SUV World', ['bolero', 'sumo', 'scorpio', 'safari', 'scorpioN', 'thar', 'tharRoxx', 'hector', 'fortuner', 'fortunerBlack']], showroom3: ['Prestige Motors', ['landCruiser', 'defender', 'gclass', 'muscle', 'coupe911', 'berlinetta', 'wedge']],
    bikeShowroom: ['City Two Wheelers', ['bike', 'starCity', 'activa', 'scooter', 'cycle', 'sport', 'faired']], bikeShowroom2: ['Big Bike House', ['classic', 'classic2', 'hayabusa', 's1000rr', 'r1250gsa', 'r1300gsa']], autoShowroom: ['Commercial Autos', ['auto', 'ace', 'tractor', 'lorry']], upgrade: ['Custom Works', null] };
  const PLAN = { showroom: [-4294, -1324, 34, 28], showroom2: [-4110, -1462, 30, 26], showroom3: [-4334, -2600, 30, 26], bikeShowroom: [-4326, -1307, 22, 18], bikeShowroom2: [-3847, -1702, 22, 18], autoShowroom: [-3948, -1587, 22, 20], upgrade: [-3715, -1799, 24, 22] };
  const COLOURS = [['Pearl White', 0xf2f2ee], ['Silky Silver', 0xb9bdc2], ['Magma Grey', 0x4a4d52], ['Midnight Black', 0x121316], ['Fire Red', 0xb3161c], ['Ocean Blue', 0x1b4f96], ['Forest Green', 0x25543a], ['Sand Beige', 0xc2ad8a], ['Sunset Orange', 0xd9651a]];
  const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const nameOf = t => { const P = Player.PARAMS[t] || Player.PARAMS[{ fortunerBlack: 'fortuner' }[t]]; return t === 'fortunerBlack' ? 'FORTUNER 4X4 (BLACK)' : P ? P.name : t.toUpperCase(); };

  // upgrade catalogue: price is the share of the vehicle price, floor in rupees
  const UPG = {
    engine: { label: 'Engine', opts: [['Stock', 0], ['Stage 1 remap', 0.03, { pw: 1.08 }], ['Stage 2 intake + remap', 0.07, { pw: 1.16 }], ['Stage 3 turbo / internals', 0.15, { pw: 1.3, mass: 12 }]] },
    exhaust: { label: 'Exhaust', opts: [['Stock', 0], ['Sport muffler', 0.012, { pw: 1.02, mass: -4 }], ['Straight-through', 0.025, { pw: 1.04, mass: -8 }]] },
    wheels: { label: 'Wheels', opts: [['Stock', 0], ['Five-spoke alloy', 0.015, { mass: -6, grip: 1.02 }], ['Ten-spoke alloy', 0.02, { mass: -7, grip: 1.02 }], ['Mesh alloy', 0.025, { mass: -9, grip: 1.03 }], ['Black forged', 0.05, { mass: -14, grip: 1.05 }]] },
    susp: { label: 'Suspension', opts: [['Stock', 0], ['Sport lowered 25 mm', 0.02, { grip: 1.08, ride: -0.025 }], ['Off-road lift 40 mm', 0.025, { off: 0.15, ride: 0.04 }]] },
    lights: { label: 'Lights', opts: [['Stock', 0, { hex: 0 }], ['White LED', 0.006, { hex: 0xf4faff }], ['Warm halogen+', 0.003, { hex: 0xffd27a }], ['Blue-white HID', 0.01, { hex: 0xbcd8ff }]] },
    tint: { label: 'Window tint', opts: [['Clear', 0, { tint: 0.75 }], ['Light 50%', 0.002, { tint: 0.45 }], ['Dark 30%', 0.003, { tint: 0.2 }]] },
  };
  for (const k in PRICE) { const s = window.VehicleDynamics && VehicleDynamics.ptSpec(k); if (s && s.src.price && k !== 'fortunerBlack') PRICE[k] = s.src.price; }   // sourced prices replace the estimates
  const uFloor = 2500;
  const uPrice = (rec, k, i) => { const f = UPG[k].opts[i][1]; return f ? Math.max(uFloor, Math.round(PRICE[rec.type] * f / 100) * 100) : 0; };
  function modsOf(rec) {
    const M = { pw: 1, mass: 0, grip: 1, top: 1, off: 0, ride: 0 };
    for (const k in UPG) { const o = UPG[k].opts[(rec.upg && rec.upg[k]) || 0][2]; if (!o) continue; if (o.pw) M.pw *= o.pw; if (o.mass) M.mass += o.mass; if (o.grip) M.grip *= o.grip; if (o.off) M.off += o.off; if (o.ride) M.ride += o.ride; }
    return M;
  }

  // ---------------------------------------------------------------- state
  let G = null, world = null, scene = null, save = { owned: {}, play: 0, seq: 0 };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.owned) save = s; } catch (e) {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} };
  const live = {};              // id -> vehicle object in the world
  const sites = [];
  const eco = { cash: () => window.Economy ? Economy.cash : G.cash, spend: (n, why) => window.Economy ? Economy.spend(n, why) : (G.cash >= n ? (G.cash -= n, true) : false) };
  const say = t => { if (G && G.showPopup) G.showPopup(t); else if (typeof showComboPopup === 'function') showComboPopup(t); };
  const notify = t => { if (window.Phone && Phone.notify) Phone.notify(t); };

  // ---------------------------------------------------------------- vehicles: paint, plates, looks
  function stripPeople(g) { const dead = []; g.traverse(o => { if (o.userData && o.userData.human) dead.push(o); }); dead.forEach(o => o.parent && o.parent.remove(o)); }
  // builders share materials between every car in the game: this vehicle gets its own before anything is tinted
  function ownMats(v) { const seen = new Map(); v.g.traverse(o => { if (!o.isMesh) return; const one = m => seen.get(m) || (seen.set(m, m.clone()), seen.get(m)); o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material); }); }
  function paint(v, hex) {
    const cur = v._paintHex !== undefined ? v._paintHex : Player.bodyColour(v);
    v.g.traverse(o => { const m = o.isMesh && o.material; if (m && m.color && !m.map && !m.vertexColors && m.color.getHex() === cur) m.color.setHex(hex); });
    v._paintHex = hex;
  }
  function plateTex(text, temp) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = temp ? '#f5d21f' : '#f6f6f2'; g.fillRect(0, 0, 256, 64); g.strokeStyle = temp ? '#c0180f' : '#111'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 58);
    g.fillStyle = temp ? '#c0180f' : '#111'; g.font = 'bold 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34, 240);
    return new THREE.CanvasTexture(c);
  }
  function fitPlate(v, text, temp) {
    (v._plates || []).forEach(p => p.parent && p.parent.remove(p)); v._plates = [];
    const b = Player.boxOf(v), two = !!(v.p ? v.p.lean : v.twoWheeler || (v.g.userData && (TrafficModels.TWO_WHEELERS || []).includes(v.g.userData.type)));
    const mat = new THREE.MeshBasicMaterial({ map: plateTex(text, temp) });
    for (const end of two ? [-1] : [1, -1]) {
      const w = two ? 0.18 : 0.4, p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
      p.position.set(0, two ? 0.75 : 0.5, (end > 0 ? b.max.z : b.min.z) + end * 0.012); if (end < 0) p.rotation.y = Math.PI; p.userData.noLOD = true; v.g.add(p); v._plates.push(p);
    }
  }
  const alloyC = {};
  function alloyTex(style) {
    if (alloyC[style]) return alloyC[style];
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), black = style === 4;
    g.translate(64, 64); g.fillStyle = black ? '#17181b' : '#c8ccd2'; g.strokeStyle = g.fillStyle;
    g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 58, 0, 7); g.stroke();
    const n = style === 1 ? 5 : style === 2 ? 10 : style === 3 ? 16 : 6; g.lineWidth = style === 1 ? 13 : style === 3 ? 3.5 : 7; g.lineCap = 'round';
    for (let i = 0; i < n; i++) { const a = i / n * 6.283; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 56, Math.sin(a) * 56); if (style === 3) { g.moveTo(Math.cos(a) * 56, Math.sin(a) * 56); g.lineTo(Math.cos(a + 0.8) * 30, Math.sin(a + 0.8) * 30); } g.stroke(); }
    g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); return alloyC[style] = t;
  }
  function setWheels(v, style) {
    (v._alloys || []).forEach(o => o.parent && o.parent.remove(o)); v._alloys = [];
    if (!style) return;
    const disc = new THREE.MeshLambertMaterial({ color: 0x0c0c0e, side: THREE.DoubleSide }), mat = new THREE.MeshLambertMaterial({ map: alloyTex(style), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, emissive: 0x222222 }), bb = new THREE.Box3();
    for (const w of v.wheels || []) {
      let rx = 0; w.traverse(o => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox); rx = Math.max(rx, Math.abs(bb.min.x), Math.abs(bb.max.x)); } });
      const R = (w.userData.radius || 0.32) * 0.68;
      for (const s of [-1, 1]) { const base = new THREE.Mesh(new THREE.CircleGeometry(R, 20), disc), o = new THREE.Mesh(new THREE.CircleGeometry(R, 20), mat); [[base, 0.004], [o, 0.008]].forEach(([q, d]) => { q.rotation.y = s * Math.PI / 2; q.position.x = s * (rx + d); w.add(q); v._alloys.push(q); }); }
    }
  }
  function setExhaust(v, level) {
    (v._tips || []).forEach(o => o.parent && o.parent.remove(o)); v._tips = [];
    if (!level) return;
    const b = Player.boxOf(v), m = new THREE.MeshPhongMaterial({ color: 0xd8dade, shininess: 90 });
    for (let i = 0; i < level; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 12, 1, true), m); t.rotation.x = Math.PI / 2; t.position.set(0.42 - i * 0.14, 0.32, b.min.z + 0.05); t.material.side = THREE.DoubleSide; v.g.add(t); v._tips.push(t); }
  }
  function setRide(v, y) {
    const d = y - (v._rideY || 0); if (!d) return; v._rideY = y;
    const root = (v.susp && v.susp.body) || v.g, wheels = new Set(v.wheels || []), steer = new Set(v.steer || []);
    const isRunning = o => { for (const w of wheels) { let q = w; while (q) { if (q === o) return true; q = q.parent; } } return steer.has(o); };
    root.children.forEach(c => { if (!isRunning(c) && !(c.userData && c.userData.human) && c !== v.susp) c.position.y += d; });
  }
  function setLooks(v, rec) {
    const U = rec.upg || {};
    setWheels(v, U.wheels || 0); setExhaust(v, U.exhaust || 0); setRide(v, modsOf(rec).ride);
    const tint = UPG.tint.opts[U.tint || 0][2].tint, lamp = UPG.lights.opts[U.lights || 0][2].hex;
    if (U.tint) { const gm = Cockpit.ownGlass(v); if (gm) gm.uniforms.tintK.value = tint; }
    if (lamp) (v.head || []).forEach(h => { const m = h.material; if (m && m.color) { if (v._lamp0 === undefined) v._lamp0 = m.color.getHex(); m.color.setHex(lamp); if (m.emissive) m.emissive.setHex(lamp); } });
  }
  // the real powertrain change: v.p is a private copy, v._pt carries the multipliers. player.js calls onTaken after setting v.p
  function tune(v, rec) {
    const ty = v.g.userData.type, s = VehicleDynamics.ptSpec(ty); v._ty = v._ty || ty;
    const P = v._pt || (s && VehicleDynamics.ptFor(v, ty)), M = modsOf(rec);
    if (P) { Object.assign(P.mods, { pw: M.pw, mass: M.mass, grip: M.grip }); P.cond = rec.cond === undefined ? 1 : rec.cond; P.fuel = rec.fuel === undefined ? 1 : rec.fuel; }
    const base = Player.PARAMS[ty] || Player.PARAMS.hatch, top = s && !s.lim ? VehicleDynamics.bench(ty, { pw: M.pw, mass: M.mass, grip: M.grip }).top : base.top;
    v.p = Object.assign({}, base, { top: Math.max(base.top, top), brake: base.brake * Math.min(1.1, M.grip), offroad: Math.min(1, base.offroad + M.off) });
    if (v._vd) v._vd.grip = v._vd.spec.grip * M.grip;
  }
  function make(type, colour) {
    const m = TrafficModels[type === 'bike' ? 'splendor' : type]();
    stripPeople(m.g); ownMats(m);
    const kind = (window.Parked && Parked.playerKind(type)) || type, ud = m.userData || {}, g = m.g;
    const v = Object.assign({}, m, { model: kind, type, parked: true, speed: 0, cur: 0, s: 0, dir: 1, r: null, wheelR: 0.4, hw: (Player.PARAMS[type] || Player.PARAMS[kind] || Player.PARAMS.hatch).hw, len: m.len, userData: ud });
    g.userData.type = g.userData.type || type;
    v.wheels = m.wheels; v.head = m.head; v.tail = m.tail;
    if (colour !== undefined) paint(v, colour);
    return v;
  }
  function spawnOwned(id) {
    const rec = save.owned[id], v = make(rec.type, rec.colour); v._ownedId = id;
    v.g.position.set(rec.x, typeof groundY === 'function' ? groundY(rec.x, rec.z) : 0, rec.z); v.g.rotation.y = rec.rot || 0; scene.add(v.g);
    setLooks(v, rec); fitPlate(v, rec.plate, !rec.perm); tune(v, rec); if (rec.dmg) restoreDamage(v, rec.dmg);
    v.onTaken = () => tune(v, save.owned[id]);
    Player.addParked(v); live[id] = v; return v;
  }

  // ---------------------------------------------------------------- visible damage
  // An impact goes by side: panels near the hit are pushed in, a lamp on that corner breaks, the glass on that side cracks.
  // Dents are data (saved with an owned vehicle), the untouched vertices are kept so a repair restores them exactly.
  const ZONES = ['front', 'rear', 'left', 'right'], _p = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function panels(v) {
    if (v._panels) return v._panels; const hex = v._paintHex !== undefined ? v._paintHex : Player.bodyColour(v), out = [];
    v.g.traverse(o => { const m = o.isMesh && o.material; if (m && m.color && m.color.getHex() === hex && o.geometry.attributes.position.count > 60) { o.geometry = o.geometry.clone(); out.push({ o, pos: o.geometry.attributes.position.array.slice(), nor: o.geometry.attributes.normal.array.slice() }); } });
    return v._panels = out;
  }
  function dent(v, D) {
    v.g.updateMatrixWorld(true);
    for (const q of panels(v)) {
      const P = q.o.geometry.attributes.position, A = P.array; _a.set(D[0], D[1], D[2]); v.g.localToWorld(_a); q.o.worldToLocal(_a);
      _b.set(D[0] + D[3], D[1] + D[4], D[2] + D[5]); v.g.localToWorld(_b); q.o.worldToLocal(_b); _d.copy(_b).sub(_a); let hit = false;
      for (let i = 0; i < A.length; i += 3) { const dx = A[i] - _a.x, dy = A[i + 1] - _a.y, dz = A[i + 2] - _a.z, r2 = dx * dx + dy * dy + dz * dz; if (r2 > D[6] * D[6]) continue;
        const f = 1 - Math.sqrt(r2) / D[6], w = D[7] * f * f * (0.75 + 0.25 * Math.sin(A[i] * 23 + A[i + 1] * 31 + A[i + 2] * 17)); A[i] += _d.x * w; A[i + 1] += _d.y * w; A[i + 2] += _d.z * w; hit = true; }
      if (hit) { P.needsUpdate = true; q.o.geometry.computeVertexNormals(); }
    }
  }
  function breakLamp(v, zone, x) {
    if (zone !== 'front' && zone !== 'rear') return; const L = (zone === 'front' ? v.head : v.tail) || []; let best = null, bd = 1e9;
    L.forEach(m => { if (m.userData.broken) return; m.getWorldPosition(_p); v.g.worldToLocal(_p); const d = Math.abs(_p.x - x); if (d < bd) { bd = d; best = m; } });
    if (best) { best.userData.broken = true; best.visible = false; if (best.lens) best.lens.visible = false; }
  }
  function crackGlass(v, D) { const m = Cockpit.ownGlass(v); if (m) m.uniforms.crack.value.set(D.front || 0, D.rear || 0, D.left || 0, D.right || 0); }
  function impact(v, zone, sev, along) {
    const b = Player.boxOf(v), D = v._dmg || (v._dmg = { dents: [], front: 0, rear: 0, left: 0, right: 0, lamps: [] }), cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, y = 0.45 + 0.35 * Math.random();
    const px = zone === 'left' ? b.max.x : zone === 'right' ? b.min.x : cx + along * (b.max.x - cx) * 0.8, pz = zone === 'front' ? b.max.z : zone === 'rear' ? b.min.z : cz + along * (b.max.z - cz) * 0.75;
    const n = { front: [0, 0, -1], rear: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] }[zone], d = [+px.toFixed(2), +y.toFixed(2), +pz.toFixed(2), n[0], 0.15, n[2], +(0.35 + sev * 0.3).toFixed(2), +(0.05 + sev * 0.11).toFixed(3)];
    if (D.dents.length < 14) { D.dents.push(d); dent(v, d); }
    if (sev > 0.3 && (zone === 'front' || zone === 'rear')) { breakLamp(v, zone, px); D.lamps.push([zone, px]); }
    D[zone] = Math.min(1, D[zone] + sev * 0.8); if (D[zone] > 0.3) crackGlass(v, D);
    if (v._ownedId && save.owned[v._ownedId]) { save.owned[v._ownedId].dmg = D; persist(); }
    return d;
  }
  function restoreDamage(v, D) { v._dmg = D; D.dents.forEach(d => dent(v, d)); (D.lamps || []).forEach(l => breakLamp(v, l[0], l[1])); crackGlass(v, D); }
  function repairBody(v) {
    (v._panels || []).forEach(q => { const g = q.o.geometry; g.attributes.position.array.set(q.pos); g.attributes.normal.array.set(q.nor); g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true; });
    [...(v.head || []), ...(v.tail || [])].forEach(m => { if (m.userData.broken) { m.userData.broken = false; m.visible = true; if (m.lens) m.lens.visible = true; } });
    if (v._glass) v._glass.uniforms.crack.value.set(0, 0, 0, 0); v._dmg = null;
  }
  const hasDamage = v => !!(v._dmg && (v._dmg.dents.length));
  const fixCost = (rec, v) => { const c = v._pt ? v._pt.cond : 1; return Math.round(((1 - c) * 0.04 + (v._dmg ? v._dmg.dents.length * 0.004 : 0)) * PRICE[rec.type] / 100) * 100; };
  function checkImpact(a) {
    const H = a._hit; if (!H) return; a._hit = null;
    const r = a.g.rotation.y, nf = H.nx * Math.sin(r) + H.nz * Math.cos(r), nl = H.nx * Math.cos(r) - H.nz * Math.sin(r);
    const zone = Math.abs(nf) >= Math.abs(nl) ? (nf < 0 ? 'front' : 'rear') : (nl < 0 ? 'left' : 'right');
    impact(a, zone, Math.min(1, H.sp / 14), Math.random() * 1.6 - 0.8);
  }
  // ---------------------------------------------------------------- buildings
  const lamb = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0 });
  let tileT = null;
  function tile() { if (tileT) return tileT; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#a9a9a6'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128); tileT = new THREE.CanvasTexture(c); tileT.wrapS = tileT.wrapT = THREE.RepeatWrapping; return tileT; }
  function sign(text, sub, w) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
    g.fillStyle = '#10243e'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 46px sans-serif'; g.fillText(text.toUpperCase(), 256, 52, 490); g.font = '20px sans-serif'; g.fillStyle = '#9fd0ff'; g.fillText(sub, 256, 82, 490);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
  }
  function buildSite(key, s) {
    const [title, list] = SITE_CAT[key], ang = s.entry ? Math.atan2(s.entry[0] - s.x, s.entry[1] - s.z) : s.rot || 0, w = s.w, d = s.d, H = 5.2, cs = Math.cos(ang), sn = Math.sin(ang);
    const L = (a, b) => ({ x: s.x + a * cs + b * sn, z: s.z - a * sn + b * cs });      // local +b is the street front
    const S = { key, title, list, x: s.x, z: s.z, w, d, ang, L, g: new THREE.Group(), slots: [], cars: [], y: typeof groundY === 'function' ? groundY(s.x, s.z) : 0 };
    S.g.position.set(s.x, S.y, s.z); S.g.rotation.y = ang; S.g.name = 'showroom-' + key; scene.add(S.g);
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); S.g.add(o); return o; }, BX = (a, b, c) => new THREE.BoxGeometry(a, b, c);
    const t = tile().clone(); t.needsUpdate = true; t.repeat.set(w / 1.2, d / 1.2);
    const floor = add(new THREE.PlaneGeometry(w, d), new THREE.MeshPhongMaterial({ map: t, shininess: 70, emissive: 0x3a3a3a }), 0, 0.03, 0); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    const wall = lamb(0xeceae4, 0x2a2a28), T = 0.25, door = 5;
    add(BX(w, H, T), lamb(0x1c3a5e, 0x101820), 0, H / 2, -d / 2); add(BX(T, H, d), wall, -w / 2, H / 2, 0); add(BX(T, H, d), wall, w / 2, H / 2, 0);
    const glass = new THREE.MeshPhongMaterial({ color: 0x9fc4d8, transparent: true, opacity: 0.22, shininess: 120, depthWrite: false }), side = (w - door) / 2;
    [-1, 1].forEach(q => { add(BX(side, H, 0.06), glass, q * (door / 2 + side / 2), H / 2, d / 2); add(BX(0.14, H, 0.14), lamb(0x2b2d30), q * door / 2, H / 2, d / 2); });
    add(BX(door, 0.8, 0.14), lamb(0x2b2d30), 0, H - 0.4, d / 2);
    const roof = new THREE.Group(); S.g.add(roof); S.roof = roof;
    const r = new THREE.Mesh(BX(w + 0.6, 0.3, d + 0.6), lamb(0xf2f2f0, 0x3a3a38)); r.position.y = H + 0.15; roof.add(r);
    for (let a = -w / 2 + 3; a < w / 2 - 1; a += 5) for (let b = -d / 2 + 3; b < d / 2 - 1; b += 5) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), new THREE.MeshBasicMaterial({ color: 0xfbfbf0 })); p.rotation.x = Math.PI / 2; p.position.set(a, H - 0.02, b); roof.add(p); }
    const bd = sign(title, key === 'upgrade' ? 'Tuning · Wheels · Paint · Repair' : 'Sales · Finance · Test drives', Math.min(w * 0.8, 18)); bd.position.set(0, H + 1.5, d / 2 + 0.05); S.g.add(bd);
    add(BX(Math.min(w * 0.8, 18) + 0.3, 3.8, 0.1), lamb(0x10243e), 0, H + 1.5, d / 2);
    // reception desk and a wall of specs at the back
    add(BX(3.4, 1.05, 0.8), lamb(0xdcd4c4, 0x201c16), -w / 2 + 3, 0.55, -d / 2 + 2);
    add(BX(1.5, 0.85, 0.7), lamb(0x4f3a2a), w / 2 - 2.6, 0.45, -d / 2 + 2.2);                                  // customer table
    const back = sign(title, key === 'upgrade' ? 'Bay 1 · Bay 2' : 'Prices approximate, ex-showroom', Math.min(w * 0.55, 13)); back.position.set(0, 3.1, -d / 2 + 0.14); S.g.add(back);
    // colliders, in world space
    if (world.addCollider) {
      const C = (a, b, ha, hb) => { const q = L(a, b); world.addCollider(q.x, q.z, ha, hb, ang); };
      C(0, -d / 2, w / 2, T); C(-w / 2, 0, T, d / 2); C(w / 2, 0, T, d / 2);
      [-1, 1].forEach(q => C(q * (door / 2 + side / 2), d / 2, side / 2, 0.12));
      C(-w / 2 + 3, -d / 2 + 2, 1.7, 0.4); C(w / 2 - 2.6, -d / 2 + 2.2, 0.75, 0.35);
    }
    if (list) {
      const big = w > 26, sp = big ? [[-0.3, -0.12], [0.3, -0.12], [-0.3, 0.24], [0.3, 0.24], [0, 0.05]] : [[-0.27, -0.12], [0.27, -0.12], [-0.27, 0.24], [0.27, 0.24]];
      sp.forEach(([a, b], i) => { const P = new THREE.Group(); P.position.set(a * w, 0.14, b * d); P.rotation.y = i === 4 ? 0.5 : (a < 0 ? 0.7 : -0.7); S.g.add(P); add(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 32), lamb(0x8a8e94, 0x151515), a * w, 0.08, b * d); S.slots.push({ P, type: list[i % list.length], v: null }); });
    }
    if (world.addMapIcon) world.addMapIcon(s.x, s.z, '$', title);
    if (window.GameLocations) GameLocations.add('shop-' + key, { name: title, x: s.x, z: s.z, kind: key === 'upgrade' ? 'garage' : 'showroom' });
    return S;
  }
  function display(S, slot, type, colour) {
    if (slot.v) { slot.P.remove(slot.v.g); slot.v = null; }
    const v = make(type, colour); v.g.position.set(0, 0, 0); v.g.rotation.set(0, 0, 0); slot.P.add(v.g); slot.v = v; slot.type = type;
    v.g.traverse(o => { o.userData.noLOD = true; });
    fitPlate(v, 'DEMO', true);
  }
  function fill(S) { if (S.filled || !S.slots.length) return; S.filled = true; S.slots.forEach(q => display(S, q, q.type)); }

  // ---------------------------------------------------------------- UI
  let ui = null, cur = null;
  const css = `#srPanel{position:fixed;inset:5vh 5vw;z-index:60;background:rgba(10,16,26,.96);color:#eef3f8;border:1px solid #3a5270;border-radius:14px;font:14px system-ui,sans-serif;display:none;overflow:auto;padding:16px}
#srPanel.open{display:flex;gap:16px;flex-wrap:wrap}#srPanel h2{margin:0 0 4px;font-size:21px}#srPanel .l{flex:1 1 230px;max-height:80vh;overflow:auto}#srPanel .r{flex:2 1 340px}
#srPanel button{font:inherit;background:#1f3550;color:#fff;border:1px solid #3a5270;border-radius:8px;padding:8px 11px;margin:3px;cursor:pointer}#srPanel button:hover{background:#2b4a70}#srPanel button.on{background:#2f7bd0}#srPanel button.buy{background:#17803f}#srPanel button:disabled{opacity:.4;cursor:default}
#srPanel .it{display:block;width:100%;text-align:left}#srPanel .sw{width:30px;height:30px;padding:0;border-radius:50%}#srPanel .sw.on{outline:3px solid #fff}#srPanel table{border-collapse:collapse;width:100%}#srPanel td{padding:3px 8px 3px 0;border-bottom:1px solid #22324a}#srPanel .est{color:#ffc46b;font-size:11px}#srPanel small{color:#9db0c4}#srPanel select{font:inherit;padding:6px}
#srHint{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:7px 13px;border-radius:8px;font:14px system-ui;z-index:40;display:none;pointer-events:none}`;
  function dom() {
    if (ui) return ui;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const p = document.createElement('div'); p.id = 'srPanel'; document.body.appendChild(p);
    const h = document.createElement('div'); h.id = 'srHint'; document.body.appendChild(h);
    p.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) act(b.dataset.a, b.dataset.v); });
    p.addEventListener('change', e => { if (e.target.dataset.a) act(e.target.dataset.a, e.target.value); });
    return ui = { p, h };
  }
  const close = () => { if (ui) ui.p.classList.remove('open'); cur = null; try { document.activeElement && document.activeElement.blur(); } catch (e) {} };
  const emiOf = (P, n) => { const r = RATE / 1200; return P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1); };
  function specRows(type, mods) {
    const s = VehicleDynamics.ptSpec(type); if (!s) return '<tr><td colspan=2>Pedal power: no engine data</td></tr>';
    const b = VehicleDynamics.bench(type, mods), tag = t => t === 'ESTIMATED' ? ' <span class=est>estimated</span>' : ' <small>' + t + '</small>', pw = mods && mods.pw ? mods.pw : 1;
    return `<tr><td>Power</td><td>${Math.round(s.ps * pw)} PS @ ${s.rp} rpm${tag(s.src.engine)}</td></tr><tr><td>Torque</td><td>${Math.round(s.nm * pw)} Nm @ ${s.rt0}${s.rt1 > s.rt0 ? '-' + s.rt1 : ''} rpm</td></tr><tr><td>Kerb weight</td><td>${s.kg + ((mods && mods.mass) || 0)} kg${tag(s.src.weight)}</td></tr>
<tr><td>Gearbox</td><td>${s.cvt ? 'CVT' : s.gears.length + '-speed ' + s.box.toUpperCase()}, ${{ f: 'FWD', r: 'RWD', a: '4WD/AWD', b: 'chain/shaft' }[s.drv]}${tag(s.src.gearing)}</td></tr><tr><td>Fuel</td><td>${s.tank} L ${s.diesel ? 'diesel' : 'petrol'}, ${s.seats} seats</td></tr>
<tr><td>0-100 km/h</td><td>${s.t100 ? s.t100 + ' s listed' + tag(s.src.perf) + ', ' : ''}${b.t100 !== null ? b.t100 + ' s in game' : (b.t60 !== null ? '0-60 ' + b.t60 + ' s in game' : 'n/a')}</td></tr><tr><td>Top speed</td><td>${s.vmax} km/h listed, ${b.top} km/h in game${s.lim ? ' (limited)' : ''}</td></tr>`;
  }
  function renderShop() {
    const c = cur, t = c.type, s0 = VehicleDynamics.ptSpec(t), price = PRICE[t], onRoad = Math.round(price * (1 + RTO)), cash = eco.cash(), down = Math.round(onRoad * DOWN), loan = onRoad - down, emi = emiOf(loan, c.months);
    ui.p.innerHTML = `<div class=l><h2>${c.S.title}</h2><small>Jangaon · cash ${money(cash)}</small>${c.S.list.map(q => `<button class="it ${q === t ? 'on' : ''}" data-a=model data-v=${q}>${nameOf(q)}<br><small>≈ ${money(PRICE[q])}</small></button>`).join('')}</div>
<div class=r><h2>${nameOf(t)}</h2><div>≈ ${money(price)} ex-showroom <span class=est>approximate${s0 && s0.src.price ? '' : ', unsourced estimate'}</span> · on road ≈ ${money(onRoad)} (10% tax and insurance)</div><p>${COLOURS.map((q, i) => `<button class="sw ${i === c.col ? 'on' : ''}" title="${q[0]}" style="background:#${q[1].toString(16).padStart(6, '0')}" data-a=col data-v=${i}></button>`).join('')} <small>${COLOURS[c.col][0]}</small></p>
<table>${specRows(t)}</table><small>${s0 ? s0.src.note : ''} ${s0 ? s0.src.links.map((u, i) => `<a style="color:#9fd0ff" target=_blank rel=noopener href="${u}">source ${i + 1}</a>`).join(' ') : ''}</small><p><button data-a=test>Test drive (2 min)</button><button class=buy data-a=cash ${cash < onRoad ? 'disabled' : ''}>Buy ${money(onRoad)}</button></p>
<p>Loan at ${RATE}% p.a. · ${DOWN * 100}% down ${money(down)} · <select data-a=months>${[12, 24, 36, 48, 60].map(m => `<option value=${m} ${m === c.months ? 'selected' : ''}>${m} EMIs</option>`).join('')}</select> · EMI ${money(emi)} every 3 game days <button class=buy data-a=loan ${cash < down ? 'disabled' : ''}>Finance</button></p><button data-a=close>Close (Esc)</button></div>`;
    ui.p.classList.add('open');
  }
  function nearbyOwned(S) { const out = []; for (const id in save.owned) { const v = live[id]; if (v && Math.hypot(v.g.position.x - S.x, v.g.position.z - S.z) < 45) out.push(id); } return out; }
  function renderShopUp() {
    const c = cur, ids = nearbyOwned(c.S); if (!ids.includes(c.id)) c.id = ids[0];
    if (!c.id) { ui.p.innerHTML = `<div class=r><h2>${c.S.title}</h2><p>Bring a vehicle you own to the workshop. Bought vehicles only: the Crysta and borrowed vehicles cannot be worked on here.</p><button data-a=close>Close (Esc)</button></div>`; ui.p.classList.add('open'); return; }
    const rec = save.owned[c.id], M = modsOf(rec), cash = eco.cash(), v = live[c.id], cond = v._pt ? v._pt.cond : rec.cond === undefined ? 1 : rec.cond, fix = fixCost(rec, v), dm = v._dmg || {};
    ui.p.innerHTML = `<div class=l><h2>${c.S.title}</h2><small>cash ${money(cash)}</small>${ids.map(q => `<button class="it ${q === c.id ? 'on' : ''}" data-a=pick data-v=${q}>${nameOf(save.owned[q].type)}<br><small>${save.owned[q].plate}</small></button>`).join('')}<table>${specRows(rec.type, { pw: M.pw, mass: M.mass, grip: M.grip })}</table></div>
<div class=r>${Object.keys(UPG).map(k => `<div><b>${UPG[k].label}</b><br>${UPG[k].opts.map((o, i) => { const on = ((rec.upg && rec.upg[k]) || 0) === i, pr = uPrice(rec, k, i); return `<button class="${on ? 'on' : ''}" data-a=up data-v="${k}:${i}" ${!on && cash < pr ? 'disabled' : ''}>${o[0]}${pr ? ' ' + money(pr) : ''}</button>`; }).join('')}</div>`).join('')}
<div><b>Paint</b> ${money(Math.max(8000, PRICE[rec.type] * 0.02))}<br>${COLOURS.map((q, i) => `<button class=sw title="${q[0]}" style="background:#${q[1].toString(16).padStart(6, '0')}" data-a=paint data-v=${i}></button>`).join('')}</div>
<p>Condition ${Math.round(cond * 100)}%, dents ${dm.dents ? dm.dents.length : 0}, broken lamps ${(dm.lamps || []).length} <button data-a=fix ${!fix || cash < fix ? 'disabled' : ''}>Repair ${money(fix)}</button></p><button data-a=close>Close (Esc)</button></div>`;
    ui.p.classList.add('open');
  }
  const render = () => cur && (cur.S.list ? renderShop() : renderShopUp());
  function act(a, val) {
    const c = cur; if (!c) return;
    if (a === 'close') return close();
    if (a === 'model') { c.type = val; c.col = 0; const q = c.S.slots[c.S.slots.length - 1]; if (!c.S.slots.some(s => s.type === val)) display(c.S, q, val); }
    if (a === 'col') { c.col = +val; let q = c.S.slots.find(s => s.type === c.type); if (!q) { q = c.S.slots[c.S.slots.length - 1]; display(c.S, q, c.type); } if (q.v) paint(q.v, COLOURS[c.col][1]); }
    if (a === 'months') c.months = +val;
    if (a === 'test') { const t = c.type, col = COLOURS[c.col][1], S = c.S; close(); return testDrive(S, t, col); }
    if (a === 'cash' || a === 'loan') return buy(a === 'loan');
    if (a === 'pick') c.id = val;
    if (a === 'up') { const [k, i] = val.split(':'), rec = save.owned[c.id]; rec.upg = rec.upg || {}; if ((rec.upg[k] || 0) === +i) return; const p = uPrice(rec, k, +i); if (p && !eco.spend(p, 'Upgrade: ' + UPG[k].opts[+i][0])) return say('NOT ENOUGH CASH'); rec.upg[k] = +i; refresh(c.id); }
    if (a === 'paint') { const rec = save.owned[c.id], p = Math.max(8000, PRICE[rec.type] * 0.02); if (!eco.spend(p, 'Paint job')) return say('NOT ENOUGH CASH'); rec.colour = COLOURS[+val][1]; paint(live[c.id], rec.colour); persist(); }
    if (a === 'fix') { const rec = save.owned[c.id], v = live[c.id], p = fixCost(rec, v); if (p && eco.spend(p, 'Repair')) { rec.cond = 1; rec.dmg = null; if (v._pt) v._pt.cond = 1; repairBody(v); persist(); } }
    render();
  }
  function refresh(id) { const v = live[id], rec = save.owned[id]; setLooks(v, rec); rec.fuel = v._pt ? v._pt.fuel : rec.fuel; tune(v, rec); persist(); if (window.Economy) Economy.addVehicle(entry(id)); }
  const entry = id => { const r = save.owned[id]; return { id, name: nameOf(r.type), model: r.type, colour: r.colour, plate: r.plate, upg: r.upg }; };
  function plateNew() { const n = 1000 + Math.floor(Math.random() * 9000); return 'TG 27 TR ' + n; }
  function plateFinal() { const L = 'ABCDEFGHJKLMNPRSTUVWXYZ', a = L[Math.floor(Math.random() * L.length)], b = L[Math.floor(Math.random() * L.length)]; return 'TG 27 ' + a + b + ' ' + (1000 + Math.floor(Math.random() * 9000)); }
  function buy(loan) {
    const c = cur, onRoad = Math.round(PRICE[c.type] * (1 + RTO)), down = Math.round(onRoad * DOWN), pay = loan ? down : onRoad;
    if (!eco.spend(pay, (loan ? 'Down payment: ' : 'Bought ') + nameOf(c.type))) return say('NOT ENOUGH CASH');
    const id = 'own' + (++save.seq) + '-' + c.type, S = c.S, q = S.L(0, S.d / 2 + 7);
    save.owned[id] = { type: c.type, colour: COLOURS[c.col][1], plate: plateNew(), perm: false, regAt: save.play + REG_AFTER, x: q.x, z: q.z, rot: S.ang + Math.PI / 2, fuel: 1, cond: 1, odo: 0, upg: {} };
    if (loan) { const P = onRoad - down; save.owned[id].loan = { emi: Math.round(emiOf(P, c.months)), left: c.months, next: save.play + EMI_EVERY, due: 0 }; }
    spawnOwned(id); persist(); if (window.Economy) Economy.addVehicle(entry(id));
    say('DELIVERED TO THE FORECOURT'); notify(nameOf(c.type) + ' delivered at ' + S.title + ', Jangaon. Temporary number ' + save.owned[id].plate + '.' + (loan ? ' EMI ' + money(save.owned[id].loan.emi) + '.' : ''));
    close(); return id;
  }
  // ---------------------------------------------------------------- test drive
  let test = null;
  function testDrive(S, type, colour) {
    if (test) endTest();
    const q = S.L(0, S.d / 2 + 7), v = make(type, colour); v.g.position.set(q.x, typeof groundY === 'function' ? groundY(q.x, q.z) : 0, q.z); v.g.rotation.y = S.ang + Math.PI / 2; scene.add(v.g);
    fitPlate(v, 'TEST DRIVE', true); Player.addParked(v); v.onTaken = () => { const ty = v.g.userData.type; v.p = Object.assign({}, Player.PARAMS[ty] || v.p); };
    G.carPos.set ? G.carPos.set(q.x - Math.cos(S.ang) * 0, G.carPos.y || 0, q.z - 0) : 0;
    test = { v, S, t: 120, q };
    Player.toggle(); if (Player.active !== v) { endTest('COULD NOT START THE TEST DRIVE'); return null; }
    say('TEST DRIVE: 2 MINUTES'); return v;
  }
  function endTest(msg) {
    const T = test; if (!T) return; test = null;
    if (Player.active === T.v && Player.mode === 'vehicle') Player.toggle();
    const L = Player.parkedList, i = L.indexOf(T.v); if (i >= 0) L.splice(i, 1);
    scene.remove(T.v.g); const p = T.S.L(0, T.S.d / 2 + 2); if (G.carPos.set) G.carPos.set(p.x, G.carPos.y, p.z); say(msg || 'TEST DRIVE OVER');
  }
  // ---------------------------------------------------------------- per-frame
  function here() {
    const p = G.carPos; let best = null;
    for (const S of sites) { const dx = p.x - S.x, dz = p.z - S.z, a = dx * Math.cos(S.ang) - dz * Math.sin(S.ang), b = dx * Math.sin(S.ang) + dz * Math.cos(S.ang); if (Math.abs(a) < S.w / 2 + (S.list ? 0 : 8) && b > -S.d / 2 && b < S.d / 2 + (S.list ? 1 : 14)) best = S; }
    return best;
  }
  const bunk = () => { const p = G.carPos; return (world.landmarks || []).find(l => l.k === 'fuel' && Math.hypot(l.x - p.x, l.z - p.z) < 24); };
  let acc = 0, lastV = 0, lamp = null;
  function update(dt) {
    dom(); save.play += dt;
    const cam = G.camera.position, p = G.carPos;
    // one shared interior light, on the nearest shop: the light count never changes, so no shader rebuild
    let nearS = null, nd = 70; for (const S of sites) { const d = Math.hypot(cam.x - S.x, cam.z - S.z); if (d < nd) { nd = d; nearS = S; } }
    lamp.intensity = nearS ? 1.5 : 0; if (nearS) lamp.position.set(nearS.x, nearS.y + 4.4, nearS.z);
    for (const S of sites) { const d = Math.hypot(cam.x - S.x, cam.z - S.z); S.g.visible = d < 500; if (d < 150) fill(S); if (S.roof) S.roof.visible = !(Math.hypot(p.x - S.x, p.z - S.z) < Math.max(S.w, S.d) / 2 + 1 && Player.mode === 'foot'); S.slots.forEach((q, i) => { if (i === 4 || S.slots.length < 5 && i === 3) q.P.rotation.y += dt * 0.25; }); }
    const a = Player.mode === 'vehicle' && Player.active;
    if (a) {
      const sp = Math.abs(a.vF || 0); a._odo = (a._odo || 0) + sp * dt / 1000;
      checkImpact(a);
      if (a._pt && lastV - sp > 7) { a._pt.cond = Math.max(0.3, a._pt.cond - (lastV - sp) * 0.012); if (a._ownedId && save.owned[a._ownedId]) save.owned[a._ownedId].cond = a._pt.cond; }
      lastV = sp;
    } else lastV = 0;
    if (test) { test.t -= dt; if (test.t <= 0 || Player.active !== test.v) endTest(); }
    if ((acc += dt) > 1) {
      acc = 0;
      for (const id in save.owned) {
        const r = save.owned[id], v = live[id]; if (!v) continue;
        r.x = v.g.position.x; r.z = v.g.position.z; r.rot = v.g.rotation.y; if (v._pt) r.fuel = v._pt.fuel; r.odo = v._odo || r.odo;
        if (!r.perm && save.play >= r.regAt) { r.plate = plateFinal(); r.perm = true; persist(); fitPlate(v, r.plate, false); notify('Registration done: ' + nameOf(r.type) + ' is now ' + r.plate + '.'); if (window.Economy) Economy.addVehicle(entry(id)); }
        if (r.loan && r.loan.left > 0 && save.play >= r.loan.next) {
          r.loan.next += EMI_EVERY;
          if (eco.spend(r.loan.emi, 'EMI: ' + nameOf(r.type))) { r.loan.left--; persist(); notify('EMI ' + money(r.loan.emi) + ' paid, ' + r.loan.left + ' left.'); } else { r.loan.due++; notify('EMI missed on ' + nameOf(r.type) + ': not enough cash. Retrying next cycle.'); r.loan.next = save.play + 960; }
        }
      }
      if (a && a._ownedId) persist();          // parked vehicles don't change: a second open tab must not rewrite the save
      const S = here(), B = bunk(), h = ui.h, stopped = Math.abs(typeof carSpeed === 'number' ? carSpeed : 0) < 5;
      if (cur) h.style.display = 'none';
      else if (S && (Player.mode === 'foot' || !S.list) && stopped) { h.textContent = 'E: ' + (S.list ? 'talk to sales at ' : 'enter ') + S.title; h.style.display = 'block'; }
      else if (B && a && a._pt && stopped) { h.textContent = 'E: fill the tank'; h.style.display = 'block'; }
      else h.style.display = 'none';
    }
  }
  function refuel() {
    const v = Player.active, P = v._pt, s = P.s, L = (1 - P.fuel) * s.tank, cost = Math.round(L * (s.diesel ? 96 : 108));   // approximate Telangana pump prices
    if (cost < 1) return say('TANK FULL');
    if (eco.spend(cost, 'Fuel')) { P.fuel = 1; say(L.toFixed(0) + ' L FILLED · ' + money(cost)); } else say('NOT ENOUGH CASH');
  }
  function open(S) { dom(); cur = S.list ? { S, type: S.list[0], col: 0, months: 36 } : { S, id: null }; render(); }
  function key(e) {
    if (cur && e.code === 'Escape') { close(); return true; }
    if (cur) return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF'].includes(e.code);
    if (e.code !== 'KeyE' || e.repeat) return false;
    const S = here(); if (S && (Player.mode === 'foot' || !S.list)) { open(S); return true; }
    if (bunk() && Player.mode === 'vehicle' && Player.active && Player.active._pt) { refuel(); return true; }
    return false;
  }
  function init(g) {
    G = g; world = g.world; scene = g.scene;
    lamp = new THREE.PointLight(0xfff4e6, 0, 48, 1); scene.add(lamp);
    const J = (window.Jangaon && Jangaon.sites) || {};
    for (const k in SITE_CAT) { const s = J[k] || (PLAN[k] && { x: PLAN[k][0], z: PLAN[k][1], rot: 0, w: PLAN[k][2], d: PLAN[k][3] }); if (s) sites.push(buildSite(k, s)); }
    for (const id in save.owned) try { spawnOwned(id); } catch (e) { console.warn('showroom: could not restore', id, e); }
  }
  GameHooks.init.push(init);
  GameHooks.update.push(dt => { if (G) update(dt); });
  GameHooks.key.push(e => key(e));
  return { sites, open, close, act, PRICE, COLOURS, UPG, modsOf, get owned() { return save.owned; }, get live() { return live; }, get test() { return test; }, get cur() { return cur; }, endTest, impact, repairBody, bunk, emiOf, play: n => { save.play += n; } };
})();
