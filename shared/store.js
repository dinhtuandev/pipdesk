/* PiPDesk storage.
 *
 * Local-first: chrome.storage.local is always the source of truth for a write.
 * chrome.storage.sync is used as a mirror, and only when the user turns on
 * "Sync across devices" in the popup. Sync items are split into chunks because
 * chrome.storage.sync rejects any single item over 8192 bytes.
 *
 * Loaded by the panels and by the popup; it only touches chrome.storage. */

const Store = (() => {
  /* chrome.storage.sync rejects an item whose JSON form (value plus key) is
     over 8192 bytes. The budget below leaves room for the key, the quotes and
     JSON escaping, and is measured in UTF-8 bytes rather than characters: a
     note in Vietnamese or with emoji costs more than one byte per character. */
  const SYNC_ITEM_LIMIT = 8000;
  const KEY_HEADROOM = 16;
  const KEYS = {
    NOTES: "notes",
    TODOS: "todos",
    TIMER: "timer",
    SETTINGS: "settings",
  };

  const encoder = new TextEncoder();
  const byteLength = (text) => encoder.encode(text).length;

  /** JSON adds two quotes and escapes some characters; measure that growth. */
  const escapedLength = (char) => byteLength(JSON.stringify(char)) - 2;

  /**
   * Split a serialized record so every chunk fits one sync item. Chunks break
   * on character boundaries, never inside a surrogate pair.
   */
  function splitForSync(serialized, key) {
    const budget = SYNC_ITEM_LIMIT - byteLength(key) - KEY_HEADROOM;
    const chunks = [];
    let current = "";
    let size = 0;

    for (const char of serialized) {
      const cost = escapedLength(char);
      if (size + cost > budget && current) {
        chunks.push(current);
        current = "";
        size = 0;
      }
      current += char;
      size += cost;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  const partKey = (key, index) => `${key}__part_${index}`;
  const partsKey = (key) => `${key}__parts`;
  const baseKeyOf = (storedKey) => {
    const cut = storedKey.indexOf("__part_");
    if (cut !== -1) return storedKey.slice(0, cut);
    if (storedKey.endsWith("__parts")) {
      return storedKey.slice(0, -"__parts".length);
    }
    return null;
  };

  const subscribers = new Set();
  const reading = new Set();

  async function getSettings() {
    const { settings } = await chrome.storage.local.get(KEYS.SETTINGS);
    return { syncEnabled: false, ...(settings || {}) };
  }

  async function setSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
    return next;
  }

  async function syncEnabled() {
    return (await getSettings()).syncEnabled;
  }

  /* --- sync mirror -------------------------------------------------- */

  async function clearSyncParts(key) {
    const everything = await chrome.storage.sync.get(null);
    const stale = Object.keys(everything).filter(
      (name) => name.startsWith(`${key}__part_`) || name === partsKey(key),
    );
    if (stale.length) await chrome.storage.sync.remove(stale);
  }

  async function writeSync(key, value) {
    const serialized = JSON.stringify(value);
    await clearSyncParts(key);
    if (
      byteLength(serialized) + byteLength(key) + 2 <=
      SYNC_ITEM_LIMIT
    ) {
      await chrome.storage.sync.set({ [key]: value });
      return;
    }
    const chunks = splitForSync(serialized, key);
    // A chunked value must not leave the previous small value behind: readers
    // check the direct key first, so a stale one would win.
    await chrome.storage.sync.remove(key);
    const batch = { [partsKey(key)]: chunks.length };
    chunks.forEach((chunk, i) => {
      batch[partKey(key, i)] = chunk;
    });
    // One write keeps other contexts from reading a half-written value.
    await chrome.storage.sync.set(batch);
  }

  async function readSync(key) {
    const direct = await chrome.storage.sync.get(key);
    if (direct[key] !== undefined) return direct[key];

    const counted = await chrome.storage.sync.get(partsKey(key));
    const count = counted[partsKey(key)];
    if (!count) return undefined;

    let serialized = "";
    for (let i = 0; i < count; i += 1) {
      const part = await chrome.storage.sync.get(partKey(key, i));
      serialized += part[partKey(key, i)] || "";
    }
    try {
      return JSON.parse(serialized);
    } catch (error) {
      console.warn(`[PiPDesk] could not decode synced "${key}"`, error);
      return undefined;
    }
  }

  async function dropSync(key) {
    await clearSyncParts(key);
    await chrome.storage.sync.remove(key);
  }

  /* --- public API --------------------------------------------------- */

  async function read(key, fallback) {
    const local = await chrome.storage.local.get(key);
    if (local[key] !== undefined) return local[key];

    if (await syncEnabled()) {
      const remote = await readSync(key);
      if (remote !== undefined) {
        await chrome.storage.local.set({ [key]: remote });
        return remote;
      }
    }
    return fallback;
  }

  async function write(key, value) {
    await chrome.storage.local.set({ [key]: value });
    if (await syncEnabled()) {
      try {
        await writeSync(key, value);
      } catch (error) {
        console.warn(`[PiPDesk] sync mirror failed for "${key}"`, error);
      }
    }
    return value;
  }

  /** Subscribe to changes of one key, from either storage area. */
  function subscribe(key, handler) {
    const entry = { key, handler };
    subscribers.add(entry);
    return () => subscribers.delete(entry);
  }

  // Absent when the file is required by `node --test` rather than a page.
  const watchStorage =
    typeof chrome !== "undefined" && chrome.storage?.onChanged
      ? chrome.storage.onChanged
      : null;

  watchStorage?.addListener(async (changes, area) => {
    if (area === "local") {
      for (const entry of subscribers) {
        if (!(entry.key in changes)) continue;
        try {
          entry.handler(changes[entry.key].newValue);
        } catch (error) {
          console.error("[PiPDesk] subscriber failed", error);
        }
      }
      return;
    }

    if (area !== "sync") return;
    // Turning sync off leaves the mirrored copy in place, but it must stop
    // overwriting local data the moment the user opts out.
    if (!(await syncEnabled())) return;

    const touched = new Set();
    for (const storedKey of Object.keys(changes)) {
      const base = baseKeyOf(storedKey);
      if (base) touched.add(base);
    }

    for (const key of touched) {
      if (reading.has(key)) continue;
      reading.add(key);
      try {
        const remote = await readSync(key);
        if (remote === undefined) continue;
        await chrome.storage.local.set({ [key]: remote });
      } finally {
        reading.delete(key);
      }
    }
  });

  return {
    KEYS,
    read,
    write,
    subscribe,
    getSettings,
    setSettings,
    syncEnabled,
    dropSync,
    splitForSync,
  };
})();

// The panels load this as a plain script; `node --test` requires it.
if (typeof module === "object" && module.exports) {
  module.exports = { Store, splitForSync: Store.splitForSync };
}
