# PiPDesk — Checklist test E2E thủ công

Bộ kịch bản này để bạn tự chạy extension `pipdesk` trong Chrome thật và ghi lại
kết quả. Mỗi ca có một thao tác, một kết quả kỳ vọng, và một neo trong mã để
đối chiếu. Mọi chuỗi trong dấu `backtick` là chuỗi hiển thị trên UI; hãy so
nguyên văn, kể cả dấu `·` và dấu `—`. Vài chuỗi được ghép lúc chạy (ví dụ hint
của `Stop PiP` ghép nhãn chế độ với ` is floating`), nên dòng "Neo" ghi rõ chỗ
tạo ra chúng.

## 1. Chuẩn bị môi trường

1. Chrome từ 116 trở lên (`manifest.json` khai báo `minimum_chrome_version` là
   `116`).
2. Mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và
   trỏ tới thư mục `D:\PiP\pipdesk`.
3. Ghim PiPDesk lên thanh công cụ.
4. Mở sẵn bốn tab: một trang web thường, một trang có video đang phát,
   `https://chromewebstore.google.com` (trang bị Chrome chặn inject script), và
   `chrome://extensions`.
5. Mở DevTools của service worker: tại `chrome://extensions`, bấm liên kết
   **service worker** của PiPDesk.
6. Biết cách mở DevTools của popup: bấm chuột phải vào popup rồi chọn
   **Inspect**.
7. Sau mỗi lần sửa mã: bấm nút reload của extension ở `chrome://extensions`,
   rồi reload tab đang test.

## 2. Cách ghi kết quả

Mỗi ca ghi một trong ba trạng thái: **Đạt**, **Không**, **Không tái hiện**.
Ghi chú bắt buộc khi kết quả không Đạt, kèm ảnh chụp hoặc dòng console nếu có.
Tổng hợp vào bảng ở mục 14.

## 3. Nhóm A — Popup và trạng thái

### TC-A1 — Trạng thái popup lúc chưa có gì nổi
- Thao tác: đang ở tab trang thường, bấm icon PiPDesk.
- Kỳ vọng: có bộ chọn mode `Tab` / `Video` với `Tab` đang được chọn, và **một**
  nút hành động ghi `Whole tab` / `Everything on the page`; nút `Selected region`
  vẫn riêng một nút; `Stop PiP` không hiện; ô note trống; góc dưới phải hiện
  `v0.1.0`; công tắc `Sync across devices` đang tắt.
- Neo: `popup/popup.js` — `setPipMode("tab")` lúc mở popup, `render()` với
  `state` rỗng cho `live = false`, `updateToggleState()` khoá mode `Video` khi
  trang không có video; `loadSyncSwitch()` đọc `syncEnabled` mặc định `false`
  trong `shared/store.js`. Lưu ý: popup giữ một port `"popup"` (`holdPort()`),
  nên mở popup là service worker đã tạo sẵn offscreen document và stream của tab
  (xem TC-A4).

### TC-A2 — Mở popup ở tab khác không đổi trạng thái
- Thao tác: bật một PiP toàn tab ở tab A, rồi chuyển sang tab B và mở popup.
- Kỳ vọng: popup ở tab B vẫn hiện trạng thái đang nổi (chấm sáng, `Stop PiP`
  hiện) vì trạng thái nằm ở service worker, không theo tab.
- Neo: `background/service-worker.js` — `state` là biến toàn cục; `get-state`.

### TC-A3 — Nút Stop bị khoá khi không có gì nổi
- Thao tác: ở trạng thái rảnh, kiểm tra nút `Stop PiP` trong popup.
- Kỳ vọng: nút có `hidden` và `disabled`; hint `Nothing is floating yet`.
- Neo: `popup/popup.html` — `#stop`; `popup/popup.js` — `els.stop.hidden = !live`.

### TC-A4 — Mở và đóng popup không dựng sẵn stream
- Thao tác: mở popup trên tab thường, chờ khoảng một giây, rồi chạy
  `await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]})`
  trong console service worker; sau đó đóng popup và chạy lại lệnh.
- Kỳ vọng: cả hai lần đều trả về **mảng rỗng** — popup không còn xin stream
  trước, vì mỗi nguồn tự xin stream riêng lúc được tạo. Nếu popup bị đóng trong
  khi có nguồn đang nổi thì các nguồn vẫn còn nguyên.
- Neo: `background/service-worker.js` — `onConnect` không còn warm-up; nhánh
  `port.onDisconnect` chỉ dọn khi `selecting` sai và `listSources()` rỗng.

### TC-A5 — Đổi mode không tự chạy capture
- Thao tác: trên trang có video, mở popup rồi bấm qua lại `Tab` và `Video`, sau
  đó đóng popup mà không bấm nút hành động.
- Kỳ vọng: không cửa sổ PiP nào mở; nhãn nút hành động đổi theo mode
  (`Whole tab` ↔ `Video on the page`); console service worker không nhận thêm
  message nào từ hai cú bấm đó.
- Neo: `popup/popup.js` — `setPipMode()` chỉ sửa state cục bộ của popup và ghi
  `MODE_COPY`; message chỉ được dựng trong handler của nút `#cap-start`.

### TC-A6 — Bật nút float cho site không phải YouTube
- Thao tác: mở một trang thường có video HTML5 (không phải YouTube), mở popup,
  bật hàng float cho site, cho phép quyền khi Chrome hỏi, rồi tải lại trang.
- Kỳ vọng: hộp xin quyền chỉ nêu đúng origin của trang đó; sau khi cho phép và
  tải lại, badge float hiện ở góc video; tắt hàng đó rồi tải lại thì badge biến
  mất.
