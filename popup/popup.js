/* ==========================================================================
   PiPDesk — popup controller
   Talks to the service worker and reflects capture state.
   ========================================================================== */

const els = {
  status: document.getElementById("status"),
  note: document.getElementById("note"),
  stop: document.getElementById("stop"),
  stopHint: document.getElementById("stop-hint"),
  stopAll: document.getElementById("stop-all"),
  sourceList: document.getElementById("source-list"),
  version: document.getElementById("version"),
  sync: document.getElementById("sync"),
  floatSite: document.getElementById("float-site"),
  start: document.getElementById("cap-start"),
  startTitle: document.getElementById("start-title"),
  startHint: document.getElementById("start-hint"),
  modeTab: document.getElementById("mode-tab"),
  modeVideo: document.getElementById("mode-video"),
  region: document.getElementById("cap-region"),
  useRegion: document.getElementById("use-region"),
  panels: {
    notes: document.getElementById("panel-notes"),
    todos: document.getElementById("panel-todos"),
    timer: document.getElementById("panel-timer"),
  },
};

const MODE_LABEL = {
  full: "The whole tab",
  region: "Your selected region",
  video: "The page video",
};

/** What the single capture button says in each mode. */
const MODE_COPY = {
  tab: { title: "Whole tab", hint: "Everything on the page" },
  video: { title: "Video on the page", hint: "Use the player's own PiP" },
};

let pipMode = "tab";
let modeChosen = false;
let hasVideo = false;
let live = false;
let popupPort = null;

/** Keeps the service worker awake and lets it warm the shared tab stream. */
function holdPort() {
  popupPort = chrome.runtime.connect({ name: "popup" });
  popupPort.onDisconnect.addListener(() => {
    popupPort = null;
  });
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(
        response || { ok: false, error: "The extension did not answer." },
      );
    });
  });
}

function setNote(text, kind = "") {
  els.note.textContent = text || "";
  els.note.classList.toggle("is-error", kind === "error");
  els.note.classList.toggle("is-ok", kind === "ok");
}

/** Single owner of the capture controls' disabled state. */
function applyModeAvailability() {
  els.modeTab.disabled = live;
  els.modeVideo.disabled = live || !hasVideo;
  els.start.disabled = live;
  els.region.disabled = live;
}

function setPipMode(mode) {
  pipMode = mode;
  const copy = MODE_COPY[mode] || MODE_COPY.tab;
  els.startTitle.textContent = copy.title;
  els.startHint.textContent = copy.hint;
  els.modeTab.classList.toggle("is-active", mode === "tab");
  els.modeVideo.classList.toggle("is-active", mode === "video");
  els.modeTab.setAttribute("aria-checked", String(mode === "tab"));
  els.modeVideo.setAttribute("aria-checked", String(mode === "video"));
}

/**
 * Apply what the page offers, then pick a default mode — but never override a
 * choice the user already made by hand.
 */
function updateToggleState(available) {
  hasVideo = Boolean(available);
  els.modeVideo.classList.toggle("has-video", hasVideo);
  els.modeVideo.title = hasVideo ? "" : "No video on this page";
  applyModeAvailability();

  if (!modeChosen) {
    setPipMode(hasVideo ? "video" : "tab");
    return;
  }
  if (pipMode === "video" && !hasVideo) setPipMode("tab");
}

const KIND_LABEL = { full: "Whole tab", region: "Selected region" };

function sourceLabel(source) {
  const title = String(source?.title || "").trim();
  const kind = KIND_LABEL[source?.kind] || "Floating window";
  return title ? `${title} — ${kind}` : kind;
}

