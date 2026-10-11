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

  /**
   * Drawing rate for the composite canvas. Every extra source is another tab
   * stream to decode, so three or four of them run at half rate instead of
   * paying full price for every frame.
   */
  function frameRate(count) {
    return count >= 3 ? 15 : 30;
  }

  /* Feature 6 (unified workspace window): one document-PiP hosted in the page
     holds a capture iframe on the left and a panel iframe on the right. Pure
     geometry + names only — the worker and the offscreen document wire it. */
  const UNIFIED_WIDTH = 1280;
  const UNIFIED_HEIGHT = 720;
  const UNIFIED_PANEL_WIDTH = 360;
  const UNIFIED_CHANNEL = "pipdesk-capture";
  const UNIFIED_PANELS = ["notes", "todos", "timer"];

  function unifiedFrame() {
    return {
      canvas: {
        x: 0,
        y: 0,
        width: UNIFIED_WIDTH - UNIFIED_PANEL_WIDTH,
        height: UNIFIED_HEIGHT,
      },
      panel: {
        x: UNIFIED_WIDTH - UNIFIED_PANEL_WIDTH,
        y: 0,
        width: UNIFIED_PANEL_WIDTH,
        height: UNIFIED_HEIGHT,
      },
    };
  }

  /** Size hint for the document-PiP requestWindow call. */
  function unifiedWindowSize() {
    return { width: UNIFIED_WIDTH, height: UNIFIED_HEIGHT };
  }

  function isUnifiedPanel(id) {
    return UNIFIED_PANELS.indexOf(id) !== -1;
  }

  const api = {
    FULL_WIDTH,
    FULL_HEIGHT,
    TILE_WIDTH,
    TILE_HEIGHT,
    UNIFIED_WIDTH,
    UNIFIED_HEIGHT,
    UNIFIED_PANEL_WIDTH,
    UNIFIED_CHANNEL,
    UNIFIED_PANELS,
    slots,
    frameRate,
    unifiedFrame,
    unifiedWindowSize,
    isUnifiedPanel,
  };

  // The page loads this as a plain script; the test runner requires it.
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.__pipDeskLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
