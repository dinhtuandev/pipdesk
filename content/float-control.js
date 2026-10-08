/* ==========================================================================
   PiPDesk — shared float control.
   One file, two mount points:
     * YouTube (content/youtube.js) puts the button inside the player bar and
       consumes this module through window.__pipDeskFloat.
     * Every origin the user switched on in the popup gets the generic badge,
       which sits over the corner of the page's own video.

   The click has to start the picture-in-picture request here, in the page: a
   request that travels through the service worker arrives without the user
   activation Chrome wants and comes back as NotAllowedError.

   Colours are rgba fallbacks on purpose: this script cannot load the token
   stylesheet, and it has to read on any site.
   ========================================================================== */

(() => {
  "use strict";

  if (window.__pipDeskFloat) return;

  const BUTTON_ID = "pipdesk-quick-pip";
  const MENU_ID = "pipdesk-quick-menu";
  const TOAST_ID = "pipdesk-quick-toast";
  const BADGE_ID = "pipdesk-float-badge";

  const ICON = [
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">',
    '<rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" ',
    'stroke="currentColor" stroke-width="1.7"/>',
    '<rect x="11.5" y="11" width="7" height="5" rx="1.1" fill="currentColor"/>',
    "</svg>",
  ].join("");

  const BUTTON_STYLE = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "width:48px",
    "height:100%",
    "padding:0",
    "border:0",
    "background:none",
    "color:#fff",
    "cursor:pointer",
    "vertical-align:top",
  ].join(";");

  const BADGE_STYLE = [
    "position:fixed",
    "z-index:2147483646",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "width:36px",
    "height:36px",
    "padding:0",
    "border:1px solid rgba(255,255,255,.28)",
    "border-radius:10px",
    "background:rgba(16,18,24,.82)",
    "color:#f4f6fb",
    "cursor:pointer",
    "box-shadow:0 4px 14px rgba(0,0,0,.35)",
    "opacity:0",
    "transition:opacity 160ms ease",
  ].join(";");

  const MENU_STYLE = [
    "position:fixed",
    "z-index:2147483647",
    "min-width:190px",
    "padding:6px",
    "border-radius:12px",
    "border:1px solid rgba(255,255,255,.14)",
    "background:rgba(24,26,32,.97)",
    "color:#f2f4f8",
    "font:500 13px/1.4 system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.45)",
  ].join(";");

  const TOAST_STYLE = [
    "position:fixed",
    "left:50%",
    "bottom:96px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "padding:8px 14px",
    "border-radius:999px",
    "background:rgba(15,15,15,.92)",
    "color:#f1f1f1",
    "font:500 13px/1.4 system-ui,sans-serif",
    "opacity:0",
    "transition:opacity 160ms ease",
    "pointer-events:none",
  ].join(";");

  const YOUTUBE_HOST = /(^|\.)youtube\.com$/;

  /* --- page helpers --------------------------------------------------- */

  /** The biggest usable video on the page — the player, not a preview. */
  function mainVideo() {
    let best = null;
    for (const video of document.querySelectorAll("video")) {
      if (video.disablePictureInPicture) continue;
      const bounds = video.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) continue;
      const area = bounds.width * bounds.height;
      if (!best || area > best.area) best = { video, area };
    }
    return best ? best.video : null;
  }

  function send(message) {
    chrome.runtime.sendMessage(message).catch(() => {
      /* the extension was reloaded while this page stayed open */
    });
  }

  let toastTimer = null;
  function toast(message) {
    let node = document.getElementById(TOAST_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = TOAST_ID;
      node.setAttribute("role", "status");
      node.setAttribute("style", TOAST_STYLE);
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.style.opacity = "0";
    }, 2400);
  }

  /* --- the float itself ----------------------------------------------- */

  async function startPip() {
    const video = mainVideo();
    if (!video) {
      toast("No video to float on this page.");
      return;
    }
    try {
      await video.requestPictureInPicture();
    } catch (error) {
      toast(`PiPDesk could not float this video (${error?.name || "error"}).`);
    }
  }

  /* --- the actions menu ----------------------------------------------- */

  const ACTIONS = [
    { label: "Float this video", run: startPip },
    { label: "Float this tab", run: () => send({ type: "start-full-pip" }) },
    { label: "Float a region", run: () => send({ type: "start-region" }) },
    { label: "Stop PiP", run: () => send({ type: "stop-pip" }) },
  ];

  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onMenuKey, true);
  }

  function onOutside(event) {
    if (!event.target.closest(`#${MENU_ID}`)) closeMenu();
  }

  function onMenuKey(event) {
    if (event.key === "Escape") closeMenu();
  }

  function openMenu(x, y) {
    closeMenu();

    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.setAttribute("role", "menu");
    menu.setAttribute("style", MENU_STYLE);

    for (const action of ACTIONS) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = action.label;
      item.setAttribute(
        "style",
        [
          "display:block",
          "width:100%",
          "padding:8px 10px",
          "border:0",
          "border-radius:8px",
          "background:none",
          "color:inherit",
          "text-align:left",
          "cursor:pointer",
        ].join(";"),
      );
      item.addEventListener("pointerenter", () => {
        item.style.background = "rgba(255,255,255,.1)";
      });
      item.addEventListener("pointerleave", () => {
        item.style.background = "none";
      });
      item.addEventListener("click", () => {
        closeMenu();
        action.run();
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    // Keep the menu inside the window, next to the control that opened it.
    const bounds = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - bounds.width - 8);
    const top = Math.min(y, window.innerHeight - bounds.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onMenuKey, true);
  }

  /* --- shared button state -------------------------------------------- */

  function syncState() {
    const floating = document.pictureInPictureElement !== null;
    for (const id of [BUTTON_ID, BADGE_ID]) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.setAttribute("aria-pressed", String(floating));
      if (id === BUTTON_ID) node.style.opacity = floating ? "0.6" : "";
    }
  }

  function wireButton(button) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPip();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY);
    });
    return button;
  }

  /** The control that goes inside a player bar. */
  function buildControl() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.title = "PiPDesk: float this video";
    button.setAttribute("aria-label", "PiPDesk: float this video");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("style", BUTTON_STYLE);
    button.innerHTML = ICON;
    return wireButton(button);
  }

  /* --- generic badge, for sites the user switched on ------------------- */

  let hideTimer = null;

  function placeBadge() {
    const badge = document.getElementById(BADGE_ID);
    if (!badge || badge.style.display === "none") return;
    const video = mainVideo();
    if (!video) {
      hideBadge();
      return;
    }
    const bounds = video.getBoundingClientRect();
    badge.style.left = `${Math.max(8, bounds.right - 46)}px`;
    badge.style.top = `${Math.max(8, bounds.top + 10)}px`;
  }

  function showBadge() {
    const badge = document.getElementById(BADGE_ID);
    if (!badge) return;
    clearTimeout(hideTimer);
    badge.style.display = "flex";
    placeBadge();
    // Let the display change land before fading the badge in.
    requestAnimationFrame(() => {
      badge.style.opacity = "1";
    });
  }

  function hideBadge() {
    const badge = document.getElementById(BADGE_ID);
    if (!badge) return;
    badge.style.opacity = "0";
    hideTimer = setTimeout(() => {
      badge.style.display = "none";
    }, 200);
  }

  function mountBadge() {
    if (document.getElementById(BADGE_ID)) return;

    const badge = document.createElement("button");
    badge.id = BADGE_ID;
    badge.type = "button";
    badge.title = "PiPDesk: float this video";
    badge.setAttribute("aria-label", "PiPDesk: float this video");
    badge.setAttribute("style", BADGE_STYLE);
    badge.innerHTML = ICON;
    wireButton(badge);
    document.body.appendChild(badge);

    // The badge follows the page's own video: show it while the pointer is
    // over that video, and let it fade shortly after the pointer leaves.
    document.addEventListener(
      "pointerover",
      (event) => {
        if (event.target instanceof HTMLVideoElement) showBadge();
      },
      true,
    );
    document.addEventListener(
      "pointerout",
      (event) => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        const badge2 = document.getElementById(BADGE_ID);
        if (badge2?.matches(":hover")) return;
        hideTimer = setTimeout(hideBadge, 2000);
      },
      true,
    );
    window.addEventListener("scroll", placeBadge, true);
    window.addEventListener("resize", placeBadge);
  }

  /* --- public surface -------------------------------------------------- */

  window.__pipDeskFloat = {
    BUTTON_ID,
    mainVideo,
    send,
    toast,
    startPip,
    openMenu,
    syncState,
    buildControl,
    wireButton,
  };

  document.addEventListener("enterpictureinpicture", syncState, true);
  document.addEventListener("leavepictureinpicture", syncState, true);

  // YouTube gets the control in its player bar instead of the badge.
  if (YOUTUBE_HOST.test(location.hostname)) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBadge, { once: true });
  } else {
    mountBadge();
  }
})();
