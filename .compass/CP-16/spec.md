# CP-16: `done` bỏ qua gate đỏ nằm ngoài danh sách bắt buộc
Loại: bug
Phạm vi: commands/done.mjs

## Mục tiêu
CP-15 là loại `bug`, chỉ bắt buộc ba gate: `spec`, `knowledge`, `test`. Nhưng nó đã chạy thêm
`convention` và `review` — vì task sửa cách gate đối chiếu, chỗ đó đáng soi kỹ.

`review` đỏ (exit 1). `done` vẫn xanh:

```
✓ Gate done PASSED — 3 gate đã pass
Task CP-15 hoàn thành.
```

`done` chỉ duyệt `rules.gates`, nên gate chạy thêm rồi đỏ thì nó không nhìn. Đúng là "báo xong
khi chưa xong" — ngay tại cổng sinh ra để chặn điều đó.

Xong nghĩa là: gate nào đã chạy mà đỏ thì `done` chặn, bất kể loại task có bắt buộc hay không.

## Ràng buộc
Không được biến gate chưa chạy thành lỗi. Loại `bug` không đòi `ui` thì thiếu `ui` vẫn phải
đóng được — chỉ gate **đã có bản ghi và đỏ** mới chặn.

Phải có đường ra: người chạy thử một gate rồi thấy không cần thì xoá bản ghi được, không bị
kẹt vĩnh viễn.

Bản ghi `done` của chính lần chạy trước không được tự tính là gate đỏ. (`done` không nằm
trong `IMPLEMENTED_GATES` nên dòng lọc đã loại — không cần kiểm riêng.)

Thông báo phải nêu **lệnh chạy được thật**. `compass check --only=<gate>` từ chối gate ngoài
danh sách loại task, nên gợi ý nó là chỉ người ta đâm vào tường.

## Rủi ro hồi quy
28 test đang canh `done`. Thêm điều kiện chặn mà sai thì task cũ không đóng được.

`readGates` trả về cả khoá `done` — nếu không loại ra thì lần `done` đỏ đầu tiên sẽ tự chặn
mọi lần sau, kể cả sau khi đã sửa hết.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Gate ngoài danh sách đã chạy và xanh | `done` xanh như cũ | P0 |
| H2 | Happy | Gate ngoài danh sách đã chạy và đỏ | `done` đỏ, nêu tên gate | P0 |
| H3 | Happy | Thông báo nêu lệnh chạy lại được thật | Không gợi ý `--only` vì nó bị từ chối | P0 |
| H4 | Happy | Nhiều gate ngoài danh sách cùng đỏ | Nêu tất cả | P1 |
| V1 | Validation | Gate ngoài danh sách chưa chạy | Không chặn — không bắt buộc | P0 |
| V2 | Validation | Gate bắt buộc đỏ | Vẫn báo như cũ, không đổi thông báo | P0 |
| V3 | Validation | Bản ghi `done` đỏ của lần trước | Không tự chặn chính mình | P0 |
| E1 | Error | Khoá lạ trong gate.json, không phải gate nào | Bỏ qua, không crash | P0 |
| V4 | Validation | Gate ngoài danh sách xanh nhưng `sourceHash` mốc | Vẫn chặn — xanh mốc không phải bằng chứng | P0 |
| E2 | Error | Bản ghi khuyết `exitCode` | Chặn, và nói đúng là bản ghi hỏng | P1 |
| EC1 | Edge | Loại `feature-m` — mọi gate đều bắt buộc | Không có gate nào "ngoài danh sách" | P1 |
| EC2 | Edge | Xoá bản ghi gate đỏ rồi chạy lại | `done` xanh | P0 |
| H5 | Happy | Gate ngoài danh sách mốc hash | Nêu lệnh chạm được nó, không gợi ý `check` | P0 |
| H6 | Happy | Gate bắt buộc đỏ | Vẫn gợi ý `check` như cũ | P0 |
| S1 | Security | Gate đỏ ở khe repo (`convention@be`) | Vẫn chặn — khe mang tên repo cũng là gate | P0 |
| S2 | Security | Problem không tự kèm lời khuyên | Hint `check` phải còn — đừng đoán từ chuỗi | P0 |
| S3 | Security | Gate bắt buộc mốc hash | Khuyên `check`, không mách xoá bằng chứng | P0 |
| S4 | Security | Gate **bắt buộc** đỏ ở khe repo (`test@be`) | Vẫn chặn — nó rơi giữa hai vòng nếu chỉ so tên gate | P0 |
| E3 | Error | Khoá `null` trong sổ gate | Báo sổ hỏng, không ném TypeError | P1 |
