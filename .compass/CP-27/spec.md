# CP-27: Không có luật viết cho investigation, nên nó ra văn kể chuyện
Loại: fix
Phạm vi: writing-vi.md
Kiểm bằng: mắt

## Mục tiêu

Thêm một phần vào `writing-vi.md` cho văn báo cáo kỹ thuật — investigation, finding, báo lỗi. Ba điều:

1. **Thứ tự mỗi finding: kết luận → bằng chứng → ảnh hưởng.** Không kể lại hành trình điều tra.
2. **Nói rõ mức chắc chắn**: đã xác nhận / suy ra / chưa biết. Ba mức, gọi tên thẳng.
3. **Không ẩn dụ, không từ kịch tính.** "Outlook event vẫn giữ email cũ", không phải "email bị đóng
   băng ở nơi ngoài tầm với".

Hiện `writing-vi.md` không có mục nào về việc này. Nó nhắc mức chắc chắn đúng một lần ở Phần 3, và
không cấm ẩn dụ chỗ nào. Phần 3 lại dạy giọng nói chuyện — hợp cho đối thoại, sai cho báo cáo. Người
đọc investigation cần quét nhanh tìm kết luận, không cần giọng thân mật.

`SKILL.md` mục "Điều tra" có luật "kết luận phải dẫn về bằng chứng" nhưng không nói viết ra sao.

Xong nghĩa là bốn ca dưới đều đạt.

## Ràng buộc

Không sửa Phần 3 (giọng). Hai loại văn cùng tồn tại: đối thoại thì thân mật, báo cáo thì khô. Phải
nói rõ phần mới áp cho loại nào, nếu không agent sẽ đọc cái nào mạnh hơn.

Giữ nguyên 34 cặp ❌→✅ đang có.

Dưới 420 dòng. Hiện 367.

## Rủi ro hồi quy

Thêm luật "đừng ẩn dụ" mà không giới hạn phạm vi thì nó tràn sang cả văn đối thoại, và câu trả lời
thường ngày mất hết ví dụ so sánh — mà Phần 5 lại đang dạy dùng so sánh khi giải thích khái niệm khó
("cache giống như để đồ trên bàn"). Hai chỗ này sẽ chọi nhau.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-27-H1 | Happy | Đọc phần mới | Có đủ ba điều: thứ tự finding, ba mức chắc chắn, cấm ẩn dụ | P0 |
| CP-27-H2 | Happy | Cặp ❌→✅ cho ẩn dụ | Dùng đúng ví dụ Outlook email, không bịa ví dụ khác | P0 |
| CP-27-EC1 | Edge | Đối chiếu với Phần 3 và Phần 5 | Nói rõ phần nào áp cho báo cáo, phần nào cho đối thoại; không chọi nhau | P0 |
| CP-27-EC2 | Edge | Đếm cặp ❌→✅ và số dòng | Không mất cặp nào, dưới 420 dòng | P1 |
