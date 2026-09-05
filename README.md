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

Gate đã có: `spec`, `convention`, `test` — 253 test.
Còn thiếu: `ui`, `visual`, `review`, knowledge base, điều tra, multi-repo.

Task `feature-s` trở lên đóng xanh **mà chưa ai đo giao diện** — `done` liệt kê rõ gate nào
chưa được kiểm. Đọc dòng đó.

## Quy ước

Viết luật một lần vào `.knowledge/decided/conventions.md` — vừa là tài liệu, vừa là gate:

    ## Không hardcode mã màu

    Màu phải đi qua CSS variable.

    ```rule
    id: no-hex-color
    type: forbid-pattern
    pattern: "#[0-9a-fA-F]{3,8}"
    scope: src/**/*.jsx
    severity: error
    ```

Không có file này thì gate pass và nói rõ là chưa có luật nào.

## Reporter

Compass tìm test ID trong output, nên reporter phải in tên từng test:

| Runner | Lệnh |
|---|---|
| `node --test` | chạy sẵn |
| Vitest | `vitest run --reporter=tap` |
| Jest | `jest --verbose` |

## Ví dụ

[examples/todo](examples/todo/) — todo list React, task `feature-s` 13 test case.

Thiết kế đầy đủ: [docs/superpowers/specs/2026-09-05-compass-design.md](docs/superpowers/specs/2026-09-05-compass-design.md)
