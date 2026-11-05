// Multiplayer client for multiplayer/server.py (ws://<host>:8094).
//
// GENERIC MESSAGES (for features in other files, e.g. mp-social.js; no server change needed):
//   MP.send(type, data, opts)   type: /^[A-Za-z0-9_:.-]{1,32}$/ ; data: anything JSON. Returns false if offline.
//     opts.to    'all' (default) | 'near' | 'squad' | a player id        opts.range  metres for 'near' (default 120, max 2000)
//     opts.self  true also delivers to the sender
//   const off = MP.on(type, (data, msg) => ...)     msg = { from, name, color, st }  (st: server time ms). off() or MP.off(type, fn) removes.
//   Limits per client: 8 KB a message, 40 messages/s (burst 80), 96 KB/s. Over the limit is dropped silently.
//   Types are a namespace of their own: they can never collide with the core protocol. Handler errors are caught.
//   Player ids: MP.myId, keys of MP.remotes (r.name, r.g.position, r.kind, r.ride).
//
// - sends state at 15 Hz stamped with the sender's server-clock estimate (skipped while parked); others are rendered through
//   a per-player jitter buffer (delay adapts to measured lag and spacing) with Hermite interpolation; short gaps extrapolate
//   and the error is blended away. Meta (vehicle, paint, seats, doors) only travels when it changes.
// - shared world: vehicle claims, where vehicles were left, knocked bikes, safe-house gate/door, server clock for time of day.
//   Traffic is NOT shared: each client runs its own.
// - chat panel (ALL / SQUAD, Tab switches while typing), quick-chat wheel (hold Q), squads (/squad ...)
// - shared map pings (Z / middle-click / click on the big map), coordinates + grid HUD, compass strip
// - scoreboard (hold Tab), zoomable/pannable big map (M)
// - passenger seats: F beside another player's vehicle asks the server for a seat; the rider follows the driver's
//   interpolated car, looks around with the normal camera, cannot drive and leaves with F (or R)
const MP = (function () {
  const RATE = 1 / 15, MAX_EXTRAP = 350, CELL = 200, TAG_FAR = 250;
  const LAT0 = 17.70160, LON0 = 79.19630, M_PER_DEG_LAT = 110574, M_PER_DEG_LON = 111320 * Math.cos(17.7016 * Math.PI / 180);
  let ws = null, myId = null, myColor = '#38bdf8', sendT = 0, status = 'offline', retry = 0;
  let lastSquad = null, retryTimer = 0, wantOnline = false, everOnline = false, lastMsgAt = 0;
  let squad = { code: null, members: [] }, channel = 'all', rtt = 0, lastSent = null, idleSends = 0;
  const remotes = {};               // id -> { g, body, wheels, head, tail, kind, name, color, squad, buf: [{t,x,z,rot,spd}], ... }
  const pings = {};                 // owner -> { x, z, name, color, t, ttl, mesh }
  const clock = { offset: null, samples: [] };
  const stats = { rx: 0, tx: 0, tx0: 0, rx0: 0, t0: performance.now(), frames: 0, interp: 0, extrap: 0, held: 0, snaps: 0, gaps: [], lastSnapAt: 0, bufDepth: 0 };
  const css = (el, s) => (el.style.cssText = s, el);
  const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ================================================================ UI
  const style = document.createElement('style');
  style.textContent = `
  #mpPanel{position:fixed;left:12px;bottom:14px;width:340px;font:12px -apple-system,system-ui,sans-serif;color:#fff;pointer-events:none;z-index:6}
  #mpStatus{background:rgba(10,15,25,.75);border-radius:8px;padding:6px 10px;margin-bottom:6px}
  #mpLog{max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;transition:opacity .6s;scrollbar-width:thin;padding-right:2px}
  #mpLog .m{background:rgba(10,15,25,.62);border-radius:5px;padding:3px 7px;line-height:1.35;word-wrap:break-word}
  #mpLog .ts{color:#64748b;font-size:10px;margin-right:4px} #mpLog .ch{font-size:10px;font-weight:700;margin-right:4px}
  #mpLog .sys{color:#94a3b8;font-style:italic} #mpLog .kill{color:#fca5a5;font-weight:600} #mpLog .warn{color:#fbbf24}
  #mpPanel.typing #mpLog{pointer-events:auto;opacity:1!important;background:rgba(5,8,14,.35);border-radius:8px}
  #mpPanel.typing #mpLog .m{opacity:1!important}
  #mpInRow{display:none;margin-top:6px;pointer-events:auto;align-items:center;gap:6px}
  #mpPanel.typing #mpInRow{display:flex}
  #mpCh{padding:6px 8px;border-radius:7px;font-weight:800;font-size:11px;background:#1e3a8a}
  #mpInput{flex:1;padding:7px 9px;border-radius:8px;border:1px solid #60a5fa;background:rgba(10,15,25,.9);color:#fff;font:13px sans-serif;outline:none}
  #mpSquad{position:fixed;left:12px;top:12px;z-index:6;font:12px system-ui,sans-serif;color:#fff;pointer-events:none;min-width:190px}
  #mpSquad .row{background:rgba(10,15,25,.72);margin-top:3px;padding:4px 8px;border-radius:6px;border-left:3px solid}
  #mpCompass{position:fixed;left:50%;top:8px;transform:translateX(-50%);width:420px;height:30px;overflow:hidden;z-index:6;pointer-events:none;
    background:linear-gradient(90deg,transparent,rgba(10,15,25,.7) 15%,rgba(10,15,25,.7) 85%,transparent);font:bold 12px system-ui,sans-serif;color:#e2e8f0}
  #mpCompass .tick{position:absolute;top:4px;transform:translateX(-50%);text-align:center}
  #mpCompass .needle{position:absolute;left:50%;top:0;width:2px;height:30px;background:#fbbf24;transform:translateX(-1px)}
  #mpHdg{position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:6;font:bold 12px system-ui;color:#fbbf24;pointer-events:none;text-shadow:0 1px 2px #000}
  #mpCoords{position:fixed;right:12px;top:240px;z-index:6;font:11px ui-monospace,Menlo,monospace;color:#e2e8f0;background:rgba(10,15,25,.72);padding:5px 9px;border-radius:7px;pointer-events:none;text-align:right}
  #mpWheel{position:fixed;left:50%;top:50%;width:360px;height:360px;margin:-180px 0 0 -180px;z-index:9;display:none}
  #mpBoard{position:fixed;left:50%;top:14%;transform:translateX(-50%);min-width:520px;z-index:9;display:none;background:rgba(8,12,20,.92);border-radius:12px;padding:12px 16px;font:13px system-ui,sans-serif;color:#fff}
  #mpBoard table{width:100%;border-collapse:collapse} #mpBoard td,#mpBoard th{padding:4px 8px;text-align:left} #mpBoard th{color:#94a3b8;font-size:11px;border-bottom:1px solid #334155}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'mpPanel';
  panel.innerHTML = '<div id="mpStatus"></div><div id="mpLog"></div><div id="mpInRow"><span id="mpCh">ALL</span><input id="mpInput" maxlength="160" placeholder="Enter send · Tab channel · Esc close · /squad create"></div>';
  document.body.appendChild(panel);
  const $s = panel.querySelector('#mpStatus'), $log = panel.querySelector('#mpLog'), $in = panel.querySelector('#mpInput'), $ch = panel.querySelector('#mpCh');
  const $squad = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpSquad' }));
  const $compass = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpCompass' }));
  const $hdg = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpHdg' }));
  const $coords = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpCoords' }));
  const $board = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpBoard' }));
  const $wheel = document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'mpWheel', width: 360, height: 360 }));
  [$squad, $compass, $hdg, $coords].forEach(e => e.style.display = 'none');
  const typing = () => document.activeElement === $in;

  // ---------------- chat log
  const EMOJI = { ':)': '🙂', ':D': '😄', ':(': '🙁', ';)': '😉', ':P': '😛', '<3': '❤️', ':fire:': '🔥', ':car:': '🚗', ':temple:': '🛕',
    ':ok:': '👌', ':thumbsup:': '👍', ':+1:': '👍', ':wave:': '👋', ':cow:': '🐄', ':tea:': '☕', ':lol:': '😂', ':gg:': '🏆', ':horn:': '📯' };
  const emojify = s => s.replace(/:[a-z+0-9]+:|:\)|:D|:\(|;\)|:P|<3/g, k => EMOJI[k] || k);
  const fmtTime = ms => { const d = new Date(ms || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  let lastChatAt = 0;
  function addLine(html) {
    const d = document.createElement('div'); d.className = 'm'; d.innerHTML = html; $log.appendChild(d);
    while ($log.children.length > 50) $log.removeChild($log.firstChild);
    $log.scrollTop = $log.scrollHeight; lastChatAt = performance.now();
  }
  function sys(text, kind) {
    addLine(`<span class="ts">${fmtTime()}</span><span class="${kind === 'kill' ? 'kill' : kind === 'warn' ? 'warn' : 'sys'}">${kind === 'kill' ? '💥 ' : ''}${escape(text)}</span>`);
  }
  function chatLine(m) {
    const ch = m.ch === 'squad' ? '<span class="ch" style="color:#4ade80">[SQUAD]</span>' : '<span class="ch" style="color:#60a5fa">[ALL]</span>';
    const where = m.quick && m.x != null ? ` <span style="color:#94a3b8">📍${gridRef(m.x, m.z)} · ${Math.round(Math.hypot(m.x - carPos.x, m.z - carPos.z))} m</span>` : '';
    addLine(`<span class="ts">${fmtTime()}</span>${ch}<b style="color:${escape(m.color || '#fff')}">${escape(m.name)}</b>: ${m.quick ? '📢 ' : ''}${escape(emojify(m.text))}${where}`);
  }
  // fade when idle
  function fadeLog() {
    const idle = performance.now() - lastChatAt;
    $log.style.opacity = typing() ? 1 : idle < 10000 ? 1 : Math.max(0, 1 - (idle - 10000) / 2000);
  }

  function setStatus() {
    const n = Object.keys(remotes).length;
    const q = rtt < 80 ? '#4ade80' : rtt < 160 ? '#fbbf24' : '#f87171';
    $s.innerHTML = status === 'online'
      ? `🟢 Online · ${n + 1} in Nellutla · <span style="color:${q}">ping ${Math.round(rtt)} ms</span>${squad.code ? ` · <span style="color:#4ade80">squad ${squad.code}</span>` : ''}<br><span style="color:#94a3b8">Enter chat · Q quick-chat · Z ping · Tab scores</span>`
      : status === 'connecting' ? '🟡 Connecting to multiplayer…'
      : `⚪ Offline · multiplayer server not reachable${everOnline ? ' · reconnecting…' : ' (run multiplayer/server.py)'}`;
  }

  // ================================================================ coordinates
  function latLon(x, z) { return [LAT0 - z / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON]; }
  function gridRef(x, z) {
    const [x0, z0] = world.bounds;
    const c = Math.max(0, Math.floor((x - x0) / CELL)), r = Math.max(0, Math.floor((z - z0) / CELL));
    return colName(c) + (r + 1);
  }
  function colName(c) { return c < 26 ? String.fromCharCode(65 + c) : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + c % 26); }
  function heading() {        // bearing in degrees, 0 = north (-z), 90 = east (+x)
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    return ((Math.atan2(d.x, -d.z) * 180 / Math.PI) + 360) % 360;
  }
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function drawCompass() {
    const h = heading(), W = 420, ppd = 2.2;   // pixels per degree
    let html = '<div class="needle"></div>';
    for (let a = Math.ceil((h - 95) / 15) * 15; a <= h + 95; a += 15) {
      const x = W / 2 + (a - h) * ppd, n = ((a % 360) + 360) % 360;
      const lbl = n % 45 === 0 ? DIRS[n / 45] : n;
      html += `<div class="tick" style="left:${x}px;${n % 45 === 0 ? 'color:' + (n === 0 ? '#f87171' : '#fff') + ';font-size:13px' : 'color:#b9d2cc;font-size:10px;top:8px'}">${lbl}</div>`;
    }
    for (const p of Object.values(pings)) {       // ping markers on the strip
      const b = (Math.atan2(p.x - carPos.x, -(p.z - carPos.z)) * 180 / Math.PI + 360) % 360, dd = wrapA((b - h) * Math.PI / 180) * 180 / Math.PI;
      if (Math.abs(dd) < 95) html += `<div class="tick" style="left:${W / 2 + dd * ppd}px;top:15px;color:${p.color}">▼</div>`;
    }
    $compass.innerHTML = html;
    $hdg.textContent = `${DIRS[Math.round(h / 45) % 8]} ${Math.round(h)}°`;
    const [la, lo] = latLon(carPos.x, carPos.z);
    $coords.innerHTML = `${la.toFixed(5)}° N  ${lo.toFixed(5)}° E<br>Grid <b style="color:#fbbf24">${gridRef(carPos.x, carPos.z)}</b>`;
  }

  // ================================================================ remote models
  // remote player on foot: the game's HumanModel, dressed in the player's colour (shirt), walking via its jointed parts
  function person(color) {
    const c = new THREE.Color(color || '#3b82f6').getHex();
    if (typeof HumanModel !== 'undefined') {
      try {
        const h = HumanModel.create({ gender: 'm', top: 'shirt', topColor: c, color: c, bottom: 'trousers', bottomColor: 0x2c3e50,
          skin: 0x8d5a3b, hair: 'short', hairColor: 0x141210, face: 'oval', feet: 'chappals', acc: {}, lod: 'low' });
        h.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return { g: h.group, human: h.parts, wheels: [], head: [], tail: [] };
      } catch (e) { console.warn('mp: HumanModel failed', e); }
    }
    const g = new THREE.Group(), m = q => new THREE.MeshLambertMaterial({ color: q });
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
    add(new THREE.BoxGeometry(0.44, 0.62, 0.26), m(c), 0, 1.13, 0); add(new THREE.SphereGeometry(0.13, 10, 8), m(0x7a4a2e), 0, 1.6, 0);
    const legs = [add(new THREE.BoxGeometry(0.15, 0.82, 0.15), m(0x2c3e50), -0.1, 0.41, 0), add(new THREE.BoxGeometry(0.15, 0.82, 0.15), m(0x2c3e50), 0.1, 0.41, 0)];
    return { g, legs, wheels: [], head: [], tail: [] };
  }
  function vehicle(kind) {
    if (kind === 'crysta' && TrafficModels.crysta) return TrafficModels.crysta();
    if (kind === 'crysta') {
      const v = TrafficModels.suv();
      v.g.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() !== 0x1c2733 && o.material.isMeshPhongMaterial) o.material = o.material.clone(), o.material.color.setHex(0xf4f4f4); });
      return v;
    }
    // kind comes off the network: anything that isn't a vehicle model falls back to a hatch
    try { const v = /^(bake|mergeUnder|setPart)$/.test(kind) || typeof TrafficModels[kind] !== 'function' ? null : TrafficModels[kind](); if (v && v.g && v.g.isObject3D) return v; } catch (e) {}
    return TrafficModels.hatch();
  }
  function modelFor(kind, color) {
    if (kind === 'foot') return person(color);
    const v = vehicle(kind);
    // lamps share materials between models only per-vehicle; clone so night toggles are per remote
    (v.head || []).forEach(m => m.material = m.material.clone()); (v.tail || []).forEach(m => m.material = m.material.clone());
    return v;
  }
  function nameTag(name, color, mate) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = mate ? 'rgba(20,83,45,.9)' : 'rgba(10,15,25,.8)'; x.fillRect(0, 8, 256, 48);
    if (mate) { x.strokeStyle = '#4ade80'; x.lineWidth = 4; x.strokeRect(2, 10, 252, 44); }
    x.fillStyle = color; x.fillRect(0, 8, 8, 48);
    x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText((mate ? '◆ ' : '') + name, 132, 42, 236);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(3.2, 0.8, 1); s.renderOrder = 10; return s;
  }
  const isMate = id => !!squad.code && squad.members.includes(id);
  // body colour: Player.bodyColour is the game's own idea of it; every material of that colour takes the paint
  function colourOf(v) { try { return Player.bodyColour(v); } catch (e) { return 0; } }
  function paintModel(v, hex) {
    if (!hex) return;
    const base = colourOf(v); if (!base) return;
    const done = new Map();
    v.g.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.material.color || o.material.color.getHex() !== base) return;
      let c = done.get(o.material); if (!c) { c = o.material.clone(); c.color.setHex(hex); done.set(o.material, c); } o.material = c; });
  }
  function setTag(r, m, mate) {
    if (r.tag) { r.g.remove(r.tag); r.tag.material.map.dispose(); r.tag.material.dispose(); }
    r.tag = nameTag(m.name, m.color, mate); r.tag.position.y = r.kind === 'bus' || r.kind === 'lorry' ? 4.6 : 3.0; r.g.add(r.tag);
    r.name = m.name; r.color = m.color; r.mate = mate;
  }
  function ensure(id, st) {       // st: meta. The model follows kind and paint; a change of name or squad only redraws the tag
    let r = remotes[id];
    const kind = st.kind || 'crysta', mate = isMate(id), paint = st.paint || 0;
    if (r && r.kind === kind && r.paint === paint) { if (r.name !== st.name || r.mate !== mate || r.color !== st.color) setTag(r, st, mate); return r; }
    const old = r, buf = r ? r.buf : [];
    if (r) { if (ride && ride.driver === id) endRide('The driver left the vehicle'); clearSitters(r); scene.remove(r.g); }
    const g = new THREE.Group(), m = modelFor(kind, st.color);
    g.rotation.order = 'YXZ'; g.add(m.g); paintModel(m, paint); g.visible = buf.length > 0;
    if (old) g.position.copy(old.g.position);
    scene.add(g);
    r = remotes[id] = { g, body: m.g, legs: m.legs, human: m.human, wheels: m.wheels || [], head: m.head || [], tail: m.tail || [], steer: m.steer || (m.userData && m.userData.steer) || [], userData: m.userData || {}, lit: -1, tag: null,
      cls: m.kind, seatDef: m.seat, len: m.len, kind, paint, buf, spd: 0, walkT: 0, rtt: old ? old.rtt : 0, mode: st.mode,
      delay: old ? old.delay : 150, lagAvg: old ? old.lagAvg : 40, lagDev: old ? old.lagDev : 10, gapAvg: old ? old.gapAvg : 67, ox: 0, oz: 0, ry: 0, rp: 0, rr: 0, steerNow: 0, doorT: [0, 0, 0, 0, 0, 0], rt: 0 };
    setTag(r, st, mate);
    if (kind !== 'foot') { r.model = classOf(r); r.p = Player.PARAMS[kind] || Player.PARAMS[r.model] || Player.PARAMS.hatch; r.hw = r.p.hw; g.userData.type = kind; if (kind === 'crysta') r.snd = 'innova'; }
    if (!old) setStatus();
    return r;
  }
  function applyMeta(id, m) {
    if (id === myId) return;
    const r = ensure(id, m);
    r.ride = m.ride || null; r.mode = m.mode; r.squad = m.squad; r.doors = m.doors || 0;
    r.g.visible = !r.ride && r.buf.length > 0;
  }
  function pushState(id, a) {
    const r = remotes[id]; if (!r) return;
    const t = a[0], S = { t, x: a[1], y: a[2], z: a[3], rot: a[4], spd: a[5], st: a[6], lean: a[7], fl: a[8] }, last = r.buf[r.buf.length - 1], lag = serverNow() - t;
    r.lagAvg += (lag - r.lagAvg) * 0.08; r.lagDev += (Math.abs(lag - r.lagAvg) - r.lagDev) * 0.08;
    if (last) {
      if (t <= last.t) return;
      const gap = t - last.t;
      r.gapAvg += (Math.min(gap, 1500) - r.gapAvg) * 0.15;
      if (Math.hypot(S.x - last.x, S.z - last.z) > Math.max(40, 120 * gap / 1000)) r.buf.length = 0;   // teleport: never glide across the map
      else if (gap > 300 && gap > r.gapAvg * 3) r.buf.push({ ...last, t: t - 70 });                    // stood still, sending nothing: hold, then move
    }
    r.buf.push(S); if (r.buf.length > 48) r.buf.shift();
    if (!r.ride) r.g.visible = true;
  }

  function drop(id) { const r = remotes[id]; if (r) { if (ride && ride.driver === id) endRide('The driver left'); clearSitters(r); scene.remove(r.g); delete remotes[id]; setStatus(); } }

  // ================================================================ pings
  function beacon(color) {
    const g = new THREE.Group(), col = new THREE.Color(color);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    beam.position.y = 30; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.0, 32), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshBasicMaterial({ color: col, fog: false }));
    tip.position.y = 8; g.add(tip);
    g.userData = { ring, tip }; return g;
  }
  function addPing(p) {
    removePing(p.owner);
    const mesh = beacon(p.color); mesh.position.set(p.x, 0, p.z); scene.add(mesh);
    const born = performance.now() - Math.max(0, serverNow() - (p.at || serverNow()));
    pings[p.owner] = { x: p.x, z: p.z, name: p.name, color: p.color, born, ttl: p.ttl || 60000, mesh, squad: p.squad };
  }
  function removePing(owner) { const p = pings[owner]; if (p) { scene.remove(p.mesh); delete pings[owner]; } }
  function placePing(x, z) {
    if (status !== 'online') { sys('Pings need multiplayer', 'warn'); return; }
    send({ t: 'ping_place', x: +x.toFixed(1), z: +z.toFixed(1) });
  }
  function pingAtCrosshair() {
    const rc = new THREE.Raycaster(); rc.setFromCamera({ x: 0, y: 0 }, camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    let t = d.y < -0.01 ? -o.y / d.y : 400;            // ground plane y = 0; looking up -> 400 m ahead
    t = Math.min(t, 800);
    placePing(o.x + d.x * t, o.z + d.z * t);
  }

  // ================================================================ network
  function serverNow() { return performance.now() + (clock.offset || 0); }
  function connect() {
    wantOnline = true;
    // one socket at a time: ignore repeated calls while a socket is connecting/open
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(retryTimer); retryTimer = 0;
    const host = location.hostname || '127.0.0.1';
    status = retry > 2 ? 'offline' : 'connecting'; setStatus();
    let sock;
    try { sock = new WebSocket(`ws://${host}:${new URLSearchParams(location.search).get('mpPort') || 8094}`); } catch (e) { return schedule(); }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      retry = 0; status = 'online'; everOnline = true; lastMsgAt = performance.now(); setStatus();
      sock.send(JSON.stringify({ t: 'hello', name: myName(), tab: tabId }));
      for (let i = 0; i < 4; i++) setTimeout(sendPing, i * 150);
    };
    sock.onclose = () => {
      if (ws !== sock) return;              // stale socket: a newer one already replaced it
      if (ride) endRide('Connection lost');
      ws = null; status = 'offline'; lastSquad = squad.code || lastSquad; Object.keys(remotes).forEach(drop); Object.keys(pings).forEach(removePing);
      squad = { code: null, members: [] }; setStatus(); schedule();
    };
    sock.onerror = () => {};
    sock.onmessage = ev => {
      if (ws !== sock) return;
      lastMsgAt = performance.now(); stats.rx += ev.data.length;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'r') { const hs = handlers[m.y]; if (hs) for (const f of hs.slice()) { try { f(m.d, m); } catch (e) { console.warn('mp handler ' + m.y, e); } } }
      else if (m.t === 'welcome') {
        myId = m.id; myColor = m.color; if (clock.offset == null) clock.offset = m.st - performance.now();
        if (lastSquad) send({ t: 'squad', op: 'rejoin', code: lastSquad });   // keep the squad across a reconnect
        lastMeta = ''; timeSynced = false; lastSent = null; recall();
      }
      else if (m.t === 'name') {
        if (m.name && m.name !== curName) { if (m.asked && m.asked !== m.name) sys(`Name "${m.asked}" is taken: you are ${m.name}`, 'info'); curName = m.name; }
      }
      else if (m.t === 'pong') {
        const now = performance.now(), r = now - m.c;
        clock.samples.push({ r, off: m.st - (m.c + r / 2) }); if (clock.samples.length > 10) clock.samples.shift();
        const best = clock.samples.reduce((a, b) => b.r < a.r ? b : a);
        clock.offset = clock.offset == null ? best.off : clock.offset + (best.off - clock.offset) * 0.3;
        rtt = rtt ? rtt * 0.7 + r * 0.3 : r; setStatus();
      }
      else if (m.t === 'roster') {
        for (const [id, e] of Object.entries(m.players)) { applyMeta(id, e.m); if (e.a) pushState(id, e.a); }
        (m.gone || []).forEach(worldGone); (m.wv || []).forEach(worldPark);
        for (const k in (m.knocked || {})) worldKnock(k, m.knocked[k][0], m.knocked[k][1], true);
        worldFlags(m.wf); setHour(m.h);
      }
      else if (m.t === 'm') applyMeta(m.id, m.m);
      else if (m.t === 'S') {
        const now = performance.now();
        stats.snaps++; if (stats.lastSnapAt) { stats.gaps.push(now - stats.lastSnapAt); if (stats.gaps.length > 120) stats.gaps.shift(); } stats.lastSnapAt = now;
        for (const id in m.p) if (id !== myId) pushState(id, m.p[id]);
      }
      else if (m.t === 'rtts') { for (const id in m.r) if (remotes[id]) remotes[id].rtt = m.r[id]; }
      else if (m.t === 'w') {
        if (m.op === 'take') worldGone(m.k); else if (m.op === 'park') worldPark(m.rec); else if (m.op === 'del') worldGone(m.k); else if (m.op === 'knock') worldKnock(m.k, m.dx, m.dz);
      }
      else if (m.t === 'wf') worldFlags(m.v);
      else if (m.t === 'time') setHour(m.h);
      else if (m.t === 'claim_ok') claimOk(m.k);
      else if (m.t === 'claim_no') { if (pendingClaim === m.k) pendingClaim = null; toast(m.reason); }
      else if (m.t === 'leave') drop(m.id);
      else if (m.t === 'seat_ok') { if (m.switch) switchSeat(m.seat); else takeSeat(m.driver, m.seat); }
      else if (m.t === 'seat_no') { asking = 0; toast(m.reason); }
      else if (m.t === 'seat_end') endRide(m.reason);
      else if (m.t === 'chat') chatLine(m);
      else if (m.t === 'sys') sys(m.text, m.kind);
      else if (m.t === 'squad') {
        const was = squad.code; squad = { code: m.code, members: m.members || [] };
        if (m.code) lastSquad = m.code;            // a null update can be the server tearing down our old socket
        if (!m.code && was) sys('You left the squad', 'info');
        if (!squad.code && channel === 'squad') setChannel('all');
        for (const id of Object.keys(pings)) if (pings[id].squad && pings[id].squad !== squad.code) removePing(id);
        setStatus();
      }
      else if (m.t === 'ping_place') { addPing(m); if (m.owner !== myId) sys(`${m.name} pinged ${gridRef(m.x, m.z)} (${Math.round(Math.hypot(m.x - carPos.x, m.z - carPos.z))} m)`, 'info'); }
      else if (m.t === 'ping_clear') removePing(m.owner);
      else if (m.t === 'horn') {
        const r = remotes[m.from];
        if (r && Math.hypot(r.g.position.x - carPos.x, r.g.position.z - carPos.z) < 200) { try { SFX.horn(r.kind || 'hatch', r.g.position.x, r.g.position.z, false, 'multiplayer'); } catch (e) {} }   // their horn, from their car
      }
    };
  }
  function sendPing() { send({ t: 'ping', c: performance.now(), rtt: Math.round(rtt) }); }
  setInterval(() => {
    sendPing();
    // dead-connection watchdog: snapshots/pongs arrive many times a second; 15 s of silence means the link is gone
    if (ws && ws.readyState === 1 && !document.hidden && performance.now() - lastMsgAt > 15000) { try { ws.close(); } catch (e) {} }
  }, 2000);
  // exponential backoff with jitter: 1, 2, 4, 8, 16, 30 s ...
  function schedule() {
    if (!wantOnline || retryTimer) return;
    retry++; const d = Math.min(30000, 1000 * Math.pow(2, retry - 1)) * (0.8 + Math.random() * 0.4);
    retryTimer = setTimeout(() => { retryTimer = 0; connect(); }, d);
  }
  window.addEventListener('online', () => { if (wantOnline && !ws) { retry = 0; connect(); } });
  function send(o) { if (ws && ws.readyState === 1) { const d = JSON.stringify(o); stats.tx += d.length; ws.send(d); } }
  const handlers = {};
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => off(type, fn); }
  function off(type, fn) { const h = handlers[type]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } }
  function sendType(type, data, opts) {
    if (!ws || ws.readyState !== 1) return false;
    const o = opts || {}, m = { t: 'r', y: type, d: data, to: o.to || 'all' };
    if (o.range != null) m.range = o.range; if (o.self) m.self = 1;
    send(m); return true;
  }
  // Names: a name the user chose (/name) is kept in localStorage; otherwise every tab gets its own random default
  // ("Koushik-XXXX", kept in sessionStorage so a reload/reconnect keeps it). The server makes names unique and tells us
  // the final one ({t:'name'}). Old auto names ("Player 168") were shared by every tab via localStorage: ignored now.
  let curName = null;
  const tabId = (() => { let t = ''; try { t = sessionStorage.getItem('nellutla.tab') || ''; } catch (e) {}
    if (!t) { t = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('nellutla.tab', t); } catch (e) {} } return t; })();
  function myName() {
    if (curName) return curName;
    let n = ''; try { if (localStorage.getItem('nellutla.nameSet') === '1') n = localStorage.getItem('nellutla.name') || ''; } catch (e) {}
    if (/^Player \d{3}(-\d+)?$/.test(n)) n = '';   // the old shared auto name is never a choice
    if (!n) { try { n = sessionStorage.getItem('nellutla.autoname') || ''; } catch (e) {} }
    if (!n) {
      n = 'Koushik-' + Math.floor(1000 + Math.random() * 9000);
      try { sessionStorage.setItem('nellutla.autoname', n); } catch (e) {}
    }
    return (curName = n);
  }
  function setName(n) { if (/^Player \d{3}(-\d+)?$/.test(n)) return; curName = n; try { localStorage.setItem('nellutla.name', n); localStorage.setItem('nellutla.nameSet', '1'); } catch (e) {} if (ws && ws.readyState === 1) send({ t: 'hello', name: n, tab: tabId }); }
  function myKind() {
    if (typeof Player === 'undefined' || Player.mode === 'crysta') return 'crysta';
    if (Player.mode === 'foot' || ride) return 'foot';   // a rider has no vehicle of their own: others draw them in the driver's
    const a = Player.active; if (!a) return 'hatch';
    const ty = a._ty || a.type;   // the exact model (splendor, scooter, swift, fortuner...) rather than the class
    return (ty && typeof TrafficModels !== 'undefined' && typeof TrafficModels[ty] === 'function') ? ty : (a.model || 'hatch');
  }
  const KIND_NAME = { crysta: 'Innova Crysta', foot: 'On foot', auto: 'Auto', bike: 'Bike', hatch: 'Hatchback', suv: 'SUV', tractor: 'Tractor', lorry: 'Lorry', bus: 'Bus', bullockCart: 'Bullock cart' };

  // ================================================================ passenger seats
  // One ride at a time. The server hands out seat numbers; the seat's place in the vehicle is worked out from the
  // vehicle's own driver seat, so every client puts a rider in the same spot.
  let ride = null, asking = 0, seatHint = null;
  const toast = t => { try { showComboPopup(t.toUpperCase()); } catch (e) {} };
  const TWO_WHEEL = /bike|splendor|activa|scooter|starcity|cycle|pulsar|bullet|sport|faired|fz|r15/i;
  function classOf(r) { return r.kind === 'crysta' ? 'suv' : r.cls === 'car' ? 'suv' : r.cls || (TWO_WHEEL.test(r.kind) ? 'bike' : 'suv'); }
  function seatsOf(model, def, kind) {         // [x, y, z, pose] for each passenger seat (the driver's is not in the list)
    const P = Player.SEATS, d = def || P[model] || P.suv;
    if (model === 'bike') return kind === 'cycle' ? [[0, d[1] - 0.05, d[2] - 0.4, 'bike']] : [[0, d[1] + 0.02, d[2] - 0.42, 'bike']];
    if (model === 'tractor' || model === 'bullockCart') return [[0.45, d[1], d[2] + 0.1, 'car']];
    if (model === 'auto') return [[-0.34, 0.88, -0.85, 'bench'], [0.34, 0.88, -0.85, 'bench'], [0, 0.88, -0.85, 'bench']];
    if (model === 'lorry') return [[-d[0], d[1], d[2], 'car']];
    if (model === 'bus') {                     // two seats a side, rows running back from the driver
      const out = [[-d[0], d[1], d[2], 'car']];
      for (let r = 1; r <= 9; r++) for (const x of [-0.8, -0.32, 0.32, 0.8]) out.push([x, d[1], d[2] - r * 0.9, 'car']);
      return out;
    }
    const out = [[-d[0], d[1], d[2], 'car'], [-d[0], d[1], d[2] - 1, 'car'], [d[0], d[1], d[2] - 1, 'car']];
    if (kind === 'crysta' || kind === 'mpv' || kind === 'bolero' || kind === 'sumo') out.push([-d[0], d[1] + 0.03, d[2] - 1.85, 'car'], [d[0], d[1] + 0.03, d[2] - 1.85, 'car']);
    return out;
  }
  function myCap() {                           // how many riders this vehicle takes: sent with our state
    if (typeof Player === 'undefined') return 3;
    if (Player.mode === 'crysta') return seatsOf('suv', null, 'crysta').length;
    const a = Player.active; if (!a || ride || Player.mode === 'foot') return 0;
    return seatsOf(a.model, a.seat, myKind()).length;
  }
  function remoteToBoard() {                   // the closest other player's vehicle we could step into
    let best = null;
    for (const [id, r] of Object.entries(remotes)) {
      if (r.kind === 'foot' || r.ride) continue;
      const d = Math.hypot(r.g.position.x - carPos.x, r.g.position.z - carPos.z);
      const reach = (r.len ? r.len / 2 : 2.4) + 2.5;
      if (d < Math.min(reach, 8.5) && (!best || d < best.d)) best = { id, r, d, clear: Math.max(0, d - (r.len ? r.len / 2 : 2.4)) };
    }
    return best;
  }
  function takeSeat(driver, seat) {
    asking = 0;
    const r = remotes[driver];
    if (!r || typeof Player === 'undefined' || Player.mode !== 'foot') { send({ t: 'seat_leave' }); return; }
    const model = classOf(r), list = seatsOf(model, r.seatDef, r.kind), s = list[seat % list.length];
    r.model = model; r.hw = r.hw || (Player.PARAMS[model] || Player.PARAMS.hatch).hw; r.len = r.len || 4;
    if (!Player.enterPassenger(r, s)) { send({ t: 'seat_leave' }); return; }
    ride = { driver, seat, r };
    toast(`Riding with ${r.name} · F to get out`);
  }
  function switchSeat(seat) {
    if (!ride) return;
    const list = seatsOf(classOf(ride.r), ride.r.seatDef, ride.r.kind);
    ride.seat = seat; Player.moveSeat(list[seat % list.length]); toast('Seat ' + (seat + 2));
  }
  function endRide(reason) {
    if (!ride) return;
    const wasIn = ride; ride = null;
    if (wasIn.r && wasIn.r.g.parent && Player.mode === 'passenger') Player.leavePassenger();
    else if (Player.mode === 'passenger') { const g = wasIn.r.g; scene.add(g); Player.leavePassenger(); scene.remove(g); }
    if (reason) toast(reason);
  }
  function leaveSeat() { send({ t: 'seat_leave' }); endRide(null); }
  // ================================================================ the shared world
  // key: a stable name for a vehicle: where the map put it, or a name given when someone first drove it
  const pkKey = it => `pk:${it.vk}@${it.x.toFixed(1)},${it.z.toFixed(1)}`;
  const crystaKey = () => 'crysta:' + tabId;
  let pendingClaim = null, rawToggle = null, holding = null, lastDrive = null, ownKeyN = 0;
  const ghosts = {};         // key -> a vehicle a player left, standing here as a real parked vehicle
  function pickKey(b) {
    if (b.pk) return pkKey(b.pk);
    if (b.prop) return `prop:${b.prop.kind}:${b.prop.i}`;
    if (b.v && !b.v.crysta) return b.v._mpKey || null;
    return null;
  }
  function claimOk(k) {
    if (pendingClaim !== k) return;
    pendingClaim = null;
    const b = Player._pick();
    holding = k;
    if (Player.mode === 'foot' && b && pickKey(b) === k && rawToggle) { delete ghosts[k]; rawToggle(); if (Player.active) Player.active._mpKey = k; }
    if (Player.mode === 'foot') {       // walked away while asking: give it straight back
      const o = b && b.pk ? b.pk : b && b.prop ? b.prop : null;
      if (o) send({ t: 'park', k, kind: o.vk === 'propbike' ? 'splendor' : o.vk, x: o.x, z: o.z, rot: o.rot, paint: 0 });
      holding = null;
    }
  }
  function worldGone(k) {
    const g = ghosts[k];
    if (g) {
      if (g !== (typeof Player !== 'undefined' && Player.active)) { if (g.g.parent) g.g.parent.remove(g.g); const L = Player.parkedList, i = L.indexOf(g); if (i >= 0) L.splice(i, 1); }
      delete ghosts[k];
    }
    if (k.startsWith('pk:') && window.Parked) { const it = Parked.vehicles.find(q => pkKey(q) === k); if (it) Parked.remove(it); }
    else if (k.startsWith('prop:')) { const p = k.split(':'); Player.hideProp(p[1], +p[2]); }
  }
  function worldPark(rec) {
    if (!rec || (rec.lock && rec.owner === tabId) || (typeof Player === 'undefined')) return;
    if (holding === rec.k) return;
    worldGone(rec.k);
    if (Player.active && Player.active._mpKey === rec.k) return;
    // the start bay stays clear: a car someone left on it would shove the Innova into the bike row at spawn
    { const h = window.SafeHouse2Home && SafeHouse2Home(); if (h && Math.hypot(rec.x - h.x, rec.z - h.z) < 3.4) return; }
    let m; try { m = vehicle(rec.kind); } catch (e) { return; }
    paintModel(m, rec.paint);
    m.g.position.set(rec.x, typeof groundY === 'function' ? groundY(rec.x, rec.z) : 0, rec.z); m.g.rotation.y = rec.rot; scene.add(m.g);
    const model = classOf({ kind: rec.kind, cls: m.kind }), v = { ...m, model, type: rec.kind, parked: true, speed: 0, cur: 0, s: 0, dir: 1, hw: (Player.PARAMS[rec.kind] || Player.PARAMS[model] || Player.PARAMS.hatch).hw, _mpKey: rec.k };
    Player.addParked(v); ghosts[rec.k] = v;
  }
  const knockedSeen = new Set();
  function worldKnock(k, dx, dz) {
    if (knockedSeen.has(k)) return; knockedSeen.add(k);
    if (!window.Parked) return;
    const it = Parked.vehicles.find(q => pkKey(q) === k); if (it) Player.knockItem(it, dx, dz);
  }
  function worldFlags(v) {
    const S = window.SafeHouse2 && SafeHouse2.state; if (S) S.remote = { gate: !!(v & 1), ped: !!(v & 2), door: !!(v & 4) };
  }
  // time of day: the server's clock, so every client sees the same sky. T and sleeping change it for everyone.
  let timeSynced = false, lastHour = 0;
  function setHour(h) { try { timeOfDay = h; lastHour = h; timeSynced = true; } catch (e) {} }
  function syncTime(dt) {
    if (!timeSynced || status !== 'online' || typeof timeOfDay !== 'number') return;
    let d = timeOfDay - lastHour; if (d > 12) d -= 24; if (d < -12) d += 24;
    if (Math.abs(d) > 0.1 + dt * 24 / 960) send({ t: 'time_set', h: +timeOfDay.toFixed(3) });
    lastHour = timeOfDay;
  }
  function trackVehicle() {      // who holds what, as this player gets in and out
    if (typeof Player === 'undefined') return;
    const m = Player.mode, a = Player.active;
    if (m === 'vehicle' && a) {
      if (!a._mpKey) { a._mpKey = `v:${tabId}:${++ownKeyN}`; send({ t: 'claim', k: a._mpKey }); }
      holding = a._mpKey; lastDrive = { v: a, kind: myKind(), paint: myPaint() };
    } else if (m === 'crysta') {
      if (lastDrive !== 'crysta') { send({ t: 'claim', k: crystaKey() }); lastDrive = 'crysta'; }
    } else if (m === 'foot' && lastDrive) {
      if (lastDrive === 'crysta') send({ t: 'park', k: crystaKey(), kind: 'crysta', x: +playerCarGroup.position.x.toFixed(2), z: +playerCarGroup.position.z.toFixed(2), rot: +playerCarGroup.rotation.y.toFixed(3), lock: 1 });
      else { const v = lastDrive.v, q = v.g.position; send({ t: 'park', k: v._mpKey, kind: lastDrive.kind, x: +q.x.toFixed(2), z: +q.z.toFixed(2), rot: +v.g.rotation.y.toFixed(3), paint: lastDrive.paint }); ghosts[v._mpKey] = v; holding = null; }
      lastDrive = null;
    }
  }
  function recall() {            // after a (re)connect: tell the new session what we are holding
    if (typeof Player === 'undefined') return;
    if (Player.mode === 'vehicle' && Player.active && Player.active._mpKey) send({ t: 'claim', k: Player.active._mpKey });
    if (Player.mode === 'crysta') { send({ t: 'claim', k: crystaKey() }); }
    else if (Player.mode === 'foot') send({ t: 'park', k: crystaKey(), kind: 'crysta', x: +playerCarGroup.position.x.toFixed(2), z: +playerCarGroup.position.z.toFixed(2), rot: +playerCarGroup.rotation.y.toFixed(3), lock: 1 });
  }
  let hooked = false;
  function hookPlayer() {
    if (hooked || typeof Player === 'undefined') return; hooked = true;
    // keyboard, gamepad and touch all end in Player.toggle / resetToCrysta
    const toggle = Player.toggle, reset = Player.resetToCrysta;
    Player.toggle = () => {
      if (ride) return leaveSeat();
      if (Player.mode === 'foot' && status === 'online') {
        const q = remoteToBoard(), own = Player._pick();
        if (q && (!own || q.clear <= own.d)) {
          if (performance.now() - asking > 1500) { asking = performance.now(); send({ t: 'seat_req', driver: q.id }); }
          return;
        }
        // shared vehicles: ask the server first, so two players can't take the same one
        const k = own && pickKey(own);
        if (k) { if (!pendingClaim) { pendingClaim = k; rawToggle = toggle; send({ t: 'claim', k }); setTimeout(() => { if (pendingClaim === k) pendingClaim = null; }, 2500); } return; }
      }
      return toggle();
    };
    Player.resetToCrysta = () => { if (ride) leaveSeat(); return reset(); };
    Player.onKnock = it => { const k = pkKey(it); knockedSeen.add(k); return (dx, dz) => send({ t: 'knock', k, dx: +dx.toFixed(3), dz: +dz.toFixed(3) }); };
  }
  // riders sitting in vehicles: the model of a rider, in the driver's car, on every client including the driver's
  function clearSitters(r) { if (!r.sit) return; for (const k in r.sit) { const h = r.sit[k].g; if (h.parent) h.parent.remove(h); } r.sit = null; }
  function hostOf(id) {                        // { key, g, model, def } of the vehicle driven by player id
    if (id === myId) {
      if (typeof Player === 'undefined' || Player.mode === 'foot' || ride) return null;
      if (Player.mode === 'crysta') return { o: localHost, g: playerCarGroup, model: 'suv', def: null, kind: 'crysta' };
      const a = Player.active; return a ? { o: localHost, g: a.g, model: a.model, def: a.seat, kind: myKind() } : null;
    }
    const r = remotes[id]; return r && r.kind !== 'foot' ? { o: r, g: r.g, model: classOf(r), def: r.seatDef, kind: r.kind } : null;
  }
  const localHost = {};
  function syncSitters() {
    const want = new Map();
    for (const [id, r] of Object.entries(remotes)) if (r.ride) want.set(id, { d: r.ride[0], s: r.ride[1], color: r.color });
    const seen = new Set();
    for (const [id, w] of want) {
      if (ride && w.d === ride.driver && w.s === ride.seat) continue;
      const H = hostOf(w.d); if (!H) continue;
      const box = H.o.sit || (H.o.sit = {}); seen.add(box); let e = box[id];
      if (e && (e.host !== H.g || e.seat !== w.s)) { if (e.g.parent) e.g.parent.remove(e.g); e = null; delete box[id]; }
      if (!e) {
        const p = person(w.color); if (!p.human) continue;
        const list = seatsOf(H.model, H.def, H.kind), s = list[w.s % list.length];
        HumanModel.sit(p.human, s[3]);
        p.g.position.set(s[0], s[1] - 0.87, s[2]); H.g.add(p.g);
        e = box[id] = { g: p.g, host: H.g, seat: w.s };
      }
      e.stamp = sitStamp + 1;
    }
    sitStamp++;
    for (const o of [localHost, ...Object.values(remotes)]) if (o.sit) for (const k in o.sit) if (o.sit[k].stamp !== sitStamp) { const g = o.sit[k].g; if (g.parent) g.parent.remove(g); delete o.sit[k]; }
  }
  let sitStamp = 0, sitT = 0;
  // F hint next to another player's vehicle
  function drawSeatHint() {
    const q = typeof Player !== 'undefined' && Player.mode === 'foot' && status === 'online' ? remoteToBoard() : null;
    if (!seatHint) { seatHint = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpSeatHint' })); css(seatHint, 'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:7;padding:7px 14px;border-radius:18px;background:rgba(10,15,25,.8);color:#fff;font:600 13px system-ui,sans-serif;pointer-events:none;display:none'); }
    seatHint.style.display = q ? 'block' : 'none';
    if (q) seatHint.textContent = 'F · Ride with ' + q.r.name;
  }

  // ================================================================ interpolation
  const herm = (p0, m0, p1, m1, k, h) => { const k2 = k * k, k3 = k2 * k; return (2 * k3 - 3 * k2 + 1) * p0 + (k3 - 2 * k2 + k) * h * m0 + (-2 * k3 + 3 * k2) * p1 + (k3 - k2) * h * m1; };
  function sample(r, rt) {
    const b = r.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) { stats.held++; return { ...b[0], mode: 'hold' }; }
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= rt && rt <= b[i].t) {
        const a = b[i - 1], c = b[i], p = b[i - 2] || a, n = b[i + 1] || c, h = (c.t - a.t) / 1000 || 0.001, k = (rt - a.t) / ((c.t - a.t) || 1);
        const hp = (c.t - p.t) / 1000 || h, hn = (n.t - a.t) / 1000 || h;
        while (b.length > 3 && b[2].t < rt - 500) b.shift();
        stats.interp++;
        return { x: herm(a.x, (c.x - p.x) / hp, c.x, (n.x - a.x) / hn, k, h), z: herm(a.z, (c.z - p.z) / hp, c.z, (n.z - a.z) / hn, k, h), y: a.y + (c.y - a.y) * k,
          rot: a.rot + wrapA(c.rot - a.rot) * k, spd: a.spd + (c.spd - a.spd) * k, st: a.st + (c.st - a.st) * k, lean: a.lean + (c.lean - a.lean) * k, fl: c.fl, mode: 'interp' };
      }
    }
    // past the newest sample: dead reckon along the last velocity, briefly
    const L = b[b.length - 1], P = b.length > 1 ? b[b.length - 2] : L, dtS = (L.t - P.t) / 1000 || 1;
    if (dtS > 1) return { ...L, mode: 'hold' };
    const ex = Math.min(MAX_EXTRAP, rt - L.t) / 1000;
    stats.extrap++;
    return { ...L, x: L.x + (L.x - P.x) / dtS * ex, z: L.z + (L.z - P.z) / dtS * ex, rot: L.rot + wrapA(L.rot - P.rot) / dtS * ex, mode: 'extrap' };
  }
  const DOOR_IDS = ['FL', 'FR', 'RL', 'RR'], MASS = { bike: 180, auto: 450, hatch: 1000, suv: 1800, tractor: 2500, lorry: 9000, bus: 11000, bullockCart: 800 };
  function doorBits() {
    try {
      if (Player.mode !== 'vehicle' || !Player.active || !Player.active._prt) return 0;
      const R = Player.active._prt; let b = 0;
      DOOR_IDS.forEach((id, i) => { if (R.doors[id] && R.doors[id]._to) b |= 1 << i; });
      if (R.boot && R.boot._to) b |= 16; if (R.hood && R.hood._to) b |= 32;
      return b;
    } catch (e) { return 0; }
  }
  function animDoors(r, dt) {
    if (r.kind === 'foot' || (!r.doors && !r.doorsOn)) return;
    let R; try { R = r.R || (r.R = Player.partsOf(r)); } catch (e) { r.doorsOn = false; return; }
    let live = false;
    [R.doors.FL, R.doors.FR, R.doors.RL, R.doors.RR, R.boot, R.hood].forEach((q, i) => {
      if (!q) return;
      const to = r.doors & (1 << (i < 4 ? i : i)) ? 1 : 0; r.doorT[i] += (to - r.doorT[i]) * Math.min(1, dt * 7);
      if (Math.abs(to - r.doorT[i]) < 0.004) r.doorT[i] = to; else live = true;
      if (q.gen) q.mesh.visible = r.doorT[i] > 0; TrafficModels.setPart(q, r.doorT[i]);
    });
    r.doorsOn = live;
  }
  function myPaint() { try { const a = Player.active; if (!a || Player.mode !== 'vehicle') return 0; return a._mpPaint != null ? a._mpPaint : (a._mpPaint = colourOf(a) || 0); } catch (e) { return 0; } }
  function sendMeta() {
    const P = typeof Player !== 'undefined' ? Player : null, S = window.SafeHouse2 && SafeHouse2.state, w = S && S.localWant;
    const m = { mode: P ? P.mode : 'crysta', kind: myKind(), cap: myCap(), paint: myPaint(), doors: doorBits(), wf: w ? (w.gate ? 1 : 0) | (w.ped ? 2 : 0) | (w.door ? 4 : 0) : 0 }, j = JSON.stringify(m);
    if (j !== lastMeta) { lastMeta = j; send({ t: 'm', m }); }
  }
  let lastMeta = '';
  function myState() {
    const P = typeof Player !== 'undefined' ? Player : null, foot = P && (P.mode === 'foot'), a = P && P.active;
    let steer = 0, lean = 0, fl = 0, y = 0;
    try {
      if (P && P.mode === 'crysta') { steer = steerAngle; }
      else if (a && P.mode === 'vehicle') { steer = a._vd ? a._vd.delta : 0; lean = a.g.rotation.z; }
      if (foot) { y = P.ped.y || 0; if (P.ped.air) fl |= 8; }
      if (typeof inputState !== 'undefined' && inputState.brake && !foot) fl |= 1;
      if (typeof headlightsOn !== 'undefined' && headlightsOn) fl |= 2;
      if (carSpeed < -0.5) fl |= 4;
    } catch (e) {}
    return [Math.round(serverNow()), +carPos.x.toFixed(2), +y.toFixed(2), +carPos.z.toFixed(2), +carRot.toFixed(3), +carSpeed.toFixed(1), +steer.toFixed(2), +lean.toFixed(2), fl];
  }
  function sendState() {
    const a = myState();
    // skip identical states (parked), but resend once a second as a keep-alive
    const same = lastSent && a.every((v, i) => i === 0 || v === lastSent[i]);
    if (!same || ++idleSends >= 15) { send({ t: 's', a }); lastSent = a; idleSends = 0; stats.sent = (stats.sent || 0) + 1; }
    else stats.skipped = (stats.skipped || 0) + 1;
  }
  // a hidden tab gets no frames: timers still tick (about once a second), so the others keep seeing this player
  setInterval(() => { if (document.hidden && status === 'online') { sendMeta(); sendState(); } }, 900);
  function capsule(hl, hw, x, z, rot, out) {   // three circles along the body
    const fx = Math.sin(rot) * hl, fz = Math.cos(rot) * hl;
    out[0] = x - fx; out[1] = z - fz; out[2] = x; out[3] = z; out[4] = x + fx; out[5] = z + fz;
  }
  const capA = [0, 0, 0, 0, 0, 0], capB = [0, 0, 0, 0, 0, 0];
  function bump(id, r) {
    const foot = myKind() === 'foot', rf = r.kind === 'foot';
    const myHw = foot ? 0.4 : Player.mode === 'crysta' ? 0.95 : (Player.active && Player.active.hw) || 0.9, myHl = foot ? 0 : Math.max(0, (Player.mode === 'crysta' ? 2.3 : ((Player.active && Player.active.len) || 4) / 2) - myHw);
    const oHw = rf ? 0.4 : r.hw || 0.9, oHl = rf ? 0 : Math.max(0, (r.len || 4) / 2 - oHw), reach = myHl + myHw + oHl + oHw;
    const q = r.g.position; if (Math.abs(q.x - carPos.x) > reach || Math.abs(q.z - carPos.z) > reach) return;
    capsule(myHl, myHw, carPos.x, carPos.z, carRot, capA); capsule(oHl, oHw, q.x, q.z, r.g.rotation.y, capB);
    let best = 1e9, nx = 0, nz = 0;
    for (let i = 0; i < 6; i += 2) for (let j = 0; j < 6; j += 2) {
      const dx = capA[i] - capB[j], dz = capA[i + 1] - capB[j + 1], d = Math.hypot(dx, dz);
      if (d < best) { best = d; nx = dx; nz = dz; }
    }
    const min = myHw + oHw; if (best >= min) return;
    const d = best || 0.01, push = min - best;
    if (!best) { nx = 1; nz = 0; }
    const mm = foot ? 70 : MASS[Player.mode === 'crysta' ? 'suv' : (Player.active && Player.active.model)] || 1500, mo = rf ? 70 : MASS[r.model] || 1500, share = mo / (mm + mo);
    carPos.x += nx / d * push * Math.max(0.5, share); carPos.z += nz / d * push * Math.max(0.5, share);   // each side moves itself
    if (rf && !foot) return;                                                                              // a walker never stops a car
    const closing = Math.abs(carSpeed) - Math.abs(r.spd) * Math.sign((nx * Math.sin(r.g.rotation.y) + nz * Math.cos(r.g.rotation.y)) * (r.spd || 0) || 0);
    if (Math.abs(carSpeed) > 20 || Math.abs(r.spd) > 20) {
      if (typeof showComboPopup === 'function' && crashCool <= 0) showComboPopup('PLAYER CRASH!');
      if (crashCool <= 0) { crashCool = 3; send({ t: 'event', kind: 'crash', other: id }); }
    }
    carSpeed *= 1 - Math.min(0.85, share * (closing > 10 ? 1.2 : 0.4));
  }

  // ================================================================ per frame
  let crashCool = 0, statusT = 0, audioL = [];
  function update(dt) {
    sendT += dt; crashCool -= dt; hookPlayer(); trackVehicle(); syncTime(dt);
    if (sendT >= RATE) { sendT -= RATE; if (sendT > RATE) sendT = 0; sendMeta(); sendState(); }
    const now = performance.now(), sn = serverNow();
    stats.frames++;
    let depth = 0; audioL = [];
    for (const [id, r] of Object.entries(remotes)) {
      const target = Math.max(60, Math.min(1400, r.lagAvg + 2 * r.lagDev + r.gapAvg * 1.15));
      r.delay += (target - r.delay) * Math.min(1, dt * (target > r.delay ? 6 : 0.8));
      const rt = r.rt = sn - r.delay, s = sample(r, rt);
      if (s) {
        // an extrapolation that turned out wrong is blended away, never snapped
        if (r.sm === 'extrap' && s.mode === 'interp') { const ex = r.g.position.x - s.x, ez = r.g.position.z - s.z; if (Math.hypot(ex, ez) < 6) { r.ox = ex; r.oz = ez; } }
        r.sm = s.mode;
        const fade = Math.exp(-dt * 7); r.ox *= fade; r.oz *= fade;
        const px = r.g.position.x, pz = r.g.position.z, nx = s.x + r.ox, nz = s.z + r.oz;
        r.g.position.x = nx; r.g.position.z = nz; r.g.rotation.y = s.rot; r.spd = s.spd;
        const dc0 = camera.position.distanceTo(r.g.position);
        if (r.kind === 'foot') r.g.position.y = s.y;
        else {
          const gnd = typeof groundY === 'function' ? groundY : () => 0;
          r.g.position.y = gnd(nx, nz);
          if (dc0 < 140 && r.model !== 'bike') {          // lie on the ground the way the driver's springs do
            const f = Math.sin(s.rot), c = Math.cos(s.rot), L = (r.len || 4) * 0.42, W = r.hw || 0.9;
            const pitch = -Math.atan2(gnd(nx + f * L, nz + c * L) - gnd(nx - f * L, nz - c * L), 2 * L);
            const roll = Math.atan2(gnd(nx + c * W, nz - f * W) - gnd(nx - c * W, nz + f * W), 2 * W);
            r.rp += (pitch - r.rp) * Math.min(1, dt * 10); r.rr += (roll - r.rr) * Math.min(1, dt * 10);
          } else { r.rp = 0; r.rr = 0; }
          r.g.rotation.x = r.rp; r.g.rotation.z = r.rr + s.lean;
          const v = (s.spd || 0) / 3.6;
          for (const w of r.wheels) w.rotation.x += v * dt / 0.33;
          r.steerNow += (s.st - r.steerNow) * Math.min(1, dt * 12);
          for (const q of r.steer) q.rotation.y = r.steerNow;
          // lamps: same values the local driver sees
          if (s.fl !== r.lit) {
            r.lit = s.fl; const on = !!(s.fl & 2);
            r.head.forEach(m => m.material.color.setHex(on ? 0xfff6d8 : 0x777766));
            r.tail.forEach(m => m.material.color.setHex(s.fl & 1 ? 0xff1a1a : on ? 0xb01818 : 0x661111));
          }
          animDoors(r, dt);
          if (r.model !== 'bullockCart' && !r.ride) { r.cur = Math.abs(v); audioL.push(r); }
        }
        if (r.human && r.kind === 'foot') {
          const P = r.human, v = Math.abs(s.spd) / 3.6;
          r.walkT += v * dt * 3.2; r.idleT = (r.idleT || 0) + dt;
          if (s.fl & 8) { HumanModel.animateWalk(P, 0.9, 1.2); if (P.legL) P.legL.rotation.x = -0.5; if (P.legR) P.legR.rotation.x = 0.3; if (P.shinL) P.shinL.rotation.x = 0.8; if (P.shinR) P.shinR.rotation.x = 0.5; }
          else if (v > 0.15) HumanModel.animateWalk(P, r.walkT, v);
          else HumanModel.animateIdle(P, r.idleT);
        }
      }
      depth += r.buf.filter(b => b.t > rt).length;
      // name tag fade by distance
      const dc = camera.position.distanceTo(r.g.position);
      r.tag.visible = dc < TAG_FAR;
      r.tag.material.opacity = r.mate ? Math.max(0.6, 1 - dc / TAG_FAR) : Math.max(0, Math.min(1, 1.15 - dc / TAG_FAR));
      const sc = 1 + Math.min(2, dc / 60); r.tag.scale.set(3.2 * sc, 0.8 * sc, 1);
      if (ride && ride.driver === id) {
        // the seat follows the same smoothed position everyone sees; Player.update ran first, so overwrite this frame's copy
        r.kmh = Math.abs(r.spd);
        carPos.set(r.g.position.x, 0, r.g.position.z); carRot = r.g.rotation.y; carSpeed = r.spd;
      }
      // never the car you are in, nor someone riding in a car
      if (ride || r.ride || isMyRider(id) || !r.g.visible) continue;
      bump(id, r);
    }
    stats.bufDepth = depth;
    if ((sitT += dt) > 0.25) { sitT = 0; syncSitters(); drawSeatHint(); }
    // pings: animate, expire
    for (const [o, p] of Object.entries(pings)) {
      const age = now - p.born;
      if (age > p.ttl) { removePing(o); continue; }
      const u = p.mesh.userData, k = (now / 1000) % 1.5 / 1.5;
      u.ring.scale.setScalar(1 + k * 2); u.ring.material.opacity = 0.85 * (1 - k);
      u.tip.rotation.y += dt * 2; u.tip.position.y = 8 + Math.sin(now / 300) * 0.6;
      const dc = camera.position.distanceTo(p.mesh.position); u.tip.scale.setScalar(Math.max(1, dc / 40));
    }
    fadeLog();
    if (isHudVisible()) { [$compass, $hdg, $coords].forEach(e => e.style.display = ''); drawCompass(); }
    if ((statusT += dt) > 0.5) { statusT = 0; drawSquad(); if (boardOpen) drawBoard(); }
  }
  const isMyRider = id => { const r = remotes[id]; return !!(r && r.ride && r.ride[0] === myId); };
  const isHudVisible = () => { const d = document.getElementById('dash'); return !d || d.style.display !== 'none'; };

  function drawSquad() {
    if (!squad.code) { $squad.style.display = 'none'; return; }
    $squad.style.display = '';
    let html = `<div class="row" style="border-color:#4ade80;font-weight:700">SQUAD ${squad.code} · ${squad.members.length}/8</div>`;
    for (const id of squad.members) {
      if (id === myId) { html += `<div class="row" style="border-color:${myColor}">◆ ${escape(myName())} (you) · ${KIND_NAME[myKind()] || myKind()}</div>`; continue; }
      const r = remotes[id];
      if (!r) { html += `<div class="row" style="border-color:#64748b;color:#94a3b8">… joining</div>`; continue; }
      const d = Math.hypot(r.g.position.x - carPos.x, r.g.position.z - carPos.z);
      html += `<div class="row" style="border-color:${r.color}">◆ <b style="color:${r.color}">${escape(r.name)}</b> · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} · ${KIND_NAME[r.kind] || r.kind}</div>`;
    }
    $squad.innerHTML = html;
  }
  let boardOpen = false;
  function drawBoard() {
    let rows = `<tr><td><b style="color:${myColor}">● ${escape(myName())}</b> (you)${squad.code ? ' ◆' : ''}</td><td>${KIND_NAME[myKind()] || myKind()}</td><td>${Math.round(rtt)} ms</td><td>—</td><td>${gridRef(carPos.x, carPos.z)}</td></tr>`;
    const list = Object.entries(remotes).map(([id, r]) => ({ id, r, d: Math.hypot(r.g.position.x - carPos.x, r.g.position.z - carPos.z) })).sort((a, b) => a.d - b.d);
    for (const { id, r, d } of list) rows += `<tr><td><b style="color:${r.color}">● ${escape(r.name)}</b>${isMate(id) ? ' <span style="color:#4ade80">◆</span>' : ''}</td><td>${KIND_NAME[r.kind] || r.kind}</td><td>${r.rtt} ms</td><td>${Math.round(d)} m</td><td>${gridRef(r.g.position.x, r.g.position.z)}</td></tr>`;
    $board.innerHTML = `<div style="font-weight:800;margin-bottom:6px">NELLUTLA · ${list.length + 1} players${squad.code ? ` · squad ${squad.code}` : ''}</div><table><tr><th>PLAYER</th><th>VEHICLE</th><th>PING</th><th>DISTANCE</th><th>GRID</th></tr>${rows}</table>`;
  }

  // ================================================================ radar + maps
  function drawRadar(ctx, scale, rot) {
    const proj = (x, z) => { const dx = x - carPos.x, dz = z - carPos.z; return [(dx * Math.cos(rot) - dz * Math.sin(rot)) * scale, (dx * Math.sin(rot) + dz * Math.cos(rot)) * scale]; };
    for (const [id, r] of Object.entries(remotes)) {
      const [rx, rz] = proj(r.g.position.x, r.g.position.z);
      if (Math.hypot(rx, rz) > 105) continue;
      ctx.fillStyle = r.color; ctx.strokeStyle = isMate(id) ? '#4ade80' : '#fff'; ctx.lineWidth = isMate(id) ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(110 + rx, 110 + rz, 5, 0, 7); ctx.fill(); ctx.stroke();
    }
    for (const p of Object.values(pings)) {
      let [rx, rz] = proj(p.x, p.z); const d = Math.hypot(rx, rz), edge = d > 98;
      if (edge) { rx *= 98 / d; rz *= 98 / d; }
      ctx.save(); ctx.translate(110 + rx, 110 + rz);
      ctx.fillStyle = p.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(-5, -4); ctx.lineTo(5, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (edge) { ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(Math.round(Math.hypot(p.x - carPos.x, p.z - carPos.z)) + 'm', 0, -7); }
      ctx.restore();
    }
  }
  function drawPlayersOnMap(ctx, P) {
    for (const [id, r] of Object.entries(remotes)) {
      const [px, py] = P(r.g.position.x, r.g.position.z), mate = isMate(id);
      ctx.fillStyle = mate ? '#4ade80' : r.color; ctx.strokeStyle = mate ? '#14532d' : '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, mate ? 7 : 6, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = mate ? '#4ade80' : '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText((mate ? '◆ ' : '') + r.name, px + 9, py - 6);
    }
    for (const p of Object.values(pings)) {
      const [px, py] = P(p.x, p.z);
      ctx.fillStyle = p.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 8, py - 16); ctx.lineTo(px + 8, py - 16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py - 17, 6, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${p.name} · ${Math.round(Math.hypot(p.x - carPos.x, p.z - carPos.z))} m · ${gridRef(p.x, p.z)}`, px, py - 28);
      ctx.textAlign = 'left';
    }
  }
  function drawBigMap(ctx, P) { drawPlayersOnMap(ctx, P); }  // legacy hook

  // full big map with zoom / pan / grid (called by index.html instead of its own drawBigMap)
  const view = { zoom: 1, cx: null, cz: null, drag: null };
  let mapProj = null;
  function bigMap(canvas) {
    // only reallocate the backing store when the size really changed (resizing every frame is costly)
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
    const g = canvas.getContext('2d'), [x0, z0, x1, z1] = world.bounds;
    if (view.cx == null) { view.cx = (x0 + x1) / 2; view.cz = (z0 + z1) / 2; }
    const s0 = Math.min(canvas.width / (x1 - x0), canvas.height / (z1 - z0)), s = s0 * view.zoom;
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    world.drawMap(g, view.cx, view.cz, s, W, H, 0);
    const P = (x, z) => [W / 2 + (x - view.cx) * s, H / 2 + (z - view.cz) * s];
    mapProj = { s, W, H };
    // grid
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = 'bold 11px sans-serif';
    const cols = Math.ceil((x1 - x0) / CELL), rows = Math.ceil((z1 - z0) / CELL);
    for (let c = 0; c <= cols; c++) { const [px] = P(x0 + c * CELL, 0); g.beginPath(); g.moveTo(px, P(0, z0)[1]); g.lineTo(px, P(0, z1)[1]); g.stroke(); if (c < cols) g.fillText(colName(c), px + CELL * s / 2 - 4, Math.max(14, P(0, z0)[1] + 14)); }
    for (let r = 0; r <= rows; r++) { const [, py] = P(0, z0 + r * CELL); g.beginPath(); g.moveTo(P(x0, 0)[0], py); g.lineTo(P(x1, 0)[0], py); g.stroke(); if (r < rows) g.fillText(String(r + 1), Math.max(4, P(x0, 0)[0] + 4), py + CELL * s / 2 + 4); }
    g.font = '12px sans-serif';
    world.landmarks.forEach(l => { const [px, py] = P(l.x, l.z); g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(l.name, px + 6, py + 4); });
    try { const m = MISSIONS[mIdx], [mx, my] = P(m.l.x, m.l.z); g.strokeStyle = '#fbbf24'; g.lineWidth = 3; g.beginPath(); g.arc(mx, my, 10, 0, 7); g.stroke(); } catch (e) {}
    drawPlayersOnMap(g, P);
    const [px, py] = P(carPos.x, carPos.z); g.fillStyle = '#38bdf8'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 7, 0, 7); g.fill(); g.stroke();
    g.fillStyle = 'rgba(10,15,25,.8)'; g.fillRect(10, H - 30, 470, 22); g.fillStyle = '#cbd5e1'; g.font = '12px sans-serif';
    g.fillText(`Wheel zoom (${view.zoom.toFixed(1)}×) · drag pan · click ping · double-click recentre · M / Esc / click outside closes`, 18, H - 14);
  }
  function mapToWorld(canvas, ex, ey) {
    const rc = canvas.getBoundingClientRect(), mx = (ex - rc.left) * canvas.width / rc.width, my = (ey - rc.top) * canvas.height / rc.height;
    return [view.cx + (mx - mapProj.W / 2) / mapProj.s, view.cz + (my - mapProj.H / 2) / mapProj.s];
  }
  function hookBigMap() {
    const c = document.getElementById('bigmap'); if (!c) return;
    c.addEventListener('wheel', e => {
      e.preventDefault(); if (!mapProj) return;
      const [wx, wz] = mapToWorld(c, e.clientX, e.clientY);
      const nz = Math.max(0.6, Math.min(12, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))), k = view.zoom / nz;
      view.cx = wx + (view.cx - wx) * k; view.cz = wz + (view.cz - wz) * k; view.zoom = nz;
    }, { passive: false });
    c.addEventListener('mousedown', e => { if (e.button === 0) view.drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: 0 }; });
    addEventListener('mousemove', e => {
      if (!view.drag || !mapProj) return;
      const dx = e.clientX - view.drag.x, dy = e.clientY - view.drag.y; view.drag.moved = Math.max(view.drag.moved, Math.hypot(dx, dy));
      view.cx = view.drag.cx - dx / mapProj.s; view.cz = view.drag.cz - dy / mapProj.s;
    });
    addEventListener('mouseup', e => {
      const d = view.drag; view.drag = null;
      if (d && d.moved < 4 && e.target === c && mapProj) { const [x, z] = mapToWorld(c, e.clientX, e.clientY); placePing(x, z); }
    });
    c.addEventListener('dblclick', () => { view.cx = carPos.x; view.cz = carPos.z; view.zoom = Math.max(view.zoom, 3); });
  }

  // ================================================================ chat input + commands
  function setChannel(c) { channel = c; $ch.textContent = c === 'squad' ? 'SQUAD' : 'ALL'; $ch.style.background = c === 'squad' ? '#166534' : '#1e3a8a'; }
  function openChat() { panel.classList.add('typing'); $in.value = ''; $in.focus(); Object.keys(inputState).forEach(k => inputState[k] = false); $log.scrollTop = $log.scrollHeight; }
  function closeChat() { panel.classList.remove('typing'); $in.blur(); lastChatAt = performance.now(); }
  function command(t) {
    const [cmd, a, b] = t.split(/\s+/);
    if (cmd === '/name' && a) { const n = t.slice(6).trim(); setName(n); sys('Name changed to ' + n); }
    else if (cmd === '/squad' && a === 'create') send({ t: 'squad', op: 'create' });
    else if (cmd === '/squad' && a === 'join' && b) send({ t: 'squad', op: 'join', code: b });
    else if (cmd === '/squad' && a === 'leave') { lastSquad = null; send({ t: 'squad', op: 'leave' }); }
    else if (cmd === '/clearping') send({ t: 'ping_clear' });
    else sys('Commands: /squad create · /squad join CODE · /squad leave · /name NAME · /clearping. Emoji: :) :D <3 :fire: :car: :temple: :thumbsup: :tea: :cow:', 'info');
  }
  function sendChat(text, ch) {
    if (status !== 'online') { sys('Not connected', 'warn'); return; }
    send({ t: 'chat', text: emojify(text), ch: ch || channel });
  }
  $in.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); if (squad.code) setChannel(channel === 'all' ? 'squad' : 'all'); else { setChannel('all'); sys('Join a squad to use SQUAD chat (/squad create)', 'warn'); } return; }
    if (e.key === 'Enter') { const t = $in.value.trim(); if (t) { if (t.startsWith('/')) command(t); else sendChat(t); } closeChat(); }
    if (e.key === 'Escape') closeChat();
  });
  $in.addEventListener('keyup', e => e.stopPropagation());
  $in.addEventListener('blur', () => panel.classList.remove('typing'));

  // ================================================================ quick-chat wheel
  const QUICK = ['Follow me', 'Wait here', 'Need a ride', 'Race?', 'Nice drive!', 'Help!', 'Going to temple', 'Thanks'];
  const QICON = ['➡️', '✋', '🚕', '🏁', '👏', '🆘', '🛕', '🙏'];
  let wheelOpen = false, wheelSel = -1;
  function drawWheel() {
    const g = $wheel.getContext('2d'), C = 180; g.clearRect(0, 0, 360, 360);
    for (let i = 0; i < 8; i++) {
      const a0 = -Math.PI / 2 + (i - 0.5) * Math.PI / 4, a1 = a0 + Math.PI / 4;
      g.beginPath(); g.moveTo(C + Math.cos(a0) * 55, C + Math.sin(a0) * 55); g.arc(C, C, 170, a0, a1); g.arc(C, C, 55, a1, a0, true); g.closePath();
      g.fillStyle = i === wheelSel ? 'rgba(59,130,246,.9)' : 'rgba(10,15,25,.82)'; g.fill(); g.strokeStyle = 'rgba(148,163,184,.5)'; g.lineWidth = 1.5; g.stroke();
      const am = -Math.PI / 2 + i * Math.PI / 4, tx = C + Math.cos(am) * 113, ty = C + Math.sin(am) * 113;
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '20px sans-serif'; g.fillText(QICON[i], tx, ty - 4);
      g.font = 'bold 12px system-ui,sans-serif'; g.fillText(QUICK[i], tx, ty + 14); g.fillStyle = '#94a3b8'; g.font = '10px sans-serif'; g.fillText(String(i + 1), tx, ty + 27);
    }
    g.fillStyle = '#e2e8f0'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText(squad.code ? 'to SQUAD' : 'to ALL', C, C + 4);
  }
  function openWheel() { wheelOpen = true; wheelSel = -1; $wheel.style.display = 'block'; drawWheel(); }
  function closeWheel(sendSel) {
    if (!wheelOpen) return; wheelOpen = false; $wheel.style.display = 'none';
    if (sendSel && wheelSel >= 0) quick(wheelSel);
  }
  function quick(i) {
    if (status !== 'online') { sys('Not connected', 'warn'); return; }
    send({ t: 'quick', text: QUICK[i], ch: squad.code ? 'squad' : 'all', x: +carPos.x.toFixed(1), z: +carPos.z.toFixed(1) });
  }
  addEventListener('mousemove', e => {
    if (!wheelOpen) return;
    const dx = e.clientX - innerWidth / 2, dy = e.clientY - innerHeight / 2;
    if (Math.hypot(dx, dy) < 40) wheelSel = -1;
    else wheelSel = ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
    drawWheel();
  });
  addEventListener('mousedown', e => {
    if (wheelOpen && e.button === 0) { e.preventDefault(); e.stopPropagation(); closeWheel(true); return; }
    if (e.button === 1 && e.target.tagName === 'CANVAS' && e.target.id !== 'bigmap' && typeof isPlaying !== 'undefined' && isPlaying) { e.preventDefault(); pingAtCrosshair(); }
  }, true);

  // ================================================================ global keys (capture phase so game keys don't fire)
  addEventListener('keydown', e => {
    if (typing()) return;
    if (wheelOpen && /^Digit[1-8]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); wheelSel = +e.code.slice(5) - 1; closeWheel(true); return; }
    if (e.key === 'Enter' && status === 'online') { e.preventDefault(); openChat(); return; }
    if (typeof isPlaying !== 'undefined' && !isPlaying) return;
    if (e.code === 'KeyH') send({ t: 'horn' });
    if (e.code === 'KeyG' && ride && !e.repeat) { e.stopPropagation(); send({ t: 'seat_switch' }); }
    if (e.code === 'KeyQ' && !e.repeat && status === 'online') { e.stopPropagation(); openWheel(); }
    if (e.code === 'KeyZ' && !e.repeat) { e.stopPropagation(); pingAtCrosshair(); }
    if (e.code === 'Tab' && !window.GamePaused && !document.querySelector('#info.open,#settings.open')) { e.preventDefault(); e.stopPropagation(); if (!boardOpen) { boardOpen = true; $board.style.display = 'block'; drawBoard(); } }
  }, true);
  addEventListener('keyup', e => {
    if (typing()) return;
    if (e.code === 'KeyQ') closeWheel(true);
    if (e.code === 'Tab') { e.preventDefault(); boardOpen = false; $board.style.display = 'none'; }
  }, true);
  addEventListener('blur', () => { closeWheel(false); boardOpen = false; $board.style.display = 'none'; });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', hookBigMap); else hookBigMap();

  function netStats() {
    const g = stats.gaps, mean = g.reduce((a, b) => a + b, 0) / (g.length || 1);
    const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / (g.length || 1));
    const tot = stats.interp + stats.extrap + stats.held || 1;
    return { clockOffset: Math.round(clock.offset), rtt: Math.round(rtt), snaps: stats.snaps, snapGapMean: +mean.toFixed(1), snapGapSd: +sd.toFixed(1),
      interpPct: +(100 * stats.interp / tot).toFixed(1), extrapPct: +(100 * stats.extrap / tot).toFixed(1), heldPct: +(100 * stats.held / tot).toFixed(1),
      bufferedAhead: stats.bufDepth, kbpsIn: +(stats.rx / 1024 / ((performance.now() - stats.t0) / 1000)).toFixed(1), kbpsOut: +(stats.tx / 1024 / ((performance.now() - stats.t0) / 1000)).toFixed(1), delays: Object.values(remotes).map(r => Math.round(r.delay)), sent: stats.sent || 0, skippedIdle: stats.skipped || 0 };
  }

  setStatus();
  return { placePing, send: sendType, on, off, serverNow, get audioList() { return audioL; }, resetStats() { Object.assign(stats, { rx: 0, tx: 0, t0: performance.now(), interp: 0, extrap: 0, held: 0, gaps: [] }); }, get mapView() { return view; }, connect, update, drawRadar, drawBigMap, bigMap, setName, myName, latLon, gridRef, heading, netStats, placePing, sendChat, command,
    get remotes() { return remotes; }, get ride() { return ride; }, get myId() { return myId; }, get pings() { return pings; }, get squad() { return squad; },
    get online() { return status === 'online'; }, get players() { return Object.keys(remotes).length + 1; } };
})();
