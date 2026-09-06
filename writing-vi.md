# Viết tiếng Việt tự nhiên

Bộ này dành cho agent viết tiếng Việt cho người đọc: giải thích, báo cáo, ghi chú, thông báo lỗi.
Spec, tên test, commit message, comment trong code vẫn viết tiếng Anh.

**Đọc cặp câu, đừng học tên luật.** Bắt chước ví dụ hiệu quả hơn nhớ quy tắc.

---

## Phần 1 — Bốn nguyên tắc

Đúng với mọi ngôn ngữ, không riêng tiếng Việt.

### 1. Kết luận trước

Người đọc quyết định đọc tiếp hay không sau câu đầu.

> ❌ Tôi đã tiến hành phân tích và nhận thấy rằng có một vấn đề khá nghiêm trọng liên quan đến parser.
>
> ✅ Parser xếp sai một test đã pass.

> ❌ Sau khi xem xét kỹ lưỡng các phương án, tôi cho rằng phương án B có nhiều ưu điểm hơn.
>
> ✅ Chọn B. Nó chạy 3 lần nhanh hơn và không cần thêm thư viện.

### 2. Nói hậu quả, đừng tả cơ chế

Người đọc mở được file. Cái họ không tự thấy là **chuyện gì sẽ xảy ra với họ**.

> ❌ Compass tìm test bằng cách đọc chuỗi trong output của reporter.
>
> ✅ Reporter không in tên test thì Compass báo thiếu, dù bạn đã viết đủ.

> ❌ Hàm này dùng debounce 300ms trên sự kiện input.
>
> ✅ Gõ xong 300ms mới gọi API, nên gõ nhanh không bắn 10 request.

### 3. Số thay cho tính từ

"Nhanh hơn nhiều" không kiểm chứng được.

> ❌ Gate này chạy khá nhanh và khá đáng tin.
>
> ✅ 26ms trên 85 file. Chưa bắt được hồi quy CP-8 — đã thử bốn vòng.

> ❌ Đã cải thiện hiệu năng đáng kể.
>
> ✅ 2.4s xuống 0.8s trên 10k dòng.

### 4. Nói chỗ đáng ngờ trước khi bị hỏi

Giả định ngầm, nhánh chưa xử lý, chỗ mình lười kiểm.

> ✅ Ngưỡng 20% là phỏng đoán, không phải số đo. Chọn vì Vitest khớp 1/13.
>
> ✅ Chỗ này tôi chưa thử với file lớn hơn 50MB. Nếu chậm thì đây là nơi cần xem.

**Khó nhất là nguyên tắc 4.** Nói ra thì mất mặt một chút, giấu đi thì người khác sập bẫy.

---

## Phần 2 — Mười hai lỗi hay gặp khi viết tiếng Việt

### 1. Chủ ngữ mơ hồ

> ❌ Ai đó quên chép `ui` và `visual` vào bảng gate.
>
> ✅ Bảng gate thiếu `ui` và `visual`.

> ❌ Hệ thống ghi nhận có sự cố xảy ra.
>
> ✅ Gate `test` đỏ ở dòng 42.

"Ai đó", "hệ thống", "người ta", "có sự" — bỏ hết. Nói thẳng cái gì thiếu, cái gì sai.

### 2. Dịch code thành lời

> ❌ Hàm `syncEvents` gọi Graph API lấy danh sách rồi lưu vào database qua repository.
>
> ✅ Lịch kéo về mỗi 15 phút, hỏi Graph "có gì đổi không" bằng deltaToken lưu trong DB.

Kể theo **dòng chảy dữ liệu**, không theo thứ tự file.

### 3. Hán-Việt nặng khi có từ thuần Việt

> ❌ Thực hiện việc kiểm tra tính hợp lệ của dữ liệu đầu vào.
>
> ✅ Kiểm dữ liệu vào có hợp lệ không.

> ❌ Tiến hành khởi tạo kết nối tới cơ sở dữ liệu.
>
> ✅ Mở kết nối DB.

Thấy "thực hiện việc", "tiến hành", "tính … của", "một cách", "mang tính", "sự", "việc" — cắt thử,
gần như luôn cắt được.

### 4. Bị động kiểu Tây

> ❌ Dữ liệu được xử lý bởi service rồi được lưu bởi repository.
>
> ✅ Service xử lý dữ liệu, repository lưu lại.

> ❌ Lỗi này đã được phát hiện bởi vòng review thứ ba.
>
> ✅ Vòng review thứ ba tìm ra lỗi này.

"Bởi" gần như luôn là dấu hiệu câu dịch. Tiếng Việt có chủ ngữ thì dùng chủ ngữ.

### 5. Đệm chữ cho câu dài ra

