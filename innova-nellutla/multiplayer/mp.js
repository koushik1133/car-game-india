// Multiplayer client for multiplayer/server.py (ws://<host>:8094).
// - sends this player's state at 12 Hz (skipped while parked), renders others ~100 ms in the past with snapshot
//   interpolation on a server clock estimate (extrapolates up to 250 ms when packets stop)
// - chat panel (ALL / SQUAD, Tab switches while typing), quick-chat wheel (hold Q), squads (/squad ...)
// - shared map pings (Z / middle-click / click on the big map), coordinates + grid HUD, compass strip
// - scoreboard (hold Tab), zoomable/pannable big map (M)
const MP = (function () {
  const RATE = 1 / 12, INTERP_DELAY = 100, MAX_EXTRAP = 250, CELL = 200, TAG_FAR = 250;
  const LAT0 = 17.70160, LON0 = 79.19630, M_PER_DEG_LAT = 110574, M_PER_DEG_LON = 111320 * Math.cos(17.7016 * Math.PI / 180);
  let ws = null, myId = null, myColor = '#38bdf8', sendT = 0, status = 'offline', retry = 0;
  let lastSquad = null, retryTimer = 0, wantOnline = false, everOnline = false, lastMsgAt = 0;
  let squad = { code: null, members: [] }, channel = 'all', rtt = 0, lastSent = null, idleSends = 0;
  const remotes = {};               // id -> { g, body, wheels, head, tail, kind, name, color, squad, buf: [{t,x,z,rot,spd}], ... }
  const pings = {};                 // owner -> { x, z, name, color, t, ttl, mesh }
  const clock = { offset: null, samples: [] };
  const stats = { frames: 0, interp: 0, extrap: 0, held: 0, snaps: 0, gaps: [], lastSnapAt: 0, bufDepth: 0 };
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
      html += `<div class="tick" style="left:${x}px;${n % 45 === 0 ? 'color:' + (n === 0 ? '#f87171' : '#fff') + ';font-size:13px' : 'color:#64748b;font-size:10px;top:8px'}">${lbl}</div>`;
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
  function person(color) {
    const g = new THREE.Group(), m = c => new THREE.MeshLambertMaterial({ color: c });
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(new THREE.BoxGeometry(0.44, 0.62, 0.26), m(color), 0, 1.13, 0);
    add(new THREE.SphereGeometry(0.13, 10, 8), m(0x7a4a2e), 0, 1.6, 0);
    const legs = [add(new THREE.BoxGeometry(0.15, 0.82, 0.15), m(0x2c3e50), -0.1, 0.41, 0), add(new THREE.BoxGeometry(0.15, 0.82, 0.15), m(0x2c3e50), 0.1, 0.41, 0)];
    return { g, legs, wheels: [], head: [], tail: [] };
  }
  function vehicle(kind) {
    if (kind === 'crysta') {
      const v = TrafficModels.suv();
      v.g.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() !== 0x1c2733 && o.material.isMeshPhongMaterial) o.material = o.material.clone(), o.material.color.setHex(0xf4f4f4); });
      return v;
    }
    return (TrafficModels[kind] || TrafficModels.hatch)();
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
  function ensure(id, st) {
    let r = remotes[id];
    const kind = st.kind || 'crysta', mate = isMate(id);
    if (r && r.kind === kind && r.name === st.name && r.mate === mate) return r;
    const buf = r ? r.buf : [];
    if (r) scene.remove(r.g);
    const g = new THREE.Group(), m = modelFor(kind, st.color);
    g.add(m.g);
    const tag = nameTag(st.name, st.color, mate); tag.position.y = kind === 'bus' || kind === 'lorry' ? 4.6 : 3.0; g.add(tag);
    g.position.set(st.x, 0, st.z); g.rotation.y = st.rot;
    scene.add(g);
    const fresh = !r;
    r = remotes[id] = { g, body: m.g, legs: m.legs, wheels: m.wheels || [], head: m.head || [], tail: m.tail || [], night: null, tag,
      kind, name: st.name, color: st.color, mate, buf, spd: 0, walkT: 0, lastRecv: performance.now(), rtt: 0, mode: st.mode };
    if (fresh) setStatus();
    return r;
  }
  function drop(id) { const r = remotes[id]; if (r) { scene.remove(r.g); delete remotes[id]; setStatus(); } }

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
    try { sock = new WebSocket(`ws://${host}:8094`); } catch (e) { return schedule(); }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      retry = 0; status = 'online'; everOnline = true; lastMsgAt = performance.now(); setStatus();
      sock.send(JSON.stringify({ t: 'hello', name: myName() }));
      for (let i = 0; i < 4; i++) setTimeout(sendPing, i * 150);
    };
    sock.onclose = () => {
      if (ws !== sock) return;              // stale socket: a newer one already replaced it
      ws = null; status = 'offline'; lastSquad = squad.code || lastSquad; Object.keys(remotes).forEach(drop); Object.keys(pings).forEach(removePing);
      squad = { code: null, members: [] }; setStatus(); schedule();
    };
    sock.onerror = () => {};
    sock.onmessage = ev => {
      if (ws !== sock) return;
      lastMsgAt = performance.now();
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') {
        myId = m.id; myColor = m.color; if (clock.offset == null) clock.offset = m.st - performance.now();
        if (lastSquad) send({ t: 'squad', op: 'rejoin', code: lastSquad });   // keep the squad across a reconnect
      }
      else if (m.t === 'pong') {
        const now = performance.now(), r = now - m.c;
        clock.samples.push({ r, off: m.st - (m.c + r / 2) }); if (clock.samples.length > 10) clock.samples.shift();
        const best = clock.samples.reduce((a, b) => b.r < a.r ? b : a);
        clock.offset = clock.offset == null ? best.off : clock.offset + (best.off - clock.offset) * 0.3;
        rtt = rtt ? rtt * 0.7 + r * 0.3 : r; setStatus();
      }
      else if (m.t === 'snap') {
        const now = performance.now();
        stats.snaps++; if (stats.lastSnapAt) { stats.gaps.push(now - stats.lastSnapAt); if (stats.gaps.length > 120) stats.gaps.shift(); } stats.lastSnapAt = now;
        for (const [id, st] of Object.entries(m.players)) {
          if (id === myId) continue;
          const r = ensure(id, st);
          const last = r.buf[r.buf.length - 1];
          if (!last || m.st > last.t) r.buf.push({ t: m.st, x: st.x, z: st.z, rot: st.rot, spd: st.spd || 0 });
          if (r.buf.length > 40) r.buf.shift();
          r.lastRecv = now; r.rtt = st.rtt || 0; r.mode = st.mode; r.squad = st.squad;
        }
        for (const id of Object.keys(remotes)) if (!m.players[id]) drop(id);
      }
      else if (m.t === 'leave') drop(m.id);
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
        if (r && Math.hypot(r.g.position.x - carPos.x, r.g.position.z - carPos.z) < 120) { try { SFX.horn(r.kind || 'hatch', r.g.position.x, r.g.position.z); } catch (e) {} }   // their horn, from their car
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
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  let curName = null;   // fixed for this tab once chosen: other tabs writing localStorage must not rename us
  function myName() {
    if (curName) return curName;
    let n = ''; try { n = localStorage.getItem('nellutla.name') || ''; } catch (e) {}
    if (!n) {   // keep one generated name per browser so reconnects don't look like new players
      n = 'Player ' + Math.floor(100 + Math.random() * 900);
      try { localStorage.setItem('nellutla.name', n); } catch (e) {}
    }
    return (curName = n);
  }
  function setName(n) { curName = n; try { localStorage.setItem('nellutla.name', n); } catch (e) {} if (ws && ws.readyState === 1) send({ t: 'hello', name: n }); }
  function myKind() {
    if (typeof Player === 'undefined' || Player.mode === 'crysta') return 'crysta';
    if (Player.mode === 'foot') return 'foot';
    return (Player.active && Player.active.model) || 'hatch';
  }
  const KIND_NAME = { crysta: 'Innova Crysta', foot: 'On foot', auto: 'Auto', bike: 'Bike', hatch: 'Hatchback', suv: 'SUV', tractor: 'Tractor', lorry: 'Lorry', bus: 'Bus', bullockCart: 'Bullock cart' };

  // ================================================================ interpolation
  function sample(r, rt) {
    const b = r.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) { stats.held++; return { ...b[0], mode: 'hold' }; }
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= rt && rt <= b[i].t) {
        const a = b[i - 1], c = b[i], k = (rt - a.t) / ((c.t - a.t) || 1);
        while (b.length > 2 && b[1].t < rt - 1000) b.shift();
        stats.interp++;
        return { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, rot: a.rot + wrapA(c.rot - a.rot) * k, spd: a.spd + (c.spd - a.spd) * k, mode: 'interp' };
      }
    }
    // past the newest snapshot: extrapolate along the last velocity for at most MAX_EXTRAP ms
    const L = b[b.length - 1], P = b.length > 1 ? b[b.length - 2] : L, dtS = (L.t - P.t) / 1000 || 1;
    const ex = Math.min(MAX_EXTRAP, rt - L.t) / 1000;
    stats.extrap++;
    return { x: L.x + (L.x - P.x) / dtS * ex, z: L.z + (L.z - P.z) / dtS * ex, rot: L.rot + wrapA(L.rot - P.rot) / dtS * ex, spd: L.spd, mode: 'extrap' };
  }

  // ================================================================ per frame
  let crashCool = 0, statusT = 0, nightNow = false;
  function update(dt) {
    sendT += dt; crashCool -= dt;
    if (sendT >= RATE) {
      sendT = 0;
      const s = { x: +carPos.x.toFixed(2), z: +carPos.z.toFixed(2), rot: +carRot.toFixed(3), spd: +carSpeed.toFixed(1), mode: typeof Player !== 'undefined' ? Player.mode : 'crysta', kind: myKind() };
      // delta: skip identical states (parked), but resend once a second as a keep-alive
      const same = lastSent && s.x === lastSent.x && s.z === lastSent.z && s.rot === lastSent.rot && s.kind === lastSent.kind && s.spd === lastSent.spd;
      if (!same || ++idleSends >= 12) { send({ t: 'state', s }); lastSent = s; idleSends = 0; stats.sent = (stats.sent || 0) + 1; }
      else stats.skipped = (stats.skipped || 0) + 1;
    }
    nightNow = typeof stars !== 'undefined' && stars.material.opacity > 0.4;
    const now = performance.now(), rt = serverNow() - INTERP_DELAY;
    stats.frames++;
    let depth = 0;
    for (const [id, r] of Object.entries(remotes)) {
      const s = sample(r, rt);
      if (s) {
        const px = r.g.position.x, pz = r.g.position.z;
        r.g.position.x = s.x; r.g.position.z = s.z; r.g.rotation.y = s.rot; r.spd = s.spd; r.smode = s.mode;
        const moved = Math.hypot(s.x - px, s.z - pz) * Math.sign(s.spd || 1);
        for (const w of r.wheels) w.rotation.x += moved / 0.33;
      }
      depth += r.buf.filter(b => b.t > rt).length;
      if (r.legs) {
        r.walkT += dt * Math.min(12, Math.abs(r.spd) * 1.2);
        const sw = Math.abs(r.spd) > 0.5 ? Math.sin(r.walkT) * 0.5 : 0;
        r.legs[0].rotation.x = sw; r.legs[1].rotation.x = -sw;
      }
      if (r.night !== nightNow) {
        r.night = nightNow;
        r.head.forEach(m => m.material.color.setHex(nightNow ? 0xfff2c0 : 0x777766));
        r.tail.forEach(m => m.material.color.setHex(nightNow ? 0xff2020 : 0x661111));
      }
      // name tag fade by distance
      const dc = camera.position.distanceTo(r.g.position);
      r.tag.visible = dc < TAG_FAR;
      r.tag.material.opacity = r.mate ? Math.max(0.6, 1 - dc / TAG_FAR) : Math.max(0, Math.min(1, 1.15 - dc / TAG_FAR));
      const sc = 1 + Math.min(2, dc / 60); r.tag.scale.set(3.2 * sc, 0.8 * sc, 1);
      // bump into other players
      const dx = carPos.x - r.g.position.x, dz = carPos.z - r.g.position.z, d = Math.hypot(dx, dz);
      const rad = (r.kind === 'foot' ? 0.4 : r.kind === 'bus' || r.kind === 'lorry' ? 3.5 : 2.0) + (myKind() === 'foot' ? 0.4 : 1.6);
      if (d < rad && d > 0.01) {
        carPos.x += dx / d * (rad - d); carPos.z += dz / d * (rad - d);
        if (Math.abs(carSpeed) > 20) {
          if (typeof showComboPopup === 'function') showComboPopup('PLAYER CRASH!');
          if (crashCool <= 0) { crashCool = 3; send({ t: 'event', kind: 'crash', other: id }); }
        }
        carSpeed *= 0.5;
      }
      if (now - r.lastRecv > 5000) drop(id);
    }
    stats.bufDepth = depth;
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
    if (e.code === 'KeyQ' && !e.repeat && status === 'online') { e.stopPropagation(); openWheel(); }
    if (e.code === 'KeyZ' && !e.repeat) { e.stopPropagation(); pingAtCrosshair(); }
    if (e.code === 'Tab') { e.preventDefault(); e.stopPropagation(); if (!boardOpen) { boardOpen = true; $board.style.display = 'block'; drawBoard(); } }
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
      bufferedAhead: stats.bufDepth, sent: stats.sent || 0, skippedIdle: stats.skipped || 0 };
  }

  setStatus();
  return { get mapView() { return view; }, connect, update, drawRadar, drawBigMap, bigMap, setName, myName, latLon, gridRef, heading, netStats, placePing, sendChat, command,
    get remotes() { return remotes; }, get pings() { return pings; }, get squad() { return squad; },
    get online() { return status === 'online'; }, get players() { return Object.keys(remotes).length + 1; } };
})();
