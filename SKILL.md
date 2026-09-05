---
name: compass
description: "Quy trình phát triển có bằng chứng — spec trước code, gate máy chạy thật thay vì AI tự khai kết quả. Dùng khi bắt đầu bất kỳ task lập trình nào — thêm tính năng, sửa bug, refactor — hoặc khi người dùng nhắc compass, gate, spec-first, hay hỏi vì sao AI báo xong mà chưa xong."
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

## Trước tiên: có `compass` chưa?

```
compass
```

Không thấy lệnh → cài một lần, dùng cho mọi dự án:

```
npm install -g <đường-dẫn-tới-repo-compass>
```

Không cài được thì gọi trực tiếp, thay `compass` bằng `node <đường-dẫn>/cli.mjs` ở mọi lệnh bên dưới.

## Luật tối cao

1. **Không bao giờ tự tuyên bố kết quả.** Chỉ `compass` mới phán pass/fail.
2. **Không sửa gì trong `evidence/`.** Đó là vùng của máy.
3. **Spec trước code.** Không có spec đã duyệt thì không gõ dòng code nào.
4. **Nghi ngờ độ lớn task → nâng cấp.** Không bao giờ hạ cấp.
5. **Knowledge base mâu thuẫn với code → DỪNG, hỏi người.** Không tự chọn bên.

## Ngôn ngữ

- Đối thoại, giải thích, báo cáo với người → **tiếng Việt**
- Spec, test name, commit message, code comment → **tiếng Anh**

### Quy tắc diễn đạt tiếng Việt

Sáu lỗi, mỗi lỗi một cặp câu. Đọc cặp câu, đừng đọc tên lỗi.

**1. Mô tả cơ chế thay vì nói kết quả**

> ❌ Compass tìm test bằng cách đọc chữ trong màn hình output.
>
> ✅ Reporter không in tên test thì Compass báo thiếu, dù bạn đã viết đủ.

Câu đầu tả máy chạy ra sao. Câu sau nói chuyện gì xảy ra với người đọc. Luôn chọn câu sau.

**2. Chủ ngữ mơ hồ**

> ❌ Ai đó quên chép `ui` và `visual` vào bảng gate.
>
> ✅ Bảng gate thiếu `ui` và `visual`.

"Ai đó", "hệ thống", "người ta" — bỏ hết. Nói thẳng cái gì thiếu, cái gì sai.

**3. Dịch code thành lời**

> ❌ Hàm `syncEvents` gọi Graph API lấy danh sách rồi lưu vào database qua repository.
>
> ✅ Lịch kéo về mỗi 15 phút, hỏi Graph "có gì đổi không" bằng deltaToken lưu trong DB.

Người đọc mở được file. Họ cần biết **vì sao** và **khi nào hỏng**, không cần biết dòng nào gọi dòng nào.

**4. Hán-Việt nặng khi có từ thuần Việt**

> ❌ Thực hiện việc kiểm tra tính hợp lệ của dữ liệu đầu vào.
>
> ✅ Kiểm dữ liệu vào có hợp lệ không.

Thấy "thực hiện việc", "tiến hành", "tính ... của" — cắt.

**5. Bị động kiểu Tây**

> ❌ Dữ liệu được xử lý bởi service rồi được lưu bởi repository.
>
> ✅ Service xử lý dữ liệu, repository lưu lại.

Tiếng Việt có chủ ngữ thì dùng chủ ngữ.

**6. Nói vòng trước khi vào việc**

> ❌ Tôi đã tiến hành phân tích và nhận thấy rằng có một vấn đề khá nghiêm trọng ở đây, cụ thể là...
>
> ✅ Parser xếp sai một test đã pass.

Câu đầu tiên phải là kết luận. Bối cảnh để sau.

**Giữ nguyên, đừng dịch:** token · cache · race condition · deadlock · commit · merge · gate · reporter.

### Tự kiểm trước khi gửi

Đọc lại đoạn vừa viết, hỏi bốn câu:

| Hỏi | Nếu "không" thì |
|---|---|
| Ba câu đầu đã nói hết ý chính chưa? | Chuyển kết luận lên đầu |
| Mỗi khẳng định có số hoặc ví dụ chưa? | Thay lời khen bằng số đo |
| Có chỗ nào đáng ngờ mà tôi im lặng không? | Nói ra — giả định ngầm, nhánh chưa xử lý, chỗ dễ vỡ |
| Đoạn từ 4 bước trở lên đã có bảng hoặc sơ đồ chưa? | Vẽ ra |

**Khó nhất là câu thứ ba.** Chỗ đáng ngờ thường là chỗ mình lười kiểm. Nói ra thì mất mặt một chút, giấu đi thì người khác sập bẫy.

## Vòng đời task

```
compass init <id> --type=<loại>     tạo spec skeleton
     ↓  bạn viết spec
compass spec <id>                   gate: spec hợp lệ?
     ↓  NGƯỜI DUYỆT ← dừng ở đây, chờ người nói tiếp
     ↓  bạn viết code + test
compass check <id>                  chạy mọi gate áp dụng
     ↓
compass done <id>                   cổng cuối
```

