# CP-11: Investigate workflow and a script library that outlives it
Loại: feature-m
Phạm vi: templates/investigation.md, lib/investigation-parser.mjs, commands/investigate.mjs, commands/scripts.mjs

## Mục tiêu
Task BUILD giả định đã biết phải làm gì. Điều tra thì không — và không có quy trình nào cho
nó, nên AI hay "để tôi xem thử", sửa code giữa chừng, rồi kết luận bằng suy luận thay vì bằng
chứng. Thiết kế §4.2 đặt ba luật cứng cho việc này.

Script viết trong lúc điều tra cũng bốc hơi: viết tạm, chạy một lần, vứt. Lần sau gặp lại
đúng câu hỏi thì viết lại từ đầu.

Xong nghĩa là: `compass investigate <id>` mở hồ sơ điều tra có cấu trúc bắt buộc;
`--close` chỉ cho đóng khi đã có kết luận kèm bằng chứng **và** một mục pitfall;
`compass scripts --list` liệt kê script đã lưu để lần sau tìm thấy mà dùng lại.

## Ràng buộc
Zero runtime dependency.

Điều tra không phải task BUILD nên **không đi qua bảng gate** — nó không có spec, không có
test case, không có `done`. Dùng chung `.compass/` nhưng tiền tố `INV-`.

`--close` bắt buộc có pitfall. Điều tra không để lại bài học thì lần sau lại sập đúng bẫy đó
— đó là cả lý do §11 tồn tại.

`.compass/scripts/` git-tracked, khác `evidence/`. Script là tài sản dùng lại, không phải
bằng chứng một lần.

## Rủi ro hồi quy
`validateTaskId` đang dùng chung cho mọi lệnh. Id `INV-014` phải qua được nó, và task BUILD
không được nhận nhầm thư mục `INV-` là của mình.

`status` và `done` đọc `.compass/<id>/spec.md`. Thư mục điều tra không có file đó — hai lệnh
này phải báo rõ chứ không crash.

`hashSource` bỏ qua `.compass/`, nên thêm `scripts/` vào đó không làm lệch gate nào. Cần kiểm
lại chứ không đoán.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Mở điều tra mới | Tạo INV-x/investigation.md từ template | P0 |
| H2 | Happy | Parse hồ sơ đủ mục | Trả giả thuyết, cách kiểm, bằng chứng, kết luận | P0 |
| H3 | Happy | Đóng điều tra hợp lệ | Exit 0, ghi bản ghi có chữ ký | P0 |
| H4 | Happy | scripts --list khi có script | Liệt kê tên và mục đích từng cái | P0 |
| H5 | Happy | scripts --list khi chưa có | Báo rõ chưa có, hướng dẫn thêm | P0 |
| H6 | Happy | Mỗi giả thuyết nêu cách kiểm trước | Parser tách đúng từng cặp | P0 |
| V1 | Validation | Đóng khi chưa có kết luận | Chặn, nêu mục còn thiếu | P0 |
| V2 | Validation | Đóng khi chưa ghi pitfall | Chặn, nhắc bắt buộc ghi | P0 |
| V3 | Validation | Giả thuyết không nêu cách kiểm | Chặn, nêu giả thuyết nào thiếu | P0 |
| V4 | Validation | Kết luận không dẫn bằng chứng | Chặn, đòi bằng chứng | P0 |
| V5 | Validation | Id không hợp lệ | Báo lỗi rõ, không tạo thư mục | P0 |
| E1 | Error | Mở điều tra đã tồn tại | Không ghi đè, báo rõ | P0 |
| E2 | Error | Đóng điều tra chưa mở | Báo rõ, exit 2 | P0 |
| E3 | Error | Hồ sơ bị xóa giữa chừng | Báo rõ, không crash | P1 |
| E4 | Error | Script không đọc được header | Vẫn liệt kê, đánh dấu thiếu mô tả | P1 |
| EC1 | Edge | Hồ sơ còn nguyên placeholder | Chặn như chưa điền | P0 |
| EC2 | Edge | Nhiều giả thuyết, một cái bị bác | Vẫn đóng được nếu có kết luận | P0 |
| EC3 | Edge | status trên thư mục INV- | Báo rõ đây là điều tra, không crash | P0 |
| EC4 | Edge | Script nằm trong thư mục con | Vẫn được liệt kê | P1 |
| S1 | Security | Id điều tra chứa ../ | Bị chặn, không thoát thư mục | P0 |
| S2 | Security | Script được liệt kê, không chạy | scripts --list không thực thi gì | P0 |
| P1 | Performance | Liệt kê nhiều script | Không đọc hết nội dung, chỉ header | P1 |
| V6 | Validation | Khối Pitfall còn nguyên chữ mẫu dạng nhãn | Chặn — placeholder sau nhãn cũng là placeholder | P0 |
| V7 | Validation | Dòng tiêu đề còn chữ mẫu | Chặn, không ghi heading vô nghĩa vào kho pitfall | P0 |
| EC5 | Edge | pitfalls.md không kết thúc bằng newline | Heading mới không dính vào đoạn cũ | P1 |
