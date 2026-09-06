# CP-25: Cài đặt đứt khi đổi tên thư mục, không có cách chẩn đoán
Loại: fix
Phạm vi: SKILL.md
Kiểm bằng: mắt

## Mục tiêu

Mục "Trước tiên: có `compass` chưa?" thêm một dòng cho ca lệnh **có nhưng hỏng**.

`npm install -g <repo>` tạo symlink từ `node_modules/compass` về thư mục repo. Đổi tên hay chuyển
thư mục repo là symlink đứt, và `compass` ném `MODULE_NOT_FOUND` trỏ vào
`node_modules\compass\cli.mjs` — không nói symlink trỏ đi đâu, cũng không nói vì sao. Người gặp phải
đọc shim, `readlink`, rồi tự suy ra; mất bốn lệnh.

Skill hiện chỉ có "Không thấy lệnh → cài một lần". Đó là ca khác. Ca này lệnh **có**, gõ ra stack
trace, và người dùng không có lý do nào để nghĩ tới symlink.

Xong nghĩa là hai ca dưới đều đạt.

## Ràng buộc

Một hai dòng, không hơn. Đây là mục đầu tiên agent đọc mỗi phiên — mọi dòng thêm vào đây bị đọc lại ở
mọi task, kể cả task không dính cài đặt.

Không đưa lệnh `readlink`. Cách sửa là cài lại, không phải chẩn đoán từng bước.

## Rủi ro hồi quy

Mục này là thứ đầu tiên agent đọc. Viết rối thì agent chạy `npm install -g` khi không cần, hoặc tệ
hơn, tưởng Compass hỏng rồi bỏ qua cả quy trình.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-25-H1 | Happy | Đọc mục đầu sau khi sửa | Nói rõ `MODULE_NOT_FOUND` nghĩa là symlink đứt, và cách sửa là chạy lại `npm install -g .` từ repo | P0 |
| CP-25-EC1 | Edge | So với ca "không thấy lệnh" đã có | Hai ca phân biệt được, không lẫn thành một | P1 |
