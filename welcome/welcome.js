/* ==========================================================================
   PiPDesk — interactive tour.
   The split preview calls offscreen/layout.js, the same maths the compositor
   uses, so the tour cannot drift from the real window. The region preview
   clones the sample page and crops it the way the canvas crop does.
   ========================================================================== */

(() => {
  "use strict";

  const layout = globalThis.__pipDeskLayout;
  if (!layout) return;

  /* --- one canvas, up to four sources --------------------------------- */

  const SOURCES = [
    { name: "Docs tab", accent: "var(--accent)" },
    { name: "Chart region", accent: "var(--mint)" },
    { name: "Dashboard", accent: "var(--warning)" },
    { name: "Player", accent: "var(--danger)" },
  ];

  const feed = document.getElementById("feed");
  const frame = document.getElementById("frame");
  const picker = document.getElementById("count-picker");
  const focusToggle = document.getElementById("focus-toggle");
  const workspaceToggle = document.getElementById("workspace-toggle");
  const layoutNote = document.getElementById("layout-note");
  const rateNote = document.getElementById("rate-note");

  const state = { count: 2, focused: false, workspace: false };
  const countButtons = [];

  const percent = (value, total) => `${(value / total) * 100}%`;

  function buildTile(slot, index) {
    const source = SOURCES[index % SOURCES.length];

    const tile = document.createElement("div");
    tile.className = "tile";
    tile.style.setProperty("--tile-accent", source.accent);
    tile.style.left = percent(slot.x, layout.FULL_WIDTH);
    tile.style.top = percent(slot.y, layout.FULL_HEIGHT);
    tile.style.width = percent(slot.width, layout.FULL_WIDTH);
    tile.style.height = percent(slot.height, layout.FULL_HEIGHT);

    const bar = document.createElement("div");
    bar.className = "tile__bar";
    const dot = document.createElement("span");
    dot.className = "tile__dot";
    const name = document.createElement("span");
    name.className = "tile__name";
    name.textContent = source.name;
    bar.append(dot, name);

    const body = document.createElement("div");
    body.className = "tile__body";
    const block = document.createElement("div");
    block.className = "tile__block";
    const line = document.createElement("div");
    line.className = "tile__line";
    const shortLine = document.createElement("div");
    shortLine.className = "tile__line tile__line--short";
    body.append(block, line, shortLine);

    tile.append(bar, body);
    return tile;
  }

  function renderStage() {
    const shown = state.focused ? 1 : state.count;
    const slots = layout.slots(shown, state.focused);
    feed.replaceChildren(...slots.map(buildTile));

    frame.classList.toggle("frame--workspace", state.workspace);
    workspaceToggle.setAttribute("aria-pressed", String(state.workspace));
    focusToggle.setAttribute("aria-pressed", String(state.focused));
    focusToggle.disabled = state.count < 2;

    for (const button of countButtons) {
      const count = Number(button.dataset.count);
      button.setAttribute("aria-pressed", String(count === state.count));
    }

    const parts = [];
    if (state.focused) {
      parts.push(
        `One of ${state.count} fills the canvas — the rest keep decoding behind it.`,
      );
    } else if (state.count === 1) {
      parts.push("One source fills the canvas.");
    } else {
      parts.push(`${state.count} sources share the canvas.`);
    }
    if (state.workspace) {
      parts.push("A 360 px panel sits beside it in the workspace window.");
    }
    layoutNote.textContent = parts.join(" ");

    rateNote.textContent =
      `${layout.FULL_WIDTH} × ${layout.FULL_HEIGHT} canvas · ` +
      `${layout.frameRate(state.count)} fps`;
  }

  for (let count = 1; count <= 4; count += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seg__btn";
    button.dataset.count = String(count);
    button.textContent = String(count);
    button.setAttribute("aria-label", `${count} source${count > 1 ? "s" : ""}`);
    button.addEventListener("click", () => {
      state.count = count;
      if (count < 2) state.focused = false;
      renderStage();
    });
    countButtons.push(button);
    picker.append(button);
  }

  focusToggle.addEventListener("click", () => {
    state.focused = !state.focused;
    renderStage();
  });

  workspaceToggle.addEventListener("click", () => {
    state.workspace = !state.workspace;
    renderStage();
  });

  /* --- region preview ------------------------------------------------- */

  const mock = document.getElementById("mock");
  const overlay = document.getElementById("mock-select");
  const cropTile = document.getElementById("crop-tile");
  const cropMeta = document.getElementById("crop-meta");
  const status = document.getElementById("status");

  let selection = null;
  let dragOrigin = null;

  function limit(next) {
    const width = mock.clientWidth;
    const height = mock.clientHeight;
    const x = Math.max(0, Math.min(next.x, width - 24));
    const y = Math.max(0, Math.min(next.y, height - 24));
    return {
      x,
      y,
      w: Math.max(24, Math.min(next.w, width - x)),
      h: Math.max(24, Math.min(next.h, height - y)),
    };
  }

  function defaultSelection() {
    const width = mock.clientWidth;
    const height = mock.clientHeight;
    return limit({
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.22),
      w: Math.round(width * 0.46),
      h: Math.round(height * 0.42),
    });
  }

  function pointOf(event) {
    const rect = mock.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function rectBetween(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  function paintCrop() {
    if (!selection) return;

    overlay.classList.add("is-on");
    overlay.style.left = `${selection.x}px`;
    overlay.style.top = `${selection.y}px`;
    overlay.style.width = `${selection.w}px`;
    overlay.style.height = `${selection.h}px`;

    const tileWidth = cropTile.clientWidth;
    const tileHeight = cropTile.clientHeight;
    if (!tileWidth || !tileHeight) return;

    const clone = mock.cloneNode(true);
    clone.removeAttribute("id");
    clone.removeAttribute("tabindex");
    for (const node of clone.querySelectorAll("[data-overlay]")) node.remove();
    clone.style.width = `${mock.clientWidth}px`;
    clone.style.height = `${mock.clientHeight}px`;
    clone.style.aspectRatio = "auto";
    clone.style.position = "absolute";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.cursor = "default";

    // Same letterboxing the compositor uses: fit the crop, then centre it.
    const scale = Math.min(
      tileWidth / selection.w,
      tileHeight / selection.h,
    );
    const x = (tileWidth - selection.w * scale) / 2 - selection.x * scale;
    const y = (tileHeight - selection.h * scale) / 2 - selection.y * scale;
    clone.style.transformOrigin = "0 0";
    clone.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

    cropTile.replaceChildren(clone);
    cropMeta.textContent =
      `x ${Math.round(selection.x)} · y ${Math.round(selection.y)} · ` +
      `${Math.round(selection.w)} × ${Math.round(selection.h)} px`;
  }

  mock.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragOrigin = pointOf(event);
    selection = limit({ ...dragOrigin, w: 0, h: 0 });
    mock.setPointerCapture(event.pointerId);
    paintCrop();
  });

  mock.addEventListener("pointermove", (event) => {
    if (!dragOrigin) return;
    selection = limit(rectBetween(dragOrigin, pointOf(event)));
    paintCrop();
  });

  mock.addEventListener("pointerup", (event) => {
    if (!dragOrigin) return;
    const end = pointOf(event);
    const travelled =
      Math.abs(end.x - dragOrigin.x) + Math.abs(end.y - dragOrigin.y);
    dragOrigin = null;
    mock.releasePointerCapture?.(event.pointerId);
    // A plain click, like the real overlay, takes a sensible default box.
    if (travelled < 8) selection = defaultSelection();
    paintCrop();
  });

  mock.addEventListener("keydown", (event) => {
    if (!selection) return;

    const step = event.shiftKey ? 12 : 4;
    const next = { ...selection };

    if (event.ctrlKey) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        next.w += event.key === "ArrowRight" ? step : -step;
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        next.h += event.key === "ArrowDown" ? step : -step;
      } else {
        return;
      }
    } else if (event.key === "ArrowLeft") next.x -= step;
    else if (event.key === "ArrowRight") next.x += step;
    else if (event.key === "ArrowUp") next.y -= step;
    else if (event.key === "ArrowDown") next.y += step;
    else return;

    event.preventDefault();
    selection = limit(next);
    paintCrop();
  });

  window.addEventListener("resize", () => {
    if (selection) selection = limit(selection);
    paintCrop();
  });

  /* --- live actions ---------------------------------------------------- */

  let statusTimer = null;

  function showStatus(text) {
    status.textContent = text;
    status.classList.add("is-on");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove("is-on"), 3600);
  }

  document.getElementById("open-popup").addEventListener("click", async () => {
    try {
      const popup = globalThis.chrome?.action?.openPopup;
      if (!popup) throw new Error("unavailable");
      await popup.call(chrome.action);
    } catch (error) {
      showStatus("Click the PiPDesk icon in the toolbar to open the popup.");
    }
  });

  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  if (manifest) document.getElementById("version").textContent = manifest.version;

  renderStage();
  selection = defaultSelection();
  paintCrop();
})();
