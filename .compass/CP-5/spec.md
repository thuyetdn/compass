# CP-5: Visual gate comparing screenshots against a baseline
Loại: feature-s
Phạm vi: lib/png.mjs, lib/image-diff.mjs, commands/visual.mjs

## Mục tiêu
Gate `ui` đo số của những thuộc tính người ta nghĩ ra để khai. Cái nó không thấy: chữ tràn,
phần tử đè lên nhau, layout vỡ ở viewport hẹp. Gate `visual` chụp trang rồi so từng pixel với
ảnh baseline đã duyệt.

Xong nghĩa là: `compass visual <id>` chụp mọi viewport, so với baseline trong
`.compass/<id>/baseline/`, fail khi tỉ lệ pixel khác vượt ngưỡng, và ghi ảnh khác biệt vào
evidence để người xem.

Lần chạy đầu chưa có baseline thì gate tạo baseline và báo rõ — không tự coi là pass ngầm.

## Ràng buộc
Zero runtime dependency. Đọc PNG bằng `node:zlib`, tự giải filter — không dùng thư viện ảnh.
Chỉ hỗ trợ PNG màu 8-bit (RGB và RGBA), đúng thứ Playwright xuất ra. Định dạng khác thì báo
rõ là chưa hỗ trợ, không đoán bừa.

Playwright lấy từ dự án đích như gate `ui`.

Ngưỡng mặc định 0.1% pixel khác, chỉnh được qua `visualThreshold` trong config.

## Rủi ro hồi quy
`visual` vào `IMPLEMENTED_GATES` sẽ chạy trên mọi task `feature-s` trở lên. Test nào đang dùng
`visual` làm ví dụ "gate chưa xây" sẽ đổi kết quả — đã gặp hai lần khi thêm `convention` và
`ui`, phải rà lại.

Ảnh baseline vào git sẽ phình repo. Cần nói rõ trong tài liệu, và chỉ chụp viewport khai trong
contract chứ không chụp bừa.

Render chữ khác nhau giữa máy và CI sẽ làm gate đỏ vì lý do vặt. Ngưỡng phần trăm là cách
giảm, không phải cách chữa — phải nói thẳng giới hạn này.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Giải mã PNG RGBA 8-bit | Trả đúng chiều rộng, cao, và mảng pixel | P0 |
| H2 | Happy | Giải mã PNG RGB không alpha | Trả pixel với alpha mặc định 255 | P0 |
| H3 | Happy | So hai ảnh giống hệt | 0 pixel khác | P0 |
| H4 | Happy | So hai ảnh khác một pixel | Đúng 1 pixel khác | P0 |
| H5 | Happy | Chưa có baseline | Tạo baseline, báo rõ, exit 0 | P0 |
| V1 | Validation | File không phải PNG | Báo lỗi rõ, không crash | P0 |
| V2 | Validation | PNG 16-bit chưa hỗ trợ | Báo rõ chưa hỗ trợ, nêu độ sâu màu | P0 |
| V3 | Validation | Ngưỡng trong config không phải số | Báo lỗi rõ | P1 |
| E1 | Error | Hai ảnh khác kích thước | Tính là khác toàn bộ, báo rõ kích thước hai bên | P0 |
| E2 | Error | Baseline hỏng, đọc không được | Báo lỗi nêu tên file, exit 2 | P1 |
| EC1 | Edge | Khác đúng bằng ngưỡng | Không vượt, gate pass | P0 |
| EC2 | Edge | Khác nhiều hơn ngưỡng một chút | Vượt, gate fail | P0 |
| EC3 | Edge | Ảnh 1x1 pixel | Không chia cho 0, tính đúng tỉ lệ | P1 |
| S1 | Security | Chunk PNG khai kích thước khổng lồ | Từ chối, không cấp phát bộ nhớ vô hạn | P0 |
