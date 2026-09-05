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

**Cấm:**
- Dịch code thành lời (*"gọi hàm X để lấy Y rồi trả về Z"*)
- Hán-Việt nặng khi có từ thuần Việt: "thực hiện việc kiểm tra" → "kiểm tra"
- Câu bị động kiểu Tây: "dữ liệu được xử lý bởi service" → "service xử lý dữ liệu"
- Dịch thuật ngữ đã quen: giữ nguyên *token, cache, race condition, deadlock*

**Bắt buộc:**
- Kể theo **dòng chảy dữ liệu**, không theo thứ tự file
- Nói cái quan trọng trước — đọc 3 câu đầu vẫn nắm được ý chính
- **Chỉ ra chỗ đáng ngờ** — giả định ngầm, nhánh không xử lý, chỗ dễ vỡ
- Ví dụ cụ thể thay vì mô tả trừu tượng
- Sơ đồ khi có từ 4 bước trở lên

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

Chạy các gate áp dụng, dừng ngay khi fail. Gate `test` không chỉ xem suite xanh — nó còn đối chiếu **mọi test ID trong spec đã thực sự chạy chưa**.

### Cách Compass đếm test ID

**Chỉ dòng có dấu hiệu pass mới được tính.** Không phải cứ thấy ID trong output là xong.

| ID xuất hiện ở | Compass kết luận |
|---|---|
| Dòng pass (`ok N`, `✔`, `✓`, `PASS`) | đã chạy |
| Dòng fail / skip / error | "xuất hiện nhưng không pass" |
| Dòng không nhận ra định dạng | "không nhận diện được định dạng" |

Ba nhóm tách riêng vì chúng đòi bạn làm ba việc khác nhau: viết test mới, bỏ skip, hay kiểm lại reporter.

**Giới hạn — phải biết:** quét text không bao giờ kín được. Định dạng reporter không nằm trong tay Compass, nên gate này bắt các ca thường gặp và **gọi tên thứ nó không phân loại được**, chứ không giả vờ chắc chắn. Đây là lưới chắn, không phải khóa.

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

GĐ 1 có gate `spec` và `test`. Các gate `convention`, `ui`, `visual`, `review` thuộc giai đoạn sau — `check` sẽ báo chúng là bỏ qua, không tính fail. Khi chạy `done`, nếu task type yêu cầu gate chưa được xây dựng, Compass sẽ thông báo rõ chúng là giai đoạn tới.

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
