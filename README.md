# Compass

Quy trình phát triển có bằng chứng cho Claude Code: spec trước code, gate máy chạy thật thay vì AI tự khai kết quả.

Kèm bộ quy tắc trả lời tiếng Việt — cài xong là có hiệu lực ở mọi phiên, không cần gọi lệnh gì.

## Cài

Trong Claude Code, chạy hai lệnh:

```
/plugin marketplace add https://github.com/thuyetdn/compass.git#compass-v2
/plugin install compass@compass
```

Xong. Không cần clone, không cần sửa file tay.

Repo private, nên máy cài phải đã đăng nhập git vào tài khoản có quyền đọc
`thuyetdn/compass`. Máy chưa có credential sẽ fail ở bước `marketplace add`.

Kiểm tra: mở phiên mới, hỏi Claude "quy tắc trả lời tiếng Việt của tôi là gì". Nếu nó kể được các mục Ngắn / Nói thẳng / Từ ngữ thì hook đang chạy.

## Cập nhật

```
/plugin marketplace update compass
```

## Gỡ

```
/plugin uninstall compass
```

## Có gì trong này

| Đường dẫn | Việc |
|---|---|
| `skills/compass/SKILL.md` | Quy trình spec-first và gate |
| `skills/compass/references/ngon-ngu.md` | Quy tắc trả lời tiếng Việt — **bản nguồn duy nhất** |
| `scripts/nap-ngon-ngu.mjs` | SessionStart hook, đọc file trên rồi bơm vào context |
| `hooks/hooks.json` | Đăng ký hook |
| `.claude-plugin/` | Manifest plugin và marketplace |

Sửa quy tắc ngôn ngữ thì sửa đúng một chỗ: `references/ngon-ngu.md`. Hook đọc thẳng từ đó, không có bản copy nào khác.

## Yêu cầu

Node (đã có sẵn nếu chạy được Claude Code). Chạy trên Windows, macOS, Linux — hook dùng `${CLAUDE_PLUGIN_ROOT}` nên đường dẫn tự đúng theo hệ điều hành.
