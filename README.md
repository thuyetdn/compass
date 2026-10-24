# Compass

AI báo "xong" khi chưa xong. Compass làm cho lời đó phải có bằng chứng.

[**Xem một task chạy thật →**](https://thuyetdn.github.io/compass/) — từ lời nhờ tới lúc gate bắt
được một test còn thiếu, trong khi suite vẫn xanh.

## Vấn đề

Bạn giao việc cho AI. Nó sửa code, chạy vài thứ, rồi nói "đã xong, test pass hết".
Bạn tin. Hai ngày sau phát hiện một nửa test chưa từng chạy, và tính năng cũ đã vỡ
từ lâu.

AI không nói dối. Nó thật sự tin là đã xong — vì không có gì bắt nó chứng minh.

Quy trình viết bằng tài liệu thì AI đọc xong rồi phớt lờ được. Quy trình viết bằng
**exit code** thì không. Compass là quy trình thứ hai: AI viết spec, viết code, viết
test; Compass chạy thật và phán pass hay fail. AI không được tự khai kết quả.

| | AI | Compass |
|---|---|---|
| Viết spec, code, test | ✅ | ❌ |
| Chạy test, đo, kiểm tra | ❌ | ✅ |
| Ghi bằng chứng | ❌ | ✅ |
| Phán pass/fail | ❌ | ✅ |

Bản ghi gate có chữ ký. Sửa tay là lộ.

## Cài

Trong Claude Code, gõ hai dòng:

```
/plugin marketplace add thuyetdn/compass
/plugin install compass@compass
```

Xong. Claude có cả quy trình lẫn công cụ — không phải cài Node package, không phải
thêm gì vào dự án.

## Dùng với Codex

Compass cũng là một plugin Codex, cài giống `superpowers`. Cần Codex CLI
(`npm install -g @openai/codex`), rồi gõ hai dòng:

```bash
codex plugin marketplace add thuyetdn/compass
codex plugin add compass@compass
```

Mở phiên Codex mới là có skill `compass`, kèm sẵn công cụ. Giao việc như bình thường; Codex viết
spec, dừng chờ bạn duyệt, rồi chạy gate. Gate `review` cần một người soi khác: mở một phiên Codex mới
và đưa nó file brief.

### Agent không nạp được skill

Agent nào chỉ đọc `AGENTS.md` thì cài lệnh `compass` (Node 20 trở lên):

```bash
npm install -g github:thuyetdn/compass
```

rồi nối đoạn quy trình mẫu vào cuối `AGENTS.md` của dự án. Đoạn mẫu nằm ở `templates/AGENTS.md`
trong gói vừa cài, viết để nối thêm chứ không ghi đè:

```bash
cat "$(npm root -g)/compass/templates/AGENTS.md" >> AGENTS.md
```

Trên PowerShell:

```powershell
Get-Content -Encoding utf8 "$(npm root -g)\compass\templates\AGENTS.md" | Add-Content -Encoding utf8 AGENTS.md
```

## Dùng

Bạn **không gõ lệnh**. Bạn giao việc như bình thường:

> Thêm nút "Xóa việc đã xong" vào danh sách todo.

Claude tự chạy quy trình:

1. Đọc code vùng sẽ sửa, phân loại task (ở đây là `feature-s`).
2. Viết spec vào `.compass/CP-1/spec.md` — mục tiêu, ràng buộc, rủi ro hồi quy, 13 test case.
3. Chạy gate `spec`, rồi **dừng lại hỏi bạn duyệt**. Đây là điểm dừng duy nhất.
4. Bạn duyệt → Claude viết test trước, thấy đỏ, rồi implement.
5. Chạy `check`: 8 gate, dừng ngay khi có cái đỏ.
6. Gate `review` sinh brief, và Claude giao brief cho một agent khác, không mang lịch sử chat. Agent
   đó soi theo 10 tiêu chí; finding mức Critical hay Major thì Claude sửa rồi đưa soi lại.
7. `done` — chỉ exit 0 mới được báo hoàn thành.

Khi gate đỏ, Claude không được bỏ qua. Nó sửa rồi chạy lại.

```
✗ Gate test FAILED
  Spec khai báo 13 test cases, chỉ tìm thấy 11 đã chạy.
  Có test mang ID này nhưng đều khai là của task khác: S1, EC4
```

Lúc này bạn biết chính xác việc còn thiếu gì — không phải đoán qua lời AI kể.

### Khi chưa biết lỗi ở đâu

Giao việc điều tra thì Claude mở hồ sơ thay vì sửa mò:

> Đơn hàng thỉnh thoảng bị trùng, không rõ vì sao.

Ba luật nó phải theo: không sửa code khi đang điều tra, mỗi giả thuyết nêu cách
kiểm tra **trước** khi kiểm tra, và kết luận phải dẫn về bằng chứng chứ không phải suy luận.
Đóng hồ sơ được thì bẫy vừa gặp tự chép vào `.knowledge/decided/pitfalls.md` — lần sau
không ai sập lại.

## Tám gate

| Gate | Đo gì |
|---|---|
| `spec` | Spec đủ mục, test case có ID và kỳ vọng đo được |
| `knowledge` | Tài liệu máy sinh còn khớp code |
| `secrets` | File `.env` không lọt vào commit |
| `convention` | Quy ước dự án, viết một lần chạy mãi |
| `test` | Suite xanh **và** mọi test ID trong spec đã thực sự chạy |
| `ui` | Số đo CSS thật khớp design contract (±2px) |
| `visual` | So pixel với baseline đã duyệt |
| `review` | Agent khác soi theo 10 tiêu chí (convention, ảnh hưởng chỗ khác, hiệu năng, bảo mật…), phải kết luận cho từng tiêu chí |

Gate `test` không chỉ xem suite xanh. Nó đối chiếu từng ID trong spec với output thật,
nên "13 test case" trong spec mà chỉ viết 11 thì không qua được.

## Soi PR của người khác

Được nhờ review PR của đồng nghiệp thì bảo Claude "soi PR 123". Compass dùng đúng mười tiêu chí của
gate `review`, cho một agent không biết gì về PR soi, rồi ghi `.git/compass/pr/pr-123/report.md` để
dán vào PR:

```bash
compass pr 123 --spec=ticket.md       # PR #123, soi theo ticket; bỏ --spec thì soi theo commit message
```

Nó lấy PR bằng `git fetch` (không cần `gh`), đọc code ở một worktree tạm, và không đụng branch hay
thay đổi chưa commit của bạn. `--run-tests` chạy test của PR, tức là chạy code của người viết PR
trên máy bạn, nên chỉ bật khi bạn muốn. Lệnh test lấy từ `.compass/config.json` đã commit ở nhánh
gốc (không từ PR, không từ bản chưa commit trên máy); cần cài gì
trước (ví dụ `npm ci`) thì khai `"prSetup": "npm ci"` trong đó. Cả `prSetup` lẫn test dùng chung
một hạn `prTestTimeout` giây, mặc định 20 phút; quá hạn thì cả cây tiến trình bị dừng.

## Dự án nhiều repo

Một task hay đụng cả backend lẫn frontend. Để Claude dò giúp:

```bash
compass init --multi
```

Nó đọc từng thư mục con: lockfile quyết trình quản lý gói, cổng khai trong
`vite.config` quyết `devUrl`, repo không có test vẫn được khai với lệnh fail. Chỗ nào
phải đoán thì nó **không ghi** mà hỏi bạn — hai repo cùng tranh một cổng là lúc đó.

Mỗi repo có `.git` riêng nằm dưới gốc cũng được. `review` soi git của từng repo trong
`Phạm vi`, `secrets` quét git của mọi repo trừ repo nằm ngoài gốc Compass bị bỏ qua, và
`compass pr` chạy ngay trong thư mục repo
(`cd be && compass pr 123`). Gốc soi của repo con khai bằng `Gốc soi (be): <sha>`.

## Xem knowledge base

```bash
compass knowledge --page
```

Một file HTML tự chứa, mở bằng trình duyệt, không cần mạng. Tài liệu bạn viết nằm cạnh
component máy quét, và chỗ nào máy đọc prop không chắc thì ghi thẳng "đừng tin" ngay
cạnh component đó.

## Quy ước thành gate

Viết luật một lần vào `.knowledge/decided/conventions.md` — vừa là tài liệu cho người,
vừa là gate cho máy:

    ## Không hardcode mã màu

    Màu phải đi qua CSS variable để đổi theme được.

    ```rule
    id: no-hex-color
    type: forbid-pattern
    pattern: "#[0-9a-fA-F]{3,8}"
    scope: src/**/*.jsx
    severity: error
    ```

Không có file này thì gate pass và nói rõ là chưa có luật nào.

Chưa viết được thì để Compass soạn nháp: `compass convention --draft` đọc `.editorconfig`, Prettier,
ESLint, `tsconfig.json` và đếm trên chính code (thụt lề, nháy, dấu chấm phẩy, tên file, tên file
test), rồi ghi `.compass/conventions-draft.md`. Mỗi convention kèm bằng chứng, kiểu "38 / 40 file".
Luật máy chạy được chỉ được đề xuất khi code hôm nay không phá chỗ nào. Bạn duyệt, sửa, rồi tự chuyển
nó vào `.knowledge/decided/`; Compass không bao giờ tự ghi vào đó.

Bản nháp mang dấu nguồn, nên về sau Compass tự nhận ra khi convention đã cũ: một file config đổi, hay
code đã trôi khỏi một convention từng đếm được. Việc kiểm tra chạy ở mọi `init`, mọi `check` và trong
mọi brief soi code, không cần ai bảo. Thấy `init` hay `check` báo, Claude soạn lại bản nháp và đưa
bạn duyệt chỗ khác; trong brief thì đó chỉ là lưu ý cho người soi.

## Gõ lệnh trực tiếp

Plugin đã đủ để Claude làm việc. Muốn tự gõ trong terminal thì cài thêm:

```bash
npm install -g .
```

```bash
compass --version                     # in phiên bản đang cài
compass status                        # đọc config, kiểm tra trước khi bắt đầu
compass init T-001 --type=feature-s   # tạo spec skeleton
compass spec T-001                    # gate: spec hợp lệ?
compass check T-001                   # chạy mọi gate áp dụng
compass done T-001                    # cổng cuối
compass convention --draft            # soạn nháp conventions.md từ config và code
compass pr 123                        # soi PR của người khác
```

Không cài cũng chạy được từ thư mục repo: `node cli.mjs status`.

## Cấu hình

`.compass/config.json` tối thiểu một dòng:

```json
{
  "test": "npm test"
}
```

Compass spawn lệnh đó và bắt exit code. Reporter phải in tên từng test, vì gate tìm
test ID trong output:

| Runner | Lệnh |
|---|---|
| `node --test` | chạy sẵn |
| Vitest | `vitest run --reporter=tap` |
| Jest | `jest --verbose` |

### Khi một ID khớp nhiều test

Spec nào cũng dùng `H1`, `V1`, `EC1`. Nhiều task chạy chung một suite thì các ID đó trùng
nhau, và gate không biết test nào của task nào — task chưa viết dòng test nào vẫn qua được.

Nên gate đỏ khi một ID khớp từ hai test khác nhau trở lên:

```
✗ Gate test FAILED
  Khớp nhiều test khác nhau, không rõ cái nào là của task này: H1
        H1 thêm một việc
        H1 xoá một việc
```

Đường thoát: đặt tên test kèm task id.

```js
test('T-12-H1 thêm một việc', ...)   // gate nhận ra đây là test của T-12
```

Nhận cả `T-12-H1`, `T-12: H1`, `[T-12] H1`.

Trong suite chung với task khác, đặt tên kèm task id cho mọi test của task, không chỉ test
bị đụng. Luật: task đã đặt tên kèm task id thì test tên trần không được tính. Có `T-12-H1`
pass rồi thì một test `S1 …` trần không còn đứng thay cho S1 của T-12, dù chỉ có mình nó
mang S1:

```
✗ Gate test FAILED
  Spec khai báo 13 test cases, chỉ tìm thấy 12 đã chạy.
  Task này đặt tên test kèm "T-12-", nên test tên trần không được tính: S1
        S1 hiện thẻ script dạng chữ
```

Task chưa đặt tên kèm task id cho test nào thì gate không có gì để dựa vào, và vẫn tính một
test trần duy nhất, kể cả khi đó là test của task khác.

## Trạng thái

Tám gate: `spec`, `knowledge`, `secrets`, `convention`, `test`, `ui`, `visual`, `review`.

Hai loại việc: BUILD (`init` → `spec` → `check` → `done`) và điều tra (`investigate` → `--close`).

## Phát triển

```bash
npm test           # suite chính, 1692 test, ~100 giây
npm run test:deep  # 17 test qua CLI thật trên examples/todo, ~115 giây
```

Suite sâu cần Playwright ở `examples/todo`; thiếu thì nó skip kèm hướng dẫn cài, không fail.

Compass tự chạy gate của chính nó: `.knowledge/decided/conventions.md` của repo này có 4
luật, và zero runtime dependency là một trong số đó — toàn bộ code chỉ dùng Node built-in.

## Đọc thêm

- [Hướng dẫn đầy đủ](docs/huong-dan.md) — dành cho người mới
- [skills/compass/SKILL.md](skills/compass/SKILL.md) — quy trình AI phải theo, đọc để biết Claude đang làm gì
- [examples/todo](examples/todo/) — todo list React, task `feature-s` 13 test case

MIT.