- Neo: `manifest.json` — `optional_host_permissions`; `background/service-worker.js`
  — nhánh `float-site-toggle` gọi `chrome.permissions.request` rồi
  `registerFloatScript()`; `popup/popup.js` — hàng float lấy trạng thái qua
  `float-site-status`.

### TC-A7 — Site chưa cấp quyền thì không chèn script
- Thao tác: ở một trang chưa bật quyền, mở popup và xem console của service
  worker.
- Kỳ vọng: không có badge float trên trang; popup hiện hàng float ở trạng thái
  tắt; console không có lỗi kiểu `Cannot access contents of the page`.
- Neo: `background/service-worker.js` — `syncFloatScripts()` / `floatSiteStatus()`
  chỉ chèn khi `chrome.permissions.contains` trả `true`.

## 4. Nhóm B — Whole tab

### TC-B1 — Bắt đầu PiP toàn tab
- Thao tác: ở tab trang thường, mở popup, chọn mode `Tab` rồi bấm nút hành động
  (`Whole tab`).
- Kỳ vọng: popup tự đóng; một cửa sổ PiP hiện nội dung của tab và cập nhật
  theo tab.
- Neo: `background/service-worker.js` — `startFullTabPip()` đặt
  `mode: "full"`; `offscreen/offscreen.js` — `sourceVideo.requestPictureInPicture()`.

### TC-B2 — Trạng thái khi đang nổi
- Thao tác: trong lúc PiP đang mở, mở lại popup.
- Kỳ vọng: chấm trạng thái sáng; nút `Stop PiP` hiện kèm hint
  `The whole tab is floating`; cả ba nút capture bị làm mờ.
- Neo: `popup/popup.js` — `render()` tính `live = Boolean(state.mode)`, gán
  `MODE_LABEL.full` vào hint và `button.disabled = live`.

### TC-B3 — Thoát bằng nút đóng của cửa sổ PiP
- Thao tác: đóng cửa sổ PiP bằng nút `X` của chính nó, rồi mở lại popup.
- Kỳ vọng: popup trở về trạng thái rảnh (`Stop PiP` ẩn, ba nút capture bật).
- Neo: `offscreen/offscreen.js` — `leavepictureinpicture` (khi cờ `closing` tắt)
  gọi `stopAll()` rồi báo `pip-exited`; `background/service-worker.js` — nhánh
  `pip-exited` xoá cờ `selecting`, đóng offscreen document và `broadcast()`.

### TC-B4 — Bấm Stop PiP
- Thao tác: đang nổi PiP toàn tab, mở popup và bấm `Stop PiP`.
- Kỳ vọng: cửa sổ PiP đóng; popup hiện note `Stopped.`; và trong console
  service worker `await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]})`
  trả về mảng rỗng.
- Neo: `background/service-worker.js` — `stopPip()` gọi `stopTabStream()` (gửi
  `stop` rồi `closeOffscreen()`); `popup/popup.js` — `okText: "Stopped."`.

### TC-B5 — Đóng tab nguồn khi đang nổi
- Thao tác: đang nổi PiP toàn tab, đóng tab nguồn.
- Kỳ vọng: ghi nhận thực tế (cửa sổ PiP có thể trắng hoặc tự đóng). Theo mã,
  chỉ khi trình duyệt bắn `leavepictureinpicture` thì service worker mới trở về
  trạng thái rảnh.
- Neo: `offscreen/offscreen.js` — `leavepictureinpicture`; không có nhánh xử lý
  `chrome.tabs.onRemoved`.

## 5. Nhóm C — Selected region

### TC-C1 — Chọn vùng và nổi đúng vùng đó
- Thao tác: trên trang có một khối nội dung tự cập nhật (ví dụ đồng hồ đang
  chạy), mở popup, bấm `Selected region`, kéo một vùng lớn hơn 24 × 24 px, rồi
  bấm `Show in PiP`.
- Kỳ vọng: trong lúc kéo, overlay tối đi và hiện hộp đúng vùng đang kéo, badge
  kích thước dạng `640 × 360`, thanh hành động có `Show in PiP` và `Cancel`.
  Sau khi bấm `Show in PiP`: overlay biến mất, cửa sổ PiP chỉ chứa đúng vùng đã
  chọn và tự cập nhật khi nội dung đó thay đổi.
- Neo: `content/content.js` — `paint()` và `sendSelection()`;
  `offscreen/offscreen.js` — `startCustomPip()` chỉ gọi PiP sau `waitForData()`,
  `drawCropFrame()` quy đổi theo `scaleX`/`scaleY` và vẽ bằng
  `requestVideoFrameCallback` lên `cropCanvas.captureStream(30)`.

### TC-C2 — Esc để huỷ khi đang chọn
- Thao tác: bấm `Selected region` rồi nhấn `Esc` (chưa kéo vùng nào).
- Kỳ vọng: overlay biến mất ngay; mở lại popup thấy ba nút capture bật và
  `Stop PiP` ẩn.
- Neo: `content/content.js` — `onKeyDown` gọi `teardown("cancel")`, hàm này gửi
  `selection-cancelled`; `background/service-worker.js` —
  `cancelRegionSelection()` đặt `selecting = false` rồi `broadcast()`.

### TC-C3 — Vùng nhỏ hơn ngưỡng không được chấp nhận
- Thao tác: bấm `Selected region`, kéo một hộp khoảng 20 × 20 px, rồi nhấn
  `Enter`.
