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

Dùng với Claude Code thì cài kèm skill — AI đọc quy trình rồi mới gõ lệnh:

```
/plugin marketplace add <đường-dẫn-tới-repo>
/plugin install compass@compass
```

Quy trình AI phải theo nằm ở [`skills/compass/SKILL.md`](skills/compass/SKILL.md).

## Dùng

```bash
compass init T-001 --type=feature-s   # tạo spec skeleton
# điền .compass/T-001/spec.md
compass spec T-001                     # kiểm tra spec hợp lệ
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
| Chạy test, đo, kiểm tra | ❌ | ✅ |
| Ghi bằng chứng | ❌ | ✅ |
| Phán pass/fail | ❌ | ✅ |

Gate record có chữ ký — sửa tay là lộ.

## Trạng thái

Bảy gate: `spec`, `knowledge`, `convention`, `test`, `ui`, `visual`, `review`.

Hai loại việc: BUILD (`init` → `spec` → `check` → `done`) và điều tra (`investigate` → `--close`).
Khai nhiều repo trong `config.json` nếu một task đụng nhiều nơi.

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

### Khi một ID khớp nhiều test

Spec nào cũng dùng `H1`, `V1`, `EC1`. Nhiều task chạy chung một suite thì các ID đó
trùng nhau, và gate không biết test nào của task nào — task chưa viết dòng test nào
vẫn qua được.

Nên gate đỏ khi một ID khớp từ hai test khác nhau trở lên:

```
✗ Gate test FAILED
  Khớp nhiều test khác nhau, không rõ cái nào là của task này: H1
        H1 thêm một việc
        H1 xoá một việc
```

Đường thoát: đặt tên test kèm task id.

```js
test('T-12-H1 thêm một việc', ...)   // gate nhận ra đây là test của T-12
```

Chỉ cần đổi tên test của task đang làm, không phải đổi test của người khác. Nhận cả
`T-12-H1`, `T-12: H1`, `[T-12] H1`.

## Test

```bash
npm test           # suite chính, vài giây
npm run test:deep  # 10 test qua CLI thật trên examples/todo, ~100 giây
```

Suite sâu cần Playwright ở `examples/todo`; thiếu thì nó skip kèm hướng dẫn cài, không fail.

## Ví dụ

[examples/todo](examples/todo/) — todo list React, task `feature-s` 13 test case.

Thiết kế đầy đủ: [docs/superpowers/specs/2026-09-05-compass-design.md](docs/superpowers/specs/2026-09-05-compass-design.md)
