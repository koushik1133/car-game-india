// Innova Crysta, 2023 look: the same shell builder as crysta-body.js reshaped from owner photos (white roof, hexagonal
// grille, slim lamps, sloping bonnet, leaning rear screen). Used for a separate car; the player's own Crysta keeps crysta-body.js.
// Replaces the box body inside buildToyotaInnovaCrysta(); keeps the same animated part handles
// (hoodMesh, trunkMesh, sunroofMesh, doorMeshes, mirrorMeshes, wiperMeshes, frontHeadlights,
// rearBrakeLights, nosFlameJets). Car faces +z, 4735 x 1830 x 1795 mm, wheelbase 2750 mm.
function buildCrystaShell2023(chassis, M, plateTex) {
  const W = carWidth;

  // Extrude a side profile drawn in (z, y) across the car's width, centred on x = 0.
  function sideExtrude(draw, width, mat, bevel) {
    const s = new THREE.Shape(); draw(s);
    const b = bevel === undefined ? 0.05 : bevel;
    const g = new THREE.ExtrudeGeometry(s, { depth: width - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 6, curveSegments: 24 });
    g.rotateY(-Math.PI / 2);
    g.translate((width - 2 * b) / 2, 0, 0);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  // Extrude a face shape drawn in (x, y) along +z by depth.
  function faceExtrude(pts, depth, mat, bevel) {
    const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    const b = bevel || 0;
    return new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2 }), mat);
  }
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); chassis.add(m); return m; };
  const plasticMat = new THREE.MeshLambertMaterial({ color: 0x1a1d22 });
  const lensMat = new THREE.MeshPhongMaterial({ color: 0xdfe8f0, specular: 0xffffff, shininess: 140, transparent: true, opacity: 0.55 });
  const tailMat = () => new THREE.MeshBasicMaterial({ color: 0xb91c1c });

  // ---------------- 1. body shell with real wheel-arch cut-outs
  // Body is split around the door apertures: front section, rear section and sill.
  const FW = 1.38, RW = -1.37, AR = 0.47, AY = 0.40;
  const front = sideExtrude(s => {
    s.moveTo(0.90, 0.30); s.lineTo(FW - AR, 0.30); s.lineTo(FW - AR, AY); s.absarc(FW, AY, AR, Math.PI, 0, true); s.lineTo(FW + AR, 0.30);
    s.lineTo(2.22, 0.30);
    s.bezierCurveTo(2.33, 0.30, 2.385, 0.36, 2.385, 0.47);   // rounded chin
    s.bezierCurveTo(2.385, 0.6, 2.37, 0.7, 2.355, 0.77);   // bumper face, slight rake
    s.bezierCurveTo(2.34, 0.86, 2.28, 0.895, 2.12, 0.905);   // nose / hood leading edge, low
    s.bezierCurveTo(1.70, 0.955, 1.30, 1.015, 1.05, 1.05);     // bonnet rising steadily to the screen
    s.lineTo(0.90, 1.06);
  }, W, M.paint, 0.06);
  chassis.add(front);
  const rear = sideExtrude(s => {
    s.moveTo(-2.28, 0.30); s.lineTo(RW - AR, 0.30); s.lineTo(RW - AR, AY); s.absarc(RW, AY, AR, Math.PI, 0, true); s.lineTo(-0.90, 0.30);
    s.lineTo(-0.90, 1.08); s.bezierCurveTo(-1.50, 1.09, -2.00, 1.10, -2.24, 1.10);
    s.bezierCurveTo(-2.27, 0.90, -2.29, 0.72, -2.30, 0.60); s.bezierCurveTo(-2.33, 0.50, -2.33, 0.36, -2.27, 0.30);   // rear bumper
  }, W, M.paint, 0.06);
  chassis.add(rear);
  const sill = sideExtrude(s => { s.moveTo(0.92, 0.30); s.lineTo(0.92, 0.40); s.lineTo(-0.92, 0.40); s.lineTo(-0.92, 0.30); }, W, M.paint, 0.02);
  chassis.add(sill);
  // cabin bulkhead behind the dashboard and the rear-quarter inner wall
  const bh = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.62, 0.04), new THREE.MeshLambertMaterial({ color: 0x1b1d21 })); bh.position.set(0, 0.72, 0.89); chassis.add(bh);


  // underbody, black sill cladding and arch flares
  box(W * 0.94, 0.14, 4.4, plasticMat, 0, 0.25, 0);
  [-1, 1].forEach(sd => {
    box(0.05, 0.10, 1.75, plasticMat, sd * (W / 2 + 0.005), 0.36, 0);
    [FW, RW].forEach(wz => {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(AR - 0.01, AR - 0.01, W * 0.86, 18, 1, true, -Math.PI / 2, Math.PI), plasticMat);
      liner.rotation.z = Math.PI / 2; liner.rotation.x = Math.PI; liner.position.set(0, AY, wz);
      liner.material = plasticMat; chassis.add(liner);
    });
    // running board with chrome edge
    box(0.13, 0.045, 1.70, plasticMat, sd * (W / 2 + 0.06), 0.28, -0.02);
    box(0.02, 0.03, 1.70, M.chrome, sd * (W / 2 + 0.125), 0.29, -0.02);
  });

  // ---------------- 2. glasshouse, floating roof, pillars
  // windshield and rear-quarter glass (door windows live on the doors)
  const windshield = sideExtrude(s => { s.moveTo(1.06, 1.04); s.lineTo(0.22, 1.64); s.lineTo(0.17, 1.63); s.lineTo(0.99, 1.04); }, W - 0.22, M.glass, 0.02);
  chassis.add(windshield);
  const quarter = sideExtrude(s => {
    s.moveTo(-0.92, 1.08); s.lineTo(-0.92, 1.66); s.lineTo(-1.95, 1.70);
    s.lineTo(-2.12, 1.65); s.lineTo(-2.285, 1.14); s.lineTo(-2.26, 1.08);   // rear edge leans forward with the screen
  }, W - 0.22, M.glass, 0.04);
  chassis.add(quarter);

  const roof = sideExtrude(s => {
    s.moveTo(0.30, 1.605); s.quadraticCurveTo(0.20, 1.70, 0.02, 1.715);
    s.bezierCurveTo(-0.70, 1.775, -1.50, 1.765, -1.97, 1.745);            // crowned roof, dropping ~3 cm to the rear
    s.quadraticCurveTo(-2.14, 1.74, -2.17, 1.69); s.lineTo(-2.15, 1.65); s.lineTo(-1.95, 1.70);
    s.bezierCurveTo(-1.40, 1.715, -0.60, 1.72, 0.22, 1.625);
  }, W - 0.20, M.paint, 0.05);   // body-colour roof, as on the 2023 car
  chassis.add(roof);
  // black A/B/C/D pillars for the floating-roof look
  [-1, 1].forEach(sd => {
    const x = sd * (W / 2 - 0.105);
    const a = box(0.035, 0.07, 0.98, M.paint, x, 1.35, 0.64); a.rotation.x = 0.62;   // body-colour A pillar
    box(0.03, 0.56, 0.09, M.pianoBlack, x, 1.37, 0.03);
    box(0.03, 0.58, 0.12, M.pianoBlack, x, 1.38, -0.97);
    { const dp = box(0.035, 0.56, 0.15, M.paint, x, 1.41, -2.2); dp.rotation.x = 0.31; }   // broad body-colour D pillar, leaning with the screen
    // the belt line kicks up behind the rear door: a body-colour panel under a third window that tapers to a point
    const kick = sideExtrude(s => { s.moveTo(-0.93, 1.07); s.lineTo(-1.25, 1.12); s.lineTo(-1.95, 1.44); s.lineTo(-2.26, 1.5); s.lineTo(-2.26, 1.07); }, 0.05, M.paint, 0.008);
    kick.position.x = sd * (W / 2 - 0.085); chassis.add(kick);
  });
  // roof rails, shark fin, spoiler with third brake lamp
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), M.paint);
  fin.position.set(0, 1.815, -1.8); fin.rotation.x = -0.35; fin.scale.z = 2.2; chassis.add(fin);
  const spoiler = sideExtrude(s => { s.moveTo(-1.95, 1.755); s.lineTo(-2.26, 1.735); s.lineTo(-2.27, 1.695); s.lineTo(-2.0, 1.725); }, W * 0.84, M.paint, 0.015);
  chassis.add(spoiler);
  box(0.5, 0.025, 0.02, new THREE.MeshBasicMaterial({ color: 0xef4444 }), 0, 1.71, -2.27);
  sunroofMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.85), M.glass);
  sunroofMesh.position.set(0, 1.735, -0.2); chassis.add(sunroofMesh);

  // ---------------- 3. hood (hinged at the cowl)
  hoodMesh = new THREE.Group(); hoodMesh.position.set(0, 1.055, 1.05);
  const hood = sideExtrude(s => {
    s.moveTo(1.05, 1.055); s.quadraticCurveTo(1.6, 1.0, 2.13, 0.91); s.quadraticCurveTo(2.27, 0.9, 2.29, 0.86); s.lineTo(2.24, 0.855); s.quadraticCurveTo(1.6, 0.97, 1.05, 1.025);
  }, W - 0.16, M.paint, 0.02);
  hood.geometry.translate(0, -1.055 + 0.006, -1.05); hoodMesh.add(hood);
  // hood bulges
  [-0.35, 0.35].forEach(x => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.95), M.paint); r.position.set(x, -0.055, 0.55); r.rotation.x = 0.125; hoodMesh.add(r); });
  chassis.add(hoodMesh);
  // wiper cowl
  box(W * 0.86, 0.03, 0.10, plasticMat, 0, 1.06, 1.02);

  // ---------------- 4. tailgate (hinged at the roof)
  trunkMesh = new THREE.Group(); trunkMesh.position.set(0, 1.70, -2.26);
  // the gate is a frame round the rear window, not one sheet over it: lower panel, header, two pillars
  const gateParts = [
    sideExtrude(s => { s.moveTo(-2.300, 1.15); s.lineTo(-2.325, 1.13); s.lineTo(-2.345, 1.08); s.lineTo(-2.35, 0.62); s.lineTo(-2.30, 0.62); s.lineTo(-2.29, 1.06); s.lineTo(-2.285, 1.15); }, W - 0.62, M.paint, 0.02),
    sideExtrude(s => { s.moveTo(-2.15, 1.68); s.lineTo(-2.172, 1.61); s.lineTo(-2.152, 1.61); s.lineTo(-2.135, 1.66); }, W - 0.30, M.paint, 0.012)];
  [-1, 1].forEach(sd => { const pg = new THREE.BoxGeometry(0.09, 0.50, 0.03); pg.rotateX(0.32); pg.translate(sd * (W / 2 - 0.2), 1.38 - 1.70, -2.245 + 2.26); trunkMesh.add(new THREE.Mesh(pg, M.paint)); });
  gateParts.forEach(gp => { gp.geometry.translate(0, -1.70, 2.26); trunkMesh.add(gp); });
  const rglass = sideExtrude(s => { s.moveTo(-2.165, 1.61); s.lineTo(-2.318, 1.15); s.lineTo(-2.328, 1.15); s.lineTo(-2.175, 1.61); }, W - 0.44, M.glass, 0);
  rglass.geometry.translate(0, -1.70, 2.26); trunkMesh.add(rglass);
  const garnish = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.03), M.chrome); garnish.position.set(0, 0.98 - 1.70, -2.385 + 2.26); trunkMesh.add(garnish);
  const emblemR = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 20), M.chrome); emblemR.scale.y = 0.7; emblemR.position.set(0, 1.07 - 1.70, -2.378 + 2.26); trunkMesh.add(emblemR);
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.15), new THREE.MeshBasicMaterial({ map: plateTex, side: THREE.DoubleSide }));
  rPlate.position.set(0, 0.80 - 1.70, -2.385 + 2.26); rPlate.rotation.y = Math.PI; trunkMesh.add(rPlate);
  const wiperR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.015), M.pianoBlack); wiperR.position.set(-0.12, 1.22 - 1.70, -2.318 + 2.26); wiperR.rotation.z = 0.35; trunkMesh.add(wiperR);
  chassis.add(trunkMesh);

  // rear bumper, reflectors, exhaust
  box(W * 0.94, 0.12, 0.06, plasticMat, 0, 0.36, -2.34);
  [-0.72, 0.72].forEach(x => box(0.18, 0.04, 0.02, tailMat(), x, 0.47, -2.325));
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.20, 14), M.chrome);
  pipe.rotation.x = Math.PI / 2; pipe.position.set(0.48, 0.27, -2.30); chassis.add(pipe);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.65, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 }));
  flame.rotation.x = -Math.PI / 2; flame.position.set(0.48, 0.27, -2.72); flame.visible = false;
  chassis.add(flame); nosFlameJets.push(flame);

  // L-shaped tail lamps wrapping onto the quarter panel
  [-1, 1].forEach(sd => {
    const v = box(0.17, 0.17, 0.05, tailMat(), sd * 0.785, 1.07, -2.325);                                       // red corner unit at the base of the screen
    const h = faceExtrude((sd > 0 ? [[0.36, 1.1], [0.7, 1.15], [0.7, 0.99], [0.42, 1.03]] : [[-0.42, 1.03], [-0.7, 0.99], [-0.7, 1.15], [-0.36, 1.1]]), 0.03, tailMat()); h.position.z = -2.385; chassis.add(h);   // tapering arm on the gate
    box(0.1, 0.035, 0.035, new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }), sd * 0.56, 1.065, -2.39);          // reverse lamp inside the arm
    const leg = box(0.075, 0.27, 0.045, new THREE.MeshPhongMaterial({ color: 0xc9ced4, specular: 0xffffff, shininess: 120 }), sd * 0.83, 0.85, -2.322); leg.rotation.z = sd * 0.16;   // clear lower leg
    box(0.045, 0.06, 0.05, new THREE.MeshBasicMaterial({ color: 0xffb020 }), sd * 0.835, 0.88, -2.326);         // amber indicator in the leg
    const wrap = box(0.02, 0.15, 0.2, tailMat(), sd * (W / 2 + 0.002), 1.07, -2.225);                           // onto the quarter panel
    rearBrakeLights.push(v, h, wrap);
  });

  // ---------------- 5. doors: real panels that swing open on front hinges
  const DOOR = [{ id: 'FL', sd: -1, z0: 0.90, z1: 0.02, win: [[0.86, 1.10], [0.24, 1.60], [0.04, 1.62], [0.04, 1.10]] },
                { id: 'FR', sd: 1, z0: 0.90, z1: 0.02, win: [[0.86, 1.10], [0.24, 1.60], [0.04, 1.62], [0.04, 1.10]] },
                { id: 'RL', sd: -1, z0: 0.00, z1: -0.90, win: [[-0.02, 1.10], [-0.02, 1.64], [-0.86, 1.66], [-0.86, 1.10]] },
                { id: 'RR', sd: 1, z0: 0.00, z1: -0.90, win: [[-0.02, 1.10], [-0.02, 1.64], [-0.86, 1.66], [-0.86, 1.10]] }];
  const cardMat = new THREE.MeshLambertMaterial({ color: 0x2a2c30 });
  const woodMat = new THREE.MeshPhongMaterial({ color: 0x6b3f22, shininess: 50 });
  const leatherMat = new THREE.MeshLambertMaterial({ color: 0x6a4325 });
  DOOR.forEach(d => {
    const g = new THREE.Group(); const xo = d.sd * W / 2;
    g.position.set(xo, 0, d.z0);
    const len = d.z0 - d.z1;
    // outer skin: profile in (z, y) relative to hinge, 7 cm thick, curving in at the bottom
    const skin = sideExtrude(s => {
      s.moveTo(0, 0.40); s.lineTo(0, 1.07); s.lineTo(-len, 1.08); s.lineTo(-len, 0.40);
      s.quadraticCurveTo(-len / 2, 0.36, 0, 0.40);
    }, 0.07, M.paint, 0.01);
    skin.position.x = -d.sd * 0.035; g.add(skin);
    // window frame (black sash) and glass, relative to hinge
    const winPts = d.win.map(p => [p[0] - d.z0, p[1]]);
    const frameShape = new THREE.Shape(winPts.map(p => new THREE.Vector2(p[0], p[1])));
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.025, bevelSegments: 1 }), M.pianoBlack);
    frame.geometry.rotateY(-Math.PI / 2); frame.position.x = -d.sd * 0.05 + 0.015; g.add(frame);
    const gl = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.012, bevelEnabled: false }), M.glass);
    gl.geometry.rotateY(-Math.PI / 2); gl.position.x = d.sd * 0.012 - d.sd * 0.03 + 0.006; gl.scale.set(1, 0.985, 0.985); g.add(gl);
    // chrome window line, handle, seams
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, len - 0.04), M.chrome); belt.position.set(d.sd * 0.002, 1.085, -len / 2); g.add(belt);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.17), M.chrome);
    handle.position.set(d.sd * 0.012, 0.98, -len + 0.22); g.add(handle);
    // inner door card with wood strip, armrest, pull handle and speaker
    const ix = -d.sd * 0.075;
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, len - 0.08), cardMat); card.position.set(ix, 0.74, -len / 2); g.add(card);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, len - 0.22), woodMat); strip.position.set(ix - d.sd * 0.005, 0.95, -len / 2); g.add(strip);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, len * 0.45), leatherMat); arm.position.set(ix - d.sd * 0.04, 0.82, -len * 0.55); g.add(arm);
    const pull = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.12), M.chrome); pull.position.set(ix - d.sd * 0.02, 0.97, -0.18); g.add(pull);
    const spk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    spk.rotation.z = Math.PI / 2; spk.position.set(ix - d.sd * 0.016, 0.56, -len * 0.3); g.add(spk);
    chassis.add(g);
    doorMeshes[d.id] = { group: g, isLeft: d.sd < 0 };
  });
  // door-opening edges: black seals and the B-pillar the doors close against
  [-1, 1].forEach(sd => {
    const seal = (h, z, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.03), M.pianoBlack); m.position.set(sd * (W / 2 - 0.09), y, z); chassis.add(m); };
    seal(0.70, 0.905, 0.75); seal(0.70, -0.905, 0.75); seal(0.70, 0.01, 0.75);
  });

  // shut lines: thin dark gaps around the doors, hood, tailgate and the fuel lid
  const gapM = new THREE.MeshBasicMaterial({ color: 0x15171a });
  [-1, 1].forEach(sd => {
    const x = sd * (W / 2 + 0.004);
    [0.905, 0.01, -0.905].forEach(z => box(0.006, 0.66, 0.006, gapM, x, 0.74, z));
    box(0.006, 0.006, 1.80, gapM, x, 0.405, 0.0);
    { const he = box(0.012, 0.006, 1.10, gapM, sd * (W / 2 - 0.10), 0.995, 1.62); he.rotation.x = 0.125; }       // hood edge
    box(0.006, 0.52, 0.006, gapM, sd * (W / 2 - 0.13), 0.90, -2.33);             // tailgate edge
    box(0.03, 0.035, 0.022, M.chrome, x, 1.095, -1.55).scale.set(0.5, 0.5, 60);   // chrome window line, rear quarter
  });
  { const fuel = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.004, 4, 24), gapM); fuel.rotation.y = Math.PI / 2; fuel.scale.set(1, 1, 1.2); fuel.position.set(-(W / 2 + 0.005), 0.92, -1.62); chassis.add(fuel); }
  box(W + 0.01, 0.006, 0.006, gapM, 0, 0.94, 2.20);                                // hood front shut line

  // ---------------- 6. folding mirrors with indicator strip
  [-1, 1].forEach(sd => {
    const g = new THREE.Group(); g.position.set(sd * (W / 2 - 0.02), 1.06, 0.90);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.14), plasticMat); base.position.x = sd * 0.04; g.add(base);
    const housing = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), M.paint);
    housing.scale.set(1.3, 0.8, 0.6); housing.position.set(sd * 0.15, 0.03, -0.02); g.add(housing);
    const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.10), M.chrome); glassM.position.set(sd * 0.15, 0.03, -0.075); glassM.rotation.y = Math.PI; g.add(glassM);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.02), new THREE.MeshBasicMaterial({ color: 0xffa726 })); ind.position.set(sd * 0.17, 0.0, 0.03); g.add(ind);
    chassis.add(g);
    mirrorMeshes[sd < 0 ? 'L' : 'R'] = { group: g, isLeft: sd < 0 };
  });

  // ---------------- 7. wipers
  [-0.34, 0.26].forEach(wx => {
    const arm = new THREE.Group(); arm.position.set(wx, 1.08, 1.03); arm.rotation.x = -0.62;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.50, 0.02), M.pianoBlack); blade.position.y = 0.25; arm.add(blade);
    chassis.add(arm); wiperMeshes.push(arm);
  });

  // ---------------- 8. front: trapezoid grille, swept headlamps, fog lamps
  const FZ = 2.415;
  const surround = faceExtrude([[-0.57, 0.88], [0.57, 0.88], [0.43, 0.48], [-0.43, 0.48]], 0.05, M.chrome, 0.012);   // hexagonal grille, widest at the top
  surround.position.z = FZ - 0.03; chassis.add(surround);
  const insert = faceExtrude([[-0.535, 0.85], [0.535, 0.85], [0.4, 0.51], [-0.4, 0.51]], 0.06, M.pianoBlack);
  insert.position.z = FZ - 0.025; chassis.add(insert);
  const slatM = new THREE.MeshPhongMaterial({ color: 0x3d4249, specular: 0xb4bcc6, shininess: 110 });
  [0.795, 0.73, 0.665, 0.6, 0.54].forEach(y => {                    // broad gloss slats, a shade lighter than the backing so they read
    const half = 0.4 + (y - 0.51) / 0.34 * 0.135;
    box(half * 2 - 0.04, 0.034, 0.03, slatM, 0, y, FZ + 0.035);
  });
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.017, 6, 24), M.chrome);
  emblem.scale.y = 0.68; emblem.position.set(0, 0.76, FZ + 0.065); chassis.add(emblem);
  const emb2 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 16), M.chrome);
  emb2.scale.x = 0.55; emb2.position.set(0, 0.77, FZ + 0.065); chassis.add(emb2);
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.14), new THREE.MeshBasicMaterial({ map: plateTex, side: THREE.DoubleSide }));
  fPlate.position.set(0, 0.40, FZ + 0.045); chassis.add(fPlate);
  box(W * 0.80, 0.07, 0.06, plasticMat, 0, 0.33, FZ - 0.02);        // lower lip / air dam

  [-1, 1].forEach(sd => {
    // swept headlamp housing following the hood line, wrapping round the corner
    const g = new THREE.Group(); g.position.set(sd * 0.0, 0, 0);
    const pts = [[0.585, 0.885], [0.9, 0.92], [0.9, 0.825], [0.56, 0.795]].map(p => [sd * p[0], p[1]]);   // slim unit running out from the grille's top corner
    if (sd < 0) pts.reverse();
    const housing = faceExtrude(pts, 0.05, M.pianoBlack, 0.01); housing.position.z = FZ - 0.045; g.add(housing);
    const lens = faceExtrude(pts, 0.02, lensMat); lens.position.z = FZ + 0.012; g.add(lens);
    const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), new THREE.MeshBasicMaterial({ color: 0x555555 }));
    proj.scale.setScalar(0.8); proj.rotation.x = Math.PI / 2; proj.position.set(sd * 0.76, 0.86, FZ + 0.005); g.add(proj);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.016, 0.01), new THREE.MeshBasicMaterial({ color: 0xe0f2fe }));
    drl.position.set(sd * 0.74, 0.817, FZ + 0.018); drl.rotation.z = sd * 0.09; g.add(drl);
    const ledM = new THREE.MeshBasicMaterial({ color: 0xf0f9ff });
    const led2 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.012, 0.01), ledM); led2.position.set(sd * 0.74, 0.897, FZ + 0.016); led2.rotation.z = sd * 0.11; g.add(led2);
    const led3 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.01), ledM); led3.scale.y = 0.6; led3.position.set(sd * 0.885, 0.87, FZ + 0.016); g.add(led3);
    const proj2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), M.chrome);
    proj2.scale.setScalar(0.8); proj2.rotation.x = Math.PI / 2; proj2.position.set(sd * 0.65, 0.85, FZ + 0.002); g.add(proj2);
    const side = box(0.03, 0.08, 0.22, lensMat, sd * (W / 2 - 0.01), 0.87, 2.24);
    chassis.add(g);
    frontHeadlights.push(proj);
    const spot = new THREE.SpotLight(0xffffff, 0, 70, Math.PI / 6, 0.3);
    spot.position.set(sd * 0.76, 0.86, FZ + 0.1); spot.target.position.set(sd * 0.74, 0, FZ + 30);
    chassis.add(spot); chassis.add(spot.target); proj.userData.spot = spot;
    // fog lamp in a chrome-trimmed bezel
    const bezel = faceExtrude(sd > 0 ? [[0.6, 0.72], [0.87, 0.69], [0.8, 0.43], [0.68, 0.47]] : [[-0.68, 0.47], [-0.8, 0.43], [-0.87, 0.69], [-0.6, 0.72]], 0.07, M.pianoBlack);   // triangular corner housing
    bezel.position.z = FZ - 0.025; chassis.add(bezel);
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 14), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    fog.rotation.x = Math.PI / 2; fog.position.set(sd * 0.75, 0.56, FZ + 0.05); chassis.add(fog);
  });
}
