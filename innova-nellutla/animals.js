// animals.js: village animal life for Nellutla. White zebu cows and bullocks (hump, dewlap, horns), black
// buffaloes, Indian pariah dogs, goats, hens/roosters and crows on the electric wires, plus villagers who lead
// cattle on a rope or drive a small herd with a stick (mornings and evenings).
// Rendering: every species is a handful of InstancedMeshes (torso, head, tail, upper leg, lower leg), so the whole
// module is ~30 draw calls; each animal is a tiny "skeleton" whose part matrices are composed on the CPU every frame
// (hip -> knee chains, head and tail pivots). Animals beyond LOD_R are not drawn and not simulated.
// Gaits: cattle and goats use the four-beat walk (LH, LF, RH, RF a quarter cycle apart, so diagonal pairs lead),
// dogs trot (diagonal pairs together). Phase advances with distance actually moved, so feet do not slide.
// Registers on window.GameHooks (init/update). Never edits the map: obstacles come from world.collide/insideBuilding.
(function () {
  'use strict';
  if (typeof GameHooks === 'undefined') return;

  const LOD_R = 150, RECYCLE_R = 230, TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
  const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  let G = null, world = null, scene = null;

  // ------------------------------------------------------------------ geometry kit (merged, vertex coloured)
  function Kit() { this.pos = []; this.nor = []; this.col = []; }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _n3 = new THREE.Matrix3();
  Kit.prototype.add = function (geo, hex, p, s, r) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0); _q.setFromEuler(_e);
    _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
    g.applyMatrix4(_m);
    const P = g.attributes.position, N = g.attributes.normal; _c.setHex(hex);
    for (let i = 0; i < P.count; i++) { this.pos.push(P.getX(i), P.getY(i), P.getZ(i)); this.nor.push(N.getX(i), N.getY(i), N.getZ(i)); this.col.push(_c.r, _c.g, _c.b); }
    return this;
  };
  Kit.prototype.ball = function (p, s, hex, seg, r) { return this.add(new THREE.SphereGeometry(1, seg || 10, Math.max(4, (seg || 10) * 0.7 | 0)), hex, p, s, r); };
  // tapered tube from a to b (radius ra at a, rb at b)
  Kit.prototype.tube = function (a, b, ra, rb, hex, seg) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    const g = new THREE.CylinderGeometry(rb, ra, L, seg || 8); g.translate(0, L / 2, 0);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const gg = g.toNonIndexed(); gg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(_q)); gg.translate(a[0], a[1], a[2]);
    return this.add(gg, hex, [0, 0, 0]);
  };
  Kit.prototype.geo = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); return g;
  };
  const W = 0xffffff;   // coat parts are white in the vertex colours and tinted per instance

  // ------------------------------------------------------------------ species rigs
  // Each rig: torso/head/tail/upper/lower geometries, pivots (rest pose, +z forward), leg hips and segment length.
  function cattleRig(kind) {   // 'cow' | 'bull' | 'buffalo'
    const buf = kind === 'buffalo', bull = kind === 'bull';
    const T = new Kit(), H = new Kit(), Tl = new Kit(), U = new Kit(), Lw = new Kit();
    const bw = buf ? 1.15 : 1, hip = buf ? 0.8 : 0.84;
    // lean zebu frame instead of one big egg: narrow deep chest, tucked flank, hook and pin bones, a spine line. The
    // coat tint multiplies these greys, so the belly, neck and joints read as form even on a white animal in sun.
    const SH = buf ? 0xc8c8c8 : 0xcfcabf, SH2 = buf ? 0xa8a8a8 : 0xb4aea3, HOOF = 0x1c1a18;
    T.ball([0, 1.06, 0.3], [0.235 * bw, 0.33, 0.5], W, 14);                               // ribcage, deep at the brisket
    T.ball([0, 1.09, -0.08], [0.24 * bw, 0.27, 0.68], W, 14);                               // barrel, drawn up at the flank
    T.ball([0, 0.86, 0.2], [0.17 * bw, 0.13, 0.42], SH, 10);                                // underline in shade
    T.ball([0, 1.13, -0.5], [0.215 * bw, 0.25, 0.36], W, 12);                               // rump
    T.tube([0, 1.36, 0.3], [0, 1.33, -0.62], 0.05, 0.05, W, 6);                             // spine
    T.tube([0, 1.34, -0.62], [0, 1.16, -0.86], 0.05, 0.035, W, 6);                          // slope to the tail head
    for (const sx of [-1, 1]) {
      T.ball([sx * 0.14 * bw, 1.25, -0.4], [0.065, 0.06, 0.13], W, 7);                       // hook bone
      T.ball([sx * 0.09 * bw, 1.17, -0.8], [0.06, 0.07, 0.07], W, 6);                      // pin bone
      T.ball([sx * 0.17 * bw, 1.0, 0.5], [0.09, 0.26, 0.15], W, 8);                         // shoulder blade
      T.ball([sx * 0.16 * bw, 1.0, -0.55], [0.1, 0.27, 0.2], W, 8);                         // thigh
    }
    if (!buf) {
      T.ball([0, 1.33, 0.46], bull ? [0.12, 0.27, 0.22] : [0.09, 0.2, 0.17], W, 9, [-0.3, 0, 0]);   // zebu hump leaning back
      for (let i = 0; i < 4; i++) T.ball([0, 0.92 - i * 0.04 + (i === 0 ? 0.12 : 0), 0.82 - i * 0.14], [0.035, (bull ? 0.25 : 0.19) - i * 0.03, 0.12], SH, 6);   // dewlap: thin hanging sheet
    } else T.ball([0, 0.8, -0.34], [0.09, 0.07, 0.13], SH2, 7);                             // udder
    // head (pivot at the neck root): neck, long narrow face, darker muzzle
    H.tube([0, -0.04, -0.14], [0, 0.04, 0.36], buf ? 0.21 : 0.17, buf ? 0.13 : 0.095, W, 10);
    H.tube([0, 0.1, 0.34], [0, -0.3, 0.72], buf ? 0.125 : 0.105, buf ? 0.095 : 0.068, W, 9);    // face sloping down
    H.ball([0, 0.1, 0.34], [0.115 * bw, 0.1, 0.12], W, 8);                                      // poll
    H.ball([0, -0.31, 0.74], [buf ? 0.1 : 0.075, 0.065, 0.075], buf ? 0x6a6560 : 0x4a3e36, 8);  // muzzle
    H.ball([0, -0.24, 0.68], [0.078, 0.05, 0.07], SH, 6);
    for (const sx of [-1, 1]) {
      H.ball([sx * 0.095, 0.02, 0.5], [0.024, 0.026, 0.026], 0x0b0b0b, 5);                      // eyes
      H.ball([sx * 0.092, 0.03, 0.49], [0.04, 0.04, 0.05], SH2, 5);                             // dark eye socket
      H.ball([sx * (buf ? 0.21 : 0.2), 0.02, 0.33], [0.12, 0.028, 0.055], SH, 6, [0, sx * 0.25, sx * -0.5]);   // ears, drooping
      if (buf) {   // crescent horns swept back and down
        H.tube([sx * 0.08, 0.18, 0.32], [sx * 0.28, 0.21, 0.2], 0.05, 0.04, 0x3a3532, 6);
        H.tube([sx * 0.28, 0.21, 0.2], [sx * 0.34, 0.13, 0.0], 0.04, 0.015, 0x3a3532, 6);
      } else {     // zebu: long, upturned, slightly outward
        H.tube([sx * 0.07, 0.18, 0.31], [sx * 0.16, 0.34, 0.27], 0.036, bull ? 0.026 : 0.02, 0x9c8f80, 6);
        H.tube([sx * 0.16, 0.34, 0.27], [sx * 0.17, 0.52, 0.2], bull ? 0.026 : 0.02, 0.006, 0x4a4238, 6);
      }
    }
    // tail (pivot at the tail head), switch at the tip
    Tl.tube([0, 0, 0], [0, -0.72, -0.06], 0.03, 0.015, W, 5); Tl.ball([0, -0.82, -0.06], [0.05, 0.14, 0.05], 0x1c1a18, 6);
    // legs: muscled top narrowing fast to thin bone, a knee knob, cannon, pastern and split-looking hoof
    U.ball([0, 0.0, 0], [buf ? 0.095 : 0.08, 0.17, 0.11], W, 7); U.tube([0, 0.04, 0], [0, -0.42, 0], buf ? 0.085 : 0.07, 0.036, W, 8);
    Lw.ball([0, 0, 0], [0.05, 0.058, 0.055], SH, 6); Lw.tube([0, 0, 0], [0, -0.33, 0], 0.033, 0.028, SH, 6);
    Lw.ball([0, -0.34, 0], [0.037, 0.035, 0.04], SH2, 5); Lw.add(new THREE.CylinderGeometry(0.036, 0.052, 0.08, 7), HOOF, [0, -0.4, 0.008]);
    const lx = 0.17 * bw;
    return { torso: T.geo(), head: H.geo(), tail: Tl.geo(), upper: U.geo(), lower: Lw.geo(), Lu: 0.42,
      headP: [0, 1.16, 0.74], tailP: [0, 1.2, -0.8], hips: [[-lx, hip, 0.52, 1], [lx, hip, 0.52, 1], [-lx, hip, -0.55, 0], [lx, hip, -0.55, 0]],
      hipY: hip, stride: 1.1, r: 0.9, len: 1.2, castShadow: true };
  }
  function dogRig() {
    const T = new Kit(), H = new Kit(), Tl = new Kit(), U = new Kit(), Lw = new Kit();
    T.ball([0, 0.5, 0], [0.12, 0.13, 0.3], W, 10); T.ball([0, 0.53, 0.2], [0.12, 0.14, 0.14], W, 8);
    T.ball([0, 0.47, 0.06], [0.08, 0.06, 0.18], 0xf2e8da, 6);                                // pale belly
    H.tube([0, 0, 0], [0, 0.1, 0.12], 0.07, 0.06, W, 7);
    H.ball([0, 0.12, 0.15], [0.085, 0.08, 0.09], W, 8);
    H.tube([0, 0.1, 0.2], [0, 0.07, 0.33], 0.045, 0.028, W, 7); H.ball([0, 0.075, 0.335], [0.022, 0.02, 0.02], 0x111111, 5);   // snout, nose
    for (const sx of [-1, 1]) {
      H.add(new THREE.ConeGeometry(0.035, 0.09, 4), W, [sx * 0.05, 0.22, 0.13], [1, 1, 0.5], [0, 0, -sx * 0.25]);   // erect ears
      H.ball([sx * 0.045, 0.14, 0.225], [0.012, 0.012, 0.012], 0x0b0b0b, 4);
    }
    Tl.tube([0, 0, 0], [0, 0.14, -0.1], 0.025, 0.02, W, 5); Tl.tube([0, 0.14, -0.1], [0, 0.2, 0.02], 0.02, 0.012, W, 5);   // sickle tail
    U.tube([0, 0.02, 0], [0, -0.22, 0], 0.035, 0.026, W, 6);
    Lw.tube([0, 0, 0], [0, -0.22, 0], 0.022, 0.02, W, 5); Lw.ball([0, -0.23, 0.02], [0.025, 0.015, 0.035], W, 5);
    return { torso: T.geo(), head: H.geo(), tail: Tl.geo(), upper: U.geo(), lower: Lw.geo(), Lu: 0.22,
      headP: [0, 0.6, 0.3], tailP: [0, 0.56, -0.3], hips: [[-0.07, 0.45, 0.22, 1], [0.07, 0.45, 0.22, 1], [-0.07, 0.46, -0.24, 0], [0.07, 0.46, -0.24, 0]],
      hipY: 0.45, stride: 0.75, r: 0.35, len: 0.5, castShadow: true };
  }
  function catRig() {        // slim village cat: small head, pointed ears, long curving tail
    const T = new Kit(), H = new Kit(), Tl = new Kit(), U = new Kit(), Lw = new Kit();
    T.ball([0, 0.27, 0], [0.075, 0.08, 0.19], W, 9); T.ball([0, 0.28, 0.12], [0.075, 0.085, 0.09], W, 7);
    H.ball([0, 0.06, 0.06], [0.06, 0.055, 0.058], W, 8); H.ball([0, 0.04, 0.11], [0.03, 0.025, 0.025], W, 6);
    H.ball([0, 0.045, 0.135], [0.008, 0.007, 0.006], 0x3a1a1a, 4);
    for (const sx of [-1, 1]) {
      H.add(new THREE.ConeGeometry(0.022, 0.05, 4), W, [sx * 0.035, 0.115, 0.05], [1, 1, 0.6], [0, 0, -sx * 0.2]);
      H.ball([sx * 0.025, 0.075, 0.105], [0.01, 0.012, 0.006], 0x9acd32, 4);
    }
    Tl.tube([0, 0, 0], [0, 0.12, -0.12], 0.016, 0.013, W, 5); Tl.tube([0, 0.12, -0.12], [0, 0.26, -0.1], 0.013, 0.01, W, 5);
    U.tube([0, 0.01, 0], [0, -0.12, 0], 0.022, 0.016, W, 5);
    Lw.tube([0, 0, 0], [0, -0.12, 0], 0.014, 0.012, W, 5); Lw.ball([0, -0.125, 0.01], [0.016, 0.01, 0.02], W, 4);
    return { torso: T.geo(), head: H.geo(), tail: Tl.geo(), upper: U.geo(), lower: Lw.geo(), Lu: 0.12,
      headP: [0, 0.32, 0.18], tailP: [0, 0.3, -0.18], hips: [[-0.04, 0.24, 0.12, 1], [0.04, 0.24, 0.12, 1], [-0.04, 0.25, -0.14, 0], [0.04, 0.25, -0.14, 0]],
      hipY: 0.24, stride: 0.4, r: 0.2, len: 0.3, castShadow: false };
  }
  function goatRig() {
    const T = new Kit(), H = new Kit(), Tl = new Kit(), U = new Kit(), Lw = new Kit();
    T.ball([0, 0.56, 0], [0.14, 0.16, 0.32], W, 10); T.ball([0, 0.6, 0.2], [0.13, 0.16, 0.15], W, 8);
    H.tube([0, 0, 0], [0, 0.14, 0.1], 0.07, 0.055, W, 7);
    H.tube([0, 0.16, 0.08], [0, 0.04, 0.26], 0.06, 0.035, W, 7);
    for (const sx of [-1, 1]) {
      H.ball([sx * 0.08, 0.1, 0.12], [0.07, 0.02, 0.035], W, 5, [0, sx * 0.3, sx * 0.9]);     // drooping ears
      H.tube([sx * 0.03, 0.2, 0.1], [sx * 0.05, 0.3, -0.02], 0.016, 0.006, 0x3d3530, 5);     // small horns back
      H.ball([sx * 0.045, 0.14, 0.17], [0.012, 0.012, 0.012], 0x0b0b0b, 4);
    }
    H.tube([0, 0.02, 0.22], [0, -0.06, 0.22], 0.012, 0.004, 0x2a2420, 4);                    // beard
    Tl.tube([0, 0, 0], [0, 0.1, -0.06], 0.025, 0.012, W, 5);
    U.tube([0, 0.02, 0], [0, -0.25, 0], 0.035, 0.025, W, 6);
    Lw.tube([0, 0, 0], [0, -0.25, 0], 0.02, 0.018, W, 5); Lw.add(new THREE.CylinderGeometry(0.02, 0.025, 0.03, 5), 0x2a2420, [0, -0.26, 0]);
    return { torso: T.geo(), head: H.geo(), tail: Tl.geo(), upper: U.geo(), lower: Lw.geo(), Lu: 0.25,
      headP: [0, 0.66, 0.3], tailP: [0, 0.66, -0.3], hips: [[-0.08, 0.51, 0.2, 1], [0.08, 0.51, 0.2, 1], [-0.08, 0.52, -0.22, 0], [0.08, 0.52, -0.22, 0]],
      hipY: 0.51, stride: 0.75, r: 0.35, len: 0.5, castShadow: true };
  }
  function henRig() {
    const T = new Kit(), H = new Kit(), Tl = new Kit(), U = new Kit(), Lw = new Kit();
    T.ball([0, 0.26, 0], [0.11, 0.12, 0.16], W, 8); T.ball([0, 0.3, 0.09], [0.085, 0.1, 0.08], W, 6);
    for (const sx of [-1, 1]) T.ball([sx * 0.095, 0.27, -0.01], [0.03, 0.08, 0.12], W, 6);     // folded wings
    H.tube([0, 0, 0], [0, 0.08, 0.03], 0.045, 0.04, W, 6); H.ball([0, 0.1, 0.04], [0.045, 0.05, 0.05], W, 6);
    H.add(new THREE.ConeGeometry(0.014, 0.05, 4), 0xe0a020, [0, 0.09, 0.1], [1, 1, 1], [Math.PI / 2, 0, 0]);   // beak
    H.ball([0, 0.16, 0.04], [0.012, 0.035, 0.04], 0xc41a1a, 5); H.ball([0, 0.06, 0.08], [0.01, 0.022, 0.012], 0xc41a1a, 4);   // comb, wattle
    for (const sx of [-1, 1]) H.ball([sx * 0.03, 0.11, 0.07], [0.007, 0.007, 0.007], 0x0b0b0b, 4);
    Tl.add(new THREE.ConeGeometry(0.06, 0.18, 5), W, [0, 0.07, -0.02], [0.5, 1, 1], [-0.5, 0, 0]);
    U.tube([0, 0, 0], [0, -0.1, 0], 0.012, 0.009, 0xd9a520, 4);
    Lw.tube([0, 0, 0], [0, -0.06, 0.01], 0.008, 0.007, 0xd9a520, 4); Lw.add(new THREE.BoxGeometry(0.05, 0.008, 0.05), 0xd9a520, [0, -0.065, 0.015]);
    return { torso: T.geo(), head: H.geo(), tail: Tl.geo(), upper: U.geo(), lower: Lw.geo(), Lu: 0.1,
      headP: [0, 0.34, 0.12], tailP: [0, 0.32, -0.13], hips: [[-0.04, 0.17, 0, 1], [0.04, 0.17, 0, 1]],
      hipY: 0.17, stride: 0.22, r: 0.15, len: 0.25, castShadow: false, biped: true };
  }
  function crowGeo() {
    const K = new Kit(), B = 0x1a1a1c, Gy = 0x55565a;
    K.ball([0, 0.1, 0], [0.06, 0.065, 0.12], B, 7); K.ball([0, 0.16, 0.08], [0.045, 0.05, 0.05], Gy, 6);
    K.add(new THREE.ConeGeometry(0.014, 0.06, 4), B, [0, 0.155, 0.14], [1, 1, 1], [Math.PI / 2, 0, 0]);
    K.add(new THREE.BoxGeometry(0.05, 0.01, 0.13), B, [0, 0.08, -0.14], [1, 1, 1], [0.3, 0, 0]);
    for (const sx of [-1, 1]) K.tube([sx * 0.02, 0.05, 0.0], [sx * 0.02, 0, 0.01], 0.006, 0.006, 0x222222, 3);
    return K.geo();
  }

  // ------------------------------------------------------------------ instanced species
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function Species(rig, cap) {
    this.rig = rig; this.cap = cap; this.list = [];
    const nl = rig.hips.length;
    const mk = (g, n, sh) => { const m = new THREE.InstancedMesh(g, mat, n); m.setColorAt(0, _c.setHex(W));   // before count = 0: r128 sizes instanceColor by count
      m.count = 0; m.frustumCulled = false; m.castShadow = !!sh; m.receiveShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
    this.m = { torso: mk(rig.torso, cap, rig.castShadow), head: mk(rig.head, cap, rig.castShadow), tail: mk(rig.tail, cap), upper: mk(rig.upper, cap * nl), lower: mk(rig.lower, cap * nl) };
  }
  const R = new THREE.Matrix4(), M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Mr = new THREE.Matrix4(), white = new THREE.Color(1, 1, 1);
  const rotXYZ = (m, x, y, z) => { _e.set(x, y, z, 'YXZ'); return m.makeRotationFromEuler(_e); };
  Species.prototype.draw = function (cam) {
    const r = this.rig, m = this.m, nl = r.hips.length; let n = 0;
    for (const a of this.list) {
      if (!a.vis) continue;
      const P = a.pose, sc = a.scale;
      _q.setFromAxisAngle(_v.set(0, 1, 0), a.yaw);
      R.compose(_v.set(a.x, a.y + P.bodyY, a.z), _q, _s.set(sc, sc, sc));
      R.multiply(Mr.makeTranslation(0, r.hipY, 0)).multiply(rotXYZ(Mt, P.pitch, 0, P.roll)).multiply(Mr.makeTranslation(0, -r.hipY, 0));
      m.torso.setMatrixAt(n, R); m.torso.setColorAt(n, a.coat);
      M1.copy(R).multiply(Mr.makeTranslation(r.headP[0], r.headP[1], r.headP[2])).multiply(rotXYZ(Mt, P.headX, P.headY, P.headZ || 0));
      m.head.setMatrixAt(n, M1); m.head.setColorAt(n, r.headUntinted ? white : a.coat);
      M1.copy(R).multiply(Mr.makeTranslation(r.tailP[0], r.tailP[1], r.tailP[2])).multiply(rotXYZ(Mt, P.tailX, 0, P.tailZ));
      m.tail.setMatrixAt(n, M1); m.tail.setColorAt(n, a.coat);
      for (let i = 0; i < nl; i++) {
        const h = r.hips[i], L = P.legs[i], k = n * nl + i;
        M1.copy(R).multiply(Mr.makeTranslation(h[0], h[1], h[2])).multiply(rotXYZ(Mt, L[0], 0, L[2] || 0));
        m.upper.setMatrixAt(k, M1); m.upper.setColorAt(k, r.biped ? white : a.coat);
        M2.copy(M1).multiply(Mr.makeTranslation(0, -r.Lu, 0)).multiply(rotXYZ(Mt, L[1], 0, 0));
        m.lower.setMatrixAt(k, M2); m.lower.setColorAt(k, r.biped ? white : a.coat);
      }
      n++;
    }
    for (const k in m) {
      const mm = m[k]; mm.count = k === 'upper' || k === 'lower' ? n * nl : n;
      mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
    }
  };

  // ------------------------------------------------------------------ poses
  function newPose(nl) { const L = []; for (let i = 0; i < nl; i++) L.push([0, 0, 0]); return { bodyY: 0, pitch: 0, roll: 0, headX: 0, headY: 0, headZ: 0, tailX: 0.15, tailZ: 0, legs: L }; }
  // gait: 'walk' (four-beat: LH 0, LF .25, RH .5, RF .75) or 'trot' (diagonals together). k = 0..1 blend from stand.
  const WALK_OFF = [0.25, 0.75, 0.0, 0.5], TROT_OFF = [0.0, 0.5, 0.5, 0.0], HOP_OFF = [0, 0.5];
  function gaitPose(a, k, trot) {
    const P = a.pose, r = a.sp.rig, ph = a.phase, nl = r.hips.length, amp = (trot ? 0.5 : 0.36) * k;
    for (let i = 0; i < nl; i++) {
      const off = nl === 2 ? HOP_OFF[i] : (trot ? TROT_OFF : WALK_OFF)[i], q = (ph + off) * TAU, s = Math.sin(q), c = Math.cos(q);
      const front = r.hips[i][3];
      // swing: leg moves forward (negative x rotation) while lifted; the knee (front) / hock (hind) folds during swing
      P.legs[i][0] = -s * amp;
      const lift = Math.max(0, c) * k;
      P.legs[i][1] = front ? lift * (trot ? 1.1 : 0.8) : -lift * (trot ? 0.9 : 0.55) + 0.12 * k;
      if (!front) P.legs[i][0] += lift * 0.25;
      P.legs[i][2] = 0;
    }
    const b = Math.sin(ph * TAU * 2);
    P.bodyY = -Math.abs(b) * 0.02 * k * (trot ? 1.5 : 1);
    P.roll = Math.sin(ph * TAU) * 0.035 * k; P.pitch = b * 0.01 * k;
    P.headX = a.headBase + Math.sin(ph * TAU * 2 + 0.6) * (trot ? 0.05 : 0.09) * k;     // head nods twice a cycle
    P.headY = 0;
  }
  function standPose(a, t) {
    const P = a.pose, nl = P.legs.length;
    for (let i = 0; i < nl; i++) { P.legs[i][0] = 0; P.legs[i][1] = 0; P.legs[i][2] = 0; }
    const br = Math.sin(t * 1.3 + a.seed) * 0.006;
    P.bodyY = br; P.pitch = 0; P.roll = Math.sin(t * 0.3 + a.seed) * 0.01;
    P.headY = Math.sin(t * 0.21 + a.seed) * 0.35 * Math.sin(t * 0.07 + a.seed * 3);
  }
  function liePose(a, t, curl) {
    const P = a.pose, r = a.sp.rig, nl = P.legs.length;
    P.bodyY = -r.hipY * (r.biped ? 0.55 : 0.62); P.pitch = 0; P.roll = curl ? 0.25 : 0.06;
    for (let i = 0; i < nl; i++) { const f = r.hips[i][3]; P.legs[i][0] = f ? -1.35 : 1.45; P.legs[i][1] = f ? 2.6 : -2.6; P.legs[i][2] = (i % 2 ? -1 : 1) * 0.25; }
    P.headX = curl ? 0.6 : 0.1 + Math.sin(t * 0.4 + a.seed) * 0.05; P.headY = curl ? 0.9 : Math.sin(t * 0.15 + a.seed) * 0.5;
    P.tailX = 0.9; P.tailZ = curl ? 0.9 : 0;
  }
  function tail(a, t, speed) {
    const P = a.pose;
    if (a.kind === 'dog') { P.tailX = speed > 0.3 ? -0.2 : 0; P.tailZ = Math.sin(t * (a.wag ? 14 : 2) + a.seed) * (a.wag ? 0.5 : 0.1); return; }
    if (a.kind === 'cat') { P.tailX = speed > 0.3 ? 0.3 : 0.1; P.tailZ = Math.sin(t * 1.5 + a.seed) * 0.3; return; }
    if (a.kind === 'goat' || a.kind === 'hen') { P.tailX = 0; P.tailZ = Math.sin(t * 6 + a.seed) * 0.15 * (Math.sin(t * 0.7 + a.seed) > 0.6 ? 1 : 0); return; }
    // cattle: lazy swish with bursts (flies)
    const burst = Math.max(0, Math.sin(t * 0.37 + a.seed * 5)) ** 4;
    P.tailX = 0.08 + speed * 0.05; P.tailZ = Math.sin(t * 2.2 + a.seed) * (0.08 + burst * 0.5);
  }

  // ------------------------------------------------------------------ places (roadsides, fields, house walls)
  let segs = [], segGrid = new Map(); const SG = 60;
  const gk = (x, z) => Math.floor(x / SG) + ',' + Math.floor(z / SG);
  function indexRoads() {
    for (const r of world.roads || []) {
      if (!['cc', 'lane', 'dirt', 'tar'].includes(r.t)) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 3) continue;
        const s = { a, b, L, w: r.w || 4, t: r.t, r }; segs.push(s);
        const k = gk((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); (segGrid.get(k) || segGrid.set(k, []).get(k)).push(s);
      }
    }
  }
  function segsNear(x, z, R, types) {
    const out = [], n = Math.ceil(R / SG), cx = Math.floor(x / SG), cz = Math.floor(z / SG);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const s of segGrid.get((cx + i) + ',' + (cz + j)) || []) if (!types || types.includes(s.t)) out.push(s);
    return out;
  }
  const tq = { x: 0, z: 0 };
  function blocked(x, z, r) {
    tq.x = x; tq.z = z; const c = world.collide(tq, r);
    if ((c && c.hit) || Math.hypot(tq.x - x, tq.z - z) > 0.01) return true;
    return !!(world.insideBuilding && world.insideBuilding(x, z, r * 0.5));
  }
  const ground = (x, z) => (typeof groundY === 'function' ? groundY(x, z) : 0);
  function ringOk(x, z, p, rMin, rMax) { const d = Math.hypot(x - p.x, z - p.z); return d >= rMin && d <= rMax; }
  // a spot beside a road (off the carriageway by `out` metres), between rMin and rMax from p
  function roadside(p, rMin, rMax, types, out) {
    const S = segsNear(p.x, p.z, rMax, types); if (!S.length) return null;
    for (let tries = 0; tries < 20; tries++) {
      const s = pick(S), t = Math.random(), ux = (s.b[0] - s.a[0]) / s.L, uz = (s.b[1] - s.a[1]) / s.L, side = Math.random() < 0.5 ? 1 : -1;
      const o = s.w / 2 + (out === undefined ? rnd(0.8, 4) : out);
      const x = s.a[0] + ux * s.L * t - uz * o * side, z = s.a[1] + uz * s.L * t + ux * o * side;
      if (!ringOk(x, z, p, rMin, rMax) || blocked(x, z, 0.8)) continue;
      return { x, z, yaw: Math.atan2(ux, uz) + (Math.random() < 0.5 ? 0 : Math.PI), seg: s };
    }
    return null;
  }
  function inField(p, rMin, rMax) {
    const F = (world.fields || []).filter(f => f.c !== 6 && ringOk(f.cx, f.cz, p, rMin - 40, rMax + 40) && f.area > 300);
    for (let tries = 0; tries < 15 && F.length; tries++) {
      const f = pick(F), x = rnd(f.x0, f.x1), z = rnd(f.z0, f.z1);
      if (world.fieldAt && world.fieldAt(x, z) !== f) continue;
      if (!ringOk(x, z, p, rMin, rMax) || blocked(x, z, 1)) continue;
      return { x, z, yaw: rnd(-Math.PI, Math.PI), field: f };
    }
    return null;
  }
  function byHouse(p, rMin, rMax) {
    const B = world.buildings || [];
    for (let tries = 0; tries < 30; tries++) {
      const b = B[Math.random() * B.length | 0]; if (!b || !b.p || !b.p.length) continue;
      const q = b.p[0]; if (!ringOk(q[0], q[1], p, rMin - 10, rMax + 10)) continue;
      const i = Math.random() * b.p.length | 0, A = b.p[i], C = b.p[(i + 1) % b.p.length], t = rnd(0.2, 0.8);
      const mx = A[0] + (C[0] - A[0]) * t, mz = A[1] + (C[1] - A[1]) * t, L = Math.hypot(C[0] - A[0], C[1] - A[1]) || 1;
      for (const sd of [1, -1]) {
        const x = mx + (C[1] - A[1]) / L * 1.4 * sd, z = mz - (C[0] - A[0]) / L * 1.4 * sd;
        if (!blocked(x, z, 0.5) && ringOk(x, z, p, rMin, rMax)) return { x, z, yaw: Math.atan2(C[0] - A[0], C[1] - A[1]) };
      }
    }
    return null;
  }
  // tries the random search near the player, then anywhere in a wider ring (and never throws)
  function findSpot(fn, p, rMin, rMax, ...rest) { return fn(p, rMin, rMax, ...rest) || fn(p, rMin, rMax * 1.6, ...rest); }

  // nearest road segment to (x,z) within R: { s, t, d, ux, uz, nx, nz } (n = unit normal pointing to the animal's side)
  function nearestRoad(x, z, R, types) {
    let best = null;
    for (const s of segsNear(x, z, R, types)) {
      const ux = (s.b[0] - s.a[0]) / s.L, uz = (s.b[1] - s.a[1]) / s.L;
      const t = Math.max(0, Math.min(s.L, (x - s.a[0]) * ux + (z - s.a[1]) * uz));
      const px = s.a[0] + ux * t, pz = s.a[1] + uz * t, d = Math.hypot(x - px, z - pz);
      if (d < R && (!best || d < best.d)) { const side = (x - px) * -uz + (z - pz) * ux >= 0 ? 1 : -1; best = { s, t, d, ux, uz, px, pz, nx: -uz * side, nz: ux * side }; }
    }
    return best;
  }
  // a target across the nearest road (dogs/cats) or standing on the carriageway (cattle)
  function roadTarget(a, across) {
    const n = nearestRoad(a.x, a.z, 25, ['cc', 'lane', 'dirt', 'tar']); if (!n) return false;
    const along = rnd(-6, 6), off = across ? -(n.s.w / 2 + rnd(1, 3)) : rnd(-n.s.w * 0.3, n.s.w * 0.3);
    const x = n.px + n.ux * along + n.nx * off, z = n.pz + n.uz * along + n.nz * off;
    if (blocked(x, z, a.sp.rig.r)) return false;
    a.tx = x; a.tz = z; return true;
  }

  // ------------------------------------------------------------------ animals
  const COATS = {
    cow: [0xf2efe8, 0xe9e4da, 0xdcd6cc, 0xd0c8bc, 0xefe8dc],
    bull: [0xe6e1d8, 0xc9c3ba, 0xb0aaa2, 0xd8d2c8],
    buffalo: [0x2a2826, 0x232120, 0x302c29],
    dog: [0xc8945a, 0xb07a44, 0xd8ac72, 0x6a4a30, 0x2a2624, 0xe0c49a],
    goat: [0x1d1b1a, 0x2a2624, 0x6b4a32, 0x8a6240, 0xe8e2d8, 0x3a3029],
    cat: [0x2a2624, 0xd08a40, 0xe8e2d8, 0x8a8078, 0x6a4a30, 0xc8a070],
    hen: [0x8a4a22, 0xa65e2a, 0xe8e0d0, 0x3a2a20, 0x6a3a1c],
  };
  const all = [];
  function spawnAnimal(kind, sp, at, role) {
    const a = { kind, sp, x: at.x, z: at.z, y: ground(at.x, at.z), yaw: at.yaw || 0, seed: Math.random() * 100, phase: Math.random(),
      pose: newPose(sp.rig.hips.length), coat: new THREE.Color(pick(COATS[kind])), scale: 1, vis: false, state: 'stand', timer: rnd(2, 10),
      tx: at.x, tz: at.z, speed: 0, vx: 0, vz: 0, role: role || 'free', headBase: 0.05, home: { x: at.x, z: at.z }, field: at.field, scared: 0, bump: 0 };
    if (kind === 'bull') a.scale = rnd(1.08, 1.16); else if (kind === 'cow') a.scale = rnd(0.9, 1.0); else if (kind === 'buffalo') a.scale = rnd(0.95, 1.05);
    else if (kind === 'dog') a.scale = rnd(0.9, 1.08); else if (kind === 'cat') a.scale = rnd(0.85, 1.05); else if (kind === 'goat') a.scale = rnd(0.85, 1.05);
    else if (kind === 'hen') { a.rooster = Math.random() < 0.2; a.scale = a.rooster ? 1.25 : rnd(0.9, 1.0); if (a.rooster) a.coat.setHex(0x9a3a14); }
    sp.list.push(a); all.push(a); return a;
  }
  // an animal kept in a pen (safehouse2.js back plot): never recycled, stays within r of (x, z)
  window.PenAnimal = (kind, x, z, r) => { if (!SP || !SP[kind]) return null; const a = spawnAnimal(kind, SP[kind], { x, z, yaw: rnd(-3, 3) }); a.pen = r; return a; };
  function respawnFree(a, p, rMin, rMax) {
    let at = null;
    if (a.kind === 'hen') at = findSpot(byHouse, p, rMin, rMax);
    else if (a.kind === 'cat') at = Math.random() < 0.6 ? findSpot(byHouse, p, rMin, rMax) : findSpot(roadside, p, rMin, rMax, ['cc', 'lane', 'dirt'], rnd(0.3, 2));
    else if (a.kind === 'dog') at = Math.random() < 0.5 ? findSpot(byHouse, p, rMin, rMax) : findSpot(roadside, p, rMin, rMax, ['cc', 'lane']);
    else if (a.kind === 'goat') at = findSpot(roadside, p, rMin, rMax, ['dirt', 'lane'], rnd(2, 8));
    else at = (Math.random() < 0.55 && findSpot(inField, p, rMin, rMax)) || findSpot(roadside, p, rMin, rMax, ['dirt', 'lane', 'cc'], rnd(1, 5));
    if (!at) return false;
    a.x = a.tx = a.home.x = at.x; a.z = a.tz = a.home.z = at.z; a.yaw = at.yaw || rnd(-3, 3); a.y = ground(a.x, a.z); a.field = at.field;
    a.state = (a.kind === 'dog' || a.kind === 'cat') && Math.random() < 0.5 ? 'lie' : (a.kind !== 'hen' && Math.random() < 0.25 ? 'lie' : 'graze'); a.timer = rnd(4, 20);
    return true;
  }

  // ------------------------------------------------------------------ herds (villager + cattle/goats) and rope leads
  const herds = [];
  let ropeGeo = null, ropeLine = null;
  function makeHerder(stick) {
    if (typeof HumanModel === 'undefined') return null;
    let ap; try { ap = HumanModel.randomAppearance('m'); } catch (e) { ap = { gender: 'm' }; }
    ap = Object.assign(ap, { bottom: pick(['lungi', 'dhoti', 'lungi']), top: pick(['shirt', 'vest', 'shirt']), lod: 'low', acc: Math.random() < 0.5 ? { towel: true } : {} });
    if (Math.random() < 0.4) ap.acc = { turban: true };
    const h = HumanModel.create(ap);
    if (stick && h.parts.foreR) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.35, 5), new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
      st.position.set(0, -0.3, 0.12); st.rotation.x = 1.1; h.parts.foreR.add(st);
    }
    h.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(h.group); return h;
  }
  // a road polyline long enough to walk: chain the segments of one road
  function pathNear(p, rMin, rMax, types) {
    const S = segsNear(p.x, p.z, rMax, types).filter(s => s.r.p.length >= 2);
    for (let t = 0; t < 12 && S.length; t++) {
      const r = pick(S).r, pts = r.p; let L = 0; const cum = [0];
      for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(L); }
      if (L < 50) continue;
      const path = { pts, cum, L, w: r.w || 4 };
      const s0 = rnd(0, L), q = pathAt(path, s0, 0);
      if (!ringOk(q.x, q.z, p, rMin, rMax)) continue;
      if (herds.some(H => H.path.pts === pts || Math.hypot(H.hp.x - q.x, H.hp.z - q.z) < 40)) continue;   // one herd per road
      return { path, s: s0 };
    }
    return null;
  }
  function pathAt(P, s, lat) {
    s = Math.max(0, Math.min(P.L - 0.01, s));
    let i = 1; while (i < P.cum.length - 1 && P.cum[i] < s) i++;
    const a = P.pts[i - 1], b = P.pts[i], L = P.cum[i] - P.cum[i - 1] || 1, t = (s - P.cum[i - 1]) / L, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    return { x: a[0] + (b[0] - a[0]) * t - uz * lat, z: a[1] + (b[1] - a[1]) * t + ux * lat, ux, uz };
  }
  function makeHerd(type, p, rMin, rMax) {
    const at = pathNear(p, rMin, rMax, type === 'goats' ? ['dirt', 'lane'] : ['dirt', 'lane', 'cc']); if (!at) return null;
    const q0 = pathAt(at.path, at.s, 0);
    const H = { type, path: at.path, s: at.s, dir: Math.random() < 0.5 ? 1 : -1, animals: [], herder: null, hp: { x: q0.x, z: q0.z, yaw: 0, phase: 0, speed: 0 }, pause: 0 };
    const lead = type === 'lead';
    H.herder = makeHerder(!lead);
    const n = type === 'goats' ? 5 + (Math.random() * 5 | 0) : lead ? 1 + (Math.random() < 0.3 ? 1 : 0) : 3 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const kind = type === 'goats' ? 'goat' : pick(['cow', 'cow', 'bull', 'buffalo']);
      const q = pathAt(H.path, H.s, 0);
      const a = spawnAnimal(kind, SP[kind], { x: q.x, z: q.z, yaw: 0 }, 'herd');
      a.slot = { back: lead ? 2.4 + i * 2.2 : 1.5 + (i >> 1) * (type === 'goats' ? 1.1 : 2.4), lat: lead ? 0 : ((i % 2 ? 1 : -1) * rnd(0.4, 1.0)) };
      a.herd = H; H.animals.push(a);
    }
    placeHerd(H, true); herds.push(H); return H;
  }
  function placeHerd(H, snap) {
    for (const a of H.animals) {
      const q = pathAt(H.path, H.s - H.dir * a.slot.back, a.slot.lat);
      if (snap) { a.x = q.x; a.z = q.z; a.y = ground(a.x, a.z); a.yaw = Math.atan2(q.ux * H.dir, q.uz * H.dir); }
      a.tx = q.x; a.tz = q.z;
    }
  }
  const herdTime = () => { const h = typeof timeOfDay === 'number' ? timeOfDay : 9; return (h > 5.5 && h < 10.5) || (h > 15.5 && h < 19.5); };

  // ------------------------------------------------------------------ crows on the wires
  let crowIM = null; const crows = [];
  function placeCrows(p, n) {
    const P = world.poles || []; if (!P.length) return;
    const near = [];
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; if (b[2] === a[2] && Math.hypot(b[0] - a[0], b[1] - a[1]) < 45 && Math.hypot(a[0] - p.x, a[1] - p.z) < 160) near.push([a, b]); }
    crows.length = 0;
    for (let k = 0; k < n && near.length; k++) {
      const [a, b] = pick(near), o = pick([-0.65, -0.22, 0.22, 0.65]), t = rnd(0.15, 0.85);
      const ax = a[0] + Math.cos(a[3]) * o, az = a[1] - Math.sin(a[3]) * o, bx = b[0] + Math.cos(b[3]) * o, bz = b[1] - Math.sin(b[3]) * o;
      const L = Math.hypot(bx - ax, bz - az), sag = 0.25 + L * 0.018;
      for (let j = 0; j < 1 + (Math.random() * 3 | 0) && crows.length < n; j++) {
        const tt = Math.min(0.95, t + j * 0.04);
        crows.push({ x: ax + (bx - ax) * tt, z: az + (bz - az) * tt, y: 7.13 - sag * 4 * tt * (1 - tt) + 0.02, yaw: Math.atan2(bx - ax, bz - az) + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), seed: Math.random() * 50 });
      }
    }
    crowCenter = { x: p.x, z: p.z };
  }
  let crowCenter = null;
  function drawCrows(t) {
    if (!crowIM) return; let n = 0;
    for (const c of crows) {
      const hop = Math.sin(t * 0.9 + c.seed) > 0.97 ? 0.04 : 0;
      _q.setFromAxisAngle(_v.set(0, 1, 0), c.yaw + Math.sin(t * 0.5 + c.seed) * 0.4 * (Math.sin(t * 0.13 + c.seed) > 0.5 ? 1 : 0));
      R.compose(_v.set(c.x, c.y + hop, c.z), _q, _s.set(1, 1, 1)); crowIM.setMatrixAt(n++, R);
    }
    crowIM.count = n; crowIM.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ bark (same synth recipe as ambient.js, its own short voice)
  let lastBark = 0;
  function bark(a, cam) {
    const now = performance.now(); if (now - lastBark < 2500) return; lastBark = now;
    a.wag = 0; a.barkT = 0.6;
    let ctx = null; try { ctx = typeof audioCtx !== 'undefined' ? audioCtx : null; } catch (e) {}
    if (!ctx || ctx.state !== 'running') return;
    if (window.SFX && SFX.bark) { SFX.bark(a.x, a.z, a.scale < 1); return; }
    const d = Math.hypot(a.x - cam.x, a.z - cam.z), vol = Math.max(0, 0.35 * (1 - d / 60)); if (vol < 0.02) return;
    const n = 1 + (Math.random() * 3 | 0), small = a.scale < 1;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * rnd(0.25, 0.4), o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(small ? 520 : 400, t0); o.frequency.exponentialRampToValueAtTime(small ? 320 : 240, t0 + 0.12);
      f.type = 'bandpass'; f.frequency.value = 750; f.Q.value = 2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.18);
    }
  }

  // ------------------------------------------------------------------ simulation
  // the vehicle the player drives (or null on foot), with speed in m/s
  function playerVehicle() {
    if (!G || G.playerMode === 'foot') return null;
    const v = (typeof carSpeed === 'number' ? carSpeed : 0) / 3.6;
    const rot = typeof carRot === 'number' ? carRot : 0;
    return { x: G.carPos.x, z: G.carPos.z, fx: Math.sin(rot), fz: Math.cos(rot), v, hw: 1.0, hl: 2.4 };
  }
  // flee / bump against the player's vehicle and nearby traffic; returns true when it took control this frame
  function vehicleReact(a, veh, dt) {
    const r = a.sp.rig.r * a.scale;
    const check = (cx, cz, fx, fz, v, hw, hl, mine) => {
      const dx = a.x - cx, dz = a.z - cz, along = dx * fx + dz * fz, side = dx * fz - dz * fx;   // side > 0 = right of the car
      const sv = Math.abs(v);
      if (sv > 1.2 && along * Math.sign(v) > -hl && along * Math.sign(v) < hl + 6 + sv * 1.6 && Math.abs(side) < hw + r + 2.5) {
        a.scared = a.kind === 'buffalo' ? 1.2 : 2;          // step aside, off the car's line
        const sd = side >= 0 ? 1 : -1; a.fleeX = fz * sd; a.fleeZ = -fx * sd;
      }
      if (Math.abs(along) < hl + r * 0.6 && Math.abs(side) < hw + r * 0.6) {                // contact: a bump, nothing more
        const sd = side >= 0 ? 1 : -1, push = hw + r * 0.6 - Math.abs(side);
        a.x += fz * sd * push; a.z -= fx * sd * push;
        if (sv > 1.5 && a.bump <= 0) {
          a.bump = 0.7; a.stagger = sd; a.scared = 2.5; a.fleeX = fz * sd; a.fleeZ = -fx * sd;
          if (mine && typeof carSpeed === 'number') {
            const heavy = a.kind === 'cow' || a.kind === 'bull' || a.kind === 'buffalo';
            carSpeed *= heavy ? 0.55 : 0.9;
            if (heavy && G.showPopup && Math.abs(carSpeed) > 8) G.showPopup(a.kind === 'buffalo' ? 'BUFFALO! SLOW DOWN' : 'COW ON THE ROAD!');
          }
          if (a.kind === 'dog') a.yelp = true;
        }
      }
    };
    if (veh) check(veh.x, veh.z, veh.fx, veh.fz, veh.v, veh.hw, veh.hl, true);
    const T = G.traffic || [];
    for (let i = 0; i < T.length; i++) {
      const tc = T[i]; if (!tc.g) continue;
      const px = tc.g.position.x, pz = tc.g.position.z; if (Math.abs(px - a.x) > 14 || Math.abs(pz - a.z) > 14) continue;
      const ry = tc.g.rotation.y; check(px, pz, Math.sin(ry), Math.cos(ry), tc.speed || 6, tc.hw || 0.9, 2.2, false);
    }
  }
  // steer toward (tx,tz) at most `max` m/s; walls push back; returns metres moved
  function moveTo(a, tx, tz, max, dt) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { a.speed += (0 - a.speed) * Math.min(1, dt * 4); return 0; }
    const want = Math.atan2(dx, dz), dy = wrap(want - a.yaw), turnRate = a.kind === 'dog' || a.kind === 'hen' ? 5 : 1.6;
    a.yaw = wrap(a.yaw + Math.max(-turnRate * dt, Math.min(turnRate * dt, dy)));
    const facing = Math.max(0, Math.cos(dy));
    const target = Math.min(max, d * 1.2) * (0.25 + 0.75 * facing);
    a.speed += (target - a.speed) * Math.min(1, dt * 3);
    const step = a.speed * dt, nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
    if (a.pen && Math.hypot(nx - a.home.x, nz - a.home.z) > a.pen) { a.tx = a.home.x; a.tz = a.home.z; a.speed = 0; return 0; }
    tq.x = nx; tq.z = nz; const c = world.collide(tq, a.sp.rig.r * a.scale * 0.8);
    if ((world.yardAt && window.SafeHouse2 && (world.yardAt(tq.x, tq.z) > 0 || world.yardAt(tq.x, tq.z) !== world.yardAt(a.x, a.z))) || (world.insideBuilding && world.insideBuilding(tq.x, tq.z, 0.1))) { a.stuck = (a.stuck || 0) + dt; a.speed *= 0.5; return 0; }
    const moved = Math.hypot(tq.x - a.x, tq.z - a.z);
    if (c && c.hit) a.stuck = (a.stuck || 0) + dt; else a.stuck = 0;
    a.x = tq.x; a.z = tq.z; return moved;
  }
  function wanderTarget(a, R) {
    for (let i = 0; i < 6; i++) {
      const ang = rnd(-Math.PI, Math.PI), d = rnd(R * 0.3, R), x = a.home.x + Math.sin(ang) * d, z = a.home.z + Math.cos(ang) * d;
      if (a.field && world.fieldAt && world.fieldAt(x, z) !== a.field) continue;
      if (!blocked(x, z, a.sp.rig.r)) { a.tx = x; a.tz = z; return; }
    }
    a.tx = a.home.x; a.tz = a.home.z;
  }
  function stepAnimal(a, dt, t, veh, cam) {
    const rig = a.sp.rig, night = typeof timeOfDay === 'number' && (timeOfDay < 5.5 || timeOfDay > 20.5);
    vehicleReact(a, veh, dt);
    if (a.bump > 0) a.bump -= dt;
    if (a.barkT > 0) a.barkT -= dt;
    let moved = 0, max = 0, trot = a.kind === 'dog', mode = 'stand';
    if (a.scared > 0) {
      a.scared -= dt; if (a.state === 'lie') a.state = 'stand';
      max = { dog: 4.5, cat: 5.5, goat: 3, hen: 2.5, buffalo: 1.6 }[a.kind] || 2.0; trot = true;
      moved = moveTo(a, a.x + a.fleeX * 4, a.z + a.fleeZ * 4, max, dt); mode = 'move';
      if (a.kind === 'dog' && a.yelp) { a.yelp = false; bark(a, cam); }
    } else if (a.herd) {
      const H = a.herd;
      a.state = 'herd';
      const d = Math.hypot(a.tx - a.x, a.tz - a.z);
      max = H.moving ? (d > 2 ? 1.6 : 1.05) : 0.6; trot = a.kind === 'goat' && d > 2.5;
      if (d > 0.4 || H.moving) { moved = moveTo(a, a.tx, a.tz, max, dt); mode = moved > 0.002 ? 'move' : 'stand'; }
      if (!H.moving && Math.random() < dt * 0.1) a.grazing = !a.grazing;
    } else {
      a.timer -= dt;
      if (a.state === 'walk' || a.state === 'trot') {
        max = a.kind === 'dog' ? (a.state === 'trot' ? 2.2 : 1.1) : a.kind === 'cat' ? (a.state === 'trot' ? 1.8 : 0.8) : a.kind === 'hen' ? 0.5 : a.kind === 'goat' ? 0.8 : 0.9;
        trot = a.state === 'trot';
        moved = moveTo(a, a.tx, a.tz, max, dt); mode = 'move';
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.4 || a.timer < 0 || a.stuck > 1.5) { a.stuck = 0; a.state = (a.kind === 'dog' || a.kind === 'cat') && Math.random() < 0.3 ? 'lie' : 'graze'; a.timer = rnd(4, 14);
          if (a.roadStand) { a.roadStand = false; a.state = 'stand'; a.timer = rnd(20, 60); a.home.x = a.x; a.home.z = a.z; } }   // cow parks itself on the road
      } else if (a.timer < 0) {
        const r = Math.random();
        if (night && a.kind !== 'dog') { a.state = a.kind === 'hen' ? 'graze' : 'lie'; a.timer = rnd(20, 60); }
        else if (a.state === 'lie' && r < 0.6) { a.state = 'stand'; a.timer = rnd(2, 5); }
        else if ((a.kind === 'dog' || a.kind === 'cat') && r < 0.3 && roadTarget(a, true)) { a.state = a.kind === 'cat' ? 'trot' : 'walk'; a.timer = rnd(10, 20); }   // amble across the road
        else if ((a.kind === 'cow' || a.kind === 'bull' || a.kind === 'buffalo') && !night && r < 0.14 && roadTarget(a, false)) { a.state = 'walk'; a.roadStand = true; a.timer = rnd(15, 30); }
        else if (r < 0.55) { wanderTarget(a, a.kind === 'dog' ? 30 : a.kind === 'cat' ? 15 : a.kind === 'hen' ? 5 : 12); a.state = (a.kind === 'dog' || a.kind === 'cat') && Math.random() < 0.5 ? 'trot' : 'walk'; a.timer = rnd(8, 20); }
        else if (r < 0.8 || a.kind === 'hen') { a.state = 'graze'; a.timer = rnd(5, 15); }
        else { a.state = 'lie'; a.timer = rnd(15, 45); }
      }
      // dogs notice someone on foot nearby, and cars rolling slowly past
      if (a.kind === 'cat' && cam.foot && a.scared <= 0) { const dx = a.x - cam.px, dz = a.z - cam.pz, d = Math.hypot(dx, dz); if (d < 4) { a.scared = 1.5; a.fleeX = dx / (d || 1); a.fleeZ = dz / (d || 1); } }
      if (a.kind === 'dog' && cam.foot && Math.hypot(cam.px - a.x, cam.pz - a.z) < 9 && Math.random() < dt * 0.6) { a.wag = 1; bark(a, cam); }
      if (a.kind === 'dog' && veh && Math.abs(veh.v) > 2 && Math.abs(veh.v) < 9 && Math.hypot(veh.x - a.x, veh.z - a.z) < 14 && Math.random() < dt * 0.4) bark(a, cam);
    }
    a.y += (ground(a.x, a.z) - a.y) * Math.min(1, dt * 8);
    // pose: gait from metres actually travelled (no foot sliding)
    const stride = rig.stride * a.scale * (trot ? 1.35 : 1);
    a.phase = (a.phase + moved / stride) % 1;
    const sp = moved / Math.max(dt, 1e-4), k = Math.min(1, sp / (trot ? 1.2 : 0.5));
    if (mode === 'move' && k > 0.05) { a.headBase = a.kind === 'hen' ? 0.1 : 0.05; gaitPose(a, k, trot); }
    else if (a.state === 'lie' && !a.herd) liePose(a, t, (a.kind === 'dog' || a.kind === 'cat') && !night ? Math.sin(a.seed) > 0 : false);
    else {
      standPose(a, t);
      const grazing = (a.state === 'graze' || (a.herd && a.grazing && !a.herd.moving)) && a.kind !== 'dog' && a.kind !== 'cat';
      if (a.kind === 'hen') {        // peck: quick dips with pauses
        const pk = Math.sin(t * 2.3 + a.seed); a.pose.headX = pk > 0.55 ? 1.2 : 0.1; a.pose.headY = Math.sin(t * 0.8 + a.seed) * 0.4;
      } else if (grazing) {
        a.pose.headX = 1.0 + Math.sin(t * 6 + a.seed) * 0.04; a.pose.headY = Math.sin(t * 0.25 + a.seed) * 0.25;
        // slow forward step every so often while grazing (one leg, then back)
        const st = Math.max(0, Math.sin(t * 0.35 + a.seed)) ** 6; a.pose.legs[0][0] = -0.2 * st;
      } else a.pose.headX = a.barkT > 0 ? -0.2 + Math.sin(t * 30) * 0.08 : 0.08;
    }
    if (a.bump > 0) { a.pose.roll = a.stagger * Math.sin(a.bump * 9) * 0.12; }
    tail(a, t, sp);
  }

  // ------------------------------------------------------------------ setup / update
  let SP = null, counts = null, built = false, centre = null;
  function tierCounts() {
    const t = (window.Quality && Quality.tier) || 'high', f = t === 'low' ? 0.35 : t === 'medium' ? 0.6 : 1;
    const c = n => Math.max(1, Math.round(n * f));
    return { cow: c(16), bull: c(6), buffalo: c(10), dog: c(24), cat: c(10), goat: c(8), hen: c(20), crow: c(24), herds: t === 'low' ? 1 : t === 'medium' ? 2 : 3, leads: t === 'low' ? 1 : 2, goatHerds: t === 'low' ? 0 : 1 };
  }
  function build(game) {
    G = game; world = game.world; scene = game.scene;
    if (!world || !world.collide) return;
    indexRoads(); counts = tierCounts();
    const cattle = { cow: cattleRig('cow'), bull: cattleRig('bull'), buffalo: cattleRig('buffalo') };
    // herds add their own animals on top of the free ones
    SP = {
      cow: new Species(cattle.cow, counts.cow + 14), bull: new Species(cattle.bull, counts.bull + 8), buffalo: new Species(cattle.buffalo, counts.buffalo + 8),
      dog: new Species(dogRig(), counts.dog), cat: new Species(catRig(), counts.cat), goat: new Species(goatRig(), counts.goat + 12), hen: new Species(henRig(), counts.hen + 8),
    };
    crowIM = new THREE.InstancedMesh(crowGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), counts.crow); crowIM.count = 0;   /* own material: no instanceColor */ crowIM.frustumCulled = false; scene.add(crowIM);
    ropeGeo = new THREE.BufferGeometry(); ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 6), 3));
    ropeLine = new THREE.LineSegments(ropeGeo, new THREE.LineBasicMaterial({ color: 0x8a6a3a })); ropeLine.frustumCulled = false; scene.add(ropeLine);
    const p = game.carPos;
    for (const k of ['cow', 'bull', 'buffalo', 'dog', 'cat', 'goat', 'hen']) for (let i = 0; i < counts[k]; i++) {
      const a = spawnAnimal(k, SP[k], { x: p.x, z: p.z });
      if (!respawnFree(a, p, 15, 140)) { a.dead = true; }
    }
    for (let i = 0; i < counts.herds; i++) makeHerd('herd', p, 20, 150);
    for (let i = 0; i < counts.leads; i++) makeHerd('lead', p, 15, 120);
    for (let i = 0; i < counts.goatHerds; i++) makeHerd('goats', p, 20, 150);
    placeCrows(p, counts.crow);
    hideStaticCattle();
    try { procBuild(); } catch (e) { console.warn('village processions', e); }
    built = true; centre = { x: p.x, z: p.z };
    const tris = Object.values(SP).reduce((s, sp) => s + Object.values(sp.m).reduce((q, m) => q + m.geometry.attributes.position.count / 3 * (m === sp.m.upper || m === sp.m.lower ? sp.rig.hips.length : 1), 0) * sp.cap, 0);
    console.log('animals.js:', all.length, 'animals,', herds.length, 'herds,', crows.length, 'crows; max ~' + Math.round(tris / 1000) + 'k tris when all are in range');
  }
  // the map's old static cattle (one InstancedMesh each for cow / buffalo, built in nellutla-world.js) are replaced
  // by the live ones: find them by their instance counts and hide them (no edits to the map file)
  function hideStaticCattle() {
    const pr = world.props; if (!pr || !world.group) return;
    const want = [(pr.cow || []).length, (pr.buffalo || []).length];
    const found = [];
    world.group.traverse(o => { if (o.isInstancedMesh && o.geometry && o.geometry.attributes.color && !o.material.map) found.push(o); });
    // bovine geometries are the only prop meshes with ~this many vertices and these counts; match both counts in order
    for (let i = 0; i < want.length; i++) {
      const n = want[i]; if (!n) continue;
      const m = found.find(o => {
        if (o.count !== n || o.userData._animalsHidden) return false;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox, h = b.max.y - b.min.y, l = Math.max(b.max.z - b.min.z, b.max.x - b.min.x);
        return h > 1.1 && h < 1.9 && l > 1.6 && l < 3.2;           // a standing bovine, not a bike / cot / hay pile
      });
      if (m) { m.userData._animalsHidden = true; m.visible = false; }
    }
  }
  let tAcc = 0, recycleT = 0, lastHornT = -1;
  // positions of animals near the player, refreshed every frame, for the traffic AI to avoid: [{x, z, r, kind}]
  const RA = [], raPool = []; window.RoadAnimals = RA;
  function update(dt, game) {
    if (!built) return;
    tAcc += dt; const t = tAcc;
    const cp = game.camera.position, pp = game.carPos, veh = playerVehicle();
    const cam = { x: cp.x, z: cp.z, foot: game.playerMode === 'foot', px: pp.x, pz: pp.z };
    // herds: the leader point walks the road (paused outside herding hours, cattle graze the verge)
    for (const H of herds) {
      H.moving = (H.trip || herdTime()) && H.pause <= 0;
      if (H.pause > 0) H.pause -= dt;
      const hp = H.hp;
      if (H.moving) {
        H.s += H.dir * 0.95 * dt;
        if (H.trip && (H.dir > 0 ? H.s > H.trip.end : H.s < H.trip.end)) { H.done = true; continue; }
        if (H.s < 2 || H.s > H.path.L - 2) { H.dir *= -1; H.pause = rnd(4, 10); H.s = Math.max(2, Math.min(H.path.L - 2, H.s)); }
        if (veh && Math.abs(veh.v) > 3 && Math.hypot(veh.x - hp.x, veh.z - hp.z) < 10) H.pause = 1.5;   // the herder waits for the car
      }
      placeHerd(H, false);
      // herder: in front holding the rope (lead) or behind the group with the stick
      const lead = H.type === 'lead', back = lead ? 0 : (Math.max(...H.animals.map(a => a.slot.back)) + 2.2);
      const q = pathAt(H.path, H.s - H.dir * back, lead ? -0.3 : 0.6);
      const ox = hp.x, oz = hp.z;
      if (!hp.init) { hp.x = q.x; hp.z = q.z; hp.init = true; }
      const dx = q.x - hp.x, dz = q.z - hp.z, d = Math.hypot(dx, dz);
      const v = Math.min(d * 2, 1.6); if (d > 0.02) { hp.x += dx / d * v * dt; hp.z += dz / d * v * dt; hp.yaw += wrap(Math.atan2(dx, dz) - hp.yaw) * Math.min(1, dt * 4); }
      const moved = Math.hypot(hp.x - ox, hp.z - oz); hp.speed = moved / Math.max(dt, 1e-4);
      const h = H.herder;
      if (h) {
        const far = Math.hypot(hp.x - cp.x, hp.z - cp.z) > LOD_R; h.group.visible = !far;
        if (!far) {
          h.group.position.set(hp.x, ground(hp.x, hp.z), hp.z); h.group.rotation.y = hp.yaw;
          hp.phase += moved * 3.2;
          if (hp.speed > 0.15) HumanModel.animateWalk(h.parts, hp.phase, hp.speed); else HumanModel.animateIdle(h.parts, t + 3);
          if (lead && h.parts.armR) { h.parts.armR.rotation.x = -0.35; h.parts.foreR.rotation.x = -0.6; }          // hand back, holding the rope
          if (!lead && h.parts.armR && hp.speed > 0.15) h.parts.armR.rotation.x = -0.5 + Math.sin(t * 1.3) * 0.15;   // stick forward
        }
      }
    }
    // a horn (window.HornEvent = {x, z, t, r} set by sfx.js / traffic) scatters animals near it; cattle shuffle off slowly
    const he = window.HornEvent;
    if (he && he.t !== lastHornT) {
      lastHornT = he.t;
      for (const a of all) {
        if (a.dead || a.herd) continue;
        const dx = a.x - he.x, dz = a.z - he.z, d = Math.hypot(dx, dz), R = he.r || 22;
        if (d > R) continue;
        const cattle = a.kind === 'cow' || a.kind === 'bull' || a.kind === 'buffalo';
        if (cattle && Math.random() < 0.4) continue;                      // some cows just ignore it
        // away from the horn and off the road
        const n = nearestRoad(a.x, a.z, 12); let fx = dx / (d || 1), fz = dz / (d || 1);
        if (n) { fx = fx * 0.4 + n.nx; fz = fz * 0.4 + n.nz; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L; }
        a.fleeX = fx; a.fleeZ = fz; a.scared = cattle ? 2.5 : 2 + Math.random(); a.roadStand = false;
        if (a.kind === 'dog' && Math.random() < 0.5) a.yelp = true;
        if (cattle && a.state === 'stand' && Math.random() < 0.3 && window.SFX && SFX.moo) SFX.moo(a.x, a.z);
      }
    }
    // free + herd animals
    RA.length = 0;
    for (const a of all) {
      if (a.dead) continue;
      const d = Math.hypot(a.x - cp.x, a.z - cp.z);
      a.vis = d < LOD_R;
      if (a.vis || a.herd) stepAnimal(a, a.vis ? dt : Math.min(dt * 4, 0.2), t, veh, cam);
      if (d < 200 && a.kind !== 'hen') { const o = raPool[RA.length] || (raPool[RA.length] = { x: 0, z: 0, r: 0, kind: '' }); o.x = a.x; o.z = a.z; o.r = a.sp.rig.r * a.scale + 0.2; o.kind = a.kind; RA.push(o); }
    }
    // ropes: herder's hand to the halter of each led animal
    const rp = ropeGeo.attributes.position.array; let ri = 0;
    for (const H of herds) if (H.type === 'lead' && H.herder && H.herder.group.visible) {
      const hand = new THREE.Vector3(); (H.herder.parts.foreR || H.herder.group).getWorldPosition(hand);
      for (const a of H.animals) {
        if (ri >= 36 || !a.vis) break;
        const r = a.sp.rig, hx = r.headP[2] * a.scale + 0.45 * a.scale;
        rp[ri++] = hand.x; rp[ri++] = hand.y - 0.2; rp[ri++] = hand.z;
        rp[ri++] = a.x + Math.sin(a.yaw) * hx; rp[ri++] = a.y + (r.headP[1] - 0.15) * a.scale; rp[ri++] = a.z + Math.cos(a.yaw) * hx;
      }
    }
    for (let i = ri; i < 36; i++) rp[i] = 0;
    ropeGeo.attributes.position.needsUpdate = true; ropeGeo.setDrawRange(0, ri / 3);
    procUpdate(dt, game, veh, cam);
    for (const k in SP) SP[k].draw(cp);
    drawCrows(t);
    // recycle: animals and herds far behind come back in a ring just past the draw distance
    recycleT -= dt;
    if (recycleT < 0) {
      recycleT = 1.0;
      for (const a of all) if (!a.herd && !a.gone && !a.pen && (a.dead || Math.hypot(a.x - pp.x, a.z - pp.z) > RECYCLE_R)) a.dead = !respawnFree(a, pp, LOD_R + 5, LOD_R + 60);
      for (const H of herds) {
        if (H.trip || Math.hypot(H.hp.x - pp.x, H.hp.z - pp.z) < RECYCLE_R) continue;
        const at = pathNear(pp, LOD_R + 5, LOD_R + 70, H.type === 'goats' ? ['dirt', 'lane'] : ['dirt', 'lane', 'cc']);
        if (at) { H.path = at.path; H.s = at.s; H.hp.init = false; placeHerd(H, true); }
      }
      if (!crowCenter || Math.hypot(crowCenter.x - pp.x, crowCenter.z - pp.z) > 120) placeCrows(pp, counts.crow);
    }
  }

  // ------------------------------------------------------------------ village life past the safe house
  // Every 1-2 minutes (more often mornings/evenings, rarely at night) something passes along the lane in front of
  // the safe-house gate at walking pace: a bullock cart, a tractor with trolley, a cattle herd or goats with their
  // herder, or a few villagers on foot. They stop for the player, register in window.RoadAnimals (traffic avoids
  // them) and are hidden/not animated beyond LOD_R.
  const GATE = { x: 51.49, z: -275.56 }, PROC = { path: null, s0: 0, timer: 20, items: [], next: 0 };
  function procBuild() {
    const S = segsNear(GATE.x, GATE.z, 40, ['lane', 'dirt', 'cc', 'tar']);
    let best = null, bd = 1e9;
    for (const sg of S) {
      const ax = sg.b[0] - sg.a[0], az = sg.b[1] - sg.a[1], L2 = ax * ax + az * az;
      const t = Math.max(0, Math.min(1, ((GATE.x - sg.a[0]) * ax + (GATE.z - sg.a[1]) * az) / L2));
      const d = Math.hypot(sg.a[0] + ax * t - GATE.x, sg.a[1] + az * t - GATE.z) + (Math.abs(ax) / Math.sqrt(L2) < 0.7 ? 40 : 0);   // the lane in front runs ENE-WSW: prefer east-west segments
      if (d < bd) { bd = d; best = sg; }
    }
    if (!best) { console.warn('processions: no lane near the safe house'); return; }
    const pts = best.r.p; let L = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(L); }
    const path = { pts, cum, L, w: best.r.w || 4 };
    // arc length of the gate on that road
    let s0 = 0, md = 1e9; for (let s = 0; s < L; s += 0.5) { const q = pathAt(path, s, 0), d = Math.hypot(q.x - GATE.x, q.z - GATE.z); if (d < md) { md = d; s0 = s; } }
    PROC.path = path; PROC.s0 = s0;
    console.log('processions: lane', best.t, 'len', Math.round(L), 'm, gate at s =', Math.round(s0), '(' + bd.toFixed(1) + ' m off the road)');
  }
  function procTrip(dir) {   // from ~110 m before the gate to ~110 m past it, clamped to the road
    const P = PROC.path, a = Math.max(3, PROC.s0 - 110), b = Math.min(P.L - 3, PROC.s0 + 110);
    return dir > 0 ? { s: a, end: b } : { s: b, end: a };
  }
  function reuseAnimal(kind, at) {
    const sp = SP[kind]; let a = sp.list.find(q => q.gone);
    if (a) { a.gone = false; a.dead = false; a.x = a.tx = at.x; a.z = a.tz = at.z; a.y = ground(at.x, at.z); a.scared = 0; a.state = 'herd'; return a; }
    if (sp.list.length >= sp.cap) return null;
    return spawnAnimal(kind, sp, at, 'herd');
  }
  function procHerd(type) {
    const dir = Math.random() < 0.5 ? 1 : -1, tr = procTrip(dir), q0 = pathAt(PROC.path, tr.s, 0);
    const H = { type: type === 'goats' ? 'goats' : 'herd', path: PROC.path, s: tr.s, dir, animals: [], herder: makeHerder(true), hp: { x: q0.x, z: q0.z, yaw: 0, phase: 0, speed: 0 }, pause: 0, trip: tr };
    const n = type === 'goats' ? 6 + (Math.random() * 6 | 0) : 3 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const kind = type === 'goats' ? 'goat' : pick(['cow', 'cow', 'bull', 'buffalo', 'buffalo']);
      const a = reuseAnimal(kind, q0); if (!a) break;
      a.slot = { back: 1.5 + (i >> 1) * (type === 'goats' ? 1.1 : 2.4), lat: (i % 2 ? 1 : -1) * rnd(0.3, 0.9) };
      a.herd = H; H.animals.push(a);
    }
    if (!H.animals.length) { if (H.herder) scene.remove(H.herder.group); return; }
    H.s -= 0; placeHerd(H, true); herds.push(H);
  }
  function procVehicle(kind) {
    if (typeof TrafficModels === 'undefined' || !TrafficModels[kind]) return;
    const v = TrafficModels[kind](); scene.add(v.g);
    const dir = Math.random() < 0.5 ? 1 : -1, tr = procTrip(dir);
    PROC.items.push({ kind, v, g: v.g, s: tr.s, end: tr.end, dir, speed: kind === 'tractor' ? 3.2 : 1.15, cur: 0, lat: PROC.path.w * 0.22, r: kind === 'tractor' ? 2.2 : 1.6, half: kind === 'tractor' ? 4 : 2.5 });
  }
  function procWalkers() {
    if (typeof HumanModel === 'undefined') return;
    const dir = Math.random() < 0.5 ? 1 : -1, tr = procTrip(dir), n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      let ap; try { ap = HumanModel.randomAppearance(Math.random() < 0.5 ? 'm' : 'f'); } catch (e) { ap = {}; }
      ap.lod = 'low'; const h = HumanModel.create(ap); scene.add(h.group);
      PROC.items.push({ kind: 'walker', h, g: h.group, s: tr.s - dir * i * 1.4, end: tr.end, dir, speed: rnd(1.0, 1.35), cur: 0, lat: PROC.path.w * 0.3 + (i % 2) * 0.6, r: 0.4, half: 0.5, phase: Math.random() * 6 });
    }
  }
  function procSpawn() {
    const r = Math.random();
    if (r < 0.22) procVehicle('bullockCart');
    else if (r < 0.38) procVehicle('tractor');
    else if (r < 0.58) procHerd('cattle');
    else if (r < 0.74) procHerd('goats');
    else procWalkers();
  }
  function procUpdate(dt, game, veh, cam) {
    if (!PROC.path) return;
    const h = typeof timeOfDay === 'number' ? timeOfDay : 9, night = h < 5.5 || h > 21;
    const near = Math.hypot(GATE.x - game.carPos.x, GATE.z - game.carPos.z) < 260;
    PROC.timer -= dt;
    if (PROC.timer <= 0) {
      PROC.timer = rnd(60, 120) * (herdTime() ? 0.6 : 1) * (night ? 3 : 1);
      if (near && PROC.items.length < 8 && !(night && Math.random() < 0.7)) procSpawn();
    }
    // finished herds: release their animals and herder
    for (let i = herds.length - 1; i >= 0; i--) {
      const H = herds[i]; if (!H.done) continue;
      for (const a of H.animals) { a.herd = null; a.gone = true; a.dead = true; a.vis = false; }
      if (H.herder) scene.remove(H.herder.group);
      herds.splice(i, 1);
    }
    const P = PROC.path;
    for (let i = PROC.items.length - 1; i >= 0; i--) {
      const it = PROC.items[i];
      const q = pathAt(P, it.s, it.dir * it.lat);
      // stop for the player: anything within a few metres ahead of us (or the player's car just in front)
      const fx = q.ux * it.dir, fz = q.uz * it.dir, dx = cam.px - q.x, dz = cam.pz - q.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      const blockedAhead = ahead > 0 && ahead < it.half + 5 && side < (veh ? 2.6 : 1.4);
      const want = blockedAhead ? 0 : it.speed;
      it.cur += (want - it.cur) * Math.min(1, dt * (want < it.cur ? 4 : 1.2));
      const ds = it.cur * dt; it.s += it.dir * ds;
      if (it.dir > 0 ? it.s > it.end : it.s < it.end) { scene.remove(it.g); PROC.items.splice(i, 1); continue; }
      const d = Math.hypot(q.x - cam.x, q.z - cam.z), vis = d < LOD_R;
      it.g.visible = vis;
      if (d < 200) { const o = raPool[RA.length] || (raPool[RA.length] = { x: 0, z: 0, r: 0, kind: '' }); o.x = q.x; o.z = q.z; o.r = it.r; o.kind = it.kind; RA.push(o); }
      if (!vis) continue;
      const yaw = Math.atan2(fx, fz);
      it.g.position.set(q.x, ground(q.x, q.z), q.z);
      it.g.rotation.y += wrap(yaw - it.g.rotation.y) * Math.min(1, dt * 3);
      if (it.v) {
        const W = (it.v.userData && it.v.userData.wheels) || [];
        for (const w of W) w.mesh.rotation.x += ds / (w.radius || 0.4);
      } else if (it.h) {
        it.phase += ds * 3.2;
        if (it.cur > 0.15) HumanModel.animateWalk(it.h.parts, it.phase, it.cur); else HumanModel.animateIdle(it.h.parts, tAcc + i);
      }
    }
  }
  window.VillageProcessions = { spawn: (k) => { if (!k) return procSpawn(); if (k === 'cattle' || k === 'goats') procHerd(k); else if (k === 'walkers') procWalkers(); else procVehicle(k); }, get items() { return PROC.items; }, get state() { return PROC; } };
  GameHooks.init.push(game => { try { build(game); } catch (e) { console.error('animals build failed', e); } });
  GameHooks.update.push((dt, game) => update(dt, game));
  // puppets: drawn by the species but moved by their owner (the bullocks in village-life.js); never in `all`
  function puppet(kind) {
    const sp = SP[kind], a = spawnAnimal(kind, sp, { x: 0, z: 0 }, 'puppet'); all.splice(all.indexOf(a), 1); a.vis = false;
    return a;
  }
  function puppetWalk(a, dist) { a.phase = (a.phase + dist / (a.sp.rig.stride * 1.6)) % 1; gaitPose(a, 1, false); a.pose.headX = 0.18; }
  window.VillageAnimals = { puppet, puppetWalk, get all() { return all; }, get herds() { return herds; }, get crows() { return crows; }, species: () => SP };
})();
