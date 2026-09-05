# Compass GĐ 1 — Ghi chú chạy thử

**Ngày:** 2026-09-05
**Task thử:** CP-1 (`fix`) — dọn thư mục tạm sau test tích hợp
**Codebase:** chính Compass (186 test thật)

---

## Về việc chọn codebase

Kế hoạch nói chạy thử trên `nexus-app-backend`. Không làm được: repo đó trên máy này chỉ có `docs/`, code chưa clone về.

Thay bằng cách tự dùng Compass trên chính nó. Không phải phép thử lý tưởng — Compass là dự án Node nhỏ, không phải NestJS nhiều module — nhưng nó là **task thật, trên codebase thật, với 186 test thật**, không phải kịch bản dựng sẵn. Việc còn thiếu là kiểm nghiệm trên monorepo và trên frontend.

---

## Bảng quan sát

| Câu hỏi | Quan sát |
|---|---|
| **Tổng thời gian so với làm tay?** | Sửa code: ~5 phút. Compass thêm: viết spec ~3 phút, chạy gate 2.5 giây. Tức là **overhead gần như toàn bộ nằm ở viết spec**, không phải ở công cụ. |
| **Gate nào cản trở hơn giúp đỡ?** | Không gate nào cản. `spec` chạy 0.1s, `test` 2.4s. Nhưng `spec` với loại `fix` đòi tối thiểu 2 test case — với sửa 1 dòng thật sự thì con số này hơi gượng. |
| **Số test tối thiểu có hợp lý?** | Cho task này (`fix`, 2 test) — hợp lý. Chưa kiểm nghiệm được `feature-m` (21 test) trên việc thật. |
| **Đối chiếu test ID có bắt được lỗi thật?** | **Có, và đây là phần giá trị nhất.** Xem mục dưới. |
| **Chỗ nào trong SKILL.md gây hiểu nhầm?** | Mục quét test ID ban đầu viết thành đoạn văn dày đặc — vi phạm chính quy tắc "không wall-of-text" nó dạy. Đã sửa thành bảng. |
| **Có lúc nào muốn bỏ qua Compass?** | Một lúc: khi viết mục "Rủi ro hồi quy" cho một fix hiển nhiên. Nhưng chính lúc ép mình viết ra thì mới nhận ra rủi ro thật — dọn quá sớm sẽ xóa thư mục khi test còn đang đọc. Điều đó **đổi cách tôi implement**: dùng `after()` thay vì dọn trong từng test. |

---

## Phát hiện quan trọng nhất

Gate xanh **không** có nghĩa mục tiêu đã đạt.

```
compass done CP-1  →  ✓ PASSED — 2 gate đã pass
```

Nhưng ngay sau đó, đếm thư mục rác vẫn thấy 40. Phải tự đo mới biết:

```
trước khi chạy suite: 40
sau khi chạy suite:   40
chênh lệch: 0          ← fix có tác dụng
```

40 thư mục kia là rác tích lũy từ các lần chạy **trước** khi có fix. Mục tiêu đạt — nhưng **Compass không chứng minh được điều đó**, nó chỉ chứng minh 2 test đã chạy và xanh.

Đây là ranh giới thật của công cụ, và nó nên được nói thẳng trong SKILL.md: *gate chứng minh test đã chạy, không chứng minh test đúng thứ cần đo.* Người viết spec vẫn chịu trách nhiệm chọn test case đo đúng mục tiêu.

---

## Quan sát về "Rủi ro hồi quy"

Mục này ban đầu thấy phiền. Nhưng nó là chỗ duy nhất trong quy trình bắt phải nghĩ **trước** khi code. Với task này, viết ra rủi ro "dọn quá sớm sẽ xóa mất thư mục đang dùng" đã dẫn thẳng tới thiết kế đúng.

Đề xuất giữ nguyên, không nới.

---

## Đề xuất trước khi sang GĐ 2

| Việc | Lý do |
|---|---|
| **Giữ nguyên số test tối thiểu** | Chưa có bằng chứng nào cho thấy chúng sai. Đợi thêm task thật. |
| **Thêm một câu vào SKILL.md** về ranh giới "gate xanh ≠ mục tiêu đạt" | Phát hiện ở trên. Không nói ra thì người dùng sẽ tin quá mức. |
| **Chạy thử trên Nexus thật khi có code** | Ba thứ chưa kiểm nghiệm: monorepo, frontend, task `feature-m` trở lên. |
| **Chưa cần rút gọn quy trình cho `fix`** | Overhead đo được là 2.5 giây máy. Phần tốn thời gian là viết spec, mà đó là phần có giá trị. |

---

## Số liệu

| Chỉ số | Giá trị |
|---|---|
| Gate `spec` | 0.10s |
| Gate `test` | 2.40s (chạy đủ 186 test) |
| Test ID đối chiếu | 2 khai báo → 2 đã chạy |
| Tổng test suite sau task | 186 pass / 186 |
