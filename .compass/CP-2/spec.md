# CP-2: Close three gaps found on the frontend trial
Loại: bug
Phạm vi: lib/task-types.mjs, lib/test-parser.mjs, commands/test.mjs

## Mục tiêu
Hai lỗi tìm ra khi chạy thử trên React + Vitest:

1. `ui` và `visual` không có trong bảng gate của bất kỳ loại task nào, dù thiết kế §5 đòi
   chúng từ `feature-s` trở lên. Task frontend đóng xanh mà không nhắc gì tới hai gate này.
2. Suite xanh nhưng không ID nào khớp — gần như chắc chắn do reporter không in tên test.
   Gate hiện bảo "viết test cho các case còn thiếu", dẫn người dùng đi viết test trùng.
3. Parser không tháo mã màu ANSI. Vitest in `\x1b[32m✓\x1b[39m H5 ...`; `isPassLine` khớp
   `^✓` sau `trimStart()` nên trượt, và test **đã pass** bị xếp vào "không rõ định dạng".
   Lỗi này nặng hơn hai lỗi trên: nó xếp sai một test đã chạy thật.

Xong nghĩa là: `feature-s` trở lên liệt kê đủ `ui`, `visual` trong danh sách chưa xây;
parser nhận đúng dòng pass có mã màu; và khi suite xanh mà không khớp ID nào, thông báo
chỉ thẳng vào reporter.

## Ràng buộc
Không đổi chữ ký `rulesFor`. Không implement gate `ui`/`visual` — chỉ khai báo để cơ chế
"chưa cài ở giai đoạn này" nhận ra chúng. Thông báo ra người dùng bằng tiếng Việt.

## Rủi ro hồi quy
Thêm gate vào `rulesFor` làm `unimplemented` của `done` dài ra — mọi test đang khẳng định
nội dung dòng "chưa xây dựng" cho `feature-s` trở lên sẽ đổi kết quả. Phải rà lại chúng.

Đổi thông báo của gate `test` có thể che mất ca thật sự thiếu test: nếu suite xanh và người
dùng **đúng là** quên viết mọi test, thông báo mới không được khẳng định chắc chắn là lỗi
reporter. Chỉ nêu khả năng, giữ nguyên hướng dẫn cũ bên cạnh.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Gate của feature-s | rulesFor('feature-s').gates chứa cả ui và visual | P0 |
| H2 | Happy | Gate của feature-m và feature-l | Cả hai đều chứa ui, visual, review | P0 |
| H3 | Happy | Suite xanh, không ID nào khớp | Output nhắc tới reporter | P0 |
| V1 | Validation | Gate của fix và bug không đổi | Vẫn đúng ['spec','test'], không có ui/visual | P0 |
| E1 | Error | Suite đỏ, không ID nào khớp | Không nhắc reporter, vì nguyên nhân là suite lỗi | P0 |
| EC1 | Edge | Suite xanh, khớp đa số ID | Không nhắc reporter, vì reporter rõ ràng in được tên | P0 |
| EC3 | Edge | Suite xanh, khớp 1/13 ID | Vẫn nhắc reporter — Vitest chỉ in tên test chậm | P0 |
| H4 | Happy | Dòng pass bọc mã màu ANSI | ID trên dòng đó được tính là đã chạy | P0 |
| E2 | Error | Dòng fail bọc mã màu ANSI | ID vào nhóm "xuất hiện nhưng không pass", không tính là chạy | P0 |
| EC2 | Edge | Mã màu chen giữa dấu pass và ID | Vẫn tính là đã chạy | P1 |
