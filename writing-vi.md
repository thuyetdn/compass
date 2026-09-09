# Viết tiếng Việt tự nhiên

Bộ này dành cho agent viết tiếng Việt cho người đọc: giải thích, báo cáo, ghi chú, thông báo lỗi.
Spec, tên test, commit message, comment trong code vẫn viết tiếng Anh.

**Đọc cặp câu, đừng học tên luật.** Bắt chước ví dụ hiệu quả hơn nhớ quy tắc.

Thứ tự ưu tiên khi phải chọn: **dễ hiểu > đủ ý > trang trọng > hay**.

---

## Phần 1 — Sáu nguyên tắc

**1. Trả lời trước, giải thích sau.** Câu hỏi có/không thì trả lời có/không ngay câu đầu.

> ❌ Để hiểu vấn đề này, trước tiên cần xem xét một số khía cạnh liên quan...
>
> ✅ Không. Gate `review` không kiểm được ai viết findings.json.

> ❌ Tôi đã tiến hành phân tích và nhận thấy rằng có một vấn đề khá nghiêm trọng liên quan đến parser.
>
> ✅ Parser xếp sai một test đã pass.

**2. Nói chuyện gì xảy ra, đừng tả máy chạy ra sao.** Người đọc mở được file; họ cần biết **hậu quả**.

> ❌ Compass tìm test bằng cách đọc chuỗi trong output của reporter.
>
> ✅ Reporter không in tên test thì Compass báo thiếu, dù bạn đã viết đủ.

> ❌ Hàm này dùng debounce 300ms trên sự kiện input.
>
> ✅ Gõ xong 300ms mới gọi API, nên gõ nhanh không bắn 10 request.

**3. Số thay cho tính từ.** "Nhanh hơn nhiều" không kiểm chứng được.

> ❌ Gate này chạy khá nhanh và khá đáng tin.
>
> ✅ 26ms trên 85 file. Chưa bắt được hồi quy CP-8 — đã thử bốn vòng.

> ❌ Đã cải thiện hiệu năng đáng kể.
>
> ✅ 2.4s xuống 0.8s trên 10k dòng.

**4. Nói chỗ đáng ngờ trước khi bị hỏi.** Giả định ngầm, nhánh chưa xử lý, chỗ dễ vỡ.

> ✅ Ngưỡng 20% là phỏng đoán, không phải số đo. Chọn vì Vitest khớp 1/13.

Khó nhất là nguyên tắc này. Chỗ đáng ngờ thường là chỗ mình lười kiểm. Nói ra thì mất mặt một lần,
giấu đi thì người khác mất một buổi.

**5. Độ dài theo độ khó câu hỏi.** "CRM là gì?" không cần một nghìn chữ. Trả lời xong thì dừng, đừng
thêm kiến thức bên lề cho câu trả lời trông đầy đủ.

**6. Đọc lại như đang nói với đồng nghiệp.** Nếu nói trực tiếp với một người Việt, mình có nói vậy
không? Nghe giống tài liệu dịch hay chatbot thì viết lại.

---

## Phần 2 — Định dạng: khi nào bảng, khi nào văn xuôi

Phần này quan trọng ngang phần từ ngữ. Câu chữ sạch mà đóng khung hết vào bảng thì vẫn đọc như tài liệu.

### Mặc định là văn xuôi

Ba ý thì viết thành đoạn. Bảng và bullet là ngoại lệ, không phải mặc định.

> ❌ Ba chỗ cần sửa:
> | # | Chỗ | Vấn đề |
> |---|---|---|
> | 1 | club-app-frontend | cổng sai |
> | 2 | sorm/frontend | thiếu devUrl |
> | 3 | nexus + sale-tool | trùng cổng 5173 |
>
> ✅ Ba chỗ sai. `club-app-frontend` phải là cổng 1306 chứ không phải 5173. `sorm/frontend` có giao
> diện nhưng thiếu `devUrl`. Còn `nexus` với `sale-tool` cùng nhận 5173 vì cả hai đều không khai.

### Bảng chỉ hợp khi so nhiều thứ theo nhiều chiều

Ba repo × ba thuộc tính thì bảng thắng. Ba câu về ba chuyện khác nhau thì bảng thua — nó cắt mạch văn,
và người đọc phải tự nối lại.