- Kỳ vọng: thanh hành động không xuất hiện, không có PiP nào mở, overlay vẫn
  còn nguyên để kéo lại.
- Neo: `content/content.js` — `MIN_SIDE = 24`; `paint()` ẩn thanh khi một cạnh
  nhỏ hơn ngưỡng, `sendSelection()` thoát sớm theo cùng điều kiện, và
  `onPointerDown()` bỏ qua sự kiện có `target` nằm trong thanh hành động.

### TC-C4 — Bấm Cancel trên overlay
- Thao tác: bấm `Selected region`, kéo một vùng hợp lệ, rồi bấm `Cancel`.
- Kỳ vọng: overlay biến mất; mở lại popup thấy ba nút capture bật và `Stop PiP`
  ẩn, tức không còn trạng thái treo.
- Neo: `content/content.js` — nút `Cancel` gọi `cancelSelection()` →
  `teardown("cancel")`, cùng đường thoát với phím `Esc` nên có gửi
  `selection-cancelled`; `background/service-worker.js` —
  `cancelRegionSelection()`.

### TC-C5 — Đổi kích thước cửa sổ khi đang chọn
- Thao tác: bấm `Selected region` rồi kéo thay đổi kích thước cửa sổ.
- Kỳ vọng: overlay tự gỡ, và mở lại popup thấy trạng thái rảnh như TC-C4.
- Neo: `content/content.js` — `window.addEventListener("resize", onViewportChange)`
  gọi `teardown("cancel")`.

### TC-C6 — Vùng chọn không mở được PiP thì phải nói rõ lý do
- Thao tác: chọn một vùng rồi bấm `Show in PiP`; nếu không cửa sổ PiP nào hiện
  ra, mở lại popup.
- Kỳ vọng: popup hiện note đỏ nêu đúng bước hỏng (lỗi từ offscreen document,
  hoặc `The tab stream is not ready.`), thay vì im lặng như trước.
- Neo: `background/service-worker.js` — `lastError` được ghi ở nhánh
  `offscreen-error` và ở `catch` của `chrome.runtime.onMessage`, trả về qua
  `get-state`; tập `ACTION_MESSAGES` xoá nó khi một hành động mới bắt đầu;
  `popup/popup.js` — `DOMContentLoaded` đọc `response.error` rồi gọi
  `setNote(..., "error")`.

### TC-C7 — Chọn vùng theo phần tử (một cú bấm)
- Thao tác: mở chế độ chọn vùng, di chuột lần lượt qua một khối văn bản, một
  ảnh và một khung video, rồi bấm một cái vào phần tử muốn cắt.
- Kỳ vọng: khung nét đứt bám theo phần tử đang trỏ mà không cần kéo; cú bấm chốt
  đúng khung đó; nút `Show in PiP` bấm được và cửa sổ PiP cắt đúng vùng vừa chốt.
  Bấm vào phần tử khác thì vùng chọn đổi sang phần tử mới.
- Neo: `content/content.js` — `elementAt()` tạm tắt `pointer-events` của lớp phủ
  để `elementFromPoint` trả phần tử thật, `paintHover()` vẽ `ui.hover`, nhánh
  `onPointerMove` khi chưa kéo, và nhánh `onPointerUp` chọn theo phần tử khi cạnh
  kéo nhỏ hơn `MIN_SIDE`.

### TC-C8 — Kéo tay vẫn giữ nguyên hành vi cũ
- Thao tác: kéo một vùng lớn hơn ngưỡng nhỏ.
- Kỳ vọng: khung vẽ theo con trỏ đúng như trước, không nhảy sang chế độ chọn
  phần tử; payload gửi đi vẫn là `{ rect, viewport }`.
- Neo: `content/content.js` — `onPointerUp` chỉ rẽ sang chọn phần tử khi cả hai
  cạnh dưới `MIN_SIDE`.

### TC-C9 — Tinh chỉnh vùng bằng bàn phím
- Thao tác: sau khi chốt vùng, bấm các phím mũi tên; giữ `Ctrl` rồi bấm mũi tên;
  cuối cùng bấm `Esc`.
- Kỳ vọng: mũi tên dịch khung từng pixel, `Ctrl` + mũi tên đổi kích thước, khung
  không vượt ra ngoài viewport; `Esc` xoá vùng chọn và nút `Show in PiP` trở về
  trạng thái chờ.
- Neo: `content/content.js` — `nudgeRect()` gọi trong `onKeyDown`;
  `clearSelection()` xoá cả `hoverRect`.

## 6. Nhóm D — Video trên trang

### TC-D1 — Nổi video bằng PiP gốc của trình phát
- Thao tác: mở tab có video, phát video, mở popup và chờ chấm báo cạnh chữ
  `Video` xuất hiện, rồi bấm nút hành động (`Video on the page`).
- Kỳ vọng: mode `Video` được chọn sẵn ngay khi mở popup; cửa sổ PiP gốc của
  trình phát hiện ra; popup đóng. Đây là ca từng hỏng trên YouTube: video hợp lệ
  nhưng lời gọi đi vòng qua service worker trả `NotAllowedError`.
- Neo: `popup/popup.js` — `updateToggleState(true)` gọi `setPipMode("video")` khi
  người dùng chưa tự chọn mode; ở mode `Video`, nút hành động chạy
  `startVideoPipFromPopup()`, hàm này inject `content/content.js` rồi gọi
  `chrome.scripting.executeScript({ target, func: () => window.__pipDeskStartVideoPip() })`
  để giữ activation của cú bấm, sau đó báo service worker bằng `video-pip-started`;
  `content/content.js` — `startVideoPip()` duyệt thẳng
  `document.querySelectorAll("video")` và chỉ bỏ qua video thiếu nguồn, thiếu kích
  thước hoặc đang ẩn; khi mọi lần thử đều bị từ chối, thông báo mang thêm tên
  ngoại lệ (xem TC-D5).

