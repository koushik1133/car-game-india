// mud.js: dust and dirt for Nellutla's unpaved roads and fields.
// - The player's vehicle throws pooled dust sprites behind its rear wheels on 'dirt' / 'field' / 'river' surfaces
//   (pool size by Quality.tier), and slowly gets dirty: tyres go brown, the lower body takes a dust tint (materials
//   are cloned per vehicle on first use and lerped from their original colour). Washes off slowly on tar / concrete,
//   faster in rain.
// - Traffic on dirt near the camera raises light dust too.
// Exposes window.Mud = { dirtOf(group), setDirt(group, k), pool }.
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined' || typeof THREE === 'undefined') return;
  const DIRTY = { dirt: 1, field: 1, river: 0.7 };
  const DUST_COL = new THREE.Color(0xd8c3a0), TYRE_DIRT = new THREE.Color(0x6b4f33), BODY_DIRT = new THREE.Color(0xa08868);
  const tier = () => (window.Quality && Quality.tier) || 'high';
  const poolSize = () => ({ low: 24, medium: 48 }[tier()] || 80);

  // ---------------------------------------------------------------- dust sprites
  let tex = null, pool = [], scene = null, nextFree = 0;
  function makeTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }
  function ensurePool() {
    const n = poolSize();
    while (pool.length < n) {
      const m = new THREE.SpriteMaterial({ map: tex, color: DUST_COL, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 2; s.userData.noLOD = true;
      scene.add(s); pool.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, a0: 0.3, g0: 1 });
    }
  }
  function puff(x, y, z, vx, vz, size, alpha, life) {
    if (!pool.length) return;
    let p = null;
    for (let i = 0; i < pool.length; i++) { const q = pool[(nextFree + i) % pool.length]; if (q.life <= 0) { p = q; nextFree = (nextFree + i + 1) % pool.length; break; } }
    if (!p) return;                                   // pool exhausted: skip (keeps it cheap)
    p.life = p.max = life; p.vx = vx; p.vy = 0.4 + Math.random() * 0.5; p.vz = vz; p.a0 = alpha; p.g0 = size;
    p.s.position.set(x, y, z); p.s.scale.setScalar(size); p.s.material.opacity = alpha; p.s.visible = true;
    p.s.material.rotation = Math.random() * 6.28;
  }
  function stepPool(dt) {
    for (const p of pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= 0.96; p.vz *= 0.96; p.vy *= 0.98;
      p.s.scale.setScalar(p.g0 * (1 + k * 2.2));
      p.s.material.opacity = p.a0 * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
    }
  }

  // ---------------------------------------------------------------- vehicle dirt (material tint)
  const _b = new THREE.Box3(), _v = new THREE.Vector3();
  function prep(group) {
    const U = group.userData; if (U._mud) return U._mud;
    const entries = [];
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    group.traverse(o => {
      if (!o.isMesh || !o.material || o.userData.noMud) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.every(m => m && m.color && !m.transparent && !(m.emissive && m.emissive.getHex() !== 0))) return;   // leave lamps / glass alone
      _b.setFromObject(o); if (_b.isEmpty()) return;
      _b.getCenter(_v).applyMatrix4(inv);
      const y = _v.y, cloned = mats.map(m => m.clone());
      // tyres: dark, low meshes (or named so); lower body: weight falls off with height
      const name = (o.name || '') + ' ' + (o.parent && o.parent.name || '');
      const lum = cloned[0].color.r * 0.3 + cloned[0].color.g * 0.59 + cloned[0].color.b * 0.11;
      const tyre = /tyre|tire|wheel/i.test(name) || (y < 0.6 && lum < 0.12);
      const w = tyre ? 1 : Math.max(0, Math.min(1, (1.25 - y) / 0.9)) * 0.75 + 0.08;
      if (w < 0.1) return;
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      entries.push({ mats: cloned, base: cloned.map(m => m.color.clone()), w, tyre });
    });
    return (U._mud = { entries, dirt: 0, shown: -1 });
  }
  function paint(M) {
    if (Math.abs(M.dirt - M.shown) < 0.015) return;
    M.shown = M.dirt;
    for (const e of M.entries) {
      const k = Math.min(0.85, M.dirt * e.w * (e.tyre ? 0.9 : 0.6));
      for (let i = 0; i < e.mats.length; i++) e.mats[i].color.copy(e.base[i]).lerp(e.tyre ? TYRE_DIRT : BODY_DIRT, k);
    }
  }

  // ---------------------------------------------------------------- per-frame
  function playerGroup() {
    try {
      if (Player.mode === 'crysta') return typeof playerCarGroup !== 'undefined' ? playerCarGroup : null;
      if (Player.mode === 'vehicle' && Player.active && Player.active.g) return Player.active.g;
    } catch (e) {}
    return null;
  }
  const raining = () => { try { return typeof rainParticles !== 'undefined' && rainParticles && rainParticles.visible; } catch (e) { return false; } };
  let trafAcc = 0;
  function emitBehind(g, speed, rate, alpha, dt, half, back) {
    const yaw = g.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // forward sign: rear wheels are behind the travel direction
    const sgn = speed >= 0 ? 1 : -1, n = rate * dt + Math.random();
    for (let i = 0; i < Math.floor(n); i++) {
      const side = Math.random() < 0.5 ? -half : half;
      const x = g.position.x - fx * back * sgn + rx * side + (Math.random() - 0.5) * 0.3;
      const z = g.position.z - fz * back * sgn + rz * side + (Math.random() - 0.5) * 0.3;
      const sp = Math.abs(speed);
      puff(x, g.position.y + 0.25, z, -fx * sgn * sp * 0.25 + (Math.random() - 0.5), -fz * sgn * sp * 0.25 + (Math.random() - 0.5),
        0.9 + Math.random() * 0.6, alpha, 1.4 + Math.random() * 1.2);
    }
  }
  function update(dt, game) {
    if (!scene) { scene = game.scene; tex = makeTex(); }
    ensurePool();
    const surfAt = game.world && game.world.surfaceAt;
    // player vehicle
    const g = playerGroup();
    if (g && surfAt) {
      const surf = surfAt(g.position.x, g.position.z), dirty = DIRTY[surf] || 0;
      const kmh = typeof carSpeed === 'number' ? carSpeed : 0, ms = kmh / 3.6, rain = raining();
      const M = prep(g);
      if (dirty && Math.abs(ms) > 0.5) M.dirt = Math.min(1, M.dirt + dt * dirty * Math.min(1, Math.abs(ms) / 12) * 0.012 * (rain ? 1.6 : 1));   // ~1.5 min to fully dirty
      else if (!dirty) M.dirt = Math.max(0, M.dirt - dt * (rain ? 0.02 : Math.abs(ms) > 8 ? 0.0012 : 0.0003));
      paint(M);
      if (dirty && !rain && Math.abs(ms) > 2) {
        const two = Player.mode === 'vehicle' && Player.active && /bike|scooter|cycle/.test(Player.active.model || '');
        emitBehind(g, ms, Math.min(40, Math.abs(ms) * 3.5) * dirty * (tier() === 'low' ? 0.5 : 1), Math.min(0.55, 0.22 + Math.abs(ms) * 0.025), dt, two ? 0.05 : 0.8, two ? 0.9 : 1.6);
      }
    }
    // traffic: light dust, only near the camera, checked at 10 Hz
    trafAcc += dt;
    if (surfAt && tier() !== 'low' && game.traffic) {
      const cp = game.camera.position, doCheck = trafAcc > 0.1; if (doCheck) trafAcc = 0;
      for (const tc of game.traffic) {
        const tg = tc.g; if (!tg || !tg.visible) continue;
        if (Math.abs(tg.position.x - cp.x) > 60 || Math.abs(tg.position.z - cp.z) > 60) continue;
        if (doCheck) tc._mudS = DIRTY[surfAt(tg.position.x, tg.position.z)] || 0;
        const v = Math.abs(tc.cur != null ? tc.cur : tc.speed || 0);
        if (tc._mudS && v > 3 && !raining()) emitBehind(tg, v, Math.min(8, v * 0.7), 0.2, dt, 0.6, 1.6);
      }
    }
    stepPool(dt);
  }
  GameHooks.update.push((dt, game) => { try { update(dt, game); } catch (e) { console.warn('mud', e); } });
  window.Mud = {
    dirtOf: (g) => (g && g.userData._mud ? g.userData._mud.dirt : 0),
    setDirt: (g, k) => { const M = prep(g); M.dirt = Math.max(0, Math.min(1, k)); paint(M); },
    get pool() { return pool; },
  };
})();
