# CP-15: Stop one task's tests from satisfying another task's gate
Loại: bug
Phạm vi: lib/test-parser.mjs, commands/test.mjs

## Mục tiêu
INV-2 kết luận: gate `test` đối chiếu ID mà không biết task nào. Spec dùng ID `H1`, `V1`,
`EC1` — 14 task trong repo này cùng dùng bộ đó, và suite có 10–13 test trùng tên mỗi ID.

Hệ quả đo được: task chưa viết dòng test nào vẫn qua gate, miễn có task khác đã viết test tên
`H1`. Đó đúng là "báo xong khi chưa xong", thứ gate này sinh ra để chặn.

Xong nghĩa là: gate phát hiện được khi một ID khớp nhiều test khác nhau, và nói thẳng thay vì
tính là đã chạy.

## Ràng buộc
**Không đổi 221 test đang có, không đổi 14 spec.** Buộc ID mang tiền tố task là cách sửa
hiển nhiên nhưng giá quá đắt, và nó phá mọi dự án đang dùng Compass.

Tín hiệu dùng để phát hiện: **một task chỉ nên có đúng một test cho mỗi ID**. ID khớp từ hai
dòng pass trở lên là đụng độ — hoặc task khác, hoặc chính task này đặt trùng tên.

Không được biến ca hợp lệ thành đỏ **khi phân biệt được**. Có một ca không phân biệt nổi:
hai dòng pass chỉ khác nhau ở một con số. Đó có thể là retry in kèm thời gian chạy, cũng có
thể là hai test tên `after 5ms` và `after 30ms` — từ dòng text không có cách nào biết.

Chọn báo đụng độ. Gộp nhầm thì gate xanh cho task chưa viết test, im lặng, đúng lỗ INV-2.
Tách nhầm thì gate đỏ kèm tên cả hai dòng, và có đường thoát ngay. Sai mà kêu lên thì hơn
sai mà im.

Phải có **đường thoát**: task đặt tên test kèm task id (`CP-15-H1 …`) thì gate nhận ra đó là
test của nó, kể cả khi task khác cũng có `H1`. Đây là cách một dự án đang chạy chuyển dần sang
tên rõ ràng mà không phải đổi hết trong một lần.

## Rủi ro hồi quy
`extractRanIds` đang được dùng bởi `test.mjs` và 20+ test. Đổi giá trị trả về mà sai thì đỏ
hàng loạt — dấu hiệu tốt, nhưng phải rà.

Suite của chính Compass có nhiều test trùng ID giữa các file. Sau khi sửa, gate `test` của
mọi task Compass sẽ đỏ — **đó là kết quả đúng**, không phải hồi quy. Phải quyết cách xử lý:
đây là lỗi thật của repo này chứ không phải của công cụ.

## Giới hạn đã biết
Ban đầu tín hiệu chỉ là "một ID khớp từ hai dòng pass trở lên", nên **đúng một** task khác có
test tên `H1` là đủ để task này xanh mà chưa viết gì. Vòng soi cuối bịt nốt: một dòng khai chủ
task khác cũng không tính là đã chạy, dù chỉ có đúng một dòng khớp.

Còn lại một ca thật sự không phân biệt được: mọi test đều **không** khai chủ. Với dự án đã đổi
tên hết theo chuẩn thì ca đó không xảy ra; với dự án chưa đổi thì đường thoát là chuyển dần.

