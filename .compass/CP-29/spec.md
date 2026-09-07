# CP-29: Không có luật về chỗ để sản phẩm, nên nó rơi vào thư mục Windows tự xoá
Loại: fix
Phạm vi: SKILL.md
Kiểm bằng: mắt

## Mục tiêu

`SKILL.md` nói rõ file do task sinh ra cho người dùng thì để ở `.compass/<id>/output/`.

Một điều tra ở `MEI/multi-repo` re-encode hai video (4.85MB và 6.63MB) cùng ba ảnh frame, rồi để tất
cả trong scratchpad của phiên — thư mục tạm Windows xoá bất cứ lúc nào. Người dùng phải hỏi mới biết,
và phải tự copy ra chỗ an toàn.

Agent làm vậy không sai luật nào, vì không có luật nào. Nó được dặn dùng scratchpad cho file tạm, và
video re-encode nghe giống file sinh ra trong lúc làm việc. Nhưng đó là **sản phẩm** — thứ người dùng
cần giữ.

Compass đã có chỗ cho bằng chứng (`evidence/`, máy ghi, người không sửa) và chỗ cho script
(`scripts/`). Thiếu chỗ cho sản phẩm.

Xong nghĩa là ba ca dưới đều đạt và `SKILL.md` vẫn dưới 480 dòng.

## Ràng buộc

Ngân sách 480 dòng, hiện 476 — còn 4 dòng. Phải cắt chỗ khác hoặc viết cực gọn.

Không cấm scratchpad. File tạm thật — log trung gian, script thử một lần — vẫn để đó là đúng. Luật
phải phân biệt được hai loại, nếu không agent sẽ đẩy cả rác vào `output/`.

Không đụng `evidence/`. Đó là vùng của máy, có chữ ký; sản phẩm của người phải nằm chỗ khác.

## Rủi ro hồi quy

`SKILL.md` là file agent đọc mỗi phiên. Thêm dòng ở đây là lấy ngân sách ngữ cảnh của mọi task sau,
kể cả task không sinh file nào.

Viết mơ hồ thì agent đẩy file tạm vào `output/`, và thư mục task phình lên vì rác.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| CP-29-H1 | Happy | Đọc luật mới | Nói rõ `.compass/<id>/output/` là chỗ để sản phẩm cho người dùng | P0 |
| CP-29-EC1 | Edge | Phân biệt với scratchpad | Nói được cái gì vào `output/`, cái gì vẫn ở scratchpad | P0 |
| CP-29-EC2 | Edge | Đếm dòng `SKILL.md` | Dưới 480 | P0 |
