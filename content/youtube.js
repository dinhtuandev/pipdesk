/* ==========================================================================
   PiPDesk — Quick PiP control for YouTube.
   Adds one button to the player's right-hand control bar. A click floats the
   video straight away, without opening the popup; a right click opens the
   PiPDesk actions next to the control.

   The click has to start the picture-in-picture request here, in the page: a
   request that travels through the service worker arrives without the user
   activation Chrome wants and comes back as NotAllowedError.

   Colours come from YouTube's own spec variables (with rgba fallbacks), so
   the control follows whatever theme the page is using.
   ========================================================================== */

(() => {
  "use strict";

  if (window.__pipDeskYouTubeControl) return;
  window.__pipDeskYouTubeControl = true;

  const BUTTON_ID = "pipdesk-quick-pip";
  const MENU_ID = "pipdesk-quick-menu";
  const TOAST_ID = "pipdesk-quick-toast";
  const CONTROLS = ".ytp-right-controls";

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

  const MENU_STYLE = [
    "position:fixed",
    "z-index:2147483647",
    "min-width:190px",
    "padding:6px",
    "border-radius:12px",
    "border:1px solid var(--yt-spec-10-percent-layer,rgba(255,255,255,.14))",
    "background:var(--yt-spec-menu-background,rgba(28,28,28,.96))",
    "color:var(--yt-spec-text-primary,#f1f1f1)",
    "font:500 13px/1.4 Roboto,Arial,sans-serif",
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
    "font:500 13px/1.4 Roboto,Arial,sans-serif",
    "opacity:0",
    "transition:opacity 160ms ease",
    "pointer-events:none",
  ].join(";");

  /* --- helpers -------------------------------------------------------- */

  /** The player control bar, once YouTube has built it. */
  function controls() {
    return document.querySelector(CONTROLS);
  }

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
        item.style.background =
          "var(--yt-spec-10-percent-layer,rgba(255,255,255,.1))";
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

  /* --- the control ---------------------------------------------------- */

  function syncState() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    const floating = document.pictureInPictureElement !== null;
    button.setAttribute("aria-pressed", String(floating));
    button.style.opacity = floating ? "0.6" : "";
  }

  function buildButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "ytp-button";
    button.title = "PiPDesk: float this video";
    button.setAttribute("aria-label", "PiPDesk: float this video");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("style", BUTTON_STYLE);
    button.innerHTML = ICON;

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

  function mount() {
    const bar = controls();
    if (!bar || document.getElementById(BUTTON_ID)) return;
    bar.insertBefore(buildButton(), bar.firstChild);
    syncState();
  }

  /* --- keeping it mounted across YouTube's own navigation ------------- */

  let pending = false;
  function scheduleMount() {
    if (pending || document.getElementById(BUTTON_ID)) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      mount();
    }, 250);
  }

  document.addEventListener("yt-navigate-finish", mount);
  document.addEventListener("enterpictureinpicture", syncState, true);
  document.addEventListener("leavepictureinpicture", syncState, true);

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
