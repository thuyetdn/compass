# CP-20: Let a doc-only task declare it has no automated tests
Loại: fix
Phạm vi: lib/spec-parser.mjs, lib/spec-validator.mjs, commands/test.mjs

## Mục tiêu
Lỗ số hai của INV-2, mở từ 2026-09-06 và chưa vá.

Mọi loại task đều đòi tối thiểu 2 test case — `fix` là 2, `bug` là 6. Task chỉ sửa tài liệu
buộc phải bịa ID, và chính chỗ bịa đó là nơi lỗ số một phát tác: CP-14 khai 7 ca là câu hỏi
kiểm bằng mắt, gate đối chiếu chúng với suite và báo xanh 7/7 khi CP-14 chưa viết dòng test nào.

Xong nghĩa là: spec khai được "việc này kiểm bằng mắt", gate `test` nói thẳng điều đó thay vì
giả vờ đối chiếu, và `done` vẫn ghi nhận là đã kiểm — bằng người, không bằng máy.

## Ràng buộc
Không được thành cửa sau. Khai "không có test tự động" mà gate im lặng xanh thì mọi task đều
khai thế. Gate phải:
- nói rõ nó không đo được gì, ngay trong output;
- đòi spec liệt kê **cách kiểm** cho từng ca, không chỉ bỏ trống;
- ghi vào bản ghi gate để `done` và `status` đọc lại được.

Task khai như vậy mà **vẫn** có test mang ID của nó thì đó là mâu thuẫn — báo lỗi, đừng đoán.

## Rủi ro hồi quy
`spec-validator` chặn `testCases.length === 0` ở nhiều nhánh. Nới sai thì mọi spec rỗng đều lọt.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Spec khai `Kiểm bằng: mắt` | Gate pass, nói rõ không đo tự động | P0 |
| H2 | Happy | Bản ghi gate lưu lại điều đó | `done` và `status` đọc được | P0 |
| V1 | Validation | Khai kiểm bằng mắt nhưng bảng ca trống | Vẫn phải liệt kê cách kiểm từng ca | P0 |
| V2 | Validation | Khai kiểm bằng mắt mà suite có test mang ID đó | Báo mâu thuẫn, không đoán | P0 |
| E1 | Error | Giá trị lạ ở `Kiểm bằng:` | Báo giá trị hợp lệ, không im lặng bỏ qua | P1 |
