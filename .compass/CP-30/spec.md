# CP-30: Kết quả query không có chỗ lưu, và lưu vào là đẩy dữ liệu khách lên git
Loại: bug
Phạm vi: lib/signature.mjs, SKILL.md

## Mục tiêu

`.compass/.gitignore` che thêm `*/data/`, và `SKILL.md` nói rõ kết quả query lưu ở
`.compass/<id>/data/`.

Điều tra thật ở `MEI/multi-repo` phải chạy query production — `.compass/scripts/inv1-prod-queries.sql`
đã nằm đó. Câu query được lưu, kết quả chạy nó thì không có chỗ. Paste vào chat thì phiên đóng là
mất, và hồ sơ điều tra dẫn "query trả về 47 dòng" mà không ai kiểm lại được. Đó là lời khai, không
phải bằng chứng — đúng thứ Compass sinh ra để chống.

Nhưng query production trả dữ liệu thật của khách: email, tên, có khi hơn. Lưu vào `.compass/` mà
thư mục đó lên git là đẩy dữ liệu khách lên repo. `.gitignore` hiện chỉ che `.salt`.

Nên `data/` phải được che sẵn, không đợi người dùng nhớ.

Xong nghĩa là 6 ca dưới đều xanh.

## Ràng buộc

`.gitignore` đã có thì vẫn không đụng — giữ nguyên luật CP-28. Người dùng có thể đã sửa nó.

`output/` **không** được che. Sản phẩm là thứ người dùng mang đi dùng và có khi muốn commit; chỉ
`data/` là chỗ chứa dữ liệu thô.

`SKILL.md` còn 2 dòng ngân sách (478/480). Phải cắt chỗ khác trước khi thêm.

## Rủi ro hồi quy

`cheSalt` chạy ở mọi lần sinh salt, tức gần như mọi dự án Compass. Viết sai nội dung `.gitignore` thì
hoặc lộ `.salt` (mất chữ ký), hoặc che nhầm `evidence/` (mất bằng chứng khỏi git, không ai review
được).

Dự án đã có `.gitignore` chỉ chứa `.salt` — như MEI hiện nay — sẽ không được cập nhật, vì luật
"đã có thì không đụng". Đó là đánh đổi có chủ ý, nhưng phải nói ra trong SKILL.md để người dùng tự
thêm.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-30-H1 | Happy | `getSalt` ở dự án mới | `.gitignore` có cả `.salt` và mẫu che `data/` | P0 |
| CP-30-H2 | Happy | Đặt file trong `.compass/INV-1/data/` rồi hỏi git | git bỏ qua file đó | P0 |
| CP-30-V1 | Validation | File trong `.compass/INV-1/output/` | git **không** bỏ qua — sản phẩm phải commit được | P0 |
| CP-30-E1 | Error | `.gitignore` đã có sẵn nội dung | Giữ nguyên, không thêm dòng | P0 |
| CP-30-EC1 | Edge | File trong `.compass/INV-1/evidence/` | git không bỏ qua — bằng chứng phải review được | P0 |
| CP-30-EC2 | Edge | `.gitignore` do `getSalt` viết ra, đưa cho git thật | git bỏ qua `data/`, không bỏ qua `output/` và `evidence/` | P1 |
