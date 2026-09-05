# CP-12: Layered config so one Compass root can serve several repos
Loại: feature-s
Phạm vi: lib/config.mjs, lib/repos.mjs, commands/status.mjs

## Mục tiêu
Một task thường đụng nhiều repo: sửa API ở backend rồi sửa màn hình gọi nó ở frontend. Hiện
Compass chỉ biết một `config.json` với một lệnh `test` — muốn chạy cả hai thì phải cài Compass
hai lần, và không có chỗ nào nói chúng thuộc cùng một task.

Thiết kế §10 giải bằng cách gộp theo tầng: `.compass/config.json` ở thư mục cha khai từng repo
con, mỗi repo đè lên phần chung. Không symlink, không script setup.

Xong nghĩa là: `config.json` khai được `repos`; `resolveRepos` trả về danh sách repo kèm cấu
hình đã gộp; `Phạm vi` trong spec quyết định repo nào áp dụng; `status` cho thấy điều đó.

## Ràng buộc
Zero runtime dependency. Không phá config một repo đang chạy — thiếu `repos` thì mọi thứ giữ
nguyên hành vi cũ.

Repo con đè lên chung theo từng trường, không thay cả khối. Khai `test` ở repo con mà không
khai `dev` thì `dev` vẫn lấy từ chung — giống cách ESLint gộp config.

Đường dẫn repo phải nằm trong thư mục gốc. Trỏ ra ngoài bằng `../` là lỗi cấu hình.

Task này **không** đổi cách gate chạy. Việc chạy gate ở nhiều repo là bước sau; đây mới là
phần phân giải cấu hình, vì làm cả hai một lúc thì không rà nổi.

## Rủi ro hồi quy
`loadConfig` đang được mọi gate dùng. Thêm trường mới mà làm sai validate hiện có thì mọi gate
đỏ — phải giữ nguyên đường đi một repo.

`findRoot` đi ngược lên tìm `.compass/config.json` đầu tiên. Repo con nằm trong thư mục cha có
config sẽ tìm thấy config cha, không phải của mình — cần rõ đó là hành vi đúng hay bẫy.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Config không khai repos | Trả một repo ảo trỏ về gốc | P0 |
| H2 | Happy | Config khai hai repo | Trả đúng hai, mỗi cái có tên và đường dẫn | P0 |
| H3 | Happy | Repo con đè trường test | Lấy của con, các trường khác lấy chung | P0 |
| H4 | Happy | Repo con không khai gì | Kế thừa toàn bộ phần chung | P0 |
| H5 | Happy | Phạm vi spec khớp một repo | Chỉ repo đó áp dụng | P0 |
| H6 | Happy | Phạm vi đụng hai repo | Cả hai áp dụng | P0 |
| V1 | Validation | repos không phải object | Báo lỗi rõ | P0 |
| V2 | Validation | Repo thiếu lệnh test | Báo lỗi nêu tên repo | P0 |
| V3 | Validation | Thư mục repo không tồn tại | Báo lỗi nêu đường dẫn | P0 |
| E1 | Error | Phạm vi không khớp repo nào | Báo rõ, không im lặng bỏ qua | P0 |
| EC1 | Edge | Một repo tên trùng thư mục con của repo khác | Khớp theo tiền tố đúng, không nhầm | P0 |
| EC2 | Edge | Phạm vi ghi nhiều đường dẫn cách nhau bằng dấu phẩy | Tách đúng | P0 |
| EC3 | Edge | Repo khai đường dẫn "." | Trỏ về chính gốc, hợp lệ | P1 |
| S1 | Security | Đường dẫn repo chứa ../ | Bị chặn, không thoát gốc | P0 |
