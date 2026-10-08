/* PiPDesk shared panel helpers: rendering utilities and the bottom nav.
   Loaded after shared/store.js by each panel page. */

const Panel = (() => {
  const PAGES = [
    { id: "notes", label: "Notes", file: "panels/notes.html" },
    { id: "todos", label: "Todos", file: "panels/todos.html" },
    { id: "timer", label: "Focus", file: "panels/timer.html" },
  ];

  const ICONS = {
    notes:
      '<path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/>',
    todos:
      '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    timer: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  };

  /** Stable-ish id for a new record: sortable by creation time. */
  function newId() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
  }

  function escapeHtml(value) {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(value ?? "").replace(/[&<>"']/g, (ch) => replacements[ch]);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  /** Local calendar day (YYYY-MM-DD). Never UTC: a "day" means the user's day. */
  function localDateKey(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}`;
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function formatDay(dayKey) {
    const [year, month, day] = String(dayKey).split("-").map(Number);
    if (!year || !month || !day) return dayKey;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  function svg(paths, size = 18) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function toast(message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1800);
  }

  /** Render the bottom navigation and wire page switching. */
  function mountNav(activeId, containerId = "panel-nav") {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="nav" role="tablist">
        ${PAGES.map(
          (page) => `
          <button class="nav__item${
            page.id === activeId ? " is-active" : ""
          }" role="tab" data-page="${page.id}" aria-selected="${
            page.id === activeId
          }">
            ${svg(ICONS[page.id], 16)}
            <span>${page.label}</span>
          </button>`,
        ).join("")}
      </div>
    `;

    container.querySelectorAll(".nav__item").forEach((button) => {
      button.addEventListener("click", () => {
        const target = PAGES.find((page) => page.id === button.dataset.page);
        if (!target || target.id === activeId) return;
        window.location.href = chrome.runtime.getURL(target.file);
      });
    });
  }

  return {
    PAGES,
    newId,
    escapeHtml,
    localDateKey,
    formatClock,
    formatDay,
    timeAgo,
    svg,
    toast,
    mountNav,
  };
})();