### TC-D2 — Trang không có video
- Thao tác: mở popup trên một trang không có thẻ `video`, thử bấm mode `Video`.
- Kỳ vọng: mode `Video` bị khoá và có tooltip `No video on this page`; `Tab` vẫn
  đang được chọn và nút hành động ghi `Whole tab`.
- Neo: `background/service-worker.js` — `checkVideo()` gọi `check-for-videos`;
  `content/content.js` — `hasPlayableVideo()` dùng lại `isPlayable()`;
  `popup/popup.js` — `updateToggleState(false)`.
- Nhánh dự phòng: nếu video biến mất giữa lúc dò và lúc bấm thì `run()` hiện
  note đỏ `No playable video found on this page.` và bật lại các nút.

### TC-D5 — Mọi video trên trang đều từ chối PiP
- Thao tác: trên tab YouTube, chạy trong console của trang
  `document.querySelectorAll("video").forEach((v) => (v.disablePictureInPicture = true))`
  rồi mở popup, để mode `Video` và bấm nút hành động.
- Kỳ vọng: mode `Video` vẫn bật vì tiêu chí mới không xét `disablePictureInPicture`;
  note đỏ **bắt đầu bằng** `This page refused picture-in-picture. (` kèm tên ngoại
  lệ trong ngoặc, và các nút capture được bật lại. Tên ngoại lệ có thể khác nhau
  giữa các máy nên chỉ so phần tiền tố. Console của trang có một dòng
  `[PiPDesk] video PiP refused` cho mỗi video đã thử, kèm `readyState`,
  `videoWidth` và tên ngoại lệ.
- Neo: `content/content.js` — `isPlayable()` không còn xét `disablePictureInPicture`,
  nên vòng lặp vẫn gọi PiP, cờ `attempted` được bật và `firstError.name` được nối
  vào thông báo thay vì `No playable video found on this page.`
- Nhận diện bản content script: nếu thay vào đó thấy mode `Video` bị khoá, hoặc
  thấy `No playable video found on this page.`, thì content script đang chạy vẫn
  là bản cũ — nạp lại tab rồi làm lại trước khi kết luận gì.

### TC-D3 — Đóng PiP gốc rồi mở lại popup
- Thao tác: sau TC-D1, đóng cửa sổ PiP gốc bằng nút `X`, rồi mở lại popup.
- Kỳ vọng: popup trở về trạng thái rảnh: ba nút capture bật, `Stop PiP` ẩn.
- Neo: `content/content.js` — listener `leavepictureinpicture` gửi `pip-exited`
  cho mọi video, không còn điều kiện theo `isPlayable()`.

### TC-D4 — Bấm Stop PiP trong chế độ video
- Thao tác: đang ở trạng thái video nổi, mở popup và bấm `Stop PiP`.
- Kỳ vọng: popup trở về trạng thái rảnh. Ghi nhận xem cửa sổ PiP gốc của video
  có tự đóng không — theo mã là không, vì `stopPip()` chỉ gửi `teardown` và
  `content.js` xử lý `teardown` bằng `clearSelection()` (chỉ dọn overlay).
- Neo: `background/service-worker.js` — `stopPip()` gọi `stopTabStream()` rồi
  gửi `teardown`; `content/content.js` — nhánh `case "teardown"` chỉ gọi
  `clearSelection()`, không đóng cửa sổ PiP gốc của trang.

## 7. Nhóm E — Panels (Notes / Todos / Focus)

### TC-E1 — Mở panel và chuyển trang trong nav
- Thao tác: trên trang thường, mở popup, bấm `Notes`.
- Kỳ vọng: một cửa sổ kiểu document PiP hiện panel Notes (tỉ lệ khoảng
  380 × 540; Chrome có thể điều chỉnh kích thước thực tế), có nav dưới gồm
  `Notes` `Todos` `Focus`; bấm `Todos` thì chính cửa sổ đó chuyển sang panel
  Todos.
- Neo: `background/service-worker.js` — `openPanel()` và `requestPanelWindow()`;
  `shared/panel.js` — `mountNav()` đổi `window.location.href`.

### TC-E2 — Notes: tạo, sửa, xoá
- Thao tác: trong panel Notes, bấm `New`, gõ nội dung, bấm `Save`; sau đó bấm
  vào một note để sửa và lưu lại; cuối cùng bấm `Delete` và xác nhận.
- Kỳ vọng: toast lần lượt `Note saved`, `Note saved`, `Note deleted`; bộ đếm
  đổi giữa `1 note` và `2 notes`; khi bấm `Delete` lần đầu hiện câu hỏi
  `Delete this note?` kèm `Delete` / `Cancel`; danh sách xếp mới nhất lên đầu;
  note dài bị cắt còn 96 ký tự kèm `…`.
- Neo: `panels/notes.js` — `saveNote()`, `removeNote()`, `preview()`, `renderCount()`.

### TC-E3 — Notes: nội dung rỗng và tìm kiếm không có kết quả
- Thao tác: bấm `New` rồi bấm `Save` khi ô văn bản trống; sau đó gõ một chuỗi
  không khớp note nào vào ô `Search notes`.
- Kỳ vọng: toast `Write something first` và vẫn ở màn hình soạn; danh sách hiện
  `No notes match that search.`; khi chưa có note nào thì hiện
  `No notes yet. Tap New to write one.`
