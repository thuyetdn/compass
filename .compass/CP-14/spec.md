# CP-14: Language rules that hold in any language, not just Vietnamese
Loại: bug
Phạm vi: SKILL.md
Kiểm bằng: mắt

## Mục tiêu
Rule hiện tại có hai lỗ.

**Một: nó chỉ nói tiếng Việt.** Compass tự nhận là portable, mang sang dự án nào cũng chạy —
nhưng phần diễn đạt gắn cứng vào một ngôn ngữ. Đội nói tiếng Anh dùng Compass thì mục đó vô
dụng, mà nó lại là mục dài thứ hai trong SKILL.md.

**Hai: nó chỉ dạy đừng làm gì.** Sáu lỗi, sáu điều cấm. Không có chỗ nào nói *nên* viết thế
nào. Người đọc tránh được sáu lỗi vẫn có thể viết ra thứ khô khốc, đúng ngữ pháp mà không ai
muốn đọc.

Xong nghĩa là: phần Ngôn ngữ tách hai tầng — nguyên tắc đúng cho mọi ngôn ngữ, và bảng lỗi
riêng cho tiếng Việt; cộng thêm phần nói cách viết cho tự nhiên, không chỉ cách tránh sai.

## Ràng buộc
Mọi ví dụ phải là **câu thật đã viết trong dự án này**, không bịa. Rule về cách nói mà bản
thân nó bịa ví dụ thì tự phá chính nó.

Không khẳng định về văn phong của một dân tộc. Tôi không có nguồn khảo sát để nói "người Nhật
thường nói thế này" — đó đúng là loại bịa mà Compass sinh ra để chặn. Nguyên tắc phải rút ra
từ cái đo được: câu nào người đọc hiểu nhanh hơn, câu nào làm họ đọc lại.

SKILL.md không được phình. Nó đang 400 dòng; thêm nội dung thì phải cắt chỗ khác.

## Rủi ro hồi quy
Rule dài ra thì AI đọc lướt, và mục này chính là mục dễ bị lướt nhất — nó không có gate nào
kiểm. Dài thêm mà không rõ hơn là làm hỏng.

Đổi cấu trúc phần Ngôn ngữ có thể làm mất mấy cặp ❌/✅ đang hiệu quả. Phải giữ nguyên chúng.

## Test cases

Mục này không có gate máy — không có gì để chạy. Test case ở đây là **câu hỏi kiểm bằng mắt**,
đọc SKILL.md sau khi sửa rồi trả lời:

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Nguyên tắc chung có áp dụng được cho tiếng Anh không | Đọc phần đó, thay ví dụ tiếng Anh vào, vẫn đúng | P0 |
| H2 | Happy | Có phần dạy viết tự nhiên, không chỉ cấm | Tìm thấy mục nói nên viết thế nào | P0 |
| H3 | Happy | Sáu cặp ❌/✅ tiếng Việt còn nguyên | Đếm đủ sáu | P0 |
| V1 | Validation | Mọi ví dụ đều là câu thật trong dự án | Truy được về file hoặc hội thoại nào | P0 |
| V2 | Validation | Không có khẳng định về văn phong dân tộc | Đọc hết, không thấy câu nào kiểu "người X hay nói" | P0 |
| E1 | Error | SKILL.md không phình quá | Dưới 480 dòng | P1 |
| EC1 | Edge | Rule có tự tuân thủ chính nó không | Đọc chính mục đó bằng bảng tự kiểm, không vi phạm | P0 |
