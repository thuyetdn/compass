# Compass GĐ 1 — Chạy thử trên frontend

**Ngày:** 2026-09-05
**Task thử:** TD-001 (`feature-s`) — todo list React, 13 test case
**Codebase:** `examples/todo` — React 18 + Vite 5 + Vitest 2, jsdom, Testing Library

Bổ sung cho [chạy thử GĐ 1 trên chính Compass](2026-09-05-phase-1-trial.md). Lần đó là task
`fix` trên dự án Node thuần; lần này cố tình chọn thứ khác hẳn — frontend, `feature-s`,
test runner không phải `node:test` — để tìm chỗ gãy.

---

## Ba chỗ gãy tìm được

### 1. Reporter mặc định của Vitest làm gate `test` đổ oan

Nghiêm trọng nhất, vì nó **báo sai** chứ không phải báo thiếu.

Vitest mặc định chỉ in tên file, không in tên từng test:

```
 ✓ test/App.test.jsx (1 test) 268ms
```

Test `H1` chạy thật và pass thật. Nhưng Compass quét output không thấy chuỗi `H1` ở đâu,
nên kết luận:

```
✗ Gate test FAILED
  Spec khai báo 1 test cases, chỉ tìm thấy 0 đã chạy.
  Không tìm thấy dấu vết: H1
```

Hai cái sai chồng lên nhau:

| | Vấn đề |
|---|---|
| **Kết luận sai** | Test đã chạy và pass, gate nói không có |
| **Hướng dẫn sai** | "Viết test cho các case còn thiếu" — làm theo sẽ viết test trùng |

Chữa được bằng `--reporter=tap`, và parser đọc tốt TAP lồng của Vitest:

```
TAP version 13
1..1
ok 1 - test/App.test.jsx # time=270.75ms {
    1..1
    ok 1 - H1 adds a todo to the list # time=269.74ms
}
```

Nhưng **không có gì trong sản phẩm nói cho người dùng biết điều đó.** `compass init` không
hỏi, SKILL.md không nhắc, thông báo lỗi không gợi ý. Trường `testReporter: "tap"` có trong
`config.json` nhưng chỉ là khai báo suông — Compass không dùng nó để kiểm tra hay cảnh báo gì.

**Đề xuất:** khi gate `test` thấy suite exit 0 mà **không ID nào** khớp, đó gần như chắc chắn
là vấn đề reporter, không phải thiếu test. Thông báo nên nói thẳng khả năng đó thay vì bảo đi
viết test.

### 2. `ui` và `visual` không nằm trong bảng gate của bất kỳ task nào

Spec thiết kế §5 ghi `feature-s` cần cả `ui` và `visual`. Nhưng
[lib/task-types.mjs](../../../lib/task-types.mjs) cho `feature-s` chỉ có:

```js
gates: ['spec', 'test', 'convention']
```

Hệ quả: chạy `done` trên một task frontend `feature-s` báo xanh, chỉ nhắc `convention`,
**im lặng hoàn toàn về `ui` và `visual`**:

```
✓ Gate done PASSED — 2 gate đã pass
Gate convention chưa xây dựng ở giai đoạn này và không được kiểm tra.
```

Nghịch lý: [commands/check.mjs](../../../commands/check.mjs) *có* `ui` và `visual` trong
thứ tự chạy (`ORDER`), nhưng vì `task-types.mjs` không bao giờ đưa chúng vào, nhánh đó chết.
Hai file không khớp nhau.

Đây khác với "gate chưa xây" — người dùng được báo rõ ràng khi gate chưa xây. Ở đây họ
**không được báo gì cả**, nên dễ tin task frontend đã qua đủ cổng.

**Đề xuất:** thêm `ui`, `visual` vào `gates` của `feature-s`/`m`/`l` ngay bây giờ, dù chưa
implement. Cơ chế "chưa cài ở giai đoạn này" đã có sẵn và chạy đúng — cứ để nó báo.

### 3. `.gitignore` nuốt mất spec của example

`.compass/` bị ignore toàn cục. Hợp lý cho trạng thái cục bộ, nhưng với một repo example thì
spec chính là thứ đáng đọc nhất — mà nó lại không vào được git.

Đã sửa: giữ `spec.md` và `config.json` của `examples/*`, vẫn loại `evidence/` và `.salt`.

---

## Chỗ Compass làm tốt hơn mong đợi

Phân biệt **test fail** với **test thiếu**. Viết 12/13 test, để app thiếu validation:

```
✗ Gate test FAILED
  Spec khai báo 13 test cases, chỉ tìm thấy 8 đã chạy.
  Xuất hiện nhưng không pass (skip/fail/error): V1, V2, EC2, S1
  Không tìm thấy dấu vết: E1
```

Hai nhóm này đòi hai việc khác nhau — sửa code, và viết test — và gate gọi tên đúng cả hai.
Đây là thứ đọc `1 passed / 4 failed` của Vitest không bao giờ thấy được.

Thêm nữa: trong 4 ca fail, hai ca (`V1`, `V2`) là app thiếu tính năng thật, hai ca (`EC2`, `S1`)
là test tôi viết sai (`user.type` gõ 500 ký tự vượt timeout 5s; `<script>` bị userEvent hiểu
thành phím tắt). Gate không phân biệt được hai loại này — nhưng nó không hứa điều đó, và
`test.log` giữ đủ chi tiết để tự đọc ra.

---

## Điều chưa kiểm nghiệm được

| Việc | Vì sao |
|---|---|
| Gate `ui` / `visual` thật | Chưa xây (GĐ 2) |
| Monorepo, phân giải config theo tầng | Chưa xây (GĐ 4) |
| Task `feature-m` (21 test) trở lên | Chưa thử; 13 test đã mất ~30 phút viết |
| Số test tối thiểu cho `feature-s` | 13 case cho một todo list thấy **vừa đủ**, không gượng như `fix`/2 case |

---

## Số liệu

| Chỉ số | Giá trị |
|---|---|
| Gate `spec` | ~0.1s |
| Gate `test` (13 test, Vitest + jsdom) | ~17s |
| Test ID đối chiếu | 13 khai báo → 13 đã chạy |
| Suite compass sau khi thêm example | 208 pass / 208 — example không lẫn vào |
