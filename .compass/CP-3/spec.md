# CP-3: Convention gate that runs rules declared in conventions.md
Loại: feature-s
Phạm vi: lib/rule-parser.mjs, lib/rule-runner.mjs, commands/convention.mjs, cli.mjs

## Mục tiêu
Quy ước dự án viết một lần trong `.knowledge/decided/conventions.md`, vừa là tài liệu người
đọc vừa là luật máy thi hành. Khối ```rule``` trong file đó khai báo luật; gate `convention`
đọc chúng, quét source, và fail khi có vi phạm mức `error`.

Xong nghĩa là: `compass convention <id>` chạy được, đọc luật từ conventions.md, báo đúng
file và số dòng vi phạm, ghi gate record có chữ ký như các gate khác.

## Ràng buộc
Zero runtime dependency — không dùng ESLint. Thiết kế §8.3 nói "sinh ESLint config tạm rồi
chạy lint", nhưng ESLint là dependency nặng và buộc dự án đích phải cài nó. Thay bằng: tự
khớp mẫu trong Compass. Đánh đổi: chỉ làm được luật dạng `forbid-pattern`, không phân tích
được AST. Luật cần AST để sau, khi có nhu cầu thật.

Không quét `node_modules/`, `dist/`, và mọi thứ trong `.gitignore` của dự án đích.
Thiếu `conventions.md` không phải lỗi — gate pass, báo rõ là không có luật nào.

## Rủi ro hồi quy
`convention` đứng trước `test` trong thứ tự chạy của `check`. Gate mới fail sẽ chặn `test`
chạy — đúng ý đồ "chạy rẻ trước", nhưng mọi test đang khẳng định `check` chạy tới `test`
trên task `feature-s` sẽ đổi kết quả nếu dự án test có conventions.md. Phải rà lại.

Quét file bằng regex trên toàn repo có thể chậm với repo lớn. Cần giới hạn phạm vi và đo.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Parse một khối rule đủ trường | Trả về object có id, type, pattern, scope, severity | P0 |
| H2 | Happy | Parse nhiều khối rule trong một file | Trả về đủ số luật, đúng thứ tự | P0 |
| H3 | Happy | Source sạch, không vi phạm | Gate pass, exit 0 | P0 |
| H4 | Happy | Source vi phạm một luật | Gate fail, nêu đúng file và số dòng | P0 |
| H5 | Happy | Không có conventions.md | Gate pass, báo không có luật nào | P0 |
| V1 | Validation | Khối rule thiếu trường bắt buộc | Báo lỗi nêu tên trường thiếu, không crash | P0 |
| V2 | Validation | Luật có type chưa hỗ trợ | Báo rõ type đó chưa hỗ trợ, không âm thầm bỏ qua | P0 |
| V3 | Validation | Pattern regex không hợp lệ | Báo lỗi nêu tên luật, không crash | P0 |
| E1 | Error | conventions.md không đọc được | Trả lỗi rõ ràng, exit 2 | P1 |
| E2 | Error | Thư mục scope không tồn tại | Không crash, coi như không có file để quét | P1 |
| EC1 | Edge | Luật severity warn có vi phạm | Gate vẫn pass, vi phạm hiện ra dạng cảnh báo | P0 |
| EC2 | Edge | Vi phạm nằm trong node_modules | Không tính là vi phạm | P0 |
| S1 | Security | Pattern chứa cấu trúc gây bùng nổ backtrack | Có giới hạn, không treo vô hạn | P1 |
