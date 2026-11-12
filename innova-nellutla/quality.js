// Performance tiers (efficient / low / medium / high), hardware detection and dynamic resolution. Loaded before the main game script so the renderer can
// read Quality.initial.antialias / pixelRatio when it is created. After the scene exists, index.html
// calls Quality.attach({...}) and the tier is applied to live objects. Nothing in nellutla-world.js is
// edited: we only toggle visibility / instance counts / shadow flags of what is already in the scene.
(function () {
  const KEY = 'nellutla.quality';
  const TIERS = {
    // camFar sits just past fogFar: everything beyond the fog end is already fully fogged, so it is invisible anyway.
    // shadowEvery: the sun's shadow map is re-rendered every Nth frame (the shadow pass re-draws ~4M triangles of
    // map-wide instanced trees/houses); world-space shadows stay put, only moving objects' shadows lag by a frame or two.
    // pixelRatio is the ceiling of the render scale (CSS pixels x this; under 1 = drawn small and stretched by the canvas).
    // trafficFrac: share of the traffic plan that is spawned (read once at load). weatherPts: most rain / snow particles.
    // legacy: the name older per-tier tables see through Quality.tier (they only know low / medium / high).
    efficient: { name: 'Efficient', pixelRatio: 0.7, shadows: false, shadowSize: 512,  fogNear: 60,  fogFar: 300,  camFar: 340,  peopleFrac: 0.2,  antialias: false, fps: 30, shadowEvery: 4, trafficFrac: 0.5, weatherPts: 500,  legacy: 'low' },
    low:       { name: 'Low',       pixelRatio: 1,   shadows: false, shadowSize: 512,  fogNear: 120, fogFar: 520,  camFar: 600,  peopleFrac: 0.35, antialias: false, fps: 30, shadowEvery: 4, trafficFrac: 0.7, weatherPts: 1200 },
    medium:    { name: 'Medium',    pixelRatio: 1,   shadows: true,  shadowSize: 1024, fogNear: 200, fogFar: 1000, camFar: 1100, peopleFrac: 0.6,  antialias: true,  fps: 60, shadowEvery: 3, trafficFrac: 1,   weatherPts: 2400 },
    high:      { name: 'High',      pixelRatio: 1.5, shadows: true,  shadowSize: 2048, fogNear: 250, fogFar: 1500, camFar: 1600, peopleFrac: 1,    antialias: true,  fps: 60, shadowEvery: 3, trafficFrac: 1,   weatherPts: 4000 },
  };
  const ORDER = ['efficient', 'low', 'medium', 'high'];
  const RES_FLOOR = 0.5;                                               // dynamic resolution never goes under this
  const isTouch = window.Device ? Device.isMobile : ((matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0);

  // ----------------------------------------------------------- hardware detection
  // The GPU name as the browser reports it (empty when it will not say). A throwaway context, released at once.
  function readGpu() {
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const gl = cv.getContext('webgl', { powerPreference: 'high-performance' }) || cv.getContext('experimental-webgl');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return name;
    } catch (e) { return ''; }
  }
  // First match wins; tested against the lower-cased name with (R) / (TM) removed.
  const GPU_TABLE = [
    [/swiftshader|llvmpipe|softpipe|software|basic render/, 'efficient'],          // no GPU at all: drawn on the CPU
    [/apple m\d|apple gpu/, 'high'],
    [/geforce (gt|mx)|geforce \d{3}m\b|\bnvs\b|quadro (k|nvs|fx)/, 'medium'],      // old / entry laptop NVIDIA
    [/nvidia|geforce|quadro|rtx|gtx/, 'high'],
    [/radeon (hd|r[2-7])|mobility radeon|firepro/, 'low'],                         // old AMD
    [/vega/, 'medium'],
    [/radeon (rx|pro)|\brx ?\d{3,4}/, 'high'],
    [/radeon|amd/, 'medium'],                                                      // Ryzen integrated ("Radeon Graphics")
    [/intel.*arc|\barc a\d/, 'high'],
    [/iris.*xe/, 'medium'],
    [/iris|uhd|hd graphics p?[56]\d\d\b/, 'low'],                                  // Iris Plus/Pro, UHD 6xx, HD 5xx/6xx
    [/intel|hd graphics|gma/, 'efficient'],                                        // HD 2000-5500, bare "HD Graphics", older
    [/adreno.*[67]\d\d|mali-g(7\d|[67]1\d)|immortalis/, 'medium'],
    [/adreno.*[2-4]\d\d|mali-(4|t|g3|g5[12])|powervr|videocore|vivante/, 'efficient'],
    [/adreno|mali/, 'low'],
  ];
  const lower = (t, n) => ORDER[Math.max(0, ORDER.indexOf(t) - (n || 1))];
  const minTier = (a, b) => ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
  // info: { gpu, mem (GB, as navigator.deviceMemory), cores, touch, minSide }. Pure, so it can be tested with made-up machines.
  function classify(info) {
    const g = String(info.gpu || '').toLowerCase().replace(/\((r|tm)\)/g, ''), mem = info.mem || 8, cores = info.cores || 8;
    let byGpu = null; for (const [re, t] of GPU_TABLE) if (re.test(g)) { byGpu = t; break; }
    if (info.touch) {
      let t = (info.minSide || 800) < 600 ? 'low' : 'medium';                      // phones / tablets
      if (mem <= 2 || cores <= 2) t = lower(t);
      return byGpu ? minTier(t, byGpu) : t;
    }
    let t = byGpu || (cores <= 4 ? 'medium' : 'high');                             // unknown GPU: guess from the CPU, the frame monitor corrects it
    if (mem <= 4 || cores <= 2) t = lower(t);                                      // small RAM / dual core: one tier lower
    return t;
  }
  function gpuShort(s) {
    const m = /^ANGLE \((.*)\)$/.exec(s); if (m) { const p = m[1].split(','); s = p[1] || p[0]; }
    return s.replace(/\((R|TM)\)|ANGLE Metal Renderer:|Direct3D.*$|OpenGL.*$|vs_\d.*$|[<>&]/gi, '').replace(/\s+/g, ' ').trim();
  }
  const hw = { gpu: readGpu(), mem: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0, touch: isTouch, minSide: Math.min(screen.width, screen.height) };
  hw.gpuName = gpuShort(hw.gpu) || 'unknown GPU';
  const detectedTier = classify(hw);
  function detect() { return detectedTier; }
  let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  const mode = TIERS[saved] ? saved : 'auto';                         // 'auto' or a fixed tier the player picked (a saved choice always wins)
  let tier = mode === 'auto' ? detect() : mode;
  const startTier = tier;

  const Q = window.Quality = {
    TIERS, ORDER, isTouch, mode, detected: detectedTier, hw, classify,
    // tier: the name older per-tier tables understand (Efficient reads as 'low'); level: the real tier
    get tier() { return TIERS[tier].legacy || tier; }, get level() { return tier; }, get T() { return TIERS[tier]; },
    initial: { antialias: TIERS[tier].antialias, pixelRatio: Math.min(devicePixelRatio || 1, TIERS[tier].pixelRatio) },
    trafficFrac: TIERS[startTier].trafficFrac,     // the traffic spawner reads this once, at load
    applied: {}, ctx: null, frameMs: 0, onChange: [],
    // dynamic resolution state: scale = the renderer's pixel ratio now, between floor and ceil (the tier's)
    res: { scale: 1, ceil: 1, floor: RES_FLOOR, ema: 0, tgt: 0, slow: 0, fast: 0, upWait: 6000, lastUp: -1e9, downs: 0, ups: 0 },
    // frame-rate cap: tier default, or 30 when Battery saver is on (saved separately)
    get fpsCap() { let b = false; try { b = localStorage.getItem('nellutla.battery') === '1'; } catch (e) {} return b ? 30 : (TIERS[tier].fps || 60); },
    idleFps: 30,                                   // cap while parked / standing still / on the start screen
    get shadowEvery() { return TIERS[tier].shadowEvery || 1; },
    onBattery: false,
    setBattery(on) { try { localStorage.setItem('nellutla.battery', on ? '1' : '0'); } catch (e) {} },
    get battery() { try { return localStorage.getItem('nellutla.battery') === '1'; } catch (e) { return false; } },
  };
  const aaAtStart = Q.initial.antialias;

  // ----------------------------------------------------------- apply to live objects
  function apply(name, why) {
    tier = name; const T = TIERS[name], c = Q.ctx; if (!c) return;
    const { renderer, scene, camera, sunLight, sky, stars } = c;
    if (c.world && c.world.setDetail) c.world.setDetail(name);   // fields: crop plants, bund distance
    // render scale: the tier's ceiling, except after an automatic step-down, which keeps the (lower) scale it had reached
    const R = Q.res; R.ceil = Math.min(devicePixelRatio || 1, T.pixelRatio); R.floor = Math.min(R.ceil, Math.max(RES_FLOOR, R.ceil * 0.5));
    setScale(why === 'adaptive' ? Math.max(R.floor, Math.min(R.ceil, renderer.getPixelRatio())) : R.ceil);
    R.slow = R.fast = 0; R.upWait = 6000; settle(why === 'start' ? 8 : 3);
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
    Q.applied = { tier: name, pixelRatio: renderer.getPixelRatio(), ceil: R.ceil, shadows: T.shadows, shadowSize: T.shadowSize, fog: [T.fogNear, T.fogFar], cameraFar: T.camFar,
      villagers: ppl && ppl.meshes ? Object.values(ppl.meshes)[0].count + '/' + Object.values(ppl.meshes)[0].userData.qFull : 'n/a',
      antialias: aaAtStart, antialiasWanted: T.antialias, why };
    Q.onChange.forEach(f => { try { f(name, why); } catch (e) {} });
  }
  function setScale(v) {
    const r = Q.ctx.renderer; Q.res.scale = v;
    if (r.getPixelRatio() !== v) { r.setPixelRatio(v); r.setSize(innerWidth, innerHeight); }
  }
  // nothing is judged for a few seconds after start, a tier change, the Start button or coming back to the tab:
  // loading, shader compiling and texture uploads are not the machine's real speed
  let quietUntil = 0;
  function settle(sec) { quietUntil = Math.max(quietUntil, performance.now() + sec * 1000); }
  Q.settle = settle;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(2); });
  Q.attach = function (ctx) { Q.ctx = ctx; apply(tier, 'start'); startMonitor(); watchBattery(); };   // battery: only tracked, never downgrades
  // laptops running on battery: in auto mode use Medium instead of High (and go back up when plugged in)
  function watchBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(b => {
      const check = () => {
        Q.onBattery = !b.charging;
        if (Q.mode !== 'auto') return;
        const want = detect() === 'high' && Q.onBattery ? 'medium' : null;
        void want;   // no auto-downgrade on battery (player wants High on laptops)
      };
      check(); b.addEventListener('chargingchange', check);
    }).catch(() => {});
  }
  // player choice from the Settings menu: 'auto' | 'efficient' | 'low' | 'medium' | 'high'
  Q.set = function (choice) {
    try { if (choice === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch (e) {}
    Q.mode = choice;
    apply(choice === 'auto' ? detect() : choice, 'user');
    if (TIERS[tier].antialias !== aaAtStart || TIERS[tier].trafficFrac !== Q.trafficFrac) notice('Antialiasing and traffic count change after reload');
  };

  // ----------------------------------------------------------- adaptive step-down
  function notice(t) {
    let n = document.getElementById('qNotice');
    if (!n) { n = document.createElement('div'); n.id = 'qNotice'; document.body.appendChild(n); }
    n.textContent = t; n.classList.add('on'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('on'), 3500);
  }
  Q.notice = notice;
  // ----------------------------------------------------------- dynamic resolution
  // Called by the main loop once per rendered frame with the time since the previous rendered frame and the frame-rate
  // cap in force. Late frames for 2 s: one step (1/8) off the render scale, down to the floor. Frames on time for a
  // while: one step back up, never past the tier's ceiling. If a step up is followed by a step down, the wait before
  // the next try doubles (to a minute), so it settles instead of see-sawing. The canvas is resized only on a step.
  let vsync = 16.7;                                                    // the screen's refresh period, measured by the monitor
  Q.frame = function (iv, cap, idle) {
    const R = Q.res, now = performance.now();
    if (!Q.ctx || idle || iv > 250 || now < quietUntil) { R.slow = R.fast = 0; return; }   // hitches and settling time are not load
    // the loop can only draw on a screen refresh, so the real target is the cap rounded up to whole refreshes
    const tgt = vsync * Math.max(1, Math.ceil((1000 / cap - 2) / vsync - 0.02));
    if (Math.abs(tgt - R.tgt) > 1) { R.tgt = tgt; R.ema = tgt; R.slow = R.fast = 0; }
    R.ema += (iv - R.ema) * 0.1;
    if (R.ema > tgt * 1.25) { R.slow += iv; R.fast = 0; } else if (R.ema < tgt * 1.08) { R.fast += iv; R.slow = 0; } else { R.slow = R.fast = 0; }
    if (R.slow > 2000 && R.scale > R.floor) {
      if (now - R.lastUp < 15000) R.upWait = Math.min(60000, R.upWait * 2);   // the last step up was too much
      setScale(Math.max(R.floor, R.scale - 0.125)); R.slow = 0; R.ema = tgt; R.downs++;
    } else if (R.fast > R.upWait && R.scale < R.ceil) {
      setScale(Math.min(R.ceil, R.scale + 0.125)); R.fast = 0; R.lastUp = now; R.ups++;
    }
  };
  // ----------------------------------------------------------- adaptive tier step-down (auto mode only)
  // Resolution goes first (above). Only when the scale is already at its floor and frames still stay above 34 ms for
  // 4 s does the tier drop one step. It never climbs back by itself, and a fixed choice in Settings is never changed.
  function startMonitor() {
    let last = performance.now(), acc = 0, n = 0, slowFor = 0, cool = 0, fastest = [];
    (function tick(now) {
      requestAnimationFrame(tick);
      const ms = now - last; last = now;
      if (document.hidden || ms > 250) return;                         // tab switch / hitch, not real load
      if (ms > 3) { fastest.push(ms); if (fastest.length >= 120) { fastest.sort((a, b) => a - b); vsync = Math.min(17, Math.max(4, fastest[12])); fastest = []; } }
      acc += ms; n++;
      if (acc >= 500) {                                                 // evaluate every half second
        const avg = acc / n; Q.frameMs = avg; acc = 0; n = 0;
        cool = Math.max(0, cool - 0.5);
        if (now < quietUntil) { slowFor = 0; return; }
        const R = Q.res, i = ORDER.indexOf(tier);
        slowFor = avg > 34 && R.scale <= R.floor + 0.001 ? slowFor + 0.5 : 0;
        if (slowFor >= 4 && i > 0 && cool === 0 && Q.mode === 'auto') {
          slowFor = 0; cool = 10;
          apply(ORDER[i - 1], 'adaptive');
          if (!isTouch) notice('Graphics set to ' + TIERS[tier].name + ' for a smoother drive');
        }
      }
    })(performance.now());
  }
})();
