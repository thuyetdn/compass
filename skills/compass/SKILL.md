---
name: compass
description: "Quy trình phát triển dựa trên bằng chứng: viết spec trước khi code và sử dụng các gate được chạy thực tế để xác minh kết quả, thay vì để AI tự kết luận rằng task đã hoàn thành. Áp dụng cho mọi task lập trình như phát triển tính năng, sửa bug hoặc refactor, cũng như khi người dùng nhắc đến Compass, gate, spec-first, hoặc đặt câu hỏi về trường hợp AI báo đã xong nhưng thực tế vẫn chưa hoàn tất."
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

## Gõ lệnh thế nào

Skill này đi kèm chính công cụ nó nói tới, nên không phải cài gì thêm:

```
node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" <lệnh>
```

Mọi lệnh bên dưới viết tắt là `compass <lệnh>` cho gọn. Gõ thì thay bằng dòng trên.

Muốn gõ `compass` trực tiếp trong terminal thì cài một lần từ repo — `npm install -g .` — nhưng
skill không cần bước đó.

Lệnh ném `MODULE_NOT_FOUND` mà bạn đã cài `-g`: symlink đứt vì repo đổi tên hoặc chuyển chỗ. Chạy
lại `npm install -g .` từ repo, đừng đi chẩn đoán từng bước.

## Luật tối cao

1. **Không bao giờ tự tuyên bố kết quả.** Chỉ `compass` mới phán pass/fail.
2. **Không sửa gì trong `evidence/`.** Đó là vùng của máy. File làm ra cho người dùng — video, ảnh,
   bản export — để ở `.compass/<id>/output/`; scratchpad là thư mục tạm của phiên, hệ điều hành xoá
   lúc nào không báo, nên chỉ để thứ vứt đi được ở đó.
3. **Spec trước code.** Không có spec đã duyệt thì không gõ dòng code nào.
4. **Nghi ngờ độ lớn task → nâng cấp.** Không bao giờ hạ cấp.
5. **Knowledge base mâu thuẫn với code → DỪNG, hỏi người.** Không tự chọn bên.

## Ngôn ngữ

- Đối thoại, giải thích, báo cáo với người → **tiếng của người đọc**
- Spec, test name, commit message, code comment → **tiếng Anh**

### Bốn nguyên tắc — đúng với mọi ngôn ngữ

Người đọc đang mệt, đang vội, và đã biết code.

**1. Kết luận trước, bối cảnh sau.** Họ quyết định đọc tiếp hay không sau câu đầu tiên: "Parser xếp
sai một test đã pass", không phải "tôi đã tiến hành phân tích và nhận thấy...".

**2. Nói chuyện gì xảy ra, đừng tả máy chạy ra sao.** Họ mở được file; họ cần biết **hậu quả**.

> ❌ Compass tìm test bằng cách đọc chữ trong màn hình output.
>
> ✅ Reporter không in tên test thì Compass báo thiếu, dù bạn đã viết đủ.

**3. Số thay cho tính từ.** "Chạy khá nhanh" không kiểm chứng được; "26ms trên 85 file" thì có.
Nhưng chỉ số đã đo — chưa đo thì viết "chưa đo", không bịa số cho câu đủ cụ thể.

**4. Chỉ ra chỗ đáng ngờ trước khi bị hỏi.** Giả định ngầm, nhánh chưa xử lý, chỗ dễ vỡ.

> ✅ Ngưỡng 20% là phỏng đoán, không phải số đo. Chọn vì Vitest khớp 1/13.

**Khó nhất là nguyên tắc 4.** Chỗ đáng ngờ thường là chỗ mình lười kiểm tra. Nói ra thì mất mặt một
chút, giấu đi thì người khác sập bẫy.

### Viết tiếng Việt

Đọc [`writing-vi.md`](references/writing-vi.md) khi viết tiếng Việt cho người đọc: 53 cặp câu **❌ → ✅** chia
theo từ ngữ, định dạng và giọng. Bắt chước cặp câu, đừng học tên luật.

**Viết ticket, email, báo cáo gửi đồng nghiệp → đọc thêm Phần 8.** Bảy phần đầu dạy viết câu cho
hay; Phần 8 dạy chọn câu nào để viết. Một bản mà mọi câu đều đạt chuẩn vẫn tệ nếu dài gấp ba lần cần
thiết. Phần 8 **không** áp cho `investigation.md` và `spec.md` — hai file đó càng đầy đủ càng tốt, vì
chúng là bằng chứng.

**Mặc định là văn xuôi.** Chọn theo quan hệ giữa các ý, không theo số ý: lập luận liền mạch → đoạn;
các mục rời nhau mà người đọc cần quét hay xử lý riêng → bullet; so nhiều thứ theo cùng tiêu chí →
bảng. Đóng khung hết vào bảng thì câu chữ có sạch mấy cũng đọc như tài liệu.

**Trả lời hội thoại: tối đa 5 câu** cho một câu hỏi đơn giản, trừ khi người dùng hỏi chi tiết. Được
vượt khi phải báo một điều chưa chắc hay một gate đỏ kèm lý do — cắt cái đó để giữ số câu là cắt sai
chỗ. Không áp cho `spec.md` và `investigation.md`.

