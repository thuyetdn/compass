# CP-6: Review gate driven by an independent agent
Loại: feature-m
Phạm vi: lib/review-brief.mjs, lib/findings.mjs, commands/review.mjs

## Mục tiêu
Người viết code không soi được code mình vừa viết — đã bỏ công vào thì thấy nó hợp lý. Gate
`review` cắt đường đó: sinh brief chỉ có diff và spec, không có lịch sử chat, không có lý do
AI đã làm thế. Agent khác đọc brief, trả findings theo format cứng, Compass đọc findings và
phán.

Xong nghĩa là: `compass review <id>` sinh `review-brief.md`; agent nộp findings vào
`evidence/findings.json`; chạy lại `compass review <id>` đọc findings và fail nếu có mức
Critical hoặc Major.

## Ràng buộc
Compass không spawn agent. Nó chỉ chạy, đo, ghi và phán — nghĩ là việc của AI. Lệnh này chạy
hai pha: pha một sinh brief và dừng, pha hai đọc findings đã nộp.

Brief **không được** chứa lịch sử hội thoại hay lời giải thích của người viết code. Chứa
những thứ đó là mất hết ý nghĩa của việc soi mù.

Findings phải là JSON đúng format. Sai format thì fail, không đoán.

Chỉ áp dụng từ `feature-m` trở lên, theo bảng gate hiện có.

## Rủi ro hồi quy
`review` vào `IMPLEMENTED_GATES` sẽ chạy trên task `feature-m` và `feature-l`. Test nào đang
dùng `review` làm ví dụ "gate chưa xây" sẽ đổi kết quả — đã gặp ba lần rồi, phải rà lại.

