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
  const FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  let ui = null;
  let rect = null;

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
      `position:fixed;inset:0;z-index:2147483647;cursor:crosshair;font-family:${FONT_STACK}`,
    );

    const hole = document.createElement("div");
    hole.setAttribute(
      "style",
      `position:absolute;display:none;border:1px solid ${PALETTE.accent};border-radius:4px;box-shadow:0 0 0 100vmax ${PALETTE.scrim};pointer-events:none`,
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
        "position:absolute",
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

    host.append(hole, hint, bar);
    document.documentElement.appendChild(host);

    return { host, hole, hint, bar, size, accept, cancel };
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

  function onPointerDown(event) {
    if (!ui || event.button !== 0) return;
    const point = pointFrom(event);
    rect = { x: point.x, y: point.y, width: 0, height: 0 };
    ui.start = point;
    ui.host.setPointerCapture(event.pointerId);
    paint();
  }

  function onPointerMove(event) {
    if (!ui || !ui.start) return;
    const point = pointFrom(event);
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
  }

  function sendSelection() {
    if (!rect || rect.width < MIN_SIDE || rect.height < MIN_SIDE) return;
    chrome.runtime.sendMessage({
      type: "region-selected",
      rect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    teardown();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      chrome.runtime
        .sendMessage({ type: "selection-cancelled" })
        .catch(() => {});
      teardown();
    }
    if (event.key === "Enter") sendSelection();
  }

  function clearSelection() {
    if (!ui) return;
    ui.host.removeEventListener("pointerdown", onPointerDown);
    ui.host.removeEventListener("pointermove", onPointerMove);
    ui.host.removeEventListener("pointerup", onPointerUp);
    ui.accept.removeEventListener("click", sendSelection);
    ui.cancel.removeEventListener("click", teardown);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", teardown);
    ui.host.remove();
    ui = null;
    rect = null;
  }

  function teardown() {
    clearSelection();
  }

  function startSelection() {
    if (ui) clearSelection();

    ui = buildUi();
    ui.accept.addEventListener("click", sendSelection);
    ui.cancel.addEventListener("click", teardown);
    ui.host.addEventListener("pointerdown", onPointerDown);
    ui.host.addEventListener("pointermove", onPointerMove);
    ui.host.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", teardown);
    return { ok: true };
  }

  /* --- native video PiP ---------------------------------------------- */

  function isPlayable(video) {
    if (video.disablePictureInPicture) return false;
    const source = video.currentSrc || video.src || video.querySelector("source");
    if (!source) return false;

    const bounds = video.getBoundingClientRect();
    if (bounds.width < 40 || bounds.height < 40) return false;

    const style = getComputedStyle(video);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  }

  async function startVideoPip() {
    const candidates = Array.from(document.querySelectorAll("video")).filter(
      isPlayable,
    );
    if (candidates.length === 0) {
      return { ok: false, error: "No playable video found on this page." };
    }

    for (const video of candidates) {
      try {
        if (video.paused) await video.play().catch(() => {});
        await video.requestPictureInPicture();
        return { ok: true };
      } catch (error) {
        /* try the next candidate */
      }
    }
    return { ok: false, error: "This page refused picture-in-picture." };
  }

  document.addEventListener(
    "leavepictureinpicture",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (!isPlayable(target)) {
        chrome.runtime.sendMessage({ type: "pip-exited" }).catch(() => {});
      }
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
        teardown();
        sendResponse({ ok: true });
        return false;
      case "start-video-pip":
        startVideoPip()
          .then((result) => sendResponse(result))
          .catch((error) =>
            sendResponse({ ok: false, error: String(error?.message || error) }),
          );
        return true;
      default:
        sendResponse({ ok: false, error: `Unsupported: ${message?.type}` });
        return false;
    }
  });
}
