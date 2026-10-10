/* ==========================================================================
   PiPDesk — canvas layout maths.
   Pure on purpose: the compositor asks this where every source sits, and
   tests/layout.test.js checks it with `node --test`, no browser needed.
   ========================================================================== */

(function (root) {
  "use strict";

  const FULL_WIDTH = 1280;
  const FULL_HEIGHT = 720;
  const TILE_WIDTH = 640;
  const TILE_HEIGHT = 360;

  /**
   * Where each source sits on the canvas.
   * A focused source — or a lone one — fills the frame. Otherwise the sources
   * share a two-column grid: two tiles sit centred, three and four fill a
   * two-by-two block.
   */
  function slots(count, focused) {
    if (focused || count <= 1) {
      return [{ x: 0, y: 0, width: FULL_WIDTH, height: FULL_HEIGHT }];
    }

    const columns = 2;
    const offsetY = count <= 2 ? Math.round((FULL_HEIGHT - TILE_HEIGHT) / 2) : 0;
    return Array.from({ length: count }, (unused, index) => ({
      x: (index % columns) * TILE_WIDTH,
      y: offsetY + Math.floor(index / columns) * TILE_HEIGHT,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
    }));
  }

  const api = { FULL_WIDTH, FULL_HEIGHT, TILE_WIDTH, TILE_HEIGHT, slots };

  // The page loads this as a plain script; the test runner requires it.
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.__pipDeskLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
