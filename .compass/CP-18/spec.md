# CP-18: Rename existing tests so old tasks can close
Loại: fix
Phạm vi: test/

## Mục tiêu
CP-15 làm gate `test` phát hiện được khi một ID khớp nhiều test khác nhau. Hệ quả đã lường
trước: 13 task cũ của chính repo này đều đỏ, vì 543 test dùng chung bộ ID `H1`, `V1`, `EC1`.

Đo được: `compass check CP-1` báo `H1` khớp ba test thuộc ba task khác nhau. Không task cũ nào
đóng được, nên Compass chưa từng chạy trọn đường trên chính nó.

Quy mô nhỏ hơn vẻ ngoài: suite có 613 test, nhưng chỉ **222 test mang ID** — đúng bằng tổng số
ca của 13 spec. 321 test còn lại không mang ID nên không gây đụng độ, để nguyên.

Xong nghĩa là: mỗi test mang tiền tố task id của task sở hữu nó, và 13 task cũ qua được gate
`test`.

## Ràng buộc
Chỉ đổi **tên** test, không đổi nội dung. Đổi một dòng assert nào là ra ngoài phạm vi.

Không đoán chủ sở hữu. `Phạm vi` trong spec trỏ tới file nguồn chứ không trỏ tới file test, và
nhiều task chạm chung file — nên phải đối chiếu từng file test với spec, không suy máy móc.

Test nào đã có tiền tố (70 test của CP-15, CP-16, CP-17) thì để nguyên.

## Rủi ro hồi quy
Đổi tên hàng loạt bằng script dễ trúng chuỗi nằm trong assert hoặc comment. Suite phải xanh
đúng 613 test trước và sau, không thừa không thiếu.

Đổi tên xong mà gán sai chủ thì task này xanh, task kia đỏ — phải chạy `check` cho cả 13 task,
không chỉ chạy suite.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Quét cả suite tìm test mang ID trần | Danh sách rỗng | P0 |
| H2 | Happy | Test có tiền tố task id phải kèm một ID | `CP-15-` rồi thôi là tiền tố vô nghĩa | P0 |
| H3 | Happy | Test không mang ID giữ nguyên tên | Vẫn còn hơn 100 test tên thường | P0 |
| V1 | Validation | Cùng task dùng một ID hai lần | Danh sách rỗng — đó vẫn là đụng độ | P0 |
