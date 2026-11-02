// auto-rides.js: auto-rickshaw rides around Nellutla.
//  - Villagers wait at the Auto Stand (Parked.lots) and the Bus Stop. AI autos (from `traffic`) pull over,
//    passengers walk over and sit in the back, ride a few hundred metres and get off near a landmark.
//  - Driving an auto yourself: waiting villagers wave you down. Stop near one, they board, a destination marker
//    appears; deliver them for a fare (added to cash), like a taxi side-job.
//  - On foot, G near the Auto Stand or a stopped / slow AI auto: sit in the back, pick a landmark, the driver
//    takes you there along the real roads (fare charged on arrival). F gets out early.
// Villagers here are HumanModel at the low LOD. Registers on window.GameHooks.
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;
  const T = THREE;
  let G = null, scene = null, world = null;
  const stops = [];            // { name, x, z (crowd), cx, cz (kerb point), pax: [] }
  const npcs = [];             // { h, g, state: wait|board|ride|leave, stop, t, tx, tz, car?, seat? }
  const MAX_WAIT = 3;
  const BENCH = [[-0.3, 0.88, -0.85], [0.3, 0.88, -0.85]];
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const popup = t => G && G.showPopup(t);
  const PL = () => (typeof Player !== 'undefined' ? Player : null);

  // ---------------------------------------------------------------- villagers
  function villager() {
    const g = Math.random() < 0.45 ? 'f' : 'm';
    let a; try { a = HumanModel.randomAppearance(g); } catch (e) { a = { gender: g }; }
    const h = HumanModel.create(Object.assign({}, a, { lod: 'low' }));
    h.group.traverse(m => { if (m.isMesh) m.castShadow = false; });
    return h;
  }
  function spawnWaiting(stop) {
    const h = villager();
    const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.6;
    const x = stop.x + Math.cos(a) * r, z = stop.z + Math.sin(a) * r;
    h.group.position.set(x, 0, z); h.group.rotation.y = Math.atan2(stop.cx - x, stop.cz - z);   // face the road
    scene.add(h.group);
    const n = { h, g: h.group, state: 'wait', stop, t: Math.random() * 10 };
    npcs.push(n); stop.pax.push(n);
    return n;
  }
  function dropNpc(n) {
    const i = npcs.indexOf(n); if (i >= 0) npcs.splice(i, 1);
    if (n.stop) { const k = n.stop.pax.indexOf(n); if (k >= 0) n.stop.pax.splice(k, 1); }
    if (n.g.parent) n.g.parent.remove(n.g);
  }
  // seat a villager in the back of an auto
  function seat(n, car, idx) {
    if (n.stop) { const k = n.stop.pax.indexOf(n); if (k >= 0) n.stop.pax.splice(k, 1); n.stop = null; }
    if (n.g.parent) n.g.parent.remove(n.g);
    const s = BENCH[idx % 2];
    car.g.add(n.g); n.g.position.set(s[0], s[1] - n.h.hipHeight, s[2]); n.g.rotation.set(0, 0, 0);
    HumanModel.sit(n.h.parts, 'bench'); n.state = 'ride'; n.car = car;
  }
  // get out on the kerb side and walk away for a while, then vanish
  function alight(n) {
    const car = n.car; if (!car) return;
    car.g.updateMatrixWorld(true);
    const rot = car.g.rotation.y, lx = Math.cos(rot), lz = -Math.sin(rot);            // car's left (kerb side)
    const x = car.g.position.x + lx * 1.3, z = car.g.position.z + lz * 1.3;
    car.g.remove(n.g); scene.add(n.g);
    n.g.position.set(x, 0, z); n.car = null; n.state = 'leave'; n.t = 0;
    const a = Math.atan2(lx, lz) + (Math.random() - 0.5) * 1.2; n.tx = x + Math.sin(a) * 30; n.tz = z + Math.cos(a) * 30;
    HumanModel.animateIdle(n.h.parts, 0);
  }
  // walk towards (tx, tz); returns true when there
  function walkTo(n, dt, speed) {
    const dx = n.tx - n.g.position.x, dz = n.tz - n.g.position.z, d = Math.hypot(dx, dz);
    if (d < 0.4) return true;
    const st = Math.min(d, speed * dt);
    n.g.position.x += dx / d * st; n.g.position.z += dz / d * st;
    n.g.rotation.y = Math.atan2(dx, dz);
    n.phase = (n.phase || 0) + speed * dt * 3.2; HumanModel.animateWalk(n.h.parts, n.phase, speed);
    return false;
  }
  // the spot behind the auto where a boarding passenger heads
  function doorOf(car) {
    const rot = car.g.rotation.y, lx = Math.cos(rot), lz = -Math.sin(rot), fx = Math.sin(rot), fz = Math.cos(rot);
    return { x: car.g.position.x + lx * 1.1 - fx * 0.6, z: car.g.position.z + lz * 1.1 - fz * 0.6 };
  }
  function clearBack(car) {
    // static bench passengers that traffic-models.js put in the back "get off" to make room
    const drv = car.g.children.find(o => o.userData && o.userData.human);
    car.g.children.filter(o => o.userData && o.userData.human && o !== drv && !npcs.some(n => n.g === o) && !(PL() && o === PL().body.group)).forEach(o => car.g.remove(o));
  }

  // ---------------------------------------------------------------- landmarks
  function landmarkNear(x, z, minD) {
    let best = null;
    for (const l of world.landmarks) { const d = Math.hypot(l.x - x, l.z - z); if (d < (minD || 0)) continue; if (!best || d < best.d) best = { l, d }; }
    return best && best.l;
  }
  function randomDest(x, z, minD, maxD) {
    const c = world.landmarks.filter(l => { const d = Math.hypot(l.x - x, l.z - z); return d > minD && d < maxD; });
    return c.length ? c[Math.random() * c.length | 0] : landmarkNear(x, z, minD);
  }

  // ---------------------------------------------------------------- road graph for AI rides (Dijkstra over road vertices)
  let graph = null;
  function buildGraph() {
    const nodes = [], key = new Map(), adj = [];
    const id = (x, z) => { const k = Math.round(x) + ',' + Math.round(z); let i = key.get(k); if (i === undefined) { i = nodes.length; key.set(k, i); nodes.push([x, z]); adj.push([]); } return i; };
    const link = (a, b) => { if (a === b) return; const d = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]); adj[a].push([b, d]); adj[b].push([a, d]); };
    const roadIds = world.roads.map(r => r.p.map(p => id(p[0], p[1])));
    roadIds.forEach(ids => { for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]); });
    // T-junctions: a road's end that stops on (or just short of) another road joins it
    world.roads.forEach((r, ri) => {
      for (const e of [0, r.p.length - 1]) {
        const p = r.p[e], pid = roadIds[ri][e];
        let best = null;
        world.roads.forEach((o, oi) => {
          if (oi === ri) return;
          for (let i = 0; i < o.p.length - 1; i++) {
            const a = o.p[i], b = o.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
            const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
            if (d < 10 && (!best || d < best.d)) best = { d, a: roadIds[oi][i], b: roadIds[oi][i + 1] };
          }
        });
        if (best) { link(pid, best.a); link(pid, best.b); }
      }
    });
    graph = { nodes, adj };
  }
  function nearestNode(x, z) { let b = -1, bd = 1e9; graph.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd) { bd = d; b = i; } }); return b; }
  function route(x0, z0, x1, z1) {
    if (!graph) buildGraph();
    const s = nearestNode(x0, z0), e = nearestNode(x1, z1), N = graph.nodes.length;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    dist[s] = 0;
    for (;;) {
      let u = -1, ud = Infinity; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0 || u === e) break; done[u] = 1;
      for (const [v, w] of graph.adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
    if (!isFinite(dist[e])) return null;
    const path = []; for (let u = e; u >= 0; u = prev[u]) path.unshift(graph.nodes[u].slice());
    return path;
  }
  function polyLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
  function polyAt(p, s) {
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= L || i === p.length - 2) { const t = Math.max(0, Math.min(1, s / (L || 1))); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])]; }
      s -= L;
    }
    return [p[0][0], p[0][1], 0];
  }
  // put a vehicle back into village traffic on the nearest road
  function backToTraffic(car) {
    const nr = world.nearestRoad(car.g.position.x, car.g.position.z, r => r.p.length >= 2);
    if (!nr) return;
    const r = nr.r; let s = 0, best = null, acc = 0;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((car.g.position.x - a[0]) * dx + (car.g.position.z - a[1]) * dz) / (L * L)));
      const d = Math.hypot(car.g.position.x - a[0] - dx * t, car.g.position.z - a[1] - dz * t);
      if (!best || d < best) { best = d; s = acc + t * L; }
      acc += L;
    }
    const heading = Math.atan2(Math.sin(car.g.rotation.y - nr.ang), Math.cos(car.g.rotation.y - nr.ang));
    Object.assign(car, { r, len: acc, s, dir: Math.abs(heading) < Math.PI / 2 ? 1 : -1, speed: car.baseSpeed || 9, cur: 0, len2: 1.4, kmh: 0 });
    if (!G.traffic.includes(car)) G.traffic.push(car);
  }

  // ---------------------------------------------------------------- AI autos picking up villagers
  function updateAI(dt) {
    for (const t of G.traffic) {
      if (t.model !== 'auto') continue;
      t.rideCool = Math.max(0, (t.rideCool || 0) - dt);
      const R = t.ride;
      if (!R) {
        if (t.rideCool > 0) continue;
        for (const st of stops) {
          if (!st.pax.some(n => n.state === 'wait')) continue;
          if (Math.hypot(t.g.position.x - st.cx, t.g.position.z - st.cz) < 14) {
            t.ride = { phase: 'stop', stop: st, saved: t.speed, pax: [], t: 0 }; t.speed = 0; break;
          }
        }
        continue;
      }
      R.t += dt;
      if (R.phase === 'stop' && t.cur < 0.4) {
        clearBack(t);
        const want = R.stop.pax.filter(n => n.state === 'wait').slice(0, 1 + (Math.random() < 0.5 ? 1 : 0));
        want.forEach(n => { n.state = 'board'; n.car = t; n.t = 0; R.pax.push(n); });
        R.phase = 'board'; R.t = 0;
      } else if (R.phase === 'board') {
        if (R.pax.every(n => n.state === 'ride') || R.t > 10) {
          R.pax.filter(n => n.state !== 'ride').forEach(n => { n.state = 'wait'; n.car = null; });
          R.pax = R.pax.filter(n => n.state === 'ride');
          if (!R.pax.length) { t.speed = R.saved; t.ride = null; t.rideCool = 20; continue; }
          R.phase = 'ride'; R.t = 0; R.go = 250 + Math.random() * 500; R.dest = randomDest(t.g.position.x, t.g.position.z, 150, 1200); t.speed = R.saved;
        }
      } else if (R.phase === 'ride') {
        R.go -= t.cur * dt;
        const near = R.dest && Math.hypot(R.dest.x - t.g.position.x, R.dest.z - t.g.position.z) < 45;
        if (R.go <= 0 || near || R.t > 90) { R.phase = 'drop'; t.speed = 0; R.t = 0; }
      } else if (R.phase === 'drop' && t.cur < 0.4) {
        R.pax.forEach(alight); R.pax = []; t.speed = R.saved; t.ride = null; t.rideCool = 30;
      }
    }
    // autos the player took or that left the traffic list: their passengers get off right away
    for (const n of npcs) if ((n.state === 'ride' || n.state === 'board') && n.car && !n.car.playerJob && !G.traffic.includes(n.car) && n.car !== (ride && ride.car)) {
      const car = n.car; if (car.ride) { car.speed = car.ride.saved || car.speed; car.ride = null; }
      if (n.state === 'ride') alight(n); else { n.state = 'wait'; n.car = null; }
    }
  }

  // ---------------------------------------------------------------- the player's taxi job (driving an auto)
  let job = null, beacon = null, rideHud = null, flagT = 0;
  function hud(text) {
    if (!rideHud) { rideHud = document.createElement('div'); rideHud.id = 'rideHud'; rideHud.style.cssText = 'position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:6;padding:6px 14px;border-radius:10px;background:rgba(10,15,25,.8);color:#fde68a;font:700 13px system-ui,sans-serif;pointer-events:none;display:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis'; document.body.appendChild(rideHud); }
    rideHud.style.display = text ? 'block' : 'none'; if (text) rideHud.innerHTML = text;
  }
  function marker(on, x, z) {
    if (!beacon) { beacon = new T.Mesh(new T.CylinderGeometry(2.5, 2.5, 40, 20, 1, true), new T.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.3, side: T.DoubleSide, depthWrite: false })); beacon.position.y = 20; scene.add(beacon); }
    beacon.visible = on; if (on) { beacon.position.x = x; beacon.position.z = z; }
  }
  function setWaypoint(x, z, label) { try { if (window.Properties && Properties.setWaypoint) Properties.setWaypoint(x, z, label); } catch (e) {} }
  function updateJob(dt) {
    const P = PL(); const myAuto = P && P.mode === 'vehicle' && P.active && P.active.model === 'auto' ? P.active : null;
    if (job) {
      const car = job.car, n = job.n;
      if (myAuto !== car) {                    // got out / swapped vehicle: the passenger leaves, no fare
        if (n.state === 'ride') alight(n); else { n.state = 'leave'; n.t = 0; n.tx = n.g.position.x + 10; n.tz = n.g.position.z; }
        car.playerJob = false; job = null; marker(false); hud(''); popup('PASSENGER LEFT · NO FARE'); return;
      }
      if (n.state === 'board') {
        const d = doorOf(car); n.tx = d.x; n.tz = d.z;
        if (Math.abs(carSpeed) > 4) { n.state = 'wait'; n.car = null; car.playerJob = false; job = null; hud(''); popup('THEY MISSED THE AUTO · STOP FULLY'); return; }
        if (walkTo(n, dt, 2.2) || (n.t += dt) > 6) { seat(n, car, 1); popup('TAKE ME TO ' + job.dest.name.toUpperCase()); marker(true, job.dest.x, job.dest.z); setWaypoint(job.dest.x, job.dest.z, job.dest.name); }
        return;
      }
      const d = Math.hypot(job.dest.x - carPos.x, job.dest.z - carPos.z);
      hud('🛺 Passenger → <b>' + job.dest.name + '</b> · ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km') + ' · fare ' + fmt(job.fare));
      if (d < 22 && Math.abs(carSpeed) < 8) {
        alight(n); G.cash = G.cash + job.fare;
        popup('FARE +' + fmt(job.fare) + ' · ధన్యవాదాలు!'); car.playerJob = false; job = null; marker(false); hud('');
      }
      return;
    }
    if (!myAuto) return;
    // waiting villagers wave you down; stop close by and one climbs in
    let best = null;
    for (const n of npcs) if (n.state === 'wait') { const d = Math.hypot(n.g.position.x - carPos.x, n.g.position.z - carPos.z); if (d < 30 && (!best || d < best.d)) best = { n, d }; }
    if (!best) return;
    if ((flagT -= dt) <= 0) { flagT = 15; popup('PASSENGER WAVING · STOP NEAR THEM'); }
    if (best.d < 11 && Math.abs(carSpeed) < 4) {
      const n = best.n, dest = randomDest(carPos.x, carPos.z, 220, 1400); if (!dest) return;
      const dist = Math.hypot(dest.x - carPos.x, dest.z - carPos.z) * 1.3;
      clearBack(myAuto);
      n.state = 'board'; n.car = myAuto; n.t = 0; myAuto.playerJob = true;
      job = { car: myAuto, n, dest, fare: Math.round(30 + dist / 1000 * 15 + Math.random() * 10) };
      popup('PASSENGER BOARDING…');
    }
  }

  // ---------------------------------------------------------------- the player as a passenger (G)
  let ride = null, picker = null;
  function closePicker() { if (picker) { picker.remove(); picker = null; } }
  function openPicker(car) {
    closePicker();
    const here = { x: carPos.x, z: carPos.z };
    const list = world.landmarks.map(l => ({ l, d: Math.hypot(l.x - here.x, l.z - here.z) })).filter(o => o.d > 60).sort((a, b) => a.d - b.d).slice(0, 9);
    if (!list.length) { popup('NOWHERE TO GO FROM HERE'); return; }
    picker = document.createElement('div'); picker.id = 'ridePicker';
    picker.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;background:rgba(10,15,25,.95);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:14px;min-width:min(360px,92vw);max-height:80vh;overflow:auto;color:#e5e7eb;font:14px system-ui,sans-serif';
    picker.innerHTML = '<div style="font-weight:800;color:#fbbf24;margin-bottom:8px">🛺 ఎక్కడికి? · Where to?</div>' +
      list.map((o, i) => `<button data-i="${i}" style="display:flex;justify-content:space-between;gap:12px;width:100%;margin:4px 0;padding:10px 12px;border-radius:9px;border:1px solid #334155;background:#111827;color:#e5e7eb;font:600 14px system-ui;cursor:pointer;text-align:left"><span><b style="color:#94a3b8">${i + 1}</b> ${o.l.name}</span><span style="color:#4ade80">${fmt(fareFor(o.d))}</span></button>`).join('') +
      '<button data-x="1" style="width:100%;margin-top:6px;padding:9px;border-radius:9px;border:0;background:#374151;color:#fff;font:600 13px system-ui;cursor:pointer">Cancel (Esc)</button>';
    picker.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); if (b.dataset.x) { closePicker(); car.speed = car.baseSpeed || car.speed; car.waitPlayer = false; return; } startRide(car, list[+b.dataset.i].l); });
    picker.list = list; picker.car = car;
    document.body.appendChild(picker);
  }
  const fareFor = d => Math.round(30 + d * 1.3 / 1000 * 15);
  function findAuto() {
    // a traffic auto close by that is stopped or slow (waiting at the stand, dropping someone off, or just crawling)
    let best = null;
    for (const t of G.traffic) {
      if (t.model !== 'auto' || t.playerJob) continue;
      const d = Math.hypot(t.g.position.x - carPos.x, t.g.position.z - carPos.z);
      if (d < 9 && (t.cur || 0) < 4 && (!best || d < best.d)) best = { t, d };
    }
    if (best) return best.t;
    // at the Auto Stand: one of the drivers there pulls up
    const st = stops.find(s => s.stand && Math.hypot(s.x - carPos.x, s.z - carPos.z) < 25);
    if (st) {
      const v = TrafficModels.auto();
      const car = Object.assign({}, v, { model: 'auto', r: null, len: 2.8, len2: 1.4, s: 0, dir: 1, speed: 0, cur: 0, wheelR: 0.4, hw: 0.75, baseSpeed: 9 });
      const bay = (st.lot && st.lot.bays.find(b => !b.taken)) || { x: st.cx, z: st.cz, rot: st.ang || 0 };
      car.g.position.set(bay.x, 0, bay.z); car.g.rotation.y = bay.rot || 0; scene.add(car.g);
      clearBack(car);
      return car;
    }
    return null;
  }
  function tryRide() {
    const P = PL(); if (!P || P.mode !== 'foot') { popup(P && P.mode === 'passenger' ? 'ALREADY RIDING · F TO GET OUT' : 'GET OUT FIRST (F) · THEN G NEAR AN AUTO'); return; }
    const car = findAuto();
    if (!car) { popup('NO AUTO HERE · TRY THE AUTO STAND OR A STOPPED AUTO'); return; }
    if (car.ride && car.ride.pax && car.ride.pax.length >= 2) { popup('THIS AUTO IS FULL'); return; }
    car.baseSpeed = car.baseSpeed || (car.ride ? car.ride.saved : car.speed) || 9; car.speed = 0; car.waitPlayer = true;
    openPicker(car);
  }
  function startRide(car, dest) {
    closePicker();
    const nr = world.nearestRoad(dest.x, dest.z);
    const tx = nr ? nr.x : dest.x, tz = nr ? nr.z : dest.z;
    let path = route(car.g.position.x, car.g.position.z, tx, tz);
    if (path && path.length < 2) path = [[tx, tz]];                 // same junction: drive straight there
    if (path) path.push([tx, tz]);
    if (!path) { popup('THE DRIVER DOESN\'T KNOW THE WAY'); car.speed = car.baseSpeed; car.waitPlayer = false; return; }
    path.unshift([car.g.position.x, car.g.position.z]);
    // passengers riding in that auto already stay; the player takes the free bench seat
    if (car.ride && car.ride.pax.length) { car.ride.pax.forEach(alight); car.ride.pax = []; car.speed = car.ride.saved; car.ride = null; }
    const i = G.traffic.indexOf(car); if (i >= 0) G.traffic.splice(i, 1);
    if (!car.g.parent) scene.add(car.g);
    const P = PL();
    if (!P.enterPassenger(car, [0.3, 0.88, -0.85, 'bench'])) { backToTraffic(car); return; }
    ride = { car, dest, path, L: polyLen(path), s: 0, v: 0, start: { x: car.g.position.x, z: car.g.position.z }, fare: fareFor(Math.hypot(dest.x - car.g.position.x, dest.z - car.g.position.z)) };
    car.waitPlayer = false;
    marker(true, dest.x, dest.z); setWaypoint(dest.x, dest.z, dest.name);
    popup('ఆటో · TO ' + dest.name.toUpperCase());
  }
  function endRide(early) {
    if (!ride) return;
    const r = ride; ride = null; marker(false); hud('');
    const done = early ? Math.min(1, r.s / Math.max(1, r.L)) : 1;
    const fare = Math.round(r.fare * (early ? Math.max(0.3, done) : 1));
    const cash = G.cash;
    if (cash >= fare) { G.cash = cash - fare; popup((early ? 'GOT OUT EARLY · PAID ' : 'ARRIVED · PAID ') + fmt(fare)); }
    else popup('NO CASH FOR THE FARE · THE DRIVER LETS IT GO');
    r.car.kmh = 0;
    backToTraffic(r.car);
  }
  function updateRide(dt) {
    if (!ride) return;
    const r = ride, car = r.car, p = r.path;
    const remain = r.L - r.s;
    let want = 9;
    const a = polyAt(p, r.s), b = polyAt(p, Math.min(r.L, r.s + 10));
    const turn = Math.abs(Math.atan2(Math.sin(b[2] - a[2]), Math.cos(b[2] - a[2])));
    want *= 1 - Math.min(0.65, turn * 0.6);
    want = Math.min(want, remain * 0.5 + 0.5);
    r.v += (want - r.v) * Math.min(1, dt * 1.5);
    r.s = Math.min(r.L, r.s + r.v * dt);
    const q = polyAt(p, r.s), off = r.s < 4 ? r.s / 4 * 1.3 : 1.3;      // keep left, easing out of the stand
    const gx = q[0] + Math.cos(q[2]) * off, gz = q[1] - Math.sin(q[2]) * off;
    const ahead = polyAt(p, Math.min(r.L, r.s + 3));
    const hx = ahead[0] + Math.cos(ahead[2]) * off - gx, hz = ahead[1] - Math.sin(ahead[2]) * off - gz;
    car.g.position.set(gx, typeof groundY === 'function' ? groundY(gx, gz) : 0, gz);
    if (Math.hypot(hx, hz) > 0.05) { const h = Math.atan2(hx, hz); car.g.rotation.y += Math.atan2(Math.sin(h - car.g.rotation.y), Math.cos(h - car.g.rotation.y)) * Math.min(1, dt * 5); }
    for (const w of car.wheels || []) w.rotation.x += r.v * dt / 0.26;
    car.kmh = r.v * 3.6; car.vF = r.v;
    const d = Math.hypot(r.dest.x - gx, r.dest.z - gz);
    hud('🛺 Riding to <b>' + r.dest.name + '</b> · ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km') + ' · fare ' + fmt(r.fare) + ' · F get out');
    if (remain < 0.5 && r.v < 0.6) { endRide(false); PL().leavePassenger(); }
  }

  // ---------------------------------------------------------------- villagers walking (boarding AI autos, leaving)
  let respawnT = 0;
  function updateNpcs(dt) {
    const cam = G.camera.position;
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      if (n.state === 'wait') {
        n.t += dt;
        // wave at an auto the player drives
        const P = PL(); const mine = P && P.mode === 'vehicle' && P.active && P.active.model === 'auto' && !job;
        const near = mine && Math.hypot(n.g.position.x - carPos.x, n.g.position.z - carPos.z) < 30;
        if (Math.abs(n.g.position.x - cam.x) + Math.abs(n.g.position.z - cam.z) < 160) {
          HumanModel.animateIdle(n.h.parts, n.t);
          if (near) { n.g.rotation.y = Math.atan2(carPos.x - n.g.position.x, carPos.z - n.g.position.z); n.h.parts.armR.rotation.set(-2.7 + Math.sin(n.t * 8) * 0.25, 0, -0.25); n.h.parts.foreR.rotation.x = -0.3; }
        }
      } else if (n.state === 'board' && n.car && !n.car.playerJob) {
        const d = doorOf(n.car); n.tx = d.x; n.tz = d.z; n.t += dt;
        if (walkTo(n, dt, 1.8) || n.t > 8) { const R = n.car.ride; seat(n, n.car, R ? R.pax.indexOf(n) : 0); }
      } else if (n.state === 'leave') {
        n.t += dt; walkTo(n, dt, 1.3);
        if (n.t > 14) dropNpc(n);
      }
    }
    // keep a few people waiting at each stop
    if ((respawnT -= dt) <= 0) {
      respawnT = 12;
      for (const st of stops) {
        const waiting = st.pax.filter(n => n.state === 'wait').length;
        const seen = Math.hypot(st.x - cam.x, st.z - cam.z) < 25;           // don't pop people in under the camera
        if (waiting < MAX_WAIT && !seen) spawnWaiting(st);
      }
    }
  }

  // ---------------------------------------------------------------- hooks
  function initStops() {
    const lots = (window.Parked && Parked.lots) || [];
    const stand = lots.find(l => l.name === 'Auto Stand');
    const bus = world.landmarks.find(l => l.k === 'busstop');
    const add = (name, x, z, extra) => {
      const nr = world.nearestRoad(x, z, r => r.t === 'highway') || world.nearestRoad(x, z);
      const cx = nr ? nr.x : x, cz = nr ? nr.z : z;
      // crowd stands on the verge, ~3 m from the kerb point towards the stop
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1, w = nr ? nr.r.w / 2 + 2.5 : 3;
      const st = Object.assign({ name, x: cx + dx / d * Math.max(w, Math.min(d, w + 2)), z: cz + dz / d * Math.max(w, Math.min(d, w + 2)), cx, cz, ang: nr ? nr.ang : 0, pax: [] }, extra);
      stops.push(st);
      // a couple of the village autos work this road, so they actually pass the stop
      if (nr) {
        const L = polyLen(nr.r.p), free = G.traffic.filter(t => t.model === 'auto' && t.r && t.r !== nr.r && !t.stopRoute);
        free.slice(0, 2).forEach(t => { t.r = nr.r; t.len = L; t.s = Math.random() * L; t.stopRoute = true; });
      }
      for (let i = 0; i < 2; i++) spawnWaiting(st);
    };
    if (stand) add('Auto Stand', stand.x, stand.z, { stand: true, lot: stand });
    if (bus) add('Bus Stop', bus.x, bus.z, {});
  }
  GameHooks.init.push(game => {
    G = game; scene = game.scene; world = game.world;
    try { initStops(); } catch (e) { console.warn('auto-rides: stops', e); }
    const P = PL(); if (P) P.onPassengerExit = () => { endRide(true); };
    addEventListener('keydown', e => {
      if (!picker) return;
      if (e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); const c = picker.car; closePicker(); c.speed = c.baseSpeed || c.speed; c.waitPlayer = false; }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m && picker.list[+m[1] - 1]) { e.stopPropagation(); e.preventDefault(); startRide(picker.car, picker.list[+m[1] - 1].l); }
    }, true);
    window.AutoRides = { stops, npcs, get job() { return job; }, get ride() { return ride; }, route, tryRide, startRide, findAuto };
  });
  GameHooks.update.push((dt) => {
    if (!G || !stops.length) return;
    updateAI(dt); updateNpcs(dt); updateJob(dt); updateRide(dt);
    // a picked-but-not-started auto shouldn't wait forever
    if (picker && PL() && PL().mode !== 'foot') closePicker();
  });
  GameHooks.key.push((e) => {
    if (e.code === 'KeyG' && !e.shiftKey && !e.repeat && !e.metaKey && !e.ctrlKey) { tryRide(); return true; }
    return false;
  });
})();
