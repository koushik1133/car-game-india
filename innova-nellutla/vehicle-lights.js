// vehicle-lights.js: headlamps off / low / high (L, Shift+L held flashes), tail, brake and reversing glow for the player and
// nearby traffic, drawn as additive decals. No real lights: the ground is one huge vertex-lit plane, so a SpotLight only
// shows wherever a vertex happens to be (the old beam floated metres ahead of the car).
// - Player: one ground grid that hugs groundY and starts at the bumper; rays find walls, the beam stops there and a splash
//   appears on the wall. Traffic: one InstancedMesh of flat beams. Rear glows: one InstancedMesh shared by everybody.
//   Lens glare: one Points cloud on the real lamp positions, sized in metres. That is at most 5 draw calls, only after dark or when the lamps are on.
window.VehicleLights = (function () {
  'use strict';
  const MAXT = 14, MAXR = 16, RAYS = 11, GLOWS = RAYS + 6, MAXH = 160, COLS = 12, ROWS = 18, BEAM = { low: { L: 40, W: 15, gain: 1.55 }, high: { L: 100, W: 22, gain: 1.5 } };
  let high = false, flash = false, G = null, frame = 0, grid = null, walls = null, halos = null, tBeams = null, rear = null;
  const hits = new Float32Array(RAYS).fill(1e3), stats = { ms: 0, player: 0, traffic: 0, rear: 0, walls: 0, calls: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), yAx = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), xAx = new THREE.Vector3(1, 0, 0);
  function beamTex(fn) {
    const w = 128, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), im = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = fn(i / (w - 1) * 2 - 1, 1 - j / (h - 1)), o = (j * w + i) * 4, a = Math.max(0, Math.min(1, v)) * 255;
      im.data[o] = a; im.data[o + 1] = a * 0.94; im.data[o + 2] = a * 0.78; im.data[o + 3] = 255;
    }
    x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // beams are sums of Gaussian lobes, so there is no edge anywhere: a hot core, a broad spill, and everything reaches zero
  // well inside the texture. Low dips and shifts left (+x, the kerb side). The texture is neutral; the tint is per model.
  const edge = (x, d) => (1 - smooth(0.8, 1, Math.abs(x))) * (1 - smooth(0.82, 1, d)) * smooth(0, 0.045, d);
  const lobe = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (w * w));
  const lowFn = (x, d) => { const c = 0.1 * d, w = 0.2 + 0.5 * Math.pow(d, 0.7), fall = Math.pow(1 - smooth(0.12, 0.95, d), 1.5);
    return edge(x, d) * fall * (0.42 * lobe(x, c, w) + 0.58 * lobe(x, c * 0.7, w * 0.42) * Math.exp(-Math.pow((d - 0.2) / 0.3, 2))); };
  const highFn = (x, d) => { const w = 0.1 + 0.34 * Math.pow(d, 0.7), fall = Math.pow(1 - d, 1.7);
    return edge(x, d) * (0.4 * lobe(x, 0, w * 1.5) * fall + 0.75 * lobe(x, 0, w * 0.4) * Math.pow(1 - d, 1.1)); };
  function glowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, '#fff'); r.addColorStop(0.35, '#777'); r.addColorStop(1, '#000'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  const add = (map, o) => new THREE.MeshBasicMaterial(Object.assign({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }, o));
  // lamp colour per model: amber-white halogen on older and utility models, whiter LED on newer ones
  const LED = /^(crysta|innova|hector|scorpioN|fortuner|landCruiser|defender|gclass|tharRoxx|thar|swiftNew|berlinetta|muscle|wedge|coupe911|hayabusa|s1000rr|r1250gsa|r1300gsa|faired)$/;
  const tintOf = ty => (LED.test(ty) ? 0xfff0dc : 0xffd29a);
  // where the lamps really are, in the vehicle frame, from their meshes: one mesh may hold both lamps, so vertices are
  // binned by side. Falls back to the box. Cached on the group.
  const _v = new THREE.Vector3(), _i = new THREE.Matrix4();
  function lampBins(g, meshes) {
    _i.copy(g.matrixWorld).invert(); const B = { L: [0, 0, 0, 0], R: [0, 0, 0, 0], C: [0, 0, 0, 0] };
    for (const m of meshes) { const P = m && m.geometry && m.geometry.attributes.position; if (!P) continue; m.updateWorldMatrix(true, false);
      const st = Math.max(1, P.count >> 7); for (let i = 0; i < P.count; i += st) { _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).applyMatrix4(_i); const b = _v.x > 0.14 ? B.L : _v.x < -0.14 ? B.R : B.C; b[0] += _v.x; b[1] += _v.y; b[2] += _v.z; b[3]++; } }
    const pt = b => ({ x: b[0] / b[3], y: b[1] / b[3], z: b[2] / b[3] }), o = [];
    if (B.L[3]) o.push(pt(B.L)); if (B.R[3]) o.push(pt(B.R));
    if (B.C[3] && (!o.length || pt(B.C).y > o[0].y + 0.3)) o.push(pt(B.C));
    return o;
  }
  function lampPoints(g, head, tail, box, two) {
    if (g._lp) return g._lp;
    g.updateWorldMatrix(true, false);
    let h = lampBins(g, head), t = lampBins(g, tail); const y = Math.max(0.55, box.y), x = two ? 0 : box.hw * 0.72;
    if (!h.length) h = two ? [{ x: 0, y, z: box.front }] : [{ x, y, z: box.front }, { x: -x, y, z: box.front }];
    if (!t.length) t = two ? [{ x: 0, y, z: box.back }] : [{ x, y, z: box.back }, { x: -x, y, z: box.back }];
    return (g._lp = { h, t });
  }
  let nh = 0;
  function halo(x, y, z, r, g, b, size) {
    if (nh >= MAXH || size < 0.02) return; const H = halos.geometry.attributes;
    H.position.setXYZ(nh, x, y, z); H.aColor.setXYZ(nh, r, g, b); H.aSize.setX(nh, size); nh++;
  }
  // the bright glare of one lamp: strongest looking into it, a small lens glow from the side, nothing from behind
  function lampHalos(g, pts, sgn, r, gc, b, size, push) {
    const e = g.matrixWorld.elements, fx = e[8] * sgn, fy = e[9] * sgn, fz = e[10] * sgn;
    for (const P of pts) {
      _v.set(P.x, P.y, P.z + sgn * push).applyMatrix4(g.matrixWorld);
      const dx = camera.position.x - _v.x, dy = camera.position.y - _v.y, dz = camera.position.z - _v.z, L = Math.hypot(dx, dy, dz) || 1, f = (dx * fx + dy * fy + dz * fz) / L; if (f < -0.05) continue;
      const k = 0.22 + 0.78 * f * f; halo(_v.x, _v.y, _v.z, r * k, gc * k, b * k, size * (0.55 + 0.45 * f));
    }
  }
  function init(scene) {
    const lowT = beamTex(lowFn), highT = beamTex(highFn), glow = glowTex();
    // player grid: unit x (-1..1), rows packed towards the bumper
    const n = (COLS + 1) * (ROWS + 1), P = new Float32Array(n * 3), U = new Float32Array(n * 2), C = new Float32Array(n * 3).fill(1), I = [];
    for (let j = 0, k = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++, k++) { U[k * 2] = i / COLS; U[k * 2 + 1] = Math.pow(j / ROWS, 1.6); }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const a = j * (COLS + 1) + i, b = a + 1, c = a + COLS + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(I);
    grid = new THREE.Mesh(g, add(lowT, { vertexColors: true })); grid.frustumCulled = false; grid.renderOrder = 4; grid.visible = false; scene.add(grid);
    const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);   // flat plane; uv v runs towards -z
    flat.translate(0, 0, -0.5); flat.rotateY(Math.PI);                       // origin at the bumper, reaching +z, u following +x
    const uv = flat.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); 
    tBeams = new THREE.InstancedMesh(flat, add(lowT, { opacity: 0.6, color: 0xffe2bc }), MAXT); tBeams.frustumCulled = false; tBeams.renderOrder = 4; tBeams.visible = false; scene.add(tBeams);
    const disc = new THREE.PlaneGeometry(1, 1); disc.rotateX(-Math.PI / 2);
    rear = new THREE.InstancedMesh(disc, add(glow), MAXR); rear.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXR * 3), 3); rear.frustumCulled = false; rear.renderOrder = 4; rear.visible = false; scene.add(rear);
    const wall = new THREE.PlaneGeometry(1, 1);
    walls = new THREE.InstancedMesh(wall, add(glow, { side: THREE.DoubleSide }), GLOWS); walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOWS * 3).fill(1), 3); walls.frustumCulled = false; walls.renderOrder = 4; walls.visible = false; scene.add(walls);
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXH * 3), 3)); hg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAXH * 3), 3)); hg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAXH), 1));
    halos = new THREE.Points(hg, new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute vec3 aColor; attribute float aSize; uniform float scale; varying vec3 c; void main(){ c=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(aSize*scale/max(0.5,-mv.z),2.0,260.0); }',
      fragmentShader: 'varying vec3 c; void main(){ float r=length(gl_PointCoord-0.5)*2.0; float a=(exp(-r*r*5.0)*0.55+exp(-r*r*45.0))*(1.0-smoothstep(0.7,1.0,r)); gl_FragColor=vec4(c*a,1.0); }' }));
    halos.frustumCulled = false; halos.renderOrder = 5; scene.add(halos);
    G = { lowT, highT };
    if (world.relevelPools) world.relevelPools(groundY);
  }
  function playerState() {
    const M = Player.mode;
    if (M === 'crysta') return { g: playerCarGroup, ty: 'crysta', head: frontHeadlights, tail: rearBrakeLights, front: 2.42, back: -2.42, hw: 0.9, y: 0.85, two: false };
    if (M !== 'vehicle' || !Player.active) return null;
    const v = Player.active, b = Player.boxOf(v), two = !!(v.p && v.p.lean);
    return { g: v.g, v, ty: v._ty || v.model, head: v.head || [], tail: v.tail || [], front: b.max.z, back: b.min.z, hw: Math.min(b.max.x, -b.min.x), y: Math.max(0.5, b.max.y * 0.42), two };
  }
  // walls and fences: rays stop the beam and leave an overlapping soft wash. Vehicles in the cone get a soft glow on the side
  // facing the lamps. Neither lights the surface properly: it is additive light laid in front of it, spilling a little.
  function updateRays(S, B, x, z, T) {
    const reach = Math.min(B.L, 48), hide = i => { m4.makeScale(0, 0, 0); walls.setMatrixAt(i, m4); };
    for (let r = 0; r < RAYS; r++) {
      const a = (r / (RAYS - 1) - 0.5) * 0.9, dx = Math.sin(carRot + a), dz = Math.cos(carRot + a); hits[r] = 1e3;
      for (let d = 1.5; d < reach; d += 1.5) { const o = { x: x + dx * d, z: z + dz * d }, c = world.collide(o, 0.25); if (!c || !c.hit) continue;
        hits[r] = d; const nx = c.nx === undefined ? -dx : c.nx, nz = c.nz === undefined ? -dz : c.nz, f = Math.pow(1 - d / reach, 1.4) * (1 - 0.5 * Math.abs(a) / 0.45), sz = 2.2 + d * 0.3;
        q.setFromAxisAngle(yAx, Math.atan2(nx, nz)); p.set(o.x + nx * 0.28, groundY(o.x, o.z) + S.y + 0.1 + d * 0.015, o.z + nz * 0.28); s.set(sz * 1.5, sz, 1); m4.compose(p, q, s); walls.setMatrixAt(r, m4);
        col.set(T).multiplyScalar(f * 0.85 * B.gain); walls.setColorAt(r, col); break; }
      if (hits[r] > 900) hide(r);
    }
    let n = RAYS; const consider = (px, pz, hw, hgt, gy) => {
      if (n >= GLOWS) return; const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz); if (d < 1 || d > reach) return;
      const a = Math.atan2(dx, dz) - carRot, aa = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); if (aa > 0.5) return;
      const u = dx / d, w = dz / d, f = Math.pow(1 - d / reach, 1.2) * (1 - aa * 1.4), o = Math.max(0.8, hw);
      q.setFromAxisAngle(yAx, Math.atan2(-u, -w)); p.set(px - u * (o + 0.25), gy + hgt * 0.5, pz - w * (o + 0.25)); s.set(o * 3.4, hgt * 1.9, 1); m4.compose(p, q, s); walls.setMatrixAt(n, m4);
      col.set(T).multiplyScalar(f * 0.8 * B.gain); walls.setColorAt(n, col); n++; };
    const skip = S.v;
    for (const L of [typeof traffic !== 'undefined' ? traffic : [], Player.parkedList || []]) for (const t of L) if (t !== skip && t.g && t.g.visible) consider(t.g.position.x, t.g.position.z, t.hw || 0.9, 1.5, t.g.position.y);
    const PK = window.Parked && Parked.vehicles; if (PK) for (const it of PK) if (!it.claimed && Math.abs(it.x - x) < 50 && Math.abs(it.z - z) < 50) consider(it.x, it.z, 0.9, 1.5, groundY(it.x, it.z));
    while (n < GLOWS) hide(n++);
    walls.instanceMatrix.needsUpdate = true; walls.instanceColor.needsUpdate = true;
  }
  function updateGrid(S, B, T, dark, x, z) {
    const P = grid.geometry.attributes.position, C = grid.geometry.attributes.color, U = grid.geometry.attributes.uv, sn = Math.sin(carRot), cs = Math.cos(carRot), W = S.two ? B.W * 0.7 : B.W;
    grid.position.set(0, 0, 0); let lift = 0.05;
    for (let k = 0; k < P.count; k++) {
      const ux = U.getX(k) * 2 - 1, d = U.getY(k) * B.L, lx = ux * W, gx = x + sn * d + cs * lx, gz = z + cs * d - sn * lx;
      P.setXYZ(k, gx, groundY(gx, gz) + lift, gz);
      const an = Math.atan2(lx, d + 0.001), r = Math.max(0, Math.min(RAYS - 1, Math.round((an / 0.9 + 0.5) * (RAYS - 1)))), v = 1 - smooth(hits[r] - 2.5, hits[r], Math.hypot(lx, d));
      C.setXYZ(k, v, v, v);
    }
    P.needsUpdate = true; C.needsUpdate = true;
    grid.material.color.set(T).multiplyScalar(B.gain * (0.3 + 0.7 * dark));
  }
  function addRear(i, x, y, z, ry, back, sz, r, g, b) {
    if (i >= MAXR) return i;
    const sn = Math.sin(ry), cs = Math.cos(ry); p.set(x + sn * (back - sz * 0.42), y + 0.055, z + cs * (back - sz * 0.42)); q.setFromAxisAngle(yAx, ry); s.set(sz * 1.5, 1, sz); m4.compose(p, q, s); rear.setMatrixAt(i, m4); col.setRGB(r, g, b); rear.setColorAt(i, col); return i + 1;
  }
  function revQuads(S) {                                     // two white reversing lamps, made once per vehicle
    if (S.g._rev) return S.g._rev;
    const g = new THREE.BufferGeometry(), x = S.hw * 0.55, w = 0.07, h = 0.05, y = S.y + 0.1, z = S.back - 0.015;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-x - w, y - h, z, -x + w, y - h, z, -x + w, y + h, z, -x - w, y + h, z, x - w, y - h, z, x + w, y - h, z, x + w, y + h, z, x - w, y + h, z], 3)); g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false })); m.visible = false; m.userData.noLOD = true; S.g.add(m); return S.g._rev = m;
  }
  function update(dt) {
    if (!G) init(scene);
    const t0 = performance.now(), dark = stars.material.opacity, S = playerState();
    const on = !!headlightsOn || flash, wantHigh = flash || (on && high), B = wantHigh ? BEAM.high : BEAM.low;
    stats.player = 0; frame++;
    if (S && on) {
      const sn = Math.sin(carRot), cs = Math.cos(carRot), x = carPos.x + sn * S.front, z = carPos.z + cs * S.front;
      const T = tintOf(S.ty); if (frame % 4 === 0) updateRays(S, B, x, z, T);
      walls.visible = true; updateGrid(S, B, T, dark, x, z);
      const t = wantHigh ? G.highT : G.lowT; if (grid.material.map !== t) grid.material.map = t;
      grid.visible = true; stats.player = 1;
    } else { grid.visible = false; walls.visible = false; }
    // rear glows and traffic beams
    let nr = 0, nb = 0; nh = 0; const hk = 0.25 + 0.75 * dark; const list = typeof traffic !== 'undefined' ? traffic : [];
    const braking = !!(inputState.brake && Math.abs(carSpeed) > 1 && !isReversing), rev = isReversing && Math.abs(carSpeed) > 0.2;
    if (S) {
      const Y = S.g.position.y, R = revQuads(S); R.visible = !!isReversing;
      if (dark > 0.25 || braking || rev) { const k = braking ? 1.2 : on ? 0.3 : 0; if (k) nr = addRear(nr, carPos.x, Y, carPos.z, carRot, S.back, S.two ? 2 : 3.6, k, 0.03 * k, 0.02 * k); if (rev) nr = addRear(nr, carPos.x, Y, carPos.z, carRot, S.back, 7, 1, 0.97, 0.88); }
      const LP = lampPoints(S.g, S.head, S.tail, S, S.two); S.g.updateWorldMatrix(true, false); col.set(tintOf(S.ty));
      if (on && !(Cockpit.seated)) lampHalos(S.g, LP.h, 1, col.r * hk, col.g * hk, col.b * hk, flash ? 3.2 : wantHigh ? 2.5 : 1.6, 0.12);
      if (braking) lampHalos(S.g, LP.t, -1, 1, 0.07, 0.04, 1.6, 0.08); else if (on && dark > 0.25) lampHalos(S.g, LP.t, -1, 0.75, 0.05, 0.03, 0.75, 0.08);
      if (rev) lampHalos(S.g, LP.t.slice(0, 2).map(q0 => ({ x: q0.x * 0.8, y: q0.y, z: q0.z })), -1, 1, 0.98, 0.92, 1.8, 0.14);
    }
    if (dark > 0.25) for (const t of list) {
      if (nb >= MAXT && nr >= MAXR) break; if (!t.g || !t.g.visible || t === (S && S.v)) continue;
      const dx = t.g.position.x - camera.position.x, dz = t.g.position.z - camera.position.z, d2 = dx * dx + dz * dz; if (d2 > 8100) continue;
      const hl = (t.len || 4) / 2, ry = t.g.rotation.y, two = (t.hw || 1) < 0.6, y = t.g.position.y;
      if (nb < MAXT) { const sn = Math.sin(ry), cs = Math.cos(ry); p.set(t.g.position.x + sn * hl, y + 0.05, t.g.position.z + cs * hl); q.setFromAxisAngle(yAx, ry); s.set(two ? 12 : 20, 1, two ? 18 : 26); m4.compose(p, q, s); tBeams.setMatrixAt(nb++, m4); }
      const bk = t.mode === 'reverse', br = t._pc !== undefined && t.cur < t._pc - dt * 0.8; t._pc = t.cur;
      nr = addRear(nr, t.g.position.x, y, t.g.position.z, ry, -hl, two ? 2 : 3.4, br ? 0.9 : 0.3, br ? 0.03 : 0.01, 0.01);
      if (d2 < 6400) { const LP = lampPoints(t.g, t.head || [], t.tail || [], { y: 0.6, hw: t.hw || 0.8, front: hl, back: -hl }, two); t.g.updateWorldMatrix(true, false); col.set(tintOf(t._ty || (t.g.userData && t.g.userData.type) || t.model));
        lampHalos(t.g, LP.h, 1, col.r * 0.9, col.g * 0.9, col.b * 0.9, 1.5, 0.12); lampHalos(t.g, LP.t, -1, br ? 1 : 0.7, 0.05, 0.03, br ? 1.5 : 0.7, 0.08); }
      if (bk) nr = addRear(nr, t.g.position.x, y, t.g.position.z, ry, -hl, 4, 0.6, 0.58, 0.5);
    }
    { const H = halos.geometry; H.setDrawRange(0, nh); H.attributes.position.needsUpdate = H.attributes.aColor.needsUpdate = H.attributes.aSize.needsUpdate = true; halos.visible = nh > 0; halos.material.uniforms.scale.value = renderer.domElement.height / renderer.getPixelRatio() * 0.72 * renderer.getPixelRatio(); }
    tBeams.count = nb; tBeams.visible = nb > 0; if (nb) tBeams.instanceMatrix.needsUpdate = true;
    rear.count = nr; rear.visible = nr > 0; if (nr) { rear.instanceMatrix.needsUpdate = true; rear.instanceColor.needsUpdate = true; }
    stats.traffic = nb; stats.rear = nr; stats.halos = nh; stats.calls = (grid.visible ? 1 : 0) + (walls.visible ? 1 : 0) + (nb ? 1 : 0) + (nr ? 1 : 0) + (nh ? 1 : 0);
    stats.ms += (performance.now() - t0 - stats.ms) * 0.1;
  }
  // L: off -> low -> high -> off
  function cycle() { if (!headlightsOn) { high = false; toggleHeadlights(); } else if (!high) high = true; else { high = false; toggleHeadlights(); } return mode(); }
  const mode = () => (headlightsOn ? (high ? 2 : 1) : 0);
  GameHooks.update.push(dt => update(dt));
  return { cycle, stats, get mode() { return mode(); }, set flash(v) { flash = !!v; }, get flash() { return flash; }, _grid: () => grid, _pts: g => g._lp };
})();
