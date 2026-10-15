# Hướng dẫn dùng Compass

Compass buộc AI chứng minh việc đã xong bằng lệnh chạy thật, thay vì tự báo "xong". AI viết spec,
code và test; Compass chạy test, đối chiếu, ghi bằng chứng có chữ ký, và chỉ nó được phán pass hay
fail.

Bài này dành cho dev trong team dùng thử và đánh giá. Đọc xong bạn cài được, chạy được một task tới
`done`, và biết chính xác một `done` xanh nói lên điều gì, không nói lên điều gì.

Xem trước 3 phút: [video demo](demo/compass-demo.webm), quay từ lệnh chạy thật trên
`examples/todo`. Đoạn AI viết spec và code trong Claude Code hiện thành thẻ chú thích, không phải
đoạn chat dựng lại.

## Cài đặt

Cần Node 20 trở lên và git. Compass không có dependency nào.

Trong Claude Code, cài plugin. AI sẽ có cả quy trình (skill `compass`) lẫn công cụ:

```
/plugin marketplace add thuyetdn/compass
/plugin install compass@compass
```

Repo đang để private, nên máy cài phải có quyền đọc repo trên GitHub.

Muốn gõ `compass` trong terminal thì cài thêm từ thư mục repo:

```bash
npm install -g .
```

Không cài thì gõ `node <thư mục repo>/cli.mjs <lệnh>`, kết quả như nhau.

Lệnh test của dự án khai trong `.compass/config.json`. `compass init` tạo file này với
`"test": "npm test"`; sửa lại nếu dự án chạy test bằng lệnh khác. Reporter phải in tên **từng
test**, vì Compass đối chiếu test ID theo tên:

| Runner | Lệnh test |
|---|---|
| `node --test` | chạy sẵn |
| Vitest | `vitest run --reporter=tap` |
| Jest | `jest --verbose` |

## Task đầu tiên

Thử trên dự án mẫu trước khi đem vào dự án thật:

```bash
cd examples/todo
npm install
npx playwright install chromium     # gate ui và visual cần
node ../../cli.mjs check TD-001
node ../../cli.mjs done TD-001
```

`TD-001` là task `feature-s` đã viết sẵn spec, code và 13 test. Đọc
[spec của nó](../examples/todo/.compass/TD-001/spec.md) để thấy một spec đạt chuẩn trông thế nào.

Trên dự án thật, mỗi task đi qua bốn lệnh:

```bash
compass init T-12 --type=bug     # tạo khung spec ở .compass/T-12/spec.md
compass spec T-12                # spec hợp lệ chưa? — DỪNG, chờ người duyệt
compass check T-12               # chạy mọi gate của loại task này
compass done T-12                # cổng cuối, đọc lại toàn bộ bằng chứng
```

Bạn không phải gõ những lệnh này nếu làm việc qua Claude Code: skill hướng dẫn AI gõ, và AI dừng sau
`compass spec` để chờ bạn duyệt. Việc của bạn là đọc spec, nhất là hai mục **Rủi ro hồi quy** và
bảng **Test cases**, rồi nói "duyệt" hay chỉ chỗ cần sửa.

Loại task quyết định số test tối thiểu và gate nào chạy:

| Loại | Dùng khi | Test tối thiểu | Gate |
|---|---|---|---|
| `fix` | typo, 1–2 dòng, không đổi hành vi | 2 | spec, knowledge, secrets, test |
| `bug` | sửa lỗi có nguyên nhân rõ | 6 | như `fix` |
| `feature-s` | tính năng nhỏ, 1 module | 13 | + convention, ui, visual |
| `feature-m` | tính năng vừa, nhiều module | 21 | + review |
| `feature-l` | tính năng lớn, nhiều repo | 30 | như `feature-m` |

Phân vân giữa hai loại thì chọn loại nặng hơn.

Mỗi test case trong spec có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`) và tên test phải bắt đầu bằng ID
đó. Nhiều task dùng chung một test suite thì `H1` trùng nhau, nên đặt kèm task id:
`test('T-12-H1 lọc theo quốc gia', …)`. Đặt kèm cho mọi test của task, không chỉ test bị trùng:
task đã đặt tên kèm task id thì test tên trần không được tính, nên một test `S1 …` trần sẽ không
được đếm là S1 của T-12 và gate đỏ, bảo đổi tên thành `T-12-S1 …`.

Mỗi tên test chỉ mang đúng một ID của spec. Tên `T-12-H1 xử lý giống H2` nhắc tới hai ID, nên gate
không biết dòng đó là của case nào và không tính H1.

## Các gate

`check` chạy từ gate rẻ tới gate đắt và dừng ở gate đỏ đầu tiên.

**`spec`** đỏ khi spec thiếu mục, thiếu lớp test bắt buộc, hoặc kỳ vọng không đo được.

**`knowledge`** đỏ khi tài liệu máy sinh trong `.knowledge/derived/` cũ hơn code. Chạy
`compass knowledge --sync` để sinh lại. Prop nào máy không đọc chắc thì đánh dấu
`confident: false`; đừng tin phần đó.

**`secrets`** chạy cho mọi loại task. Nó đỏ khi file `.env` nằm trong diff hoặc đã bị git theo dõi,
khi thư mục có `.env` mà `.gitignore` chưa che, hoặc khi code mới đọc `.env` mà spec không khai dòng
`Dùng .env: <lý do>`. Gate không bao giờ mở file `.env`.

**`convention`** chạy các luật viết trong `.knowledge/decided/conventions.md`, mỗi luật là một khối
` ```rule ` với regex cấm. Chưa có file đó thì gate xanh và nói rõ là chưa có luật nào.

