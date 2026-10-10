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

/** The floating sources live in the offscreen document; the worker only tracks
    the running selection and the last failure. */
let selecting = false;
let lastError = "";

const MAX_SOURCES = 4;

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

async function broadcast() {
  const sources = await listSources();
  chrome.runtime
    .sendMessage({ type: "state", sources, selecting, error: lastError })
    .catch(() => {
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

/** Release the offscreen document once nothing is floating any more. */
async function stopTabStream() {
  await closeOffscreen();
}

/* --- capture flows -------------------------------------------------- */

async function startFullTabPip() {
  const tab = await activeTab();
  return createSource("full", null, null, tab.id);
}

async function startRegionSelection() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  selecting = true;
  await broadcast();
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "select-region",
  });
  if (!response?.ok) {
    selecting = false;
    await broadcast();
    throw new Error(response?.error || "Could not start region selection.");
  }
  return { ok: true };
}

async function beginRegionCapture({ rect, viewport }, sender) {
  selecting = false;

  // Remember the box per site so the next capture can reuse it.
  const origin = originOf(sender.tab?.url);
  if (origin) {
    const remembered = await getSettings();
    await setSettings({
      regions: { ...(remembered.regions || {}), [origin]: { rect, viewport } },
    });
  }

  return createSource("region", rect, viewport, sender.tab?.id);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return null;
  }
}

/** Reuse the box this site was last cut with, without showing the overlay. */
async function startSavedRegion() {
  const tab = await activeTab();
  const origin = originOf(tab.url);
  const saved = origin ? (await getSettings()).regions?.[origin] : null;
  if (!saved) throw new Error("No saved region for this site yet.");
  return createSource("region", saved.rect, saved.viewport, tab.id);
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
async function enterVideoState() {
  await broadcast();
  return { ok: true };
}

/** The popup already opened the page's own window: just refresh the popup. */
async function markVideoPipStarted() {
  await broadcast();
  return { ok: true };
}

/* --- floating sources ----------------------------------------------- */

let nextSourceId = 0;

/** A stream id can only be consumed once, so each source asks for its own. */
async function createStreamId(tabId) {
  await ensureOffscreen();
  const tab = await chrome.tabs.get(tabId);
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });
  return { streamId, initialSize: { width: tab.width, height: tab.height } };
}

/** One floating source: its own stream, its own tile in the shared window. */
async function createSource(kind, rect, viewport, tabId) {
  const shown = await listSources();
  if (shown.length >= MAX_SOURCES) {
    throw new Error(`Up to ${MAX_SOURCES} floating sources are supported.`);
  }

  const tab =
    tabId === undefined ? await activeTab() : await chrome.tabs.get(tabId);
  const sourceId = `source-${(nextSourceId += 1)}`;
  const { streamId, initialSize } = await createStreamId(tab.id);

  const result = await toOffscreen({
    type: "create-source",
    sourceId,
    kind,
    streamId,
    initialSize,
    rect: rect || null,
    viewport: viewport || null,
    tabId: tab.id,
    title: tab.title || "",
  });
  if (!result?.ok) throw new Error(result?.error || "PiP was refused.");

  await broadcast();
  return { ok: true, sourceId };
}

/** The offscreen document owns the list, so ask it instead of caching one. */
async function listSources() {
  if (!(await hasOffscreenDocument())) return [];
  try {
    const result = await toOffscreen({ type: "list-sources" });
    return result?.sources || [];
  } catch (error) {
    return [];
  }
}

/** Show one source alone, or pass `null` to go back to the grid. */
async function focusSource(sourceId) {
  const result = await toOffscreen({
    type: "focus-source",
    sourceId: sourceId || null,
  });
  await broadcast();
  return result;
}

/** Stop every floating source, then release the offscreen document. */
async function stopAllSources() {
  for (const source of await listSources()) {
    await toOffscreen({ type: "stop-source", sourceId: source.id });
  }
  await stopTabStream();
  await broadcast();
  return { ok: true };
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
  if (!selecting) return { ok: true };

  selecting = false;
  await broadcast();
  return { ok: true };
}

