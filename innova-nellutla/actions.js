// actions.js: on-foot character actions on top of Player.act (the pose engine in player.js).
//   E  pick up / put down a nearby crate, sack or pot · E near a shop: buy food · 0 (or the phone's Bag app): eat
//   Actions.sleep() fades to 7:00 next morning and saves (the safe-house bed has its own E; owned houses: panel "Sleep here")
// Doors: the safe-house front door and gates are E in safehouse2.js, Crysta doors 1-4. Sit X, wave 8, namaste 9: mp-social.js.
// A new shop anywhere: GameLocations.add(id, { name, x, z, kind: 'shop' }) is enough for the prompt to appear there.
// window.Actions = { items, inventory, carrying, pickUp, putDown, nearestItem, nearestShop, openShop, closeShop, buy(id), eat(id), sleep, MENU }
(function () {
  'use strict';
  const KEY = 'nellutla.actions', REACH = 1.7, SHOP_R = 4.5;
  const MENU = [
    { id: 'chai', name: 'Chai', price: 10, sec: 2, food: 1 }, { id: 'samosa', name: 'Samosa', price: 20, sec: 2.5, food: 1 },
    { id: 'water', name: 'Water bottle', price: 20, sec: 1.8, food: 1 }, { id: 'biryani', name: 'Biryani', price: 120, sec: 4, food: 1 },
  ];
  const KINDS = {
    crate: () => box(0.5, 0.36, 0.42, 0xa8763e), sack: () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), new THREE.MeshLambertMaterial({ color: 0xcdbb94 })); m.scale.set(1, 0.75, 0.8); m.position.y = 0.2; return m; },
    pot: () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshLambertMaterial({ color: 0xa8542c })); m.position.y = 0.19; return m; },
  };
  function box(w, h, d, c) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.y = h / 2; return m; }
  let G = null, hint = null, shopEl = null, fade = null, inventory = {}, carrying = null, shop = null, saved = null;
  const items = [];
  const PL = () => { try { return Player; } catch (e) { return null; } };
  const foot = () => G && G.playerMode === 'foot';
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const gy = (x, z) => { try { return groundY(x, z); } catch (e) { return 0; } };
  function persist() { try { localStorage.setItem(KEY, JSON.stringify({ inventory, items: items.map(i => ({ k: i.kind, x: +i.x.toFixed(2), z: +i.z.toFixed(2) })) })); } catch (e) {} }
  function addItem(kind, x, z) {
    const g = new THREE.Group(); g.add(KINDS[kind]()); g.position.set(x, gy(x, z), z); G.scene.add(g);
    const it = { kind, x, z, g }; items.push(it); return it;
  }
  function nearestItem() { const c = G.carPos; let best = null, bd = REACH; for (const i of items) { const d = Math.hypot(i.x - c.x, i.z - c.z); if (d < bd) { bd = d; best = i; } } return best; }
  function shops() { const a = (window.Properties ? Properties.props.filter(p => p.type === 'shop').map(p => ({ id: p.id, name: 'Shop ' + p.id, x: p.x, z: p.z })) : []); return a.concat(GameLocations.all.filter(l => l.kind === 'shop')); }
  function nearestShop() { const c = G.carPos; let best = null, bd = SHOP_R; for (const s of shops()) { const d = Math.hypot(s.x - c.x, s.z - c.z); if (d < bd) { bd = d; best = s; } } return best; }
  function pickUp(it) {
    it = it || nearestItem(); if (!it || carrying || !foot() || (PL().action && PL().action.lock)) return false;
    PL().act('pickup', { dur: 0.7, lock: true, onEnd() {
      if (!foot()) return; items.splice(items.indexOf(it), 1); carrying = it;
      PL().bodyRef.add(it.g); it.g.position.set(0, 0.88, 0.36); PL().act('carry'); persist();
    } });
    return true;
  }
  function dropAt(x, z) {
    const it = carrying; carrying = null; G.scene.add(it.g); it.x = x; it.z = z; it.g.position.set(x, gy(x, z), z); it.g.rotation.set(0, 0, 0); items.push(it); persist();
  }
  function putDown() {
    if (!carrying || !foot()) return false;
    const c = G.carPos; let rot = 0; try { rot = carRot; } catch (e) {}
    const x = c.x + Math.sin(rot) * 0.7, z = c.z + Math.cos(rot) * 0.7;
    PL().act('putdown', { dur: 0.6, lock: true, onEnd() { if (carrying) dropAt(x, z); } });
    return true;
  }
  function openShop(s) {
    shop = s || nearestShop(); if (!shop) return false;
    if (!shopEl) { shopEl = document.createElement('div'); shopEl.id = 'actShop'; shopEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(320px,90vw);z-index:60;background:#10151f;color:#f1f5f9;border-radius:14px;padding:14px;font:14px system-ui;box-shadow:0 10px 40px #0009'; document.body.appendChild(shopEl);
      shopEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.id) buy(b.dataset.id); else closeShop(); }); }
    drawShop(); return true;
  }
  function drawShop() {
    shopEl.style.display = 'block';
    shopEl.innerHTML = `<b style="font-size:16px">${shop.name}</b><div style="color:#94a3b8;margin:2px 0 10px">Cash ${fmt(Economy.cash)}</div>` +
      MENU.map((m, i) => `<button data-id="${m.id}" style="display:flex;justify-content:space-between;width:100%;min-height:44px;margin:4px 0;padding:0 12px;align-items:center;border:0;border-radius:9px;background:#1e293b;color:inherit;font:inherit;cursor:pointer"><span>${i + 1}. ${m.name}${inventory[m.id] ? ' · have ' + inventory[m.id] : ''}</span><b style="color:#fbbf24">${fmt(m.price)}</b></button>`).join('') +
      '<button style="width:100%;min-height:44px;margin-top:6px;border:0;border-radius:9px;background:#334155;color:inherit;font:inherit;cursor:pointer">Leave (Esc)</button>';
  }
  function closeShop() { if (shopEl) shopEl.style.display = 'none'; shop = null; }
  function buy(id) {
    const m = MENU.find(q => q.id === id); if (!m) return false;
    if (!Economy.spend(m.price, 'Bought ' + m.name)) { G.showPopup('NOT ENOUGH CASH'); return false; }
    inventory[id] = (inventory[id] || 0) + 1; persist(); G.showPopup(m.name.toUpperCase() + ' BOUGHT · 0 TO EAT'); if (shop) drawShop(); return true;
  }
  function eat(id) {
    id = id || Object.keys(inventory).find(k => inventory[k] > 0);
    const m = MENU.find(q => q.id === id);
    if (!m || !inventory[id]) { G.showPopup('NOTHING TO EAT · BUY FROM A SHOP'); return false; }
    if (!foot() || carrying) { G.showPopup(carrying ? 'PUT IT DOWN FIRST' : 'GET OUT TO EAT'); return false; }
    if (PL().action && PL().action.lock) return false;
    inventory[id]--; if (!inventory[id]) delete inventory[id]; persist();
    PL().act('eat', { dur: m.sec, lock: true, onEnd() { G.showPopup(m.name.toUpperCase() + ' · TASTY'); } });
    return true;
  }
  function sleep() {
    if (!foot()) return false;
    if (!fade) { fade = document.createElement('div'); fade.id = 'actFade'; fade.style.cssText = 'position:fixed;inset:0;background:#000;color:#fff;font:600 18px system-ui;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .6s;pointer-events:none;z-index:90'; document.body.appendChild(fade); }
    PL().act('sleep', { dur: 2.8, lock: true }); fade.textContent = ''; fade.style.opacity = '1';
    setTimeout(() => {
      try { timeOfDay = 7.0; } catch (e) {}
      try { window.Properties && Properties.persist(); } catch (e) {}
      fade.textContent = 'SLEPT TILL 7:00 AM · SAVED';
      setTimeout(() => { fade.style.opacity = '0'; G.showPopup('GOOD MORNING'); }, 1300);
    }, 700);
    return true;
  }
  function current() {
    if (!foot() || shop) return null;
    if (PL().action && PL().action.lock) return null;
    if (carrying) return { t: 'Put down', f: putDown };
    const it = nearestItem(); if (it) return { t: 'Pick up ' + it.kind, f: () => pickUp(it) };
    const s = nearestShop(); if (s) return { t: 'Buy at ' + s.name, f: () => openShop(s) };
    return null;
  }

  GameHooks.init.push(g => {
    G = g;
    hint = document.createElement('div'); hint.id = 'actHint'; hint.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:21;padding:7px 13px;border-radius:18px;background:rgba(10,14,22,.8);color:#fff;font:600 13px system-ui;display:none;pointer-events:none'; document.body.appendChild(hint);
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && saved.inventory) inventory = saved.inventory;
    queueMicrotask(() => {
      const offRamp = (i, n) => { const S = window.SafeHouse2; if (!S) return i; const l = S.L(i.x, i.z); if (l.a < -7.4 || l.a > -1 || l.b < -5.3 || l.b > 0) return i; const q = S.W(-12 - n * 0.8, -1); return { k: i.k, x: q.x, z: q.z }; };   // nothing lies on the car ramp
      if (saved && Array.isArray(saved.items) && saved.items.length) saved.items.map(offRamp).forEach(i => KINDS[i.k] && addItem(i.k, i.x, i.z));
      else if (window.SafeHouse2) { const c = SafeHouse2.door || SafeHouse2.center; [['crate', -2.2, -3.2], ['sack', -1.2, -3.6], ['pot', 0, -3.2]].forEach(([k, dx, dz], n) => { const i = offRamp({ k, x: c.x + dx, z: c.z + dz }, n); addItem(k, i.x, i.z); }); }
      window.Phone.addApp({ id: 'bag', name: 'Bag', icon: 'bag', open(box) {
        const keys = Object.keys(inventory);
        box.innerHTML = keys.length ? '' : '<p class="ph-note">Empty. Buy food at a shop.</p>';
        keys.forEach(k => { const m = MENU.find(q => q.id === k); if (!m) return; const b = document.createElement('button'); b.className = 'ph-item'; b.innerHTML = `<span>${m.name} × ${inventory[k]}</span><small>Eat</small>`; b.onclick = () => { if (eat(k)) Phone.close(); }; box.appendChild(b); });
      } });
    });
  });
  GameHooks.update.push(() => {
    if (carrying && !foot()) { const c = G.carPos; dropAt(c.x + 1.5, c.z); }
    const a = current(); hint.style.display = a ? 'block' : 'none'; if (a) hint.innerHTML = '<b style="color:#fbbf24">E</b> ' + a.t;
    if (shop && Math.hypot(shop.x - G.carPos.x, shop.z - G.carPos.z) > SHOP_R + 2) closeShop();
  });
  GameHooks.key.unshift(e => {
    if (!shop) return false;
    const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
    if (n !== undefined && !e.repeat) { buy(MENU[n].id); return true; }
    if (e.code === 'Escape' || (e.code === 'KeyE' && !e.repeat)) { closeShop(); return true; }
    return false;
  });
  GameHooks.key.push(e => {
    if (e.repeat) return false;
    if (e.code === 'Digit0' && foot()) { eat(); return true; }
    if (e.code === 'KeyE') { const a = current(); if (a) { a.f(); return true; } }
    return false;
  });
  window.Actions = { MENU, items, get inventory() { return inventory; }, get carrying() { return carrying; }, pickUp, putDown, nearestItem, nearestShop, openShop, closeShop, buy, eat, sleep, get shopOpen() { return !!shop; } };
})();
