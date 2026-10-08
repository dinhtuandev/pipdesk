/* PiPDesk todos panel: add, toggle, inline edit, due dates, active/done split. */
(() => {
  "use strict";

  const KEY = Store.KEYS.TODOS;
  const $ = (id) => document.getElementById(id);
  let todos = [];
  let editingId = null;
  let unsubscribe = null;

  /* One element from props; user text always goes through textContent. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key === "value") node.value = value;
      else if (key === "checked") node.checked = Boolean(value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  const button = (text, cls, onclick) =>
    el("button", { type: "button", class: cls, text, onclick });

  function normalise(value) {
    if (!Array.isArray(value)) return [];
    return value.map((todo) => ({
      id: typeof todo.id === "number" ? todo.id : Panel.newId(),
      text: String(todo.text ?? ""),
      done: Boolean(todo.done),
      due: typeof todo.due === "string" && todo.due ? todo.due : null,
      createdAt: Number(todo.createdAt) || Date.now(),
    }));
  }

  const persist = () => Store.write(KEY, todos);

  /* Soonest due first, undated last, then oldest created first. */
  function byDueThenCreated(a, b) {
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return a.createdAt - b.createdAt;
  }

  function dueBadge(todo) {
    if (!todo.due) return null;
    const today = Panel.localDateKey();
    if (!todo.done && todo.due < today) {
      return el("span", {
        class: "due due--past",
        text: `Overdue · ${Panel.formatDay(todo.due)}`,
      });
    }
    if (!todo.done && todo.due === today) {
      return el("span", { class: "due due--today", text: "Due today" });
    }
    return el("span", { class: "due", text: `Due ${Panel.formatDay(todo.due)}` });
  }

  function metaLine(todo) {
    const badge = dueBadge(todo);
    return el("div", { class: "item__meta" }, [
      badge,
      badge ? document.createTextNode(" · ") : null,
      el("span", { text: `Added ${Panel.timeAgo(todo.createdAt)}` }),
    ]);
  }

  function renderRow(todo) {
    const main = el(
      "button",
      {
        type: "button",
        class: "item__main",
        "aria-label": `Edit: ${todo.text}`,
        onclick: () => {
          editingId = todo.id;
          render();
        },
      },
      [el("div", { class: "item__text todo__text", text: todo.text }), metaLine(todo)],
    );

    return el("div", { class: todo.done ? "item item--done" : "item" }, [
      el("input", {
        type: "checkbox",
        class: "check",
        checked: todo.done,
        "aria-label": `${todo.done ? "Mark as not done" : "Mark as done"}: ${todo.text}`,
        onchange: () => toggleTodo(todo.id),
      }),
      main,
      button("Delete", "btn btn--danger", () => removeTodo(todo.id)),
    ]);
  }

  function renderEditor(todo) {
    return el("div", { class: "item" }, [
      el("div", { class: "edit" }, [
        el("label", { class: "sr-only", for: "todo-edit-text", text: "Todo text" }),
        el("input", {
          type: "text",
          id: "todo-edit-text",
          class: "field",
          value: todo.text,
          onkeydown: (event) => {
            if (event.key === "Enter") saveEdit(todo.id);
            if (event.key === "Escape") cancelEdit();
          },
        }),
        el("label", { class: "sr-only", for: "todo-edit-date", text: "Due date" }),
        el("input", {
          type: "date",
          id: "todo-edit-date",
          class: "field",
          value: todo.due || "",
          onkeydown: (event) => {
            if (event.key === "Escape") cancelEdit();
          },
        }),
        el("div", { class: "row" }, [
          button("Save", "btn btn--primary", () => saveEdit(todo.id)),
          button("Cancel", "btn btn--ghost", cancelEdit),
          button("Delete", "btn btn--danger", () => removeTodo(todo.id)),
        ]),
      ]),
    ]);
  }

  function fill(host, list, emptyText) {
    host.textContent = "";
    if (!list.length) {
      host.appendChild(el("p", { class: "empty", text: emptyText }));
      return;
    }
    for (const todo of list) {
      host.appendChild(todo.id === editingId ? renderEditor(todo) : renderRow(todo));
    }
  }

  function render() {
    const active = todos.filter((todo) => !todo.done).sort(byDueThenCreated);
    const done = todos.filter((todo) => todo.done).sort((a, b) => b.createdAt - a.createdAt);
    $("todos-meta").textContent = active.length === 1 ? "1 active" : `${active.length} active`;
    fill($("todos-active"), active, "No active todos.");
    fill($("todos-done"), done, "Nothing completed yet.");
    const field = editingId !== null ? $("todo-edit-text") : null;
    if (field) field.focus();
  }

  async function addTodo() {
    const input = $("todo-input");
    const text = input.value.trim();
    if (!text) {
      Panel.toast("Write a todo first");
      return;
    }
    todos = [...todos, { id: Panel.newId(), text, done: false, due: null, createdAt: Date.now() }];
    input.value = "";
    await persist();
    render();
  }

  async function toggleTodo(id) {
    todos = todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
    if (editingId === id) editingId = null;
    await persist();
    render();
  }

  async function removeTodo(id) {
    todos = todos.filter((todo) => todo.id !== id);
    if (editingId === id) editingId = null;
    await persist();
    render();
    Panel.toast("Todo deleted");
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  async function saveEdit(id) {
    const text = $("todo-edit-text").value.trim();
    if (!text) {
      Panel.toast("Todo text cannot be empty");
      return;
    }
    const due = $("todo-edit-date").value || null;
    todos = todos.map((todo) => (todo.id === id ? { ...todo, text, due } : todo));
    editingId = null;
    await persist();
    render();
  }

  function applyExternal(value) {
    todos = normalise(value);
    if (editingId === null) render();
  }

  async function init() {
    todos = normalise(await Store.read(KEY, []));
    unsubscribe = Store.subscribe(KEY, applyExternal);
    $("todo-add").addEventListener("click", addTodo);
    $("todo-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") addTodo();
    });
    render();
  }

  window.addEventListener("pagehide", () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  });

  Panel.mountNav("todos");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
