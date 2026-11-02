// Drop-in .glb support for the player car.
// Put a licensed model at innova-nellutla/models/crysta.glb (optional settings in models/crysta.json).
// The model is auto-fitted to the real Crysta size (4735 mm long), sat on the ground, and its wheels and doors
// are hooked up to steering, wheel spin and the 1-4 door keys when their node names make them recognisable.
// Press G in game to switch between the .glb model and the built-in procedural Crysta.
const CrystaGLB = (function () {
  const state = { loaded: false, using: false, root: null, procedural: null, procWheels: null, procDoors: null, wheels: [], doors: {} };
  const defaults = {
    length: 4.735,          // metres, nose to tail
    rotateY: 0,             // extra yaw in degrees if the model faces the wrong way after auto-orientation
    flip: false,            // set true if the car ends up facing backwards
    yOffset: 0,             // lift (+) or sink (-) the body, metres
    hideBuiltInWheels: 'auto',   // true, false or 'auto' (hide when the model has wheels)
    plates: true,           // add the TS 08 HN 1111 plates
  };
  const WHEEL_RE = /(wheel|tyre|tire|rim)/i, DOOR_RE = /door/i;

  function nameOf(o) { let n = ''; for (let p = o; p; p = p.parent) n = (p.name || '') + ' ' + n; return n; }

  function fit(root, cfg) {
    // orient: longest horizontal extent becomes the z (forward) axis
    let box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) root.rotation.y += Math.PI / 2;
    root.rotation.y += (cfg.flip ? Math.PI : 0) + THREE.MathUtils.degToRad(cfg.rotateY);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root); size = box.getSize(new THREE.Vector3());
    const s = cfg.length / size.z;
    root.scale.multiplyScalar(s); root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.position.x -= c.x; root.position.z -= c.z; root.position.y -= box.min.y - cfg.yOffset;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
  }

  // wrap a node in a pivot placed at its bounding-box centre (or a given point) so it can rotate in place
  function pivotAround(node, holder, point) {
    const b = new THREE.Box3().setFromObject(node), center = point || b.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group(); pivot.position.copy(holder.worldToLocal(center.clone()));
    holder.add(pivot); pivot.updateMatrixWorld(true);
    pivot.attach(node);
    return { pivot, box: b };
  }

  function hookWheels(root, holder) {
    const found = [];
    root.traverse(o => { if (o !== root && WHEEL_RE.test(o.name) && !found.some(f => isAncestor(f, o))) found.push(o); });
    // keep only top-most wheel nodes and drop tiny bits (bolts, caps) found inside a bigger match
    const wheels = found.filter(o => { const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return s.y > 0.3; });
    const out = [];
    for (const w of wheels) {
      const steer = new THREE.Group(); const { pivot, box } = pivotAround(w, holder);
      const c = box.getCenter(new THREE.Vector3());
      // steering group sits at the wheel centre; spin group is the pivot inside it
      holder.add(steer); steer.position.copy(pivot.position); steer.attach(pivot);
      out.push({ anchor: steer, tire: pivot, isFront: c.z > 0 });
    }
    return out;
  }
  function isAncestor(a, b) { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; }

  function hookDoors(root, holder) {
    const doors = {};
    root.traverse(o => {
      if (!DOOR_RE.test(o.name) || /(boot|trunk|tail|hood|bonnet)/i.test(o.name)) return;
      const n = nameOf(o).toLowerCase();
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      if (s.y < 0.4 || s.z < 0.5) return;
      const left = /(_l\b|left|\bl\b|_lh|lf|lr|fl|rl)/.test(n) ? true : /(_r\b|right|\br\b|_rh|rf|rr|fr)/.test(n) ? false : c.x < 0;
      const front = /(front|_f|fl|fr|lf|rf)/.test(n) ? true : /(rear|back|_r[lr]|rl|rr|lr)/.test(n) ? false : c.z > -0.1;
      const id = (front ? 'F' : 'R') + (left ? 'L' : 'R');
      if (doors[id]) return;
      // hinge on the front edge, at the outer side
      const hinge = new THREE.Vector3(left ? b.min.x : b.max.x, c.y, b.max.z);
      const { pivot } = pivotAround(o, holder, hinge);
      doors[id] = { group: pivot, isLeft: left };
    });
    return doors;
  }

  function addPlates(holder, box) {
    const tex = createLicensePlateTexture();
    const mk = (z, back) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); m.position.set(0, 0.42, z); if (back) m.rotation.y = Math.PI; holder.add(m); };
    mk(box.max.z + 0.01, false); mk(box.min.z - 0.01, true);
  }

  function use(on) {
    if (!state.loaded) return false;
    state.using = on;
    state.holder.visible = on;
    // procedural body: hide meshes but keep headlight spots working
    state.procedural.traverse(o => { if (o.isMesh) o.visible = !on; });
    const hideWheels = state.cfg.hideBuiltInWheels === 'auto' ? state.wheels.length >= 4 : !!state.cfg.hideBuiltInWheels;
    state.procWheels.forEach(w => w.anchor.visible = !(on && hideWheels));
    wheelMeshes.length = 0;
    (on && hideWheels ? state.wheels : state.procWheels).forEach(w => wheelMeshes.push(w));
    for (const k of Object.keys(doorMeshes)) delete doorMeshes[k];
    Object.assign(doorMeshes, on && Object.keys(state.doors).length ? state.doors : state.procDoors);
    return true;
  }

  function loadFromURL(url, cfg) {
    cfg = Object.assign({}, defaults, cfg || {});
    return new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) return reject(new Error('GLTFLoader not available'));
      new THREE.GLTFLoader().load(url, gltf => {
        const root = gltf.scene;
        root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const holder = new THREE.Group(); holder.name = 'CrystaGLB';
        holder.add(root);
        const box = fit(root, cfg);
        playerCarGroup.add(holder);
        if (state.holder) playerCarGroup.remove(state.holder);
        state.holder = holder; state.root = root; state.cfg = cfg;
        state.procedural = playerCarGroup.children[0];
        state.procWheels = state.procWheels || wheelMeshes.slice();
        state.procDoors = state.procDoors || Object.assign({}, doorMeshes);
        state.wheels = hookWheels(root, holder);
        state.doors = hookDoors(root, holder);
        if (cfg.plates) addPlates(holder, box);
        state.loaded = true;
        use(true);
        resolve({ wheels: state.wheels.length, doors: Object.keys(state.doors), size: box.getSize(new THREE.Vector3()) });
      }, undefined, reject);
    });
  }

  async function tryLoad(base) {
    base = base || 'models/';
    try {
      const head = await fetch(base + 'crysta.glb', { method: 'HEAD' });
      if (!head.ok) return null;
      let cfg = {};
      try { const r = await fetch(base + 'crysta.json'); if (r.ok) cfg = await r.json(); } catch (e) {}
      return await loadFromURL(base + 'crysta.glb', cfg);
    } catch (e) { console.warn('crysta.glb not loaded:', e); return null; }
  }

  return { tryLoad, loadFromURL, toggle() { return state.loaded ? use(!state.using) && state.using : false; }, get loaded() { return state.loaded; } };
})();
