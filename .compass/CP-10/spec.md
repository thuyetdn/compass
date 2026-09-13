# CP-10: Knowledge gate that keeps derived docs from going stale
Loại: feature-m
Phạm vi: lib/knowledge-scan.mjs, lib/manifest.mjs, commands/knowledge.mjs
Gốc soi: f60ce9b
Soi đến: d98a9d9

## Mục tiêu
Tài liệu lỗi thời tệ hơn không có tài liệu: người đọc tin vào thông tin sai. Thiết kế §8.5 gọi
đây là "chữa bệnh gốc" — `derived/` do máy sinh, `.manifest` ghi hash file nguồn, và gate báo
đỏ khi nguồn đã đổi sau lần sinh cuối.

Xong nghĩa là: `compass knowledge` báo tài liệu còn khớp code không; `--sync` sinh lại;
`done` gọi gate này nên sửa component xong mà không regen thì không đóng được task.

## Ràng buộc
Zero runtime dependency, nên **không có parser AST**. Thiết kế §8.4 nói "đọc AST TypeScript",
nhưng Node không có sẵn parser TS/JSX và thêm một cái là phá ràng buộc gốc — cùng lý do đã bỏ
ESLint ở gate `convention`.

Thay bằng: trích bằng mẫu regex, và **khai rõ độ tin cậy** cho từng mục trích được. Đánh đổi
thật: prop dạng phức tạp sẽ trích thiếu hoặc sai. Tài liệu nói sai mà tự nhận là chắc chắn thì
tệ hơn nói "không chắc" — nên mỗi mục phải mang cờ `confident`.

`.knowledge/derived/` là vùng máy sinh, gitignore. `decided/` là người viết, git-tracked.

Gate pass khi dự án chưa có `.knowledge/` — không phải mọi dự án đều cần.

## Rủi ro hồi quy
`knowledge` vào `IMPLEMENTED_GATES` sẽ chạy trên mọi loại task, kể cả `fix`. Test nào dùng nó
làm ví dụ "gate chưa xây" sẽ đổi kết quả — đã gặp bốn lần, phải rà lại.

Gate đọc `.knowledge/derived/` mà `sourceHash` của CP-7 lại hash cả cây source. Nếu `--sync`
ghi vào thư mục nằm trong phạm vi hash thì mọi gate khác lệch hash ngay sau khi sync — đúng
bẫy đã gặp với `.compass/`.

Quét cả cây source ở repo lớn có thể chậm. Phải đo.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Trích một component có props | Trả tên, path, danh sách prop | P0 |
| H2 | Happy | Đếm số nơi component được dùng | usedIn đúng số file import nó | P0 |
| H3 | Happy | Sinh manifest từ file đã quét | Mỗi file có hash riêng | P0 |
| H4 | Happy | Manifest khớp, không file nào đổi | Gate pass | P0 |
| H5 | Happy | Một file nguồn đã đổi | Gate fail, nêu tên file | P0 |
| H6 | Happy | Chạy --sync | Sinh lại derived, gate pass sau đó | P0 |
| V1 | Validation | Dự án không có .knowledge | Gate pass, báo rõ chưa dùng | P0 |
| V2 | Validation | Manifest hỏng, không parse được | Báo lỗi rõ, coi như cần sync | P0 |
| V3 | Validation | derived/ có nhưng thiếu manifest | Coi như cần sync, không crash | P0 |
| V4 | Validation | Component có prop không trích được | Đánh dấu confident=false, không bịa | P0 |
| E1 | Error | File nguồn bị xóa sau khi sinh | Gate fail, nêu file thiếu | P0 |
| E2 | Error | Không ghi được derived/ | Báo lỗi rõ, exit 2 | P1 |
| E3 | Error | Thư mục source không tồn tại | Không crash, derived rỗng | P1 |
| EC1 | Edge | File thêm mới sau khi sinh | Gate fail, nêu file mới | P0 |
| EC2 | Edge | Sync rồi chạy gate khác ngay | sourceHash không lệch vì sync | P0 |
| EC3 | Edge | Component không ai dùng | usedIn = 0, vẫn liệt kê | P1 |
| EC4 | Edge | File JSX và TSX lẫn lộn | Cả hai đều được quét | P1 |
| S1 | Security | Tên component chứa ký tự lạ | Không chèn được vào JSON output | P0 |
| S2 | Security | derived/ nằm ngoài phạm vi sourceHash | Sync không làm hỏng gate khác | P0 |
| P1 | Performance | Quét cây source của Compass | Xong dưới 5 giây | P1 |
| P2 | Performance | Chạy gate hai lần liên tiếp | Lần hai không sinh lại thừa | P1 |
| S3 | Security | Sửa code rồi done mà chưa sync | done chặn, không đóng với tài liệu lỗi thời | P0 |
| EC5 | Edge | Tên component xuất hiện trong comment | Không tính là dùng | P0 |
| EC6 | Edge | Tên component nằm trong chuỗi | Không tính là dùng | P0 |
| EC7 | Edge | Import đổi tên: { X as Y } | Tính là dùng X | P1 |
| V5 | Validation | Prop TSX có type object đi kèm | Trích đủ prop, không mất cái nào | P0 |
| EC8 | Edge | Import bị comment-out | Không tính là dùng | P0 |
| EC9 | Edge | Chuỗi chứa chữ "import" | Không tính là dùng | P0 |
| EC10 | Edge | File có regex literal chứa dấu nháy | Vẫn đọc được import ở dưới | P0 |
| V6 | Validation | Tham số dạng props: { a: string } | confident=false, không bịa prop từ type | P0 |
| EC11 | Edge | Regex đứng sau từ khóa return | Nhận đúng là regex, không phải phép chia | P0 |
| EC12 | Edge | Giá trị mặc định là chuỗi chứa dấu } | Không cắt sớm, trích đủ prop | P0 |
| EC13 | Edge | Regex sau MỌI từ khóa đứng trước biểu thức | Nhận đúng là regex, rà cả danh sách chứ không từng cái | P0 |
| H7 | Happy | File nguồn bị sửa, ở tầng manifest | Manifest báo file đó theo tên (H5 kiểm cùng ca ở tầng gate) | P1 |
| E4 | Error | File nguồn bị xoá, ở tầng manifest | Báo là mất, không lặng lẽ bỏ qua | P1 |
| EC14 | Edge | File thêm sau lần sinh, ở tầng manifest | Báo là mới thêm | P1 |
| V8 | Validation | Manifest thiếu hẳn map sources | Tính là cũ, không crash | P1 |
| V7 | Validation | Manifest là null | Tính là chưa từng sinh | P1 |