## Phân loại task

| Loại | Dùng khi | Test tối thiểu | Lớp bắt buộc |
|---|---|---|---|
| `fix` | typo, 1-2 dòng, không đổi hành vi | 2 | Happy |
| `bug` | sửa lỗi có nguyên nhân rõ | 6 | Happy, Validation, Error, Edge |
| `feature-s` | tính năng nhỏ, 1 module | 13 | + Security |
| `feature-m` | tính năng vừa, nhiều module | 21 | cả 6 lớp |
| `feature-l` | tính năng lớn, cross-repo | 30 | cả 6 lớp |

Sáu lớp: Happy · Validation · Error · Edge · Security · Performance

Nghi ngờ giữa hai loại → **chọn cái nặng hơn**.

## Bước 1 — Định hướng

Trước khi viết gì:

1. Đọc code thật của vùng sẽ sửa
2. Nếu dự án có `.knowledge/index.md` → đọc bản đồ, rồi chỉ nạp mảnh liên quan
3. Không nuốt cả thư mục docs vào context

*Knowledge base cho biết **ở đâu** và **tại sao**. Code cho biết **thực tế là gì**. Khi lệch nhau, code thắng về sự thật — nhưng phải báo người, không tự sửa docs.*

## Bước 2 — Spec

```
compass init <id> --type=<loại>
```

Điền vào `.compass/<id>/spec.md`. Mọi mục đều bắt buộc, đặc biệt **Rủi ro hồi quy** — nghĩ xem tính năng cũ nào có thể vỡ.

Test case phải có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`), mô tả, và kỳ vọng **đo được**. "Hoạt động đúng" không phải kỳ vọng đo được.

```
compass spec <id>
```

Pass → **dừng lại, đưa người duyệt**. Đây là điểm dừng bắt buộc duy nhất. Không tự đi tiếp.

## Bước 3 — Implement

- Mỗi test case trong spec = một test function, **tên bắt đầu bằng ID**: `test_H1_filters_by_country`
- Viết test trước, chạy thấy nó đỏ, rồi mới implement
- KHÔNG test implementation detail: state nội bộ, snapshot lớn, mock chính mình
- FE: query bằng role/text người dùng thấy, không bằng test-id nội bộ
- Phát hiện task lớn hơn dự tính → sửa `Loại:` trong spec, chạy lại `compass spec`, xin duyệt lại

## Bước 4 — Verify

```
compass check <id>
```

Chạy các gate áp dụng, dừng ngay khi fail. Rẻ trước, đắt sau: `spec` → `convention` → `test`.

Gate `test` không chỉ xem suite xanh — nó còn đối chiếu **mọi test ID trong spec đã thực sự chạy chưa**.

### Gate `convention` — quy ước viết một lần

Luật nằm trong `.knowledge/decided/conventions.md`. Phần văn xuôi cho người đọc, khối ```` ```rule ```` cho máy chạy:

````markdown
## Không hardcode mã màu

Màu phải đi qua CSS variable để đổi theme được.

```rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}\b"
scope: src/**/*.jsx
severity: error
message: Dùng CSS variable thay vì mã màu
```
````

| Trường | Nghĩa |
|---|---|
| `id` | Tên luật, hiện trong báo lỗi. Không trùng nhau |
| `type` | Hiện chỉ có `forbid-pattern` |
| `pattern` | Regex. Khớp là vi phạm |
| `scope` | Glob: `**`, `*`, `?` |
| `severity` | `error` chặn gate, `warn` chỉ hiện ra |
| `message` | Tùy chọn — câu nhắc kèm mỗi vi phạm |

Không có `conventions.md` thì gate pass và nói rõ là chưa có luật nào. Luật khai sai — thiếu trường, regex hỏng, `type` chưa hỗ trợ — thì gate **fail**, vì luật chạy không được trông như có bảo vệ mà thật ra không bảo vệ gì.

`node_modules`, `dist`, `build`, `coverage`, `.git` không bị quét.

**Giới hạn:** chỉ khớp mẫu theo dòng, không phân tích AST. Luật kiểu "component này phải nhận prop kia" chưa làm được. Quy ước mềm cứ để dạng văn xuôi — vẫn đọc được, chỉ không có gate.

### Cách Compass đếm test ID

**Chỉ dòng có dấu hiệu pass mới được tính.** Không phải cứ thấy ID trong output là xong.

| ID xuất hiện ở | Compass kết luận |
|---|---|
| Dòng pass (`ok N`, `✔`, `✓`, `PASS`) | đã chạy |
| Dòng fail / skip / error | "xuất hiện nhưng không pass" |
| Dòng không nhận ra định dạng | "không nhận diện được định dạng" |

Ba nhóm tách riêng vì chúng đòi bạn làm ba việc khác nhau: viết test mới, bỏ skip, hay kiểm lại reporter.