Lỗ thứ hai: Jest `--verbose` in tên `describe` thành một dòng chữ trần, không dấu hiệu nào.
Hai test cùng tên ở hai `describe` trong **cùng một file** vì thế vẫn gộp làm một. Không vá,
vì bắt dòng chữ trần là đoán — đúng cái bẫy đã ghi trong pitfalls. Ca này hiếm hơn ca hai file
(đã bắt được qua dòng `PASS <file>`), và đường thoát task id vẫn dùng được.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Mỗi ID khớp đúng một dòng pass | Gate pass như cũ | P0 |
| H2 | Happy | Một ID khớp hai dòng pass | Gate fail, nêu ID và số dòng | P0 |
| H3 | Happy | Thông báo nêu được vài dòng khớp | Người đọc thấy ngay test nào đụng | P0 |
| H4 | Happy | Nhiều ID cùng đụng | Nêu tất cả, không dừng ở cái đầu | P0 |
| H5 | Happy | Không ID nào đụng | Không có cảnh báo thừa | P0 |
| H6 | Happy | Bản ghi gate lưu số ID bị đụng | `done` đọc lại được | P0 |
| V1 | Validation | ID khớp một dòng pass và một dòng fail | Không tính là đụng — đó là retry | P0 |
| V2 | Validation | ID chỉ khớp dòng không nhận diện được | Giữ nguyên hành vi cũ | P0 |
| V3 | Validation | Spec không có test case nào | Giữ nguyên hành vi cũ | P1 |
| E1 | Error | Output rỗng | Không crash, báo thiếu như cũ | P0 |
| E2 | Error | Suite đỏ và có ID đụng | Báo cả hai, không che lẫn nhau | P1 |
| EC1 | Edge | ID đụng nhưng suite vẫn xanh | Gate fail — đây chính là ca CP-14 | P0 |
| EC2 | Edge | Cùng một dòng lặp lại y hệt | Tính là một, không phải đụng | P0 |
| EC3 | Edge | ID ngắn khớp trong ID dài hơn | H1 không khớp H10 | P0 |
| H7 | Happy | Tên test mang task id | Nhận là test của task này, dù có đụng độ | P0 |
| EC4 | Edge | Hai test cùng mang task id và cùng ID | Vẫn là đụng độ — task tự đặt trùng | P0 |
| EC5 | Edge | Task id xuất hiện ở dòng khác không liên quan | Không nhận nhầm | P1 |
| H8 | Happy | ID bị đụng không bị báo thêm là không tìm thấy dấu vết | Một lỗi báo một lần | P1 |
| H9 | Happy | Đường thoát chạy được qua lệnh `compass test` | Gate pass khi tên test mang task id | P0 |
| EC6 | Edge | Task id là tiền tố của task id khác (`CP-1` với `CP-15`) | Không nhận vơ test của nhau | P0 |
| EC7 | Edge | Hai dòng chỉ khác nhau ở con số | Báo đụng độ — không phân biệt nổi retry với hai test | P0 |
| EC8 | Edge | Tên test có sẵn số đo (`rejects 5ms delay`) | Không cắt mất phần tên thật | P0 |
| EC9 | Edge | Output dùng CRLF | Kết quả y hệt khi dùng LF | P0 |
| EC13 | Edge | Dòng y hệt nhau lặp lại khi có khai task id | Vẫn tính là một | P1 |
| EC10 | Edge | Task id nằm chỗ khác trên dòng (`wrote CP-15.log`) | Không tính là lời khai sở hữu | P0 |
| EC11 | Edge | Số đo kết thúc tên test (`after 5ms` với `after 30ms`) | Vẫn là hai test, vẫn đụng độ | P0 |
| EC12 | Edge | Đường thoát viết theo nhiều kiểu (`CP-15: H1`, `[CP-15] H1`) | Nhận hết, không ép một định dạng | P1 |
| EC14 | Edge | Tên suite cha có chứa ID (`H1 handling > CP-15-H1 …`) | Đường thoát vẫn nhận ra | P0 |
| EC15 | Edge | Đường dẫn mang task id đứng đầu dòng (`.compass/CP-15/H1`) | Không tính là lời khai sở hữu | P0 |
| EC16 | Edge | Dự án đặt ID ở cuối tên (`parses a config H1`) | Vẫn phát hiện được đụng độ | P0 |
| EC17 | Edge | ID vừa đụng độ vừa xuất hiện trên dòng lạ | Chỉ báo một lỗi, không báo hai | P1 |
| EC18 | Edge | ID dài mang tiền tố task id (`CP-15-H10`) | Không trả lời thay cho ID ngắn | P1 |
| EC19 | Edge | Task id cách ID cả một quãng dấu | Không tính là lời khai sở hữu | P0 |
| EC20 | Edge | Số thứ tự reporter khác nhau, tên y hệt | Một test chạy hai lần, không đụng | P0 |
| EC21 | Edge | Task id nhắc giữa câu (`warns: CP-15-H1 renamed`) | Là lời nhắc, không phải lời khai | P0 |
| EC22 | Edge | Hai suite TAP khác nhau, test cùng tên | Vẫn phát hiện đụng độ | P0 |
| EC23 | Edge | Một suite TAP, một test | Không biến thành hai | P0 |
| EC24 | Edge | Hai test top-level cùng tên ở hai file | Vẫn phát hiện đụng độ | P0 |
| EC25 | Edge | `describe` lồng nhau, test trùng tên ở hai nhánh | Phân biệt bằng đường dẫn đầy đủ | P0 |
| EC26 | Edge | Reporter in `PASSED` / `FAILED` | Bóc trọn tiền tố, đường thoát vẫn sống | P0 |
| EC27 | Edge | Jest `--verbose`, hai file cùng tên test | Phân biệt bằng dòng `PASS <file>` | P0 |
| EC28 | Edge | Vitest tap, dòng mở khối `{` | Là suite chứa, không tính thành test | P0 |
| EC29 | Edge | Chú thích TAP cuối dòng (`# time=…`) | Không phải tên test | P0 |
| EC30 | Edge | Tên test kết thúc bằng `{` | Vẫn là test, không phải khối chứa | P0 |
| EC31 | Edge | Tên test chứa dấu `#` | Phần sau dấu vẫn thuộc về tên | P0 |
| EC32 | Edge | Dòng `PASS <chữ>` không giống đường dẫn | Là test, không phải tiêu đề file | P0 |
| EC33 | Edge | Container Vitest in `not ok` (suite có test đỏ) | Vẫn là container, cơ chế không tắt | P0 |
| EC34 | Edge | Directive TAP viết thường (`# skip`) | Nhận ra là skip — TAP không phân biệt hoa thường | P0 |
| EC35 | Edge | Biên số ký tự nối của đường thoát | Bốn thì nhận, năm thì không | P1 |
| EC36 | Edge | Jest in `FAIL <file>` khi suite đỏ | Vẫn là tiêu đề file, không phải test | P0 |
| EC37 | Edge | Hai repo, test trùng tên | Vẫn là hai test — dòng `# repo` mở khối mới | P0 |
| EC38 | Edge | Cùng một ca có test ở mỗi repo | Không phải đụng độ — đó là ca CP-13 phục vụ | P0 |
| EC39 | Edge | Hai test cùng ID trong **cùng** repo | Vẫn là đụng độ, nới cho đa repo không nới cho một repo | P0 |
| EC40 | Edge | Mọi test mang ID đều khai chủ khác | Báo thiếu test, không báo đụng độ | P0 |
| EC41 | Edge | Tên repo có khoảng trắng (`my app`) | Vẫn tách được khối, cơ chế không tắt | P0 |
| EC42 | Edge | ID chỉ có ở task khác | Nêu vào nhóm riêng, không xoá khỏi mọi nhóm | P0 |
| EC43 | Edge | Ca EC42 ở tầng lệnh | Không khuyên sửa reporter đang chạy đúng | P0 |
