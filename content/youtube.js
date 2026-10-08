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

  const CONTROLS = ".ytp-right-controls";

  function mount() {
    const bar = document.querySelector(CONTROLS);
    if (!bar || document.getElementById(shared.BUTTON_ID)) return;
    bar.insertBefore(shared.buildControl(), bar.firstChild);
    shared.syncState();
  }

  /* YouTube navigates without reloading, and rebuilds the player as it goes. */
  let pending = false;
  function scheduleMount() {
    if (pending || document.getElementById(shared.BUTTON_ID)) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      mount();
    }, 250);
  }

  document.addEventListener("yt-navigate-finish", mount);
  new MutationObserver(scheduleMount).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
