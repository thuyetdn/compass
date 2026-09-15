# Compass

Quy trình phát triển có bằng chứng cho Claude Code: spec trước code, gate máy chạy thật thay vì AI tự khai kết quả.

Kèm bộ quy tắc trả lời tiếng Việt, cài xong là tự áp dụng ở mọi phiên mới, không cần gọi lệnh gì. Hook nạp luật lúc mở phiên, nên sửa luật giữa chừng thì phải `/clear` mới thấy.

## Cài

Trong Claude Code, chạy hai lệnh:

```
/plugin marketplace add https://github.com/thuyetdn/compass.git#compass-v2
/plugin install compass@compass
```

Không cần clone, không cần sửa file tay.

Repo private, nên máy cài phải đã đăng nhập git vào tài khoản có quyền đọc
`thuyetdn/compass`. Máy chưa có credential sẽ fail ở bước `marketplace add`.

Kiểm tra bằng máy, đừng hỏi Claude xem nó có nhớ luật không. Chạy thẳng hook trong thư mục plugin đã cài:

```
$ node scripts/load-language.mjs
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"# Cách trả lời tiếng Việt (compass)...
```

Ra JSON như trên là hook đọc được file luật. Im lặng hoặc báo `khong tim thay language.md` là hỏng đường dẫn.

## Cập nhật

```
/plugin marketplace update compass
/plugin update compass
```

Cần cả hai. Lệnh đầu kéo bản mới về marketplace clone, lệnh sau mới thay bản đang cài. Chạy mỗi lệnh đầu thì code mới nằm im trong clone, Claude Code vẫn chạy bản cũ.

Bản cài so theo `version` trong manifest chứ không so commit, nên sửa code mà quên tăng version thì update bỏ qua.

## Gỡ

```
/plugin uninstall compass
```

## Có gì trong này

| Đường dẫn | Làm gì |
|---|---|
| `skills/flow/SKILL.md` | Quy trình spec-first và gate, gọi bằng `/compass:flow` |
| `skills/flow/references/language.md` | Quy tắc trả lời tiếng Việt, **bản nguồn duy nhất** |
| `scripts/load-language.mjs` | SessionStart hook, đọc file trên rồi nạp vào context |
| `scripts/check-voice.mjs` | Stop hook, chặn câu trả lời dính cụm giọng dịch |
| `hooks/hooks.json` | Đăng ký hook |
| `.claude-plugin/` | Manifest plugin và marketplace |

Sửa quy tắc ngôn ngữ thì sửa đúng một chỗ: `references/language.md`. Hook đọc thẳng từ đó, không có bản copy nào khác.

## Hook chặn giọng dịch

Nhắc Claude giữ giọng thì nó vẫn quên, nên có hook chặn thật. Cuối mỗi lượt, `check-voice.mjs` đọc câu trả lời rồi dò các cụm trong bảng "Giọng dịch" của `language.md`. Dính thì chặn, Claude phải viết lại mới gửi đi được.

Bảng là nguồn duy nhất: thêm một dòng vào đó là hook bắt thêm cụm ấy, không phải sửa script.

Thử tay:

```
$ echo '{"stop_hook_active":false,"last_assistant_message":"cách sửa rẻ nhất"}' | node scripts/check-voice.mjs
compass: câu trả lời dính 1 chỗ giọng dịch, chưa gửi đi được.
  - cách sửa rẻ nhất
```

Hook chỉ bắt được cụm cố định trong bảng. Lỗi cấu trúc (heading dài thành cả câu, tự chế ẩn dụ) thì grep không thấy, phần đó do bước subagent viết lại lo, mô tả trong `language.md` mục "Cách kiểm tra".

Block code trong câu trả lời được bỏ qua khi dò, vì output lệnh không phải văn Claude viết.

## Yêu cầu

Node (đã có sẵn nếu chạy được Claude Code). Chạy trên Windows, macOS, Linux. Hook dùng `${CLAUDE_PLUGIN_ROOT}` nên đường dẫn tự đúng theo hệ điều hành.
