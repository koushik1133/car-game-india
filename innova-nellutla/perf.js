// perf.js: cheaper scene bookkeeping.
// three.js rebuilds the matrix of every object in the scene on every render, drawn or not. Most of this game's objects
// are hidden at any moment (parts of merged vehicles, showroom stock, pooled models), so the scene's own update walks
// only what is visible. A hidden branch is brought fully up to date the moment it is shown again, and the first time it
// is met, so anything that reads its position still gets a correct one.
(function () {
  const base = THREE.Object3D.prototype.updateMatrixWorld;
  const stats = { skipped: 0, still: 0, on: true, lazy: true };
  function walk(o, force) {
    // An object that has not moved, turned or been resized since the last frame keeps the matrix it has: rebuilding it
    // would give the same numbers. Most of the scene (buildings, parked things, parts of models) is like that.
    if (o.matrixAutoUpdate) {
      const p = o.position, q = o.quaternion, s = o.scale;
      if (!stats.lazy || o._px !== p.x || o._py !== p.y || o._pz !== p.z || o._qx !== q._x || o._qy !== q._y || o._qz !== q._z || o._qw !== q._w
          || o._sx !== s.x || o._sy !== s.y || o._sz !== s.z || o._mp !== o.parent) {   // a new parent moves it too
        o._px = p.x; o._py = p.y; o._pz = p.z; o._qx = q._x; o._qy = q._y; o._qz = q._z; o._qw = q._w; o._sx = s.x; o._sy = s.y; o._sz = s.z; o._mp = o.parent;
        o.updateMatrix();
      } else stats.still++;
    }
    if (o.matrixWorldNeedsUpdate || force) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix); else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      o.matrixWorldNeedsUpdate = false; force = true;
    }
    const ch = o.children;
    for (let i = 0, n = ch.length; i < n; i++) {
      const c = ch[i];
      if (!c.visible) {
        if (c._mwSeen) { c._mwStale = true; stats.skipped++; continue; }
        c._mwSeen = true; c.updateMatrixWorld(true); continue;          // first meeting: one full update
      }
      if (c._mwStale) { c._mwStale = false; c._mwSeen = true; c.updateMatrixWorld(true); continue; }   // shown again
      if (c.updateMatrixWorld !== base) { c.updateMatrixWorld(force); continue; }   // cameras, skinned meshes, frozen groups: their own rule
      walk(c, force);
    }
  }
  // Audio: the engine, road and ambience voices re-send the same target to the same control every frame. A repeat of the
  // target a control is already heading for changes nothing, so it is dropped (and re-sent at most a few times a second).
  if (window.AudioParam && AudioParam.prototype.setTargetAtTime) {
    const orig = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (v, t, k) {
      const now = performance.now();
      if (this._pv === v && this._pk === k && now - this._pt < 250) return this;
      this._pv = v; this._pk = k; this._pt = now;
      return orig.call(this, v, t, k);
    };
    ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'setValueCurveAtTime'].forEach(n => {
      const f = AudioParam.prototype[n]; if (!f) return;
      AudioParam.prototype[n] = function () { this._pt = -1e9; return f.apply(this, arguments); };
    });
  }
  GameHooks.init.push(G => {
    const scene = G.scene;
    scene.updateMatrixWorld = function (force) {
      if (force || !stats.on) return base.call(this, force);
      stats.skipped = 0; stats.still = 0; walk(this, false);
    };
    window.Perf = stats;
  });
})();