- Neo: `panels/notes.js` — `saveNote()` và `renderList()`.

### TC-E4 — Todos: thêm, chia nhóm, xoá
- Thao tác: trong panel Todos, gõ vào ô `Add a todo` rồi nhấn `Enter`; thêm tiếp
  một việc bằng nút `Add`; thử thêm một việc trống; tick vào ô kiểm của một việc;
  xoá một việc.
- Kỳ vọng: việc mới nằm ở mục `Active`; việc đã tick chuyển xuống mục `Done` và
  bị gạch ngang; thêm trống cho toast `Write a todo first`; xoá cho toast
  `Todo deleted`; bộ đếm đổi dạng `1 active` / `2 active`; hai mục rỗng hiện
  `No active todos.` và `Nothing completed yet.`
- Neo: `panels/todos.js` — `addTodo()`, `toggleTodo()`, `removeTodo()`, `render()`.

### TC-E5 — Todos: sửa nội dung và hạn
- Thao tác: bấm vào một việc để mở trình sửa, đổi nội dung, đặt hạn là **hôm
  nay**, `Save`; mở lại và đặt hạn là **hôm qua**, `Save`; thử xoá trắng nội
  dung rồi `Save`; bấm `Enter` và `Esc` trong ô sửa.
- Kỳ vọng: hạn hôm nay hiện `Due today`; hạn đã qua hiện `Overdue · <ngày>`;
  nội dung trắng cho toast `Todo text cannot be empty`; `Enter` lưu còn `Esc`
  đóng trình sửa; việc có hạn sớm xếp trước việc không có hạn.
- Neo: `panels/todos.js` — `saveEdit()`, `dueBadge()`, `byDueThenCreated()`.

### TC-E6 — Focus: chạy hết một phiên khi panel đang mở
- Thao tác: mở panel `Focus`, bấm `Durations`, đặt Work = 1 phút, `Save`, rồi
  bấm `Start` và giữ nguyên cửa sổ cho tới khi đồng hồ về 0.
- Kỳ vọng: lúc đầu đồng hồ `25:00` / nhãn `Work` / meta `Ready`; đặt lại thời
  lượng cho toast `Durations saved`; khi chạy nút đổi thành `Pause` và meta
  `Running`; hết phiên có toast `Focus session logged`, nhãn chuyển sang
  `Short break`, dòng `Today:` tăng thành `1 session · 1 min`.
  Ghi nhận xem thông báo hệ thống có hiện hay không (xem mục 13).
- Neo: `panels/timer.js` — `start()`, `finishSession()`, `paint()`,
  `renderHistory()`.

### TC-E7 — Focus: đóng panel rồi mở lại sau khi hết phiên
- Thao tác: đặt Work = 1 phút, bấm `Start`, đóng ngay cửa sổ panel, chờ quá
  1 phút, rồi mở lại panel `Focus`.
- Kỳ vọng: khi hết phiên (panel đã đóng) có thông báo hệ thống tiêu đề
  `Focus session complete` với nội dung `Nice work. Time for a break.`; mở lại
  panel thấy nhãn `Short break`, dòng `Today:` là `1 session · 1 min`, badge
  ` · 1 done` cạnh nhãn, và mục `Last 7 days` có một dòng log theo ngày.
- Neo: `background/service-worker.js` — listener `chrome.alarms.onAlarm` tạo
  notification id `focus-timer`; `panels/timer.js` — `load()` gọi
  `finishSession()` khi `endsAt` đã qua lúc panel mở lại.

### TC-E8 — Durations, Reset và bền vững sau khi reload
- Thao tác: mở `Durations`, thử nhập `0` hoặc `200` rồi `Save`; sau đó đặt lại
  giá trị hợp lệ, bấm `Reset`; cuối cùng vào `chrome://extensions` bấm reload
  extension rồi mở lại panel.
- Kỳ vọng: giá trị ngoài 1–180 cho toast `Use whole minutes between 1 and 180`
  và giữ nguyên màn hình cài đặt; `Reset` đưa đồng hồ về đúng thời lượng của
  chế độ hiện tại và meta về `Ready`; sau khi reload, thời lượng đã lưu, notes,
  todos và lịch sử Focus vẫn còn.
- Neo: `panels/timer.js` — `saveSettings()`, `reset()`, `merge()` và `Store`;
  `shared/store.js` — `chrome.storage.local` là bản ghi chính;
  `background/service-worker.js` — `onInstalled` chỉ tạo `settings` khi chưa có.

### TC-E9 — Nhánh cửa sổ riêng trên trang bị chặn scripting
- Thao tác: mở tab `https://chromewebstore.google.com`, mở popup và bấm `Notes`.
- Kỳ vọng: một cửa sổ popup riêng (khoảng 380 × 540) hiện panel Notes thay vì
  cửa sổ document PiP. Nếu Chrome của bạn không chặn inject ở trang đó thì ghi
  **Không tái hiện**.
- Neo: `background/service-worker.js` — `openPanel()` rơi xuống nhánh
  `chrome.windows.create({ type: "popup" })` khi `executeScript` lỗi.

## 8. Nhóm F — Sync

### TC-F1 — Bật và tắt mirror
- Thao tác: mở popup, bật công tắc `Sync across devices`; sau đó tắt lại.
- Kỳ vọng: khi bật, note `Notes, todos and timer now follow your Chrome
  profile.` và trong console service worker
  `await chrome.storage.sync.get(null)` thấy các khoá `notes`, `todos`,
  `timer`; khi tắt, note `Sync off. Your data stays on this device.` và
  `await chrome.storage.local.get(null)` vẫn còn nguyên dữ liệu.
