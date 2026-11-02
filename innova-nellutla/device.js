// Device detection shared by touch-controls.js and quality.js.
// Phones and tablets get on-screen controls (like mobile shooters); laptops and desktops don't, even with a touchscreen,
// because they have a keyboard and a fine pointer. Override with localStorage 'nellutla.controls' = 'touch' | 'keyboard'.
window.Device = (function () {
  const ua = navigator.userAgent || '';
  const mq = q => !!(window.matchMedia && matchMedia(q).matches);
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;          // iPadOS reports itself as a Mac
  const mobileUA = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(ua);
  const tabletUA = iPadOS || /iPad|Tablet|Android(?!.*Mobile)|Silk|Kindle|PlayBook/i.test(ua);
  const primaryCoarse = mq('(pointer: coarse)'), anyFine = mq('(any-pointer: fine)'), canHover = mq('(any-hover: hover)');
  let type = mobileUA ? 'phone' : tabletUA ? 'tablet'
    : (primaryCoarse && !anyFine && !canHover) ? (Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet')
    : 'desktop';
  let override = null;
  try { override = localStorage.getItem('nellutla.controls'); } catch (e) {}
  const touchUI = override === 'touch' ? true : override === 'keyboard' ? false : type !== 'desktop';
  return {
    type,                     // 'phone' | 'tablet' | 'desktop' (laptops included)
    touchUI,                  // show on-screen controls
    isMobile: type !== 'desktop',
    setControls(mode) { try { mode ? localStorage.setItem('nellutla.controls', mode) : localStorage.removeItem('nellutla.controls'); } catch (e) {} location.reload(); },
  };
})();
document.documentElement.dataset.device = Device.type;
document.documentElement.classList.toggle('touch-ui', Device.touchUI);
