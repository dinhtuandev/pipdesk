/* PiPDesk unified workspace — capture half.
   An extension page iframed inside the page-hosted document-PiP window. It
   plays the offscreen compositor's canvas stream, pushed over a same-origin
   BroadcastChannel (a live MediaStream cannot travel in a runtime message).
   Plain script, no modules; under ~100 lines on purpose. */
(() => {
  "use strict";

  const CHANNEL =
    (globalThis.__pipDeskLayout && globalThis.__pipDeskLayout.UNIFIED_CHANNEL) ||
    "pipdesk-capture";

  const video = document.getElementById("feed");
  const empty = document.getElementById("empty");
  let attached = false;
  let helloTimer = null;
  let channel = null;

  function tell(message) {
    try {
      const pending = chrome.runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {
          /* no listener yet (offscreen still starting) — hello loop retries */
        });
      }
    } catch (error) {
      /* extension reloaded under us */
    }
  }

  function showVideo() {
    attached = true;
    video.hidden = false;
    empty.hidden = true;
    if (helloTimer !== null) {
      clearInterval(helloTimer);
      helloTimer = null;
    }
  }

  async function attach(stream) {
    if (!(stream instanceof MediaStream)) {
      throw new Error("no stream in the broadcast");
    }
    video.srcObject = stream;
    await video.play();
    showVideo();
    tell({ type: "unified-capture-ready" });
  }

  function listen() {
    try {
      channel = new BroadcastChannel(CHANNEL);
    } catch (error) {
      tell({ type: "unified-capture-failed", error: String(error) });
      return;
    }
    channel.onmessage = (event) => {
      if (event?.data?.type !== "capture-stream") return;
      attach(event.data.stream).catch((error) => {
        tell({ type: "unified-capture-failed", error: String(error?.message || error) });
      });
    };
  }

  // Ask the offscreen document to (re)publish until a stream lands. Stops on
  // its own once attached; always torn down on unload.
  function hello() {
    tell({ type: "unified-capture-loaded", target: "offscreen" });
    let tries = 0;
    helloTimer = setInterval(() => {
      if (attached || tries >= 10) {
        clearInterval(helloTimer);
        helloTimer = null;
        return;
      }
      tries += 1;
      tell({ type: "unified-capture-loaded", target: "offscreen" });
    }, 2000);
  }

  window.addEventListener("pagehide", () => {
    if (helloTimer !== null) clearInterval(helloTimer);
    helloTimer = null;
    if (channel) channel.close();
    channel = null;
  });

  listen();
  hello();
})();
