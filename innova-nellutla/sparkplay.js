// SparkPlay: the phone-projection screen on car dashboards. One shared 512x256 canvas texture, redrawn at about 6 Hz and only while seated in cockpit view.
// Apps: map with guidance, radio (synthesised on the game's AudioContext), phone contacts. Keys: = next app, - next item, \ select.
(function () {
  'use strict';
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c), mat = new THREE.MeshBasicMaterial({ map: tex });
  const APPS = ['Map', 'Radio', 'Phone'], RADIO = [
    { name: 'Nellutla FM', f: '91.1', root: 146.8, scale: [0, 2, 4, 7, 9, 12], bpm: 104 },
    { name: 'Highway Beats', f: '94.3', root: 110, scale: [0, 3, 5, 7, 10, 12], bpm: 128 },
    { name: 'Temple Morning', f: '98.5', root: 196, scale: [0, 2, 5, 7, 9, 14], bpm: 66 }];
  const INK = '#0a1d22', ACC = '#f6b21b', TXT = '#f4f8f2', DIM = '#b9d2cc';
  const S = { app: 0, st: 0, on: false, con: 0, T: 0, last: 0, compact: false, frames: 0, step: 0 };
  let timer = 0, bus = null, bar = null;
  function note(ct, f, t, d, type, v) { const o = ct.createOscillator(), a = ct.createGain(); o.type = type; o.frequency.value = f; a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(v, t + .01); a.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(a); a.connect(bus); o.start(t); o.stop(t + d + .02); }
  function play() {
    let ct = null; try { ct = audioCtx; } catch (e) {} if (!ct) return false;
    if (!bus) { bus = ct.createGain(); bus.gain.value = .35; bus.connect(ct.destination); }
    clearInterval(timer); const beat = () => 60 / RADIO[S.st].bpm / 2;
    timer = setInterval(() => { const R = RADIO[S.st], t = ct.currentTime + .05, n = S.step++, p = R.scale[(n * 5 + (n >> 3) * 3) % R.scale.length], f = R.root * Math.pow(2, p / 12);
      if (n % 3 !== 2) note(ct, f * 2, t, .28, 'triangle', .1); if (n % 8 === 0) note(ct, R.root / 2, t, .6, 'sine', .22); if (n % 4 === 2) note(ct, 70, t, .12, 'square', .06); }, beat() * 1000);
    return true;
  }
  function radio(on) { S.on = on && play(); if (!S.on) clearInterval(timer); }
  function next() { S.app = (S.app + 1) % APPS.length; S.T = 0; }
  function item() { if (S.app === 1) { S.st = (S.st + 1) % RADIO.length; if (S.on) radio(true); } else if (S.app === 2) { const L = contacts(); S.con = (S.con + 1) % (L.length || 1); } S.T = 0; }
  function select() { if (S.app === 1) radio(!S.on); else if (S.app === 2) { const n = contacts()[S.con]; if (n) try { Phone.call(n.id); } catch (e) {} } S.T = 0; }
  const contacts = () => (window.Phone && Phone.contacts) || [];
  function tx(t, x, y, font, col, max) { g.font = font; g.fillStyle = col; g.fillText(t, x, y, max); }
  function mapApp(x0, big) {
    const w = W - x0, I = window.Nav && Nav.instr();
    g.save(); g.beginPath(); g.rect(x0, 0, w, H); g.clip(); g.translate(x0, 0);
    if (window.Nav) { const rot = Math.PI + carRot, s = .55; Nav.base(g, carPos.x, carPos.z, s, w, H, rot); Nav.drawRoute(g, carPos.x, carPos.z, s, w, H, rot, 7); }
    g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); const a = w / 2, b = H / 2 + 30; g.moveTo(a, b - 12); g.lineTo(a + 9, b + 9); g.lineTo(a, b + 5); g.lineTo(a - 9, b + 9); g.closePath(); g.fill(); g.stroke();
    if (I) { const st = Nav.state; g.fillStyle = INK; g.fillRect(0, 0, w, big ? 76 : 62); g.save(); g.translate(8, 6); g.scale(2, 2); g.strokeStyle = ACC; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(new Path2D(Nav.ARROW[I.k] || Nav.ARROW.straight)); g.restore();
      tx(Nav.fmtD(st.nextIn), 66, big ? 28 : 24, '700 ' + (big ? 30 : 24) + 'px Barlow, system-ui', TXT); tx(I.t, 66, big ? 58 : 48, '600 ' + (big ? 21 : 17) + 'px Barlow, system-ui', DIM, w - 74);
      g.fillStyle = INK; g.fillRect(0, H - 30, w, 30); tx(Nav.fmtD(st.remain) + ' left, ' + Nav.fmtT(st.secs), 10, H - 15, '600 ' + (big ? 19 : 16) + 'px Barlow, system-ui', ACC, w - 20);
    } else { g.fillStyle = INK; g.fillRect(0, H - 34, w, 34); tx('Press M to pick a destination', 10, H - 17, '600 ' + (big ? 19 : 16) + 'px Barlow, system-ui', TXT, w - 20); }
    g.restore();
  }
  function radioApp(x, big) {
    const R = RADIO[S.st], y = big ? 56 : 44; tx(R.f + ' FM', x + 18, y, '800 ' + (big ? 58 : 44) + 'px "Barlow Condensed", system-ui', ACC); tx(R.name, x + 18, y + (big ? 52 : 40), '600 ' + (big ? 28 : 22) + 'px Barlow, system-ui', TXT);
    tx(S.on ? 'Playing' : 'Stopped', x + 18, y + (big ? 90 : 70), '500 ' + (big ? 21 : 18) + 'px Barlow, system-ui', DIM);
    for (let i = 0; i < 18; i++) { const h = S.on ? 8 + 34 * Math.abs(Math.sin(S.frames * .7 + i * 1.3)) : 4; g.fillStyle = ACC; g.fillRect(x + 18 + i * 13, H - 18 - h, 8, h); }
    tx('\\ play or stop    - next station', x + 18, H - 8, '500 13px Barlow, system-ui', DIM);
  }
  function phoneApp(x, big) {
    const L = contacts(), rh = big ? 42 : 34, first = Math.max(0, Math.min(S.con - 2, L.length - 5)); tx('Contacts', x + 18, 22, '700 19px Barlow, system-ui', ACC);
    L.slice(first, first + 5).forEach((n, i) => { const y = 42 + i * rh, on = first + i === S.con; if (on) { g.fillStyle = ACC; g.fillRect(x + 8, y, W - x - 16, rh - 4); } tx(n.name, x + 18, y + rh / 2 - 2, '600 ' + (big ? 25 : 20) + 'px Barlow, system-ui', on ? INK : TXT); });
    if (!L.length) tx('No contacts yet', x + 18, 70, '500 20px Barlow, system-ui', DIM);
  }
  function draw() {
    S.frames++; g.textBaseline = 'middle'; g.fillStyle = '#0f272d'; g.fillRect(0, 0, W, H); const rail = S.compact ? 0 : 58;
    if (rail) { g.fillStyle = INK; g.fillRect(0, 0, rail, H); ['M3 5l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 3v14M15 5v14', 'M4 9h16v10H4zM6 9l11-5M8 14h0M13 12h5M13 16h5', 'M7 3h10v18H7zM11 18h2'].forEach((d, i) => { const y = 14 + i * 80; if (i === S.app) { g.fillStyle = ACC; g.fillRect(0, y - 8, 4, 62); } g.save(); g.translate(14, y + 4); g.scale(1.25, 1.25); g.strokeStyle = i === S.app ? ACC : DIM; g.lineWidth = 2; g.stroke(new Path2D(d)); g.restore(); }); }
    if (S.app === 0) mapApp(rail, S.compact); else if (S.app === 1) radioApp(rail, S.compact); else phoneApp(rail, S.compact);
    if (window.Drive && Drive.engine) tx(Math.round(Drive.speed) + ' km/h  ·  ' + Drive.gear + '  ·  ' + (Math.round(Drive.rpm / 50) * 50) + ' rpm', 12, 250, '14px sans-serif', '#9fd0ff', 300);
    if (S.target) { S.target.canvas.getContext('2d').drawImage(c, 0, 0); S.target.tex.needsUpdate = true; } else tex.needsUpdate = true;
  }
  function strip() {
    if (bar) return; bar = document.createElement('div'); bar.id = 'spBar'; bar.innerHTML = '<b>SparkPlay</b><button data-a="next">Next app <kbd>=</kbd></button><button data-a="item">Next item <kbd>-</kbd></button><button data-a="sel">Select <kbd>\\</kbd></button>';
    bar.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); ({ next, item, sel: select })[b.dataset.a](); b.blur(); }); document.body.appendChild(bar);
  }
  window.SparkPlay = { mat, tick(dt, seat, mesh) {
    S.compact = !!(seat && seat.compactScreen); S.last = performance.now(); strip(); document.body.classList.add('sp-on');
    S.target = mesh || null;
    if ((S.T -= dt) <= 0) { S.T = .16; draw(); }
  }, get state() { return S; }, next, item, select, radio };
  GameHooks.init.push(() => { });
  GameHooks.key.push(e => { if (e.repeat || !document.body.classList.contains('sp-on')) return false; if (e.code === 'Equal') { next(); return true; } if (e.code === 'Minus') { item(); return true; } if (e.code === 'Backslash') { select(); return true; } return false; });
  GameHooks.update.push(() => { const on = performance.now() - S.last < 700; if (!on && document.body.classList.contains('sp-on')) document.body.classList.remove('sp-on'); if (S.on && Player.mode === 'foot') radio(false); });
})();