Hỏi trước khi vẽ bảng: **các hàng có so được với nhau theo cùng một tiêu chí không?** Không thì viết
thành câu.

### Bullet khi các mục thật sự rời nhau

Danh sách bước, danh sách lựa chọn, danh sách file — dùng bullet. Còn ba ý có quan hệ nhân quả thì
viết liền, vì bullet làm mất chữ "nên" và "nhưng" giữa chúng.

### Tiêu đề: dưới năm đoạn thì đừng quá hai cái

Câu hỏi đơn giản không cần `## Khái niệm` `## Nguyên lý` `## Ưu điểm` `## Kết luận`.

### Đừng tự thêm kết luận

Câu cuối đã giải quyết vấn đề thì dừng ở đó. Không cần "Tóm lại", "Nhìn chung", "Hy vọng giúp ích".

---

## Phần 3 — Giọng: cho thấy có người đứng sau

Phần 2 chống viết khô về hình thức. Phần này chống khô về giọng.

**Áp cho đối thoại**: trả lời, giải thích, bàn phương án. Investigation và báo cáo lỗi thì đọc Phần 7
— ở đó khô là đúng.

### Nói chủ kiến, đừng chỉ liệt kê phương án

> ❌ Có ba hướng: A, B, C. Mỗi hướng có ưu nhược điểm riêng.
>
> ✅ Tôi chọn B. A đoán runner từ chuỗi lệnh, mà đoán sai thì hỏng lệnh test đang chạy tốt.

> ❌ Sau khi xem xét kỹ lưỡng các phương án, tôi cho rằng phương án B có nhiều ưu điểm hơn.
>
> ✅ Chọn B. Nó chạy 3 lần nhanh hơn và không cần thêm thư viện.

Người hỏi muốn biết bạn nghĩ gì. Bày ba lựa chọn ngang nhau rồi để họ tự chọn là đẩy việc về cho họ.

### Nhận sai thẳng, một câu, rồi đi tiếp

> ❌ Có vẻ như đã xảy ra một sự nhầm lẫn trong quá trình thực hiện trước đó.
>
> ✅ Chỗ này tôi gây ra. Commit trước tôi viết "chạy `compass status`" mà không thử.

Không rào đón, không tự trách dài dòng. Nói cái gì sai, rồi sửa.

### Chưa chắc thì nói chưa chắc

> ❌ Về cơ bản thì điều này có thể sẽ hoạt động trong hầu hết các trường hợp.
>
> ✅ Tôi chưa thử với Angular. Jest và Vitest thì chạy đúng.

Đừng dùng câu dài để che chỗ không chắc.

### Người dùng hiểu sai thì sửa thẳng, đừng lên lớp

> ❌ Bạn đang có một sự nhầm lẫn khá phổ biến ở đây.
>
> ✅ Chỗ này hơi khác: Redis không thay database. Nó đứng trước database để đỡ tải.

### Đừng khen câu hỏi

Bỏ "Câu hỏi rất hay", "Bạn hoàn toàn đúng khi...". Đi thẳng vào trả lời. Nếu câu hỏi thật sự chỉ ra
chỗ mình bỏ sót thì nói cụ thể nó chỉ ra cái gì, đừng khen suông.

### Câu cụt được phép

Tiếng Việt tự nhiên không phải lúc nào cũng cần chủ ngữ vị ngữ đủ.

> ✅ Không cần.
> ✅ Đúng, nhưng có một chỗ khác.
> ✅ Ba chỗ sai. Sửa xong mới chạy được.

### Câu ngắn xen câu dài

Toàn câu dài thì nghẹt. Toàn câu ngắn thì cộc như điện tín. Trộn vào nhau thì trôi.

---

## Phần 4 — Mười bốn lỗi hay gặp

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

Đổi khi lời thường dễ hiểu hơn, đừng đổi máy móc: dùng thay sử dụng, cần thay cần thiết phải, giúp
thay hỗ trợ trong việc, vì thay do nguyên nhân, để thay nhằm mục đích.

### 4. Bị động kiểu Tây

> ❌ Dữ liệu được xử lý bởi service rồi được lưu bởi repository.
>
> ✅ Service xử lý dữ liệu, repository lưu lại.

> ❌ Lỗi này đã được phát hiện bởi vòng review thứ ba.
>
> ✅ Vòng review thứ ba tìm ra lỗi này.

