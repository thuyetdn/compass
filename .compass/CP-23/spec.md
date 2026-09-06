# CP-23: `testReporter` là trường chết, và nó bẫy người dùng
Loại: bug
Phạm vi: lib/config.mjs, commands/status.mjs

## Mục tiêu

Bỏ `testReporter` khỏi `DEFAULT_CONFIG` và khỏi phần kiểm hợp lệ. Config nào còn khai thì vẫn chạy,
nhưng `compass status` nói thẳng trường đó không có tác dụng và chỉ cách đúng: ghép cờ reporter vào
lệnh `test`.

`config.mjs:28-31` kiểm giá trị rồi trả về ở dòng 34. Grep toàn bộ `lib/` và `commands/` cho thấy
không chỗ nào đọc. Người dùng thấy nó trong config sẽ tưởng khai `"testReporter": "tap"` là đủ, rồi
không ghép `--reporter=tap` vào lệnh Vitest, rồi gate `test` báo thiếu ca mà không hiểu vì sao —
output không in tên test thì mọi ID biến mất.

Xong nghĩa là 6 ca dưới đều xanh, và không còn trường nào trong config hứa một việc nó không làm.

## Ràng buộc

Config đã khai `testReporter` phải tiếp tục chạy. Bỏ một trường là thay đổi phá vỡ; người đang dùng
không được chặn giữa chừng chỉ vì Compass dọn nhà.

Không tự đoán runner rồi ghép cờ hộ. Đoán từ chuỗi như `yarn test:ci --shard=2/4` là chỗ dễ sai, và
sai thì hỏng lệnh test đang chạy tốt của người ta.

Hai test hiện có trong `test/config.test.mjs` khoá hành vi cũ — phải đổi chúng, không được xoá suông.

## Rủi ro hồi quy

`loadConfig` là hàm được gọi ở gần như mọi lệnh. Đổi giá trị trả về của nó mà sai thì cả bảy gate
gãy cùng lúc.

`DEFAULT_CONFIG` được `compass init` ghi ra file cho dự án mới. Nếu bỏ trường mà quên chỗ này, dự án
mới vẫn sinh ra config có trường chết.

Config khai `testReporter` sai kiểu (số, mảng) trước đây bị chặn. Sau khi bỏ kiểm, nó phải được lờ đi
chứ không được làm `loadConfig` ném.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-23-H1 | Happy | Config chỉ có `test`, không có `testReporter` | `loadConfig` ok, config trả về không có khoá `testReporter` | P0 |
| CP-23-H2 | Happy | `compass init` ở dự án mới | `config.json` sinh ra không chứa `testReporter` | P0 |
| CP-23-V1 | Validation | Config còn khai `"testReporter": "tap"` | `loadConfig` vẫn ok, không báo lỗi | P0 |
| CP-23-E1 | Error | Config khai `"testReporter": "xml"` — giá trị trước đây bị chặn | `loadConfig` ok, không ném, không báo lỗi | P0 |
| CP-23-E2 | Error | `testReporter` sai kiểu: mảng, số, `null`, object | `loadConfig` ok, không ném với mọi kiểu | P1 |
| CP-23-EC1 | Edge | `compass status` không id, config có khai `testReporter` | In cảnh báo nói trường không có tác dụng và chỉ cách ghép cờ vào lệnh test | P0 |
| CP-23-EC2 | Edge | `compass status` không id, config không khai `testReporter` | Không in cảnh báo nào | P1 |
