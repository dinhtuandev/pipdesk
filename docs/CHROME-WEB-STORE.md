# Đưa PiPDesk lên Chrome Web Store

Tài liệu này gồm: những gì đã có, những gì còn thiếu, nội dung copy-paste cho
listing, câu trả lời Privacy practices, hướng dẫn cho reviewer và thứ tự nộp.

---

## 1. Hiện trạng

| Hạng mục | Trạng thái |
| --- | --- |
| Manifest V3, không remote code | ✅ |
| Icon 16 / 48 / 128 px | ✅ `icons/` |
| Tên ≤ 45 ký tự | ✅ `PiPDesk — Picture-in-Picture Workspace` (38) |
| Summary ≤ 132 ký tự | ✅ (xem mục 3) |
| Trang hướng dẫn tương tác | ✅ `welcome/` |
| Chính sách quyền riêng tư | ✅ live tại `https://dinhtuandev.github.io/pipdesk/privacy-policy.html` (GitHub Pages từ `main` → `/docs`) |
| Screenshot 1280 × 800 (1–5 ảnh) | ✅ `store/01…04-*.png` (4 ảnh, tái tạo bằng script) |
| Promo tile 440 × 280 | ✅ `store/promo-440x280.png` (không bắt buộc) |
| Tài khoản developer + 2FA | ❌ cần đăng ký (phí một lần 5 USD) |
| Privacy practices / lý do từng quyền | ✅ soạn sẵn ở mục 4 |
| Hướng dẫn test cho reviewer | ✅ soạn sẵn ở mục 6 |

---

## 2. Checklist kỹ thuật trước khi nộp

1. Chạy toàn bộ kiểm tra trong `AGENTS.md`:

   ```bash
   for f in $(find . -name '*.js' -not -path './node_modules/*'); do node --check "$f" || exit 1; done
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
   node --test
   ```

2. Cài thử trên **profile Chrome sạch** (Load unpacked):
   - Tab tour tự mở đúng một lần khi cài mới; reload extension không mở lại.
   - Không có `Unchecked runtime.lastError` trong console service worker.
   - Bấm thử 1 → 4 source, Focus, Workspace, kéo vùng chọn, mở popup.
3. Kiểm tra tab **Help** trong popup mở được tour.
4. Không có network call: `grep -rn "fetch(\|XMLHttpRequest\|WebSocket" --include=*.js .`
5. Tăng `version` trong `manifest.json` cho **mỗi** lần upload (store không cho
   trùng version đã duyệt).
6. Đóng gói và kiểm tra (validate manifest, icon, không có network call, mọi
   file được tham chiếu đều có trong gói):

   ```bash
   python tools/package.py        # ghi dist/pipdesk-<version>.zip
   ```

   Chrome bỏ qua file thừa, nhưng gói gọn giúp review nhanh hơn và tránh lộ
   ghi chú nội bộ (`docs/`, `tools/`, `tests/`, `store/`, `.git/`).

---

## 3. Store listing (copy-paste, tiếng Anh)

**Name** (≤ 45)

```text
PiPDesk — Picture-in-Picture Workspace
```

**Summary** (≤ 132)

```text
Float a tab, a page region, a video, or your notes, to-dos and focus timer above your work. No account, no uploads.
```

**Category:** Productivity
**Language:** English

**Detailed description**

```text
PiPDesk keeps the things you watch and the tools you need on top of whatever you
are doing — in one picture-in-picture window.

WHAT YOU CAN FLOAT
• A whole tab. Capture the page you are on and keep it visible while you work
  somewhere else.
• One region of a page. Drag a box and only that rectangle floats; the rest of
  the page stays out.
• A video. On sites you enable, a small control floats the page's own video with
  the browser's native picture-in-picture.
• Your own tools. Notes, a to-do list and a Pomodoro focus timer live in the
  same floating window, and the notes copy out as Markdown when you need them
  elsewhere.

UP TO FOUR SOURCES, ONE WINDOW
Chrome only allows one document picture-in-picture window per tab, so PiPDesk
composes every source onto a single canvas: one source fills the frame, two sit
side by side, three or four share a 2×2 grid. Focus a row to see one alone, or
switch to the workspace layout and keep a panel next to the capture.

BUILT TO STAY OUT OF THE WAY
• Keyboard shortcuts: Alt+Shift+P floats the tab, Alt+Shift+R starts a region,
  Alt+Shift+X stops everything.
• Auto close a capture after 15, 25 or 50 minutes.
• Optional sync of notes, to-dos and timer through your own Chrome profile.

PRIVATE BY DESIGN
No account, no server, no analytics. Captured pixels are decoded and drawn
inside the extension and never leave your computer. Notes, to-dos and timer
history are stored in chrome.storage on your machine.

Requires Chrome 116 or newer.
```