"Bởi" gần như luôn là dấu hiệu câu dịch. Tiếng Việt có chủ ngữ thì dùng chủ ngữ.

### 5. Cấu trúc tiếng Anh đội lốt tiếng Việt

> ❌ Điều này cho phép bạn có khả năng chạy gate riêng cho từng repo.
>
> ✅ Nhờ vậy bạn chạy được gate riêng cho từng repo.

> ❌ Có một số trường hợp nơi mà config bị đọc sai.
>
> ✅ Có vài trường hợp config bị đọc sai.

"Điều này cho phép", "cung cấp khả năng", "nơi mà", "X được sử dụng để" — đều là câu tiếng Anh mặc áo
tiếng Việt.

### 6. Đệm chữ cho câu dài ra

> ❌ Về cơ bản thì có thể nói rằng gate này về mặt nào đó đã hoạt động tương đối ổn định.
>
> ✅ Gate chạy đúng, 576 test xanh.

"Về cơ bản", "có thể nói rằng", "về mặt nào đó", "tương đối", "khá là", "nhìn chung", "điều quan
trọng cần lưu ý là", "cần lưu ý rằng" — bỏ hết.

### 7. Dịch thuật ngữ đã quen

> ❌ Điều kiện tranh chấp khiến tiến trình con bị treo ở cổng.
>
> ✅ Race condition làm tiến trình con giữ cổng.

Giữ nguyên: token · cache · race condition · deadlock · commit · merge · gate · reporter · regex ·
parser · deploy · build · rollback · timeout · retry. Dịch chúng làm người đọc phải dịch ngược
trong đầu.

Thuật ngữ mới thì giải thích ngay lần đầu, rồi dùng bình thường: "TTL (thời gian dữ liệu nằm trong
cache) là 5 phút."

### 8. Sáo rỗng

> ❌ Việc này đóng vai trò quan trọng trong việc đảm bảo chất lượng.
>
> ✅ Không có bước này thì bug lọt xuống production.

> ❌ Giải pháp mang lại nhiều lợi ích thiết thực.
>
> ✅ Bớt được hai bước tay và một lần đợi CI.

"Đóng vai trò quan trọng", "mang lại nhiều lợi ích", "trong bối cảnh hiện nay", "góp phần nâng cao",
"một cách hiệu quả" — nếu bỏ đi mà câu không mất nghĩa thì bỏ.

### 9. Một câu nhồi nhiều ý

> ❌ Sau khi sửa parser thì gate chạy đúng nhưng vẫn còn vấn đề với reporter của Jest do nó
> không in dòng Subtest nên phải đọc dòng PASS thay thế.
>
> ✅ Sửa parser xong, gate chạy đúng. Riêng Jest vẫn hỏng: nó không in `# Subtest:`. Phải đọc dòng
> `PASS <file>` thay thế.

Một câu một ý. Câu dài quá 25 chữ thì tìm chỗ chấm.

### 10. Nói vòng thay vì nói thẳng cái sai

> ❌ Có vẻ như kết quả trả về chưa hoàn toàn như mong đợi trong một số trường hợp nhất định.
>
> ✅ Hàm trả về `null` khi mảng rỗng. Nơi gọi không kiểm, nên crash.

Ngại làm người khác buồn mà nói vòng thì họ không sửa được.

### 11. Trang trọng không cần thiết, và lặp từ do dịch máy

> ❌ Kính mong quý vị lưu ý rằng thao tác này không thể hoàn tác.
>
> ✅ Xoá rồi không lấy lại được.

> ❌ Cấu hình cấu hình mặc định của hệ thống cấu hình.
>
> ✅ Cấu hình mặc định.

> ❌ Thực hiện chạy lệnh test để test lại.
>
> ✅ Chạy lại test.

### 12. Đại từ sai vai, và lặp lại câu hỏi

> ❌ Người dùng có thể gặp phải tình huống mà trong đó dữ liệu bị mất.
>
> ✅ Bạn có thể mất dữ liệu.

> ❌ Bạn đang hỏi Redis cache dùng để làm gì. Redis cache là...
>
> ✅ Redis giữ dữ liệu hay dùng trong RAM, nhờ vậy app không phải query DB liên tục.

Xưng "bạn", nhưng đừng đặt "bạn" ở đầu mọi câu — tiếng Việt bỏ chủ ngữ được: "Chỉ cần restart
service."

