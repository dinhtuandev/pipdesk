/* ==========================================================================
   PiPDesk — background service worker
   Owns capture state, the offscreen capture document and panel windows.
   ========================================================================== */

const OFFSCREEN_URL = "offscreen/offscreen.html";
const OFFSCREEN_TARGET = "offscreen";
const TIMER_ALARM = "focus-timer";

const PANELS = {
  notes: { file: "panels/notes.html", width: 380, height: 540 },
  todos: { file: "panels/todos.html", width: 380, height: 540 },
  timer: { file: "panels/timer.html", width: 340, height: 580 },
};

const IDLE_STATE = { capturing: false, mode: null, tabId: null, selecting: false };
let state = { ...IDLE_STATE };
let streamTabId = null;
let streamReady = null;
let lastError = "";

/** Messages that begin an action clear the previous failure reason. */
const ACTION_MESSAGES = new Set([
  "start-full-pip",
  "start-region",
  "region-selected",
  "start-video-pip",
  "video-pip-started",
  "stop-pip",
]);

/* --- small helpers -------------------------------------------------- */

function broadcast() {
  chrome.runtime.sendMessage({ type: "state", state }).catch(() => {
    /* no listener open right now */
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    throw new Error("No active tab to work with.");
  }
  return tab;
}

async function offscreenExists() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await offscreenExists()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification:
      "Capture the tab the user picked so it can be shown in a picture-in-picture window.",
  });
}

async function closeOffscreen() {
  if (!(await offscreenExists())) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch (error) {
    console.warn("[PiPDesk] could not close the offscreen document", error);
  }
}

/** Send a message to the offscreen document, creating it first if needed. */
async function toOffscreen(message, attempt = 0) {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage({
      ...message,
      target: OFFSCREEN_TARGET,
    });
  } catch (error) {
    if (attempt === 0) {
      // The document exists but may still be running its first script.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return toOffscreen(message, attempt + 1);
    }
    throw error;
  }
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    if (pong?.ok) return;
  } catch (error) {
    /* not injected in this tab yet — fall through and inject */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"],
  });
}

async function hasOffscreenDocument() {
  return offscreenExists();
}

/**
 * Open the tab stream once and share it between the capture modes. While the
 * stream for a tab is still alive every caller gets the same promise.
 */
function ensureStream(tabId) {
  if (streamTabId === tabId && streamReady) return streamReady;

  streamTabId = tabId;
  streamReady = (async () => {
    await ensureOffscreen();
    const tab = await chrome.tabs.get(tabId);
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
    const initialSize = { width: tab.width, height: tab.height };
    const result = await toOffscreen({
      type: "initialize-stream",
      streamId,
      initialSize,
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Could not start the tab stream.");
    }
    return tabId;
  })();

  streamReady.catch(() => {
    streamTabId = null;
    streamReady = null;
  });
  return streamReady;
}

/** Drop the shared stream and the offscreen document that holds it. */
async function stopTabStream() {
  streamTabId = null;
  streamReady = null;
  try {
    if (await hasOffscreenDocument()) {
      await toOffscreen({ type: "stop" });
    }
  } catch (error) {
    console.warn("[PiPDesk] offscreen stop failed", error);
  }
  await closeOffscreen();
}

/* --- capture flows -------------------------------------------------- */

async function startFullTabPip() {
  const tab = await activeTab();
  state = { capturing: true, mode: "full", tabId: tab.id, selecting: false };
  broadcast();
  try {
    await ensureStream(tab.id);
    const result = await toOffscreen({ type: "start-full-pip" });
    if (!result?.ok) throw new Error(result?.error || "PiP was refused.");
  } catch (error) {
    state = { ...IDLE_STATE };
    broadcast();
    throw error;
  }
  return { ok: true, state };
}

async function startRegionSelection() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  state = { capturing: false, mode: "region", tabId: tab.id, selecting: true };
  broadcast();
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "select-region",
  });
  if (!response?.ok) {
    state = { ...IDLE_STATE };
    broadcast();
    throw new Error(response?.error || "Could not start region selection.");
  }
  return { ok: true, state };
}