**Screenshots** — đã có 4 ảnh 1280 × 800 trong `store/`, chụp từ giao diện
thật của extension (không phải mockup), kèm promo tile 440 × 280:

| File | Nội dung |
| --- | --- |
| `store/01-shared-window.png` | Tour: “One canvas, up to four sources” với 2 nguồn đang chia canvas. |
| `store/02-region.png` | Tour: kéo một vùng chọn, chỉ hộp đó hiển thị. |
| `store/03-popup.png` | Popup toolbar: Tab/Video, Auto close, Own panels, các công tắc footer. |
| `store/04-panels.png` | Panel Notes (có dữ liệu mẫu) và Focus cùng lịch sử 7 ngày. |
| `store/promo-440x280.png` | Promo tile (không bắt buộc). |

Tái tạo sau khi UI đổi (yêu cầu Chromium có `--load-extension`, ví dụ bản
Playwright; ảnh chỉ ghi vào profile tạm thời do script xoá):

```bash
node tools/store-shots.mjs      # chụp store/raw/*.png từ extension thật
python tools/store-assets.py    # ghép thành 4 ảnh 1280×800 + promo tile
```

`CHROME_PATH=/path/to/chrome` nếu muốn chỉ đích Chromium riêng. Cảnh báo: ảnh
chụp panel dùng dữ liệu mẫu (`seedSampleData` trong script) để giao diện không
trống; nếu bạn không muốn, xoá câu gọi đó trước khi chụp lại.

**Promo tile** đã có sẵn: `store/promo-440x280.png` (440 × 280, nền `#0d1017`,
icon + tên + dòng “Float a tab, a region, a video, or your own notes and timer
above your work.”)

---

## 4. Privacy practices (copy-paste)

**Single purpose**

```text
PiPDesk shows content the user chooses — a tab, a page region, a page video, or
the extension's own notes, to-dos and timer — in a floating picture-in-picture
window on top of other windows.
```

**Permission justifications**

| Permission | Justification (EN) |
| --- | --- |
| `activeTab` | Starts a capture on the tab the user is looking at, only after they click the toolbar button or use a shortcut. |
| `tabCapture` | Core feature: captures the pixels of the tab the user chose so they can be shown in the floating window. |
| `offscreen` | Runs the capture, crop and canvas compositor in a hidden document. An MV3 service worker cannot hold a MediaStream. |
| `scripting` | Injects the region-selection overlay and the video picture-in-picture call into the current tab on demand, and manages per-site float scripts the user enables. |
| `storage` | Stores notes, to-dos, timer history and settings locally; sync is opt-in. |
| `alarms` | Ends a focus session and auto-closes a capture after the chosen minutes, even when the service worker is idle. |
| `notifications` | Tells the user when a focus session ends. |
| `contextMenus` | Adds PiPDesk actions (float tab, float region, stop) to Chrome's page right-click menu. |
| Optional host permissions (`https://*/*`, `http://*/*`) | Optional and off by default. Requested only when the user turns on the floating badge for one specific site, so the badge can appear on that site's pages. |
| Content script on `https://www.youtube.com/*` | Places the Quick PiP control in the YouTube player bar. It must run on YouTube pages to receive the user's click. |

**Remote code:** No, all logic ships in the package.

**Data usage:** the extension does not collect, sell or share user data, and makes
no network requests. Captured frames are processed in memory in the offscreen
document. Website content is processed only locally and never transmitted.

**Privacy policy URL:** `https://dinhtuandev.github.io/pipdesk/privacy-policy.html`
(xem mục 5).

---

## 5. Chính sách quyền riêng tư

**URL đã live và dán thẳng vào listing:**

