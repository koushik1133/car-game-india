// jobs.js: paid driving work.
//  BUS  RTC-style routes between Nellutla and Jangaon on the real road graph, with a timetable. Sign on at a stop (E or
//       the pill), drive the duty bus: door, stop request, indicators, wipers, parking brake, ticket machine. Passengers
//       wait, board, ring the bell and alight. Salary per trip by route, plus penalties. Two AI buses work the same road
//       through the normal traffic AI. Conductor: ride an AI bus (single player), or a player's bus in multiplayer.
//  TAXI Autos always, cars after O (roof sign): people hail at the roadside and at the Auto Stand, the phone Rides app
//       lists bookings, the meter runs by distance, tips follow driving quality. Fares go through Economy.
// Bus keys while on duty: 1 door, 2 ticket, 3 bell, 4 wipers, 5 parking brake, [ ] indicators. Every control is also an
// on-screen button, so touch needs nothing extra. Duty is not resumed after a reload; totals are saved ('nellutla.jobs').
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;
  const T = THREE, KEY = 'nellutla.jobs', GM = 24 * 60 / 960;   // game minutes per real second
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gy = (x, z) => (typeof groundY === 'function' ? groundY(x, z) : 0);
  const hhmm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'); };
  let G = null, world = null, ready = false, stats = { trips: 0, busPay: 0, condPay: 0, rides: 0, taxiPay: 0, ratingSum: 0 };
  const pop = t => G && G.showPopup(t), P = () => Player, nowMin = () => timeOfDay * 60;
  const earn = (n, r) => { if (n > 0) Economy.earn(n, r); persist(); };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) {} };
  const notify = t => { try { window.Phone && Phone.notify(t); } catch (e) {} };
  const way = (x, z, l) => { try { window.Properties && Properties.setWaypoint && Properties.setWaypoint(x, z, l); } catch (e) {} };

  // ---------------------------------------------------------------- people
  const pool = [];
  function person() {
    const h = pool.pop() || HumanModel.create(Object.assign({}, HumanModel.randomAppearance(Math.random() < 0.45 ? 'f' : 'm'), { lod: 'low' }));
    h.group.visible = true; h.group.traverse(m => { if (m.isMesh) m.castShadow = false; }); return h;
  }
  function free(h) { if (h.group.parent) h.group.parent.remove(h.group); HumanModel.animateIdle(h.parts, 0); if (pool.length < 10) pool.push(h); }
  function place(h, x, z) { G.scene.add(h.group); h.group.position.set(x, gy(x, z), z); h.group.rotation.set(0, 0, 0); }
  function walk(n, dt, sp) {
    const g = n.h.group, dx = n.tx - g.position.x, dz = n.tz - g.position.z, d = Math.hypot(dx, dz); if (d < 0.4) return true;
    const st = Math.min(d, sp * dt); g.position.x += dx / d * st; g.position.z += dz / d * st; g.position.y = gy(g.position.x, g.position.z); g.rotation.y = Math.atan2(dx, dz);
    n.ph = (n.ph || 0) + sp * dt * 3.2; HumanModel.animateWalk(n.h.parts, n.ph, sp); return false;
  }
  const saidAt = {};
  function paxSay(id, pos, key) {                          // spoken passenger lines, with a gap so they don't nag
    const k = key || id, now = performance.now(); if (saidAt[k] && now - saidAt[k] < 9000) return false; saidAt[k] = now;
    try { return window.Voice ? Voice.say(Math.random() < 0.45 ? 'villager_f' : 'villager_m', id, { pos, prio: 1 }) : false; } catch (e) { return false; }
  }
  const atCar = () => ({ x: carPos.x, z: carPos.z });
  const walkers = [];                                      // people walking off after alighting
  function leave(h, x, z, ax, az) { place(h, x, z); walkers.push({ h, tx: x + ax * 14, tz: z + az * 14, t: 0 }); }
  function tickWalkers(dt) { for (let i = walkers.length - 1; i >= 0; i--) { const n = walkers[i]; n.t += dt; if (walk(n, dt, 1.4) || n.t > 12) { free(n.h); walkers.splice(i, 1); } } }

  // ---------------------------------------------------------------- routes
  // Real places on the road (map data; source noted). The 7 km of highway between the bunk and town has no named place
  // in OSM or Overture, so the bus runs it without a stop rather than with an invented one.
  const PL = [['Nellutla Bus Stop', null], ['Nellutla Junction (NH-365B)', [-178, -5]], ['Nellutla Petrol Bunk', [-1260, -707]], ['Jangaon RTC', [-1400, -595]]];
  const TOWN_STOPS = [["St. Mary's High School", [-4280, -1368]], ['Ravali Nursing Home', [-3707, -1768]]];   // Overture / OSM
  const ROUTES = [];
  function terminus() {
    const J = window.Jangaon && Jangaon.sites && Jangaon.sites.busStand, b = world.bounds;
    if (J && J.x > b[0] && J.x < b[2] && J.z > b[1] && J.z < b[3]) { const e = J.entry || [J.x, J.z]; return [J.name || 'Jangaon RTC', e]; }
    return PL[PL.length - 1];
  }
  function polyS(p, x, z) {                                // arc length of the nearest point on the polyline
    let acc = 0, best = 1e12, s = 0, nx = 0, nz = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (L * L), 0, 1);
      const q = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); if (q < best) { best = q; s = acc + t * L; nx = a[0] + dx * t; nz = a[1] + dz * t; } acc += L;
    }
    return { s, x: nx, z: nz, L: acc };
  }
  function pathAt(p, s) { for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (s <= L || i === p.length - 2) { const k = clamp(s / (L || 1), 0, 1); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], b[1] - a[1])]; } s -= L; } return [p[0][0], p[0][1], 0]; }
  // Jangaon's streets are in JANGAON_LITE.net, not world.roads, so AutoRides.route stops at the nearest highway node
  let TG = null;
  function townGraph() {
    if (TG) return TG; const key = q => Math.round(q[0]) + ',' + Math.round(q[1]), adj = new Map(), pts = new Map();
    const link = (u, v, line, L) => { (adj.get(u) || adj.set(u, []).get(u)).push([v, line, L]); };
    for (const e of JANGAON_LITE.net.edges) { const p = e[3], u = key(p[0]), v = key(p[p.length - 1]); let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); pts.set(u, p[0]); pts.set(v, p[p.length - 1]); link(u, v, p, L); link(v, u, p.slice().reverse(), L); }
    // keep only the biggest connected piece, so a nearest street end is always reachable
    const seen = new Set(); let best = [];
    pts.forEach((_, k) => { if (seen.has(k)) return; const c = [k]; seen.add(k); for (let i = 0; i < c.length; i++) for (const [v] of adj.get(c[i]) || []) if (!seen.has(v)) { seen.add(v); c.push(v); } if (c.length > best.length) best = c; });
    const main = new Set(best); pts.forEach((_, k) => { if (!main.has(k)) pts.delete(k); });
    return TG = { adj, pts };
  }
  function townNode(x, z) { let k0 = null, d0 = 1e12; townGraph().pts.forEach((q, k) => { const d = Math.hypot(q[0] - x, q[1] - z); if (d < d0) { d0 = d; k0 = k; } }); return k0; }
  function townRoute(A, B) {
    const { adj } = townGraph(), dist = new Map([[A, 0]]), prev = new Map(), open = new Set([A]);
    while (open.size) { let u = null, ud = Infinity; open.forEach(k => { if (dist.get(k) < ud) { ud = dist.get(k); u = k; } }); open.delete(u); if (u === B) break; for (const [v, line, L] of adj.get(u) || []) { const nd = ud + L; if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, [u, line]); open.add(v); } } }
    if (!dist.has(B)) return null;
    const out = []; for (let k = B; prev.has(k); k = prev.get(k)[0]) out.unshift(prev.get(k)[1]);
    let path = []; out.forEach(l => { path = path.concat(path.length ? l.slice(1) : l); }); return path;
  }
  const inVillage = q => { const v = window.JANGAON_LITE ? JANGAON_LITE.v : [-1e9, -1e9, 1e9, 1e9]; return q[0] > v[0] && q[0] < v[2] && q[1] > v[1] && q[1] < v[3]; };
  // a drivable path between any two points, over the village roads and the town streets
  function nav(a, b) {
    const hasTown = window.JANGAON_LITE && JANGAON_LITE.net && Jangaon.ready, ta = !inVillage(a), tb = !inVillage(b);
    if (!hasTown || (!ta && !tb)) return AutoRides.route(a[0], a[1], b[0], b[1]);
    if (ta && tb) return townRoute(townNode(a[0], a[1]), townNode(b[0], b[1]));
    if (ta) { const r = nav(b, a); return r && r.slice().reverse(); }
    const base = AutoRides.route(a[0], a[1], -3788, -33); if (!base) return null;
    let J = null, jd = 1e9, ji = 0; townGraph().pts.forEach((q, k) => base.forEach((h, i) => { const d = Math.hypot(h[0] - q[0], h[1] - q[1]); if (d < jd) { jd = d; J = k; ji = i; } }));
    const t = townRoute(J, townNode(b[0], b[1])); return t && base.slice(0, ji + 1).concat(t);
  }
  function buildRoutes() {
    const home = world.landmarks.find(l => l.k === 'busstop') || { x: -50, z: 60 };
    const end = terminus(), town = !inVillage(end[1]), list = PL.slice(0, -1).concat(town ? TOWN_STOPS : [], [end]); list[0] = [PL[0][0], [home.x, home.z]];
    let path = nav(list[0][1], end[1]);                    // one path: stop-to-stop legs doubled back over sparse road nodes
    if (!path) throw new Error('no road to ' + end[0]);
    path = path.filter((q, i) => !i || Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) > 0.5);
    const road = { p: path, w: 7.5, t: 'highway', bus: true }, L = polyS(path, path[0][0], path[0][1]).L;
    const stops = list.map(([name, q]) => { const o = polyS(path, q[0], q[1]); return { name, s: o.s, x: o.x, z: o.z }; });
    stops.sort((a, b) => a.s - b.s);
    ROUTES.push({ id: '54', name: 'Palle Velugu 54', road, L, stops, base: 420, every: 180, first: 360 });
    ROUTES.push({ id: '54X', name: 'Express 54X', road, L, stops: [stops[0], stops[stops.length - 2], stops[stops.length - 1]], base: 560, every: 240, first: 420 });
    stops.forEach(s => stopPost(s));
  }
  function stopPost(s) {
    const g = new T.Group(), p = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2.6, 5), new T.MeshLambertMaterial({ color: 0x666666 })); p.position.y = 1.3; g.add(p);
    const b = new T.Mesh(new T.BoxGeometry(0.7, 0.45, 0.04), new T.MeshBasicMaterial({ color: 0xc62828 })); b.position.y = 2.5; g.add(b);
    g.position.set(s.x, 0, s.z); s.post = g; G.scene.add(g);
  }
  // kerb position of a stop for a travel direction: left of travel
  function kerb(R, st, dir, off) {
    const q = pathAt(R.road.p, st.s), h = dir > 0 ? q[2] : q[2] + Math.PI, lx = Math.cos(h), lz = -Math.sin(h);
    return { x: q[0] + lx * off, z: q[1] + lz * off, lx, lz };
  }
  const nextDeparture = (R, m) => { let t = R.first; while (t < m + 3) t += R.every; return t > 1260 ? R.first + 1440 : t; };
  const fareOf = (a, b) => Math.max(10, Math.abs(a - b) * 12);

  // ---------------------------------------------------------------- bus visuals: door leaf, indicators, wipers, added to the model
  function fitBus(v) {
    if (v._fit) return v._fit; const paint = new T.MeshLambertMaterial({ color: 0x2e8b3e });
    const door = new T.Mesh(new T.BoxGeometry(0.05, 2.05, 0.9), paint); door.position.set(1.29, 1.65, 4.0); door.name = 'busDoorLeaf'; v.g.add(door);
    const amb = () => new T.MeshBasicMaterial({ color: 0x552200 });
    const ind = [-1, 1].map(s => { const m = amb(), a = new T.Mesh(new T.BoxGeometry(0.16, 0.14, 0.05), m), b = new T.Mesh(a.geometry, m); a.position.set(s * 1.1, 1.3, 5.22); b.position.set(s * 1.1, 1.3, -5.22); v.g.add(a); v.g.add(b); return m; });
    const wip = [-0.55, 0.55].map(x => { const g = new T.Group(), b = new T.Mesh(new T.BoxGeometry(0.03, 0.75, 0.02), new T.MeshBasicMaterial({ color: 0x111111 })); b.position.y = 0.37; g.add(b); g.position.set(x, 1.72, 5.24); v.g.add(g); return g; });
    return v._fit = { door, ind, wip, wt: 0, seated: [] };
  }
  function animBus(v, S, dt) {
    const F = fitBus(v), z = S.door ? 3.15 : 4.0; F.door.position.z += clamp(z - F.door.position.z, -2 * dt, 2 * dt);
    const on = Math.floor(performance.now() / 400) % 2 === 0;
    F.ind[0].color.setHex(S.ind > 0 && on ? 0xffa000 : 0x552200);   // index 0 is x<0: the bus's right
    F.ind[1].color.setHex(S.ind < 0 && on ? 0xffa000 : 0x552200);
    if (S.ind && on !== F.lastOn) { F.lastOn = on; tick(); }
    if (S.wiper) F.wt += dt * 5; const a = S.wiper ? Math.sin(F.wt) * 0.8 : 0.9; F.wip.forEach(w => { w.rotation.z = a; });
  }
  function seatShow(v, n) {
    const F = fitBus(v);
    while (F.seated.length > Math.min(n, 8)) free(F.seated.pop());
    while (F.seated.length < Math.min(n, 8)) { const i = F.seated.length, h = person(); v.g.add(h.group); h.group.position.set((i % 2 ? -1 : 1) * 0.8, 1.35 - h.hipHeight, 2.2 - (i >> 1) * 1.3); h.group.rotation.set(0, 0, 0); HumanModel.sit(h.parts, 'bench'); F.seated.push(h); }
  }
  let actx = null;
  function beep(f, d, type, vol) { try { actx = actx || (window.GameAudio && GameAudio.ctx) || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(vol || 0.05, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d); o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d); } catch (e) {} }
  const tick = () => beep(900, 0.03, 'square', 0.015), ding = () => beep(1250, 0.4, 'sine', 0.08), printer = () => beep(2200, 0.08, 'sawtooth', 0.02);

  // ---------------------------------------------------------------- the player's duty
  let D = null;                                            // duty state
  function signOn(R, o) {
    o = o || {}; if (D) { pop('ALREADY ON DUTY'); return false; } if (P().mode === 'passenger') return false;
    const dir = o.dir || 1, first = dir > 0 ? R.stops[0] : R.stops[R.stops.length - 1];
    const v = TrafficModels.bus(), bay = kerb(R, first, dir, 2.2), h = pathAt(R.road.p, first.s)[2] + (dir > 0 ? 0 : Math.PI);
    const car = Object.assign(v, { model: 'bus', hw: 1.3, len: 10.4, duty: true });
    car.g.position.set(bay.x, 0, bay.z); car.g.rotation.y = h; G.scene.add(car.g); Player.addParked(car);
    D = { R, dir, v: car, idx: 0, list: dir > 0 ? R.stops.slice() : R.stops.slice().reverse(), door: false, ind: 0, wiper: false, park: true, bell: false, pax: [], queue: [], tick: 0, unt: 0, way: 0, pen: 0, bonus: 0, log: [], dep: nextDeparture(R, nowMin()), sent: false, left: false, cond: null, condT: -99, spd: 0, cool: {}, away: 0, phase: 'stand', tripNo: 1, t0: performance.now() };
    D.dues = dues(D); ui(true); pop(R.name.toUpperCase() + ' · DEPARTS ' + hhmm(D.dep) + ' · GET IN (F)'); way(bay.x, bay.z, 'Duty bus'); prepare(D.list[0]); return true;
  }
  function dues(d) { let t = d.dep; const out = [t]; for (let i = 1; i < d.list.length; i++) { t += (Math.abs(d.list[i].s - d.list[i - 1].s) / 9 + 20) * GM; out.push(t); } return out; }
  function prepare(st) {                                   // people at this stop for this trip
    const d = D, i = d.list.indexOf(st), rest = d.list.length - 1 - i; d.queue.forEach(q => free(q.h)); d.queue = [];
    if (rest <= 0) return;
    const n = 1 + (Math.random() * 3 | 0), K = kerb(d.R, st, d.dir, 6.2);
    for (let k = 0; k < n; k++) { const h = person(), x = K.x + (Math.random() - 0.5) * 4, z = K.z + (Math.random() - 0.5) * 4; place(h, x, z); d.queue.push({ h, to: i + 1 + (Math.random() * rest | 0) }); }
  }
  function penalty(key, amt, why, gap) {
    const d = D, now = performance.now(); if (d.cool[key] && now - d.cool[key] < (gap || 8000)) return; d.cool[key] = now; d.pen += amt; d.log.push(why + ' -' + fmt(amt)); pop('PENALTY ' + fmt(amt) + ' · ' + why.toUpperCase());
  }
  function ctl(c) {
    const d = D; if (!d) return false;
    if (c === 'door') { if (d.left) { d.door = !d.door; beep(180, 0.25, 'sawtooth', 0.03); } else pop('GET IN THE BUS'); }
    if (c === 'wiper') d.wiper = !d.wiper;
    if (c === 'park') d.park = !d.park;
    if (c === 'left') d.ind = d.ind === -1 ? 0 : -1;
    if (c === 'right') d.ind = d.ind === 1 ? 0 : 1;
    if (c === 'bell') { d.bell = true; ding(); }
    if (c === 'ticket') issue();
    paint(); return true;
  }
  function issue(byCond) {
    const d = D, p = d.pax.find(q => !q.ticket); if (!p) { if (!byCond) pop('EVERYONE HAS A TICKET'); return 0; }
    p.ticket = true; const f = fareOf(p.to, p.from); d.way += f; printer(); paint(); return f;
  }
  function endTrip() {
    const d = D, base = d.R.base * (d.cond ? 0.85 : 1), comm = Math.round(d.way * 0.08), late = Math.max(0, nowMin() - d.dues[d.dues.length - 1]);
    if (late > 30) { const a = Math.min(200, Math.round(late / 3)); d.pen += a; d.log.push('Late ' + Math.round(late) + ' min -' + fmt(a)); }
    const pay = Math.max(0, Math.round(base + comm + d.bonus - d.pen));
    stats.trips++; stats.busPay += pay; earn(pay, 'RTC ' + d.R.id + ' trip salary');
    pop('TRIP DONE · PAID ' + fmt(pay)); notify(`${d.R.name}: paid ${fmt(pay)} (base ${fmt(base)}, tickets ${fmt(comm)}, bonus ${fmt(d.bonus)}, penalties ${fmt(d.pen)})`);
    d.lastPay = { pay, base, comm, bonus: d.bonus, pen: d.pen, log: d.log.slice() }; Jobs.lastPay = d.lastPay;
    if (typeof MP !== 'undefined' && MP.online && d.cond) MP.send('bus:done', { pay: Math.round(d.way * 0.1) }, { to: d.cond });
    // turn round for the return trip
    d.dir = -d.dir; d.list.reverse(); d.idx = 0; d.way = 0; d.pen = 0; d.bonus = 0; d.log = []; d.pax = []; d.dep = nowMin() + 60; d.dues = dues(d); d.tripNo++; d.phase = 'stand'; d.sent = false; prepare(d.list[0]); paint();
  }
  function signOff() {
    const d = D; if (!d) return; D = null; d.queue.forEach(q => free(q.h)); seatShow(d.v, 0); ui(false);
    if (P().active === d.v && P().mode === 'vehicle') { pop('DUTY ENDED · BUS IS YOURS TILL YOU LEAVE IT'); d.v.duty = false; }
    else { const L = P().parkedList, i = L.indexOf(d.v); if (i >= 0) L.splice(i, 1); G.scene.remove(d.v.g); }
    if (typeof MP !== 'undefined' && MP.online) MP.send('bus:off', {}, { to: 'near', range: 400 });
  }
  function updateDuty(dt) {
    const d = D; if (!d) return; const v = d.v, st = d.list[d.idx], inBus = P().mode === 'vehicle' && P().active === v;
    animBus(v, d, dt); d.left = inBus;
    if (!inBus) { d.away += dt; if (d.away > 90 && d.pax.length) { penalty('aband', 500, 'Bus abandoned', 1e6); } paint(); return; } d.away = 0;
    if (d.park) { v.vF = 0; v.vL = 0; }
    const kmh = Math.abs(carSpeed), dist = Math.hypot(st.x - carPos.x, st.z - carPos.z);
    if (d.door && kmh > 6) penalty('door', 100, 'Moving with door open');
    if (kmh > 72) { penalty('speed', 100, 'Overspeed', 15000); if (d.pax.length) paxSay('px_slow', atCar); }
    if (d.spd - kmh > 22) { penalty('crash', 150, 'Collision or harsh stop', 5000); if (d.pax.length) paxSay('px_slow', atCar); }
    d.spd = kmh;
    if (d.phase === 'stand') {                              // at the first stop: load up, then leave on time
      serve(d, st, dist, kmh, dt);
      if (!d.door && kmh > 4) { d.phase = 'run'; d.idx = 1; prepare(d.list[1]); d.ok = false; d.bell = false; const late = nowMin() - d.dep; if (late < -5) penalty('early', 80, 'Left before time', 1e6); else if (late > 45) penalty('lated', 100, 'Late start', 1e6); else d.bonus += 40; }
    } else if (d.phase === 'run') {
      const n = d.idx, wants = d.pax.some(p => p.to === n);
      if (wants && dist < 260 && !d.bell) { d.bell = true; ding(); paxSay('px_stop', atCar); }
      if (dist < 90 && dist > 12 && d.ind === -1) d.indOk = true;
      if (dist < 16) { d.was = true; if (kmh < 3 && d.door) { d.phase = 'stop'; d.sv = 0; if (d.pax.some(p => p.to === n)) paxSay('px_thanks', atCar); if (!d.indOk) penalty('ind', 30, 'No indicator into the stop', 1000); else d.bonus += 10; } }
      else if (d.was && dist > 34 || dist > d.lastD + 60) {
        // went past
        if (wants || d.queue.length) { penalty('skip' + n, 200, 'Skipped ' + st.name, 1e6); d.pax.filter(p => p.to === n).forEach(p => { p.to = Math.min(d.list.length - 1, n + 1); }); }
        advance(d);
      }
      d.lastD = Math.min(d.lastD === undefined ? 1e9 : d.lastD, dist);
    } else if (d.phase === 'stop') {
      serve(d, st, dist, kmh, dt);
      if (d.idx === d.list.length - 1) { if (!d.pax.length && !d.proc) endTrip(); }
      else if (!d.door && kmh > 2) { if (d.queue.length) penalty('leftp', 50, 'Left people at the stop', 2000); advance(d); }
    }
    seatShow(v, d.pax.length);
  }
  function advance(d) { d.idx = Math.min(d.idx + 1, d.list.length - 1); d.phase = 'run'; d.bell = false; d.ok = false; d.was = false; d.indOk = false; d.lastD = undefined; prepare(d.list[d.idx]); const s = d.list[d.idx]; way(s.x, s.z, s.name); }
  // door open at a stop: people get off one at a time, then on
  function serve(d, st, dist, kmh, dt) {
    if (!d.door || kmh > 3 || dist > 24) { d.proc = null; return; }
    if ((d.sv = (d.sv || 0) - dt) > 0) return; d.sv = 0.9; d.proc = true;
    const i = d.idx, off = d.pax.findIndex(p => p.to <= i), r = d.v.g.rotation.y, lx = Math.cos(r), lz = -Math.sin(r), fx = Math.sin(r), fz = Math.cos(r);
    const dx = d.v.g.position.x + lx * 2 + fx * 4, dz = d.v.g.position.z + lz * 2 + fz * 4;
    if (off >= 0) { const p = d.pax.splice(off, 1)[0]; if (!p.ticket) { penalty('tk', 50, 'Passenger without a ticket', 200); } leave(person(), dx, dz, lx, lz); paint(); return; }
    if (d.queue.length && d.pax.length < 40) { const q = d.queue.shift(); free(q.h); d.pax.push({ to: q.to, from: i, ticket: false }); paint(); return; }
    d.proc = null;
  }

  // ---------------------------------------------------------------- AI buses on the same road
  const AI = [];
  function spawnAI(R, frac, dir) {
    const v = TrafficModels.bus(), s = R.L * frac, spd = 11;
    const t = Object.assign(v, { model: 'bus', r: R.road, len: R.L, s, dir, speed: spd, cur: spd, len2: v.len / 2, wheelR: 0.4, drv: 1, K: { acc: 0.8, brk: 4, hw: 1.9, gap: 3 }, lat: null, latT: null, latV: 0, mode: 'drive', modeT: 0, stuckT: 0, tries: 0, followT: 0 });
    t.aiRoute = R; t.base = spd; t.dwell = 0; t.visited = -1; G.scene.add(t.g); G.traffic.push(t); fitBus(t); t.bs = { door: false, ind: 0, wiper: false }; t.pax = 6; t.ppl = []; t.lastDir = dir; AI.push(t); return t;
  }
  function updateAI(dt) {
    for (const t of AI) {
      if (t.taken) continue;
      if (P().active === t) { if (Cond && Cond.bus === t) continue; t.taken = true; continue; }
      if (t.r !== t.aiRoute.road) { t.r = t.aiRoute.road; t.len = t.aiRoute.L; t.s = clamp(t.s, 0, t.len); }   // traffic respawn: back on the route
      if (t.lastDir !== t.dir) { t.lastDir = t.dir; t.visited = -1; }
      animBus(t, t.bs, dt); aiPeople(t, dt);
      if (t.dwell > 0) {
        t.dwell -= dt; if (t.dwell <= 0 && t.ppl.length) t.dwell = 0.2; t.bs.door = t.dwell > 1; t.bs.ind = 0;
        if (t.dwell <= 0) { t.speed = t.base; t.visited = t.stopNo; } continue;
      }
      const stops = t.aiRoute.stops; let k = -1;
      for (let i = 0; i < stops.length; i++) { const ds = (stops[i].s - t.s) * t.dir; if (ds > -3 && ds < 30 && i !== t.visited) k = i; }
      if (k >= 0) { const ds = Math.abs(stops[k].s - t.s); t.bs.ind = -1; t.speed = Math.max(1.2, t.base * clamp(ds / 30, 0, 1)); if (ds < 3) { t.speed = 0; t.stopNo = k; t.dwell = 8; t.served = (t.served || 0) + 1; Jobs.aiStops++; aiLoad(t, k); } }
      else t.speed = t.base;
    }
  }
  function aiDoor(t) { const r = t.g.rotation.y, lx = Math.cos(r), lz = -Math.sin(r), fx = Math.sin(r), fz = Math.cos(r); return { x: t.g.position.x + lx * 1.5 + fx * 3.15, z: t.g.position.z + lz * 1.5 + fz * 3.15, lx, lz, fx, fz }; }
  function aiLoad(t, k) {                                  // who gets off and on; the people are only drawn near the player
    const last = t.dir > 0 ? t.aiRoute.stops.length - 1 : 0, off = k === last ? t.pax : Math.min(t.pax, Math.random() * 3 | 0), on = k === last ? 2 : 1 + (Math.random() * 3 | 0), Q = aiDoor(t), seen = dist2(t) < 220 * 220;
    t.pax += on - off; t.loads = (t.loads || 0) + on; if (k === last) t.routes = (t.routes || 0) + 1; if (!seen) return;
    for (let i = 0; i < Math.min(off, 3); i++) leave(person(), Q.x + Q.fx * i * 0.5, Q.z + Q.fz * i * 0.5, Q.lx, Q.lz);
    for (let i = 0; i < on; i++) { const h = person(), x = Q.x + Q.lx * (4 + i) + Q.fx * (i - 1), z = Q.z + Q.lz * (4 + i) + Q.fz * (i - 1); place(h, x, z); t.ppl.push({ h, tx: Q.x, tz: Q.z, t: 0 }); }
    if (off) paxSay('px_thanks', () => ({ x: Q.x, z: Q.z }), 'aibus');
  }
  function aiPeople(t, dt) { for (let i = t.ppl.length - 1; i >= 0; i--) { const n = t.ppl[i]; n.t += dt; if (t.dwell > 0 && t.dwell < 7 && walk(n, dt, 1.5) || n.t > 14) { free(n.h); t.ppl.splice(i, 1); } } }

  // ---------------------------------------------------------------- conductor on an AI bus (single player)
  let Cond = null;
  function joinCond(t) {
    if (D || Cond || P().mode !== 'foot') return false; t = t || AI.filter(a => !a.taken).sort((a, b) => dist2(a) - dist2(b))[0]; if (!t) return false;
    if (dist2(t) > 45 * 45 || !P().enterPassenger(t, [0.7, 1.3, 3.0, 'bench'])) { pop('WAIT FOR THE BUS AT THE STOP'); return false; }
    Cond = { bus: t, pax: [], way: 0, v: 0, wait: 6, right: false, stop: nearStop(t), paid: 0, s: t.s }; t.cur = 0; t.speed = 0; ui(true); board(Cond); pop('CONDUCTOR · TICKETS, THEN BELL TO GO'); return true;
  }
  const dist2 = t => { const dx = t.g.position.x - carPos.x, dz = t.g.position.z - carPos.z; return dx * dx + dz * dz; };
  function nearStop(t) { let b = 0, bd = 1e12; t.aiRoute.stops.forEach((s, i) => { const d = Math.abs(s.s - t.s); if (d < bd) { bd = d; b = i; } }); return b; }
  function board(C) {
    const st = C.bus.aiRoute.stops, end = C.bus.dir > 0 ? st.length - 1 : 0;
    C.pax = C.pax.filter(p => p.to !== C.stop); if (C.stop === end) return;
    for (let i = 0, n = 1 + (Math.random() * 3 | 0); i < n; i++) { const left = Math.abs(end - C.stop), to = C.stop + C.bus.dir * (1 + (Math.random() * left | 0)); C.pax.push({ to, from: C.stop, ticket: false }); }
    C.right = false; C.wait = 12; paint();
  }
  function condTicket() { const C = Cond, p = C && C.pax.find(q => !q.ticket); if (!p) return 0; p.ticket = true; const f = fareOf(p.to, p.from); C.way += f; printer(); paint(); return f; }
  function condBell() { if (!Cond) return; if (Cond.pax.some(p => !p.ticket)) { pop('ISSUE ALL TICKETS FIRST'); return; } Cond.right = true; ding(); pop('రైట్ రైట్!'); }
  function condEnd(early) {
    const C = Cond; if (!C) return; Cond = null; ui(false); const t = C.bus, pay = early ? 0 : Math.round(150 + C.way * 0.1);
    if (pay) { stats.condPay += pay; earn(pay, 'RTC conductor trip'); pop('CONDUCTOR PAY ' + fmt(pay)); }
    t.speed = t.base; t.cur = 0; if (!G.traffic.includes(t)) G.traffic.push(t); if (t.len < 100) { t.len = t.aiRoute.L; } t.len2 = 5.2; t.visited = C.stop; t.taken = false; t.bs.door = false; if (!early) P().leavePassenger();
    if (!early) t.dir = -t.dir; Jobs.lastCond = pay;
  }
  function updateCond(dt) {
    const C = Cond; if (!C) return; const t = C.bus, st = t.aiRoute.stops, p = t.aiRoute.road.p;
    if (P().active !== t) { condEnd(true); return; }
    animBus(t, t.bs, dt); seatShow(t, C.pax.length);
    const target = st[C.stop + t.dir];
    if (C.right || C.wait <= 0 && !C.pax.some(q => !q.ticket)) { C.go = true; }
    else C.wait -= dt;
    t.bs.door = !C.go; if (!C.go) { t.kmh = 0; return; }
    if (!target) { condEnd(false); return; }
    const rem = Math.abs(target.s - t.s); C.v = Math.min(C.v + 1 * dt, Math.min(12, rem / 2.5 + 0.4)); t.s += t.dir * C.v * dt; t.kmh = C.v * 3.6;
    const q = pathAt(p, t.s), h = q[2] + (t.dir > 0 ? 0 : Math.PI), lx = Math.cos(h), lz = -Math.sin(h), x = q[0] + lx * 2, z = q[1] + lz * 2;
    t.g.position.set(x, gy(x, z), z); t.g.rotation.y += Math.atan2(Math.sin(h - t.g.rotation.y), Math.cos(h - t.g.rotation.y)) * Math.min(1, dt * 3);
    if (rem < 1) { C.stop += t.dir; C.go = false; C.right = false; C.v = 0; if (C.stop === 0 || C.stop === st.length - 1) condEnd(false); else board(C); }
  }

  // ---------------------------------------------------------------- multiplayer: a player's bus with a player conductor
  // Driver sends bus:st to nearby players each second. The rider (MP.ride, seat from mp.js) answers with bus:tk / bus:rt.
  let remoteBus = null;
  function initMP() {
    if (typeof MP === 'undefined' || !MP.on) return;
    MP.on('bus:st', (m, msg) => { remoteBus = Object.assign(m, { from: msg.from, t: performance.now() }); if (MP.ride && MP.ride.driver === msg.from) { ui(true); paint(); } });
    MP.on('bus:off', (m, msg) => { if (remoteBus && remoteBus.from === msg.from) { remoteBus = null; ui(!!D || !!Cond); } });
    MP.on('bus:tk', (m, msg) => { if (!D) return; D.cond = msg.from; D.condT = performance.now(); const f = issue(true); if (f) MP.send('bus:fee', { f: Math.round(f * 0.1) }, { to: msg.from }); });
    MP.on('bus:rt', (m, msg) => { if (!D) return; D.cond = msg.from; D.condT = performance.now(); ding(); pop('CONDUCTOR: RIGHT RIGHT'); });
    MP.on('bus:fee', m => { if (m && m.f > 0 && m.f <= 20) { stats.condPay += m.f; earn(m.f, 'Conductor ticket share'); } });
    MP.on('bus:done', m => { if (m && m.pay > 0 && m.pay < 2000) { stats.condPay += m.pay; earn(m.pay, 'Conductor trip share'); pop('CONDUCTOR SHARE ' + fmt(m.pay)); } });
  }
  const riderOnBus = () => !!(remoteBus && typeof MP !== 'undefined' && MP.ride && MP.ride.driver === remoteBus.from && performance.now() - remoteBus.t < 4000);
  let mpT = 0;
  function tickMP(dt) {
    if (!D || typeof MP === 'undefined' || !MP.online || (mpT += dt) < 1) return; mpT = 0;
    MP.send('bus:st', { r: D.R.id, st: D.list[D.idx].name, pax: D.pax.length, un: D.pax.filter(p => !p.ticket).length, door: D.door }, { to: 'near', range: 400 });
  }

  // ---------------------------------------------------------------- taxi
  let X = null, hailT = 6, offers = [], bookT = 0;         // X: { v, kind, n?, stage, ... }
  const LOT = () => (window.Parked && Parked.lots || []).find(l => l.name === 'Auto Stand');
  function taxiCar(v) { return !!v && (v.model === 'auto' ? !v.noTaxi : !!v.taxi); }
  function roof(v, on) {
    if (on && !v._roof) { const c = document.createElement('canvas'); c.width = 128; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#fbbf24'; x.fillRect(0, 0, 128, 40); x.fillStyle = '#111'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.fillText('TAXI', 64, 31); const m = new T.Mesh(new T.BoxGeometry(0.7, 0.2, 0.26), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c) })); const b = new T.Box3().setFromObject(v.g); m.position.set(0, b.max.y - v.g.position.y + 0.08, 0); v.g.add(m); v._roof = m; }
    else if (!on && v._roof) { v.g.remove(v._roof); v._roof = null; }
  }
  function toggleTaxi() {
    const v = P().active; if (P().mode !== 'vehicle' || !v) { pop('GET IN A CAR OR AUTO'); return false; }
    if (v.model === 'auto') { v.noTaxi = !v.noTaxi; pop(v.noTaxi ? 'AUTO OFF DUTY' : 'AUTO ON DUTY'); return true; }
    if (!['hatch', 'suv'].includes(v.model)) { pop('ONLY CARS CAN RUN AS TAXIS'); return false; }
    v.taxi = !v.taxi; roof(v, v.taxi); pop(v.taxi ? 'TAXI ON DUTY' : 'TAXI OFF DUTY'); return true;
  }
  function roadside(x, z) { const nr = world.nearestRoad(x, z, r => r.t !== 'dirt'); if (!nr) return null; const lx = Math.cos(nr.ang), lz = -Math.sin(nr.ang), s = Math.random() < 0.5 ? 1 : -1, w = nr.r.w / 2 + 1.6; return { x: nr.x + lx * s * w, z: nr.z + lz * s * w }; }
  function hailer(q) { const h = person(); place(h, q.x, q.z); return { h, x: q.x, z: q.z, t: 0, state: 'wave' }; }
  const dests = (x, z) => { const c = world.landmarks.filter(l => { const d = Math.hypot(l.x - x, l.z - z); return d > 200 && d < 1700 && l.k !== 'sign'; }); return c[Math.random() * c.length | 0] || world.landmarks[0]; };
  function spawnHail(at) {
    if (X && X.n) return null; const v = P().active; let q;
    if (at) q = at; else { const r = v.g.rotation.y, d = 60 + Math.random() * 70; q = roadside(carPos.x + Math.sin(r) * d, carPos.z + Math.cos(r) * d); } if (!q) return null;
    X.n = hailer(q); X.stage = 'pickup'; X.dest = dests(q.x, q.z); X.tMax = 90; return X.n;
  }
  const ratePer100 = k => (k === 'auto' ? 2 : 3), flag = k => (k === 'auto' ? 25 : 40);
  function meter(x) { return flag(x.kind) + Math.max(0, x.m - 400) / 100 * ratePer100(x.kind); }
  function drop(reason) { if (X && X.n) { if (X.n.state === 'ride') { unseat(X.n, X.v); } else { X.n.state = 'gone'; free(X.n.h); } X.n = null; } if (X) { X.stage = 'free'; } hud(''); if (reason) pop(reason); }
  function seatPax(n, v) { n.h.group.parent.remove(n.h.group); v.g.add(n.h.group); if (v.model === 'auto') { n.h.group.position.set(0.3, 0.88 - n.h.hipHeight, -0.85); HumanModel.sit(n.h.parts, 'bench'); } else n.h.group.visible = false; n.h.group.rotation.set(0, 0, 0); n.state = 'ride'; }
  function unseat(n, v) { n.h.group.visible = true; v.g.remove(n.h.group); const r = v.g.rotation.y, lx = Math.cos(r), lz = -Math.sin(r); leave(n.h, v.g.position.x + lx * 1.4, v.g.position.z + lz * 1.4, lx, lz); }
  function updateTaxi(dt) {
    const v = P().mode === 'vehicle' ? P().active : null, on = taxiCar(v) && !D;
    if (!on) { if (X) { const had = X.n; drop(had ? 'PASSENGER LEFT · NO FARE' : ''); X = null; hud(''); } return; }
    if (!X || X.v !== v) X = { v, kind: v.model === 'auto' ? 'auto' : 'taxi', stage: 'free', q: 5, n: null, m: 0, spd: 0 };
    const kmh = Math.abs(carSpeed), x = X;
    if (x.stage === 'free') {
      hud('For hire');
      const lot = LOT(), atStand = lot && Math.hypot(lot.x - carPos.x, lot.z - carPos.z) < 40 && kmh < 6;
      if ((hailT -= dt * (atStand ? 4 : 1)) <= 0) { hailT = 14 + Math.random() * 14; spawnHail(atStand ? roadside(carPos.x + 4, carPos.z + 4) : null); if (x.n) pop('PASSENGER WAVING AHEAD'); }
      return;
    }
    if (x.stage === 'pickup') {
      const n = x.n, g = n.h.group, d = Math.hypot(g.position.x - carPos.x, g.position.z - carPos.z);
      n.t += dt; g.rotation.y = Math.atan2(carPos.x - g.position.x, carPos.z - g.position.z); if (n.h.parts.armR) n.h.parts.armR.rotation.set(-2.7 + Math.sin(n.t * 8) * 0.25, 0, -0.25);
      hud('Pick up · ' + Math.round(d) + ' m');
      if (d < 10 && kmh < 4) { n.tx = carPos.x; n.tz = carPos.z; if (walk(n, dt, 2.4) || d < 2.2 || (n.w = (n.w || 0) + dt) > 6) { seatPax(n, v); x.stage = 'ride'; x.m = 0; x.q = 5; x.lx = carPos.x; x.lz = carPos.z; x.spd = kmh; way(x.dest.x, x.dest.z, x.dest.name); pop('TO ' + x.dest.name.toUpperCase() + ' · METER ON'); } }
      else if (d > 260 || (x.tMax -= dt) < 0 && !x.booked) drop('');
      return;
    }
    const step = Math.hypot(carPos.x - x.lx, carPos.z - x.lz); x.lx = carPos.x; x.lz = carPos.z; if (step < 40) x.m += step;
    if (x.spd - kmh > 18) { x.q = Math.max(0, x.q - 1); pop('EASY! RATING ' + x.q.toFixed(1)); paxSay('px_slow', atCar); }
    if (kmh > (x.kind === 'auto' ? 50 : 75)) x.q = Math.max(0, x.q - dt * 0.15);
    x.spd = kmh;
    const d = Math.hypot(x.dest.x - carPos.x, x.dest.z - carPos.z), fare = meter(x);
    hud(`Meter ${fmt(fare)} · ${(x.m / 1000).toFixed(2)} km · to ${x.dest.name} ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} · ★${x.q.toFixed(1)}`);
    if (d < 120 && !x.saidStop) { x.saidStop = true; paxSay('px_stop', atCar); }
    if (d < 25 && kmh < 4) {
      const tip = Math.round(fare * clamp((x.q - 3) / 2, 0, 1) * 0.25), f = Math.round(fare);
      unseat(x.n, v); x.n = null; x.stage = 'free'; stats.rides++; stats.taxiPay += f + tip; stats.ratingSum += x.q; earn(f, (x.kind === 'auto' ? 'Auto' : 'Taxi') + ' fare'); if (tip) earn(tip, 'Tip');
      Jobs.lastFare = { fare: f, tip, rating: x.q, m: x.m }; pop('FARE ' + fmt(f) + (tip ? ' + TIP ' + fmt(tip) : ' · NO TIP') + ' · ★' + x.q.toFixed(1)); hud(''); hailT = 8; x.booked = false; x.saidStop = false; paxSay(tip >= f * 0.1 ? 'px_good' : 'px_thanks', atCar);
    }
  }
  function makeOffers() {
    offers = []; for (let i = 0; i < 3; i++) { const l = world.landmarks[Math.random() * world.landmarks.length | 0], q = roadside(l.x, l.z); if (q) offers.push({ q, name: l.name }); }
  }
  function accept(i) {
    const o = offers[i]; if (!o || !X || X.stage !== 'free') { pop('BE IN A FREE AUTO OR TAXI'); return false; }
    spawnHail(o.q); X.booked = true; way(o.q.x, o.q.z, 'Pickup: ' + o.name); pop('BOOKING ACCEPTED · ' + o.name.toUpperCase()); offers.splice(i, 1); return true;
  }
  function ridesApp(c) {
    if (!offers.length) makeOffers();
    c.innerHTML = `<div style="font:13px/1.4 system-ui;padding:6px"><b>Rides · bookings</b><br>Rides ${stats.rides} · earned ${fmt(stats.taxiPay)} · rating ${stats.rides ? (stats.ratingSum / stats.rides).toFixed(1) : '-'}<hr>` + offers.map((o, i) => `<div class="ph-item" data-i="${i}" style="padding:8px;border-bottom:1px solid #4445;cursor:pointer">Pickup at ${o.name} · ${Math.round(Math.hypot(o.q.x - carPos.x, o.q.z - carPos.z))} m</div>`).join('') + '</div>';
    c.querySelectorAll('.ph-item').forEach(el => el.addEventListener('click', () => { accept(+el.dataset.i); ridesApp(c); }));
  }
  function busApp(c) {
    const m = nowMin(); c.innerHTML = '<div style="font:13px/1.4 system-ui;padding:6px"><b>RTC timetable</b><br>' + ROUTES.map(R => `${R.name}: next ${hhmm(nextDeparture(R, m))}, every ${R.every / 60} h, ${R.stops.map(s => s.name).join(' > ')}`).join('<br><br>') + `<hr>Trips ${stats.trips}, salary ${fmt(stats.busPay)}, conductor ${fmt(stats.condPay)}</div>`;
  }

  // ---------------------------------------------------------------- called taxi: a real car drives here on the roads, then takes you
  let CT = null;
  const polyLen = p => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
  function setLeg(c, path, stage) { c.path = path.filter((q, i) => !i || Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) > 0.5); c.L = polyLen(c.path); c.s = 0; c.stage = stage; }
  function callTaxi(dest, fare) {
    if (CT && CT.stage === 'away') endCT();                // the last cab is only driving off
    if (CT) { pop('TAXI ALREADY BOOKED'); return false; }
    const here = world.nearestRoad(carPos.x, carPos.z, r => r.t !== 'dirt') || world.nearestRoad(carPos.x, carPos.z); if (!here) return false;
    const pick = [here.x, here.z], all = world.landmarks.concat(window.Jangaon && Jangaon.ready ? Jangaon.landmarks : []).filter(l => { const d = Math.hypot(l.x - carPos.x, l.z - carPos.z); return d > 350 && d < 1100; });
    const l = all[Math.random() * all.length | 0] || { x: carPos.x + 500, z: carPos.z }, sr = world.nearestRoad(l.x, l.z, r => r.t !== 'dirt') || here, start = [sr.x, sr.z], come = nav(start, pick);
    const dr = world.nearestRoad(dest.x, dest.z, r => r.t !== 'dirt'), to = dr ? [dr.x, dr.z] : [dest.x, dest.z], go = nav(pick, to);
    if (!come || !go) { pop('NO TAXI CAN REACH YOU HERE'); return false; }
    const v = TrafficModels.hatch(); v.model = 'hatch'; v.taxi = true; roof(v, true); G.scene.add(v.g); v.g.position.set(start[0], gy(start[0], start[1]), start[1]);
    if (come[0]) v.g.rotation.y = Math.atan2(come[Math.min(1, come.length - 1)][0] - start[0], come[Math.min(1, come.length - 1)][1] - start[1]);
    CT = { v, dest, fare, to, go, v0: 0, wait: 0, spd: 0 }; setLeg(CT, [start].concat(come, [pick]), 'come'); way(pick[0], pick[1], 'Taxi pickup'); pop('TAXI ON THE WAY'); return true;
  }
  function endCT() { const c = CT; if (!c) return; CT = null; roof(c.v, false); G.scene.remove(c.v.g); hud(''); }
  function ctPay(frac) { const c = CT, f = Math.max(30, Math.round(c.fare * frac)); Economy.spend(Math.min(f, G.cash), 'Taxi to ' + c.dest.name); return f; }
  function ctAway() { const c = CT, x = c.v.g.position, l = world.landmarks.filter(q => Math.hypot(q.x - x.x, q.z - x.z) > 400)[0], p = l && nav([x.x, x.z], [l.x, l.z]); if (p && p.length > 1) setLeg(c, [[x.x, x.z]].concat(p), 'away'); else endCT(); }
  function updateCT(dt) {
    const c = CT; if (!c) return; const v = c.v, mine = P().active === v && P().mode === 'passenger';
    if (c.stage === 'ride' && !mine) { const fr = clamp(c.s / Math.max(1, c.L), 0.2, 1), f = ctPay(fr); pop('GOT OUT EARLY · PAID ' + fmt(f)); hud(''); ctAway(); return; }
    if (c.stage === 'wait') {
      const d = Math.hypot(v.g.position.x - carPos.x, v.g.position.z - carPos.z); c.wait += dt; hud('Taxi here · walk to it · ' + Math.round(d) + ' m');
      if (d < 3.6 && P().mode === 'foot') {
        if (!P().enterPassenger(v, [0.42, 0.72, -0.55, 'car'])) return;
        setLeg(c, [[v.g.position.x, v.g.position.z]].concat(c.go, [c.to]), 'ride'); way(c.dest.x, c.dest.z, c.dest.name); c.saidStop = false; pop('TO ' + c.dest.name.toUpperCase() + ' · F TO GET OUT'); return;
      }
      if (c.wait > 120) { pop('TAXI LEFT · NO CHARGE'); hud(''); ctAway(); } return;
    }
    const p = c.path, r = c.L - c.s, a = pathAt(p, c.s), b = pathAt(p, Math.min(c.L, c.s + 12)), turn = Math.abs(Math.atan2(Math.sin(b[2] - a[2]), Math.cos(b[2] - a[2])));
    let want = 15 * (1 - Math.min(0.7, turn * 0.7)); want = Math.min(want, r * 0.45 + 0.5);
    if (c.stage !== 'ride') for (const t of G.traffic) { const dx = t.g.position.x - v.g.position.x, dz = t.g.position.z - v.g.position.z; if (dx * dx + dz * dz < 144 && (dx * Math.sin(v.g.rotation.y) + dz * Math.cos(v.g.rotation.y)) > 0) { want = Math.min(want, 3); break; } }
    c.v0 += (want - c.v0) * Math.min(1, dt * 1.3); c.s = Math.min(c.L, c.s + c.v0 * dt);
    const q = pathAt(p, c.s), off = 1.8 * clamp(Math.min(c.s, r) / 8, 0, 1), gx = q[0] + Math.cos(q[2]) * off, gz = q[1] - Math.sin(q[2]) * off, ah = pathAt(p, Math.min(c.L, c.s + 4)), hx = ah[0] - q[0], hz = ah[1] - q[1];
    v.g.position.set(gx, gy(gx, gz), gz); if (Math.hypot(hx, hz) > 0.05) { const h = Math.atan2(hx, hz); v.g.rotation.y += Math.atan2(Math.sin(h - v.g.rotation.y), Math.cos(h - v.g.rotation.y)) * Math.min(1, dt * 5); }
    for (const w of v.wheels || []) w.rotation.x += c.v0 * dt / 0.3; v.kmh = c.v0 * 3.6; v.vF = c.v0;
    if (c.stage === 'come') { hud(`Taxi coming · ${r < 1000 ? Math.round(r) + ' m' : (r / 1000).toFixed(1) + ' km'} away`); if (r < 0.6 && c.v0 < 0.8) { c.stage = 'wait'; c.wait = 0; beep(420, 0.2, 'square', 0.04); pop('TAXI HERE · WALK TO IT'); } return; }
    if (c.stage === 'ride') {
      if (mine) { carPos.x = gx; carPos.z = gz; }
      hud(`To ${c.dest.name} · ${r < 1000 ? Math.round(r) + ' m' : (r / 1000).toFixed(1) + ' km'} · fare ${fmt(c.fare)} · F get out`);
      if (r < 120 && !c.saidStop) { c.saidStop = true; }
      if (r < 0.6 && c.v0 < 0.8) { const f = ctPay(1); P().leavePassenger(); pop('ARRIVED · PAID ' + fmt(f)); hud(''); paxSay('px_thanks', atCar, 'driver'); ctAway(); } return;
    }
    if (r < 1 && Math.hypot(gx - carPos.x, gz - carPos.z) > 120) endCT(); else if (r < 1) ctAway();
  }

  // ---------------------------------------------------------------- UI
  let hudEl = null, barEl = null, pillEl = null, panEl = null;
  const css = `#jobHud{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 86px);transform:translateX(-50%);z-index:7;display:none;max-width:92vw;padding:5px 12px;border-radius:9px;background:rgba(10,15,25,.82);color:#fde68a;font:600 12px system-ui;pointer-events:none;text-align:center}
#busBar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 86px);transform:translateX(-50%);z-index:9;display:none;gap:5px;flex-wrap:wrap;justify-content:center;max-width:min(620px,70vw)}
#busBar button{min-width:52px;min-height:44px;padding:4px 7px;border-radius:9px;border:1px solid #475569;background:rgba(15,23,42,.9);color:#e2e8f0;font:700 11px system-ui;cursor:pointer;touch-action:manipulation}#busBar button.on{background:#b45309;border-color:#fbbf24;color:#fff}
html.touch #busBar{left:6px;right:auto;bottom:auto;top:32%;transform:none;width:118px;max-width:none;gap:3px}html.touch #busBar button{min-width:56px;padding:3px 4px;font-size:10px}
#jobPill{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 196px);transform:translateX(-50%);z-index:9;display:none;min-height:40px;padding:9px 16px;border-radius:20px;border:1px solid #38bdf8;background:rgba(10,30,50,.9);color:#e0f2fe;font:700 13px system-ui;cursor:pointer}
#jobPanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:41;width:min(420px,94vw);max-height:84vh;overflow:auto;background:rgba(10,15,25,.97);color:#e5e7eb;border:1px solid #334155;border-radius:14px;padding:14px;font:13px/1.4 system-ui}#jobPanel h3{margin:0 0 6px;color:#fbbf24}#jobPanel button{display:block;width:100%;min-height:42px;margin:5px 0;padding:8px;border-radius:9px;border:1px solid #334155;background:#111827;color:#fff;font:600 13px system-ui;cursor:pointer;text-align:left}`;
  const hud = t => { if (!hudEl) return; if (hudEl._t !== t) { hudEl._t = t; hudEl.textContent = t; } hudEl.style.display = t ? 'block' : 'none'; };
  function ui(on) { if (barEl) barEl.style.display = on ? 'flex' : 'none'; if (on) paint(); else hud(''); }
  const BTN = [['door', 'DOOR 1'], ['ticket', 'TICKET 2'], ['bell', 'BELL 3'], ['wiper', 'WIPER 4'], ['park', 'P-BRK 5'], ['left', '◀ IND ['], ['right', 'IND ▶ ]'], ['end', 'END']];
  function press(c) {
    if (c === 'end') { if (D) signOff(); else if (Cond) { P().leavePassenger && (Cond.bus, condEnd(true), P().leavePassenger()); } return; }
    if (Cond) { if (c === 'ticket') condTicket(); if (c === 'bell') condBell(); return; }
    if (D) { ctl(c); return; }
    if (riderOnBus()) { if (c === 'ticket') { MP.send('bus:tk', {}, { to: remoteBus.from }); printer(); } if (c === 'bell') { MP.send('bus:rt', {}, { to: remoteBus.from }); ding(); } }
  }
  function paint() {
    if (!barEl) return; const b = barEl.children;
    if (D) {
      const d = D, st = d.list[d.idx], un = d.pax.filter(p => !p.ticket).length, on = { door: d.door, wiper: d.wiper, park: d.park, left: d.ind < 0, right: d.ind > 0, bell: d.bell, ticket: un > 0 };
      for (const e of b) e.classList.toggle('on', !!on[e.dataset.c]);
      hud(`${d.R.id} · ${d.phase === 'stand' ? 'Depart ' + hhmm(d.dep) + ' · ' + st.name : 'Next ' + st.name + ' due ' + hhmm(d.dues[d.idx])}${d.bell ? ' · STOP' : ''} · ${d.pax.length} on board · ${un} no ticket · ${d.queue.length} waiting · tickets ${fmt(d.way)}${d.pen ? ' · penalties ' + fmt(d.pen) : ''}`);
    } else if (Cond) { const C = Cond; hud(`Conductor · ${C.pax.length} on board · ${C.pax.filter(p => !p.ticket).length} no ticket · ${fmt(C.way)} · next ${(C.bus.aiRoute.stops[C.stop + C.bus.dir] || {}).name || 'end'}`); }
    else if (riderOnBus()) hud(`Conductor · ${remoteBus.r} · next ${remoteBus.st} · ${remoteBus.pax} on board · ${remoteBus.un} no ticket`);
  }
  const closeP = () => { if (panEl) { panEl.remove(); panEl = null; } };
  function nearAny() { for (const R of ROUTES) for (const s of R.stops) if (Math.hypot(s.x - carPos.x, s.z - carPos.z) < 22) return s; return null; }
  function depot() {
    closeP(); const m = nowMin(); panEl = document.createElement('div'); panEl.id = 'jobPanel';
    const nearBus = AI.some(a => !a.taken && dist2(a) < 45 * 45);
    panEl.innerHTML = '<h3>' + UI.icon('bus') + ' RTC duty</h3>' + ROUTES.map((R, i) => `<button data-r="${i}">Drive ${R.name} · next ${hhmm(nextDeparture(R, m))} · ${fmt(R.base)} a trip</button>`).join('') + `<button data-c="1" ${nearBus ? '' : 'disabled'}>Conductor on this bus${nearBus ? '' : ' · wait for one here'}</button><button data-x="1">Close</button>`;
    panEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; e.stopPropagation(); closeP(); if (b.dataset.r) { const R = ROUTES[+b.dataset.r], s = nearAny(); signOn(R, { dir: s && s === R.stops[R.stops.length - 1] ? -1 : 1 }); } if (b.dataset.c) joinCond(); });
    document.body.appendChild(panEl);
  }
  function initUI() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    hudEl = document.createElement('div'); hudEl.id = 'jobHud'; document.body.appendChild(hudEl);
    barEl = document.createElement('div'); barEl.id = 'busBar'; barEl.innerHTML = BTN.map(([c, l]) => `<button data-c="${c}">${l}</button>`).join(''); document.body.appendChild(barEl);
    barEl.addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); e.stopPropagation(); press(b.dataset.c); } });
    pillEl = document.createElement('button'); pillEl.id = 'jobPill'; pillEl.textContent = 'RTC duty'; pillEl.addEventListener('click', e => { e.stopPropagation(); depot(); }); document.body.appendChild(pillEl);
  }

  const Jobs = window.Jobs = {
    ROUTES, AI, aiStops: 0, callTaxi, nav, get called() { return CT; }, lastPay: null, lastFare: null, lastCond: null, signOn, signOff, ctl, press, joinCond, condTicket, condBell, toggleTaxi, accept, makeOffers, spawnHail, ridesApp, busApp, depot, fareOf, nextDeparture, hhmm,
    get duty() { return D; }, get cond() { return Cond; }, get taxi() { return X; }, get offers() { return offers; }, get stats() { return stats; }, get remoteBus() { return remoteBus; },
  };
  GameHooks.init.push(g => {
    G = g; world = g.world; try { stats = Object.assign(stats, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    initUI(); initMP();
    try { Phone.addApp({ id: 'rides', name: 'Rides', icon: 'taxi', open: ridesApp }); Phone.addApp({ id: 'rtc', name: 'RTC', icon: 'bus', open: busApp }); } catch (e) {}
  });
  function lateInit() {                                    // AutoRides and Parked exist only after every init hook has run
    if (window.Jangaon && Jangaon.sites && !Jangaon.ready && performance.now() < 40000) return;   // wait for the town streets
    ready = true;
    try {
      buildRoutes(); spawnAI(ROUTES[0], 0.25, 1); spawnAI(ROUTES[0], 0.7, -1);
      ROUTES[0].stops.forEach((s, i) => { try { GameLocations.add('rtc-' + i, { name: s.name, x: s.x, z: s.z, kind: 'bus stop' }); } catch (e) {} });
      console.log('jobs.js: route', Math.round(ROUTES[0].L), 'm,', ROUTES[0].stops.map(s => s.name).join(' > '));
    } catch (e) { console.error('jobs.js routes', e); }
  }
  GameHooks.update.push(dt => {
    if (!G) return; if (!ready) { if (!window.AutoRides) return; lateInit(); }
    tickWalkers(dt); updateDuty(dt); updateAI(dt); updateCond(dt); tickMP(dt); updateTaxi(dt); updateCT(dt);
    if ((bookT += dt) > 45) { bookT = 0; makeOffers(); }
    if (riderOnBus() !== !!(barEl && barEl._rider)) { if (barEl) barEl._rider = riderOnBus(); if (!D && !Cond) ui(riderOnBus()); }
    if (pillEl) { pillEl.style.display = !D && !Cond && P().mode === 'foot' && !panEl && nearAny() ? 'block' : 'none'; }
  });
  GameHooks.key.push(e => {
    if (e.repeat) return false;
    if (e.code === 'Escape' && panEl) { closeP(); return true; }
    if (e.code === 'KeyO') return toggleTaxi();
    if (e.code === 'KeyE' && P().mode === 'foot' && !D && !Cond && nearAny()) { if (panEl) closeP(); else depot(); return true; }
    if (D || Cond || riderOnBus()) { const c = { Digit1: 'door', Digit2: 'ticket', Digit3: 'bell', Digit4: 'wiper', Digit5: 'park', BracketLeft: 'left', BracketRight: 'right' }[e.code]; if (c) { press(c); return true; } }
    return false;
  });
})();
