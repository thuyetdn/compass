---
name: compass
description: Quy trình phát triển có bằng chứng — spec trước code, gate máy kiểm thay vì AI tự khai. Dùng khi bắt đầu bất kỳ task lập trình nào trong dự án có .compass/.
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

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

### Cách Compass quét test ID

Compass đọc output của lệnh test và tìm các test ID từ spec trên những dòng được báo cáo là PASS. Cụ thể: Compass coi test ID là chạy thành công chỉ khi nó xuất hiện trên dòng được đánh dấu pass (ví dụ: `ok N`, `✔`, `✓`, `PASS`). Nếu test ID xuất hiện trên dòng báo fail, skip, hoặc error, Compass báo cáo nó "đã xuất hiện nhưng không pass". Nếu Compass không nhận diện được định dạng báo cáo của test runner, nó liệt kê các dòng lạ và nói "không nhận diện được định dạng".

**Hạn chế:** Quét text output không thể chắc chắn 100% vì định dạng báo cáo không nằm dưới quyền kiểm soát của Compass. Gate này bắt được trường hợp bình thường (test bỏ sót, test fail) và tên rõ ràng những gì nó không thể phân loại. Nó không thay thế một hệ thống báo cáo structured.

Fail → sửa → chạy lại. Không bỏ qua, không giải thích vòng vo.

## Bước 5 — Đóng task

```
compass done <id>
```

Exit 0 mới được báo hoàn thành. Dán output của lệnh này khi báo cáo.

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
| "Tôi sẽ sửa gate.json cho nhanh" | Chữ ký sẽ lộ. Và đó là gian lận. |
| "Người duyệt chắc sẽ đồng ý thôi" | Chờ họ nói. Đoán ý là bỏ qua checkpoint. |
