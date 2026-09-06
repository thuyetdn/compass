# CP-26: writing-vi.md dạy cách tránh sai, không dạy cách nói cho ra người
Loại: fix
Phạm vi: writing-vi.md
Kiểm bằng: mắt

## Mục tiêu

Viết lại `writing-vi.md` để nó dạy được cả **định dạng** và **giọng**, không chỉ dạy tránh lỗi từ ngữ.

Bản hiện tại có 4 nguyên tắc và 12 lỗi. Cả 16 mục đều là "đừng làm thế này": chủ ngữ mơ hồ, Hán-Việt
nặng, bị động kiểu Tây, sáo rỗng, câu dài. Làm theo đủ thì được câu đúng và sạch, nhưng khô. Bốn
nguyên tắc còn đẩy về phía khô hơn — kết luận trước, số thay tính từ, bảng khi nhiều bước — vì đó là
luật của văn báo cáo, không phải văn nói chuyện.

Ba thứ thiếu hẳn: khi nào **đừng** dùng bảng và bullet, độ dài phải theo độ khó câu hỏi, và giọng có
chủ kiến ("tôi nghĩ", "chỗ này tôi đoán", "tôi sai rồi").

Bổ sung từ bộ 30 quy tắc người dùng đưa, gộp phần trùng với 12 lỗi cũ, cộng `Response algorithm` và
`Final quality gate`.

Xong nghĩa là bốn ca dưới đều đạt.

## Ràng buộc

Giữ nguyên các cặp ❌→✅ đang có. Chúng cụ thể và đúng; viết lại chỉ làm mất công không thêm gì.

Phải xử một mâu thuẫn: bản cũ khuyên dùng bảng khi có từ 4 bước, bộ mới khuyên đừng lạm dụng bảng và
bullet. Không được để hai lời khuyên đứng cạnh nhau mà không phân xử — agent sẽ đọc cái nào mạnh hơn,
và cái mạnh hơn thường là cái bảo dùng bảng.

`SKILL.md` trỏ sang file này; đường dẫn và tên mục được trỏ tới không được đổi.

Không có trần dòng cho file này, nhưng đừng dài quá 400 — dài hơn thì agent lướt thay vì đọc.

## Rủi ro hồi quy

File này định hình cách agent nói với người dùng trong mọi phiên. Viết hỏng thì mọi câu trả lời sau
đó hỏng theo, và triệu chứng khó truy về nguyên nhân.

Bỏ mất một cặp ❌→✅ đang dùng tốt là mất một chỗ neo cụ thể. Agent bắt chước ví dụ, không bắt chước
tên luật — mất ví dụ là mất phần dạy được.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-26-H1 | Happy | Đọc phần định dạng | Nói rõ khi nào dùng bảng, khi nào bullet, khi nào chỉ viết văn xuôi | P0 |
| CP-26-H2 | Happy | Đọc phần giọng | Có cặp ❌→✅ cho việc nói chủ kiến và nhận sai | P0 |
| CP-26-EC1 | Edge | Tìm mâu thuẫn bảng/bullet | Chỉ còn một lời khuyên, không phải hai cái chọi nhau | P0 |
| CP-26-EC2 | Edge | Đối chiếu cặp ❌→✅ bản cũ với bản mới | Không cặp nào biến mất | P1 |