Ba lỗi nặng nhất, để đây cho khỏi phải mở file: chủ ngữ mơ hồ ("ai đó quên chép" → "bảng gate
thiếu"), bị động kiểu Tây ("được xử lý bởi service" → "service xử lý"), và sáo rỗng ("đóng vai trò
quan trọng" → nói thẳng hậu quả).

Lỗi khó thấy nhất: nhịp tiếng Anh giữa các câu — câu dẫn "Nói gọn:", hỏi tu từ "Thấy chưa?", nhắc lại
ý đầu ở cuối đoạn. Từng câu đúng hết mà đoạn vẫn đọc như văn dịch. Phần 4 mục 15–17.

Lỗi nặng hơn mọi lỗi trên: viết lại mà **thêm sự thật** — con số, nguyên nhân, chủ thể, hay nói chắc
hơn điều mình biết. Câu gọn mà sai thì tệ hơn câu dài mà đúng.

**Phép thử cuối cùng: đọc thành tiếng.** Câu đúng ngữ pháp mà đọc xong phải đọc lại là câu hỏng.

### Khuôn trả lời — chốt trước, bảng sau

Vào thẳng kết quả. Câu đầu là kết luận, hoặc câu hỏi cần người dùng quyết. Bỏ phần dẫn nhập và phần
tóm tắt lại điều vừa nói.

Khuôn mặc định: **một dòng in đậm chốt lại, rồi một bảng hai cột trạng thái.**

> **CP-42 chưa code. Bug có thật. Cần bạn duyệt.**
>
> | | |
> |---|---|
> | Spec gate | ✓ pass |
> | Bug | 4/4 shape sai, đều `confident: true` |
> | Suite nền | 1000 test, 0 fail |
> | Chỗ dễ vỡ | xử lý string trong `flush` (E2, EC4) |

Giá trị trong bảng là số đo hay pass/fail, không phải tính từ — cùng nguyên tắc 3 ở trên.

Việc không có trạng thái để bày thành bảng thì viết văn xuôi ngắn. Đóng khung hết vào bảng thì câu
chữ có sạch mấy cũng đọc như tài liệu.

Chi tiết — cách đo, lập luận, các bước đã chạy — để dành, nói khi người dùng hỏi thêm.

**Hai thứ không được cắt để cho ngắn:** điều mình chưa chắc, và gate đỏ kèm lý do. Cắt mấy cái đó là
cắt sai chỗ.

## Vòng đời task

```
compass init <id> --type=<loại>     tạo spec skeleton
     ↓  bạn viết spec
compass spec <id>                   gate: spec hợp lệ?
     ↓  NGƯỜI DUYỆT ← dừng ở đây, chờ người nói tiếp
     ↓  bạn viết code + test
compass check <id>                  chạy mọi gate áp dụng
     ↓
compass done <id>                   cổng cuối
```

## Phân loại task

| Loại | Dùng khi | Test tối thiểu | Lớp bắt buộc |
|---|---|---|---|
| `fix` | typo, 1-2 dòng, không đổi hành vi | 2 | Happy |
| `bug` | sửa lỗi có nguyên nhân rõ | 6 | Happy, Validation, Error, Edge |
| `feature-s` | tính năng nhỏ, 1 module | 13 | + Security |
| `feature-m` | tính năng vừa, nhiều module | 21 | cả 6 lớp |
| `feature-l` | tính năng lớn, cross-repo | 30 | cả 6 lớp |

Sáu lớp: Happy · Validation · Error · Edge · Security · Performance

Nghi ngờ giữa hai loại → **chọn cái nặng hơn**.

## Bước 1 — Định hướng

Trước khi viết gì:

1. Đọc code thật của vùng sẽ sửa
2. Nếu dự án có `.knowledge/index.md` → đọc bản đồ, rồi chỉ nạp mảnh liên quan
3. **Đọc `.knowledge/decided/pitfalls.md`** nếu có — bẫy người trước đã sập, tốn cả buổi mỗi cái
4. Không nuốt cả thư mục docs vào context

*Knowledge base cho biết **ở đâu** và **tại sao**. Code cho biết **thực tế là gì**. Khi lệch nhau, code thắng về sự thật — nhưng phải báo người, không tự sửa docs.*

## Bước 2 — Spec

```
compass init <id> --type=<loại>
```

Điền vào `.compass/<id>/spec.md`. Mọi mục đều bắt buộc, đặc biệt **Rủi ro hồi quy** — nghĩ xem tính năng cũ nào có thể vỡ.

Test case phải có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`), mô tả, và kỳ vọng **đo được**. "Hoạt động đúng" không phải kỳ vọng đo được.

**Bốn dòng khai thêm, dùng khi cần:**

| Dòng | Khi nào | Gate làm gì |
|---|---|---|
| `Lệnh test: <lệnh>` | Task cần suite khác với cả dự án | Chạy lệnh đó thay lệnh trong config |
| `Kiểm tra bằng: mắt` | Việc sửa tài liệu, đổi config — không có test tự động | Nói thẳng nó không đo gì, vẫn đòi bảng case |
| `Soi đến: <sha>` | Task nằm giữa lịch sử nhánh, có commit của việc khác đến sau nó | Gate `review` dừng diff ở commit đó và chỉ giữ file trong `Phạm vi:` |
| `Dùng .env: <lý do>` | Task thật sự cần đọc file `.env` | Gate `secrets` cho phép **đọc**, vẫn chặn commit file `.env` |

`Kiểm tra bằng: mắt` không phải cửa sau. Gate vẫn đòi liệt kê từng case và cách kiểm tra, và báo lỗi
nếu suite có test mang task id — lời khai mâu thuẫn với thực tế thì phải sửa, không đoán.

```
compass spec <id>
```

Pass → **dừng lại, đưa người duyệt**. Đây là điểm dừng bắt buộc duy nhất. Không tự đi tiếp.

## Bước 3 — Implement

- Mỗi test case trong spec = một test function, **tên bắt đầu bằng ID**: `test_H1_filters_by_country`
- Viết test trước, chạy thấy nó đỏ, rồi mới implement
- KHÔNG test implementation detail: state nội bộ, snapshot lớn, mock chính mình
- FE: query bằng role/text người dùng thấy, không bằng test-id nội bộ
- Phát hiện task lớn hơn dự tính → sửa `Loại:` trong spec, chạy lại `compass spec`, xin duyệt lại

## Bước 4 — Verify

```
compass check <id>
```

Chạy các gate áp dụng, dừng ngay khi fail. Rẻ trước, đắt sau:

```
spec (0.1s) → secrets (0.3s) → convention (1s) → test (vài giây) → ui (30s) → visual (30s) → review (cần agent)
```

Gate nào áp dụng thì tùy loại task — xem bảng Phân loại. Gate `test` không chỉ xem suite xanh:
nó đối chiếu **mọi test ID trong spec đã thực sự chạy chưa**.

### Gate `knowledge` — tài liệu không được lỗi thời

Tài liệu sai tệ hơn không có tài liệu: người đọc tin vào thông tin sai.

`.knowledge/` chia hai:

| Thư mục | Là gì | Ai viết |
|---|---|---|
| `decided/` | Quy ước, quyết định, bẫy đã sập — không suy ra được từ code | Người, git-tracked |
| `derived/` | Component, props, ai dùng ở đâu — suy ra được | Máy sinh, gitignore |

```
compass knowledge          docs còn khớp code không?
compass knowledge --sync   sinh lại
```

Gate đỏ khi file nguồn đổi sau lần sinh cuối, và `done` gọi nó — sửa component xong mà không regen thì không đóng được task.

**Giới hạn:** trích bằng regex, không phân tích AST (Node không có parser TS/JSX sẵn, thêm một cái là phá zero-dependency). Component nào không đọc được prop thì đánh dấu `confident: false` — **đừng tin phần đó**. Nói không chắc còn hơn bịa cho chắc.

### Gate `secrets` — file mật khẩu đừng lọt vào commit

Chạy cho **mọi loại task**, kể cả `fix` một dòng: sửa một dòng vẫn commit lộ khoá dễ như làm
tính năng lớn.

Gate đọc diff của task rồi đỏ khi gặp một trong ba thứ:

| # | Chuyện gì | Gate nói gì |
|---|---|---|
| 1 | File `.env` nằm trong diff, hoặc đã bị git theo dõi từ trước | nêu đường dẫn, bảo `git rm --cached` và đổi khoá |
| 2 | File `.env` có trong thư mục mà `.gitignore` chưa che | đưa sẵn dòng cần thêm vào `.gitignore` |
| 3 | Dòng code mới đọc `.env` mà spec không khai | chỉ file và số dòng, nhắc dòng `Dùng .env:` |

`.env.example`, `.env.sample`, `.env.template` là tài liệu — miễn. Chặn chúng là chặn đúng file
dạy người ta đừng commit file thật.

**Muốn đọc `.env` thì khai vào spec**, ở phần đầu như `Gốc soi:`:

```
Dùng .env: chạy local, không đụng production
```

Lời khai này là chữ ký của người duyệt, nên `specHash` phủ nó: thêm sau khi duyệt là phải duyệt
lại. Và nó chỉ cho phép **đọc** — commit file `.env` vẫn đỏ, vì đồng ý đọc không phải đồng ý gửi
khoá lên repo.

**Gate không bao giờ mở file `.env`.** Nó chỉ làm việc với đường dẫn, text diff và metadata git;
output nêu tên file, không bao giờ nêu một dòng bên trong. Đó là test, không phải lời hứa — nếu
gate làm lộ đúng thứ nó canh thì thà đừng có gate.

Một ngoại lệ đã cân nhắc: `sourceHash` băm **kích thước** file `.env` thay cho nội dung, còn
`diffHash` thì băm cả diff — mà diff của một file `.env` đã bị commit thì chứa nội dung, do git
đưa vào. Gỡ `diffHash` ra là mất khả năng biết diff đã đổi, tức mất thứ buộc bằng chứng vào một
bản code. Ranh giới giữ được: giá trị không bao giờ nằm trong `gate.json` ở dạng đọc được.

**Giới hạn:** khớp mẫu theo dòng, không phân tích cú pháp. `process.env.X` và `import.meta.env`
không tính là đọc file (đúng), nhưng một đường dẫn `.env` ghép động trong biến thì gate không
thấy. Nó bắt trường hợp thường gặp, không phải lưới kín.

Không phải repo git thì gate **đỏ**, không xanh. Không có diff nghĩa là chưa quét được gì, mà
báo xanh lúc chưa quét đúng là kiểu sai Compass sinh ra để chặn.

**Thư mục nháp làm gate đỏ oan.** Lý do 2 hỏi git file nào chưa được ignore, nên một thư mục
tạm chứa file thử — agent soi code hay dựng — làm gate đỏ dù task không đụng gì tới nó. Gặp thì
thêm tên thư mục đó vào `.gitignore`, cạnh `.probe-tmp/`. Không tự dò được: tên thư mục do người
tạo đặt, và đoán theo mẫu thì vừa lọt thư mục thật vừa bỏ qua file `.env` thật nằm cạnh nó.

### Gate `convention` — quy ước viết một lần

Luật nằm trong `.knowledge/decided/conventions.md`. Phần văn xuôi cho người đọc, khối ```` ```rule ```` cho máy chạy:

````markdown
## Không hardcode mã màu

Màu phải đi qua CSS variable để đổi theme được.

```rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}\b"
scope: src/**/*.jsx
severity: error
message: Dùng CSS variable thay vì mã màu
```
````

`id` không trùng nhau · `type` hiện chỉ có `forbid-pattern` · `pattern` là regex, khớp là vi
phạm · `scope` nhận glob `**` `*` `?` · `severity` là `error` (chặn) hoặc `warn` (chỉ hiện) ·
`message` tùy chọn, hiện kèm mỗi vi phạm.

Không có `conventions.md` thì gate pass và nói rõ là chưa có luật nào. Luật khai sai — thiếu trường, regex hỏng, `type` chưa hỗ trợ — thì gate **fail**, vì luật chạy không được trông như có bảo vệ mà thật ra không bảo vệ gì.

`node_modules`, `dist`, `build`, `coverage`, `.git` không bị quét.

**Giới hạn:** chỉ khớp mẫu theo dòng, không phân tích AST. Luật kiểu "component này phải nhận prop kia" chưa làm được. Quy ước mềm cứ để dạng văn xuôi — vẫn đọc được, chỉ không có gate.

### Gate `ui` — đo số, không nhìn ảnh

Khai số thiết kế vào `.compass/<id>/design-contract.json`:

```json
{
  "viewports": [{ "name": "desktop", "width": 1280 }],
  "elements": [
    {
      "name": "Nút gửi",
      "selector": "form button",
      "properties": { "background-color": "#2563eb", "padding-left": "20px" }
    }
  ]
}
```

Compass khởi động dev server, mở từng viewport bằng Playwright, đọc `getComputedStyle`, so theo dung sai:

| Thuộc tính | Dung sai |
|---|---|
| color, font-size, font-weight | khớp tuyệt đối |
| padding, margin, gap, width | ±2px |
| border-radius, line-height | ±1px |

Config cần `dev` và `devUrl`. Playwright cài ở **dự án đích**, không phải ở Compass:

```
npm install -D playwright && npx playwright install chromium
```

Không có contract thì gate pass và nói rõ là chưa có gì để đối chiếu.

### Gate `visual` — chụp và so pixel

`ui` chỉ đo những thuộc tính bạn nghĩ ra để khai. Nó **không thấy** chữ tràn, phần tử đè nhau, layout vỡ ở màn hẹp.

Lần chạy đầu tạo baseline trong `.compass/<id>/baseline/` và nói rõ là **chưa so gì cả**. Xem ảnh, thấy đúng thì commit vào git. Từ lần sau nó so pixel.

Vượt ngưỡng (mặc định 0.1%, chỉnh bằng `visualThreshold`) thì fail và ghi ảnh diff vào evidence — đỏ là chỗ đổi, mờ là chỗ giữ nguyên.

Thay đổi là cố ý thì xóa baseline cũ, chạy lại để chốt baseline mới.

**Giới hạn:** render chữ khác nhau giữa máy và CI làm gate đỏ vì lý do vặt. Ngưỡng phần trăm giảm bớt, không chữa được.

### Gate `review` — agent khác soi diff

Chỉ từ `feature-m`. Chạy hai pha.

```
compass review <id>          → sinh review-brief.md, exit 1
   ↓  đưa brief cho agent KHÁC
   ↓  agent ghi evidence/findings.json
compass review <id>          → đọc findings, phán
```

Brief **chỉ có** spec và diff. Không lịch sử chat, không lời giải thích của người viết — reviewer biết lý do sẽ cân nhắc lý do đó thay vì đọc code.

Findings theo format cứng:

```json
{ "findings": [{ "severity": "Major", "title": "...", "detail": "...", "file": "a.js", "line": 42 }] }
```

`Critical` và `Major` chặn gate. `Minor` và `Info` hiện ra nhưng không chặn. Không tìm thấy gì thì nộp `{"findings": []}` — đừng bịa cho có.

Sửa code sau khi nộp findings thì gate **tự mở lại**: findings cũ nói về bản cũ, Compass sinh brief mới và bắt soi lại. Trường `brief` trong findings phải đúng id ghi trong brief — đó là thứ buộc một kết quả vào một bản code.

**Phạm vi soi.** Mặc định Compass so với điểm rẽ khỏi nhánh chính, hoặc commit đầu tiên nếu không có. Nhánh sống lâu thì phạm vi đó là cả dự án chứ không phải một task.

Khai vào spec của task, một dòng cạnh `Phạm vi:` — **phải ở phần đầu spec, trên heading `##` đầu tiên** — trỏ vào commit ngay **trước** khi task bắt đầu:

```
Gốc soi: abc1234
```

Config vẫn nhận `reviewBase` làm mặc định chung, nhưng nó là **một** giá trị cho cả dự án nên chỉ đúng cho một task. Nhánh mang nhiều task mà chỉ dựa vào config thì những task còn lại được soi trên diff không chứa code của chúng — agent nộp findings trung thực, gate xanh, và bằng chứng nói về việc của người khác. Spec đè config, nên khai theo task là đường thoát.

Giá trị nằm trong spec nên `specHash` phủ nó: đổi gốc soi là đổi spec, phải duyệt lại. Đúng như vậy — phạm vi soi quyết định người soi thấy gì.

Chỉ vùng đầu mới tính, nên ví dụ trong tài liệu bên dưới không bao giờ đổi phạm vi soi. Đọc fence để phân biệt ví dụ với lời khai đã thử bốn lần và sập cả bốn — lần tệ nhất là phạm vi lấy từ một dòng trong tài liệu.

Gốc soi cho ra diff rỗng thì gate **đỏ**, và nói rõ đó là gốc soi sai chỗ chứ không phải "chưa có gì để sửa". Diff rỗng không phải soi sạch.

**Task nằm giữa lịch sử thì khai thêm `Soi đến:`.** Gốc soi chỉ chốt đầu; gate vẫn diff tới HEAD, nên
một task có 22 commit của việc khác đến sau nó ra brief 78 file thay vì 13. `Soi đến: <sha>` chốt đuôi
— cũng ở phần đầu spec, cạnh `Gốc soi:` — và khi có nó, diff chỉ giữ file nằm trong `Phạm vi:`. Nhờ vậy
ba task chung một commit mà phạm vi không giao nhau vẫn tách được brief riêng.

Hai điều đi kèm, để không tưởng mình soi đủ. Diff `Gốc soi..Soi đến` không gồm thay đổi chưa commit —
brief nói rõ điều đó, task đang viết dở thì đừng khai `Soi đến`. Và thu hẹp theo `Phạm vi` chỉ bật
khi có `Soi đến`: task ở đỉnh nhánh vẫn được soi trọn, kể cả file nó đụng mà quên khai — đó là cách một
thay đổi chưa ai soi bị bắt hôm nay.

Gate đỏ khi `Soi đến` không phải commit, không nằm sau gốc soi, trùng gốc soi, hay thu hẹp xong không
còn file nào. Brief rỗng không phải soi sạch. `Phạm vi` viết cho người — `lib/x.mjs (mới)`,
`commands/`, dấu `\` trên Windows đều đọc được — nhưng mục mở đầu bằng `-`, chứa `..`, hay là đường dẫn
tuyệt đối thì bị từ chối trước khi tới git.

Diff quá 2MB thì gate từ chối. Không ai đọc hết chừng đó, và gate xanh trên bản chưa đọc còn tệ hơn không có gate — chia task nhỏ ra.

### Cách Compass đếm test ID

**Chỉ dòng có dấu hiệu pass mới được tính.** Không phải cứ thấy ID trong output là xong.

| ID xuất hiện ở | Compass kết luận |
|---|---|
| Dòng pass (`ok N`, `✔`, `✓`, `PASS`) | đã chạy |
| Dòng fail / skip / error | "xuất hiện nhưng không pass" |
| Dòng không nhận ra định dạng | "không nhận diện được định dạng" |
| Hai dòng pass khác nhau, cùng ID | "không rõ cái nào của task này" |

Bốn nhóm tách riêng vì đòi bốn việc khác nhau: viết test mới, bỏ skip, kiểm tra reporter, đặt lại tên.

**Reporter phải in tên từng test.** Chỉ in tên **file** thì mọi ID biến mất và gate báo thiếu dù
bạn đã viết đủ: `node --test` chạy sẵn, Vitest cần `--reporter=tap`, Jest cần `--verbose`.

**Một ID khớp nhiều test là đỏ.** Mọi spec đều dùng `H1`, `V1`, `EC1`, nên nhiều task chung một
suite thì gate không biết test nào của ai — task chưa viết gì vẫn qua. Đường thoát: đặt tên test
kèm task id, `test('T-12-H1 …')`. Chỉ đổi tên test của task đang làm.

**Giới hạn:** quét text không kín được. Gate bắt case thường gặp và **gọi tên thứ nó không phân
loại được**, chứ không giả vờ chắc chắn. Đây là lưới chắn, không phải khóa.

Fail → sửa → chạy lại. Không bỏ qua, không giải thích vòng vo.

## Bước 5 — Đóng task

```
compass done <id>
```

Exit 0 mới được báo hoàn thành. Dán output của lệnh này khi báo cáo.

### Gate xanh ≠ mục tiêu đạt

Compass chứng minh **test đã chạy và xanh**. Nó không chứng minh **test đo đúng thứ cần đo**.

Một task có mục tiêu "không còn để lại file rác" có thể pass mọi gate trong khi rác vẫn còn — nếu test case chỉ kiểm tra hàm dọn chạy được, chứ không kiểm tra kết quả cuối. Gate không biết điều đó.

Nên: sau khi `done` xanh, **tự kiểm tra mục tiêu gốc một lần**. Nếu spec nói "sau khi chạy không còn X", thì đi đếm X. Trách nhiệm chọn test case đo đúng mục tiêu vẫn nằm ở người viết spec — công cụ chỉ đảm bảo bạn không nói dối về việc đã chạy chúng.

### Compass từ chối bản ghi thế nào

Bản ghi gate được ký kèm **danh tính**, không chỉ nội dung. Bốn lý do bị từ chối:

| Thông báo | Nghĩa là |
|---|---|
| "bản ghi đã bị sửa tay" | Giá trị trong `gate.json` bị đổi |
| "không thuộc slot này" | Bản ghi của gate khác bị chuyển sang |
| "thuộc task khác" | `gate.json` bị chép từ task khác |
| "bản ghi từ phiên bản cũ" | Thiếu trường danh tính — chạy lại gate |

### Bốn thứ `done` đối chiếu

`done` đọc `gate.json` chứ không chạy lại gate, nên nó so bốn thứ để biết bằng chứng còn nói đúng về hiện tại:

| Trường | Bắt được gì |
|---|---|
| `sig` | Bản ghi bị sửa tay, chuyển khe, hay chép từ task khác |
| `specHash` | Spec đổi sau khi gate chạy — phải duyệt lại |
| `sourceHash` | **Code đổi sau khi gate xanh** — bằng chứng nói về bản cũ |
| `configHash` | Lệnh test đổi sau khi gate chạy |

Gate nào đọc code mà thiếu `sourceHash` thì bị coi là bản ghi cũ và bị chặn — không được miễn.

### Hai giới hạn còn lại

**Khôi phục cả code lẫn bản ghi.** Lưu `gate.json` lúc xanh, sửa code, rồi khôi phục **cả hai** về đúng trạng thái cũ — `done` xanh. Đúng ra là nên thế: code đó thật sự là code đã được kiểm tra. Chỗ hở thật nằm ở việc không có gì xâu chuỗi các lần chạy theo thời gian.

**`config.json` được tin.** Compass bắt được lệnh test **đổi sau** khi gate chạy, nhưng nếu ai sửa nó **trước** — trỏ sang một lệnh `echo` in ra TAP giả — thì không phát hiện được. Compass không phán được lệnh đó có phải test suite thật hay không.

Hai điều này chặn được **sai sót vô tình**, không chặn được **cố ý gian lận**. Đó là ranh giới, và bạn nên biết nó ở đâu.

## Điều tra — khi chưa biết vấn đề ở đâu

Task BUILD giả định đã biết phải làm gì. Chưa biết thì mở điều tra, không phải mò rồi sửa bừa.

```
compass investigate INV-1          mở hồ sơ
     ↓  điền giả thuyết, kiểm tra, ghi bằng chứng
compass investigate INV-1 --close  đóng — chỉ khi đủ bằng chứng và pitfall
```

**Ba luật cứng:**

1. **Không sửa code khi đang điều tra.** Sửa là task BUILD riêng.
2. **Mỗi giả thuyết nêu cách kiểm tra TRƯỚC khi kiểm tra.** Không "để tôi xem thử".
3. **Kết luận phải dẫn về bằng chứng**, không phải suy luận.

`--close` chặn nếu thiếu bằng chứng, thiếu kết luận, thiếu pitfall, hay còn chữ mẫu. Đóng được thì pitfall tự chép vào `.knowledge/decided/pitfalls.md` — lần sau đọc được.

### Script và dữ liệu

Mọi file sinh ra lúc điều tra đều lưu vào `.compass/scripts/`, mỗi cái mở đầu bằng một dòng comment
nói nó làm gì. Đừng để ở `output/` — thư mục đó bị `.gitignore` che, và công cụ để đó là mất.

Ba loại, ba chỗ:

| Loại | Đặt ở | Vì sao riêng |
|---|---|---|
| Chạy bằng `node` (`.mjs`) | `scripts/` | Đúng nghĩa "script" |
| Query dán vào client (`.sql`) | `scripts/queries/` | Có `-- @out:`, và `compass data` đọc nó |
| Công cụ mở bằng trình duyệt (`.html`) | `scripts/tools/` | Có giao diện, không chạy bằng lệnh |

`compass scripts` quét cả thư mục con, nên chia ra không mất gì. Comment mô tả nhận `//`, `#`, `--`,
`/* */` và `<!-- -->` — viết bằng cú pháp của chính loại file đó.

Kết quả chạy — query, log, dump — lưu vào `.compass/<id>/data/`, **đừng paste vào chat**: phiên đóng
là mất, và hồ sơ dẫn "query trả 47 dòng" mà không ai kiểm tra lại được thì đó là lời khai, không phải
bằng chứng. Tên file theo khuôn `<task-id>-<việc>-<ngày>.<đuôi>`, khớp tên script sinh ra nó:
`queries/inv1-prod-queries.sql` → `INV-1-prod-queries-0907.csv`. Không phải nghĩ tên, chỉ điền vào khuôn.

`data/` được `.gitignore` che sẵn vì query production trả về email và tên khách hàng. Dự án dựng
trước tháng 9/2026 có `.gitignore` chỉ một dòng `.salt` — tự thêm `data/` vào.

```
compass scripts        liệt kê những gì đã có
```

#### Một file `.sql`, nhiều query

Khuôn trên tính theo một script một kết quả. File `.sql` mười query thì cả mười cùng một `<việc>`,
nên khai tên ngay trên từng query — lúc bạn còn biết nó trả về cái gì:

```sql
-- Q0 — mỗi status có bao nhiêu package?
-- @out: INV-4-q0-status-dist-0908.csv
select clp.Status, count(*) from crmlaaspackages clp group by clp.Status;

-- Q1 — một contact cụ thể. THAY <EMAIL> rồi chạy tay.
-- @out: -
select * from mastercontact where Email = '<EMAIL>';
```

`-- @out: -` nghĩa là "case chạy tay, đừng đợi file" — dùng cho query có placeholder phải thay.
Vẫn phải khai, để không ai lặng lẽ bỏ sót một query.

```
compass data <id> <file.sql>
```

`<file.sql>` là đường dẫn, nên file `.sql` nằm ở `.compass/scripts/queries/` thì gõ
`compass data INV-1 .compass/scripts/queries/inv1-prod-0909.sql`.

Lệnh đối chiếu khai báo với file thật trong `data/`:

```
✗ Gate data FAILED
    dòng 20: ✓ INV-4-q0-status-dist-0908.csv
    dòng 32: (chạy tay, không đợi file)
    dòng 71: ✓ INV-4-q2-status-gap-0915.csv (khai 0908, thấy 0915)
    dòng 95: ✗ INV-4-q2b-status-gap-sample-0908.csv — chưa có trong data/

  16 query đã khai · 2/14 file có trong data/ · 2 chạy tay
```

Ngày lệch thì vẫn tính là có, kèm lời nhắc — chạy lại query hôm khác không phải sửa file `.sql`.
Tên trùng nhau, sai khuôn, hay query chưa khai đều làm gate đỏ. Một file chỉ thỏa **một** khai báo:
hai query cùng gốc tên mà chỉ có một file thì query thứ hai báo thiếu.

Gate này **không** nằm trong `check` hay `done`. Nó chạy khi bạn gọi, vì task không đụng database
thì không có gì để đối chiếu.

**Giới hạn:** gate kiểm tra hình dạng tên, không kiểm tra ý nghĩa. `INV-4-xyz-0908.csv` qua được như
`INV-4-status-gap-0908.csv`. Nó canh bạn khỏi quên và khỏi đặt trùng — tên có tả đúng query hay
không vẫn là việc của bạn.

**Lỗ còn lại, biết trước để khỏi sập.** Comment một query ra mà để lại dòng `@out:` của nó thì khai
báo đó thuộc về query kế tiếp. Gate in dấu `⚠` chỉ đúng hai dòng số:

```
⚠ Dòng 1: khai "-" cách query ở dòng 3 một khoảng — kiểm tra xem nó thuộc query nào
```

Nó **không** phán, vì phán được thì phải biết một dòng comment là code đã tắt hay lời nói về code —
văn bản không chứa thông tin đó. Ba cách đoán đều sai cả hai chiều: đọc từ khoá SQL thì lọt sáu case
và chặn oan năm câu văn thường; đòi dòng trống thì lọt mọi file viết liền.

Case nguy hiểm nhất thì gate **có** chặn: nếu query thật cũng có khai báo riêng, hai khai báo cho một
query là mâu thuẫn đo được, gate đỏ và chỉ ra cả hai dòng. Chỉ khi query thật **không** khai gì thì
dấu `⚠` là thứ duy nhất báo bạn — đọc nó.

Dấu `⚠` bật khi giữa khai báo và query có **một dòng comment đầy đủ** — `--` hay `/* … */`, kể cả
khi query nằm chung dòng với nó. Nó **không** bật khi khai báo đứng sát query, sau khối tiêu đề, sau
một dòng trống, hay khi comment nằm trong thân query. Đó là ranh giới đo được; bố cục nào lọt ra
ngoài thì gate im, nên đừng coi nó là lưới kín.

Thư mục này git-tracked. Lần sau gặp lại câu hỏi cũ thì tìm thấy mà dùng, khỏi viết lại.

## Nhiều repo

Một task hay đụng cả backend lẫn frontend. Khai chúng trong `config.json`:

```json
{
  "test": "npm test",
  "repos": {
    "backend":  { "test": "yarn test" },
    "frontend": { "test": "pnpm test", "dev": "pnpm dev", "devUrl": "http://localhost:5173/" }
  }
}
```

Repo con đè lên phần chung theo từng trường — khai `test` mà không khai `dev` thì `dev` vẫn lấy từ chung.

`Phạm vi` trong spec quyết định repo nào áp dụng, và `compass status` cho thấy Compass đọc ra gì.

### Dựng config cho dự án nhiều repo

`compass init` chỉ đẻ config một repo. Nhiều repo thì **đọc từng thư mục con rồi viết**, đừng hỏi
người dùng từng repo một — thông tin đã nằm sẵn trong file.

Với mỗi thư mục con có `package.json`:

| Đọc gì | Ra cái gì |
|---|---|
| `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` | trình quản lý gói |
| `scripts.test` | lệnh test — ghép với trình quản lý: `yarn test`, `pnpm test` |
| `scripts.dev` + cổng | `dev` và `devUrl`, **chỉ cho repo có giao diện** |

Cổng nằm ở `vite.config` (`server.port`), `next.config`, hoặc `angular.json` (`serve.options.port`).
Không khai thì lấy mặc định: **Vite 5173 · Next 3000 · Angular 4200**. Hai repo cùng framework mà đều
không khai là hai `devUrl` trùng nhau — `visual` sẽ chụp nhầm trang. Gặp vậy thì hỏi người dùng, đừng
tự chọn cổng.

Cờ reporter ghép vào chính lệnh `test`, không có trường config nào cho nó: `"test": "vitest run
--reporter=tap"`. Xem mục "Cách Compass đếm test ID" để biết runner nào cần cờ gì.

Bốn luật khi viết:

1. **Không có `scripts.test`** → khai `"test": "echo 'chưa có test' && exit 1"`. Gate đỏ khi đụng tới,
   đúng như vậy — chưa có test thì chưa có bằng chứng. Đừng bỏ repo ra khỏi config.
2. **Không phải Node** (PHP, Java, Go) → vẫn khai, lệnh test của hệ đó. Compass không quan tâm ngôn ngữ,
   nó chỉ cần một lệnh và một mã thoát.
3. **Backend đừng khai `devUrl`** — khai vào thì `ui`/`visual` chạy oan rồi đỏ vì không có trang nào.
4. **Config đã có thì không ghi đè.** In ra cái vừa dò được, để người tự gộp.
5. **Repo lồng trong thư mục con** → key là đường dẫn: `"sorm/backend"`, `"sorm/frontend"`. Một thư
   mục cha chứa hai repo là chuyện thường; khai thành một entry thì lệnh test của một nửa sẽ sai.

Viết xong chạy `compass status` và **đọc kết quả cùng người dùng**. Đó là lúc bắt được lockfile đoán sai
hay repo bị bỏ sót — rẻ hơn nhiều so với phát hiện lúc gate đỏ giữa chừng.

## Giai đoạn hiện tại

Tám gate: `spec`, `knowledge`, `secrets`, `convention`, `test`, `ui`, `visual`, `review`.

Cộng knowledge base sinh tự động, lệnh `investigate`, config nhiều repo, và `check` chạy gate
theo từng repo.

Chưa xong ở chế độ nhiều repo: `convention`, `ui`, `visual` quét đúng thư mục nhưng **ghi sổ không
kèm tên repo**, nên hai repo đè lên nhau và chỉ repo cuối còn bằng chứng. Gate vẫn xanh — đây là dạng
sai khó thấy nhất. Dự án nhiều repo chỉ nên tin `test` và `knowledge` cho tới khi vá xong.

Chưa có: trang xem knowledge bằng trình duyệt, và lệnh dựng config nhiều repo (làm tay theo mục trên).

### Giới hạn còn lại của `done`

`done` đọc `gate.json`, không đo lại code. Sửa code sau khi gate xanh thì `done` vẫn đóng được — đúng với **mọi** gate, không riêng `review`. Chặn được sai sót vô tình, không chặn được cố ý.

## Red Flags

| Bạn nghĩ | Thực tế |
|---|---|
| "Task nhỏ, bỏ spec cho nhanh" | Nhỏ = spec ngắn, không phải không có spec |
| "Test pass rồi, chắc compass cũng pass" | Chưa chạy thì chưa biết gì cả |
| "Docs lỗi thời chút không sao" | Docs lỗi thời = quyết định dựa trên thông tin sai |
| "Screenshot trông giống rồi" | Trông giống không phải bằng chứng. Đo số. |
| "Còn 1 test fail nhưng không liên quan" | Fail là fail |
| "Tôi sẽ sửa gate.json cho nhanh" | Chữ ký sẽ lộ — sửa giá trị, chuyển khe, chép từ task khác đều bị bắt. Và đó là gian lận. |
| "Người duyệt chắc sẽ đồng ý thôi" | Chờ họ nói. Đoán ý là bỏ qua checkpoint. |
| "compass done xanh rồi, xong" | Gate chứng minh test đã chạy, không chứng minh test đo đúng thứ. Tự kiểm tra mục tiêu gốc một lần. |
