# CP-13: Run the gates in each repo a task touches
Loại: feature-m
Phạm vi: commands/check.mjs, commands/test.mjs, commands/convention.mjs, commands/ui.mjs, commands/visual.mjs, commands/done.mjs, lib/gate-store.mjs

## Mục tiêu
CP-12 đọc được khai báo `repos` trong config và biết task đụng repo nào, nhưng `check` không
dùng thông tin đó — nó vẫn chạy mọi gate ở thư mục gốc. Task sửa API backend rồi sửa màn hình
frontend chỉ được kiểm một nửa, và nửa nào thì tùy lệnh test ở gốc trỏ vào đâu.

Đây là phần cuối còn dở của lộ trình. Để nguyên thì `resolveRepos` là code chết.

Xong nghĩa là: `check` chạy gate ở đúng từng repo mà `Phạm vi` trong spec chỉ tới, gộp kết
quả, và `done` biết mọi repo đều đã qua.

## Ràng buộc
**Chạy tuần tự, không song song.** Hai dev server tranh cổng là lỗi chập chờn đã tốn nhiều giờ
ở CP-8; tiết kiệm vài giây không đáng đổi lấy chuyện đó.

Gate `ui` và `visual` chỉ chạy ở repo có `devUrl`. Backend không khai thì bỏ qua cho repo đó,
không tính là fail — không thêm quy ước đặt tên file nào phải nhớ.

Gate `spec`, `knowledge`, `review` chạy một lần ở gốc: chúng đọc spec, tài liệu và diff — đều
là thứ của cả task, không của riêng repo nào.

Dự án một repo phải chạy y như cũ. Không có `repos` trong config thì mọi hành vi giữ nguyên.

## Rủi ro hồi quy
`writeGate` hiện ghi một bản ghi cho mỗi gate. Chạy `test` ở hai repo sẽ ghi đè lẫn nhau, và
`done` chỉ thấy repo cuối — mất bằng chứng của repo kia mà không ai biết.

`sourceHash` hash cả cây từ gốc, nên nó phủ mọi repo. Hai repo cùng ghi `sourceHash` giống
nhau là đúng, nhưng phải kiểm chứ không đoán.

Mọi test đang gọi gate với `cwd: root` sẽ đi qua đường mới. Nếu đổi chữ ký sai thì đỏ hàng
loạt — đó là dấu hiệu tốt, không phải hỏng.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Một repo, không khai repos | Chạy y như trước, không đổi gì | P0 |
| H2 | Happy | Hai repo, phạm vi đụng cả hai | Gate test chạy ở cả hai | P0 |
| H3 | Happy | Hai repo, phạm vi chỉ đụng một | Chỉ repo đó chạy | P0 |
| H4 | Happy | Output nêu rõ repo nào | Mỗi dòng kết quả có tên repo | P0 |
| H5 | Happy | Cả hai repo xanh | check exit 0 | P0 |
| H6 | Happy | done sau check đa repo | Exit 0, thấy đủ bản ghi | P0 |
| V1 | Validation | Một repo đỏ, một xanh | check fail, nêu đúng repo đỏ | P0 |
| V2 | Validation | Phạm vi không khớp repo nào | Báo rõ, không âm thầm chạy hết | P0 |
| V3 | Validation | Repo khai devUrl, repo kia không | ui chỉ chạy ở repo có devUrl | P0 |
| V4 | Validation | Config repos sai định dạng | Báo lỗi rõ, không chạy gate nào | P0 |
| E1 | Error | Lệnh test của một repo không tồn tại | Báo rõ repo nào, không crash | P0 |
| E2 | Error | Repo bị xóa giữa chừng | Báo rõ, không crash | P1 |
| EC1 | Edge | Hai repo cùng tên gate ghi bản ghi | Không ghi đè, done thấy cả hai | P0 |
| EC2 | Edge | Repo đơn vẫn ghi bản ghi như cũ | Bản ghi cũ vẫn đọc được | P0 |
| EC3 | Edge | Không repo nào có devUrl | ui và visual bỏ qua, không fail | P0 |
| EC4 | Edge | Chạy check hai lần liên tiếp | Lần hai vẫn xanh, không sót tiến trình | P0 |
| S1 | Security | Bản ghi của repo A không dùng cho repo B | Chữ ký buộc theo repo | P0 |
| S2 | Security | Một repo pass, sửa code repo kia | done chặn | P0 |
| P1 | Performance | Hai repo chạy tuần tự | Không có hai dev server sống cùng lúc | P0 |
| P2 | Performance | Repo đơn không chậm thêm | Thời gian check không tăng đáng kể | P1 |
| P3 | Performance | Dừng ngay khi repo đầu fail | Không chạy tiếp repo sau | P1 |
