// On-screen touch controls for phones and tablets. Only built when the device has a coarse pointer or
// touch support. Analog input is merged into padIn by TouchControls.apply(padIn), which index.html calls
// inside pollGamepad() right before syncInput(), so the car and the on-foot player read it exactly like a
// gamepad. One-shot actions (horn, lights, F, M, chat...) are synthetic KeyboardEvents on window, so every
// module that listens for keys (mp.js, player.js, properties.js) reacts as if a key was pressed.
(function () {
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const isTouch = window.Device ? Device.touchUI : (coarse || 'ontouchstart' in window || navigator.maxTouchPoints > 0);   // phones/tablets only; laptops with touchscreens keep keyboard UI
  const TC = window.TouchControls = { enabled: isTouch, state: { steer: 0, gas: false, brake: false, drift: false, nos: false, left: false, right: false, moveY: 0 }, apply() {}, setSteerMode() {}, steerMode: 'stick' };
  if (!isTouch) return;
  document.documentElement.classList.add('touch');

  const S = TC.state;
  let steerMode = 'stick'; try { steerMode = localStorage.getItem('nellutla.steer') || 'stick'; } catch (e) {}

  // ------------------------------------------------------------- key helpers
  const KEYS = { KeyG: 'g', KeyH: 'h', KeyL: 'l', KeyV: 'v', KeyF: 'f', KeyM: 'm', KeyE: 'e', KeyQ: 'q', KeyZ: 'z', KeyR: 'r', KeyP: 'p', KeyI: 'i', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape' };
  function key(type, code) { window.dispatchEvent(new KeyboardEvent(type, { code, key: KEYS[code] || code, bubbles: true, cancelable: true })); }
  function tap(code) { key('keydown', code); setTimeout(() => key('keyup', code), 60); }
  TC.tap = tap;

  // ------------------------------------------------------------- DOM
  const root = document.createElement('div'); root.id = 'tc';
  root.innerHTML = `
    <div id="tcStick" class="tc-stick"><div class="tc-knob"></div></div>
    <div id="tcArrows"><button class="tc-btn tc-arrow" data-hold="left" aria-label="Steer left">◀</button><button class="tc-btn tc-arrow" data-hold="right" aria-label="Steer right">▶</button></div>
    <div id="tcQuick"><button class="tc-btn" data-tap="KeyF" aria-label="Get in or out">F</button><button class="tc-btn" data-tap="KeyV" aria-label="Camera">🎥</button><button class="tc-btn tc-footonly" data-tap="KeyG" aria-label="Ride an auto">🛺</button></div>
    <div id="tcDrive">
      <button class="tc-btn tc-pedal" id="tcGas" data-hold="gas" aria-label="Accelerate">GAS</button>
      <button class="tc-btn tc-pedal" id="tcBrake" data-hold="brake" aria-label="Brake or reverse">BRAKE<small>REV</small></button>
      <button class="tc-btn" id="tcHand" data-hold="drift" aria-label="Handbrake">HAND</button>
      <button class="tc-btn" id="tcNos" data-hold="nos" aria-label="NOS">NOS</button>
      <button class="tc-btn" id="tcHorn" data-tap="KeyH" aria-label="Horn">📯</button>
    </div>
    <div id="tcFoot">
      <button class="tc-btn" id="tcJump" data-hold="drift" aria-label="Jump">JUMP</button>
      <button class="tc-btn" id="tcRun" data-hold="nos" aria-label="Run">RUN</button>
      <button class="tc-btn" id="tcUse" data-tap="KeyE" aria-label="Interact">E</button>
    </div>
    <div id="tcMore" class="panel">
      <button class="tc-btn" data-tap="KeyL">💡<small>Lights</small></button>
      <button class="tc-btn" data-tap="Enter">💬<small>Chat</small></button>
      <button class="tc-btn" data-down="KeyQ">🗨<small>Quick</small></button>
      <button class="tc-btn" data-tap="KeyZ">📍<small>Ping</small></button>
      <button class="tc-btn" data-hold-key="Tab">👥<small>Players</small></button>
      <button class="tc-btn" data-tap="KeyP">🏠<small>Property</small></button>
      <button class="tc-btn" data-tap="KeyR">↺<small>Reset</small></button>
      <button class="tc-btn" id="tcSteerMode">🕹<small>Steer</small></button>
    </div>`;
  document.body.appendChild(root);
  // map and "more" live in the shared HUD bar built by index.html
  function addBarButtons() {
    const bar = document.getElementById('hudBar'); if (!bar) return setTimeout(addBarButtons, 50);
    // the map button lives in the HUD bar for every device now (index.html #btnMap)
    const more = document.createElement('button'); more.className = 'hud-btn touch-only'; more.id = 'tcMoreBtn'; more.textContent = '⋯'; more.title = 'More'; more.setAttribute('aria-label', 'More actions');
    bar.appendChild(more);
    more.addEventListener('click', e => { e.stopPropagation(); root.classList.toggle('more-open'); });
  }
  addBarButtons();

  // ------------------------------------------------------------- buttons
  function bind(el) {
    if (el._tcBound) return; el._tcBound = true;
    el.addEventListener('contextmenu', e => e.preventDefault());
    const hold = el.dataset.hold, tapK = el.dataset.tap, down = el.dataset.down, holdKey = el.dataset.holdKey;
    let pid = null;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (pid !== null) return; pid = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('on');
      if (hold) S[hold] = true;
      if (holdKey) key('keydown', holdKey);
      if (down) key('keydown', down);                // quick-chat wheel: opens, the next tap on the wheel picks
      if (tapK && tapK !== 'Enter') tap(tapK);
      if (tapK || down) root.classList.remove('more-open');
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (err) {}
    });
    const up = e => {
      if (e.pointerId !== pid) return; pid = null; el.classList.remove('on');
      if (hold) S[hold] = false;
      if (holdKey) key('keyup', holdKey);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    // chat needs a real user-activation click so the on-screen keyboard can open on the focused input
    if (tapK === 'Enter') el.addEventListener('click', () => { tap('Enter'); });
  }
  root.querySelectorAll('.tc-btn').forEach(bind);

  // ------------------------------------------------------------- virtual stick (steer while driving, move on foot)
  const stick = document.getElementById('tcStick'), knob = stick.querySelector('.tc-knob');
  let sid = null, cx = 0, cy = 0;
  function moveStick(e) {
    const r = stick.offsetWidth / 2, dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, r / d);
    const x = dx * k / r, y = dy * k / r;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const dz = v => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
    S.steer = -dz(x); S.moveY = -dz(y);
  }
  stick.addEventListener('pointerdown', e => {
    e.preventDefault(); if (sid !== null) return; sid = e.pointerId;
    try { stick.setPointerCapture(sid); } catch (err) {}
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.classList.add('on'); moveStick(e);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) moveStick(e); });
  const endStick = e => { if (e.pointerId !== sid) return; sid = null; S.steer = 0; S.moveY = 0; knob.style.transform = ''; stick.classList.remove('on'); };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick); stick.addEventListener('lostpointercapture', endStick);

  function setSteerMode(m) {
    steerMode = TC.steerMode = m === 'arrows' ? 'arrows' : 'stick';
    root.dataset.steer = steerMode;
    try { localStorage.setItem('nellutla.steer', steerMode); } catch (e) {}
    const b = document.getElementById('tcSteerMode'); if (b) b.querySelector('small').textContent = steerMode === 'stick' ? 'Stick' : 'Arrows';
    const sel = document.getElementById('setSteer'); if (sel) sel.value = steerMode;
  }
  TC.setSteerMode = setSteerMode; setSteerMode(steerMode);
  document.getElementById('tcSteerMode').addEventListener('click', () => setSteerMode(steerMode === 'stick' ? 'arrows' : 'stick'));
  // tapping anywhere else closes the "more" drawer
  window.addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('#tcMore, #tcMoreBtn')) root.classList.remove('more-open'); });

  // ------------------------------------------------------------- merge into padIn (called from pollGamepad)
  TC.apply = function (padIn) {
    const foot = typeof Player !== 'undefined' && Player.mode === 'foot';
    // foot: the stick is a move stick, push up = walk forward (gas), down = back (brake); in arrows mode
    // on foot the stick is still shown, the arrows only steer the car
    const stickActive = sid !== null && (foot || steerMode === 'stick');
    const steer = stickActive ? S.steer : 0;
    if (Math.abs(steer) > Math.abs(padIn.steer || 0)) padIn.steer = steer;
    const fwd = foot && stickActive && S.moveY > 0.3, back = foot && stickActive && S.moveY < -0.3;
    padIn.gasB = !!padIn.gasB || S.gas || fwd;
    padIn.brakeB = !!padIn.brakeB || S.brake || back;
    padIn.leftB = !!padIn.leftB || S.left || steer > 0.3;
    padIn.rightB = !!padIn.rightB || S.right || steer < -0.3;
    padIn.driftB = !!padIn.driftB || S.drift;
    padIn.nosB = !!padIn.nosB || S.nos;
  };

  // ------------------------------------------------------------- which cluster is visible
  let last = '';
  setInterval(() => {
    const playing = typeof isPlaying !== 'undefined' && isPlaying;
    const mode = !playing ? 'off' : (typeof Player !== 'undefined' && Player.mode === 'foot') ? 'foot' : 'drive';
    if (mode !== last) { last = mode; root.dataset.mode = mode; if (mode !== 'drive') { S.gas = S.brake = S.left = S.right = false; } }
  }, 100);
  // no pinch-zoom / double-tap zoom / page bounce on iOS
  ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (!e.target.closest || !e.target.closest('#start, #info, #settings, #mpLog, #ccRoot, #propPanel')) e.preventDefault(); }, { passive: false });
})();
