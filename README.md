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
| `skills/flow/SKILL.md` | Quy trình 5 bước: phân làn, spec, gate, commit, báo cáo |
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

Grep chỉ bắt được cụm cố định trong bảng. Lỗi tôi chế ra lần đầu thì tra chuỗi không thấy: tự chế thuật ngữ, câu hỏi sai tiểu từ, heading dài thành cả câu. Đó là việc của lớp thứ hai.

### Lớp hai: subagent đọc lại

Grep sạch rồi thì Stop hook đưa câu trả lời cho một subagent đọc, khai báo bằng `"type": "agent"` trong `hooks.json`. Subagent không phải người vừa viết nên nhìn ra lỗi, thấy câu nào người Việt không nói ngoài đời thì chặn và chỉ chỗ sai. Claude viết lại, duyệt lại lần nữa, sạch mới tới tay bạn.

Stop hook không sửa thẳng được chữ trong câu trả lời, Claude Code không cho. Nó chỉ chặn được, nên người viết lại vẫn là Claude, subagent chỉ soi.

Giá phải trả: mỗi lượt chậm thêm vài giây và tốn thêm token. Timeout đặt 60 giây. Chống lặp vô hạn có sẵn, `check-voice.mjs` đọc `stop_hook_active` để bỏ qua lần chặn thứ hai, còn Claude Code tự cắt sau 8 lần chặn liên tiếp.

Tắt lớp này thì xóa block `"type": "agent"` trong `hooks/hooks.json`, grep vẫn chạy.

Block code trong câu trả lời được bỏ qua khi dò, vì output lệnh không phải văn Claude viết.

## Yêu cầu

Node (đã có sẵn nếu chạy được Claude Code). Chạy trên Windows, macOS, Linux. Hook dùng `${CLAUDE_PLUGIN_ROOT}` nên đường dẫn tự đúng theo hệ điều hành.
