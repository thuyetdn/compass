---
name: compass
description: "Quy trình phát triển có bằng chứng — spec trước code, gate máy chạy thật thay vì AI tự khai kết quả. Dùng khi bắt đầu bất kỳ task lập trình nào — thêm tính năng, sửa bug, refactor — hoặc khi người dùng nhắc compass, gate, spec-first, hay hỏi vì sao AI báo xong mà chưa xong."
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

## Trước tiên: có `compass` chưa?

```
compass
```

Không thấy lệnh → cài một lần, dùng cho mọi dự án:

```
npm install -g <đường-dẫn-tới-repo-compass>
```

Không cài được thì gọi trực tiếp, thay `compass` bằng `node <đường-dẫn>/cli.mjs` ở mọi lệnh bên dưới.

Lệnh **có** nhưng ném `MODULE_NOT_FOUND` → symlink đứt vì repo bị đổi tên hoặc chuyển chỗ. Chạy lại
`npm install -g .` từ repo, đừng đi chẩn đoán từng bước.

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

**4. Chỉ ra chỗ đáng ngờ trước khi bị hỏi.** Giả định ngầm, nhánh chưa xử lý, chỗ dễ vỡ.

> ✅ Ngưỡng 20% là phỏng đoán, không phải số đo. Chọn vì Vitest khớp 1/13.

**Khó nhất là nguyên tắc 4.** Chỗ đáng ngờ thường là chỗ mình lười kiểm. Nói ra thì mất mặt một
chút, giấu đi thì người khác sập bẫy.

### Viết tiếng Việt

Đọc [`writing-vi.md`](writing-vi.md) khi viết tiếng Việt cho người đọc: 34 cặp câu **❌ → ✅** chia
theo từ ngữ, định dạng và giọng. Bắt chước cặp câu, đừng học tên luật.

**Mặc định là văn xuôi.** Bảng chỉ dùng khi so nhiều thứ theo cùng một tiêu chí; ba ý rời nhau thì
viết thành đoạn. Đóng khung hết vào bảng thì câu chữ có sạch mấy cũng đọc như tài liệu.

