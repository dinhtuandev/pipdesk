/* ==========================================================================
   PiPDesk — offscreen compositor.
   One canvas, one picture-in-picture window. Every source (a whole tab, or a
   region of one) decodes its own tab stream into a hidden <video>, and each
   frame paints the sources into a grid on the canvas.

   It has to be one window: a document only ever holds a single
   document.pictureInPictureElement, and the offscreen document is the only
   capture host the extension gets.
   ========================================================================== */

const compositeCanvas = document.getElementById("composite-canvas");
const pipVideo = document.getElementById("pip-video");
const compositeContext = compositeCanvas.getContext("2d", { alpha: false });

const MAX_SOURCES = 4;
const FULL_WIDTH = 1280;
const FULL_HEIGHT = 720;
const TILE_WIDTH = 640;
const TILE_HEIGHT = 360;

const supportsFrameCallback =
  typeof pipVideo.requestVideoFrameCallback === "function";

/* The canvas shares the panel background instead of inventing a colour. */
const backdrop = getComputedStyle(document.documentElement)
  .getPropertyValue("--bg")
  .trim();

const sources = new Map();
let canvasStream = null;
let frameHandle = null;
let fallbackTimer = null;
let closing = false;

/* --- helpers -------------------------------------------------------- */

function once(target, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(event, onEvent);
      reject(new Error(`Timed out waiting for "${event}".`));
    }, timeout);

    function onEvent() {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      resolve();
    }

    target.addEventListener(event, onEvent);
  });
}

/** Wait until a video has decoded a frame; PiP refuses one without. */
function waitForData(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return once(video, "loadeddata").catch(() => {
    /* fall through: the picture-in-picture request reports the real failure */
  });
}

/** Where each source sits on the canvas: 1 fills it, 2 split, 3-4 grid. */
function slots() {
  const count = sources.size;
  if (count <= 1) {
    return [{ x: 0, y: 0, width: FULL_WIDTH, height: FULL_HEIGHT }];
  }

  const columns = 2;
  const offsetY = count <= 2 ? Math.round((FULL_HEIGHT - TILE_HEIGHT) / 2) : 0;
  return Array.from({ length: count }, (unused, index) => ({
    x: (index % columns) * TILE_WIDTH,
    y: offsetY + Math.floor(index / columns) * TILE_HEIGHT,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  }));
}

