// Nellutla village world builder (three.js r128, global THREE).
// Usage: const world = NellutlaWorld.build(scene, window.NELLUTLA_MAP);
//   world.collide(pos, radius) -> {hit, nx, nz} pushes pos out of buildings/walls
//   world.surfaceAt(x, z) -> 'highway'|'tar'|'cc'|'lane'|'dirt'|'river'|'field'
//   world.bounds, world.spawn, world.landmarks, world.drawMap(ctx, ...)
(function () {
  const ROAD_STYLE = {
    highway: { col: '#3a3a3c', y: 0.11, tex: 'asphalt' },
    tar:     { col: '#4a4744', y: 0.09, tex: 'asphalt' },
    cc:      { col: '#d8d5cc', y: 0.07, tex: 'concrete' },
    lane:    { col: '#cfcabd', y: 0.06, tex: 'concrete' },
    dirt:    { col: '#a88660', y: 0.05, tex: 'dirt' },
  };
  const LC_COLS = [[176,146,104],[168,98,60],[104,128,58],[66,90,44],[206,186,150],[158,132,98],[60,96,104]];

  function noiseCanvas(size, base, amp, speck) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const im = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const n = (Math.random() - 0.5) * amp;
      im.data[i*4] = base[0] + n; im.data[i*4+1] = base[1] + n; im.data[i*4+2] = base[2] + n; im.data[i*4+3] = 255;
    }
    g.putImageData(im, 0, 0);
    for (let i = 0; i < speck; i++) {
      g.fillStyle = `rgba(${Math.random()<0.5?0:255},${Math.random()<0.5?0:255},${Math.random()<0.5?0:255},0.05)`;
      g.fillRect(Math.random()*size, Math.random()*size, 1+Math.random()*3, 1+Math.random()*3);
    }
    return c;
  }
  function tex(canvas, rep) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (rep) t.repeat.set(rep, rep);
    return t;
  }

  function makeRoadTextures() {
    const asphalt = noiseCanvas(256, [200,200,200], 60, 400);
    const concrete = noiseCanvas(256, [204,200,192], 34, 300);
    const cg = concrete.getContext('2d'); cg.strokeStyle = 'rgba(0,0,0,0.25)'; cg.lineWidth = 2;
    cg.beginPath(); cg.moveTo(0, 2); cg.lineTo(256, 2); cg.stroke();       // CC slab joint
    const dirt = noiseCanvas(256, [215,205,190], 70, 900);
    const dg = dirt.getContext('2d');
    dg.fillStyle = 'rgba(80,60,40,0.18)';                                   // wheel ruts
    dg.fillRect(40, 0, 36, 256); dg.fillRect(180, 0, 36, 256);
    dg.fillStyle = 'rgba(90,120,50,0.22)'; dg.fillRect(100, 0, 56, 256);    // grass hump
    return { asphalt: tex(asphalt), concrete: tex(concrete), dirt: tex(dirt) };
  }

  function facadeTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 118, 128, 10);          // plinth stain
    g.fillStyle = '#3d4b5a'; g.fillRect(34, 40, 40, 34);                    // window
    g.fillStyle = '#6a8fae'; g.fillRect(37, 43, 34, 28);
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(41 + i*7, 43); g.lineTo(41 + i*7, 71); g.stroke(); } // grill
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(30, 34, 48, 5);            // sunshade
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, 128, 6);
    return tex(c);
  }

  // ---------- realistic material generators (procedural; one tile = 3.2 m wide x one 3.2 m floor)
  function plaster(g, S, stain) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    const im = g.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i++) { const n = 235 + (Math.random() - 0.5) * 26; im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = n; }
    g.putImageData(im, 0, 0);
    // rain streaks from the top and dust at the plinth
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S, w = 2 + Math.random() * 7, len = S * (0.15 + Math.random() * 0.45);
      const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `rgba(70,65,55,${0.12 + Math.random()*0.12})`); gr.addColorStop(1, 'rgba(70,65,55,0)');
      g.fillStyle = gr; g.fillRect(x, 0, w, len);
    }
    const pg = g.createLinearGradient(0, S * 0.82, 0, S); pg.addColorStop(0, 'rgba(110,85,60,0)'); pg.addColorStop(1, `rgba(110,85,60,${stain || 0.35})`);
    g.fillStyle = pg; g.fillRect(0, S * 0.82, S, S * 0.18);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(90,80,70,0.06)'; g.beginPath(); g.ellipse(Math.random()*S, Math.random()*S, 10+Math.random()*40, 8+Math.random()*30, 0, 0, 7); g.fill(); }
  }
  function grillWindow(g, x, y, w, h) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 6, y - 14, w + 12, 8);                 // chajja shadow
    g.fillStyle = '#7a5a3a'; g.fillRect(x - 4, y - 4, w + 8, h + 8);                          // wooden frame
    g.fillStyle = '#22303c'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(140,170,190,0.35)'; g.fillRect(x + 2, y + 2, w / 2 - 3, h - 4);
    g.strokeStyle = '#1b2a2a'; g.lineWidth = 2.5;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x + i * w / 6, y); g.lineTo(x + i * w / 6, y + h); g.stroke(); }
    g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x - 4, y + h + 4, w + 8, 4);                // sill
  }
  function facadeVariants() {
    const S = 256, mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); plaster(g, S); draw(g); return tex(c); };
    return [
      mk(g => grillWindow(g, 78, 70, 100, 92)),                                                   // 0 window
      mk(g => {                                                                                   // 1 door + small window
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(40, 44, 100, 8);
        const dc = ['#6b3f22', '#2f5d8a', '#3f6b3a', '#7a2f2f', '#5a4632'][Math.floor(Math.random() * 5)];
        g.fillStyle = dc; g.fillRect(52, 56, 76, 200);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(58, 64, 30, 80); g.strokeRect(92, 64, 30, 80); g.strokeRect(58, 152, 30, 90); g.strokeRect(92, 152, 30, 90);
        g.fillStyle = '#d4a017'; g.fillRect(118, 150, 6, 6);
        g.fillStyle = '#d9c9a8'; g.fillRect(40, 244, 100, 12);                                    // step
        grillWindow(g, 168, 80, 60, 70);
        g.fillStyle = '#ffffff'; g.fillRect(60, 30, 60, 16); g.fillStyle = '#c0392b'; g.font = 'bold 10px sans-serif'; g.fillText('శ్రీ', 82, 42);
      }),
      mk(g => {}),                                                                                // 2 blank wall
      mk(g => { g.fillStyle = '#2b2b2b'; g.fillRect(100, 40, 56, 30); g.strokeStyle = '#555'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(100, 40 + i * 7.5); g.lineTo(156, 40 + i * 7.5); g.stroke(); } }), // 3 ventilator
      mk(g => {                                                                                   // 4 shop with rolling shutter + board
        const bc = ['#c0392b', '#1565c0', '#2e7d32', '#f9a825'][Math.floor(Math.random() * 4)];
        g.fillStyle = bc; g.fillRect(0, 18, S, 46); g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
        g.fillText(['KIRANA STORE', 'MOBILE SHOP', 'TEA STALL', 'HOTEL', 'FERTILIZERS', 'MEDICAL'][Math.floor(Math.random() * 6)], S / 2, 52);
        g.fillStyle = '#8f9499'; g.fillRect(14, 74, S - 28, 182);
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let y = 78; y < 256; y += 6) { g.beginPath(); g.moveTo(14, y); g.lineTo(S - 14, y); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(14, 74, S - 28, 6);
      }),
    ];
  }
  function facadeGlow(i) {
    // lit window / shop-board areas matching facadeVariants() layouts
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.fillStyle = '#fff';
    if (i === 0 && Math.random() < 0.8) g.fillRect(80, 72, 96, 88);
    if (i === 1) { g.fillRect(170, 82, 56, 66); g.fillStyle = '#665'; g.fillRect(52, 56, 76, 6); }
    if (i === 4) { g.fillRect(0, 18, S, 46); g.fillStyle = '#555'; g.fillRect(14, 74, S - 28, 182); }
    return new THREE.CanvasTexture(c);
  }
  function stainedConcrete(S, algae) {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    plaster(g, S, algae ? 0.0 : 0.15);
    if (algae) {                                                                                  // black monsoon algae at the base, like the street view walls
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * S, h = S * (0.2 + Math.random() * 0.55);
        const gr = g.createLinearGradient(0, S, 0, S - h); gr.addColorStop(0, 'rgba(40,45,35,0.55)'); gr.addColorStop(1, 'rgba(40,45,35,0)');
        g.fillStyle = gr; g.fillRect(x, S - h, 6 + Math.random() * 18, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, S, 8);                                   // coping
    } else {
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(60,60,55,${Math.random()*0.12})`; g.beginPath(); g.ellipse(Math.random()*S, Math.random()*S, 5+Math.random()*30, 5+Math.random()*30, 0, 0, 7); g.fill(); }
    }
    return c;
  }
  function tileTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0, v = 200 + Math.random() * 55;
      g.fillStyle = `rgb(${v},${v*0.9},${v*0.85})`; g.fillRect(x + o, y, 15, 15);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + o, y + 13, 15, 3);
    }
    return tex(c);
  }
  function sheetTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) { const v = 205 + Math.sin(x / 64 * Math.PI * 16) * 40; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 64); }
    g.fillStyle = 'rgba(120,70,40,0.25)'; g.fillRect(0, 58, 64, 6);
    return tex(c);
  }
  function leafTexture() {
    const c = noiseCanvas(128, [205, 205, 205], 90, 0), g = c.getContext('2d');
    for (let i = 0; i < 900; i++) { const lit = Math.random() < 0.45; g.fillStyle = lit ? 'rgba(255,255,225,0.22)' : 'rgba(25,45,20,0.32)'; g.beginPath(); g.ellipse(Math.random()*128, Math.random()*128, 3 + Math.random()*4, 2 + Math.random()*3, Math.random()*3, 0, 7); g.fill(); }
    return tex(c);
  }
  function clumpGeometry() {
    // one body and four lobes (same 160 triangles as before) with a sun-lit top and dark underside baked into vertex colours
    const parts = [[0, 0, 0, 0.92, 1], [0.62, -0.1, 0.1, 0.58, 0], [-0.58, 0.02, 0.24, 0.6, 0], [0.08, 0.1, -0.64, 0.56, 0], [-0.06, 0.28, 0.5, 0.54, 0]];
    const pos = [], nor = [], uv = [], col = [];
    for (const [ox, oy, oz, r, d] of parts) {
      const g = new THREE.IcosahedronGeometry(r, d), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (Math.sin(x * 9 + z * 7) + Math.cos(y * 11)) * 0.07;
        const X = x * k + ox, Y = y * k * 0.85 + oy, Z = z * k + oz, n = Math.hypot(X, Y + 0.3, Z) || 1, b = 0.5 + 0.62 * Math.min(1, Math.max(0, (Y + 0.75) / 1.5));
        pos.push(X, Y, Z); nor.push(X / n, (Y + 0.3) / n, Z / n); col.push(b, b, b);
        uv.push(Math.atan2(z, x) / 6.28 * 3, y * 1.5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  function frondTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
    g.strokeStyle = '#6b5a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 256); g.stroke();
    for (let y = 6; y < 250; y += 5) {
      const w = 30 * Math.sin(y / 256 * Math.PI) + 4;
      g.strokeStyle = `rgb(${60 + Math.random()*30},${110 + Math.random()*40},${35})`; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(32, y); g.lineTo(32 - w, y + 14); g.stroke(); g.beginPath(); g.moveTo(32, y); g.lineTo(32 + w, y + 14); g.stroke();
    }
    return new THREE.CanvasTexture(c);
  }
  function frondGeometry() {
    // 12 drooping fronds radiating from the crown
    const pos = [], uv = [], nor = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + (k % 2) * 0.2, ca = Math.cos(a), sa = Math.sin(a), L = 4.2, Wd = 0.9, seg = 6;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        const P = (t, side) => { const r = t * L, y = 0.6 * t * 4 * (1 - t) * 1.2 - t * t * 2.2 + (k % 3) * 0.15; return [ca * r - sa * side * Wd / 2, y, sa * r + ca * side * Wd / 2]; };
        const A = P(t0, -1), B = P(t0, 1), C = P(t1, 1), Dd = P(t1, -1);
        pos.push(...A, ...B, ...C, ...A, ...C, ...Dd);
        uv.push(0, t0, 1, t0, 1, t1, 0, t0, 1, t1, 0, t1);
        for (let j = 0; j < 6; j++) nor.push(0, 1, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }

  // ---------- realism kit: merged procedural geometry with vertex colours (props, people, near trees, poles)
  const _km = new THREE.Matrix4(), _kq = new THREE.Quaternion(), _ke = new THREE.Euler(), _kv = new THREE.Vector3(), _ks = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function Kit() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  // t: {p:[x,y,z], r:[rx,ry,rz] | q:Quaternion, s:[sx,sy,sz]}; shade(x,y,z) -> colour multiplier
  Kit.prototype.add = function (g, hex, t, shade, uvFix) {
    if (g.index) g = g.toNonIndexed();
    t = t || {};
    const q = t.q || _kq.setFromEuler(_ke.set(...(t.r || [0, 0, 0])));
    g.applyMatrix4(_km.compose(_kv.set(...(t.p || [0, 0, 0])), q, _ks.set(...(t.s || [1, 1, 1]))));
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const c = Array.isArray(hex) ? new THREE.Color(hex[0], hex[1], hex[2]) : new THREE.Color(hex);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      this.pos.push(x, y, z); this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      if (uvFix) this.uv.push(uvFix[0], uvFix[1]); else this.uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      const k = shade ? shade(x, y, z) : 1; this.col.push(c.r * k, c.g * k, c.b * k);
    }
    return this;
  };
  // tapered cylinder from point a (radius r0) to point b (radius r1)
  Kit.prototype.tube = function (a, b, r0, r1, hex, seg, shade, uvFix) {
    const d = new THREE.Vector3(b[0]-a[0], b[1]-a[1], b[2]-a[2]), L = d.length() || 1e-4;
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
    return this.add(new THREE.CylinderGeometry(r1, r0, L, seg || 6, 1), hex, { p: [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2], q }, shade, uvFix);
  };
  Kit.prototype.ball = function (p, s, hex, seg, r, shade, uvFix) { return this.add(new THREE.SphereGeometry(1, seg || 10, Math.max(4, (seg || 10) - 2)), hex, { p, s, r }, shade, uvFix); };
  Kit.prototype.box = function (p, s, hex, r) { return this.add(new THREE.BoxGeometry(1, 1, 1), hex, { p, s, r }); };
  // raw quad (double-sided materials) with uv
  Kit.prototype.quad = function (a, b, c, d, n, hex, uvs, k) {
    const cc = Array.isArray(hex) ? new THREE.Color(hex[0], hex[1], hex[2]) : new THREE.Color(hex); k = k || 1;
    uvs = uvs || [[0,0],[1,0],[1,1],[0,1]];
    for (const [P, U] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      this.pos.push(...P); this.nor.push(...n); this.uv.push(...U); this.col.push(cc.r * k, cc.g * k, cc.b * k);
    }
    return this;
  };
  Kit.prototype.geo = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); return g;
  };
  function deform(g, fn) {
    const P = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); fn(v); P.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  }
  let _seed = 12345;
  const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };

  // ---------- canvas textures for the realism pass
  function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function leafCardTexture() {
    // a sprig cluster of pinnate neem / tamarind leaflets on twigs, transparent background
    const [c, g] = cvs(256, 256);
    const leaf = (x, y, a, L, W) => {
      const h = 78 + Math.random() * 40, l = 17 + Math.random() * 22;
      g.fillStyle = `hsl(${h},${38 + Math.random()*25}%,${l}%)`;
      g.beginPath(); g.ellipse(x, y, L, W, a, 0, 7); g.fill();
      g.strokeStyle = `hsla(${h},40%,${l + 14}%,0.6)`; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x - Math.cos(a) * L * 0.8, y - Math.sin(a) * L * 0.8); g.lineTo(x + Math.cos(a) * L * 0.8, y + Math.sin(a) * L * 0.8); g.stroke();
    };
    for (let k = 0; k < 9; k++) {
      const a0 = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, L = 60 + Math.random() * 55;
      const x0 = 128 + (Math.random() - 0.5) * 50, y0 = 150 + Math.random() * 60;
      g.strokeStyle = 'rgba(70,52,34,0.95)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x0, y0);
      const x1 = x0 + Math.cos(a0) * L, y1 = y0 + Math.sin(a0) * L; g.quadraticCurveTo((x0 + x1) / 2 + 8, (y0 + y1) / 2, x1, y1); g.stroke();
      for (let s = 0.15; s < 1; s += 0.075) {
        const x = x0 + (x1 - x0) * s, y = y0 + (y1 - y0) * s, sz = 7 + (1 - s) * 5;
        leaf(x + Math.cos(a0 + 1.3) * sz, y + Math.sin(a0 + 1.3) * sz, a0 + 1.1, sz, sz * 0.32);
        leaf(x + Math.cos(a0 - 1.3) * sz, y + Math.sin(a0 - 1.3) * sz, a0 - 1.1, sz, sz * 0.32);
      }
      leaf(x1, y1, a0, 8, 3);
    }
    for (let i = 0; i < 220; i++) {                      // fill the heart of the sprig
      const r = Math.pow(Math.random(), 0.7) * 95, t = Math.random() * 6.28;
      leaf(128 + Math.cos(t) * r, 120 + Math.sin(t) * r * 0.85, Math.random() * 6.28, 6 + Math.random() * 5, 2 + Math.random() * 1.5);
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // Telangana trees, unit space (instance y scale = height): clear trunk th, crown centre cy, radii rx / ry, lobe count, card size
  const TREE_SP = [
    { name: 'neem',     th: 0.34, cy: 0.66, rx: 0.46, ry: 0.33, lobes: 9,  card: 0.30, r: 0.024, weight: 0.42 },
    { name: 'tamarind', th: 0.30, cy: 0.63, rx: 0.60, ry: 0.35, lobes: 10, card: 0.33, r: 0.030, weight: 0.26 },
    { name: 'mango',    th: 0.20, cy: 0.56, rx: 0.56, ry: 0.43, lobes: 8,  card: 0.36, r: 0.028, weight: 0.24 },
    { name: 'banyan',   th: 0.24, cy: 0.54, rx: 0.86, ry: 0.32, lobes: 11, card: 0.38, r: 0.040, weight: 0.08 }];
  function treeAtlas() {
    // 2 x 2 atlas of dense leaf clusters, one per species: an opaque heart so crowns have no holes, ragged leafy edges
    const [c, g] = cvs(1024, 1024), C = 256;
    const styles = [[100, 112, 22, 40, 11, 3.0, 2300], [94, 108, 20, 36, 6.5, 2.2, 5200], [118, 134, 14, 31, 21, 6, 1300], [108, 124, 15, 31, 16, 9, 1200]];
    styles.forEach(([h0, h1, l0, l1, L, W, n], q) => {
      const ox = (q % 2) * 512, oy = (q >> 1) * 512;
      g.save(); g.beginPath(); g.rect(ox + 4, oy + 4, 504, 504); g.clip();
      g.fillStyle = `hsl(${h0},38%,${l0}%)`; g.beginPath(); g.arc(ox + C, oy + C, 150, 0, 7); g.fill();
      for (let i = 0; i < n; i++) {
        const r = Math.pow(Math.random(), 0.62) * 236, t = Math.random() * 6.28, x = r * Math.cos(t), y = r * Math.sin(t) * 0.92;
        const lit = 0.5 - y / 470 + (i / n) * 0.3, a = t + (Math.random() - 0.5) * 1.8, ll = L * (0.8 + Math.random() * 0.6);
        g.fillStyle = `hsl(${h0 + Math.random() * (h1 - h0)},${34 + Math.random() * 26}%,${l0 + (l1 - l0) * Math.min(1, lit * (0.6 + Math.random() * 0.7))}%)`;
        g.beginPath(); g.ellipse(ox + C + x, oy + C + y, ll, W * (0.8 + Math.random() * 0.4), a, 0, 7); g.fill();
      }
      g.restore();
    });
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function barkTexture() {
    const [c, g] = cvs(128, 256);
    const im = g.createImageData(128, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
      const n = 150 + Math.sin(x * 0.35 + Math.sin(y * 0.05) * 2) * 30 + (Math.random() - 0.5) * 40, i = (y * 128 + x) * 4;
      im.data[i] = n * 0.92; im.data[i+1] = n * 0.86; im.data[i+2] = n * 0.78; im.data[i+3] = 255;
    }
    g.putImageData(im, 0, 0);
    g.strokeStyle = 'rgba(30,22,15,0.55)';
    for (let i = 0; i < 40; i++) { g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * 128; g.beginPath(); g.moveTo(x, Math.random() * 256); g.lineTo(x + (Math.random() - 0.5) * 8, Math.random() * 256); g.stroke(); }
    return tex(c);
  }
  function strawTexture() {
    const [c, g] = cvs(256, 256);
    g.fillStyle = '#b89a5a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, L = 8 + Math.random() * 26, a = Math.PI / 2 + (Math.random() - 0.5) * 0.9;
      const v = 140 + Math.random() * 100; g.strokeStyle = `rgba(${v},${v * 0.85},${v * 0.5},0.8)`; g.lineWidth = 0.6 + Math.random();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(70,55,30,0.12)'; g.fillRect(Math.random() * 256, Math.random() * 256, 30, 6); }
    return tex(c);
  }
  function ropeWeaveTexture() {
    // nawar / jute rope criss-cross of a charpai, gaps are transparent
    const [c, g] = cvs(128, 128);
    for (let k = 0; k < 2; k++) for (let i = -128; i < 256; i += 11) {
      g.strokeStyle = k ? '#c9a46a' : '#b48a50'; g.lineWidth = 5;
      g.beginPath(); if (k) { g.moveTo(i, 0); g.lineTo(i + 128, 128); } else { g.moveTo(i, 128); g.lineTo(i + 128, 0); } g.stroke();
      g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 1; g.stroke();
    }
    const t = tex(c); t.repeat.set(3, 6); return t;
  }
  function checkTexture() {
    // lungi checks: tint is multiplied on top
    const [c, g] = cvs(64, 64);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.28)'; for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 5, 64); g.fillRect(0, i, 64, 5); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 8; i < 64; i += 16) { g.fillRect(i, 0, 2, 64); g.fillRect(0, i, 64, 2); }
    const t = tex(c); t.repeat.set(4, 3); return t;
  }
  function sareeTexture() {
    // body with small butta motifs and a contrasting zari border along the hem (v near 0)
    const [c, g] = cvs(128, 128);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.0)';
    for (let y = 10; y < 100; y += 16) for (let x = (y / 16 % 2) * 8; x < 128; x += 16) { g.fillStyle = 'rgba(255,235,160,0.9)'; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    g.fillStyle = '#e8b830'; g.fillRect(0, 106, 128, 16); g.fillStyle = '#7a1a1a'; g.fillRect(0, 110, 128, 6);
    g.fillStyle = '#e8b830'; for (let x = 0; x < 128; x += 8) g.fillRect(x, 111, 4, 4);
    const t = tex(c); t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }
  function frondTexture2() {
    const [c, g] = cvs(128, 512);
    for (let y = 8; y < 504; y += 4) {
      const t = y / 512, w = 58 * Math.sin(Math.min(1, t * 1.15) * Math.PI) + 6, hue = 85 + Math.random() * 18;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${hue},${45 + Math.random() * 15}%,${22 + Math.random() * 14 + (t > 0.85 ? 8 : 0)}%)`; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + s * w * 0.5, y + 6, 64 + s * w, y + 22 + Math.random() * 6); g.stroke();
      }
    }
    g.strokeStyle = '#8a7a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 512); g.stroke();
    g.fillStyle = '#6b5a30'; g.fillRect(58, 0, 12, 512);   // solid rachis strip (also sampled by coconuts)
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function palmTrunkTexture() {
    const [c, g] = cvs(64, 256);
    g.fillStyle = '#8a7a66'; g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 9 + Math.random() * 4) {
      g.fillStyle = `rgba(50,40,30,${0.35 + Math.random() * 0.25})`; g.fillRect(0, y, 64, 2 + Math.random() * 2);
      g.fillStyle = 'rgba(200,190,170,0.18)'; g.fillRect(0, y + 3, 64, 2);
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 40 : 190},${Math.random() < 0.5 ? 35 : 180},30,0.12)`; g.fillRect(Math.random() * 64, Math.random() * 256, 3, 1); }
    const t = tex(c); t.repeat.set(2, 8); return t;
  }
  function edgeAlphaTexture(soft) {
    // across-road alpha: solid core, ragged (or soft) edges; repeats along the road
    const [c, g] = cvs(64, 256), im = g.createImageData(64, 256);
    const edge = []; for (let y = 0; y < 256; y++) edge.push(0.5 + Math.abs(Math.sin(y * 0.11) * 1.2 + Math.sin(y * 0.37) * 0.8 + (Math.random() - 0.5) * 1.6));
    for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
      const d = Math.min(x, 63 - x), i = (y * 64 + x) * 4;
      const a = soft ? Math.min(1, Math.pow(d / 32, 1.4) * 1.6) : (d > edge[y] + (x < 32 ? 0 : (edge[(y + 97) % 256] - edge[y]) * 0.7) ? 1 : 0);
      im.data[i] = im.data[i+1] = im.data[i+2] = 255 * a; im.data[i+3] = 255;
    }
    g.putImageData(im, 0, 0); return tex(c);
  }
  function roadDecalTexture() {
    // 2x2 atlas: crack, oil stain, patch repair, dust/tyre scuffs
    const [c, g] = cvs(256, 256);
    const crack = (ox, oy) => {
      g.strokeStyle = 'rgba(30,28,25,0.9)'; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        let x = ox + 64 + (Math.random() - 0.5) * 30, y = oy + 10; g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 14; s++) { x += (Math.random() - 0.5) * 18; y += 8; x = Math.max(ox + 6, Math.min(ox + 122, x)); g.lineWidth = 1 + Math.random() * 1.5; g.lineTo(x, Math.min(oy + 122, y)); }
        g.stroke();
      }
    };
    crack(0, 0);
    let gr = g.createRadialGradient(192, 64, 4, 192, 64, 58); gr.addColorStop(0, 'rgba(25,22,20,0.75)'); gr.addColorStop(0.6, 'rgba(35,30,25,0.35)'); gr.addColorStop(1, 'rgba(35,30,25,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(192, 64, 58, 44, 0.4, 0, 7); g.fill();
    g.fillStyle = 'rgba(95,92,85,0.75)'; g.beginPath(); g.moveTo(16, 150); g.lineTo(108, 140); g.lineTo(116, 230); g.lineTo(22, 238); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,38,35,0.6)'; g.lineWidth = 2; g.stroke();
    gr = g.createRadialGradient(192, 192, 4, 192, 192, 60); gr.addColorStop(0, 'rgba(120,95,60,0.6)'); gr.addColorStop(1, 'rgba(120,95,60,0)');
    g.fillStyle = gr; g.fillRect(128, 128, 128, 128);
    g.strokeStyle = 'rgba(30,30,30,0.25)'; g.lineWidth = 6; g.beginPath(); g.moveTo(140, 140); g.bezierCurveTo(180, 200, 200, 160, 250, 250); g.stroke();
    return new THREE.CanvasTexture(c);
  }
  function detailTexture() {
    // multi-octave soil / grit detail, 512 px
    const S = 512, [c, g] = cvs(S, S), im = g.createImageData(S, S);
    const L = (n) => { const a = new Float32Array(n * n).map(() => Math.random()); return (x, y) => { const fx = x / S * n, fy = y / S * n, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j; const A = a[(j % n) * n + i % n], B = a[(j % n) * n + (i + 1) % n], C = a[((j + 1) % n) * n + i % n], Dd = a[((j + 1) % n) * n + (i + 1) % n]; return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + Dd * tx) * ty; }; };
    const o1 = L(8), o2 = L(32), o3 = L(128);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = 128 + (o1(x, y) - 0.5) * 70 + (o2(x, y) - 0.5) * 60 + (o3(x, y) - 0.5) * 50 + (Math.random() - 0.5) * 50, i = (y * S + x) * 4;
      im.data[i] = im.data[i+1] = im.data[i+2] = v; im.data[i+3] = 255;
    }
    g.putImageData(im, 0, 0);
    for (let i = 0; i < 1800; i++) { const v = Math.random() < 0.5 ? 60 : 200; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 0.6 + Math.random() * 1.6, 0, 7); g.fill(); }
    return tex(c);
  }

  // swept tapered limb through pts; rad(t) is the radius along it (no end caps: limbs end inside the foliage or the ground)
  Kit.prototype.limb = function (pts, rad, sides) {
    const v = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), ref = new THREE.Vector3(), rings = [];
    let len = 0;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      ref.set(Math.abs(v.y) > 0.9 ? 1 : 0, Math.abs(v.y) > 0.9 ? 0 : 1, 0); u.crossVectors(v, ref).normalize(); w.crossVectors(v, u);
      if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
      const r = rad(i / (pts.length - 1)), ring = [];
      for (let k = 0; k <= sides; k++) { const t = k / sides * 6.283, c = Math.cos(t), s = Math.sin(t); ring.push({ p: [p[0] + (u.x * c + w.x * s) * r, p[1] + (u.y * c + w.y * s) * r, p[2] + (u.z * c + w.z * s) * r], n: [u.x * c + w.x * s, u.y * c + w.y * s, u.z * c + w.z * s], uv: [k / sides * 2, len * 8] }); }
      rings.push(ring);
    });
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < sides; k++) for (const V of [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k], rings[i + 1][k + 1], rings[i][k + 1]]) { this.pos.push(...V.p); this.nor.push(...V.n); this.uv.push(...V.uv); this.col.push(1, 1, 1); }
    return this;
  };
  // detailed tree (instance scale = tree size): flared curved trunk, limbs forking into twigs, and a crown of rounded lobes.
  // Each lobe is a dark low-poly core wrapped in dense leaf-cluster cards, normals pointing out of the whole crown so it shades as one soft form.
  function nearTreeGeometry(kind) {
    const S = TREE_SP[kind], wood = new Kit(), leaves = new Kit();
    const fork = [(rnd() - 0.5) * 0.05, S.th, (rnd() - 0.5) * 0.05];
    const bow = [fork[0] * 0.3 + (rnd() - 0.5) * 0.03, S.th * 0.5, fork[2] * 0.3 + (rnd() - 0.5) * 0.03];
    wood.limb([[0, -0.03, 0], [0, 0.015, 0], [bow[0] * 0.5, S.th * 0.22, bow[2] * 0.5], bow, fork], t => S.r * (t < 0.3 ? 1.9 - t * 2.6 : 1.12 - t * 0.42), 8);
    // lobes on the crown ellipsoid, none in the hollow under it
    const lobes = [], ga = 2.39996;
    for (let i = 0; i < S.lobes; i++) {
      const y = 0.92 - 1.5 * i / Math.max(1, S.lobes - 1), rr = Math.sqrt(Math.max(0.08, 1 - y * y)), t = i * ga + rnd() * 0.5, d = 0.56 + rnd() * 0.12;
      lobes.push({ c: [Math.cos(t) * rr * S.rx * d, S.cy + y * S.ry * d, Math.sin(t) * rr * S.rx * d], r: (S.rx + S.ry) * (0.3 + rnd() * 0.08) });
    }
    for (const L of lobes) {
      const c = L.c, f = [fork[0] * (0.6 + rnd() * 0.4), S.th * (0.86 + rnd() * 0.14), fork[2] * (0.6 + rnd() * 0.4)];
      const m = [f[0] + (c[0] - f[0]) * 0.42 + (rnd() - 0.5) * 0.05, f[1] + (c[1] - f[1]) * 0.58, f[2] + (c[2] - f[2]) * 0.42 + (rnd() - 0.5) * 0.05];
      wood.limb([f, m, c], t => S.r * (0.5 - t * 0.38), 5);
      const a = rnd() * 6.28, tip = [c[0] + Math.cos(a) * L.r * 0.7, c[1] + L.r * 0.3, c[2] + Math.sin(a) * L.r * 0.7];
      wood.limb([m, tip], t => S.r * (0.2 - t * 0.13), 3);
    }
    if (kind === 3) for (let i = 0; i < 7; i++) {            // banyan: aerial prop roots hanging from the limbs
      const L = lobes[(i * 3 + 2) % lobes.length], x = L.c[0] * 0.85, z = L.c[2] * 0.85, thick = i < 2 ? 0.34 : 0.1;
      wood.limb([[x, L.c[1], z], [x + 0.01, L.c[1] * 0.5, z + 0.01], [x, -0.01, z]], () => S.r * thick, i < 2 ? 5 : 3);
    }
    const u0 = (kind % 2) * 0.5, v0 = 0.5 - (kind >> 1) * 0.5;       // canvas top maps to uv v = 1 in the flipped texture
    const uvs = [[u0 + 0.01, v0 + 0.01], [u0 + 0.49, v0 + 0.01], [u0 + 0.49, v0 + 0.49], [u0 + 0.01, v0 + 0.49]], heart = [u0 + 0.25, v0 + 0.25];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), n = new THREE.Vector3(), o = new THREE.Vector3(), V = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const shade = (p) => { const h = Math.max(0, Math.min(1, ((p[1] - S.cy) / S.ry + 1) / 2)); return 0.5 + h * 0.62; };
    for (const L of lobes) {                                 // the core stops the sky showing through
      const g = new THREE.IcosahedronGeometry(1, 0), P = g.attributes.position, k = 0.46 * shade(L.c);
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = L.r * 0.74;
        leaves.pos.push(L.c[0] + x * r, L.c[1] + y * r * 0.85, L.c[2] + z * r); leaves.nor.push(...o.set(L.c[0] + x * r, (L.c[1] - S.cy) + 0.2, L.c[2] + z * r).normalize().toArray());
        leaves.uv.push(...heart); leaves.col.push(k, k, k);
      }
    }
    const N = 150, per = N / lobes.length;
    for (let i = 0; i < N; i++) {
      const L = lobes[Math.floor(i / per)];
      n.set(rnd() - 0.5, rnd() - 0.42, rnd() - 0.5).normalize();
      const p = [L.c[0] + n.x * L.r, L.c[1] + n.y * L.r * 0.85, L.c[2] + n.z * L.r], sz = S.card * (0.55 + rnd() * 0.3);
      o.set(p[0], (p[1] - S.cy) * 1.4 + 0.12, p[2]).normalize();                    // shading normal: out of the crown
      q.setFromUnitVectors(V.set(0, 0, 1), V.clone().copy(n).lerp(o, 0.7).normalize());
      q.multiply(new THREE.Quaternion().setFromEuler(e.set((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, rnd() * 6.28)));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => V.set(x * sz / 2, y * sz / 2, 0).applyQuaternion(q).toArray().map((c, k) => c + p[k]));
      leaves.quad(corners[0], corners[1], corners[2], corners[3], o.toArray(), 0xffffff, uvs, shade(p) * (0.9 + rnd() * 0.2));
    }
    return { wood: wood.geo(), leaves: leaves.geo() };
  }
  function palmFrondGeometry() {
    // 16 arching fronds with a V-fold, 3 dead hanging fronds and a coconut bunch
    const K = new Kit();
    const F = (a, L, Wd, droop, dead) => {
      const ca = Math.cos(a), sa = Math.sin(a), seg = 8, cl = dead ? 0x8a6a3a : 0xffffff;
      const P = (t, side) => {
        const r = t * L, y = dead ? -t * L * 0.9 : (0.9 * t - t * t * droop) * L * 0.35, w = Wd * Math.sin(Math.min(1, t * 1.2) * Math.PI) * 0.5 + 0.05;
        const fold = Math.abs(side) * w * 0.25;
        return [ca * r * (dead ? 0.3 : 1) - sa * side * w, y + fold, sa * r * (dead ? 0.3 : 1) + ca * side * w];
      };
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        for (const s of [-1, 1]) {
          const A = P(t0, 0), B = P(t0, s), C = P(t1, s), Dd = P(t1, 0);
          if (s < 0) K.quad(A, Dd, C, B, [0, 1, 0], cl, [[0.5, t0], [0.5, t1], [0, t1], [0, t0]], dead ? 0.8 : 0.9 + rnd() * 0.15); else K.quad(A, B, C, Dd, [0, 1, 0], cl, [[0.5, t0], [s < 0 ? 0 : 1, t0], [s < 0 ? 0 : 1, t1], [0.5, t1]], dead ? 0.8 : 0.9 + rnd() * 0.15);
        }
      }
    };
    for (let k = 0; k < 16; k++) F(k / 16 * 6.28 + (k % 2) * 0.2, 4.0 + rnd() * 0.8, 1.15, 1.4 + (k % 3) * 0.35 + (k > 11 ? 0.8 : 0), false);
    for (let k = 0; k < 3; k++) F(k * 2.1 + 0.5, 3.0, 0.7, 0, true);
    for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28; K.ball([Math.cos(a) * 0.32, -0.35 - (k % 3) * 0.12, Math.sin(a) * 0.32], [0.16, 0.19, 0.16], k % 4 ? 0x7c8a2e : 0x9a7a30, 7, null, null, [0.5, 0.5]); }   // coconuts sample the solid rachis strip
    return K.geo();
  }
  // tapered concrete H-section pole with HT cross-arm, pin insulators and an LT arm with shackles
  function poleGeometry() {
    const K = new Kit(), H = 8.6, con = 0xb9b5aa;
    // flanges and web
    for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(1, H, 1, 1, 4, 1); g.translate(0, H / 2, 0); deform(g, v => { const t = v.y / H; v.x = v.x * 0.045 + s * (0.11 - 0.045 * t); v.z *= 0.2 - 0.08 * t; }); K.add(g, con, {}, (x, y) => 0.85 + 0.15 * Math.min(1, y / 1.2)); }
    { const g = new THREE.BoxGeometry(1, H, 1, 1, 4, 1); g.translate(0, H / 2, 0); deform(g, v => { const t = v.y / H; v.x *= 0.2 - 0.07 * t; v.z *= 0.05; }); K.add(g, con, {}, (x, y) => 0.8 + 0.2 * Math.min(1, y / 1.2)); }
    // HT V cross-arm (steel channel) + braces
    K.box([0, 8.15, 0.12], [1.9, 0.09, 0.07], 0x5c5f63);
    K.tube([-0.6, 8.12, 0.12], [0, 7.55, 0.1], 0.018, 0.018, 0x5c5f63, 4); K.tube([0.6, 8.12, 0.12], [0, 7.55, 0.1], 0.018, 0.018, 0x5c5f63, 4);
    const pinIns = (x, y, z) => {
      K.tube([x, y, z], [x, y + 0.1, z], 0.012, 0.012, 0x777777, 4);
      for (let i = 0; i < 3; i++) K.add(new THREE.CylinderGeometry(0.035 + i * 0.012, 0.075 - i * 0.008, 0.06, 10), 0xe8e4da, { p: [x, y + 0.24 - i * 0.055, z] });
      K.add(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 8), 0xe8e4da, { p: [x, y + 0.29, z] });
    };
    pinIns(-0.85, 8.2, 0.12); pinIns(0.85, 8.2, 0.12); pinIns(0, 8.62, 0);
    // LT arm with four shackle (spool) insulators
    K.box([0, 7.0, 0.12], [1.5, 0.08, 0.07], 0x5c5f63);
    for (const x of [-0.65, -0.22, 0.22, 0.65]) K.add(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 8), 0x6e4a2a, { p: [x, 7.11, 0.12] });
    // stay clamp, danger plate
    K.box([0, 2.6, 0.105], [0.18, 0.22, 0.01], 0xd8d0b0);
    K.box([0, 2.6, 0.112], [0.12, 0.05, 0.004], 0xb71c1c);
    return K.geo();
  }

  // ---------- street props
  function bovineGeometry(buffalo) {
    // zebu cow (white/grey, hump, dewlap, upturned horns) or Murrah buffalo (black, swept-back crescent horns)
    const K = new Kit(), hide = buffalo ? 0x2a2826 : 0xe6dfd2, dark = buffalo ? 0x1a1918 : 0xb8ae9e, hoof = 0x1c1a18;
    const mott = (x, y, z) => 0.9 + 0.1 * Math.sin(x * 13 + z * 7) * Math.cos(y * 11);
    const L = buffalo ? 1.0 : 0.92, Hb = buffalo ? 1.02 : 1.0;
    // barrel body: lathe along z (rump -> chest), flattened sides, sagging belly, prominent shoulders
    const lath = (prof, L) => { const g = new THREE.LatheGeometry(prof.map(([r, t]) => new THREE.Vector2(r, t * L)), 20); g.rotateX(Math.PI / 2); g.translate(0, 0, -L / 2); return g; };
    const bw = buffalo ? 1.12 : 1.0, BL = 1.75 * L;
    const body = deform(lath([[0.0, 0], [0.2, 0.02], [0.3, 0.08], [0.34, 0.2], [0.36, 0.45], [0.37, 0.65], [0.35, 0.85], [0.28, 0.96], [0.0, 1]], BL), v => {
      v.x *= 0.88 * bw; if (v.y < 0) v.y *= 1.12 + 0.12 * Math.cos(v.z / BL * Math.PI); if (v.y > 0) v.y *= 0.92;
    });
    K.add(body, hide, { p: [0, Hb, 0] }, mott);
    K.ball([0, Hb + 0.12, -0.6 * L], [0.27 * bw, 0.22, 0.3], hide, 12, null, mott);                      // rump / pin bones
    K.ball([0.16 * bw, Hb + 0.24, -0.58 * L], [0.07, 0.06, 0.08], hide, 8); K.ball([-0.16 * bw, Hb + 0.24, -0.58 * L], [0.07, 0.06, 0.08], hide, 8);
    if (!buffalo) {
      K.ball([0, Hb + 0.36, 0.5 * L], [0.13, 0.2, 0.19], 0xd8d0c2, 12, [-0.35, 0, 0]);                  // zebu hump
      K.add(deform(new THREE.SphereGeometry(1, 10, 8), v => { v.y -= Math.max(0, -v.y) * 0.4; }), 0xddd5c6, { p: [0, Hb - 0.2, 0.86 * L], s: [0.05, 0.26, 0.2], r: [0.6, 0, 0] }); // dewlap
    }
    // neck and long head angled down to the muzzle
    const nz = 0.98 * L, hy = buffalo ? Hb + 0.02 : Hb + 0.12;
    K.tube([0, Hb + 0.08, 0.6 * L], [0, hy + 0.04, nz + 0.12], buffalo ? 0.27 : 0.21, buffalo ? 0.2 : 0.15, hide, 12, mott);
    const headG = deform(lath([[0.0, 0], [0.11, 0.03], [0.14, 0.15], [0.13, 0.4], [0.1, 0.7], [0.095, 0.9], [0.06, 1.0], [0, 1.0]], 0.5), v => { v.x *= buffalo ? 1.15 : 1.0; });
    const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.0, 0, 0));
    K.add(headG, hide, { p: [0, hy + 0.02, nz + 0.25], q: hq }, mott);
    const hp = (lz) => { const v3 = new THREE.Vector3(0, 0, lz).applyQuaternion(hq); return [v3.x, hy + 0.02 + v3.y, nz + 0.25 + v3.z]; };
    const tip = hp(0.24), poll = hp(-0.2), eyeP = hp(-0.08);
    K.ball(tip, [buffalo ? 0.12 : 0.095, 0.075, 0.08], buffalo ? 0x161514 : 0x8a7c6c, 10);                 // muzzle
    for (const sx of [-1, 1]) {
      K.ball([sx * (buffalo ? 0.13 : 0.115), eyeP[1] + 0.02, eyeP[2]], [0.028, 0.028, 0.028], 0x0c0c0c, 6);   // eyes
      K.add(new THREE.SphereGeometry(1, 8, 6), dark, { p: [sx * (buffalo ? 0.22 : 0.19), poll[1] - 0.02, poll[2] + 0.02], s: [0.13, 0.035, 0.065], r: [0, sx * 0.3, sx * -0.35] }); // ears
      if (buffalo) {                                                                                    // crescent horns sweeping back
        const pts = []; for (let t = 0; t <= 1.001; t += 0.2) pts.push(new THREE.Vector3(sx * (0.08 + t * 0.3 - t * t * 0.1), poll[1] + 0.06 + t * 0.1 - t * t * 0.12, poll[2] - t * 0.32 + t * t * 0.2));
        K.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.04, 6, false), 0x2e2a26, {});
      } else {
        K.tube([sx * 0.07, poll[1] + 0.02, poll[2]], [sx * 0.17, poll[1] + 0.24, poll[2] - 0.06], 0.033, 0.01, 0x5a4a3a, 6); // upturned horns
      }
    }
    // legs with knees/hocks and hooves
    for (const [lx, lz, front] of [[0.2, 0.62, 1], [-0.2, 0.62, 1], [0.19, -0.62, 0], [-0.19, -0.62, 0]]) {
      const x = lx * (buffalo ? 1.1 : 1), z = lz * L, knee = [x, 0.42, z + (front ? 0.02 : -0.08)];
      K.tube([x, Hb - 0.05, z + (front ? 0 : -0.04)], knee, front ? 0.11 : 0.14, 0.065, hide, 8, mott);
      K.ball(knee, [0.065, 0.07, 0.07], hide, 8);
      K.tube(knee, [x, 0.08, z], 0.05, 0.042, front ? hide : dark, 8);
      K.add(new THREE.CylinderGeometry(0.045, 0.06, 0.08, 8), hoof, { p: [x, 0.04, z + 0.01] });
    }
    // tail with switch
    K.tube([0, Hb + 0.2, -0.95 * L], [0.02, 0.4, -0.98 * L], 0.03, 0.015, hide, 5);
    K.ball([0.02, 0.32, -0.98 * L], [0.05, 0.12, 0.05], 0x111111, 6);
    return K.geo();
  }
  function bikeGeometry(paint) {
    // commuter motorcycle (Splendor-style): spoked wheels, teardrop tank, long seat, engine, silencer
    const K = new Kit(), blk = 0x161616, chrome = 0xbfc3c7, wb = 0.64;
    for (const z of [wb, -wb]) {
      K.add(new THREE.TorusGeometry(0.28, 0.055, 8, 22), blk, { p: [0, 0.33, z], r: [0, Math.PI / 2, 0] });
      K.add(new THREE.TorusGeometry(0.22, 0.012, 4, 18), chrome, { p: [0, 0.33, z], r: [0, Math.PI / 2, 0] });
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI; K.tube([0, 0.33 + Math.sin(a) * 0.22, z + Math.cos(a) * 0.22], [0, 0.33 - Math.sin(a) * 0.22, z - Math.cos(a) * 0.22], 0.004, 0.004, chrome, 3); }
      K.add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), chrome, { p: [0, 0.33, z], r: [0, 0, Math.PI / 2] });
      K.add(new THREE.TorusGeometry(0.31, 0.03, 4, 12, 1.6), z > 0 ? paint : blk, { p: [0, 0.35, z], r: [0, Math.PI / 2, 0.1] });   // mudguards
    }
    K.tube([0, 0.33, wb], [0, 0.95, wb - 0.22], 0.025, 0.025, chrome, 6);                                // fork
    K.tube([-0.36, 1.02, wb - 0.3], [0.36, 1.02, wb - 0.3], 0.013, 0.013, chrome, 5);                   // handlebar
    for (const sx of [-1, 1]) K.tube([sx * 0.3, 1.02, wb - 0.3], [sx * 0.38, 1.02, wb - 0.3], 0.02, 0.02, blk, 6);
    K.add(new THREE.CylinderGeometry(0.08, 0.07, 0.09, 12), chrome, { p: [0, 0.9, wb - 0.12], r: [Math.PI / 2 - 0.2, 0, 0] });   // headlamp
    K.ball([0, 0.9, wb - 0.07], [0.065, 0.065, 0.02], 0xfff6d0, 10);
    K.ball([0, 0.8, 0.12], [0.15, 0.12, 0.3], paint, 14, [0.12, 0, 0]);                              // tank
    K.ball([0, 0.78, -0.3], [0.13, 0.05, 0.36], 0x1a1a1a, 10);                                        // seat
    K.box([0, 0.48, 0.05], [0.24, 0.24, 0.32], 0x4a4c50);                                             // engine
    for (let i = 0; i < 4; i++) K.box([0, 0.62, -0.02 + i * 0.05], [0.28, 0.015, 0.02], 0x2c2d30);   // cylinder fins
    K.tube([0, 0.62, 0.32], [0, 0.42, -0.1], 0.03, 0.03, blk, 6);                                     // frame
    K.tube([0, 0.45, -0.1], [0, 0.74, -0.55], 0.03, 0.03, blk, 6);
    K.box([0, 0.6, -0.42], [0.2, 0.22, 0.18], paint);                                                 // side panel
    K.tube([0.14, 0.32, 0.1], [0.16, 0.4, -0.75], 0.04, 0.045, chrome, 10);                           // silencer
    K.tube([0.1, 0.45, -0.1], [0.08, 0.7, -0.58], 0.02, 0.02, 0x333333, 5);                           // rear shocks
    K.box([0, 0.62, -0.8], [0.12, 0.06, 0.05], 0xb71c1c);                                             // tail lamp
    K.tube([0.04, 0.05, -0.1], [0.08, 0.45, -0.08], 0.012, 0.012, blk, 4);                            // side stand
    return K.geo();
  }
  function cotGeometry() {
    const K = new Kit(), wood = 0x6b4a2a;
    for (const [x, z] of [[0.42, 0.9], [-0.42, 0.9], [0.42, -0.9], [-0.42, -0.9]]) {
      const g = new THREE.LatheGeometry([[0.0, 0], [0.04, 0], [0.045, 0.06], [0.03, 0.12], [0.055, 0.22], [0.03, 0.32], [0.045, 0.4], [0.04, 0.5], [0, 0.5]].map(a => new THREE.Vector2(a[0], a[1])), 8);
      K.add(g, wood, { p: [x, 0, z] });
    }
    for (const x of [0.42, -0.42]) K.tube([x, 0.44, -0.95], [x, 0.44, 0.95], 0.035, 0.035, 0x7a5532, 6);
    for (const z of [0.9, -0.9]) K.tube([-0.47, 0.44, z], [0.47, 0.44, z], 0.032, 0.032, 0x7a5532, 6);
    return K.geo();
  }
  function cotWeaveGeometry() {
    const K = new Kit();
    K.quad([-0.4, 0.46, -0.87], [0.4, 0.46, -0.87], [0.4, 0.43, 0.87], [-0.4, 0.43, 0.87], [0, 1, 0], 0xffffff, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return K.geo();
  }
  function dishGeometry() {
    // offset parabolic dish on a wall bracket, LNB on an arm
    const K = new Kit(), prof = [];
    for (let i = 0; i <= 8; i++) { const r = i / 8 * 0.36; prof.push(new THREE.Vector2(r, r * r / (4 * 0.32))); }
    const g = new THREE.LatheGeometry(prof, 20); g.computeVertexNormals();
    K.add(g, 0xeeeeee, { p: [0, 1.05, 0.05], r: [Math.PI / 2 - 0.45, 0, 0], s: [1, 1, 0.82] });
    K.tube([0, 0, 0], [0, 1.0, 0], 0.025, 0.025, 0x6d6d6d, 6);
    K.tube([0, 0.95, 0.02], [0, 0.88, 0.45], 0.012, 0.012, 0x444444, 4);
    K.box([0, 0.9, 0.47], [0.05, 0.05, 0.1], 0x333333);
    K.add(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8), 0x333333, { p: [0, 0.92, 0.42], r: [Math.PI / 2 - 0.4, 0, 0] });
    return K.geo();
  }
  function flagGeometry() {
    const K = new Kit();
    K.tube([0, 0, 0], [0, 5.6, 0], 0.035, 0.025, 0xdddddd, 6);
    K.ball([0, 5.62, 0], [0.05, 0.05, 0.05], 0xd4a017, 6);
    const N = 8;
    for (let i = 0; i < N; i++) {
      const x0 = i / N * 0.95, x1 = (i + 1) / N * 0.95, w0 = Math.sin(x0 * 7) * 0.06, w1 = Math.sin(x1 * 7) * 0.06, sag0 = x0 * 0.12, sag1 = x1 * 0.12;
      K.quad([x0, 4.95 - sag0, w0], [x1, 4.95 - sag1, w1], [x1, 5.5 - sag1 * 0.4, w1], [x0, 5.5 - sag0 * 0.4, w0], [0, 0, 1], 0xff8f00, null, 0.85 + 0.15 * Math.cos(x0 * 7));
    }
    return K.geo();
  }
  function hayGeometry() {
    // conical rick (Telangana gaddi kuppa) with a twisted top knot, lumpy straw surface
    const prof = [[0, 0], [1.55, 0], [1.6, 0.35], [1.5, 1.1], [1.15, 1.9], [0.6, 2.55], [0.2, 2.85], [0.12, 3.05], [0, 3.15]].map(a => new THREE.Vector2(a[0], a[1]));
    const g = deform(new THREE.LatheGeometry(prof, 18), v => { const a = Math.atan2(v.z, v.x), k = 1 + Math.sin(a * 5 + v.y * 2) * 0.05 + Math.sin(a * 13) * 0.025; v.x *= k; v.z *= k; });
    const K = new Kit(); K.add(g, 0xffffff, { s: [1, 0.9, 1] }, (x, y) => 0.7 + Math.min(0.3, y * 0.15));
    const uv = K.uv; for (let i = 0; i < uv.length; i += 2) { uv[i] *= 4; uv[i + 1] *= 2; }
    return K.geo();
  }
  function shrubGeometry() {
    // leafy cluster: crossed leaf cards around a few stems
    const K = new Kit(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.28, r = rnd() * 0.45, p = [Math.cos(a) * r, 0.25 + rnd() * 0.5, Math.sin(a) * r], sz = 0.45 + rnd() * 0.3;
      q.setFromEuler(e.set((rnd() - 0.5) * 1.2, rnd() * 6.28, (rnd() - 0.5) * 0.6));
      const n = new THREE.Vector3(p[0], p[1] - 0.1, p[2]).normalize().toArray();
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => v.set(x * sz / 2, y * sz / 2, 0).applyQuaternion(q).toArray().map((o, k) => o + p[k]));
      K.quad(c[0], c[1], c[2], c[3], n, 0xffffff, null, 0.6 + p[1] * 0.6);
    }
    return K.geo();
  }
  function sandGeometry() {
    const g = deform(new THREE.ConeGeometry(1.4, 0.9, 20, 4), v => { const a = Math.atan2(v.z, v.x); const k = 1 + Math.sin(a * 3) * 0.08 + Math.sin(a * 7 + 1) * 0.04; v.x *= k; v.z *= k; v.y += (v.y > 0.3 ? -0.08 : 0); });
    const K = new Kit(); K.add(g, 0xc8aa7c, { p: [0, 0.45, 0] }, () => 0.9 + rnd() * 0.12); return K.geo();
  }

  // ---------- villager body parts (local space: y up, +z forward, feet at y=0, 1.68 m adult man)
  function personParts() {
    const P = {}, skinShade = (x, y, z) => 1;
    const ell = (K, r0, r1, y0, y1, zs, hex, seg, open, shade) => K.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg || 12, 3, open), hex, { p: [0, (y0 + y1) / 2, 0], s: [1, 1, zs] }, shade);
    // skin: head, face features, neck, midriff (shows between blouse and saree)
    let K = new Kit();
    K.add(deform(new THREE.SphereGeometry(1, 14, 12), v => { if (v.y < -0.2) { v.x *= 0.86; v.z = v.z * 0.92 + 0.04; } }), 0xffffff, { p: [0, 1.6, 0.0], s: [0.092, 0.118, 0.104] });
    K.ball([0, 1.54, 0.045], [0.062, 0.045, 0.055], 0xffffff, 8);                     // jaw
    K.add(new THREE.ConeGeometry(0.018, 0.045, 6), 0xf0e6e0, { p: [0, 1.59, 0.105], r: [1.3, 0, 0] });   // nose
    for (const sx of [-1, 1]) {
      K.ball([sx * 0.092, 1.6, 0.0], [0.015, 0.03, 0.02], 0xe8dcd4, 6);              // ears
      K.ball([sx * 0.035, 1.62, 0.088], [0.016, 0.009, 0.01], 0x0c0a0a, 6);          // eyes
      K.box([sx * 0.035, 1.645, 0.093], [0.035, 0.007, 0.01], 0x2a1a14);             // brows
    }
    K.box([0, 1.548, 0.092], [0.035, 0.008, 0.01], 0x6a3a32);                         // lips
    K.tube([0, 1.4, -0.005], [0, 1.53, 0.0], 0.05, 0.045, 0xffffff, 10);              // neck
    ell(K, 0.135, 0.13, 0.93, 1.16, 0.72, 0xffffff, 12);                               // midriff
    P.skin = K.geo();
    // hair: short (men, boys) with moustache, long braid (women, girls)
    K = new Kit();
    K.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), 0xffffff, { p: [0, 1.617, -0.012], s: [0.099, 0.122, 0.112], r: [-0.55, 0, 0] });
    K.box([0, 1.567, 0.098], [0.045, 0.01, 0.012], 0xffffff);
    P.hairShort = K.geo();
    K = new Kit();
    K.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), 0xffffff, { p: [0, 1.617, -0.014], s: [0.1, 0.124, 0.114], r: [-0.5, 0, 0] });
    K.ball([0, 1.6, -0.1], [0.055, 0.05, 0.04], 0xffffff, 8);
    let prev = [0, 1.57, -0.11];
    for (let i = 1; i <= 7; i++) { const nx = [0, 1.57 - i * 0.065, -0.115 - Math.sin(i * 0.4) * 0.025]; K.ball(nx, [0.026 - i * 0.0015, 0.04, 0.022], 0xffffff, 6); prev = nx; }
    K.ball([0, 1.6, -0.035], [0.012, 0.012, 0.012], 0xe8e0d0, 4);
    P.hairLong = K.geo();
    // shirt: torso, shoulders, short sleeves, collar, pocket
    K = new Kit();
    ell(K, 0.16, 0.175, 0.8, 1.38, 0.62, 0xffffff, 16);
    K.ball([0, 1.375, 0], [0.19, 0.06, 0.11], 0xffffff, 12);
    for (const sx of [-1, 1]) { K.ball([sx * 0.187, 1.372, 0], [0.06, 0.058, 0.064], 0xffffff, 10); K.tube([sx * 0.187, 1.372, 0], [sx * 0.212, 1.2, 0.0], 0.06, 0.056, 0xffffff, 10); }   // rounded sleeve cap under the shoulder line, not a tube standing above it
    K.add(new THREE.TorusGeometry(0.055, 0.016, 5, 14), 0xf4f4f4, { p: [0, 1.435, 0.0], r: [Math.PI / 2 - 0.25, 0, 0] });
    K.box([0.075, 1.25, 0.108], [0.08, 0.09, 0.006], 0xd8d8d8);
    for (let i = 0; i < 4; i++) K.ball([0, 1.36 - i * 0.12, 0.11], [0.008, 0.008, 0.005], 0xcccccc, 4);
    P.shirt = K.geo();
    // blouse with short sleeves
    K = new Kit();
    ell(K, 0.14, 0.16, 1.14, 1.37, 0.66, 0xffffff, 16);
    K.ball([0, 1.37, 0], [0.19, 0.07, 0.11], 0xffffff, 12);
    for (const sx of [-1, 1]) { K.ball([sx * 0.18, 1.368, 0], [0.056, 0.054, 0.058], 0xffffff, 10); K.tube([sx * 0.18, 1.368, 0], [sx * 0.2, 1.27, 0.0], 0.056, 0.052, 0xffffff, 10); K.ball([sx * 0.06, 1.27, 0.07], [0.068, 0.062, 0.055], 0xffffff, 10); }
    P.blouse = K.geo();
    // saree: pleated flared skirt (border at hem) + waist tuck + pallu over the left shoulder
    K = new Kit();
    const sk = deform(new THREE.CylinderGeometry(0.155, 0.255, 0.96, 32, 6, true), v => {
      const a = Math.atan2(v.x, v.z), t = 0.5 - v.y / 0.96, front = Math.max(0, Math.cos(a));
      const r = 1 + Math.sin(a * 22) * 0.04 * t * (0.4 + front) + front * t * 0.05; v.x *= r; v.z *= r * 0.82;
    });
    K.add(sk, 0xffffff, { p: [0, 0.5, 0] });
    K.add(new THREE.TorusGeometry(0.15, 0.025, 6, 20), 0xffffff, { p: [0, 0.975, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.78, 1] });
    const path = [[0.13, 0.97, 0.12], [0.07, 1.12, 0.145], [-0.02, 1.27, 0.14], [-0.12, 1.41, 0.07], [-0.16, 1.46, -0.03], [-0.13, 1.38, -0.12], [-0.11, 1.15, -0.16], [-0.1, 0.92, -0.17], [-0.09, 0.7, -0.165]];
    for (let i = 0; i < path.length - 1; i++) {
      const A = new THREE.Vector3(...path[i]), B = new THREE.Vector3(...path[i + 1]);
      const side = (P2) => { const t = B.clone().sub(A).normalize(), out = new THREE.Vector3(P2.x, 0, P2.z).normalize(); return t.cross(out).normalize().multiplyScalar(i < 4 ? 0.11 : 0.14); };
      const sA = side(A), sB = side(B), out = new THREE.Vector3(A.x, 0, A.z).normalize().multiplyScalar(0.012);
      const u0 = i / (path.length - 1), u1 = (i + 1) / (path.length - 1);
      K.quad(A.clone().add(sA).add(out).toArray(), B.clone().add(sB).add(out).toArray(), B.clone().sub(sB).add(out).toArray(), A.clone().sub(sA).add(out).toArray(),
        new THREE.Vector3(A.x, 0.3, A.z).normalize().toArray(), 0xffffff, [[u0 * 3, 0.05], [u1 * 3, 0.05], [u1 * 3, 0.7], [u0 * 3, 0.7]]);
    }
    P.saree = K.geo();
    // lungi (ankle length with a front fold) and dhoti (white, knee length, tucked)
    K = new Kit();
    K.add(deform(new THREE.CylinderGeometry(0.17, 0.2, 0.86, 22, 3, true), v => { const a = Math.atan2(v.x, v.z); v.x *= 1.09; v.z *= 0.76 + (0.43 - v.y) / 0.86 * 0.32; if (Math.abs(a) < 0.4) v.z += 0.012; }), 0xffffff, { p: [0, 0.53, 0] });   // deeper toward the hem so a walking leg stays inside the cloth
    K.box([0.02, 0.6, 0.168], [0.07, 0.62, 0.012], 0xe8e8e8, [-0.05, 0, 0.04]);
    K.add(new THREE.TorusGeometry(0.168, 0.02, 5, 18), 0xe0e0e0, { p: [0, 0.95, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.76, 1] });
    P.lungi = K.geo();
    K = new Kit();
    K.add(deform(new THREE.CylinderGeometry(0.17, 0.22, 0.5, 22, 3, true), v => { v.z *= 0.78; }), 0xffffff, { p: [0, 0.71, 0] });
    K.add(new THREE.PlaneGeometry(0.12, 0.42), 0xeeeeee, { p: [0, 0.68, -0.17], r: [0.08, 0, 0] });
    K.add(new THREE.PlaneGeometry(0.1, 0.5), 0xeeeeee, { p: [0.02, 0.66, 0.17], r: [-0.08, 0, 0] });
    P.dhoti = K.geo();
    // school uniform: boys' shorts, girls' pinafore skirt, satchel
    K = new Kit();
    ell(K, 0.16, 0.17, 0.66, 0.95, 0.72, 0xffffff, 16, true);
    P.shorts = K.geo();
    K = new Kit();
    K.add(deform(new THREE.CylinderGeometry(0.15, 0.25, 0.4, 24, 2, true), v => { const a = Math.atan2(v.x, v.z); const r = 1 + Math.sin(a * 12) * 0.03 * (0.2 - v.y); v.x *= r; v.z *= r * 0.8; }), 0xffffff, { p: [0, 0.78, 0] });
    P.skirt = K.geo();
    K = new Kit();
    K.box([0, 1.14, -0.16], [0.26, 0.3, 0.1], 0xffffff); K.box([0, 1.27, -0.1], [0.27, 0.05, 0.03], 0xdddddd);
    for (const sx of [-1, 1]) K.tube([sx * 0.1, 1.42, -0.06], [sx * 0.1, 1.05, 0.08], 0.012, 0.012, 0x222222, 4);
    P.bag = K.geo();
    // jointed limbs: arm hangs from the shoulder pivot, leg from the hip pivot
    K = new Kit();
    K.tube([0, 0, 0], [0, -0.29, 0], 0.047, 0.04, 0xffffff, 9);
    K.ball([0, -0.29, 0], [0.04, 0.04, 0.04], 0xffffff, 8);
    K.tube([0, -0.29, 0], [0, -0.53, 0.05], 0.038, 0.029, 0xffffff, 9);
    K.ball([0, -0.6, 0.06], [0.026, 0.065, 0.042], 0xffffff, 8);
    K.ball([0.022, -0.575, 0.085], [0.011, 0.03, 0.011], 0xffffff, 5, [0.5, 0, 0.3]);
    P.arm = K.geo();
    K = new Kit();
    K.tube([0, 0, 0], [0, -0.44, 0.015], 0.072, 0.05, 0xffffff, 10);
    K.ball([0, -0.44, 0.015], [0.05, 0.05, 0.05], 0xffffff, 8);
    K.tube([0, -0.44, 0.015], [0, -0.83, -0.005], 0.046, 0.034, 0xffffff, 9);
    K.ball([0, -0.845, 0.05], [0.04, 0.03, 0.1], 0xffffff, 8);
    K.box([0, -0.872, 0.05], [0.085, 0.016, 0.25], 0x2a2018);
    K.tube([-0.03, -0.855, 0.12], [0.03, -0.855, 0.12], 0.006, 0.006, 0x8a5a2a, 3);
    P.leg = K.geo();
    K = new Kit();
    K.tube([0, -0.5, 0.08], [0.0, -1.47, -0.06], 0.013, 0.011, 0x6b4a2a, 5);
    K.add(new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI), 0x6b4a2a, { p: [0, -0.56, 0.03], r: [0, Math.PI / 2, 0] });
    P.stick = K.geo();
    return P;
  }

  // ---------- geometry helpers (manual merge: one draw call per material)
  function Builder() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  Builder.prototype.tri = function (a, b, c, n, ua, ub, uc, col) {
    this.pos.push(...a, ...b, ...c); this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc); for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
  };
  Builder.prototype.quad = function (a, b, c, d, n, uvs, col) {
    this.tri(a, b, c, n, uvs[0], uvs[1], uvs[2], col); this.tri(a, c, d, n, uvs[0], uvs[2], uvs[3], col);
  };
  Builder.prototype.mesh = function (mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; return m;
  };

  // quad wound so its front face points along n (lambert double-side lighting stays correct)
  Builder.prototype.oquad = function (a, b, c, d, n, col, uvs) {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    const cx = uy*vz - uz*vy, cy = uz*vx - ux*vz, cz = ux*vy - uy*vx;
    uvs = uvs || [[0,0],[1,0],[1,1],[0,1]];
    if (cx*n[0] + cy*n[1] + cz*n[2] < 0) this.quad(a, d, c, b, n, [uvs[0], uvs[3], uvs[2], uvs[1]], col); else this.quad(a, b, c, d, n, uvs, col);
  };
  // axis-aligned-in-plan bar from (x1,z1) to (x2,z2), between heights y0 and y1, thickness th
  function bar(bld, x1, z1, x2, z2, y0, y1, th, col) {
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz); if (L < 1e-4) return;
    const nx = -dz / L * th / 2, nz = dx / L * th / 2;
    const p = [[x1+nx,z1+nz],[x2+nx,z2+nz],[x2-nx,z2-nz],[x1-nx,z1-nz]], cxm = (x1+x2)/2, czm = (z1+z2)/2;
    for (let i = 0; i < 4; i++) {
      const A = p[i], B = p[(i+1)%4], mx = (A[0]+B[0])/2 - cxm, mz = (A[1]+B[1])/2 - czm, ml = Math.hypot(mx, mz) || 1;
      bld.oquad([A[0],y0,A[1]],[B[0],y0,B[1]],[B[0],y1,B[1]],[A[0],y1,A[1]],[mx/ml,0,mz/ml],col);
    }
    bld.oquad([p[0][0],y1,p[0][1]],[p[1][0],y1,p[1][1]],[p[2][0],y1,p[2][1]],[p[3][0],y1,p[3][1]],[0,1,0],col);
  }
  // raised window / door surround with reveals and a sill, aligned to the facade texture openings
  function frameRect(B, a, tx, tz, nx, nz, s0, s1, y0, y1, dep, w, c, cd, door) {
    const P = (s2, y, o) => [a[0]+tx*s2+nx*o, y, a[1]+tz*s2+nz*o], fn = [nx, 0, nz], e = 0.012;
    const yb = door ? y0 : y0 - w;
    B.oquad(P(s0-w,yb,dep), P(s0,yb,dep), P(s0,y1+w,dep), P(s0-w,y1+w,dep), fn, c);
    B.oquad(P(s1,yb,dep), P(s1+w,yb,dep), P(s1+w,y1+w,dep), P(s1,y1+w,dep), fn, c);
    B.oquad(P(s0,y1,dep), P(s1,y1,dep), P(s1,y1+w,dep), P(s0,y1+w,dep), fn, c);
    B.oquad(P(s0,y0,e), P(s0,y1,e), P(s0,y1,dep), P(s0,y0,dep), [tx,0,tz], cd);
    B.oquad(P(s1,y0,e), P(s1,y1,e), P(s1,y1,dep), P(s1,y0,dep), [-tx,0,-tz], cd);
    B.oquad(P(s0,y1,e), P(s1,y1,e), P(s1,y1,dep), P(s0,y1,dep), [0,-1,0], cd);
    B.oquad(P(s0-w,yb,0), P(s0-w,y1+w,0), P(s0-w,y1+w,dep), P(s0-w,yb,dep), [-tx,0,-tz], c);
    B.oquad(P(s1+w,yb,0), P(s1+w,y1+w,0), P(s1+w,y1+w,dep), P(s1+w,yb,dep), [tx,0,tz], c);
    B.oquad(P(s0-w,y1+w,0), P(s1+w,y1+w,0), P(s1+w,y1+w,dep), P(s0-w,y1+w,dep), [0,1,0], c);
    if (!door) {
      B.oquad(P(s0,y0,e), P(s1,y0,e), P(s1,y0,dep), P(s0,y0,dep), [0,1,0], cd);
      B.oquad(P(s0-w-0.06,y0-w,0), P(s1+w+0.06,y0-w,0), P(s1+w+0.06,y0-w,dep+0.08), P(s0-w-0.06,y0-w,dep+0.08), [0,1,0], c);
      B.oquad(P(s0-w-0.06,y0-w-0.06,dep+0.08), P(s1+w+0.06,y0-w-0.06,dep+0.08), P(s1+w+0.06,y0-w,dep+0.08), P(s0-w-0.06,y0-w,dep+0.08), fn, c);
    }
  }

  function wallBox(bld, x1, z1, x2, z2, h, th, col, uvScale, y0) {
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz); if (L < 0.01) return;
    const nx = -dz / L * th / 2, nz = dx / L * th / 2, b0 = y0 || 0;
    const p = [[x1+nx,z1+nz],[x2+nx,z2+nz],[x2-nx,z2-nz],[x1-nx,z1-nz]];
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i+1)%4], ex = b[0]-a[0], ez = b[1]-a[1], el = Math.hypot(ex, ez) || 1;
      const u = el / uvScale;
      bld.quad([a[0],b0,a[1]],[b[0],b0,b[1]],[b[0],h,b[1]],[a[0],h,a[1]],[ez/el,0,-ex/el],[[0,b0/uvScale],[u,b0/uvScale],[u,h/uvScale],[0,h/uvScale]],col);
    }
    bld.quad([p[0][0],h,p[0][1]],[p[3][0],h,p[3][1]],[p[2][0],h,p[2][1]],[p[1][0],h,p[1][1]],[0,1,0],[[0,0],[0,1],[1,1],[1,0]],col);
  }

  function ribbon(b, pts, w, y, col, vOff, cap) {
    // pts [[x,z]], mitred ribbon with along-road UVs in metres
    let dist = vOff || 0;
    const n = pts.length; const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i-1)], c = pts[Math.min(n-1, i+1)];
      let tx = c[0]-a[0], tz = c[1]-a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let ox = -tz, oz = tx, scale = 1;
      if (i > 0 && i < n-1) {
        const d1x = p[0]-a[0], d1z = p[1]-a[1], l1 = Math.hypot(d1x, d1z) || 1;
        const cos = (d1x/l1)*tx + (d1z/l1)*tz; scale = Math.min(2.5, 1 / Math.max(0.4, Math.sqrt((1+cos)/2)));
      }
      if (cap && Math.hypot(p[0] - cap.bx, p[1] - cap.bz) < 0.1) {       // square-cut end along a given line (the breaker)
        const dt = ox * cap.lx + oz * cap.lz, k = w / 2 / dt; L.push([p[0] + cap.lx * k, p[1] + cap.lz * k]); R.push([p[0] - cap.lx * k, p[1] - cap.lz * k]); continue;
      }
      L.push([p[0]+ox*w/2*scale, p[1]+oz*w/2*scale]); R.push([p[0]-ox*w/2*scale, p[1]-oz*w/2*scale]);
    }
    for (let i = 0; i < n-1; i++) {
      const seg = Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]);
      const v0 = dist / w, v1 = (dist + seg) / w; dist += seg;
      b.quad([L[i][0],y,L[i][1]],[L[i+1][0],y,L[i+1][1]],[R[i+1][0],y,R[i+1][1]],[R[i][0],y,R[i][1]],[0,1,0],[[0,v0],[0,v1],[1,v1],[1,v0]],col);
      // round-ish cap at joints so junctions don't show gaps
    }
  }

  // dashed or solid marking along polyline at lateral offset
  function marking(b, pts, off, w, y, col, dash, gap) {
    for (let i = 0; i < pts.length-1; i++) {
      const a = pts[i], c = pts[i+1], dx = c[0]-a[0], dz = c[1]-a[1], L = Math.hypot(dx, dz); if (L < 0.5) continue;
      const ux = dx/L, uz = dz/L, ox = -uz*off, oz = ux*off, hx = -uz*w/2, hz = ux*w/2;
      const step = dash ? dash + gap : L;
      for (let s = 0; s < L; s += step) {
        const e = Math.min(L, s + (dash || L));
        const p0 = [a[0]+ux*s+ox, a[1]+uz*s+oz], p1 = [a[0]+ux*e+ox, a[1]+uz*e+oz];
        b.quad([p0[0]+hx,y,p0[1]+hz],[p1[0]+hx,y,p1[1]+hz],[p1[0]-hx,y,p1[1]-hz],[p0[0]-hx,y,p0[1]-hz],[0,1,0],[[0,0],[0,1],[1,1],[1,0]],col);
      }
    }
  }

  function signSprite(text, sub, bg) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = bg || '#0b5d1e'; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 144);
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = 'bold 44px sans-serif'; g.fillText(text, 256, sub ? 70 : 95, 480);
    if (sub) { g.font = 'bold 40px sans-serif'; g.fillText(sub, 256, 128, 480); }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    return m;
  }

  // ---------------- farm fields: parcels traced from the imagery by tools/fields.py
  // classes: 0 fallow 1 ploughed red soil 2 paddy 3 flooded paddy 4 row crop 5 stubble 6 orchard 7 scrub 8 cloud (shown as fallow)
  const FIELD_COLS = [[164,138,98],[160,88,52],[66,112,42],[52,84,58],[88,116,50],[188,168,118],[124,120,80],[136,128,90],[164,138,98]];
  const FIELD_MAP = [[208,192,150],[204,150,110],[150,194,110],[126,172,156],[170,194,122],[222,210,162],[120,162,98],[180,176,134],[208,192,150]];
  // real imagery colour per parcel (median of the photo), pre-compensated for the scene lighting and the game's ACES
  // tone mapping. FIELD_INV maps a wanted on-screen value to the texture value that produces it; it was measured by
  // painting a grey ramp on the ground and reading the rendered pixels at noon from 150 m (no fog).
  const FIELD_INV = [[0, 0], [7, 10], [39, 30], [72, 50], [105, 70], [128, 90], [157, 130], [172, 150], [180, 170], [197, 230], [202, 255]];
  const FIELD_SAT = 1.18;
  function invTone(v) {
    for (let i = 1; i < FIELD_INV.length; i++) if (v <= FIELD_INV[i][0]) {
      const [o0, p0] = FIELD_INV[i - 1], [o1, p1] = FIELD_INV[i]; return p0 + (p1 - p0) * (v - o0) / (o1 - o0);
    }
    return 255;
  }
  function fieldPaint(f) {
    if (f.m == null) return FIELD_COLS[f.c];
    let r = (f.m >> 16) & 255, g = (f.m >> 8) & 255, b = f.m & 255;
    const L = (r + g + b) / 3;
    r = L + (r - L) * FIELD_SAT; g = L + (g - L) * FIELD_SAT; b = L + (b - L) * FIELD_SAT;
    return [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(invTone(v)))));
  }
  function fieldInfo(f, i) {
    const p = f.p; let A = 0, cx = 0, cz = 0, best = 0, ang = 0;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length], cr = a[0] * b[1] - b[0] * a[1];
      A += cr; cx += (a[0] + b[0]) * cr; cz += (a[1] + b[1]) * cr;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
    }
    if (ang < 0) ang += Math.PI; if (ang >= Math.PI) ang -= Math.PI;
    const h = Math.sin(i * 91.7 + p.length * 3.1) * 43758.5453, hv = h - Math.floor(h);
    return { i, p, c: f.c, m: f.m, area: Math.abs(A / 2), cx: A ? cx / (3 * A) : p[0][0], cz: A ? cz / (3 * A) : p[0][1], ang, h: hv,
      x0, z0, x1, z1, crop: f.c === 4 ? (hv < 0.55 ? 'cotton' : hv < 0.8 ? 'maize' : 'chilli') : null };
  }
  function pointInPoly(x, z, p) {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i], b = p[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  }
  // sprite atlas for field plants: paddy tuft, cotton bush, maize, chilli, grass tuft, thorn branch (6 cells of 128x256)
  function cropAtlas() {
    const [c, g] = cvs(768, 256);
    const R = (a, b) => a + Math.random() * (b - a);
    const blade = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + R(-6, 6), (y0 + y1) / 2, x1, y1); g.stroke(); };
    g.lineCap = 'round';
    // 0 paddy: dense fan of thin blades
    for (let k = 0; k < 70; k++) { const bx = 64 + R(-14, 14); blade(bx, 256, bx + R(-50, 50), R(40, 120), R(2, 3.5), `rgb(${R(70, 120)|0},${R(140, 190)|0},${R(40, 70)|0})`); }
    // 1 cotton: woody stem, leafy bush, white bolls
    blade(192, 256, 192, 120, 5, '#5b4a32');
    for (let k = 0; k < 60; k++) { g.fillStyle = `rgb(${R(40, 80)|0},${R(90, 130)|0},${R(30, 55)|0})`; g.beginPath(); g.ellipse(192 + R(-50, 50), R(70, 220), R(8, 16), R(6, 11), R(0, 3), 0, 7); g.fill(); }
    for (let k = 0; k < 26; k++) { g.fillStyle = '#f6f4ee'; g.beginPath(); g.arc(192 + R(-46, 46), R(70, 210), R(4, 7), 0, 7); g.fill(); }
    // 2 maize: stalk, arching leaves, tassel
    blade(320, 256, 322, 20, 6, '#7f9a3e');
    for (let k = 0; k < 12; k++) { const y = R(60, 230), s = k % 2 ? 1 : -1; blade(321, y, 321 + s * R(40, 62), y + R(-30, 30), R(5, 8), `rgb(${R(80, 120)|0},${R(130, 165)|0},${R(40, 60)|0})`); }
    for (let k = 0; k < 8; k++) blade(322, 26, 322 + R(-16, 16), R(0, 12), 2, '#c8b060');
    // 3 chilli: small dense bush with red and green pods
    blade(448, 256, 448, 150, 4, '#4d5a2a');
    for (let k = 0; k < 50; k++) { g.fillStyle = `rgb(${R(40, 80)|0},${R(100, 140)|0},${R(30, 50)|0})`; g.beginPath(); g.ellipse(448 + R(-48, 48), R(110, 240), R(7, 12), R(5, 8), R(0, 3), 0, 7); g.fill(); }
    for (let k = 0; k < 22; k++) { g.fillStyle = Math.random() < 0.7 ? '#c0281c' : '#3f7a20'; g.beginPath(); g.ellipse(448 + R(-42, 42), R(120, 235), 2.5, 7, R(-0.5, 0.5), 0, 7); g.fill(); }
    // 4 grass tuft for the bunds
    for (let k = 0; k < 40; k++) { const bx = 576 + R(-20, 20); blade(bx, 256, bx + R(-55, 55), R(120, 200), R(2, 4), `rgb(${R(110, 160)|0},${R(130, 170)|0},${R(50, 80)|0})`); }
    // 5 thorn branches (dry babul/prosopis cuttings stacked as a fence)
    for (let k = 0; k < 26; k++) { const x0 = 640 + R(0, 128), y0 = R(110, 256); const x1 = x0 + R(-50, 50), y1 = y0 - R(30, 110); blade(x0, y0, x1, y1, R(2, 4), `rgb(${R(70, 100)|0},${R(55, 75)|0},${R(35, 50)|0})`);
      for (let t = 0; t < 4; t++) { const u = Math.random(), px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u; blade(px, py, px + R(-12, 12), py - R(4, 14), 1.2, '#4a3a28'); } }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // a patch of plants (rows along local +x) merged into one geometry; instanced across a field
  function cropPatchGeometry(cell, size, rowSp, plantSp, w, h, crossed, jitter) {
    const pos = [], nor = [], uv = [], colA = [], u0 = cell / 6, u1 = (cell + 1) / 6;
    const add = (x, z, yaw, ww, hh, shade) => {
      const n = crossed ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const a = yaw + k * Math.PI / 2, dx = Math.cos(a) * ww / 2, dz = Math.sin(a) * ww / 2;
        const P = [[x - dx, 0, z - dz], [x + dx, 0, z + dz], [x + dx, hh, z + dz], [x - dx, hh, z - dz]];
        const U = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
        for (const idx of [0, 1, 2, 0, 2, 3]) { pos.push(...P[idx]); nor.push(0, 1, 0); uv.push(...U[idx]); colA.push(shade, shade * (0.95 + Math.random() * 0.1), shade); }
      }
    };
    for (let z = -size / 2 + rowSp / 2; z < size / 2; z += rowSp)
      for (let x = -size / 2 + plantSp / 2; x < size / 2; x += plantSp)
        add(x + (Math.random() - 0.5) * jitter, z + (Math.random() - 0.5) * jitter * 0.3, Math.random() * 6.28, w * (0.8 + Math.random() * 0.4), h * (0.8 + Math.random() * 0.4), 0.8 + Math.random() * 0.3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
    return g;
  }

  // Hand fixes checked against the z18 mosaic, applied to the map data before anything is built from it (so the
  // surface raster, drains, walls, traffic and the minimap all follow): the Shivalayam junction.
  // The lane from the south keeps the map's alignment and curves into the CC road near (66,-340). The temple compound stands north of the CC road, gate on its east wall.
  function shivalayamFixes(D) {
    const near = (p, x, z) => Math.hypot(p[0] - x, p[1] - z) < 0.6;
    const cc = D.roads.find(r => r.t === 'cc' && r.p.some(p => near(p, 44.3, -333)) && r.p.some(p => near(p, 113.6, -351.5)));
    const lane = D.roads.find(r => r.t === 'lane' && r.p.some(p => near(p, 58.4, -329.5)));
    const dirt = D.roads.find(r => r.t === 'dirt' && r.p.some(p => near(p, 44.3, -333)));
    const lm = D.landmarks.find(l => l.name === 'Shivalayam Temple');
    if (!cc || !lane || !lm) return;
    const bez = (a, c, b, n) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u*u*a[0] + 2*u*t*c[0] + t*t*b[0], u*u*a[1] + 2*u*t*c[1] + t*t*b[1]]); } return o; };
    const r1 = q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10];
    // the CC road's kink at the north road junction becomes a curve; the dirt road joins at its middle
    const i = cc.p.findIndex(p => near(p, 44.3, -333)), P = cc.p[i], A = cc.p[i - 1 < 0 ? 0 : i - 1], B = cc.p[i + 1];
    const off = (from, to, d) => { const l = Math.hypot(to[0] - from[0], to[1] - from[1]); return [from[0] + (to[0] - from[0]) * d / l, from[1] + (to[1] - from[1]) * d / l]; };
    const arc = bez(off(P, A, 9), P, off(P, B, 9), 8).map(r1);
    cc.p.splice(i, 1, ...arc);
    if (dirt) { const k = dirt.p.findIndex(p => near(p, 44.3, -333)); dirt.p[k] = arc[4]; }
    // the lane: round the temple's east side, then one curve into the CC road eastbound
    const J = cc.p.findIndex(p => near(p, 113.6, -351.5)), a = cc.p[J - 1], b = cc.p[J];
    const onCC = x => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
    const I = onCC(66), E = r1(onCC(80));
    cc.p.splice(J, 0, E);
    const path = [[50.3, -300.5], [49.3, -306.9], ...bez([58.4, -329.5], I, E, 10)].map(r1);   // the map's own alignment; only its last stretch curves into the CC road
    const k = lane.p.findIndex(p => near(p, 58.4, -329.5)), rest = lane.p.slice(0, k).concat(lane.p.slice(k + 2));   // drops the two stale vertices
    lane.p = k === 0 ? path.reverse().concat(rest) : rest.concat(path);
    // The real compound (Street View pano B-n88abR6EtJXHJ3DJpDQw at 17.70462 N 79.19677 E, heading 340, shows the red-striped wall, pink
    // plinth and gate; Google Maps imagery shows the walled plot 15-20 m north of that road, east wall facing the north road). Gate on the east wall.
    lm.x = 34.7; lm.z = -351.5; lm.face = 1.325; lm.Rx = 10; lm.Rz = 11.5;
    (window.NELLUTLA_EXCLUDE = window.NELLUTLA_EXCLUDE || []).push({ x: 40.5, z: -341.7, r: 2 }, { x: 35.2, z: -362.4, r: 2 });   // ML footprints of the compound's own shed and north range
    { const c = Math.cos(lm.face), s = Math.sin(lm.face), inside = (x, z) => { const dx = x - lm.x, dz = z - lm.z; return Math.abs(dx * c - dz * s) < lm.Rx + 1 && Math.abs(dx * s + dz * c) < lm.Rz + 1; };
      D.walls = D.walls.filter(w => !inside((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)); }
  }
  // Raised land opposite the safe house: a rounded plateau about a car high (1.4 m) with grassy sloped sides, north of
  // lane east_diag and east of the lane running north from the gate. A height field only (no mesh here): streetscape.js
  // draws it, groundY() in index.html adds it, so cars, walkers and anything else sampling groundY climb it.
  const LAND = { x: 53.3, z: -270.7, ux: 0.895, uz: 0.446, nx: 0.446, nz: -0.895, a: 9.6, d: 10.5, ha: 6.5, hd: 2.6, slope: 4.6, h: 1.4, r: 2 };
  // landRaw: the drawn surface. The road-side slope is stretched so its toe runs under the road edge, with a thin turf
  // floor, so no bare strip is left. landAt: the same, cut off at the road edges (road height comes from surfaceAt).
  // Second raised plot: west of the mud lane, north of the cement lane (the green plot opposite the gate in the photos).
  const LAND2 = { x: 53.3, z: -270.7, ux: 0.8767, uz: 0.4808, nx: 0.4808, nz: -0.8767, a: -16, d: 8, ha: 5, hd: 2.5, slope: 4, h: 1.0, r: 1.2, toe: 2.7 };
  // Third raised plot: the open ground past the brick heap, south of the lane between the house's east wall and the white
  // compounds. Same profile as the others; its slope starts just beyond the drain and is notched around the heap.
  const LAND3 = { x: 53.3, z: -270.7, ux: 0.8978, uz: 0.4403, nx: -0.4403, nz: 0.8978, a: 8.5, d: 19, ha: 6, hd: 7, slope: 3.2, h: 1.4, r: 2, toe: 5.4 };
  // The open play ground west of the house: barely raised, gentle edges, dirt with patchy grass.
  const LAND4 = { x: 18.5, z: -268, ux: 1, uz: 0, nx: 0, nz: 1, a: 0, d: 0, ha: 5, hd: 5, slope: 3, h: 0.4, r: 2, toe: -10, patchy: true };
  // The overgrown land between the lane and the house's west wall (photos 74-76): rises from just past the road edge and keeps climbing
  // right up to the lilac wall, no flat top and no gap. a, b: the safe house's frame (safehouse2.js).
  const LAND5 = { x: 50.43, z: -264.19, ux: 0.889, uz: 0.458, nx: -0.458, nz: 0.889, a: -33, d: 3.5, ha: 14, hd: 8.5, slope: 0, h: 1.3, area: true };
  // The shrub land carried north to the red-tile house: same height, sloping down to the foot of its south wall (wall at d 2.8, axes = the house's)
  const LAND6 = { x: 63.5, z: -297.5, ux: 0.995, uz: -0.0998, nx: 0.0998, nz: 0.995, a: 2.5, d: 12, ha: 12, hd: 9.5, slope: 0, h: 1.4, area: true };
  function land6Raw(x, z) {
    const dx = x - LAND6.x, dz = z - LAND6.z, u = dx * LAND6.ux + dz * LAND6.uz, v = dx * LAND6.nx + dz * LAND6.nz, sm = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
    const h = LAND6.h * sm((v - 3.2) / 4.3) * sm((21 - v) / 3) * sm((x - 52.1 - 1.2 * (z + 283.1) / 12.4 - 2.8) / 3.2) * sm((13.5 - u) / 3.5);
    return h < 0.03 ? 0 : h;
  }
  const laneOff = (x, z) => (x - 20.3) * -0.4806 + (z + 288.8) * 0.8769;   // metres south of the cement lane's centre line
  function land5Raw(x, z) {
    const dx = x - LAND5.x, dz = z - LAND5.z, a = dx * LAND5.ux + dz * LAND5.uz, b = dx * LAND5.nx + dz * LAND5.nz, o = laneOff(x, z);
    if (a >= -19.42 || a < -46.5 || o < 2.7 || b > 12) return 0;
    const sm = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }, k = Math.max(sm((z + 281.5) / 2.5), sm((x - 17.5) / 3)), h = LAND5.h * sm((o - 2.7) / 5) * sm((a + 46.5) / 8) * sm((12 - b) / 3) * k;   // k: the green house keeps its own level
    return h < 0.03 ? 0 : h;
  }
  // turf skin from the road edge to where the raster stops being road: the land reaches the slab with no bare strip; the road stays level
  function land5Skin(x, z) { const dx = x - LAND5.x, dz = z - LAND5.z, a = dx * LAND5.ux + dz * LAND5.uz, b = dx * LAND5.nx + dz * LAND5.nz, o = laneOff(x, z); return a < -19.42 && a > -38 && x > 18 && b < 12 && o >= 1.62 && o < 3.4 ? 0.075 : 0; }
  // The house stands on a raised plot: yard and house YARD_H above the road. Frame as safehouse2.js. The car bay is a ramp from the
  // main gate up into the yard, feathered into the yard on both sides; a short ramp at the pedestrian gate (drawn as steps).
  const YARD_H = 0.85, YF = { ux: 13.2 / 14.857, uz: 6.8 / 14.857, a0: -19.5, a1: -1.1, b0: -5.2, b1: 18.5, ac: -4.25, hw: 2.05, fade: 1, rl: 5 };
  YF.x = 38.8 + 14 * YF.ux - 1.8 * YF.uz; YF.z = -272.2 + 14 * YF.uz + 1.8 * YF.ux;
  function yardAt(x, z) {
    const dx = x - YF.x, dz = z - YF.z, a = dx * YF.ux + dz * YF.uz, b = -dx * YF.uz + dz * YF.ux;
    if (a > -10.3 && a < -8.5 && b > YF.b0 - 0.85 && b <= YF.b0) return YARD_H * (b - YF.b0 + 0.85) / 0.85;
    if (a <= YF.a0 || a >= YF.a1 || b <= YF.b0 || b >= YF.b1) return 0;
    const t = Math.min(1, (b - YF.b0) / YF.rl), k = Math.min(1, Math.max(0, (Math.abs(a - YF.ac) - YF.hw) / YF.fade));
    return YARD_H * (t + (1 - t) * k);
  }
  function floorAt(x, z) { const dx = x - YF.x, dz = z - YF.z, a = dx * YF.ux + dz * YF.uz, b = -dx * YF.uz + dz * YF.ux; return a > YF.a0 && a < YF.a1 && b > YF.b0 && b < YF.b1; }
  const HEAP3 = { a: 14.34, d: 5, ra: 5, rd: 1.7 };   // the rubble heap (streetscape.js) in LAND3 axes
  const mudX = z => 52.1 + 1.2 * (z + 283.1) / 12.4;      // centre line of the mud lane
  function plateau(L0, x, z) {
    const dx = x - L0.x, dz = z - L0.z;
    if (dx * dx + dz * dz > 1600) return 0;
    const ld = dx * L0.nx + dz * L0.nz - L0.d; let od = Math.abs(ld) - L0.hd; if (ld < 0 && od > 0) od *= L0.slope / (L0.d - L0.hd - (L0.toe || 1));
    const qa = Math.abs(dx * L0.ux + dz * L0.uz - L0.a) - L0.ha + L0.r, qd = od + L0.r;
    const sd = Math.hypot(Math.max(qa, 0), Math.max(qd, 0)) + Math.min(Math.max(qa, qd), 0) - L0.r;   // rounded box distance
    if (sd <= 0) return L0.h;
    if (sd >= L0.slope) return 0;
    const t = 1 - sd / L0.slope, v = Math.max(0.036, L0.h * t * t * (3 - 2 * t));
    if (L0 === LAND3 || L0 === LAND4) return v;
    const c = (drainDist(x, z) - 0.55) / 1.2;   // the bank stands back from the channel
    return c <= 0 ? 0 : c >= 1 ? v : v * c < 0.036 ? 0 : v * c;
  }
  function land2Raw(x, z) {
    const e = (mudX(z) - x - 2.8) / 3; if (e <= 0) return 0;                 // fades out before the drain of the mud lane
    const k = e >= 1 ? 1 : e * e * (3 - 2 * e), h = plateau(LAND2, x, z);
    return h > 0 ? Math.max(0.036, h * k) : 0;
  }
  function land3Raw(x, z) {
    const h = plateau(LAND3, x, z); if (h <= 0) return 0;
    const dx = x - LAND3.x, dz = z - LAND3.z, ea = (dx * LAND3.ux + dz * LAND3.uz - HEAP3.a) / HEAP3.ra, ed = (dx * LAND3.nx + dz * LAND3.nz - HEAP3.d) / HEAP3.rd, e = (ea * ea + ed * ed - 1) / 0.9;
    if (e <= 0) return 0;
    const k = e >= 1 ? 1 : e * e * (3 - 2 * e); return Math.max(0.036, h * k);
  }
  function landRaw(x, z) { return Math.max(plateau(LAND, x, z), land2Raw(x, z), land3Raw(x, z), plateau(LAND4, x, z), land5Raw(x, z), land5Skin(x, z), land6Raw(x, z)); }
  function landAt(x, z) {
    if (floorAt(x, z) || yardAt(x, z) > 0) return yardAt(x, z);
    const L0 = LAND, dx = x - L0.x, dz = z - L0.z, h3 = land3Raw(x, z), h4 = plateau(LAND4, x, z);
    if (h3 > 0) return h3;
    if (h4 > 0 || land5Raw(x, z) > 0) return Math.max(h4, land5Raw(x, z));
    if (Math.abs(x - mudX(z)) < 2) return 0;
    if (x > mudX(z)) return Math.max(land6Raw(x, z), dx * L0.nx + dz * L0.nz < 2.1 ? 0 : plateau(LAND, x, z));
    return dx * LAND2.nx + dz * LAND2.nz < 2.7 ? 0 : land2Raw(x, z);
  }

  // The speed breaker opposite the gate divides the surface: lane opposite the house = mud; house side = cement.
  // Both keep the reduced 3.2 m width. D.roads keeps its topology (traffic, walkers, auto rides run the whole polylines);
  // only what is drawn or raster-sampled reads visibleRoads().
  const BRK = { x: 52.08, z: -274.43, lx: 0.889, lz: 0.458, nx: -0.458, nz: 0.889, bx: 52.98, bz: -273.97 };   // n points to the house
  const SPANS = [
    { a: [20.3, -288.8], b: [53.3, -270.7], w: 3.2, t: 'lane' }, { a: [BRK.bx, BRK.bz], b: [53.3, -270.7], w: 3.2, t: 'lane', cap: true },
    { a: [52.1, -283.1], b: [BRK.bx, BRK.bz], w: 3.2, t: 'dirt', cap: true }, { a: [50.3, -300.5], b: [52.1, -283.1], w: 3.2, t: 'dirt' },
  ];
  // The street's one open channel (photos 57-61): the north edge of the lane, opposite the house gates, from end to end, lengthwise
  // under the breaker at the mud lane's mouth. Two open runs meet at the culvert mouths. No walls and no colliders: wheels drop in
  // (dipAt, added to groundY), walkers step or jump over. streetscape.js draws it.
  const DIP = { off: 2.3, w: 0.55, edge: 0.12, depth: 0.1 };
  const CULV = { w: [48.42, -275.54], e: [55.6, -272.1] };
  function offLine(P, off) {
    return P.map((b, i) => {
      const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)], l0 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l1 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
      const n0 = i ? [-(b[1] - a[1]) / l0, (b[0] - a[0]) / l0] : [-(c[1] - b[1]) / l1, (c[0] - b[0]) / l1], n1 = i < P.length - 1 ? [-(c[1] - b[1]) / l1, (c[0] - b[0]) / l1] : n0;
      let mx = n0[0] + n1[0], mz = n0[1] + n1[1]; const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      const k = off / (mx * n0[0] + mz * n0[1]); return [b[0] + mx * k, b[1] + mz * k];
    });
  }
  let DRUNS = [];
  function drainRun(D) {
    const r = D.roads.find(q => q.p.some(p => Math.hypot(p[0] - 79.4, p[1] + 257.9) < 0.6) && q.p.some(p => Math.hypot(p[0] - 20.3, p[1] + 288.8) < 0.6));
    if (!r) return;
    r.drainRoad = true;
    const ix = (x, z) => r.p.findIndex(p => Math.hypot(p[0] - x, p[1] - z) < 0.6), I = ix(20.3, -288.8), J = ix(53.3, -270.7);
    const trim = (R, e) => { const i = e ? R.length - 1 : 0, a = R[i], b = R[e ? i - 1 : 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); R[i] = [a[0] + (b[0] - a[0]) * 2.6 / l, a[1] + (b[1] - a[1]) * 2.6 / l]; return R; };
    DRUNS = [trim([...offLine(r.p.slice(0, I + 1), -DIP.off), CULV.w], false), trim([CULV.e, ...offLine(r.p.slice(J + 1), -DIP.off)], true)];
  }
  function drainDist(x, z) {
    let b = 1e9;
    for (const R of DRUNS) for (let i = 0; i < R.length - 1; i++) { const a = R[i], c = R[i + 1]; if (Math.abs(x - (a[0] + c[0]) / 2) > Math.abs(c[0] - a[0]) / 2 + 2) continue; const vx = c[0] - a[0], vz = c[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz))); b = Math.min(b, Math.hypot(a[0] + vx * t - x, a[1] + vz * t - z)); }
    return b;
  }
  function dipAt(x, z) {
    if (x < 0 || x > 285 || z > -205 || z < -305) return 0;
    const d = drainDist(x, z), hw = DIP.w / 2; if (d >= hw + DIP.edge) return 0;
    const t = Math.min(1, (hw + DIP.edge - d) / DIP.edge); return -DIP.depth * t * t * (3 - 2 * t);
  }
  const MUD_COL = '#e8dcc6';
  function visibleRoads(D) {
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.6, out = [];
    for (const r0 of D.roads) {
      let r = r0;
      for (let i = 0; i < r.p.length - 1; i++) { const a = r.p[i], b = r.p[i + 1];   // split the lane at the breaker
        if ((near(a, [52.1, -283.1]) && near(b, [53.3, -270.7])) || (near(b, [52.1, -283.1]) && near(a, [53.3, -270.7]))) { r = { ...r, p: [...r.p.slice(0, i + 1), [BRK.bx, BRK.bz], ...r.p.slice(i + 1)] }; break; } }
      const cuts = [];
      for (const m of SPANS) for (let i = 0; i < r.p.length - 1; i++)
        if ((near(r.p[i], m.a) && near(r.p[i + 1], m.b)) || (near(r.p[i], m.b) && near(r.p[i + 1], m.a))) cuts.push({ i, m });
      if (!cuts.length || r.t === 'dirt') { out.push(r); continue; }
      cuts.sort((p, q) => p.i - q.i);
      let from = 0;
      for (const c of cuts) {
        if (c.i > from) out.push({ ...r, p: r.p.slice(from, c.i + 1) });
        out.push({ ...r, t: c.m.t, w: c.m.w, mud: c.m.t === 'dirt', plain: c.m.t === 'lane', cap: c.m.cap, p: r.p.slice(c.i, c.i + 2) });
        from = c.i + 1;
      }
      if (from < r.p.length - 1) out.push({ ...r, p: r.p.slice(from) });
    }
    return out;
  }
  // the pink two-storey house north of the gate lane is really one storey
  function houseLaneFixes(D) {
    // No road beside the house: on the imagery the lane from the south stops at the east-west lane near (48,-226); the
    // stretch up to the junction at (54,-270) was never there. It now ends on that lane, at a shared vertex (routes follow).
    const sn = D.roads.find(r => r.t === 'lane' && Math.hypot(r.p[0][0] - 54, r.p[0][1] + 270) < 2 && Math.hypot(r.p[1][0] - 48, r.p[1][1] + 228) < 3);
    const ew = D.roads.find(r => r !== sn && r.p.some(p => Math.hypot(p[0] - 15, p[1] + 234) < 2) && r.p.some(p => Math.hypot(p[0] - 57, p[1] + 224) < 2));
    if (sn) { sn.p.shift();
      if (ew) { const i = ew.p.findIndex((p, k) => k && p[0] > sn.p[0][0]), A = ew.p[i - 1], B = ew.p[i], t = (sn.p[0][0] - A[0]) / (B[0] - A[0]), J = [sn.p[0][0], Math.round((A[1] + (B[1] - A[1]) * t) * 10) / 10]; ew.p.splice(i, 0, J); sn.p[0] = J; } }
    // the mud lane south, past the brick heap and well clear of the house: on the imagery it leaves the CC lane near (76,-259), passes west of the
    // (77,-249) houses and takes the alley between the (63,-235) and (75,-228) blocks down to the east-west lane. Shared vertices at both ends.
    { const dg = D.roads.find(r => r.p.some(p => Math.hypot(p[0] - 53.3, p[1] + 270.7) < 0.6) && r.p.some(p => Math.hypot(p[0] - 79.4, p[1] + 257.9) < 0.6)), J = [76.5, -259.3], K = [66.2, -219.1];
      if (dg && ew) { dg.p.splice(dg.p.findIndex(p => Math.hypot(p[0] - 79.4, p[1] + 257.9) < 0.6), 0, J); ew.p.splice(ew.p.findIndex((p, k) => k && p[0] > K[0]), 0, K);
        D.roads.push({ t: 'lane', n: 'heap_ns', w: 3, mud: true, p: [J, [75.7, -252], [75.2, -245], [72.6, -240.5], [71.7, -236], [69.6, -230], [67.4, -224], K] }); } }
    for (const b of D.buildings) {
      const n = b.p.length, x = b.p.reduce((s, q) => s + q[0], 0) / n, z = b.p.reduce((s, q) => s + q[1], 0) / n;
      if (Math.hypot(x - 58.9, z + 289.3) < 1.5) b.h = 3.2;
      if (Math.abs(x - 75) < 6 && z > -237 && z < -216) for (const q of b.p) if (q[0] < 73.5) { q[0] += 1.5; q[1] += 0.45; }   // the alley is wider than this block's traced footprint: a car passes
      if (Math.hypot(x - 92.6, z + 261.6) < 1.5) b.h = 3.2;   // nothing two-storey behind the blue house (photo 47)
    }
  }

  function build(scene, D) {
    shivalayamFixes(D);
    houseLaneFixes(D);
    drainRun(D);
    const VR = visibleRoads(D);
    const noDrain = r => r.drainRoad;
    const [xmin, zmin, xmax, zmax] = D.bounds;
    const W = xmax - xmin, H = zmax - zmin, cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;
    const group = new THREE.Group(); group.name = 'Nellutla'; scene.add(group);
    const CH = 160, chunkList = [];                         // spatial chunk size (m) + chunk LOD registry (see splitIM)
    let chunkX = 1e9, chunkZ = 1e9; const mirrors = [], chunkIMs = new Set();
    const col = new THREE.Color();

    // ---------------- ground: land-cover classes painted to a canvas
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 4096; groundCanvas.height = Math.round(4096 * H / W);
    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.anisotropy = 8;
    // per-field attributes for the ground shader: R = class, G = row direction, B = per-field random
    const FI = (D.fields || []).map(fieldInfo);
    const cropAtlasTex = cropAtlas();
    const fieldCanvas = document.createElement('canvas');
    fieldCanvas.width = 2048; fieldCanvas.height = Math.round(2048 * H / W);
    {
      const g = fieldCanvas.getContext('2d'), fx = fieldCanvas.width / W, fz = fieldCanvas.height / H;
      g.fillStyle = '#000'; g.fillRect(0, 0, fieldCanvas.width, fieldCanvas.height);
      for (const f of FI) {
        g.fillStyle = `rgb(${(f.c + 1) * 16},${Math.round(f.ang / Math.PI * 255)},${Math.round(f.h * 255)})`;
        g.beginPath(); f.p.forEach((q2, k) => k ? g.lineTo((q2[0] - xmin) * fx, (q2[1] - zmin) * fz) : g.moveTo((q2[0] - xmin) * fx, (q2[1] - zmin) * fz)); g.fill();
      }
    }
    const fieldTex = new THREE.CanvasTexture(fieldCanvas);
    fieldTex.magFilter = fieldTex.minFilter = THREE.NearestFilter; fieldTex.generateMipmaps = false;
    const gmat = new THREE.MeshLambertMaterial({ map: groundTex });
    const detail = detailTexture();
    gmat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.fieldMap = { value: fieldTex };
      sh.uniforms.fieldBox = { value: new THREE.Vector4(xmin, zmin, W, H) };
      sh.fragmentShader = 'uniform sampler2D detailMap;\nuniform sampler2D fieldMap;\nuniform vec4 fieldBox;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        `#include <map_fragment>
         float d1 = texture2D(detailMap, vUv * 900.0).r;
         float d2 = texture2D(detailMap, vUv * 140.0).r;
         float d3 = texture2D(detailMap, vUv * 3100.0).r;
         float camD = gl_FragCoord.z / gl_FragCoord.w;
         diffuseColor.rgb *= 0.55 + 0.45 * d1 + 0.45 * d2 + (d3 - 0.5) * 0.5 * clamp(1.0 - camD / 90.0, 0.0, 1.0);
         float green = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
         if (green > 0.015) {
           float rows = 0.5 + 0.5 * sin(vUv.x * 2600.0 + vUv.y * 600.0);
           float fade = clamp(1.0 - (gl_FragCoord.z / gl_FragCoord.w) / 120.0, 0.0, 1.0); diffuseColor.rgb *= mix(1.0, 0.86 + 0.2 * rows, clamp(green * 14.0, 0.0, 1.0) * fade);
         }
         // field patterns: crop rows along each field's long axis, ploughed furrows, paddy water, stubble
         vec4 fa = texture2D(fieldMap, vUv);
         float fcv = fa.r * 255.0 / 16.0;
         if (fa.r > 0.03 && abs(fract(fcv + 0.5) - 0.5) < 0.12) {
           float fc = floor(fcv + 0.5) - 1.0;
           float an = fa.g * 3.14159265;
           vec2 wp = vec2(fieldBox.x + vUv.x * fieldBox.z, fieldBox.y + (1.0 - vUv.y) * fieldBox.w);
           vec2 dir = vec2(cos(an), sin(an));
           float across = dot(wp, vec2(-dir.y, dir.x)), along = dot(wp, dir);
           float nf = clamp(1.0 - camD / 260.0, 0.0, 1.0);
           if (fc > 3.5 && fc < 4.5) {
             float sp = 0.75 + fa.b * 0.3;
             float r = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(across * 6.2832 / sp));
             vec3 soil = vec3(0.45, 0.36, 0.25) * (0.8 + 0.4 * d2);
             diffuseColor.rgb = mix(diffuseColor.rgb, mix(soil, diffuseColor.rgb * 1.12, r), 0.75 * nf);
           } else if (fc > 0.5 && fc < 1.5) {
             float r = sin(across * 6.2832 / 0.42) + 0.35 * sin(across * 6.2832 / 0.17 + d1 * 3.0);
             diffuseColor.rgb *= 1.0 + 0.16 * r * nf;
           } else if (fc > 1.5 && fc < 3.5) {
             float r = 0.5 + 0.5 * sin(across * 6.2832 / 0.25);
             diffuseColor.rgb *= 1.0 + (r - 0.5) * 0.16 * nf;
             float wet = fc > 2.5 ? 0.55 : 0.18;
             float sheen = smoothstep(0.55, 0.9, d2) * wet;
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.60, 0.62), sheen * (1.0 - r * 0.6));
           } else if (fc > 4.5 && fc < 5.5) {
             float row = step(0.62, fract(across / 0.28));
             float cut = step(0.45, fract(along / 0.18 + floor(across / 0.28) * 0.37));
             diffuseColor.rgb *= 1.0 + (row * cut * 0.22 - 0.06) * nf;
           }
         }`);
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), gmat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz); ground.receiveShadow = true;
    group.add(ground);
    // outer fields to the horizon
    const outer = new THREE.Mesh(new THREE.RingGeometry(Math.max(W, H) * 0.7, 9000, 64, 1),
      new THREE.MeshLambertMaterial({ color: 0x8f7a52 }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(cx, -0.05, cz); group.add(outer);
    const outerFill = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, H * 1.6), new THREE.MeshLambertMaterial({ color: 0x8f7a52 }));
    outerFill.rotation.x = -Math.PI / 2; outerFill.position.set(cx, -0.08, cz); group.add(outerFill);

    const lcImg = new Image();
    lcImg.onload = () => {
      const lc = D.landcover, t = document.createElement('canvas'); t.width = lc.w; t.height = lc.h;
      const tg = t.getContext('2d'); tg.drawImage(lcImg, 0, 0);
      const src = tg.getImageData(0, 0, lc.w, lc.h).data;
      // class colours from the imagery medians, tone-compensated like the parcels
      const lcCols = lc.cols ? lc.cols.map(c => fieldPaint({ m: c[0] << 16 | c[1] << 8 | c[2] })) : LC_COLS;
      const out = tg.createImageData(lc.w, lc.h);
      // per-field tint: low-freq random blobs
      const tintW = 64, tintH = Math.ceil(64 * lc.h / lc.w), tint = new Float32Array(tintW * tintH).map(() => 0.85 + Math.random() * 0.3);
      for (let y = 0; y < lc.h; y++) for (let x = 0; x < lc.w; x++) {
        const i = y * lc.w + x, k = src[i * 4], c = lcCols[k] || lcCols[0];
        const tv = tint[Math.floor(y / lc.h * tintH) * tintW + Math.floor(x / lc.w * tintW)];
        const n = 0.92 + Math.random() * 0.16;
        out.data[i*4] = c[0]*tv*n; out.data[i*4+1] = c[1]*tv*n; out.data[i*4+2] = c[2]*tv*n; out.data[i*4+3] = 255;
      }
      tg.putImageData(out, 0, 0);
      const g = groundCanvas.getContext('2d');
      g.imageSmoothingEnabled = true; g.drawImage(t, 0, 0, groundCanvas.width, groundCanvas.height);
      // dry river bed
      const sx = groundCanvas.width / W, sz = groundCanvas.height / H;
      g.lineCap = g.lineJoin = 'round';
      paintFieldsOnGround(g, sx, sz);
      for (const rv of D.river) {
        g.strokeStyle = 'rgb(214,196,160)'; g.lineWidth = 22 * sx; g.beginPath();
        rv.forEach((p, i) => i ? g.lineTo((p[0]-xmin)*sx, (p[1]-zmin)*sz) : g.moveTo((p[0]-xmin)*sx, (p[1]-zmin)*sz)); g.stroke();
        g.strokeStyle = 'rgba(120,140,110,0.5)'; g.lineWidth = 3 * sx; g.stroke();
      }
      // trampled earth around road edges
      g.strokeStyle = 'rgba(150,120,85,0.55)';
      for (const r of D.roads) {
        g.lineWidth = (r.w + 3) * sx; g.beginPath();
        r.p.forEach((p, i) => i ? g.lineTo((p[0]-xmin)*sx, (p[1]-zmin)*sz) : g.moveTo((p[0]-xmin)*sx, (p[1]-zmin)*sz)); g.stroke();
      }
      // village yards: packed earth with blotchy tone variation, grassy patches, damp ground beside the CC-lane drains
      try {
        for (const H of houses) {
          for (let k = 0; k < 7; k++) {
            const r = hash(H.cx * (k + 1.3), H.cz * (k + 0.7)), a = r * 6.283 * 7, d = 4 + r * 10;
            const X = (H.cx + Math.cos(a) * d - xmin) * sx, Z = (H.cz + Math.sin(a) * d - zmin) * sz, R = (2 + r * 5) * sx;
            const gr = g.createRadialGradient(X, Z, 0, X, Z, R);
            const c0 = k % 3 === 0 ? 'rgba(112,118,70,0.35)' : k % 3 === 1 ? 'rgba(120,96,70,0.35)' : 'rgba(196,176,140,0.3)';
            gr.addColorStop(0, c0); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - R, Z - R, R * 2, R * 2);
          }
        }
        g.strokeStyle = 'rgba(70,70,52,0.45)';
        for (const r of VR) if ((r.t === 'cc' || r.t === 'lane') && !r.plain && !noDrain(r)) {
          g.lineWidth = 1.6 * sx; g.beginPath();
          r.p.forEach((q2, i) => { const a = r.p[Math.max(0, i - 1)], c2 = r.p[Math.min(r.p.length - 1, i + 1)], L = Math.hypot(c2[0] - a[0], c2[1] - a[1]) || 1, nx = -(c2[1] - a[1]) / L, nz = (c2[0] - a[0]) / L, o = r.w / 2 + 1.0;
            const X = (q2[0] + nx * o - xmin) * sx, Z = (q2[1] + nz * o - zmin) * sz; i ? g.lineTo(X, Z) : g.moveTo(X, Z); });
          g.stroke();
        }
      } catch (e) { console.warn(e); }
      groundTex.needsUpdate = true;
      if (typeof paintMap === 'function') try { paintMap(lcImg); } catch (e) { console.warn(e); }
    };
    lcImg.src = 'data:image/png;base64,' + D.landcover.png;

    // parcels painted over the land-cover raster: class colour per field, bund lines, paddy channels, lake shore mud
    function paintFieldsOnGround(g, sx, sz) {
      const P = (q2) => [(q2[0] - xmin) * sx, (q2[1] - zmin) * sz];
      const path = (pts, close) => { g.beginPath(); pts.forEach((q2, k) => { const a = P(q2); k ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); if (close) g.closePath(); };
      for (const f of FI) {
        const c = fieldPaint(f);
        g.globalAlpha = f.c === 7 ? 0.85 : 1;
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; path(f.p, true); g.fill();
      }
      g.globalAlpha = 1;
      // bunds: pale trodden earth with a grassy fringe
      g.lineWidth = Math.max(1, 0.9 * sx); g.strokeStyle = 'rgba(196,172,128,0.9)';
      for (const f of FI) { path(f.p, true); g.stroke(); }
      g.lineWidth = Math.max(0.6, 0.35 * sx); g.strokeStyle = 'rgba(112,124,70,0.55)';
      for (const f of FI) { path(f.p, true); g.stroke(); }
      // paddy feeder channels: one long edge of most paddy fields carries water from the bore well
      g.lineWidth = Math.max(0.8, 0.7 * sx); g.strokeStyle = 'rgba(70,92,96,0.85)';
      for (const f of FI) if ((f.c === 2 || f.c === 3) && f.h < 0.7) {
        const e = longEdge(f); path([e[0], e[1]]); g.stroke();
      }
      // lake: wet mud and dry cracked shore around the water line
      for (const lk of D.lakes) {
        g.strokeStyle = 'rgb(150,128,96)'; g.lineWidth = 16 * sx; path(lk, true); g.stroke();
        g.strokeStyle = 'rgb(102,88,66)'; g.lineWidth = 7 * sx; g.stroke();
      }
    }
    function longEdge(f) {
      let best = null;
      for (let k = 0; k < f.p.length; k++) { const a = f.p[k], b = f.p[(k + 1) % f.p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || L > best[2]) best = [a, b, L]; }
      return best;
    }
    // water: Jangaon cheruvu, a shallow tank with a glossy surface
    const waterMat = new THREE.MeshPhongMaterial({ color: 0x3b6670, specular: 0x6a8a90, shininess: 60, transparent: true, opacity: 0.93 });
    for (const lk of D.lakes) {
      const sh = new THREE.Shape(lk.map(p => new THREE.Vector2(p[0], -p[1])));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), waterMat);
      m.rotation.x = -Math.PI / 2; m.position.y = 0.04; m.receiveShadow = true; group.add(m);
    }

    // ---------------- roads
    const RT = makeRoadTextures();
    // CC0 photo textures (innova-nellutla/assets.js, Poly Haven) when the game provides them; procedural canvases otherwise.
    // The game renders with linear output like the canvas textures, so the colour maps are kept linear too.
    const CC0 = (name, rx, ry, fallback) => {
      if (typeof window === 'undefined' || !window.Assets || !Assets.tex) return fallback;
      const t = Assets.tex(name, { repeat: [rx, ry === undefined ? rx : ry] }).map;
      if (!t) return fallback;
      t.encoding = THREE.LinearEncoding; t.anisotropy = 8;
      return t;
    };
    // road UVs: u = 0..1 across the road, v = metres / width along it, so one tile is one road width square
    RT.asphalt = CC0('asphalt', 1, 1, RT.asphalt);
    RT.concrete = CC0('ccroad', 1, 1, RT.concrete);
    RT.dirt = CC0('dirt', 1, 1, RT.dirt);
    const roadBuilders = {};
    VR.forEach((r, i) => {
      const st = ROAD_STYLE[r.t] || ROAD_STYLE.dirt;
      const b = roadBuilders[r.t] || (roadBuilders[r.t] = new Builder());
      ribbon(b, r.p, r.w, st.y + (i % 4) * 0.004, col.set(r.mud ? MUD_COL : st.col), 0, r.cap ? BRK : null);
    });
    // ragged road edges (alpha-tested) over soft dirt shoulders that fade into the fields
    const raggedA = edgeAlphaTexture(false), softA = edgeAlphaTexture(true);
    for (const t in roadBuilders) {
      const st = ROAD_STYLE[t];
      const mat = new THREE.MeshLambertMaterial({ map: RT[st.tex], vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
        alphaMap: t === 'highway' ? null : raggedA, alphaTest: t === 'highway' ? 0 : 0.5 });
      const m = roadBuilders[t].mesh(mat); m.receiveShadow = true; group.add(m);
    }
    const shoulderB = new Builder(), shCol = new THREE.Color(0x9c8460);
    VR.forEach(r => { if (r.t !== 'dirt' || r.mud) ribbon(shoulderB, r.p, r.w + (r.t === 'highway' ? 4 : r.mud ? 1.6 : 3), 0.03, shCol); });
    const shm = shoulderB.mesh(new THREE.MeshLambertMaterial({ map: RT.dirt, alphaMap: softA, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    shm.receiveShadow = true; shm.renderOrder = -1; group.add(shm);
    // cracks, oil stains and patch repairs on the concrete streets
    const decB = new Builder(), decTex = roadDecalTexture(), white1 = new THREE.Color(1, 1, 1);
    for (const r of VR) if (r.t === 'cc' || r.t === 'tar' || r.t === 'lane') {
      const y = (ROAD_STYLE[r.t].y) + 0.02;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], c2 = r.p[i+1], L = Math.hypot(c2[0]-a[0], c2[1]-a[1]); if (L < 2) continue;
        const ux = (c2[0]-a[0]) / L, uz = (c2[1]-a[1]) / L;
        for (let d = 2 + rnd() * 4; d < L; d += 4 + rnd() * 7) {
          const off = (rnd() - 0.5) * (r.w - 1.2), x = a[0] + ux * d - uz * off, z = a[1] + uz * d + ux * off;
          const sz = 0.7 + rnd() * 1.6, an = rnd() * 6.28, ca = Math.cos(an) * sz / 2, sa = Math.sin(an) * sz / 2;
          const cell = Math.floor(rnd() * 4), u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
          decB.quad([x - ca + sa, y, z - sa - ca], [x + ca + sa, y, z + sa - ca], [x + ca - sa, y, z + sa + ca], [x - ca - sa, y, z - sa + ca], [0, 1, 0],
            [[u0, v0 + 0.5], [u0 + 0.5, v0 + 0.5], [u0 + 0.5, v0], [u0, v0]], white1);
        }
      }
    }
    const decm = decB.mesh(new THREE.MeshLambertMaterial({ map: decTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    decm.receiveShadow = true; group.add(decm);
    const mk = new Builder(), white = new THREE.Color(0xf2f2f2), yellow = new THREE.Color(0xf2c230);
    for (const r of D.roads) {
      if (r.t === 'highway') {
        marking(mk, r.p, 0, 0.15, 0.14, white, 3, 6);
        marking(mk, r.p, r.w/2 - 0.35, 0.15, 0.14, white);
        marking(mk, r.p, -(r.w/2 - 0.35), 0.15, 0.14, white);
      } else if (r.t === 'tar') marking(mk, r.p, 0, 0.12, 0.12, white, 2, 7);
    }
    group.add(mk.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));
    // open drains along CC streets (seen in street view)
    const drain = new Builder(), drainCol = new THREE.Color(0x353b33);
    for (const r of VR) if ((r.t === 'cc' || r.t === 'lane') && !r.plain && !noDrain(r)) {
      const off = r.w/2 + 0.35;
      marking(drain, r.p, off, 0.55, 0.08, drainCol);
    }
    group.add(drain.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

    // ---------------- landmark footprints: clear the plot for modelled landmarks, repaint civic buildings
    const centroid = b => [b.p.reduce((s2, q2) => s2 + q2[0], 0) / b.p.length, b.p.reduce((s2, q2) => s2 + q2[1], 0) / b.p.length];
    const CLEAR_R = { temple: 9, fuel: 16, busstop: 5, tank: 6 };
    const CIVIC = { school: '#f3d27a', hospital: '#f4f4ee', clinic: '#f4f4ee', anganwadi: '#f6a04d', hall: '#cfe8c8', factory: '#d9d6cf' };
    const EXCL = (typeof window !== 'undefined' && Array.isArray(window.NELLUTLA_EXCLUDE)) ? window.NELLUTLA_EXCLUDE.filter(e => e && isFinite(e.x) && isFinite(e.z) && isFinite(e.r)) : [];
    D.buildings = D.buildings.filter(b => {
      const [x, z] = centroid(b);
      if (EXCL.some(e => !e.walls && Math.hypot(e.x - x, e.z - z) < (e.r || 0))) return false;
      return !D.landmarks.some(l => CLEAR_R[l.k] && Math.hypot(l.x - x, l.z - z) < CLEAR_R[l.k]);
    });
    // entries with walls: true remove compound-wall segments whose midpoint is inside instead of buildings
    const EXW = EXCL.filter(e => e.walls);
    if (EXW.length) D.walls = D.walls.filter(w => !EXW.some(e => Math.hypot(e.x - (w[0] + w[2]) / 2, e.z - (w[1] + w[3]) / 2) < e.r));
    for (const l of D.landmarks) if (CIVIC[l.k]) {
      let best = null;
      for (const b of D.buildings) { const [x, z] = centroid(b), d = Math.hypot(l.x - x, l.z - z); if (d < 40 && (!best || d < best.d)) best = { d, b }; }
      if (best) { best.b.paint = CIVIC[l.k]; best.b.r = 'rcc'; l.bld = best.b; }
    }

    // quick lookups used while placing buildings and trees
    const roadSegs = [];
    for (const r of VR) for (let i = 0; i < r.p.length - 1; i++) roadSegs.push([r.p[i], r.p[i+1], r.t, r.w]);
    // keep the carriageway clear: nearest road edge, push-off for props/poles, plus open areas other modules declare
    // (window.NELLUTLA_CLEAR: [{x, z, r}] e.g. the earth plaza in streetscape.js)
    const CLEAR = (typeof window !== 'undefined' && Array.isArray(window.NELLUTLA_CLEAR)) ? window.NELLUTLA_CLEAR.filter(e => e && isFinite(e.x) && isFinite(e.z) && isFinite(e.r)) : [];
    function roadHit(x, z, pad) {           // deepest road (or clear zone) the point stands in: {dx, dz, need} push vector, or null
      let best = null;
      for (const [a, c, t, w] of roadSegs) {
        if (t === 'river') continue;
        if (Math.abs(a[0] - x) > 60 && Math.abs(c[0] - x) > 60) continue;
        const dx = c[0]-a[0], dz = c[1]-a[1], L2 = dx*dx + dz*dz || 1, tt = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / L2));
        const px = x - a[0] - tt*dx, pz = z - a[1] - tt*dz, d = Math.hypot(px, pz), need = w / 2 + pad - d;
        if (need > 0 && (!best || need > best.need)) {
          const L = Math.sqrt(L2), nx = d > 1e-3 ? px / d : -dz / L, nz = d > 1e-3 ? pz / d : dx / L;
          best = { nx, nz, need };
        }
      }
      for (const e of CLEAR) {
        const px = x - e.x, pz = z - e.z, d = Math.hypot(px, pz), need = e.r + pad - d;
        if (need > 0 && (!best || need > best.need)) best = { nx: d > 1e-3 ? px / d : 1, nz: d > 1e-3 ? pz / d : 0, need };
      }
      return best;
    }
    // move a point standing on a road to the nearest edge (+pad); null if it cannot be cleared (squeezed between roads)
    function pushOffRoad(x, z, pad) {
      for (let k = 0; k < 6; k++) { const h = roadHit(x, z, pad); if (!h) return [x, z]; x += h.nx * (h.need + 0.05); z += h.nz * (h.need + 0.05); }
      return roadHit(x, z, pad) ? null : [x, z];
    }
    // compound walls never run across a carriageway: cut them, leaving an opening where the road passes
    {
      const out = [];
      for (const w of D.walls) {
        const L = Math.hypot(w[2]-w[0], w[3]-w[1]); if (L < 0.05) continue;
        const n = Math.max(1, Math.ceil(L / 0.25)); let run = null;
        const flush = (t1) => { if (run !== null && (t1 - run) * L > 0.6) out.push([w[0] + (w[2]-w[0]) * run, w[1] + (w[3]-w[1]) * run, w[0] + (w[2]-w[0]) * t1, w[1] + (w[3]-w[1]) * t1]); run = null; };
        for (let i = 0; i <= n; i++) {
          const t = i / n, blocked = !!roadHit(w[0] + (w[2]-w[0]) * t, w[1] + (w[3]-w[1]) * t, 0.1);
          if (blocked) flush(Math.max(0, (i - 1) / n)); else if (run === null) run = t;
        }
        flush(1);
      }
      D.walls = out;
    }
    function surfaceAtEarly(x, z) {
      let best = 'field', bd = 1e9;
      for (const [a, c, t, w] of roadSegs) {
        if (Math.abs(a[0] - x) > 200 && Math.abs(c[0] - x) > 200) continue;
        const dx = c[0]-a[0], dz = c[1]-a[1], L2 = dx*dx + dz*dz || 1, tt = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / L2));
        const d = Math.hypot(x - a[0] - tt*dx, z - a[1] - tt*dz) - w / 2;
        if (d < 22 && d < bd) { bd = d; best = t; }
      }
      return best;
    }
    const bGrid = new Map();
    for (const b of D.buildings) { const k = Math.floor(b.p[0][0] / 20) + ',' + Math.floor(b.p[0][1] / 20); bGrid.set(k, (bGrid.get(k) || 0) + 1); }
    const nearBuilding = (x, z) => (bGrid.get(Math.floor(x / 20) + ',' + Math.floor(z / 20)) || 0) > 0;

    // ---------------- buildings (Telangana village style: plastered RCC houses, tiled and sheet roofs)
    const segs = [];           // collision segments
    const tanks = [], mumties = [];
    const FV = facadeVariants();
    // typical Telangana house paints: lime white, pista green, sky blue, pink, cream, yellow, lilac
    const PAINTS = ['#f1eee6', '#f1eee6', '#ebe4d2', '#a8d8a0', '#9fcbe8', '#f2b8c6', '#f5e08a', '#c9b3e0', '#f4c68a', '#8fd6c9', '#e8e2c8', '#b8e0b0'];
    const wallB = FV.map(() => new Builder());
    const roofs = new Builder(), parapets = new Builder(), ledges = new Builder(), tileRoofs = new Builder(), sheetRoofs = new Builder();
    const frames = new Builder(), railings = new Builder(), clothes = new Builder();
    const FRAME_COLS = ['#6b4a2e', '#5a3a22', '#f2f0ea', '#2f5d8a', '#3f6b3a', '#8a8f94', '#7a2f2f'];
    const stoneCol = new THREE.Color(0x8e8a80), revealCol = new THREE.Color(0x6e6a62);
    const roofCol = { rcc: 0xa39f96, tile: 0xb0583a, sheet: 0x5b86b8 };
    // real roof colour sampled from the satellite image, lifted out of the haze so it reads like the photo
    const hsl = {};
    function roofColour(b) {
      if (!b.rc) return col.setHex(roofCol[b.r]).clone();
      const c = new THREE.Color(b.rc); c.getHSL(hsl);
      return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), Math.min(0.92, hsl.l * 1.45 + 0.04));
    }
    const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
    const nearHighway = (x, z) => ['highway', 'tar'].includes(surfaceAtEarly(x, z));
    function inside(pt, poly) {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        if (((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1])) && (pt[0] < (poly[j][0]-poly[i][0]) * (pt[1]-poly[i][1]) / (poly[j][1]-poly[i][1]) + poly[i][0])) c = !c;
      return c;
    }
    const houses = [];          // per-building facade info for the near-detail pass
    const OLD_WALLS = ['#b49c80', '#a39a8c', '#c8b596', '#9c8f7e', '#d8cdb6'];   // mud, stone, lime-washed mud
    for (const b of D.buildings) {
      const p = b.p, h = b.h, n = p.length;
      const cx2 = p.reduce((s2, q2) => s2 + q2[0], 0) / n, cz2 = p.reduce((s2, q2) => s2 + q2[1], 0) / n;
      const oldHouse = b.r === 'tile' && !b.paint && hash(cx2 * 0.7, cz2 * 1.9) < 0.6;
      const c = col.set(oldHouse ? OLD_WALLS[Math.floor(hash(cz2, cx2 * 2.3) * OLD_WALLS.length)] : (b.paint || PAINTS[Math.floor(hash(b.p[0][0], b.p[0][1]) * PAINTS.length)])).clone();
      const EI = [];
      const shop = nearHighway(cx2, cz2) && b.a < 300;
      const frameColB = col.set(FRAME_COLS[Math.floor(hash(cz2, cx2) * FRAME_COLS.length)]).clone();
      for (let i = 0; i < n; i++) {
        const a = p[i], d = p[(i+1)%n], ex = d[0]-a[0], ez = d[1]-a[1], el = Math.hypot(ex, ez) || 1;
        let nx = ez/el, nz = -ex/el;
        let flip = false;
        if (inside([(a[0]+d[0])/2 + nx*0.3, (a[1]+d[1])/2 + nz*0.3], p)) { nx = -nx; nz = -nz; flip = true; }
        const r = hash(a[0], a[1]);
        let vIdx = r < 0.45 ? 0 : r < 0.62 ? 1 : r < 0.82 ? 2 : 3;     // window, door, blank, ventilator
        if (shop && el > 2.5 && r < 0.6) vIdx = 4;                       // rolling-shutter shops on main roads
        if (b.r === 'sheet' || b.a > 600) vIdx = 2;
        const u = Math.max(1, Math.round(el / 3.2));
        // u must run left-to-right as seen from outside, or shop boards read in mirror writing:
        // with the unflipped normal, a->d runs to the viewer's left, so the texture is reversed there
        const uvs = flip ? [[0,0],[u,0],[u,h/3.2],[0,h/3.2]] : [[u,0],[0,0],[0,h/3.2],[u,h/3.2]];
        wallB[vIdx].quad([a[0],0,a[1]],[d[0],0,d[1]],[d[0],h,d[1]],[a[0],h,a[1]],[nx,0,nz],uvs,c);
        segs.push([a[0], a[1], d[0], d[1]]);
        EI.push({ a, d, nx, nz, el, vIdx, u });
        // window surrounds, door frames and a door step, aligned with the facade texture
        if ((vIdx === 0 || vIdx === 1) && b.r !== 'sheet') {
          const tx = ex/el, tz = ez/el, tw = el / u, fc = frameColB;
          for (let f = 0; f * 3.2 + 2.35 < h + 0.01; f++) for (let k = 0; k < u; k++) {
            const y = f * 3.2;
            if (vIdx === 0) frameRect(frames, a, tx, tz, nx, nz, (k + 0.305) * tw, (k + 0.695) * tw, y + 1.175, y + 2.33, 0.08, 0.06, fc, revealCol);
            else {
              frameRect(frames, a, tx, tz, nx, nz, (k + 0.656) * tw, (k + 0.89) * tw, y + 1.33, y + 2.19, 0.08, 0.05, fc, revealCol);
              frameRect(frames, a, tx, tz, nx, nz, (k + 0.203) * tw, (k + 0.5) * tw, y + 0.02, y + 2.56, 0.1, 0.07, fc, revealCol, true);
              if (f === 0) {
                const s0 = (k + 0.15) * tw, s1 = (k + 0.55) * tw, P0 = [a[0] + tx * s0 + nx * 0.22, a[1] + tz * s0 + nz * 0.22], P1 = [a[0] + tx * s1 + nx * 0.22, a[1] + tz * s1 + nz * 0.22];
                bar(frames, P0[0], P0[1], P1[0], P1[1], 0, 0.17, 0.44, stoneCol);
                const Q0 = [a[0] + tx * (s0 + 0.08) + nx * 0.6, a[1] + tz * (s0 + 0.08) + nz * 0.6], Q1 = [a[0] + tx * (s1 - 0.08) + nx * 0.6, a[1] + tz * (s1 - 0.08) + nz * 0.6];
                bar(frames, Q0[0], Q0[1], Q1[0], Q1[1], 0, 0.09, 0.3, stoneCol);
              }
            }
          }
        }
        // chajja (sunshade slab) over openings
        if (b.r === 'rcc' && el > 2.2 && vIdx !== 2) {
          for (let f = 0; f * 3.2 < h - 0.5; f++) {
            const y = f * 3.2 + 2.35, o = 0.45, sx = nx*o, sz = nz*o, k = 0.12;
            const a2 = [a[0] + ex/el*0.2, a[1] + ez/el*0.2], d2 = [d[0] - ex/el*0.2, d[1] - ez/el*0.2];
            ledges.quad([a2[0],y,a2[1]],[d2[0],y,d2[1]],[d2[0]+sx,y,d2[1]+sz],[a2[0]+sx,y,a2[1]+sz],[0,1,0],[[0,0],[1,0],[1,1],[0,1]],c);
            ledges.quad([a2[0]+sx,y-k,a2[1]+sz],[d2[0]+sx,y-k,d2[1]+sz],[d2[0]+sx,y,d2[1]+sz],[a2[0]+sx,y,a2[1]+sz],[nx,0,nz],[[0,0],[1,0],[1,1],[0,1]],c);
            ledges.quad([a2[0],y-k,a2[1]],[d2[0],y-k,d2[1]],[d2[0]+sx,y-k,d2[1]+sz],[a2[0]+sx,y-k,a2[1]+sz],[0,-1,0],[[0,0],[1,0],[1,1],[0,1]],col.setRGB(0.35,0.35,0.33).clone());
          }
        }
      }
      houses.push({ b, p, h, n, c, fc: frameColB, cx: cx2, cz: cz2, E: EI, shop, old: oldHouse });
      if (b.r === 'tile') {
        // gabled Mangalore-tile roof over the footprint's oriented box
        let best = 0, ang = 0;
        for (let i = 0; i < n; i++) { const a = p[i], d = p[(i+1)%n], L = Math.hypot(d[0]-a[0], d[1]-a[1]); if (L > best) { best = L; ang = Math.atan2(d[1]-a[1], d[0]-a[0]); } }
        const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (const q2 of p) { const uu = (q2[0]-cx2)*ux + (q2[1]-cz2)*uz, vv = (q2[0]-cx2)*vx + (q2[1]-cz2)*vz; u0 = Math.min(u0, uu); u1 = Math.max(u1, uu); v0 = Math.min(v0, vv); v1 = Math.max(v1, vv); }
        u0 -= 0.35; u1 += 0.35; v0 -= 0.45; v1 += 0.45;
        const P = (uu, vv, y) => [cx2 + ux*uu + vx*vv, y, cz2 + uz*uu + vz*vv];
        const vm = (v0 + v1) / 2, rh = h + Math.min(1.8, (v1 - v0) * 0.32), tc = roofColour(b);
        const L2 = (u1-u0)/1.2, W2 = (vm-v0)/1.2;
        tileRoofs.quad(P(u0,v0,h), P(u1,v0,h), P(u1,vm,rh), P(u0,vm,rh), [vx*-0.7,0.7,vz*-0.7], [[0,0],[L2,0],[L2,W2],[0,W2]], tc);
        tileRoofs.quad(P(u1,v1,h), P(u0,v1,h), P(u0,vm,rh), P(u1,vm,rh), [vx*0.7,0.7,vz*0.7], [[0,0],[L2,0],[L2,W2],[0,W2]], tc);
        // gable end walls
        for (const uu of [u0 + 0.35, u1 - 0.35]) wallB[2].tri(P(uu, v0+0.45, h), P(uu, v1-0.45, h), P(uu, vm, rh-0.1), [ux,0,uz], [0,0], [1,0], [0.5,0.5], c);
      } else {
        const contour = p.map(q2 => new THREE.Vector2(q2[0], q2[1]));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        const rc = roofColour(b);
        const tgt = b.r === 'sheet' ? sheetRoofs : roofs, ry = b.r === 'rcc' ? h : h + 0.05;
        for (const t of tris) {
          const A = p[t[0]], B = p[t[1]], C = p[t[2]];
          tgt.tri([A[0],ry,A[1]],[C[0],ry,C[1]],[B[0],ry,B[1]],[0,1,0],[A[0]/3,A[1]/3],[C[0]/3,C[1]/3],[B[0]/3,B[1]/3],rc);
        }
      }
      if (b.r === 'rcc') {
        const hr = hash(cx2 * 3, cz2 * 7), railed = hash(cx2 * 1.3, cz2 * 0.7) < 0.3;
        const railC = col.set(['#2f5d8a', '#3f6b3a', '#222222', '#9aa0a6', '#7a2f2f'][Math.floor(hr * 5)]).clone();
        for (let i = 0; i < n; i++) {
          const A = p[i], Bq = p[(i+1)%n];
          if (!railed) { wallBox(parapets, A[0], A[1], Bq[0], Bq[1], h + 0.9, 0.2, c, 3, h - 0.05); continue; }
          wallBox(parapets, A[0], A[1], Bq[0], Bq[1], h + 0.3, 0.2, c, 3, h - 0.05);                       // low parapet + steel railing
          const L = Math.hypot(Bq[0]-A[0], Bq[1]-A[1]), ux = (Bq[0]-A[0]) / (L || 1), uz = (Bq[1]-A[1]) / (L || 1), np = Math.max(1, Math.round(L / 1.3));
          for (let j = 0; j <= np; j++) { const x = A[0] + (Bq[0]-A[0]) * j / np, z = A[1] + (Bq[1]-A[1]) * j / np; bar(railings, x - ux * 0.02, z - uz * 0.02, x + ux * 0.02, z + uz * 0.02, h + 0.3, h + 1.0, 0.04, railC); }
          bar(railings, A[0], A[1], Bq[0], Bq[1], h + 0.96, h + 1.02, 0.05, railC);
          bar(railings, A[0], A[1], Bq[0], Bq[1], h + 0.62, h + 0.65, 0.025, railC);
        }
        if (b.a > 50 && hash(cz2 * 2.1, cx2 * 1.7) < 0.35) {
          // rooftop clothes-line between two pipes, with sarees, shirts and towels drying
          let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const L = Math.hypot(p[(i+1)%n][0]-p[i][0], p[(i+1)%n][1]-p[i][1]); if (L > bl) { bl = L; bi = i; } }
          const A = p[bi], Bq = p[(bi+1)%n], ux = (Bq[0]-A[0]) / bl, uz = (Bq[1]-A[1]) / bl;
          const mx = (A[0]+Bq[0])/2, mz = (A[1]+Bq[1])/2, ix = cx2 - mx, iz = cz2 - mz, il = Math.hypot(ix, iz) || 1, ins = Math.min(1.4, il * 0.6);
          const L2 = Math.min(bl - 2, 7); if (L2 > 2) {
            const s0 = [mx + ix / il * ins - ux * L2 / 2, mz + iz / il * ins - uz * L2 / 2], s1 = [s0[0] + ux * L2, s0[1] + uz * L2];
            const pole = col.setHex(0x55575a).clone();
            bar(clothes, s0[0], s0[1], s0[0] + ux * 0.05, s0[1] + uz * 0.05, h, h + 1.75, 0.05, pole);
            bar(clothes, s1[0] - ux * 0.05, s1[1] - uz * 0.05, s1[0], s1[1], h, h + 1.75, 0.05, pole);
            bar(clothes, s0[0], s0[1], s1[0], s1[1], h + 1.68, h + 1.695, 0.012, col.setHex(0xdddddd).clone());
            const CL = ['#c2185b', '#1565c0', '#f9a825', '#2e7d32', '#ffffff', '#d84315', '#6a1b9a', '#00838f', '#eeeeee', '#ad1457', '#283593'];
            const perp = [-uz, 0, ux];
            for (let t = 0.2; t < L2 - 0.3;) {
              const r2 = hash(t + cx2, cz2 - t), w = r2 < 0.2 ? 1.1 : 0.35 + r2 * 0.4, len = r2 < 0.2 ? 1.25 : 0.4 + r2 * 0.5;
              if (t + w > L2 - 0.1) break;
              const cc2 = col.set(CL[Math.floor(r2 * 97) % CL.length]).clone(), y1 = h + 1.68, sw2 = (r2 - 0.5) * 0.08;
              const A2 = [s0[0] + ux * t, y1, s0[1] + uz * t], B2 = [s0[0] + ux * (t + w), y1, s0[1] + uz * (t + w)];
              const C2 = [B2[0] + perp[0] * sw2, y1 - len, B2[2] + perp[2] * sw2], D2 = [A2[0] + perp[0] * sw2, y1 - len * (0.92 + r2 * 0.1), A2[2] + perp[2] * sw2];
              clothes.oquad(A2, B2, C2, D2, perp, cc2); clothes.oquad(A2, B2, C2, D2, perp.map(v => -v), cc2);
              t += w + 0.12 + r2 * 0.2;
            }
          }
        }
        if (b.a > 45 && hr < 0.55) tanks.push([cx2 + (hr - 0.3) * 2, h, cz2 + (hr - 0.3) * 1.5, hr < 0.2 ? 0x2f5d8a : 0x1d1d1d]);
        if (b.a > 70 && hr > 0.35) {
          // staircase headroom ("mumty") on the roof
          const v0p = p[0]; let mx = cx2 + (v0p[0] - cx2) * 0.45, mz = cz2 + (v0p[1] - cz2) * 0.45;
          mumties.push([mx, h, mz, Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]), c.clone()]);
        }
      }
    }
    for (const m of mumties) {
      const [mx, y0, mz, ang, mc] = m, hw = 1.25, ca = Math.cos(ang), sa = Math.sin(ang);
      const pts = [[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].map(([a2, b2]) => [mx + a2*ca - b2*sa, mz + a2*sa + b2*ca]);
      for (let i = 0; i < 4; i++) {
        const a = pts[i], d = pts[(i+1)%4], ex = d[0]-a[0], ez = d[1]-a[1], el = Math.hypot(ex, ez);
        let nx = ez/el, nz = -ex/el; if (inside([(a[0]+d[0])/2 + nx*0.2, (a[1]+d[1])/2 + nz*0.2], pts)) { nx = -nx; nz = -nz; }
        wallB[i === 0 ? 1 : 2].quad([a[0],y0,a[1]],[d[0],y0,d[1]],[d[0],y0+2.5,d[1]],[a[0],y0+2.5,a[1]],[nx,0,nz],[[0,0],[1,0],[1,0.78],[0,0.78]],mc);
        segs.length; // roof-level, no collision needed
      }
      roofs.quad([pts[0][0],y0+2.5,pts[0][1]],[pts[3][0],y0+2.5,pts[3][1]],[pts[2][0],y0+2.5,pts[2][1]],[pts[1][0],y0+2.5,pts[1][1]],[0,1,0],[[0,0],[0,1],[1,1],[1,0]],col.setHex(roofCol.rcc).clone());
    }
    const facadeMats = [];
    FV.forEach((t, i) => {
      const mat = new THREE.MeshLambertMaterial({ map: t, vertexColors: true, emissive: 0xffc070, emissiveMap: facadeGlow(i), emissiveIntensity: 0 });
      facadeMats.push(mat);
      const m = wallB[i].mesh(mat); m.castShadow = m.receiveShadow = true; group.add(m);
    });
    const roofTex = CC0('concrete', 0.6, 0.6, tex(stainedConcrete(256, false)));
    const rm = roofs.mesh(new THREE.MeshLambertMaterial({ map: roofTex, vertexColors: true })); rm.receiveShadow = true; group.add(rm);
    const tm = tileRoofs.mesh(new THREE.MeshLambertMaterial({ map: CC0('roof', 0.8, 0.8, tileTexture()), vertexColors: true })); tm.castShadow = true; group.add(tm);
    const sm = sheetRoofs.mesh(new THREE.MeshLambertMaterial({ map: CC0('corrugated', 0.5, 0.5, sheetTexture()), vertexColors: true })); sm.receiveShadow = true; group.add(sm);
    const pm = parapets.mesh(new THREE.MeshLambertMaterial({ map: roofTex, vertexColors: true })); pm.castShadow = true; group.add(pm);
    const lm = ledges.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); lm.castShadow = true; group.add(lm);
    const frm = frames.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); frm.castShadow = true; frm.receiveShadow = true; group.add(frm);
    const rlm = railings.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); rlm.castShadow = true; group.add(rlm);
    const clm = clothes.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); clm.castShadow = true; group.add(clm);
    // Sintex water tanks on roofs (black and blue)
    if (tanks.length) {
      const tg = new THREE.CylinderGeometry(0.62, 0.55, 1.2, 14); tg.translate(0, 0.6, 0);
      const im = new THREE.InstancedMesh(tg, new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 }), tanks.length);
      const m4b = new THREE.Matrix4();
      tanks.forEach((t, i) => { im.setMatrixAt(i, m4b.makeTranslation(t[0], t[1], t[2])); im.setColorAt(i, col.setHex(t[3])); });
      group.add(im);
    }

    // ---------------- compound walls: real village boundary walls - 23 cm brick/stone core, plastered (most), exposed
    // brick or dry granite (some), darker plinth band at the foot, projecting concrete coping on top, piers every ~3 m
    const cw = new Builder(), cwp = new Builder(), cwBrick = new Builder(), cwStone = new Builder(), cwCope = new Builder();
    const cwCols = ['#e8e4da', '#cfe3cf', '#dcd2c0', '#f0f0f0', '#c9dbe6', '#e9d6c8', '#efe3b8', '#d9cbb0'];
    for (const w of D.walls) {
      const hw = hash(w[0] * 0.13 + w[2] * 0.07, w[1] * 0.11 + w[3] * 0.05);
      const style = hw < 0.62 ? 'plaster' : hw < 0.84 ? 'brick' : 'stone';
      const cc = style === 'plaster' ? col.set(cwCols[Math.floor(Math.abs(w[0]*7 + w[1]*3)) % cwCols.length]).clone()
        : style === 'brick' ? col.setRGB(0.95 + hw * 0.05, 0.88, 0.84).clone() : col.setRGB(0.9, 0.88, 0.86).clone();
      const H = style === 'stone' ? 1.25 : 1.5 + (hw * 17 % 1) * 0.3, T = style === 'stone' ? 0.42 : 0.25;
      const body = style === 'plaster' ? cw : style === 'brick' ? cwBrick : cwStone;
      wallBox(body, w[0], w[1], w[2], w[3], H, T, cc, style === 'stone' ? 1.2 : 1.45);
      const plinth = cc.clone().multiplyScalar(0.62);                                       // splashed, darker foot
      if (style !== 'stone') wallBox(style === 'brick' ? cwBrick : cw, w[0], w[1], w[2], w[3], 0.32, T + 0.06, plinth, 1.45);
      const cope = style === 'plaster' ? cc.clone().multiplyScalar(0.92) : col.setRGB(0.78, 0.77, 0.74).clone();
      if (style !== 'stone') wallBox(cwCope, w[0], w[1], w[2], w[3], H + 0.08, T + 0.1, cope, 1.45, H);
      else wallBox(cwCope, w[0], w[1], w[2], w[3], H + 0.1, T + 0.04, col.setRGB(0.62, 0.6, 0.58).clone(), 1.2, H - 0.02); // flat capstones
      const L = Math.hypot(w[2]-w[0], w[3]-w[1]), k = Math.max(1, Math.round(L / 3));
      if (style !== 'stone') for (let i = 0; i <= k; i++) {
        const x = w[0] + (w[2]-w[0]) * i / k, z = w[1] + (w[3]-w[1]) * i / k, ux = (w[2]-w[0]) / (L || 1) * 0.2, uz = (w[3]-w[1]) / (L || 1) * 0.2;
        const end = i === 0 || i === k, ph = H + (end ? 0.3 : 0.18);
        wallBox(style === 'brick' ? cwBrick : cwp, x - ux, z - uz, x + ux, z + uz, ph, T + 0.16, cc, 1.45);
        wallBox(cwCope, x - ux * 1.25, z - uz * 1.25, x + ux * 1.25, z + uz * 1.25, ph + 0.07, T + 0.24, cope, 1.45, ph);   // pier cap
      }
      segs.push(w);
    }
    // steel main gates across gaps between compound-wall runs (two leaves, flat-bar frame, vertical bars with spear tips)
    const gates = new Builder(), ends = [];
    D.walls.forEach((w, i) => { const L = Math.hypot(w[2]-w[0], w[3]-w[1]) || 1, ux = (w[2]-w[0]) / L, uz = (w[3]-w[1]) / L; ends.push([w[0], w[1], -ux, -uz, i], [w[2], w[3], ux, uz, i]); });
    const gateUsed = new Set();
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const A = ends[i], Bq = ends[j]; if (A[4] === Bq[4] || gateUsed.has(i) || gateUsed.has(j)) continue;
      const dx = Bq[0]-A[0], dz = Bq[1]-A[1], g = Math.hypot(dx, dz); if (g < 2.2 || g > 4.6) continue;
      const gx = dx / g, gz = dz / g;
      if (A[2]*gx + A[3]*gz < 0.85 || -(Bq[2]*gx + Bq[3]*gz) < 0.85) continue;            // gap continues both wall lines
      const mx = (A[0]+Bq[0])/2, mz = (A[1]+Bq[1])/2;
      if (roadSegs.some(([a2, c2, t2, w2]) => { const ddx = c2[0]-a2[0], ddz = c2[1]-a2[1], L2 = ddx*ddx + ddz*ddz || 1, tt = Math.max(0, Math.min(1, ((mx-a2[0])*ddx + (mz-a2[1])*ddz) / L2)); return Math.hypot(mx - a2[0] - tt*ddx, mz - a2[1] - tt*ddz) < w2 / 2 + 0.3; })) continue;
      gateUsed.add(i); gateUsed.add(j);
      const gc = col.set(['#1b5e20', '#0d47a1', '#263238', '#4e342e', '#455a64', '#b0bec5'][Math.floor(hash(mx, mz) * 6)]).clone();
      const s0 = 0.2, s1 = g - 0.2, H2 = 1.55, P = (t) => [A[0] + gx * t, A[1] + gz * t];
      for (const [l0, l1] of [[s0, g / 2 - 0.02], [g / 2 + 0.02, s1]]) {
        const p0 = P(l0), p1 = P(l1);
        bar(gates, p0[0], p0[1], p1[0], p1[1], 0.08, 0.14, 0.05, gc);
        bar(gates, p0[0], p0[1], p1[0], p1[1], 0.7, 0.75, 0.04, gc);
        bar(gates, p0[0], p0[1], p1[0], p1[1], H2 - 0.06, H2, 0.05, gc);
        for (const t of [l0, l1]) { const q2 = P(t); bar(gates, q2[0] - gx * 0.03, q2[1] - gz * 0.03, q2[0] + gx * 0.03, q2[1] + gz * 0.03, 0.06, H2 + 0.05, 0.06, gc); }
        for (let t = l0 + 0.12; t < l1 - 0.06; t += 0.12) { const q2 = P(t); bar(gates, q2[0] - gx * 0.009, q2[1] - gz * 0.009, q2[0] + gx * 0.009, q2[1] + gz * 0.009, 0.1, H2 + 0.12, 0.018, gc); }
        const pm = P((l0 + l1) / 2); bar(gates, pm[0] - gx * 0.25, pm[1] - gz * 0.25, pm[0] + gx * 0.25, pm[1] + gz * 0.25, 0.9, 1.25, 0.012, gc);  // name plate panel
      }
      segs.push([A[0], A[1], Bq[0], Bq[1]]);
    }
    const gm = gates.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); gm.castShadow = true; group.add(gm);
    const cwTex = CC0('plaster', 0.7, 0.7, tex(stainedConcrete(256, true)));
    const cwm = cw.mesh(new THREE.MeshLambertMaterial({ map: cwTex, vertexColors: true })); cwm.castShadow = cwm.receiveShadow = true; group.add(cwm);
    const cwpm = cwp.mesh(new THREE.MeshLambertMaterial({ map: cwTex, vertexColors: true })); cwpm.castShadow = true; group.add(cwpm);
    for (const [B, tx] of [[cwBrick, CC0('brick', 0.8, 0.8, null)], [cwStone, CC0('granite', 0.6, 0.6, null)], [cwCope, CC0('concrete', 1.2, 1.2, null)]]) {
      if (!B.pos.length) continue;
      const mm = B.mesh(new THREE.MeshLambertMaterial(tx ? { map: tx, vertexColors: true } : { vertexColors: true })); mm.castShadow = mm.receiveShadow = true; group.add(mm);
    }


    // ---------------- village near-detail pass: facade trim, parapets, verandas, greenery, street clutter
    // Everything here is merged per 120 m cell and per material, and only shown near the camera (see updateVillage).
    const VC = 120, vCells = new Map();
    // knockable street clutter (drums, buckets, pots, parked prop cycles): each stamp is recorded with its vertex range in
    // its cell's merged clutter mesh so a game module can hide it there and swap in a loose copy (world.clutter API)
    const CLUTTER = [];
    const vCell = (x, z) => {
      const k = Math.floor(x / VC) + ',' + Math.floor(z / VC);
      let e = vCells.get(k);
      if (!e) vCells.set(k, e = { x: (Math.floor(x / VC) + 0.5) * VC, z: (Math.floor(z / VC) + 0.5) * VC, trim: new Builder(), green: new Builder(), bou: new Builder(), grass: new Builder(), clutter: new Builder(), meshes: {} });
      return e;
    };
    const roadDist = (x, z) => {
      let bd = 1e9;
      for (const [a2, c2, t2, w2] of roadSegs) {
        if (Math.abs(a2[0] - x) > 80 && Math.abs(c2[0] - x) > 80) continue;
        const ddx = c2[0]-a2[0], ddz = c2[1]-a2[1], L2 = ddx*ddx + ddz*ddz || 1, tt = Math.max(0, Math.min(1, ((x-a2[0])*ddx + (z-a2[1])*ddz) / L2));
        bd = Math.min(bd, Math.hypot(x - a2[0] - tt*ddx, z - a2[1] - tt*ddz) - w2 / 2);
      }
      return bd;
    };
    const shade = (c0, k) => c0.clone().multiplyScalar(k);
    // a slab / box given a base edge (a->d), outward normal and depth
    function slab(B, a, d, nx, nz, o0, o1, y0, y1, c0) {
      const P = (q2, o, y) => [q2[0] + nx * o, y, q2[1] + nz * o];
      const tx = d[0] - a[0], tz = d[1] - a[1], tl = Math.hypot(tx, tz) || 1;
      B.oquad(P(a, o1, y0), P(d, o1, y0), P(d, o1, y1), P(a, o1, y1), [nx, 0, nz], c0);
      B.oquad(P(a, o0, y1), P(d, o0, y1), P(d, o1, y1), P(a, o1, y1), [0, 1, 0], shade(c0, 1.04));
      B.oquad(P(a, o0, y0), P(d, o0, y0), P(d, o1, y0), P(a, o1, y0), [0, -1, 0], shade(c0, 0.55));
      B.oquad(P(a, o0, y0), P(a, o1, y0), P(a, o1, y1), P(a, o0, y1), [-tx / tl, 0, -tz / tl], shade(c0, 0.85));
      B.oquad(P(d, o0, y0), P(d, o1, y0), P(d, o1, y1), P(d, o0, y1), [tx / tl, 0, tz / tl], shade(c0, 0.85));
    }
    // copy a prototype geometry into a builder, turned by ang about y and moved to (x, y, z)
    const _sv = new THREE.Vector3(), _sn = new THREE.Vector3(), _sq = new THREE.Quaternion(), _sm = new THREE.Matrix4();
    function stamp(B, g, x, y, z, ang, sc, tint) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
      _sq.setFromAxisAngle(_up, ang); _sm.compose(_sv.set(x, y, z), _sq, new THREE.Vector3(sc || 1, sc || 1, sc || 1));
      for (let i = 0; i < P.count; i++) {
        _sv.fromBufferAttribute(P, i).applyMatrix4(_sm); _sn.fromBufferAttribute(N, i).applyQuaternion(_sq);
        B.pos.push(_sv.x, _sv.y, _sv.z); B.nor.push(_sn.x, _sn.y, _sn.z); B.uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        const cr = C ? C.getX(i) : 1, cg = C ? C.getY(i) : 1, cb = C ? C.getZ(i) : 1;
        B.col.push(cr * (tint ? tint.r : 1), cg * (tint ? tint.g : 1), cb * (tint ? tint.b : 1));
      }
    }
    // prototypes: grass tuft (crossed blade cards), clutter props
    const tuftG = (() => {
      const K = new Kit();
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3, ca = Math.cos(a) * 0.26, sa = Math.sin(a) * 0.26;
        K.quad([-ca, 0, -sa], [ca, 0, sa], [ca, 0.16, sa], [-ca, 0.16, -sa], [0, 1, 0], 0xffffff);
      }
      return K.geo();
    })();
    const shrubG = shrubGeometry();
    const VPROPS = {
      bucket: (() => { const K = new Kit(); K.add(new THREE.CylinderGeometry(0.17, 0.13, 0.32, 10, 1, true), 0xffffff, { p: [0, 0.16, 0] }); K.add(new THREE.CircleGeometry(0.13, 10), 0x333333, { p: [0, 0.02, 0], r: [-Math.PI / 2, 0, 0] }); return K.geo(); })(),
      drum: (() => { const K = new Kit(); K.add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), 0xffffff, { p: [0, 0.45, 0] }); K.add(new THREE.TorusGeometry(0.3, 0.02, 4, 12), 0xcccccc, { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0] }); K.add(new THREE.TorusGeometry(0.3, 0.02, 4, 12), 0xcccccc, { p: [0, 0.62, 0], r: [Math.PI / 2, 0, 0] }); return K.geo(); })(),
      pot: (() => { const K = new Kit(); K.add(new THREE.SphereGeometry(0.2, 10, 7), 0xffffff, { p: [0, 0.2, 0], s: [1, 0.9, 1] }); K.add(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 10), 0xffffff, { p: [0, 0.4, 0] }); return K.geo(); })(),
      bricks: (() => { const K = new Kit(); for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) K.box([(x - 1) * 0.24 + (y % 2) * 0.05, 0.04 + y * 0.085, 0], [0.22, 0.075, 0.5], [0.62 + (x * 7 + y * 3) % 5 * 0.03, 0.28, 0.2]); return K.geo(); })(),
      cycle: (() => {
        const K = new Kit(), blk = 0x1c1c1c;
        for (const x of [-0.52, 0.52]) K.add(new THREE.TorusGeometry(0.33, 0.018, 4, 18), blk, { p: [x, 0.35, 0] });
        K.tube([-0.52, 0.35, 0], [-0.05, 0.42, 0], 0.017, 0.017, 0x8b1a1a, 4); K.tube([-0.05, 0.42, 0], [0.42, 0.78, 0], 0.017, 0.017, 0x8b1a1a, 4);
        K.tube([-0.05, 0.42, 0], [-0.22, 0.8, 0], 0.017, 0.017, 0x8b1a1a, 4); K.tube([-0.22, 0.8, 0], [0.42, 0.78, 0], 0.017, 0.017, 0x8b1a1a, 4);
        K.tube([0.52, 0.35, 0], [0.42, 0.95, 0], 0.016, 0.016, 0x8b1a1a, 4); K.tube([-0.52, 0.35, 0], [-0.22, 0.8, 0], 0.014, 0.014, 0x8b1a1a, 4);
        K.tube([0.42, 0.95, -0.25], [0.42, 0.95, 0.25], 0.014, 0.014, blk, 4); K.box([-0.24, 0.84, 0], [0.24, 0.05, 0.1], blk);
        K.box([-0.62, 0.6, 0], [0.35, 0.03, 0.18], 0x444444);   // carrier
        return K.geo();
      })(),
      cart: (() => {
        const K = new Kit();
        K.box([0, 0.62, 0], [1.6, 0.08, 0.85], 0x7a5a3a); K.box([0, 0.72, 0.42], [1.6, 0.14, 0.03], 0x6a4a2e); K.box([0, 0.72, -0.42], [1.6, 0.14, 0.03], 0x6a4a2e);
        for (const z of [-0.47, 0.47]) K.add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), 0x2a2a2a, { p: [0.1, 0.3, z], r: [Math.PI / 2, 0, 0] });
        K.tube([-0.8, 0.62, -0.3], [-1.4, 0.75, -0.3], 0.025, 0.025, 0x5a4028, 4); K.tube([-0.8, 0.62, 0.3], [-1.4, 0.75, 0.3], 0.025, 0.025, 0x5a4028, 4);
        K.tube([0.75, 0.58, 0], [0.75, 0.0, 0], 0.03, 0.03, 0x5a4028, 4);
        return K.geo();
      })(),
      tulsi: (() => {   // tulsi kota: stepped plinth with a niche, plant on top
        const K = new Kit();
        K.box([0, 0.12, 0], [0.8, 0.24, 0.8], 0xffffff); K.box([0, 0.55, 0], [0.56, 0.62, 0.56], 0xffffff); K.box([0, 0.9, 0], [0.66, 0.08, 0.66], 0xffffff);
        K.box([0, 0.5, 0.282], [0.2, 0.24, 0.01], 0x2a2018);
        return K.geo();
      })(),
    };
    const BUCKET_COLS = [0xd32f2f, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a, 0xeeeeee].map(h2 => new THREE.Color(h2));
    const DRUM_COLS = [0x1565c0, 0x1976d2, 0x0d47a1, 0xb0bec5, 0x2e7d32].map(h2 => new THREE.Color(h2));
    const TRIMS = ['#7a2f2f', '#5a3a22', '#2e5d3a', '#f4f1e8', '#3b4f7a', '#8a6a3a'];
    const plinthCols = [new THREE.Color(0x8a4a3a), new THREE.Color(0x7d7a73), new THREE.Color(0x5e5a54), new THREE.Color(0x9a5a40)];
    const AO = new Builder();          // ground contact darkening (multiply blended)
    const aoIn = new THREE.Color(0.52, 0.5, 0.48), aoOut = new THREE.Color(1, 1, 1);
    function aoStrip(a, d, nx, nz, w, k) {
      const y = 0.075, ci = k ? new THREE.Color(1 - (1 - aoIn.r) * k, 1 - (1 - aoIn.g) * k, 1 - (1 - aoIn.b) * k) : aoIn;
      const tx = d[0] - a[0], tz = d[1] - a[1], tl = Math.hypot(tx, tz) || 1, ex = tx / tl * w * 0.6, ez = tz / tl * w * 0.6;
      const A = [a[0], y, a[1]], Dd = [d[0], y, d[1]], A2 = [a[0] + nx * w - ex, y, a[1] + nz * w - ez], D2 = [d[0] + nx * w + ex, y, d[1] + nz * w + ez];
      AO.pos.push(...A, ...Dd, ...D2, ...A, ...D2, ...A2);
      for (let i = 0; i < 6; i++) AO.nor.push(0, 1, 0), AO.uv.push(0, 0);
      for (const cc of [ci, ci, aoOut, ci, aoOut, aoOut]) AO.col.push(cc.r, cc.g, cc.b);
    }
    const rangoli = new Builder();
    const decoTex = (() => {      // 4 muggu patterns in a 2x2 atlas: white rice-flour dots and loops on wetted earth
      const [cv, g] = cvs(256, 256);
      for (let k = 0; k < 4; k++) {
        const ox = (k % 2) * 128 + 64, oy = Math.floor(k / 2) * 128 + 64;
        g.fillStyle = 'rgba(96,78,58,0.55)'; g.beginPath(); g.arc(ox, oy, 60, 0, 7); g.fill();
        g.strokeStyle = 'rgba(250,248,240,0.95)'; g.fillStyle = 'rgba(250,248,240,0.95)'; g.lineWidth = 2.2;
        const N = 4 + k;
        for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) if (Math.abs(i) + Math.abs(j) <= N) { g.beginPath(); g.arc(ox + i * 6.5, oy + j * 6.5, 1.3, 0, 7); g.fill(); }
        for (let r = 1; r <= 3; r++) { g.beginPath(); for (let t = 0; t <= 64; t++) { const a = t / 64 * 6.2832, rr = r * 14 + Math.sin(a * (4 + k * 2)) * 5; t ? g.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr) : g.moveTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr); } g.stroke(); }
        if (k % 2) { g.fillStyle = ['rgba(220,40,60,0.8)', 'rgba(240,170,20,0.85)'][k >> 1]; for (let t = 0; t < 8; t++) { const a = t / 8 * 6.2832; g.beginPath(); g.arc(ox + Math.cos(a) * 34, oy + Math.sin(a) * 34, 5, 0, 7); g.fill(); } }
      }
      const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
    })();
    const grassTex = (() => {
      const [cv, g] = cvs(128, 128);
      for (let i = 0; i < 70; i++) {
        const x = 8 + Math.random() * 112, h2 = 50 + Math.random() * 75, lean = (Math.random() - 0.5) * 40;
        g.strokeStyle = `hsl(${52 + Math.random() * 38},${26 + Math.random() * 22}%,${28 + Math.random() * 24}%)`; g.lineWidth = 1 + Math.random() * 1.4;
        g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h2 * 0.6, x + lean, 128 - h2); g.stroke();
      }
      const t = new THREE.CanvasTexture(cv); return t;
    })();
    // no grass on a carriageway or its first metre of verge: low tufts only, and never where a wheel runs
    const stampGrass = (C, X, Z, a, sc, c) => { if (!roadHit(X, Z, 1.1)) stamp(C, tuftG, X, 0, Z, a, sc, c); };
    const hh = (x, z, k) => hash(x * k + 3.1, z * k - 7.7);

    for (const H of houses) {
      const { b, p, h, n, c, cx: hx, cz: hz, E } = H;
      const cell = vCell(hx, hz), T = cell.trim;
      const r1 = hh(hx, hz, 1.7), r2 = hh(hx, hz, 2.9), r3 = hh(hx, hz, 4.3), r4 = hh(hx, hz, 5.1);
      const trim = r1 < 0.5 ? shade(c, 0.74) : col.set(TRIMS[Math.floor(r2 * TRIMS.length)]).clone();
      const plinth = plinthCols[Math.floor(r3 * plinthCols.length)];
      const isHouse = b.r !== 'sheet' && b.a < 600;
      // ground contact strips all round (also for sheds)
      for (const e of E) aoStrip(e.a, e.d, e.nx, e.nz, 1.0);
      if (!isHouse) continue;
      // plinth band, pilasters, string courses
      for (const e of E) {
        const { a, d, nx, nz } = e, A = [a[0] - nx * 0.02, a[1] - nz * 0.02], Dd = [d[0] - nx * 0.02, d[1] - nz * 0.02];
        slab(T, A, Dd, nx, nz, 0, 0.09, 0, 0.42 + r4 * 0.15, plinth);
        if (b.r === 'rcc' && !H.old) for (let f = 1; f * 3.2 < h - 0.4; f++) slab(T, A, Dd, nx, nz, 0, 0.07, f * 3.2 - 0.12, f * 3.2 + 0.04, trim);
        if (b.r === 'rcc') slab(T, A, Dd, nx, nz, 0, 0.1, h - 0.16, h + 0.02, trim);         // roof-slab edge band
      }
      for (let i = 0; i < n; i++) {
        const e0 = E[(i + n - 1) % n], e1 = E[i], v0 = p[i];
        if (!e0 || !e1 || H.old) continue;
        const ox = (e0.nx + e1.nx) * 0.5, oz = (e0.nz + e1.nz) * 0.5;
        const tx = (e1.d[0] - e1.a[0]) / e1.el, tz = (e1.d[1] - e1.a[1]) / e1.el;
        bar(T, v0[0] + ox * 0.08 - tx * 0.2, v0[1] + oz * 0.08 - tz * 0.2, v0[0] + ox * 0.08 + tx * 0.2, v0[1] + oz * 0.08 + tz * 0.2, 0, h + (b.r === 'rcc' ? 0.95 : 0), 0.4, trim);
      }
      // window grills and opened shutters, over the facade texture openings
      for (const e of E) if (e.vIdx === 0 && b.r !== 'sheet') {
        const { a, nx, nz, el, u } = e, tx = (e.d[0] - a[0]) / el, tz = (e.d[1] - a[1]) / el, tw = el / u;
        for (let f = 0; f * 3.2 + 2.35 < h + 0.01; f++) for (let k = 0; k < u; k++) {
          const y = f * 3.2, s0 = (k + 0.305) * tw, s1 = (k + 0.695) * tw, P = (s2, o) => [a[0] + tx * s2 + nx * o, a[1] + tz * s2 + nz * o];
          for (let g2 = 1; g2 < 6; g2++) { const q2 = P(s0 + (s1 - s0) * g2 / 6, 0.05); bar(T, q2[0] - tx * 0.008, q2[1] - tz * 0.008, q2[0] + tx * 0.008, q2[1] + tz * 0.008, y + 1.175, y + 2.33, 0.016, col.setHex(0x2b2b2b).clone()); }
          const m0 = P(s0, 0.05), m1 = P(s1, 0.05); bar(T, m0[0], m0[1], m1[0], m1[1], y + 1.72, y + 1.75, 0.016, col.setHex(0x2b2b2b).clone());
          if (hh(s0 + hx, y + hz, 3.3) < 0.3) {          // two wooden shutter leaves swung open against the wall
            const sw = (s1 - s0) / 2, fcl = col.set(['#3f6b3a', '#2f5d8a', '#6b4a2e', '#7a2f2f'][Math.floor(hh(hx, hz, 7.7) * 4)]).clone();
            for (const [hs, dir] of [[s0 - 0.06, -1], [s1 + 0.06, 1]]) {
              const q0 = P(hs, 0.03), q1 = P(hs + dir * sw * 0.96, 0.03 + sw * 0.28);
              T.oquad([q0[0], y + 1.2, q0[1]], [q1[0], y + 1.2, q1[1]], [q1[0], y + 2.3, q1[1]], [q0[0], y + 2.3, q0[1]], [tx * dir, 0, tz * dir], fcl);
              T.oquad([q0[0], y + 1.2, q0[1]], [q1[0], y + 1.2, q1[1]], [q1[0], y + 2.3, q1[1]], [q0[0], y + 2.3, q0[1]], [-tx * dir, 0, -tz * dir], shade(fcl, 0.8));
            }
          }
        }
      }
      // decorative parapets on flat RCC roofs
      const railed = hash(hx * 1.3, hz * 0.7) < 0.3;
      if (b.r === 'rcc' && !railed) {
        const style = r2 < 0.42 ? 'zig' : r2 < 0.62 ? 'jali' : r2 < 0.85 ? 'band' : 'post';
        const top = h + 0.9;
        for (let i = 0; i < n; i++) {
          const A = p[i], Bq = p[(i + 1) % n], L = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]); if (L < 0.8) continue;
          const ux = (Bq[0] - A[0]) / L, uz = (Bq[1] - A[1]) / L, e = E[i];
          bar(T, A[0], A[1], Bq[0], Bq[1], top - 0.02, top + 0.07, 0.32, trim);                     // coping
          if (style === 'zig') {
            const m = Math.max(1, Math.round(L / 1.15));
            for (let j = 0; j < m; j++) {
              const t0 = (j + 0.5) * L / m, X = A[0] + ux * t0, Z = A[1] + uz * t0;
              bar(T, X - ux * 0.36, Z - uz * 0.36, X + ux * 0.36, Z + uz * 0.36, top + 0.07, top + 0.27, 0.24, c);
              bar(T, X - ux * 0.22, Z - uz * 0.22, X + ux * 0.22, Z + uz * 0.22, top + 0.27, top + 0.45, 0.22, c);
              bar(T, X - ux * 0.09, Z - uz * 0.09, X + ux * 0.09, Z + uz * 0.09, top + 0.45, top + 0.6, 0.2, trim);
            }
          } else if (style === 'jali' && e) {
            // dark pierced openings on both faces of the parapet
            const m = Math.max(1, Math.floor((L - 0.3) / 0.32)), dk = col.setHex(0x1e1c1a).clone();
            for (let j = 0; j < m; j++) for (const sd of [1, -1]) {
              const t0 = 0.15 + j * (L - 0.3) / m + 0.06, t1 = t0 + (L - 0.3) / m - 0.12, o = sd * 0.104;
              const P0 = [A[0] + ux * t0 + e.nx * o, A[1] + uz * t0 + e.nz * o], P1 = [A[0] + ux * t1 + e.nx * o, A[1] + uz * t1 + e.nz * o];
              T.oquad([P0[0], h + 0.25, P0[1]], [P1[0], h + 0.25, P1[1]], [P1[0], h + 0.7, P1[1]], [P0[0], h + 0.7, P0[1]], [e.nx * sd, 0, e.nz * sd], dk);
            }
          } else if (style === 'band' && e) {
            slab(T, [A[0] + e.nx * 0.1, A[1] + e.nz * 0.1], [Bq[0] + e.nx * 0.1, Bq[1] + e.nz * 0.1], e.nx, e.nz, 0, 0.03, h + 0.35, h + 0.55, trim);
          } else {
            const m = Math.max(1, Math.round(L / 1.6));
            for (let j = 0; j <= m; j++) { const X = A[0] + ux * L * j / m, Z = A[1] + uz * L * j / m; bar(T, X - ux * 0.15, Z - uz * 0.15, X + ux * 0.15, Z + uz * 0.15, top, top + 0.35, 0.3, trim); }
          }
        }
      }
      // front veranda (pillars + sunshade slab, some with scalloped arches) on the edge nearest a road
      let front = null, fd = 1e9;
      for (const e of E) if (e.el > 3.2) {
        const mx = (e.a[0] + e.d[0]) / 2 + e.nx * 2.2, mz = (e.a[1] + e.d[1]) / 2 + e.nz * 2.2, rd = roadDist(mx, mz);
        if (rd > 0.6 && rd < fd) { fd = rd; front = e; }
      }
      if (front && fd < 14 && !H.shop) {
        const { a, d, nx, nz, el } = front, tx = (d[0] - a[0]) / el, tz = (d[1] - a[1]) / el;
        const kind = H.old ? (r3 < 0.6 ? 'tileveranda' : 'none') : r3 < 0.55 ? 'veranda' : r3 < 0.75 ? 'arch' : 'none';
        if (kind !== 'none') {
          const dep = 1.7, s0 = Math.min(0.3, el * 0.05), s1 = el - s0, A = [a[0] + tx * s0, a[1] + tz * s0], Dd = [a[0] + tx * s1, a[1] + tz * s1];
          const yS = kind === 'tileveranda' ? Math.min(2.6, h - 0.3) : Math.min(3.0, h - 0.15);
          slab(T, A, Dd, nx, nz, 0, dep, 0, 0.32, plinth);                                       // raised veranda floor
          slab(T, A, Dd, nx, nz, dep - 0.02, dep + 0.35, 0, 0.16, shade(plinth, 0.9));          // step
          if (kind === 'tileveranda') {
            const tc2 = col.setHex(0xa4502f).clone(), y2 = yS - 0.55;
            T.oquad([A[0], yS, A[1]], [Dd[0], yS, Dd[1]], [Dd[0] + nx * (dep + 0.35), y2, Dd[1] + nz * (dep + 0.35)], [A[0] + nx * (dep + 0.35), y2, A[1] + nz * (dep + 0.35)], [nx * 0.5, 0.86, nz * 0.5], tc2);
            T.oquad([A[0], yS - 0.04, A[1]], [Dd[0], yS - 0.04, Dd[1]], [Dd[0] + nx * (dep + 0.35), y2 - 0.04, Dd[1] + nz * (dep + 0.35)], [A[0] + nx * (dep + 0.35), y2 - 0.04, A[1] + nz * (dep + 0.35)], [0, -1, 0], col.setHex(0x5a4030).clone());
          } else {
            slab(T, [A[0] - tx * 0.15, A[1] - tz * 0.15], [Dd[0] + tx * 0.15, Dd[1] + tz * 0.15], nx, nz, 0, dep + 0.25, yS, yS + 0.14, c);   // sunshade slab
            slab(T, [A[0] - tx * 0.15, A[1] - tz * 0.15], [Dd[0] + tx * 0.15, Dd[1] + tz * 0.15], nx, nz, dep + 0.15, dep + 0.28, yS - 0.1, yS + 0.2, trim);
          }
          const nb = Math.max(1, Math.round((s1 - s0) / 2.6)), pc = kind === 'tileveranda' ? col.setHex(0x6b4a2e).clone() : (r4 < 0.5 ? trim : col.setHex(0xf2efe6).clone());
          const yTop = kind === 'tileveranda' ? yS - 0.5 : yS;
          for (let j = 0; j <= nb; j++) {
            const t0 = s0 + (s1 - s0) * j / nb, X = a[0] + tx * t0 + nx * (dep - 0.18), Z = a[1] + tz * t0 + nz * (dep - 0.18);
            bar(T, X - tx * 0.11, Z - tz * 0.11, X + tx * 0.11, Z + tz * 0.11, 0.32, yTop, 0.2, pc);
            bar(T, X - tx * 0.16, Z - tz * 0.16, X + tx * 0.16, Z + tz * 0.16, 0.32, 0.6, 0.28, pc);          // pillar base
            bar(T, X - tx * 0.16, Z - tz * 0.16, X + tx * 0.16, Z + tz * 0.16, yTop - 0.18, yTop, 0.28, pc);  // capital
          }
          if (kind === 'arch') {
            // scalloped arch fascia between pillars (three lobes per bay)
            for (let j = 0; j < nb; j++) {
              const b0 = s0 + (s1 - s0) * j / nb + 0.11, b1 = s0 + (s1 - s0) * (j + 1) / nb - 0.11, bw = b1 - b0, o = dep - 0.18;
              const yAt = (t) => { const x = (t - b0) / bw, lobe = Math.abs(Math.sin(x * Math.PI * 3)) * 0.12; return yS - 0.75 + Math.sin(x * Math.PI) * 0.62 - lobe * Math.sin(x * Math.PI); };
              const SEG = 12;
              for (let k = 0; k < SEG; k++) {
                const ta = b0 + bw * k / SEG, tb = b0 + bw * (k + 1) / SEG;
                const Pa = [a[0] + tx * ta + nx * o, a[1] + tz * ta + nz * o], Pb = [a[0] + tx * tb + nx * o, a[1] + tz * tb + nz * o];
                for (const sd of [1, -1]) {
                  const off = sd * 0.1;
                  T.oquad([Pa[0] + nx * off, yAt(ta), Pa[1] + nz * off], [Pb[0] + nx * off, yAt(tb), Pb[1] + nz * off], [Pb[0] + nx * off, yS, Pb[1] + nz * off], [Pa[0] + nx * off, yS, Pa[1] + nz * off], [nx * sd, 0, nz * sd], sd > 0 ? c : shade(c, 0.8));
                }
                T.oquad([Pa[0] - nx * 0.1, yAt(ta), Pa[1] - nz * 0.1], [Pb[0] - nx * 0.1, yAt(tb), Pb[1] - nz * 0.1], [Pb[0] + nx * 0.1, yAt(tb), Pb[1] + nz * 0.1], [Pa[0] + nx * 0.1, yAt(ta), Pa[1] + nz * 0.1], [0, -1, 0], shade(c, 0.6));
              }
            }
          }
          // tulsi kota in front of the veranda on some houses
          if (r1 > 0.55) {
            const t0 = el * (0.25 + r4 * 0.5), X = a[0] + tx * t0 + nx * (dep + 1.4), Z = a[1] + tz * t0 + nz * (dep + 1.4);
            if (roadDist(X, Z) > 0.5) {
              stamp(T, VPROPS.tulsi, X, 0, Z, Math.atan2(nx, nz), 1, ['#f4f1e8', '#e8b04a', '#c9b3e0', '#a8d8a0'].map(x2 => new THREE.Color(x2))[Math.floor(r2 * 4)]);
              stamp(cell.green, shrubG, X, 0.92, Z, r3 * 6, 0.55, new THREE.Color(0.55, 0.8, 0.45));
            }
          }
        }
      }
      // muggu (rangoli) in front of the main door, wet-earth platform, buckets and drums by the wall
      for (const e of E) {
        const { a, nx, nz, el, u } = e, tx = (e.d[0] - a[0]) / el, tz = (e.d[1] - a[1]) / el, tw = el / u;
        if (e.vIdx === 1) {
          const sm = (0.35) * tw, X = a[0] + tx * sm + nx * 1.6, Z = a[1] + tz * sm + nz * 1.6;
          if (hh(X, Z, 2.2) < 0.55 && roadDist(X, Z) > -1.0) {
            const k = Math.floor(hh(X, Z, 6.1) * 4), u0 = (k % 2) * 0.5, v0 = 1 - Math.floor(k / 2) * 0.5, R = 0.7, y = 0.1;
            rangoli.quad([X - tx * R - nx * R, y, Z - tz * R - nz * R], [X + tx * R - nx * R, y, Z + tz * R - nz * R], [X + tx * R + nx * R, y, Z + tz * R + nz * R], [X - tx * R + nx * R, y, Z - tz * R + nz * R], [0, 1, 0], [[u0, v0 - 0.5], [u0 + 0.5, v0 - 0.5], [u0 + 0.5, v0], [u0, v0]], aoOut);
          }
        }
        // clutter against the wall (within reach of the street)
        for (let t = 1.0; t < el - 0.8; t += 3.0) {
          const X = a[0] + tx * t + nx * 0.45, Z = a[1] + tz * t + nz * 0.45, r = hh(X, Z, 3.7);
          if (r > 0.42) continue;
          const rd = roadDist(X, Z); if (rd < 0.2 || rd > 12) continue;
          const ang = Math.atan2(tx, tz), C = cell.clutter;
          const ks = (k2, g2, x2, z2, a2, tint) => { const v0 = C.pos.length / 3; stamp(C, g2, x2, 0, z2, a2, 1, tint); CLUTTER.push({ k: k2, x: x2, z: z2, ang: a2, tint: tint || null, cell, v0, v1: C.pos.length / 3 }); };
          if (r < 0.1) ks('drum', VPROPS.drum, X, Z, ang, DRUM_COLS[Math.floor(r * 50) % DRUM_COLS.length]);
          else if (r < 0.2) { ks('bucket', VPROPS.bucket, X, Z, 0, BUCKET_COLS[Math.floor(r * 60) % 6]); ks('pot', VPROPS.pot, X + tx * 0.45, Z + tz * 0.45, 0, new THREE.Color(r < 0.15 ? 0xb87333 : 0x9a4a2a)); }
          else if (r < 0.27) ks('cycle', VPROPS.cycle, X + nx * 0.1, Z + nz * 0.1, ang - Math.PI / 2 + 0.12);
          else if (r < 0.32) stamp(C, VPROPS.bricks, X + nx * 0.3, 0, Z + nz * 0.3, ang, 1);
          else if (r < 0.35) stamp(C, VPROPS.cart, X + nx * 0.6, 0, Z + nz * 0.6, ang + Math.PI / 2, 1);
          else ks('bucket', VPROPS.bucket, X, Z, 0, BUCKET_COLS[Math.floor(r * 90) % 6]);
        }
        // weeds and grass along the wall foot
        for (let t = 0.3; t < el; t += 0.9) {
          const r = hh(a[0] + tx * t, a[1] + tz * t, 1.9); if (r > 0.55) continue;
          const X = a[0] + tx * t + nx * (0.12 + r * 0.4), Z = a[1] + tz * t + nz * (0.12 + r * 0.4);
          stampGrass(cell.grass, X, Z, r * 9, 0.6 + r * 0.9, new THREE.Color(0.75 + r * 0.3, 0.85 + r * 0.2, 0.6));
        }
      }
    }

    // compound walls: shrubs and bougainvillea spilling over, weeds at the foot, contact shading
    for (const w of D.walls) {
      const L = Math.hypot(w[2] - w[0], w[3] - w[1]); if (L < 0.5) continue;
      const ux = (w[2] - w[0]) / L, uz = (w[3] - w[1]) / L, nx = -uz, nz = ux;
      aoStrip([w[0], w[1]], [w[2], w[3]], nx, nz, 0.6, 0.8); aoStrip([w[2], w[3]], [w[0], w[1]], -nx, -nz, 0.6, 0.8);
      const cell = vCell((w[0] + w[2]) / 2, (w[1] + w[3]) / 2);
      for (let t = 0.6; t < L; t += 2.2) {
        const X = w[0] + ux * t, Z = w[1] + uz * t, r = hh(X, Z, 2.7);
        if (r < 0.3) {   // shrub top behind the wall, bougainvillea on some
          const side = roadDist(X + nx, Z + nz) > roadDist(X - nx, Z - nz) ? 1 : -1, bou = r < 0.11;
          const tint = bou ? new THREE.Color(1, 1, 1) : new THREE.Color(0.6 + r, 0.85, 0.5);
          stamp(bou ? cell.bou : cell.green, shrubG, X + nx * side * 0.45, 0.7 + r * 1.2, Z + nz * side * 0.45, r * 20, 1.5 + r * 2.5, tint);
          if (bou) stamp(cell.green, shrubG, X + nx * side * 0.1 + ux * 0.6, 1.3, Z + nz * side * 0.1 + uz * 0.6, r * 31, 1.3, new THREE.Color(0.55, 0.8, 0.4));
        }
        for (const sd of [1, -1]) if (hh(X + sd, Z, 4.1) < 0.6)
          stampGrass(cell.grass, X + nx * sd * 0.3 + ux * r, Z + nz * sd * 0.3 + uz * r, r * 7, 0.7 + r, new THREE.Color(0.8, 0.9, 0.6));
      }
    }

    // CC lanes: kerb, drain lip, slab covers over the drain, panel joints, damp edges
    const joints = new Builder(), jointCol = new THREE.Color(0.8, 0.79, 0.76), dampCol = new THREE.Color(0.66, 0.66, 0.6), crackCol = new THREE.Color(0.7, 0.68, 0.65);
    for (const r of VR) if ((r.t === 'cc' || r.t === 'lane') && !r.plain) {
      const y = ROAD_STYLE[r.t].y + 0.015;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], c2 = r.p[i + 1], L = Math.hypot(c2[0] - a[0], c2[1] - a[1]); if (L < 1) continue;
        const ux = (c2[0] - a[0]) / L, uz = (c2[1] - a[1]) / L, nx = -uz, nz = ux, hw = r.w / 2;
        const cell = vCell((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2), T = cell.trim;
        // transverse panel joints every ~3.6 m and a centre joint
        for (let d = 1.8; d < L; d += 3.6) {
          const X = a[0] + ux * d, Z = a[1] + uz * d;
          joints.quad([X - nx * hw - ux * 0.025, y, Z - nz * hw - uz * 0.025], [X + nx * hw - ux * 0.025, y, Z + nz * hw - uz * 0.025], [X + nx * hw + ux * 0.025, y, Z + nz * hw + uz * 0.025], [X - nx * hw + ux * 0.025, y, Z - nz * hw + uz * 0.025], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], jointCol);
          if (hh(X, Z, 8.3) < 0.25) {      // hairline crack across a panel
            const o = (hh(Z, X, 2.1) - 0.5) * hw, X2 = X + ux * 1.8 + nx * o, Z2 = Z + uz * 1.8 + nz * o;
            joints.quad([X + nx * o * 0.3, y, Z + nz * o * 0.3], [X2, y, Z2], [X2 + ux * 0.03, y, Z2 + uz * 0.03 + 0.03], [X + nx * o * 0.3 + 0.03, y, Z + nz * o * 0.3 + 0.03], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], crackCol);
          }
        }
        if (r.w > 3.2) joints.quad([a[0] - nx * 0.02, y, a[1] - nz * 0.02], [c2[0] - nx * 0.02, y, c2[1] - nz * 0.02], [c2[0] + nx * 0.02, y, c2[1] + nz * 0.02], [a[0] + nx * 0.02, y, a[1] + nz * 0.02], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], jointCol);
        if (!r.drainRoad) {
        // kerb at the slab edge and the outer lip of the open drain (drain sits at hw+0.35, 0.55 wide)
        const side = 1, kc = col.setHex(0xb8b4aa).clone();
        const K0 = [a[0] + nx * (hw + 0.02) * side, a[1] + nz * (hw + 0.02) * side], K1 = [c2[0] + nx * (hw + 0.02) * side, c2[1] + nz * (hw + 0.02) * side];
        bar(T, K0[0], K0[1], K1[0], K1[1], 0, 0.18, 0.12, kc);
        const D0 = [a[0] + nx * (hw + 0.68), a[1] + nz * (hw + 0.68)], D1 = [c2[0] + nx * (hw + 0.68), c2[1] + nz * (hw + 0.68)];
        bar(T, D0[0], D0[1], D1[0], D1[1], 0, 0.2, 0.12, shade(kc, 0.9));
        // damp patch on the earth beyond the drain
        AO.pos.push(D0[0], 0.07, D0[1], D1[0], 0.07, D1[1], D1[0] + nx * 0.9, 0.07, D1[1] + nz * 0.9, D0[0], 0.07, D0[1], D1[0] + nx * 0.9, 0.07, D1[1] + nz * 0.9, D0[0] + nx * 0.9, 0.07, D0[1] + nz * 0.9);
        for (let k = 0; k < 6; k++) AO.nor.push(0, 1, 0), AO.uv.push(0, 0);
        for (const cc of [dampCol, dampCol, aoOut, dampCol, aoOut, aoOut]) AO.col.push(cc.r, cc.g, cc.b);
        // slab covers over the drain at doorways / crossings
        for (let d = 1.0; d < L - 1; d += 5.5) {
          if (hh(a[0] + ux * d, a[1] + uz * d, 5.9) > 0.3) continue;
          const X = a[0] + ux * d + nx * (hw + 0.35), Z = a[1] + uz * d + nz * (hw + 0.35);
          bar(T, X - nx * 0.5, Z - nz * 0.5, X + nx * 0.5, Z + nz * 0.5, 0.1, 0.2, 0.9 + hh(X, Z, 1.1) * 0.6, col.setHex(0xa9a59b).clone());
        }
        }
        // grass and weeds where the earth meets the kerb / drain lip
        for (let d = 0.5; d < L; d += 1.3) {
          const rr = hh(a[0] + ux * d, a[1] + uz * d, 6.6); if (rr > 0.5) continue;
          const o = hw + 0.8 + rr * 0.8;
          stampGrass(cell.grass, a[0] + ux * d + nx * o, a[1] + uz * d + nz * o, rr * 13, 0.6 + rr, new THREE.Color(0.8 + rr * 0.3, 0.9, 0.55));
          if (rr < 0.2) { const o2 = -(hw + 0.4 + rr * 1.5); stampGrass(cell.grass, a[0] + ux * d + nx * o2, a[1] + uz * d + nz * o2, rr * 17, 0.5 + rr, new THREE.Color(0.85, 0.9, 0.6)); }
        }
      }
    }
    // wall-base darkening baked into vertex colours (houses and compound walls)
    for (const B of [...wallB, cw, cwp]) for (let i = 0; i < B.pos.length / 3; i++) {
      if (B.pos[i * 3 + 1] < 0.01) { B.col[i * 3] *= 0.66; B.col[i * 3 + 1] *= 0.64; B.col[i * 3 + 2] *= 0.62; }
    }
    const aoMesh = AO.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    aoMesh.renderOrder = 1; group.add(aoMesh);
    const jm = joints.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    jm.renderOrder = 1; group.add(jm);
    const rgm = rangoli.mesh(new THREE.MeshLambertMaterial({ map: decoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    rgm.receiveShadow = true; group.add(rgm);
    const villageGroup = new THREE.Group(); villageGroup.name = 'villageDetail'; group.add(villageGroup);
    const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const greenMat = new THREE.MeshLambertMaterial({ map: leafCardTexture(), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide });
    const bouTex = (() => {      // bougainvillea: leaf sprigs smothered in magenta bracts
      const t = leafCardTexture(), g = t.image.getContext('2d');
      const d = g.getImageData(0, 0, 256, 256).data;
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        if (d[(Math.floor(y) * 256 + Math.floor(x)) * 4 + 3] < 128) continue;
        g.fillStyle = `hsl(${310 + Math.random() * 30},${70 + Math.random() * 20}%,${42 + Math.random() * 18}%)`;
        g.beginPath(); g.arc(x, y, 2.5 + Math.random() * 3, 0, 7); g.fill();
      }
      t.needsUpdate = true; return t;
    })();
    const bouMat = new THREE.MeshLambertMaterial({ map: bouTex, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide });
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const clutterMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const e of vCells.values()) {
      for (const [k, B, mat] of [['trim', e.trim, trimMat], ['green', e.green, greenMat], ['bou', e.bou, bouMat], ['grass', e.grass, grassMat], ['clutter', e.clutter, clutterMat]]) {
        if (!B.pos.length) continue;
        const m = B.mesh(mat); m.geometry.computeBoundingSphere(); m.visible = false;
        if (k === 'trim' || k === 'clutter') m.castShadow = true;
        m.receiveShadow = k !== 'grass';
        e.meshes[k] = m; villageGroup.add(m);
      }
      e.trim = e.green = e.bou = e.grass = e.clutter = null;
    }
    // clutter API: list of knockable props; hide(p) collapses its vertices in the merged mesh (it is then drawn loose)
    const clutterApi = {
      items: CLUTTER, protos: VPROPS, material: clutterMat,
      hide(p) {
        const m = p.cell.meshes.clutter; if (!m || p.hidden) return; p.hidden = true;
        const P = m.geometry.attributes.position;
        for (let i = p.v0; i < p.v1; i++) P.setXYZ(i, p.x, -50, p.z);
        P.needsUpdate = true;
      },
    };
    let vLevel = 'high';
    const V_R = { efficient: { trim: 0, green: 0, bou: 0, grass: 0, clutter: 0 }, low: { trim: 0, green: 0, bou: 0, grass: 0, clutter: 0 }, medium: { trim: 110, green: 110, bou: 110, grass: 60, clutter: 0 }, high: { trim: 90, green: 90, bou: 90, grass: 70, clutter: 90 } };
    function updateVillage(cp) {
      const R = V_R[vLevel] || V_R.high, pad = VC * 0.71;
      for (const e of vCells.values()) {
        const d = Math.hypot(e.x - cp.x, e.z - cp.z) - pad;
        for (const k in e.meshes) e.meshes[k].visible = d < R[k];
      }
    }

    // ---------------- farm fields: bunds, orchards, near-camera crops, field features
    const fieldGroup = new THREE.Group(); fieldGroup.name = 'fields'; group.add(fieldGroup);
    const FG = 100, fGrid = new Map();                       // field lookup grid (100 m cells)
    FI.forEach(f => {
      for (let gx = Math.floor(f.x0 / FG); gx <= Math.floor(f.x1 / FG); gx++)
        for (let gz = Math.floor(f.z0 / FG); gz <= Math.floor(f.z1 / FG); gz++) {
          const k = gx + ',' + gz; if (!fGrid.has(k)) fGrid.set(k, []); fGrid.get(k).push(f);
        }
    });
    const fieldAt = (x, z) => { for (const f of fGrid.get(Math.floor(x / FG) + ',' + Math.floor(z / FG)) || []) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && pointInPoly(x, z, f.p)) return f; return null; };
    const edgeDist = (x, z, f) => { let d = 1e9; for (let k = 0; k < f.p.length; k++) { const a = f.p[k], b = f.p[(k + 1) % f.p.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); d = Math.min(d, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return d; };
    // detected tree crowns inside orchard parcels are replaced by the planted grid below
    D.trees = D.trees.filter(t => { const f = fieldAt(t[0], t[1]); return !(f && f.c === 6); });
    // dark open water reads as canopy to the tree detector: drop "trees" standing in the tanks
    D.trees = D.trees.filter(t => !D.lakes.some(lk => pointInPoly(t[0], t[1], lk)));
    // trees never stand on a carriageway: shift onto the verge, drop if there is no room
    D.trees = D.trees.filter(t => { const p = pushOffRoad(t[0], t[1], 1.2); if (!p) return false; t[0] = p[0]; t[1] = p[1]; return true; });
    // parcels the imagery shows full of tree crowns are wooded, not cropped: no crop rows there
    FI.forEach(f => f.trees = 0);
    for (const t of D.trees) { const f = fieldAt(t[0], t[1]); if (f) f.trees++; }
    FI.forEach(f => { f.wooded = f.trees * 1000 / Math.max(f.area, 1) > 1.2; });
    // trees standing on a bund line: in Telangana these are mostly toddy / date palms
    const bundTree = D.trees.map(t => { const f = fieldAt(t[0], t[1]); return !!f && edgeDist(t[0], t[1], f) < 3; });

    // bunds: trapezoid earthen ridges (0.35 m high, 0.6 m base), one mesh per 8x8 chunk, hidden beyond the LOD range
    const BCH = 8, bundChunks = [];
    // bund segments in a 10 m grid for bundAt(x, z): ridge height under a point (trapezoid: 0.2 m flat top, 0.6 m base)
    const BUG = 10, bundGrid = new Map();
    function addBundSeg(ax, az, bx, bz, hgt) {
      const sg = [ax, az, bx, bz, hgt];
      for (let gx = Math.floor((Math.min(ax, bx) - 0.4) / BUG); gx <= Math.floor((Math.max(ax, bx) + 0.4) / BUG); gx++)
        for (let gz = Math.floor((Math.min(az, bz) - 0.4) / BUG); gz <= Math.floor((Math.max(az, bz) + 0.4) / BUG); gz++) {
          const k = gx + ',' + gz; let l = bundGrid.get(k); if (!l) bundGrid.set(k, l = []); l.push(sg);
        }
    }
    function bundAt(x, z) {
      const l = bundGrid.get(Math.floor(x / BUG) + ',' + Math.floor(z / BUG)); if (!l) return 0;
      let best = 0;
      for (const [ax, az, bx, bz, hgt] of l) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = ((x - ax) * dx + (z - az) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const d = Math.abs((x - ax) * dz - (z - az) * dx) / Math.sqrt(L2);
        if (d >= 0.3) continue;
        const y = d <= 0.1 ? hgt : hgt * (0.3 - d) / 0.2; if (y > best) best = y;
      }
      return best;
    }
    const bundTex = tex(noiseCanvas(128, [150, 124, 88], 40, 400));
    const bundMat = new THREE.MeshLambertMaterial({ map: bundTex, vertexColors: true });
    {
      const seen = new Set(), builders = [];
      for (let i = 0; i < BCH * BCH; i++) builders.push(new Builder());
      const dirtC = new THREE.Color(0x9a7c56), grassC = new THREE.Color(0x7d8a4a), dryC = new THREE.Color(0xa89466);
      for (const f of FI) for (let k = 0; k < f.p.length; k++) {
        const a = f.p[k], b = f.p[(k + 1) % f.p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1.5) continue;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        let an = Math.atan2(b[1] - a[1], b[0] - a[0]); if (an < 0) an += Math.PI;
        const key = Math.round(mx / 3) + ',' + Math.round(mz / 3) + ',' + Math.round(an / 0.2) % 16;
        if (seen.has(key)) continue; seen.add(key);
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
        const ci = Math.min(BCH - 1, Math.max(0, Math.floor((mx - xmin) / W * BCH))) * BCH + Math.min(BCH - 1, Math.max(0, Math.floor((mz - zmin) / H * BCH)));
        const B = builders[ci], hgt = 0.3 + hash(mx, mz) * 0.1, ext = 0.3;
        addBundSeg(a[0] - ux * ext, a[1] - uz * ext, b[0] + ux * ext, b[1] + uz * ext, hgt);
        const ax = a[0] - ux * ext, az = a[1] - uz * ext, bx = b[0] + ux * ext, bz = b[1] + uz * ext, Lu = (L + 2 * ext) / 2;
        const top = hash(mz, mx) < 0.5 ? grassC : dryC;
        const P = (x, z, o, y) => [x + nx * o, y, z + nz * o];
        B.oquad(P(ax, az, -0.3, 0.01), P(bx, bz, -0.3, 0.01), P(bx, bz, -0.1, hgt), P(ax, az, -0.1, hgt), [-nx, 0.8, -nz], dirtC, [[0, 0], [Lu, 0], [Lu, 0.4], [0, 0.4]]);
        B.oquad(P(ax, az, -0.1, hgt), P(bx, bz, -0.1, hgt), P(bx, bz, 0.1, hgt), P(ax, az, 0.1, hgt), [0, 1, 0], top, [[0, 0.4], [Lu, 0.4], [Lu, 0.6], [0, 0.6]]);
        B.oquad(P(ax, az, 0.1, hgt), P(bx, bz, 0.1, hgt), P(bx, bz, 0.3, 0.01), P(ax, az, 0.3, 0.01), [nx, 0.8, nz], dirtC, [[0, 0.6], [Lu, 0.6], [Lu, 1], [0, 1]]);
      }
      builders.forEach((B, i) => {
        if (!B.pos.length) return;
        const m = B.mesh(bundMat); m.receiveShadow = true; m.geometry.computeBoundingSphere();
        const gx = Math.floor(i / BCH), gz = i % BCH;
        bundChunks.push({ m, x: xmin + (gx + 0.5) * W / BCH, z: zmin + (gz + 0.5) * H / BCH, r: Math.hypot(W, H) / BCH / 2 });
        fieldGroup.add(m);
      });
    }

    // orchards: mango trees planted on a ~9 m grid along the parcel axis (the dotted pattern in the imagery)
    {
      const pts = [];
      for (const f of FI) if (f.c === 6) {
        const ca = Math.cos(f.ang), sa = Math.sin(f.ang), R = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / 2 + 9;
        for (let u = -R; u <= R; u += 9) for (let w = -R; w <= R; w += 9) {
          const x = f.cx + ca * u - sa * w, z = f.cz + sa * u + ca * w;
          if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || !pointInPoly(x, z, f.p) || edgeDist(x, z, f) < 3) continue;
          pts.push([x + (hash(x, z) - 0.5) * 0.8, z + (hash(z, x) - 0.5) * 0.8, 4.5 + hash(x * 1.3, z) * 2.5]);
        }
      }
      if (pts.length) {
        const tg = new THREE.CylinderGeometry(0.14, 0.24, 1, 6, 1, true); tg.translate(0, 0.5, 0);
        const cg = new THREE.IcosahedronGeometry(1, 1);
        { const p = cg.attributes.position, nr = cg.attributes.normal; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + Math.sin(x * 7 + z * 5) * 0.08 + Math.cos(y * 9) * 0.05; nr.setXYZ(i, x, y * 1.2 + 0.25, z); p.setXYZ(i, x * k, y * 0.72 * k, z * k); } for (let i = 0; i < nr.count; i++) { const l = Math.hypot(nr.getX(i), nr.getY(i), nr.getZ(i)); nr.setXYZ(i, nr.getX(i) / l, nr.getY(i) / l, nr.getZ(i) / l); } }
        const otr = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0x6e5a44 }), pts.length);
        const ocr = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ map: leafTexture(), color: 0xffffff }), pts.length);
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color();
        pts.forEach((t, i) => {
          const s0 = t[2];
          M.compose(V.set(t[0], 0, t[1]), Q.identity(), S.set(1, s0 * 0.32, 1)); otr.setMatrixAt(i, M);
          Q.setFromAxisAngle(V.set(0, 1, 0), hash(t[0], t[1]) * 6.28);
          M.compose(V.set(t[0], s0 * 0.32 + s0 * 0.3, t[1]), Q, S.set(s0 * 0.5, s0 * 0.42, s0 * 0.5)); ocr.setMatrixAt(i, M);
          ocr.setColorAt(i, C.setHSL(0.27 + hash(t[1], t[0]) * 0.04, 0.45, 0.24 + hash(t[0] * 2, t[1]) * 0.06));
          segs.push([t[0] - 0.25, t[1], t[0] + 0.25, t[1]]);
        });
        otr.castShadow = ocr.castShadow = true; fieldGroup.add(otr); fieldGroup.add(ocr);
        lodChunks(splitIM(otr, { cell: 240 }), 'keep'); lodChunks(splitIM(ocr, { cell: 240 }), 'keep');
      }
    }

    // field features, kept sparse: bore-well pump sheds by paddy, scarecrows in crops, a few farm huts, thorn fences
    {
      const fb = new Builder(), C = (h) => new THREE.Color(h);
      const brick = C(0xb8806a), tin = C(0x8e9aa2), pipe = C(0x3d5f8a), pole = C(0x6b5038), cloth = [C(0xc0392b), C(0x2e5fa8), C(0xe0c050), C(0xf0ece0)], pot = C(0xb06a40), thatch = C(0xb8a070), mud = C(0xa88a66);
      const box = (x, z, w, d, y0, y1, rot, c) => {
        const ca = Math.cos(rot), sa = Math.sin(rot), P = (u, v, y) => [x + ca * u - sa * v, y, z + sa * u + ca * v];
        const c4 = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        for (let k = 0; k < 4; k++) { const a = c4[k], b = c4[(k + 1) % 4]; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; fb.oquad(P(a[0], a[1], y0), P(b[0], b[1], y0), P(b[0], b[1], y1), P(a[0], a[1], y1), [ca * mx - sa * mz, 0, sa * mx + ca * mz], c); }
        fb.oquad(P(-w / 2, -d / 2, y1), P(w / 2, -d / 2, y1), P(w / 2, d / 2, y1), P(-w / 2, d / 2, y1), [0, 1, 0], c);
      };
      const roof = (x, z, w, d, y, rise, rot, c) => {           // single-slope tin sheet / pyramid thatch
        const ca = Math.cos(rot), sa = Math.sin(rot), P = (u, v, yy) => [x + ca * u - sa * v, yy, z + sa * u + ca * v];
        fb.oquad(P(-w / 2, -d / 2, y + rise), P(w / 2, -d / 2, y + rise), P(w / 2, d / 2, y), P(-w / 2, d / 2, y), [0, 1, 0], c);
        fb.oquad(P(-w / 2, d / 2, y), P(w / 2, d / 2, y), P(w / 2, -d / 2, y + rise), P(-w / 2, -d / 2, y + rise), [0, -1, 0], c);
      };
      const clearOf = (x, z, r) => !roadSegs.some(([a2, c2, t2, w2]) => { const dx = c2[0] - a2[0], dz = c2[1] - a2[1], L2 = dx * dx + dz * dz || 1, tt = Math.max(0, Math.min(1, ((x - a2[0]) * dx + (z - a2[1]) * dz) / L2)); return Math.hypot(x - a2[0] - tt * dx, z - a2[1] - tt * dz) < w2 / 2 + r; }) && !nearBuilding(x, z);
      const inner = (f, d) => {                                 // a point a few metres in from the field's first corner
        const a = f.p[0], dx = f.cx - a[0], dz = f.cz - a[1], L = Math.hypot(dx, dz) || 1;
        return [a[0] + dx / L * d, a[1] + dz / L * d];
      };
      let nShed = 0, nCrow = 0, nHut = 0, nFence = 0;
      for (const f of FI) {
        if ((f.c === 2 || f.c === 3) && f.area > 2500 && f.h > 0.86) {                 // bore-well pump shed
          const [x, z] = inner(f, 4); if (!pointInPoly(x, z, f.p) || !clearOf(x, z, 4)) continue;
          box(x, z, 1.8, 1.6, 0, 1.9, f.ang, brick); roof(x, z, 2.4, 2.2, 1.9, 0.3, f.ang, tin);
          const ca = Math.cos(f.ang), sa = Math.sin(f.ang);
          box(x + ca * 1.4, z + sa * 1.4, 0.12, 0.12, 0, 0.9, f.ang, pipe); box(x + ca * 2.2, z + sa * 2.2, 1.6, 0.12, 0.75, 0.87, f.ang, pipe);
          box(x - sa * 1.6, z + ca * 1.6, 1.2, 0.9, 0, 0.5, f.ang, C(0x9a9a92));          // small cistern the pipe empties into
          segs.push([x - 1, z, x + 1, z], [x, z - 1, x, z + 1]); nShed++;
        } else if (f.c === 4 && f.area > 1800 && f.h > 0.9) {                           // scarecrow
          const x = f.cx, z = f.cz; if (!pointInPoly(x, z, f.p) || !clearOf(x, z, 3)) continue;
          box(x, z, 0.08, 0.08, 0, 1.9, f.ang, pole); box(x, z, 1.3, 0.06, 1.35, 1.42, f.ang, pole);
          box(x, z, 0.5, 0.25, 0.85, 1.45, f.ang, cloth[Math.floor(f.h * 37) % 4]); box(x, z, 0.3, 0.3, 1.55, 1.85, f.ang + 0.6, pot);
          nCrow++;
        } else if ((f.c === 6 || f.c === 0) && f.area > 5000 && f.h < 0.05) {          // farm hut
          const [x, z] = inner(f, 6); if (!pointInPoly(x, z, f.p) || !clearOf(x, z, 5)) continue;
          box(x, z, 3.2, 2.6, 0, 1.9, f.ang, mud); roof(x, z, 4.0, 3.4, 1.9, 0.9, f.ang, thatch);
          segs.push([x - 1.6, z - 1.3, x + 1.6, z - 1.3], [x + 1.6, z - 1.3, x + 1.6, z + 1.3], [x + 1.6, z + 1.3, x - 1.6, z + 1.3], [x - 1.6, z + 1.3, x - 1.6, z - 1.3]); nHut++;
        }
      }
      if (fb.pos.length) { const m = fb.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })); m.castShadow = m.receiveShadow = true; fieldGroup.add(m); }
      // thorn fences: cut babul branches heaped along the road-facing edge of some crop fields
      const fence = new Builder(), fc0 = new THREE.Color(1, 1, 1);
      for (const f of FI) {
        if (!(f.c === 4 || f.c === 6) || f.h < 0.6 || f.h > 0.72) continue;
        const e = longEdge(f), a = e[0], b = e[1], L = e[2]; if (L < 15) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (let d = 1; d < L - 1; d += 1.6) {
          const x = a[0] + ux * d, z = a[1] + uz * d, hh = 0.9 + hash(x, z) * 0.6, o = (hash(z, x) - 0.5) * 0.4;
          const x0 = x - ux * 1.0 - uz * o, z0 = z - uz * 1.0 + ux * o, x1 = x + ux * 1.0 - uz * o, z1 = z + uz * 1.0 + ux * o;
          fence.oquad([x0, 0, z0], [x1, 0, z1], [x1, hh, z1], [x0, hh, z0], [-uz, 0, ux], fc0, [[5 / 6, 0], [1, 0], [1, 1], [5 / 6, 1]]);
        }
        nFence++;
      }
      if (fence.pos.length) fieldGroup.add(fence.mesh(new THREE.MeshLambertMaterial({ map: cropAtlasTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })));
      console.log('[fields]', FI.length, 'parcels; pump sheds', nShed, 'scarecrows', nCrow, 'huts', nHut, 'thorn fences', nFence);
    }

    // near-camera crops: instanced patches of real plants inside each field, rebuilt as the camera moves
    const CROP = {
      paddy:  { geo: cropPatchGeometry(0, 2, 0.25, 0.4, 0.4, 0.62, false, 0.08), size: 2, cap: 6000 },
      cotton: { geo: cropPatchGeometry(1, 3, 0.9, 0.6, 0.9, 1.0, true, 0.12), size: 3, cap: 2600 },
      maize:  { geo: cropPatchGeometry(2, 3, 0.75, 0.45, 0.7, 2.1, true, 0.08), size: 3, cap: 2600 },
      chilli: { geo: cropPatchGeometry(3, 3, 0.6, 0.45, 0.6, 0.6, true, 0.1), size: 3, cap: 2600 },
      tuft:   { geo: cropPatchGeometry(4, 1, 1, 1, 0.6, 0.45, true, 0.3), size: 1, cap: 3000 },
    };
    const cropMat = new THREE.MeshLambertMaterial({ map: cropAtlasTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    // plant cards carry up-facing normals: light both faces like the front so back faces don't go black
    cropMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace(/\?\s*vIndirectFront\s*:\s*vIndirectBack/g, '? vIndirectFront : vIndirectFront').replace(/\?\s*vLightFront\s*:\s*vLightBack/g, '? vLightFront : vLightFront'); };
    for (const k in CROP) {
      const c = CROP[k]; c.im = new THREE.InstancedMesh(c.geo, cropMat, c.cap); c.im.count = 0; c.im.frustumCulled = false; c.im.receiveShadow = true;
      c.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fieldGroup.add(c.im);
    }
    let cropR = 85, tuftR = 45, bundLod = 600, cropX = 1e9, cropZ = 1e9;
    function updateFields(cam) {
      for (const b of bundChunks) b.m.visible = Math.hypot(cam.x - b.x, cam.z - b.z) - b.r < bundLod;
      if (Math.abs(cam.x - cropX) + Math.abs(cam.z - cropZ) < 12) return;
      cropX = cam.x; cropZ = cam.z;
      for (const k in CROP) CROP[k].n = 0;
      if (cropR <= 0 || cam.y > 120) { for (const k in CROP) CROP[k].im.count = 0; return; }
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      const seen = new Set(), R = cropR + 10;
      for (let gx = Math.floor((cam.x - R) / FG); gx <= Math.floor((cam.x + R) / FG); gx++)
        for (let gz = Math.floor((cam.z - R) / FG); gz <= Math.floor((cam.z + R) / FG); gz++)
          for (const f of fGrid.get(gx + ',' + gz) || []) {
            if (seen.has(f.i)) continue; seen.add(f.i);
            if (f.x1 < cam.x - R || f.x0 > cam.x + R || f.z1 < cam.z - R || f.z0 > cam.z + R) continue;
            // tufts of grass along this field's bunds
            if (tuftR > 0) {
              const T = CROP.tuft;
              for (let k = 0; k < f.p.length && T.n < T.cap; k++) {
                const a = f.p[k], b = f.p[(k + 1) % f.p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                for (let d = 0.8; d < L && T.n < T.cap; d += 1.9) {
                  const x = a[0] + (b[0] - a[0]) * d / L, z = a[1] + (b[1] - a[1]) * d / L;
                  if (Math.abs(x - cam.x) > tuftR || Math.abs(z - cam.z) > tuftR || hash(x, z) < 0.35) continue;
                  Q.setFromAxisAngle(Y, hash(z, x) * 6.28); const sc = 0.7 + hash(x * 3, z) * 0.7;
                  M.compose(V.set(x + (hash(x, z * 2) - 0.5) * 0.5, 0.25, z + (hash(x * 2, z) - 0.5) * 0.5), Q, S.set(sc, sc, sc)); T.im.setMatrixAt(T.n++, M);
                }
              }
            }
            const kind = f.wooded ? null : f.c === 2 || f.c === 3 ? 'paddy' : f.crop; if (!kind) continue;
            const c = CROP[kind], step = c.size, ca = Math.cos(f.ang), sa = Math.sin(f.ang);
            Q.setFromAxisAngle(Y, -f.ang);
            const hr = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / 2 + step;
            // grid in the field's own frame, anchored at its centroid so rows line up across patches
            for (let u = -hr; u <= hr; u += step) for (let w = -hr; w <= hr; w += step) {
              if (c.n >= c.cap) break;
              const x = f.cx + ca * u - sa * w, z = f.cz + sa * u + ca * w, dx = x - cam.x, dz = z - cam.z;
              if (dx * dx + dz * dz > cropR * cropR || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
              if (!pointInPoly(x, z, f.p) || edgeDist(x, z, f) < step * 0.5 + 0.5) continue;
              const sc = f.c === 3 ? 0.8 : 1;
              M.compose(V.set(x, f.c === 3 ? -0.05 : 0, z), Q, S.set(1, sc * (0.9 + f.h * 0.25), 1)); c.im.setMatrixAt(c.n++, M);
            }
          }
      for (const k in CROP) { const c = CROP[k]; c.im.count = c.n; c.im.instanceMatrix.needsUpdate = true; }
    }
    // quality hook: 'efficient' | 'low' | 'medium' | 'high'
    function setDetail(level) {
      const L2 = { efficient: [0, 0, 220], low: [0, 0, 300], medium: [55, 25, 450], high: [85, 45, 600] }[level] || [85, 45, 600];
      [cropR, tuftR, bundLod] = L2; cropX = 1e9;
      vLevel = V_R[level] ? level : 'high';
      chunkX = 1e9;
    }

    // ---------------- spatial chunking: map-wide instanced / merged meshes are split into CH x CH m cells, each with a
    // true bounding sphere, so camera and shadow-camera frustum culling work (r128 culls an InstancedMesh by its base
    // geometry's sphere, which is why these were all frustumCulled = false and drew every instance every frame).
    // Each chunk also gets a per-tier distance rule (hide / low-poly swap) applied in updateChunks().
    // per-tier distances (m, from the chunk's sphere surface): [low, medium, high]
    const CH_DIST = { shrub: [110, 180, 240], prop: [120, 200, 260], crownLo: [140, 200, 280], trunk: [220, 360, 480], palm: [280, 450, 600] };
    const chDist = (k) => { const t = CH_DIST[k]; return vLevel === 'efficient' ? t[0] * 0.8 : vLevel === 'low' ? t[0] : vLevel === 'medium' ? t[1] : t[2]; };
    function shallowGeo(base, sphere) {          // shares GPU buffers with base; only the bounding sphere differs
      const g = new THREE.BufferGeometry(); g.index = base.index;
      for (const n in base.attributes) g.attributes[n] = base.attributes[n];
      g.groups = base.groups; g.boundingSphere = sphere; return g;
    }
    // split an InstancedMesh into per-cell InstancedMeshes; returns { chunks: [{im, x, z, r, idx: [orig i]}], at: [chunk, local] per orig i }
    function splitIM(im, opt) {
      opt = opt || {};
      const base = im.geometry; if (!base.boundingSphere) base.computeBoundingSphere();
      const bs = base.boundingSphere, M = new THREE.Matrix4(), P = new THREE.Vector3(), cells = new Map(), n = im.count;
      const info = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        im.getMatrixAt(i, M); P.copy(bs.center).applyMatrix4(M);
        const sc = M.getMaxScaleOnAxis(); info.set([P.x, P.y, P.z, bs.radius * sc + (opt.pad || 0)], i * 4);
      }
      for (let i = 0; i < n; i++) {
        const cs = opt.cell || CH, k = opt.key ? opt.key(i) : Math.floor(info[i * 4] / cs) + ',' + Math.floor(info[i * 4 + 2] / cs);
        (cells.get(k) || cells.set(k, []).get(k)).push(i);
      }
      const at = new Array(n), chunks = [];
      for (const idx of cells.values()) {
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
        for (const i of idx) { if (!info[i * 4 + 3]) continue; const x = info[i * 4], y = info[i * 4 + 1], z = info[i * 4 + 2], r = info[i * 4 + 3]; x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); }
        const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); let R = 0;
        for (const i of idx) if (info[i * 4 + 3]) R = Math.max(R, Math.hypot(info[i * 4] - c.x, info[i * 4 + 1] - c.y, info[i * 4 + 2] - c.z) + info[i * 4 + 3]);
        const sph = new THREE.Sphere(c, R);
        const ci = new THREE.InstancedMesh(shallowGeo(base, sph), im.material, idx.length);
        idx.forEach((i, j) => { im.getMatrixAt(i, M); ci.setMatrixAt(j, M); at[i] = [chunks.length, j]; });
        if (im.instanceColor) { const C = new THREE.Color(); idx.forEach((i, j) => { im.getColorAt(i, C); ci.setColorAt(j, C); }); }
        if (im.instanceMatrix.usage === THREE.DynamicDrawUsage) ci.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        ci.castShadow = im.castShadow; ci.receiveShadow = im.receiveShadow; ci.renderOrder = im.renderOrder; ci.name = im.name; ci.visible = im.visible;
        ci.frustumCulled = true;
        chunks.push({ im: ci, x: c.x, z: c.z, r: R, idx, sph }); chunkIMs.add(ci);
      }
      const parent = im.parent;
      if (opt.mirror) {
        // the original stays in the scene graph (other scripts find it by instance count, edit its matrices or hide it)
        // but is taken off every render layer; the chunks follow its matrices and .visible (see syncMirrors)
        im.layers.disableAll(); if (parent) chunks.forEach(ch => parent.add(ch.im));
        mirrors.push({ src: im, chunks, at, ver: im.instanceMatrix.version, vis: true });
      } else if (parent) { parent.remove(im); chunks.forEach(ch => parent.add(ch.im)); }
      return { chunks, at };
    }
    // register chunks for distance rules: kind = 'shrub' | 'prop' | 'trunk' (hidden beyond chDist), or 'keep' (culling only)
    function lodChunks(res, kind, src) { for (const ch of res.chunks) chunkList.push({ ims: [ch.im], x: ch.x, z: ch.z, r: ch.r, kind, src }); return res; }
    const _mm = new THREE.Matrix4();
    function syncMirrors() {
      for (const m of mirrors) {
        if (m.src.instanceMatrix.version !== m.ver) {
          m.ver = m.src.instanceMatrix.version;
          for (let i = 0; i < m.at.length; i++) { const [c, j] = m.at[i]; m.src.getMatrixAt(i, _mm); m.chunks[c].im.setMatrixAt(j, _mm); }
          m.chunks.forEach(ch => ch.im.instanceMatrix.needsUpdate = true);
        }
        if (m.vis !== m.src.visible) { m.vis = m.src.visible; chunkX = 1e9; }
      }
    }
    function updateChunks(cam) {
      syncMirrors();
      if (Math.abs(cam.x - chunkX) + Math.abs(cam.z - chunkZ) < 5) return;
      chunkX = cam.x; chunkZ = cam.z;
      const dS = chDist('shrub'), dP = chDist('prop'), dT = chDist('trunk'), dL = chDist('crownLo'), dPa = chDist('palm');
      for (const c of chunkList) {
        const d = Math.hypot(cam.x - c.x, cam.z - c.z) - c.r;
        if (c.kind === 'shrub') c.ims[0].visible = d < dS;
        else if (c.kind === 'prop') c.ims[0].visible = d < dP && (!c.src || c.src.visible);
        else if (c.kind === 'trunk') c.ims[0].visible = d < dT;
        else if (c.kind === 'palm') c.ims[0].visible = d < dPa;
        else if (c.kind === 'crown') { const lo = d > dL; c.ims[0].visible = !lo; c.ims[1].visible = lo; }
        else if (c.kind === 'mirror') c.ims[0].visible = c.src.visible;
      }
      for (const c of bigChunks) { const d = Math.hypot(cam.x - c.x, cam.z - c.z) - c.r; c.m.castShadow = c.src.castShadow && d < SHADOW_NEAR; if (c.f) { c.m.visible = d < HLOD_NEAR; c.f.visible = !c.m.visible; } }
    }

    // ---------------- trees: neem / tamarind canopies, coconut palms near houses
    const T = D.trees, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const isPalm = T.map((t, i) => hash(t[0], t[1]) < (bundTree[i] ? 0.3 : surfaceAtEarly(t[0], t[1]) === 'field' ? 0.05 : 0.08) || nearBuilding(t[0], t[1]) && hash(t[1], t[0]) < 0.35);
    const broad = T.filter((t, i) => !isPalm[i]), palms = T.filter((t, i) => isPalm[i]);
    const trunkG = new THREE.CylinderGeometry(0.1, 0.24, 1, 6); trunkG.translate(0, 0.5, 0);
    const crownG = clumpGeometry();
    const barkTex = barkTexture();
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6f5c49, map: barkTex }), broad.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ map: leafTexture(), color: 0xffffff, vertexColors: true }), broad.length);
    const treeCols = [[0x62863f, 0x587c38, 0x6c8e47], [0x4f7534, 0x486d30, 0x578039], [0x3f6a2f, 0x396229, 0x477336], [0x4a7036, 0x426831, 0x54783c]];
    // LOD: detailed trees near the camera, matching lumpy clumps far away. Near trees live in one instanced pool per species (8 draw calls at most,
    // per pass) rather than per tree cell; hero trees placed by hand (world.addHeroTree) stay in the pool at every distance.
    const NEAR_R = 90, NEAR_CAP = 700;
    const nearG = TREE_SP.map((S, i) => nearTreeGeometry(i));
    const woodMat = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xb9a48c, vertexColors: true });
    const cardMat = new THREE.MeshLambertMaterial({ map: treeAtlas(), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const farT = new Float32Array(broad.length * 16), farC = new Float32Array(broad.length * 16), nearM = new Float32Array(broad.length * 16);
    const nearCol = new Float32Array(broad.length * 3), species = new Uint8Array(broad.length), isNear = new Uint8Array(broad.length);
    const nearTint = [0xffffff, 0xf0f6e4, 0xe4eedc, 0xfbf6dc, 0xe8f2e8, 0xf4f0d4];
    const pickSp = (a, big) => { let w = 0; for (let k = 0; k < 4; k++) { w += TREE_SP[k].weight; if (a < w) return k === 3 && !big ? 2 : k; } return 0; };
    const nearMatrix = (x, z, sz, a, out, at) => { const H = sz * 1.3; q.setFromAxisAngle(v.set(0, 1, 0), a * 6.28); m4.compose(v.set(x, 0, z), q, s.set(H * (1 + a * 0.15), H, H * (1 + a * 0.15))); m4.toArray(out, at); };
    let maxTree = 1;
    broad.forEach((t, i) => {
      const sz = t[2], hr = hash(t[0], t[1]), sp = species[i] = pickSp(hash(t[1] * 1.7, t[0]), sz > 7), S = TREE_SP[sp], H = sz * 1.3, w = H * (1 + hr * 0.15); maxTree = Math.max(maxTree, H * 1.1);
      m4.compose(v.set(t[0], 0, t[1]), q.identity(), s.set(H * S.r * 3, H * S.th * 1.06, H * S.r * 3)); trunks.setMatrixAt(i, m4); m4.toArray(farT, i * 16);
      q.setFromAxisAngle(v.set(0, 1, 0), hr * 6.28);
      m4.compose(v.set(t[0], H * S.cy, t[1]), q, s.set(w * S.rx * 0.98, H * S.ry * 1.6, w * S.rx * 0.98)); crowns.setMatrixAt(i, m4); m4.toArray(farC, i * 16);
      crowns.setColorAt(i, col.setHex(treeCols[sp][Math.floor(hr * 3)]));
      nearMatrix(t[0], t[1], sz, hr, nearM, i * 16);
      col.setHex(nearTint[Math.floor(hr * 7.3 % 1 * nearTint.length)]).toArray(nearCol, i * 3);
      segs.push([t[0]-0.3, t[1], t[0]+0.3, t[1]]);
    });
    // far crowns don't cast shadows: the detailed near-tree LOD does (8.5k instances in the shadow pass was the biggest cost)
    crowns.castShadow = false; group.add(trunks); group.add(crowns);
    // chunked by tree position: per cell a far trunk / far crown (+ a low-poly crown sharing its instance buffers, swapped
    // in beyond CH_DIST.crownLo) and per-species near-tree meshes sized to the trees in that cell
    const TCH = 240, treeKey = (i) => Math.floor(broad[i][0] / TCH) + ',' + Math.floor(broad[i][1] / TCH);
    const trunkSplit = splitIM(trunks, { key: treeKey }), crownSplit = splitIM(crowns, { key: treeKey });
    const crownLoG = (() => {                  // 20-tri stand-in for the far clump, fitted to its bounds
      crownG.computeBoundingBox(); const bb = crownG.boundingBox, g = new THREE.IcosahedronGeometry(1, 0);
      const ctr = new THREE.Vector3(), sz3 = new THREE.Vector3(); bb.getCenter(ctr); bb.getSize(sz3);
      g.scale(sz3.x * 0.47, sz3.y * 0.47, sz3.z * 0.47); g.translate(ctr.x, ctr.y, ctr.z);
      const nr = g.attributes.normal, pl = g.attributes.position, cl = new Float32Array(nr.count * 3); for (let i = 0; i < nr.count; i++) { const x = nr.getX(i), y = nr.getY(i) + 0.35, z = nr.getZ(i), l = Math.hypot(x, y, z); nr.setXYZ(i, x / l, y / l, z / l); cl.fill(0.5 + 0.62 * Math.min(1, Math.max(0, (pl.getY(i) - bb.min.y) / sz3.y)), i * 3, i * 3 + 3); }
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      return g;
    })();
    const treeChunks = [];
    trunkSplit.chunks.forEach((tc, ci) => {
      const cc = crownSplit.chunks[ci];        // same keys, same insertion order
      const lo = new THREE.InstancedMesh(shallowGeo(crownLoG, cc.sph), cc.im.material, cc.idx.length);
      lo.instanceMatrix = cc.im.instanceMatrix; lo.instanceColor = cc.im.instanceColor; lo.visible = false; lo.frustumCulled = true; lo.castShadow = false; lo.receiveShadow = cc.im.receiveShadow;
      group.add(lo);
      chunkList.push({ ims: [tc.im], x: tc.x, z: tc.z, r: tc.r, kind: 'trunk' }, { ims: [cc.im, lo], x: cc.x, z: cc.z, r: cc.r, kind: 'crown' });
      treeChunks.push({ x: tc.x, z: tc.z, r: tc.r + maxTree, idx: tc.idx, trunk: tc.im, crown: cc.im, any: false });
    });
    const heroes = [];                 // { x, z, sp, m: Float32Array(16), c: [r, g, b] }
    const HERO_CAP = 24, poolCap = TREE_SP.map((S, sp) => Math.min(NEAR_CAP, species.reduce((n, x) => n + (x === sp ? 1 : 0), 0)) + HERO_CAP);
    const nearW = [], nearL = [];
    TREE_SP.forEach((S, sp) => {
      const w = new THREE.InstancedMesh(nearG[sp].wood, woodMat, poolCap[sp]), l = new THREE.InstancedMesh(nearG[sp].leaves, cardMat, poolCap[sp]);
      l.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(poolCap[sp] * 3).fill(1), 3);
      for (const m of [w, l]) { m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }
      nearW.push(w); nearL.push(l);
    });
    function addHeroTree(x, z, sz, sp) {
      if (heroes.length >= HERO_CAP) return;
      const h = { x, z, sp, m: new Float32Array(16), c: [1, 1, 1] }; nearMatrix(x, z, sz, hash(x, z), h.m, 0); heroes.push(h); lodX = 1e9;
    }
    const zeroM = new Float32Array(16);
    let lodX = 1e9, lodZ = 1e9;
    function updateTrees(cam) {
      if (Math.abs(cam.x - lodX) + Math.abs(cam.z - lodZ) < 6) return;
      lodX = cam.x; lodZ = cam.z;
      const R2 = NEAR_R * NEAR_R, cnt = [0, 0, 0, 0];
      const put = (sp, M, ma, C, ca) => { const k = cnt[sp]++; nearW[sp].instanceMatrix.array.set(M.subarray(ma, ma + 16), k * 16); nearL[sp].instanceMatrix.array.set(M.subarray(ma, ma + 16), k * 16); nearL[sp].instanceColor.array.set(C.subarray(ca, ca + 3), k * 3); };
      for (const h of heroes) put(h.sp, h.m, 0, new Float32Array(h.c), 0);
      for (const ch of treeChunks) {
        const inRange = Math.hypot(cam.x - ch.x, cam.z - ch.z) - ch.r < NEAR_R;
        if (!inRange && !ch.any) continue;
        let dirty = false, any = false;
        const tA = ch.trunk.instanceMatrix.array, cA = ch.crown.instanceMatrix.array;
        ch.idx.forEach((i, j) => {
          const t = broad[i], dx = t[0] - cam.x, dz = t[1] - cam.z, sp = species[i];
          const near = inRange && dx * dx + dz * dz < R2 && cnt[sp] < poolCap[sp] ? 1 : 0;
          if (near !== isNear[i]) {
            isNear[i] = near; dirty = true;
            tA.set(near ? zeroM : farT.subarray(i * 16, i * 16 + 16), j * 16);
            cA.set(near ? zeroM : farC.subarray(i * 16, i * 16 + 16), j * 16);
          }
          if (near) { any = true; put(sp, nearM, i * 16, nearCol, i * 3); }
        });
        ch.any = any;
        if (dirty) ch.trunk.instanceMatrix.needsUpdate = ch.crown.instanceMatrix.needsUpdate = true;
      }
      for (let k = 0; k < 4; k++) {
        nearW[k].count = nearL[k].count = cnt[k]; nearW[k].visible = nearL[k].visible = cnt[k] > 0;
        if (cnt[k]) nearW[k].instanceMatrix.needsUpdate = nearL[k].instanceMatrix.needsUpdate = nearL[k].instanceColor.needsUpdate = true;
      }
    }
    if (palms.length) {
      const pt = new THREE.CylinderGeometry(0.15, 0.22, 1, 9, 8); pt.translate(0, 0.5, 0);
      const pos = pt.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setX(i, pos.getX(i) + y * y * 0.6); }
      pt.computeVertexNormals();
      const pTr = new THREE.InstancedMesh(pt, new THREE.MeshLambertMaterial({ map: palmTrunkTexture() }), palms.length);
      const fr = palmFrondGeometry();
      const pCr = new THREE.InstancedMesh(fr, new THREE.MeshLambertMaterial({ map: frondTexture2(), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }), palms.length);
      palms.forEach((t, i) => {
        const H = 8 + hash(t[1], t[0]) * 6, ang = hash(t[0], t[1]) * 6.28;
        q.setFromAxisAngle(v.set(0, 1, 0), ang);
        m4.compose(v.set(t[0], 0, t[1]), q, s.set(1, H, 1)); pTr.setMatrixAt(i, m4);
        const lean = 0.6;           // matches the trunk bend at the top
        m4.compose(v.set(t[0] + Math.cos(-ang) * lean, H, t[1] + Math.sin(-ang) * lean), q, s.set(1, 1, 1)); pCr.setMatrixAt(i, m4);
        segs.push([t[0]-0.25, t[1], t[0]+0.25, t[1]]);
      });
      pCr.castShadow = true; group.add(pTr); group.add(pCr);
      lodChunks(splitIM(pTr, { cell: 240 }), 'palm'); lodChunks(splitIM(pCr, { cell: 240 }), 'palm');
    }

    // ---------------- electric poles + wires along village/tar roads
    const poles = [];
    for (const r of D.roads) if (r.t === 'cc' || r.t === 'tar' || r.t === 'lane') {
      let carry = 0;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], c = r.p[i+1], L = Math.hypot(c[0]-a[0], c[1]-a[1]); if (L < 1) continue;
        const ux = (c[0]-a[0])/L, uz = (c[1]-a[1])/L, off = r.w/2 + 1.1;
        for (let d = carry; d < L; d += 38) poles.push([a[0]+ux*d - uz*off, a[1]+uz*d + ux*off, r, Math.atan2(ux, uz)]);
        carry = (carry - L) % 38; if (carry < 0) carry += 38;
      }
    }
    // a pole set off one road must not stand on another (junctions, lanes that run into a road's verge)
    const onCarriageway = (x, z, pad) => roadSegs.some(([a2, c2, t2, w2]) => {
      if (t2 === 'river') return false;
      const dx = c2[0] - a2[0], dz = c2[1] - a2[1], L2 = dx * dx + dz * dz || 1, tt = Math.max(0, Math.min(1, ((x - a2[0]) * dx + (z - a2[1]) * dz) / L2));
      return Math.hypot(x - a2[0] - tt * dx, z - a2[1] - tt * dz) < w2 / 2 + pad;
    });
    // move such poles to the nearest road edge instead (wires follow, they are strung pole to pole); drop only if squeezed
    for (let i = poles.length - 1; i >= 0; i--) { const q2 = pushOffRoad(poles[i][0], poles[i][1], 0.7); if (!q2) { poles.splice(i, 1); continue; } poles[i][0] = q2[0]; poles[i][1] = q2[1]; }
    // tapered concrete H-poles; local x is the cross-arm, turned across the road
    const poleIM = new THREE.InstancedMesh(poleGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), poles.length);
    poleIM.castShadow = true; poleIM.frustumCulled = false;
    const wire = [], poleAx = (p, o) => [p[0] + Math.cos(p[3]) * o, p[1] - Math.sin(p[3]) * o];
    const span = (A, B, ya, yb) => {
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]), sag = 0.25 + L * 0.018, N = 10;
      let prev = [A[0], ya, A[1]];
      for (let k = 1; k <= N; k++) {
        const t = k / N, pt = [A[0] + (B[0] - A[0]) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), A[1] + (B[1] - A[1]) * t];
        wire.push(...prev, ...pt); prev = pt;
      }
    };
    poles.forEach((p, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), p[3]); m4.compose(v.set(p[0], 0, p[1]), q, s.set(1, 1, 1)); poleIM.setMatrixAt(i, m4);
      segs.push([p[0]-0.15, p[1], p[0]+0.15, p[1]]);
      const nx = poles[i+1];
      if (nx && nx[2] === p[2] && Math.hypot(nx[0]-p[0], nx[1]-p[1]) < 45) {
        for (const [o, y] of [[-0.85, 8.52], [0.85, 8.52], [0, 8.94]]) span(poleAx(p, o), poleAx(nx, o), y, y);
        for (const o of [-0.65, -0.22, 0.22, 0.65]) span(poleAx(p, o), poleAx(nx, o), 7.13, 7.13);
      }
    });
    group.add(poleIM); lodChunks(splitIM(poleIM, { cell: 320 }), 'keep');
    // distribution transformers on some poles (tank + fins + bushings + fuse arm) and service drops to nearby houses
    {
      const K = new Kit(), gr = 0x7d8580;
      K.box([0, 0, 0], [0.75, 1.05, 0.6], gr); K.box([0, 0.56, 0], [0.8, 0.06, 0.65], 0x6c736f);
      for (let i = -3; i <= 3; i++) K.box([i * 0.1, 0, 0.33], [0.02, 0.85, 0.08], 0x6c736f);
      for (const x of [-0.22, 0, 0.22]) K.add(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 8), 0x8a5a3a, { p: [x, 0.74, 0] });
      for (const x of [-0.25, 0.25]) K.add(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), 0xe8e4da, { p: [x, 0.62, -0.2] });
      K.box([0, -0.6, 0.0], [1.2, 0.08, 0.7], 0x4a4d50);               // platform channel
      K.box([0, 1.9, -0.25], [1.5, 0.07, 0.07], 0x5c5f63);              // AB switch / fuse arm
      for (const x of [-0.55, 0, 0.55]) K.add(new THREE.CylinderGeometry(0.03, 0.05, 0.25, 8), 0xe8e4da, { p: [x, 2.05, -0.25] });
      const tg2 = K.geo(), list = [];
      poles.forEach((p, i) => { if ((p[2].t === 'cc' || p[2].t === 'lane') && hash(p[0] * 0.37, p[1] * 0.91) < 0.12) list.push(p); });
      const tIM = new THREE.InstancedMesh(tg2, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, list.length));
      tIM.count = list.length; tIM.castShadow = true;
      list.forEach((p, i) => {
        q.setFromAxisAngle(v.set(0, 1, 0), p[3]);
        const off = new THREE.Vector3(0, 0, -0.55).applyQuaternion(q);
        m4.compose(v.set(p[0] + off.x, 4.6, p[1] + off.z), q, s.set(1, 1, 1)); tIM.setMatrixAt(i, m4);
        for (const x of [-0.22, 0, 0.22]) {                               // HT leads up to the cross-arm
          const a = new THREE.Vector3(x, 5.5, -0.55).applyQuaternion(q), b2 = new THREE.Vector3(x * 3.5, 8.2, 0.12).applyQuaternion(q);
          wire.push(p[0] + a.x, a.y, p[1] + a.z, p[0] + b2.x, b2.y, p[1] + b2.z);
        }
      });
      group.add(tIM); if (list.length) lodChunks(splitIM(tIM, { cell: 320 }), 'keep');
      // service drops: LT arm -> roof edge of houses within reach (a sagging cable each)
      for (const H of houses) {
        if (H.b.r === 'sheet' || hash(H.cx * 1.1, H.cz * 2.3) > 0.55) continue;
        let best = null, bd = 30;
        for (const p of poles) { const d = Math.hypot(p[0] - H.cx, p[1] - H.cz); if (d < bd) { bd = d; best = p; } }
        if (!best) continue;
        let tgt = H.p[0], td = 1e9; for (const q2 of H.p) { const d = Math.hypot(q2[0] - best[0], q2[1] - best[1]); if (d < td) { td = d; tgt = q2; } }
        if (td > 22) continue;
        const o = (hash(H.cx, H.cz) - 0.5) * 1.3, A = poleAx(best, o), ya = 7.1, yb = H.h + 0.6, N = 8, sag = 0.3 + td * 0.03;
        let prev = [A[0], ya, A[1]];
        for (let k = 1; k <= N; k++) { const t = k / N, pt = [A[0] + (tgt[0] - A[0]) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), A[1] + (tgt[1] - A[1]) * t]; wire.push(...prev, ...pt); prev = pt; }
      }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));

    // ---------------- landmarks (modelled from typical Telangana village civic buildings)
    const LM_STYLE = {
      temple: '#c0392b', hospital: '#1565c0', clinic: '#1565c0', school: '#0b5d1e', anganwadi: '#6a1b9a',
      fuel: '#e65100', factory: '#37474f', hall: '#0b5d1e', village: '#0b5d1e', busstop: '#b71c1c', sign: '#0b5d1e', tank: '#455a64',
    };
    const L = (hex) => new THREE.MeshLambertMaterial({ color: hex });
    const addBox = (g, w, h, d, mat, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const solid = (cx, cz, hw, hd) => segs.push([cx-hw, cz-hd, cx+hw, cz-hd], [cx+hw, cz-hd, cx+hw, cz+hd], [cx+hw, cz+hd, cx-hw, cz+hd], [cx-hw, cz+hd, cx-hw, cz-hd]);
    const facingRoad = (x, z) => {                      // angle that faces the nearest road
      let best = null;
      for (const [a, c2] of roadSegs) { const dx = c2[0]-a[0], dz = c2[1]-a[1], L2 = dx*dx + dz*dz || 1, t = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / L2)); const px = a[0]+t*dx, pz = a[1]+t*dz, d = Math.hypot(x-px, z-pz); if (!best || d < best.d) best = { d, px, pz }; }
      return best ? Math.atan2(best.px - x, best.pz - z) : 0;
    };
    function textBoard(text, sub, bg, w, h) {
      const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(6, 6, c.width - 12, c.height - 12);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `bold ${Math.round(c.height * (sub ? 0.3 : 0.45))}px sans-serif`;
      g.fillText(text, 256, c.height * (sub ? 0.42 : 0.62), 490);
      if (sub) { g.font = `bold ${Math.round(c.height * 0.26)}px sans-serif`; g.fillText(sub, 256, c.height * 0.82, 490); }
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    }
    function flagPole(g, x, z, h) {
      addBox(g, 0.08, h, 0.08, L(0xdddddd), x, h / 2, z);
      const c = document.createElement('canvas'); c.width = 90; c.height = 60; const f = c.getContext('2d');
      f.fillStyle = '#ff9933'; f.fillRect(0, 0, 90, 20); f.fillStyle = '#fff'; f.fillRect(0, 20, 90, 20); f.fillStyle = '#138808'; f.fillRect(0, 40, 90, 20);
      f.strokeStyle = '#000080'; f.lineWidth = 2; f.beginPath(); f.arc(45, 30, 8, 0, 7); f.stroke();
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
      fl.position.set(x + 0.78, h - 0.6, z); g.add(fl);
    }
    function temple(g, big, shiva, Rx, Rz) {
      const white = L(0xf4ede0), saffron = L(0xe8892b), red = L(0xb83b2e), gold = new THREE.MeshPhongMaterial({ color: 0xd4a017, shininess: 80 });
      const S2 = big ? 1 : 0.75;
      // compound wall with entrance
      const R = Rz || 11 * S2, RX = Rx || R;
      for (const [x1, z1, x2, z2] of [[-RX, -R, RX, -R], [RX, -R, RX, R], [-RX, R, -RX, -R], [-RX, R, -2.2, R], [2.2, R, RX, R]]) {
        const m = addBox(g, Math.hypot(x2 - x1, z2 - z1) || 0.3, 1.4, 0.3, white, (x1 + x2) / 2, 0.7, (z1 + z2) / 2, Math.atan2(-(z2 - z1), x2 - x1));
        for (let i = 0; i < 12; i++) addBox(g, 0.4, 0.3, 0.32, i % 2 ? saffron : red, x1 + (x2 - x1) * (i + 0.5) / 12, 1.55, z1 + (z2 - z1) * (i + 0.5) / 12);
      }
      // entrance arch
      addBox(g, 0.5, 4, 0.5, white, -2.2, 2, R); addBox(g, 0.5, 4, 0.5, white, 2.2, 2, R); addBox(g, 5, 0.8, 0.6, saffron, 0, 4.2, R);
      // platform, garbhagriha, vimana tiers, kalasha
      addBox(g, 7 * S2, 0.8, 9 * S2, L(0xbdb5a6), 0, 0.4, -2 * S2);
      addBox(g, 5 * S2, 3.6, 5 * S2, white, 0, 2.6, -4 * S2);
      for (let k = 0; k < 5; k++) {
        const w = (4.8 - k * 0.85) * S2;
        addBox(g, w, 1.1 * S2, w, k % 2 ? saffron : white, 0, 4.4 + k * 1.1 * S2, -4 * S2);
        for (const [ox, oz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) addBox(g, 0.35, 0.5, 0.35, red, ox * w / 2, 4.4 + k * 1.1 * S2 + 0.6, -4 * S2 + oz * w / 2);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9 * S2, 12, 8, 0, 6.3, 0, Math.PI / 2), saffron); dome.position.set(0, 4.4 + 5 * 1.1 * S2 - 0.5, -4 * S2); g.add(dome);
      const kal = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 8), gold); kal.position.set(0, dome.position.y + 1.2 * S2, -4 * S2); g.add(kal);
      // pillared mandapa in front
      addBox(g, 6 * S2, 0.3, 4.4 * S2, white, 0, 3.6, 0.6 * S2);
      for (const ox of [-2.6, -0.9, 0.9, 2.6]) for (const oz of [-1.4, 1.8]) addBox(g, 0.35, 2.8, 0.35, white, ox * S2, 2.2, oz * S2);
      addBox(g, 6.2 * S2, 0.35, 4.6 * S2, red, 0, 3.85, 0.6 * S2);
      // dhwaja stambham, nandi, deepa stambha
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 9, 10), gold); pole.position.set(0, 4.5, 5 * S2); g.add(pole);
      addBox(g, 1, 0.6, 1, white, 0, 0.3, 5 * S2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ color: 0xff7f00, side: THREE.DoubleSide })); flag.position.set(0.7, 8.6, 5 * S2); g.add(flag);
      if (shiva) {
        const nandi = new THREE.Group(); nandi.position.set(0, 0.8, 2.8 * S2);
        addBox(nandi, 0.7, 0.6, 1.3, L(0x3a3a3a), 0, 0.35, 0); addBox(nandi, 0.4, 0.45, 0.45, L(0x3a3a3a), 0, 0.75, 0.55); g.add(nandi);
      }
      if (!Rx) solid(g.position.x, g.position.z - 2 * S2, 3.6 * S2, 4.6 * S2);    // rotated plots: colliders added after the grid exists
      mergeByMaterial(g);    // ~110 boxes -> one mesh per material (8 draw calls instead of 110)
    }
    // merge every plain mesh under g into one mesh per material (geometry baked into g's local frame)
    function mergeByMaterial(g) {
      g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), m = new THREE.Matrix4();
      const buckets = new Map(), victims = [];
      g.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        geo.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
        const b = buckets.get(o.material) || buckets.set(o.material, { geos: [], cs: false, rs: false }).get(o.material);
        b.geos.push(geo); b.cs = b.cs || o.castShadow; b.rs = b.rs || o.receiveShadow; victims.push(o);
      });
      if (victims.length < 2) return;
      victims.forEach(o => o.parent.remove(o));
      for (const [mat, b] of buckets) {
        const names = ['position', 'normal', 'uv'].filter(n => b.geos.every(q => q.attributes[n]));
        const total = b.geos.reduce((a, q) => a + q.attributes.position.count, 0), out = new THREE.BufferGeometry();
        for (const n of names) {
          const sz = n === 'uv' ? 2 : 3, arr = new Float32Array(total * sz); let off = 0;
          for (const q of b.geos) { arr.set(q.attributes[n].array.subarray(0, q.attributes.position.count * sz), off); off += q.attributes.position.count * sz; }
          out.setAttribute(n, new THREE.BufferAttribute(arr, sz));
        }
        if (!out.attributes.normal) out.computeVertexNormals();
        out.computeBoundingSphere();
        const mesh = new THREE.Mesh(out, mat); mesh.castShadow = b.cs; mesh.receiveShadow = b.rs; g.add(mesh);
        b.geos.forEach(q => q.dispose());
      }
    }
    function school(g, l) {
      // compound wall with an arched gate, name board and national flag
      addBox(g, 0.5, 3.6, 0.5, L(0xf3d27a), -3, 1.8, 0); addBox(g, 0.5, 3.6, 0.5, L(0xf3d27a), 3, 1.8, 0);
      const b = textBoard('ZILLA PARISHAD HIGH SCHOOL', 'జి.ప.ఉ.పాఠశాల · నెల్లుట్ల', '#8e1b1b', 6.4, 1.3); b.position.set(0, 3.9, 0.01); g.add(b);
      const gate = addBox(g, 5.4, 1.6, 0.06, L(0x2d6a4f), 0, 0.85, 0.05); gate.material.transparent = true; gate.material.opacity = 0.75;
      flagPole(g, 6, -6, 8);
      solid(g.position.x - 3, g.position.z, 0.3, 0.3); solid(g.position.x + 3, g.position.z, 0.3, 0.3);
    }
    function hospital(g, l, big) {
      const sign = textBoard(big ? 'GOVERNMENT HOSPITAL' : 'HEALTH SUB CENTRE', big ? 'ప్రభుత్వ ఆసుపత్రి · నెల్లుట్ల' : 'ఆరోగ్య ఉపకేంద్రం · BC COLONY', '#0d47a1', 5.5, 1.3);
      sign.position.set(0, 3.2, 0); g.add(sign);
      addBox(g, 0.12, 3, 0.12, L(0x777777), -2.4, 1.5, -0.05); addBox(g, 0.12, 3, 0.12, L(0x777777), 2.4, 1.5, -0.05);
      const cross = new THREE.Group(); addBox(cross, 0.9, 0.28, 0.05, new THREE.MeshBasicMaterial({ color: 0xd32f2f }), 0, 0, 0); addBox(cross, 0.28, 0.9, 0.05, new THREE.MeshBasicMaterial({ color: 0xd32f2f }), 0, 0, 0);
      cross.position.set(3.4, 3.2, 0); g.add(cross);
      if (big) {   // parked 108 ambulance
        const amb = new THREE.Group(); amb.position.set(-5, 0, 4);
        addBox(amb, 1.9, 1.9, 4.8, L(0xf5f5f5), 0, 1.25, 0); addBox(amb, 1.92, 0.25, 4.82, L(0xd32f2f), 0, 1.3, 0);
        addBox(amb, 1.7, 0.6, 0.05, L(0x1c2733), 0, 1.75, 2.42); addBox(amb, 1.0, 0.15, 0.3, new THREE.MeshBasicMaterial({ color: 0x1e88e5 }), 0, 2.3, 1.6);
        for (const [x, z] of [[-0.9, 1.5], [0.9, 1.5], [-0.9, -1.5], [0.9, -1.5]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12), L(0x111111)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z); amb.add(w); }
        const lab = textBoard('108', 'EMERGENCY', '#d32f2f', 1.2, 0.6); lab.position.set(0.97, 1.6, 0); lab.rotation.y = Math.PI / 2; amb.add(lab);
        g.add(amb); solid(g.position.x - 5, g.position.z + 4, 1, 2.4);
      }
    }
    function fuelStation(g) {
      const white = L(0xf4f4f4), orange = L(0xe8711c), blue = L(0x1d4f91);
      addBox(g, 16, 0.9, 10, white, 0, 6, 0); addBox(g, 16.1, 0.5, 10.1, orange, 0, 5.4, 0);
      for (const [x, z] of [[-5, -2.5], [5, -2.5], [-5, 2.5], [5, 2.5]]) { addBox(g, 0.6, 5.2, 0.6, white, x, 2.6, z); solid(g.position.x + x, g.position.z + z, 0.4, 0.4); }
      for (const x of [-3, 3]) {
        addBox(g, 3.4, 0.25, 1.4, L(0xcfcfcf), x, 0.12, 0);
        addBox(g, 0.9, 1.9, 0.6, blue, x - 0.8, 1.2, 0); addBox(g, 0.9, 1.9, 0.6, blue, x + 0.8, 1.2, 0);
        addBox(g, 0.7, 0.4, 0.62, new THREE.MeshBasicMaterial({ color: 0x9be7ff }), x - 0.8, 1.6, 0);
        solid(g.position.x + x, g.position.z, 1.4, 0.4);
      }
      addBox(g, 0.4, 7, 0.4, L(0x777777), 10, 3.5, 6);
      const tot = textBoard('PETROL · DIESEL', 'Nellutla Fuel Station · 24 HRS', '#1d4f91', 3.5, 2.2); tot.position.set(10, 7.6, 6.25); g.add(tot);
      solid(g.position.x + 10, g.position.z + 6, 0.3, 0.3);
      addBox(g, 5, 3, 4, white, 0, 1.5, -9); solid(g.position.x, g.position.z - 9, 2.5, 2);
    }
    function busStop(g) {
      const roof = addBox(g, 7, 0.18, 3, L(0x1565c0), 0, 3, 0); roof.rotation.x = 0.06;
      addBox(g, 7, 2.6, 0.12, L(0xe0e0e0), 0, 1.5, -1.4);
      for (const x of [-3.3, 3.3]) addBox(g, 0.15, 3, 0.15, L(0x888888), x, 1.5, 1.3);
      addBox(g, 6, 0.1, 0.6, L(0x888888), 0, 0.55, -0.9); addBox(g, 6, 0.5, 0.1, L(0x888888), 0, 0.3, -1.1);
      const b = textBoard('NELLUTLA', 'నెల్లుట్ల బస్ స్టాప్', '#b71c1c', 4.5, 0.9); b.position.set(0, 3.6, 0.2); g.add(b);
      const bm = L(0x9e9a92);
      for (const bx of [-5.6, 5.6]) { addBox(g, 2.2, 0.08, 0.5, bm, bx, 0.48, 0.2); addBox(g, 2.2, 0.4, 0.07, bm, bx, 0.75, -0.02); for (const lx of [-0.9, 0.9]) addBox(g, 0.12, 0.44, 0.4, bm, bx + lx, 0.22, 0.2); }
      for (const lx of [-2.6, 0, 2.6]) addBox(g, 0.1, 0.5, 0.1, L(0x666666), lx, 0.27, -0.9);
      solid(g.position.x, g.position.z - 1.4, 3.5, 0.2);
    }
    function factory(g) {
      const b = textBoard('SRI LAKSHMI COTTON GINNING MILL', 'NELLUTLA', '#37474f', 9, 1.6); b.position.set(0, 4, 0); g.add(b);
      for (const x of [-4.4, 4.4]) addBox(g, 0.2, 4, 0.2, L(0x666666), x, 2, -0.05);
      for (let i = 0; i < 18; i++) addBox(g, 1.3, 1.1, 1.0, L(0xf2f0ea), -6 + (i % 6) * 1.4, 0.55 + Math.floor(i / 6) * 1.1, -6 - (i % 3) * 0.1);
      solid(g.position.x, g.position.z - 6, 4.5, 0.6);
    }
    for (const lm of D.landmarks) {
      const g = new THREE.Group(); g.position.set(lm.x, 0, lm.z);
      const face = facingRoad(lm.x, lm.z);
      if (lm.k === 'temple') { temple(g, lm.name.startsWith('Shiva'), lm.name.startsWith('Shiva'), lm.Rx, lm.Rz); g.rotation.y = lm.face != null ? lm.face : face; }
      else if (lm.k === 'tank') {
        const legMat = L(0xcfcfcf);
        for (const [ox, oz] of [[-2.5,-2.5],[2.5,-2.5],[2.5,2.5],[-2.5,2.5]]) { addBox(g, 0.5, 14, 0.5, legMat, ox, 7, oz); segs.push([lm.x+ox-0.3, lm.z+oz, lm.x+ox+0.3, lm.z+oz]); }
        for (const y of [4.5, 9]) addBox(g, 5.5, 0.3, 0.3, legMat, 0, y, -2.5), addBox(g, 5.5, 0.3, 0.3, legMat, 0, y, 2.5);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(5, 3.5, 5, 24), L(0xeeeeee)); bowl.position.y = 16.5; bowl.castShadow = true; g.add(bowl);
        const lid = new THREE.Mesh(new THREE.ConeGeometry(5.1, 1.2, 24), L(0xd8d8d8)); lid.position.y = 19.6; g.add(lid);
        const t = textBoard('MISSION BHAGIRATHA', 'NELLUTLA', '#1565c0', 4, 1.2); t.position.set(0, 16.5, 5.05); g.add(t);
      }
      else if (lm.k === 'busstop') { busStop(g); g.rotation.y = face; }
      else if (lm.k === 'fuel') { fuelStation(g); g.rotation.y = face; }
      else if (lm.k === 'school') { g.position.set(lm.x, 0, lm.z); g.rotation.y = face; g.position.x += Math.sin(face) * 6; g.position.z += Math.cos(face) * 6; school(g, lm); }
      else if (lm.k === 'hospital' || lm.k === 'clinic') { g.rotation.y = face; g.position.x += Math.sin(face) * 5; g.position.z += Math.cos(face) * 5; hospital(g, lm, lm.k === 'hospital'); }
      else if (lm.k === 'factory') { g.rotation.y = face; factory(g); }
      if (['anganwadi', 'hall', 'sign'].includes(lm.k)) {
        const titles = { anganwadi: ['ANGANWADI CENTRE', 'అంగన్‌వాడీ కేంద్రం'], hall: ['GOLLA KURUMA COMMUNITY HALL', 'గొల్ల కురుమ సంఘ భవనం'], sign: ['LINGALA GHANPUR ←', 'లింగాల ఘనపూర్'] };
        const [t1, t2] = titles[lm.k];
        const b = textBoard(t1, t2, LM_STYLE[lm.k], 4.4, 1.2); b.position.set(0, 3.2, 0); g.add(b);
        addBox(g, 0.1, 3, 0.1, L(0x666666), -2, 1.5, -0.03); addBox(g, 0.1, 3, 0.1, L(0x666666), 2, 1.5, -0.03);
        g.rotation.y = face; g.position.x += Math.sin(face) * 4; g.position.z += Math.cos(face) * 4;
      }
      group.add(g);
    }

    // ---------------- collision grid
    const CS = 16, grid = new Map();
    const key = (i, j) => i * 100003 + j;
    for (const sg of segs) {
      const i0 = Math.floor(Math.min(sg[0], sg[2]) / CS), i1 = Math.floor(Math.max(sg[0], sg[2]) / CS);
      const j0 = Math.floor(Math.min(sg[1], sg[3]) / CS), j1 = Math.floor(Math.max(sg[1], sg[3]) / CS);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(sg);
      }
    }
    function collide(pos, radius) {
      let hit = false, nx = 0, nz = 0;
      const i0 = Math.floor((pos.x - radius) / CS), i1 = Math.floor((pos.x + radius) / CS);
      const j0 = Math.floor((pos.z - radius) / CS), j1 = Math.floor((pos.z + radius) / CS);
      for (let it = 0; it < 2; it++)
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const list = grid.get(key(i, j)); if (!list) continue;
        for (const sg of list) {
          const dx = sg[2]-sg[0], dz = sg[3]-sg[1], L2 = dx*dx + dz*dz || 1e-6;
          const t = Math.max(0, Math.min(1, ((pos.x-sg[0])*dx + (pos.z-sg[1])*dz) / L2));
          const px = sg[0] + t*dx, pz = sg[1] + t*dz, ex = pos.x - px, ez = pos.z - pz, d = Math.hypot(ex, ez);
          if (d < radius && d > 1e-4) {
            const push = radius - d; pos.x += ex/d*push; pos.z += ez/d*push;
            hit = true; nx = ex/d; nz = ez/d;
          }
        }
      }
      return { hit, nx, nz };
    }

    // ---------------- street-level life: bikes, cattle, haystacks, cots, sand piles, shrubs, dish antennas
    function boxesGeometry(parts) {
      // parts: [w, h, d, x, y, z, hexColor, rotY?]
      const b = new Builder(), c3 = new THREE.Color();
      for (const [w, h, d, x, y, z, hex, ry] of parts) {
        const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        if (ry) g.rotateY(ry);
        g.translate(x, y, z);
        const P = g.attributes.position, N = g.attributes.normal; c3.setHex(hex);
        for (let i = 0; i < P.count; i++) { b.pos.push(P.getX(i), P.getY(i), P.getZ(i)); b.nor.push(N.getX(i), N.getY(i), N.getZ(i)); b.uv.push(0, 0); b.col.push(c3.r, c3.g, c3.b); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      return geo;
    }
    const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const PROPS = {
      bike: [[bikeGeometry(0xb71c1c), propMat]],
      bike2: [[bikeGeometry(0x1a1a1a), propMat]],
      buffalo: [[bovineGeometry(true), propMat]],
      cow: [[bovineGeometry(false), propMat]],
      cot: [[cotGeometry(), propMat], [cotWeaveGeometry(), new THREE.MeshLambertMaterial({ map: ropeWeaveTexture(), alphaTest: 0.5, side: THREE.DoubleSide })]],
      sand: [[sandGeometry(), propMat]],
      hay: [[hayGeometry(), new THREE.MeshLambertMaterial({ map: strawTexture(), vertexColors: true })]],
      shrub: [[shrubGeometry(), new THREE.MeshLambertMaterial({ map: leafCardTexture(), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide })]],
      dish: [[dishGeometry(), propMat]],
      flag: [[flagGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })]],
    };
    const placed = {}; Object.keys(PROPS).forEach(k => placed[k] = []);
    const tmp = { x: 0, z: 0 };
    const free = (x, z, r) => { tmp.x = x; tmp.z = z; return !collide(tmp, r).hit && Math.hypot(tmp.x - x, tmp.z - z) < 0.01; };
    for (const r of VR) {
      const village = r.t === 'cc' || r.t === 'lane';
      if (!village && r.t !== 'tar' && r.t !== 'dirt') continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], c2 = r.p[i+1], L = Math.hypot(c2[0]-a[0], c2[1]-a[1]); if (L < 2) continue;
        const ux = (c2[0]-a[0])/L, uz = (c2[1]-a[1])/L, rot = Math.atan2(ux, uz);
        for (let d = 3; d < L; d += village ? 6 : 9) {
          const hr = hash(a[0] + d * 3.1, a[1] - d * 1.7), side = hr < 0.5 ? 1 : -1;
          const off = r.w / 2 + 1.6 + (hr * 7 % 1) * 1.5;
          const x = a[0] + ux * d - uz * off * side, z = a[1] + uz * d + ux * off * side;
          const near = nearBuilding(x, z);
          let kind = null;
          if (village || near) {
            if (hr < 0.10) kind = hr < 0.055 ? 'bike' : 'bike2'; else if (hr < 0.14) kind = 'cot'; else if (hr < 0.18) kind = 'buffalo'; else if (hr < 0.21) kind = 'cow';
            else if (hr < 0.23) kind = 'sand'; else if (hr < 0.235) kind = 'flag'; else if (hr < 0.5) kind = 'shrub';
          } else {
            if (hr < 0.03) kind = 'hay'; else if (hr < 0.05) kind = 'buffalo'; else if (hr < 0.4) kind = 'shrub';
          }
          if (!kind || !free(x, z, kind === 'hay' ? 1.8 : 1.0)) continue;
          if (kind !== 'shrub' && onCarriageway(x, z, 1.0)) continue;          // never park a prop on another road
          placed[kind].push([x, z, kind === 'bike' || kind === 'bike2' || kind === 'cot' ? rot + (hr > 0.07 ? Math.PI / 2 : 0) : hr * 40, 0.8 + (hr * 13 % 1) * 0.5]);
        }
      }
    }
    for (const b of D.buildings) if (b.r === 'rcc') {
      const hr = hash(b.p[0][1], b.p[0][0]);
      if (hr < 0.22) { const q2 = b.p[0], q3 = b.p[1]; placed.dish.push([q2[0] + (q3[0]-q2[0])*0.3, q2[1] + (q3[1]-q2[1])*0.3, hr * 30, 1, b.h]); }
    }
    for (const k in placed) {
      const list = placed[k]; if (!list.length) continue;
      const ims = PROPS[k].map(([g, mat]) => new THREE.InstancedMesh(g, mat, list.length));
      list.forEach((it, i) => {
        q.setFromAxisAngle(v.set(0, 1, 0), it[2]);
        const sc = k === 'shrub' || k === 'hay' || k === 'sand' ? it[3] : k === 'cow' || k === 'buffalo' ? 0.92 + (it[3] - 0.8) * 0.3 : 1;
        m4.compose(v.set(it[0], it[4] || 0, it[1]), q, s.set(sc, sc, sc)); ims.forEach(im => im.setMatrixAt(i, m4));
        if (k !== 'shrub' && k !== 'dish' && k !== 'flag') {
          const sg = [it[0] - 0.6, it[1], it[0] + 0.6, it[1]], kk = key(Math.floor(it[0] / CS), Math.floor(it[1] / CS));
          (grid.get(kk) || grid.set(kk, []).get(kk)).push(sg);
        }
      });
      ims.forEach(im => { im.castShadow = k !== 'shrub'; im.frustumCulled = false; group.add(im); });
      // bikes / cattle stay whole: player.js and animals.js find those InstancedMeshes by instance count
      // (those are mirrored: the original stays findable, the chunks copy its matrices / visibility)
      const mir = /^(bike|bike2|cow|buffalo)$/.test(k);
      ims.forEach(im => lodChunks(splitIM(im, { cell: k === 'shrub' ? 240 : 320, mirror: mir }), k === 'shrub' ? 'shrub' : 'prop', mir ? im : null));
    }

    // ---------------- surface raster (2 m) for grip / audio
    const SR = 2, sw = Math.ceil(W / SR), sh = Math.ceil(H / SR);
    const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
    const sg2 = sc.getContext('2d'); sg2.lineCap = sg2.lineJoin = 'round';
    const SURF = ['field', 'dirt', 'lane', 'cc', 'tar', 'highway', 'river'];
    const drawLine = (pts, w, v2) => {
      sg2.strokeStyle = `rgb(${v2},0,0)`; sg2.lineWidth = w / SR; sg2.beginPath();
      pts.forEach((p, i) => i ? sg2.lineTo((p[0]-xmin)/SR, (p[1]-zmin)/SR) : sg2.moveTo((p[0]-xmin)/SR, (p[1]-zmin)/SR)); sg2.stroke();
    };
    sg2.imageSmoothingEnabled = false;
    D.river.forEach(r => drawLine(r, 22, 6));
    ['dirt', 'lane', 'cc', 'tar', 'highway'].forEach(t => VR.filter(r => r.t === t).forEach(r => drawLine(r.p, r.w + 0.5, SURF.indexOf(t))));
    const sdata = sg2.getImageData(0, 0, sw, sh).data;
    // speed breakers lift whatever rolls over them (list filled by streetFurniture below)
    const HUMPS = [];
    function humpAt(x, z) {
      for (const h of HUMPS) {
        const dx = x - h[0], dz = z - h[1]; if (dx * dx + dz * dz > 30) continue;
        const sa = Math.sin(h[2]), ca = Math.cos(h[2]), al = dx * sa + dz * ca;
        if (Math.abs(al) >= h[5] / 2 || Math.abs(dx * ca - dz * sa) >= (h[3] + 0.4) / 2) continue;
        const c = Math.cos(Math.PI * al / h[5]); let y = h[6] * c * c;
        if (h[7]) { const e = Math.min(1, ((h[3] + 0.4) / 2 - Math.abs(dx * ca - dz * sa)) / 0.4); y *= e * e * (3 - 2 * e); }   // cement hump: rounded ends
        return y;
      }
      return 0;
    }
    function surfaceAt(x, z) {
      const i = Math.floor((x - xmin) / SR), j = Math.floor((z - zmin) / SR);
      if (i < 0 || j < 0 || i >= sw || j >= sh) return 'field';
      const sf = SURF[Math.round(sdata[(j * sw + i) * 4])] || 'field';
      // a clean join at the speed breaker (the raster is 2 m): cement on the house side, mud beyond
      if ((sf === 'lane' || sf === 'dirt') && x > 44 && x < 60 && z > -300 && z < -266) return (x - BRK.x) * BRK.nx + (z - BRK.z) * BRK.nz > 0 ? 'lane' : 'dirt';
      return sf;
    }

    // ---------------- dynamic colliders (parked vehicles etc.) and building lookups for other modules
    function addCollider(x, z, hw, hl, rot) {
      const c = Math.cos(rot || 0), s2 = Math.sin(rot || 0);
      const P2 = (a, b2) => [x + a * c + b2 * s2, z - a * s2 + b2 * c];      // local (right, fwd) -> world, fwd = (sin r, cos r)
      const pts = [P2(-hw, -hl), P2(hw, -hl), P2(hw, hl), P2(-hw, hl)], handle = [];
      for (let i = 0; i < 4; i++) {
        const a = pts[i], b2 = pts[(i + 1) % 4], sg = [a[0], a[1], b2[0], b2[1]];
        const i0 = Math.floor(Math.min(sg[0], sg[2]) / CS), i1 = Math.floor(Math.max(sg[0], sg[2]) / CS);
        const j0 = Math.floor(Math.min(sg[1], sg[3]) / CS), j1 = Math.floor(Math.max(sg[1], sg[3]) / CS);
        for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) { const k = key(ii, jj); (grid.get(k) || grid.set(k, []).get(k)).push(sg); handle.push([k, sg]); }
      }
      return handle;
    }
    function removeCollider(handle) {
      for (const [k, sg] of handle || []) { const l = grid.get(k); if (l) { const i = l.indexOf(sg); if (i >= 0) l.splice(i, 1); } }
    }
    const BG = 20, bldGrid = new Map();
    D.buildings.forEach(b => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of b.p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      b.bb = [x0, z0, x1, z1];
      for (let i = Math.floor(x0 / BG); i <= Math.floor(x1 / BG); i++) for (let j = Math.floor(z0 / BG); j <= Math.floor(z1 / BG); j++) { const k = i * 100003 + j; (bldGrid.get(k) || bldGrid.set(k, []).get(k)).push(b); }
    });
    function insideBuilding(x, z, margin) {
      const m = margin || 0;
      for (let i = Math.floor((x - m) / BG); i <= Math.floor((x + m) / BG); i++) for (let j = Math.floor((z - m) / BG); j <= Math.floor((z + m) / BG); j++) {
        for (const b of bldGrid.get(i * 100003 + j) || []) {
          const bb = b.bb; if (x < bb[0] - m || x > bb[2] + m || z < bb[1] - m || z > bb[3] + m) continue;
          if (inside([x, z], b.p)) return b;
          if (m) for (let k2 = 0; k2 < b.p.length; k2++) {
            const a = b.p[k2], c2 = b.p[(k2 + 1) % b.p.length], dx = c2[0]-a[0], dz = c2[1]-a[1], L2 = dx*dx + dz*dz || 1;
            const t = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / L2));
            if (Math.hypot(x - a[0] - t*dx, z - a[1] - t*dz) < m) return b;
          }
        }
      }
      return null;
    }
    // nearest road point: { d, x, z, ang (road heading), r }
    function nearestRoad(x, z, filter) {
      let best = null;
      for (const r of D.roads) { if (filter && !filter(r)) continue;
        for (let i = 0; i < r.p.length - 1; i++) {
          const a = r.p[i], c2 = r.p[i+1];
          if (Math.min(a[0], c2[0]) > x + 300 || Math.max(a[0], c2[0]) < x - 300) continue;
          const dx = c2[0]-a[0], dz = c2[1]-a[1], L2 = dx*dx + dz*dz || 1, t = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / L2));
          const px = a[0]+t*dx, pz = a[1]+t*dz, d = Math.hypot(x-px, z-pz);
          if (!best || d < best.d) best = { d, x: px, z: pz, ang: Math.atan2(dx, dz), r };
        }
      }
      return best;
    }

    // ---------------- street furniture: speed breakers, road signs, NH milestones, village arch
    (function streetFurniture() {
      // speed breakers on village roads near the school and the Shivalayam
      const humps = [];
      const targets = D.landmarks.filter(l => l.k === 'school' || (l.k === 'temple' && l.name.startsWith('Shiva')));
      for (const l of targets) for (const r of D.roads) {
        if (!['cc', 'lane', 'tar'].includes(r.t)) continue;
        let s = 0; const samples = [];
        for (let i = 0; i < r.p.length - 1; i++) {
          const a = r.p[i], c2 = r.p[i+1], L2 = Math.hypot(c2[0]-a[0], c2[1]-a[1]);
          for (let d = 0; d < L2; d += 2) { const x = a[0] + (c2[0]-a[0]) * d / L2, z = a[1] + (c2[1]-a[1]) * d / L2; samples.push([s + d, x, z, Math.atan2(c2[0]-a[0], c2[1]-a[1]), Math.hypot(x - l.x, z - l.z)]); }
          s += L2;
        }
        if (!samples.length) continue;
        const m = samples.reduce((b2, p) => p[4] < b2[4] ? p : b2); if (m[4] > 55) continue;
        for (const off of [-22, 22]) {
          const p = samples.reduce((b2, q2) => Math.abs(q2[0] - (m[0] + off)) < Math.abs(b2[0] - (m[0] + off)) ? q2 : b2);
          if (Math.abs(p[0] - (m[0] + off)) > 3) continue;
          if (humps.some(h => Math.hypot(h[0] - p[1], h[1] - p[2]) < 10)) continue;
          humps.push([p[1], p[2], p[3], r.w, (ROAD_STYLE[r.t] || ROAD_STYLE.cc).y]);
        }
      }
      // the safe-house breaker replaces any generated one near the gate: on the lane straight opposite the main gate
      // (gate axis meets it at this point), its long side parallel to the gate line. Big concrete hump: 6.4 x 1.7 m, 17 cm.
      for (let i = humps.length - 1; i >= 0; i--) if (Math.hypot(humps[i][0] - 48.7, humps[i][1] + 270.2) < 14 || Math.hypot(humps[i][0] - 76, humps[i][1] + 340) < 12) humps.splice(i, 1);
      // Plain cement, no paint; it is the line where the mud lane meets the cement road (BRK).
      humps.push([BRK.x, BRK.z, Math.atan2(-0.458, 0.889), 7, ROAD_STYLE.lane.y, 2.6, 0.17, true]);   // broad cement hump over the culvert (photos 58-60)
      for (const h of humps) { if (h[5] == null) { h[5] = 0.9; h[6] = 0.1; h[7] = true; h[8] = true; } }   // every breaker is plain cement; h[8]: generated, gets warning signs
      HUMPS.push(...humps);
      if (humps.length) {
        for (const h of humps) {
          // same curve as humpAt in metres, cement texture in world UVs
          const wd = h[3] + 0.4, eg = new THREE.PlaneGeometry(wd, h[5], 16, 12); eg.rotateX(-Math.PI / 2);
          const P = eg.attributes.position, UV = eg.attributes.uv, sa = Math.sin(h[2]), ca = Math.cos(h[2]);
          for (let i = 0; i < P.count; i++) {
            const lx = P.getX(i), lz = P.getZ(i), wx = h[0] + lx * ca + lz * sa, wz = h[1] - lx * sa + lz * ca;
            P.setY(i, humpAt(wx, wz)); UV.setXY(i, wx / 3.2, wz / 3.2);
          }
          eg.computeVertexNormals();
          const em = new THREE.Mesh(eg, new THREE.MeshLambertMaterial({ map: RT.concrete, color: 0xc8c4ba }));
          em.position.set(h[0], h[4] - 0.02, h[1]); em.rotation.y = h[2]; em.receiveShadow = true; group.add(em);
        }
      }
      // sign boards: canvas plates on a grey pole
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
      const plate = (draw, w, h) => { const [c, g] = cvs(256, Math.round(256 * h / w)); draw(g, c.width, c.height); const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3 })); };
      const signDraw = {
        speed: (n) => (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w/2, h/2, w/2 - 2, 0, 7); g.fill(); g.strokeStyle = '#d32f2f'; g.lineWidth = w * 0.11; g.beginPath(); g.arc(w/2, h/2, w/2 - w * 0.07, 0, 7); g.stroke(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${w * 0.38}px sans-serif`; g.fillText(n, w/2, h/2 + 4); },
        school: (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w/2, 6); g.lineTo(w - 6, h - 6); g.lineTo(6, h - 6); g.closePath(); g.fill(); g.strokeStyle = '#d32f2f'; g.lineWidth = 16; g.stroke();
          g.fillStyle = '#111'; for (const [x, s2] of [[0.42, 1], [0.58, 0.8]]) { g.beginPath(); g.arc(w * x, h * 0.5, 11 * s2, 0, 7); g.fill(); g.fillRect(w * x - 9 * s2, h * 0.55, 18 * s2, 50 * s2); } },
        junction: (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w/2, 6); g.lineTo(w - 6, h - 6); g.lineTo(6, h - 6); g.closePath(); g.fill(); g.strokeStyle = '#d32f2f'; g.lineWidth = 16; g.stroke();
          g.fillStyle = '#111'; g.fillRect(w/2 - 8, h * 0.35, 16, h * 0.5); g.fillRect(w * 0.3, h * 0.6, w * 0.4, 16); },
        info: (t1, t2, bg) => (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `bold ${h * 0.3}px sans-serif`; g.fillText(t1, w/2, h * 0.45, w - 16); if (t2) { g.font = `bold ${h * 0.22}px sans-serif`; g.fillText(t2, w/2, h * 0.8, w - 16); } },
      };
      function signAt(x, z, faceAng, draw, w, h) {
        const gS = new THREE.Group(); gS.position.set(x, 0, z); gS.rotation.y = faceAng;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), poleMat); pole.position.y = 1.3; gS.add(pole);
        const p = plate(draw, w, h); p.position.set(0, 2.6 + h / 2 - 0.2, 0.06); gS.add(p);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), poleMat); back.position.set(0, p.position.y, 0.04); back.rotation.y = Math.PI; gS.add(back);
        group.add(gS); addCollider(x, z, 0.12, 0.12, 0);
      }
      // place a sign on the left verge of a road, facing traffic travelling along heading `ang`
      const verge = (x, z, ang, w, side) => [x + Math.cos(ang) * (w / 2 + 1.2) * side, z - Math.sin(ang) * (w / 2 + 1.2) * side];
      const safe = (x, z) => !insideBuilding(x, z, 0.6) && surfaceAt(x, z) === 'field' && Math.hypot(x - 45, z + 276) > 28;   // none around the house junction
      for (const h of humps.filter(q2 => q2[8])) for (const dir of [1, -1]) {
        const back = 18 * dir, x0 = h[0] - Math.sin(h[2]) * back, z0 = h[1] - Math.cos(h[2]) * back;
        const [sx, sz] = verge(x0, z0, h[2], h[3], dir);
        if (safe(sx, sz)) signAt(sx, sz, h[2] + (dir > 0 ? Math.PI : 0), signDraw.school, 0.9, 0.8);
      }
      // highway: speed limits, junction warning, milestones
      const hwRoads = D.roads.filter(r => r.t === 'highway');
      const hwAtX = (X) => { let best = null; for (const r of hwRoads) for (let i = 0; i < r.p.length - 1; i++) { const a = r.p[i], c2 = r.p[i+1]; if ((a[0] - X) * (c2[0] - X) > 0) continue; const t = (X - a[0]) / ((c2[0] - a[0]) || 1e-6); const z = a[1] + (c2[1] - a[1]) * t; if (!best || r.w > best.w) best = { x: X, z, ang: Math.atan2(c2[0]-a[0], c2[1]-a[1]), w: r.w }; } return best; };
      const J = D.landmarks.find(l => l.k === 'busstop') || { x: 0, z: 0 };
      const hj = nearestRoad(J.x, J.z, r => r.t === 'highway');
      if (hj) {
        for (const [dx, kind] of [[-260, 'speed'], [260, 'speed'], [-120, 'junction'], [120, 'junction'], [-60, 'speed40'], [60, 'speed40']]) {
          const p = hwAtX(hj.x + dx); if (!p) continue;
          const heading = dx < 0 ? p.ang : p.ang + Math.PI;     // traffic approaching the junction, driving on the left
          const [sx, sz] = verge(p.x, p.z, heading, p.w + 0.6, 1);
          if (!safe(sx, sz)) continue;
          const draw = kind === 'junction' ? signDraw.junction : signDraw.speed(kind === 'speed40' ? '40' : '60');
          signAt(sx, sz, heading + Math.PI, draw, 0.9, kind === 'junction' ? 0.8 : 0.9);
        }
        // milestones every km, white stone with a yellow cap; west face JANGAON, east face WARANGAL
        const stoneMat = new THREE.MeshLambertMaterial({ color: 0xf2f0ea }), capMat = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
        const xs = hwRoads.flatMap(r => r.p.map(p => p[0])), hx0 = Math.max(xmin + 20, Math.min(...xs)), hx1 = Math.min(xmax - 20, Math.max(...xs));
        for (let X = Math.ceil((hx0 - hj.x) / 1000) * 1000 + hj.x - 500; X < hx1; X += 1000) {
          const p = hwAtX(X); if (!p) continue;
          const sx = p.x - Math.cos(p.ang) * (p.w / 2 + 2), sz = p.z + Math.sin(p.ang) * (p.w / 2 + 2);
          if (!safe(sx, sz)) continue;
          const jk = Math.max(1, Math.round(18 + (X - hj.x) / 1000)), wk = Math.max(1, Math.round(52 - (X - hj.x) / 1000));
          const gM = new THREE.Group(); gM.position.set(sx, 0, sz); gM.rotation.y = p.ang + Math.PI / 2;
          const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.22), stoneMat); body.position.y = 0.375; gM.add(body);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.22, 12, 1, false, 0, Math.PI), capMat); cap.rotation.x = Math.PI / 2; cap.rotation.z = Math.PI / 2; cap.position.y = 0.75; gM.add(cap);
          for (const [face, txt, km] of [[1, 'JANGAON', jk], [-1, 'WARANGAL', wk]]) {
            const p2 = plate((g, w, h) => { g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h * 0.3); g.fillStyle = '#111'; g.textAlign = 'center'; g.font = `bold ${h * 0.18}px sans-serif`; g.fillText('NH 365B', w/2, h * 0.22); g.font = `bold ${h * 0.17}px sans-serif`; g.fillText(txt, w/2, h * 0.55, w - 8); g.font = `bold ${h * 0.24}px sans-serif`; g.fillText(km + ' km', w/2, h * 0.86); }, 0.52, 0.9);
            p2.position.set(0, 0.47, 0.115 * face); if (face < 0) p2.rotation.y = Math.PI; gM.add(p2);
          }
          gM.traverse(o => { if (o.isMesh) o.castShadow = true; });
          group.add(gM); addCollider(sx, sz, 0.3, 0.15, p.ang + Math.PI / 2);
        }
        // village name arch over the road that leaves the NH towards the village
        let best = null;
        for (const r of D.roads) { if (r.t === 'highway' || r.t === 'dirt') continue;
          for (const [i, j] of [[0, 1], [r.p.length - 1, r.p.length - 2]]) { const e = r.p[i], d = Math.hypot(e[0] - hj.x, e[1] - hj.z); if (d < 120 && (!best || d < best.d)) best = { d, r, e, n: r.p[j] }; } }
        if (best) {
          const ang = Math.atan2(best.n[0] - best.e[0], best.n[1] - best.e[1]), w = best.r.w + 3;
          const ax = best.e[0] + Math.sin(ang) * 14, az = best.e[1] + Math.cos(ang) * 14;
          const gA = new THREE.Group(); gA.position.set(ax, 0, az); gA.rotation.y = ang;
          const pil = new THREE.MeshLambertMaterial({ color: 0xe9dcc0 }), red = new THREE.MeshLambertMaterial({ color: 0xb83b2e });
          for (const sx2 of [-1, 1]) { addBox(gA, 0.8, 6, 0.8, pil, sx2 * w / 2, 3, 0); addBox(gA, 1, 0.5, 1, red, sx2 * w / 2, 6.2, 0); addCollider(ax + Math.cos(ang) * sx2 * w / 2, az - Math.sin(ang) * sx2 * w / 2, 0.5, 0.5, ang); }
          addBox(gA, w + 1.2, 1.6, 0.5, red, 0, 6.6, 0);
          const tb = textBoard('NELLUTLA', 'నెల్లుట్ల గ్రామం · WELCOMES YOU', '#0b5d1e', w, 1.4);
          tb.position.set(0, 6.6, -0.26); tb.rotation.y = Math.PI; gA.add(tb);
          const tb2 = textBoard('NELLUTLA', 'THANK YOU · VISIT AGAIN', '#0b5d1e', w, 1.4); tb2.position.set(0, 6.6, 0.26); gA.add(tb2);
          const kal = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 8), new THREE.MeshPhongMaterial({ color: 0xd4a017 })); kal.position.set(0, 7.9, 0); gA.add(kal);
          group.add(gA);
        }
      }
    })();

    // ---------------- 2D map renderer for radar / full map (north up: canvas y = world z = south)
    const mapCanvas = document.createElement('canvas'); const MS = 0.5; // px per metre
    mapCanvas.width = Math.ceil(W * MS); mapCanvas.height = Math.ceil(H * MS);
    const mapIcons = [];        // { x, z, type: 'P' | ..., label }
    // stylised land-cover palette: fallow, red soil, crops, trees, built, scrub, water
    const MAP_LC = [[196, 178, 132], [184, 140, 98], [142, 176, 96], [104, 146, 82], [214, 204, 184], [176, 168, 120], [110, 170, 214]];
    const roadName = r => r.t === 'highway' ? 'NH-365B' : r.t === 'tar' ? 'Lingala Ghanpur Rd' : null;
    function paintMap(lcImgLoaded) {
      const g = mapCanvas.getContext('2d');
      g.fillStyle = '#c9b98e'; g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
      if (lcImgLoaded) {
        const lc = D.landcover, t = document.createElement('canvas'); t.width = lc.w; t.height = lc.h;
        const tg = t.getContext('2d'); tg.drawImage(lcImgLoaded, 0, 0);
        const im = tg.getImageData(0, 0, lc.w, lc.h);
        for (let i = 0; i < lc.w * lc.h; i++) { const c = MAP_LC[im.data[i * 4]] || MAP_LC[0]; im.data[i*4] = c[0]; im.data[i*4+1] = c[1]; im.data[i*4+2] = c[2]; im.data[i*4+3] = 255; }
        tg.putImageData(im, 0, 0);
        g.imageSmoothingEnabled = true; g.drawImage(t, 0, 0, mapCanvas.width, mapCanvas.height);
      }
      const P = p => [(p[0]-xmin)*MS, (p[1]-zmin)*MS];
      g.lineCap = g.lineJoin = 'round';
      const path = pts => { g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); };
      const line = (pts, w, c) => { g.strokeStyle = c; g.lineWidth = w; path(pts); g.stroke(); };
      // farm parcels: subtle crop colours with bund lines
      for (const f of FI) { const c = f.m != null ? [(f.m >> 16) & 255, (f.m >> 8) & 255, f.m & 255].map(v => Math.min(255, 40 + v * 1.05) | 0) : FIELD_MAP[f.c]; path(f.p); g.closePath(); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fill(); }
      g.strokeStyle = 'rgba(140,116,80,0.55)'; g.lineWidth = 0.6;
      for (const f of FI) { path(f.p); g.closePath(); g.stroke(); }
      D.lakes.forEach(lk => { path(lk); g.strokeStyle = '#b8a07a'; g.lineWidth = 5; g.stroke(); });
      D.river.forEach(r => { line(r, 12, '#d8c9a4'); line(r, 4, '#7fb7da'); });
      D.lakes.forEach(lk => { path(lk); g.fillStyle = '#6fb0dc'; g.fill(); g.strokeStyle = '#4b8fbf'; g.lineWidth = 1.5; g.stroke(); });
      D.buildings.forEach(b => { path(b.p); g.closePath(); g.fillStyle = b.paint ? '#d9a77a' : '#bfb2a2'; g.fill(); g.strokeStyle = '#8f8172'; g.lineWidth = 0.7; g.stroke(); });
      // roads: dark casing, then fill; widths by class
      const RC = { dirt: ['#9a7a52', '#d9bf8f'], lane: ['#8e8678', '#f4efe4'], cc: ['#8a8a8a', '#ffffff'], tar: ['#a8742a', '#ffd36b'], highway: ['#b0561c', '#ff9d3b'] };
      const RW = { dirt: 3, lane: 4, cc: 5, tar: 7, highway: 11 };
      const order = ['dirt', 'lane', 'cc', 'tar', 'highway'];
      order.forEach(t => D.roads.filter(r => r.t === t).forEach(r => line(r.p, Math.max(RW[t], r.w * MS) + 2.5, RC[t][0])));
      order.forEach(t => D.roads.filter(r => r.t === t).forEach(r => line(r.p, Math.max(RW[t], r.w * MS), RC[t][1])));
      D.roads.filter(r => r.t === 'highway').forEach(r => line(r.p, 0.8, 'rgba(255,255,255,0.8)'));
    }
    paintMap(null);
    // road labels (placed once along the longest straight run of each named road class)
    const roadLabels = [];
    for (const r of D.roads) {
      const name = roadName(r) || (r.t === 'cc' ? 'Village Rd' : null); if (!name) continue;
      let best = null;
      for (let i = 0; i < r.p.length - 1; i++) { const a = r.p[i], b2 = r.p[i+1], L2 = Math.hypot(b2[0]-a[0], b2[1]-a[1]); if (!best || L2 > best.L) best = { L: L2, a, b2 }; }
      if (best && best.L > (r.t === 'cc' ? 60 : 120) && !roadLabels.some(l => l.name === name && Math.hypot(l.x - (best.a[0] + best.b2[0]) / 2, l.z - (best.a[1] + best.b2[1]) / 2) < (r.t === 'cc' ? 150 : 700))) roadLabels.push({ name, x: (best.a[0] + best.b2[0]) / 2, z: (best.a[1] + best.b2[1]) / 2, ang: Math.atan2(best.b2[1] - best.a[1], best.b2[0] - best.a[0]), major: r.t !== 'cc' });
    }
    function drawMap(ctx, cxw, czw, scale, w, h, rot) {
      ctx.save(); ctx.translate(w/2, h/2); if (rot) ctx.rotate(rot);
      ctx.save(); ctx.scale(scale / MS, scale / MS); ctx.translate(-(cxw - xmin) * MS, -(czw - zmin) * MS);
      ctx.drawImage(mapCanvas, 0, 0); ctx.restore();
      // overlays in screen pixels, kept upright
      const co = Math.cos(rot || 0), si = Math.sin(rot || 0);
      const S = (x, z) => { const dx = (x - cxw) * scale, dz = (z - czw) * scale; return [dx, dz]; };
      const lim = Math.max(w, h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (scale < 0.6 || scale > 0.8) {
        ctx.font = `bold ${scale > 0.8 ? 10 : 11}px sans-serif`;
        for (const l of roadLabels) {
          if (!l.major && scale < 0.6) continue;
          const [dx, dz] = S(l.x, l.z); if (Math.abs(dx) > lim || Math.abs(dz) > lim) continue;
          let a = l.ang + (rot || 0); if (Math.cos(a) < 0) a += Math.PI;
          ctx.save(); ctx.translate(dx, dz); ctx.rotate(a - (rot || 0));
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(l.name, 0, -7);
          ctx.fillStyle = l.major ? '#7a3a08' : '#444'; ctx.fillText(l.name, 0, -7); ctx.restore();
        }
      }
      for (const ic of mapIcons) {
        const [dx, dz] = S(ic.x, ic.z); if (Math.abs(dx) > lim || Math.abs(dz) > lim) continue;
        ctx.save(); ctx.translate(dx, dz); ctx.rotate(-(rot || 0));
        const r2 = scale > 0.8 ? 7 : 6;
        ctx.fillStyle = '#1565c0'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-r2, -r2, r2 * 2, r2 * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `bold ${r2 * 1.6}px sans-serif`; ctx.fillText(ic.type, 0, 1);
        ctx.restore();
      }
      ctx.restore();
    }
    function addMapIcon(x, z, type, label) { mapIcons.push({ x, z, type: type || 'P', label }); }

    // ---------------- villagers walking along the lanes
    const people = [];
    const PP = personParts(), PART = {};
    (function () {
      const routes = D.roads.filter(r => (r.t === 'cc' || r.t === 'lane' || r.t === 'tar') && r.p.length >= 2);
      const lens = routes.map(r => r.p.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - r.p[i-1][0], p[1] - r.p[i-1][1]) : 0, 0));
      const COUNT = 220;
      const skin = [0x8d5a3b, 0x7a4a2e, 0x6b3f26, 0x9a6844, 0x5e3720, 0xa0704c];
      const sarees = [0xc2185b, 0x1565c0, 0xf9a825, 0x2e7d32, 0xd84315, 0x6a1b9a, 0x00838f, 0xad1457, 0x8e24aa, 0xef6c00, 0x00695c, 0xb71c1c, 0x5d4037];
      const blouses = [0xf9a825, 0x2e7d32, 0xb71c1c, 0x1a237e, 0x6a1b9a, 0x4e342e, 0xd81b60];
      const shirts = [0xffffff, 0xf5f5f5, 0xbfd7ea, 0x90a4ae, 0xe0c9a6, 0x8d6e63, 0x5c6bc0, 0xd7ccc8, 0x9ccc65, 0x4fc3f7];
      const lungis = [0x1565c0, 0x283593, 0x6d4c41, 0x2e7d32, 0x8e1b3a, 0xf5f5f5, 0x37474f, 0x00695c];
      const sareeTex = sareeTexture(); sareeTex.repeat.set(3, 1);
      const mats = {
        skin: new THREE.MeshLambertMaterial({ vertexColors: true }), cloth: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
        hair: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x333333 }),
        saree: new THREE.MeshLambertMaterial({ map: sareeTex, vertexColors: true, side: THREE.DoubleSide }),
        lungi: new THREE.MeshLambertMaterial({ map: checkTexture(), vertexColors: true, side: THREE.DoubleSide }),
        stick: new THREE.MeshLambertMaterial({ vertexColors: true }),
      };
      const matOf = { skin: 'skin', arm: 'skin', leg: 'skin', hairShort: 'hair', hairLong: 'hair', saree: 'saree', lungi: 'lungi', dhoti: 'cloth', shirt: 'cloth', blouse: 'cloth', shorts: 'cloth', skirt: 'cloth', bag: 'cloth', stick: 'stick' };
      const cap = { arm: COUNT * 2, leg: COUNT * 2 };
      for (const k in matOf) {
        const m = new THREE.InstancedMesh(PP[k], mats[matOf[k]], cap[k] || COUNT); m.castShadow = true; m.frustumCulled = false;
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((cap[k] || COUNT) * 3).fill(1), 3); m.count = 0; group.add(m); PART[k] = m;
      }
      const slot = (k, hex) => { const m = PART[k], i = m.count++; m.setColorAt(i, col.setHex(hex)); return i; };
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      // quiet zones (e.g. the lane in front of the safe house): villagers never spawn or walk into them
      const quiet = (x, z) => (window.NELLUTLA_QUIET || []).some(q => Math.hypot(x - q.x, z - q.z) < q.r);
      let made = 0, guard = 0;
      while (made < COUNT && guard++ < COUNT * 20) {
        const k = Math.floor(Math.random() * routes.length); if (lens[k] < 30) continue;
        const r = routes[k], roll = Math.random();
        const type = roll < 0.42 ? 'woman' : roll < 0.76 ? 'man' : roll < 0.82 ? 'elderMan' : roll < 0.86 ? 'elderWoman' : roll < 0.93 ? 'boy' : 'girl';
        const female = type === 'woman' || type === 'elderWoman' || type === 'girl', kid = type === 'boy' || type === 'girl', elder = type.startsWith('elder');
        const sk = pick(skin), hairC = elder ? pick([0xb0aca4, 0xd8d4cc, 0x8a8680]) : pick([0x0e0b09, 0x15100c, 0x1c1410]);
        const parts = {};
        parts.skin = slot('skin', sk); parts.armL = slot('arm', sk); parts.armR = slot('arm', sk); parts.legL = slot('leg', sk); parts.legR = slot('leg', sk);
        parts[female ? 'hairLong' : 'hairShort'] = slot(female ? 'hairLong' : 'hairShort', hairC);
        if (type === 'woman' || type === 'elderWoman') { const sc2 = pick(sarees); parts.saree = slot('saree', sc2); parts.blouse = slot('blouse', Math.random() < 0.5 ? sc2 : pick(blouses)); }
        else if (type === 'man' || type === 'elderMan') {
          parts.shirt = slot('shirt', pick(shirts));
          if (elder || Math.random() < 0.15) parts.dhoti = slot('dhoti', 0xf2efe6); else parts.lungi = slot('lungi', pick(lungis));
        } else {
          parts.shirt = slot('shirt', Math.random() < 0.6 ? 0xffffff : 0xbfd7ea);
          if (type === 'boy') parts.shorts = slot('shorts', pick([0x1a237e, 0x4e342e, 0x37474f])); else parts.skirt = slot('skirt', pick([0x1a237e, 0x880e4f, 0x37474f]));
          parts.bag = slot('bag', pick([0xc62828, 0x1565c0, 0x2e7d32, 0x6a1b9a]));
        }
        const stick = elder && Math.random() < 0.85; if (stick) parts.stick = slot('stick', 0xffffff);
        const scale = kid ? 0.66 + Math.random() * 0.1 : female ? 0.92 + Math.random() * 0.05 : 0.98 + Math.random() * 0.07;
        const s0 = Math.random() * lens[k], q0 = pathPoint(r, s0);
        if (quiet(q0[0], q0[1])) { for (const k2 in parts) { const m = PART[k2 === 'armL' || k2 === 'armR' ? 'arm' : k2 === 'legL' || k2 === 'legR' ? 'leg' : k2]; if (m) m.count--; } continue; }
        people.push({ r, len: lens[k], s: s0, dir: Math.random() < 0.5 ? 1 : -1, speed: (elder ? 0.55 : kid ? 1.1 : 0.9) + Math.random() * (elder ? 0.2 : 0.6),
          side: Math.random() < 0.5 ? 1 : -1, off: 0, phase: Math.random() * 6, scale, type, parts, stick, stoop: elder ? 0.14 : 0,
          swing: type === 'woman' || type === 'elderWoman' ? 0.3 : parts.lungi != null ? 0.3 : 0.5, idle: Math.random() < 0.25, x: 0, z: 0, rot: 0 });
        made++;
      }
      people.meshes = PART;
      people.count = made;
      Object.values(PART).forEach(m => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      // distance LOD: each frame only villagers near the camera are packed into the first slots (count = packed);
      // per-slot colours are kept here so they can follow a person to whatever slot it lands in
      people.srcCol = {}; people.qLim = {}; people.lastN = {};
      for (const k in PART) { const m = PART[k]; m.userData.qFull = m.count; people.srcCol[k] = m.instanceColor.array.slice(); people.qLim[k] = people.lastN[k] = m.count; }
      // villagers beyond PEOPLE_SH m go into a twin set of meshes (same geometry / material) that casts no shadow, so the
      // shadow pass only draws the few inside the sun's shadow box; both sets get a per-frame bounding sphere (frustum culling)
      people.far = {};
      for (const k in PART) {
        const m = PART[k], cap2 = m.instanceMatrix.count, base = m.geometry;
        m.geometry = shallowGeo(base, new THREE.Sphere()); m.frustumCulled = true;
        const f = new THREE.InstancedMesh(shallowGeo(base, new THREE.Sphere()), m.material, cap2);
        f.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap2 * 3).fill(1), 3);
        f.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        f.count = 0; f.castShadow = false; f.receiveShadow = m.receiveShadow; f.frustumCulled = true; group.add(f); people.far[k] = f;
      }
    })();
    function pathPoint(r, s2) {
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b2 = r.p[i+1], L = Math.hypot(b2[0]-a[0], b2[1]-a[1]);
        if (s2 <= L || i === r.p.length - 2) { const t = Math.min(1, s2 / (L || 1)); return [a[0] + (b2[0]-a[0]) * t, a[1] + (b2[1]-a[1]) * t, Math.atan2(b2[0]-a[0], b2[1]-a[1])]; }
        s2 -= L;
      }
    }
    const pm4 = new THREE.Matrix4(), pq = new THREE.Quaternion(), pqa = new THREE.Quaternion(), pv = new THREE.Vector3(), ps = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
    const bodyM = new THREE.Matrix4(), jointM = new THREE.Matrix4(), rotM = new THREE.Matrix4(), limbM = new THREE.Matrix4();
    let peopleT = 0; const PEOPLE_SH = 90;
    function updatePeople(dt, car, camPos) {
      if (!people.count) return;
      peopleT += dt;
      const M = people.meshes, QUIET = window.NELLUTLA_QUIET || [];
      // quality.js lowers mesh.count to drop the tail of the crowd: pick that up as a slot limit
      const QL = people.qLim, NX = {}, NF = {}, MF = people.far, PR2 = Math.pow(vLevel === 'efficient' ? 120 : vLevel === 'low' ? 160 : vLevel === 'medium' ? 230 : 300, 2), SH2 = PEOPLE_SH * PEOPLE_SH;
      const BN = [1e9, 1e9, -1e9, -1e9], BF = [1e9, 1e9, -1e9, -1e9];
      for (const k in M) { if (M[k].count !== people.lastN[k]) QL[k] = M[k].count; NX[k] = NF[k] = 0; }
      const meshOf = (k) => k === 'armL' || k === 'armR' ? 'arm' : k === 'legL' || k === 'legR' ? 'leg' : k;
      const D = {};
      people.forEach((p) => {
        // only animate + draw people near the camera; far ones keep their last pose and are not drawn
        const P0 = p.parts;
        for (const k in P0) if (P0[k] >= QL[meshOf(k)]) return;
        let near = true;
        if (camPos && p.x !== 0) { const dx = p.x - camPos.x, dz = p.z - camPos.z, d2 = dx * dx + dz * dz; if (d2 > PR2) return; near = d2 < SH2; }
        const TM = near ? M : MF, TN = near ? NX : NF, bb = near ? BN : BF;
        for (const k in P0) {             // pack this person's parts into the next free slots, colours follow
          const mk = meshOf(k), j = TN[mk]++, src = people.srcCol[mk]; D[k] = j;
          TM[mk].instanceColor.array[j * 3] = src[P0[k] * 3]; TM[mk].instanceColor.array[j * 3 + 1] = src[P0[k] * 3 + 1]; TM[mk].instanceColor.array[j * 3 + 2] = src[P0[k] * 3 + 2];
        }
        let walking = !p.idle;
        let target = p.r.w / 2 + 0.7 + (p.dodge || 0);   // p.dodge: sidestep set by visitors.js (Crowd)
        if (car && !window.NELLUTLA_ON_FOOT) {      // on foot, visitors.js (Crowd) makes them sidestep the walker instead
          const dc = Math.hypot(car.x - p.x, car.z - p.z);
          if (dc < 7) { target = p.r.w / 2 + 2.6; walking = false; }      // step aside for the car
        }
        p.off += (target - p.off) * Math.min(1, dt * 3);
        if (walking) {
          p.s += p.dir * p.speed * dt;
          if (QUIET.length) { const q = pathPoint(p.r, p.s); if (QUIET.some(z2 => Math.hypot(q[0] - z2.x, q[1] - z2.z) < z2.r)) { p.s -= 2 * p.dir * p.speed * dt; p.dir = -p.dir; } }
          if (p.s > p.len) { p.s = p.len; p.dir = -1; } else if (p.s < 0) { p.s = 0; p.dir = 1; }
        }
        const [x, z, h] = pathPoint(p.r, p.s), rot = p.dir > 0 ? h : h + Math.PI;
        const o = p.off * p.side;
        p.x = x + Math.cos(h) * o; p.z = z - Math.sin(h) * o; p.rot = rot;
        const ph = peopleT * 6 * p.speed + p.phase, sw = walking ? Math.sin(ph) * p.swing : 0, sc = p.scale;
        const bob = walking ? Math.abs(Math.cos(ph)) * 0.025 * sc : 0;
        pq.setFromAxisAngle(yAxis, rot); pqa.setFromAxisAngle(xAxis, p.stoop); pq.multiply(pqa); ps.set(sc, sc, sc);
        bodyM.compose(pv.set(p.x, bob + landAt(p.x, p.z) + humpAt(p.x, p.z) + dipAt(p.x, p.z) + (surfaceAt(p.x, p.z) === 'field' ? 0 : 0.065), p.z), pq, ps);
        const P = D;
        if (p.x < bb[0]) bb[0] = p.x; if (p.x > bb[2]) bb[2] = p.x; if (p.z < bb[1]) bb[1] = p.z; if (p.z > bb[3]) bb[3] = p.z;
        for (const k in P0) if (k !== 'armL' && k !== 'armR' && k !== 'legL' && k !== 'legR' && k !== 'stick') TM[k].setMatrixAt(P[k], bodyM);
        const limb = (mesh, idx, lx, ly, lz, ang) => {
          jointM.makeTranslation(lx, ly, lz); rotM.makeRotationX(ang);
          limbM.multiplyMatrices(bodyM, jointM).multiply(rotM); mesh.setMatrixAt(idx, limbM);
        };
        const sh = p.type === 'woman' || p.type === 'elderWoman' ? 0.185 : 0.205;
        limb(TM.leg, P.legL, -0.09, 0.88, 0, sw - p.stoop); limb(TM.leg, P.legR, 0.09, 0.88, 0, -sw - p.stoop);
        limb(TM.arm, P.armL, -sh, 1.4, 0, -sw * 0.8 + 0.04);
        const armR = p.stick ? -0.35 - p.stoop + sw * 0.15 : sw * 0.8 + 0.04;
        limb(TM.arm, P.armR, sh, 1.4, 0, armR);
        if (p.stick) limb(TM.stick, P.stick, sh, 1.4, 0, armR);
      });
      const setSph = (m, b) => { const sp = m.geometry.boundingSphere; if (b[0] > b[2]) { sp.center.set(0, -1e5, 0); sp.radius = 0; return; } sp.center.set((b[0] + b[2]) / 2, 1, (b[1] + b[3]) / 2); sp.radius = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 2.5; };
      for (const k in M) {
        M[k].count = people.lastN[k] = NX[k]; M[k].instanceMatrix.needsUpdate = true; M[k].instanceColor.needsUpdate = true; setSph(M[k], BN);
        const f = MF[k]; f.count = NF[k]; setSph(f, BF); if (f.count) { f.instanceMatrix.needsUpdate = true; f.instanceColor.needsUpdate = true; }
      }
    }

    // ---------------- night lighting: street lamps on the poles switch on at dusk, off at dawn.
    // Cheap by design: emissive bulbs + one additive halo sprite per lamp (Points) + one additive light-pool decal per lamp
    // on the road (InstancedMesh) = 3 draw calls for all lamps; only a few real PointLights (by Quality tier) follow the car.
    const LAMP_X = 0.95, LAMP_Y = 6.55;                                       // bulb position in pole space (local +x faces the road)
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x8a8d90 });
    const lampG = new THREE.BoxGeometry(1.1, 0.06, 0.06); lampG.translate(0.5, 6.75, 0);                    // bracket arm
    const headG = new THREE.BoxGeometry(0.5, 0.12, 0.24); headG.translate(LAMP_X, 6.66, 0);                 // housing
    const lampIM = new THREE.InstancedMesh(lampG, lampMat, poles.length), headIM = new THREE.InstancedMesh(headG, lampMat, poles.length);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0x3a3a38 });
    const bulbG = new THREE.BoxGeometry(0.42, 0.04, 0.18); bulbG.translate(LAMP_X, 6.58, 0);
    const bulbIM = new THREE.InstancedMesh(bulbG, bulbMat, poles.length);
    const lampPos = [];                                                        // world bulb positions [x, z]
    poles.forEach((p, i) => {
      pm4.makeRotationY(p[3]).setPosition(p[0], 0, p[1]);
      lampIM.setMatrixAt(i, pm4); headIM.setMatrixAt(i, pm4); bulbIM.setMatrixAt(i, pm4);
      lampPos.push([p[0] + Math.cos(p[3]) * LAMP_X, p[1] - Math.sin(p[3]) * LAMP_X]);
    });
    for (const im of [lampIM, headIM, bulbIM]) { im.frustumCulled = false; group.add(im); }
    lampIM.castShadow = headIM.castShadow = true;
    for (const im of [lampIM, headIM, bulbIM]) if (poles.length) lodChunks(splitIM(im, { cell: 320 }), 'prop');
    const glowTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv);
    })();
    // halos around the bulbs
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos.flatMap(q2 => [q2[0], LAMP_Y, q2[1]]), 3));
    const haloMat = new THREE.PointsMaterial({ map: glowTex, color: 0xffc070, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const halos = new THREE.Points(haloGeo, haloMat); halos.visible = false; halos.frustumCulled = false; halos.renderOrder = 3; group.add(halos);
    // light pools on the ground under each lamp (flat additive decals just above the road surface)
    const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xd8904a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, poles.length)); pools.count = poles.length;
    poles.forEach((p, i) => {
      const ox = Math.cos(p[3]) * 1.6, oz = -Math.sin(p[3]) * 1.6, R = 11 + hash(p[0], p[1]) * 2;
      m4.compose(v.set(lampPos[i][0] + ox, 0.14, lampPos[i][1] + oz), q.setFromAxisAngle(yAxis, p[3]), s.set(R, 1, R * 0.85)); pools.setMatrixAt(i, m4);
    });
    pools.visible = false; pools.frustumCulled = false; pools.renderOrder = 2; group.add(pools);
    // a handful of real lights re-assigned to the lamps nearest the car (0 / 2 / 4 by tier; count fixed at build time
    // so materials never recompile - unused ones just sit at intensity 0)
    const tierName = (typeof window !== 'undefined' && window.Quality && Quality.tier) || 'medium';
    const NL = tierName === 'low' ? 0 : tierName === 'high' ? 4 : 2;
    const lampLights = [];
    for (let i = 0; i < NL; i++) { const L = new THREE.PointLight(0xffb066, 0, 22, 1.8); group.add(L); lampLights.push(L); }
    let nightF = 0, lampOn = 0, lampTimer = 0;
    function setNight(f) {
      nightF = f;
      lampOn = Math.max(0, Math.min(1, (f - 0.25) / 0.2));                   // dusk: on as the sun goes down; dawn: off
      bulbMat.color.setRGB(0.23 + lampOn * 0.77, 0.23 + lampOn * 0.62, 0.22 + lampOn * 0.28);
      haloMat.opacity = lampOn * 0.9; halos.visible = lampOn > 0.01;
      poolMat.opacity = lampOn * 0.95; pools.visible = lampOn > 0.01;
      for (const m of facadeMats) m.emissiveIntensity = f * 0.9;
    }
    // pools were laid at one fixed height, which sits under raised roads and hovers over dips: rest each on the highest ground it covers
    function relevelPools(gy) {
      const M = new THREE.Matrix4();
      for (let i = 0; i < poles.length; i++) { pools.getMatrixAt(i, M); const x = M.elements[12], z = M.elements[14]; let y = -9;
        for (const [a, b] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) y = Math.max(y, gy(x + a, z + b));
        M.elements[13] = y + 0.04; pools.setMatrixAt(i, M); }
      pools.instanceMatrix.needsUpdate = true;
    }
    const lampIdx = [];
    function updateLamps(car, dt) {
      if (!NL) return;
      if (lampOn <= 0.01 || !car) { lampLights.forEach(L => L.intensity = 0); return; }
      lampTimer -= dt || 0;
      if (lampTimer <= 0) {                                                  // re-pick the nearest lamps a few times a second
        lampTimer = 0.4; lampIdx.length = 0;
        const best = [];
        for (let i = 0; i < lampPos.length; i++) {
          const dx = lampPos[i][0] - car.x, dz = lampPos[i][1] - car.z; if (Math.abs(dx) > 70 || Math.abs(dz) > 70) continue;
          const d = dx * dx + dz * dz;
          if (best.length < NL || d < best[best.length - 1][0]) { best.push([d, i]); best.sort((a2, b2) => a2[0] - b2[0]); if (best.length > NL) best.pop(); }
        }
        best.forEach(b2 => lampIdx.push(b2[1]));
      }
      lampLights.forEach((L, k) => {
        const i = lampIdx[k];
        if (i === undefined) { L.intensity = 0; return; }
        L.position.set(lampPos[i][0], LAMP_Y - 0.4, lampPos[i][1]); L.intensity = 1.4 * lampOn;
      });
    }

    // hand-built geometry has mixed winding; render both faces
    group.traverse(o => { if (o.isMesh && o.material && !o.isInstancedMesh) o.material.side = THREE.DoubleSide; });

    // ---------------- spatial chunks for the big merged meshes (house walls, roofs, compound walls, roads ...)
    // Each one spans the whole map, so every pass drew all of it. Split its triangles by centroid into SPLIT_C cells;
    // a chunk shares the original's vertex buffers (own index + bounding sphere only), so camera and shadow-camera
    // frustum culling work. Sparse cells go into one 'rest' chunk to keep draw calls low. The chunks are children of
    // the original mesh, which stays in place (so .visible / material changes on it still apply) but is taken off
    // every render layer. Only chunks within SHADOW_NEAR m of the camera cast shadows (see updateChunks).
    const SPLIT_C = 120, SPLIT_MIN = 1500, SHADOW_NEAR = 80, HLOD_NEAR = 100, bigChunks = [];
    // far copy of a chunk: vertex clustering on the shared buffers (only a new index), small triangles dropped. Colours stay baked in the vertices.
    function clusterIndex(L, P, N) {
      const G = 1.4, rep = new Map(), out = [], id = [0, 0, 0];
      const cell = v => { const n = N ? (N[v * 3] > 0.5 ? 1 : N[v * 3] < -0.5 ? 2 : 0) + (N[v * 3 + 1] > 0.5 ? 3 : N[v * 3 + 1] < -0.5 ? 6 : 0) + (N[v * 3 + 2] > 0.5 ? 9 : N[v * 3 + 2] < -0.5 ? 18 : 0) : 0;
        const k = (Math.round(P[v * 3] / G) * 73856093 ^ Math.round(P[v * 3 + 1] / G) * 83492791 ^ Math.round(P[v * 3 + 2] / G) * 19349663) * 27 + n; let r = rep.get(k); if (r === undefined) rep.set(k, r = v); return r; };
      for (let i = 0; i < L.length; i += 3) {
        const a = cell(L[i]), b = cell(L[i + 1]), c = cell(L[i + 2]); if (a === b || b === c || a === c) continue;
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (nx * nx + ny * ny + nz * nz < 0.16) continue;   // < 0.2 m2
        out.push(a, b, c);
      }
      return out;
    }
    function splitMesh(mesh) {
      const g = mesh.geometry, pos = g.attributes.position, ix = g.index ? g.index.array : null;
      const nT = (ix ? ix.length : pos.count) / 3, P = pos.array, cells = new Map();
      for (let t = 0; t < nT; t++) {
        const a = ix ? ix[t * 3] : t * 3, b = ix ? ix[t * 3 + 1] : t * 3 + 1, c = ix ? ix[t * 3 + 2] : t * 3 + 2;
        const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        const k = Math.floor(x / SPLIT_C) * 4096 + Math.floor(z / SPLIT_C);
        let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(a, b, c);
      }
      const buckets = [], rest = [];
      for (const L of cells.values()) if (L.length / 3 >= SPLIT_MIN) buckets.push(L); else for (const v of L) rest.push(v);
      if (rest.length) buckets.push(rest);
      if (buckets.length < 2) return 0;
      const Arr = pos.count < 65536 ? Uint16Array : Uint32Array;
      for (const L of buckets) {
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
        for (const v of L) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        const cen = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); let R2 = 0;
        for (const v of L) { const dx = P[v * 3] - cen.x, dy = P[v * 3 + 1] - cen.y, dz = P[v * 3 + 2] - cen.z, d = dx * dx + dy * dy + dz * dz; if (d > R2) R2 = d; }
        const cg = new THREE.BufferGeometry();
        for (const n in g.attributes) cg.attributes[n] = g.attributes[n];
        cg.setIndex(new THREE.BufferAttribute(new Arr(L), 1)); cg.boundingSphere = new THREE.Sphere(cen, Math.sqrt(R2) + 0.01);
        const cm = new THREE.Mesh(cg, mesh.material);
        cm.castShadow = mesh.castShadow; cm.receiveShadow = mesh.receiveShadow; cm.renderOrder = mesh.renderOrder; cm.name = mesh.name;
        cm.userData.chunkOf = mesh; mesh.add(cm);
        let fm = null; const FL = clusterIndex(L, P, g.attributes.normal && g.attributes.normal.array);
        if (FL.length < L.length * 0.8) {
          const fg = new THREE.BufferGeometry(); for (const n in g.attributes) fg.attributes[n] = g.attributes[n];
          fg.setIndex(new THREE.BufferAttribute(new Arr(FL), 1)); fg.boundingSphere = cg.boundingSphere;
          fm = new THREE.Mesh(fg, mesh.material); fm.castShadow = false; fm.receiveShadow = false; fm.renderOrder = mesh.renderOrder; fm.name = mesh.name; fm.visible = false; mesh.add(fm);
        }
        bigChunks.push({ m: cm, f: fm, src: mesh, x: cen.x, z: cen.z, r: Math.hypot(x1 - x0, z1 - z0) / 2 });
      }
      mesh.layers.disableAll(); mesh.userData.chunked = buckets.length;
      return buckets.length;
    }
    {
      const todo = []; group.updateMatrixWorld(true);
      group.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.layers.mask || o.userData.chunkOf) return;
        const g = o.geometry; if (!g || !g.attributes.position || (g.groups && g.groups.length > 1)) return;
        if (!o.matrixWorld.equals(new THREE.Matrix4())) return;
        const nT = (g.index ? g.index.count : g.attributes.position.count) / 3; if (nT < 3000) return;
        if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere.radius < 300) return;
        todo.push(o);
      });
      let nc = 0; for (const o of todo) nc += splitMesh(o);
      // static InstancedMeshes still drawn as one unculled block (instances spread over the map, small base sphere):
      // split per cell too (mirror mode: the original keeps its matrices / count / .visible for other scripts)
      const ims = [];
      group.traverse(o => {
        if (!o.isInstancedMesh || !o.layers.mask || chunkIMs.has(o) || o.count < 5) return;
        if (o.instanceMatrix.usage === THREE.DynamicDrawUsage || o.count !== o.instanceMatrix.count) return;   // dynamic / pooled
        const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere.radius > 20) return;
        ims.push(o);
      });
      for (const o of ims) lodChunks(splitIM(o, { cell: 320, mirror: true }), 'mirror', o);
      console.log('[chunks] merged meshes', todo.length, '->', nc, 'chunks; instanced', ims.length, 'meshes split');
    }

    // billboards face camera
    const billboards = []; group.traverse(o => { if (o.userData.billboard) billboards.push(o); });
    // ---------------- undulating ground: a gentle height field (0 .. 0.5 m, never below the road plane), 2.5 m grid
    // Everything is drawn at y = 0, so the land rises and dips ABOVE that plane: road beds, building plots, walls, water
    // and declared clear zones stay at exactly 0 (the mask), fields and verges roll. A world-following terrain patch
    // draws it near the camera; beyond the patch the old flat plane takes over. Meshes standing on the land (crops,
    // bunds, trees, grass) ride it in the vertex shader from the same texture, so nothing floats. groundY adds undAt.
    const UC = 2.5, UW = Math.ceil(W / UC) + 1, UH = Math.ceil(H / UC) + 1, UND = new Uint8Array(UW * UH), UND_MAX = 0.5;
    {
      const mc = document.createElement('canvas'); mc.width = UW; mc.height = UH;
      const mg = mc.getContext('2d', { willReadFrequently: true }), mx = x => (x - xmin) / UC, mz = z => (z - zmin) / UC;
      mg.fillStyle = '#fff'; mg.fillRect(0, 0, UW, UH); mg.strokeStyle = mg.fillStyle = '#000'; mg.lineCap = mg.lineJoin = 'round';
      const stroke = (pts, w) => { mg.lineWidth = w / UC; mg.beginPath(); pts.forEach((q2, i) => i ? mg.lineTo(mx(q2[0]), mz(q2[1])) : mg.moveTo(mx(q2[0]), mz(q2[1]))); mg.stroke(); };
      for (const r of VR) stroke(r.p, r.w + 2);
      D.river.forEach(r => stroke(r, 28));
      for (const lk of D.lakes) { stroke(lk.concat([lk[0]]), 6); mg.beginPath(); lk.forEach((q2, i) => i ? mg.lineTo(mx(q2[0]), mz(q2[1])) : mg.moveTo(mx(q2[0]), mz(q2[1]))); mg.closePath(); mg.fill(); }
      for (const b of D.buildings) { stroke(b.p.concat([b.p[0]]), 4); mg.beginPath(); b.p.forEach((q2, i) => i ? mg.lineTo(mx(q2[0]), mz(q2[1])) : mg.moveTo(mx(q2[0]), mz(q2[1]))); mg.closePath(); mg.fill(); }
      for (const w of D.walls) stroke([[w[0], w[1]], [w[2], w[3]]], 3);
      const disc = (x, z, r) => { mg.beginPath(); mg.arc(mx(x), mz(z), r / UC, 0, 7); mg.fill(); };
      for (const e of CLEAR) disc(e.x, e.z, e.r + 1);
      for (const e of (typeof window !== 'undefined' && window.NELLUTLA_FLAT) || []) disc(e.x, e.z, e.r);   // plots other modules build on
      for (const l of D.landmarks) disc(l.x, l.z, 12);
      disc(LAND.x + LAND.a * LAND.ux + LAND.d * LAND.nx, LAND.z + LAND.a * LAND.uz + LAND.d * LAND.nz, 15);
      const px = mg.getImageData(0, 0, UW, UH).data;
      let A = new Float32Array(UW * UH), Bf = new Float32Array(UW * UH);
      for (let i = 0; i < A.length; i++) A[i] = px[i * 4] / 255;
      // three box blurs (radius 2 cells), then only the outer half of the ramp: 0 at the painted edge, 1 about 9 m out
      const rad = 2, nrm = 1 / (2 * rad + 1);
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j < UH; j++) { let sum = 0; const o = j * UW;
          for (let i = -rad; i <= rad; i++) sum += A[o + Math.max(0, Math.min(UW - 1, i))];
          for (let i = 0; i < UW; i++) { Bf[o + i] = sum * nrm; sum += A[o + Math.min(UW - 1, i + rad + 1)] - A[o + Math.max(0, i - rad)]; } }
        for (let i = 0; i < UW; i++) { let sum = 0;
          for (let j = -rad; j <= rad; j++) sum += Bf[Math.max(0, Math.min(UH - 1, j)) * UW + i];
          for (let j = 0; j < UH; j++) { A[j * UW + i] = sum * nrm; sum += Bf[Math.min(UH - 1, j + rad + 1) * UW + i] - Bf[Math.max(0, j - rad) * UW + i]; } }
      }
      for (let j = 0; j < UH; j++) for (let i = 0; i < UW; i++) {
        const k = j * UW + i; let m = (A[k] - 0.5) * 2; if (m <= 0) continue;
        m = m * m * (3 - 2 * m);
        const x = xmin + i * UC, z = zmin + j * UC;
        let n = 0.5 * Math.sin(x * 0.0413 + z * 0.0237 + 1.3) + 0.3 * Math.sin(-x * 0.0291 + z * 0.0702 + 4.1) + 0.2 * Math.sin(x * 0.1037 + z * 0.0619 + 2.2);
        n = 0.5 + 0.5 * n; n = n * n * (3 - 2 * n);
        UND[k] = Math.min(255, Math.round(255 * m * n));
      }
    }
    function undAt(x, z) {
      const u = (x - xmin) / UC, v = (z - zmin) / UC, i = Math.floor(u), j = Math.floor(v);
      if (i < 0 || j < 0 || i >= UW - 1 || j >= UH - 1) return 0;
      const fu = u - i, fv = v - j, k = j * UW + i;
      return (UND[k] * (1 - fu) * (1 - fv) + UND[k + 1] * fu * (1 - fv) + UND[k + UW] * (1 - fu) * fv + UND[k + UW + 1] * fu * fv) * UND_MAX / 255;
    }
    const UFADE0 = 118, UFADE1 = 158;      // land fades to the flat plane by this distance from the patch centre
    const undTex = new THREE.DataTexture(UND, UW, UH, THREE.LuminanceFormat, THREE.UnsignedByteType);
    undTex.minFilter = undTex.magFilter = THREE.LinearFilter; undTex.generateMipmaps = false; undTex.needsUpdate = true;
    const undU = { undTex: { value: undTex }, undCtr: { value: new THREE.Vector2(0, 0) }, undBox: { value: new THREE.Vector4(xmin, zmin, UC * UW, UC * UH) }, undAmp: { value: new THREE.Vector3(UND_MAX, UFADE0, UFADE1) } };
    // a mesh with this material rides the land: vertex y + height at its own world x,z
    const onLand = new WeakSet();
    function rideLand(mat) {
      if (!mat || onLand.has(mat) || mat.isShaderMaterial || mat.isLineBasicMaterial || mat.isPointsMaterial || mat.isSpriteMaterial) return;
      onLand.add(mat);
      const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
      mat.onBeforeCompile = function (sh, r) {
        if (prev) prev.call(this, sh, r);
        Object.assign(sh.uniforms, undU);
        sh.vertexShader = 'uniform sampler2D undTex; uniform vec2 undCtr; uniform vec4 undBox; uniform vec3 undAmp;\n' + sh.vertexShader.replace('#include <project_vertex>', `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          vec4 undW = modelMatrix * mvPosition;
          undW.y += texture2D(undTex, (undW.xz - undBox.xy + ${(UC / 2).toFixed(2)}) / undBox.zw).r * undAmp.x * (1.0 - smoothstep(undAmp.y, undAmp.z, distance(undW.xz, undCtr)));
          mvPosition = viewMatrix * undW;
          gl_Position = projectionMatrix * mvPosition;`);
      };
      mat.customProgramCacheKey = () => prevKey + '|land';
      mat.needsUpdate = true;
    }
    function sitOnLand(obj) { obj.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(rideLand); }); }
    onLand.add(gmat); ground.position.y = -0.01; sitOnLand(group);
    // the terrain patch: a grid on the height samples themselves (so it agrees with groundY), re-sampled in 10 m steps
    const UN = 130, UV_N = (UN + 1) * (UN + 1), upP = new Float32Array(UV_N * 3), upN = new Float32Array(UV_N * 3), upT = new Float32Array(UV_N * 2), upI = new Uint32Array(UN * UN * 6);
    for (let j = 0, q = 0; j < UN; j++) for (let i = 0; i < UN; i++) { const a = j * (UN + 1) + i, b = a + 1, c = a + UN + 1, d = c + 1; upI[q++] = a; upI[q++] = c; upI[q++] = b; upI[q++] = b; upI[q++] = c; upI[q++] = d; }
    const upG = new THREE.BufferGeometry();
    upG.setAttribute('position', new THREE.BufferAttribute(upP, 3)); upG.setAttribute('normal', new THREE.BufferAttribute(upN, 3)); upG.setAttribute('uv', new THREE.BufferAttribute(upT, 2)); upG.setIndex(new THREE.BufferAttribute(upI, 1));
    const undPatch = new THREE.Mesh(upG, gmat); undPatch.receiveShadow = true; undPatch.frustumCulled = false; group.add(undPatch);
    let upX = 1e9, upZ = 1e9;
    function updateLand(cp) {
      const ci = Math.round((cp.x - xmin) / UC / 4) * 4, cj = Math.round((cp.z - zmin) / UC / 4) * 4;
      if (ci === upX && cj === upZ) return;
      upX = ci; upZ = cj;
      const cx0 = xmin + ci * UC, cz0 = zmin + cj * UC; undU.undCtr.value.set(cx0, cz0);
      const hgt = (i, j) => { if (i < 0 || j < 0 || i >= UW || j >= UH) return 0; const x = i - ci, z = j - cj, d = Math.sqrt(x * x + z * z) * UC, t = Math.max(0, Math.min(1, (d - UFADE0) / (UFADE1 - UFADE0))); return UND[j * UW + i] * UND_MAX / 255 * (1 - t * t * (3 - 2 * t)); };
      let k = 0;
      for (let j = 0; j <= UN; j++) for (let i = 0; i <= UN; i++, k++) {
        const gi = ci + i - UN / 2, gj = cj + j - UN / 2, x = xmin + gi * UC, z = zmin + gj * UC;
        upP[k * 3] = x; upP[k * 3 + 1] = hgt(gi, gj); upP[k * 3 + 2] = z;
        const nx = (hgt(gi - 1, gj) - hgt(gi + 1, gj)) / (2 * UC), nz = (hgt(gi, gj - 1) - hgt(gi, gj + 1)) / (2 * UC), l = 1 / Math.sqrt(nx * nx + nz * nz + 1);
        upN[k * 3] = nx * l * 3 ; upN[k * 3 + 1] = l; upN[k * 3 + 2] = nz * l * 3;   // slopes are 1-2 %: lit a little stronger so the land reads
        upT[k * 2] = (x - xmin) / W; upT[k * 2 + 1] = 1 - (z - zmin) / H;
      }
      upG.attributes.position.needsUpdate = upG.attributes.normal.needsUpdate = upG.attributes.uv.needsUpdate = true;
    }

    function update(camera, dt, car) {
      updateLand(camera.position);
      if (dt) { updatePeople(dt, car, camera.position); updateLamps(car, dt); }
      updateTrees(camera.position);
      updateVillage(camera.position);
      updateFields(camera.position);
      updateChunks(camera.position);
      for (const b of billboards) {
        const p = b.parent.position; b.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      }
    }

    const junction = D.landmarks.find(l => l.k === 'busstop') || { x: 0, z: 0 };
    const hw = D.roads.filter(r => r.t === 'highway' && r.w >= 9).flatMap(r => r.p)
      .reduce((best, p) => { const d = Math.hypot(p[0]-junction.x, p[1]-junction.z); return d < best.d ? { d, p } : best; }, { d: 1e9, p: [0, 0] }).p;

    // the Shivalayam compound wall is solid (four colliders in the rotated plot, a 4.4 m entrance on the road side)
    for (const l of D.landmarks) if (l.Rx) {
      const c = Math.cos(l.face), s3 = Math.sin(l.face), W = (a, b2) => [l.x + a * c + b2 * s3, l.z - a * s3 + b2 * c];
      for (const [a0, b0, a1, b1] of [[-l.Rx, -l.Rz, l.Rx, -l.Rz], [l.Rx, -l.Rz, l.Rx, l.Rz], [-l.Rx, -l.Rz, -l.Rx, l.Rz], [-l.Rx, l.Rz, -2.2, l.Rz], [2.2, l.Rz, l.Rx, l.Rz]]) {
        const [mx, mz] = W((a0 + a1) / 2, (b0 + b1) / 2); addCollider(mx, mz, Math.abs(a1 - a0) / 2 + 0.15, Math.abs(b1 - b0) / 2 + 0.15, l.face);
      }
      { const [mx, mz] = W(0, -2); addCollider(mx, mz, 3.6, 4.6, l.face); }      // sanctum + mandapa
    }
    console.log('[chunks]', chunkList.length, 'instanced chunks,', treeChunks.length, 'tree cells');
    return { group, addHeroTree, bounds: D.bounds, collide, surfaceAt, drawMap, update, landmarks: D.landmarks, roads: D.roads, clutter: clutterApi,
      relevelPools, _lamps: () => ({ lampPos, lampLights, pools, n: poles.length }), spawn: { x: hw[0], z: hw[1] }, mapCanvas, addCollider, removeCollider, insideBuilding, nearestRoad, addMapIcon, undAt, sitOnLand, landRaw, land2: LAND2, buildings: D.buildings, mapScale: MS, setNight, people, props: placed, poles, setDetail, fields: FI, fieldAt, fieldGroup, bundAt, humpAt, landAt, land: LAND, land3: LAND3, land4: LAND4, land5: LAND5, land6: LAND6, yardH: YARD_H, yardAt, mudRoad: [[20.4, -287.2], [18.8, -283], [18.2, -279.6], [15, -276.4], [13.4, -277.4], [13, -280.2]], land4At: (x, z) => plateau(LAND4, x, z), drainRuns: DRUNS, drainW: DIP.w, dipAt };
  }

  window.NellutlaWorld = { build };
})();
