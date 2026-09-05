# Compass

Quy trình phát triển có bằng chứng kiểm chứng được — cho AI có tool.

## Vấn đề

AI báo "xong" khi chưa xong. Không phải vì nói dối — vì nó thật sự tin thế.
Quy trình viết bằng tài liệu thì AI đọc rồi phớt lờ được. Quy trình viết bằng
exit code thì không.

## Cài

```bash
npm install -g .
```

Hoặc chạy trực tiếp: `node cli.mjs <lệnh>`

## Dùng

```bash
compass init T-001 --type=feature-s   # tạo spec skeleton
# điền .compass/T-001/spec.md
compass spec T-001                     # kiểm spec hợp lệ
# người duyệt → viết code + test
compass check T-001                    # chạy mọi gate
compass done T-001                     # cổng cuối
```

## Cấu hình

`.compass/config.json`:

```json
{
  "test": "npm test"
}
```

`test` là lệnh chạy test suite của dự án — Compass tự spawn nó, tự bắt exit code.

## Nguyên tắc

| | AI | Compass |
|---|---|---|
| Viết spec, code, test | ✅ | ❌ |
| Chạy test, đo, kiểm | ❌ | ✅ |
| Ghi bằng chứng | ❌ | ✅ |
| Phán pass/fail | ❌ | ✅ |

Gate record có chữ ký — sửa tay là lộ.

## Trạng thái

GĐ 1: gate `spec` và `test`.
GĐ 2-4: `convention`, `ui`, `visual`, `review`, knowledge base, điều tra, multi-repo.

Thiết kế đầy đủ: [docs/superpowers/specs/2026-09-05-compass-design.md](docs/superpowers/specs/2026-09-05-compass-design.md)
