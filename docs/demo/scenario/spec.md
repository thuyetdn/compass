# TD-002: Clear completed todos
Loại: feature-s
Phạm vi: src/App.jsx, src/App.css, test/ClearDone.test.jsx, test/ClearDone.edge.test.jsx

## Mục tiêu
Dưới danh sách có nút "Xóa việc đã xong". Bấm vào thì mọi việc đã đánh dấu xong biến mất, việc
chưa xong giữ nguyên thứ tự, và số "Còn lại" không đổi.

## Ràng buộc
Không thêm state library. Query bằng role/text người dùng thấy, không dùng test-id. Màu đi qua
CSS variable như phần còn lại của app.

## Rủi ro hồi quy
Thêm việc và đánh dấu xong (TD-001) dùng chung danh sách. Xóa theo tiêu đề thay vì theo id sẽ xóa
nhầm khi hai việc trùng tiêu đề. Nút nằm trong form thì bấm xóa sẽ gửi luôn chữ đang gõ dở. Nút đặt
trong từng dòng sẽ đổi textContent của dòng và làm vỡ test H2 của TD-001.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Hai việc, đánh dấu xong một, bấm nút | Chỉ còn việc chưa xong | P0 |
| H2 | Happy | Năm việc, việc 2 và 4 đã xong, bấm nút | Còn việc 1, 3, 5 đúng thứ tự | P0 |
| H3 | Happy | Số còn lại sau khi xóa | "Còn lại" giữ nguyên như trước khi bấm | P0 |
| H4 | Happy | Đánh dấu việc còn lại sau khi xóa | Checkbox thành checked, "Còn lại" giảm 1 | P1 |
| H5 | Happy | Thêm việc mới sau khi xóa | Việc mới hiện ở cuối danh sách | P1 |
| H6 | Happy | Xóa hai lượt liên tiếp | Lượt hai xóa đúng việc vừa đánh dấu | P1 |
| V1 | Validation | Có việc nhưng chưa việc nào xong | Nút bị disabled | P0 |
| V2 | Validation | Danh sách rỗng | Nút bị disabled | P1 |
| E1 | Error | Bấm nút khi ô nhập đang có chữ gõ dở | Không thêm việc mới, chữ trong ô nhập giữ nguyên | P0 |
| EC1 | Edge | Mọi việc đều đã xong | Danh sách rỗng, hiện "Còn lại: 0" | P0 |
| EC2 | Edge | Hai việc trùng tiêu đề, chỉ một việc xong | Chỉ việc đã xong bị xóa, việc kia còn | P0 |
| EC3 | Edge | Đánh dấu rồi bỏ đánh dấu, bấm nút | Việc đó vẫn còn | P1 |
| S1 | Security | Tiêu đề chứa thẻ script, đánh dấu xong rồi xóa | Hiện dạng chữ trước khi xóa, biến mất sau khi xóa, không có thẻ script trong trang | P0 |
