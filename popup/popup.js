/* ==========================================================================
   PiPDesk — popup controller
   Talks to the service worker and reflects capture state.
   ========================================================================== */

const els = {
  status: document.getElementById("status"),
  note: document.getElementById("note"),
  stop: document.getElementById("stop"),
  stopHint: document.getElementById("stop-hint"),
  version: document.getElementById("version"),
  sync: document.getElementById("sync"),
  full: document.getElementById("cap-full"),
  region: document.getElementById("cap-region"),
  video: document.getElementById("cap-video"),
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

const CAPTURE_BUTTONS = [els.full, els.region, els.video];

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

function render(state) {
  const live = Boolean(state?.mode);
  const selecting = Boolean(state?.selecting);

  els.status.classList.toggle("is-live", live);
  els.stop.hidden = !live;
  els.stop.disabled = !live;

  if (live) {
    els.stopHint.textContent = `${
      MODE_LABEL[state.mode] || "Something"
    } is floating`;
  }

  for (const button of CAPTURE_BUTTONS) {
    button.disabled = live;
  }

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
    if (current.ok) render(current.state);
    else button.disabled = false;
    return;
  }

  if (response.state) render(response.state);
  if (okText) setNote(okText, "ok");
  if (close) window.close();
}

function bind() {
  els.full.addEventListener("click", () =>
    run(els.full, { type: "start-full-pip" }, { close: true }),
  );

  els.region.addEventListener("click", () =>
    run(els.region, { type: "start-region" }, { close: true }),
  );

  els.video.addEventListener("click", () =>
    run(els.video, { type: "start-video-pip" }, { close: true }),
  );

  els.stop.addEventListener("click", () =>
    run(els.stop, { type: "stop-pip" }, { okText: "Stopped." }),
  );

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

/* --- lifecycle ------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target === "offscreen") return;
  if (message?.type === "state") render(message.state);
  if (message?.type === "alert") setNote(message.message, "error");
});

document.addEventListener("DOMContentLoaded", async () => {
  els.version.textContent = `v${chrome.runtime.getManifest().version}`;
  bind();
  bindSyncSwitch();
  await loadSyncSwitch();

  const response = await send({ type: "get-state" });
  if (response.ok) {
    render(response.state);
  } else {
    setNote(response.error, "error");
  }
});
