// lod.js: distance LOD for the dynamic actors that live as top-level scene children
// (traffic / procession / multiplayer vehicles = groups with userData.dims or a child that has it,
// villagers / riders / avatars = groups holding a HumanModel).
//   near  (< NEAR m):   full model, its own meshes (wheels spin, lamps change colour, limbs swing)
//   mid   (< hide m):   one merged vertex-coloured mesh = 1 draw call, a snapshot of the current pose
//   far   (> hide m):   not drawn
//   rest  (near, not moved for 2 s): same materials and geometry, merged per material in the vehicle's frame, so a parked
//         car costs one call per material instead of one per part and looks identical. Any part moving undoes it at once.
// Shadows are cast only inside SHADOW m. Uses camera layers, not .visible, so it never fights the modules
// that own .visible (parked / GLB swap / hide-on-board); the shadow pass honours layers too.
(function () {
  const TIER = {
    low:    { veh: 260, ped: 90,  near: 30, pedNear: 22, shadow: 40 },
    medium: { veh: 350, ped: 140, near: 40, pedNear: 30, shadow: 60 },
    high:   { veh: 500, ped: 220, near: 55, pedNear: 40, shadow: 60 },
  };
  const NEAR = 0, NEAR_NOSHADOW = 1, MID = 2, HIDDEN = 3, REST = 4;
  const farMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hasDims = c => !!(c.userData && c.userData.dims) || c.children.some(k => k.userData && k.userData.dims);
  const isHuman = c => !!(c.userData && (c.userData.humanRef || c.userData.human)) || c.children.some(k => k.userData && k.userData.humanRef);
  function drawn(o, root) { for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return false; return true; }

  const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _c = new THREE.Color();
  // bake everything currently drawn under c into one vertex-coloured mesh in c's local frame
  function buildFar(c) {
    c.updateMatrixWorld(true); _inv.copy(c.matrixWorld).invert();
    const parts = []; let total = 0;
    c.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData._far || !drawn(o, c)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || (mat.transparent && mat.opacity < 0.2)) return;
      const src = o.geometry; if (!src || !src.attributes.position) return;
      const g = src.index ? src.toNonIndexed() : src;
      parts.push([o, g, g !== src, mat]); total += g.attributes.position.count;
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let off = 0;
    for (const [o, g, own, mat] of parts) {
      _m.multiplyMatrices(_inv, o.matrixWorld); _n.getNormalMatrix(_m);
      const p = g.attributes.position, nn = g.attributes.normal, vc = mat.vertexColors && g.attributes.color, cnt = p.count;
      _c.copy(mat.color || _c.setRGB(0.6, 0.6, 0.6));
      if (mat.map) _c.multiplyScalar(0.85);               // textured cloth / plates read slightly darker than their tint
      if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.3) _c.add(mat.emissive);
      const v = new THREE.Vector3();
      for (let i = 0; i < cnt; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(_m); pos.set([v.x, v.y, v.z], (off + i) * 3);
        if (nn) { v.fromBufferAttribute(nn, i).applyMatrix3(_n).normalize(); nor.set([v.x, v.y, v.z], (off + i) * 3); }
        const k = (off + i) * 3;
        col[k] = _c.r * (vc ? vc.getX(i) : 1); col[k + 1] = _c.g * (vc ? vc.getY(i) : 1); col[k + 2] = _c.b * (vc ? vc.getZ(i) : 1);
      }
      if (own) g.dispose();
      off += cnt;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, farMat); m.userData._far = true; m.castShadow = false; m.receiveShadow = false;
    m.userData._sig = parts.length;
    return m;
  }
  function signature(c) { let n = 0; c.traverse(o => { if (o.isMesh && !o.userData._far && !o.isSkinnedMesh && drawn(o, c)) n++; }); return n; }
  function glbActive(c) {
    let on = false;
    c.traverse(o => { const r = o.userData && o.userData.humanRef; if (r && r.parts && r.parts._glb && r.parts._glb.obj) on = true; });
    return on;
  }

  // ---------------------------------------------------------- rest merge
  let bakeId = 0;
  // plain opaque paint that differs only in colour shares one vertex-coloured material: same shading, fewer calls
  const families = new Map();
  function family(mat) {
    if (mat.map || mat.vertexColors || mat.transparent || mat.alphaTest || !mat.color || mat.envMap || mat.normalMap || mat.alphaMap || mat.lightMap || mat.aoMap || mat.emissiveMap || mat.specularMap) return null;
    if (mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null;
    if (!(mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshBasicMaterial || mat.isMeshStandardMaterial)) return null;
    if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0) return null;           // lamps stay on their own
    const k = [mat.type, mat.side, mat.flatShading, mat.shininess, mat.specular && mat.specular.getHex(), mat.roughness, mat.metalness, mat.fog, mat.toneMapped, mat.polygonOffset, mat.depthWrite].join();
    let f = families.get(k);
    if (!f) { f = mat.clone(); f.color.set(0xffffff); f.vertexColors = true; families.set(k, f); }
    return f;
  }
  function bakeRest(c) {
    const ud = c.userData, id = ++bakeId;
    leaveCell(c);
    if (ud._mg) { c.remove(ud._mg); ud._mg.children.forEach(m => m.geometry.dispose()); ud._mg = null; }
    c.updateMatrixWorld(true); _inv.copy(c.matrixWorld).invert();
    const buckets = new Map();
    c.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData._far || !drawn(o, c)) return;
      const mat = o.material, g = o.geometry;
      if (!mat || Array.isArray(mat) || (mat.isShaderMaterial && !mat.userData.interior) || !g || !g.attributes.position || !g.attributes.normal || g.morphAttributes.position || g.attributes.position.isInterleavedBufferAttribute) return;
      const m4 = new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld);
      if (mat.isShaderMaterial && m4.elements.some((e, i) => Math.abs(e - (i % 5 ? 0 : 1)) > 1e-4)) return;   // cabin glass works in the vehicle's own frame: only panes already in it
      const uv = !!mat.map && !!g.attributes.uv, col = !!mat.vertexColors && !!g.attributes.color;
      if ((mat.map && !uv) || (mat.vertexColors && !col)) return;
      const cs = o.userData._cs !== undefined ? o.userData._cs : o.castShadow, fam = family(mat), k = (fam ? fam.uuid : mat.uuid) + (cs ? 1 : 0) + (o.receiveShadow ? 1 : 0) + (o.renderOrder || 0);
      let b = buckets.get(k); if (!b) buckets.set(k, b = { mat: fam || mat, fam: !!fam, cs, rs: o.receiveShadow, ro: o.renderOrder, uv, col: col || !!fam, parts: [], v: 0, i: 0 });
      const n = g.attributes.position.count; b.parts.push([o, g, m4, mat.color]); b.v += n; b.i += g.index ? g.index.count : n;
    });
    const grp = new THREE.Group(); grp.userData._far = true;
    const v = new THREE.Vector3();
    for (const b of buckets.values()) {
      if (b.parts.length < 2) continue;                       // nothing to gain: the part stays as it is
      const pos = new Float32Array(b.v * 3), nor = new Float32Array(b.v * 3), uvs = b.uv ? new Float32Array(b.v * 2) : null, cols = b.col ? new Float32Array(b.v * 3) : null, idx = new Uint32Array(b.i);
      let vo = 0, io = 0;
      for (const [o, g, m4, tint] of b.parts) {
        _n.getNormalMatrix(m4); const flip = m4.determinant() < 0;
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, cnt = P.count;
        for (let i = 0; i < cnt; i++) {
          const k = (vo + i) * 3;
          v.fromBufferAttribute(P, i).applyMatrix4(m4); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
          v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
          if (uvs) { uvs[(vo + i) * 2] = U.getX(i); uvs[(vo + i) * 2 + 1] = U.getY(i); }
          if (b.fam) { cols[k] = tint.r; cols[k + 1] = tint.g; cols[k + 2] = tint.b; }
          else if (cols) { cols[k] = C.getX(i); cols[k + 1] = C.getY(i); cols[k + 2] = C.itemSize > 2 ? C.getZ(i) : 1; }
        }
        const I = g.index && g.index.array, ni = I ? I.length : cnt, i0 = io;
        for (let i = 0; i < ni; i++) idx[io++] = (I ? I[i] : i) + vo;
        if (flip) for (let i = i0; i + 2 < io; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }   // mirrored parts keep their facing
        vo += cnt; o.userData._baked = id;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      if (cols) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, b.mat); m.castShadow = b.cs; m.receiveShadow = b.rs; m.renderOrder = b.ro; m.userData._far = true; m.userData._cs = b.cs; m.layers.set(1);
      grp.add(m);
    }
    grp.layers.set(1); c.add(grp); grp.updateMatrixWorld(true);
    ud._mg = grp; ud._mgId = id; ud._lod = undefined;
  }
  // anything that would make the merged copy wrong: a part moved or turned, was shown / hidden, or changed material
  function restHash(c) {
    let h = c.position.x * 3 + c.position.z * 7 + c.rotation.y * 11;
    c.traverse(o => {
      if (o === c || o.userData._far) return;
      const p = o.position, q = o.quaternion;
      h += (p.x + p.y * 2 + p.z * 3 + q.x * 5 + q.y * 7 + q.z * 11) * (1 + (o.id % 13)) + (o.visible ? o.id % 17 : 0) + (o.material && o.material.id ? o.material.id * 0.37 : 0) + (o.material && o.material.color ? o.material.color.r + o.material.color.g * 2 + o.material.color.b * 3 : 0);
    });
    return Math.round(h * 2000);
  }

  // ---------------------------------------------------------- cross-vehicle batches
  // Cars that have stood still for a while share one mesh per material within a 64 m cell. Cabin glass stays per car: its shader
  // needs the car's own frame. Anything that leaves rest drops out at once and the cell is rebuilt on the next frame.
  const cells = new Map(), _nb = new THREE.Matrix3(), _vb = new THREE.Vector3();
  function leaveCell(c) { const ud = c.userData, q = ud._cell; if (q) { q.vs.delete(c); q.dirty = true; ud._cell = null; } if (ud._join) { ud._join.join.delete(c); ud._join = null; } }
  function joinCell(c) {
    const ud = c.userData; if (ud._cell || ud._join) return;
    const k = Math.floor(c.position.x / 64) * 4096 + Math.floor(c.position.z / 64);
    let q = cells.get(k); if (!q) cells.set(k, q = { vs: new Set(), join: new Set(), grp: null, dirty: false, x: c.position.x, z: c.position.z });
    q.join.add(c); ud._join = q; q.dirty = true;
  }
  function rebuildCell(q, scene) {
    q.dirty = false;
    const joined = [...q.join]; q.join.clear();
    joined.forEach(c => { if (c.parent && c.userData._mg) { c.userData._join = null; c.userData._cell = q; q.vs.add(c); } else c.userData._join = null; });
    if (q.grp) { scene.remove(q.grp); q.grp.children.forEach(m => m.geometry.dispose()); q.grp = null; }
    const B = new Map();
    for (const c of q.vs) {
      c.updateMatrixWorld(true);
      for (const m of c.userData._mg.children) {
        if (m.material.isShaderMaterial) continue;
        const k = m.material.uuid + (m.userData._cs ? 1 : 0) + (m.receiveShadow ? 1 : 0) + m.renderOrder, g = m.geometry;
        let b = B.get(k); if (!b) B.set(k, b = { m, parts: [], v: 0, i: 0, uv: !!g.attributes.uv, col: !!g.attributes.color });
        b.parts.push([g, c.matrixWorld]); b.v += g.attributes.position.count; b.i += g.index.count;
      }
    }
    if (B.size) {
      q.grp = new THREE.Group(); q.grp.name = 'restBatch';
      for (const b of B.values()) {
        const pos = new Float32Array(b.v * 3), nor = new Float32Array(b.v * 3), uvs = b.uv ? new Float32Array(b.v * 2) : null, cols = b.col ? new Float32Array(b.v * 3) : null, idx = new Uint32Array(b.i);
        let vo = 0, io = 0;
        for (const [g, w] of b.parts) {
          _nb.getNormalMatrix(w); const P = g.attributes.position, N = g.attributes.normal, n = P.count, I = g.index.array;
          for (let i = 0; i < n; i++) { const k = (vo + i) * 3; _vb.fromBufferAttribute(P, i).applyMatrix4(w); pos[k] = _vb.x; pos[k + 1] = _vb.y; pos[k + 2] = _vb.z; _vb.fromBufferAttribute(N, i).applyMatrix3(_nb).normalize(); nor[k] = _vb.x; nor[k + 1] = _vb.y; nor[k + 2] = _vb.z; }
          if (uvs) uvs.set(g.attributes.uv.array, vo * 2); if (cols) cols.set(g.attributes.color.array, vo * 3);
          for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo; vo += n;
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); if (cols) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, b.m.material); m.castShadow = b.m.userData._cs; m.userData._cs = b.m.userData._cs; m.receiveShadow = b.m.receiveShadow; m.renderOrder = b.m.renderOrder; q.grp.add(m);
      }
      scene.add(q.grp);
    }
    joined.forEach(c => { c.userData._lod = undefined; setState(c, REST, !!c.userData._rs); });
  }

  function setState(c, s, shadow) {
    const ud = c.userData;
    if (s !== REST && (ud._cell || ud._join)) leaveCell(c);
    if (s === MID) {
      if (glbActive(c)) s = NEAR_NOSHADOW;
      else if (!ud._farMesh || ud._lod !== MID && ud._farMesh.userData._sig !== signature(c)) {   // (re)bake on entering mid range if the model changed
        if (ud._farMesh) { c.remove(ud._farMesh); ud._farMesh.geometry.dispose(); }
        ud._farMesh = buildFar(c); c.add(ud._farMesh);
      }
    }
    const key = s === REST ? (shadow ? 4 : 5) : s; ud._rs = shadow;
    if (ud._lod === key) return;
    ud._lod = key;
    const far = ud._farMesh, mg = ud._mg, mid = ud._mgId;
    c.traverse(o => {
      if (o.userData._far) return;
      if (!o.isMesh && !o.isSprite) return;
      if (s === REST) o.layers.set(o.userData._baked === mid ? 1 : 0);
      else o.layers.set(s === NEAR || s === NEAR_NOSHADOW || (s === MID && o.isSprite) ? 0 : 1);
      if (o.isMesh) {
        if (o.userData._cs === undefined) o.userData._cs = o.castShadow;
        o.castShadow = s === NEAR || (s === REST && shadow) ? o.userData._cs : false;
      }
    });
    if (far) far.layers.set(s === MID ? 0 : 1);
    if (mg) mg.children.forEach(m => { const own = s === REST && (!ud._cell || m.material.isShaderMaterial); m.layers.set(own ? 0 : 1); m.castShadow = own && shadow && m.userData._cs; });
  }
  // force a model back to full detail (e.g. the player is about to drive / ride it)
  function full(c) { if (c && c.userData && c.userData._lod !== undefined) setState(c, NEAR); }

  function restCrysta(c, t, T) {
    const ud = c.userData, h = restHash(c); if (h !== ud._h) { ud._h = h; ud._hT = t; }
    if (t - (ud._hT || t) > 2000) { if (!ud._mg || ud._mgH !== h) { bakeRest(c); ud._mgH = h; } setState(c, REST, true); }
    else if (ud._lod !== undefined) setState(c, NEAR);
  }
  const cp = new THREE.Vector3(), wp = new THREE.Vector3();
  let acc = 0, builds = 0, rests = 0;
  GameHooks.update.push(function (dt, G) {
    for (const q of cells.values()) if (q.dirty) { rebuildCell(q, G.scene); break; }          // at most one cell per frame
    acc += dt; if (acc < 0.2) return; acc = 0; builds = 0; rests = 0;
    const t = performance.now();
    const T = TIER[window.Quality && Quality.tier] || TIER.medium;
    G.camera.getWorldPosition(cp);
    const P = typeof Player !== 'undefined' ? Player : null, mine = P && P.active && P.active.g, body = P && P.body && P.body.group;
    for (const q of cells.values()) { for (const c of q.vs) if (!c.parent || !c.visible) { leaveCell(c); c.userData._lod = undefined; } if (q.grp) { const on = Math.hypot(q.x - cp.x, q.z - cp.z) < T.shadow + 45; q.grp.children.forEach(m => { m.castShadow = on && m.userData._cs; }); } }
    // the Crysta has no dims of its own: same at-rest merge for it, never batched, undone by the first wheel turn
    if (typeof playerCarGroup !== 'undefined' && playerCarGroup) { if (window.Cockpit && Cockpit.seated) { if (playerCarGroup.userData._lod !== undefined) setState(playerCarGroup, NEAR); playerCarGroup.userData._hT = t; } else restCrysta(playerCarGroup, t, T); }
    for (const c of G.scene.children) {
      if (!c.userData || !c.isGroup && !c.isObject3D) continue;
      const veh = hasDims(c), ped = !veh && isHuman(c);
      if (!veh && !ped) continue;
      if (c === mine || c === body) { setState(c, NEAR); continue; }
      c.getWorldPosition(wp);
      const d = Math.hypot(wp.x - cp.x, wp.z - cp.z);
      const near = veh ? T.near : T.pedNear, hide = veh ? T.veh : T.ped;
      let s = d > hide ? HIDDEN : d > near ? MID : d > T.shadow ? NEAR_NOSHADOW : NEAR;
      // cap the bakes per tick so a teleport does not stall a frame
      if (s === MID && c.userData._lod !== MID && !c.userData._farMesh) { if (builds >= 12) s = NEAR_NOSHADOW; else builds++; }
      if (veh && (s === NEAR || s === NEAR_NOSHADOW)) {
        const ud = c.userData, h = restHash(c);
        if (h !== ud._h) { ud._h = h; ud._hT = t; }
        else if (t - ud._hT > 2000) {
          if (!ud._mg || ud._mgH !== h) { if (rests < 2) { rests++; bakeRest(c); ud._mgH = h; } }
          if (ud._mg && ud._mgH === h) { setState(c, REST, s === NEAR); if (t - ud._hT > 8000) joinCell(c); continue; }
        }
      }
      setState(c, s);
    }
  });
  // compile every material that exists once all modules have built, on the start screen, instead of hitching at first sight in play
  // plus one of every vehicle and the town's material setups, which otherwise first appear while travelling
  GameHooks.init.push(g => setTimeout(() => {
    try {
      const t0 = performance.now(), root = new THREE.Group(), T = THREE, px = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), box = new T.BoxGeometry(1, 1, 1);
      for (const k in window.TrafficModels) { const f = TrafficModels[k]; if (typeof f !== 'function') continue; try { const v = f(); if (v && v.g) root.add(v.g); } catch (e) {} }
      [new T.MeshLambertMaterial({ map: px, vertexColors: true, emissiveMap: px, emissive: 0xffffff }), new T.MeshLambertMaterial({ map: px, vertexColors: true }), new T.MeshLambertMaterial({ vertexColors: true })].forEach(m => { const q = new T.Mesh(box, m); q.receiveShadow = true; root.add(q); });
      g.scene.add(root); g.renderer.compile(g.scene, g.camera); g.scene.remove(root);
      console.log('precompile:', g.renderer.info.programs.length, 'programs,', Math.round(performance.now() - t0), 'ms');
    } catch (e) { console.warn('precompile', e); }
  }, 0));
  window.ActorLOD = { full, TIER };
})();
