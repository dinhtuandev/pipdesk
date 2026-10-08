/* PiPDesk focus timer: pomodoro state kept in the shared timer record.
   A running session is anchored on `endsAt`, so the panel can be closed. */
(() => {
  "use strict";

  const KEY = Store.KEYS.TIMER;
  const ALARM = "focus-timer";
  const DEFAULTS = {
    workMin: 25, shortMin: 5, longMin: 15,
    mode: "work", remainingSec: 0, running: false, endsAt: null,
    completedSessions: 0, history: {},
  };
  const LABEL = { work: "Work", short: "Short break", long: "Long break" };
  const FIELDS = [
    ["timer-work", "workMin"], ["timer-short", "shortMin"], ["timer-long", "longMin"],
  ];
  const $ = (id) => document.getElementById(id);
  let timer = { ...DEFAULTS };
  let intervalId = null;
  let unsubscribe = null;

  /* One element from props; user text always goes through textContent. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  function clampMinutes(value, fallback) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) ? Math.min(180, Math.max(1, minutes)) : fallback;
  }

  function durationOf(config, mode) {
    const minutes =
      mode === "work" ? config.workMin : mode === "short" ? config.shortMin : config.longMin;
    return clampMinutes(minutes, DEFAULTS.workMin) * 60;
  }

  const durationFor = (mode) => durationOf(timer, mode);

  function merge(raw) {
    const stored = raw && typeof raw === "object" ? raw : {};
    const next = { ...DEFAULTS, ...stored };
    next.workMin = clampMinutes(stored.workMin, DEFAULTS.workMin);
    next.shortMin = clampMinutes(stored.shortMin, DEFAULTS.shortMin);
    next.longMin = clampMinutes(stored.longMin, DEFAULTS.longMin);
    next.mode = LABEL[stored.mode] ? stored.mode : "work";
    next.completedSessions = Math.max(0, Math.round(Number(stored.completedSessions) || 0));
    next.history = stored.history && typeof stored.history === "object" ? stored.history : {};
    next.remainingSec = Math.max(0, Math.round(Number(stored.remainingSec) || 0));
    next.running = Boolean(stored.running) && Number.isFinite(Number(stored.endsAt));
    next.endsAt = next.running ? Number(stored.endsAt) : null;
    if (!next.running && next.remainingSec === 0) {
      next.remainingSec = durationOf(next, next.mode);
    }
    return next;
  }

  function remainingNow() {
    if (timer.running && timer.endsAt) {
      return Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
    }
    return Math.max(0, timer.remainingSec);
  }

  function stopTicking() {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
  }

  function startTicking() {
    stopTicking();
    intervalId = setInterval(() => (remainingNow() <= 0 ? finishSession() : paint()), 500);
  }

  function syncTicking() {
    if (timer.running && timer.endsAt && remainingNow() > 0) startTicking();
    else stopTicking();
  }

  const persist = () => Store.write(KEY, timer);

  function renderHistory() {
    const host = $("timer-history");
    host.textContent = "";
    const rows = [];
    for (let back = 0; back < 7; back += 1) {
      const day = new Date();
      day.setHours(12, 0, 0, 0);
      day.setDate(day.getDate() - back);
      const key = Panel.localDateKey(day);
      const entry = timer.history[key];
      if (entry && (entry.sessions || entry.minutes)) rows.push({ key, ...entry });
    }
    if (!rows.length) {
      host.appendChild(el("p", { class: "empty", text: "No focus sessions logged yet." }));
      return;
    }
    for (const row of rows) {
      host.appendChild(
        el("div", { class: "row row--between log" }, [
          el("span", { text: Panel.formatDay(row.key) }),
          el("span", {
            class: "log__value",
            text: `${row.sessions || 0} · ${row.minutes || 0} min`,
          }),
        ]),
      );
    }
  }

  function paint() {
    const remaining = remainingNow();
    const today = timer.history[Panel.localDateKey()] || { sessions: 0, minutes: 0 };
    const idle = !timer.running && remaining === durationFor(timer.mode);
    const logged = timer.completedSessions ? ` · ${timer.completedSessions} done` : "";
    $("timer-clock").textContent = Panel.formatClock(remaining);
    $("timer-mode").textContent = LABEL[timer.mode] + logged;
    $("timer-start").textContent = timer.running ? "Pause" : "Start";
    $("timer-meta").textContent = timer.running ? "Running" : idle ? "Ready" : "Paused";
    $("timer-today").textContent = `${today.sessions || 0} session${
      today.sessions === 1 ? "" : "s"
    } · ${today.minutes || 0} min`;
    renderHistory();
  }

  async function start() {
    if (timer.running) return;
    timer.remainingSec = remainingNow() || durationFor(timer.mode);
    timer.running = true;
    timer.endsAt = Date.now() + timer.remainingSec * 1000;
    chrome.alarms.create(ALARM, { delayInMinutes: timer.remainingSec / 60 });
    startTicking();
    paint();
    await persist();
  }

  async function pause() {
    if (!timer.running) return;
    timer.remainingSec = remainingNow();
    timer.running = false;
    timer.endsAt = null;
    stopTicking();
    await chrome.alarms.clear(ALARM);
    paint();
    await persist();
  }

  async function reset() {
    stopTicking();
    await chrome.alarms.clear(ALARM);
    timer.running = false;
    timer.endsAt = null;
    timer.remainingSec = durationFor(timer.mode);
    paint();
    await persist();
  }

  /* Session ran out: log it when it was work, then advance the rotation. */
  async function finishSession() {
    stopTicking();
    await chrome.alarms.clear(ALARM);
    const finished = timer.mode;
    timer.running = false;
    timer.endsAt = null;

    if (finished === "work") {
      timer.completedSessions += 1;
      const key = Panel.localDateKey();
      const day = timer.history[key] || { minutes: 0, sessions: 0 };
      timer.history = {
        ...timer.history,
        [key]: { minutes: day.minutes + timer.workMin, sessions: day.sessions + 1 },
      };
      timer.mode = timer.completedSessions % 4 === 0 ? "long" : "short";
      Panel.toast("Focus session logged");
    } else {
      timer.mode = "work";
      Panel.toast("Break over — back to work");
    }

    timer.remainingSec = durationFor(timer.mode);
    paint();
    await persist();
  }

  function openSettings() {
    for (const [id, prop] of FIELDS) $(id).value = String(timer[prop]);
    $("timer-view").hidden = true;
    $("timer-settings-view").hidden = false;
    $("timer-work").focus();
  }

  function closeSettings() {
    $("timer-settings-view").hidden = true;
    $("timer-view").hidden = false;
  }

  async function saveSettings() {
    const next = {};
    for (const [id, prop] of FIELDS) {
      const field = $(id);
      const raw = Number(field.value);
      if (!Number.isInteger(raw) || raw < 1 || raw > 180) {
        Panel.toast("Use whole minutes between 1 and 180");
        field.focus();
        return;
      }
      next[prop] = raw;
    }
    timer = { ...timer, ...next };
    if (!timer.running) timer.remainingSec = durationFor(timer.mode);
    closeSettings();
    paint();
    await persist();
    Panel.toast("Durations saved");
  }

  async function load() {
    timer = merge(await Store.read(KEY, null));
    if (timer.running && timer.endsAt <= Date.now()) {
      await finishSession(); // ran out while the panel was closed
      return;
    }
    if (timer.running) {
      timer.remainingSec = remainingNow();
      startTicking();
    }
    paint();
  }

  function applyExternal(value) {
    if (!value) return;
    timer = merge(value);
    syncTicking();
    paint();
  }

  async function init() {
    $("timer-start").addEventListener("click", () => (timer.running ? pause() : start()));
    $("timer-reset").addEventListener("click", reset);
    $("timer-settings").addEventListener("click", openSettings);
    $("timer-save").addEventListener("click", saveSettings);
    $("timer-cancel").addEventListener("click", closeSettings);
    unsubscribe = Store.subscribe(KEY, applyExternal);
    await load();
  }

  /* The alarm must outlive the panel: only the interval is torn down here. */
  window.addEventListener("pagehide", () => {
    stopTicking();
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  });

  Panel.mountNav("timer");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