Ba lỗi nặng nhất, để đây cho khỏi phải mở file: chủ ngữ mơ hồ ("ai đó quên chép" → "bảng gate
thiếu"), bị động kiểu Tây ("được xử lý bởi service" → "service xử lý"), và sáo rỗng ("đóng vai trò
quan trọng" → nói thẳng hậu quả).

**Phép thử cuối cùng: đọc thành tiếng.** Câu đúng ngữ pháp mà đọc xong phải đọc lại là câu hỏng.

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

**Hai dòng khai thêm, dùng khi cần:**

| Dòng | Khi nào | Gate làm gì |
|---|---|---|
| `Lệnh test: <lệnh>` | Task cần suite khác với cả dự án | Chạy lệnh đó thay lệnh trong config |
| `Kiểm bằng: mắt` | Việc sửa tài liệu, đổi config — không có test tự động | Nói thẳng nó không đo gì, vẫn đòi bảng ca |

`Kiểm bằng: mắt` không phải cửa sau. Gate vẫn đòi liệt kê từng ca và cách kiểm, và báo lỗi
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
spec (0.1s) → convention (1s) → test (vài giây) → ui (30s) → visual (30s) → review (cần agent)
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

**Phạm vi soi.** Mặc định Compass so với điểm rẽ khỏi nhánh chính, hoặc commit đầu tiên nếu không có. Nhánh sống lâu thì phạm vi đó là cả dự án chứ không phải một task — khai `reviewBase` trong config để trỏ đúng chỗ task bắt đầu:

```json
{ "reviewBase": "abc1234" }
```

Diff quá 2MB thì gate từ chối. Không ai đọc hết chừng đó, và gate xanh trên bản chưa đọc còn tệ hơn không có gate — chia task nhỏ ra.

### Cách Compass đếm test ID

**Chỉ dòng có dấu hiệu pass mới được tính.** Không phải cứ thấy ID trong output là xong.

| ID xuất hiện ở | Compass kết luận |
|---|---|
| Dòng pass (`ok N`, `✔`, `✓`, `PASS`) | đã chạy |
| Dòng fail / skip / error | "xuất hiện nhưng không pass" |
| Dòng không nhận ra định dạng | "không nhận diện được định dạng" |
| Hai dòng pass khác nhau, cùng ID | "không rõ cái nào của task này" |

Bốn nhóm tách riêng vì đòi bốn việc khác nhau: viết test mới, bỏ skip, kiểm reporter, đặt lại tên.

**Reporter phải in tên từng test.** Chỉ in tên **file** thì mọi ID biến mất và gate báo thiếu dù
bạn đã viết đủ: `node --test` chạy sẵn, Vitest cần `--reporter=tap`, Jest cần `--verbose`.

**Một ID khớp nhiều test là đỏ.** Mọi spec đều dùng `H1`, `V1`, `EC1`, nên nhiều task chung một
suite thì gate không biết test nào của ai — task chưa viết gì vẫn qua. Đường thoát: đặt tên test
kèm task id, `test('T-12-H1 …')`. Chỉ đổi tên test của task đang làm.

**Giới hạn:** quét text không kín được. Gate bắt ca thường gặp và **gọi tên thứ nó không phân
loại được**, chứ không giả vờ chắc chắn. Đây là lưới chắn, không phải khóa.

Fail → sửa → chạy lại. Không bỏ qua, không giải thích vòng vo.

## Bước 5 — Đóng task

```
compass done <id>
```

Exit 0 mới được báo hoàn thành. Dán output của lệnh này khi báo cáo.

### Gate xanh ≠ mục tiêu đạt

Compass chứng minh **test đã chạy và xanh**. Nó không chứng minh **test đo đúng thứ cần đo**.

Một task có mục tiêu "không còn để lại file rác" có thể pass mọi gate trong khi rác vẫn còn — nếu test case chỉ kiểm hàm dọn chạy được, chứ không kiểm kết quả cuối. Gate không biết điều đó.

Nên: sau khi `done` xanh, **tự kiểm mục tiêu gốc một lần**. Nếu spec nói "sau khi chạy không còn X", thì đi đếm X. Trách nhiệm chọn test case đo đúng mục tiêu vẫn nằm ở người viết spec — công cụ chỉ đảm bảo bạn không nói dối về việc đã chạy chúng.

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

**Khôi phục cả code lẫn bản ghi.** Lưu `gate.json` lúc xanh, sửa code, rồi khôi phục **cả hai** về đúng trạng thái cũ — `done` xanh. Đúng ra là nên thế: code đó thật sự là code đã được kiểm. Chỗ hở thật nằm ở việc không có gì xâu chuỗi các lần chạy theo thời gian.

**`config.json` được tin.** Compass bắt được lệnh test **đổi sau** khi gate chạy, nhưng nếu ai sửa nó **trước** — trỏ sang một lệnh `echo` in ra TAP giả — thì không phát hiện được. Compass không phán được lệnh đó có phải test suite thật hay không.

Hai điều này chặn được **sai sót vô tình**, không chặn được **cố ý gian lận**. Đó là ranh giới, và bạn nên biết nó ở đâu.

## Điều tra — khi chưa biết vấn đề ở đâu

Task BUILD giả định đã biết phải làm gì. Chưa biết thì mở điều tra, không phải mò rồi sửa bừa.

```
compass investigate INV-1          mở hồ sơ
     ↓  điền giả thuyết, kiểm, ghi bằng chứng
compass investigate INV-1 --close  đóng — chỉ khi đủ bằng chứng và pitfall
```

**Ba luật cứng:**

1. **Không sửa code khi đang điều tra.** Sửa là task BUILD riêng.
2. **Mỗi giả thuyết nêu cách kiểm TRƯỚC khi kiểm.** Không "để tôi xem thử".
3. **Kết luận phải dẫn về bằng chứng**, không phải suy luận.

`--close` chặn nếu thiếu bằng chứng, thiếu kết luận, thiếu pitfall, hay còn chữ mẫu. Đóng được thì pitfall tự chép vào `.knowledge/decided/pitfalls.md` — lần sau đọc được.

### Script và dữ liệu

Script viết lúc điều tra lưu vào `.compass/scripts/`, mỗi cái mở đầu bằng một dòng comment nói nó làm gì.

Kết quả chạy — query, log, dump — lưu vào `.compass/<id>/data/`, **đừng paste vào chat**: phiên đóng
là mất, và hồ sơ dẫn "query trả 47 dòng" mà không ai kiểm lại được thì đó là lời khai, không phải
bằng chứng. Tên file theo khuôn `<task-id>-<việc>-<ngày>.<đuôi>`, khớp tên script sinh ra nó:
`inv1-prod-queries.sql` → `INV-1-prod-queries-0907.csv`. Không phải nghĩ tên, chỉ điền vào khuôn.

`data/` được `.gitignore` che sẵn vì query production trả về email và tên khách hàng. Dự án dựng
trước tháng 9/2026 có `.gitignore` chỉ một dòng `.salt` — tự thêm `data/` vào.

```
compass scripts        liệt kê những gì đã có
```

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

Bảy gate: `spec`, `knowledge`, `convention`, `test`, `ui`, `visual`, `review`.

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
| "compass done xanh rồi, xong" | Gate chứng minh test đã chạy, không chứng minh test đo đúng thứ. Tự kiểm mục tiêu gốc một lần. |
