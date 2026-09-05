# CP-7: sourceHash so done can tell whether the code still matches its evidence
Loại: feature-s
Phạm vi: lib/source-hash.mjs, commands/test.mjs, commands/convention.mjs, commands/ui.mjs, commands/visual.mjs, commands/done.mjs

## Mục tiêu
`done` đọc `gate.json` chứ không đo lại code. Sửa code sau khi gate xanh thì `done` vẫn đóng
được — đúng với mọi gate. Đây là giới hạn số một trong ba giới hạn SKILL.md tự tuyên bố, và
là chỗ duy nhất còn hở sau khi `review` đã chống được điều tương tự.

Xong nghĩa là: mọi gate chạy trên code đều ghi `sourceHash`; `done` tính lại và chặn khi lệch,
nêu rõ gate nào và file nào đã đổi.

## Ràng buộc
Zero runtime dependency. Hash phải ổn định giữa hai lần chạy liên tiếp khi không ai sửa gì —
nếu không, mọi task sẽ không bao giờ đóng được.

`.compass/` phải nằm ngoài phạm vi hash. Gate ghi record vào đó ở mỗi lần chạy, nên đưa nó vào
sẽ khiến gate tự làm lệch hash của chính mình. Đây đúng là bẫy đã gặp khi xây `review`.

Không quét `node_modules`, `dist`, `build`, `coverage`, `.git` — cùng danh sách gate
`convention` đang dùng.

## Rủi ro hồi quy
Mọi test đang chạy `check` rồi `done` sẽ đi qua đường mới. Nếu hash không ổn định giữa hai
lần chạy, chúng đỏ hàng loạt — đó là dấu hiệu tốt, không phải hồng.

Bản ghi cũ không có `sourceHash`. Theo tiền lệ của `configHash`, thiếu trường là bản ghi cũ
chứ không phải được miễn — phải chặn, không âm thầm bỏ qua.

Hash cả cây source ở repo lớn có thể chậm. Cần đo, và chỉ đọc file thật sự cần.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Hash cây source không đổi | Hai lần gọi trả cùng giá trị | P0 |
| H2 | Happy | Sửa nội dung một file | Hash đổi | P0 |
| H3 | Happy | Thêm file mới | Hash đổi | P0 |
| H4 | Happy | Xóa một file | Hash đổi | P0 |
| H5 | Happy | check rồi done, không sửa gì | done pass | P0 |
| V1 | Validation | Bản ghi gate thiếu sourceHash | done chặn, báo bản ghi từ phiên bản cũ | P0 |
| V2 | Validation | Gate không chạy trên code (spec) | Không đòi sourceHash | P0 |
| V3 | Validation | Thư mục source không tồn tại | Trả hash ổn định, không crash | P1 |
| E1 | Error | File không đọc được giữa chừng | Không crash, tính là đã đổi | P1 |
| EC1 | Edge | Ghi record vào .compass sau khi hash | Hash không đổi | P0 |
| EC2 | Edge | Đổi tên file, giữ nguyên nội dung | Hash đổi | P0 |
| EC3 | Edge | Sửa file trong node_modules | Hash không đổi | P0 |
| S1 | Security | Sửa code sau khi mọi gate xanh | done chặn, nêu tên gate | P0 |
