/* Capture the real extension UI for Chrome Web Store screenshots.
 *
 * Chrome is launched with the unpacked extension and a throwaway profile, then
 * driven over the DevTools protocol with Node's built-in fetch and WebSocket.
 * No npm dependencies. Raw 1× captures land in store/raw/ and are composed into
 * 1280 × 800 store frames by tools/store-assets.py.
 *
 *   node tools/store-shots.mjs
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "store", "raw");
const PORT = 9333;

/* Branded Chrome ignores --load-extension, so a Chromium build (for example
   the one Playwright downloads) is the reliable choice. */
async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "ms-playwright")
      : path.join(process.env.HOME || "", ".cache", "ms-playwright");
  try {
    const builds = (await readdir(cache))
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const build of builds) {
      const binary =
        process.platform === "win32"
          ? path.join(cache, build, "chrome-win64", "chrome.exe")
          : path.join(cache, build, "chrome-linux", "chrome");
      if (existsSync(binary)) return binary;
    }
  } catch {
    /* no Playwright cache */
  }
  return process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome";
}

const CHROME = await findChrome();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

/** Wait until the browser exposes its debugging endpoint. */
async function browserTargets() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await json(`http://127.0.0.1:${PORT}/json/list`);
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome never opened its debugging port.");
}

/** The unpacked id is only discoverable from the extension's own targets. */
async function extensionId() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await browserTargets();
    for (const target of targets) {
      const match =
        /^chrome-extension:\/\/([a-p]{32})\/(?:background\/service-worker\.js|welcome\/welcome\.html)/.exec(
          target.url,
        );
      if (match) return match[1];
    }
    await sleep(250);
  }
  throw new Error("The extension did not register a target.");
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { target, send, close: () => socket.close() };
}

async function openTab(url) {
  const target = await json(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  return connect(target);
}

/**
 * extension pages refuse a renderer-initiated navigation, so ask the extension
 * itself to open the tab and then attach to the page it created.
 */
async function extensionHost(id) {
  const targets = await browserTargets();
  // Any extension context can open the tab; the welcome page from onInstalled
  // is usually around even when the service worker has gone idle.
  const host =
    targets.find(
      (target) =>
        target.type === "service_worker" && target.url.includes(id),
    ) ||
    targets.find((target) => target.url.startsWith(`chrome-extension://${id}/`));
  if (!host) throw new Error("No extension context is running.");
  return host;
}

async function openExtensionTab(id, file) {
  const url = `chrome-extension://${id}/${file}`;
  const session = await connect(await extensionHost(id));
  try {
    await session.send("Runtime.evaluate", {
      expression: `chrome.tabs.create({ url: ${JSON.stringify(url)} })`,
      awaitPromise: true,
    });
  } finally {
    session.close();
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const page = (await browserTargets()).find(
      (target) => target.type === "page" && target.url === url,
    );
    if (page) return connect(page);
    await sleep(200);
  }
  throw new Error(`The extension did not open ${url}.`);
}

/* Sample records so the panel screenshots show the real UI doing its job.
   This only ever writes to the throwaway profile the script deletes at the end. */
async function seedSampleData(id) {
  const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.toISOString().slice(0, 10);
  };
  const now = Date.now();
  const sample = {
    notes: [
      { id: 1, text: "Publish checklist: privacy URL, screenshots, promo tile", updatedAt: now },
      { id: 2, text: "Ask two people to test the region selector before submitting", updatedAt: now - 3_600_000 },
      { id: 3, text: "Ideas: pin a floating source to a shortcut, collapse the label strip", updatedAt: now - 86_400_000 },
    ],
    todos: [
      { id: 11, text: "Record the reviewer walkthrough video", done: false, due: day(0), createdAt: now - 7_200_000 },
      { id: 12, text: "Write permission justifications", done: true, due: null, createdAt: now - 90_000_000 },
      { id: 13, text: "Update the store screenshots after the UI review", done: false, due: day(-1), createdAt: now - 1000 },
      { id: 14, text: "Test on a clean Chrome profile", done: true, due: null, createdAt: now - 170_000_000 },
    ],
    timer: {
      workMin: 25,
      shortMin: 5,
      longMin: 15,
      mode: "work",
      remainingSec: 0,
      running: false,
      endsAt: null,
      completedSessions: 7,
      history: {
        [day(0)]: { sessions: 3, minutes: 75 },
        [day(1)]: { sessions: 2, minutes: 50 },
        [day(2)]: { sessions: 2, minutes: 50 },
        [day(4)]: { sessions: 1, minutes: 25 },
      },
    },
  };

  const session = await connect(await extensionHost(id));
  try {
    await session.send("Runtime.evaluate", {
      expression: `chrome.storage.local.set(${JSON.stringify(sample)})`,
      awaitPromise: true,
    });
  } finally {
    session.close();
  }
}