async function stopPip(sourceId) {
  // One row in the popup stops only that source.
  if (sourceId) {
    await toOffscreen({ type: "stop-source", sourceId });
    await broadcast();
    return { ok: true };
  }

  selecting = false;
  await stopAllSources();

  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id, { type: "teardown" });
  } catch (error) {
    /* nothing listening any more */
  }
  return { ok: true };
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
      return {
        ok: true,
        sources: await listSources(),
        selecting,
        error: lastError,
      };

    case "start-full-pip":
      return startFullTabPip();

    case "start-region":
      return startRegionSelection();

    case "start-region-again":
      return startSavedRegion();

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

    case "float-site-status":
      return floatSiteStatus(message.origin);

    case "float-site-toggle":
      return floatSiteToggle(message.origin, Boolean(message.on));

    case "focus-source":
      return focusSource(message.sourceId);

    case "stop-pip":
      return stopPip(message.sourceId);

    case "open-panel":
      return openPanel(message.page);

    case "pip-exited":
      selecting = false;
      await stopTabStream();
      await broadcast();
      return { ok: true };

    case "offscreen-error":
      console.error("[PiPDesk] offscreen:", message.message);
      lastError = message.message;
      await stopTabStream();
      await broadcast();
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

/* --- float button per site ------------------------------------------ */

const FLOAT_SCRIPT_PREFIX = "pipdesk-float-";

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { syncEnabled: false, floatOrigins: [], ...(settings || {}) };
}

async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** Content-script ids only take letters, digits and a few separators. */
function floatScriptId(origin) {
  return `${FLOAT_SCRIPT_PREFIX}${origin.replace(/[^a-z0-9]/gi, "_")}`;
}

async function registerFloatScript(origin) {
  const id = floatScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [`${origin}/*`],
      js: ["content/float-control.js"],
      runAt: "document_idle",
    },
  ]);
}

async function unregisterFloatScript(origin) {
  const id = floatScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (!existing.length) return;
  await chrome.scripting.unregisterContentScripts({ ids: [id] });
}

/**
 * Keep the stored origins, the granted permissions and the registered scripts
 * in step: a permission revoked at chrome://extensions must also drop the
 * origin, or the popup would claim a site is on while its pages show nothing.
 */
async function syncFloatScripts() {
  const settings = await getSettings();
  const allowed = [];

  for (const origin of settings.floatOrigins) {
    const granted = await chrome.permissions.contains({
      origins: [`${origin}/*`],
    });
    if (!granted) continue;
    allowed.push(origin);
    await registerFloatScript(origin);
  }

  if (allowed.length !== settings.floatOrigins.length) {
    await setSettings({ floatOrigins: allowed });
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const wanted = new Set(allowed.map(floatScriptId));
  const stale = registered
    .filter(
      (script) =>
        script.id.startsWith(FLOAT_SCRIPT_PREFIX) && !wanted.has(script.id),
    )
    .map((script) => script.id);
  if (stale.length) {
    await chrome.scripting.unregisterContentScripts({ ids: stale });
  }
}

async function floatSiteStatus(origin) {
  if (!origin) throw new Error("No site to check.");
  const settings = await getSettings();
  return {
    ok: true,
    origin,
    enabled: settings.floatOrigins.includes(origin),
  };
}

async function floatSiteToggle(origin, on) {
  if (!origin) throw new Error("No site to change.");
  const settings = await getSettings();
  const origins = new Set(settings.floatOrigins);

  if (on) {
    await registerFloatScript(origin);
    origins.add(origin);
  } else {
    await unregisterFloatScript(origin);
    origins.delete(origin);
  }

  await setSettings({ floatOrigins: [...origins] });
  return { ok: true, origin, enabled: Boolean(on) };
}

chrome.runtime.onInstalled.addListener(syncFloatScripts);
chrome.runtime.onStartup.addListener(syncFloatScripts);

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

/* --- keyboard commands ---------------------------------------------- */

/**
 * These call exactly what the popup buttons and the page menus call. Video
 * mode has no command on purpose: its picture-in-picture request must come
 * from the popup, the only context that still holds the click's activation.
 */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "float-tab") await startFullTabPip();
    if (command === "float-region") await startRegionSelection();
    if (command === "stop-all") await stopPip();
  } catch (error) {
    lastError = String(error?.message || error);
    console.error("[PiPDesk] command", command, error);
  }
});

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
 * The popup holds a port open, which keeps the worker alive for the session.
 * Closing it with nothing floating releases the offscreen document again.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;

  port.onDisconnect.addListener(async () => {
    // A running selection or a floating source must survive the popup closing.
    if (selecting) return;
    if ((await listSources()).length > 0) return;
    await stopTabStream();
    await broadcast();
  });
});

/** A closed tab takes its floating sources with it. */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const mine = (await listSources()).filter(
    (source) => source.tabId === tabId,
  );
  if (!mine.length) return;
  for (const source of mine) {
    await toOffscreen({ type: "stop-source", sourceId: source.id });
  }
  await broadcast();
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
