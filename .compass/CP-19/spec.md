# CP-19: Let a task declare the test command it needs
Loại: fix
Phạm vi: lib/spec-parser.mjs, commands/test.mjs

## Mục tiêu
`config.json` khai đúng một lệnh test cho cả dự án. Compass có hai suite: `npm test` (614 test,
25 giây) và `npm run test:deep` (10 test qua CLI thật, 125 giây).

Hệ quả đo được: CP-9 khai 13 ca, cả 13 nằm ở suite sâu, nên gate `test` chạy `npm test` không
thấy ca nào — báo "không tìm thấy dấu vết" cho 13 ca đang xanh. CP-8 và CP-5 cũng vậy, tổng
20 ca. Ba task không đóng được vì gate chạy sai lệnh.

Đổi lệnh chung sang chạy cả hai thì mọi task phải đợi 2 phút mỗi lần `check`.

Xong nghĩa là: spec khai được lệnh test riêng, và gate dùng lệnh đó.

## Ràng buộc
Không đổi hành vi mặc định. Spec không khai gì thì gate vẫn chạy lệnh trong `config.json`.

`configHash` phải phản ánh lệnh **thật sự chạy**. Nếu không, đổi lệnh trong spec mà `done` vẫn
xanh với bằng chứng cũ.

## Rủi ro hồi quy
`parseSpec` được 15 spec và 40+ test dùng. Thêm trường mà sai thì hỏng cả spec-validator.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Spec khai `Lệnh test:` | Gate chạy đúng lệnh đó | P0 |
| H2 | Happy | Spec không khai | Gate chạy lệnh trong config như cũ | P0 |
| V1 | Validation | `Lệnh test:` để trống | Coi như không khai | P1 |