Pha một trả exit khác 0 để chặn `check` đi tiếp. Nếu trả 0 thì `done` sẽ pass với một gate
mới chỉ sinh brief chứ chưa ai soi — đúng kiểu lỗi Compass sinh ra để chặn.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Sinh brief lần đầu | Tạo review-brief.md, exit khác 0, nêu bước tiếp theo | P0 |
| H2 | Happy | Brief chứa diff và spec | Có cả hai phần, đúng nội dung | P0 |
| H3 | Happy | Findings rỗng | Gate pass | P0 |
| H4 | Happy | Findings chỉ mức Minor | Gate pass, vẫn hiện findings ra | P0 |
| H5 | Happy | Findings có mức Major | Gate fail, nêu từng finding | P0 |
| V1 | Validation | findings.json không phải JSON | Báo lỗi rõ, không crash | P0 |
| V2 | Validation | Finding thiếu trường severity | Báo lỗi nêu finding thứ mấy | P0 |
| V3 | Validation | severity không thuộc bốn mức | Báo rõ mức hợp lệ | P0 |
| E1 | Error | Không phải repo git | Báo rõ, exit 2 | P1 |
| E2 | Error | Không có thay đổi nào để soi | Báo rõ, không sinh brief rỗng | P1 |
| EC1 | Edge | Findings có mức Critical | Gate fail | P0 |
| EC2 | Edge | Brief đã có, findings chưa nộp | Nhắc lại brief đang chờ, không ghi đè | P0 |
| S1 | Security | Brief không chứa lịch sử chat | Chỉ có diff, spec, tiêu chí — không gì khác | P0 |
| S2 | Security | Task chỉ gồm file mới chưa tracked | Brief chứa đủ nội dung file mới | P0 |
| S3 | Security | Code đổi sau khi nộp findings | Gate fail, sinh brief mới, không dùng findings cũ | P0 |
| EC3 | Edge | Vừa sửa file cũ vừa thêm file mới | Brief chứa cả hai | P0 |
| EC4 | Edge | Pha một chạy sau khi từng pass | Gate record thành fail, done không đóng được | P0 |
| EC5 | Edge | File .compass đổi khi gate ghi record | Không tính là code đổi, review không mở lại | P0 |
| V4 | Validation | Finding có line không phải số nguyên | Bỏ qua trường line, không crash | P1 |
| E3 | Error | Brief bị xóa nhưng findings còn | Gate fail — không có brief thì không có bằng chứng đã soi | P0 |
| P1 | Performance | Diff rất lớn | Không tràn buffer, có giới hạn rõ | P1 |
| P2 | Performance | Chạy hai lần liên tiếp không đổi code | Lần hai không sinh lại brief | P1 |
| S4 | Security | Chạy pha một hai lần rồi mới đổi code | Vẫn phát hiện code đổi, không mất diffHash | P0 |
| S5 | Security | Nộp findings mà chưa từng có brief | Gate fail, không tính là đã soi | P0 |
| S6 | Security | Xóa gate.json rồi chạy lại với findings cũ | Gate fail, không dùng lại findings | P0 |
| S7 | Security | Gate không được để lại file trong index git | git status sau khi chạy giống hệt trước | P0 |
| EC6 | Edge | Brief cũ còn nhưng code đã đổi | Sinh lại brief theo code mới | P0 |
| S8 | Security | Commit rồi thêm code mới rồi commit tiếp | Gate vẫn phát hiện, không dùng findings cũ | P0 |
| S9 | Security | Người dùng đã stage việc xóa một file | Gate chạy xong, staged deletion còn nguyên | P0 |
| S10 | Security | File mới có tên chứa dấu tiếng Việt | Brief chứa file đó | P0 |
| S11 | Security | Không lấy được diff lúc phán | Gate fail exit 2, không bỏ qua mọi kiểm tra | P0 |
| S12 | Security | reviewBase là cờ git thay vì commit | Từ chối, không truyền vào git | P0 |
| S13 | Security | reviewBase trỏ commit không tồn tại | Từ chối, báo rõ | P0 |
| E4 | Error | Repo git chưa có commit nào | Báo rõ, exit 2, không crash | P0 |
| P3 | Performance | Rất nhiều file untracked | Không tràn dòng lệnh | P0 |
| P4 | Performance | Diff vượt giới hạn | Từ chối kèm số đo, không sinh brief khổng lồ | P0 |
| S14 | Security | Diff không lấy được lúc phán | Gate record thành fail, done không đóng được | P0 |
| P5 | Performance | File untracked có đường dẫn dài | Không tràn dòng lệnh, batch theo ký tự | P0 |
| V5 | Validation | findings.json là mảng trần | Báo đúng lý do thiếu brief id, không báo code đã đổi | P1 |
| S15 | Security | Diff chứa dòng ba backtick | Không đóng sớm code fence, cả diff nằm trong khối | P0 |
| S16 | Security | Spec chứa dòng ba backtick | Không đóng sớm code fence của spec | P0 |
| S17 | Security | Spec đổi sau khi soi, code giữ nguyên | Gate chặn ở mọi lần chạy lại, không chỉ lần đầu | P0 |
| EC8 | Edge | Brief bị sửa tay ở pha hai | Sinh lại brief, không giữ bản đã sửa | P1 |
| H6 | Happy | Findings rỗng, ở tầng **gate** | Gate exit 0 (H3 kiểm cùng ca ở tầng parser) | P1 |
| H8 | Happy | Finding mức Minor, ở tầng gate | Gate exit 0 nhưng vẫn in ra finding đó | P1 |
| H7 | Happy | Finding mức Major, ở tầng gate | Gate exit 1, nêu tên finding | P1 |
| EC7 | Edge | Finding mức Critical, ở tầng gate | Gate exit 1 | P1 |
| V6 | Validation | findings.json không phải JSON hợp lệ | Exit 2, không phải gate đỏ | P1 |
| V7 | Validation | Finding thiếu trường `detail` | Exit 2, nêu đúng tên trường thiếu | P1 |
| EC9 | Edge | Project lồng ghi vào `.compass/` của nó | Không tính là đổi code, review không mở lại | P0 |
| S18 | Security | Xoá `gate.json` khi code và findings y nguyên | Không xanh trở lại — không sổ thì không bằng chứng | P0 |
| S19 | Security | Sửa brief **sau** khi verdict đã có | Mở lại review — đổi câu hỏi sau khi có câu trả lời | P0 |
| S20 | Security | Brief biến mất khi code y nguyên | Gate đỏ **và** sổ đỏ theo — `done` đọc sổ, không chạy lại gate | P0 |
| S21 | Security | findings.json hỏng định dạng | Sổ cũng phải đỏ, không giữ verdict xanh cũ | P0 |
| V8 | Validation | Finding thiếu `title` | Từ chối, nêu đúng tên trường | P1 |
| V9 | Validation | Trường chỉ có khoảng trắng | Tính là thiếu | P1 |
| V10 | Validation | Phần tử findings không phải object | Từ chối, không crash | P1 |
| V11 | Validation | Trường `file` sai kiểu | Bỏ đi, không mang theo đường dẫn giả | P1 |
