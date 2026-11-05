// sculpt-people.js: the two hero characters (the on-foot player and the grandma) as one hand-authored skinned mesh each.
//
// No metaballs or fields: every part is an authored surface with planned edge flow. Limbs, torso and clothes are lofts
// through bone-local sections (superellipses with separate front and back depth), the head is an explicit grid whose
// face is a height field of deliberate planes (brow shelf, nose ridge, cheekbones, hollow cheeks, jaw corner, chin),
// hair is its own volume from a hairline, and clothes are separate shells that hang: shirt with a turned hem, open
// sleeves and collar leaves, a straight lungi, a blue saree with geometric knife pleats and a pallu ribbon. Proportions
// are a lean rural build, about 7.5 heads tall. Vertices are skinned to the HumanModel joints, so the same walk, idle,
// sit, jaw and lip code poses it; below the waist cloth follows thigh then shin on each side.
//
// API: SculptPeople.create('player'|'grandma', extraAppearance) -> HumanModel result.
//      HumanModel.create(appearance) calls SculptPeople.attach when appearance.sculpt is set. The old part meshes stay
//      in the group with invisible materials so lod.js can still bake its mid-distance snapshot from them.
(function () {
  const BONES = ['hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'skirt', 'jaw'];
  const BI = {}; BONES.forEach((b, i) => { BI[b] = i; });
  const SKIN = 0, HAIR = 1, TOP = 2, BOT = 3, ACC = 4;
  // value noise
  function hash(i, j, k) { let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function noise(x, y, z) {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(hash(i, j, k), hash(i + 1, j, k), u), l(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
      l(l(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v), w) * 2 - 1;
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------ textures
  // Detail lives here, not in the mesh. Every surface gets a height field (float array, row 0 = top of the image) that
  // is turned into a tangent-space normal map; three.js derives the tangent frame from screen derivatives of the UVs, so
  // no tangent attribute is needed and skinning / morphs just work. Valleys of the same height field darken the colour
  // map (AO between pleats and folds). Large-scale AO, tan and contact shadow are baked per vertex in build().
  // Built once per kind and shared by every instance of that kind (texCache).
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function hex(c) { return '#' + new THREE.Color(c).getHexString(); }
  function speckle(x, w, h, n, alpha, light, dark, size) {
    for (let i = 0; i < n; i++) { x.fillStyle = Math.random() < 0.5 ? light : dark; x.globalAlpha = alpha * Math.random(); const s = size * (0.5 + Math.random()); x.fillRect(Math.random() * w, Math.random() * h, s, s); }
    x.globalAlpha = 1;
  }
  function blotch(x, x0, w, h, n, col, alpha, r) {
    for (let i = 0; i < n; i++) { const px = x0 + Math.random() * w, py = Math.random() * h, rr = r * (0.5 + Math.random());
      const g = x.createRadialGradient(px, py, 0, px, py, rr); g.addColorStop(0, col); g.addColorStop(1, col + '00'); x.globalAlpha = alpha; x.fillStyle = g; x.fillRect(px - rr, py - rr, rr * 2, rr * 2); }
    x.globalAlpha = 1;
  }
  function glow(x, cx, cy, rx, ry, rgb, a) {            // soft elliptical patch
    x.save(); x.translate(cx, cy); x.scale(1, ry / rx);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g; x.fillRect(-rx, -rx, rx * 2, rx * 2); x.restore();
  }
  function tileNoise(n) {                               // periodic fine grain, -1..1
    const a = new Float32Array(n * n), b = new Float32Array(n * n), m = n - 1;
    for (let i = 0; i < n * n; i++) a[i] = Math.random() * 2 - 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = (a[y * n + x] * 2 + a[y * n + ((x + 1) & m)] + a[((y + 1) & m) * n + x] + a[((y + m) & m) * n + x] + a[y * n + ((x + m) & m)]) / 3;
    return b;
  }
  // evaluate f(u, v) on a coarse grid (v up), then bilinear upsample to W x H; f is smooth so this saves ~95 % of the calls
  function grid(gw, gh, W, H, f) {
    const G = new Float32Array((gw + 1) * (gh + 1));
    for (let j = 0; j <= gh; j++) { const v = 1 - j / gh; for (let i = 0; i <= gw; i++) G[j * (gw + 1) + i] = f(i / gw, v); }
    const O = new Float32Array(W * H), sx = gw / W, sy = gh / H;
    for (let y = 0; y < H; y++) {
      const gy = y * sy, j = gy | 0, fy = gy - j, r0 = j * (gw + 1), r1 = r0 + gw + 1, o = y * W;
      for (let x = 0; x < W; x++) { const gx = x * sx, i = gx | 0, fx = gx - i, a = G[r0 + i] + (G[r0 + i + 1] - G[r0 + i]) * fx, b = G[r1 + i] + (G[r1 + i + 1] - G[r1 + i]) * fx; O[o + x] = a + (b - a) * fy; }
    }
    return O;
  }
  function addFine(Hf, W, H, amp, weave, N) {           // returns a copy with grain and a 2 px over-under weave on top
    const O = new Float32Array(Hf.length), m = N ? 127 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; O[i] = Hf[i] + (N ? N[(y & m) * 128 + (x & m)] * amp : 0) + (((x >> 1) + (y >> 1)) & 1 ? weave : -weave); }
    return O;
  }
  function normalTex(Hf, W, H, s, wrap) {               // rows are flipped: image row 0 is v = 1
    const D = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const up = (wrap ? (y + H - 1) % H : Math.max(0, y - 1)) * W, dn = (wrap ? (y + 1) % H : Math.min(H - 1, y + 1)) * W, row = y * W, o = (H - 1 - y) * W * 4;
      for (let x = 0; x < W; x++) {
        const l = x ? x - 1 : wrap ? W - 1 : 0, r = x < W - 1 ? x + 1 : wrap ? 0 : x;
        const nx = (Hf[row + l] - Hf[row + r]) * s, ny = (Hf[dn + x] - Hf[up + x]) * s, il = 127.5 / Math.sqrt(nx * nx + ny * ny + 1), k = o + x * 4;
        D[k] = (nx * il + 127.5) | 0; D[k + 1] = (ny * il + 127.5) | 0; D[k + 2] = (il + 127.5) | 0; D[k + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(D, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; else t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true; return t;
  }
  function shadeBy(x, Hf, W, H, k, lo) {                // valleys darken, ridges lift a little (painted AO)
    const im = x.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0, n = W * H; i < n; i++) { let m = 1 + Hf[i] * k; if (m < lo) m = lo; else if (m > 1.1) m = 1.1; const o = i * 4; d[o] *= m; d[o + 1] *= m; d[o + 2] *= m; }
    x.putImageData(im, 0, 0);
  }
  function roughCanvas(w, h, r) { const c = canvas(w, h), x = c.getContext('2d'); x.fillStyle = rm(r, 0); x.fillRect(0, 0, w, h); return [c, x]; }
  const rm = (r, m) => 'rgb(0,' + Math.round(r * 255) + ',' + Math.round((m || 0) * 255) + ')';   // g = roughness, b = metalness (three.js channels)

  // skin atlas 1024 x 512: left half body skin, right half (512 x 512) the face, planar in head-local x,y
  function skinMaps(kind, skin) {
    const F = kind === 'grandma', W = 1024, Hh = 512, c = canvas(W, Hh), x = c.getContext('2d'), hc = canvas(W, Hh), h = hc.getContext('2d', { willReadFrequently: true });
    const base = new THREE.Color(skin), red = hex(base.clone().lerp(new THREE.Color(0xb8483f), 0.3)), olive = hex(base.clone().lerp(new THREE.Color(0x6d6a3a), 0.22)), dk = hex(base.clone().multiplyScalar(0.8)), lt = hex(base.clone().lerp(new THREE.Color(0xffe0c0), 0.2));
    x.fillStyle = hex(base); x.fillRect(0, 0, W, Hh); h.fillStyle = '#808080'; h.fillRect(0, 0, W, Hh);
    blotch(x, 0, W, Hh, 150, red, 0.14, 44); blotch(x, 0, W, Hh, 110, olive, 0.12, 36); blotch(x, 0, W, Hh, 110, dk, 0.12, 30);
    speckle(x, W, Hh, 9000, 0.16, lt, dk, 1.8);
    const fx = hx => W / 2 + (0.5 + hx / 0.2) * (W / 2), fy = hy => (1 - (0.5 + (hy - 0.11) / 0.2)) * Hh, sc = (W / 2) / 0.2;
    x.save(); x.beginPath(); x.rect(W / 2, 0, W / 2, Hh); x.clip(); h.save(); h.beginPath(); h.rect(W / 2, 0, W / 2, Hh); h.clip();
    // crease: dark line in colour, groove in the height map (same stroke, so light and paint agree)
    const crease = (path, w, depth, tone) => {
      x.strokeStyle = 'rgba(58,28,20,' + tone * 0.32 + ')'; x.lineWidth = w * 3; x.lineCap = 'round'; x.beginPath(); path(x); x.stroke(); x.strokeStyle = 'rgba(58,28,20,' + tone * 0.6 + ')'; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); path(x); x.stroke();
      h.lineCap = 'round'; for (const [k, a] of [[5, 0.1], [3, 0.16], [1.5, 0.3]]) { h.strokeStyle = 'rgba(0,0,0,' + a * depth + ')'; h.lineWidth = w * k; h.beginPath(); path(h); h.stroke(); }
    };
    const pad = (hx, hy, rx, ry, a) => glow(h, fx(hx), fy(hy), rx * sc, ry * sc, a > 0 ? '255,255,255' : '0,0,0', Math.abs(a));
    // undertones: warm centre of the face, cooler jaw, lighter forehead and nose bridge, tired eye sockets
    glow(x, fx(0), fy(0.17), 0.06 * sc, 0.03 * sc, '236,190,150', 0.22);
    glow(x, fx(0), fy(0.105), 0.012 * sc, 0.035 * sc, '240,196,158', 0.3);
    glow(x, fx(0), fy(0.082), 0.015 * sc, 0.012 * sc, '190,84,70', 0.22);
    for (const s of [1, -1]) {
      glow(x, fx(s * 0.046), fy(0.094), 0.03 * sc, 0.024 * sc, '205,104,84', F ? 0.14 : 0.16);        // blush
      glow(x, fx(s * 0.08), fy(0.108), 0.016 * sc, 0.03 * sc, '186,80,66', 0.22);                  // ears
      glow(x, fx(s * 0.032), fy(0.114), 0.024 * sc, 0.016 * sc, '46,24,20', F ? 0.34 : 0.24);      // socket AO, under-eye
      glow(x, fx(s * 0.019), fy(0.129), 0.012 * sc, 0.012 * sc, '40,22,18', 0.26);                 // inner corner by the nose
      glow(x, fx(s * 0.015), fy(0.079), 0.012 * sc, 0.011 * sc, '40,20,16', 0.2);                  // nose wings
      glow(x, fx(s * 0.063), fy(0.044), 0.026 * sc, 0.03 * sc, '70,62,40', 0.14);                  // cooler jaw
    }
    glow(x, fx(0), fy(0.04), 0.022 * sc, 0.006 * sc, '46,24,20', 0.3);                             // under the lower lip
    glow(x, fx(0), fy(0.016), 0.09 * sc, 0.018 * sc, '40,22,18', 0.34);                            // under the chin
    if (!F) {   // beard shadow, then individual stubble dots and a moustache
      for (const [a, b, r1, r2] of [[0, 0.04, 0.07, 0.034], [0, 0.066, 0.027, 0.01]]) glow(x, fx(a), fy(b), r1 * sc, r2 * sc, '44,46,52', 0.34);
      x.save(); x.beginPath(); x.ellipse(fx(0), fy(0.046), 0.07 * sc, 0.038 * sc, 0, 0, 7); x.ellipse(fx(0), fy(0.069), 0.026 * sc, 0.0075 * sc, 0, 0, 7); x.clip();
      for (let i = 0; i < 5000; i++) { x.fillStyle = 'rgba(25,18,14,' + (0.12 + Math.random() * 0.26) + ')'; x.fillRect(W / 2 + Math.random() * W / 2, Math.random() * Hh, 1.3, 1.3); }
      x.restore();
      for (let i = 0; i < 900; i++) { const t = Math.random() * 2 - 1, px = fx(t * 0.026), py = fy(0.0625 + Math.random() * 0.0085 + 0.003 * (1 - t * t)); x.strokeStyle = 'rgba(14,10,8,' + (0.2 + Math.random() * 0.34) + ')'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + t * 3, py + 3); x.stroke(); }
    }
    // facial creases and forms for the normal map
    pad(0, 0.17, 0.05, 0.022, 0.12);
    for (const s of [1, -1]) {
      pad(s * 0.046, 0.094, 0.022, 0.016, 0.3); pad(s * 0.032, 0.109, 0.016, 0.0045, F ? 0.3 : 0.14);       // cheek, eye bag
      crease(g => { g.moveTo(fx(s * 0.016), fy(0.084)); g.quadraticCurveTo(fx(s * 0.031), fy(0.068), fx(s * 0.028), fy(0.05)); }, F ? 2.2 : 1.4, F ? 0.75 : 0.32, F ? 0.3 : 0.12);   // nasolabial
      crease(g => { g.moveTo(fx(s * 0.018), fy(0.1135)); g.quadraticCurveTo(fx(s * 0.032), fy(0.106), fx(s * 0.05), fy(0.113)); }, 1.3, F ? 0.55 : 0.24, F ? 0.3 : 0.12);            // tear trough
      crease(g => { g.ellipse(fx(s * 0.032), fy(0.1255), 0.0155 * sc, 0.0078 * sc, 0, Math.PI * 1.1, Math.PI * 1.9); }, 1.2, 0.5, 0.24);                                           // lid fold
      crease(g => { g.moveTo(fx(s * 0.024), fy(0.058)); g.quadraticCurveTo(fx(s * 0.028), fy(0.054), fx(s * 0.0255), fy(0.05)); }, 1.3, 0.4, 0.16);                                // mouth corner
    }
    crease(g => { g.moveTo(fx(-0.024), fy(0.03)); g.quadraticCurveTo(fx(0), fy(0.022), fx(0.024), fy(0.03)); }, 1.4, 0.18, 0.05);
    for (const s of [1, -1]) { crease(g => { g.moveTo(fx(s * 0.0035), fy(0.0755)); g.lineTo(fx(s * 0.0028), fy(0.0645)); }, 1.2, 0.2, 0.05); }   // philtrum
    if (F) {
      for (let w = 0; w < 4; w++) for (const s of [1, -1]) crease(g => { const y0 = 0.15 + w * 0.0072, a = 0.006 + Math.random() * 0.006; g.moveTo(fx(s * a), fy(y0 + 0.002)); g.bezierCurveTo(fx(s * 0.018), fy(y0 + 0.0045), fx(s * 0.03), fy(y0 + 0.001), fx(s * (0.036 + Math.random() * 0.01)), fy(y0 - 0.004)); }, 1.3, 0.5, 0.12);
      for (const s of [1, -1]) {
        for (let w = 0; w < 3; w++) crease(g => { g.moveTo(fx(s * 0.05), fy(0.121 + (w - 1) * 0.002)); g.quadraticCurveTo(fx(s * 0.056), fy(0.121 + (w - 1) * 0.004), fx(s * 0.061), fy(0.12 + (w - 1) * 0.0065)); }, 1.1, 0.45, 0.14);     // crow's feet
        pad(s * 0.041, 0.041, 0.018, 0.016, 0.22);                                                    // jowl
        crease(g => { g.moveTo(fx(s * 0.024), fy(0.05)); g.quadraticCurveTo(fx(s * 0.027), fy(0.04), fx(s * 0.024), fy(0.03)); }, 1.5, 0.6, 0.26);        // marionette
        crease(g => { g.moveTo(fx(s * 0.0035), fy(0.142)); g.lineTo(fx(s * 0.005), fy(0.131)); }, 1.3, 0.5, 0.2);                                         // frown
      }
      for (let i = 0; i < 26; i++) { const t = Math.random() * 2 - 1; crease(g => { g.moveTo(fx(t * 0.02), fy(0.0655)); g.lineTo(fx(t * 0.021), fy(0.0695)); }, 0.7, 0.2, 0.07); }      // smoker's lines
      for (let i = 0; i < 40; i++) { const a = Math.random() * 7, r = Math.random() * 0.06; x.fillStyle = 'rgba(70,40,26,0.28)'; x.beginPath(); x.arc(fx(Math.cos(a) * r * 1.2), fy(0.1 + Math.sin(a) * r), 1 + Math.random() * 1.6, 0, 7); x.fill(); }   // age spots
    }
    // eyes: sclera with shaded corners, iris with fibres and limbal ring, pupil, catchlight, caruncle, lash line
    for (const s of [1, -1]) {
      const ex = fx(s * 0.032), ey = fy(0.1215), ew = 0.0135 * sc, eh = 0.0058 * sc, ir = eh * 1.08, iy = ey - eh * 0.08;
      x.save(); x.beginPath(); x.ellipse(ex, ey, ew, eh, 0, 0, 7); x.clip();
      x.fillStyle = F ? '#d8cbb4' : '#e6ddce'; x.fillRect(ex - ew, ey - eh, ew * 2, eh * 2);
      let g = x.createLinearGradient(ex - ew, 0, ex + ew, 0); g.addColorStop(0, 'rgba(120,70,60,0.42)'); g.addColorStop(0.32, 'rgba(120,70,60,0)'); g.addColorStop(0.68, 'rgba(120,70,60,0)'); g.addColorStop(1, 'rgba(120,70,60,0.42)'); x.fillStyle = g; x.fillRect(ex - ew, ey - eh, ew * 2, eh * 2);
      x.fillStyle = 'rgba(190,80,70,0.7)'; x.beginPath(); x.ellipse(ex - s * ew * 0.92, ey + eh * 0.1, ew * 0.15, eh * 0.42, 0, 0, 7); x.fill();
      g = x.createRadialGradient(ex, iy, ir * 0.3, ex, iy, ir); g.addColorStop(0, F ? '#5a4128' : '#4c2f16'); g.addColorStop(0.72, F ? '#3e2c1e' : '#2e1b0c'); g.addColorStop(0.9, '#150c07'); g.addColorStop(1, F ? 'rgba(120,120,125,0.75)' : '#0c0705');
      x.fillStyle = g; x.beginPath(); x.arc(ex, iy, ir, 0, 7); x.fill();
      x.strokeStyle = 'rgba(150,104,60,0.3)'; x.lineWidth = 0.7; for (let a = 0; a < 6.28; a += 0.3) { x.beginPath(); x.moveTo(ex + Math.cos(a) * ir * 0.45, iy + Math.sin(a) * ir * 0.45); x.lineTo(ex + Math.cos(a) * ir * 0.85, iy + Math.sin(a) * ir * 0.85); x.stroke(); }
      x.fillStyle = '#050403'; x.beginPath(); x.arc(ex, iy, ir * 0.42, 0, 7); x.fill();
      g = x.createLinearGradient(0, ey - eh, 0, ey - eh * 0.1); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(ex - ew, ey - eh, ew * 2, eh);   // lid shadow on the eyeball
      x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.ellipse(ex + eh * 0.34, iy - ir * 0.36, ir * 0.2, ir * 0.15, 0, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.3)'; x.beginPath(); x.arc(ex - eh * 0.3, iy + ir * 0.42, ir * 0.09, 0, 7); x.fill();
      x.restore();
      x.strokeStyle = '#120a07'; x.lineWidth = 2.6; x.beginPath(); x.ellipse(ex, ey + eh * 0.08, ew * 1.03, eh * 1.12, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      x.strokeStyle = 'rgba(90,56,44,0.55)'; x.lineWidth = 1.1; x.beginPath(); x.ellipse(ex, ey - eh * 0.1, ew * 0.98, eh * 1.02, 0, Math.PI * 0.08, Math.PI * 0.92); x.stroke();
      // brow, hair by hair
      for (let n = 0; n < 2; n++) for (let b = 0; b < (F ? 46 : 80); b++) {
        const t = Math.random(), bx = ex + s * (-0.72 + t * 1.55) * ew * 1.15, by = fy(0.137) - Math.sin(t * Math.PI * 0.85) * 0.0038 * sc + (Math.random() - 0.5) * (1 - t) * 3.6;
        x.strokeStyle = F ? 'rgba(112,106,98,' + (0.4 + Math.random() * 0.4) + ')' : 'rgba(16,11,9,' + (0.5 + Math.random() * 0.45) + ')'; x.lineWidth = F ? 1 : 1.8; x.beginPath(); x.moveTo(bx, by + 2.6); x.lineTo(bx + s * (2.4 + t * 3), by - 1.6 + t * 2.4); x.stroke();
      }
    }
    for (const s of [1, -1]) { glow(x, fx(s * 0.0072), fy(0.0768), 0.005 * sc, 0.0028 * sc, '22,8,6', 0.92); pad(s * 0.0072, 0.0768, 0.0042, 0.0024, -0.5); }
    // lips: filled with feathered edges so the paint sits on the sculpted lip instead of ending in a step
    const lip = base.clone().lerp(new THREE.Color(F ? 0x7c3e3a : 0x7a3c38), F ? 0.55 : 0.6), lipUp = hex(lip.clone().multiplyScalar(0.86)), lipLo = hex(lip.clone().lerp(new THREE.Color(0xc07468), 0.14));
    const upper = g => { g.moveTo(fx(-0.0235), fy(0.0532)); g.bezierCurveTo(fx(-0.015), fy(0.0605), fx(-0.0065), fy(0.0655), fx(0), fy(0.0622)); g.bezierCurveTo(fx(0.0065), fy(0.0655), fx(0.015), fy(0.0605), fx(0.0235), fy(0.0532)); g.quadraticCurveTo(fx(0), fy(0.0505), fx(-0.0235), fy(0.0532)); };
    const lower = g => { g.moveTo(fx(-0.0225), fy(0.0532)); g.quadraticCurveTo(fx(0), fy(0.0505), fx(0.0225), fy(0.0532)); g.bezierCurveTo(fx(0.013), fy(0.0425), fx(-0.013), fy(0.0425), fx(-0.0225), fy(0.0532)); };
    for (const [shape, col] of [[upper, lipUp], [lower, lipLo]]) {
      x.lineJoin = 'round'; for (const [w, a] of [[9, 0.09], [6, 0.13], [3, 0.2]]) { x.strokeStyle = col; x.globalAlpha = a; x.lineWidth = w; x.beginPath(); shape(x); x.stroke(); }
      x.globalAlpha = 0.86; x.fillStyle = col; x.beginPath(); shape(x); x.fill(); x.globalAlpha = 1;
    }
    glow(x, fx(0), fy(0.0475), 0.011 * sc, 0.0024 * sc, '255,214,200', 0.16);
    for (const s of [1, -1]) glow(x, fx(s * 0.0235), fy(0.0532), 0.0035 * sc, 0.0026 * sc, '30,12,10', 0.5);
    crease(g => { g.moveTo(fx(-0.023), fy(0.0534)); g.bezierCurveTo(fx(-0.01), fy(0.0512), fx(-0.003), fy(0.0528), fx(0), fy(0.0522)); g.bezierCurveTo(fx(0.003), fy(0.0528), fx(0.01), fy(0.0512), fx(0.023), fy(0.0534)); }, 1.5, 0.75, 0.7);
    for (let i = 0; i < 34; i++) { const t = Math.random() * 2 - 1, up = i % 2; h.strokeStyle = 'rgba(0,0,0,0.13)'; h.lineWidth = 1; h.beginPath(); h.moveTo(fx(t * 0.019), fy(up ? 0.054 : 0.0515)); h.lineTo(fx(t * 0.02), fy(up ? 0.06 : 0.045)); h.stroke(); }
    if (F) { x.fillStyle = '#a80e1a'; x.beginPath(); x.arc(fx(0), fy(0.148), 0.0042 * sc, 0, 7); x.fill(); x.fillStyle = 'rgba(255,240,230,0.4)'; x.beginPath(); x.arc(fx(0.001), fy(0.1495), 0.0011 * sc, 0, 7); x.fill(); }
    x.restore(); h.restore();
    // height: blur the 8-bit strokes so gradients are smooth, then add pores (fine on the face, coarser mottling on the body)
    const px = h.getImageData(0, 0, W, Hh).data, Hf = new Float32Array(W * Hh), B = new Float32Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) Hf[i] = px[i * 4] / 255 - 0.5;
    for (let y = 1; y < Hh - 1; y++) for (let k = 1; k < W - 1; k++) { const i = y * W + k; B[i] = (Hf[i] * 2 + Hf[i - 1] + Hf[i + 1] + Hf[i - W] + Hf[i + W]) / 6; }
    const N = tileNoise(128);
    for (let y = 0; y < Hh; y++) { const fade = Math.min(1, (Hh - 1 - y) / 12); for (let k = 0; k < W; k++) { const i = y * W + k; B[i] += N[(y & 127) * 128 + (k & 127)] * (k >= W / 2 ? 0.0048 : 0.0016) * fade; } }
    // roughness: oily T-zone, drier cheeks, wet lips and eyes
    const [rc, r] = roughCanvas(512, 256, F ? 0.7 : 0.62), rx = v => 256 + (0.5 + v / 0.2) * 256, ry = v => (1 - (0.5 + (v - 0.11) / 0.2)) * 256, rs = 256 / 0.2, gl = (a, b, c1, c2, v) => { const g = r; const p = g.createRadialGradient(0, 0, 0, 0, 0, 1); p.addColorStop(0, v); p.addColorStop(1, v.replace('rgb', 'rgba').replace(')', ',0)')); g.save(); g.translate(rx(a), ry(b)); g.scale(c1 * rs, c2 * rs); g.fillStyle = p; g.fillRect(-1, -1, 2, 2); g.restore(); };
    gl(0, 0.165, 0.05, 0.03, rm(F ? 0.56 : 0.47)); gl(0, 0.1, 0.012, 0.04, rm(0.42)); gl(0, 0.056, 0.024, 0.01, rm(0.32));
    for (const s of [1, -1]) gl(s * 0.032, 0.1215, 0.0105, 0.005, rm(0.2));
    return { map: texture(c, false), normalMap: normalTex(B, W, Hh, F ? 7 : 6, false), roughnessMap: texture(rc, false) };
  }
  // hair: repeating 256 tile of long strands, their brightness is the height
  function hairMaps(col) {
    const c = canvas(256, 256), x = c.getContext('2d', { willReadFrequently: true }), b = new THREE.Color(col);
    x.fillStyle = hex(b.clone().multiplyScalar(0.72)); x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1100; i++) {
      const cc = b.clone().multiplyScalar(0.5 + Math.random() * 1.15); x.strokeStyle = hex(cc); x.globalAlpha = 0.55; x.lineWidth = 0.6 + Math.random() * 1.3;
      const px = Math.random() * 256, py = Math.random() * 256, dx = Math.random() * 8 - 4;
      for (const ox of px < 12 ? [0, 256] : px > 244 ? [0, -256] : [0]) for (const oy of py > 166 ? [0, -256] : [0]) { x.beginPath(); x.moveTo(px + ox, py + oy); x.bezierCurveTo(px + ox + dx, py + oy + 30, px + ox - dx, py + oy + 60, px + ox + dx, py + oy + 90); x.stroke(); }
    }
    x.globalAlpha = 1;
    const d = x.getImageData(0, 0, 256, 256).data, Hf = new Float32Array(65536); let mx = 1e-3;
    for (let i = 0; i < 65536; i++) { Hf[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; if (Hf[i] > mx) mx = Hf[i]; }
    for (let i = 0; i < 65536; i++) Hf[i] /= mx;
    return { map: texture(c, true), normalMap: normalTex(Hf, 256, 256, 2.4, true) };
  }
  function weaveCanvas(x, w, h, col, a) {
    x.fillStyle = hex(col); x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 2) { x.fillStyle = 'rgba(0,0,0,' + (a * Math.random()) + ')'; x.fillRect(0, yy, w, 1); }
    for (let xx = 0; xx < w; xx += 2) { x.fillStyle = 'rgba(255,255,255,' + (a * 0.8 * Math.random()) + ')'; x.fillRect(xx, 0, 1, h); }
  }
  const nz = (u, a, b, c) => noise(Math.cos(u * 6.2832) * a + 3, Math.sin(u * 6.2832) * a + 7, b + c);   // periodic in u
  // top atlas 1024 x 512: torso u = angle round the body, v up to 0.8 ((y - 0.72) m); sleeves in the band above it,
  // left half / right half, u = angle round the arm.
  function topMaps(kind, col) {
    const F = kind === 'grandma', W = 1024, Hh = 512, c = canvas(W, Hh), x = c.getContext('2d', { willReadFrequently: true });
    weaveCanvas(x, W, Hh, new THREE.Color(col), F ? 0.09 : 0.07);
    const Y = v => (1 - v) * Hh, U = u => u * W, vy = y => y - 0.72;
    const f = (u, v) => {
      if (v > 0.81) { const t = (v - 0.84) / 0.14, a = (u * 2) % 1;      // sleeves: wrinkles radiate from the armpit, soft ring near the hem
        return 0.34 * Math.sin(t * 16 + 2.4 * nz(a, 1.2, t * 2, 3)) * sstep(0.45, 0.95, t) * (0.4 + 0.6 * Math.cos((a - 0.5) * 6.28) ** 2) + 0.14 * Math.sin(a * 37.7 + t * 5) * sstep(0.6, 0, t); }
      const y = v + 0.72, a = u - 0.5, sideC = Math.cos(a * 12.566) ** 2;
      let h = 0.18 * Math.sin(u * 56.5 + 3 * nz(u, 2, v * 3, 0)) * sstep(1.32, 1.02, y);                      // vertical hang from the chest
      h += 0.42 * sideC * Math.sin(y * 62 + u * 20 + 2.2 * nz(u, 3, y * 4, 5)) * Math.exp(-(((y - (F ? 1.25 : 1.06)) / 0.09) ** 2));   // waist creases
      h += 0.3 * Math.sin(y * 44 - u * 44 + 2 * nz(u, 2, y * 3, 9)) * Math.exp(-(((y - 1.34) / 0.07) ** 2)) * Math.sin(u * 6.283 * 2) ** 2;  // pull from armpit to chest
      if (F) { h += 0.4 * Math.exp(-(((y - 1.3) / 0.05) ** 2) - ((Math.abs(a) - 0.04) / 0.012) ** 2); }        // bust darts
      else { h += 0.3 * sstep(0.012, 0.0105, Math.abs(a)) * (y > 0.8 ? 1 : 0); h -= 0.4 * Math.exp(-(((Math.abs(a) - 0.0115) / 0.001) ** 2)); h += 0.2 * sstep(0.033, 0.03, Math.abs(a - 0.062)) * sstep(1.325, 1.32, y) * sstep(1.22, 1.225, y); }
      return h;
    };
    const G = grid(512, 256, W, Hh, f);
    shadeBy(x, G, W, Hh, F ? 0.28 : 0.34, 0.6);
    if (!F) {
      for (let px = 0; px < W; px += 9) { x.fillStyle = px % 27 ? 'rgba(255,255,255,0.11)' : 'rgba(10,30,60,0.2)'; x.fillRect(px, 0, 1.4, Hh); }     // fine woven stripe: reads as cloth and shows the fit
      for (const y of [1.46, 1.36, 1.26, 1.16, 1.06, 0.96]) { const py = Y(vy(y)), a = U(0.5); x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.arc(a + 0.7, py + 0.7, 2.7, 0, 7); x.fill(); x.fillStyle = '#ece8de'; x.beginPath(); x.arc(a, py, 2.4, 0, 7); x.fill(); x.fillStyle = 'rgba(0,0,0,0.42)'; x.fillRect(a - 1.3, py - 0.4, 2.6, 0.8); }
      x.strokeStyle = 'rgba(0,0,0,0.26)'; x.setLineDash([3, 2]); x.lineWidth = 1; x.strokeRect(U(0.53), Y(vy(1.325)), U(0.064), Y(vy(1.222)) - Y(vy(1.325))); x.setLineDash([]);
      x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(0, Y(0.02), W, 3);
      for (const rg of [[0, U(0.27)], [U(0.73), W]]) { x.fillStyle = 'rgba(0,0,0,0.24)'; x.fillRect(rg[0], Y(vy(1.41)), rg[1] - rg[0], 2); }      // back yoke seam
      x.fillStyle = 'rgba(0,0,0,0.32)'; x.fillRect(0, Y(0.963), W, 2.5);                                                                   // armhole seam on the sleeve cap
      x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, Y(0.812), W, 2);                                                                     // sleeve hem stitch
    } else {
      x.fillStyle = 'rgba(30,8,10,0.35)'; x.fillRect(U(0.498), Y(0.8), 4, Hh);
      x.fillStyle = '#c9a044'; x.fillRect(0, Y(0.855), W, 4); x.fillStyle = '#7a1b26'; x.fillRect(0, Y(0.862), W, 4);    // sleeve hem trim
    }
    return { map: texture(c, true), normalMap: normalTex(addFine(G, W, Hh, 0.012, F ? 0.02 : 0.016, NOISE()), W, Hh, F ? 2.6 : 2.4, true) };
  }
  let _nz = null; const NOISE = () => _nz || (_nz = tileNoise(128));
  // lungi atlas 1024 x 1024: u = angle, v = (y - 0.25) / 0.85
  function lungiMaps() {
    const W = 1024, c = canvas(W, W), x = c.getContext('2d', { willReadFrequently: true }), tc = canvas(128, 128), t = tc.getContext('2d');
    weaveCanvas(t, 128, 128, new THREE.Color(0xe7b2b6), 0.08);
    t.globalAlpha = 0.55; t.fillStyle = '#7d7f88'; t.fillRect(0, 20, 128, 34); t.fillRect(20, 0, 34, 128);
    t.globalAlpha = 0.8; t.fillStyle = '#f6f1ee'; t.fillRect(0, 80, 128, 3); t.fillRect(80, 0, 3, 128);
    t.fillStyle = '#8c3a4c'; t.fillRect(0, 100, 128, 2); t.fillRect(100, 0, 2, 128); t.fillRect(0, 37, 128, 1.5); t.fillRect(37, 0, 1.5, 128); t.globalAlpha = 1;
    x.fillStyle = x.createPattern(tc, 'repeat'); x.save(); x.scale(W / 12 / 128, 120 / 128); x.fillRect(0, 0, 13 * 128, 10 * 128); x.restore();
    const lap = 0.585;     // the overlapping edge of the wrap
    const f = (u, v) => {
      const y = v * 0.85 + 0.25, low = sstep(0.75, 0.42, y), a = u - lap;
      let h = 0.55 * (0.3 + low) * Math.sin(u * 50.3 + 3 * nz(u, 2, y * 2.4, 0)) + 0.3 * low * Math.sin(u * 113 + 2 * nz(u, 3, y * 3, 4));
      h += 0.5 * Math.sin(u * 188 + 1.6 * nz(u, 4, y * 5, 2)) * sstep(0.9, 1.02, y);                                                   // gathered at the waist
      h += 0.42 * Math.sin(y * 30 + u * 40 + 2 * nz(u, 2, y * 3, 7)) * Math.exp(-(((y - 0.84) / 0.08) ** 2)) * Math.cos(u * 12.566) ** 2;   // hip creases
      h += a < 0 ? 0.7 * Math.exp(a / 0.03) : -0.5 * Math.exp(-a / 0.012);                                                             // wrap edge
      h -= 0.5 * sstep(0.36, 0.345, y) * sstep(0.33, 0.345, y);                                                                         // hem stitch
      return h;
    };
    const G = grid(512, 256, W, W, f); shadeBy(x, G, W, W, 0.34, 0.58);
    const [rc, r] = roughCanvas(64, 64, 0.88); void r;
    return { map: texture(c, true), normalMap: normalTex(addFine(G, W, W, 0.012, 0.018, NOISE()), W, W, 3, true), roughnessMap: texture(rc, true) };
  }
  // saree atlas 1024 x 1024: skirt in v 0..0.7 (u = angle, 0.7 per metre above the hem), pallu strip v 0.71..1 (edge..centre of the cloth)
  function sareeMaps() {
    const W = 1024, c = canvas(W, W), x = c.getContext('2d', { willReadFrequently: true });
    weaveCanvas(x, W, W, new THREE.Color(0x1f4c9c), 0.06);
    blotch(x, 0, W, W, 40, '#173a78', 0.1, 90);
    const Y = v => (1 - v) * W, M = 0.7;
    const border = (v0, dir, hgt) => {            // maroon-and-zari band with temple teeth, across the whole width
      const yy = t => Y(v0 + dir * t * hgt), H_ = Math.abs(yy(1) - yy(0));
      x.fillStyle = '#74161f'; x.fillRect(0, Math.min(yy(0), yy(1)), W, H_);
      for (const [t, b] of [[0.07, 0.05], [0.8, 0.06], [0.95, 0.03]]) { x.fillStyle = '#d3a23c'; x.fillRect(0, yy(t) - H_ * b / 2, W, H_ * b); }
      x.fillStyle = '#d3a23c'; for (let i = 0; i < 64; i++) { const px = i * 16 + 8, py = yy(0.45); x.beginPath(); x.moveTo(px, py - H_ * 0.18); x.quadraticCurveTo(px + 5, py, px, py + H_ * 0.18); x.quadraticCurveTo(px - 5, py, px, py - H_ * 0.18); x.fill(); }
      x.fillStyle = '#74161f'; for (let i = 0; i < 80; i++) { const px = i * 12.8; x.beginPath(); x.moveTo(px, yy(1)); x.lineTo(px + 6.4, yy(1.28)); x.lineTo(px + 12.8, yy(1)); x.fill(); }
    };
    border(0, 1, 0.075 * M); border(0.71, 1, 0.066);
    x.fillStyle = '#c9983c'; for (let i = 0; i < 620; i++) { const px = (i % 31) * 33 + (((i / 31) | 0) % 2) * 16, py = Y(0.13 + ((i / 31) | 0) * 0.029); x.globalAlpha = 0.55; x.beginPath(); x.arc(px, py, 1.5, 0, 7); x.fill(); } x.globalAlpha = 1;
    const f = (u, v) => {
      if (v > 0.705) { const w = (v - 0.71) / 0.29; return 0.5 * Math.sin(w * 26 + 1.8 * Math.sin(u * 12.566)) + 0.28 * Math.sin(w * 63 + u * 25.1) * sstep(0.15, 0.5, w); }
      const yy = v / M, a0 = u - 0.5 + 0.007 * nz(u, 2, yy * 4, 1), a = a0 * (1 + 0.4 * yy), wid = Math.abs(a);
      const low = sstep(0.95, 0.35, yy), mask = sstep(0.095, 0.075, wid);
      let s = (a * 48 + 1.1 * Math.sin(a * 61) + 100) % 1; const saw = s < 0.82 ? s / 0.82 : (1 - s) / 0.18;           // knife pleats fan down from the tuck
      let h = (saw * 2 - 1) * mask * (0.6 + 0.2 * low);
      h += (1 - mask) * (0.6 * (0.2 + low) * Math.sin(u * 44 + 3 * nz(u, 2, yy * 2, 0)) + 0.26 * low * Math.sin(u * 101 + 2 * nz(u, 3, yy * 3, 5)));
      h += (1 - mask) * 0.4 * Math.sin(yy * 26 + u * 37.7 + 2 * nz(u, 2, yy * 3, 7)) * Math.exp(-(((yy - 0.8) / 0.09) ** 2));   // pull over the hip
      h += 0.5 * Math.sin(u * 283) * sstep(0.9, 0.98, yy);                                      // tuck at the waist
      return h;
    };
    const G = grid(768, 256, W, W, f); shadeBy(x, G, W, W, 0.3, 0.55);
    const [rc, r] = roughCanvas(256, 256, 0.74), RY = v => (1 - v) * 256;     // silk: smoother body, zari border shiny and part metal
    r.fillStyle = rm(0.82); r.fillRect(0, 0, 256, RY(0.71)); r.fillStyle = rm(0.82); r.fillRect(0, RY(0.7), 256, 8);
    for (const [a, b] of [[0, 0.056], [0.71, 0.776]]) { r.fillStyle = rm(0.42, 0.18); r.fillRect(0, RY(b), 256, RY(a) - RY(b)); }
    for (const v of [0.004, 0.044, 0.051, 0.715, 0.763, 0.772]) { r.fillStyle = rm(0.28, 0.72); r.fillRect(0, RY(v) - 1, 256, 1.6); }
    return { map: texture(c, true), normalMap: normalTex(addFine(G, W, W, 0.01, 0.015, NOISE()), W, W, 3.2, true), roughnessMap: texture(rc, true) };
  }
  function texture(c, rep) {
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; if (rep) t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4; if (THREE.sRGBEncoding && window.renderer && renderer.outputEncoding === THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const texCache = {};
  function textures(kind) {
    if (texCache[kind]) return texCache[kind];
    const F = kind === 'grandma', t0 = performance.now();
    const set = { skin: skinMaps(kind, SkinBase[kind]), hair: hairMaps(F ? 0x86817a : 0x241d19), top: topMaps(kind, F ? 0x7a2632 : 0x24588f), bot: F ? sareeMaps() : lungiMaps() };
    STATS[kind + 'TexMs'] = Math.round(performance.now() - t0);
    return (texCache[kind] = set);
  }


  // ------------------------------------------------------------ mesh builder: authored grids (no fields, no metaballs)
  const STATS = {};
  const SkinBase = { player: 0x8d5a3b, grandma: 0x9a6a48 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const crom = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  function curve(tab, y) {                     // piecewise cubic through [y, value] pairs (y descending or ascending)
    const T = tab[0][0] < tab[tab.length - 1][0] ? tab : tab.slice().reverse();
    if (y <= T[0][0]) return T[0][1]; if (y >= T[T.length - 1][0]) return T[T.length - 1][1];
    let i = 0; while (y > T[i + 1][0]) i++;
    const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0]), g = k => T[Math.max(0, Math.min(T.length - 1, k))][1];
    return crom(g(i - 1), g(i), g(i + 1), g(i + 2), t);
  }

  function Mesher(frames) {
    const out = { pos: [], nor: [], uv: [], col: [], si: [], sw: [], h: [], idx: [[], [], [], [], []] };
    const tp = (bone, x, y, z) => { const e = frames[BI[bone]].m.elements; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };
    const local = (bone, p) => { const e = frames[BI[bone]].inv, [x, y, z] = p; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };
    // nu x nv vertex grid; F(i, j) -> { p, w: {bone: weight}, uv, c: [r,g,b] }. wrap closes it round in i.
    function grid(mat, nu, nv, F, o) {
      o = o || {};
      const cols = o.wrap ? nu + 1 : nu, V = [];
      for (let j = 0; j < nv; j++) for (let i = 0; i < cols; i++) V.push(F(i, j));
      const P = (i, j) => { const ii = o.wrap ? ((i % nu) + nu) % nu : Math.max(0, Math.min(nu - 1, i)), jj = Math.max(0, Math.min(nv - 1, j)); return V[jj * cols + ii].p; };
      const N = []; let cx = 0, cy = 0, cz = 0, flipS = 0;
      for (const v of V) { cx += v.p[0]; cy += v.p[1]; cz += v.p[2]; } cx /= V.length; cy /= V.length; cz /= V.length;
      for (let j = 0; j < nv; j++) for (let i = 0; i < cols; i++) {
        const a = P(i + 1, j), b = P(i - 1, j), c = P(i, j + 1), d = P(i, j - 1);
        const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        N.push([nx, ny, nz]); const p = P(i, j); flipS += nx * (p[0] - cx) + ny * (p[1] - cy) + nz * (p[2] - cz);
      }
      const flip = flipS < 0, base = out.pos.length / 3;
      V.forEach((v, k) => {
        const n = N[k]; out.pos.push(v.p[0], v.p[1], v.p[2]); const sg = flip ? -1 : 1; out.nor.push(n[0] * sg, n[1] * sg, n[2] * sg);
        out.uv.push(v.uv ? v.uv[0] : 0.5, v.uv ? v.uv[1] : 0.5);
        const c = v.c || [1, 1, 1]; out.col.push(c[0], c[1], c[2]); out.h.push(o.head ? 1 : 0);
        const W = Object.entries(v.w).sort((a, b) => b[1] - a[1]).slice(0, 4), S = W.reduce((s, e) => s + e[1], 0);
        for (let q = 0; q < 4; q++) { out.si.push(W[q] ? BI[W[q][0]] : 0); out.sw.push(W[q] ? W[q][1] / S : 0); }
      });
      const I = out.idx[mat];
      for (let j = 0; j < nv - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (flip) I.push(a, c, b, b, c, d); else I.push(a, b, c, b, d, c);
      }
    }
    // ring: bone-local section. x half-width, f front (+z), b back (-z), p squareness (2 ellipse, 3+ boxy).
    const R = (bone, y, w, f, b, p, o) => {
      o = o || {}; const cx = o.cx || 0, cz = o.cz || 0, c = tp(bone, cx, y, cz), a = tp(bone, cx + 1, y, cz), d = tp(bone, cx, y, cz + 1);
      return { c, ux: a.map((v, i) => v - c[i]), uz: d.map((v, i) => v - c[i]), w, f, b, p: p || 2, wt: o.wt || { [bone]: 1 }, ao: o.ao === undefined ? 1 : o.ao, y };
    };
    // ring on an arbitrary axis system (used by feet, which run along z)
    const RZ = (bone, z, w, up, dn, p, o) => {
      o = o || {}; const y0 = o.y0, c = tp(bone, o.cx || 0, y0, z), a = tp(bone, (o.cx || 0) + 1, y0, z), d = tp(bone, o.cx || 0, y0 + 1, z);
      return { c, ux: a.map((v, i) => v - c[i]), uz: d.map((v, i) => v - c[i]), w, f: up, b: dn, p: p || 2, wt: { [bone]: 1 }, ao: o.ao === undefined ? 1 : o.ao, y: z };
    };
    function loft(mat, rings, sides, o) {
      o = o || {}; const sub = o.sub || 2, nr = rings.length, rows = [];
      const g = k => rings[Math.max(0, Math.min(nr - 1, k))];
      for (let k = 0; k < nr - 1; k++) for (let s = 0; s < (k === nr - 2 ? sub + 1 : sub); s++) {
        const t = s / sub, q = (fn) => crom(fn(g(k - 1)), fn(g(k)), fn(g(k + 1)), fn(g(k + 2)), t), L = fn => lerp(fn(g(k)), fn(g(k + 1)), t);
        const wt = {}; for (const b in g(k).wt) wt[b] = g(k).wt[b] * (1 - t); for (const b in g(k + 1).wt) wt[b] = (wt[b] || 0) + g(k + 1).wt[b] * t;
        rows.push({ c: [0, 1, 2].map(i => q(r => r.c[i])), ux: [0, 1, 2].map(i => L(r => r.ux[i])), uz: [0, 1, 2].map(i => L(r => r.uz[i])), w: Math.max(1e-4, q(r => r.w)), f: Math.max(1e-4, q(r => r.f)), b: Math.max(1e-4, q(r => r.b)), p: L(r => r.p), wt, ao: L(r => r.ao), v: (k + t) / (nr - 1) });
      }
      grid(mat, sides, rows.length, (i, j) => {
        const r = rows[j], th = (i % sides) / sides * Math.PI * 2, s = Math.sin(th), c = Math.cos(th), e = 2 / r.p;
        let x = r.w * spow(s, e), z = (c > 0 ? r.f : r.b) * spow(c, e), y = 0;
        if (o.mod) { const m = o.mod(th, r.v, x, z, j / (rows.length - 1)); x += m[0]; z += m[1]; if (m[2]) y = m[2]; }
        const p = [0, 1, 2].map(k => r.c[k] + r.ux[k] * x + r.uz[k] * z + (k === 1 ? y : 0));
        return { p, w: o.wf ? o.wf(p, th, r) : r.wt, uv: o.uv ? o.uv(p, th, r, i / sides, j) : bodyUV(p), c: o.col ? o.col(p, r) : [r.ao, r.ao, r.ao] };
      }, { wrap: true });
    }
    // round tube through bone-local points [x, y, z, r]
    function tube(mat, bone, pts, sides, o) {
      o = o || {}; const W = pts.map(q => tp(bone, q[0], q[1], q[2])), sc = frames[BI[bone]].sc, n = pts.length;
      grid(mat, sides, n + 2, (i, j) => {
        const jj = Math.max(0, Math.min(n - 1, j - 1)), a = W[Math.max(0, jj - 1)], b = W[Math.min(n - 1, jj + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const rf = Math.abs(ty) > 0.8 ? [1, 0, 0] : [0, 1, 0]; let ux = ty * rf[2] - tz * rf[1], uy = tz * rf[0] - tx * rf[2], uz = tx * rf[1] - ty * rf[0]; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
        const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux, th = (i % sides) / sides * 6.2832, r = (j === 0 || j === n + 1 ? 0.0001 : pts[jj][3]) * sc, c = Math.cos(th) * r, s = Math.sin(th) * r, w = W[jj];
        const p = [w[0] + ux * c + vx * s, w[1] + uy * c + vy * s, w[2] + uz * c + vz * s];
        return { p, w: o.wt || { [bone]: 1 }, uv: mat === SKIN ? bodyUV(p) : [0.5, 0.5], c: o.col || [1, 1, 1] };
      }, { wrap: true });
    }
    const bodyUV = p => [0.04 + 0.42 * Math.min(1, Math.max(0, 0.5 + p[0] * 1.1 + p[2] * 0.3)), 0.04 + 0.9 * Math.min(1, Math.max(0, p[1] / 1.8))];
    return { out, grid, R, RZ, loft, tube, tp, local, bodyUV };
  }

  // ---- head: an explicit surface. y rows top to chin, x/z from width, front and back profiles; the face is a height
  // field added to z, planes on purpose (brow shelf, nose ridge, cheekbone, hollow cheek, jaw corner, chin).
  function headSurf(F) {
    const W = F ? [[0.222, 0.004], [0.214, 0.03], [0.2, 0.052], [0.175, 0.066], [0.145, 0.0705], [0.118, 0.0695], [0.098, 0.067], [0.075, 0.059], [0.055, 0.0515], [0.038, 0.0415], [0.024, 0.03], [0.012, 0.014], [0.006, 0.003]]
      : [[0.222, 0.004], [0.214, 0.032], [0.2, 0.055], [0.175, 0.069], [0.145, 0.0735], [0.118, 0.073], [0.098, 0.0715], [0.075, 0.0655], [0.055, 0.0595], [0.038, 0.049], [0.024, 0.034], [0.012, 0.016], [0.006, 0.003]];
    const Fz = [[0.222, 0.004], [0.214, 0.035], [0.2, 0.062], [0.175, 0.082], [0.15, 0.09], [0.14, 0.093], [0.125, 0.087], [0.1, 0.087], [0.07, 0.09], [0.055, 0.091], [0.045, 0.086], [0.03, 0.088], [0.02, 0.08], [0.012, 0.058], [0.006, 0.02]];
    const Bz = [[0.222, 0.004], [0.214, 0.042], [0.2, 0.074], [0.175, 0.096], [0.145, 0.104], [0.115, 0.1], [0.09, 0.086], [0.065, 0.066], [0.04, 0.05], [0.02, 0.036], [0.006, 0.012]];
    const face = (x, y) => {              // z offset of the front of the face
      const ax = Math.abs(x), G = (cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)), GA = (cx, cy, rx, ry) => Math.exp(-(((ax - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
      let d = 0;
      d += 0.0035 * Math.exp(-(((y - 0.1415) / 0.0065) ** 2)) * sstep(0.062, 0.03, ax) ;                 // brow shelf
      d -= 0.0085 * GA(0.033, 0.1215, 0.021, 0.0105);                                                    // orbit
      d += 0.0045 * GA(0.032, 0.1215, 0.0125, 0.0065);                                                   // eyeball under the lid
      d -= 0.003 * Math.exp(-(((ax - 0.0095) / 0.0055) ** 2) - ((y - 0.128) / 0.008) ** 2);              // nasion hollows
      const ny = sstep(0.14, 0.09, y), nw = lerp(0.0062, 0.0115, ny);
      const nh = curve([[0.14, 0], [0.128, 0.005], [0.11, 0.0125], [0.095, 0.0205], [0.086, 0.0255], [0.079, 0.021], [0.073, 0.004], [0.068, 0]], y);
      d += nh * Math.exp(-((x / nw) ** 2));                                                             // nose ridge and tip
      d += 0.0105 * GA(0.0125, 0.0815, 0.0058, 0.0062);                                                  // alae
      d += 0.0058 * GA(0.05, 0.102, 0.018, 0.0095);                                                      // cheekbone
      d -= (F ? 0.0115 : 0.0085) * GA(0.054, 0.066, 0.015, 0.016);                                       // hollow under it
      d -= 0.0018 * Math.exp(-((x / 0.0035) ** 2)) * sstep(0.075, 0.068, y) * sstep(0.06, 0.064, y);     // philtrum
      d += 0.0036 * G(0, 0.0585, 0.0215, 0.0044);                                                        // upper lip
      d += 0.0046 * G(0, 0.0468, 0.0185, 0.0048);                                                        // lower lip
      d -= 0.0028 * G(0, 0.0529, 0.024, 0.0013);                                                         // mouth line
      d += 0.0042 * G(0, 0.0255, 0.0165, 0.0085);                                                        // chin ball
      d -= 0.0022 * GA(0.0235, 0.076, 0.004, 0.018) * sstep(0.044, 0.05, y);                             // nasolabial
      return d;
    };
    const fall = x => sstep(0.075, 0.03, Math.abs(x));
    // th measured from the front; 0 front, +pi/2 left (x+)
    function pt(th, y, extra) {
      const s = Math.sin(th), c = Math.cos(th), p = 2.5, w = curve(W, y), f = curve(Fz, y), b = curve(Bz, y);
      const jaw = sstep(0.09, 0.04, y);                                                                 // squarer below the cheek
      const e = 2 / lerp(p, 3, jaw);
      let x = w * spow(s, e), z = (c > 0 ? f : b) * spow(c, e);
      const ex = extra || 0;
      if (c > 0) z += face(x, y) * sstep(0, 0.45, c);
      else z += 0;
      const nx = s, nz = c;
      return [x + nx * ex, z + nz * ex];
    }
    return { pt, face, W, Fz, Bz };
  }

  function buildGeo(kind, frames) {
    const F = kind === 'grandma', M = Mesher(frames), { R, RZ, loft, tube, grid, tp, local } = M, out = M.out;
    const shX = Math.abs(local('torso', tp('armL', 0, 0, 0))[0]);
    // ---- head skin
    const HS = headSurf(F), rows = [], cols = [];
    for (const [a, b, n] of [[0.222, 0.15, 7], [0.15, 0.108, 13], [0.108, 0.07, 11], [0.07, 0.04, 13], [0.04, 0.006, 7]]) for (let i = 0; i < n; i++) rows.push(lerp(a, b, i / n)); rows.push(0.006);
    for (const [a, b, n] of [[-Math.PI, -1.5, 5], [-1.5, -0.55, 8], [-0.55, 0.55, 22], [0.55, 1.5, 8], [1.5, Math.PI, 6]]) for (let i = 0; i < n; i++) cols.push(lerp(a, b, i / n));
    const hbone = y => y < 0.058 ? { jaw: sstep(0.058, 0.044, y), head: 1 - sstep(0.058, 0.044, y) } : { head: 1 };
    grid(SKIN, cols.length, rows.length, (i, j) => {
      const th = i >= cols.length ? Math.PI : cols[i], y = rows[j], [x, z] = HS.pt(th, y), p = tp('head', x, y, z), front = z > 0.01;
      const d = HS.face(x, y), sx = x * (1 + 3 * Math.max(0, 0.09 - z));
      const ao = lerp(1, Math.max(0.62, 1 + Math.min(0, d) * 26), sstep(0.02, 0.05, z)) * lerp(0.72, 1, sstep(0.012, 0.03, y));
      return { p, w: front ? hbone(y) : { head: 1 }, uv: [0.5 + 0.5 * Math.min(0.995, Math.max(0.005, 0.5 + sx / 0.2)), Math.min(1, Math.max(0, 0.5 + (y - 0.11) / 0.2))], c: [ao, ao * 0.97, ao * 0.95] };
    }, { wrap: true, head: true });
    // ears: a thin shell tilted off the skull
    for (const s of [1, -1]) {
      const c = [s * (F ? 0.073 : 0.076), 0.105, -0.012];
      grid(SKIN, 14, 6, (i, j) => {
        const a = i / 14 * 6.283, r = j / 5, ey = Math.sin(a), ex = Math.cos(a), hy = 0.0285, hz = 0.0165 * (ey < -0.2 ? 0.72 : 1);
        const y = c[1] + ey * hy * r * (ey < 0 ? 1.12 : 1), z = c[2] + ex * hz * r, back = sstep(0.012, -0.016, z - c[2]);
        const rim = sstep(0.62, 0.86, r), cup = -0.0045 * (1 - rim) * sstep(0.1, 0.5, r), x = c[0] + s * (0.0015 + 0.017 * back * r + cup + 0.0025 * rim);
        return { p: tp('head', x, y, z), w: { head: 1 }, uv: [0.52, 0.5], c: rim > 0.5 ? [0.95, 0.9, 0.86] : [0.68, 0.6, 0.56] };
      }, { wrap: true, head: true });
    }
    if (F) for (const s of [1, -1]) tube(ACC, 'head', [[s * 0.0755, 0.08, -0.008, 0.005], [s * 0.0755, 0.074, -0.008, 0.0055]], 6, { wt: { head: 1 }, col: [0.9, 0.66, 0.2] });
    // ---- hair: a mass that starts at a hairline, with its own volume and locks
    const hairline = th => { const a = Math.abs(th), q = a / Math.PI;
      return F ? curve([[0, 0.192], [0.12, 0.178], [0.3, 0.13], [0.47, 0.098], [0.62, 0.08], [1, 0.06]], q) : curve([[0, 0.183], [0.09, 0.184], [0.17, 0.168], [0.26, 0.15], [0.335, 0.122], [0.385, 0.134], [0.47, 0.142], [0.56, 0.105], [0.68, 0.07], [0.85, 0.05], [1, 0.046]], q); };
    const HU = 44, HV = 12, topY = 0.222;
    grid(HAIR, HU, HV, (i, j) => {
      const th = (i % HU) / HU * 6.2832 - Math.PI, t = j / (HV - 1), h0 = hairline(th) - 0.002, y = lerp(h0, topY, 1 - (1 - t) * (1 - t));
      const lift = sstep(0, 0.13, t), crown = sstep(0.1, 0.8, t);
      let e;
      if (F) { const [px] = HS.pt(th, y), part = Math.exp(-((px / 0.0065) ** 2)) * sstep(-0.5, 0.2, Math.cos(th)) * sstep(0.95, 0.7, t);
        e = lift * (0.0095 + 0.003 * crown - 0.0075 * part + sstep(1, 0.72, t) * 0.0013 * Math.sin(th * 26 + y * 30) * (1 - part)); }
      else { const [px, pz] = HS.pt(th, y), sw = sstep(0.05, -0.04, px - 0.028), fr = sstep(-0.02, 0.07, pz);
        e = lift * lerp(0.42, 1, sstep(0.125, 0.175, y)) * (0.0115 + 0.0075 * crown + 0.007 * sw * fr * sstep(0.02, 0.05, Math.abs(px - 0.028)) + sstep(1, 0.72, t) * 0.0024 * Math.sin(th * 13 + y * 55 + 2 * noise(th * 2, y * 18, 1)) - 0.0035 * Math.exp(-(((px - 0.028) / 0.006) ** 2)) * fr); }
      const dome = 1 - t ** 5; let [x, z] = HS.pt(th, y, e * dome), yy = y + e * sstep(0.2, 0.95, t);
      if (!F) z += lift * 0.0045 * sstep(0.05, 0.09, z);                                                 // quiff comes forward over the forehead
      const a = lerp(0.72, 1, lift) * (F ? 1 : 1);
      return { p: tp('head', x, yy, z), w: { head: 1 }, uv: [(th + Math.PI) / 6.2832 * 4, y * (F ? 3.5 : 6)], c: [a, a, a] };
    }, { wrap: true, head: true });
    if (F) {   // knot of hair at the nape, with a tie and a wrapped band of strands
      const c = [0, 0.092, -0.118];
      grid(HAIR, 12, 9, (i, j) => { const a = i / 12 * 6.283, b = j / 8 * Math.PI, wob = 1 + 0.09 * Math.sin(a * 3 + b * 4);
        const x = c[0] + Math.cos(a) * Math.sin(b) * 0.041 * wob, y = c[1] + Math.cos(b) * 0.036 * wob, z = c[2] + Math.sin(a) * Math.sin(b) * 0.03 * wob;
        return { p: tp('head', x, y, z), w: { head: 1 }, uv: [a * 0.6, b * 0.9 + a * 0.3], c: [1, 1, 1] }; }, { wrap: true, head: true });
    }
    // ---- neck (torso to head); cords and a real gap under the jaw
    const neckT = { torso: 1 }, neckM = { torso: 0.5, head: 0.5 }, nw = F ? 0.04 : 0.049, nf = F ? 0.04 : 0.05;
    const neckCol = (p) => { const a = lerp(0.68, 1, sstep(1.59, 1.53, p[1])); return [a, a * 0.97, a * 0.94]; };
    loft(SKIN, [R('torso', 0.41, 0.09, 0.08, 0.05, 2, { cz: 0.005, wt: neckT }), R('torso', 0.47, nw + 0.022, nf + 0.012, nf + 0.01, 2, { cz: -0.002, wt: neckT }), R('torso', 0.53, nw + 0.003, nf, nf + 0.002, 2, { cz: 0.002, wt: neckT }),
      R('torso', 0.58, nw, nf - 0.002, nf, 2, { cz: 0.006, wt: neckM }), R('head', 0.04, nw * 0.88, nf * 0.9, nf * 0.9, 2, { cz: -0.004, wt: { head: 1 } }), R('head', 0.075, nw * 0.8, nf * 0.8, nf * 0.8, 2, { cz: -0.012, wt: { head: 1 } })], 16, { sub: 2, col: neckCol,
      mod: (th, v, x, z) => { const c = Math.exp(-(((Math.abs(th - Math.PI) - 2.45) / 0.3) ** 2)); return [x * 0.03 * c, z * 0.03 * c]; } });

    // ---- arms and hands
    for (const [s, A, Fo] of [[1, 'armL', 'foreL'], [-1, 'armR', 'foreR']]) {
      const a = F ? 0.8 : 1, ww = (y) => { const t = sstep(0.05, -0.05, y); return { [A]: 1 - t, [Fo]: t }; };
      const tan = (p, r) => { const u = sstep(0, 1, r.v) ; return [r.ao * (F ? 0.93 : 0.88), r.ao * (F ? 0.89 : 0.81), r.ao * (F ? 0.85 : 0.74)]; };
      const top = F ? -0.03 : -0.05;
      loft(SKIN, [R(A, top, 0.036 * a, 0.038 * a, 0.038 * a, 2, { ao: 0.6 }), R(A, -0.09, 0.0355 * a, 0.039 * a, 0.037 * a, 2, { ao: 0.75 }), R(A, -0.17, 0.0335 * a, 0.0355 * a, 0.0355 * a), R(A, -0.25, 0.031 * a, 0.03 * a, 0.032 * a, 2.2, { wt: { [A]: 0.8, [Fo]: 0.2 } }),
        R(Fo, 0, 0.0305 * a, 0.029 * a, 0.0335 * a, 2.3, { wt: { [A]: 0.45, [Fo]: 0.55 } }), R(Fo, -0.04, 0.0335 * a, 0.0325 * a, 0.033 * a, 2, { wt: { [Fo]: 1 } }), R(Fo, -0.09, 0.0325 * a, 0.0305 * a, 0.03 * a, 2, { wt: { [Fo]: 1 } }),
        R(Fo, -0.16, 0.0268 * a, 0.0235 * a, 0.0235 * a, 2.2, { wt: { [Fo]: 1 } }), R(Fo, -0.215, 0.0225, 0.0165, 0.0165, 2.5, { wt: { [Fo]: 1 } }), R(Fo, -0.24, 0.0232, 0.0155, 0.0155, 2.6, { wt: { [Fo]: 1 } })], 12, { sub: 2, col: tan });
      // hand, palm plane faces the thigh: x is thickness here, z is the palm width
      const i = -s, ha = F ? 0.92 : 1;
      loft(SKIN, [R(Fo, -0.235, 0.0165, 0.0235, 0.0235, 2.4), R(Fo, -0.262, 0.0155, 0.0345 * ha, 0.0325 * ha, 2.8), R(Fo, -0.292, 0.0145, 0.0405 * ha, 0.038 * ha, 3.2), R(Fo, -0.318, 0.0115, 0.0405 * ha, 0.038 * ha, 3.4), R(Fo, -0.33, 0.006, 0.036 * ha, 0.034 * ha, 3)], 10, { sub: 1, col: tan });
      const Z = [0.0285, 0.0095, -0.0095, -0.0275].map(v => v * ha), L = [0.062, 0.071, 0.066, 0.052].map(v => v * ha), r = F ? 0.0072 : 0.0082;
      for (let f = 0; f < 4; f++) tube(SKIN, Fo, [[i * 0.002, -0.322, Z[f], r], [i * 0.007, -0.322 - L[f] * 0.5, Z[f], r * 0.92], [i * 0.016, -0.322 - L[f] * 0.82, Z[f], r * 0.82], [i * 0.024, -0.322 - L[f], Z[f], r * 0.6]], 6, { col: [0.84, 0.77, 0.7] });
      tube(SKIN, Fo, [[i * 0.003, -0.262, 0.032 * ha, 0.0125], [i * 0.012, -0.295, 0.05 * ha, 0.0098], [i * 0.019, -0.326, 0.055 * ha, 0.0078], [i * 0.022, -0.343, 0.056 * ha, 0.0055]], 6, { col: [0.84, 0.77, 0.7] });
      if (F) for (let b = 0; b < 3; b++) { const pts = []; for (let q = 0; q <= 10; q++) { const t = q / 10 * 6.2832; pts.push([Math.sin(t) * 0.031, -0.195 - b * 0.012, Math.cos(t) * 0.027, 0.0044]); } tube(ACC, Fo, pts, 4, { col: b % 2 ? [0.66, 0.08, 0.1] : [0.82, 0.6, 0.2] }); }
    }
    // ---- legs: knee, calf, tendon, ankle bones, foot with toes, chappal
    const lf = F ? 0.84 : 1;
    for (const [s, Lg, Sh] of [[1, 'legL', 'shinL'], [-1, 'legR', 'shinR']]) {
      const tan = (p, r) => [r.ao * 0.9, r.ao * 0.84, r.ao * 0.78];
      loft(SKIN, [R(Lg, -0.26, 0.05 * lf, 0.056 * lf, 0.052 * lf, 2, { ao: 0.6 }), R(Lg, -0.37, 0.045 * lf, 0.05 * lf, 0.047 * lf, 2.2, { ao: 0.6 }), R(Sh, 0, 0.04 * lf, 0.043 * lf, 0.038 * lf, 2.5, { wt: { [Lg]: 0.5, [Sh]: 0.5 }, ao: 0.7 }), R(Sh, -0.05, 0.0385 * lf, 0.0385 * lf, 0.044 * lf, 2.2),
        R(Sh, -0.13, 0.0425 * lf, 0.033 * lf, 0.058 * lf, 2, { cx: s * -0.003 }), R(Sh, -0.22, 0.0355 * lf, 0.03 * lf, 0.045 * lf), R(Sh, -0.31, 0.0265 * lf, 0.028 * lf, 0.029 * lf), R(Sh, -0.385, 0.0235, 0.0265, 0.0265, 2.3), R(Sh, -0.415, 0.0285, 0.03, 0.028, 2.4), R(Sh, -0.44, 0.027, 0.035, 0.032, 2.4)], 12, { sub: 2, col: tan });
      const y0 = -0.436, cx = s * 0.002, f = F ? 0.94 : 1;
      loft(SKIN, [RZ(Sh, -0.056 * f, 0.004, 0.003, 0.003, 2, { y0, cx }), RZ(Sh, -0.05 * f, 0.022, 0.019, 0.016, 2.4, { y0, cx }), RZ(Sh, -0.02 * f, 0.033, 0.03, 0.019, 2.6, { y0, cx }), RZ(Sh, 0.03 * f, 0.033, 0.03, 0.019, 2.6, { y0: y0 - 0.002, cx }), RZ(Sh, 0.08 * f, 0.039, 0.019, 0.017, 2.7, { y0: y0 - 0.005, cx }), RZ(Sh, 0.118 * f, 0.043, 0.0125, 0.0135, 2.8, { y0: y0 - 0.007, cx }), RZ(Sh, 0.13 * f, 0.004, 0.004, 0.004, 2, { y0: y0 - 0.008, cx })], 12, { sub: 1, col: tan });
      for (let t = 0; t < 5; t++) { const x = s * (-0.03 + t * 0.0145) * -1, zb = 0.122 - t * 0.0035 - (t === 0 ? 0 : 0.004), l = [0.04, 0.036, 0.03, 0.024, 0.02][t], r = [0.0115, 0.0072, 0.0068, 0.0062, 0.0058][t];
        tube(SKIN, Sh, [[x * 1.0 + cx, -0.443, zb * f, r], [x * 1.0 + cx, -0.446, (zb + l * 0.6) * f, r * 0.96], [x * 1.0 + cx, -0.448, (zb + l) * f, r * 0.7]], 6, { col: [0.86, 0.78, 0.7] }); }
      const br = F ? [0.42, 0.28, 0.17] : [0.28, 0.17, 0.1];
      loft(ACC, [RZ(Sh, -0.062, 0.004, 0.002, 0.002, 2, { y0: -0.455, cx }), RZ(Sh, -0.055, 0.034, 0.0055, 0.0055, 3, { y0: -0.455, cx }), RZ(Sh, 0.02, 0.041, 0.0055, 0.0055, 3, { y0: -0.455, cx }), RZ(Sh, 0.1, 0.05, 0.0055, 0.0055, 3, { y0: -0.455, cx }), RZ(Sh, 0.163, 0.048, 0.0055, 0.0055, 3, { y0: -0.455, cx }), RZ(Sh, 0.183, 0.004, 0.002, 0.002, 2, { y0: -0.455, cx })], 10, { sub: 1, col: () => br });
      const tx = s * 0.014 + cx;
      for (const d of [1, -1]) tube(ACC, Sh, [[tx, -0.449, 0.122, 0.0042], [tx + d * 0.018, -0.426, 0.082, 0.0048], [d * 0.043 + cx, -0.446, 0.036, 0.0048]], 5, { col: br });
    }
    // ---- clothes
    const wrapW = (t, hipsW, p, x, y) => {};
    // cloth below the waist follows the legs like real cloth over them: split by side, thigh then shin
    const legWeights = (p, Hw) => {
      const y = p[1], side = sstep(-0.055, 0.055, p[0]), top = sstep(Hw, Hw - 0.16, y), knee = sstep(0.58, 0.44, y);
      const hipPart = 1 - top, w = { hips: Math.max(1e-4, hipPart) };
      w.legL = top * side * (1 - knee); w.shinL = top * side * knee; w.legR = top * (1 - side) * (1 - knee); w.shinR = top * (1 - side) * knee;
      return w;
    };
    const ang = (p) => Math.atan2(p[0], p[2]) / 6.2832 + 0.5;
    const seamU = (p, th, i) => { const a = th / 6.2832 + 0.5; return a > 1 ? a - 1 : a; };
    if (!F) {
      const ht = { hips: 0.75, torso: 0.25 }, mt = { hips: 0.3, torso: 0.7 };
      const uvT = (p, th, r, u) => [u + 0.5, Math.min(0.81, Math.max(0.005, p[1] - 0.72))];
      // shirt: tailored village half-sleeve. Sloped shoulders running into the neck, a chest, a gentle taper to the waist,
      // then a loose hem over the lungi; the widest point is the chest, not the shoulder corner.
      loft(TOP, [R('torso', -0.095, 0.142, 0.1, 0.094, 2.3, { wt: ht, ao: 0.6 }), R('torso', -0.122, 0.153, 0.104, 0.098, 2.3, { wt: ht, ao: 0.75 }), R('torso', -0.116, 0.155, 0.106, 0.1, 2.3, { wt: ht }), R('torso', -0.05, 0.151, 0.101, 0.096, 2.25, { wt: ht }), R('torso', 0.05, 0.1435, 0.094, 0.09, 2.2, { wt: mt }), R('torso', 0.17, 0.1445, 0.097, 0.092, 2.25),
        R('torso', 0.29, 0.1575, 0.109, 0.1, 2.35), R('torso', 0.37, 0.164, 0.106, 0.102, 2.45), R('torso', 0.425, 0.1655, 0.094, 0.097, 2.5), R('torso', 0.468, 0.162, 0.08, 0.087, 2.5), R('torso', 0.5, 0.133, 0.069, 0.075, 2.3), R('torso', 0.522, 0.09, 0.061, 0.066, 2.05, { cz: 0.002 }), R('torso', 0.541, 0.0585, 0.056, 0.058, 2, { cz: 0.004, ao: 0.8 })], 32, { sub: 2, uv: uvT,
        mod: (th, v, x, z, t) => { const low = sstep(0.5, 0.1, t), a = 0.0032 * low * Math.sin(th * 5 + 1 + 2 * noise(th, t * 3, 2)) + 0.0014 * Math.sin(th * 11 + t * 9); const s = Math.sin(th), c = Math.cos(th); return [s * a, c * a]; } });
      // sleeves: start inside the shoulder so the cap flows out of the torso, narrow to a slightly flared open hem with a turned edge
      for (const [A, u0] of [['armL', 0], ['armR', 0.5]]) {
        const uvS = (p, th, r, u) => [u0 + u * 0.5, Math.min(0.995, Math.max(0.82, 0.975 + local(A, p)[1] * 0.85))];
        loft(TOP, [R(A, 0.012, 0.004, 0.006, 0.006, 2, { cx: -0.04 }), R(A, 0.006, 0.024, 0.036, 0.038, 2, { cx: -0.04 }), R(A, -0.016, 0.038, 0.052, 0.054, 2, { cx: -0.02, ao: 0.92 }), R(A, -0.05, 0.047, 0.055, 0.057, 2.05, { cx: -0.004 }), R(A, -0.09, 0.0455, 0.0525, 0.054), R(A, -0.14, 0.0465, 0.05, 0.0515, 2, { ao: 0.94 }), R(A, -0.2, 0.05, 0.052, 0.053), R(A, -0.194, 0.0465, 0.049, 0.05, 2, { ao: 0.55 }), R(A, -0.165, 0.039, 0.042, 0.043, 2, { ao: 0.45 })], 18, { sub: 2, uv: uvS,
          mod: (th, v, x, z, t) => { const a = 0.002 * Math.sin(th * 3 + t * 6); return [Math.sin(th) * a, Math.cos(th) * a]; } });
      }
      // collar: a band standing round the neck, then two leaves folded down over it ending in real points at the front
      loft(TOP, [R('torso', 0.522, 0.062, 0.062, 0.06, 2, { cz: 0.004, ao: 0.7 }), R('torso', 0.54, 0.0585, 0.0585, 0.0585, 2, { cz: 0.004 }), R('torso', 0.556, 0.055, 0.0545, 0.0565, 2, { cz: 0.002 }), R('torso', 0.561, 0.051, 0.05, 0.053, 2, { cz: 0.002, ao: 0.55 })], 20, { sub: 1, uv: () => [0.26, 0.66] });
      for (const s of [1, -1]) grid(TOP, 15, 6, (i, j) => {
        const t = i / 14, q = j / 5, a = 0.09 + t * (Math.PI - 0.09), fold = Math.sin(q * Math.PI) * 0.0035;        // rolled over the top edge, not a flat paper strip
        const point = sstep(0.3, 0, t);                                                                        // the leaf deepens into its tip at the front
        const r = 0.0575 + q * (0.0135 + 0.02 * point) + fold, cy = 0.557 + 0.005 * t - 0.012 * point;
        const x = s * Math.sin(a) * r + s * 0.014 * q * point, y = cy - q * (0.026 + 0.04 * point), z = 0.003 + Math.cos(a) * r * (0.97 + 0.08 * q * point);
        const shade = q > 0.84 ? 0.8 : 1;
        return { p: tp('torso', x, y, z), w: { torso: 1 }, uv: [0.26, 0.66], c: [shade, shade, shade] };
      });
      // lungi: a wrapped tube, falls dead straight from the hips; waist roll, one overlap fold, hem
      const uvL = (p, th, r, u) => [u + 0.5, Math.min(1, Math.max(0, (p[1] - 0.25) / 0.85))];
      loft(BOT, [R('hips', -0.68, 0.135, 0.105, 0.098, 2.3, { ao: 0.5 }), R('hips', -0.72, 0.1525, 0.118, 0.11, 2.3, { ao: 0.7 }), R('hips', -0.714, 0.1545, 0.12, 0.112, 2.3), R('hips', -0.5, 0.153, 0.117, 0.11, 2.3), R('hips', -0.25, 0.1515, 0.114, 0.111, 2.3), R('hips', -0.12, 0.149, 0.1, 0.098, 2.4), R('hips', -0.04, 0.146, 0.092, 0.092, 2.4),
        R('hips', 0.03, 0.138, 0.086, 0.086, 2.4), R('hips', 0.06, 0.136, 0.084, 0.084, 2.4), R('hips', 0.072, 0.1405, 0.088, 0.088, 2.4), R('hips', 0.09, 0.139, 0.086, 0.086, 2.4), R('hips', 0.1, 0.13, 0.078, 0.078, 2.4)], 32, { sub: 2, uv: uvL, wf: p => legWeights(p, 0.84),
        mod: (th, v, x, z, t) => { const low = sstep(0.75, 0.15, t) ; let a = low * (0.0042 * Math.sin(th * 7 + 0.7 + 2 * noise(th, 1, 3)) + 0.0022 * Math.sin(th * 13 + 2)); const d = ((th + 0.45) % 6.2832) - 0.9; a += low * 0.0085 * Math.exp(-((d / 0.11) ** 2)) * (d < 0 ? 1 : 0.6); const s = Math.sin(th), c = Math.cos(th); return [s * a, c * a, t > 0.2 ? 0 : Math.sin(th * 2 + 1) * 0.003]; } });
      
    } else {
      // skin under: thin chest and bare midriff of a rural elder
      loft(SKIN, [R('hips', 0.04, 0.128, 0.08, 0.082, 2.4, { wt: { hips: 1 }, ao: 0.6 }), R('torso', 0.08, 0.1155, 0.0725, 0.076, 2.4, { wt: { hips: 0.2, torso: 0.8 } }), R('torso', 0.14, 0.1135, 0.0725, 0.077, 2.4), R('torso', 0.22, 0.121, 0.079, 0.08, 2.4), R('torso', 0.34, 0.135, 0.09, 0.09, 2.5), R('torso', 0.42, 0.1385, 0.086, 0.09, 2.8), R('torso', 0.47, 0.125, 0.071, 0.08, 2.8), R('torso', 0.51, 0.09, 0.058, 0.066, 2.4), R('torso', 0.54, 0.05, 0.048, 0.05, 2.1)], 16, { sub: 2 });
      const uvB = (p, th, r, u) => [u + 0.5, Math.min(0.81, Math.max(0.005, p[1] - 0.72))];
      // blouse: fitted, ends above the waist, with a low scooped neck
      loft(TOP, [R('torso', 0.205, 0.1215, 0.08, 0.081, 2.4, { ao: 0.7 }), R('torso', 0.215, 0.1275, 0.0845, 0.0855, 2.4), R('torso', 0.3, 0.1365, 0.097, 0.0915, 2.5), R('torso', 0.38, 0.144, 0.097, 0.095, 2.8), R('torso', 0.43, 0.153, 0.088, 0.094, 3), R('torso', 0.47, 0.143, 0.0735, 0.0845, 2.9), R('torso', 0.492, 0.112, 0.0665, 0.0765, 2.6), R('torso', 0.515, 0.084, 0.06, 0.066, 2.3)], 22, { sub: 2, uv: uvB });
      for (const [A, u0] of [['armL', 0], ['armR', 0.5]]) {
        const uvS = (p, th, r, u) => [u0 + u * 0.5, Math.min(0.995, Math.max(0.82, 0.99 + local(A, p)[1] * 0.85))];
        loft(TOP, [R(A, 0.01, 0.004, 0.005, 0.005, 2, { cx: -0.02 }), R(A, 0.0, 0.028, 0.032, 0.032, 2, { cx: -0.018 }), R(A, -0.026, 0.037, 0.043, 0.043, 2, { cx: -0.007 }), R(A, -0.05, 0.041, 0.045, 0.046), R(A, -0.08, 0.0405, 0.0445, 0.044), R(A, -0.142, 0.0375, 0.041, 0.0405), R(A, -0.136, 0.033, 0.036, 0.036, 2, { ao: 0.55 }), R(A, -0.11, 0.03, 0.033, 0.033, 2, { ao: 0.45 })], 14, { sub: 1, uv: uvS });
      }
      // saree: tucked at the waist, a sheaf of real knife pleats that stand proud at the front and change the outline
      const uvS = (p, th, r, u) => [u + 0.5, Math.min(0.698, Math.max(0, p[1] - 0.035) * 0.7)];
      const pleat = (th, t, i) => {               // th from the front, t 0 hem .. 1 waist
        const wr = ((th + Math.PI) % 6.2832) - Math.PI, off = wr - 0.03, spread = lerp(0.62, 0.3, t), q = off / spread;
        if (Math.abs(q) > 1.25) return 0;
        const m = sstep(1.2, 0.86, Math.abs(q)), n = 8, sw = ((q + 2) * n * 0.5) % 1, saw = sw < 0.72 ? sw / 0.72 : (1 - sw) / 0.28;
        return m * (0.021 + 0.03 * (1 - t)) * (0.42 + 0.58 * saw);
      };
      loft(BOT, [R('hips', -0.835, 0.178, 0.135, 0.128, 2.1, { ao: 0.5 }), R('hips', -0.872, 0.197, 0.152, 0.15, 2.1, { ao: 0.75 }), R('hips', -0.865, 0.1985, 0.1535, 0.1515, 2.1), R('hips', -0.72, 0.193, 0.148, 0.148, 2.1), R('hips', -0.5, 0.179, 0.136, 0.137, 2.2), R('hips', -0.3, 0.17, 0.125, 0.133, 2.2), R('hips', -0.1, 0.1695, 0.116, 0.14, 2.3), R('hips', 0, 0.156, 0.105, 0.126, 2.3), R('hips', 0.07, 0.132, 0.092, 0.104, 2.4), R('hips', 0.105, 0.1265, 0.094, 0.097, 2.4), R('hips', 0.125, 0.1215, 0.09, 0.09, 2.4)], 48, { sub: 2, uv: uvS, wf: p => legWeights(p, 0.93),
        mod: (th, v, x, z, t) => { const wrap = 1 - sstep(0.55, 0.85, t), up = sstep(0.8, 0.95, t), hem = t < 0.16 ? 0 : 1; let a = pleat(th, Math.min(1, t * 1.05)) * wrap * 1 + wrap * sstep(0.1, 0.5, 1 - t) * (0.0065 * Math.sin(th * 5 + 2.5 * noise(th, t * 2, 4)) + 0.0028 * Math.sin(th * 12 + 3 * t)) * (Math.abs(((th + Math.PI) % 6.2832) - Math.PI) > 0.8 ? 1 : 0.3); void up; void hem; const s = Math.sin(th), c = Math.cos(th); return [s * a, c * a]; } });
      // pallu: from the right hip, across the chest in gathered folds, over the left shoulder, down the back as one wide fall
      const path = [[-0.12, -0.04, 0.078], [-0.098, 0.05, 0.09], [-0.05, 0.17, 0.097], [0.03, 0.29, 0.117], [0.078, 0.39, 0.106], [0.106, 0.455, 0.074], [0.116, 0.49, 0.012], [0.118, 0.47, -0.058], [0.128, 0.41, -0.1], [0.128, 0.26, -0.11], [0.112, 0.08, -0.112], [0.1, -0.12, -0.136], [0.098, -0.33, -0.155], [0.1, -0.52, -0.168]];
      const N = 26, A = 11, sp = (q, c) => { const n = path.length - 1, f = q * n, k = Math.min(n - 1, Math.floor(f)), g = m => path[Math.max(0, Math.min(n, m))][c]; return crom(g(k - 1), g(k), g(k + 1), g(k + 2), f - k); };
      const Pt = q => [sp(q, 0), sp(q, 1), sp(q, 2)], L = [0]; for (let i = 1; i <= N; i++) { const a = Pt((i - 1) / N), b = Pt(i / N); L.push(L[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
      const hw = q => curve([[0, 0.075], [0.2, 0.078], [0.36, 0.088], [0.46, 0.05], [0.56, 0.095], [0.72, 0.125], [1, 0.14]], q);
      grid(BOT, A, N + 1, (i, j) => {
        const q = j / N, a = i / (A - 1) * 2 - 1, c = Pt(q), c2 = Pt(Math.min(1, q + 0.02)), c1 = Pt(Math.max(0, q - 0.02));
        let tx = c2[0] - c1[0], ty = c2[1] - c1[1], tz = c2[2] - c1[2]; const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const ax = c[0] * 0.55, nl0 = Math.hypot(c[0] - ax, 0, c[2]) || 1, sh = sstep(0.42, 0.47, q) * sstep(0.53, 0.47, q); let nx = (c[0] - ax) / nl0 * (1 - sh), ny = sh, nz = c[2] / nl0 * (1 - sh);
        const d = tx * nx + ty * ny + tz * nz; nx -= tx * d; ny -= ty * d; nz -= tz * d; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx, W = hw(q), g = sstep(0.62, 0.42, Math.abs(q - 0.3)) ;
        const fold = 0.011 * sstep(0.2, 0.34, q) * sstep(0.6, 0.48, q) + 0.006 * g * Math.sin(a * 9.4 + q * 7) + 0.004 * (1 - g) * Math.sin(a * 6.2 + q * 4 + 1) + (q > 0.62 ? 0.003 * Math.sin(a * 14) : 0);
        const lx = c[0] + sx * W * a + nx * fold, ly = c[1] + sy * W * a + ny * fold, lz = c[2] + sz * W * a + nz * fold, p = tp('torso', lx, ly, lz);
        const hipK = Math.max(sstep(0.05, -0.12, ly), q < 0.12 ? sstep(0.12, 0.03, q) : 0), w = hipK > 0 ? { torso: 1 - hipK, hips: hipK } : { torso: 1 };
        const shade = lerp(0.82, 1, sstep(-1, 1, Math.sin(a * 9.4 + q * 7))) * 1;
        return { p, w, uv: [L[j] * 2, 0.71 + 0.285 * (1 - Math.abs(a))], c: [shade, shade, shade] };
      });
    }
    // ---- geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.sw, 4));
    const index = []; let start = 0;
    out.idx.forEach((I, m) => { if (!I.length) return; geo.addGroup(start, I.length, m); for (const v of I) index.push(v); start += I.length; });
    geo.setIndex(index);
    // lip shapes (relative morph targets, head-local deltas): 0 'open' lips part, 1 'round' (o / u), 2 'wide' (e / i)
    const hm = frames[BI.head].m, nv = out.pos.length / 3, MT = [new Float32Array(nv * 3), new Float32Array(nv * 3), new Float32Array(nv * 3)];
    const hInv = frames[BI.head].inv, dv = new THREE.Vector3(), hm3 = new THREE.Matrix3().setFromMatrix4(hm);
    for (let i = 0; i < nv; i++) {
      if (!out.h[i]) continue;
      const x = out.pos[i * 3], y = out.pos[i * 3 + 1], z = out.pos[i * 3 + 2], e = hInv;
      const hx = e[0] * x + e[4] * y + e[8] * z + e[12], hy = e[1] * x + e[5] * y + e[9] * z + e[13], hz = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (hz < 0.05) continue;
      const w = Math.exp(-((hx / 0.03) ** 2 + ((hy - 0.053) / 0.022) ** 2 + ((hz - 0.095) / 0.03) ** 2));
      if (w < 0.01) continue;
      const up = hy > 0.053 ? 1 : -1, lip = Math.exp(-(((hy - 0.053) / 0.012) ** 2));
      const set = (k, a, b, c) => { dv.set(a, b, c).applyMatrix3(hm3); MT[k][i * 3] = dv.x; MT[k][i * 3 + 1] = dv.y; MT[k][i * 3 + 2] = dv.z; };
      set(0, 0, up * 0.0035 * w * lip, -0.001 * w);
      set(1, -0.32 * hx * w, 0, 0.0055 * w * lip);
      set(2, 0.14 * hx * w, -(hy - 0.053) * 0.25 * w, -0.0015 * w);
    }
    geo.morphAttributes.position = MT.map(a => new THREE.BufferAttribute(a, 3));
    geo.morphTargetsRelative = true;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    STATS[kind + 'Tris'] = index.length / 3;
    return geo;
  }

  function materials(kind, o) {
    const F = kind === 'grandma', T = textures(kind), scale = v => new THREE.Vector2(v, v);
    const std = (opt) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0, skinning: true, morphTargets: true, vertexColors: true }, opt));
    // one texture set per kind; a different skin tone is a material tint on that shared set
    const a = new THREE.Color(SkinBase[kind]), b = new THREE.Color(o.skin === undefined ? SkinBase[kind] : o.skin);
    const tone = new THREE.Color(b.r / a.r, b.g / a.g, b.b / a.b);
    const bot = F ? { metalnessMap: T.bot.roughnessMap, metalness: 1 } : {};
    return [
      std(Object.assign({}, T.skin, { color: tone, roughness: 1, normalScale: scale(F ? 1 : 0.8), emissive: new THREE.Color(0.06, 0.04, 0.032), emissiveMap: T.skin.map })),    // low warm self-light: cheap stand-in for light scattering through skin in the shadow side
      std(Object.assign({}, T.hair, { roughness: 0.52, normalScale: scale(0.8) })),
      std(Object.assign({}, T.top, { roughness: 0.88, side: THREE.DoubleSide, normalScale: scale(0.9) })),
      std(Object.assign({}, T.bot, bot, { roughness: 1, side: THREE.DoubleSide, normalScale: scale(1) })),
      std({ roughness: 0.45, metalness: 0.25 }),
    ];
  }

  // ------------------------------------------------------------ attach to a HumanModel result
  const cache = {};
  function attach(res, kind) {
    const P = res.parts, body = res.group.children.find(c => c.name === 'humanBody') || res.group.children[0];
    const handOf = f => f.children.find(c => c.isGroup && c.children.length >= 0 && Math.abs(c.position.y + 0.245) < 0.01) || null;
    void handOf;
    // jaw joint (hinge just in front of the ears); visitors.js rotates parts.jaw.rotation.x while speaking
    if (!P.jaw) { const j = new THREE.Group(); j.name = 'jaw'; j.position.set(0, 0.085, 0.0); P.head.add(j); Object.defineProperty(P, 'jaw', { value: j, enumerable: false, writable: true, configurable: true }); }
    P.jaw.rotation.set(0, 0, 0);
    // bind pose: arms out a little (so the arm surface doesn't fuse with the hips), legs slightly apart
    P.hips.position.set(0, 0.92, 0); P.hips.rotation.set(0, 0, 0);
    P.torso.rotation.set(0, 0, 0); P.torso.scale.set(1, 1, 1); P.head.rotation.set(0, 0, 0);
    P.legL.position.x = 0.074; P.legR.position.x = -0.074; P.head.position.y = 0.56; P.head.scale.setScalar(1.02);                                                                              // lower the skull: a neck, not a stalk
    const shX = kind === 'grandma' ? 0.15 : 0.172; P.armL.position.x = shX; P.armR.position.x = -shX;      // real biacromial width for a lean build
    P.armL.rotation.set(0, 0, 0.13); P.armR.rotation.set(0, 0, -0.13); P.foreL.rotation.set(-0.08, 0, 0); P.foreR.rotation.set(-0.08, 0, 0);
    P.legL.rotation.set(0, 0, 0.035); P.legR.rotation.set(0, 0, -0.035); P.shinL.rotation.set(0, 0, 0); P.shinR.rotation.set(0, 0, 0);
    if (P.skirt) { P.skirt.rotation.set(0, 0, 0); P.skirt.scale.set(1, 1, 1); }
    res.group.updateMatrixWorld(true);
    const bInv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const frames = BONES.map(n => {
      const m = new THREE.Matrix4().multiplyMatrices(bInv, (P[n] || P.hips).matrixWorld), inv = new THREE.Matrix4().copy(m).invert();
      const sc = new THREE.Vector3().setFromMatrixColumn(m, 0).length();
      return { m, inv: inv.elements, sc, local: [m.elements[12], m.elements[13], m.elements[14]] };
    });
    const t0 = performance.now();
    const geo = cache[kind] || (cache[kind] = buildGeo(kind, frames));
    const mats = materials(kind, res.appearance);
    const mesh = new THREE.SkinnedMesh(geo, mats);
    mesh.name = 'sculptBody'; mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    body.add(mesh); res.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(BONES.map(n => P[n] || P.hips));
    mesh.bind(skel, mesh.matrixWorld);
    // old primitive meshes: kept (lod.js bakes its mid-distance snapshot from them) but not drawn
    body.traverse(o => {
      if (!o.isMesh || o === mesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(hide) : hide(o.material);
      o.castShadow = false;
    });
    res.sculpt = { kind, mesh, tris: geo.index.count / 3, ms: Math.round(performance.now() - t0) };
    return res;
  }
  function hide(m) { const c = m.clone(); c.visible = false; return c; }

  const LOOKS = {
    player: { gender: 'm', top: 'shirt', bottom: 'lungi', topColor: 0x2f6fb3, bottomColor: 0xf4cccc, color: 0x2f6fb3, skin: 0x8d5a3b, hair: 'short',
      hairColor: 0x141210, facial: 'stubble', face: 'oval', brows: 'medium', eyes: 0x2a1a10, feet: 'chappals', feetColor: 0x5a3a24, acc: {}, height: 1, build: 1 },
    grandma: { elder: true, gender: 'f', bottomColor: 0x1f4c9c, topColor: 0x7a2632, skin: 0x9a6a48, face: 'oval', brows: 'thin', feet: 'chappals', feetColor: 0x6b4a2e },
  };
  function create(kind, extra) { return HumanModel.create(Object.assign({}, LOOKS[kind], extra || {}, { sculpt: kind })); }
  window.SculptPeople = { create, attach, LOOKS, cache, texCache, STATS, CH: null };
})();
