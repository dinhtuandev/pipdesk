# PiPDesk

A Chrome extension that keeps the things you want to watch **on top of whatever
you are doing** — a whole tab, one region of a page, a video, or your own notes,
to-do list and focus timer.

Built as a personal, dependency-free Chrome MV3 extension. There is no account,
no server, no telemetry and no monetisation layer: everything lives in
`chrome.storage` on your machine (optionally mirrored through your Chrome
profile when you turn on sync).

## Features

| Feature | What it does |
| --- | --- |
| Whole tab PiP | Captures the tab with `chrome.tabCapture` and floats it in a picture-in-picture window. |
| Selected region PiP | Drag a box over any part of a page; only that rectangle floats. |
| Page video PiP | Hands a video element on the page to the browser's native picture-in-picture. |
| Notes | Capture-and-go notes in their own floating panel. |
| Todos | Active/done split, due dates with overdue highlighting, inline editing. |
| Focus timer | Pomodoro with work / short / long breaks, daily history and a system notification when a session ends. |
| Optional sync | One switch mirrors notes, todos and timer through `chrome.storage.sync`. |

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin the extension, then click its icon on any page.

Requires Chrome 116 or newer (document Picture-in-Picture). If a page refuses a
document PiP window, the panel falls back to a small standalone window.

## Using it

- **Whole tab / Selected region / Page video** start a floating window for the
  current tab. Press `Esc` while selecting a region to cancel.
- **Panels** open Notes, Todos or Focus in their own always-on-top window, with
  a bottom nav to switch between them.
- **Stop PiP** ends the current capture and releases the tab stream.

## How it is put together

```text
manifest.json              MV3 manifest — no host permissions, no content scripts
background/service-worker.js  state, capture orchestration, offscreen lifecycle, alarms
offscreen/                 tab capture, region cropping, PiP promotion
content/content.js         region selection overlay + native video PiP
popup/                     the toolbar popup
panels/                    notes, todos, timer (rendered inside the PiP window)
shared/                    design tokens, panel styles, storage, panel helpers
tools/make-icons.py        regenerates icons/*.png from code
```

Design notes worth knowing before you change things:

- **Local-first storage.** `chrome.storage.local` is always written first; the
  sync mirror is written only when the user enables it. Sync items are chunked
  because a single `chrome.storage.sync` item is capped at 8 KB.
- **Local dates.** Day keys (`YYYY-MM-DD`) use the user's calendar day, never
  UTC — otherwise daily stats drift for anyone outside UTC.
- **Escaping.** All user text is passed through `Panel.escapeHtml` before it
  reaches `innerHTML`.
- **Narrow web surface.** Only the three panel HTML files are web-accessible,
  with `use_dynamic_url` enabled. The content script is injected on demand
  instead of being declared for every page.

## Development

```bash
node --check background/service-worker.js   # syntax check a source file
python tools/make-icons.py                  # regenerate the icon set
```

After editing, press the reload button for the extension on
`chrome://extensions`, then reload any tab you were testing on.

## Privacy

No network requests, no analytics, no accounts. Captured pixels stay in an
offscreen document in your browser and are never uploaded. "Sync across
devices" uses Google's own `chrome.storage.sync`, which means the data you
choose to sync is stored in your Chrome profile.

## License

MIT — see [LICENSE](LICENSE). Replace the copyright holder in that file with
your own name before publishing.