async function beginRegionCapture({ rect, viewport }, sender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) throw new Error("Lost track of the source tab.");

  state = { capturing: true, mode: "region", tabId, selecting: false };
  broadcast();
  try {
    await ensureStream(tabId);
    const result = await toOffscreen({
      type: "start-custom-pip",
      rect,
      viewport,
    });
    if (!result?.ok) throw new Error(result?.error || "PiP was refused.");
  } catch (error) {
    state = { ...IDLE_STATE };
    broadcast();
    throw error;
  }
  return { ok: true, state };
}

async function startVideoPip() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "start-video-pip",
  });
  if (!response?.ok) {
    throw new Error(response?.error || "No playable video found on this page.");
  }
  return enterVideoState(tab.id);
}

/** Both video paths end here: the page owns that picture-in-picture window. */
async function enterVideoState(tabId) {
  // A page-owned window needs no tab stream, so release it.
  await stopTabStream();
  state = { capturing: false, mode: "video", tabId, selecting: false };
  broadcast();
  return { ok: true, state };
}

/** The popup already opened the page's own window: just record and clean up. */
async function markVideoPipStarted() {
  const tab = await activeTab();
  return enterVideoState(tab.id);
}

/** Ask the tab whether it holds a video the browser could float. */
async function checkVideo() {
  try {
    const tab = await activeTab();
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "check-for-videos",
    });
    return { ok: true, hasVideo: Boolean(response?.hasVideo) };
  } catch (error) {
    // A page that refuses the content script simply has nothing to offer.
    console.warn("[PiPDesk] video check skipped", error);
    return { ok: true, hasVideo: false };
  }
}

async function cancelRegionSelection() {
  // A cancel that arrives after the capture started must not end the session.
  if (state.capturing) return { ok: true, state };

  if (state.tabId !== null) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "cancel-selection" });
    } catch (error) {
      /* tab closed or never injected */
    }
  }
  state = { ...IDLE_STATE };
  broadcast();
  return { ok: true, state };
}

async function stopPip() {
  await stopTabStream();

  if (state.tabId !== null) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "teardown" });
    } catch (error) {
      /* nothing listening any more */
    }
  }

  state = { ...IDLE_STATE };
  broadcast();
  return { ok: true, state };
}

/* --- panels --------------------------------------------------------- */

/**
 * Runs inside the page. Kept free of outer references because
 * chrome.scripting stringifies it; injection keeps the user gesture that
 * document Picture-in-Picture requires.
 */
async function requestPanelWindow({ url, width, height }) {
  if (!window.documentPictureInPicture) {
    return { ok: false, error: "Document Picture-in-Picture is unavailable." };
  }
  const pipWindow = await window.documentPictureInPicture.requestWindow({
    width,
    height,
  });
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.setAttribute(
    "style",
    "width:100%;height:100%;border:0;display:block;background:#0d1017",
  );
  pipWindow.document.documentElement.setAttribute("style", "height:100%");
  pipWindow.document.body.setAttribute(
    "style",
    "margin:0;height:100%;overflow:hidden;background:#0d1017",
  );
  pipWindow.document.body.appendChild(frame);
  return { ok: true };
}

async function openPanel(page) {
  const panel = PANELS[page];
  if (!panel) throw new Error(`Unknown panel: ${page}`);

  const url = chrome.runtime.getURL(panel.file);
  const tab = await activeTab();

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: requestPanelWindow,
      args: [{ url, width: panel.width, height: panel.height }],
    });
    if (result?.result?.ok) {
      return { ok: true, how: "document-pip" };
    }
    console.warn("[PiPDesk] document PiP refused:", result?.result?.error);
  } catch (error) {
    console.warn("[PiPDesk] panel injection failed", error);
  }

  const win = await chrome.windows.create({
    url,
    type: "popup",
    width: panel.width,
    height: panel.height,
    focused: true,
  });
  return { ok: true, how: "window", windowId: win.id };
}

/* --- message routing ------------------------------------------------ */

