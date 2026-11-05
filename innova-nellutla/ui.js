// ui.js: icons, HUD stacks, pause menu, tier-aware glass, keyboard focus for dialogs. No per-frame work here:
// the stacks adopt late-created elements through a childList observer on <body>, which fires only when something is added.
(function () {
  'use strict';
  const P = {
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.8 2.4c-.9.5-1.3 1-1.3 2"/><path d="M12 17h0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', play: '<path d="M7 5l12 7-12 7z"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    sound: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    muted: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 10l5 5M21 10l-5 5"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    call: '<path d="M6 3l3 1 1 5-2 1.5a12 12 0 0 0 5.5 5.5L15 14l5 1 1 3-2 3C10 21 3 13 3 5z"/>',
    chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>', home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
    bank: '<path d="M3 9l9-5 9 5z"/><path d="M6 9v8M10 9v8M14 9v8M18 9v8M4 20h16"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    car: '<path d="M4 16v-3l2-5a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 5v3z"/><path d="M4 13h16"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    taxi: '<path d="M10 5h4v2h-4z"/><path d="M4 16v-3l2-5a1.5 1.5 0 0 1 1.5-1h9A1.5 1.5 0 0 1 18 8l2 5v3z"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    bus: '<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M4 11h16M12 4v7"/><circle cx="8" cy="18.5" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/>',
    camera: '<path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13" r="3.5"/>', wheat: '<path d="M12 21V8"/><path d="M12 8c-3-1-3-3-3-5 2 0 3 1 3 3 0-2 1-3 3-3 0 2 0 4-3 5zM12 13c-2 0-4-1-5-3 3 0 4 1 5 3zM12 13c2 0 4-1 5-3-3 0-4 1-5 3zM12 18c-2 0-4-1-5-3 3 0 4 1 5 3zM12 18c2 0 4-1 5-3-3 0-4 1-5 3z"/>',
    bag: '<path d="M6 9h12l1 11H5z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>', headset: '<path d="M5 14v-2a7 7 0 0 1 14 0v2"/><rect x="3.5" y="14" width="4" height="6" rx="1"/><rect x="16.5" y="14" width="4" height="6" rx="1"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/>', seat: '<path d="M7 4v9h9l1 7M7 13l-1 7"/>', wave: '<path d="M8 12V6a1.3 1.3 0 0 1 2.6 0v5M10.6 11V4.5a1.3 1.3 0 0 1 2.6 0V11M13.2 11V6a1.3 1.3 0 0 1 2.6 0v6l2-2a1.3 1.3 0 0 1 2 1.7L15 19a4 4 0 0 1-3 1.500H10a4 4 0 0 1-4-4l2-4.500"/>',
    namaste: '<path d="M12 4l-3 8-3 4 3 4 3-4zM12 4l3 8 3 4-3 4-3-4z"/>', horn: '<path d="M4 10v4h3l11 5V5L7 10z"/><path d="M8 14l1 5h3l-1-3"/>', bulb: '<path d="M9 17h6M10 20h4M8 13a6 6 0 1 1 8 0c-1 .8-1 2-1 3H9c0-1 0-2.200-1-3z"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/>', people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><path d="M16 5a3 3 0 0 1 0 6M18 14c2 1 3 3 3 6"/>', stick: '<circle cx="12" cy="6" r="3"/><path d="M12 9v7M5 20h14l-1-4H6z"/>', reset: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500V4"/>', rotate: '<rect x="6" y="3" width="12" height="18" rx="2" transform="rotate(30 12 12)"/>'
  };
  const icon = n => P[n] ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>` : String(n || '').replace(/[&<>"]/g, '');
  window.UI = { icon };

  // ---- stacks
  const left = document.getElementById('uiLeft'), right = document.getElementById('uiRight'), prompts = document.getElementById('uiPrompts'), bar = document.getElementById('hudBar');
  const HOME = { jobHud: left, farmJob: left, rideHud: left, sh2Safe: left, mpSquad: left, mpCoords: right, socDock: right, socTalk: right, phoneBtn: bar,
    propHint: prompts, actHint: prompts, enterHint: prompts, sh2Hint: prompts, socHint: prompts, srHint: prompts, mpSeatHint: prompts, farmPill: prompts, jobPill: prompts, talkChoices: prompts, talkBtn: prompts };
  const adopt = n => { const p = n.id && HOME[n.id]; if (p && n.parentNode !== p) p.appendChild(n); };
  // an icon swap on elements the modules build; touch-controls keeps its labels and data attributes
  const dress = () => {
    const set = (sel, name) => document.querySelectorAll(sel).forEach(b => { if (b.dataset.ic) return; b.dataset.ic = 1; const s = b.querySelector('small'); b.innerHTML = icon(name); if (s) b.appendChild(s); });
    [['#socBtnV', 'headset'], ['#socBtnP', 'mic'], ['#socBtnS', 'seat'], ['#socBtnW', 'wave'], ['#socBtnN', 'namaste'], ['#tcMoreBtn', 'more'], ['#tcHorn', 'horn'], ['#tcQuick [data-tap="KeyV"]', 'camera'],
      ['[data-tap="KeyL"]', 'bulb'], ['[data-tap="Enter"]', 'chat'], ['[data-down="KeyQ"]', 'chat'], ['[data-tap="KeyZ"]', 'pin'], ['[data-hold-key="Tab"]', 'people'], ['[data-tap="KeyP"]', 'home'], ['[data-tap="KeyR"]', 'reset'], ['#tcSteerMode', 'stick']].forEach(a => set(...a));
    const ph = document.getElementById('phoneBtn'); if (ph && !ph.dataset.ic) { ph.dataset.ic = 1; ph.innerHTML = icon('phone'); }
  };
  const scan = () => { for (const id in HOME) { const n = document.getElementById(id); if (n) adopt(n); } dress(); };
  new MutationObserver(l => { for (const m of l) if (m.addedNodes.length) { scan(); return; } }).observe(document.body, { childList: true });

  // ---- mission card folds to its title 9 s after it changes; click to reopen
  const card = document.getElementById('mission'); let foldT = 0;
  const unfold = () => { card.classList.remove('mini'); clearTimeout(foldT); foldT = setTimeout(() => card.classList.add('mini'), 9000); };
  new MutationObserver(unfold).observe(document.getElementById('mTask'), { childList: true, characterData: true, subtree: true });
  document.getElementById('go').addEventListener('click', unfold);
  card.addEventListener('click', e => { e.stopPropagation(); if (card.classList.contains('mini')) unfold(); else card.classList.add('mini'); });

  // ---- pause: stops the loop (window.GamePaused), so no CPU or GPU is spent behind the menu
  const pause = document.getElementById('pause'), scrim = document.getElementById('scrim'), resumeBtn = document.getElementById('pResume');
  const isOn = () => pause.classList.contains('on');
  function setPause(on) {
    pause.classList.toggle('on', on); scrim.classList.toggle('on', on); window.GamePaused = on;
    try { releaseAllInput(); } catch (e) {}
    try { if (audioCtx && !(window.GameMute && GameMute.muted)) on ? audioCtx.suspend() : audioCtx.resume(); } catch (e) {}
    if (on) resumeBtn.focus(); else if (document.activeElement) document.activeElement.blur();
  }
  const dialogs = () => [document.getElementById('info'), document.getElementById('settings')].filter(d => d.classList.contains('open'));
  const blocking = () => { // something else already owns Escape
    if (dialogs().length) return true;
    try { if (showMap) return true; } catch (e) {}
    if (window.Phone && Phone.isOpen) return true;
    return ['propPanel', 'farmPanel', 'jobPanel', 'srPanel', 'actShop', 'ridePicker', 'ccRoot', 'mpBoard'].some(id => { const n = document.getElementById(id); return n && getComputedStyle(n).display !== 'none'; });
  };
  pause.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    if (b.id === 'pResume') setPause(false);
    if (b.id === 'pControls') { toggleHelp(true); focusDialog(); }
    if (b.id === 'pSettings') { toggleSettings(true); focusDialog(); }
    if (b.id === 'pMute' && window.GameMute) { GameMute.toggle(); syncMute(); }
    if (b.id === 'pReset') { Player.resetToCrysta(); respawnCar(); setPause(false); }
  });
  const syncMute = () => { const b = document.getElementById('pMute'); if (b && window.GameMute) b.querySelector('span').textContent = GameMute.muted ? 'Turn sound on' : 'Turn sound off'; };
  const focusables = r => [...r.querySelectorAll('button,input,select,a[href]')].filter(n => n.offsetParent !== null && !n.disabled);
  const focusDialog = () => { const d = dialogs()[0]; if (d) { const f = focusables(d); if (f[0]) f[0].focus(); } };
  // runs first (capture, registered before the game's listeners): a paused game hears nothing, and Tab stays inside open dialogs
  addEventListener('keydown', e => {
    const d = dialogs()[0], scope = d || (isOn() ? pause : null);
    if (e.code === 'Tab' && scope) {
      e.stopImmediatePropagation(); e.preventDefault();
      const f = focusables(scope); if (!f.length) return; let i = f.indexOf(document.activeElement);
      i = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length; f[i].focus(); return;
    }
    if (!isOn()) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape' && !e.repeat) { if (d) { toggleHelp(false); toggleSettings(false); resumeBtn.focus(); } else setPause(false); return; }
    if (!d && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) { e.preventDefault(); const f = focusables(pause), i = f.indexOf(document.activeElement); f[(i + (e.code === 'ArrowDown' ? 1 : f.length - 1)) % f.length].focus(); }
  }, true);
  GameHooks.key.push(e => {
    if (e.code !== 'Escape' || e.repeat || !isPlaying) return false;
    if (blocking()) return false;
    setPause(true); return true;
  });
  document.getElementById('btnPause').addEventListener('click', e => { e.stopPropagation(); setPause(true); });

  // ---- glass only on the high tier; the rest get flat panels and no backdrop cost
  GameHooks.init.push(() => {
    const tier = () => { try { document.documentElement.dataset.tier = Quality.tier; } catch (e) {} };
    tier(); try { Quality.onChange.push(tier); } catch (e) {}
    scan(); syncMute();
  });
  scan();
})();
