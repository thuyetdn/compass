# CP-22: `compass status` không kiểm được config vì đòi task id
Loại: bug
Phạm vi: commands/status.mjs

## Mục tiêu

`compass status` chạy được khi không có task id, và in ra danh sách repo Compass đọc được từ
`config.json` — tên, thư mục, lệnh test, `devUrl` nếu có.

Hiện tại `status.mjs:14` chặn ngay khi thiếu `taskId`, mà phần đọc repo nằm sau đó. Muốn kiểm config
thì phải có task, muốn có task thì phải viết spec, mà viết spec thì cần biết config đúng chưa. Vòng
tròn không lối ra — người dùng nhận "Thiếu task id", tưởng mình gõ sai, rồi bỏ luôn bước kiểm.

Xong nghĩa là 6 ca dưới đều xanh, và `compass status` không đối số in được cấu hình repo.

## Ràng buộc

`compass status <id>` giữ nguyên hành vi cũ — không đổi định dạng, không bớt thông tin. Đây là thêm
một chế độ, không phải sửa chế độ đang có.

Không đọc `gate.json` ở chế độ không id: chưa có task thì không có sổ để đọc.

## Rủi ro hồi quy

`compass status <id>` đang được dùng để xem gate nào xanh đỏ. Nếu nhánh mới bắt nhầm cả trường hợp
có id, người dùng mất hẳn cách xem tình hình task.

`config.json` hỏng hoặc thiếu là chuyện thường lúc mới dựng. Nhánh mới phải báo lỗi đọc được thay vì
ném stack trace — chính lúc đó người dùng cần thông tin nhất.

Dự án một repo không khai `repos` cũng phải chạy được, không được đòi phải có `repos` mới in.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-22-H1 | Happy | `status` không id, config khai 3 repo | Liệt kê đủ 3 tên kèm lệnh test từng repo | P0 |
| CP-22-H2 | Happy | `status` không id, dự án một repo không khai `repos` | Vẫn in cấu hình, không đòi `repos` | P0 |
| CP-22-V1 | Validation | `status <id>` với task có thật | Giữ nguyên đầu ra cũ — gate và trạng thái | P0 |
| CP-22-E1 | Error | `status` không id, chưa có `.compass/config.json` | Nói không tìm thấy config, mã thoát 2, không stack trace | P0 |
| CP-22-E2 | Error | `status` không id, `repos` khai repo trỏ vào thư mục không tồn tại | In lỗi cấu hình nêu tên repo, không ném | P1 |
| CP-22-EC1 | Edge | Repo khai `devUrl` và repo không khai, trong cùng config | Chỉ repo có khai mới hiện `devUrl` | P1 |
