# CP-31: Pitfall được ghi tự động nhưng không ai bảo đọc
Loại: fix
Phạm vi: SKILL.md
Kiểm bằng: mắt

## Mục tiêu

Bước 1 — Định hướng bảo agent đọc `.knowledge/decided/pitfalls.md`.

Đóng điều tra thì Compass chép pitfall vào file đó, và `--close` chặn nếu thiếu pitfall — ghi lại là
bắt buộc. Nhưng không bước nào bảo đọc, không gate nào đọc. Bước 1 nhắc `index.md` mà bỏ qua
`pitfalls.md`. `SKILL.md` chỉ nói "lần sau đọc được", không nói "lần sau phải đọc".

Kết quả: pitfall nằm im, tái dùng phụ thuộc vào việc agent tình cờ mở file. `MEI/multi-repo` đã có
hai mục trong `pitfalls.md` — một cái cảnh báo gate `visual` sẽ **xanh trên ảnh sai** khi ba frontend
dùng chung cổng 5173. Đó là loại bẫy tốn cả buổi nếu gặp lại mà không biết.

Xong nghĩa là hai ca dưới đều đạt.

## Ràng buộc

Ngân sách 480 dòng. Phải cắt chỗ khác trước khi thêm.

Không biến nó thành gate. Đọc tài liệu là việc agent làm, máy không kiểm được — thêm gate ở đây là
hứa một thứ không đo được.

## Rủi ro hồi quy

Bước 1 là chỗ agent đọc trước mọi task. Thêm một bước nữa vào đây làm mọi task dài thêm, kể cả task
không dính bẫy nào.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-31-H1 | Happy | Đọc Bước 1 | Có dòng bảo đọc `.knowledge/decided/pitfalls.md`, kèm lý do | P0 |
| CP-31-EC1 | Edge | Đếm dòng SKILL.md | Không quá 480 | P0 |