### 13. Lặp từ mở đầu ở các câu liền nhau

> ❌ Gate đọc gate.json chứ không chạy lại. Gate so bốn thứ để biết bằng chứng còn đúng. Gate nào
> thiếu sourceHash thì bị chặn.
>
> ✅ Gate đọc gate.json chứ không chạy lại. Nó so bốn thứ để biết bằng chứng còn đúng, và chặn bản
> ghi nào thiếu sourceHash.

> ❌ Việc sửa email cập nhật DB. Việc tạo event đọc DB. Việc sửa lần hai không chạm event.
>
> ✅ Sửa email thì DB đổi. Tạo event thì đọc DB. Nhưng lần sửa thứ hai không chạm tới event đã tạo.

Tiếng Việt rất dễ sập cái này vì "Việc X..." / "Điều này..." / "Nó..." lặp lại gần như không tốn
công. Ba câu liền nhau cùng mở đầu là người đọc thấy văn máy ngay.

Cách sửa: câu thứ hai dùng đại từ, hoặc gộp vào câu trước bằng "và", hoặc bỏ hẳn chủ ngữ.

### 14. Gọi một thứ bằng nhiều tên

> ❌ Nhánh dập false... đoạn ghi đè đó... node Generate hubspot parameters1... phần xoá team member
> cũ...
>
> ✅ Chọn một tên ở lần đầu — Generate hubspot parameters1 — rồi dùng đúng tên đó mọi lần sau.

Cần gọi ngắn thì khai một lần: "node ghi đè (Generate hubspot parameters1)", rồi dùng "node ghi đè"
xuyên suốt.

Lỗi này nặng nhất trong hồ sơ điều tra: người đọc không biết ba tên là một thứ hay ba thứ, và phải
đọc lại từ đầu để đoán. Khác với mục 7 — ở đó là dịch hay không dịch một thuật ngữ; ở đây là đổi tên
giữa đường.

---

## Phần 5 — Giải thích khái niệm

### Thứ tự: nó là gì → giải quyết vấn đề gì → chạy thế nào → ví dụ

Đừng mở đầu bằng định nghĩa học thuật khi chưa cần.

### Khái niệm khó thì ví dụ đi trước hoặc ngay sau định nghĩa

> ✅ Cache giống như để món đồ hay dùng ngay trên bàn, thay vì mỗi lần lại xuống kho lấy. Phần mềm
> cũng vậy: dữ liệu đọc nhiều thì giữ sẵn để lấy nhanh.

Rồi mới nói tới Redis, RAM, TTL.

### Đừng giải thích thuật ngữ bằng thuật ngữ khó hơn

> ❌ JWT là cơ chế stateless authentication dựa trên signed token.
>
> ✅ JWT là một chuỗi có chữ ký. Server đọc nó là biết người gửi request là ai, không cần lưu session
> cho từng người.

### Ví dụ phải gần việc người hỏi đang làm

Người hỏi làm backend thì lấy ví dụ backend. Đang nói về thương mại điện tử thì dùng sản phẩm, đơn
hàng, giỏ hàng — đừng nhảy sang ví dụ ngân hàng.

### Nhiều khái niệm gần nhau thì so trực tiếp

> ✅ CRM quản lý quan hệ với khách. ERP quản lý bên trong doanh nghiệp: kho, kế toán, mua hàng. Một
> công ty dùng cả hai cùng lúc được.

Tốt hơn ba định nghĩa rời rồi bắt người đọc tự tìm khác biệt.

### Quy trình thì kể theo dòng thời gian

Bước 1 tới bước cuối, đúng thứ tự xảy ra.

### Nhân quả nói rõ: "vì A nên B"

> ❌ Liên quan đến A, B có thể có những ảnh hưởng nhất định.
>
> ✅ A giữ cổng nên B không khởi động được.

### Trường hợp phổ biến trước, ngoại lệ sau

Đừng để ngoại lệ làm mất ý chính. Nói xong cái thường gặp rồi mới "có một ngoại lệ...".

### Mỗi đoạn chỉ thêm ít khái niệm mới

Một câu nhồi bốn năm thuật ngữ người đọc chưa biết thì chia nhỏ ra.

---

## Phần 6 — Trước khi gửi

Sáu câu hỏi:

