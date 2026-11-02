// Performance tiers (low / medium / high). Loaded before the main game script so the renderer can
// read Quality.initial.antialias / pixelRatio when it is created. After the scene exists, index.html
// calls Quality.attach({...}) and the tier is applied to live objects. Nothing in nellutla-world.js is
// edited: we only toggle visibility / instance counts / shadow flags of what is already in the scene.
(function () {
  const KEY = 'nellutla.quality';
  const TIERS = {
    low:    { name: 'Low',    pixelRatio: 1,   shadows: false, shadowSize: 512,  fogNear: 120, fogFar: 520,  camFar: 650,  peopleFrac: 0.35, antialias: false },
    medium: { name: 'Medium', pixelRatio: 1.5, shadows: true,  shadowSize: 1024, fogNear: 200, fogFar: 1100, camFar: 2200, peopleFrac: 0.7,  antialias: true },
    high:   { name: 'High',   pixelRatio: 2,   shadows: true,  shadowSize: 2048, fogNear: 250, fogFar: 1700, camFar: 6000, peopleFrac: 1,    antialias: true },
  };
  const ORDER = ['low', 'medium', 'high'];
  const isTouch = window.Device ? Device.isMobile : ((matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0);

  function detect() {
    const minSide = Math.min(screen.width, screen.height), mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
    if (isTouch && minSide < 600) return 'low';                       // phones
    if (mem <= 2 || cores <= 2) return 'low';
    if (isTouch || mem <= 4 || cores <= 4) return 'medium';            // tablets, low-end laptops
    return 'high';
  }
  let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  const mode = TIERS[saved] ? saved : 'auto';                         // 'auto' or a fixed tier the player picked
  let tier = mode === 'auto' ? detect() : mode;

  const Q = window.Quality = {
    TIERS, isTouch, mode, get tier() { return tier; }, detected: detect(),
    initial: { antialias: TIERS[tier].antialias, pixelRatio: Math.min(devicePixelRatio || 1, TIERS[tier].pixelRatio) },
    applied: {}, ctx: null, frameMs: 0, onChange: [],
  };
  const aaAtStart = Q.initial.antialias;

  // ----------------------------------------------------------- apply to live objects
  function apply(name, why) {
    tier = name; const T = TIERS[name], c = Q.ctx; if (!c) return;
    const { renderer, scene, camera, sunLight, sky, stars } = c;
    if (c.world && c.world.setDetail) c.world.setDetail(name);   // fields: crop plants, bund distance
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, T.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    if (sunLight.castShadow !== T.shadows) { sunLight.castShadow = T.shadows; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
    if (sunLight.shadow.mapSize.x !== T.shadowSize) {
      sunLight.shadow.mapSize.set(T.shadowSize, T.shadowSize);
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    if (scene.fog) { scene.fog.near = T.fogNear; scene.fog.far = T.fogFar; }
    camera.far = T.camFar; camera.updateProjectionMatrix();
    // the sky dome (r 3000) and star shell (r 2800) follow the camera: keep them inside the far plane
    const s = Math.min(1, (T.camFar * 0.92) / 3000); if (sky) sky.scale.setScalar(s); if (stars) stars.scale.setScalar(s);
    // villagers are instanced meshes filled person by person, so lowering .count hides the tail of the crowd
    const ppl = c.world && c.world.people;
    if (ppl && ppl.meshes) Object.values(ppl.meshes).forEach(m => { if (m.userData.qFull == null) m.userData.qFull = m.count; m.count = Math.ceil(m.userData.qFull * T.peopleFrac); });
    // far tree crowns: with camFar 650 anything past ~400 m is fogged and clipped; on Low also drop
    // the big far-LOD instanced crown mesh from the shadow pass (already off) and from rendering beyond fog
    Q.applied = { tier: name, pixelRatio: renderer.getPixelRatio(), shadows: T.shadows, shadowSize: T.shadowSize, fog: [T.fogNear, T.fogFar], cameraFar: T.camFar,
      villagers: ppl && ppl.meshes ? Object.values(ppl.meshes)[0].count + '/' + Object.values(ppl.meshes)[0].userData.qFull : 'n/a',
      antialias: aaAtStart, antialiasWanted: T.antialias, why };
    Q.onChange.forEach(f => { try { f(name, why); } catch (e) {} });
  }
  Q.attach = function (ctx) { Q.ctx = ctx; apply(tier, 'start'); startMonitor(); };
  // player choice from the Settings menu: 'auto' | 'low' | 'medium' | 'high'
  Q.set = function (choice) {
    try { if (choice === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch (e) {}
    Q.mode = choice;
    apply(choice === 'auto' ? detect() : choice, 'user');
    if (TIERS[tier].antialias !== aaAtStart) notice('Antialiasing changes after reload');
  };

  // ----------------------------------------------------------- adaptive step-down
  function notice(t) {
    let n = document.getElementById('qNotice');
    if (!n) { n = document.createElement('div'); n.id = 'qNotice'; document.body.appendChild(n); }
    n.textContent = t; n.classList.add('on'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('on'), 3500);
  }
  Q.notice = notice;
  function startMonitor() {
    let last = performance.now(), acc = 0, n = 0, slowFor = 0, cool = 0;
    (function tick(now) {
      requestAnimationFrame(tick);
      const ms = now - last; last = now;
      if (document.hidden || ms > 250) return;                         // tab switch / hitch, not real load
      acc += ms; n++;
      if (acc >= 500) {                                                 // evaluate every half second
        const avg = acc / n; Q.frameMs = avg; acc = 0; n = 0;
        cool = Math.max(0, cool - 0.5);
        slowFor = avg > 33 ? slowFor + 0.5 : 0;
        const i = ORDER.indexOf(tier);
        if (slowFor >= 3 && i > 0 && cool === 0 && Q.mode === 'auto') {   // a tier the player picked by hand is respected
          slowFor = 0; cool = 6;
          apply(ORDER[i - 1], 'adaptive');
          notice('Low frame rate: graphics set to ' + TIERS[tier].name);
        }
      }
    })(performance.now());
  }
})();
