// Innova Crysta wheels (17" two-tone diamond-cut alloys, 215/55 R17) and RHD cabin interior.
// Car faces +z; the driver sits on the right, which is -x.

function crystaRoundedBox(w, h, d, r, mat) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001);
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const b = Math.min(r, d / 2 - 0.001);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(d - 2 * b) / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

// ---------------------------------------------------------------- wheel
// Returns { spin: group that rotates with the wheel, fixed: group for caliper/disc }; axle along x, outer face at +x*side.
function buildCrystaWheel(side, R, Wd) {
  const spin = new THREE.Group(), fixed = new THREE.Group();
  const rubber = new THREE.MeshLambertMaterial({ color: 0x17181b });
  const silver = new THREE.MeshPhongMaterial({ color: 0xeef2f6, specular: 0xffffff, shininess: 140 });
  const gunmetal = new THREE.MeshPhongMaterial({ color: 0x2b2f36, specular: 0x667085, shininess: 60 });
  const barrelMat = new THREE.MeshPhongMaterial({ color: 0x8a919b, specular: 0xcccccc, shininess: 60, side: THREE.DoubleSide });

  // tyre: lathe profile with rounded shoulders, tread rendered with a groove texture
  const rimR = R * 0.70, hw = Wd / 2;
  const prof = [];
  prof.push(new THREE.Vector2(rimR, -hw * 0.92));
  prof.push(new THREE.Vector2(R * 0.90, -hw));
  prof.push(new THREE.Vector2(R * 0.985, -hw * 0.82));
  prof.push(new THREE.Vector2(R, -hw * 0.55));
  prof.push(new THREE.Vector2(R, hw * 0.55));
  prof.push(new THREE.Vector2(R * 0.985, hw * 0.82));
  prof.push(new THREE.Vector2(R * 0.90, hw));
  prof.push(new THREE.Vector2(rimR, hw * 0.92));
  const tc = document.createElement('canvas'); tc.width = 64; tc.height = 512;
  const tg = tc.getContext('2d'); tg.fillStyle = '#1b1c1f'; tg.fillRect(0, 0, 64, 512);
  tg.fillStyle = '#0c0c0d'; [14, 30, 46].forEach(x => tg.fillRect(x, 0, 3, 512));
  for (let y = 0; y < 512; y += 12) { tg.fillRect(0, y, 14, 3); tg.fillRect(50, y + 6, 14, 3); }
  const treadTex = new THREE.CanvasTexture(tc); treadTex.wrapS = treadTex.wrapT = THREE.RepeatWrapping;
  const tyreGeo = new THREE.LatheGeometry(prof, 40);
  const tyre = new THREE.Mesh(tyreGeo, new THREE.MeshLambertMaterial({ map: treadTex, color: 0xffffff, side: THREE.DoubleSide }));
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
  // sidewall lettering ring
  const swc = document.createElement('canvas'); swc.width = 1024; swc.height = 64;
  const sg = swc.getContext('2d'); sg.fillStyle = '#17181b'; sg.fillRect(0, 0, 1024, 64);
  sg.fillStyle = '#4a4d52'; sg.font = 'bold 30px sans-serif';
  sg.fillText('BRIDGESTONE  DUELER  H/T   215/55 R17 94V', 20, 42); sg.fillText('TUBELESS  RADIAL', 760, 42);
  const swTex = new THREE.CanvasTexture(swc);
  const sw = new THREE.Mesh(new THREE.RingGeometry(rimR + 0.005, R * 0.93, 48, 1), new THREE.MeshLambertMaterial({ map: swTex, side: THREE.DoubleSide }));
  // map the strip around the ring
  const uv = sw.geometry.attributes.uv, pos = sw.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i)), r = Math.hypot(pos.getX(i), pos.getY(i));
    const u = (a / (Math.PI * 2) + 1) % 1; uv.setXY(i, side < 0 ? 1 - u : u, (r - rimR) / (R * 0.93 - rimR));
  }
  sw.rotation.y = side * Math.PI / 2; sw.position.x = side * (hw + 0.002); spin.add(sw);

  // rim barrel and dark face dish
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, Wd * 0.9, 32, 1, true), barrelMat);
  barrel.rotation.z = Math.PI / 2; spin.add(barrel);
  const dish = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.98, 32), gunmetal);
  dish.rotation.y = side * Math.PI / 2; dish.position.x = side * (hw * 0.35); spin.add(dish);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.012, 6, 40), silver);
  lip.rotation.y = Math.PI / 2; lip.position.x = side * hw * 0.88; spin.add(lip);

  // 5 twin spokes: gunmetal body with machined (diamond-cut) silver face
  const faceX = side * hw * 0.80;
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2;
    for (const off of [-0.11, 0.11]) {
      const a = a0 + off;
      const s = new THREE.Shape();
      s.moveTo(-0.022, 0.07); s.lineTo(0.022, 0.07); s.lineTo(0.034, rimR * 0.97); s.lineTo(-0.034, rimR * 0.97);
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 1 });
      const body = new THREE.Mesh(geo, gunmetal);
      const face = new THREE.Mesh(new THREE.ShapeGeometry(s), silver);
      const g = new THREE.Group(); g.add(body); face.position.z = 0.059; g.add(face);
      // orient: shape plane faces +z; turn so it faces outward (+x*side), rotate around axle
      g.rotation.order = 'YXZ';
      g.rotation.y = side * Math.PI / 2;
      g.rotation.z = a;
      g.position.x = faceX - side * 0.06;
      spin.add(g);
    }
  }
  // hub, lug nuts, Toyota centre cap
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.05, 20), gunmetal);
  hub.rotation.z = Math.PI / 2; hub.position.x = faceX; spin.add(hub);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6), silver);
    nut.rotation.z = Math.PI / 2; nut.position.set(faceX + side * 0.02, Math.sin(a) * 0.058, Math.cos(a) * 0.058); spin.add(nut);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 18), new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 90 }));
  cap.rotation.z = Math.PI / 2; cap.position.x = faceX + side * 0.03; spin.add(cap);
  const logo = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 4, 18), silver);
  logo.scale.y = 0.65; logo.rotation.y = Math.PI / 2; logo.position.x = faceX + side * 0.037; spin.add(logo);

  // brake disc and red caliper stay put (do not spin)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.025, 28), new THREE.MeshPhongMaterial({ color: 0x9aa0a6, shininess: 50 }));
  disc.rotation.z = Math.PI / 2; disc.position.x = side * 0.0; fixed.add(disc);
  const caliper = crystaRoundedBox(0.06, 0.16, 0.13, 0.02, new THREE.MeshPhongMaterial({ color: 0xc81e1e, shininess: 60 }));
  caliper.rotation.y = Math.PI / 2; caliper.position.set(side * 0.03, 0.14, -0.06); caliper.rotation.x = 0.4; fixed.add(caliper);
  return { spin, fixed };
}

