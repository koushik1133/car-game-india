// Mute all game sound: comma key or the speaker button in the HUD. Covers the WebAudio context, spoken lines and recorded clips.
(function () {
  const KEY = 'nellutla.muted';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const ctx = () => { try { return audioCtx; } catch (e) { return null; } };
  function apply() {
    const c = ctx();
    if (c) { if (muted && c.state === 'running') c.suspend(); else if (!muted && c.state === 'suspended' && !document.hidden) c.resume(); }
    if (muted && window.speechSynthesis) speechSynthesis.cancel();
    document.querySelectorAll('audio').forEach(a => { a.muted = muted; });
    const b = document.getElementById('btnMute');
    if (b) { b.innerHTML = UI.icon(muted ? 'muted' : 'sound'); b.classList.toggle('on', muted); b.title = (muted ? 'Unmute' : 'Mute') + ' (,)'; }
  }
  function toggle() { muted = !muted; try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {} apply(); }
  // later sounds stay silent too: the context is held suspended, speech plays at zero volume so turns and lip sync keep their timing
  const speak = SpeechSynthesis.prototype.speak;
  SpeechSynthesis.prototype.speak = function (u) { if (muted) u.volume = 0; return speak.call(this, u); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = muted; return play.call(this); };
  setInterval(() => { const c = ctx(); if (muted && c && c.state === 'running') c.suspend(); }, 500);
  function addButton() {
    const s = document.getElementById('btnSettings'); if (!s || document.getElementById('btnMute')) return;
    const b = document.createElement('button');
    b.className = 'hud-btn'; b.id = 'btnMute'; b.setAttribute('aria-label', 'Mute sound');
    b.innerHTML = UI.icon('sound');
    b.addEventListener('click', e => { e.stopPropagation(); toggle(); b.blur(); });
    s.parentNode.insertBefore(b, s);
    apply();
  }
  addEventListener('keydown', e => { if (e.code === 'Comma' && !e.repeat && !/INPUT|TEXTAREA/.test((e.target.tagName || ''))) toggle(); });
  addButton(); addEventListener('DOMContentLoaded', addButton);
  window.GameMute = { toggle, get muted() { return muted; } };
})();