/** Paint one source into its slot, letterboxed so nothing is stretched. */
function drawSource(source, slot) {
  const video = source.video;
  if (!video.videoWidth) return;

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;

  if (source.rect && source.viewport) {
    const scaleX = video.videoWidth / source.viewport.width;
    const scaleY = video.videoHeight / source.viewport.height;
    sourceX = Math.max(0, Math.round(source.rect.x * scaleX));
    sourceY = Math.max(0, Math.round(source.rect.y * scaleY));
    sourceWidth = Math.min(
      video.videoWidth - sourceX,
      Math.round(source.rect.width * scaleX),
    );
    sourceHeight = Math.min(
      video.videoHeight - sourceY,
      Math.round(source.rect.height * scaleY),
    );
  }
  if (sourceWidth < 2 || sourceHeight < 2) return;

  const scale = Math.min(slot.width / sourceWidth, slot.height / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);

  compositeContext.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    slot.x + Math.round((slot.width - drawWidth) / 2),
    slot.y + Math.round((slot.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
}

function drawFrame() {
  if (backdrop) {
    compositeContext.fillStyle = backdrop;
    compositeContext.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  }

  const layout = slots();
  let index = 0;
  for (const source of sources.values()) {
    drawSource(source, layout[index] || layout[layout.length - 1]);
    index += 1;
  }
}

function stopFrameLoop() {
  if (frameHandle !== null && pipVideo.cancelVideoFrameCallback) {
    pipVideo.cancelVideoFrameCallback(frameHandle);
  }
  frameHandle = null;
  if (fallbackTimer !== null) clearInterval(fallbackTimer);
  fallbackTimer = null;
}

function pumpFrames() {
  stopFrameLoop();
  if (supportsFrameCallback) {
    const step = () => {
      drawFrame();
      frameHandle = pipVideo.requestVideoFrameCallback(step);
    };
    frameHandle = pipVideo.requestVideoFrameCallback(step);
    return;
  }
  fallbackTimer = setInterval(drawFrame, 33);
}

function releaseSource(entry) {
  for (const track of entry.video.srcObject?.getTracks() || []) track.stop();
  entry.video.pause();
  entry.video.srcObject = null;
  entry.video.remove();
}

/* --- tasks ---------------------------------------------------------- */

async function createSource(message) {
  const { sourceId } = message;
  if (!sourceId) throw new Error("create-source needs a sourceId.");
  if (sources.has(sourceId)) return { ok: true, sourceId };
  if (sources.size >= MAX_SOURCES) {
    throw new Error(`Up to ${MAX_SOURCES} floating sources are supported.`);
  }

  const bounds = message.initialSize || {};
  const mandatory = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: message.streamId,
    maxFrameRate: 30,
  };
  if (bounds.width > 0 && bounds.height > 0) {
    mandatory.minWidth = bounds.width;
    mandatory.maxWidth = bounds.width;
    mandatory.minHeight = bounds.height;
    mandatory.maxHeight = bounds.height;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory },
  });

  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.setAttribute(
    "style",
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;",
  );
  video.srcObject = stream;
  document.body.appendChild(video);

  try {
    await waitForData(video);
    await video.play();
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    video.remove();
    throw error;
  }

  sources.set(sourceId, {
    kind: message.kind || "full",
    tabId: message.tabId ?? null,
    title: message.title || "",
    video,
    rect: message.rect || null,
    viewport: message.viewport || null,
  });
  drawFrame();

  // The window opens once, on the first source; the rest just join the grid.
  if (sources.size === 1) {
    canvasStream = compositeCanvas.captureStream(30);
    pipVideo.srcObject = canvasStream;
    await pipVideo.play().catch(() => {});
    pumpFrames();
    await waitForData(pipVideo);
    await pipVideo.requestPictureInPicture();
  }

  return { ok: true, sourceId };
}

async function stopAll() {
  stopFrameLoop();

  closing = true;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
  } catch (error) {
    /* the window is already gone */
  }

  for (const entry of sources.values()) releaseSource(entry);
  sources.clear();

  if (canvasStream) {
    for (const track of canvasStream.getTracks()) track.stop();
    canvasStream = null;
  }
  pipVideo.srcObject = null;

  chrome.runtime.sendMessage({ type: "pip-exited" }).catch(() => {});
  return { ok: true };
}

async function stopSource(message) {
  const { sourceId } = message;
  const entry = sources.get(sourceId);
  if (!entry) return { ok: true };

  releaseSource(entry);
  sources.delete(sourceId);

  if (sources.size > 0) {
    drawFrame();
    return { ok: true };
  }
  return stopAll();
}

function listSources() {
  return {
    ok: true,
    sources: [...sources.entries()].map(([id, entry]) => ({
      id,
      kind: entry.kind,
      tabId: entry.tabId,
      title: entry.title,
    })),
  };
}

/* --- messaging ------------------------------------------------------ */

const TASKS = {
  "create-source": createSource,
  "stop-source": stopSource,
  "list-sources": listSources,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;

  const task = TASKS[message.type];
  const pending = task
    ? task(message)
    : Promise.resolve({ ok: false, error: `Unsupported: ${message.type}` });

  pending
    .then((result) => sendResponse(result))
    .catch((error) => {
      const text = String(error?.message || error);
      chrome.runtime
        .sendMessage({ type: "offscreen-error", message: text })
        .catch(() => {});
      sendResponse({ ok: false, error: text });
    });
  return true;
});

/* The user closed our window: it takes every source with it. An exit we asked
   for ourselves sets `closing`, so it is not reported twice. */
pipVideo.addEventListener("leavepictureinpicture", () => {
  if (closing) {
    closing = false;
    return;
  }
  stopAll().catch(() => {});
});