/** One row per floating source: focus it, or stop it. */
function renderSources(sources) {
  els.sourceList.replaceChildren();

  for (const source of sources) {
    const row = document.createElement("div");
    row.className = "source";

    const label = document.createElement("span");
    label.className = "source__label";
    label.textContent = sourceLabel(source);

    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "source__focus";
    focus.textContent = source.focused ? "Back to grid" : "Show alone";
    focus.addEventListener("click", async () => {
      focus.disabled = true;
      await send({
        type: "focus-source",
        sourceId: source.focused ? null : source.id,
      });
      await loadState();
    });

    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "source__stop";
    stop.textContent = "Stop";
    stop.addEventListener("click", async () => {
      stop.disabled = true;
      await send({ type: "stop-pip", sourceId: source.id });
      await loadState();
    });

    row.append(label, focus, stop);
    els.sourceList.appendChild(row);
  }

  els.stopAll.hidden = sources.length < 2;
}

async function loadState() {
  const response = await send({ type: "get-state" });
  if (response.ok) render(response);
  return response;
}

function render(payload) {
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  live = sources.length > 0;
  const selecting = Boolean(payload?.selecting);

  els.status.classList.toggle("is-live", live);
  els.stop.hidden = !live;
  els.stop.disabled = !live;
  renderSources(sources);

  if (live) {
    els.stopHint.textContent =
      sources.length === 1
        ? "1 floating source"
        : `${sources.length} floating sources`;
  }

  applyModeAvailability();

  if (selecting) {
    setNote("Drag on the page to pick an area · Esc to cancel");
  }
}

async function run(button, message, { close = false, okText = "" } = {}) {
  button.disabled = true;
  setNote("Working…");

  const response = await send(message);

  if (!response.ok) {
    setNote(response.error || "That did not work.", "error");
    // Re-enable whatever the current state allows.
    const current = await send({ type: "get-state" });
    if (current.ok) render(current);
    else button.disabled = false;
    return;
  }

    if (response.state) render(response);
  if (okText) setNote(okText, "ok");
  if (close) window.close();
}

/**
 * Video PiP must be asked for by a context that still holds the click's user
 * activation — the worker has none, and Chrome answers NotAllowedError. So the
 * popup drives the tab itself and only then tells the worker what is floating.
 */
async function startVideoPipFromPopup() {
  els.start.disabled = true;
  setNote("Working…");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("No active tab to work with.");

    // Inject first: on a fresh tab this is what exposes the entry point.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/content.js"],
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__pipDeskStartVideoPip?.(),
    });
    const result = injection?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "No playable video found on this page.");
    }

    const response = await send({ type: "video-pip-started" });
    if (!response.ok) {
      throw new Error(response.error || "The extension did not answer.");
    }
    render(response);
    window.close();
  } catch (error) {
    setNote(String(error?.message || error), "error");
    const current = await send({ type: "get-state" });
    if (current.ok) render(current);
    else els.start.disabled = false;
  }
}

function bind() {
  for (const [mode, button] of [
    ["tab", els.modeTab],
    ["video", els.modeVideo],
  ]) {
    button.addEventListener("click", () => {
      modeChosen = true;
      setPipMode(mode);
    });
  }

  els.start.addEventListener("click", () => {
    if (pipMode === "video") {
      startVideoPipFromPopup();
      return;
    }
    run(els.start, { type: "start-full-pip" }, { close: true });
  });

  els.region.addEventListener("click", () =>
    run(els.region, { type: "start-region" }, { close: true }),
  );

  els.useRegion.addEventListener("click", () =>
    run(els.useRegion, { type: "start-region-again" }, { close: true }),
  );

  els.stop.addEventListener("click", () =>
    run(els.stop, { type: "stop-pip" }, { okText: "Stopped." }),
  );

  els.stopAll.addEventListener("click", async () => {
    els.stopAll.disabled = true;
    await send({ type: "stop-pip" });
    await loadState();
    els.stopAll.disabled = false;
  });

  for (const [page, button] of Object.entries(els.panels)) {
    button.addEventListener("click", () =>
      run(button, { type: "open-panel", page }, { close: true }),
    );
  }
}

/* --- cross-device sync ---------------------------------------------- */

