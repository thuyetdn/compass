# CP-21: done leaves no record that it ran
Loại: fix
Phạm vi: commands/done.mjs, commands/status.mjs

## Mục tiêu
`done` đọc sổ gate, phán pass/fail, rồi không ghi gì. Đo được: chạy `compass done CP-1` xanh,
rồi đọc `gate.json` — chỉ có `spec`, `test`, `knowledge`. Không dấu vết nào của `done`.

Ba hệ quả:

1. **Không lệnh nào biết task đã đóng.** `status` liệt kê gate đã chạy, và `done` không nằm
   trong đó — nhìn vào không phân biệt được task xong với task đang làm.
2. **Không có bằng chứng cho chính cổng cuối.** Mọi gate khác đều ký và lưu; riêng cổng quyết
   định "xong hay chưa" thì không.
3. **CP-16 tự mâu thuẫn.** Nó thêm luật "gate đã chạy mà đỏ thì chặn", kèm chú thích rằng khoá
   `done` bị lọc sẵn. Nhưng khoá đó chưa từng tồn tại.

Xong nghĩa là: `done` ghi bản ghi đã ký như mọi gate, và `status` đọc được để nói task đã đóng.

## Ràng buộc
Bản ghi `done` không được tự chặn lần chạy sau. Đóng rồi chạy lại `done` phải vẫn xanh —
không thì task đóng một lần là hết đường kiểm lại.

Không đổi điều kiện pass/fail hiện có. Task nào đang đóng được thì vẫn đóng được.

## Rủi ro hồi quy
42 test đang canh `done`. `verifyAllGates` duyệt mọi khoá trong sổ — thêm khoá `done` mà bản
ghi thiếu trường thì nó báo gian lận cho một task hợp lệ.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `done` xanh | Ghi bản ghi `done` đã ký vào sổ | P0 |
| H2 | Happy | `status` sau khi đóng | Nói rõ task đã đóng | P0 |
| H3 | Happy | Chạy `done` hai lần | Lần hai vẫn xanh | P0 |
| V1 | Validation | `done` đỏ | Không ghi bản ghi xanh giả | P0 |
| V2 | Validation | Bản ghi `done` bị sửa tay | `verifyAllGates` bắt được | P0 |
