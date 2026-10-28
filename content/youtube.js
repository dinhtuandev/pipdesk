/* ==========================================================================
   PiPDesk — YouTube mount point.
   The control lives in content/float-control.js, which this file consumes
   through window.__pipDeskFloat; here we only decide where it goes.

   The click has to be the thing that asks for the picture-in-picture window:
   a request routed through the service worker arrives without the page's user
   activation and comes back as NotAllowedError.
   ========================================================================== */

(() => {
  "use strict";

  if (window.__pipDeskYouTubeControl) return;
  window.__pipDeskYouTubeControl = true;

  const shared = window.__pipDeskFloat;
  if (!shared) return; // float-control.js did not load: nothing to mount.

  const PLAYER = "#movie_player, .html5-video-player";
  const CONTROLS = ".ytp-right-controls";

  /*
   * YouTube rebuilds the player constantly (ads, captions, the progress bar),
   * so watching the whole document meant a callback on every one of those
   * mutations for the entire session. Watch the player instead, and only until
   * the control is in place. The player may not exist yet at document_idle, in
   * which case the document is observed just long enough to notice it.
   */
  let observer = null;
  let observed = null;
  let pending = null;

  function observePlayer() {
    const target = document.querySelector(PLAYER) || document.documentElement;
    if (observed === target) return;
    observer?.disconnect();
    observer = new MutationObserver(scheduleMount);
    observer.observe(target, { childList: true, subtree: true });
    observed = target;
  }

  function mount() {
    // Hover previews carry their own copy of the control bar; take the player's.
    const bar =
      document.querySelector(`${PLAYER} ${CONTROLS}`) ||
      document.querySelector(CONTROLS);
    if (!bar || document.getElementById(shared.BUTTON_ID)) return;
    bar.insertBefore(shared.buildControl(), bar.firstChild);
    shared.syncState();
    observePlayer();
  }

  function scheduleMount() {
    if (pending || document.getElementById(shared.BUTTON_ID)) return;
    pending = setTimeout(() => {
      pending = null;
      mount();
    }, 300);
  }

  function watch() {
    observePlayer();
    mount();
  }

  /* A navigation can replace the player node we were watching. */
  document.addEventListener("yt-navigate-finish", watch);

  /* Watching the player misses the case where YouTube swaps the whole player
     node without a navigation event; a slow check costs one lookup. */
  const guard = setInterval(() => {
    if (!document.getElementById(shared.BUTTON_ID)) mount();
  }, 2000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else {
    watch();
  }

  window.addEventListener("pagehide", () => {
    clearInterval(guard);
    observer?.disconnect();
    observer = null;
    observed = null;
    if (pending !== null) clearTimeout(pending);
    pending = null;
  });
})();