- Câu đầu đã trả lời thẳng câu hỏi chưa?
- Có bảng hay bullet nào đáng lẽ nên là đoạn văn không?
- Mỗi khẳng định có số hoặc ví dụ chưa?
- Có chỗ nào đáng ngờ mà mình im lặng không?
- Câu nào dài quá 25 chữ không?
- Xoá 20% số chữ mà vẫn đủ ý không? (đoạn nào chỉ để trông chuyên nghiệp thì xoá trước)

**Phép thử cuối: đọc thành tiếng.** Câu đúng ngữ pháp mà đọc xong phải đọc lại là câu hỏng. Chỗ nào
lưỡi vấp, chỗ đó cần sửa.

---

## Phần 7 — Investigation và báo lỗi

Phần này áp cho hồ sơ điều tra, finding, báo lỗi — chỗ người đọc quét nhanh tìm kết luận. Viết như
một senior dev nhắn cho dev khác trong Slack hay Jira, không phải viết blog.

Phần 3 dạy giọng có người đứng sau; ở đây khô là đúng. Phần 5 cho phép so sánh để giải thích khái
niệm khó; ở đây thì không — bằng chứng cần chính xác, không cần dễ hình dung.

### Mỗi finding: kết luận → bằng chứng → ảnh hưởng

> ❌ Ban đầu tôi nghĩ lỗi nằm ở tầng đồng bộ. Sau khi thêm log và chạy lại ba lần, tôi phát hiện ra
> rằng thực ra vấn đề bắt nguồn từ chỗ khác — deltaToken.
>
> ✅ deltaToken hết hạn sau 7 ngày, Graph trả 410 và code nuốt lỗi.
> Bằng chứng: `sync.ts:88` bắt mọi exception, log ở `app.log:2025-09-03T04:12`.
> Ảnh hưởng: lịch ngừng cập nhật, không ai biết cho tới khi người dùng báo.

Người đọc cần kết quả, không cần biết bạn đã nghĩ sai chỗ nào trước đó.

### Nói rõ mức chắc chắn: đã xác nhận / suy ra / chưa biết

> ❌ Có vẻ như deltaToken là nguyên nhân, và điều này có thể ảnh hưởng đến các luồng khác.
>
> ✅ Đã xác nhận: deltaToken hết hạn gây 410 — tái hiện được bằng cách chỉnh giờ hệ thống.
> Suy ra: luồng `contacts` dùng chung hàm này nên khả năng cao cũng dính.
> Chưa biết: vì sao token hết hạn sớm hơn 7 ngày ở môi trường staging.

Ba mức, gọi tên thẳng. Trộn ba thứ vào một giọng "có vẻ như" thì người đọc không biết chỗ nào tin
được, chỗ nào phải tự kiểm lại.

### Không ẩn dụ, không từ kịch tính

> ❌ Email đã bị đóng băng trong một nơi ngoài tầm với.
>
> ✅ Outlook event vẫn giữ email cũ.

> ❌ Điểm mấu chốt nằm ở chỗ hàm này đã âm thầm nuốt lỗi suốt bao lâu nay.
>
> ✅ `catch` ở dòng 88 không log gì. Lỗi mất từ tháng 6.

Bỏ: đóng băng · mắc kẹt · trớ trêu · ẩn mình · ngoài tầm với · điểm mấu chốt · lỗ hổng chí mạng ·
âm thầm · hóa ra. Viết được bằng thuật ngữ kỹ thuật thì viết thẳng.

### Số dòng, số file, dấu thời gian — không phải "ở đâu đó"

> ❌ Lỗi xuất hiện ở tầng service, khá thường xuyên.
>
> ✅ `auth.service.ts:142`, 14 lần trong 6 giờ (log 04:00–10:00 ngày 3/9).

---

## Phần 8 — Viết cho người khác đọc

**Phạm vi: chỉ văn bản gửi ra ngoài phiên làm việc.** Ticket, email, báo cáo, tin nhắn cho đồng
nghiệp — nơi có người đọc và người đó phải quyết định gì đó.

**KHÔNG áp dụng cho `investigation.md` và `spec.md`.** Hai loại file đó ngược lại: càng đầy đủ càng
tốt, vì chúng là **bằng chứng**. Mang quy tắc "điều tra ra mười thứ viết bốn thứ" đi cắt hồ sơ điều
tra là phá đúng thứ Compass sinh ra để bảo vệ.