```text
https://dinhtuandev.github.io/pipdesk/privacy-policy.html
```

Nó là GitHub Pages của chính repo này: nhánh `main`, thư mục `/docs`, bật sẵn
qua `POST /repos/dinhtuandev/pipdesk/pages` (không còn phải cấu hình tay).

Hai bản nội dung luôn phải khớp nhau:

- `docs/privacy-policy.md` — bản dễ đọc khi review trong repo,
- `docs/privacy-policy.html` — bản Pages thật sự phục vụ (Jekyll chỉ copy file
  không có front matter, nên Markdown sẽ không tự render thành HTML).

Sửa nội dung → cập nhật cả hai file → `git push` → Pages tự build lại trong
khoảng một phút.

Lưu ý: dữ liệu trong policy (email, URL) cũng phải khớp phần “Contact” của
Chrome Web Store. Nếu đổi domain hoặc xoá repo thì URL này chết, khi đó bật
lại Pages hoặc cập nhật listing ngay.

Trong listing, mục **Contact email** điền `trandinhtuan0219@gmail.com`, mục
**Support contact URL** điền `https://github.com/dinhtuandev` (không bắt buộc
nhưng có thì reviewer hỏi ít hơn).

---

## 6. Hướng dẫn cho reviewer (copy-paste)

```text
PiPDesk needs a real user gesture and a normal web page. To test:

1. Install and open any https page (for example https://example.com).
2. Click the PiPDesk toolbar icon, keep mode "Tab", press "Whole tab". A
   floating window appears. Click "Stop PiP" to end it.
3. Click the icon again, press "Selected region", drag a box on the page and
   press "Show in PiP".
4. Open the icon → tab Help → "Open the interactive tour" to see the layout
   explained without capturing anything.
5. On https://www.youtube.com, start any video. A PiPDesk button appears in the
   player controls (left click floats the video, right click opens actions).
6. Optional: enable "Float button on this site" for a site in the popup footer
   and accept the optional host permission prompt.

Known limitations by design:
- chrome:// pages, the Chrome Web Store and other extension pages cannot be
  captured; Chrome blocks tabCapture there.
- Opening a document picture-in-picture window requires the user's click, so the
  shortcut keys cover tab, region and stop but not video mode.
- On browsers older than Chrome 116 the workspace/panel windows fall back to a
  small standalone window.
```

---

## 7. Thứ tự nộp

1. Đăng ký Chrome Web Store developer (5 USD một lần), bật 2FA cho tài khoản
   Google.
2. Xác minh email, điền thông tin trader (EU DSA) — dự án cá nhân miễn phí có
   thể chọn “non-trader”.
3. Upload `pipdesk-<version>.zip`, sửa các lỗi manifest nếu có.
4. Điền listing (mục 3), tải screenshot và promo tile.
5. Điền Privacy practices (mục 4), dán URL privacy policy.
6. Dán hướng dẫn reviewer (mục 6), chọn phân phối (Public, tất cả khu vực, miễn
   phí).
7. Submit. Review thường 1–7 ngày; trả lời email của reviewer kèm video quay
   màn hình nếu họ không tái hiện được `tabCapture`.
8. Sau khi publish: tăng `version` mỗi bản, cập nhật screenshot khi UI đổi,
   không thêm remote code, không mở rộng quyền mà không có lý do.

---

## 8. Rủi ro review cần lường trước

- **`optional_host_permissions` cho mọi site**: hợp lệ nhưng reviewer hay hỏi.
  Lý do đã có ở mục 4; nếu bị hỏi lại, quay video bật badge cho một site và
  prompt quyền xuất hiện.
- **`tabCapture`**: cần thao tác người dùng thật. Reviewer test bằng DevTools
  hoặc tab `chrome://` sẽ luôn thất bại — hướng dẫn ở mục 6 nói rõ.
- **YouTube content script**: chỉ một match pattern, đúng single purpose.
- **Mô tả không khớp chức năng**: mọi tính năng trong mô tả đều có trong bản
  nộp; không hứa “background audio”, “download”, “edit video”.
- **Dữ liệu nhạy cảm**: dù không upload, hãy khai báo trung thực rằng extension
  xử lý nội dung trang cục bộ; privacy policy nêu rõ không lưu/không gửi.
