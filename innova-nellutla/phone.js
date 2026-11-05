// phone.js: the in-game smartphone ("Palm"). API: window.Phone = { addApp, notify, message(from, text), open, close, toggle,
// openApp(id), isOpen, apps, messages, call(contactId), callVehicle(id), taxiTo(place) }. See economy.js for addApp / notify.
// Opens on Backspace, the phone button, or a quick tap of Up while on foot (standing) or stopped. Up is also the throttle and
// walk key, so a held Up, or a tap while moving, only drives. While open: arrows + Enter navigate, Esc / Backspace go back
// and close, Down closes from the home screen's bottom row or before anything is selected. WASD still drive and walk.
(function () {
  'use strict';
  const KEY = 'nellutla.phone', TAP_MS = 220, STILL_KMH = 3;
  const DELIVERY_FEE = 200, MECHANIC_FEE = 500;
  const stub = window.Phone || {};
  const apps = [], appById = {};
  let G = null, root = null, screen = null, banner = null, btn = null, isOpen = false, view = 'home', sel = -1, curApp = null;
  let inCall = null, messages = [], unread = 0, upTap = true, upT = 0, upOK = false;
  const delivered = {}, photos = [];
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PL = () => { try { return Player; } catch (e) { return null; } };
  const speed = () => { try { return Math.abs(carSpeed); } catch (e) { return 0; } };
  const hour = () => { try { return timeOfDay; } catch (e) { return 12; } };
  const playing = () => { try { return isPlaying; } catch (e) { return false; } };
  const clock = () => { const h = hour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
  function persist() { try { localStorage.setItem(KEY, JSON.stringify({ messages: messages.slice(0, 60), unread, upTap })); } catch (e) {} }
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { messages = s.messages || []; unread = s.unread || 0; if (s.upTap === false) upTap = false; } } catch (e) {}

  // ---- shell
  function css() {
    const s = document.createElement('style');
    s.textContent = `
#phone{position:fixed;right:252px;bottom:14px;width:262px;height:min(540px,calc(100vh - 28px));z-index:58;display:none;flex-direction:column;box-sizing:border-box;padding:9px;border-radius:30px;background:#07090d;box-shadow:0 0 0 2px #39404d,0 14px 44px #000a;font:14px/1.3 system-ui,sans-serif;color:#eef2f7;transform:translateY(16px);opacity:0;transition:transform .16s,opacity .16s}
#phone.on{transform:none;opacity:1}
#phone .ph-in{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;background:linear-gradient(165deg,#12324a,#1d1436 62%,#3a1730)}
#phone .ph-bar{display:flex;justify-content:space-between;padding:8px 15px 5px;font:600 12px system-ui}
#phone .ph-title{display:flex;align-items:center;gap:6px;padding:2px 8px 7px;font:700 16px system-ui}
#phone .ph-back{min-width:40px;min-height:36px;border:0;border-radius:9px;background:#fff2;color:inherit;font:700 15px system-ui;cursor:pointer}
#phone .ph-screen{flex:1;min-height:0;overflow-y:auto;padding:4px 9px 9px;-webkit-overflow-scrolling:touch}
#phone .ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:6px}
#phone .ph-app{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:68px;border:0;border-radius:15px;background:#fff1;color:inherit;font:11px system-ui;cursor:pointer}
#phone .ph-app i{font:normal 25px system-ui}
#phone .ph-app em{position:absolute;right:7px;top:5px;min-width:15px;border-radius:8px;background:#ef4444;font:700 10px/15px system-ui}
#phone .ph-item{display:flex;width:100%;box-sizing:border-box;justify-content:space-between;align-items:center;gap:8px;min-height:46px;margin:0 0 6px;padding:6px 10px;border:0;border-radius:11px;background:#fff1;color:inherit;font:14px system-ui;text-align:left;cursor:pointer}
#phone .ph-item small{color:#b6c2d2;flex:none;max-width:48%;text-align:right}
#phone .sel{outline:2px solid #fbbf24;outline-offset:-2px;background:#fff3}
#phone .ph-note{color:#b6c2d2;font-size:13px;margin:6px 2px 10px}
#phone .ph-big{font:700 26px system-ui;margin:4px 2px 10px;color:#fbbf24}
#phone .ph-line{padding:9px 11px;border-radius:11px;background:#fff1;margin-bottom:8px}
#phone .ph-row{display:flex;justify-content:space-between;gap:8px;padding:6px 2px;border-bottom:1px solid #fff1;font-size:12px}
#phone .plus{color:#4ade80}#phone .minus{color:#f87171}
#phone img{width:100%;border-radius:10px;display:block;margin-bottom:7px}
#phoneBtn{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));margin-left:150px;width:44px;height:44px;z-index:30;display:none;border:0;border-radius:13px;background:rgba(10,14,22,.72);color:#fff;font:21px system-ui;cursor:pointer}
#phoneBtn em{position:absolute;right:-3px;top:-3px;min-width:16px;border-radius:8px;background:#ef4444;font:700 10px/16px system-ui;font-style:normal}
body.playing #phoneBtn{display:block}
#phoneBanner{position:fixed;left:50%;top:60px;transform:translateX(-50%);max-width:min(340px,86vw);z-index:59;padding:9px 14px;border-radius:13px;background:rgba(10,14,22,.9);color:#fff;font:600 13px system-ui;display:none;pointer-events:none}
@media (max-width:760px),(max-height:520px){#phone{left:50%;right:auto;margin-left:-125px;width:250px;bottom:6px;height:calc(100vh - 12px)}#phoneBtn{left:auto;margin:0;right:calc(8px + env(safe-area-inset-right,0px));top:calc(58px + env(safe-area-inset-top,0px))}}`;
    document.head.appendChild(s);
  }
  function build() {
    css();
    root = document.createElement('div'); root.id = 'phone';
    root.innerHTML = '<div class="ph-in"><div class="ph-bar"><span id="phClock"></span><span id="phCash"></span></div><div id="phHead"></div><div class="ph-screen" id="phScreen"></div></div>';
    document.body.appendChild(root); screen = root.querySelector('#phScreen');
    banner = document.createElement('div'); banner.id = 'phoneBanner'; document.body.appendChild(banner);
    btn = document.createElement('button'); btn.id = 'phoneBtn'; btn.setAttribute('aria-label', 'Phone'); btn.innerHTML = UI.icon('phone'); document.body.appendChild(btn);
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); btn.blur(); });
    root.addEventListener('pointerdown', e => e.stopPropagation());
    Economy.onChange(status);
  }
  function badge() { const old = btn.querySelector('em'); if (old) old.remove(); if (unread) { const e = document.createElement('em'); e.textContent = unread; btn.appendChild(e); } }
  function status() { if (!root) return; root.querySelector('#phClock').textContent = clock(); root.querySelector('#phCash').textContent = fmt(Economy.cash); }
  function items() { return [...screen.querySelectorAll(view === 'home' ? '.ph-app' : '.ph-item')].concat(view === 'home' ? [] : [...root.querySelectorAll('.ph-back')]); }
  function mark() { const L = items(); root.querySelectorAll('.sel').forEach(e => e.classList.remove('sel')); if (L[sel]) { L[sel].classList.add('sel'); L[sel].scrollIntoView({ block: 'nearest' }); } }
  function head(title) {
    const h = root.querySelector('#phHead');
    if (!title) { h.innerHTML = ''; return; }
    h.innerHTML = `<div class="ph-title"><button class="ph-back" aria-label="Back">‹</button><span>${esc(title)}</span></div>`;
    h.firstChild.firstChild.onclick = back;
  }
  function home() {
    if (inCall) endCall(); view = 'home'; curApp = null; sel = -1; head(null);
    screen.innerHTML = '<div class="ph-grid"></div>'; const g = screen.firstChild;
    apps.forEach(a => {
      const b = document.createElement('button'); b.className = 'ph-app'; b.dataset.id = a.id;
      b.innerHTML = `<i>${UI.icon(a.icon)}</i><span>${esc(a.name)}</span>` + (a.id === 'messages' && unread ? `<em>${unread}</em>` : '');
      b.onclick = () => openApp(a.id); g.appendChild(b);
    });
    status();
  }
  function openApp(id) {
    const a = appById[id]; if (!a) return false;
    if (!isOpen) show();
    view = 'app'; curApp = a; sel = 0; head(a.name); screen.innerHTML = ''; screen.scrollTop = 0;
    const box = document.createElement('div'); screen.appendChild(box);
    try { a.open(box); } catch (e) { console.error('phone app failed', id, e); box.innerHTML = '<p class="ph-note">This app stopped.</p>'; }
    mark(); return true;
  }
  const refresh = () => { if (isOpen && curApp) { const s = sel; openApp(curApp.id); sel = s; mark(); } };
  function back() { if (view === 'home') close(); else if (curApp && curApp._back) { const f = curApp._back; curApp._back = null; f(); } else home(); }
  function show() {
    if (isOpen || !playing()) return false;
    isOpen = true; root.style.display = 'flex'; requestAnimationFrame(() => root.classList.add('on'));
    if (view === 'home') home(); status();
    const P = PL(); if (P && P.mode === 'foot' && !P.action && !(window.Actions && Actions.carrying)) P.act('text');
    return true;
  }
  function close() {
    if (!isOpen) return; if (inCall) endCall();
    isOpen = false; root.classList.remove('on'); root.style.display = 'none'; view = 'home'; curApp = null; sel = -1;
    const P = PL(); if (P && P.action && (P.action.kind === 'text' || P.action.kind === 'phone')) P.act(null);
  }
  function toggle() { if (isOpen) close(); else show(); }
  function move(dx, dy) {
    const L = items(); if (!L.length) { if (view === 'home' && dy > 0) close(); return; }
    if (view === 'home') {
      if (sel < 0) { if (dy > 0) return close(); sel = 0; return mark(); }
      const n = sel + dx + dy * 3;
      if (dy > 0 && n >= L.length) return Math.ceil((sel + 1) / 3) >= Math.ceil(L.length / 3) ? close() : (sel = L.length - 1, mark());
      if (n >= 0 && n < L.length) sel = n;
    } else sel = (sel + (dx + dy) + L.length) % L.length;
    mark();
  }
  // capture: runs before the game's handler, so only the keys the phone actually uses are taken away from it
  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    const c = e.code, stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (isOpen) {
      const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[c];
      if (m) { stop(); move(m[0], m[1]); return; }
      if (c === 'Enter' || c === 'NumpadEnter') { stop(); if (!e.repeat) { const L = items(); if (L[sel]) L[sel].click(); } return; }
      if (c === 'Escape' || c === 'Backspace') { stop(); if (!e.repeat) back(); return; }
      return;
    }
    if (c === 'Backspace' && !e.repeat && playing() && !blocked()) { stop(); show(); return; }
    if (c === 'ArrowUp' && !e.repeat) { upT = performance.now(); upOK = upTap && stillNow(); }
  }
  function onKeyUp(e) {
    if (e.code !== 'ArrowUp' || !upOK) return; upOK = false;
    if (!isOpen && performance.now() - upT < TAP_MS && playing() && !blocked()) show();
  }
  function blocked() { // another panel owns the keyboard
    if (document.body.classList.contains('map-open')) return true;
    const p = document.getElementById('propPanel'); return !!(p && p.style.display === 'block') || !!(window.Actions && Actions.shopOpen);
  }
  function stillNow() {
    const P = PL(); if (!P) return false;
    if (P.mode === 'foot') return Math.abs(P.ped.speed || 0) < 0.5;
    return speed() < STILL_KMH;
  }

  // ---- list helpers
  function row(box, label, sub, fn) { const b = document.createElement('button'); b.className = 'ph-item'; b.innerHTML = `<span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}`; b.onclick = fn; box.appendChild(b); return b; }
  function note(box, t) { const p = document.createElement('p'); p.className = 'ph-note'; p.textContent = t; box.appendChild(p); return p; }
  function sub(box, fn) { curApp._back = () => { openApp(curApp.id); }; box.innerHTML = ''; fn(box); sel = 0; mark(); }
  function dist(x, z) { const c = G.carPos, d = Math.hypot(x - c.x, z - c.z); return d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'; }

  // ---- messages and notifications
  function message(from, text) { messages.unshift({ from, text: String(text), t: Date.now() }); messages.length = Math.min(messages.length, 60); if (!(isOpen && curApp && curApp.id === 'messages')) unread++; persist(); if (btn) badge(); }
  let bannerT = 0;
  function notify(text) {
    message('SparkV', text);
    banner.textContent = text; banner.style.display = 'block'; clearTimeout(bannerT); bannerT = setTimeout(() => { banner.style.display = 'none'; }, 3500);
    if (isOpen && curApp && curApp.id === 'messages') refresh();
  }

  // ---- calling
  const CONTACTS = [
    { id: 'ammamma', name: 'Ammamma', sub: 'Grandma', spk: 'ammamma', pick: () => hour() >= 21 || hour() < 5 ? 'gm_night' : hour() < 11 ? 'gm_tiffin' : ['gm_hello', 'gm_eat', 'gm_tea'][Math.random() * 3 | 0],
      opts: () => [] },
    { id: 'friends', name: 'Friends', sub: 'Come over', spk: 'friend1', pick: () => 'fr_hello', opts: () => [
      ['Come to me', () => { Visitors.setFriends(false); Visitors.setFriends(true); say('friend1', 'fr_go'); endSoon('They are on the way.'); }],
      ['Go home now', () => { Visitors.setFriends(false); say('friend1', 'fr_later'); endSoon('They are heading home.'); }]] },
    { id: 'mechanic', name: 'Mechanic', sub: fmt(MECHANIC_FEE) + ' visit', spk: 'villager_m', pick: () => 'ph_mech', opts: () => [
      ['Fix my vehicle · ' + fmt(MECHANIC_FEE), mechanic]] },
    { id: 'taxi', name: 'Taxi', sub: 'Fare by distance', spk: 'villager_m', pick: () => 'ph_taxi', opts: () => places().slice(0, 12).map(p => [p.name + ' · ' + fmt(fare(p)), () => taxiTo(p)]) },
    { id: 'delivery', name: 'Vehicle delivery', sub: fmt(DELIVERY_FEE), spk: 'villager_m', pick: () => 'ph_deliver', opts: () => Economy.vehicles.map(v => [v.name, () => { callVehicle(v.id); endSoon('Delivery booked.'); }]) },
  ];
  function say(spk, id, cb) {
    const v = window.Voice, me = inCall; if (!v) { if (cb) cb(); return; }
    v.say(spk, id, { prio: true, onStart(line) { if (inCall === me && inCall) inCall.line.textContent = (line && line.tr) || ''; }, onEnd() { if (cb) cb(); } });
  }
  function ring() { try { if (typeof audioCtx === 'undefined' || !audioCtx) return; const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime; o.frequency.value = 440; g.gain.value = 0.04; o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.5); } catch (e) {} }
  function call(id) {
    const c = CONTACTS.find(q => q.id === id); if (!c) return false;
    show(); if (!curApp || curApp.id !== 'contacts') openApp('contacts');
    if (inCall) endCall();
    const box = screen.firstChild; box.innerHTML = '';
    curApp._back = () => { endCall(); openApp('contacts'); };
    const P = PL(); if (P && P.mode === 'foot' && !(window.Actions && Actions.carrying)) P.act('phone');
    note(box, 'Calling…'); const big = document.createElement('div'); big.className = 'ph-big'; big.textContent = c.name; box.appendChild(big);
    const line = document.createElement('div'); line.className = 'ph-line'; line.textContent = '…'; box.appendChild(line);
    const opts = document.createElement('div'); box.appendChild(opts);
    inCall = { c, line, state: 'ringing', timer: setTimeout(() => {
      if (!inCall) return; inCall.state = 'talking'; box.firstChild.textContent = 'On call'; opts.innerHTML = '';
      say(c.spk, c.pick());
      c.opts().forEach(([label, fn]) => row(opts, label, '', fn));
      row(opts, 'Hang up', '', () => { endCall(); openApp('contacts'); }); sel = 0; mark();
    }, 900) };
    ring(); row(opts, 'Hang up', '', () => { endCall(); openApp('contacts'); }); sel = 0; mark();
    return true;
  }
  function endCall() {
    if (!inCall) return; clearTimeout(inCall.timer); inCall = null; try { Voice.stop(); } catch (e) {}
    const P = PL(); if (P && P.action && P.action.kind === 'phone') P.act(isOpen ? 'text' : null);
  }
  function endSoon(msg) { if (inCall) inCall.line.textContent = msg; if (inCall) { const c = inCall; setTimeout(() => { if (inCall === c) { endCall(); if (curApp && curApp.id === 'contacts') openApp('contacts'); } }, 1600); } }

  function mechanic() {
    const P = PL(), mode = P.mode;
    if (mode === 'foot') { const near = P._pick && P._pick(); if (!near || !near.v) return endSoon('No vehicle next to you.'); }
    if (!Economy.spend(MECHANIC_FEE, 'Mechanic')) return endSoon('Not enough cash.');
    endSoon('On the way, 6 seconds.');
    setTimeout(() => {
      const M = P.mode, near = M === 'foot' ? (P._pick() || {}).v : null, tgt = M === 'crysta' ? { g: playerCarGroup } : M === 'vehicle' ? P.active : near;
      if (!tgt || !tgt.g) { Economy.earn(MECHANIC_FEE, 'Mechanic refund'); return notify('Mechanic could not find the vehicle. Refunded.'); }
      if (M !== 'crysta') tgt.g.rotation.z = 0;
      try { window.Mud && Mud.setDirt(tgt.g, 0); } catch (e) {}
      notify('Mechanic: serviced, cleaned and set upright.');
    }, 6000);
  }
  function places() {
    const L = GameLocations.all.slice(); const home = GameLocations.get('home');
    return L.sort((a, b) => (b === home) - (a === home) || a.name.localeCompare(b.name));
  }
  const fare = p => Math.max(60, Math.round(Math.hypot(p.x - G.carPos.x, p.z - G.carPos.z) / 1000 * 18 / 10) * 10);
  function taxiTo(p) {
    const P = PL();
    if (P.mode !== 'foot') { endSoon('Get out of the vehicle first.'); return false; }
    if (G.cash < fare(p)) { endSoon('Not enough cash.'); return false; }
    if (!window.Jobs || !Jobs.callTaxi(p, fare(p))) { endSoon('No taxi free.'); return false; }
    endSoon('Taxi coming.');                               // jobs.js: a real car drives over on the roads; you pay on arrival
    return true;
  }

  // ---- vehicles
  // a free patch of ground close to (x, z): not in a building or river, away from other vehicles
  function spot(x, z, need, minR) {
    const P = PL(), others = (P.parkedList || []).concat(G.traffic || []); need = need || 3.5;
    for (const r of [1.5, 5, 7, 10, 14, 19]) if (r >= (minR || 0)) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, q = { x: x + Math.sin(a) * r, z: z + Math.cos(a) * r };
      const t = { x: q.x, y: 0, z: q.z }; if (G.world.collide(t, 1.6).hit) continue;
      if (G.world.surfaceAt(q.x, q.z) === 'river') continue;
      if (others.some(v => v.g && Math.hypot(v.g.position.x - q.x, v.g.position.z - q.z) < need)) continue;
      return q;
    }
    return null;
  }
  function placeVehicle(entry) {
    const P = PL(), c = G.carPos, s = spot(c.x, c.z, 4.5, 5);
    if (!s) return notify('No clear space for the delivery here.');
    const rot = Math.atan2(c.x - s.x, c.z - s.z);
    if (entry.id === 'crysta') {
      if (P.mode === 'crysta') return notify('You are already in the Crysta.');
      playerCarGroup.position.set(s.x, playerCarGroup.position.y, s.z); playerCarGroup.rotation.y = rot; try { crystaState.rot = rot; } catch (e) {}
      if (!P.parkedList.some(v => v.crysta)) P.addParked({ g: playerCarGroup, len: 4.7, hw: 0.95, crysta: true });
    } else {
      const old = delivered[entry.id];
      if (old) { if (P.active === old) return notify('You are already in it.'); const i = P.parkedList.indexOf(old); if (i >= 0) P.parkedList.splice(i, 1); const j = G.traffic.indexOf(old); if (j >= 0) G.traffic.splice(j, 1); G.scene.remove(old.g); }
      const make = window.TrafficModels ? TrafficModels[entry.model] : (typeof TrafficModels !== 'undefined' ? TrafficModels[entry.model] : null);
      if (!make) return notify('No delivery truck for a ' + entry.name + '.');
      const v = make(); { const dead = []; v.g.traverse(o => { if (o.userData && o.userData.human) dead.push(o); }); dead.forEach(o => o.parent && o.parent.remove(o)); }
      const col = entry.color != null ? entry.color : entry.colour;
      if (col != null) { const m = new THREE.MeshPhongMaterial({ color: col, specular: 0x8a8a8a, shininess: 85 }); v.g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) o.material = m; }); }
      v.g.position.set(s.x, 0, s.z); v.g.rotation.y = rot; G.scene.add(v.g);
      const o = { ...v, model: entry.model, r: null, len: 100, s: 0, dir: 1, speed: 0, cur: 0, len2: v.len / 2, wheelR: 0.4, ownedId: entry.id };
      P.addParked(o); delivered[entry.id] = o;
    }
    notify(entry.name + ' delivered next to you.');
  }
  function callVehicle(id) {
    const e = Economy.vehicles.find(v => v.id === id); if (!e) return false;
    const P = PL();
    if ((id === 'crysta' && P.mode === 'crysta') || (delivered[id] && P.active === delivered[id])) { notify('You are already in it.'); return false; }
    if (!Economy.spend(DELIVERY_FEE, 'Delivery of ' + e.name)) { notify('Not enough cash for delivery.'); return false; }
    notify(e.name + ' on the way, 5 seconds.');
    setTimeout(() => placeVehicle(e), Phone._deliverMs);
    return true;
  }

  // ---- built-in apps
  function selfie() {
    try {
      G.renderer.render(G.scene, G.camera);
      const cv = G.renderer.domElement, s = document.createElement('canvas'); s.width = 280; s.height = Math.round(280 * cv.height / cv.width);
      s.getContext('2d').drawImage(cv, 0, 0, s.width, s.height);
      photos.unshift(s.toDataURL('image/jpeg', 0.75)); photos.length = Math.min(photos.length, 8); return true;
    } catch (e) { return false; }
  }
  function installApps() {
    add({ id: 'contacts', name: 'Contacts', icon: 'call', open(b) { CONTACTS.forEach(c => row(b, c.name, c.sub, () => call(c.id))); } });
    add({ id: 'messages', name: 'Messages', icon: 'chat', open(b) {
      unread = 0; persist(); badge();
      if (!messages.length) note(b, 'No messages.');
      messages.forEach(m => { const d = document.createElement('div'); d.className = 'ph-line ph-item'; d.style.display = 'block'; d.innerHTML = `<b>${esc(m.from)}</b><br>${esc(m.text)}`; b.appendChild(d); });
    } });
    add({ id: 'properties', name: 'Properties', icon: 'home', open(b) {
      const P = window.Properties; if (!P) return note(b, 'Unavailable.');
      const c = G.carPos, all = P.props.slice().sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z));
      note(b, `Income ${fmt(P.dailyIncome())} / day`);
      all.filter(p => P.isOwned(p.id)).forEach(p => row(b, '★ ' + p.id, 'Owned · ' + dist(p.x, p.z), () => detail(b, p)));
      all.filter(p => !P.isOwned(p.id)).slice(0, 25).forEach(p => row(b, P.typeName(p.type), fmt(p.price) + ' · ' + dist(p.x, p.z), () => detail(b, p)));
    } });
    function detail(b, p) {
      const P = window.Properties;
      sub(b, b => {
        const big = document.createElement('div'); big.className = 'ph-big'; big.textContent = fmt(p.price); b.appendChild(big);
        note(b, `${P.typeName(p.type)} · ${p.id} · ${p.area} m² · ${dist(p.x, p.z)}${p.income ? ' · ' + fmt(p.income) + '/day' : ''}`);
        if (P.isOwned(p.id)) note(b, 'You own this.');
        else row(b, Economy.canAfford(p.price) ? 'Buy now' : 'Not enough cash', '', () => { if (!Economy.canAfford(p.price)) return; P.buy(p.id); P.closePanel(); notify('Bought ' + p.id); openApp('properties'); });
        row(b, 'Set waypoint', '', () => P.setWaypoint(p.x, p.z, p.id));
      });
    }
    add({ id: 'bank', name: 'Bank', icon: 'bank', open(b) {
      const big = document.createElement('div'); big.className = 'ph-big'; big.textContent = fmt(Economy.cash); b.appendChild(big);
      const L = Economy.log; if (!L.length) note(b, 'No transactions yet.');
      L.slice(0, 40).forEach(e => { const d = document.createElement('div'); d.className = 'ph-row'; d.innerHTML = `<span>${esc(e.reason)}</span><b class="${e.amount > 0 ? 'plus' : 'minus'}">${e.amount > 0 ? '+' : '−'}${fmt(Math.abs(e.amount))}</b>`; b.appendChild(d); });
    } });
    add({ id: 'gps', name: 'Map', icon: 'compass', open(b) {
      const st = Nav.state;
      if (st.dest) { note(b, st.dest.name + (st.r ? ': ' + Nav.fmtD(st.remain || st.r.len) + ', ' + Nav.fmtT(st.secs || st.r.secs) : '')); row(b, 'Stop route', '', () => { Nav.stop(); refresh(); }); }
      const L = Nav.places().filter(l => l.cat !== 'property').sort((p, q) => Nav.cats[p.cat].rank - Nav.cats[q.cat].rank || p.name.localeCompare(q.name));
      let cat = ''; L.forEach(l => { if (l.cat !== cat) { cat = l.cat; note(b, Nav.cats[cat].name); } row(b, l.name, dist(l.x, l.z), () => { Nav.setDest(l.x, l.z, l.name); refresh(); }); });
    } });
    add({ id: 'vehicles', name: 'Vehicles', icon: 'car', open(b) { Economy.vehicles.forEach(v => row(b, v.name, 'Call · ' + fmt(DELIVERY_FEE), () => { callVehicle(v.id); })); } });
    add({ id: 'camera', name: 'Camera', icon: 'camera', open(b) {
      row(b, 'Take photo', '', () => { selfie(); refresh(); });
      photos.forEach(u => { const i = new Image(); i.src = u; i.alt = 'Photo'; b.appendChild(i); });
      if (!photos.length) note(b, 'Photos last until you reload.');
    } });
    add({ id: 'settings', name: 'Settings', icon: 'gear', open(b) {
      row(b, 'Up tap opens phone', upTap ? 'On' : 'Off', () => { upTap = !upTap; persist(); refresh(); });
      if (window.Voice) row(b, 'Voices', Voice.muted ? 'Off' : 'On', () => { Voice.setMuted(!Voice.muted); refresh(); });
      row(b, 'Clear messages', '', () => { messages = []; unread = 0; persist(); badge(); refresh(); });
    } });
  }
  function add(a) { if (!a || !a.id) return; if (appById[a.id]) apps.splice(apps.indexOf(appById[a.id]), 1, a); else apps.push(a); appById[a.id] = a; if (isOpen && view === 'home') home(); }

  const Phone = window.Phone = { contacts: CONTACTS, addApp: add, notify: t => { if (banner) notify(t); else (stub._notes || (stub._notes = [])).push(t); }, message, open: show, close, toggle, openApp, call, callVehicle, taxiTo, get isOpen() { return isOpen; }, get inCall() { return inCall; }, get view() { return view; }, get apps() { return apps; }, get messages() { return messages; }, get unread() { return unread; }, _deliverMs: 5000 };

  GameHooks.init.push(g => {
    G = g; build();
    Object.assign(Voice.LINES, {
      ph_mech: { id: 'ph_mech', te: 'చెప్పండి సార్, బండికి ఏమైంది?', tr: 'Cheppandi saar, bandiki emaindi?' },
      ph_taxi: { id: 'ph_taxi', te: 'టాక్సీ సార్, ఎక్కడికి వెళ్ళాలి?', tr: 'Taxi saar, ekkadiki vellali?' },
      ph_deliver: { id: 'ph_deliver', te: 'ఏ బండి తేవాలి సార్?', tr: 'Ae bandi tevali saar?' },
    });
    installApps(); badge();
    (stub._apps || []).forEach(add);
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKeyUp, true);
    queueMicrotask(() => {
      const c = window.SafeHouse2 && SafeHouse2.door; if (c) GameLocations.add('home', { name: 'Home', x: c.x, z: c.z, kind: 'home' });
      (G.world.landmarks || []).slice(0, 30).forEach((l, i) => { const x = l.x, z = l.z; if (typeof x === 'number' && typeof z === 'number' && l.name) GameLocations.add('lm' + i, { name: l.name, x, z, kind: 'landmark' }); });
      (stub._notes || []).forEach(notify); stub._notes = [];
    });
    let t = 0; GameHooks.update.push(dt => { if ((t += dt) > 1 && isOpen) { t = 0; status(); } });
  });
})();
