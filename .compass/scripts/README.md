# Công cụ điều tra

Mọi file viết trong lúc điều tra thì lưu vào đây, đừng viết tạm rồi vứt. Thư mục này
git-tracked — lần sau gặp lại câu hỏi cũ thì có sẵn mà dùng.

Ba loại, ba chỗ:

| Loại | Đặt ở |
|---|---|
| Chạy bằng `node` (`.mjs`) | ngay đây |
| Query dán vào client (`.sql`) | `queries/` |
| Công cụ mở bằng trình duyệt (`.html`) | `tools/` |

`compass scripts` quét cả thư mục con nên chia ra không mất gì. Mỗi file mở đầu bằng một
dòng comment nói nó làm gì; `compass scripts` đọc đúng dòng đó, và nhận cú pháp của cả năm
loại comment: `//`, `#`, `--`, `/* */`, `<!-- -->`.

Mặc định chỉ đọc. Script có ghi phải đòi cờ `--write` và hỏi lại trước khi ghi.

## File `.sql` nhiều query (trong `queries/`)

Khai tên file kết quả ngay trên từng query, để khỏi phải nghĩ tên lúc export:

```sql
-- @out: INV-4-q0-status-dist-0908.csv
select ...;

-- @out: -          ← ca chạy tay, có placeholder phải thay
select ... where Email = '<EMAIL>';
```

`compass data <id> queries/<file>.sql` đối chiếu khai báo với file thật trong `.compass/<id>/data/`.