- Neo: `popup/popup.js` — `bindSyncSwitch()`, `mirrorLocalToSync()`;
  `shared/store.js` — `setSettings()` và nhánh `syncEnabled` trong `write()`.

### TC-F2 — Ghi chú dài hơn 8.000 ký tự
- Thao tác: đang bật sync, trong panel Notes tạo một ghi chú có độ dài khoảng
  9.000 ký tự, lưu lại, rồi chạy `await chrome.storage.sync.get(null)` trong
  console service worker.
- Kỳ vọng: xuất hiện các khoá `notes__parts` và `notes__part_0`,
  `notes__part_1` (số khúc tuỳ độ dài). Ghi nhận thêm: khoá `notes` cũ còn hay
  mất trong `chrome.storage.sync` (xem mục 13).
- Neo: `shared/store.js` — `writeSync()` chia chuỗi theo `SYNC_ITEM_LIMIT = 8000`
  sau `JSON.stringify`, và `clearSyncParts()` chỉ xoá các khoá dạng
  `notes__part_*` / `notes__parts`.

### TC-F3 — Sync tắt thì không ghi ra sync
- Thao tác: tắt sync, tạo thêm một note mới, rồi chạy
  `await chrome.storage.sync.get(null)`.
- Kỳ vọng: không có khoá nào mới cho note vừa tạo; bản ghi mới chỉ nằm trong
  `chrome.storage.local`.
- Neo: `shared/store.js` — `write()` chỉ gọi `writeSync()` khi `syncEnabled()`.

## 9. Nhóm G — Lỗi và biên

### TC-G1 — Lỗi khi tab bị chặn scripting
- Thao tác: ở tab `https://chromewebstore.google.com`, mở popup và bấm
  `Selected region`.
- Kỳ vọng: popup hiện note lỗi màu đỏ (nội dung do Chrome trả về), ba nút
  capture được bật lại, không có overlay nào xuất hiện.
- Neo: `background/service-worker.js` — `ensureContentScript()` gọi
  `chrome.scripting.executeScript()`; `popup/popup.js` — nhánh lỗi trong `run()`
  hỏi lại `get-state` để render đúng trạng thái.

### TC-G2 — Message không hỗ trợ vẫn có câu trả lời
- Thao tác: mở DevTools của popup và chạy
  `chrome.runtime.sendMessage({type:"nope"})`.
- Kỳ vọng: nhận `{ok: false, error: "Unsupported message: nope"}`.
- Neo: `background/service-worker.js` — nhánh `default` trong `handle()`. Đây là
  đối chứng dương cho yêu cầu trong `AGENTS.md`: không được có message nào
  service worker không trả lời.

### TC-G3 — Overlay được dọn sạch sau mọi đường thoát
- Thao tác: lặp lại ba đường thoát overlay (phím `Esc`, nút `Cancel`, nút
  `Show in PiP`), sau mỗi lần chạy trong console của trang web:
  `document.getElementById("pipdesk-selection")`.
- Kỳ vọng: `null` ở cả ba lần, và trang không còn bị chặn click.
- Neo: `content/content.js` — `clearSelection()` gỡ mọi listener và xoá `#pipdesk-selection`.

### TC-G4 — Console sạch sau cả lượt test
- Thao tác: sau khi chạy hết checklist, đọc lại console của service worker.
- Kỳ vọng: không có dòng `Unsupported message:` nào, không có lỗi đỏ chưa xử lý.
- Neo: `background/service-worker.js` — `handle()` chỉ trả lỗi cho message lạ;
  mọi luồng hợp lệ phải trả `{ ok: true }`.

## 10. Nhóm H — Quick PiP trên YouTube

### TC-H1 — Nút xuất hiện trong thanh điều khiển
- Thao tác: mở một trang xem video `https://www.youtube.com/watch?v=...`, đưa
  chuột xuống thanh điều khiển của trình phát.
- Kỳ vọng: nút PiPDesk nằm trong nhóm điều khiển bên phải, cạnh các nút của
  YouTube, và có tooltip `PiPDesk: float this video`.
- Neo: `content/youtube.js` — `mount()` chèn `#pipdesk-quick-pip` vào đầu
  `.ytp-right-controls`; `manifest.json` khai báo `content_scripts` cho
  `https://www.youtube.com/*`.

### TC-H2 — Bấm nút là float ngay, không cần mở popup
- Thao tác: bấm nút PiPDesk khi video đang phát.
- Kỳ vọng: cửa sổ PiP của trình phát mở ra; popup của extension không mở.
- Neo: `content/youtube.js` — `startPip()` gọi `video.requestPictureInPicture()`
  ngay trong handler click, nên lời gọi giữ được user activation của trang.

### TC-H3 — Chuột phải trên nút mở nhóm hành động
- Thao tác: bấm chuột phải vào nút PiPDesk.
- Kỳ vọng: menu PiPDesk hiện cạnh nút với bốn mục `Float this video`,
  `Float this tab`, `Float a region`, `Stop PiP`; bấm ra ngoài hoặc `Esc` thì
  menu đóng.
- Neo: `content/youtube.js` — `openMenu()`, `ACTIONS`, `onOutside`, `onMenuKey`.

### TC-H4 — Menu chuột phải của Chrome có mục PiPDesk
- Thao tác: bấm chuột phải vào một vùng trống của trang.
- Kỳ vọng: nhóm `PiPDesk` hiện trong menu của Chrome với ba mục con
  `Float this tab`, `Float a region`, `Stop PiP`; chọn `Float this tab` thì PiP
  toàn tab mở ra.