> ❌ Về cơ bản thì có thể nói rằng gate này về mặt nào đó đã hoạt động tương đối ổn định.
>
> ✅ Gate chạy đúng, 576 test xanh.

"Về cơ bản", "có thể nói rằng", "về mặt nào đó", "tương đối", "khá là", "nhìn chung", "nói chung" —
bỏ hết.

### 6. Dịch thuật ngữ đã quen

> ❌ Điều kiện tranh chấp khiến tiến trình con bị treo ở cổng.
>
> ✅ Race condition làm tiến trình con giữ cổng.

Giữ nguyên: token · cache · race condition · deadlock · commit · merge · gate · reporter · regex ·
parser · deploy · build · rollback · timeout · retry. Dịch chúng làm người đọc phải dịch ngược
trong đầu.

### 7. Sáo rỗng

> ❌ Việc này đóng vai trò quan trọng trong việc đảm bảo chất lượng.
>
> ✅ Không có bước này thì bug lọt xuống production.

> ❌ Giải pháp mang lại nhiều lợi ích thiết thực.
>
> ✅ Bớt được hai bước tay và một lần đợi CI.

"Đóng vai trò quan trọng", "mang lại nhiều lợi ích", "trong bối cảnh hiện nay", "góp phần nâng cao",
"một cách hiệu quả" — nếu bỏ đi mà câu không mất nghĩa thì bỏ.

### 8. Một câu nhồi nhiều ý

> ❌ Sau khi sửa parser thì gate chạy đúng nhưng vẫn còn vấn đề với reporter của Jest do nó
> không in dòng Subtest nên phải đọc dòng PASS thay thế.
>
> ✅ Sửa parser xong, gate chạy đúng. Riêng Jest vẫn hỏng: nó không in `# Subtest:`. Phải đọc dòng
> `PASS <file>` thay thế.

Một câu một ý. Câu dài quá 25 chữ thì tìm chỗ chấm.

### 9. Nói vòng thay vì nói thẳng cái sai

> ❌ Có vẻ như kết quả trả về chưa hoàn toàn như mong đợi trong một số trường hợp nhất định.
>
> ✅ Hàm trả về `null` khi mảng rỗng. Nơi gọi không kiểm, nên crash.

Ngại làm người khác buồn mà nói vòng thì họ không sửa được.

### 10. Trang trọng không cần thiết

> ❌ Kính mong quý vị lưu ý rằng thao tác này không thể hoàn tác.
>
> ✅ Xoá rồi không lấy lại được.

Viết cho đồng nghiệp, không phải cho công văn.

### 11. Lặp từ do dịch máy

> ❌ Cấu hình cấu hình mặc định của hệ thống cấu hình.
>
> ✅ Cấu hình mặc định.

> ❌ Thực hiện chạy lệnh test để test lại.
>
> ✅ Chạy lại test.

### 12. Đại từ sai vai

> ❌ Người dùng có thể gặp phải tình huống mà trong đó dữ liệu bị mất.
>
> ✅ Bạn có thể mất dữ liệu.

Nói với người đang đọc. "Bạn" gần hơn "người dùng" khi chính họ là người dùng.

---

## Phần 3 — Tự kiểm trước khi gửi

Đọc lại đoạn vừa viết, hỏi sáu câu:

| Hỏi | Nếu "không" thì |
|---|---|
| Ba câu đầu đã nói hết ý chính chưa? | Chuyển kết luận lên đầu |
| Mỗi khẳng định có số hoặc ví dụ chưa? | Thay tính từ bằng số đo |
| Có chỗ nào đáng ngờ mà tôi im lặng không? | Nói ra trước khi bị hỏi |
| Đoạn từ 4 bước trở lên đã có bảng hoặc sơ đồ chưa? | Vẽ ra |
| Câu nào dài quá 25 chữ không? | Tìm chỗ chấm |
| Đọc thành tiếng có chỗ nào vấp không? | Viết lại chỗ đó |

**Phép thử cuối cùng: đọc thành tiếng.** Câu đúng ngữ pháp mà đọc xong phải đọc lại là câu hỏng.
Chỗ nào lưỡi vấp, chỗ đó cần sửa.

---

## Phần 4 — Ba thói quen làm câu dễ đọc

Bốn nguyên tắc ở Phần 1 chống viết dở. Ba thói quen này làm câu trôi.

- **Câu ngắn xen câu dài.** Toàn câu dài thì nghẹt, toàn câu ngắn thì cộc.
- **Từ đời thường khi có.** "Chỗ này hỏng" đọc nhanh hơn "khu vực này tồn tại lỗi".
- **Giải thích bằng lời thường trước, thuật ngữ sau.** "Hai tiến trình cùng giành một cổng — cái
  này gọi là race condition" dễ vào hơn là ném thuật ngữ ra trước.
