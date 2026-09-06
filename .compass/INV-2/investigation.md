# INV-2: Gate test xanh cho task chưa viết dòng test nào

**Mở:** 2026-09-06
**Vùng nghi:** lib/test-parser.mjs, commands/test.mjs

## Triệu chứng

CP-14 chỉ sửa tài liệu, không viết test nào. Bảy ID trong spec là câu hỏi kiểm bằng mắt.
Gate vẫn báo:

```
✓ Gate test PASSED — 7/7 test cases đã chạy
```

Đếm trong suite: mỗi ID trong spec CP-14 có 10–13 test cùng tên thuộc task khác.

| ID | Số test trùng tên |
|---|---|
| H1 | 10 |
| H3 | 13 |
| EC1 | 13 |

Tái hiện độc lập, không dính CP-14: repo tạm, spec khai H1 và H2, lệnh test in
`ok 1 - H1 chuyện hoàn toàn khác` → gate exit 0, "2/2 test cases đã chạy".

Đây ăn thẳng vào mục đích của gate: nó sinh ra để chống "báo xong khi chưa xong".

## Giả thuyết

### H1: ID quá ngắn nên đụng nhau giữa các task
**Cách kiểm:** đọc `extractRanIds`, xem nó khớp ID theo cách nào. Rồi đếm số test trong suite mang tên bắt đầu bằng mỗi ID phổ biến (`H1`, `V1`, `EC1`).
**Kết quả:** đúng — khớp `H1` như một từ đứng riêng ở bất kỳ đâu trong output. Suite có 10 test tên `H1…`, 13 test `EC1…`, và 14 spec cùng dùng ID `H1`.

### H2: Gate không biết test nào thuộc task nào
**Cách kiểm:** kiểm xem `testCommand` có truyền thông tin task nào vào việc đối chiếu không, ngoài danh sách ID. Nếu không, nó không thể phân biệt được.
**Kết quả:** đúng — `extractRanIds(run.output, specIds)` chỉ nhận mảng ID. Không có tham số nào mang thông tin task, nên không có gì để phân biệt.

### H3: Task chỉ sửa tài liệu vẫn bị buộc khai test case
**Cách kiểm:** đọc `spec-validator.mjs` xem có loại task nào được miễn bảng test case không. Chạy `compass init` với từng loại, xem template đòi gì.
**Kết quả:** đúng — `minTests` thấp nhất là 2 (`fix`), và validator chặn khi `testCases.length === 0`. Không có đường nào khai "việc này không có test tự động".

### H4: Lỗi này chỉ xảy ra khi nhiều task dùng chung một suite
**Cách kiểm:** dựng hai repo tạm — một repo chỉ có đúng một task, một repo có hai task dùng chung ID. So kết quả gate.
**Kết quả:** sai — gate cho cùng kết quả `exit 0, 2/2` ở cả hai ca, tức nó **không phân biệt được**. Một ca thứ ba (hai ID chung một dòng) có fail, nhưng vì cơ chế `seenOnSharedLines` khác hẳn, không liên quan tới việc test thuộc task nào.

## Bằng chứng

Cách khớp ID — `lib/test-parser.mjs`:

```js
const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`);
if (pattern.test(plain)) idsOnThisLine.push(id);
```

Chữ ký hàm — `commands/test.mjs:43`:

```js
const extracted = extractRanIds(run.output, specIds);
```

Đo mức đụng độ trên chính repo này:

```
ID trong spec → số test cùng tên trong suite
  H1: 10    H2: 10    V1: 11    E1: 11    EC1: 13    S1: 10
14 spec cùng dùng ID H1
```

Ba ca chạy thật, cùng spec khai H1 và H2:

```
chỉ test của T-1                    exit 0  ✓ 2/2 test cases đã chạy
chỉ test của task khác, trùng ID    exit 0  ✓ 2/2 test cases đã chạy   ← sai
hai ID trên cùng một dòng           exit 1  ✗ (do seenOnSharedLines, không liên quan)
```

Giá của cách sửa hiển nhiên nhất (buộc ID mang tiền tố task): **14 spec + 221 test** phải đổi.

Nhưng `testCommand` đã nhận `taskId` ở dòng 13 — nó chỉ không truyền xuống `extractRanIds`.

## Kết luận

Gate `test` đối chiếu ID mà **không biết task nào**. `extractRanIds` chỉ nhận danh sách ID
trần, và ID trong spec là `H1`, `V1`, `EC1` — 14 task cùng dùng chung bộ đó, suite có 10–13
test trùng tên mỗi ID. Bất kỳ test nào của bất kỳ task nào cũng thoả mãn gate của task khác.

Hệ quả: một task chưa viết dòng test nào vẫn qua được gate, miễn có task khác đã viết test
tên `H1`. Đó chính là "báo xong khi chưa xong" — thứ gate này sinh ra để chặn.

Có hai lỗ riêng, đừng nhầm thành một:

1. **ID không định danh được task.** Sửa được mà không phá 221 test: `testCommand` đã có
   `taskId`, chỉ cần truyền xuống rồi ưu tiên dòng có mang task id, hoặc cảnh báo khi một ID
   khớp nhiều dòng thuộc file khác nhau.
2. **Không có đường khai "việc này không có test tự động".** Mọi loại task đều đòi tối thiểu
   2 test case. Task chỉ sửa tài liệu buộc phải bịa ID, và chính chỗ bịa đó là nơi lỗ số 1
   phát tác.

## Pitfall

**Gặp:** 2026-09-06 · INV-2 · gate `test` xanh cho CP-14, task chỉ sửa tài liệu
**Triệu chứng:** gate báo đủ test đã chạy cho một task chưa viết dòng test nào; nhìn output thấy tên test lạ hoắc
**Nguyên nhân:** định danh dùng để đối chiếu (`H1`, `V1`) không định danh được thứ nó đối chiếu. 14 task chung một bộ ID, gate không nhận tham số nào cho biết task nào đang chạy.
**Vùng ảnh hưởng:** lib/test-parser.mjs, commands/test.mjs, lib/spec-validator.mjs
**Phòng tránh:** khi một gate đối chiếu hai danh sách, hỏi trước "định danh này có duy nhất trong phạm vi đối chiếu không". Nếu không thì gate đang đo thứ khác với thứ nó tưởng. Ở đây phạm vi là cả suite, mà ID chỉ duy nhất trong một spec.

## Việc cần làm tiếp

Mở hai task BUILD, tách riêng vì chúng sửa hai thứ khác nhau:

1. **Buộc ID định danh được task.** Truyền `taskId` xuống `extractRanIds`, ưu tiên dòng mang
   task id, và cảnh báo khi một ID khớp nhiều dòng ở file khác nhau. Không đổi 221 test đang có.
2. **Cho phép task khai không có test tự động.** Việc sửa tài liệu, đổi config, viết ghi chú —
   ép bịa test case chỉ tạo ra chỗ cho lỗ số 1 phát tác. Cần một đường khai rõ ràng thay vì
   bịa, và gate phải kiểm bằng cách khác.