// ---------------------------------------------------------------- interior
function buildCrystaInterior(chassis) {
  // cabin plastics carry a little emissive: under the sun shadow the shell would otherwise leave them black
  const glow = 0x17140f;
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color, emissive: glow }, extra));
  const leather = lam(0x8a5a33);          // Hazel brown
  const leatherDark = lam(0x5e3a1f);
  const black = lam(0x2e3036);
  const softBlack = lam(0x45484f);
  const wood = new THREE.MeshPhongMaterial({ color: 0x7c4a28, specular: 0x553322, shininess: 60, emissive: glow });
  const chrome = new THREE.MeshPhongMaterial({ color: 0xf1f5f9, specular: 0xffffff, shininess: 130, emissive: 0x222222 });
  const beige = lam(0xd8cdbb, { side: THREE.DoubleSide });
  const carpet = lam(0x3a342e);
  const add = (m, x, y, z) => { m.position.set(x, y, z); chassis.add(m); return m; };

  // floor, headliner, pillar trims
  add(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.04, 3.3), carpet), 0, 0.46, -0.55);
  const head = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), beige), 0, 1.66, -0.98); head.rotation.x = Math.PI / 2;   // ends where the windscreen meets the roof, not out over the bonnet

  // dashboard: sculpted profile across the width
  const ds = new THREE.Shape();
  ds.moveTo(1.10, 0.62); ds.lineTo(1.10, 1.05); ds.quadraticCurveTo(0.95, 1.16, 0.78, 1.12);
  ds.lineTo(0.66, 1.02); ds.lineTo(0.66, 0.62);
  const dg = new THREE.ExtrudeGeometry(ds, { depth: 1.44, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  dg.rotateY(-Math.PI / 2); dg.translate(0.72, 0, 0);
  chassis.add(new THREE.Mesh(dg, softBlack));
  add(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.02), wood), 0, 0.98, 0.655);        // wood strip
  add(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.012, 0.022), chrome), 0, 1.01, 0.655);
  // AC vents
  [-0.62, -0.18, 0.18, 0.62].forEach(x => {
    const v = add(crystaRoundedBox(0.14, 0.07, 0.03, 0.015, black), x, 1.06, 0.66);
    for (let i = 0; i < 3; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 0.01), chrome), x, 1.04 + i * 0.02, 0.645);
  });

  // instrument binnacle with lit dials (driver side, -x)
  const binn = add(crystaRoundedBox(0.44, 0.16, 0.14, 0.04, black), -0.40, 1.13, 0.80);
  const dialTex = (label, max) => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#05070c'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#38bdf8'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 112, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
    g.fillStyle = '#e2e8f0'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
      g.fillRect(128 + Math.cos(a) * 92 - 2, 128 + Math.sin(a) * 92 - 2, 5, 5);
      g.fillText(String(Math.round(max * i / 8)), 128 + Math.cos(a) * 70, 136 + Math.sin(a) * 70);
    }
    g.fillStyle = '#94a3b8'; g.font = '18px sans-serif'; g.fillText(label, 128, 200);
    return new THREE.CanvasTexture(c);
  };
  [[-0.50, 'km/h', 200], [-0.30, 'x1000 rpm', 6]].forEach(([x, l, mx], i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.068, 32), new THREE.MeshBasicMaterial({ map: dialTex(l, mx) }));
    d.position.set(x, 1.11, 0.725); d.rotation.y = Math.PI; chassis.add(d);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.055, 0.004), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    n.geometry.translate(0, 0.024, 0);
    n.position.set(x, 1.11, 0.722); chassis.add(n);
    if (i === 0) cockpitSpeedoNeedle = n; else cockpitTachoNeedle = n;
  });
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.09), new THREE.MeshBasicMaterial({ color: 0x0ea5e9 }));
  mid.position.set(-0.40, 1.11, 0.724); mid.rotation.y = Math.PI; chassis.add(mid);

  // 8" touchscreen with a live map texture
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 256;
  const scg = sc.getContext('2d'); scg.fillStyle = '#0b1220'; scg.fillRect(0, 0, 320, 192);
  if (window.NellutlaWorldRef && window.NellutlaWorldRef.mapCanvas) { const mc = window.NellutlaWorldRef.mapCanvas; scg.drawImage(mc, mc.width / 2 - 200, mc.height / 2 - 120, 400, 240, 0, 0, 320, 192); }
  scg.fillStyle = '#e2e8f0'; scg.font = 'bold 16px sans-serif'; scg.fillText('NELLUTLA  ·  NH-365B', 12, 22);
  const screenTex = new THREE.CanvasTexture(sc);
  add(crystaRoundedBox(0.30, 0.19, 0.04, 0.015, black), 0, 1.07, 0.665);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.16), new THREE.MeshBasicMaterial({ map: screenTex }));
  scr.position.set(0, 1.07, 0.643); scr.rotation.y = Math.PI; chassis.add(scr);
  chassis.userData.screen = { canvas: sc, tex: screenTex, mesh: scr }; window.CrystaScreen = chassis.userData.screen;
  // climate panel
  add(crystaRoundedBox(0.26, 0.08, 0.03, 0.01, black), 0, 0.90, 0.66);
  [-0.08, 0.08].forEach(x => { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), chrome); k.rotation.x = Math.PI / 2; add(k, x, 0.90, 0.64); });

  // centre console with gear lever and armrest
  add(crystaRoundedBox(0.24, 0.30, 0.75, 0.04, softBlack), 0, 0.62, 0.30);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.32), wood), 0, 0.775, 0.42);
  const lever = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), chrome), 0, 0.84, 0.46);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), leatherDark), 0, 0.92, 0.46);
  add(crystaRoundedBox(0.22, 0.07, 0.30, 0.03, leather), 0, 0.80, 0.04);

  // steering column and wheel (RHD)
  const colm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.30, 10), black), -0.40, 1.00, 0.66);
  colm.rotation.x = Math.PI / 2 - 0.45;
  const sw = new THREE.Group(); sw.position.set(-0.40, 1.03, 0.52); sw.rotation.x = -0.45;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 36), leatherDark); sw.add(rim);
  [0, Math.PI * 0.95, Math.PI * 0.05 + Math.PI].forEach(() => {});
  for (const a of [Math.PI / 2 + Math.PI, 0, Math.PI]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.02), softBlack);
    sp.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); sp.rotation.z = a; sw.add(sp);
  }
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 20), softBlack); boss.rotation.x = Math.PI / 2; sw.add(boss);
  const emb = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 4, 16), chrome); emb.scale.y = 0.65; emb.position.z = -0.022; sw.add(emb);
  chassis.add(sw); chassis.userData.steeringWheel = sw;

  // seats: two front, two second-row captain seats, third-row bench
  function seat(x, z, w) {
    const g = new THREE.Group(); g.position.set(x, 0.48, z);
    const cush = crystaRoundedBox(w, 0.13, 0.50, 0.05, leather); cush.position.set(0, 0.10, 0); g.add(cush);
    const back = crystaRoundedBox(w * 0.96, 0.66, 0.13, 0.05, leather); back.position.set(0, 0.48, -0.26); back.rotation.x = -0.18; g.add(back);
    // side bolsters and stitch panel
    [-1, 1].forEach(sd => { const b = crystaRoundedBox(0.07, 0.56, 0.16, 0.03, leatherDark); b.position.set(sd * (w * 0.48 - 0.03), 0.48, -0.24); b.rotation.x = -0.18; g.add(b); });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.42, 0.01), leatherDark); panel.position.set(0, 0.48, -0.19); panel.rotation.x = -0.18; g.add(panel);
    const hr = crystaRoundedBox(0.26, 0.17, 0.10, 0.04, leather); hr.position.set(0, 0.92, -0.36); g.add(hr);
    [-0.07, 0.07].forEach(px => { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), chrome); post.position.set(px, 0.83, -0.35); g.add(post); });
    chassis.add(g); return g;
  }
  seat(-0.40, 0.22, 0.52); seat(0.40, 0.22, 0.52);
  const c1 = seat(-0.40, -0.70, 0.50), c2 = seat(0.40, -0.70, 0.50);
  // captain seat armrests
  [c1, c2].forEach(g => [-1, 1].forEach(sd => { const a = crystaRoundedBox(0.05, 0.05, 0.30, 0.02, leatherDark); a.position.set(sd * 0.29, 0.33, -0.05); g.add(a); }));
  const bench = seat(0, -1.55, 1.30);
  // door cards, armrests, window switches, inner pillars and the screen header: the shell is one-sided from in here
  [-1, 1].forEach(sd => {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 2.5), beige), sd * 0.86, 0.82, -0.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 2.5), softBlack), sd * 0.85, 1.13, -0.6);
    add(crystaRoundedBox(0.09, 0.05, 0.42, 0.02, leather), sd * 0.81, 0.92, 0.08);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.3, 0.9), wood), sd * 0.835, 0.78, 0.35);
    const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 0.05), beige), sd * 0.8, 1.38, 0.5); pillar.rotation.x = -0.92; pillar.rotation.z = sd * 0.09;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.56, 0.1), beige), sd * 0.8, 1.38, -0.28);
  });
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.1), beige), 0, 1.65, 0.26);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.1), softBlack), -0.46, 0.62, 0.72);   // pedals
  add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), softBlack), -0.34, 0.6, 0.74);
  // interior rear-view mirror housing
}
