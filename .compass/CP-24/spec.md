# CP-24: Bảng dò config thiếu ba trường hợp gặp thật khi dựng 15 repo
Loại: fix
Phạm vi: SKILL.md
Kiểm bằng: mắt

## Mục tiêu

Mục "Dựng config cho dự án nhiều repo" trong `SKILL.md` bổ sung ba thứ agent vấp khi dựng config cho
`MEI/multi-repo`, cộng bảng cờ reporter:

1. **Key repo là đường dẫn nhiều tầng.** `store/` chứa `backend/` (PHP) và `frontend/` — hai repo, một
   thư mục cha. `repos.mjs` `path.resolve` key rồi kiểm `isInside`, nên `"store/backend"` hợp lệ. Skill
   không nói, nên agent hoặc bỏ sót cả `store` hoặc khai một entry rồi đặt lệnh test sai.
2. **Cổng dev mặc định.** Skill bảo đọc cổng từ `vite.config`/`next.config`, nhưng 3 trên 5 frontend
   không khai — chúng dùng mặc định framework. Không nói lấy mặc định nào thì agent đoán, và hai repo
   Vite cùng nhận 5173 rồi tranh cổng.
3. **Angular.** Không phải Vite cũng không phải Next. `skynet2` khai cổng 5555 trong `angular.json`.

Cộng bảng cờ reporter: mục "Cách Compass đếm test ID" nói Vitest cần `--reporter=tap`, Jest cần
`--verbose`, nhưng không nói ghép vào đâu. Nay CP-23 đã bỏ `testReporter`, chỗ duy nhất để ghép là
lệnh `test` trong config — phải nói rõ.

Xong nghĩa là hai ca dưới đều đạt và `SKILL.md` vẫn dưới 480 dòng.

## Ràng buộc

Ngân sách 480 dòng. Hiện 460 sau CP-22/CP-23 — còn khoảng 20 dòng, phải viết gọn.

Không lặp lại thứ đã có. Mục "Cách Compass đếm test ID" đã liệt kê cờ của từng runner; chỗ mới chỉ
nói **ghép vào đâu**, không chép lại danh sách.

## Rủi ro hồi quy

`SKILL.md` là file agent đọc mỗi phiên. Viết dài thêm là lấy ngân sách ngữ cảnh của mọi task sau này,
kể cả task không liên quan đến đa repo.

Số cổng mặc định phải đúng. Ghi sai thì agent dựng config trỏ vào cổng không có gì, `ui`/`visual` chạy
rồi đỏ mà lý do nằm ở tài liệu chứ không ở code.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-24-H1 | Happy | Đọc mục "Dựng config" sau khi sửa | Có đủ 4 điểm: key đa tầng, cổng mặc định 3 framework, cảnh báo đụng cổng, ghép cờ vào lệnh test | P0 |
| CP-24-EC1 | Edge | Đếm dòng `SKILL.md` | Dưới 480 | P0 |