- Neo: `background/service-worker.js` — `buildContextMenu()` tạo nhóm
  `pipdesk-menu`; `chrome.contextMenus.onClicked` gọi `startFullTabPip()`,
  `startRegionSelection()`, `stopPip()`.
- Lưu ý: menu của Chrome cố ý **không** có mục float video, vì cú bấm ở menu
  không mang activation cho trang; việc đó chỉ nút trên trang làm được.

### TC-H5 — Điều hướng trong YouTube không nhân đôi nút
- Thao tác: từ một video bấm sang video khác (YouTube không nạp lại trang), rồi
  đếm số nút bằng `document.querySelectorAll("#pipdesk-quick-pip").length`.
- Kỳ vọng: luôn bằng `1`.
- Neo: `content/youtube.js` — `mount()` thoát khi nút đã tồn tại,
  `scheduleMount()` chỉ hẹn lại lúc nút vắng mặt, và có nghe
  `yt-navigate-finish`.

### TC-H6 — Trang không phải YouTube thì không có nút
- Thao tác: mở một trang bất kỳ khác YouTube.
- Kỳ vọng: không nút PiPDesk nào được chèn; `content/youtube.js` chỉ chạy trên
  `https://www.youtube.com/*`.
- Neo: `manifest.json` — `content_scripts[0].matches`.

## 11. Nhóm I — nhiều nguồn nổi trong một cửa sổ

Phép đo cổng đã chốt câu hỏi: bật một capture rồi tạo capture thứ hai thì cửa sổ
mới thay chỗ cửa sổ cũ. Mỗi cây tài liệu chỉ nuôi được **một** cửa sổ PiP, nên
nhiều cửa sổ rời là bất khả thi từ phía extension; hướng iframe bị bỏ và
`offscreen/capture.html` đã xoá. Bộ ca dưới đây kiểm bản thay thế: nhiều nguồn
cùng vẽ vào một canvas và cùng nổi trong một cửa sổ.

### TC-I1 — Hai nguồn cùng nổi trong một cửa sổ
- Thao tác: ở tab A bấm `Whole tab`, rồi sang tab B bấm `Selected region` và chọn
  một vùng.
- Kỳ vọng: chỉ có **một** cửa sổ PiP, bên trong chia hai ô cạnh nhau; popup liệt
  kê hai dòng, dòng của A ghi `Whole tab`, dòng của B ghi `Selected region`.
- Neo: `offscreen/offscreen.js` — `create-source` thêm nguồn vào registry và chỉ
  gọi `requestPictureInPicture()` khi đây là nguồn đầu tiên; `slots()` xếp ô.

### TC-I2 — Dừng một nguồn, cửa sổ vẫn sống
- Thao tác: bấm nút `Stop` ở dòng của tab B.
- Kỳ vọng: nguồn A giãn ra chiếm trọn khung, cửa sổ không đóng; popup còn một
  dòng và nút `Stop all` tự ẩn.
- Neo: `background/service-worker.js` — `stopPip(message.sourceId)` chỉ gỡ đúng
  nguồn đó; `offscreen/offscreen.js` — `stop-source` vẽ lại lưới khi còn nguồn.

### TC-I3 — Đóng cửa sổ bằng nút X
- Thao tác: đóng cửa sổ PiP bằng nút X.
- Kỳ vọng: popup trống danh sách, không còn chỉ báo chia sẻ tab.
- Neo: `offscreen/offscreen.js` — `leavepictureinpicture` không thấy cờ `closing`
  thì gọi `stopAll()` và báo `pip-exited`; worker nhận `pip-exited` rồi
  `broadcast()`.

### TC-I4 — Đóng tab nguồn
- Thao tác: đang có hai nguồn, đóng tab của nguồn thứ hai.
- Kỳ vọng: ô của tab đó mất, cửa sổ vẫn giữ nguồn còn lại; đóng nốt tab kia thì
  cửa sổ đóng và danh sách rỗng.
- Neo: `chrome.tabs.onRemoved` trong service worker lọc theo `tabId` rồi gọi
  `stop-source`.

### TC-I5 — Trần bốn nguồn
- Thao tác: thêm nguồn thứ năm.
- Kỳ vọng: popup hiện note lỗi `Up to 4 floating sources are supported.`, bốn ô cũ
  vẫn vẽ bình thường.
- Neo: `background/service-worker.js` — `MAX_SOURCES` chặn trong `createSource()`
  trước khi xin stream; `offscreen/offscreen.js` — `MAX_SOURCES` chặn lần nữa.

### TC-I6 — Worker bị thu hồi
- Thao tác: dừng service worker ở `chrome://extensions` khi đang có hai nguồn rồi
  mở lại popup.
- Kỳ vọng: vẫn đủ hai dòng kèm nhãn tiêu đề tab.
- Neo: `get-state` và `broadcast()` lấy `list-sources` từ offscreen document thay
  vì giữ bản sao trong worker.

### TC-I7 — Đóng popup khi đang có nguồn
- Thao tác: đang có hai nguồn, mở rồi đóng popup.
- Kỳ vọng: cả hai ô vẫn vẽ, chỉ báo chia sẻ tab vẫn còn.
- Neo: `onDisconnect` chỉ giải phóng offscreen document khi không còn nguồn nào.

### TC-I8 — Nguồn tiêu điểm chiếm trọn khung
- Thao tác: đang có hai nguồn, bấm `Show alone` ở một dòng trong popup.
- Kỳ vọng: cửa sổ chỉ còn nguồn đó ở 1280×720, các nguồn khác vẫn nằm trong danh
  sách; nút của dòng đó đổi thành `Back to grid`.
