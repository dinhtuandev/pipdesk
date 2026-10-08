/* ==========================================================================
   PiPDesk — content script
   Region selection overlay and native video picture-in-picture.
   Injected on demand by the service worker, never declared in the manifest.
   ========================================================================== */

if (!window.__pipDeskContentScript) {
  window.__pipDeskContentScript = true;

  const OVERLAY_ID = "pipdesk-selection";
  const PALETTE = {
    accent: "#7c5cff",
    accentText: "#ffffff",
    surface: "#161a23",
    border: "#2a3140",
    text: "#e9edf5",
    dim: "#9aa5b8",
    scrim: "rgba(9,11,16,.64)",
  };
  const MIN_SIDE = 24;
  /* The overlay covers the page, so the action bar needs a higher stack level
     or the overlay swallows the presses meant for its buttons. */
  const OVERLAY_Z = 2147483646;
  const BAR_Z = 2147483647;
  const FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  let ui = null;
  let rect = null;
  let hoverRect = null;

  /* --- selection overlay -------------------------------------------- */

  function button(label, primary) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.setAttribute(
      "style",
      [
        "padding:6px 12px",
        "border-radius:6px",
        `font:600 12px/1 ${FONT_STACK}`,
        "cursor:pointer",
        primary
          ? `background:${PALETTE.accent};border:1px solid ${PALETTE.accent};color:${PALETTE.accentText}`
          : `background:transparent;border:1px solid ${PALETTE.border};color:${PALETTE.dim}`,
      ].join(";"),
    );
    return node;
  }

  function buildUi() {
    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.setAttribute(
      "style",
      `position:fixed;inset:0;z-index:${OVERLAY_Z};cursor:crosshair;font-family:${FONT_STACK}`,
    );

    const hole = document.createElement("div");
    hole.setAttribute(
      "style",
      `position:absolute;display:none;border:1px solid ${PALETTE.accent};border-radius:4px;box-shadow:0 0 0 100vmax ${PALETTE.scrim};pointer-events:none`,
    );

    const hover = document.createElement("div");
    hover.setAttribute(
      "style",
      `position:absolute;display:none;border:1px dashed ${PALETTE.accent};border-radius:4px;pointer-events:none`,
    );

    const hint = document.createElement("div");
    hint.setAttribute(
      "style",
      [
        "position:absolute",
        "top:16px",
        "left:50%",
        "transform:translateX(-50%)",
        "padding:6px 12px",
        "border-radius:999px",
        `background:${PALETTE.surface}`,
        `border:1px solid ${PALETTE.border}`,
        `color:${PALETTE.dim}`,
        "font-size:12px",
        "pointer-events:none",
      ].join(";"),
    );
    hint.textContent = "Drag to select an area · Esc to cancel";

    const bar = document.createElement("div");
    bar.setAttribute(
      "style",
      [
        "position:fixed",
        `z-index:${BAR_Z}`,
        "display:none",
        "align-items:center",
        "gap:8px",
        "padding:6px",
        "border-radius:10px",
        `background:${PALETTE.surface}`,
        `border:1px solid ${PALETTE.border}`,
        "box-shadow:0 6px 20px rgba(0,0,0,.45)",
      ].join(";"),
    );

    const size = document.createElement("span");
    size.setAttribute(
      "style",
      `color:${PALETTE.dim};font-size:12px;padding-left:6px`,
    );

    const accept = button("Show in PiP", true);
    const cancel = button("Cancel", false);
    bar.append(size, accept, cancel);

    // The action bar sits beside the overlay, not inside it: a press on a
    // button must never be read as the start of a new selection. It also has
    // to paint above the overlay, or the overlay swallows the click.
    host.append(hole, hover, hint);
    document.documentElement.append(host, bar);

    return { host, hole, hover, hint, bar, size, accept, cancel };
  }

  function paint() {
    if (!ui || !rect) return;
    const { hole, bar } = ui;
    hole.style.display = "block";
    hole.style.left = `${rect.x}px`;
    hole.style.top = `${rect.y}px`;
    hole.style.width = `${rect.width}px`;
    hole.style.height = `${rect.height}px`;

    if (rect.width >= MIN_SIDE && rect.height >= MIN_SIDE) {
      ui.size.textContent = `${Math.round(rect.width)} × ${Math.round(
        rect.height,
      )}`;
      ui.bar.style.display = "flex";
      ui.hint.style.display = "none";
      const barTop = Math.min(
        window.innerHeight - 48,
        rect.y + rect.height + 10,
      );
      ui.bar.style.left = `${Math.min(
        Math.max(8, rect.x),
        Math.max(8, window.innerWidth - 220),
      )}px`;
      ui.bar.style.top = `${Math.max(8, barTop)}px`;
    } else {
      ui.bar.style.display = "none";
      ui.hint.style.display = "block";
    }
  }

  function pointFrom(event) {
    return {
      x: Math.min(Math.max(0, event.clientX), window.innerWidth),
      y: Math.min(Math.max(0, event.clientY), window.innerHeight),
    };
  }

  /**
   * The page element under a point. The overlay covers the whole page, so it
   * has to step out of hit testing for the instant it asks what is below.
   */
  function elementAt(point) {
    ui.host.style.pointerEvents = "none";
    const node = document.elementFromPoint(point.x, point.y);
    ui.host.style.pointerEvents = "";
    if (!node || node === document.body || node === document.documentElement) {
      return null;
    }
    if (node.closest(`#${OVERLAY_ID}`) || ui.bar.contains(node)) return null;
    return node;
  }

  /** Outline the box a click would take. */
  function paintHover(node) {
    if (!ui) return;

    if (!node) {
      ui.hover.style.display = "none";
      hoverRect = null;
      return;
    }

    const bounds = node.getBoundingClientRect();
    const width = Math.min(bounds.width, window.innerWidth);
    const height = Math.min(bounds.height, window.innerHeight);
    if (width < 1 || height < 1) {
      ui.hover.style.display = "none";
      hoverRect = null;
      return;
    }

    hoverRect = {
      x: Math.round(Math.max(0, bounds.left)),
      y: Math.round(Math.max(0, bounds.top)),
      width: Math.round(width),
      height: Math.round(height),
    };
    ui.hover.style.display = "block";
    ui.hover.style.left = `${hoverRect.x}px`;
    ui.hover.style.top = `${hoverRect.y}px`;
    ui.hover.style.width = `${hoverRect.width}px`;
    ui.hover.style.height = `${hoverRect.height}px`;
  }

  function onPointerDown(event) {
    if (!ui || event.button !== 0) return;
    if (ui.bar.contains(event.target)) return;
    const point = pointFrom(event);
    rect = { x: point.x, y: point.y, width: 0, height: 0 };
    ui.start = point;
    ui.hover.style.display = "none";
    ui.host.setPointerCapture(event.pointerId);
    paint();
  }

  function onPointerMove(event) {
    if (!ui) return;
    const point = pointFrom(event);

    if (!ui.start) {
      // Element picking: outline the box a click would take.
      paintHover(elementAt(point));
      return;
    }

    rect = {
      x: Math.min(ui.start.x, point.x),
      y: Math.min(ui.start.y, point.y),
      width: Math.abs(point.x - ui.start.x),
      height: Math.abs(point.y - ui.start.y),
    };
    paint();
  }

  function onPointerUp(event) {
    if (!ui || !ui.start) return;
    ui.start = null;
    ui.host.releasePointerCapture?.(event.pointerId);

    // A click rather than a drag: take the element that was outlined instead
    // of leaving behind a rectangle too small to use.
    const dragged = rect;
    const tooSmall =
      !dragged || dragged.width < MIN_SIDE || dragged.height < MIN_SIDE;
    if (tooSmall && hoverRect) rect = { ...hoverRect };
    paint();
  }

  function sendSelection() {
    if (!rect || rect.width < MIN_SIDE || rect.height < MIN_SIDE) return;
    chrome.runtime
      .sendMessage({
        type: "region-selected",
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
      .catch(() => {});
    teardown("commit");
  }

  /** Arrow keys move the pending rectangle; Ctrl with the arrows resizes it. */
  function nudgeRect(event) {
    if (!ui || !rect) return false;

    const step = event.shiftKey ? 10 : 1;
    const key = event.key;
    const next = { ...rect };

    if (event.ctrlKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      next.width += key === "ArrowRight" ? step : -step;
    } else if (event.ctrlKey && (key === "ArrowUp" || key === "ArrowDown")) {
      next.height += key === "ArrowDown" ? step : -step;
    } else if (key === "ArrowLeft") {
      next.x -= step;
    } else if (key === "ArrowRight") {
      next.x += step;
    } else if (key === "ArrowUp") {
      next.y -= step;
    } else if (key === "ArrowDown") {
      next.y += step;
    } else {
      return false;
    }

    next.width = Math.max(MIN_SIDE, next.width);
    next.height = Math.max(MIN_SIDE, next.height);
    next.x = Math.min(
      Math.max(0, next.x),
      Math.max(0, window.innerWidth - next.width),
    );
    next.y = Math.min(
      Math.max(0, next.y),
      Math.max(0, window.innerHeight - next.height),
    );

    rect = next;
    paint();
    return true;
  }

  function onKeyDown(event) {
    if (nudgeRect(event)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      teardown("cancel");
    }
    if (event.key === "Enter") sendSelection();
  }

  function cancelSelection() {
    teardown("cancel");
  }

  function clearSelection() {
    if (!ui) return;
    ui.host.removeEventListener("pointerdown", onPointerDown);
    ui.host.removeEventListener("pointermove", onPointerMove);
    ui.host.removeEventListener("pointerup", onPointerUp);
    ui.accept.removeEventListener("click", sendSelection);
    ui.cancel.removeEventListener("click", cancelSelection);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    ui.host.remove();
    ui.bar.remove();
    ui = null;
    rect = null;
    hoverRect = null;
  }

  /**
   * The single exit for the overlay. "commit" has already told the service
   * worker about the rectangle; every other reason cancels the pending
   * selection so the worker is never left waiting for one.
   */
  function teardown(reason) {
    clearSelection();
    if (reason === "commit") return;
    chrome.runtime.sendMessage({ type: "selection-cancelled" }).catch(() => {});
  }

  function onViewportChange() {
    teardown("cancel");
  }

  function startSelection() {
    if (ui) clearSelection();

    ui = buildUi();
    ui.accept.addEventListener("click", sendSelection);
    ui.cancel.addEventListener("click", cancelSelection);
    ui.host.addEventListener("pointerdown", onPointerDown);
    ui.host.addEventListener("pointermove", onPointerMove);
    ui.host.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    return { ok: true };
  }

  /* --- native video PiP ---------------------------------------------- */

  /* The same eligibility test the 1.1.0 source uses: a source, a real size and
     nothing hiding it. Nothing else — a player like YouTube's sits in states a
     stricter test rejects while the video itself would float fine. */
  function isPlayable(video) {
    const source =
      video.src || video.querySelector("source")?.src || video.currentSrc;
    if (!source) return false;

    const bounds = video.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;

    const style = getComputedStyle(video);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  async function startVideoPip() {
    let attempted = false;
    let firstError = null;

    for (const video of document.querySelectorAll("video")) {
      if (!isPlayable(video)) continue;
      attempted = true;

      try {
        if (video.paused) await video.play().catch(() => {});
        await video.requestPictureInPicture();
        return { ok: true };
      } catch (error) {
        if (!firstError) firstError = error;
        /* The loop swallows this, so say it out loud: without the reason the
           popup can only report "refused" with no idea why. */
        console.warn("[PiPDesk] video PiP refused", {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          paused: video.paused,
          muted: video.muted,
          disabled: video.disablePictureInPicture,
          source: String(video.currentSrc || video.src || "").slice(0, 64),
          error: `${error?.name}: ${error?.message}`,
          pictureInPictureEnabled: document.pictureInPictureEnabled,
          pictureInPictureBusy: document.pictureInPictureElement !== null,
        });
      }
    }

    if (!attempted) {
      return { ok: false, error: "No playable video found on this page." };
    }
    return {
      ok: false,
      error: `This page refused picture-in-picture. (${
        firstError?.name || "unknown"
      })`,
    };
  }

  /** True while the page holds at least one video the browser could float. */
  function hasPlayableVideo() {
    return Array.from(document.querySelectorAll("video")).some(isPlayable);
  }

  document.addEventListener(
    "leavepictureinpicture",
    (event) => {
      if (!(event.target instanceof HTMLVideoElement)) return;
      chrome.runtime.sendMessage({ type: "pip-exited" }).catch(() => {});
    },
    true,
  );

  /* --- messaging ----------------------------------------------------- */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.type) {
      case "ping":
        sendResponse({ ok: true });
        return false;
      case "select-region":
        sendResponse(startSelection());
        return false;
      case "cancel-selection":
      case "teardown":
        clearSelection();
        sendResponse({ ok: true });
        return false;
      case "start-video-pip":
        startVideoPip()
          .then((result) => sendResponse(result))
          .catch((error) =>
            sendResponse({ ok: false, error: String(error?.message || error) }),
          );
        return true;
      case "check-for-videos":
        sendResponse({ ok: true, hasVideo: hasPlayableVideo() });
        return false;
      default:
        sendResponse({ ok: false, error: `Unsupported: ${message?.type}` });
        return false;
    }
  });

  /* The popup drives video PiP through chrome.scripting.executeScript, so this
     entry point has to be reachable from the isolated world. */
  window.__pipDeskStartVideoPip = () => startVideoPip();
}