**Giới hạn — phải biết:** quét text không bao giờ kín được. Định dạng reporter không nằm trong tay Compass, nên gate này bắt các ca thường gặp và **gọi tên thứ nó không phân loại được**, chứ không giả vờ chắc chắn. Đây là lưới chắn, không phải khóa.

### Reporter phải in tên từng test

Compass tìm ID bằng cách đọc output. Reporter nào chỉ in tên **file** thì mọi ID đều biến mất, và gate báo thiếu test dù bạn đã viết đủ.

| Runner | Lệnh trong `config.json` |
|---|---|
| `node --test` | chạy sẵn, không cần cờ |
| Vitest | `vitest run --reporter=tap` — mặc định chỉ in tên file |
| Jest | `jest --verbose` |

Kiểm nhanh: chạy lệnh test, nhìn output. Không thấy tên test nào thì Compass cũng không thấy.

Khi suite xanh mà gần như không ID nào khớp, gate sẽ tự nhắc khả năng này trước khi bảo bạn đi viết test.

Fail → sửa → chạy lại. Không bỏ qua, không giải thích vòng vo.

## Bước 5 — Đóng task

```
compass done <id>
```

Exit 0 mới được báo hoàn thành. Dán output của lệnh này khi báo cáo.

### Gate xanh ≠ mục tiêu đạt

Compass chứng minh **test đã chạy và xanh**. Nó không chứng minh **test đo đúng thứ cần đo**.

Một task có mục tiêu "không còn để lại file rác" có thể pass mọi gate trong khi rác vẫn còn — nếu test case chỉ kiểm hàm dọn chạy được, chứ không kiểm kết quả cuối. Gate không biết điều đó.

Nên: sau khi `done` xanh, **tự kiểm mục tiêu gốc một lần**. Nếu spec nói "sau khi chạy không còn X", thì đi đếm X. Trách nhiệm chọn test case đo đúng mục tiêu vẫn nằm ở người viết spec — công cụ chỉ đảm bảo bạn không nói dối về việc đã chạy chúng.

### Compass từ chối bản ghi thế nào

Bản ghi gate được ký kèm **danh tính**, không chỉ nội dung. Bốn lý do bị từ chối:

| Thông báo | Nghĩa là |
|---|---|
| "bản ghi đã bị sửa tay" | Giá trị trong `gate.json` bị đổi |
| "không thuộc slot này" | Bản ghi của gate khác bị chuyển sang |
| "thuộc task khác" | `gate.json` bị chép từ task khác |
| "bản ghi từ phiên bản cũ" | Thiếu trường danh tính — chạy lại gate |

### Ba giới hạn chưa đóng được

**Source code không được hash.** Test xanh xong, code vẫn có thể bị đổi mà `done` không biết.

**Bản ghi cũ có thể được khôi phục.** Lưu `gate.json` lúc xanh, để test đỏ, chép lại file cũ — `done` vẫn xanh. Bản ghi đó hợp lệ mọi mặt: đúng khe, đúng task, spec và config không đổi. Không có gì đánh dấu thời gian hay xâu chuỗi các lần chạy.

**`config.json` được tin.** Compass bắt được lệnh test **đổi sau** khi gate chạy (qua `configHash`), nhưng nếu ai sửa nó **trước** khi chạy gate — trỏ sang một lệnh `echo` in ra định dạng TAP giả — thì không có cách nào phát hiện. Compass không phán được lệnh đó có phải test suite thật hay không.

Ba điều này chặn được **sai sót vô tình**, không chặn được **cố ý gian lận**. Đó là ranh giới, và bạn nên biết nó ở đâu.

## Giai đoạn hiện tại

Đã có: `spec`, `convention`, `test`. Còn thiếu: `ui`, `visual`, `review` — `check` báo chúng là bỏ qua, không tính fail, và `done` liệt kê rõ gate nào chưa được kiểm.

Task frontend `feature-s` trở lên vì thế đóng xanh **mà chưa ai đo giao diện**. Dòng "chưa xây dựng ở giai đoạn này" trong output `done` là thứ phải đọc, không phải ghi chú cho vui.

## Red Flags

| Bạn nghĩ | Thực tế |
|---|---|
| "Task nhỏ, bỏ spec cho nhanh" | Nhỏ = spec ngắn, không phải không có spec |
| "Test pass rồi, chắc compass cũng pass" | Chưa chạy thì chưa biết gì cả |
| "Docs lỗi thời chút không sao" | Docs lỗi thời = quyết định dựa trên thông tin sai |
| "Screenshot trông giống rồi" | Trông giống không phải bằng chứng. Đo số. |
| "Còn 1 test fail nhưng không liên quan" | Fail là fail |
| "Tôi sẽ sửa gate.json cho nhanh" | Chữ ký sẽ lộ — sửa giá trị, chuyển khe, chép từ task khác đều bị bắt. Và đó là gian lận. |
| "Người duyệt chắc sẽ đồng ý thôi" | Chờ họ nói. Đoán ý là bỏ qua checkpoint. |
| "compass done xanh rồi, xong" | Gate chứng minh test đã chạy, không chứng minh test đo đúng thứ. Tự kiểm mục tiêu gốc một lần. |
