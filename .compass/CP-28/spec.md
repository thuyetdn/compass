# CP-28: `.salt` không được che khi dự án mở bằng `investigate`
Loại: bug
Phạm vi: lib/signature.mjs

## Mục tiêu

`getSalt` tự viết `.compass/.gitignore` khi nó sinh salt mới. Hiện chỉ `initCommand` làm việc đó
(`init.mjs:47-50`), nên dự án mở bằng `compass investigate` có `.salt` trần — đã gặp thật ở
`MEI/multi-repo`.

Salt lên git nghĩa là ai clone repo cũng ký được bản ghi gate. Chữ ký hết tác dụng, và mọi lời hứa
"máy phán chứ không phải AI tự khai" sập theo. Comment ở `init.mjs:45` nói đúng điều này, chỉ là nó
đặt ở nhánh không phải nhánh duy nhất.

Đặt ở `getSalt` chứ không thêm vào từng lệnh: nơi nào sinh salt thì nơi đó che. Thêm dòng vào
`investigate.mjs` chỉ vá được lệnh này, còn lệnh thứ ba viết sau vẫn hở.

Xong nghĩa là 6 ca dưới đều xanh.

## Ràng buộc

`.gitignore` đã có thì không đụng. Người dùng có thể đã thêm dòng của họ vào đó.

Không đổi giá trị `getSalt` trả về, và không đổi định dạng file `.salt`. Đổi là mọi chữ ký cũ hỏng.

Ghi `.gitignore` hỏng thì không được làm `getSalt` ném. Ký bản ghi quan trọng hơn che file; thư mục
chỉ đọc thì vẫn phải ký được.

Nhánh `catch` bao quanh lệnh ghi **không đo được bằng test**: muốn tới đó phải qua `existsSync` rồi
mới hỏng ở `writeFileSync`, mà mọi cách làm hỏng đều khiến `existsSync` trả true và chặn trước. Nó
chỉ chạy khi quyền ghi mất giữa hai lệnh. Giữ `try/catch` vì mất quyền là chuyện có thật, nhưng
mutation bỏ nó sẽ sống sót — và sống sót đúng, không phải dấu hiệu test rỗng.

## Rủi ro hồi quy

`getSalt` được gọi ở mọi lần ghi và đọc bản ghi gate. Thêm thao tác ghi file vào đây mà sai thì cả
bảy gate gãy cùng lúc.

`initCommand` đang tạo `.gitignore` và có test canh (`init.test.mjs:90`). Hai chỗ cùng ghi một file
phải không đá nhau.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-28-H1 | Happy | `getSalt` ở dự án chưa có `.salt` lẫn `.gitignore` | Tạo cả hai, `.gitignore` chứa `.salt` | P0 |
| CP-28-H2 | Happy | `compass investigate` ở dự án mới | `.compass/.gitignore` có mặt | P0 |
| CP-28-V1 | Validation | `.gitignore` đã có nội dung riêng của người dùng | Giữ nguyên, không ghi đè | P0 |
| CP-28-E1 | Error | `.gitignore` là thư mục — không che được | `getSalt` vẫn ký và ghi `.salt`, không ném | P0 |
| CP-28-EC1 | Edge | Gọi `getSalt` lần hai khi `.salt` đã có | Không ghi lại `.gitignore`, salt không đổi | P1 |
| CP-28-EC2 | Edge | `compass init` vẫn chạy như cũ | `.gitignore` đúng một dòng `.salt`, không nhân đôi | P1 |
