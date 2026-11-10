// people-models.js: procedural villagers for the Nellutla driving game (three.js r128, no external assets).
// HumanModel.create(appearance) returns
//   { group, parts: { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, skirt? }, hipHeight, scale }
// The group origin is between the feet, the figure faces +z. Every part is a Group pivoted at its joint,
// so rotation.x swings a limb forward (negative) or back (positive).
//
// Appearance (all optional; legacy { gender, skin, outfit, color, bottom, scale, lod } still works):
//   gender 'm'|'f', height 0.9..1.1, build 0.85..1.2, skin hex, face 'oval'|'round'|'square'|'long',
//   brows 'thin'|'medium'|'thick'|'arched', eyes hex, hair (see HAIR), hairColor hex, facial (see FACIAL),
//   top (see TOPS), topColor, bottom (see BOTTOMS), bottomColor, feet (see FEET), feetColor,
//   acc { sunglasses, watch, chain, bindi, bangles, cap, turban, earrings } booleans, accColor, lod 'high'|'low'
const HumanModel = (function () {
  const geoCache = {}, matCache = {};
  const G = (key, fn) => geoCache[key] || (geoCache[key] = fn());

  // ------------------------------------------------------------ fabric textures (grey-scale canvas, tinted by colour)
  const texCache = {};
  function tex(kind) {
    if (texCache[kind]) return texCache[kind];
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, N, N);
    let rep = [3, 3];
    const noise = (a) => { const d = x.getImageData(0, 0, N, N); for (let i = 0; i < d.data.length; i += 4) { const v = (Math.random() - 0.5) * a; d.data[i] += v; d.data[i + 1] += v; d.data[i + 2] += v; } x.putImageData(d, 0, 0); };
    if (kind === 'weave') {            // plain cotton weave
      for (let i = 0; i < N; i += 2) { x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(i, 0, 1, N); x.fillStyle = 'rgba(0,0,0,0.045)'; x.fillRect(0, i, N, 1); }
      noise(18); rep = [4, 4];
    } else if (kind === 'denim') {     // diagonal twill
      x.fillStyle = '#e6e9f0'; x.fillRect(0, 0, N, N);
      for (let i = -N; i < N; i += 3) { x.strokeStyle = 'rgba(0,0,0,0.13)'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + N, N); x.stroke(); }
      noise(30); rep = [3, 4];
    } else if (kind === 'check') {     // lungi check
      x.fillStyle = 'rgba(0,0,0,0.26)'; for (let i = 0; i < N; i += 32) { x.fillRect(i, 0, 9, N); x.fillRect(0, i, N, 9); }
      x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 16; i < N; i += 32) { x.fillRect(i, 0, 3, N); x.fillRect(0, i, N, 3); }
      noise(14); rep = [3, 2];
    } else if (kind === 'border') {    // saree: plain body, zari border at the hem (v = 0) and small butis
      x.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < N; i += 2) x.fillRect(i, 0, 1, N);
      for (let i = 8; i < N - 24; i += 20) for (let j = 8; j < N; j += 20) { x.fillStyle = 'rgba(255,230,140,0.9)'; x.beginPath(); x.arc(j + (i % 40 ? 10 : 0), i, 2, 0, 7); x.fill(); }
      const gr = x.createLinearGradient(0, N - 22, 0, N); gr.addColorStop(0, 'rgba(120,20,20,0.6)'); gr.addColorStop(0.3, '#ffd77a'); gr.addColorStop(0.6, '#c8952e'); gr.addColorStop(1, '#ffe39a');
      x.fillStyle = gr; x.fillRect(0, N - 22, N, 22); noise(10); rep = [4, 1];
    } else if (kind === 'khaki') {
      for (let i = -N; i < N; i += 2) { x.strokeStyle = 'rgba(0,0,0,0.07)'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + N, N); x.stroke(); } noise(12); rep = [4, 4];
    } else if (kind === 'knit') {      // T-shirt jersey
      for (let i = 0; i < N; i += 3) for (let j = 0; j < N; j += 4) { x.fillStyle = 'rgba(0,0,0,0.05)'; x.fillRect(i, j, 1, 2); } noise(10); rep = [5, 5];
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4;
    return (texCache[kind] = t);
  }
  const skinMat = hex => matCache['sk' + hex] || (matCache['sk' + hex] = new THREE.MeshPhongMaterial({ color: hex, specular: 0x241a12, shininess: 14 }));
  const plain = (hex, shiny) => { const k = 'p' + hex + (shiny || 0); return matCache[k] || (matCache[k] = shiny ? new THREE.MeshPhongMaterial({ color: hex, specular: 0x444444, shininess: shiny }) : new THREE.MeshPhongMaterial({ color: hex, specular: 0x111111, shininess: 6 })); };
  const cloth = (hex, kind, dbl) => { const k = 'c' + hex + kind + (dbl ? 'd' : ''); return matCache[k] || (matCache[k] = new THREE.MeshPhongMaterial({ color: hex, map: tex(kind || 'weave'), specular: 0x161616, shininess: 5, side: dbl ? THREE.DoubleSide : THREE.FrontSide })); };
  const metal = hex => matCache['m' + hex] || (matCache['m' + hex] = new THREE.MeshPhongMaterial({ color: hex, specular: 0xffffff, shininess: 80 }));

  // ------------------------------------------------------------ geometry helpers
  let SEG = 12, RINGS = 1;   // set per LOD inside create()
  // Smooth limb along -y from the pivot: rounded ends, tapered from r1 to r2, with a muscle bulge near tBulge.
  function limb(r1, r2, len, bulge, tB, sg) {
    const SG = sg ? Math.min(sg, SEG) : SEG, RG = sg ? 1 : RINGS;
    return G(['limb', r1, r2, len, bulge, tB, SG, RG].join(), () => {
      const pts = [], cap = RG >= 2 ? 2 : 1;
      for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + i * Math.PI / 2 / cap; pts.push(new THREE.Vector2(Math.max(0.0004, Math.cos(a) * r2), -len + Math.sin(a) * r2 * 0.8)); }
      const mid = RG >= 2 ? 4 : 2;
      for (let i = 1; i < mid; i++) {
        const t = i / mid, y = -len + t * len;                 // t from bottom (0) to top (1)
        const r = r2 + (r1 - r2) * t + (bulge || 0) * Math.exp(-Math.pow((t - (tB || 0.6)) / 0.22, 2));
        pts.push(new THREE.Vector2(r, y));
      }
      for (let i = 0; i <= cap; i++) { const a = i * Math.PI / 2 / cap; pts.push(new THREE.Vector2(Math.max(0.0004, Math.cos(a) * r1), Math.sin(a) * r1 * 0.8)); }
      return new THREE.LatheGeometry(pts, SG);
    });
  }
  // Lofted body shell: superellipse cross-sections [y, halfWidth, halfDepth, zOffset, exponent] stacked up the
  // body, welded round the seam (no duplicated column) so normals are smooth everywhere; closed at both ends.
  function loft(key, secs, seg) {
    return G('loft' + key + '|' + seg, () => {
      const pos = [], uv = [], idx = [], n = secs.length;
      for (let j = 0; j < n; j++) {
        const [y, w, d, zo, e] = secs[j], ex = 2 / (e || 2.4);
        for (let i = 0; i < seg; i++) {
          const a = i / seg * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
          pos.push(Math.sign(sa) * Math.pow(Math.abs(sa), ex) * w, y, Math.sign(ca) * Math.pow(Math.abs(ca), ex) * d + (zo || 0));
          uv.push(i / seg * 2, y * 2);
        }
      }
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
        const a = j * seg + i, b = j * seg + (i + 1) % seg, c = a + seg, dd = b + seg;
        idx.push(a, b, c, b, dd, c);
      }
      const bot = pos.length / 3; pos.push(0, secs[0][0] - 0.01, secs[0][3] || 0); uv.push(0.5, 0);
      const top = bot + 1; pos.push(0, secs[n - 1][0] + 0.008, secs[n - 1][3] || 0); uv.push(0.5, 1);
      for (let i = 0; i < seg; i++) { idx.push(bot, (i + 1) % seg, i); idx.push(top, (n - 1) * seg + i, (n - 1) * seg + (i + 1) % seg); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    });
  }
  const lathe = (key, pts, seg) => G(key + '|' + seg, () => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg));
  const sphere = (r, w, h) => G(['sph', r, w, h].join(), () => new THREE.SphereGeometry(r, w, h));
  const torus = (r, t, a, b, arc) => G(['tor', r, t, a, b, arc || 0].join(), () => new THREE.TorusGeometry(r, t, a, b, arc || Math.PI * 2));
  function mesh(geo, m, parent, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; parent.add(o); return o; }
  function joint(parent, x, y, z) { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; }

  // Flat cloth strip following a curve (saree pallu, dupatta, waist tuck).
  function ribbon(key, pts, width) {
    return G(key, () => {
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
      const n = 18, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const p = curve.getPoint(i / n), t = curve.getTangent(i / n);
        const out = new THREE.Vector3(p.x, 0, p.z).normalize();
        const side = new THREE.Vector3().crossVectors(t, out).normalize().multiplyScalar(width / 2);
        pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
        uv.push(i / n * 3, 0, i / n * 3, 1);
        if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    });
  }
  // Open skirt hanging from the waist with soft pleats (lungi, saree, dhoti, kurta / kameez hem).
  function skirt(len, rTop, rHem, pleats, seg) {
    return G(['sk', len, rTop, rHem, pleats, seg].join(), () => {
      const g = new THREE.CylinderGeometry(rTop, rHem, len, seg, 3, true);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (len / 2 - y) / len, a = Math.atan2(x, z);
        const k = 1 + (pleats ? 0.08 * Math.sin(a * 12) * t * (z > 0 ? 1 : 0.35) : 0.03 * Math.sin(a * 5) * t);
        p.setXYZ(i, x * k, y, z * k * 0.8);
      }
      g.translate(0, -len / 2, 0); g.computeVertexNormals(); return g;
    });
  }
  // Sculpted head: sphere warped into cranium, cheekbones, narrowing jaw and chin.
  function headGeo(shape, low) {
    return G('head' + shape + low, () => {
      const g = new THREE.SphereGeometry(0.1, low ? 9 : 20, low ? 7 : 15), p = g.attributes.position;
      const jawW = { oval: 0.7, round: 0.86, square: 0.9, long: 0.7 }[shape] || 0.74;
      const yS = shape === 'long' ? 1.14 : shape === 'round' ? 1.02 : 1.08;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ny = y / 0.1;
        let w = 0.8;
        if (ny < 0.1) { const t = Math.min(1, (0.1 - ny) / 1.1); w *= 1 - (1 - jawW) * (shape === 'square' ? t * t * t : t * t * 1.15); }
        if (ny > 0.2 && ny < 0.7 && z > 0) w *= 1 + 0.05 * Math.sin((ny - 0.2) / 0.5 * Math.PI);     // temples
        let zz = z * 0.95;
        if (z < 0) zz *= 1.08;                                                                         // occiput
        if (ny < -0.45 && z > 0) zz += (-0.45 - ny) * 0.02;                                            // chin forward
        if (ny < -0.2 && z < 0) zz *= 0.8;                                                             // under-jaw tuck
        if (z > 0 && ny > -0.3 && ny < 0.45) zz *= 0.96;                                               // flatter face plane
        p.setXYZ(i, x * w, y * yS, zz);
      }
      g.computeVertexNormals(); return g;
    });
  }
  // feet / shoes: rounded wedge
  function footGeo(kind, low) {
    return G('foot' + kind + low, () => {
      const g = new THREE.SphereGeometry(0.05, low ? 6 : 10, low ? 4 : 6), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y < -0.012) y = -0.012 - (y + 0.012) * 0.15;        // flat sole
        const front = z > 0 ? 1 + z * 2 : 1;                     // toe box longer than heel
        p.setXYZ(i, x * (kind === 'shoes' ? 0.92 : 0.85) * (z > 0.02 ? 1.05 : 1), y * (kind === 'shoes' ? 0.75 : 0.55), z * 2.3 * front * 0.9);
      }
      g.computeVertexNormals(); return g;
    });
  }

  // ------------------------------------------------------------ catalogue
  const SKINS = [0xe2b08b, 0xcf9a73, 0xb98059, 0xa36b45, 0x8d5a3b, 0x7a4a2e, 0x6b4028, 0x553220];
  const HAIR_COLORS = [0x141210, 0x2a1d15, 0x3d2817, 0x5a3a22, 0x8a8580, 0xd8d4cc];
  const EYES = [0x2a1a10, 0x3d2614, 0x5a3a1c, 0x4d5a2a, 0x3a4a5a];
  const PALETTE = [0xffffff, 0xf3efe6, 0xe8d8b0, 0xc8a26a, 0x8b6b3d, 0x4e4a42, 0x2b2b2b, 0x1f2a4d, 0x2f6fb3, 0x5fa8d3, 0x2e7d32, 0x7cb342, 0xf2c200,
    0xef6c00, 0xc62828, 0xad1457, 0xf48fb1, 0x7b1fa2, 0x00897b, 0x8d6e63, 0xb38b4d, 0x6d4c41, 0x37474f, 0x0d47a1];
  const OPTIONS = {
    gender: ['m', 'f'],
    face: ['oval', 'round', 'square', 'long'],
    brows: ['thin', 'medium', 'thick', 'arched'],
    hair: ['short', 'sidepart', 'curly', 'braid', 'bun', 'long', 'bald'],
    facial: ['none', 'moustache', 'beard', 'stubble', 'handlebar'],
    top: ['shirt', 'tshirt', 'kurta', 'kameez', 'blouse', 'school', 'uniform', 'vest'],
    bottom: ['trousers', 'jeans', 'lungi', 'dhoti', 'saree', 'salwar', 'schoolskirt', 'shorts'],
    feet: ['chappals', 'shoes', 'barefoot'],
    acc: ['sunglasses', 'watch', 'chain', 'bindi', 'bangles', 'earrings', 'cap', 'turban', 'towel'],
  };
  const pick = a => a[Math.random() * a.length | 0];

  // legacy { outfit, color } -> full appearance
  function normalize(o) {
    o = Object.assign({}, o || {});
    if (o.elder) {            // grandmother: blue saree, grey bun, a little shorter
      o.gender = o.gender || 'f';
      if (o.gender === 'f') { o.top = o.top || 'blouse'; o.bottom = o.bottom || 'saree'; if (o.topColor === undefined) o.topColor = 0x7a2632; if (o.bottomColor === undefined) o.bottomColor = 0x1f4c9c; o.hair = o.hair || 'bun'; }
      if (o.hairColor === undefined) o.hairColor = 0xb9b5ae;
      o.height = o.height || 0.97; if (!o.acc) o.acc = o.gender === 'f' ? { bindi: true, bangles: true, earrings: true } : {};
    }
    const female = o.gender === 'f' || o.gender === 'female'; o.gender = female ? 'f' : 'm';
    const col = o.color !== undefined ? o.color : pick([0x2f6fb3, 0xc62828, 0x2e7d32, 0x6a1b9a, 0xef6c00, 0xffffff, 0x795548]);
    if (!o.top || !o.bottom) {
      const outfit = o.outfit || (female ? 'saree' : 'shirt');
      const map = {
        saree: ['blouse', 'saree'], salwar: ['kameez', 'salwar'], lungi: ['shirt', 'lungi'], dhoti: ['shirt', 'dhoti'],
        school: female ? ['school', 'schoolskirt'] : ['school', 'shorts'], kurta: ['kurta', 'trousers'], tshirt: ['tshirt', 'jeans'],
        uniform: ['uniform', 'trousers'], shirt: ['shirt', Math.random() < 0.3 ? 'jeans' : 'trousers'],
      }[outfit] || ['shirt', 'trousers'];
      o.top = o.top || map[0]; o.bottom = o.bottom || map[1];
      if (outfit === 'school') { o.child = true; o.topColor = 0xf7f7f2; o.bottomColor = 0x1f2a4d; o.feet = 'shoes'; o.feetColor = 0x111111; }
      if (o.bottom === 'saree') { o.topColor = o.topColor !== undefined ? o.topColor : (o.blouse || 0x7b1fa2); o.bottomColor = o.bottomColor !== undefined ? o.bottomColor : col; }
      else if (o.bottom === 'salwar') { o.topColor = o.topColor !== undefined ? o.topColor : col; o.bottomColor = o.bottomColor !== undefined ? o.bottomColor : (o.bottom2 || 0xf3efe6); }
      else if (o.bottom === 'lungi') { o.topColor = o.topColor !== undefined ? o.topColor : col; o.bottomColor = o.bottomColor !== undefined ? o.bottomColor : pick([0xffffff, 0x9fc5e8, 0xb6d7a8, 0xf4cccc]); }
      else { o.topColor = o.topColor !== undefined ? o.topColor : col; }
    }
    if (o.topColor === undefined) o.topColor = col;
    if (o.bottomColor === undefined && o.bottom === 'jeans') o.bottomColor = pick([0x2c4a7a, 0x3a5a8c, 0x22304a]);
    if (o.bottomColor === undefined) o.bottomColor = pick([0x2b2b2b, 0x4e4a42, 0x2c3e50, 0x6d5d4b]);
    if (o.skin === undefined) o.skin = pick(SKINS.slice(2));
    if (!o.hair) o.hair = female ? pick(['braid', 'bun', 'long']) : o.child ? 'short' : pick(['short', 'sidepart', 'curly', 'short']);
    if (o.hairColor === undefined) o.hairColor = 0x141210;
    if (!o.facial) o.facial = female || o.child ? 'none' : pick(['moustache', 'moustache', 'none', 'stubble', 'beard']);
    if (!o.face) o.face = female ? 'oval' : pick(['oval', 'square', 'round']);
    if (!o.brows) o.brows = female ? 'arched' : 'medium';
    if (o.eyes === undefined) o.eyes = 0x2a1a10;
    if (!o.feet) o.feet = Math.random() < 0.7 ? 'chappals' : 'shoes';
    if (o.feetColor === undefined) o.feetColor = o.feet === 'shoes' ? 0x2a1c12 : 0x5a3a24;
    if (!o.acc) o.acc = female ? { bindi: true, bangles: Math.random() < 0.6, earrings: true } : {};
    if (o.accColor === undefined) o.accColor = 0xd4a530;
    o.height = o.height || 1; o.build = o.build || 1;
    return o;
  }

  function randomAppearance(gender) {
    const f = gender ? gender === 'f' : Math.random() < 0.5;
    const top = f ? pick(['blouse', 'kameez', 'kameez', 'tshirt', 'kurta']) : pick(['shirt', 'tshirt', 'kurta', 'shirt', 'vest']);
    const bottom = top === 'blouse' ? 'saree' : top === 'kameez' ? 'salwar' : f ? pick(['jeans', 'salwar']) : pick(['trousers', 'jeans', 'lungi', 'dhoti']);
    // village wardrobe by garment instead of any two random colours: bright saree with a contrasting blouse, muted
    // working shirts, checked lungis, off-white dhotis, a kameez with pale salwar
    const WR = { saree: [0xb3123f, 0x0f766e, 0x7c2d92, 0xd9730d, 0x1d4e9e, 0x2f7d32, 0xc2185b], blouse: [0xc98a10, 0x8a1538, 0x14532d, 0x1e3a8a, 0xe8dcc8],
      lungi: [0x2b4a73, 0x4a5f3a, 0x6b2f2f, 0x3f3f55], dhoti: [0xece6d6, 0xe4dcc8], shirt: [0xd9d4c6, 0x8fa8c0, 0xa8a48e, 0x7c8a6a, 0xc7b79a, 0x5f7a96, 0xb7c4cc], trousers: [0x2f3640, 0x4a4438, 0x3a3f4a, 0x57503f] };
    const topC = bottom === 'saree' ? pick(WR.blouse) : !f && top !== 'kurta' ? pick(WR.shirt) : pick(PALETTE);
    const botC = bottom === 'saree' ? pick(WR.saree) : WR[bottom] ? pick(WR[bottom]) : bottom === 'salwar' ? 0xefe9dc : pick(PALETTE);
    return normalize({
      gender: f ? 'f' : 'm', height: 0.94 + Math.random() * 0.12, build: 0.88 + Math.random() * 0.28, skin: pick([0x9a6a48, 0x8d5a3b, 0x7a4c30, 0x7a4a2e, 0x6b4028]),   // village tones; the full range stays in the creator's palette
      face: pick(OPTIONS.face), brows: f ? pick(['thin', 'arched']) : pick(['medium', 'thick']), eyes: pick(EYES),
      hair: f ? pick(['braid', 'bun', 'long']) : pick(['short', 'sidepart', 'curly', 'bald']), hairColor: pick(HAIR_COLORS.slice(0, 4)),
      facial: f ? 'none' : pick(OPTIONS.facial), top, bottom, topColor: topC, bottomColor: botC, feet: pick(['chappals', 'shoes']),
      acc: f ? { bindi: true, bangles: Math.random() < 0.7, earrings: Math.random() < 0.8, chain: Math.random() < 0.4 }
        : { watch: Math.random() < 0.5, chain: Math.random() < 0.3, sunglasses: Math.random() < 0.25, cap: Math.random() < 0.15 },
    });
  }

  // ------------------------------------------------------------ build
  function create(input) {
    if (!input || !input.lod || input.lod !== 'low') {
      // first full-detail human is the on-foot player (player.js builds it right after this file loads);
      // apply the saved appearance from the character creator, if any.
      if (!api.player && api.playerAppearance) input = Object.assign({}, input || {}, api.playerAppearance);
    }
    const o = normalize(input);
    const female = o.gender === 'f', low = o.lod === 'low';
    SEG = low ? 6 : 10; RINGS = low ? 1 : 2;
    const child = !!o.child;
    const s = (o.scale || (child ? 0.8 : female ? 0.9 : 0.95)) * (o.scale ? 1 : o.height);
    const bw = o.build * (female ? 0.94 : 1);              // girth multiplier
    const skinM = skinMat(o.skin), lipM = skinMat(new THREE.Color(o.skin).multiplyScalar(0.72).getHex());
    const hairM = new THREE.MeshPhongMaterial({ color: o.hairColor, specular: 0x333333, shininess: 30 });
    const hm = matCache['h' + o.hairColor] || (matCache['h' + o.hairColor] = hairM);
    const top = o.top, bot = o.bottom;
    const topKind = top === 'tshirt' || top === 'vest' ? 'knit' : top === 'uniform' ? 'khaki' : 'weave';
    const topM = cloth(top === 'uniform' ? 0xc2a36b : o.topColor, topKind);
    const botKind = bot === 'jeans' ? 'denim' : bot === 'lungi' ? 'check' : bot === 'saree' ? 'border' : top === 'uniform' && bot === 'trousers' ? 'khaki' : 'weave';
    const botColor = top === 'uniform' && bot === 'trousers' ? 0x9c7f4a : bot === 'jeans' && o.bottomColor === undefined ? 0x2c4a7a : o.bottomColor;
    const botM = cloth(botColor, botKind), botD = cloth(botColor, botKind, true);
    const feetM = o.feet === 'shoes' ? plain(o.feetColor, 40) : plain(o.feetColor);

    // which segments are covered
    const sleeveLong = top === 'kurta' || top === 'kameez' || top === 'uniform' || (top === 'shirt' && o.sleeves === 'long');
    const sleeveShort = top === 'shirt' && !sleeveLong || top === 'tshirt' || top === 'blouse' || top === 'school';
    const fullLegs = bot === 'trousers' || bot === 'jeans' || bot === 'salwar';
    const skirtLike = { lungi: [0.78, 0.165, 0.21, false], dhoti: [0.7, 0.165, 0.2, true], saree: [0.9, 0.17, 0.27, true], schoolskirt: [0.4, 0.16, 0.22, true] }[bot];

    const group = new THREE.Group(); group.userData.human = true;
    const body = joint(group, 0, 0, 0); body.scale.setScalar(s); body.name = 'humanBody';
    const hipH = 0.92;
    const hips = joint(body, 0, hipH, 0);

    // pelvis
    const pelPts = female ? [[0.0004, -0.11], [0.11, -0.09], [0.17, -0.01], [0.16, 0.05], [0.12, 0.09], [0.0004, 0.1]]
      : [[0.0004, -0.11], [0.11, -0.09], [0.155, -0.01], [0.148, 0.05], [0.125, 0.09], [0.0004, 0.1]];
    const pelS = (female ? [[-0.125, 0.05, 0.045], [-0.1, 0.13, 0.085], [-0.03, 0.172, 0.105], [0.04, 0.162, 0.1], [0.1, 0.135, 0.088]]
      : [[-0.125, 0.05, 0.045], [-0.1, 0.12, 0.08], [-0.03, 0.156, 0.095], [0.04, 0.15, 0.092], [0.1, 0.14, 0.088]]).map(r => [r[0], r[1] * bw, r[2] * bw, 0, 2.3]);
    void pelPts; mesh(loft('pel' + female + bw.toFixed(3), pelS, 18), fullLegs || bot === 'shorts' ? botM : skirtLike ? botM : skinM, hips);

    // torso: chest / waist silhouette (lathe), flattened front to back, with breasts / pecs
    const torso = joint(hips, 0, 0.04, 0);
    const torPts = female
      ? [[0.0004, -0.07], [0.15, -0.06], [0.125, 0.08], [0.112, 0.17], [0.138, 0.27], [0.152, 0.35], [0.155, 0.42], [0.145, 0.48], [0.075, 0.535], [0.045, 0.55], [0.0004, 0.555]]
      : [[0.0004, -0.07], [0.155, -0.06], [0.142, 0.08], [0.138, 0.18], [0.16, 0.3], [0.182, 0.4], [0.185, 0.46], [0.15, 0.51], [0.08, 0.545], [0.047, 0.56], [0.0004, 0.565]];
    const midriff = top === 'blouse' || top === 'vest';
    const torM = top === 'blouse' ? skinM : topM;
    // sculpted torso: waist -> ribcage -> chest -> armpits -> sloping shoulders -> neck base
    const torS = (female
      ? [[-0.07, 0.178, 0.112, 0], [0.04, 0.128, 0.088, 0], [0.13, 0.118, 0.084, 0.004], [0.22, 0.132, 0.09, 0.008], [0.3, 0.148, 0.098, 0.012], [0.38, 0.158, 0.1, 0.01],
         [0.44, 0.168, 0.092, 0], [0.48, 0.165, 0.08, -0.006], [0.515, 0.13, 0.066, -0.008], [0.545, 0.075, 0.056, -0.004], [0.565, 0.05, 0.048, 0]]
      : [[-0.07, 0.16, 0.108, 0], [0.04, 0.15, 0.1, 0], [0.14, 0.152, 0.104, 0.004], [0.24, 0.164, 0.112, 0.01], [0.33, 0.178, 0.12, 0.014], [0.4, 0.188, 0.118, 0.012],
         [0.45, 0.194, 0.104, 0], [0.49, 0.184, 0.086, -0.008], [0.525, 0.138, 0.068, -0.01], [0.553, 0.08, 0.058, -0.004], [0.575, 0.052, 0.05, 0]]).map(r => [r[0], r[1] * bw, r[2] * bw, r[3], r[0] > 0.42 ? 2.2 : 2.6]);
    void torPts; mesh(loft('tor' + female + bw.toFixed(3), torS, 18), torM, torso);
    if (top === 'blouse') {     // fitted short blouse over the chest, midriff bare
      mesh(loft('blouse' + female + bw.toFixed(3), torS.filter(r => r[0] >= 0.22).map(r => [r[0], r[1] * 1.03 + 0.002, r[2] * 1.04 + 0.002, r[3], r[4]]), 18), topM, torso);
    }
    if (top === 'vest') {       // sleeveless banian: skin shoulders
      for (const sx of [-1, 1]) { const sh = mesh(sphere(0.06, SEG, 6), skinM, torso, sx * 0.145 * bw, 0.47, 0); sh.scale.set(1, 0.7, 0.9); }
    }
    if (female && !low) for (const sx of [-1, 1]) {
      const b = mesh(sphere(0.058, 10, 7), topM, torso, sx * 0.06 * bw, 0.35, 0.068 * bw); b.scale.set(1, 0.9, 0.7);
    } else if (!low && !midriff) {
      for (const sx of [-1, 1]) { const pc = mesh(sphere(0.07, 10, 6), topM, torso, sx * 0.072 * bw, 0.39, 0.068 * bw); pc.scale.set(1.1, 0.62, 0.45); }
    }
    // neck and trapezius
    mesh(limb(0.054, 0.06, 0.09, 0, 0.5, 9), skinM, torso, 0, 0.61, 0.01);
    if (!low) { const tr = mesh(sphere(0.09, 12, 6), top === 'blouse' || top === 'vest' ? topM : torM, torso, 0, 0.5, -0.012); tr.scale.set(1.55 * bw, 0.45, 0.7 * bw); }

    // clothing details
    if (!low) {
      if (top === 'shirt' || top === 'school' || top === 'uniform') {
        for (const sx of [-1, 1]) {   // collar flaps
          const c = mesh(G('collar', () => { const g = new THREE.CircleGeometry(0.036, 3); g.scale(1, 0.7, 1); return g; }), cloth(top === 'uniform' ? 0xc2a36b : o.topColor, 'weave', true), torso, sx * 0.035, 0.53, 0.065);
          c.rotation.set(-0.5, sx * 0.5, sx * 0.4 + Math.PI);
        }
        const btn = plain(0xeeeeee, 30);
        for (let i = 0; i < 4; i++) mesh(sphere(0.006, 5, 3), btn, torso, 0, 0.46 - i * 0.1, 0.098 * bw * (i < 2 ? 1.04 : 0.97));
        if (top === 'uniform') {
          mesh(torus(0.15, 0.016, 4, 22), plain(0x3b2614, 30), torso, 0, -0.035, 0).scale.set(bw, 1, 0.63 * bw);
          for (const sx of [-1, 1]) { const ep = mesh(sphere(0.04, 6, 4), cloth(0xa0864f, 'khaki'), torso, sx * 0.13 * bw, 0.5, 0); ep.scale.set(1.2, 0.25, 0.8); }
          mesh(sphere(0.012, 6, 4), metal(0xd8d8d8), torso, 0.09 * bw, 0.37, 0.1 * bw);
        }
        if (top === 'school') {   // tie
          const tie = mesh(G('tie', () => { const g = new THREE.ConeGeometry(0.024, 0.24, 4); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.25); return g; }), cloth(0x8b1a1a, 'weave'), torso, 0, 0.38, 0.1); tie.rotation.x = Math.PI + 0.12;
        }
      }
      if (top === 'kurta' || top === 'kameez') {   // neckline placket
        mesh(G('plk', () => new THREE.PlaneGeometry(0.02, 0.14)), cloth(new THREE.Color(o.topColor).multiplyScalar(0.8).getHex(), 'weave'), torso, 0, 0.47, 0.1 * bw).rotation.x = -0.25;
      }
      if (top === 'tshirt') { const nk = mesh(torus(0.055, 0.008, 4, 14), topM, torso, 0, 0.545, 0.012); nk.rotation.x = Math.PI / 2 + 0.3; }
      if (fullLegs && (top === 'shirt' || top === 'tshirt' || top === 'school') && bot !== 'salwar') mesh(torus(0.147, 0.012, 4, 22), plain(0x2a1c12, 30), torso, 0, -0.02, 0).scale.set(bw, 1, 0.64 * bw);
    }

    // head
    // the sculpted heroes keep their own bind proportions; everyone else had a pin head (about 1/9 of the figure)
    const sculptKind = o.sculpt || (low ? null : o.elder && female ? 'grandma'
      : !api.player && !api.playerAppearance && !o.child && o.gender === 'm' && bot === 'lungi' && top === 'shirt' ? 'player' : null);
    const head = joint(torso, 0, 0.575, 0.02); head.scale.setScalar(sculptKind ? 1.1 : child ? 1.38 : 1.27);
    const headY = 0.11;
    const hd = mesh(headGeo(o.face, low), skinM, head, 0, headY, 0);
    const fz = 0.091;  // approx face-plane depth at eye level
    if (!low) {
      // eyes: whites, iris, pupil
      const white = plain(0xf4efe6, 40), irisM = plain(o.eyes, 60), pupilM = plain(0x050505);
      for (const sx of [-1, 1]) {
        const ex = sx * 0.031, ey = headY + 0.012;
        const w = mesh(sphere(0.0145, 7, 5), white, head, ex, ey, fz - 0.012); w.scale.set(1.2, 0.72, 0.8);
        const ir = mesh(G('iris', () => new THREE.CircleGeometry(0.0072, 12)), irisM, head, ex, ey, fz - 0.0003);
        const pu = mesh(G('pupil', () => new THREE.CircleGeometry(0.0033, 8)), pupilM, head, ex, ey, fz);
        ir.castShadow = pu.castShadow = false;
        // upper lid crease
        const lid = mesh(sphere(0.0155, 7, 3), skinM, head, ex, ey + 0.004, fz - 0.013); lid.scale.set(1.25, 0.6, 0.85);
        lid.position.y += 0.0035;
        // eyebrow
        const bt = { thin: 0.0028, medium: 0.004, thick: 0.0058, arched: 0.0034 }[o.brows] || 0.004;
        const br = mesh(G('brow' + o.brows, () => { const g = new THREE.TorusGeometry(0.03, bt, 4, 10, o.brows === 'arched' ? 1.4 : 1.1); g.rotateZ(Math.PI / 2 - (o.brows === 'arched' ? 0.7 : 0.55)); g.translate(0, -0.026, 0); return g; }), hm, head, ex, ey + 0.021, fz - 0.002);
        br.rotation.z = sx > 0 ? -0.12 : 0.12; br.scale.x = sx * (female ? 0.95 : 1.05); br.scale.z = 0.5;
        // ears
        const ear = mesh(G('ear', () => { const g = new THREE.SphereGeometry(0.024, 8, 6); g.scale(0.4, 1, 0.75); return g; }), skinM, head, sx * 0.081, headY - 0.002, -0.004);
        ear.rotation.y = sx * 0.3;
      }
      // nose: bridge + tip + nostrils
      const nose = mesh(G('nose', () => { const g = new THREE.CylinderGeometry(0.005, 0.012, 0.046, 8, 1); g.translate(0, -0.023, 0); g.scale(1, 1, 1.1); return g; }), skinM, head, 0, headY + 0.01, fz + 0.001);
      nose.rotation.x = 0.22; nose.position.z = fz - 0.003;
      mesh(sphere(0.0095, 8, 6), skinM, head, 0, headY - 0.03, fz + 0.003).scale.set(1.2, 0.8, 0.85);
      for (const sx of [-1, 1]) mesh(sphere(0.0065, 6, 4), skinM, head, sx * 0.0095, headY - 0.033, fz - 0.003);
      // lips
      const lipCol = female ? skinMat(new THREE.Color(o.skin).lerp(new THREE.Color(0xa0303a), 0.45).getHex()) : lipM;
      const up = mesh(G('lipU', () => { const g = new THREE.SphereGeometry(0.02, 10, 6); g.scale(0.95, 0.22, 0.32); return g; }), lipCol, head, 0, headY - 0.055, fz - 0.007);
      const lo = mesh(G('lipL', () => { const g = new THREE.SphereGeometry(0.018, 10, 6); g.scale(0.95, 0.28, 0.34); return g; }), lipCol, head, 0, headY - 0.063, fz - 0.009);
      // cheekbones and chin
    } else {
      // the far figure still needs a readable face: eyes with a white, brows, a nose with a bridge, and a mouth
      const eyeG = G('eyeLow', () => { const g = new THREE.SphereGeometry(0.0085, 5, 4); g.scale(1.25, 0.8, 0.6); return g; }), dark = plain(0x1a1210);
      const browG = G('browLow', () => new THREE.BoxGeometry(0.026, 0.005, 0.006));
      for (const sx of [-1, 1]) {
        mesh(eyeG, dark, head, sx * 0.031, headY + 0.012, fz - 0.004);
        const b = mesh(browG, hm, head, sx * 0.031, headY + 0.03, fz - 0.003); b.rotation.z = sx * -0.14;
      }
      const nz = mesh(G('noseLow', () => { const g = new THREE.CylinderGeometry(0.005, 0.012, 0.04, 5, 1); g.translate(0, -0.02, 0); return g; }), skinM, head, 0, headY + 0.012, fz - 0.002); nz.rotation.x = 0.3;
      mesh(G('lipLow', () => new THREE.BoxGeometry(0.03, 0.007, 0.006)), lipM, head, 0, headY - 0.058, fz - 0.004);
    }
    buildHair(o, head, headY, hm, low, female);
    buildFacial(o, head, headY, hm, low);

    // arms: shoulder -> upper arm -> elbow -> forearm -> hand
    const shW = (female ? 0.164 : 0.186) * bw;       // lean shoulders: the arm sits at the end of the chest, not out on a stalk
    function arm(sx) {
      const sh = joint(torso, sx * shW, 0.455, 0); sh.rotation.z = sx * 0.06;
      // deltoid
      mesh(sphere(0.046 * bw, SEG + 2, low ? 4 : 8), sleeveLong || sleeveShort ? topM : skinM, sh, 0, -0.012, 0).scale.set(1, 1.08, 1);
      mesh(limb((sleeveShort ? 0.044 : 0.05) * bw, 0.038 * bw, 0.28, sleeveShort ? 0 : 0.008, 0.65), sleeveLong ? topM : skinM, sh);
      if (sleeveShort) mesh(limb(0.047 * bw, (top === 'blouse' ? 0.043 : 0.048) * bw, top === 'blouse' ? 0.1 : 0.17, 0, 0.5), topM, sh, 0, -0.012, 0);
      const el = joint(sh, 0, -0.285, 0);
      mesh(limb(0.038 * bw, 0.027 * bw, 0.24, 0.008, 0.75), sleeveLong ? topM : skinM, el);
      if (sleeveLong) mesh(limb(0.031 * bw, 0.03 * bw, 0.03, 0, 0.5, 8), skinM, el, 0, -0.215, 0);
      // hand: palm, finger block, thumb
      const hand = joint(el, 0, -0.245, 0.002);
      const palm = mesh(sphere(0.036, low ? 5 : 7, low ? 4 : 5), skinM, hand, 0, -0.03, 0); palm.scale.set(0.55, 1.05, 0.95);
      if (!low) {
        const fing = mesh(limb(0.017, 0.012, 0.06, 0, 0.5, 7), skinM, hand, 0, -0.055, 0.004); fing.scale.set(1.15, 1, 2.1); fing.rotation.x = -0.25;
        const th = mesh(limb(0.011, 0.008, 0.045, 0, 0.5, 5), skinM, hand, 0, -0.02, 0.024); th.rotation.set(-0.7, 0, sx * 0.35);
      }
      return [sh, el, hand];
    }
    const [armL, foreL, handL] = arm(1), [armR, foreR, handR] = arm(-1);

    // legs: hip -> thigh -> knee -> shin -> foot
    const loose = bot === 'salwar', shorts = bot === 'shorts', dhoti = bot === 'dhoti';
    function leg(sx) {
      const hp = joint(hips, sx * 0.08 * bw, -0.03, 0);
      const thighM = fullLegs || shorts ? botM : skinM;
      mesh(limb((loose ? 0.09 : 0.078) * bw, (loose ? 0.07 : 0.052) * bw, 0.43, 0.012, 0.65), thighM, hp);
      if (shorts) mesh(limb(0.084 * bw, 0.072 * bw, 0.26, 0, 0.5), botM, hp);
      const kn = joint(hp, 0, -0.435, 0);
      const shinM = fullLegs ? botM : skinM;
      mesh(limb((loose ? 0.068 : 0.054) * bw, (loose ? 0.042 : 0.034) * bw, 0.41, 0.014, 0.72), shinM, kn);
      if (loose && !low) mesh(torus(0.04, 0.008, 4, 10), botM, kn, 0, -0.38, 0).rotation.x = Math.PI / 2;
      if (child && !low && o.feet === 'shoes') mesh(limb(0.04, 0.036, 0.12, 0, 0.5), plain(0xf2f2f2), kn, 0, -0.29, 0);   // socks
      // ankle + foot
      if (o.feet !== 'shoes') mesh(sphere(0.03, low ? 5 : 8, low ? 3 : 5), skinM, kn, 0, -0.43, 0.005);
      const fg = joint(kn, 0, -0.455, 0.035);
      if (o.feet === 'barefoot' || o.feet === 'chappals') {
        mesh(footGeo('bare', low), skinM, fg, 0, 0.004, 0);
        if (o.feet === 'chappals') {
          const sole = mesh(G('sole', () => { const g = new THREE.CylinderGeometry(0.05, 0.05, 0.012, low ? 8 : 14); g.scale(0.9, 1, 2.3); return g; }), feetM, fg, 0, -0.022, 0.012);
          if (!low) { const st = mesh(torus(0.03, 0.006, 4, 10, Math.PI), feetM, fg, 0, -0.014, 0.04); st.rotation.y = Math.PI / 2; st.rotation.z = 0; st.scale.set(1, 0.8, 1.2); }
        }
      } else mesh(footGeo('shoes', low), feetM, fg, 0, 0.002, 0.004);
      return [hp, kn];
    }
    const [legL, shinL] = leg(1), [legR, shinR] = leg(-1);
    const parts = { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR };
    Object.defineProperty(parts, '_narrow', { value: bot === 'saree' || bot === 'schoolskirt' ? 0.62 : bot === 'lungi' || bot === 'dhoti' ? 0.85 : 1, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(parts, '_stoop', { value: o.elder ? 0.26 : 0, enumerable: false, writable: true, configurable: true });

    // skirts and drapes
    let hem = null;
    if (top === 'kurta' || top === 'kameez') hem = [top === 'kameez' ? 0.5 : 0.46, 0.15, 0.215, false, topM === topM ? cloth(o.topColor, 'weave', true) : null];
    if (skirtLike) {
      const sk = joint(hips, 0, 0.045, 0);
      mesh(skirt(skirtLike[0] * (child ? 1 : 1), skirtLike[1] * bw, skirtLike[2] * bw, skirtLike[3], low ? 10 : 26), botD, sk);
      if (bot === 'lungi' && !low) { const knot = mesh(sphere(0.03, 8, 6), botD, sk, 0.03, -0.01, 0.105 * bw); knot.scale.set(1.3, 0.7, 0.6); }
      if (bot === 'dhoti' && !low) mesh(ribbon('dhotiTuck', [[0, -0.02, 0.12], [0.01, -0.2, 0.15], [-0.01, -0.45, 0.16], [0, -0.66, 0.16]], 0.11), botD, sk);
      parts.skirt = sk;
    }
    if (hem) {
      const hj = joint(hips, 0, 0.03, 0);
      mesh(skirt(hem[0], hem[1] * bw, hem[2] * bw, false, low ? 10 : 22), hem[4], hj);
      if (!parts.skirt) parts.skirt = hj; else parts.skirt2 = hj;
    }
    if (bot === 'saree') {        // pallu from right hip across chest, over the left shoulder, down the back
      mesh(ribbon('pallu' + female, [[-0.15, -0.0, 0.07], [-0.07, 0.17, 0.11], [0.05, 0.33, 0.115], [0.13, 0.47, 0.06], [0.15, 0.5, -0.05], [0.14, 0.32, -0.12], [0.14, 0.02, -0.13], [0.15, -0.38, -0.16]], 0.2), botD, torso);
      if (!low) mesh(ribbon('waistband', [[-0.15, 0.0, 0.03], [-0.09, 0.0, 0.085], [0, 0.0, 0.095], [0.09, 0.0, 0.085], [0.15, 0.0, 0.03]], 0.05), botD, torso);
    }
    if (top === 'kameez' || o.dupatta) {
      const dm = cloth(o.dupattaColor !== undefined ? o.dupattaColor : (o.bottomColor === 0xf3efe6 ? 0xf8bbd0 : o.bottomColor), 'weave', true);
      mesh(ribbon('dupatta', [[0.15, 0.48, -0.06], [0.14, 0.49, 0.05], [0.07, 0.37, 0.115], [0, 0.33, 0.12], [-0.07, 0.37, 0.115], [-0.14, 0.49, 0.05], [-0.15, 0.48, -0.06], [-0.15, 0.2, -0.11], [-0.15, -0.1, -0.12]], 0.13), dm, torso);
    }

    // accessories
    const acc = o.acc || {}, gold = metal(o.accColor || 0xd4a530);
    if (!low) {
      if (acc.watch) { const w = mesh(torus(0.03, 0.007, 5, 14), plain(0x222222, 30), foreR, 0, -0.205, 0); w.rotation.x = Math.PI / 2; const f = mesh(G('wf', () => new THREE.CylinderGeometry(0.013, 0.013, 0.006, 12)), metal(0xc0c0c0), foreR, 0, -0.205, 0.032); f.rotation.x = Math.PI / 2; }
      if (acc.bangles) for (const fr of [foreL, foreR]) for (let i = 0; i < 3; i++) { const b = mesh(torus(0.034, 0.0045, 3, 10), i === 1 ? plain(0xc62828, 50) : gold, fr, 0, -0.18 - i * 0.012, 0); b.rotation.x = Math.PI / 2; }
      if (acc.chain) { const c = mesh(torus(0.072, 0.0035, 4, 24), gold, torso, 0, 0.52, 0.03); c.rotation.x = Math.PI / 2 - 0.7; c.scale.set(1.15 * bw, 1, 1); }
      if (acc.bindi) mesh(sphere(0.0055, 6, 4), plain(0xc0101a, 40), head, 0, headY + 0.04, fz + 0.001);
      if (acc.earrings) for (const sx of [-1, 1]) mesh(sphere(0.007, 6, 4), gold, head, sx * 0.083, headY - 0.03, 0);
      if (acc.sunglasses) {
        const gm = plain(0x0a0a0a, 90);
        for (const sx of [-1, 1]) { const l = mesh(sphere(0.022, 10, 6), gm, head, sx * 0.032, headY + 0.012, fz + 0.002); l.scale.set(1.1, 0.75, 0.25); }
        const bar = mesh(limb(0.003, 0.003, 0.15, 0, 0.5, 4), gm, head, -0.075, headY + 0.02, fz - 0.005); bar.rotation.z = Math.PI / 2;
        for (const sx of [-1, 1]) { const arm = mesh(limb(0.003, 0.003, 0.09, 0, 0.5, 4), gm, head, sx * 0.083, headY + 0.02, fz - 0.004); arm.rotation.x = Math.PI / 2; }
      }
    }
    if (acc.cap) {
      const cm = cloth(o.capColor !== undefined ? o.capColor : (top === 'uniform' ? 0x8a6d3b : 0x1f2a4d), top === 'uniform' ? 'khaki' : 'weave');
      const c = mesh(G('cap', () => new THREE.SphereGeometry(0.112, SEG + 2, 6, 0, Math.PI * 2, 0, 1.45)), cm, head, 0, headY + 0.012, -0.006); c.scale.set(0.86, 0.9, 1);
      const br = mesh(G('brim', () => { const g = new THREE.CylinderGeometry(0.09, 0.09, 0.006, 14, 1, false, -Math.PI / 2, Math.PI); g.scale(0.8, 1, 0.75); return g; }), cm, head, 0, headY + 0.03, 0.07); br.rotation.x = 0.12;
    } else if (acc.turban) {
      const tm = cloth(o.turbanColor !== undefined ? o.turbanColor : 0xffffff, 'weave');
      for (let i = 0; i < (low ? 2 : 4); i++) { const t = mesh(torus(0.09 - i * 0.012, 0.024, 6, SEG + 4), tm, head, 0, headY + 0.045 + i * 0.024, -0.008); t.rotation.x = Math.PI / 2 + 0.15; t.scale.set(0.92, 1.05, 1); }
      mesh(sphere(0.06, 10, 6), tm, head, 0, headY + 0.1, -0.01).scale.set(1.1, 0.6, 1.1);
    }
    if (acc.towel && !low) mesh(ribbon('towel', [[0.13, 0.47, 0.06], [0.15, 0.5, -0.02], [0.13, 0.48, -0.07], [-0.13, 0.48, -0.07], [-0.15, 0.5, -0.02], [-0.13, 0.47, 0.06]], 0.08), cloth(0xf4f0e0, 'check', true), torso);

    // ~30 small meshes per figure: merge each joint's own meshes into one mesh per material (joints still pose)
    if (typeof TrafficModels !== 'undefined' && TrafficModels.mergeUnder) {
      const pv = Object.values(parts).filter(p => p && p.isObject3D), all = new Set(pv);
      for (const p of pv) TrafficModels.mergeUnder(p, new Set(pv.filter(q => q !== p)));
    }
    group.traverse(m => { if (m.isMesh) m.castShadow = true; });
    animateIdle(parts, Math.random() * 10);
    const res = { group, parts, hipHeight: hipH * s, scale: s, appearance: o };
    group.userData.humanRef = res;
    // hero characters: one continuous sculpted skinned mesh (sculpt-people.js) instead of the part meshes
    if (sculptKind && window.SculptPeople) {
      try { SculptPeople.attach(res, sculptKind); animateIdle(parts, Math.random() * 10); } catch (e) { console.warn('sculpt failed', e); }
    }
    if (!low && !api.player) api.player = res;
    if (!res.sculpt) glbRegister(res);
    return res;
  }

  function buildHair(o, head, y, hm, low, female) {
    const st = o.hair; if (st === 'bald') return;
    const sg = low ? 8 : 16, sr = low ? 5 : 9;
    // scalp: the head surface above a hairline (high on the forehead, down to the nape at the back), pushed out
    const longH = st === 'braid' || st === 'bun' || st === 'long';
    const cap = mesh(G('scalp' + o.face + low + longH + st, () => {
      const src = headGeo(o.face, low), p = src.attributes.position, idx = src.index.array, keep = [];
      const pos = p.clone(), n = src.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const k = st === 'curly' ? 1.1 : longH ? 1.07 : 1.06;
        pos.setXYZ(i, p.getX(i) * k, p.getY(i) * k + 0.004, p.getZ(i) * k - 0.002);
      }
      for (let i = 0; i < idx.length; i += 3) {
        let cy = 0, cz = 0, cx = 0; for (let k = 0; k < 3; k++) { cx += p.getX(idx[i + k]) / 3; cy += p.getY(idx[i + k]) / 3; cz += p.getZ(idx[i + k]) / 3; }
        const front = cz / 0.1, side = Math.abs(cx) / 0.08;
        // hairline height: forehead ~0.045, temples lower, behind the ears down to the nape
        let line = front > 0.55 ? 0.05 - (st === 'sidepart' && cx < 0 ? 0.008 : 0) : front > 0 ? 0.05 - (0.55 - front) * 0.09 : (longH ? -0.07 : -0.045) + front * 0.02;
        if (front > 0 && front < 0.55 && side > 0.7) line = Math.min(line, 0.01);
        if (cy > line) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', pos); g.setAttribute('normal', n.clone()); g.setIndex(keep); return g;
    }), hm, head, 0, y, 0);
    if (low) { if (st === 'bun') mesh(sphere(0.045, 6, 4), hm, head, 0, y - 0.02, -0.1); if (st === 'braid' || st === 'long') { const b = mesh(limb(0.03, 0.02, 0.32, 0, 0.5), hm, head, 0, y - 0.03, -0.085); b.rotation.x = 0.15; } return; }
    if (st === 'sidepart') {
      const sw = mesh(sphere(0.07, 12, 8), hm, head, 0.015, y + 0.058, 0.02); sw.scale.set(1.2, 0.45, 1.05); sw.rotation.z = 0.15;
      const p = mesh(sphere(0.05, 10, 6), hm, head, -0.04, y + 0.058, 0.0); p.scale.set(0.95, 0.45, 1.2);
    } else if (st === 'short') {
      const f = mesh(sphere(0.07, 12, 8), hm, head, 0, y + 0.058, 0.008); f.scale.set(1.15, 0.38, 1.1);
    } else if (st === 'curly') {
      const curl = G('curl', () => new THREE.SphereGeometry(0.03, 7, 5));
      for (let i = 0; i < 22; i++) {
        const th = (i * 2.399) % (Math.PI * 2), ph = 0.2 + (i / 22) * 1.2;
        const x = Math.sin(ph) * Math.sin(th) * 0.098, yy = Math.cos(ph) * 0.11, z = Math.sin(ph) * Math.cos(th) * 0.102 - 0.01;
        if (z > 0.05 && yy < 0.05) continue;
        mesh(curl, hm, head, x * 0.92, y + yy + 0.012, z).rotation.set(i, i * 2, 0);
      }
    }
    if (female || st === 'long' || st === 'braid' || st === 'bun') {
      // side volume framing the face
      for (const sx of [-1, 1]) { const sv = mesh(sphere(0.05, 9, 7), hm, head, sx * 0.068, y + 0.02, -0.02); sv.scale.set(0.5, 1.2, 1.15); }
    }
    if (st === 'bun') {
      mesh(sphere(0.046, 12, 10), hm, head, 0, y + 0.0, -0.112);
      mesh(torus(0.04, 0.012, 6, 14), plain(0xfafafa), head, 0, y + 0.0, -0.105).scale.set(1, 1, 0.6);   // jasmine strand
    } else if (st === 'braid') {
      for (let i = 0; i < 9; i++) { const b = mesh(sphere(0.026 - i * 0.0012, 6, 4), hm, head, (i % 2 ? 0.006 : -0.006), y - 0.03 - i * 0.042, -0.1 - Math.min(i, 3) * 0.008); b.scale.set(1, 1.3, 0.9); }
      mesh(sphere(0.012, 6, 4), plain(0xc62828), head, 0, y - 0.03 - 9 * 0.042, -0.12);
    } else if (st === 'long') {
      const back = mesh(G('hlong', () => { const g = new THREE.CylinderGeometry(0.088, 0.105, 0.34, 16, 3, true, Math.PI / 2 + 0.15, Math.PI - 0.3); g.translate(0, -0.17, 0); g.scale(1, 1, 0.75); return g; }), hm, head, 0, y + 0.03, -0.02);
      back.material = matCache['hd' + o.hairColor] || (matCache['hd' + o.hairColor] = new THREE.MeshPhongMaterial({ color: o.hairColor, specular: 0x333333, shininess: 30, side: THREE.DoubleSide }));
      back.rotation.x = 0.1;
    }
  }
  function buildFacial(o, head, y, hm, low) {
    const f = o.facial; if (!f || f === 'none') return;
    const fz = 0.091;
    if (f === 'beard' || f === 'stubble') {
      const g = G('beard' + o.face + low + f, () => {
        const src = headGeo(o.face, low), p = src.attributes.position, idx = src.index.array, keep = [];
        for (let i = 0; i < idx.length; i += 3) {
          let cy = 0, cz = 0; for (let k = 0; k < 3; k++) { cy += p.getY(idx[i + k]) / 3; cz += p.getZ(idx[i + k]) / 3; }
          if (cy < -0.028 && cz > -0.035 && !(f === 'stubble' && cy > -0.07 && cz > 0.07 && Math.abs(p.getX(idx[i])) < 0.02)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', p.clone()); g.setAttribute('normal', src.attributes.normal.clone()); g.setIndex(keep);
        return g;
      });
      const m = f === 'stubble' ? (matCache['stub' + o.hairColor] || (matCache['stub' + o.hairColor] = new THREE.MeshLambertMaterial({ color: o.hairColor, transparent: true, opacity: 0.35, depthWrite: false }))) : hm;
      const b = mesh(g, m, head, 0, y - (f === 'beard' ? 0.004 : 0), f === 'beard' ? 0.006 : 0.001);
      const k = f === 'beard' ? 1.09 : 1.012; b.scale.set(k, f === 'beard' ? 1.06 : 1.005, k);
    }
    if (f === 'moustache' || f === 'beard' || f === 'handlebar' || f === 'stubble') {
      if (low) { mesh(G('mustLow', () => { const g = new THREE.BoxGeometry(0.046, 0.011, 0.008); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) > 0.02) p.setY(i, p.getY(i) - 0.006); return g; }), hm, head, 0, y - 0.044, fz + 0.001); return; }   // centred under the nose, ends drooping
      const th = f === 'handlebar' ? 1.9 : 1.35;
      const mo = mesh(G('must' + f, () => { const g = new THREE.TorusGeometry(0.026, f === 'stubble' ? 0.0045 : 0.0085, 6, 14, th); g.rotateZ(-Math.PI / 2 - th / 2 + Math.PI); g.scale(1, 0.55, 0.6); return g; }), hm, head, 0, y - 0.043, fz + 0.001);
      mo.rotation.x = 0.1;
    }
  }

  // ------------------------------------------------------------ animation
  // Walk / run cycle. phase advances with distance; speed in m/s (about 1.4 walking, 5 running).
  function animateWalk(p, phase, speed) {
    if (glbDrive(p, Math.abs(speed) > 2.6 ? 'run' : 'walk', speed)) return;
    const sp = Math.abs(speed), k = Math.min(1, sp / 1.6), run = Math.min(1, Math.max(0, (sp - 2.2) / 2.3));
    const amp = (0.48 + run * 0.4) * k * (p._narrow || 1), s = Math.sin(phase), c = Math.cos(phase), dir = speed < 0 ? -1 : 1;
    p.legL.rotation.set(-s * amp * dir, 0, 0.02); p.legR.rotation.set(s * amp * dir, 0, -0.02);
    // knee bends on the swing (leg moving forward) plus a little at heel strike; bigger when running
    p.shinL.rotation.x = k * (0.12 + run * 0.5 + Math.max(0, c) * (0.85 + run * 0.9));
    p.shinR.rotation.x = k * (0.12 + run * 0.5 + Math.max(0, -c) * (0.85 + run * 0.9));
    p.armL.rotation.set(s * amp * 0.8 * dir, 0, 0.07 + run * 0.08); p.armR.rotation.set(-s * amp * 0.8 * dir, 0, -0.07 - run * 0.08);
    p.foreL.rotation.x = -0.2 - k * (0.15 + run * 1.1) - Math.max(0, -s) * 0.3 * k;
    p.foreR.rotation.x = -0.2 - k * (0.15 + run * 1.1) - Math.max(0, s) * 0.3 * k;
    // counter-rotation of shoulders and pelvis, lateral hip sway and drop over the stance leg
    p.torso.rotation.set(0.03 * k + run * 0.16, s * (0.13 + run * 0.06) * k, -s * 0.03 * k);
    p.hips.rotation.set(0, -s * 0.09 * k, s * 0.045 * k * (1 - run * 0.5));
    p.hips.position.x = s * 0.018 * k * (1 - run);
    p.hips.position.y = 0.92 - (1 - Math.abs(c)) * 0.02 * k + Math.abs(c) * run * 0.03 - run * 0.03;
    p.head.rotation.set(-p.torso.rotation.x * 0.7, -p.torso.rotation.y * 0.6, -p.torso.rotation.z);
    // lungi / saree / kurta hem: swings after the legs (a quarter cycle behind), twists with the pelvis, flares at the hem
    // when the knees part, and kicks back a little when running
    const lag = Math.sin(phase - 0.6), spread = Math.abs(s) * k;
    if (p.skirt) { p.skirt.rotation.set(-run * 0.15 + lag * 0.07 * k * dir, s * 0.06 * k, lag * 0.05 * k); p.skirt.scale.set(1 + spread * 0.07, 1, 1 + spread * 0.3); }
    if (p.skirt2) { p.skirt2.rotation.set(-run * 0.12 + lag * 0.05 * k * dir, s * 0.05 * k, lag * 0.04 * k); p.skirt2.scale.set(1 + spread * 0.05, 1, 1 + spread * 0.08); }
    if (p._stoop) { const q = p._stoop; p.torso.rotation.x += q; p.head.rotation.x -= q * 0.75; p.armL.rotation.x -= q * 0.8; p.armR.rotation.x -= q * 0.8; p.hips.rotation.x += q * 0.12; }
  }
  // Turning on the spot: small alternating steps (feet shuffle round) instead of the body spinning on frozen legs.
  function animateTurn(p, t, rate) {
    if (glbDrive(p, 'walk', 0.6)) return;
    const k = Math.min(1, Math.abs(rate) / 2.5), s = Math.sin(t * 9);
    animateIdle(p, t);
    p.legL.rotation.x = -Math.max(0, s) * 0.25 * k; p.legR.rotation.x = -Math.max(0, -s) * 0.25 * k;
    p.shinL.rotation.x = 0.05 + Math.max(0, s) * 0.4 * k; p.shinR.rotation.x = 0.05 + Math.max(0, -s) * 0.4 * k;
    p.hips.rotation.y = Math.sign(rate) * 0.06 * k; p.head.rotation.y = Math.sign(rate) * 0.2 * k;
  }
  // Standing idle: breathing, slow weight shift between feet, glances, relaxed arms.
  function animateIdle(p, t) {
    if (glbDrive(p, 'idle', 0)) return;
    const b = Math.sin(t * 1.7), w = Math.sin(t * 0.35), wl = Math.max(0, w), wr = Math.max(0, -w);
    p.hips.position.set(w * 0.02, 0.92 - Math.abs(w) * 0.008, 0);
    p.hips.rotation.set(0, 0, w * 0.035);
    p.legL.rotation.set(0, 0, 0.02 - w * 0.035); p.legR.rotation.set(0, 0, -0.02 - w * 0.035);
    p.shinL.rotation.x = 0.03 + wr * 0.12; p.shinR.rotation.x = 0.03 + wl * 0.12;
    p.legL.rotation.x = -wr * 0.06; p.legR.rotation.x = -wl * 0.06;
    p.torso.rotation.set(0.01 + b * 0.012, Math.sin(t * 0.4) * 0.04, -w * 0.04);
    p.torso.scale.set(1 + b * 0.008, 1, 1 + b * 0.012);
    p.armL.rotation.set(0.07 + b * 0.02 + w * 0.05, 0, 0.1 + b * 0.01); p.armR.rotation.set(0.03 - b * 0.02 - w * 0.05, 0, -0.08 - b * 0.01);   // not symmetrical: a resting body never is
    p.foreL.rotation.x = -0.3; p.foreR.rotation.x = -0.2;
    p.head.rotation.set(Math.sin(t * 0.23) * 0.05, Math.sin(t * 0.5) * 0.28 * Math.sin(t * 0.13), w * 0.03);
    if (p.skirt) { p.skirt.rotation.set(0, 0, 0); p.skirt.scale.set(1, 1, 1); }
    if (p.skirt2) { p.skirt2.rotation.set(0, 0, 0); p.skirt2.scale.set(1, 1, 1); }
    if (p._stoop) { const q = p._stoop; p.torso.rotation.x += q; p.head.rotation.x -= q * 0.75; p.armL.rotation.x -= q * 0.8; p.armR.rotation.x -= q * 0.8; p.hips.rotation.x += q * 0.12; }
  }
  // Seated poses. 'car' = upright seat with hands on a wheel, 'bike' = astride, legs apart, hands on bars,
  // 'bench' = sitting on a plank with hands on knees.
  function sit(p, pose) {
    glbDrive(p, 'sit', 0, pose);
    if (pose === 'sideSaddle') {     // pillion, both legs to one side, knees together; one hand to the rider's shoulder, one in her lap
      p.hips.position.set(0, 0.92, 0); p.hips.rotation.set(0, 0, 0); p.torso.rotation.set(0.04, -0.35, 0); p.torso.scale.set(1, 1, 1); p.head.rotation.set(0, -0.3, 0);
      p.legL.rotation.set(-1.32, 0, 0.03); p.legR.rotation.set(-1.32, 0, -0.03); p.shinL.rotation.x = 1.4; p.shinR.rotation.x = 1.4;
      p.armL.rotation.set(-0.55, 0, 0.1); p.foreL.rotation.x = -0.95;
      p.armR.rotation.set(-1.15, 0, 0.45); p.foreR.rotation.x = -0.5;
      if (p.skirt) { p.skirt.rotation.set(-1.15, 0, 0); p.skirt.scale.set(1, 0.6, 1); }
      if (p.skirt2) { p.skirt2.rotation.set(-1.15, 0, 0); p.skirt2.scale.set(1, 0.6, 1); }
      return;
    }
    const bike = pose === 'bike';
    p.hips.position.set(0, 0.92, 0); p.hips.rotation.set(0, 0, 0); p.torso.rotation.set(bike ? 0.25 : 0.05, 0, 0); p.torso.scale.set(1, 1, 1); p.head.rotation.set(bike ? -0.2 : 0, 0, 0);
    p.legL.rotation.set(bike ? -1.1 : -1.45, 0, bike ? 0.25 : 0.08); p.legR.rotation.set(bike ? -1.1 : -1.45, 0, bike ? -0.25 : -0.08);
    p.shinL.rotation.x = bike ? 1.55 : 1.45; p.shinR.rotation.x = bike ? 1.55 : 1.45;
    const reach = pose === 'bench' ? -0.5 : bike ? -0.95 : -0.85;
    p.armL.rotation.set(reach, 0, 0.12); p.armR.rotation.set(reach, 0, -0.12);
    p.foreL.rotation.x = pose === 'bench' ? -0.9 : -0.55; p.foreR.rotation.x = p.foreL.rotation.x;
    if (p.skirt) { p.skirt.rotation.set(-1.25, 0, 0); p.skirt.scale.set(1, 0.55, 1); }
    if (p.skirt2) { p.skirt2.rotation.set(-1.25, 0, 0); p.skirt2.scale.set(1, 0.55, 1); }
  }

  // Rebuild an existing human in place: same group object and same parts object (so code holding
  // references, like player.js, keeps animating the new body).
  function rebuild(h, appearance) {
    if (!h) return null;
    const keep = api.player; api.player = keep || h;
    const n = create(Object.assign({}, appearance, { lod: h.appearance && h.appearance.lod }));
    api.player = keep;
    while (h.group.children.length) h.group.remove(h.group.children[0]);
    while (n.group.children.length) h.group.add(n.group.children[0]);
    for (const k of Object.keys(h.parts)) delete h.parts[k];
    Object.assign(h.parts, n.parts);
    h.hipHeight = n.hipHeight; h.scale = n.scale; h.appearance = n.appearance;
    glbUnregister(n); if (h.parts._glb) { h.parts._glb.res = h; glbDetach(h.parts._glb); }
    return h;
  }
  function triangles(obj) {
    let t = 0;
    obj.traverse(m => { if (m.isMesh) { const g = m.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return Math.round(t);
  }


  // ------------------------------------------------------------ asset-backed (GLB) characters
  // When Assets.CHARACTER (e.g. 'models/villager.glb', a rigged, animated CC0 humanoid) and Assets (assets.js) are
  // present, the nearest GLB.MAX humans to the camera swap their procedural body for a SkeletonUtils
  // clone of it, tinted to the appearance, driven by an AnimationMixer. Everything else stays
  // procedural, and so does everything if the file is missing. Clip names are matched loosely:
  // /idle/, /walk/, /run|sprint|jog/, /sit/. Without a sit clip, seated humans stay procedural.
  const GLB = { path: 'models/villager.glb', state: 'idle', gltf: null, clips: {}, list: [], MAX: 30, RANGE: 70, active: 0 };
  const CLIP_RX = { idle: /idle/i, walk: /walk/i, run: /run|sprint|jog/i, sit: /sit/i };
  function glbUse(g) {               // also callable directly with an already-loaded gltf
    if (!THREE.SkeletonUtils) { GLB.state = 'none'; return false; }
    GLB.gltf = g; GLB.clips = {};
    for (const k in CLIP_RX) GLB.clips[k] = g.animations.find(a => CLIP_RX[k].test(a.name) && !(k === 'idle' && /sit/i.test(a.name))) || null;
    const b = new THREE.Box3().setFromObject(g.scene); GLB.height = Math.max(0.1, b.max.y - b.min.y); GLB.minY = b.min.y;
    GLB.state = 'ready';
  }
  function glbLoad() {
    if (GLB.state !== 'idle' || !window.Assets) return;
    if (!Assets.CHARACTER) { GLB.state = 'none'; return; }   // no character file shipped yet (avoids a 404)
    GLB.path = Assets.CHARACTER;
    GLB.state = 'loading';
    Promise.all([Assets.gltf(GLB.path), Assets.needSkeletonUtils()]).then(([g, ok]) => {
      if (GLB.state !== 'loading') return;
      if (!g || !ok || !THREE.SkeletonUtils || !g.animations.length) { GLB.state = 'none'; return; }
      glbUse(g);
    });
  }
  function glbRegister(res) {
    const c = { res, obj: null, mixer: null, actions: {}, cur: null, mode: 'idle', speed: 0, pose: null, seen: performance.now() };
    Object.defineProperty(res.parts, '_glb', { value: c, enumerable: false, writable: true, configurable: true });
    GLB.list.push(c);
  }
  function glbUnregister(res) {
    const c = res.parts && res.parts._glb; if (!c) return;
    glbDetach(c); const i = GLB.list.indexOf(c); if (i >= 0) GLB.list.splice(i, 1);
  }
  const TINT = [
    ['hair', /hair|beard|brow/i], ['feet', /shoe|boot|feet|foot|sandal/i], ['skin', /skin|body|face|head|hand|arm/i],
    ['bottom', /pant|trouser|leg|bottom|lower|skirt|short|lungi|dhoti/i], ['top', /shirt|top|torso|cloth|jacket|sweater|upper|vest|dress/i]];
  function glbAttach(c) {
    const o = c.res.appearance, g = GLB.gltf;
    const obj = THREE.SkeletonUtils.clone(g.scene);
    const k = (1.75 * c.res.scale) / GLB.height;
    obj.scale.setScalar(k); obj.position.y = -GLB.minY * k;
    const colour = { skin: o.skin, hair: o.hairColor, feet: o.feetColor,
      top: o.top === 'uniform' ? 0xc2a36b : o.topColor,
      bottom: o.bottom === 'jeans' && o.bottomColor === undefined ? 0x2c4a7a : o.bottomColor };
    obj.traverse(m => {
      if (!m.isMesh) return;
      m.castShadow = true; m.frustumCulled = false;
      m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => {
        const t = TINT.find(e => e[1].test(mt.name || '') || e[1].test(m.name || ''));
        if (t && colour[t[0]] !== undefined && mt.color) mt.color.setHex(colour[t[0]]);
        if (m.isSkinnedMesh) mt.skinning = true;
      });
    });
    c.mixer = new THREE.AnimationMixer(obj); c.actions = {}; c.cur = null;
    for (const n in GLB.clips) if (GLB.clips[n]) c.actions[n] = c.mixer.clipAction(GLB.clips[n]);
    c.obj = obj;
    const grp = c.res.group;
    grp.children.forEach(ch => { ch.userData.glbHidden = ch.visible; ch.visible = false; });
    grp.add(obj); GLB.active++;
    glbPlay(c, c.mode, 0);
  }
  function glbDetach(c) {
    if (!c.obj) return;
    c.mixer.stopAllAction(); c.mixer.uncacheRoot(c.obj);
    const grp = c.obj.parent; if (grp) grp.remove(c.obj);
    c.obj.traverse(m => { if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); });
    if (grp) grp.children.forEach(ch => { if (ch.userData.glbHidden !== undefined) { ch.visible = ch.userData.glbHidden; delete ch.userData.glbHidden; } });
    c.obj = null; c.mixer = null; c.actions = {}; c.cur = null; GLB.active--;
  }
  function glbPlay(c, mode, fade) {
    const name = c.actions[mode] ? mode : mode === 'run' && c.actions.walk ? 'walk' : 'idle';
    const a = c.actions[name]; if (!a) return;
    if (name === 'walk') a.timeScale = Math.max(0.4, Math.min(2.2, c.speed / 1.4));
    else if (name === 'run') a.timeScale = Math.max(0.6, Math.min(1.6, c.speed / 4.5));
    else a.timeScale = 1;
    if (c.cur === name) return;
    const prev = c.cur && c.actions[c.cur];
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (name === 'sit') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    if (prev && fade) a.crossFadeFrom(prev, fade, false); else if (prev) prev.stop();
    a.play(); c.cur = name;
  }
  // called from animateWalk/animateIdle/sit; returns true when a GLB body is showing (skip the procedural pose)
  function glbDrive(p, mode, speed, pose) {
    const c = p && p._glb; if (!c) return false;
    c.mode = mode; c.speed = Math.abs(speed); c.pose = pose || null;
    if (!c.obj) return false;
    if (mode === 'sit' && !GLB.clips.sit) { glbDetach(c); return false; }
    glbPlay(c, mode, 0.2);
    return true;
  }
  function inScene(o) { while (o) { if (o.isScene) return o.visible !== false; if (!o.visible) return false; o = o.parent; } return false; }
  let lastT = performance.now(), lastRank = 0;
  const wp = new THREE.Vector3();
  function glbTick() {
    requestAnimationFrame(glbTick);
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (GLB.state === 'idle') glbLoad();
    if (GLB.state !== 'ready') return;
    if (now - lastRank > 400) {
      lastRank = now;
      const cam = (typeof camera !== "undefined" && camera) || window.camera, cp = cam && cam.getWorldPosition ? cam.getWorldPosition(new THREE.Vector3()) : null;
      const cand = [];
      for (let i = GLB.list.length - 1; i >= 0; i--) {
        const c = GLB.list[i];
        if (!inScene(c.res.group)) {
          if (c.obj) glbDetach(c);
          if (!c.res.group.parent && now - c.seen > 30000) GLB.list.splice(i, 1);   // dropped humans
          continue;
        }
        c.seen = now;
        if (c.mode === 'sit' && !GLB.clips.sit) { if (c.obj) glbDetach(c); continue; }
        const d = cp ? c.res.group.getWorldPosition(wp).distanceTo(cp) : 0;
        if (d < GLB.RANGE) cand.push([d, c]); else if (c.obj) glbDetach(c);
      }
      cand.sort((a, b) => a[0] - b[0]);
      cand.forEach(([, c], i) => { if (i < GLB.MAX) { if (!c.obj) glbAttach(c); } else if (c.obj) glbDetach(c); });
    }
    for (const c of GLB.list) if (c.mixer) c.mixer.update(dt);
  }
  requestAnimationFrame(glbTick);

  // saved appearance from the character creator (character-creator.js writes this key)
  let saved = null;
  try { const r = localStorage.getItem('nellutla.character'); if (r) saved = JSON.parse(r); } catch (e) { saved = null; }

  const api = { create, animateWalk, animateIdle, animateTurn, sit, rebuild, triangles, normalize, randomAppearance,
    OPTIONS, SKINS, HAIR_COLORS, EYES, PALETTE, playerAppearance: saved, player: null, GLB, glbUse };
  return api;
})();