async function loadSyncSwitch() {
  const settings = await Store.getSettings();
  els.sync.checked = Boolean(settings.syncEnabled);
}

/** Push what is already on this device into the synced copy. */
async function mirrorLocalToSync() {
  for (const key of [Store.KEYS.NOTES, Store.KEYS.TODOS, Store.KEYS.TIMER]) {
    const local = await chrome.storage.local.get(key);
    if (local[key] !== undefined) {
      await Store.write(key, local[key]);
    }
  }
}

function bindSyncSwitch() {
  els.sync.addEventListener("change", async () => {
    const enabled = els.sync.checked;
    els.sync.disabled = true;
    try {
      await Store.setSettings({ syncEnabled: enabled });
      if (enabled) {
        await mirrorLocalToSync();
        setNote("Notes, todos and timer now follow your Chrome profile.", "ok");
      } else {
        setNote("Sync off. Your data stays on this device.");
      }
    } catch (error) {
      setNote(String(error?.message || error), "error");
      els.sync.checked = !enabled;
    } finally {
      els.sync.disabled = false;
    }
  });
}

/* --- float button per site ------------------------------------------ */

let floatOrigin = null;

/** The origin of the tab this popup was opened on, or null if it has none. */
async function currentOrigin() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  if (!/^https?:\/\//.test(url)) return null;
  floatOrigin = new URL(url).origin;
  return floatOrigin;
}

async function loadFloatSwitch() {
  if (!(await currentOrigin())) {
    els.floatSite.checked = false;
    els.floatSite.disabled = true;
    return;
  }
  const status = await send({ type: "float-site-status", origin: floatOrigin });
  els.floatSite.checked = Boolean(status.ok && status.enabled);
}

/** Offer to reuse the box this site was last cut with. */
async function loadRegionButton() {
  const origin = await currentOrigin();
  if (!origin) {
    els.useRegion.hidden = true;
    return;
  }
  const settings = await Store.getSettings();
  els.useRegion.hidden = !settings.regions?.[origin];
}

function bindFloatSwitch() {
  els.floatSite.addEventListener("change", async () => {
    const wanted = els.floatSite.checked;
    if (!floatOrigin) return;

    els.floatSite.disabled = true;
    try {
      if (wanted) {
        // The request has to start here: only a popup click counts as the user
        // gesture Chrome wants before it asks about a new site.
        const granted = await chrome.permissions.request({
          origins: [`${floatOrigin}/*`],
        });
        if (!granted) {
          els.floatSite.checked = false;
          setNote("Chrome did not give access to this site.");
          return;
        }
      }

      const response = await send({
        type: "float-site-toggle",
        origin: floatOrigin,
        on: wanted,
      });
      if (!response.ok) {
        throw new Error(response.error || "That did not work.");
      }
      setNote(
        wanted
          ? "Float button on for this site. Reload the page to see it."
          : "Float button off for this site.",
        wanted ? "ok" : "",
      );
    } catch (error) {
      els.floatSite.checked = !wanted;
      setNote(String(error?.message || error), "error");
    } finally {
      els.floatSite.disabled = false;
    }
  });
}

/* --- lifecycle ------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target === "offscreen") return;
  if (message?.type === "state") render(message);
  if (message?.type === "alert") setNote(message.message, "error");
});

document.addEventListener("DOMContentLoaded", async () => {
  els.version.textContent = `v${chrome.runtime.getManifest().version}`;
  holdPort();
  bind();
  setPipMode("tab");
  bindSyncSwitch();
  await loadSyncSwitch();
  bindFloatSwitch();
  await loadFloatSwitch();
  await loadRegionButton();

  const response = await send({ type: "get-state" });
  if (response.ok) {
    render(response);
    // A capture that failed while this popup was closed reports itself here.
    if (response.error) setNote(response.error, "error");
  } else {
    setNote(response.error, "error");
  }

  const video = await send({ type: "check-video" });
  updateToggleState(Boolean(video?.hasVideo));
});
