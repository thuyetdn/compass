# Quy ước — todo demo

Người đọc để hiểu, máy đọc để thi hành. Khối ```rule``` là phần Compass chạy.

## Không hardcode mã màu

Màu phải đi qua CSS variable để đổi theme được.

✅ `color: var(--text-primary)`
❌ `color: #333333`

```rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}\b"
scope: src/**/*.jsx
severity: error
message: Dùng CSS variable thay vì mã màu
```

## Không để lại console.log

Log lọt vào production làm rối devtools của người dùng.

```rule
id: no-console-log
type: forbid-pattern
pattern: "console\.log\("
scope: src/**/*.jsx
severity: error
message: Bỏ console.log trước khi commit
```

## Không dùng test-id để query

Test phải nhìn app như người dùng nhìn: theo role và text.

```rule
id: no-test-id
type: forbid-pattern
pattern: "getByTestId|data-testid"
scope: test/**/*.jsx
severity: error
message: Query bằng role hoặc text người dùng thấy
```

## Tránh TODO không có người nhận

Quy ước mềm — chỉ cảnh báo.

```rule
id: bare-todo
type: forbid-pattern
pattern: "TODO(?!\()"
scope: src/**/*.jsx
severity: warn
message: Ghi TODO(tên) để biết ai lo
```
