# CP-4: UI gate that measures computed style against a design contract
Loại: feature-m
Phạm vi: lib/design-contract.mjs, lib/tolerance.mjs, lib/browser.mjs, lib/dev-server.mjs, commands/ui.mjs
Lệnh test: npm test && npm run test:deep

## Mục tiêu
Screenshot trông giống không phải bằng chứng. Gate `ui` mở trang thật trong browser, đọc
`getComputedStyle` của từng selector khai trong `design-contract.json`, so với số thiết kế
theo dung sai, rồi báo bảng số.

Xong nghĩa là: `compass ui <id>` khởi động dev server từ config, đo mọi thuộc tính trong
contract trên mọi viewport, fail khi có sai lệch vượt dung sai, và ghi gate record có chữ ký.

## Ràng buộc
Compass giữ zero runtime dependency. Playwright phải nằm ở dự án đích, không phải ở Compass.
Không tìm thấy Playwright thì gate báo rõ cách cài và trả exit 2 — không âm thầm pass, cũng
không giả vờ đo được.

Không có `design-contract.json` thì gate pass và nói rõ là chưa có hợp đồng nào để đối chiếu.

Dung sai theo thiết kế §7.4: color/font-weight/font-size đúng tuyệt đối; padding/margin/gap
±2px; border-radius/line-height ±1px.

## Rủi ro hồi quy
`ui` vào `IMPLEMENTED_GATES` sẽ làm `check` chạy nó trên mọi task `feature-s` trở lên. Test
nào đang dùng `ui` làm ví dụ "gate chưa xây" sẽ đổi kết quả — phải rà lại, đúng như lần thêm
`convention` vừa rồi.

Dev server là tiến trình con. Gate crash giữa chừng mà không kill nó thì port kẹt, lần chạy
sau treo. Phải dọn kể cả khi lỗi.

Đo trên browser thật nên chậm và có thể chập chờn. Cần timeout rõ ràng, không treo vô hạn.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Parse contract đủ trường | Trả về danh sách phần tử, mỗi cái có selector và thuộc tính | P0 |
| H2 | Happy | Parse contract nhiều viewport | Mỗi viewport có tên và chiều rộng | P0 |
| H3 | Happy | So màu khớp tuyệt đối | Không có sai lệch | P0 |
| H4 | Happy | So padding lệch 1px | Trong dung sai ±2px, không tính lệch | P0 |
| H5 | Happy | Không có design-contract.json | Gate pass, báo chưa có hợp đồng | P0 |
| V1 | Validation | Contract không phải JSON hợp lệ | Báo lỗi rõ, exit 2, không crash | P0 |
| V2 | Validation | Contract thiếu trường elements | Báo lỗi nêu tên trường thiếu | P0 |
| V3 | Validation | Phần tử thiếu selector | Báo lỗi nêu tên phần tử | P0 |
| V4 | Validation | Viewport có width không phải số | Báo lỗi rõ | P1 |
| E1 | Error | Playwright không có trong dự án | Exit 2, chỉ rõ lệnh cài | P0 |
| E2 | Error | Dev server không lên sau timeout | Exit 2, báo rõ đã đợi bao lâu | P0 |
| E3 | Error | Selector không tìm thấy trên trang | Tính là sai lệch, nêu tên selector | P0 |
| E4 | Error | Config thiếu dev hoặc devUrl | Exit 2, báo trường nào thiếu | P0 |
| EC1 | Edge | Padding lệch đúng 2px | Trong dung sai, không tính lệch | P0 |
| EC2 | Edge | Padding lệch 2.5px | Vượt dung sai, tính lệch | P0 |
| EC3 | Edge | Màu viết dạng rgb so với hex | Quy về cùng dạng rồi so, không báo lệch giả | P0 |
| EC4 | Edge | Contract rỗng, không phần tử nào | Gate pass, báo 0 thuộc tính đã đo | P1 |
| S1 | Security | Selector chứa mã chèn vào trang | Không chạy như code, chỉ dùng làm selector | P0 |
| S2 | Security | devUrl trỏ ra ngoài localhost | Cảnh báo rõ trước khi mở | P1 |
| P1 | Performance | Đo nhiều thuộc tính trên một selector | Chỉ một lần truy vấn cho mỗi selector, không lặp | P1 |
| P2 | Performance | Dev server bị kill khi gate lỗi | Không còn tiến trình con sót lại | P0 |
| P3 | Performance | Gọi stop hai lần liên tiếp | Lần hai không ném lỗi, không treo | P1 |
| V5 | Validation | Contract không phải JSON, ở tầng gate | Exit 2 (V1 kiểm cùng ca ở tầng parser) | P1 |
| V6 | Validation | Element thiếu selector, ở tầng gate | Exit 2, nêu tên element thiếu | P1 |
| E5 | Error | Config có `dev` nhưng thiếu `devUrl` | Exit 2, nói rõ thiếu trường nào | P1 |
| EC5 | Edge | Contract có mảng elements rỗng, ở tầng gate | Gate exit 0, không đo gì | P1 |
| P4 | Performance | Thuộc tính longhand (`row-gap`, `min-width`) | Hưởng dung sai của shorthand, không rơi về 0px | P0 |
| P5 | Performance | Tên khớp nhiều mục trong bảng dung sai | Chọn mục cụ thể nhất, không chọn mục gặp trước | P1 |
| V7 | Validation | Contract parse ra `null`, số, mảng | Báo lỗi, không ném TypeError ra ngoài lệnh | P0 |
