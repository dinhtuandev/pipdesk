/* PiPDesk notes panel: list, search, compose/edit, inline delete confirmation. */
(() => {
  "use strict";

  const KEY = Store.KEYS.NOTES;
  const $ = (id) => document.getElementById(id);
  let notes = [];
  let query = "";
  let editingId = null;
  let confirmId = null;
  let unsubscribe = null;

  /* One element from props; user text always goes through textContent. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key === "value") node.value = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  const button = (text, cls, onclick) =>
    el("button", { type: "button", class: cls, text, onclick });

  const byNewest = () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  function preview(text) {
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > 96 ? `${flat.slice(0, 96)}…` : flat;
  }

  function renderCount() {
    $("notes-count").textContent =
      notes.length === 1 ? "1 note" : `${notes.length} notes`;
  }

  function renderActions() {
    const host = $("notes-actions");
    host.textContent = "";
    if (confirmId !== null && confirmId === editingId) {
      host.append(
        el("span", { class: "confirm", text: "Delete this note?" }),
        button("Delete", "btn btn--danger", () => removeNote(editingId)),
        button("Cancel", "btn btn--ghost", () => {
          confirmId = null;
          renderActions();
        }),
      );
      return;
    }
    host.append(button("Save", "btn btn--primary", saveNote), button("Back", "btn", showList));
    if (editingId !== null) {
      host.appendChild(
        button("Delete", "btn btn--danger", () => {
          confirmId = editingId;
          renderActions();
        }),
      );
    }
  }

  function renderList() {
    const host = $("notes-items");
    host.textContent = "";
    const needle = query.trim().toLowerCase();
    const items = byNewest().filter(
      (note) => !needle || note.text.toLowerCase().includes(needle),
    );

    if (!items.length) {
      host.appendChild(
        el("p", {
          class: "empty",
          text: needle ? "No notes match that search." : "No notes yet. Tap New to write one.",
        }),
      );
      return;
    }

    for (const note of items) {
      if (confirmId === note.id) {
        host.appendChild(
          el("div", { class: "item" }, [
            el("div", { class: "item__text confirm", text: "Delete this note?" }),
            button("Delete", "btn btn--danger", () => removeNote(note.id)),
            button("Cancel", "btn btn--ghost", () => {
              confirmId = null;
              renderList();
            }),
          ]),
        );
        continue;
      }
      host.appendChild(
        el("div", { class: "item" }, [
          el(
            "button",
            { type: "button", class: "item__main", "aria-label": "Edit note", onclick: () => openEditor(note.id) },
            [
              el("div", { class: "item__text", text: preview(note.text) }),
              el("div", { class: "item__meta", text: Panel.timeAgo(note.updatedAt) }),
            ],
          ),
          button("Delete", "btn btn--danger", () => {
            confirmId = note.id;
            renderList();
          }),
        ]),
      );
    }
  }

  function showEditor() {
    $("notes-list").hidden = true;
    $("notes-editor").hidden = false;
    renderActions();
    $("notes-text").focus();
  }

  function showList() {
    $("notes-editor").hidden = true;
    $("notes-list").hidden = false;
    editingId = null;
    confirmId = null;
    renderList();
  }

  function openEditor(id) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    editingId = note.id;
    confirmId = null;
    $("notes-text").value = note.text;
    showEditor();
  }

  async function removeNote(id) {
    const wasEditing = editingId === id;
    notes = notes.filter((note) => note.id !== id);
    confirmId = null;
    if (wasEditing) editingId = null;
    await Store.write(KEY, notes);
    Panel.toast("Note deleted");
    renderCount();
    if (wasEditing) showList();
    else renderList();
  }

  async function saveNote() {
    const text = $("notes-text").value.trim();
    if (!text) {
      Panel.toast("Write something first");
      return;
    }
    const now = Date.now();
    notes =
      editingId === null
        ? [...notes, { id: Panel.newId(), text, updatedAt: now }]
        : notes.map((note) =>
            note.id === editingId ? { ...note, text, updatedAt: now } : note,
          );
    await Store.write(KEY, notes);
    Panel.toast("Note saved");
    renderCount();
    showList();
  }

  function applyExternal(value) {
    notes = Array.isArray(value) ? value : [];
    renderCount();
    if (editingId === null) renderList();
  }

  async function init() {
    applyExternal(await Store.read(KEY, []));
    unsubscribe = Store.subscribe(KEY, applyExternal);
    $("notes-search").addEventListener("input", (event) => {
      query = event.target.value;
      renderList();
    });
    $("notes-new").addEventListener("click", () => {
      editingId = null;
      confirmId = null;
      $("notes-text").value = "";
      showEditor();
    });
    renderList();
  }

  window.addEventListener("pagehide", () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  });

  Panel.mountNav("notes");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
