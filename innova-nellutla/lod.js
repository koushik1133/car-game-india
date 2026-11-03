// lod.js: distance LOD for the dynamic actors that live as top-level scene children
// (traffic / procession / multiplayer vehicles = groups with userData.dims or a child that has it,
// villagers / riders / avatars = groups holding a HumanModel).
//   near  (< NEAR m):   full model, its own meshes (wheels spin, lamps change colour, limbs swing)
//   mid   (< hide m):   one merged vertex-coloured mesh = 1 draw call, a snapshot of the current pose
//   far   (> hide m):   not drawn
// Shadows are cast only inside SHADOW m. Uses camera layers, not .visible, so it never fights the modules
// that own .visible (parked / GLB swap / hide-on-board); the shadow pass honours layers too.
(function () {
  const TIER = {
    low:    { veh: 260, ped: 90,  near: 30, pedNear: 22, shadow: 40 },
    medium: { veh: 350, ped: 140, near: 40, pedNear: 30, shadow: 60 },
    high:   { veh: 500, ped: 220, near: 55, pedNear: 40, shadow: 60 },
  };
  const NEAR = 0, NEAR_NOSHADOW = 1, MID = 2, HIDDEN = 3;
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

  function setState(c, s) {
    const ud = c.userData;
    if (s === MID) {
      if (glbActive(c)) s = NEAR_NOSHADOW;
      else if (!ud._farMesh || ud._lod !== MID && ud._farMesh.userData._sig !== signature(c)) {   // (re)bake on entering mid range if the model changed
        if (ud._farMesh) { c.remove(ud._farMesh); ud._farMesh.geometry.dispose(); }
        ud._farMesh = buildFar(c); c.add(ud._farMesh);
      }
    }
    if (ud._lod === s) return;
    ud._lod = s;
    const far = ud._farMesh;
    c.traverse(o => {
      if (o === far) return;
      if (!o.isMesh && !o.isSprite) return;
      o.layers.set(s === NEAR || s === NEAR_NOSHADOW || (s === MID && o.isSprite) ? 0 : 1);
      if (o.isMesh) {
        if (o.userData._cs === undefined) o.userData._cs = o.castShadow;
        o.castShadow = s === NEAR ? o.userData._cs : false;
      }
    });
    if (far) far.layers.set(s === MID ? 0 : 1);
  }
  // force a model back to full detail (e.g. the player is about to drive / ride it)
  function full(c) { if (c && c.userData && c.userData._lod !== undefined) setState(c, NEAR); }

  const cp = new THREE.Vector3(), wp = new THREE.Vector3();
  let acc = 0, builds = 0;
  GameHooks.update.push(function (dt, G) {
    acc += dt; if (acc < 0.2) return; acc = 0; builds = 0;
    const T = TIER[window.Quality && Quality.tier] || TIER.medium;
    G.camera.getWorldPosition(cp);
    const P = typeof Player !== 'undefined' ? Player : null, mine = P && P.active && P.active.g, body = P && P.body && P.body.group;
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
      setState(c, s);
    }
  });
  window.ActorLOD = { full, TIER };
})();
