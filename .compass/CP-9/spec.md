# CP-9: Deep integration test running all six gates against a real project
Loại: feature-s
Phạm vi: test/deep-integration.test.mjs, package.json
Lệnh test: npm test && npm run test:deep

## Mục tiêu
Bug dev-server (CP-8) chỉ lộ khi chạy `check` đủ sáu gate trên task có design contract. 403
test không bắt được, vì mọi test hiện có kiểm từng gate riêng lẻ. Lần sau ai sửa
`lib/dev-server.mjs`, suite vẫn xanh và bug quay lại im lặng.

Chỗ chưa ai đi qua là **các gate tương tác với nhau**: hai gate browser tranh cùng một cổng,
gate này để lại tiến trình cho gate kia, `sourceHash` của gate trước lệch vì gate sau ghi
evidence.

Xong nghĩa là: một suite chạy `compass` thật trên `examples/todo` — đủ sáu gate, nhiều lần
liên tiếp — kiểm cả kết quả lẫn tiến trình còn sót; tách khỏi `npm test` để không làm chậm
vòng lặp thường ngày.

## Ràng buộc
Chạy qua CLI thật, không import hàm — đúng cách người dùng gọi. Cần Playwright và dev server
của `examples/todo`; thiếu thì test phải **skip có thông báo**, không fail và cũng không âm
thầm pass.

Không sửa `examples/todo` trong lúc test rồi để nguyên. Sửa gì phải khôi phục, kể cả khi
assertion fail.

Chạy được nhiều lần liên tiếp mà không cần dọn tay.

## Rủi ro hồi quy
Suite này chậm (mỗi lần `check` khoảng một phút). Gộp vào `npm test` sẽ làm vòng lặp phát
triển chậm gấp nhiều lần — phải tách lệnh riêng, và `npm test` không được đụng tới nó.

Test ghi vào `.compass/TD-001/evidence/` của demo, làm `gate.json` đổi sau mỗi lần chạy. Nếu
không dọn thì `git status` bẩn sau mỗi lần chạy test.

Baseline ảnh của `visual` phụ thuộc cách máy render chữ. Trên máy khác, hoặc CI, gate này sẽ
đỏ vì lý do vặt chứ không phải lỗi thật — phải nói rõ trong tài liệu.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | check chạy đủ sáu gate | Exit 0, mọi gate xanh | P0 |
| H2 | Happy | done sau check | Exit 0 | P0 |
| H3 | Happy | check chạy hai lần liên tiếp | Cả hai lần xanh | P0 |
| H4 | Happy | status sau check | Liệt kê đủ gate đã chạy | P1 |
| V1 | Validation | Thiếu Playwright | Skip có thông báo, không fail | P0 |
| V2 | Validation | Thiếu node_modules của demo | Skip có thông báo | P0 |
| E1 | Error | Sửa CSS lệch dung sai | Gate ui fail, nêu đúng thuộc tính | P0 |
| E2 | Error | Xóa một test khỏi suite demo | Gate test fail, nêu ID thiếu | P0 |
| EC1 | Edge | Cổng dev còn tiến trình sau check | Không còn tiến trình nào giữ cổng | P0 |
| EC2 | Edge | Sửa code sau khi check xanh | done chặn, nêu gate | P0 |
| EC3 | Edge | check chạy khi cổng đang bị chiếm | Báo lỗi rõ, không treo | P1 |
| S1 | Security | Test tự khôi phục file đã sửa | Demo về đúng trạng thái ban đầu | P0 |
| P1 | Performance | Toàn bộ suite sâu | Xong trong 10 phút | P1 |
