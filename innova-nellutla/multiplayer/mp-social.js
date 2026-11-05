// mp-social.js: the social layer on top of MP (multiplayer/mp.js). Uses only MP.send / MP.on / MP.remotes / MP.ride / MP.squad.
//   Chat    ALL / NEARBY (60 m) / SQUAD, colours, times, history, quick chat, bubbles over heads, mask + flood limits.
//           Reuses mp.js's own input element (moved into this panel), so Enter opens it and every game key stays off while typing.
//   Voice   WebRTC mesh, signalled through the relay. Nearest 6 peers only; car mates first, then squad, then distance.
//           Spatial like PUBG / GTA Online: full inside 3 m, inverse falloff, silent by 45 m; squad stays audible at any range
//           on a band-limited "radio"; people in the same vehicle are flat and clear; a closed vehicle muffles outsiders.
//           Opus with DTX and FEC, audio track toggled for PTT / gate (no renegotiation). Opt in only: joining shares your IP
//           with peers, so nothing connects until the player presses Join voice. window.SPARK_ICE overrides the ICE servers.
//   Sit     X sits on the nearest chair, bench, sofa, porch edge or compound wall; moving stands up. 8 wave, 9 namaste.
//           Pose goes to nearby players; jaw follows the voice level; idle players turn to whoever they are talking with.
// Keys: Enter chat, ` or . push-to-talk, / voice panel, ; mute mic, X sit, 8 wave, 9 namaste.
(function () {
  if (typeof MP === 'undefined' || !MP.on || typeof GameHooks === 'undefined') { console.warn('mp-social: needs MP.on and GameHooks'); return; }
  const NEAR_CHAT = 60, VOICE_R = 45, VOICE_DROP = 55, MAX_PEERS = 6, TALK_R = 3.5;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nellutla.social.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('nellutla.social.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const FONT = '-apple-system,system-ui,"Noto Sans Telugu","Telugu Sangam MN","Kohinoor Telugu",Gautami,"Nirmala UI",sans-serif';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const time = ms => { const d = new Date(ms || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const playing = () => typeof isPlaying !== 'undefined' && isPlaying;
  const onFoot = () => typeof Player !== 'undefined' && Player.mode === 'foot';
  const myPos = () => carPos;
  function toast(t) { if (typeof showComboPopup === 'function') showComboPopup(t); }

  // ================================================================ styles + DOM
  const st = document.createElement('style');
  st.textContent = `
  #mpLog,#mpInRow,#mpPanel.typing #mpLog,#mpPanel.typing #mpInRow{display:none!important}
  #socChat{position:fixed;left:12px;bottom:72px;width:min(360px,calc(100vw - 24px));z-index:7;font:13px/1.4 ${FONT};color:#f1f5f9;pointer-events:none}
  #socChat .log{max-height:190px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;transition:opacity .6s;padding-right:2px}
  #socChat .ln{background:rgba(9,13,22,.62);border-radius:6px;padding:3px 8px;overflow-wrap:anywhere}
  #socChat .ln.old{opacity:.55} #socChat .t{color:#7c8aa0;font-size:10px;margin-right:5px}
  #socChat .c{font-size:10px;font-weight:700;margin-right:5px;letter-spacing:.02em} #socChat .n{font-weight:700}
  #socChat .chrome{position:absolute;left:-200vw;width:100%;box-sizing:border-box;pointer-events:auto;margin-top:6px;background:rgba(9,13,22,.86);border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:7px}
  #socChat.open .log{pointer-events:auto;opacity:1!important;max-height:min(260px,38vh)} #socChat.open .chrome{position:static}
  #socTabs{display:flex;gap:4px;margin-bottom:6px}
  #socTabs button{flex:1;border:0;border-radius:7px;padding:6px 0;min-height:30px;background:#1e293b;color:#94a3b8;font:700 11px ${FONT};cursor:pointer}
  #socTabs button.on{background:var(--c);color:#fff}
  #socRow #mpInput{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid #475569;background:#0b1220;color:#fff;font:16px ${FONT};outline:none}
  #socRow #mpInput:focus{border-color:#60a5fa}
  #socQuick{display:flex;gap:4px;overflow-x:auto;margin-top:6px;scrollbar-width:none}
  #socQuick button{flex:none;border:1px solid #334155;border-radius:14px;background:transparent;color:#cbd5e1;padding:4px 10px;min-height:28px;font:12px ${FONT};cursor:pointer}
  #socDock{position:fixed;right:12px;top:300px;z-index:7;display:flex;flex-direction:column;gap:6px;font:12px ${FONT}}
  #socDock button{width:44px;height:44px;border-radius:12px;border:1px solid rgba(148,163,184,.3);background:rgba(9,13,22,.72);color:#fff;font-size:18px;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}
  #socDock button.on{background:#b91c1c} #socDock button.live{background:#15803d} #socDock button[hidden]{display:none}
  #socVoice{position:fixed;right:64px;top:300px;width:min(290px,calc(100vw - 80px));max-height:calc(100vh - 320px);overflow:auto;z-index:8;display:none;background:rgba(9,13,22,.93);border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:10px 12px;color:#e2e8f0;font:12px/1.4 ${FONT}}
  #socVoice.open{display:block} #socVoice h4{margin:0 0 6px;font-size:13px} #socVoice .msg{color:#fbbf24;margin:6px 0}
  #socVoice button{border:0;border-radius:7px;padding:7px 9px;background:#1e293b;color:#e2e8f0;font:12px ${FONT};cursor:pointer}
  #socVoice button.pri{background:#2563eb;color:#fff;font-weight:700;width:100%} #socVoice .row{display:flex;gap:6px;align-items:center;margin-top:6px}
  #socVoice .row>.g{flex:1} #socVoice button.on{background:#2563eb;color:#fff}
  #socMeter{height:6px;background:#1e293b;border-radius:3px;overflow:hidden;margin-top:6px} #socMeter i{display:block;height:100%;width:0;background:#4ade80}
  #socVoice .pr{display:flex;align-items:center;gap:6px;margin-top:5px} #socVoice .pr b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #socVoice .dot{width:9px;height:9px;border-radius:50%;background:#475569;flex:none} #socVoice .dot.on{background:#4ade80;box-shadow:0 0 6px #4ade80}
  #socVoice input[type=range]{width:64px}
  #socTalk{position:fixed;right:64px;top:256px;z-index:7;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font:12px ${FONT};color:#fff}
  #socTalk span{background:rgba(9,13,22,.72);border-radius:6px;padding:2px 8px}
  #socHint{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:6;pointer-events:none;background:rgba(9,13,22,.74);color:#fff;border-radius:8px;padding:5px 12px;font:13px ${FONT};display:none}
  #socHint b{color:#fbbf24}
  html.touch #socChat{bottom:auto;top:48px;width:min(300px,62vw)} html.touch #socChat.open{top:auto}
  @media (prefers-reduced-motion:reduce){#socChat .log{transition:none}}`;
  document.head.appendChild(st);

  const box = el('div'); box.id = 'socChat';
  box.innerHTML = '<div class="log" aria-live="polite"></div><div class="chrome"><div id="socTabs"></div><div id="socRow"></div><div id="socQuick"></div></div>';
  document.body.appendChild(box);
  const $log = box.querySelector('.log'), $tabs = box.querySelector('#socTabs'), $row = box.querySelector('#socRow'), $quick = box.querySelector('#socQuick');
  const dock = el('div'); dock.id = 'socDock';
  dock.innerHTML = '<button id="socBtnV" title="Voice chat (/)" aria-label="Voice chat">🎧</button><button id="socBtnP" title="Hold to talk (`)" aria-label="Hold to talk" hidden>🎤</button><button id="socBtnS" title="Sit or stand (X)" aria-label="Sit or stand">🪑</button><button id="socBtnW" title="Wave (8)" aria-label="Wave">👋</button><button id="socBtnN" title="Namaste (9)" aria-label="Namaste">🙏</button>';
  document.body.appendChild(dock);
  const vp = el('div'); vp.id = 'socVoice'; document.body.appendChild(vp);
  const talkers = el('div'); talkers.id = 'socTalk'; document.body.appendChild(talkers);
  const hint = el('div'); hint.id = 'socHint'; document.body.appendChild(hint);
  { const st = document.createElement('style'); st.textContent = 'body.soc-sit #enterHint, body.soc-sit #actHint, body.soc-sit #uiPrompts, body.soc-sit #propHint { display: none !important; }'; document.head.appendChild(st); }
  const showHud = v => { [box, dock, talkers].forEach(e => e.style.display = v ? '' : 'none'); };

  // ================================================================ chat
  const CH = { all: { label: 'ALL', color: '#1d4ed8', txt: '#60a5fa' }, near: { label: 'NEARBY', color: '#b45309', txt: '#fbbf24' }, squad: { label: 'SQUAD', color: '#166534', txt: '#4ade80' } };
  const QUICK = ['నమస్తే', 'బాగున్నావా?', 'Follow me', 'Wait here', 'Come here', 'Thanks!', 'Get in', 'Sorry!'];
  // masked for everyone who has the filter on; Latin words match whole, Telugu script as a substring
  const BAD_L = /\b(f+u+c+k+\w*|sh[i1]+t+\w*|b[i1]tch\w*|bastard\w*|asshole\w*|c+u+n+t+\w*|n[i1]gg\w*|madarchod\w*|bh?enchod\w*|chutiya\w*|bosdi\w*|lanja\w*|dengu\w*|puku|modda\w*)\b/gi;
  const BAD_T = /లంజ|దెంగ|పూకు|మొడ్డ/g;
  const mask = s => s.replace(BAD_L, w => w[0] + '*'.repeat(Math.max(2, w.length - 1))).replace(BAD_T, '***');
  let filterOn = store.get('filter', true), mutedNames = store.get('muted', []), channel = 'all';
  const isMuted = n => mutedNames.includes(n);
  const sent = [], flood = {}, recall = store.get('recall', []);
  let recallI = -1, lastText = '', lastActive = 0;
  const input = () => document.getElementById('mpInput');

  function line(o, restore) {
    const d = el('div', 'ln' + (restore ? ' old' : ''));
    d.appendChild(el('span', 't', time(o.at)));
    if (o.ch) { const c = el('span', 'c', CH[o.ch].label); c.style.color = CH[o.ch].txt; d.appendChild(c); }
    if (o.name) { const n = el('span', 'n', o.name); n.style.color = /^#[0-9a-f]{3,8}$/i.test(o.color || '') ? o.color : '#fff'; d.appendChild(n); d.appendChild(document.createTextNode(': ')); }
    d.appendChild(document.createTextNode(filterOn ? mask(o.text) : o.text));
    $log.appendChild(d); while ($log.children.length > 200) $log.removeChild($log.firstChild);
    $log.scrollTop = $log.scrollHeight; if (!restore) lastActive = performance.now();
  }
  const hist = store.get('history', []).slice(-40); hist.forEach(o => { try { line(o, true); } catch (e) {} });
  function record(o) { line(o); hist.push(o); if (hist.length > 80) hist.shift(); store.set('history', hist); }
  const note = t => record({ text: t });

  // mp.js's system lines and quick-chat wheel keep going into its hidden log: show them here
  const srcLog = document.getElementById('mpLog');
  if (srcLog) new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    const t = n.textContent || ''; if (t) { const d = el('div', 'ln'); d.innerHTML = n.innerHTML; $log.appendChild(d); $log.scrollTop = $log.scrollHeight; lastActive = performance.now(); }
  }))).observe(srcLog, { childList: true });

  function setChannel(c) {
    if (c === 'squad' && !(MP.squad && MP.squad.code)) { note('Join a squad to use SQUAD chat and voice: /squad create'); c = 'all'; }
    channel = c;
    [...$tabs.children].forEach(b => b.classList.toggle('on', b.dataset.c === c));
    const i = input(); if (i) i.placeholder = 'Message ' + CH[c].label + ' · Enter send · Tab channel · Esc close';
  }
  Object.keys(CH).forEach(c => {
    const b = el('button', '', CH[c].label); b.dataset.c = c; b.style.setProperty('--c', CH[c].color); b.type = 'button';
    b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => { setChannel(c); input().focus(); }); $tabs.appendChild(b);
  });
  QUICK.forEach(q => {
    const b = el('button', '', q); b.type = 'button'; b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', () => { say(q); input().focus(); }); $quick.appendChild(b);
  });
  function say(raw) {
    const text = raw.trim().slice(0, 160); if (!text) return;
    if (!MP.online) return note('Not connected');
    const now = performance.now();
    while (sent.length && now - sent[0] > 5000) sent.shift();
    if (sent.length >= 5) return note('Slow down: 5 messages per 5 seconds.');
    if (text === lastText && sent.length && now - sent[sent.length - 1] < 2500) return note('You just said that.');
    const ch = channel, to = ch === 'near' ? 'near' : ch === 'squad' ? 'squad' : 'all';
    if (!MP.send('soc:chat', { text, ch }, to === 'near' ? { to, range: NEAR_CHAT } : { to })) return note('Not connected');
    sent.push(now); lastText = text; recall.unshift(text); recall.length = Math.min(recall.length, 20); store.set('recall', recall); recallI = -1;
    record({ text, ch, name: MP.myName(), color: myColor(), at: Date.now() });
    bubble('me', filterOn ? mask(text) : text);
    chatAt.me = now;
  }
  const myColor = () => '#fbbf24';
  const chatAt = {};
  MP.on('soc:chat', (d, m) => {
    if (!d || typeof d.text !== 'string' || !m || !m.from || isMuted(m.name)) return;
    const now = performance.now(), f = flood[m.from] = (flood[m.from] || []).filter(t => now - t < 5000);
    if (f.length >= 7) return;                         // a modified client cannot spam past the limit on other screens
    f.push(now);
    const ch = CH[d.ch] ? d.ch : 'all', text = d.text.slice(0, 160);
    record({ text, ch, name: String(m.name || 'Player').slice(0, 24), color: m.color, at: Date.now() });
    bubble(m.from, filterOn ? mask(text) : text); chatAt[m.from] = now;
    Pose.seen(m.from);
  });
  function adopt() {
    const i = input(); if (!i || i.parentNode === $row) return !!i;
    $row.appendChild(i); i.maxLength = 160; i.setAttribute('enterkeyhint', 'send'); i.setAttribute('autocomplete', 'off'); i.setAttribute('aria-label', 'Chat message');
    i.addEventListener('focus', () => { box.classList.add('open'); if (channel === 'squad' && !(MP.squad && MP.squad.code)) channel = 'all'; setChannel(channel); fitKeyboard(); $log.scrollTop = $log.scrollHeight; });
    i.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== i) { box.classList.remove('open'); box.style.bottom = ''; lastActive = performance.now(); } }, 120));
    return true;
  }
  // capture on the wrapper: mp.js's own handler on the input never sees the keys we take
  $row.addEventListener('keydown', e => {
    e.stopPropagation();
    const i = input();
    if (e.key === 'Tab') { e.preventDefault(); const o = ['all', 'near'].concat(MP.squad && MP.squad.code ? ['squad'] : []); setChannel(o[(o.indexOf(channel) + 1) % o.length]); }
    else if (e.key === 'Escape') { e.preventDefault(); i.blur(); }
    else if (e.key === 'ArrowUp' && recall.length) { e.preventDefault(); recallI = Math.min(recall.length - 1, recallI + 1); i.value = recall[recallI]; }
    else if (e.key === 'ArrowDown' && recallI >= 0) { e.preventDefault(); recallI--; i.value = recallI >= 0 ? recall[recallI] : ''; }
    else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault(); const t = i.value.trim(); i.value = '';
      if (t === '/filter') { filterOn = !filterOn; store.set('filter', filterOn); note('Language filter ' + (filterOn ? 'on' : 'off')); }
      else if (t.startsWith('/')) MP.command(t); else if (t) say(t);
      i.blur();
    }
  }, true);
  // touch keyboards: keep the box above them
  function fitKeyboard() {
    const v = window.visualViewport; if (!v || !box.classList.contains('open')) return;
    const kb = Math.max(0, innerHeight - v.height - v.offsetTop);
    box.style.bottom = (kb > 60 ? kb + 8 : 72) + 'px';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', fitKeyboard); visualViewport.addEventListener('scroll', fitKeyboard); }

  // ---------------- bubbles
  const bubbles = {};
  function segs(t) { return window.Intl && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map(s => s.segment) : [...t]; }
  function bubble(id, text) {
    if (typeof THREE === 'undefined' || typeof scene === 'undefined') return;
    let b = bubbles[id];
    if (!b) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 180;
      const tex = new THREE.CanvasTexture(c), mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const s = new THREE.Sprite(mat); s.renderOrder = 20; s.scale.set(3.4, 1.2, 1); s.center.set(0.5, 0); scene.add(s);
      b = bubbles[id] = { c, tex, mat, s };
    }
    const g = b.c.getContext('2d'); g.clearRect(0, 0, 512, 180); g.font = '500 30px ' + FONT;
    const lines = []; let cur = '';              // wrap on grapheme clusters so Telugu conjuncts never split
    for (const ch of segs(text)) { if (g.measureText(cur + ch).width > 450) { lines.push(cur); cur = ''; if (lines.length === 3) break; } cur += ch; }
    if (lines.length < 3 && cur) lines.push(cur);
    const w = Math.max(...lines.map(l => g.measureText(l).width)) + 44, h = lines.length * 38 + 26, x = (512 - w) / 2, y = 164 - h;
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, 18); else g.rect(x, y, w, h);
    g.fill(); g.beginPath(); g.moveTo(240, y + h); g.lineTo(272, y + h); g.lineTo(256, 180); g.fill();
    g.fillStyle = '#0f172a'; g.textBaseline = 'middle'; g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, 256, y + 32 + i * 38));
    b.tex.needsUpdate = true; b.until = performance.now() + clamp(3000 + text.length * 80, 4000, 9000); b.s.visible = true;
  }
  function tickBubbles() {
    const now = performance.now();
    for (const id of Object.keys(bubbles)) {
      const b = bubbles[id], r = id === 'me' ? null : MP.remotes[id];
      if (id !== 'me' && !r) { scene.remove(b.s); b.mat.map.dispose(); b.mat.dispose(); delete bubbles[id]; continue; }
      const p = r ? (r.ride && MP.remotes[r.ride[0]] ? MP.remotes[r.ride[0]].g.position : r.g.position) : carPos;
      const kind = r ? r.kind : (onFoot() ? 'foot' : 'car'), dc = camera.position.distanceTo(p);
      b.s.visible = now < b.until && dc < 70;
      if (b.s.visible) {
        const seat = id === 'me' ? Pose.mine : Pose.of(id);
        b.s.position.set(p.x, seat && seat.sit ? seat.sit.y + 0.95 : kind === 'foot' ? 2.0 : 2.7, p.z);
        const k = clamp(dc / 14, 0.42, 2.4); b.s.scale.set(3.4 * k, 1.2 * k, 1);
        b.mat.opacity = clamp((b.until - now) / 500, 0, 1);
      }
    }
  }

  // ================================================================ voice
  const V = {
    on: false, ctx: null, master: null, mic: null, micTrack: null, meterTrack: null, micAn: null, micBuf: null, micLevel: 0, listenOnly: false,
    mode: store.get('mode', 'ptt'), selfMute: false, ptt: false, gateT: 0, sending: false, thresh: store.get('gate', 0.02),
    volume: store.get('vol', 1), peerVol: store.get('peerVol', {}), peers: {}, roster: {}, msg: '', dial: 0, lastId: null, speaking: false
  };
  const ICE = () => window.SPARK_ICE || [{ urls: 'stun:stun.l.google.com:19302' }];
  const rtcOK = () => typeof RTCPeerConnection !== 'undefined';
  function setMsg(m) { V.msg = m || ''; panel(); }
  function ensureCtx() {
    if (V.ctx) { if (V.ctx.state === 'suspended') V.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    V.ctx = new AC({ latencyHint: 'interactive' });        // own context: the game's is suspended by mute and by menus
    V.master = V.ctx.createGain(); V.master.connect(V.ctx.destination); applyMaster();
    V.ctx.resume();
  }
  const applyMaster = () => { if (V.master) V.master.gain.setTargetAtTime(window.GameMute && GameMute.muted ? 0 : V.volume, V.ctx.currentTime, 0.02); };

  async function openMic() {
    V.listenOnly = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      V.listenOnly = true;
      return setMsg('Microphone needs HTTPS or localhost. On this address you can listen but not speak.');
    }
    setMsg('Allow the microphone in your browser prompt. It is only used for voice chat, and only sent while you talk.');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      V.mic = s; V.micTrack = s.getAudioTracks()[0]; V.micTrack.enabled = false;
      V.meterTrack = V.micTrack.clone(); V.meterTrack.enabled = true;   // meter and gate see the mic even while the sent track is off
      V.micAn = V.ctx.createAnalyser(); V.micAn.fftSize = 512; V.micBuf = new Float32Array(512);
      V.ctx.createMediaStreamSource(new MediaStream([V.meterTrack])).connect(V.micAn);
      V.micTrack.addEventListener('ended', () => { closeMic(); V.listenOnly = true; setMsg('Microphone was disconnected. You can still listen.'); pushMic(); });
      setMsg('');
    } catch (e) {
      V.listenOnly = true;
      const n = e && e.name;
      setMsg(n === 'NotAllowedError' || n === 'SecurityError' ? 'Microphone blocked, so you are listen-only. Allow it from the icon in the address bar, then press Retry mic.'
        : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No microphone found, so you are listen-only.'
        : n === 'NotReadableError' ? 'Another app is holding the microphone, so you are listen-only.' : 'Could not open the microphone, so you are listen-only.');
    }
  }
  function closeMic() {
    if (V.mic) V.mic.getTracks().forEach(t => t.stop()); if (V.meterTrack) V.meterTrack.stop();
    V.mic = V.micTrack = V.meterTrack = V.micAn = null; V.micLevel = 0; V.sending = false;
  }
  const pushMic = () => { for (const p of Object.values(V.peers)) if (p.sender) p.sender.replaceTrack(V.micTrack || null).catch(() => {}); };
  async function join() {
    if (V.on) return;
    if (!rtcOK()) return setMsg('This browser has no WebRTC, so voice chat is not available.');
    if (!MP.online) return setMsg('Connect to multiplayer first.');
    ensureCtx(); V.on = true; V.lastId = MP.myId; dockState(); panel();
    await openMic();
    if (!V.on) { closeMic(); return; }
    pushMic(); announce(); panel();
  }
  function leave() {
    if (!V.on) return; V.on = false;
    Object.keys(V.peers).forEach(id => { sig(id, { k: 'bye' }); closePeer(id); });
    closeMic(); MP.send('soc:v', { on: false }, { to: 'all' }); V.roster = {}; setMsg(''); dockState();
  }
  const announce = () => MP.send('soc:v', { on: true, mic: !!V.micTrack }, { to: 'all' });
  MP.on('soc:v', (d, m) => {
    if (!d || !m.from) return;
    if (d.on) { const fresh = !V.roster[m.from]; V.roster[m.from] = { at: performance.now(), mic: !!d.mic }; if (fresh && V.on) announce(); }
    else { delete V.roster[m.from]; if (V.peers[m.from]) closePeer(m.from); }
  });

  function wanted() {      // who we should be connected to, best first
    const me = myPos(), list = [];
    for (const id of Object.keys(V.roster)) {
      const r = MP.remotes[id]; if (!r || isMuted(r.name)) continue;
      const d = Math.hypot(r.g.position.x - me.x, r.g.position.z - me.z), mate = carMate(id), sq = isSquad(id), had = !!V.peers[id];
      if (mate || sq || d < (had ? VOICE_DROP : VOICE_R)) list.push({ id, score: (mate ? -2000 : sq ? -1000 : 0) + d - (had ? 5 : 0) });
    }
    return list.sort((a, b) => a.score - b.score).slice(0, MAX_PEERS).map(o => o.id);
  }
  const carMate = id => {
    const r = MP.remotes[id], me = MP.ride; if (!r) return false;
    return !!((r.ride && r.ride[0] === MP.myId) || (me && (me.driver === id || (r.ride && r.ride[0] === me.driver))));
  };
  const isSquad = id => !!(MP.squad && MP.squad.code && (MP.squad.members || []).includes(id));
  function reconcile() {
    if (!V.on) return;
    if (MP.myId !== V.lastId) { Object.keys(V.peers).forEach(closePeer); V.roster = {}; V.lastId = MP.myId; announce(); }   // new socket, new id
    const now = performance.now();
    for (const id of Object.keys(V.roster)) if (now - V.roster[id].at > 14000 || !MP.remotes[id]) { delete V.roster[id]; if (V.peers[id]) closePeer(id); }
    const want = wanted();
    for (const id of Object.keys(V.peers)) {
      const p = V.peers[id];
      if (want.includes(id)) p.outSince = 0;
      else if (!p.outSince) p.outSince = now;
      else if (now - p.outSince > 6000) { sig(id, { k: 'bye' }); closePeer(id); }   // hysteresis: a border crossing does not redial
    }
    for (const id of want) if (!V.peers[id] && now > (V.backoff && V.backoff[id] || 0)) {
      if (MP.myId < id) dial(id); else sig(id, { k: 'req' });            // the lower id always offers, so offers never collide
      (V.backoff = V.backoff || {})[id] = now + 3000;
    }
  }
  const sig = (id, d) => MP.send('soc:sig', d, { to: id });
  function tuneSdp(sdp) {   // voice-sized Opus: FEC for loss, DTX so silence costs nothing, mono 24 kb/s
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i); if (!m) return sdp;
    const opt = 'useinbandfec=1;usedtx=1;stereo=0;maxaveragebitrate=24000';
    const re = new RegExp('a=fmtp:' + m[1] + ' ([^\\r\\n]*)');
    return re.test(sdp) ? sdp.replace(re, (l, p) => 'a=fmtp:' + m[1] + ' ' + p.split(';').filter(k => !/^(useinbandfec|usedtx|stereo|maxaveragebitrate)=/.test(k)).concat(opt).join(';')) : sdp;
  }
  function makePeer(id, answering) {
    const pc = new RTCPeerConnection({ iceServers: ICE(), bundlePolicy: 'max-bundle' });
    const p = V.peers[id] = { id, pc, level: 0, speakT: 0, state: 'connecting', pending: [], outSince: 0 };
    if (!answering) {          // one sendrecv transceiver for life: joining PTT, gate and a later mic all use replaceTrack / enabled
      p.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (V.micTrack) p.sender.replaceTrack(V.micTrack).catch(() => {});
    }
    pc.onicecandidate = e => { if (e.candidate) sig(id, { k: 'ice', c: e.candidate }); };
    pc.ontrack = e => attach(p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState; panel();
      if (pc.connectionState === 'failed') {
        if (!V.relayNote) { V.relayNote = true; setMsg('Could not reach a player directly. Off a LAN some networks need a TURN server (see README).'); }
        closePeer(id); (V.backoff = V.backoff || {})[id] = performance.now() + 10000;
      }
    };
    panel(); return p;
  }
  function attach(p, stream) {
    if (p.src) return;
    const c = V.ctx;
    // Chrome only pulls a remote stream into Web Audio if a media element also plays it. Kept out of the DOM on purpose:
    // mute.js unmutes every <audio> it finds and that would double the voice without any spatial mix.
    p.sink = new Audio(); p.sink.srcObject = stream; const pl = p.sink.play(); p.sink.muted = true; if (pl) pl.then(() => { p.sink.muted = true; }).catch(() => {});
    p.src = c.createMediaStreamSource(stream);
    p.an = c.createAnalyser(); p.an.fftSize = 512; p.buf = new Float32Array(512);
    p.hp = c.createBiquadFilter(); p.hp.type = 'highpass'; p.hp.frequency.value = 80;
    p.lp = c.createBiquadFilter(); p.lp.type = 'lowpass'; p.lp.frequency.value = 12000;
    p.gain = c.createGain(); p.gain.gain.value = 0;
    p.pan = c.createPanner(); p.pan.panningModel = (window.Device && Device.touchUI) ? 'equalpower' : 'HRTF';
    p.pan.distanceModel = 'inverse'; p.pan.refDistance = 3; p.pan.rolloffFactor = 1.3; p.pan.maxDistance = 200;
    p.src.connect(p.an); p.src.connect(p.hp); p.hp.connect(p.lp); p.lp.connect(p.gain); p.gain.connect(p.pan); p.pan.connect(V.master);
  }
  function closePeer(id) {
    const p = V.peers[id]; if (!p) return; delete V.peers[id];
    try { p.pc.close(); } catch (e) {}
    if (p.sink) { p.sink.pause(); p.sink.srcObject = null; }
    [p.src, p.an, p.hp, p.lp, p.gain, p.pan].forEach(n => { if (n) try { n.disconnect(); } catch (e) {} });
    panel();
  }
  async function dial(id) {
    const p = makePeer(id);
    try {
      const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o);
      sig(id, { k: 'offer', sdp: p.pc.localDescription.sdp });
    } catch (e) { console.warn('voice offer', e); closePeer(id); }
  }
  async function flushIce(p) { for (const c of p.pending.splice(0)) try { await p.pc.addIceCandidate(c); } catch (e) {} }
  MP.on('soc:sig', async (d, m) => {
    const id = m.from; if (!d || !id || !V.on) return;
    if (d.k === 'req') {
      const r = MP.remotes[id];
      if (r && !isMuted(r.name) && !V.peers[id] && MP.myId < id && Object.keys(V.peers).length < MAX_PEERS) dial(id);
      else if (Object.keys(V.peers).length >= MAX_PEERS && !V.peers[id]) sig(id, { k: 'bye' });
    } else if (d.k === 'offer' && typeof d.sdp === 'string') {
      if (Object.keys(V.peers).length >= MAX_PEERS || (MP.remotes[id] && isMuted(MP.remotes[id].name))) return sig(id, { k: 'bye' });
      if (V.peers[id]) closePeer(id);
      const p = makePeer(id, true);
      try {
        await p.pc.setRemoteDescription({ type: 'offer', sdp: tuneSdp(d.sdp) });
        const tr = p.pc.getTransceivers()[0];      // created by the offer; a transceiver added earlier would stay unassociated
        tr.direction = 'sendrecv'; p.sender = tr.sender;
        if (V.micTrack) await p.sender.replaceTrack(V.micTrack);
        const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
        sig(id, { k: 'answer', sdp: p.pc.localDescription.sdp }); flushIce(p);
      } catch (e) { console.warn('voice answer', e); closePeer(id); }
    } else if (d.k === 'answer' && typeof d.sdp === 'string' && V.peers[id]) {
      try { await V.peers[id].pc.setRemoteDescription({ type: 'answer', sdp: tuneSdp(d.sdp) }); flushIce(V.peers[id]); } catch (e) { console.warn('voice answer set', e); }
    } else if (d.k === 'ice' && V.peers[id]) {
      const p = V.peers[id]; if (p.pc.remoteDescription) p.pc.addIceCandidate(d.c).catch(() => {}); else p.pending.push(d.c);
    } else if (d.k === 'bye') closePeer(id);
  });

  const setP = (node, v) => { if (node && node.setTargetAtTime) node.setTargetAtTime(v, V.ctx.currentTime, 0.06); };
  function place(o, x, y, z) { if (o.positionX) { setP(o.positionX, x); setP(o.positionY, y); setP(o.positionZ, z); } else o.setPosition(x, y, z); }
  function tickVoice(dt) {
    applyMaster();
    if (!V.on) return;
    if (V.ctx.state === 'suspended' && !document.hidden) V.ctx.resume();
    const L = V.ctx.listener, me = myPos(), d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
    place(L, me.x, 1.5, me.z);
    if (L.forwardX) { setP(L.forwardX, d.x); setP(L.forwardY, 0); setP(L.forwardZ, d.z); L.upY.value = 1; } else L.setOrientation(d.x, 0, d.z, 0, 1, 0);
    const iFoot = onFoot() && !MP.ride, meClosed = !iFoot && !bikeish(myKind());
    for (const p of Object.values(V.peers)) {
      const r = MP.remotes[p.id]; if (!r || !p.pan) continue;
      if (p.an) { p.an.getFloatTimeDomainData(p.buf); p.level += (rms(p.buf) - p.level) * clamp(dt * 18, 0, 1); }
      if (p.level > 0.012) p.speakT = 0.3; else p.speakT -= dt;
      const rp = r.g.position, dx = rp.x - me.x, dz = rp.z - me.z, dist = Math.hypot(dx, dz), mate = carMate(p.id), sq = isSquad(p.id);
      const pv = V.peerVol[r.name] == null ? 1 : V.peerVol[r.name];
      let g = pv, lp = 12000, hp = 80, px = rp.x, pz = rp.z;
      if (mate) { px = me.x; pz = me.z; g *= 1.1; }                                     // same vehicle: dry and centred
      else {
        const near = clamp((VOICE_R - dist) / 10, 0, 1);                               // proximity falls to nothing by 45 m
        const closed = meClosed !== (r.kind !== 'foot' && !bikeish(r.kind)) || (meClosed && !mate);
        if (closed && near > 0) { lp = 1400; g *= 0.65; }                              // glass between you
        if (sq && dist > VOICE_R - 10) {                                               // squad radio takes over as proximity fades
          const k = 3.5 / Math.max(dist, 1); px = me.x + dx * k; pz = me.z + dz * k; lp = 3400; hp = 320;
        } else g *= near;
      }
      setP(p.gain.gain, g); setP(p.lp.frequency, lp); setP(p.hp.frequency, hp);
      place(p.pan, px, r.kind === 'foot' ? 1.5 : 1.2, pz);
    }
    // mic: PTT, or open with a noise gate and 400 ms hangover
    let want = false;
    if (V.micAn) {
      V.micAn.getFloatTimeDomainData(V.micBuf); V.micLevel += (rms(V.micBuf) - V.micLevel) * clamp(dt * 18, 0, 1);
      if (V.micLevel > V.thresh) V.gateT = 0.4; else V.gateT -= dt;
      want = !V.selfMute && (V.mode === 'open' ? V.gateT > 0 : V.ptt);
    }
    if (V.micTrack && want !== V.sending) { V.sending = want; V.micTrack.enabled = want; dockState(); }
    const talkingNow = V.sending && V.micLevel > 0.008;
    if (talkingNow) V.talkT = 0.3; else V.talkT = (V.talkT || 0) - dt;
    const sp = V.talkT > 0;
    if (sp !== V.speaking) { V.speaking = sp; Pose.dirty = true; }
    meterAndList();
  }
  const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
  const bikeish = k => /bike|cycle|auto|moped|scooter/.test(k || '');
  const myKind = () => onFoot() ? 'foot' : (Player.active && Player.active.model) || 'car';

  // ---------------- voice UI
  let listT = 0;
  function meterAndList() {
    const i = vp.querySelector('#socMeter i');
    if (i) { i.style.width = clamp(V.micLevel * 700, 0, 100) + '%'; i.style.background = V.sending ? '#4ade80' : '#64748b'; }
    if ((listT += 1) % 6) return;
    for (const p of Object.values(V.peers)) { const d = vp.querySelector(`.dot[data-p="${p.id}"]`); if (d) d.classList.toggle('on', p.speakT > 0); }
    const names = Object.values(V.peers).filter(p => p.speakT > 0 && MP.remotes[p.id]).slice(0, 4).map(p => MP.remotes[p.id].name);
    if (V.sending) names.unshift('You');
    const key = names.join('|'); if (key !== talkers.dataset.k) { talkers.dataset.k = key; talkers.textContent = ''; names.forEach(n => talkers.appendChild(el('span', '', n))); }
  }
  function dockState() {
    const b = dock.querySelector('#socBtnV'), t = dock.querySelector('#socBtnP');
    b.classList.toggle('live', V.on); t.hidden = !(V.on && V.micTrack && V.mode === 'ptt');
    t.classList.toggle('on', V.sending);
    dock.querySelector('#socBtnS').classList.toggle('live', !!Pose.mine.sit);
  }
  function panel() {
    if (!vp.classList.contains('open')) return;
    vp.textContent = ''; vp.appendChild(el('h4', '', 'Voice chat'));
    if (V.msg) vp.appendChild(el('div', 'msg', V.msg));
    const btn = (t, f, cls) => { const b = el('button', cls || '', t); b.type = 'button'; b.addEventListener('click', e => { f(); e.currentTarget.blur(); }); return b; };
    const row = (...k) => { const r = el('div', 'row'); k.forEach(x => r.appendChild(x)); vp.appendChild(r); return r; };
    if (!V.on) {
      vp.appendChild(el('div', '', 'Talk to players around you and your squad. Joining connects you directly to them, so they can see your IP address. Headphones stop echo.'));
      row(btn('Join voice', join, 'pri')); return;
    }
    if (V.micTrack) {
      row(btn('Push-to-talk', () => setMode('ptt'), V.mode === 'ptt' ? 'on' : ''), btn('Open mic', () => setMode('open'), V.mode === 'open' ? 'on' : ''), btn(V.selfMute ? 'Unmute' : 'Mute mic', muteSelf, V.selfMute ? 'on' : ''));
      const m = el('div'); m.id = 'socMeter'; m.appendChild(el('i')); vp.appendChild(m);
      if (V.mode === 'open') row(el('span', 'g', 'Mic sensitivity'), range(0.004, 0.08, 0.002, 0.084 - V.thresh, v => { V.thresh = 0.084 - v; store.set('gate', V.thresh); }));
      else vp.appendChild(el('div', '', 'Hold ` or . to talk (or the mic button).'));
    } else row(btn('Retry mic', async () => { await openMic(); pushMic(); announce(); dockState(); panel(); }));
    row(el('span', 'g', 'Voice volume'), range(0, 1.5, 0.05, V.volume, v => { V.volume = v; store.set('vol', v); }));
    if (window.GameMute && GameMute.muted) vp.appendChild(el('div', 'msg', 'Game sound is muted, so voices are too. Press , to unmute.'));
    const ids = Object.keys(V.peers);
    vp.appendChild(el('div', '', ids.length ? `Connected to ${ids.length} of ${MAX_PEERS}` : 'Nobody in voice range yet.'));
    for (const id of ids) {
      const r = MP.remotes[id], name = r ? r.name : id, pr = el('div', 'pr'), dot = el('span', 'dot'); dot.dataset.p = id;
      pr.appendChild(dot); pr.appendChild(el('b', '', name + (carMate(id) ? ' · car' : isSquad(id) ? ' · squad' : '') + (V.peers[id].state === 'connected' ? '' : ' …')));
      pr.appendChild(range(0, 1.5, 0.05, V.peerVol[name] == null ? 1 : V.peerVol[name], v => { V.peerVol[name] = v; store.set('peerVol', V.peerVol); }));
      pr.appendChild(btn('Mute', () => toggleMute(name)));
      vp.appendChild(pr);
    }
    if (mutedNames.length) for (const n of mutedNames) { const pr = el('div', 'pr'); pr.appendChild(el('b', '', n + ' · muted')); pr.appendChild(btn('Unmute', () => toggleMute(n))); vp.appendChild(pr); }
    row(btn('Leave voice', leave));
  }
  function range(a, b, s, v, f) { const i = el('input'); i.type = 'range'; i.min = a; i.max = b; i.step = s; i.value = v; i.setAttribute('aria-label', 'Level'); i.addEventListener('input', () => f(+i.value)); i.addEventListener('keydown', e => e.stopPropagation()); return i; }
  function setMode(m) { V.mode = m; store.set('mode', m); dockState(); panel(); }
  function muteSelf() { V.selfMute = !V.selfMute; panel(); toast(V.selfMute ? 'MIC MUTED' : 'MIC ON'); }
  function toggleMute(n) {
    mutedNames = isMuted(n) ? mutedNames.filter(x => x !== n) : mutedNames.concat(n); store.set('muted', mutedNames);
    if (isMuted(n)) for (const id of Object.keys(V.peers)) if (MP.remotes[id] && MP.remotes[id].name === n) { sig(id, { k: 'bye' }); closePeer(id); }
    panel();
  }
  function togglePanel() { vp.classList.toggle('open'); panel(); }

  // ================================================================ sit, emotes, talk
  const Seats = { list: [], walls: [] };
  const seat = (x, z, y, rot, pose, label) => Seats.list.push({ x, z, y, rot, pose, label });
  function placeFurniture(G) {
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
    const addBox = (g, w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); };
    const put = (x, y, z, rot, build) => { const g = new THREE.Group(); build(g); g.position.set(x, y, z); g.rotation.y = rot; G.scene.add(g); };
    const plastic = mat(0xc62f2f), stone = mat(0x8c8678);
    const chair = (x, y, z, rot) => {
      put(x, y, z, rot, g => {
        addBox(g, 0.44, 0.04, 0.42, 0, 0.42, 0, plastic); addBox(g, 0.44, 0.42, 0.04, 0, 0.66, -0.21, plastic);
        for (const [a, b] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) addBox(g, 0.04, 0.41, 0.04, a, 0.205, b, plastic);
      });
      seat(x, z, y + 0.44, rot, 'chair', 'chair');
    };
    const bench = (x, y, z, rot) => {    // stone slab bench, three places
      put(x, y, z, rot, g => { addBox(g, 1.9, 0.08, 0.45, 0, 0.41, 0, stone); for (const a of [-0.75, 0.75]) addBox(g, 0.14, 0.38, 0.4, a, 0.19, 0, stone); });
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const a of [-0.6, 0, 0.6]) seat(x + a * c, z - a * s, y + 0.45, rot, 'chair', 'bench');
    };
    const SH = window.SafeHouse2;
    if (SH && SH.W) {
      const W = SH.W, O = W(0, 0), Nb = W(0, 1), Na = W(1, 0), faceGate = Math.atan2(-(Nb.x - O.x), -(Nb.z - O.z)), faceA = Math.atan2(Na.x - O.x, Na.z - O.z);
      let p = W(-8.9, 0.75); chair(p.x, 0.97, p.z, faceGate);                                 // porch, beside grandma
      p = W(-14.4, -2.2); chair(p.x, 0.85, p.z, faceGate + 0.5); p = W(-13.5, -2.4); chair(p.x, 0.85, p.z, faceGate - 0.5);   // courtyard pair, clear of the ramp
      for (const a of [-9.1, -8.4, -7.7]) { p = W(a, -0.75); seat(p.x, p.z, 0.99, faceGate, 'floor', 'porch edge'); }
      for (const b of [4.7, 5.6, 6.5]) { p = W(-13.2, b); seat(p.x, p.z, 1.41, faceA, 'chair', 'sofa'); }
      for (const a of [-11.9, -11.3]) { p = W(a, 7.3); seat(p.x, p.z, 1.4, faceGate, 'chair', 'sofa'); }
    }
    const lm = (window.NELLUTLA_MAP && NELLUTLA_MAP.landmarks) || [];
    let n = 0;
    for (const l of lm) {                                                                     // a stone bench beside each landmark
      if (n >= 8 || l.x == null) continue;
      for (const [ox, oz] of [[9, 4], [-9, 4], [9, -4], [-9, -4]]) {
        const q = { x: l.x + ox, z: l.z + oz }, s = G.world.surfaceAt ? G.world.surfaceAt(q.x, q.z) : '';
        const hit = G.world.collide && G.world.collide({ x: q.x, z: q.z }, 1.3);
        if (hit && hit.hit || /road|highway|tar|water|river|lake/i.test(String(s))) continue;
        bench(q.x, typeof groundY === 'function' ? groundY(q.x, q.z) : 0, q.z, Math.atan2(-ox, -oz)); n++; break;
      }
    }
    const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };   // same as nellutla-world.js
    Seats.walls = ((window.NELLUTLA_MAP && NELLUTLA_MAP.walls) || []).map(w => {
      const h = hash(w[0] * 0.13 + w[2] * 0.07, w[1] * 0.11 + w[3] * 0.05);
      return { w, H: (h < 0.84 ? 1.5 + (h * 17 % 1) * 0.3 + 0.08 : 1.35) };
    });
  }
  function occupied(x, z) {
    for (const [id, s] of Object.entries(Pose.st)) { const r = MP.remotes[id]; if (s.sit && r && Math.hypot(r.g.position.x - x, r.g.position.z - z) < 0.4) return true; }
    return false;
  }
  function nearestSeat() {
    const p = carPos; let best = null, bd = 1.7;
    for (const s of Seats.list) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd && Math.abs(s.y - p.y) < 1.2 && !occupied(s.x, s.z)) { bd = d; best = s; } }
    if (best) return best;
    bd = 1.2;
    for (const { w, H } of Seats.walls) {                                                      // any compound wall
      const ax = w[0], az = w[1], ex = w[2] - ax, ez = w[3] - az, L = ex * ex + ez * ez || 1, t = clamp(((p.x - ax) * ex + (p.z - az) * ez) / L, 0, 1);
      const x = ax + ex * t, z = az + ez * t, d = Math.hypot(p.x - x, p.z - z);
      if (d < bd && d > 0.05 && !occupied(x, z)) { bd = d; best = { x, z, y: H + (typeof groundY === 'function' ? groundY(x, z) : 0), rot: Math.atan2(p.x - x, p.z - z), pose: 'ledge', label: 'wall' }; }
    }
    return best;
  }
  // forward along the model's +z: thighs lie forward of the hips, so the pelvis goes to the seat's back half
  const SEAT_BACK = { chair: 0.12, ledge: 0.0, floor: 0 };
  function poseSit(P, pose) {
    HumanModel.sit(P, 'bench');
    if (pose === 'chair') {
      P.legL.rotation.set(-1.5, 0, 0.06); P.legR.rotation.set(-1.5, 0, -0.06); P.shinL.rotation.x = P.shinR.rotation.x = 1.5;
      P.torso.rotation.x = 0.06; P.armL.rotation.set(-0.5, 0, 0.1); P.armR.rotation.set(-0.5, 0, -0.1); P.foreL.rotation.x = P.foreR.rotation.x = -0.75;
      if (P.skirt) { P.skirt.rotation.set(-0.8, 0, 0); P.skirt.scale.set(1.2, 0.72, 2); }
    } else if (pose === 'ledge') {   // legs hanging over the edge
      P.legL.rotation.set(-1.25, 0, 0.1); P.legR.rotation.set(-1.15, 0, -0.1); P.shinL.rotation.x = 1.2; P.shinR.rotation.x = 1.05;
      P.torso.rotation.x = 0.14; P.armL.rotation.set(-0.3, 0, 0.22); P.armR.rotation.set(-0.3, 0, -0.22); P.foreL.rotation.x = P.foreR.rotation.x = -0.5;
    } else {                         // cross-legged on the floor
      P.legL.rotation.set(-1.45, 0, 0.75); P.legR.rotation.set(-1.45, 0, -0.75); P.shinL.rotation.x = P.shinR.rotation.x = 2.2;
      P.torso.rotation.x = 0.08; P.armL.rotation.set(-0.45, 0, 0.14); P.armR.rotation.set(-0.45, 0, -0.14); P.foreL.rotation.x = P.foreR.rotation.x = -0.8;
    }
  }
  function poseEmote(P, em, t) {
    const k = clamp(Math.min(t, em.dur - t) / 0.25, 0, 1);
    if (em.k === 'wave') { P.armR.rotation.set(-0.2 * k, 0, -2.6 * k); P.foreR.rotation.x = -0.5 * k; P.foreR.rotation.z = Math.sin(t * 11) * 0.45 * k; }
    else {                                    // namaste: palms together at the chest, small bow
      P.armL.rotation.set(-0.95 * k, 0, -0.48 * k); P.armR.rotation.set(-0.95 * k, 0, 0.48 * k); P.foreL.rotation.x = P.foreR.rotation.x = -1.75 * k;
      P.foreL.rotation.y = 0.5 * k; P.foreR.rotation.y = -0.5 * k; P.head.rotation.x += 0.28 * k * Math.sin(Math.min(1, t / em.dur) * Math.PI);
    }
  }
  function poseTalk(P, t, lvl) {
    const v = clamp(lvl, 0, 1);
    if (P.jaw) P.jaw.rotation.x = v * 0.3;                    // sculpted body: real jaw
    P.head.rotation.x += Math.sin(t * 7.5) * 0.035 * v + v * 0.03;  // low LOD has no jaw; speech still reads through the head
    P.head.rotation.y += Math.sin(t * 3.1) * 0.05 * v;
  }
  const Pose = {
    st: {}, mine: { sit: null, em: null, talk: false }, stand: null, emT: 0, dirty: false, keep: 0, lastSpoke: {}, jaw: 0,
    of(id) { return this.st[id]; }, seen() {},
    send() {
      const m = this.mine;
      MP.send('soc:pose', { sit: m.sit ? { p: m.sit.pose, y: +m.sit.y.toFixed(2), r: +m.sit.rot.toFixed(3), b: m.sit.b } : null, em: m.em ? m.em.k : null, talk: !!V.speaking }, { to: 'near', range: 150 });
      this.dirty = false; this.keep = 3;
    }
  };
  MP.on('soc:pose', (d, m) => {
    if (!d || !m.from) return; const s = Pose.st[m.from] || (Pose.st[m.from] = { t: 0, jaw: 0 });
    s.sit = d.sit && typeof d.sit.y === 'number' ? { pose: ['chair', 'ledge', 'floor'].includes(d.sit.p) ? d.sit.p : 'chair', y: d.sit.y, rot: +d.sit.r || 0, b: +d.sit.b || 0 } : null;
    if (d.em && (d.em === 'wave' || d.em === 'namaste')) { if (!s.em || s.em.k !== d.em) s.em = { k: d.em, t: 0, dur: 2.4 }; } s.talk = !!d.talk;
  });
  function sit() {
    if (Pose.mine.sit) return standUp();
    if (!onFoot() || MP.ride) return;
    const s = nearestSeat(); if (!s) return toast('NOTHING TO SIT ON HERE');
    Pose.stand = { x: carPos.x, z: carPos.z };
    Pose.mine.sit = Object.assign({ b: SEAT_BACK[s.pose] }, s); Pose.dirty = true; dockState();
  }
  function standUp() {
    if (!Pose.mine.sit) return; Pose.mine.sit = null;
    if (Pose.stand) { carPos.x = Pose.stand.x; carPos.z = Pose.stand.z; }
    Pose.dirty = true; dockState();
  }
  function emote(k) { if (!Player || typeof Player.mode === 'undefined') return; Pose.mine.em = { k, t: 0, dur: 2.4 }; Pose.dirty = true; }
  const seatGY = s => s.y + 0.02 - 0.89;
  const seatForward = s => s.b || 0;
  // who is someone talking with? the closest person within reach when either of them is speaking or just chatted
  function partnerOf(p, selfId, ids) {
    let best = null, bd = TALK_R;
    for (const o of ids) {
      if (o.id === selfId) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd && d > 0.3 && (o.active || p.active)) { bd = d; best = o; }
    }
    return best;
  }
  function tickPose(dt) {
    const now = performance.now(), t = now / 1000, ids = [{ id: 'me', x: carPos.x, z: carPos.z, active: !!V.speaking || now - (chatAt.me || 0) < 5000 }];
    for (const [id, r] of Object.entries(MP.remotes)) if (r.kind === 'foot' && !r.ride) {
      const pr = V.peers[id], s = Pose.st[id];
      ids.push({ id, x: r.g.position.x, z: r.g.position.z, active: !!(pr && pr.speakT > 0) || !!(s && s.talk) || now - (chatAt[id] || 0) < 5000 });
    }
    // remote avatars, after mp.js animated them this frame
    for (const [id, r] of Object.entries(MP.remotes)) {
      if (!r.human) continue;
      const s = Pose.st[id] || (Pose.st[id] = { t: 0, jaw: 0 }), P = r.human, moving = Math.abs(r.spd || 0) > 1.2;
      if (moving && s.sit) s.sit = null;
      if (s.sit) {
        poseSit(P, s.sit.pose); r.g.position.y = seatGY(s.sit); r.g.rotation.y = s.sit.rot;
        r.g.position.x -= Math.sin(s.sit.rot) * seatForward(s.sit); r.g.position.z -= Math.cos(s.sit.rot) * seatForward(s.sit); P.head.rotation.set(0, 0, 0);
      } else if (r._socSat !== false) { r._socSat = false; P.hips.position.set(0, 0.92, 0); [P.torso, P.hips, P.head, P.armL, P.armR, P.foreL, P.foreR].forEach(o => o && o.rotation.set(0, 0, 0)); if (P.skirt) { P.skirt.rotation.set(0, 0, 0); P.skirt.scale.set(1, 1, 1); } r.g.position.y = 0; }
      if (s.sit) r._socSat = true;
      const me = ids.find(o => o.id === id), mate = me && !moving ? partnerOf(me, id, ids) : null;
      if (mate) {
        const a = Math.atan2(mate.x - r.g.position.x, mate.z - r.g.position.z);
        if (s.sit) P.head.rotation.y = clamp(wrapA(a - s.sit.rot), -1.1, 1.1);
        else { s.face = (s.face == null ? r.g.rotation.y : s.face) + clamp(wrapA(a - (s.face == null ? r.g.rotation.y : s.face)), -3 * dt, 3 * dt); r.g.rotation.y = s.face; }
      } else s.face = null;
      if (s.em) { s.em.t += dt; if (s.em.t >= s.em.dur) s.em = null; else poseEmote(P, s.em, s.em.t); }
      const pr = V.peers[id], lvl = pr ? clamp(pr.level * 14, 0, 1) : s.talk ? 0.45 + Math.sin(t * 13) * 0.3 : 0;
      s.jaw += (lvl - s.jaw) * clamp(dt * 20, 0, 1); poseTalk(P, t + r.walkT, s.jaw);
    }
    // our own body
    if (typeof Player === 'undefined') return;
    const body = Player.body, P = body && body.parts, m = Pose.mine;
    if (!P) return;
    if (m.sit && (!onFoot() || MP.ride)) { m.sit = null; Pose.dirty = true; dockState(); }
    if (m.sit && document.activeElement !== input() && (inputState.gas || inputState.brake || inputState.left || inputState.right)) standUp();
    if (onFoot()) {
      if (m.sit) {
        const g = body.group, s = m.sit;
        carPos.x = s.x; carPos.z = s.z; carRot = s.rot; carSpeed = 0;
        poseSit(P, s.pose); g.position.set(s.x - Math.sin(s.rot) * s.b, seatGY(s), s.z - Math.cos(s.rot) * s.b); g.rotation.set(0, s.rot, 0); P.head.rotation.set(0, 0, 0);
      }
      const self = ids[0], mate = Math.abs(carSpeed) < 1 ? partnerOf(self, 'me', ids) : null;
      if (mate) {
        const a = Math.atan2(mate.x - carPos.x, mate.z - carPos.z);
        if (m.sit) P.head.rotation.y = clamp(wrapA(a - m.sit.rot), -1.1, 1.1);
        else { Pose.face = (Pose.face == null ? carRot : Pose.face) + clamp(wrapA(a - (Pose.face == null ? carRot : Pose.face)), -3 * dt, 3 * dt); body.group.rotation.y = Pose.face; }
      } else Pose.face = null;
      if (m.em) { m.em.t += dt; if (m.em.t >= m.em.dur) { m.em = null; Pose.dirty = true; } else poseEmote(P, m.em, m.em.t); }
      Pose.jaw += ((V.sending ? clamp(V.micLevel * 14, 0, 1) : 0) - Pose.jaw) * clamp(dt * 20, 0, 1); poseTalk(P, t, Pose.jaw);
    }
    Pose.keep -= dt;
    if (MP.online && (Pose.dirty || (Pose.keep <= 0 && (m.sit || m.em)))) Pose.send();
  }
  let hintT = 0;
  function tickHint(dt) {
    if ((hintT += dt) < 0.2) return; hintT = 0;
    const can = onFoot() && !MP.ride && playing();
    const s = can && !Pose.mine.sit ? nearestSeat() : null;
    let msg = '';
    document.body.classList.toggle('soc-sit', !!Pose.mine.sit);   // one prompt only while seated (style below)
    if (Pose.mine.sit) msg = 'Press <b>X</b> or move to stand';
    else if (s) msg = `Press <b>X</b> to sit on the ${s.label}`;
    if (msg !== hint._m) { hint._m = msg; hint.innerHTML = msg; hint.style.display = msg ? 'block' : 'none'; }
  }

  // ================================================================ input
  GameHooks.key.push(e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.code === 'Backquote' || e.code === 'Period') { V.ptt = true; return true; }
    if (e.code === 'Slash') { togglePanel(); return true; }
    if (e.code === 'Semicolon') { muteSelf(); return true; }
    if (!playing()) return false;
    if (e.code === 'KeyX') { sit(); return true; }
    if (e.code === 'Digit8') { emote('wave'); return true; }
    if (e.code === 'Digit9') { emote('namaste'); return true; }
    return false;
  });
  const pttOff = () => { V.ptt = false; };
  addEventListener('keyup', e => { if (e.code === 'Backquote' || e.code === 'Period') pttOff(); });
  addEventListener('blur', pttOff); document.addEventListener('visibilitychange', () => { if (document.hidden) pttOff(); });
  const B = id => dock.querySelector(id);
  B('#socBtnV').addEventListener('click', e => { togglePanel(); e.currentTarget.blur(); });
  const pb = B('#socBtnP');
  pb.addEventListener('pointerdown', e => { e.preventDefault(); pb.setPointerCapture(e.pointerId); V.ptt = true; });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => pb.addEventListener(n, pttOff));
  B('#socBtnS').addEventListener('click', e => { sit(); e.currentTarget.blur(); });
  B('#socBtnW').addEventListener('click', e => { emote('wave'); e.currentTarget.blur(); });
  B('#socBtnN').addEventListener('click', e => { emote('namaste'); e.currentTarget.blur(); });

  // ================================================================ frame + slow ticks
  GameHooks.init.push(game => {
    adopt(); setChannel('all');
    setTimeout(() => { try { placeFurniture(game); } catch (e) { console.error('mp-social seats', e); } }, 1500);  // after SafeHouse2
  });
  // poses go after mp.js has animated remotes and Player.update has posed us, so wrap MP.update
  const baseUpdate = MP.update;
  MP.update = function (dt) {
    baseUpdate(dt);
    try { tickVoice(dt); tickPose(dt); tickBubbles(); tickHint(dt); } catch (e) { console.warn('mp-social', e); }
    const typing = document.activeElement === input();
    if (typing && !box.classList.contains('open')) { box.classList.add('open'); setChannel(channel); fitKeyboard(); }
    const idle = performance.now() - lastActive;
    $log.style.opacity = box.classList.contains('open') ? 1 : idle < 12000 ? 1 : Math.max(0, 1 - (idle - 12000) / 2000);
  };
  setInterval(() => { try { reconcile(); } catch (e) { console.warn(e); } }, 1000);
  setInterval(() => { if (V.on && MP.online) announce(); }, 5000);
  addEventListener('pointerdown', () => { if (V.ctx && V.ctx.state === 'suspended') V.ctx.resume(); }, true);
  addEventListener('beforeunload', () => { if (V.on) Object.keys(V.peers).forEach(id => sig(id, { k: 'bye' })); });

  window.Social = {
    say, sit, standUp, emote, join, leave, setMode, setChannel, bubble, Seats, Pose,
    get voice() { return V; }, showHud,
    async stats() {    // real RTP counters, for the test page and debugging
      const out = { sending: V.sending, micLevel: +V.micLevel.toFixed(4), peers: {} };
      for (const [id, p] of Object.entries(V.peers)) {
        const rep = await p.pc.getStats(); const o = { state: p.pc.connectionState, level: +p.level.toFixed(4), gain: p.gain ? +p.gain.gain.value.toFixed(3) : null };
        rep.forEach(s => {
          if (s.type === 'outbound-rtp' && s.kind === 'audio') { o.pktOut = s.packetsSent; o.bytesOut = s.bytesSent; }
          if (s.type === 'inbound-rtp' && s.kind === 'audio') { o.pktIn = s.packetsReceived; o.bytesIn = s.bytesReceived; o.lost = s.packetsLost; o.jitter = s.jitter; o.rxLevel = s.audioLevel; }
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) o.rtt = s.currentRoundTripTime;
        });
        out.peers[id] = o;
      }
      return out;
    }
  };
})();
