# Quy ước — Compass

Người đọc để hiểu, máy đọc để thi hành. Khối ```rule``` là phần Compass tự chạy trên chính nó.

## Zero runtime dependency

Compass chỉ dùng Node built-in. Thêm một package là buộc mọi dự án đích phải cài nó.

Import phải từ `node:*` hoặc đường dẫn tương đối.

```rule
id: no-bare-import
type: forbid-pattern
pattern: "^import .* from '[^.n]"
scope: lib/**/*.mjs
severity: error
message: Chỉ import từ node:* hoặc đường dẫn tương đối
```

## lib/ không được thoát tiến trình

`lib/` phải test được. Chỉ `cli.mjs` mới được đặt exit code.

```rule
id: no-exit-in-lib
type: forbid-pattern
pattern: "process\.exit"
scope: lib/**/*.mjs
severity: error
message: lib/ trả về giá trị, cli.mjs mới set exit code
```

## Không nối chuỗi đường dẫn

Dự án chạy trên Windows. Nối chuỗi là hỏng.

```rule
id: no-path-concat
type: forbid-pattern
pattern: "['\"]\s*\+\s*['\"]/"
scope: lib/**/*.mjs
severity: error
message: Dùng path.join thay vì nối chuỗi
```

## Không để lại console.log trong lib

`lib/` trả dữ liệu, không in ra màn hình.

```rule
id: no-console-in-lib
type: forbid-pattern
pattern: "console\.log\("
scope: lib/**/*.mjs
severity: error
message: lib/ trả giá trị, commands/ lo phần hiển thị
```
