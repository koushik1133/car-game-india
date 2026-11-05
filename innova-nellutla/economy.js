// economy.js: shared money, owned vehicles, map locations, plus a Phone stub. Loads right after GameHooks is defined,
// before every feature module, so anything may use these at script load time or in a GameHooks.init hook.
//
// window.Economy
//   .cash                      current money (read-only here; it IS GAME.cash, so old code writing G.cash still works)
//   .canAfford(amount)         -> bool. same rule as properties.js: finite number and cash >= amount
//   .earn(amount, reason)      adds money, logs it. returns the new cash. non-positive / NaN is ignored
//   .spend(amount, reason)     -> true if paid, false (nothing changes, no popup) if unaffordable or invalid
//   .log                       newest first: [{ t: Date.now(), amount: +/-n, reason, cash }] (keeps 200). copy, read only
//                              direct G.cash changes (missions, fares) are picked up within a frame as reason 'Other'
//   .vehicles                  owned vehicles: [{ id, name, model, ... }]. copy, read only. the Crysta is always first
//   .addVehicle({ id?, name, model, colour?, ...anything JSON-safe }) -> the stored entry. same id replaces. model is
//                              a TrafficModels kind (hatch, suv, bike, auto, tractor, lorry, bus...), used by "call to you"
//   .removeVehicle(id)         -> bool (the Crysta can't be removed)
//   .hasVehicle(id)            -> bool
//   .onChange(fn)              -> unsubscribe. fn({ cash, delta, reason, vehicles }); delta is 0 for vehicle changes
// All of it persists in localStorage 'nellutla.economy' (properties.js still keeps its own copy of cash in its save).
//
// window.GameLocations         places for the phone Map / GPS
//   .add(id, { name, x, z, kind })   same id replaces. kind is free text ('showroom', 'farm', 'job', 'town'...)
//   .remove(id), .get(id), .all (array of { id, name, x, z, kind })
//
// window.Phone                 (the real one comes from phone.js; this stub queues until then, so call order is free)
//   .addApp({ id, name, icon, open(container) })   icon is a short text/emoji. open gets an empty div to fill; a child
//                              with class "ph-item" becomes selectable by arrows + Enter (Enter clicks it); same id replaces
//   .notify(text)              banner on the phone / HUD and added to Messages
(function () {
  'use strict';
  const KEY = 'nellutla.economy', MAX_LOG = 200;
  const CRYSTA = { id: 'crysta', name: 'Innova Crysta', model: 'crysta', builtin: true };
  const valid = n => typeof n === 'number' && isFinite(n);
  let log = [], vehicles = [Object.assign({}, CRYSTA)], shadow = null, last = null, restored = false, dirty = false;
  const subs = [];

  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      if (valid(s.cash)) shadow = s.cash;
      if (Array.isArray(s.log)) log = s.log.slice(0, MAX_LOG);
      if (Array.isArray(s.vehicles)) vehicles = [Object.assign({}, CRYSTA)].concat(s.vehicles.filter(v => v && v.id && v.id !== 'crysta'));
    }
  } catch (e) {}

  const G = () => window.GAME || null;
  function cashNow() { const g = G(); if (g) { const c = g.cash; return valid(c) ? c : 0; } return valid(shadow) ? shadow : 0; }
  function setCash(v) { v = Math.round(v); if (G() && restored) G().cash = v; else shadow = v; }
  function persist() {
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, cash: restored || !G() ? cashNow() : shadow, log, vehicles: vehicles.filter(v => !v.builtin) })); } catch (e) {}
  }
  function emit(delta, reason) {
    const ev = { cash: cashNow(), delta, reason, vehicles: Economy.vehicles };
    subs.slice().forEach(f => { try { f(ev); } catch (e) { console.error('Economy.onChange listener failed', e); } });
  }
  function record(amount, reason) {
    log.unshift({ t: Date.now(), amount, reason: String(reason || 'Other'), cash: cashNow() });
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    last = cashNow(); persist(); emit(amount, reason);
  }

  const Economy = window.Economy = {
    get cash() { return cashNow(); },
    canAfford: n => valid(n) && cashNow() >= n,
    earn(n, reason) { if (!valid(n) || n <= 0) return cashNow(); n = Math.round(n); setCash(cashNow() + n); record(n, reason); return cashNow(); },
    spend(n, reason) {
      if (!valid(n) || n < 0 || cashNow() < n) return false;
      n = Math.round(n); setCash(cashNow() - n); if (n) record(-n, reason); return true;
    },
    get log() { return log.map(e => Object.assign({}, e)); },
    get vehicles() { return vehicles.map(v => Object.assign({}, v)); },
    addVehicle(v) {
      if (!v) return null;
      const e = Object.assign({}, v); e.id = String(e.id || (e.model || 'car') + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36));
      if (e.id === 'crysta') return vehicles[0];
      const i = vehicles.findIndex(o => o.id === e.id); if (i >= 0) vehicles[i] = e; else vehicles.push(e);
      persist(); emit(0, 'vehicle added'); return Object.assign({}, e);
    },
    removeVehicle(id) {
      const i = vehicles.findIndex(o => o.id === id); if (i < 0 || vehicles[i].builtin) return false;
      vehicles.splice(i, 1); persist(); emit(0, 'vehicle removed'); return true;
    },
    hasVehicle: id => vehicles.some(o => o.id === id),
    onChange(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
  };

  // locations
  const locs = {};
  window.GameLocations = {
    add(id, o) { if (!id || !o || !valid(o.x) || !valid(o.z)) return null; return locs[id] = { id, name: o.name || id, x: o.x, z: o.z, kind: o.kind || 'place' }; },
    remove(id) { const had = !!locs[id]; delete locs[id]; return had; },
    get: id => locs[id] || null,
    get all() { return Object.values(locs); },
  };

  // phone stub: phone.js takes these queues over
  if (!window.Phone) window.Phone = { _apps: [], _notes: [], addApp(a) { this._apps.push(a); }, notify(t) { this._notes.push(t); } };

  // saved cash wins over the (up to 5 s older) copy properties.js restores, so run after every init hook
  GameHooks.init.push(() => queueMicrotask(() => {
    if (valid(shadow)) G().cash = shadow;
    restored = true; shadow = null; last = cashNow();
  }));
  // anything that wrote G.cash directly (missions, fares, older modules) still lands in the bank log
  GameHooks.update.push(() => {
    if (!restored) return;
    const c = cashNow();
    if (last === null) last = c;
    if (c !== last) { const d = c - last; record(d, d > 0 ? 'Other income' : 'Other payment'); }
  });
})();
