# CP-1: Dọn thư mục tạm sau test tích hợp
Loại: fix
Phạm vi: test/integration.test.mjs

## Mục tiêu
Test tích hợp tạo thư mục tạm bằng `mkdtempSync` nhưng không bao giờ xóa. Mỗi lần chạy suite để lại 5 thư mục rác trong `os.tmpdir()`. Xong nghĩa là: sau khi suite chạy, không còn thư mục nào do test này tạo ra.

## Ràng buộc
Không đổi hành vi của bất kỳ assertion nào — chỉ thêm bước dọn. Không dùng thư viện ngoài.

## Rủi ro hồi quy
Dọn quá sớm sẽ xóa thư mục khi test còn đang đọc file trong đó, làm test đỏ ngẫu nhiên. Đây là rủi ro chính. Ngoài ra, `rmSync` với đường dẫn sai có thể xóa nhầm — phải chỉ xóa đúng thư mục do chính test tạo.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Chạy trọn vòng init→check→done rồi dọn | Thư mục tạm không còn tồn tại sau test | P0 |
| H2 | Happy | Năm test tích hợp cùng chạy | Không test nào để lại thư mục | P0 |
