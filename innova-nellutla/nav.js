// nav.js: the road graph (village + Jangaon), routing, turn-by-turn guidance, the dark vector map used by the full map, the minimap and SparkPlay.
// API: Nav.setDest(x, z, name), Nav.stop(), Nav.route(ax, az, bx, bz), Nav.places(), Nav.base(ctx, cx, cz, s, W, H, rot), Nav.state.
(function () {
  'use strict';
  const COL = { bg: '#0a1d22', water: '#17536e', rail: '#5a7a80', dirt: '#2f4a50', lane: '#44626a', cc: '#68858b', tar: '#9db3b5', highway: '#f6b21b', link: '#44626a', route: '#37d7ff' };
  const KMH = { highway: 70, tar: 45, cc: 28, lane: 18, dirt: 14, link: 10 }, ORDER = ['dirt', 'lane', 'link', 'cc', 'tar', 'highway'];
  const PX = { dirt: 1, lane: 1.1, link: 1, cc: 1.5, tar: 2, highway: 3.2 };
  const STREET = { canal_road: 'Canal Road', east_main: 'East Main Road', east_mid: 'East Middle Road', east_north: 'East North Road', east_south: 'East South Road', east_diag: 'East Diagonal Road', layout_1: 'Layout Road 1', layout_2: 'Layout Road 2' };
  const TYPE = { highway: 'NH-365B', tar: 'town road', cc: 'village road', lane: 'lane', dirt: 'field track', link: 'link road' };
  let G = null, net = null;
  const fmtD = m => m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
  const fmtT = s => s < 90 ? '1 min' : s < 3600 ? Math.round(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + Math.round(s % 3600 / 60) + ' min';

  // ---- graph
  const X = [], Z = [], adj = [], ids = new Map(), HC = 40, vHash = new Map(), segHash = new Map();
  let polys = [], ready = false, readyWait = [];
  const hk = (x, z, c) => Math.floor(x / c) + ',' + Math.floor(z / c);
  function vert(x, z) {
    const k = Math.round(x / 2.5) + ',' + Math.round(z / 2.5); let i = ids.get(k);
    if (i === undefined) { i = X.length; ids.set(k, i); X.push(x); Z.push(z); adj.push([]); const h = hk(x, z, HC); (vHash.get(h) || vHash.set(h, []).get(h)).push(i); }
    return i;
  }
  function link(a, b, t, name, id) {
    if (a === b || adj[a].some(e => e.to === b)) return; const len = Math.hypot(X[a] - X[b], Z[a] - Z[b]), cost = len / (KMH[t] / 3.6);
    adj[a].push({ to: b, len, cost, t, name, id }); adj[b].push({ to: a, len, cost, t, name, id });
    const n = Math.max(1, Math.ceil(len / 30));
    for (let i = 0; i <= n; i++) { const h = hk(X[a] + (X[b] - X[a]) * i / n, Z[a] + (Z[b] - Z[a]) * i / n, HC), L = segHash.get(h) || segHash.set(h, []).get(h); if (!L.some(s => s.a === a && s.b === b)) L.push({ a, b, id }); }
  }
  function unlink(a, b) { adj[a] = adj[a].filter(e => e.to !== b); adj[b] = adj[b].filter(e => e.to !== a); }
  function addPoly(p, t, name, id) { let prev = -1; for (const q of p) { const v = vert(q[0], q[1]); if (prev >= 0) link(prev, v, t, name, id); prev = v; } }
  function stitch(R) {   // dead ends that stop on a road without sharing a vertex become junctions
    const n = X.length;
    for (let v = 0; v < n; v++) {
      if (adj[v].length !== 1) continue; const own = adj[v][0].id, h = [Math.floor(X[v] / HC), Math.floor(Z[v] / HC)]; let best = null;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of segHash.get((h[0] + i) + ',' + (h[1] + j)) || []) {
        if (s.id === own || !adj[s.a].some(e => e.to === s.b)) continue;
        const ax = X[s.a], az = Z[s.a], dx = X[s.b] - ax, dz = Z[s.b] - az, L = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((X[v] - ax) * dx + (Z[v] - az) * dz) / L)), px = ax + dx * k, pz = az + dz * k, d = Math.hypot(X[v] - px, Z[v] - pz);
        if (d < R && (!best || d < best.d)) best = { d, s, px, pz };
      }
      if (!best) continue; const { s } = best, e = adj[s.a].find(q => q.to === s.b); let m = vert(best.px, best.pz);
      if (m !== s.a && m !== s.b) { unlink(s.a, s.b); link(s.a, m, e.t, e.name, e.id); link(m, s.b, e.t, e.name, e.id); }
      link(v, m, 'link', e.name, own);
    }
  }
  function components() { const c = new Int32Array(X.length).fill(-1), size = []; for (let i = 0; i < X.length; i++) { if (c[i] >= 0) continue; const id = size.length; let n = 0; const st = [i]; c[i] = id; while (st.length) { const v = st.pop(); n++; for (const e of adj[v]) if (c[e.to] < 0) { c[e.to] = id; st.push(e.to); } } size.push(n); } return { c, size }; }
  function joinIslands(R) {   // bridge leftover islands to the main network with the shortest connector in reach
    const { c, size } = components(), main = size.indexOf(Math.max(...size)), best = {};
    for (let v = 0; v < X.length; v++) { if (c[v] === main) continue; const h = [Math.floor(X[v] / HC), Math.floor(Z[v] / HC)], r = Math.ceil(R / HC);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const u of vHash.get((h[0] + i) + ',' + (h[1] + j)) || []) { if (c[u] !== main) continue; const d = Math.hypot(X[v] - X[u], Z[v] - Z[u]); if (d < R && (!best[c[v]] || d < best[c[v]].d)) best[c[v]] = { d, v, u }; } }
    for (const k in best) link(best[k].v, best[k].u, 'link', '', 'j' + k);
    return Object.keys(best).length;
  }
  function nearest(x, z) {
    const a = Math.floor(x / HC), b = Math.floor(z / HC); let best = -1, bd = 1e18;
    for (let r = 0; r < 60; r++) { for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; for (const v of vHash.get((a + i) + ',' + (b + j)) || []) { if (!adj[v].length) continue; const d = (X[v] - x) ** 2 + (Z[v] - z) ** 2; if (d < bd) { bd = d; best = v; } } } if (best >= 0 && r * HC > Math.sqrt(bd) + HC) break; }
    return best;
  }
  function astar(s, t) {
    const n = X.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), V = 70 / 3.6, H = v => Math.hypot(X[v] - X[t], Z[v] - Z[t]) / V, hp = [[H(s), s]];
    const push = o => { let i = hp.push(o) - 1; while (i) { const p = (i - 1) >> 1; if (hp[p][0] <= o[0]) break; hp[i] = hp[p]; i = p; } hp[i] = o; };
    const pop = () => { const top = hp[0], l = hp.pop(); if (hp.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hp.length) break; if (c + 1 < hp.length && hp[c + 1][0] < hp[c][0]) c++; if (hp[c][0] >= l[0]) break; hp[i] = hp[c]; i = c; } hp[i] = l; } return top; };
    g[s] = 0; while (hp.length) { const [, v] = pop(); if (v === t) break; for (const e of adj[v]) { const c = g[v] + e.cost; if (c < g[e.to]) { g[e.to] = c; prev[e.to] = v; push([c + H(e.to), e.to]); } } }
    if (g[t] === Infinity) return null; const path = [t]; while (path[path.length - 1] !== s) path.push(prev[path[path.length - 1]]); return path.reverse();
  }
  function edgeOf(a, b) { return adj[a].find(e => e.to === b); }
  const roadName = e => e ? (e.name || TYPE[e.t]) : '';
  function route(ax, az, bx, bz) {
    if (!ready) return null; const s = nearest(ax, az), t = nearest(bx, bz); if (s < 0 || t < 0) return null;
    const vs = s === t ? [s] : astar(s, t); if (!vs) return null;
    const pts = [[ax, az]]; vs.forEach(v => pts.push([X[v], Z[v]])); pts.push([bx, bz]);
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = (i, d) => { const dir = Math.sign(d); let k = i, left = Math.abs(d); while (left > 0 && k + dir >= 0 && k + dir < pts.length) { left -= Math.hypot(pts[k + dir][0] - pts[k][0], pts[k + dir][1] - pts[k][1]); k += dir; } return pts[k]; };
    const steps = []; let secs = 0;
    for (let i = 1; i < vs.length; i++) secs += edgeOf(vs[i - 1], vs[i]).cost;
    for (let i = 1; i < vs.length - 1; i++) {
      const k = i + 1, p = pts[k], a = at(k, -18), b = at(k, 18), d1 = Math.atan2(p[1] - a[1], p[0] - a[0]), d2 = Math.atan2(b[1] - p[1], b[0] - p[0]); let ang = (d2 - d1) * 180 / Math.PI; while (ang > 180) ang -= 360; while (ang < -180) ang += 360;
      const deg = adj[vs[i]].length, A = Math.abs(ang), e0 = edgeOf(vs[i - 1], vs[i]), e1 = edgeOf(vs[i], vs[i + 1]);
      if (!((deg >= 3 && A > 28) || A > 75)) continue;
      const side = ang > 0 ? 'right' : 'left', kind = A > 125 ? 'sharp' : A < 45 ? 'slight' : 'turn', last = steps[steps.length - 1];
      if (last && cum[k] - last.at < 20) { if (A > last.A) { last.at = cum[k]; last.A = A; last.side = side; last.kind = kind; last.road = roadName(e1); } continue; }
      steps.push({ at: cum[k], side, kind, A, road: roadName(e1), from: roadName(e0), i: k });
    }
    return { pts, cum, steps, secs, len: cum[cum.length - 1], vs };
  }

  // the Hyderabad arterials keep their own junctions (a flyover shares no vertex with the road under it, so nothing here goes through vert()'s merge grid).
  // A one-way carriageway stays in the graph backwards at six times the cost: never chosen while a legal way exists, and it keeps a wrong-side start routable.
  function rawVert(x, z) { const i = X.length; X.push(x); Z.push(z); adj.push([]); const h = hk(x, z, HC); (vHash.get(h) || vHash.set(h, []).get(h)).push(i); return i; }
  function rawLink(a, b, t, name, id, one, pref) { const len = Math.hypot(X[a] - X[b], Z[a] - Z[b]), cost = len / (KMH[t] / 3.6) * (pref === 2 ? 3 : pref ? .55 : 1); adj[a].push({ to: b, len, cost, t, name, id }); adj[b].push({ to: a, len, cost: one ? cost * 6 : cost, t, name, id });
    const n = Math.max(1, Math.ceil(len / 30)); for (let i = 0; i <= n; i++) { const h = hk(X[a] + (X[b] - X[a]) * i / n, Z[a] + (Z[b] - Z[a]) * i / n, HC), L = segHash.get(h) || segHash.set(h, []).get(h); L.push({ a, b, id }); } }
  let hydIn = false;
  function addHyd(n) { if (hydIn) return; hydIn = true; const t0 = performance.now();
    const jm = n.jnames || {}; polys.forEach(o => { if (o.id[0] === 'j' && jm[o.id.slice(1)]) { o.name = jm[o.id.slice(1)]; } });      // the Jangaon net's own highway ids name NH-163 correctly too
    for (let v = 0; v < X.length; v++) for (const e of adj[v]) if (e.id && e.id[0] === 'j' && jm[e.id.slice(1)]) e.name = jm[e.id.slice(1)];
    const NV = n.nodes.map(q => rawVert(q[0], q[1]));
    n.edges.forEach((e, i) => { const t = e[3], nm = n.names[e[6]] || (t === 'highway' ? 'Highway link' : ''), o = { p: e[4], t, name: nm, id: 'h' + i }; let prev = NV[e[0]]; const m = e[4].length; for (let k = 1; k < m; k++) { const v = k === m - 1 ? NV[e[1]] : rawVert(e[4][k][0], e[4][k][1]); rawLink(prev, v, t, nm, o.id, e[5], e[7]); tileAdd(t, e[4][k - 1][0], e[4][k - 1][1], e[4][k][0], e[4][k][1]); prev = v; } polys.push(o); });
    for (const j of n.joins) { const v = NV[j[0]], u = nearestOld(j[1], j[2]); if (u >= 0) rawLink(v, u, 'highway', '', 'hj', 0); }
    const addPath = (P, l) => l.forEach((q, i) => i ? P.lineTo(q[0], q[1]) : P.moveTo(q[0], q[1])); (n.water || []).forEach(l => addPath(water, l)); (n.rail || []).forEach(l => addPath(rail, l)); (n.metro || []).forEach(l => addPath(rail, l));
    Nav.hydMs = performance.now() - t0; placeList = null; hydWait.splice(0).forEach(f => f()); draw.dirty = true; }
  const hydWait = [];
  function nearestOld(x, z) { let b = -1, bd = 1e12; const a = Math.floor(x / HC), c = Math.floor(z / HC); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const v of vHash.get((a + i) + ',' + (c + j)) || []) { if (!adj[v].length) continue; const d = (X[v] - x) ** 2 + (Z[v] - z) ** 2; if (d < bd) { bd = d; b = v; } } return b; }

  // ---- basemap: world-space Path2D per tile and class, so a frame only strokes what is on screen
  const TS = 900, tiles = new Map(); let water = null, rail = null;
  function tileAdd(cls, x0, z0, x1, z1) { const k = Math.floor((x0 + x1) / 2 / TS) + ',' + Math.floor((z0 + z1) / 2 / TS); let t = tiles.get(k); if (!t) { t = { k, i: Math.floor((x0 + x1) / 2 / TS), j: Math.floor((z0 + z1) / 2 / TS) }; tiles.set(k, t); } const p = t[cls] || (t[cls] = new Path2D()); p.moveTo(x0, z0); p.lineTo(x1, z1); }
  function buildTiles() { tiles.clear(); for (const r of polys) for (let i = 1; i < r.p.length; i++) tileAdd(r.t, r.p[i - 1][0], r.p[i - 1][1], r.p[i][0], r.p[i][1]); }
  function buildBase() {
    const B = window.MAP_BASE || {}; water = new Path2D(); rail = new Path2D();
    (B.water || []).forEach(l => l.forEach((q, i) => i ? water.lineTo(q[0], q[1]) : water.moveTo(q[0], q[1])));
    (B.rail || []).forEach(l => l.forEach((q, i) => i ? rail.lineTo(q[0], q[1]) : rail.moveTo(q[0], q[1])));
    B.river && (Nav._river = B.river.map(l => { const p = new Path2D(); l.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); return p; }));
  }
  function base(g, cx, cz, s, W, H, rot) {
    g.save(); g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2); if (rot) g.rotate(rot); g.scale(s, s); g.translate(-cx, -cz); g.lineCap = 'round'; g.lineJoin = 'round';
    const lw = px => px / s;
    if (water) { g.fillStyle = COL.water; g.fill(water); (Nav._river || []).forEach(p => { g.strokeStyle = COL.water; g.lineWidth = Math.max(lw(2), 14); g.stroke(p); });
      g.strokeStyle = COL.rail; g.lineWidth = lw(1.4); g.setLineDash([lw(6), lw(4)]); g.stroke(rail); g.setLineDash([]); }
    const R = Math.hypot(W, H) / 2 / s, i0 = Math.floor((cx - R) / TS), i1 = Math.floor((cx + R) / TS), j0 = Math.floor((cz - R) / TS), j1 = Math.floor((cz + R) / TS), on = [];
    tiles.forEach(t => { if (t.i >= i0 && t.i <= i1 && t.j >= j0 && t.j <= j1) on.push(t); });
    const K = Math.max(.7, Math.min(3.4, s * 2.4));
    for (const c of ORDER) {
      if (s < .12 && (c === 'dirt' || c === 'link')) continue; g.strokeStyle = COL[c]; g.lineWidth = Math.max(lw(PX[c] * K), { highway: 7.5, tar: 6, cc: 5, lane: 3.5, dirt: 3, link: 3 }[c] * .9);
      for (const t of on) if (t[c]) g.stroke(t[c]);
    }
    g.restore();
  }

  // ---- places
  const CATS = [['home', 'Home', '#37d7ff'], ['showroom', 'Showrooms', '#c9a6ff'], ['garage', 'Garages', '#8fd3ff'], ['shop', 'Shops', '#ffb347'], ['transport', 'Bus and train', '#6fe0a8'], ['market', 'Markets', '#ffd166'], ['temple', 'Temples and worship', '#ff9e7a'], ['fuel', 'Fuel', '#ffe066'], ['health', 'Health', '#ff7f9f'], ['school', 'Schools', '#a8d8ff'], ['civic', 'Civic and leisure', '#c2d5d0'], ['property', 'Property for sale', '#9be15d'], ['place', 'Places', '#e4efe9']];
  const CAT = {}; CATS.forEach((c, i) => CAT[c[0]] = { id: c[0], name: c[1], col: c[2], rank: i });
  const KMAP = { home: 'home', showroom: 'showroom', garage: 'garage', shop: 'shop', transport: 'transport', 'bus stop': 'transport', busstop: 'transport', busstand: 'transport', station: 'transport', market: 'market', temple: 'temple', church: 'temple', mosque: 'temple', fuel: 'fuel', hospital: 'health', clinic: 'health', school: 'school', anganwadi: 'school', civic: 'civic', police: 'civic', bank: 'civic', theatre: 'civic', hall: 'civic', funchall: 'civic', tank: 'place', village: 'place', hamlet: 'place', town: 'place', factory: 'civic' };
  const GLYPH = { home: 'M4 12l8-7 8 7M7 11v8h10v-8', showroom: 'M4 16v-3l2-5h12l2 5v3zM7 16v2M17 16v2', garage: 'M14 6l4 4-8 8H6v-4zM13 7l4 4', shop: 'M4 9h16l-1-4H5zM6 9v10h12V9', transport: 'M6 5h12v12H6zM6 11h12M8 17v2M16 17v2', market: 'M4 9l2-4h12l2 4M6 9v10h12V9M10 19v-5h4v5', temple: 'M12 3l3 6H9zM7 21V12l5-3 5 3v9z', fuel: 'M6 20V5h8v15M14 11h3v6a1 1 0 0 0 3 0V9l-3-3M8 9h4', health: 'M12 6v12M6 12h12', school: 'M3 10l9-4 9 4-9 4zM7 12v5h10v-5', civic: 'M4 9l8-4 8 4zM6 9v9M18 9v9M12 9v9M4 19h16', property: 'M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8', place: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z' };
  Object.keys(GLYPH).forEach(k => GLYPH[k] = new Path2D(GLYPH[k]));
  let placeList = null;
  const clean = n => String(n).replace('Chearch', 'Church');
  function places() {
    if (placeList && placeList.at > performance.now() - 5000) return placeList.l;
    const l = [], seen = new Set(), add = (name, x, z, kind) => { if (typeof x !== 'number' || !name) return; name = clean(name); const k = name.toLowerCase().replace(/, jangaon$/, '') + '|' + Math.round(x / 80) + '|' + Math.round(z / 80); if (seen.has(k)) return; seen.add(k); l.push({ name, x, z, cat: KMAP[kind] || 'place' }); };
    const LL = window.GameLocations ? GameLocations.all : [];
    LL.forEach(p => { if (!/^lm\d+$/.test(p.id)) add(p.name, p.x, p.z, p.kind); });
    (G.world.landmarks || []).forEach(p => { if (p.k !== 'sign') add(p.name, p.x, p.z, p.k); });
    ((window.JANGAON_LITE || {}).landmarks || []).forEach(p => add(p.name, p.x, p.z, p.k));
    ((window.HYD_LITE || {}).landmarks || []).forEach(p => add(p.name, p.x, p.z, p.k));
    if (window.Properties) Properties.props.forEach(p => { if (Properties.isOwned(p.id)) add('My ' + Properties.typeName(p.type) + ' ' + p.id, p.x, p.z, 'home'); else if (p.type === 'shop') add('Shop ' + p.id, p.x, p.z, 'shop'); else { add(Properties.typeName(p.type) + ' ' + p.id, p.x, p.z, 'x'); l[l.length - 1].cat = 'property'; } });
    placeList = { at: performance.now(), l }; return l;
  }

  // ---- guidance
  const state = window.__navState = { dest: null, r: null, i: 0, off: 0, remain: 0, secs: 0, next: null, nextIn: 0, re: 0, onRoute: true };
  function setDest(x, z, name) {
    state.dest = { x, z, name: name || 'Pinned spot' };
    if (!ready) { readyWait.push(() => state.dest && recalc()); toast('Loading roads'); } else recalc();
    draw.dirty = true; syncSide(); tick(1);
  }
  function recalc() { const c = G.carPos, d = state.dest; if (window.Hyd && !hydIn && (d.x < Hyd.lite.bounds[2] || c.x < Hyd.lite.bounds[2])) { hydWait.push(() => state.dest && recalc()); Hyd.loadNet().then(addHyd); return; } state.r = route(c.x, c.z, d.x, d.z); state.i = 0; state.off = 0; state.re = performance.now(); if (!state.r) toast('No road route to ' + d.name); }
  function stop(quiet) { state.dest = null; state.r = null; card(); draw.dirty = true; syncSide(); if (!quiet) toast('Route cancelled'); }
  const toast = t => { try { G.showPopup(t); } catch (e) {} };
  function tick() {
    const d = state.dest; if (!d) return; const r = state.r, c = G.carPos, foot = G.playerMode === 'foot';
    if (Math.hypot(c.x - d.x, c.z - d.z) < 24) { const n = d.name; stop(true); toast('You have arrived: ' + n); try { Phone.notify('Arrived at ' + n); } catch (e) {} return; }
    if (!r) { card(); return; }
    let best = state.i, bd = 1e18, bx = c.x, bz = c.z; const hi = Math.min(r.pts.length - 1, state.i + 60);
    for (let i = Math.max(1, state.i); i <= hi; i++) { const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((c.x - a[0]) * dx + (c.z - a[1]) * dz) / L)), px = a[0] + dx * k, pz = a[1] + dz * k, q = (c.x - px) ** 2 + (c.z - pz) ** 2; if (q < bd) { bd = q; best = i; bx = px; bz = pz; } }
    state.i = best; const off = Math.sqrt(bd), done = r.cum[best - 1 < 0 ? 0 : best - 1] + Math.hypot(bx - r.pts[best - 1][0], bz - r.pts[best - 1][1]);
    if (off > 40) { state.off += state.dt || .25; if (state.off > 1.5 && performance.now() - state.re > 3000) { recalc(); toast('Rerouting'); Nav.reroutes++; return tick(); } } else state.off = 0;
    state.onRoute = off <= 40; state.remain = r.len - done; state.secs = foot ? state.remain / 1.6 : r.secs * (state.remain / (r.len || 1));
    state.next = r.steps.find(s => s.at > done + 3) || null; state.nextIn = state.next ? state.next.at - done : state.remain; card();
  }
  const ARROW = { left: 'M17 19v-7a3 3 0 0 0-3-3H6M10 5L6 9l4 4', right: 'M7 19v-7a3 3 0 0 1 3-3h8M14 5l4 4-4 4', slightleft: 'M15 20v-6l-6-6M8 13V7h6', slightright: 'M9 20v-6l6-6M16 13V7h-6', sharpleft: 'M16 20V8l-8 8M8 10v6h6', sharpright: 'M8 20V8l8 8M16 10v6h-6', straight: 'M12 20V5M7 10l5-5 5 5', arrive: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z' };
  const instr = () => { const n = state.next; if (!n) return { k: 'arrive', t: 'Arrive at ' + state.dest.name }; const w = n.kind === 'sharp' ? 'Sharp ' + n.side : n.kind === 'slight' ? 'Keep ' + n.side : 'Turn ' + n.side; return { k: n.kind === 'turn' ? n.side : n.kind + n.side, t: w + (n.road && n.road !== n.from ? ' onto ' + n.road : '') }; };
  let cardEl = null, cardKey = '';
  function card() {
    if (!cardEl) { cardEl = document.createElement('div'); cardEl.id = 'navCard'; cardEl.className = 'panel'; cardEl.innerHTML = '<svg viewBox="0 0 24 24" class="ic na"><path/></svg><div class="nb"><b></b><span></span></div><button aria-label="Cancel route"></button>'; const L = document.getElementById('uiLeft'); L.insertBefore(cardEl, L.firstChild); cardEl.querySelector('button').innerHTML = UI.icon('close'); cardEl.querySelector('button').onclick = e => { e.stopPropagation(); stop(); e.currentTarget.blur(); }; }
    if (!state.dest) { cardEl.style.display = 'none'; cardKey = ''; return; } cardEl.style.display = '';
    if (!state.r) return; const I = instr(), a = fmtD(state.nextIn) + '  ' + I.t, b = fmtD(state.remain) + ' left, ' + fmtT(state.secs) + ' to ' + state.dest.name, k = a + b; if (k === cardKey) return; cardKey = k;
    cardEl.querySelector('path').setAttribute('d', ARROW[I.k] || ARROW.straight); cardEl.querySelector('b').textContent = a; cardEl.querySelector('span').textContent = b;
  }

  // route on any north-up or rotated map
  function drawRoute(g, cx, cz, s, W, H, rot, width) {
    const r = state.r, d = state.dest; if (!d) return; g.save(); g.translate(W / 2, H / 2); if (rot) g.rotate(rot); g.scale(s, s); g.translate(-cx, -cz); g.lineCap = g.lineJoin = 'round';
    if (r) { const R = Math.hypot(W, H) / s; g.beginPath(); let pen = false; const c = G.carPos; g.moveTo(c.x, c.z); pen = true; for (let i = Math.max(0, state.i); i < r.pts.length; i++) { const p = r.pts[i]; if (Math.abs(p[0] - cx) > R || Math.abs(p[1] - cz) > R) { pen = false; g.moveTo(p[0], p[1]); } else { g.lineTo(p[0], p[1]); pen = true; } }
      g.strokeStyle = '#04343f'; g.lineWidth = (width + 3) / s; g.stroke(); g.strokeStyle = COL.route; g.lineWidth = width / s; g.stroke(); }
    g.restore();
  }
  function destPin(g, x, y) { g.save(); g.translate(x, y); g.fillStyle = COL.route; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-11, -12, -9, -24, 0, -24); g.bezierCurveTo(9, -24, 11, -12, 0, 0); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -15, 3.2, 0, 7); g.fill(); g.restore(); }
  function radar(g, s, rot) {
    if (!state.dest) return; const c = G.carPos, d = state.dest; drawRoute(g, c.x, c.z, s, 220, 220, rot, 5);
    const a = rot, dx = d.x - c.x, dz = d.z - c.z, rx = (dx * Math.cos(a) - dz * Math.sin(a)) * s, rz = (dx * Math.sin(a) + dz * Math.cos(a)) * s, q = Math.hypot(rx, rz), k = Math.min(1, 96 / (q || 1)); destPin(g, 110 + rx * k, 110 + rz * k);
  }

  // ---- full map
  const v = { s: .3, cx: 0, cz: 0, W: 0, H: 0, opened: false, hits: [], filter: { property: false }, query: '' };
  const P = (x, z) => [v.W / 2 + (x - v.cx) * v.s, v.H / 2 + (z - v.cz) * v.s];
  const toWorld = (mx, my) => [v.cx + (mx - v.W / 2) / v.s, v.cz + (my - v.H / 2) / v.s];
  function icon(g, x, y, cat, r) { g.fillStyle = cat.col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = '#06242a'; g.lineWidth = 1.5; g.stroke(); g.save(); g.translate(x - r * .72, y - r * .72); g.scale(r / 16.6, r / 16.6); g.lineWidth = 2.4; g.lineCap = g.lineJoin = 'round'; g.stroke(GLYPH[cat.id]); g.restore(); }
  function draw(c) {
    if (!c) c = document.getElementById('bigmap'); const W = c.clientWidth, H = c.clientHeight, now = performance.now();
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; draw.dirty = true; }
    if (!v.opened) { v.opened = true; v.cx = G.carPos.x; v.cz = G.carPos.z; }
    v.W = W; v.H = H; if (!draw.dirty && now - (draw.t || 0) < 200) return; draw.t = now; draw.dirty = false; const g = c.getContext('2d'), s = v.s;
    base(g, v.cx, v.cz, s, W, H, 0); drawRoute(g, v.cx, v.cz, s, W, H, 0, 5); v.hits = [];
    g.textBaseline = 'middle'; const boxes = [], free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    // towns first, so nothing sits over them
    const town = (n, x, z, a) => { if (s > a) return; const [px, py] = P(x, z); g.font = '700 ' + (s < .1 ? 15 : 18) + 'px Barlow, system-ui'; const w = g.measureText(n).width; if (free(px - w / 2 - 4, py - 13, w + 8, 26)) { g.lineWidth = 4; g.strokeStyle = COL.bg; g.strokeText(n, px - w / 2, py); g.fillStyle = '#fbf6e8'; g.fillText(n, px - w / 2, py); } };
    // highway shields
    if (s > .05) { const seen = []; for (const r of polys) { if (r.t !== 'highway') continue; const m = r.p[r.p.length >> 1], [px, py] = P(m[0], m[1]); if (px < 40 || py < 20 || px > W - 40 || py > H - 20 || seen.some(q => Math.hypot(q[0] - px, q[1] - py) < 240)) continue; seen.push([px, py]); g.font = '700 11px "Barlow Condensed", system-ui'; const t = r.name && /^(NH|SH)/.test(r.name) ? r.name : 'NH-365B', w = g.measureText(t).width + 10; if (free(px - w / 2, py - 9, w, 18)) { g.fillStyle = '#fbf6e8'; g.fillRect(px - w / 2, py - 9, w, 18); g.fillStyle = '#0c2a2e'; g.fillText(t, px - w / 2 + 5, py + 1); } } }
    // places: cluster on a screen grid, then label by importance
    const q = v.query, cell = 48, cells = new Map(); const L = places();
    for (const p of L) { if (v.filter[p.cat] === false) continue; if (q && !p.name.toLowerCase().includes(q)) continue; if (p.cat === 'property' && s < .5 && !q) continue; const [px, py] = P(p.x, p.z); if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue; if (p.cat === 'home' || s > 3) { cells.set('u' + cells.size, [[p, px, py]]); continue; } const k = Math.floor(px / cell) + ',' + Math.floor(py / cell); (cells.get(k) || cells.set(k, []).get(k)).push([p, px, py]); }
    const singles = []; cells.forEach(a => {
      if (a.length === 1) { singles.push(a[0]); return; } let mx = 0, my = 0, top = a[0][0]; a.forEach(o => { mx += o[1]; my += o[2]; if (CAT[o[0].cat].rank < CAT[top.cat].rank) top = o[0]; }); mx /= a.length; my /= a.length;
      g.fillStyle = '#0a1d22'; g.beginPath(); g.arc(mx, my, 13, 0, 7); g.fill(); g.strokeStyle = CAT[top.cat].col; g.lineWidth = 2.5; g.stroke(); g.fillStyle = '#fbf6e8'; g.font = '700 12px Barlow, system-ui'; const t = String(a.length); g.fillText(t, mx - g.measureText(t).width / 2, my + 1); v.hits.push({ x: mx, y: my, r: 15, cluster: 1 }); free(mx - 14, my - 14, 28, 28);
    });
    singles.sort((a, b) => CAT[a[0].cat].rank - CAT[b[0].cat].rank);
    singles.forEach(o => { const r = 10; free(o[1] - r, o[2] - r, 2 * r, 2 * r); });
    singles.forEach(o => { const [p, x, y] = o, cat = CAT[p.cat]; icon(g, x, y, cat, 10); v.hits.push({ x, y, r: 12, p }); if ((s < .32 && cat.rank > 4 || cat.id === 'property' && s < 1.4) && !q) return; g.font = '600 12px Barlow, system-ui'; const w = g.measureText(p.name).width; let lx = x + 14; if (!free(lx, y - 8, w, 16)) { lx = x - 14 - w; if (!free(lx, y - 8, w, 16)) return; } g.lineWidth = 3; g.strokeStyle = COL.bg; g.strokeText(p.name, lx, y); g.fillStyle = '#eaf3ee'; g.fillText(p.name, lx, y); });
    boxes.length = 0; town('Jangaon', -3900, -2050, .5); town('Nellutla', 0, -60, .7); ((window.HYD_LITE || {}).towns || []).forEach(t => town(t[0], t[1], t[2], s < .05 ? .03 : .5));
    try { MP.drawBigMap(g, P); } catch (e) {}
    if (state.dest) { const [x, y] = P(state.dest.x, state.dest.z); destPin(g, x, y); }
    try { const m = MISSIONS[mIdx], [x, y] = P(m.l.x, m.l.z); g.strokeStyle = '#f6b21b'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); } catch (e) {}
    const [px, py] = P(G.carPos.x, G.carPos.z); g.save(); g.translate(px, py); g.rotate(-(Math.PI + carRot)); g.fillStyle = '#fff'; g.strokeStyle = '#0a1d22'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  const clampV = () => { const b = G.world.bounds; v.s = Math.max(.0055, Math.min(6, v.s)); v.cx = Math.max(b[0], Math.min(b[2], v.cx)); v.cz = Math.max(b[1], Math.min(b[3], v.cz)); draw.dirty = true; };
  function zoomAt(mx, my, k) { const [wx, wz] = toWorld(mx, my); v.s *= k; v.s = Math.max(.0055, Math.min(6, v.s)); v.cx = wx - (mx - v.W / 2) / v.s; v.cz = wz - (my - v.H / 2) / v.s; clampV(); }
  function clickMap(mx, my) {
    for (const h of v.hits) if (Math.hypot(h.x - mx, h.y - my) <= h.r) { if (h.cluster) return zoomAt(mx, my, 2.2); return setDest(h.p.x, h.p.z, h.p.name); }
    const [x, z] = toWorld(mx, my), n = nearest(x, z); if (n >= 0) setDest(X[n], Z[n], 'Pinned spot');
  }
  function hookMap() {
    const c = document.getElementById('bigmap'), pts = new Map(); let drag = null, pinch = 0;
    const local = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('wheel', e => { e.preventDefault(); e.stopImmediatePropagation(); const m = local(e); zoomAt(m[0], m[1], e.deltaY < 0 ? 1.25 : .8); }, { passive: false, capture: true });
    c.addEventListener('contextmenu', e => { e.preventDefault(); const m = local(e), w = toWorld(m[0], m[1]); try { MP.placePing(w[0], w[1]); } catch (x) {} draw.dirty = true; });
    c.addEventListener('pointerdown', e => { if (e.button) return; c.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); drag = { p: local(e), cx: v.cx, cz: v.cz, moved: 0 }; pinch = 0; });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; const m = local(e); pts.set(e.pointerId, m);
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch); pinch = d; if (drag) drag.moved = 99; return; }
      if (!drag) return; const dx = m[0] - drag.p[0], dy = m[1] - drag.p[1]; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy)); v.cx = drag.cx - dx / v.s; v.cz = drag.cz - dy / v.s; clampV();
    });
    const up = e => { const had = pts.delete(e.pointerId); if (!pts.size && drag && had) { if (drag.moved < 5) clickMap(drag.p[0], drag.p[1]); drag = null; } };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', e => { pts.delete(e.pointerId); drag = null; });
  }

  // ---- side panel
  let side = null, list = null, sum = null;
  const openCat = { home: 1, showroom: 1 };
  function buildSide() {
    side = document.createElement('aside'); side.id = 'mapSide';
    side.innerHTML = '<h2>Locations</h2><input id="mapSearch" type="search" placeholder="Search places" aria-label="Search places" autocomplete="off"><div id="mapRoute"></div><div id="mapList"></div><div id="mapTools"><button data-z="1.5" aria-label="Zoom in">+</button><button data-z="0.66" aria-label="Zoom out">-</button><button data-me="1">Find me</button><button data-all="1">Whole map</button></div>';
    document.body.appendChild(side); list = side.querySelector('#mapList'); sum = side.querySelector('#mapRoute');
    const s = side.querySelector('#mapSearch');
    s.addEventListener('input', () => { v.query = s.value.trim().toLowerCase(); draw.dirty = true; renderList(); });
    s.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { s.blur(); setMap(false); } if (e.key === 'Enter') { const b = list.querySelector('.pl'); if (b) b.click(); } });
    side.addEventListener('click', e => {
      e.stopPropagation(); const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z) zoomAt(v.W / 2, v.H / 2, +b.dataset.z);
      if (b.dataset.me) { v.cx = G.carPos.x; v.cz = G.carPos.z; v.s = Math.max(v.s, .6); clampV(); }
      if (b.dataset.all) { const c = document.getElementById('bigmap').getBoundingClientRect(), vis = Math.min(c.right, side.getBoundingClientRect().left) - c.left, x0 = -77000, x1 = 2500, z0 = -6000, z1 = 38000; v.s = Math.min((vis - 40) / (x1 - x0), (v.H - 40) / (z1 - z0)); v.cx = (x0 + x1) / 2 + (v.W - vis) / 2 / v.s; v.cz = (z0 + z1) / 2; clampV(); }
      if (b.dataset.stop) stop();
      if (b.dataset.cat) { openCat[b.dataset.cat] = !openCat[b.dataset.cat]; renderList(); }
      if (b.dataset.eye) { const k = b.dataset.eye; v.filter[k] = v.filter[k] === false; draw.dirty = true; renderList(); }
      if (b.dataset.i) { const p = shown[+b.dataset.i]; v.cx = p.x; v.cz = p.z; v.s = Math.max(v.s, .7); clampV(); setDest(p.x, p.z, p.name); }
    });
  }
  let shown = [];
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderList() {
    if (!list) return; const q = v.query, c = G.carPos, L = places().map(p => ({ p, d: Math.hypot(p.x - c.x, p.z - c.z) })).filter(o => !q || o.p.name.toLowerCase().includes(q)); let h = ''; shown = [];
    for (const cat of CATS) { const a = L.filter(o => o.p.cat === cat[0]).sort((x, y) => x.d - y.d); if (!a.length) continue; const open = q || openCat[cat[0]], off = v.filter[cat[0]] === false;
      h += `<div class="ch"><button data-cat="${cat[0]}" aria-expanded="${!!open}"><i style="background:${cat[2]}"></i>${cat[1]}<em>${a.length}</em></button><button data-eye="${cat[0]}" class="eye" aria-pressed="${!off}" title="Show on map">${off ? 'Off' : 'On'}</button></div>`;
      if (open) a.slice(0, 40).forEach(o => { shown.push(o.p); h += `<button class="pl" data-i="${shown.length - 1}"><span>${esc(o.p.name)}</span><small>${fmtD(o.d)}</small></button>`; }); }
    list.innerHTML = h || '<p>No place matches. Try fewer letters.</p>';
  }
  function syncSide() { if (!sum) return; const d = state.dest; sum.innerHTML = d ? `<b>${esc(d.name)}</b><span>${state.r ? fmtD(state.r.len) + ', ' + fmtT(state.r.secs) : 'No road route'}</span><button data-stop="1">Stop route</button>` : '<span>Pick a place or click the map to set a route.</span>'; }

  const Nav = window.Nav = { tick, route, setDest, stop, places, base, draw, radar, drawRoute, state, instr: () => state.dest && state.r ? instr() : null, ARROW, fmtD, fmtT, reroutes: 0, cats: CAT,
    hydIn: () => hydIn, get ready() { return ready; }, get stats() { return { verts: X.length, comps: components().size.sort((a, b) => b - a).slice(0, 6), tiles: tiles.size }; }, opened() { renderList(); syncSide(); draw.dirty = true; } };

  GameHooks.init.push(g => {
    G = g; buildBase(); buildSide(); hookMap();
    (g.world.roads || []).forEach((r, i) => { const t = PX[r.t] ? r.t : 'lane', o = { p: r.p, t, name: t === 'highway' ? 'NH-365B' : STREET[r.n] || '', id: 'v' + i }; polys.push(o); addPoly(o.p, o.t, o.name, o.id); });
    buildTiles();
    fetch('../nellutla-map/jangaon-net.json?v=1').then(r => r.json()).then(n => {
      net = n; n.edges.forEach((e, i) => { const t = PX[e[3]] ? e[3] : 'tar', o = { p: e[4], t, name: t === 'highway' ? 'NH-365B' : '', id: 'j' + i }; polys.push(o); addPoly(o.p, o.t, o.name, o.id); });
      stitch(16); joinIslands(60); joinIslands(120); buildTiles(); ready = true; readyWait.splice(0).forEach(f => f()); draw.dirty = true;
      // the corridor to Secunderabad joins in once the page has settled: nothing about it runs during load
      if (window.Hyd) { const go = () => Hyd.loadNet().then(addHyd); const idle = window.requestIdleCallback || (f => setTimeout(f, 200)); setTimeout(() => idle(go, { timeout: 3000 }), 2500); }
    });
    if (window.Properties) { Properties.setWaypoint = (x, z, l) => setDest(x, z, l); }
    const old = window.setMap; if (typeof setMap === 'function') { const o = setMap; setMap = on => { o(on); if (on) { Nav.opened(); try { document.getElementById('mapSearch').value = ''; v.query = ''; } catch (e) {} } }; }
    let T = 0; GameHooks.update.push(() => { const n = performance.now(); if (n - T > 250) { state.dt = Math.min(1, (n - T) / 1000); T = n; tick(); } });
  });
})();