- Neo: `offscreen/offscreen.js` — `focusSource()` đặt `focusedId` rồi `drawFrame()`
  vẽ theo `slots(count, true)`; `list-sources` trả `focused` cho đúng nguồn đó;
  `popup/popup.js` — `renderSources()` đổi nhãn nút theo `source.focused`.

### TC-I9 — Bỏ tiêu điểm và dừng nguồn đang tiêu điểm
- Thao tác: bấm `Back to grid`, sau đó đặt tiêu điểm lại rồi bấm `Stop` ở đúng
  dòng đang tiêu điểm.
- Kỳ vọng: lần đầu lưới trở lại như cũ; lần sau cửa sổ vẽ các nguồn còn lại theo
  lưới, và nếu đó là nguồn cuối cùng thì cửa sổ đóng hẳn.
- Neo: `offscreen/offscreen.js` — `stopSource()` đặt `focusedId = null` khi id
  trùng, `stopAll()` luôn đặt `null`, nên tiêu điểm không bao giờ trỏ vào nguồn
  đã gỡ.

## 12. Lệnh kiểm tra bằng console

Console service worker (`chrome://extensions` → service worker):

```js
await chrome.storage.local.get(null);
await chrome.storage.sync.get(null);
await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
```

Console popup (chuột phải vào popup → Inspect):

```js
chrome.runtime.sendMessage({ type: "nope" });
```

Console của trang web đang test:

```js
document.getElementById("pipdesk-selection");
```

Console của offscreen document (`chrome://extensions` → Inspect views
`offscreen.html`):

```js
document.pictureInPictureElement;
```

## 13. Hành vi đã ghi nhận (theo mã, cần xác nhận khi chạy)

Hai điểm đầu dưới đây suy ra từ mã nguồn, chưa chạy thực tế; điểm 3 lấy từ log
thật trên YouTube. TC-F2, TC-E6 và TC-D1 là nơi ghi lại kết quả.

1. `clearSyncParts()` không xoá khoá `notes` trực tiếp, trong khi `readSync()`
   ưu tiên khoá trực tiếp trước các khúc — nên khi dữ liệu chuyển từ nhỏ sang
   lớn hơn 8.000 ký tự, `chrome.storage.sync` có thể còn khoá `notes` cũ bên
   cạnh `notes__part_*`.
2. Thông báo hệ thống của Focus timer do alarm trong service worker tạo. Khi
   panel đang mở, phiên kết thúc ở phía panel và alarm bị xoá ngay, nên thông
   báo có thể không hiện — TC-E6 chỉ ghi nhận, còn TC-E7 (panel đã đóng) mới là
   ca kiểm tra thông báo.
3. Trên YouTube, `requestPictureInPicture()` trả `NotAllowedError` dù video hợp lệ
   (`readyState` 4, `videoWidth` 1280, đang phát, `disablePictureInPicture` false).
   Lời gọi cần mang activation của cú bấm, nên mode `Video` giờ gọi từ popup qua
   `startVideoPipFromPopup()` thay vì đi vòng qua service worker; TC-D1 kiểm tra.

Hai hành vi treo trạng thái trước đây đã được sửa và nay là kỳ vọng bình thường:
nút `Cancel` và việc đổi kích thước cửa sổ gửi `selection-cancelled` (TC-C4,
TC-C5), và đóng PiP video luôn gửi `pip-exited` (TC-D3). Riêng `Stop PiP` vẫn
không đóng cửa sổ PiP gốc của trang (TC-D4).

## 14. Bảng ghi kết quả

| Mã ca | Kết quả | Ghi chú |
| --- | --- | --- |
| TC-A1 |  |  |
| TC-A2 |  |  |
| TC-A3 |  |  |
| TC-A4 |  |  |
| TC-A5 |  |  |
| TC-A6 |  |  |
| TC-A7 |  |  |
| TC-B1 |  |  |
| TC-B2 |  |  |
| TC-B3 |  |  |
| TC-B4 |  |  |
| TC-B5 |  |  |
| TC-C1 |  |  |
| TC-C2 |  |  |
| TC-C3 |  |  |
| TC-C4 |  |  |
| TC-C5 |  |  |
| TC-C6 |  |  |
| TC-C7 |  |  |
| TC-C8 |  |  |
| TC-C9 |  |  |
| TC-D1 |  |  |
| TC-D2 |  |  |
| TC-D3 |  |  |
| TC-D4 |  |  |
| TC-D5 |  |  |
| TC-E1 |  |  |
| TC-E2 |  |  |
| TC-E3 |  |  |
| TC-E4 |  |  |
| TC-E5 |  |  |
| TC-E6 |  |  |
| TC-E7 |  |  |
| TC-E8 |  |  |
| TC-E9 |  |  |
| TC-F1 |  |  |
| TC-F2 |  |  |
| TC-F3 |  |  |
| TC-G1 |  |  |
| TC-G2 |  |  |
| TC-G3 |  |  |
| TC-G4 |  |  |
| TC-H1 |  |  |
| TC-H2 |  |  |
| TC-H3 |  |  |
| TC-H4 |  |  |
| TC-H5 |  |  |
| TC-H6 |  |  |
| TC-I1 |  |  |
| TC-I2 |  |  |
| TC-I3 |  |  |
| TC-I4 |  |  |
| TC-I5 |  |  |
| TC-I6 |  |  |
| TC-I7 |  |  |
| TC-I8 |  |  |
| TC-I9 |  |  |
