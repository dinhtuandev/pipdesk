# AGENTS.md

Working notes for anyone (human or agent) making changes in this repository.

## What this is

An unpacked Chrome MV3 extension. No build step, no bundler, no dependencies,
no package manager. Edit a file, reload the extension at `chrome://extensions`,
reload the tab you are testing.

## Layout

- `background/service-worker.js` — the only stateful authority. Owns capture
  state, the offscreen document lifecycle, panel windows and the timer alarm.
- `offscreen/` — `chrome.tabCapture` stream decoding, region cropping, and
  promotion of a video element into picture-in-picture.
- `offscreen/layout.js` — where each source sits on the composite canvas. Pure
  on purpose: `tests/layout.test.js` covers it with `node --test`.
- `content/content.js` — injected on demand by the service worker. Region
  selection overlay plus native video PiP. Never declared in the manifest.
- `content/youtube.js` — the one declared content script. Puts the Quick PiP
  control into YouTube's player bar and owns the menu behind its right click.
- `popup/` — the toolbar popup. Sends messages, renders returned state.
- `panels/` — notes, todos and timer. These run as extension pages inside a
  document picture-in-picture window.
- `shared/` — tokens, panel styles, `Store`, and `Panel` helpers. Loaded as
  plain scripts; globals `Store` and `Panel`.

## Conventions

- Plain ES2020, no modules, no frameworks. Each panel script stays under ~200
  lines.
- Never hardcode a colour outside `shared/tokens.css`. Two exceptions, both
  because the file cannot load the token stylesheet: `rgba()` scrims in
  `content/content.js`, and the YouTube control in `content/youtube.js`, which
  follows YouTube's own `--yt-spec-*` variables with rgba fallbacks so it
  matches whatever theme the page happens to use.
- Never pass user text to `innerHTML` without `Panel.escapeHtml`. Prefer
  `textContent`.
- Storage goes through `Store`. `chrome.storage.local` is written first; sync is
  a mirror, never the primary.
- Day keys come from `Panel.localDateKey()`. Do not use `toISOString()` for a
  calendar day.
- Timers and listeners must be cleared on pause, reset and unload.
- A picture-in-picture request only succeeds from a context that still holds the
  click's user activation. Calls that travel popup → service worker → content
  script lose it and Chrome answers `NotAllowedError`, which is why the popup
  and the YouTube control call `video.requestPictureInPicture()` themselves, and
  why the `commands` shortcuts cover tab, region and stop but never video mode.
- One document tree can only hold one picture-in-picture window: a second request
  from the offscreen document or one of its iframes replaces the first (measured,
  TC-I2). Several sources therefore share a single canvas in
  `offscreen/offscreen.js`; do not go back to assuming one capture per window.
- Anything added to the manifest requires a reason: permissions here are
  intentionally narrow (`activeTab`, `tabCapture`, `offscreen`, `scripting`,
  `storage`, `alarms`, `notifications`, `contextMenus`). The only host access is
  the `https://www.youtube.com/*` match the Quick PiP control needs; every other
  page stays behind `activeTab`. Only three web-accessible files.

## Checks before you commit

```bash
for f in $(find . -name '*.js' -not -path './node_modules/*'); do node --check "$f" || exit 1; done
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --test                # layout maths lives in tests/*.test.js
python tools/make-icons.py   # only when the icon artwork changes
```

Then confirm by hand: load the folder unpacked, click each capture mode on a
normal page, open each panel, and confirm no message reaches the service worker
that it cannot answer (`Unsupported message:` in the console).