**`test`** chạy lệnh test rồi đối chiếu: mọi ID trong spec phải xuất hiện trên một dòng **pass**.
Thấy ID trên dòng fail hay skip, hay một ID khớp hai test khác nhau, đều là đỏ, và gate nói rõ trường
hợp nào để bạn biết phải làm gì.

**`ui`** mở trang bằng Playwright, đọc `getComputedStyle` rồi so với số thiết kế khai trong
`.compass/<id>/design-contract.json`, có dung sai (padding ±2px, màu khớp tuyệt đối).

**`visual`** chụp màn hình và so pixel với baseline. Lần đầu nó chỉ tạo baseline và nói rõ là chưa
so gì; xem ảnh, thấy đúng thì commit.

**`review`** sinh một brief chỉ gồm spec và diff, đưa cho một agent **khác** soi. Agent đó ghi
`findings.json`; finding mức `Critical` hay `Major` chặn gate. Sửa code sau khi soi thì gate tự mở
lại.

Hai gate `ui` và `visual` cần `dev` và `devUrl` trong config. Repo không khai `devUrl` (backend
chẳng hạn) thì `check` ghi bản ghi bỏ qua thay vì chạy.

Chi tiết từng gate, kể cả cách khai `Gốc soi:` để thu hẹp phạm vi review, nằm trong
[SKILL.md](../skills/compass/SKILL.md).

## Compass chứng minh gì, không chứng minh gì

Một `done` xanh chứng minh bốn điều:

- Mọi test ID trong spec đã chạy và **pass**, trên chính lệnh test khai trong config.
- Bằng chứng nói về bản code hiện tại. `done` băm lại code, spec và config rồi so với lúc gate chạy;
  sửa code sau khi gate xanh thì `done` đỏ và bảo chạy lại `check`.
- Bản ghi gate không bị sửa tay, chuyển sang gate khác hay chép từ task khác. Mỗi bản ghi ký bằng
  một salt chỉ nằm trên máy bạn.
- Mọi gate mà loại task đòi hỏi đều đã chạy và xanh, hoặc được bỏ qua với lý do ghi rõ.

Nó **không** chứng minh:

- **Test đo đúng thứ cần đo.** Spec nói "không còn file rác" mà test chỉ kiểm tra hàm dọn chạy
  được thì mọi gate vẫn xanh trong khi rác còn nguyên. Sau khi `done` xanh, tự kiểm tra mục tiêu gốc
  một lần.
- **Người đã duyệt spec.** Điểm dừng sau `compass spec` là quy trình AI phải theo, không phải bản
  ghi. Compass không lưu ai duyệt, lúc nào.
- **Lệnh test là test thật.** Ai sửa `config.json` trỏ sang một lệnh in ra TAP giả *trước* khi gate
  chạy thì Compass không phát hiện được. Nó chỉ bắt được lệnh đổi *sau* khi gate chạy.
- **Reviewer soi kỹ.** Gate `review` kiểm tra findings có đúng định dạng và đúng bản code, không
  kiểm tra agent soi có tốt không.

Ranh giới chung: Compass chặn sai sót vô tình, không chặn được người cố ý gian lận.

## Giới hạn

- **Quét bằng regex, không phân tích cú pháp.** `knowledge`, `convention` và `secrets` đọc text theo
  dòng. Chúng bắt trường hợp thường gặp, và gọi tên thứ không phân loại được thay vì đoán, nhưng
  không phải lưới kín. Ví dụ: một đường dẫn `.env` ghép động trong biến thì `secrets` không thấy.
- **`visual` đỏ vì font.** Chữ render khác nhau giữa các máy và CI làm lệch vài pixel. Ngưỡng
  `visualThreshold` (mặc định 0.1%) giảm bớt, không chữa được.
- **Nhiều repo.** `convention`, `ui`, `visual` đo từng repo và ghi bằng chứng riêng cho từng repo;
  `test` gộp mọi repo vào một bản ghi. Chưa có lệnh dựng config nhiều repo, phải viết tay theo mục
  "Nhiều repo" trong SKILL.md, rồi chạy `compass status` để kiểm tra Compass đọc ra gì.
- **Worktree mồ côi bị quét như code thường.** Worktree của agent (`.claude/worktrees/` hay chỗ khác,
  miễn tạo bằng `git worktree add`) được nhận ra và bỏ qua, không cần xoá trước khi chạy gate. Nhưng
  xoá thư mục quản trị trong `.git/worktrees/` mà để lại thư mục worktree thì Compass, như git, coi
  nó là file bình thường và quét hết. Dọn bằng `git worktree remove`, đừng xoá tay.
- **`review` cần một agent khác.** Compass sinh brief nhưng không tự gọi agent; bạn hoặc AI chính phải
  giao brief cho một agent mới, không mang theo lịch sử chat.
- **`review` từ chối diff quá 2MB.** Không ai đọc hết chừng đó. Chia task nhỏ ra.

## Góp ý

Bạn dùng thử thì ghi lại ba thứ, mỗi thứ kèm task id và output của lệnh:

- Gate đỏ mà bạn thấy oan, hay xanh mà bạn thấy lẽ ra phải đỏ.
- Chỗ phải đoán vì thông báo của Compass không nói rõ phải làm gì.
- Bước nào làm chậm bạn mà không bắt được lỗi nào.

Gửi qua issue trên repo `thuyetdn/compass`. Output dán nguyên văn, đừng tóm tắt: đọc thông báo sai
chỗ nào, Compass sửa đúng chỗ đó.