async function waitFor(session, expression, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result?.value) return;
    await sleep(150);
  }
  const state = await session.send("Runtime.evaluate", {
    expression: "document.title + ' | ' + location.href",
    returnByValue: true,
  });
  throw new Error(
    `Timed out waiting for ${label}: ${state.result?.value || "no page"}`,
  );
}

async function capture({
  url,
  width,
  height,
  ready,
  scroll = 0,
  scrollTo,
  clip,
  clipContent,
  extension,
}) {
  const session = extension
    ? await openExtensionTab(extension.id, extension.file)
    : await openTab(url);
  try {
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Emulation.setScrollbarsHidden", { hidden: true });
    if (!extension) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await session.send("Page.navigate", { url });
      await sleep(400);
    } else {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }
    await waitFor(session, ready, url);
    if (scrollTo) {
      await session.send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(
          scrollTo,
        )})?.scrollIntoView({ block: "start" }); window.scrollBy(0, -24)`,
      });
      await sleep(350);
    } else if (scroll) {
      await session.send("Runtime.evaluate", {
        expression: `window.scrollTo(0, ${scroll})`,
      });
      await sleep(350);
    }
    let area = clip;
    if (clipContent) {
      const measured = await session.send("Runtime.evaluate", {
        expression: "document.documentElement.scrollHeight",
        returnByValue: true,
      });
      area = {
        x: 0,
        y: 0,
        width: clipContent.width,
        height: Math.min(Number(measured.result?.value) || height, 1000),
      };
    }
    const shot = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      ...(area ? { clip: { ...area, scale: 1 } } : {}),
    });
    return Buffer.from(shot.data, "base64");
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${session.target.id}`).catch(
      () => {},
    );
  }
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "pipdesk-shots-"));

  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=" + PORT,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "--window-size=1400,1000",
      "--load-extension=" + ROOT,
      "--disable-extensions-except=" + ROOT,
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  try {
    const id = await extensionId();
    console.log(`extension ${id}`);

    await seedSampleData(id);

    const extensionPage = (file, extra) => ({
      ...extra,
      extension: { id, file },
      url: `chrome-extension://${id}/${file}`,
    });

    const shots = [
      extensionPage("welcome/welcome.html", {
        file: "welcome-top.png",
        width: 1280,
        height: 800,
        ready: "Boolean(document.querySelector('.frame'))",
        scroll: 0,
      }),
      extensionPage("welcome/welcome.html", {
        file: "welcome-region.png",
        width: 1280,
        height: 800,
        ready: "Boolean(document.querySelector('.frame'))",
        scrollTo: "#region-title",
      }),
      extensionPage("popup/popup.html", {
        file: "popup.png",
        width: 1280,
        height: 900,
        ready:
          "document.readyState === 'complete' && document.getElementById('version')?.textContent.startsWith('v')",
        clipContent: { width: 380 },
      }),
      extensionPage("panels/notes.html", {
        file: "notes.png",
        width: 380,
        height: 540,
        ready: "Boolean(document.querySelector('#panel-nav .nav'))",
      }),
      extensionPage("panels/timer.html", {
        file: "timer.png",
        width: 340,
        height: 580,
        ready: "Boolean(document.querySelector('#panel-nav .nav'))",
      }),
    ];

    for (const shot of shots) {
      const png = await capture(shot);
      const target = path.join(RAW, shot.file);
      await (await import("node:fs/promises")).writeFile(target, png);
      console.log("wrote", path.relative(ROOT, target));
    }
  } finally {
    chrome.kill();
    await sleep(400);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