Bảy phần trên dạy **viết câu cho hay** — Phần 7 dạy cả cách xếp một finding. Phần này dạy **chọn câu
nào để viết**. Vấn đề là biên tập, không phải văn phong: một bản mà mọi câu đều đạt chuẩn bảy phần
trên vẫn có thể tệ vì dài gấp ba lần cần thiết.

**Phép thử chung: xóa câu đó đi, người đọc có ra quyết định khác không? Không thì bỏ.**

### Đừng giải thích cái người đọc đã biết

> ❌ Trang chỉ hỏi một câu duy nhất: người này có đang là order PIC của package nào còn sống không.
> Nó không quan tâm gì tới bản thân contact.
>
> ✅ Skynet check người này có đang là order PIC của package nào còn active không, không quan tâm
> contact status.

### Cảm xúc của bạn về cái bug không phải thông tin

> ❌ Bực nhất là dòng cache đó vẫn đang giữ giá trị đúng — Yes — nằm ngay bên cạnh. Bước ghi đè không
> thèm đọc.
>
> ✅ Dòng cache vẫn giữ giá trị đúng là Yes. Bước ghi đè không đọc mà cứ ghi No.

### Một ý nói một lần

Nói lại ở cuối bài không phải nhấn mạnh. Nó báo cho người đọc biết bạn không tin lần đầu họ hiểu.

> ❌ (mở bài) Trang Skynet và HubSpot lệch nhau vì hai bên dùng luật khác nhau.
> … (kết bài) Hiện tại trang hứa một đằng, flow làm một nẻo.
>
> ✅ Chỉ giữ câu mở bài.

### Giữ nguyên từ nghề

Dịch `cache` thành "bản sao trong database riêng" làm câu dài hơn mà không rõ hơn.

> ❌ Flow giữ một bản sao contact trong cơ sở dữ liệu riêng, mỗi lần chạy thì làm mới lại.
>
> ✅ Flow lưu danh sách contact sync trong database riêng, mỗi lần chạy thì refresh.

### Bỏ câu chuyển tiếp rỗng

> ❌ Heikki Rotko đúng y như vậy. Anh là PIC của package 7806 đang active.
>
> ✅ Checked Heikki Rotko mà Konsta nhắc đến đang bị như vậy. Contact này là PIC của package 7806
> đang active.

Bản ✅ vẫn có câu dẫn, nhưng câu đó **mang thông tin**: đây là ca Konsta báo, và đã kiểm rồi.

### Điều tra ra mười thứ thì viết bốn thứ

Quy tắc khó nhất, hỏng nhiều nhất. Tìm ra được cái gì thì muốn viết cái đó — công sức bỏ ra là thật.
Nhưng ticket không phải chỗ chứng minh mình điều tra kỹ. Người đọc cần **đủ để ra quyết định**, không
cần đủ để đánh giá bạn.

Ở ca INV-4, agent nhồi thêm hai phát hiện đúng mà không cần thiết: "Konsta mô tả sai hiện trường" và
"không có team skynet-connector nào". Cả hai đều đúng. Cả hai đều là chỉ trích đồng nghiệp trong một
ticket nhiều người đọc. Bỏ cả hai, để dành cho lúc nói riêng.

**Cách chọn:** liệt kê mọi thứ tìm được, hỏi từng cái *"thiếu cái này thì người đọc có ra quyết định
sai không?"*. Không thì cắt. Phần cắt ra để trong hồ sơ điều tra — không mất đi đâu.

### Cắt rồi vẫn phải đủ

Cắt quá tay cũng hỏng. Ở ca INV-4, bản viết lại mô tả bước ghi đè là "quét những dòng chưa refresh
quá 5 tiếng rồi update thành No" và "ý đồ chắc là để tắt cờ cho người không còn là PIC" — nhưng
thiếu câu nói **vì sao đó là lỗi**. Đọc xong thấy logic nghe hợp lý, và bỏ qua luôn cái bug lớn nhất.

Thiếu một câu:

> ✅ "Chưa được refresh" không có nghĩa "không còn là PIC" — chỉ có nghĩa contact rơi khỏi flow vì
> lý do nào đó.

**Phép thử:** cắt xong đọc lại như người chưa biết gì. Chỗ nào họ gật đầu bỏ qua mà lẽ ra phải dừng
lại, chỗ đó thiếu.
