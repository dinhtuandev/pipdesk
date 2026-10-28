# PiPDesk privacy policy

Last updated: 2026-10-28

PiPDesk is a Chrome extension that shows content you choose in a floating
picture-in-picture window. This policy explains what the extension handles and
what it never does.

## What PiPDesk handles

- **Captured pixels.** When you float a tab or a region, Chrome's `tabCapture`
  API hands the extension a live video stream of that tab. The stream is decoded
  and drawn onto a canvas inside a hidden offscreen document in your browser.
  It is never recorded to disk, never sent over a network, and is released when
  you stop the capture or close the floating window.
- **Page interaction.** When you start the region selector or the video
  picture-in-picture action, the extension injects a small script into the tab
  you are on. It draws a selection overlay, or asks the page's video element to
  enter picture-in-picture. It reads no page content beyond what that action
  needs.
- **Your own data.** Notes, to-dos, focus-timer history and settings are stored
  with `chrome.storage.local` on your device. If you turn on "Sync across
  devices", the notes, to-dos and timer data are mirrored to
  `chrome.storage.sync`, which means it is stored in your own Chrome profile by
  Google under Google's terms.
- **The floating button setting.** If you enable the floating badge for a site,
  the extension stores that site's origin and asks Chrome for permission to run
  on that site so the badge can appear there.

## What PiPDesk never does

- No account and no sign-in.
- No analytics, telemetry, crash reporting or advertising.
- No network requests of any kind. The extension contains no remote code and
  loads nothing from the internet.
- No selling, sharing or transferring of user data to third parties.
- No reading of browsing history, passwords, form fields or page text for any
  purpose other than the action you started.

## Retention and deletion

Captured video exists only in memory while a capture is running. Notes, to-dos,
timer history and settings stay in `chrome.storage` until you clear them in the
extension or uninstall PiPDesk, which removes its storage. If sync is enabled,
delete the data in the extension and it is removed from `chrome.storage.sync` as
well; you can also clear synced extension data from your Google account's Chrome
sync settings.

## Permissions

Each permission exists for one visible feature: `activeTab` and `tabCapture` to
float the tab you chose, `offscreen` to run the compositor, `scripting` for the
region selector and video action, `storage` for your notes and settings,
`alarms` and `notifications` for the focus timer and auto-close, `contextMenus`
for Chrome's right-click menu, and optional host access only for sites where you
explicitly enable the floating badge. The YouTube content script places the
Quick PiP control in the player bar.

## Children

PiPDesk is a general-purpose productivity tool and is not directed at children.

## Changes

If this policy changes, the updated version will be published at this URL and
the "Last updated" date above will change.

## Contact

Questions about this policy: <trandinhtuan0219@gmail.com>
You can also reach the author at <https://github.com/dinhtuandev>.
