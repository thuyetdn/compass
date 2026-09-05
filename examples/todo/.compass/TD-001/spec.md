# TD-001: Todo list with add, toggle and remaining count
Loại: feature-s
Phạm vi: src/App.jsx

## Mục tiêu
Người dùng thêm được việc, đánh dấu xong, và thấy số việc còn lại cập nhật đúng.

## Ràng buộc
Không thêm state library. Query bằng role/text người dùng thấy, không dùng test-id.

## Rủi ro hồi quy
Không có tính năng cũ — đây là màn hình đầu tiên. Nhưng crypto.randomUUID không có ở
mọi môi trường test; nếu thiếu thì mọi test render sẽ vỡ cùng lúc.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Thêm một việc | Việc hiện trong danh sách | P0 |
| H2 | Happy | Thêm hai việc | Cả hai cùng hiện, đúng thứ tự nhập | P0 |
| H3 | Happy | Đánh dấu xong một việc | Checkbox của việc đó thành checked | P0 |
| H4 | Happy | Bỏ đánh dấu xong | Checkbox trở lại unchecked | P1 |
| H5 | Happy | Số còn lại sau khi thêm | Hiện "Còn lại: 2" khi có 2 việc chưa xong | P0 |
| H6 | Happy | Số còn lại sau khi đánh dấu | Giảm còn 1 khi đánh dấu xong 1 trong 2 | P0 |
| V1 | Validation | Gửi form khi ô nhập rỗng | Không thêm việc nào vào danh sách | P0 |
| V2 | Validation | Gửi form khi chỉ có khoảng trắng | Không thêm việc nào vào danh sách | P0 |
| V3 | Validation | Ô nhập được xóa sau khi thêm | Giá trị ô nhập trở về rỗng | P1 |
| E1 | Error | Đánh dấu việc bằng id không tồn tại | Danh sách giữ nguyên, không throw | P1 |
| EC1 | Edge | Danh sách rỗng lúc đầu | Hiện "Còn lại: 0", không có item nào | P0 |
| EC2 | Edge | Tiêu đề rất dài 500 ký tự | Vẫn hiện đầy đủ, không cắt bớt | P2 |
| S1 | Security | Tiêu đề chứa thẻ script | Hiện dưới dạng chữ, không chạy như HTML | P0 |
