// safehouse.js: retired. Version 1 of the player's home stood on map building #317; version 2 (safehouse2.js) now
// stands there and owns the plot, gate, storage ('nellutla.safehouse2') and map icon. This file stays because
// index.html still loads it; it only clears the old v1 save so stale v1 vehicles never reappear.
(function () {
  'use strict';
  try { localStorage.removeItem('nellutla.safehouse'); } catch (e) {}
})();
