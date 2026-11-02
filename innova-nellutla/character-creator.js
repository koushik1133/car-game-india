// character-creator.js: "Village Look" character creator for the on-foot player.
// Opens from the start screen button or with U while on foot. Live turntable preview in its own renderer.
// Saves to localStorage 'nellutla.character' and rebuilds the player's HumanModel in place.
const CharacterCreator = (function () {
  const KEY = 'nellutla.character';
  const H = HumanModel;
  const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');

  const PRESETS = {
    'Farmer':            { gender: 'm', height: 0.98, build: 1.05, skin: 0x6b4028, face: 'square', brows: 'thick', hair: 'short', hairColor: 0x2a1d15, facial: 'moustache', top: 'vest', topColor: 0xf3efe6, bottom: 'lungi', bottomColor: 0x9fc5e8, feet: 'chappals', feetColor: 0x5a3a24, acc: { towel: true, turban: true }, turbanColor: 0xffffff },
    'College student':   { gender: 'm', height: 1.02, build: 0.95, skin: 0xa36b45, face: 'oval', brows: 'medium', hair: 'sidepart', hairColor: 0x141210, facial: 'stubble', top: 'tshirt', topColor: 0x2f6fb3, bottom: 'jeans', bottomColor: 0x2c4a7a, feet: 'shoes', feetColor: 0xf3efe6, acc: { watch: true, sunglasses: true } },
    'Auto driver':       { gender: 'm', height: 0.97, build: 1.0, skin: 0x7a4a2e, face: 'round', brows: 'thick', hair: 'curly', hairColor: 0x141210, facial: 'handlebar', top: 'uniform', topColor: 0xc2a36b, bottom: 'trousers', bottomColor: 0xb8995e, feet: 'chappals', feetColor: 0x3b2a1e, acc: { watch: true, chain: true } },
    'Teacher':           { gender: 'f', height: 1.0, build: 1.0, skin: 0xb98059, face: 'oval', brows: 'arched', hair: 'bun', hairColor: 0x141210, facial: 'none', top: 'blouse', topColor: 0x0d47a1, bottom: 'saree', bottomColor: 0x00897b, feet: 'chappals', feetColor: 0x6d4c41, acc: { bindi: true, bangles: true, earrings: true, watch: true, chain: true } },
    'Grandma in saree':  { gender: 'f', height: 0.94, build: 1.1, skin: 0x8d5a3b, face: 'round', brows: 'thin', hair: 'bun', hairColor: 0xd8d4cc, facial: 'none', top: 'blouse', topColor: 0x7b1fa2, bottom: 'saree', bottomColor: 0xc62828, feet: 'barefoot', acc: { bindi: true, bangles: true, earrings: true, chain: true } },
    'Young woman':       { gender: 'f', height: 1.0, build: 0.92, skin: 0xcf9a73, face: 'oval', brows: 'arched', hair: 'braid', hairColor: 0x141210, facial: 'none', top: 'kameez', topColor: 0xf48fb1, bottom: 'salwar', bottomColor: 0xf3efe6, dupattaColor: 0xad1457, feet: 'chappals', feetColor: 0xc8a26a, acc: { bindi: true, bangles: true, earrings: true } },
    'Shopkeeper':        { gender: 'm', height: 0.96, build: 1.18, skin: 0xa36b45, face: 'round', brows: 'medium', hair: 'bald', hairColor: 0x2a1d15, facial: 'moustache', top: 'kurta', topColor: 0xf3efe6, bottom: 'dhoti', bottomColor: 0xffffff, feet: 'chappals', feetColor: 0x3b2a1e, acc: { chain: true, watch: true } },
    'Police constable':  { gender: 'm', height: 1.04, build: 1.08, skin: 0x8d5a3b, face: 'square', brows: 'thick', hair: 'short', hairColor: 0x141210, facial: 'moustache', top: 'uniform', topColor: 0xc2a36b, bottom: 'trousers', bottomColor: 0xb8995e, feet: 'shoes', feetColor: 0x1a120c, acc: { cap: true, watch: true }, capColor: 0x8a6d3b },
    'School girl':       { gender: 'f', child: true, height: 1.0, build: 0.9, skin: 0xb98059, face: 'round', brows: 'thin', hair: 'braid', hairColor: 0x141210, facial: 'none', top: 'school', topColor: 0xf7f7f2, bottom: 'schoolskirt', bottomColor: 0x1f2a4d, feet: 'shoes', feetColor: 0x111111, acc: { bindi: true } },
  };
  const DEFAULT = PRESETS['College student'];
  const clone = o => JSON.parse(JSON.stringify(o));

  function load() { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function store(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } }

  let saved = load(), cur = clone(saved || DEFAULT), backup = null;
  function current() { return saved ? clone(saved) : null; }

  // apply to the in-game on-foot player (HumanModel.player is the human player.js created)
  function applyToPlayer(a) {
    H.playerAppearance = clone(a);
    if (H.player) {
      const vis = H.player.group.visible;
      H.rebuild(H.player, clone(a));
      H.player.group.visible = vis;
      H.player.group.traverse(m => { if (m.isMesh) { m.castShadow = true; } });
    }
  }

  // ------------------------------------------------------------ UI
  let root, prev, previewHuman, rnd, scn, cam, open = false, rotY = 0.4, drag = null, tab = 'Presets', t0 = 0, zoom = 0;
  const css = `
  #ccRoot{position:fixed;inset:0;z-index:60;display:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5efe6;
    background:radial-gradient(120% 90% at 30% 40%,#3a2418 0%,#1a120e 55%,#0c0807 100%)}
  #ccRoot.on{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,440px)}
  #ccStage{position:relative;overflow:hidden}
  #ccStage canvas{width:100%;height:100%;display:block;cursor:grab}
  #ccTitle{position:absolute;left:28px;top:22px;letter-spacing:.32em;font-size:12px;color:#e9b45c;text-transform:uppercase}
  #ccTitle b{display:block;font-size:30px;letter-spacing:.06em;color:#fff7ea;font-weight:800;text-transform:none;margin-top:4px}
  #ccHint{position:absolute;left:28px;bottom:22px;font-size:12px;color:#c8b8a2;opacity:.8}
  #ccZoom{position:absolute;right:18px;bottom:18px;display:flex;gap:8px}
  #ccZoom button{background:rgba(255,255,255,.08);border:1px solid rgba(233,180,92,.4);color:#fff;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:12px}
  #ccPanel{background:linear-gradient(180deg,rgba(18,12,10,.92),rgba(10,7,6,.97));border-left:1px solid rgba(233,180,92,.25);display:flex;flex-direction:column;min-height:0}
  #ccTabs{display:flex;flex-wrap:wrap;gap:4px;padding:16px 16px 0}
  #ccTabs button{flex:1 0 auto;background:none;border:none;border-bottom:2px solid transparent;color:#bfae96;padding:10px 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
  #ccTabs button.on{color:#fff;border-color:#e9b45c}
  #ccBody{flex:1;overflow:auto;padding:12px 20px 20px}
  .ccRow{margin:14px 0}
  .ccLbl{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#d7a85a;margin-bottom:8px}
  .ccChips{display:flex;flex-wrap:wrap;gap:6px}
  .ccChip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#efe6d8;border-radius:8px;padding:7px 11px;font-size:13px;cursor:pointer}
  .ccChip.on{background:#e9b45c;color:#1b120b;border-color:#e9b45c;font-weight:700}
  .ccSw{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.18);cursor:pointer;padding:0}
  .ccSw.on{outline:2px solid #e9b45c;outline-offset:2px}
  .ccRange{width:100%;accent-color:#e9b45c}
  .ccPreset{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .ccPreset button{text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(233,180,92,.25);border-radius:10px;padding:12px;color:#fff;cursor:pointer;font-size:14px}
  .ccPreset button:hover{background:rgba(233,180,92,.15)}
  .ccPreset small{display:block;color:#b8a68c;font-size:11px;margin-top:3px}
  #ccFoot{display:flex;gap:8px;padding:14px 16px;border-top:1px solid rgba(255,255,255,.08)}
  #ccFoot button{flex:1;padding:12px;border-radius:10px;font-weight:800;letter-spacing:.08em;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff}
  #ccFoot #ccSave{background:#e9b45c;color:#1b120b;border-color:#e9b45c}
  #ccOpenBtn{padding:10px 22px;border-radius:10px;border:1px solid #e9b45c;background:rgba(233,180,92,.12);color:#ffe2ad;font-weight:700;letter-spacing:.06em;cursor:pointer;font-size:14px}
  @media (max-width:760px){#ccRoot.on{grid-template-columns:1fr;grid-template-rows:42vh 1fr}#ccPanel{border-left:none}}`;

  const LABELS = {
    m: 'Male', f: 'Female', oval: 'Oval', round: 'Round', square: 'Square', long: 'Long', thin: 'Thin', medium: 'Medium', thick: 'Thick', arched: 'Arched',
    short: 'Short crop', sidepart: 'Side part', curly: 'Curly', braid: 'Long braid', bun: 'Bun', long: 'Long open', bald: 'Bald',
    none: 'Clean', moustache: 'Moustache', beard: 'Full beard', stubble: 'Stubble', handlebar: 'Handlebar',
    shirt: 'Shirt', tshirt: 'T-shirt', kurta: 'Kurta', kameez: 'Kameez', blouse: 'Saree blouse', school: 'School shirt', uniform: 'Khaki uniform', vest: 'Banian',
    trousers: 'Trousers', jeans: 'Jeans', lungi: 'Lungi', dhoti: 'Dhoti', saree: 'Saree', salwar: 'Salwar', schoolskirt: 'School skirt', shorts: 'Shorts',
    chappals: 'Chappals', shoes: 'Shoes', barefoot: 'Barefoot',
    sunglasses: 'Sunglasses', watch: 'Watch', chain: 'Gold chain', bindi: 'Bindi', bangles: 'Bangles', earrings: 'Earrings', cap: 'Cap', turban: 'Turban (talapaga)', towel: 'Shoulder towel',
  };
  const L = k => LABELS[k] || k;

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'ccRoot';
    root.innerHTML = `<div id="ccStage"><div id="ccTitle">Nellutla · Village look<b>Create your character</b></div>
      <div id="ccHint">Drag to turn · scroll to zoom</div><div id="ccZoom"><button data-z="0">Full body</button><button data-z="1">Face</button></div></div>
      <div id="ccPanel"><div id="ccTabs"></div><div id="ccBody"></div>
      <div id="ccFoot"><button id="ccRand">Randomize</button><button id="ccCancel">Cancel</button><button id="ccSave">Save</button></div></div>`;
    document.body.appendChild(root);
    const stage = root.querySelector('#ccStage');
    // preview renderer
    rnd = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rnd.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    rnd.shadowMap.enabled = true;
    stage.insertBefore(rnd.domElement, stage.firstChild);
    scn = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    scn.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3020, 0.75));
    const key = new THREE.DirectionalLight(0xffe2b8, 0.95); key.position.set(2.2, 3.5, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.5; key.shadow.camera.right = key.shadow.camera.top = 1.5; scn.add(key);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.45); rim.position.set(-3, 2.5, -2.5); scn.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.06, 48), new THREE.MeshPhongMaterial({ color: 0x5a3a26, shininess: 30 }));
    disc.position.y = -0.03; disc.receiveShadow = true; scn.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.008, 6, 64), new THREE.MeshBasicMaterial({ color: 0xe9b45c })); ring.rotation.x = Math.PI / 2; scn.add(ring);
    prev = new THREE.Group(); scn.add(prev);
    // drag to rotate, wheel to zoom
    const cv = rnd.domElement;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, r: rotY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (drag) rotY = drag.r + (e.clientX - drag.x) * 0.01; });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(0, Math.min(1, zoom + (e.deltaY > 0 ? -0.15 : 0.15))); }, { passive: false });
    root.querySelectorAll('#ccZoom button').forEach(b => b.onclick = () => { zoom = +b.dataset.z; });
    const tabs = root.querySelector('#ccTabs');
    for (const t of ['Presets', 'Body', 'Face', 'Hair', 'Outfit', 'Accessories']) {
      const b = document.createElement('button'); b.textContent = t; b.onclick = () => { tab = t; renderTab(); }; tabs.appendChild(b);
    }
    root.querySelector('#ccRand').onclick = () => { cur = H.randomAppearance(); delete cur.lod; refresh(); };
    root.querySelector('#ccCancel').onclick = () => close(false);
    root.querySelector('#ccSave').onclick = () => close(true);
    window.addEventListener('resize', size);
  }

  function chips(label, key, list, obj) {
    obj = obj || cur;
    const row = document.createElement('div'); row.className = 'ccRow';
    row.innerHTML = `<div class="ccLbl">${label}</div>`;
    const box = document.createElement('div'); box.className = 'ccChips';
    for (const v of list) {
      const b = document.createElement('button'); b.className = 'ccChip' + (obj[key] === v ? ' on' : ''); b.textContent = L(v);
      b.onclick = () => { obj[key] = v; fixCombos(key); refresh(); }; box.appendChild(b);
    }
    row.appendChild(box); return row;
  }
  function swatches(label, key, list) {
    const row = document.createElement('div'); row.className = 'ccRow'; row.innerHTML = `<div class="ccLbl">${label}</div>`;
    const box = document.createElement('div'); box.className = 'ccChips';
    for (const c of list) {
      const b = document.createElement('button'); b.className = 'ccSw' + (cur[key] === c ? ' on' : ''); b.style.background = hex(c); b.title = hex(c);
      b.onclick = () => { cur[key] = c; refresh(); }; box.appendChild(b);
    }
    row.appendChild(box); return row;
  }
  function slider(label, key, min, max) {
    const row = document.createElement('div'); row.className = 'ccRow';
    row.innerHTML = `<div class="ccLbl">${label}</div>`;
    const r = document.createElement('input'); r.type = 'range'; r.className = 'ccRange'; r.min = min; r.max = max; r.step = 0.01; r.value = cur[key] || 1;
    r.oninput = () => { cur[key] = +r.value; rebuildPreview(); }; row.appendChild(r); return row;
  }
  // keep tops / bottoms sensible together
  function fixCombos(key) {
    if (key === 'bottom' && cur.bottom === 'saree') cur.top = 'blouse';
    if (key === 'top' && cur.top === 'blouse' && cur.bottom !== 'saree') cur.bottom = 'saree';
    if (key === 'bottom' && cur.bottom !== 'saree' && cur.top === 'blouse') cur.top = cur.gender === 'f' ? 'kameez' : 'shirt';
    if (key === 'top' && cur.top === 'kameez' && cur.bottom !== 'salwar') cur.bottom = 'salwar';
    if (key === 'gender') {
      if (cur.gender === 'f') { cur.facial = 'none'; if (['short', 'bald', 'sidepart', 'curly'].includes(cur.hair)) cur.hair = 'braid'; cur.brows = 'arched'; }
      else { if (['braid', 'bun', 'long'].includes(cur.hair)) cur.hair = 'short'; if (['blouse', 'kameez'].includes(cur.top)) { cur.top = 'shirt'; cur.bottom = 'trousers'; } if (cur.bottom === 'schoolskirt') cur.bottom = 'shorts'; }
    }
  }
  function renderTab() {
    root.querySelectorAll('#ccTabs button').forEach(b => b.classList.toggle('on', b.textContent === tab));
    const body = root.querySelector('#ccBody'); body.innerHTML = ''; const O = H.OPTIONS;
    const add = el => body.appendChild(el);
    if (tab === 'Presets') {
      const g = document.createElement('div'); g.className = 'ccPreset';
      const desc = { 'Farmer': 'Banian, lungi, talapaga', 'College student': 'Tee, jeans, shades', 'Auto driver': 'Khaki, handlebar moustache', 'Teacher': 'Cotton saree, bun',
        'Grandma in saree': 'Silver hair, silk saree', 'Young woman': 'Salwar kameez, dupatta', 'Shopkeeper': 'Kurta, dhoti, gold chain', 'Police constable': 'Khaki uniform, cap', 'School girl': 'Uniform, braid, tie' };
      for (const n of Object.keys(PRESETS)) {
        const b = document.createElement('button'); b.innerHTML = `${n}<small>${desc[n] || ''}</small>`;
        b.onclick = () => { cur = clone(PRESETS[n]); refresh(); }; g.appendChild(b);
      }
      add(g);
    } else if (tab === 'Body') {
      add(chips('Gender', 'gender', O.gender)); add(slider('Height', 'height', 0.9, 1.1)); add(slider('Build', 'build', 0.85, 1.2));
    } else if (tab === 'Face') {
      add(swatches('Skin tone', 'skin', H.SKINS)); add(chips('Face shape', 'face', O.face)); add(chips('Eyebrows', 'brows', O.brows)); add(swatches('Eye colour', 'eyes', H.EYES));
    } else if (tab === 'Hair') {
      add(chips('Hair style', 'hair', O.hair)); add(swatches('Hair colour', 'hairColor', H.HAIR_COLORS));
      if (cur.gender !== 'f') add(chips('Facial hair', 'facial', O.facial));
    } else if (tab === 'Outfit') {
      add(chips('Top', 'top', O.top)); add(swatches('Top colour', 'topColor', H.PALETTE));
      add(chips('Bottom', 'bottom', O.bottom)); add(swatches('Bottom colour', 'bottomColor', H.PALETTE));
      if (cur.top === 'kameez') add(swatches('Dupatta colour', 'dupattaColor', H.PALETTE));
      add(chips('Footwear', 'feet', O.feet)); add(swatches('Footwear colour', 'feetColor', [0x3b2a1e, 0x5a3a24, 0x111111, 0x6d4c41, 0xc8a26a, 0xf3efe6, 0xc62828, 0x1f2a4d]));
    } else if (tab === 'Accessories') {
      cur.acc = cur.acc || {};
      const row = document.createElement('div'); row.className = 'ccRow'; row.innerHTML = '<div class="ccLbl">Wear</div>';
      const box = document.createElement('div'); box.className = 'ccChips';
      for (const a of O.acc) {
        const b = document.createElement('button'); b.className = 'ccChip' + (cur.acc[a] ? ' on' : ''); b.textContent = L(a);
        b.onclick = () => { cur.acc[a] = !cur.acc[a]; if (a === 'cap' && cur.acc.cap) cur.acc.turban = false; if (a === 'turban' && cur.acc.turban) cur.acc.cap = false; refresh(); };
        box.appendChild(b);
      }
      row.appendChild(box); add(row);
      add(swatches('Jewellery metal', 'accColor', [0xd4a530, 0xe8c66a, 0xc0c0c0, 0xb87333]));
      if (cur.acc.turban) add(swatches('Turban colour', 'turbanColor', H.PALETTE));
      if (cur.acc.cap) add(swatches('Cap colour', 'capColor', H.PALETTE));
    }
  }
  function rebuildPreview() {
    if (previewHuman) prev.remove(previewHuman.group);
    const a = clone(cur); a.lod = 'high';
    const keep = H.player; previewHuman = H.create(a); H.player = keep;
    previewHuman.group.traverse(m => { if (m.isMesh) m.castShadow = true; });
    prev.add(previewHuman.group);
  }
  function refresh() { rebuildPreview(); renderTab(); }
  function size() {
    if (!rnd) return; const st = root.querySelector('#ccStage'), w = st.clientWidth || 600, h = st.clientHeight || 600;
    rnd.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }

  function openUI() {
    if (!root) build();
    backup = clone(cur); open = true; root.classList.add('on'); size(); refresh();
    if (typeof inputState === 'object') Object.keys(inputState).forEach(k => inputState[k] = false);
    t0 = performance.now(); requestAnimationFrame(loop);
  }
  function close(save) {
    open = false; root.classList.remove('on');
    if (save) { delete cur.lod; saved = clone(cur); store(saved); applyToPlayer(saved); }
    else cur = backup || cur;
  }
  function loop(now) {
    if (!open) return;
    const t = (now - t0) / 1000;
    if (!drag) rotY += 0.004;
    prev.rotation.y = rotY;
    if (previewHuman) H.animateIdle(previewHuman.parts, t);
    const top = previewHuman ? previewHuman.hipHeight / 0.92 * 1.78 : 1.7;
    const fy = THREE.MathUtils.lerp(top * 0.52, top * 0.93, zoom), dist = THREE.MathUtils.lerp(4.4, 1.05, zoom);
    cam.position.set(0, fy + 0.08 * (1 - zoom), dist); cam.lookAt(0, fy, 0);
    rnd.render(scn, cam);
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ hooks
  GameHooks.init.push(() => {
    if (saved) applyToPlayer(saved);
    const start = document.getElementById('start');
    if (start && !document.getElementById('ccOpenBtn')) {
      if (!root) build();
      const b = document.createElement('button'); b.id = 'ccOpenBtn'; b.type = 'button'; b.textContent = 'Customize Character';
      b.onclick = e => { e.stopPropagation(); openUI(); };
      const go = document.getElementById('go');
      if (go && go.parentNode === start) start.insertBefore(b, go.nextSibling); else start.appendChild(b);
    }
  });
  GameHooks.key.push(e => {
    if (open) {
      if (e.code === 'Escape') close(false);
      else if (e.code === 'Enter') close(true);
      return true;                     // creator swallows game keys while open
    }
    if (e.code === 'KeyU' && typeof Player !== 'undefined' && Player.mode === 'foot') { openUI(); return true; }
    return false;
  });

  return { current, open: openUI, close, presets: PRESETS, apply: applyToPlayer, get isOpen() { return open; } };
})();
