# CP-17: Bản cài mang theo spec nội bộ và test của chính Compass
Loại: bug
Phạm vi: package.json

## Mục tiêu
`package.json` không khai `files`, nên `npm pack` gói tất cả những gì không bị `.gitignore`:

```
136 file · 1.7 MB
  .compass/    31 file — spec nội bộ, review-brief 143KB
  test/        41 file
  examples/    16 file
  docs/         6 file
```

Người cài `compass` sẽ có 15 spec nội bộ của repo này nằm trong `node_modules`. Ba hệ quả:

1. **Rác.** 1.7MB cho một CLI cần chưa tới 200KB.
2. **Nhầm lẫn.** `node_modules/compass/.compass/` trông y hệt thư mục làm việc của người dùng.
3. **Rò rỉ.** Review-brief chứa nguyên diff của repo. Với dự án nội bộ thì đó là mã nguồn.

Xong nghĩa là: bản đóng gói chỉ có thứ cần để chạy, và có test canh điều đó.

## Ràng buộc
Phải giữ được `templates/` — `init` và `investigate` đọc file trong đó lúc chạy. Thiếu là hỏng.

`SKILL.md` và `writing-vi.md` cũng phải giữ: chúng là tài liệu agent đọc, không phải tài liệu
người đọc, nên không thể chỉ để trên GitHub.

Không được sửa `.gitignore` để đạt mục tiêu — `.compass/` phải còn trong git, đó là bằng chứng
của repo này.

## Rủi ro hồi quy
Khai thiếu một mục trong `files` thì lệnh liên quan hỏng, mà suite chạy trong repo gốc nên
**không phát hiện được** — test đọc file qua đường dẫn tương đối, luôn thấy đủ.

Nên test phải soi chính danh sách `files`, hoặc chạy `npm pack` thật.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `files` có mọi thư mục lệnh cần | `lib`, `commands`, `templates` đều có | P0 |
| H2 | Happy | `files` có tài liệu agent đọc | `SKILL.md`, `writing-vi.md` đều có | P0 |
| H3 | Happy | Gói không chứa `.compass/` hay `.knowledge/` | Không rò hồ sơ nội bộ | P0 |
| H4 | Happy | Gói không chứa `test/` | Không rác | P1 |
| V1 | Validation | Mọi mục trong `files` đều tồn tại thật | Không khai file ma | P0 |
| V2 | Validation | Mọi file `templates/` mà code đọc đều được gói | `init` chạy được sau khi cài | P0 |
| E1 | Error | `package.json` đọc được và là JSON hợp lệ | Không crash | P1 |
| EC1 | Edge | `bin` trỏ tới file có trong gói | `compass` gọi được | P0 |
| EC2 | Edge | Thêm thư mục mới vào `lib/` | Vẫn được gói, không cần sửa `files` | P1 |
| V3 | Validation | `npm pack` thật không gói hồ sơ nội bộ, kể cả `.compass/` lồng | Hỏi npm, không hỏi mảng `files` | P0 |
| V4 | Validation | File rác trong thư mục đã khai | Bị bắt — `.gitignore` không áp ở đó | P0 |
| EC3 | Edge | Mọi file npm gói đều nằm trong `files` | Trừ những file npm luôn tự thêm | P0 |
| EC4 | Edge | Mục thư mục không dấu `/` (`lib`) | Không tràn sang `library.md` hay `libfoo/` | P1 |
| E2 | Error | Output npm có chữ lạ trước JSON | Cắt từ dấu `[` — `prepack` in ra màn hình không được làm chết bốn ca | P1 |