async function handle(message, sender) {
  if (ACTION_MESSAGES.has(message?.type)) lastError = "";

  switch (message?.type) {
    case "get-state":
      return { ok: true, state, error: lastError };

    case "start-full-pip":
      return startFullTabPip();

    case "start-region":
      return startRegionSelection();

    case "region-selected":
      return beginRegionCapture(message, sender);

    case "selection-cancelled":
      return cancelRegionSelection();

    case "start-video-pip":
      return startVideoPip();

    case "video-pip-started":
      return markVideoPipStarted();

    case "check-video":
      return checkVideo();

    case "stop-pip":
      return stopPip();

    case "open-panel":
      return openPanel(message.page);

    case "pip-exited":
      state = { ...IDLE_STATE };
      await stopTabStream();
      broadcast();
      return { ok: true, state };

    case "offscreen-error":
      console.error("[PiPDesk] offscreen:", message.message);
      lastError = message.message;
      state = { ...IDLE_STATE };
      await stopTabStream();
      broadcast();
      chrome.runtime
        .sendMessage({ type: "alert", message: message.message })
        .catch(() => {});
      return { ok: false, error: message.message };

    default:
      return { ok: false, error: `Unsupported message: ${message?.type}` };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === OFFSCREEN_TARGET) return false;

  const pending = handle(message, sender);
  if (!pending) return false;

  pending
    .then((result) => sendResponse(result))
    .catch((error) => {
      const text = String(error?.message || error);
      lastError = text;
      console.error("[PiPDesk]", error);
      sendResponse({ ok: false, error: text });
    });
  return true;
});

/* --- lifecycle ------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({ settings: { syncEnabled: false } });
  }
});

/* --- page context menu ---------------------------------------------- */

const MENU_ROOT = "pipdesk-menu";

/**
 * The Chrome menu gets the actions that do not need the page's own click:
 * "float this video" only exists on the YouTube control, because a page-side
 * picture-in-picture request would arrive here without user activation.
 */
function buildContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ROOT,
      title: "PiPDesk",
      contexts: ["page", "frame", "video"],
    });
    for (const [id, title] of [
      ["pipdesk-float-tab", "Float this tab"],
      ["pipdesk-float-region", "Float a region"],
      ["pipdesk-stop", "Stop PiP"],
    ]) {
      chrome.contextMenus.create({
        id,
        parentId: MENU_ROOT,
        title,
        contexts: ["page", "frame", "video"],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(buildContextMenu);
chrome.runtime.onStartup.addListener(buildContextMenu);

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === "pipdesk-float-tab") await startFullTabPip();
    if (info.menuItemId === "pipdesk-float-region") await startRegionSelection();
    if (info.menuItemId === "pipdesk-stop") await stopPip();
  } catch (error) {
    lastError = String(error?.message || error);
    console.error("[PiPDesk] context menu", error);
  }
});

/**
 * The popup holds a port open, which keeps the worker alive for the session
 * and gives us the moment to prepare the tab stream before a capture mode is
 * picked. Closing the popup with nothing floating releases it again.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;

  activeTab()
    .then((tab) => ensureStream(tab.id))
    .catch((error) => {
      // A page that refuses capture must not break the popup: the capture
      // buttons ask for the stream again and report the real error.
      console.warn("[PiPDesk] stream warm-up skipped", error);
    });

  port.onDisconnect.addListener(() => {
    // A capture window or a running selection must survive the popup closing.
    if (state.capturing || state.selecting) return;
    // The page owns its own video window, so keep reporting it as floating.
    if (state.mode !== "video") {
      state = { ...IDLE_STATE };
      broadcast();
    }
    stopTabStream();
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;

  const { timer } = await chrome.storage.local.get("timer");
  const finishedBreak = timer?.mode !== "work";

  await chrome.notifications.create(TIMER_ALARM, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: finishedBreak ? "Break over" : "Focus session complete",
    message: finishedBreak
      ? "Ready to get back to it?"
      : "Nice work. Time for a break.",
    priority: 2,
  });

  await chrome.storage.local.remove("timerEndsAt");
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === TIMER_ALARM) {
    chrome.notifications.clear(TIMER_ALARM);
  }
});
