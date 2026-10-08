/* ==========================================================================
   PiPDesk — offscreen capture document
   Decodes the tab capture stream, crops a selected region onto a canvas and
   promotes the right video element into picture-in-picture.
   ========================================================================== */

const sourceVideo = document.getElementById("source-video");
const cropVideo = document.getElementById("crop-video");
const cropCanvas = document.getElementById("crop-canvas");
const cropContext = cropCanvas.getContext("2d", { alpha: false });

const supportsFrameCallback =
  typeof sourceVideo.requestVideoFrameCallback === "function";

let tabStream = null;
let cropStream = null;
let rect = null;
let viewport = null;
let mode = null;
let frameHandle = null;
let fallbackTimer = null;

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

/** Draw the selected part of the tab onto the canvas, in source pixels. */
function drawCropFrame() {
  if (!rect || !viewport || !sourceVideo.videoWidth) return;

  const scaleX = sourceVideo.videoWidth / viewport.width;
  const scaleY = sourceVideo.videoHeight / viewport.height;

  const sourceX = Math.max(0, Math.round(rect.x * scaleX));
  const sourceY = Math.max(0, Math.round(rect.y * scaleY));
  const sourceWidth = Math.min(
    sourceVideo.videoWidth - sourceX,
    Math.round(rect.width * scaleX),
  );
  const sourceHeight = Math.min(
    sourceVideo.videoHeight - sourceY,
    Math.round(rect.height * scaleY),
  );

  if (sourceWidth < 2 || sourceHeight < 2) return;

  if (cropCanvas.width !== sourceWidth || cropCanvas.height !== sourceHeight) {
    cropCanvas.width = sourceWidth;
    cropCanvas.height = sourceHeight;
  }

  cropContext.drawImage(
    sourceVideo,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
}

/** Repaint only when the source produces a new frame. */
function pumpFrames() {
  if (mode !== "region") return;
  drawCropFrame();

  if (supportsFrameCallback) {
    frameHandle = sourceVideo.requestVideoFrameCallback(pumpFrames);
  } else {
    fallbackTimer = setTimeout(pumpFrames, 33);
  }
}

function stopFrameLoop() {
  if (frameHandle !== null && sourceVideo.cancelVideoFrameCallback) {
    sourceVideo.cancelVideoFrameCallback(frameHandle);
    frameHandle = null;
  }
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

/* --- capture lifecycle ---------------------------------------------- */

async function startCapture(message) {
  await stopCapture();

  mode = message.mode;
  rect = message.rect || null;
  viewport = message.viewport || null;

  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId,
        maxFrameRate: 30,
      },
    },
  });

  sourceVideo.srcObject = tabStream;
  await sourceVideo.play().catch(() => {});
  if (sourceVideo.readyState < 1) await once(sourceVideo, "loadedmetadata");

  if (mode === "full") {
    await sourceVideo.requestPictureInPicture();
    return { ok: true };
  }

  if (!rect || !viewport) {
    throw new Error("Region capture needs a selection rectangle.");
  }

  cropStream = cropCanvas.captureStream(30);
  cropVideo.srcObject = cropStream;
  await cropVideo.play().catch(() => {});
  if (cropVideo.readyState < 1) await once(cropVideo, "loadedmetadata");

  pumpFrames();
  await cropVideo.requestPictureInPicture();
  return { ok: true };
}

async function stopCapture() {
  stopFrameLoop();
  mode = null;
  rect = null;
  viewport = null;

  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture().catch(() => {});
  }

  sourceVideo.pause();
  sourceVideo.srcObject = null;
  cropVideo.pause();
  cropVideo.srcObject = null;

  if (cropStream) {
    cropStream.getTracks().forEach((track) => track.stop());
    cropStream = null;
  }
  if (tabStream) {
    tabStream.getTracks().forEach((track) => track.stop());
    tabStream = null;
  }

  cropCanvas.width = 1;
  cropCanvas.height = 1;
  return { ok: true };
}

/* Leaving picture-in-picture (from either video) ends the session. */
document.addEventListener(
  "leavepictureinpicture",
  (event) => {
    if (event.target !== sourceVideo && event.target !== cropVideo) return;
    if (!mode) return;
    stopCapture()
      .then(() => chrome.runtime.sendMessage({ type: "pip-exited" }))
      .catch(() => {});
  },
  true,
);

/* --- messaging ------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;

  const task =
    message.type === "start-capture"
      ? startCapture(message)
      : message.type === "stop"
        ? stopCapture()
        : Promise.resolve({ ok: false, error: `Unsupported: ${message.type}` });

  task
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
