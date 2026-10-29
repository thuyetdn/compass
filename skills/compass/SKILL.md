---
name: compass
description: "Quy trình phát triển dựa trên bằng chứng: viết spec trước khi code và sử dụng các gate được chạy thực tế để xác minh kết quả, thay vì để AI tự kết luận rằng task đã hoàn thành. Áp dụng cho mọi task lập trình như phát triển tính năng, sửa bug hoặc refactor, cũng như khi người dùng nhắc đến Compass, gate, spec-first, hoặc đặt câu hỏi về trường hợp AI báo đã xong nhưng thực tế vẫn chưa hoàn tất."
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

## Gõ lệnh thế nào

Skill này đi kèm chính công cụ nó nói tới, nên không phải cài gì thêm. Cách gọi tùy nơi chạy.

Trong Claude Code:

```
node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" <lệnh>
```

Trong Codex: Codex liệt kê skill kèm đường dẫn tới file `SKILL.md` này. `cli.mjs` nằm ở gốc plugin,
hai cấp trên thư mục chứa file này:

```
node "<thư mục chứa SKILL.md này>/../../cli.mjs" <lệnh>
```

Mọi lệnh bên dưới viết tắt là `compass <lệnh>` cho gọn. Gõ thì thay bằng dòng hợp với nơi bạn chạy.

Không tìm thấy `cli.mjs` theo hai đường trên (skill được chép lẻ, không đi kèm plugin) thì cài lệnh
một lần: `npm install -g github:thuyetdn/compass`, rồi gõ thẳng `compass <lệnh>`. Agent không nạp
được skill thì dùng đoạn quy trình rút gọn ở `templates/AGENTS.md`.

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

Đọc [`writing-vi.md`](references/writing-vi.md) khi viết tiếng Việt cho người đọc: 56 cặp câu **❌ → ✅** chia
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
5. `init` in dòng "Chưa có …conventions.md" hay "…có thể đã cũ" thì làm theo mục
   [Convention thiếu hoặc đã cũ](#convention-thiếu-hoặc-đã-cũ) trước khi viết spec

*Knowledge base cho biết **ở đâu** và **tại sao**. Code cho biết **thực tế là gì**. Khi lệch nhau, code thắng về sự thật — nhưng phải báo người, không tự sửa docs.*

## Bước 2 — Spec

```
compass init <id> --type=<loại>
```

Điền vào `.compass/<id>/spec.md`. Mọi mục đều bắt buộc, đặc biệt **Rủi ro hồi quy** — nghĩ xem tính năng cũ nào có thể vỡ.

Test case phải có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`), mô tả, và kỳ vọng **đo được**. "Hoạt động đúng" không phải kỳ vọng đo được.

**Năm dòng khai thêm, dùng khi cần:**

| Dòng | Khi nào | Gate làm gì |
|---|---|---|
| `Lệnh test: <lệnh>` | Task cần suite khác với cả dự án | Chạy lệnh đó thay lệnh trong config |
| `Kiểm tra bằng: mắt` | Việc sửa tài liệu, đổi config — không có test tự động | Nói thẳng nó không đo gì, vẫn đòi bảng case |
| `Soi đến: <sha>` | Task nằm giữa lịch sử nhánh, có commit của việc khác đến sau nó | Gate `review` dừng diff ở commit đó và chỉ giữ file trong `Phạm vi:` |
| `Dùng .env: <lý do>` | Task thật sự cần đọc file `.env` | Gate `secrets` cho phép **đọc**, vẫn chặn commit file `.env` |
| `Gốc soi (be): <sha>`, `Soi đến (be): <sha>` | Repo con `be` có git riêng (mục "Repo con có git riêng") | Gốc soi và Soi đến của riêng git đó |

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
compass knowledge --page   ghi trang HTML xem bằng trình duyệt
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

`.env.example`, `.env.sample`, `.env.template` và `.env.dist` (quy ước của Symfony) là tài liệu —
miễn. Chặn chúng là chặn đúng file dạy người ta đừng commit file thật. Chỉ đuôi cuối tính:
`.env.dist.local` vẫn bị chặn.

**Repo cố ý commit `.env` chứa cấu hình public** thì khai từng file trong `config.json`, đúng như
gate in ra:

```json
"secretsPublic": ["api/.env", "api/.env.alpha"]
```

Đây là lỗ có chủ ý: Compass không kiểm tra được file có thật sự public hay không. Nên nó bó hẹp:

- **Đường dẫn chính xác, không ký tự đại diện.** `be/.env*` bị từ chối (exit 2), vì nó che luôn
  một `.env.production.local` ai đó commit sau này với khoá thật. Mỗi file public mới là một dòng
  config có người xem.
- **Chỉ miễn lý do 1, cho file git đang theo dõi.** File khai mà nằm trên đĩa chưa ignore vẫn đỏ;
  code mới đọc nó vẫn cần `Dùng .env:` trong spec.
- **Gate kể tên từng file nó không quét**, bằng một dòng `ℹ`, kể cả khi xanh. Khai mà git không
  theo dõi thì cũng có một dòng `ℹ` nói lời khai không có tác dụng. `compass status` liệt kê danh sách.
- **So phân biệt hoa thường.** Khai `BE/.env` cho file `be/.env` thì gate vẫn đỏ.
- **`done` so `configHash` của bản ghi `secrets`.** Gỡ một dòng khai sau khi gate xanh thì phải
  chạy lại `check`. Bản ghi `secrets` từ 3.1.2 trở về trước băm config theo cách khác, nên cũng phải
  chạy lại một lần.
- **Brief soi code liệt kê lời khai.** Diff không gồm `.compass/`, nên brief có một mục riêng kể
  từng đường dẫn khai, đánh dấu **mới** (config ở gốc soi chưa có, tức task này thêm), có từ trước,
  hay **không biết** (không đọc được config ở gốc soi — coi như mới). Người soi phải báo finding
  `security` cho dòng mới, trừ khi spec nói vì sao file đó public. Thêm hay bớt một dòng sau khi soi
  thì `review` mở lại.

Lời khai nằm ở config chứ không ở spec, vì đó là sự thật về repo, không phải về một task.

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
báo xanh lúc chưa quét đúng là kiểu sai Compass sinh ra để chặn. `config.json` không phải JSON hợp
lệ cũng vậy: gate không biết repo con nào có git riêng, nên thoát mã 2 và không quét gì.

**Thư mục nháp làm gate đỏ oan.** Lý do 2 hỏi git file nào chưa được ignore, nên một thư mục
tạm chứa file thử — agent soi code hay dựng — làm gate đỏ dù task không đụng gì tới nó. Gặp thì
thêm tên thư mục đó vào `.gitignore`, cạnh `.probe-tmp/`. Không tự dò được: tên thư mục do người
tạo đặt, và đoán theo mẫu thì vừa lọt thư mục thật vừa bỏ qua file `.env` thật nằm cạnh nó.

Worktree tạo bằng `git worktree add` thì khác: nó nhận ra được từ thứ nằm trên đĩa, không cần đoán
tên. `.git` của nó là file trỏ vào thư mục quản trị có `commondir` — dấu git tự dùng để nhận worktree
liên kết. Nên worktree của agent (`.claude/worktrees/<tên>/` hay bất kỳ đâu) không cần dòng nào
trong `.gitignore`: `knowledge`, `convention` và `sourceHash` không đi vào nó, brief không mang nó
thành gitlink, còn git vốn không liệt kê file bên trong cho `secrets`. Thư mục nháp không có `.git`
thì vẫn phải thêm vào `.gitignore` như trên.

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

`node_modules`, `dist`, `build`, `coverage`, `.git` không bị quét, và cả worktree liên kết lồng
trong repo — bản checkout của agent không phải code của task. Nhận theo cấu trúc, không theo tên:
`.git` là file, dòng đầu `gitdir: <p>`, và `<p>` có file `commondir`. Submodule (`.git` cũng là
file nhưng không có `commondir`) và repo lồng có `.git` là thư mục vẫn được quét như cũ. Không đọc
ra được thì cứ quét — gate đỏ oan còn hơn bỏ sót. Gốc quét không bao giờ bị bỏ, nên chạy Compass
ngay trong worktree vẫn thấy code của nó.

**Giới hạn:** chỉ khớp mẫu theo dòng, không phân tích AST. Luật kiểu "component này phải nhận prop kia" chưa làm được. Quy ước mềm cứ để dạng văn xuôi — vẫn đọc được, chỉ không có gate.

### Convention thiếu hoặc đã cũ

`compass convention --draft` đọc config của repo (`.editorconfig`, Prettier, ESLint, `tsconfig.json`,
script trong `package.json`) và đếm trên code (thụt lề, nháy, dấu chấm phẩy, cách đặt tên file, tên
file test), rồi soạn `.compass/conventions-draft.md`. Mỗi convention kèm bằng chứng: dòng config, hay
"38 / 40 file". Đếm được dưới 20 file, hoặc dưới 90 % đồng ý, thì nó vào mục "Chưa đủ mẫu" hay
"Không nhất quán", không thành luật. Luật máy chạy được chỉ được đề xuất khi code hôm nay không phá
chỗ nào, và để `severity: warn`. File config viết bằng JS không bao giờ bị chạy.

Chỉ đọc file đã theo dõi trong git, cả file code lẫn file config, và luật đề xuất cũng chỉ chạy thử
trên những file đó. Nhờ vậy file nháp chưa add trên máy ai đó không đổi được bản nháp hay kết luận. Dự
án nhiều repo thì đếm trong từng repo đã khai, và đọc config ở gốc lẫn trong từng repo. Repo lớn thì
tên file vẫn đếm hết, còn thụt lề, nháy và dấu chấm phẩy đọc từ 1.000 file lấy đều theo thứ tự tên,
mỗi file 64 KB đầu; bản nháp ghi rõ khi đã lấy mẫu như vậy.

Bản nháp mang một dấu nguồn: comment cuối file ghi dấu vân tay từng file config và số đếm sau mỗi
convention. Nó đi theo file khi người chuyển bản nháp vào `.knowledge/decided/`. Từ đó Compass tự so
lại ở mọi `init`, mọi lần gate `convention` chạy (tức mọi `check`) và trong mọi brief soi
code. Nó báo "có thể đã cũ" khi một file config đổi, bị xóa hay mới xuất hiện, hoặc khi code đã trôi
khỏi một convention đếm được. Gate vẫn pass, vì convention cũ không phải code sai.

`init` hay gate `convention` in một trong hai dòng sau thì làm ngay, **không chờ ai bảo**:

- `⚠ Chưa có .knowledge/decided/conventions.md`
- `⚠ .knowledge/decided/conventions.md có thể đã cũ`

Brief soi code thì chỉ ghi một lưu ý cho người soi ("convention đã khai có thể đã cũ"), để họ không
bắt code theo luật repo đã rời đi. Người soi không làm ba bước dưới đây: họ chỉ ghi `findings.json`.

1. Chạy `compass convention --draft` (thêm `--force` nếu bản nháp cũ còn đó).
2. Đưa người xem bản nháp. Repo đã có `conventions.md` thì chỉ ra chỗ bản nháp khác file đang dùng,
   kèm lý do Compass đưa ra, và mục "Cần người quyết".
3. Dừng và **chờ người duyệt**. Đây là luật 5: convention mâu thuẫn với code thì người chọn bên.
   **Không tự sửa `.knowledge/decided/`**; người duyệt tự chuyển file, hay bảo bạn chuyển.

Dòng đó hiện ngay sau `init` thì làm ba bước trên **trước khi viết spec**, để spec và code theo đúng
convention người vừa xác nhận. File `conventions.md` viết tay, không có dấu nguồn, chỉ được một dòng
nhắc rằng Compass không biết nó cũ hay chưa; không có gì để làm.

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

Lần chạy đầu tạo baseline trong `.compass/<id>/baseline/` (nhiều repo: `baseline/<repo>/`) và nói rõ là **chưa so gì cả**. Xem ảnh, thấy đúng thì commit vào git. Từ lần sau nó so pixel.

Vượt ngưỡng (mặc định 0.1%, chỉnh bằng `visualThreshold`) thì fail và ghi ảnh diff vào evidence — đỏ là chỗ đổi, mờ là chỗ giữ nguyên.

Thay đổi là cố ý thì xóa baseline cũ, chạy lại để chốt baseline mới.

**Giới hạn:** render chữ khác nhau giữa máy và CI làm gate đỏ vì lý do vặt. Ngưỡng phần trăm giảm bớt, không chữa được.

### Gate `review` — agent khác soi diff

Từ `feature-s` trở lên. Chạy hai pha.

```
compass review <id>          → sinh review-brief.md, exit 1
   ↓  đưa brief cho agent KHÁC
   ↓  agent ghi evidence/findings.json
compass review <id>          → đọc findings, phán
```

Brief có spec, diff, và phần ngữ cảnh máy dò từ repo. Không lịch sử chat, không lời giải thích của người viết — reviewer biết lý do sẽ cân nhắc lý do đó thay vì đọc code.

Người soi xét mười tiêu chí, mỗi cái một khóa:

| Khóa | Xét gì | Brief đưa thêm |
|---|---|---|
| `spec` | đúng từng case, không làm ngoài phạm vi | — |
| `convention` | theo convention của repo | `conventions.md` nguyên file; không có thì tối đa 2 file cùng thư mục để so |
| `impact` | chỗ khác đang dùng code vừa đổi | nơi gọi các tên export trong file bị sửa (chỉ JS và TS) |
| `tests` | test kiểm tra kết quả thật | — |
| `regression` | mỗi rủi ro hồi quy trong spec đã có test | — |
| `performance` | IO hay truy vấn trong vòng lặp, đọc cả file lớn | — |
| `security` | input không escape, đường dẫn thoát repo, lộ secret | — |
| `errors` | input rỗng, file hỏng, đường dẫn Windows | — |
| `reuse` | repo đã có helper làm việc này | export của module cùng thư mục |
| `docs` | tài liệu còn tả đúng hành vi | file Markdown nhắc tới file hay tên vừa đổi |

Ngữ cảnh dò bằng regex nên sót được và thừa được; brief nói thẳng điều đó, và rào nó như dữ liệu
bị soi, giống diff. Nội dung file `.env` không bao giờ vào brief. Mỗi mục có giới hạn (20 tên
export, 8 nơi gọi mỗi tên, 15 tài liệu, tổng 200 KB) và cắt chỗ nào thì nói cắt bao nhiêu.

Findings theo format cứng:

```json
{
  "brief": "<id trong brief>",
  "coverage": { "spec": { "verdict": "clean" }, "performance": { "verdict": "insufficient", "note": "spec không nói cỡ dữ liệu" } },
  "findings": [{ "severity": "Major", "criterion": "impact", "title": "...", "detail": "...", "file": "a.js", "line": 42 }]
}
```

`coverage` phải có kết luận cho **cả mười** khóa, thiếu một khóa là gate đỏ. Kết luận là `clean`
(đã xét, không thấy gì), `findings` (có ít nhất một finding mang khóa đó) hoặc `insufficient`
(brief không đủ dữ liệu, phải kèm `note`). Kết luận phải khớp với finding: `clean` mà có finding của
khóa đó, hay `findings` mà không có, đều đỏ. `insufficient` không chặn gate nhưng gate in ra; riêng
`spec` và `tests` không được `insufficient`, vì brief luôn có đủ spec và diff.

Mỗi finding mang `criterion`. Finding thuộc `convention` mang thêm `basis`: `declared` khi dựa vào
luật trong `conventions.md`, `inferred` khi suy ra từ code. Repo chưa khai convention mà ghi
`declared` là đỏ.

`Critical` và `Major` chặn gate. `Minor` và `Info` hiện ra nhưng không chặn. Không tìm thấy gì thì vẫn nộp đủ `coverage` với `"findings": []` — đừng bịa cho có.

Sửa code sau khi nộp findings thì gate **tự mở lại**: findings cũ nói về bản cũ, Compass sinh brief mới và bắt soi lại. Trường `brief` trong findings phải đúng id ghi trong brief — đó là thứ buộc một kết quả vào một bản code. Id băm cả spec, diff lẫn ngữ cảnh, nên khi chỉ ngữ cảnh đổi gate cũng mở lại, và nói rõ là ngữ cảnh đổi chứ không phải code đổi. Ngữ cảnh đổi riêng theo hai đường. Một là nâng cấp Compass: mẫu brief và cách dò ngữ cảnh nằm trong Compass, nên bản mới có thể ra brief khác cho đúng spec và diff cũ. Hai là task khai `Soi đến:`, tức là diff bị chốt ở một commit: ai đó sửa `conventions.md` sau commit đó thì gate báo ngữ cảnh đổi. Không khai `Soi đến:` thì diff đi tới cây làm việc, nên sửa `conventions.md` cũng là một phần của diff, và gate báo đúng là code hoặc spec đã đổi.

**Phạm vi soi.** Mặc định Compass so với điểm rẽ khỏi nhánh chính, hoặc commit đầu tiên nếu không có. Repo chỉ có đúng một commit thì Compass so với cây rỗng của git, nên chính commit đó cũng được soi, và gate `secrets` quét nó. Nhánh sống lâu thì phạm vi đó là cả dự án chứ không phải một task.

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

**Code nằm trong `.compass/` thì khai vào `Phạm vi`.** Diff của gate bỏ qua `.compass/**`, vì đó là spec,
sổ gate, brief — thứ gate tự ghi; đưa vào thì mỗi lần ghi sổ diff đổi và review tự mở lại. Nhưng công cụ
để ở `.compass/scripts/` cũng bị bỏ theo, và task làm chính công cụ đó nhận "0 file" mãi. Khai file đó
trong `Phạm vi:` (`.compass/scripts/x.mjs (mới)`) thì nó vào brief, có hay không có `Soi đến`, đã commit
hay chưa. `evidence/`, `review/`, `review-brief.md` và `.salt` thì không bao giờ vào, kể cả khi khai —
salt lọt vào brief gửi cho agent khác là lộ khoá ký.

Diff quá 2MB thì gate từ chối. Không ai đọc hết chừng đó, và gate xanh trên bản chưa đọc còn tệ hơn không có gate — chia task nhỏ ra.

### Cách Compass đếm test ID

**Chỉ dòng có dấu hiệu pass mới được tính.** Không phải cứ thấy ID trong output là xong.

| ID xuất hiện ở | Compass kết luận |
|---|---|
| Dòng pass (`ok N`, `✔`, `✓`, `PASS`) | đã chạy |
| Dòng fail / skip / error | "xuất hiện nhưng không pass" |
| Dòng không nhận ra định dạng | "không nhận diện được định dạng" |
| Hai dòng pass khác nhau, cùng ID | "không rõ cái nào của task này" |
| Dòng pass tên trần, trong khi task đã có test đặt tên kèm task id | "test tên trần không được tính" |

Các nhóm tách riêng vì đòi những việc khác nhau: viết test mới, bỏ skip, kiểm tra reporter, đặt lại tên.

**Reporter phải in tên từng test.** Chỉ in tên **file** thì mọi ID biến mất và gate báo thiếu dù
bạn đã viết đủ: `node --test` chạy sẵn, Vitest cần `--reporter=tap`, Jest cần `--verbose`.

**Một ID khớp nhiều test là đỏ.** Mọi spec đều dùng `H1`, `V1`, `EC1`, nên nhiều task chung một
suite thì gate không biết test nào của ai — task chưa viết gì vẫn qua. Đường thoát: đặt tên test
kèm task id, `test('T-12-H1 …')`. Chỉ đổi tên test của task đang làm.

**Đặt tiền tố thì đặt cho mọi test của task.** Luật: task đã đặt tên kèm task id thì test tên trần
không được tính. Chỉ cần một test `T-12-H1 …` pass, `S1 …` trần không còn được tính là S1 của T-12,
dù nó là dòng duy nhất mang S1. Test trần không cho biết nó của ai — trong suite chung, nó dễ là test
của task khác. Gate đỏ, in tên test bị bỏ, và bảo đổi thành `T-12-S1 …`. Task không đặt tiền tố nào
thì gate không có tín hiệu gì, và vẫn tính một dòng trần duy nhất — kể cả khi đó là test của task khác.

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
| `configHash` | `config.json` đổi sau khi gate `test` hay `secrets` chạy: lệnh test khác, hay danh sách `secretsPublic` khác |

Gate nào đọc code mà thiếu `sourceHash` thì bị coi là bản ghi cũ và bị chặn — không được miễn.

### Hai giới hạn còn lại

**Khôi phục cả code lẫn bản ghi.** Lưu `gate.json` lúc xanh, sửa code, rồi khôi phục **cả hai** về đúng trạng thái cũ — `done` xanh. Đúng ra là nên thế: code đó thật sự là code đã được kiểm tra. Chỗ hở thật nằm ở việc không có gì xâu chuỗi các lần chạy theo thời gian.

**`config.json` được tin.** Compass bắt được lệnh test **đổi sau** khi gate chạy, nhưng nếu ai sửa nó **trước** — trỏ sang một lệnh `echo` in ra TAP giả — thì không phát hiện được. Compass không phán được lệnh đó có phải test suite thật hay không.
`secretsPublic` cũng vậy: một file `.env` chứa khoá thật mà được khai public từ trước khi gate chạy
thì gate không quét nó. Dòng `ℹ` nêu tên từng file như thế. Dòng do chính task thêm thì brief soi
code đánh dấu **mới** và người soi báo `security`; dòng đã có ở gốc soi thì chỉ người duyệt config chặn.

Hai điều này chặn được **sai sót vô tình**, không chặn được **cố ý gian lận**. Đó là ranh giới, và bạn nên biết nó ở đâu.

## Soi PR của người khác

Gate `review` chỉ soi task của chính bạn. Được nhờ soi PR của đồng nghiệp thì dùng `compass pr`:

```
compass pr 123                       PR #123 trên GitHub, lấy bằng git fetch từ origin
compass pr feature/loc-quoc-gia      một nhánh, hay một sha
  --base=origin/develop              nhánh để so; mặc định origin/HEAD, rồi main, rồi master.
                                     Với số PR, chỉ base dạng origin/<nhánh> được fetch mới;
                                     base khác (develop) dùng bản local đang có
  --spec=ticket.md                   soi theo ticket; không có thì soi theo commit message
  --run-tests                        chạy test của PR
```

Hai pha như gate `review`:

1. `compass pr <ref>` sinh `.git/compass/pr/<key>/review-brief.md` rồi thoát mã 1. `<key>` là `pr-123`,
   `sha-<7 ký tự>`, hay tên nhánh. Tên nhánh có ký tự ngoài `A-Za-z0-9._-` (như `/`) hay có chữ hoa
   thì được đổi ký tự lạ thành `-` và kèm 6 ký tự băm: `feature/loc` thành `feature-loc-<6 ký tự>`.
   Lệnh in sẵn đường dẫn đúng.
2. Đưa brief cho một agent **khác**, không mang lịch sử phiên này. Agent đó ghi
   `.git/compass/pr/<key>/findings.json` theo đúng mười tiêu chí.
3. Chạy lại đúng lệnh cũ. Compass kiểm tra findings như gate `review`, rồi ghi `.git/compass/pr/<key>/report.md`
   để dán vào PR: kết luận, kết quả test, finding theo mức kèm file và dòng. Mã thoát 0 khi không có
   Critical hay Major và test (nếu chạy) pass.

Những điều cần biết:

- **Không đụng việc của bạn.** Diff là `điểm rẽ...đầu PR`, nên commit đã có trên nhánh gốc không lọt
  vào. Ngữ cảnh đọc từ một worktree tạm ở đầu PR, nằm ngoài repo và được gỡ đi kể cả khi lỗi. Branch,
  index và thay đổi chưa commit của bạn giữ nguyên. Brief, findings và báo cáo nằm trong thư mục git
  (`.git/compass/pr/`), không trong cây làm việc, nên không lên git và PR không chạm tới được. Trong
  một worktree phụ, thư mục đó là của repo chính; lệnh luôn in sẵn đường dẫn đúng.
- **Không có spec thì soi theo ý định có được.** Đưa ticket bằng `--spec`. Không có ticket thì brief
  dùng commit message của PR và nói rõ đó là tất cả những gì người soi có.
- **`--run-tests` chạy code của người khác.** Chỉ bật khi người dùng đồng ý, và nói rõ điều đó với họ.
  Lệnh test lấy từ `.compass/config.json` **đã commit ở đỉnh nhánh gốc** (`--base`), không từ PR
  và không từ đĩa — đứng trên nhánh PR thì file trên đĩa là của PR; sửa config thì commit lên nhánh
  gốc. Test chạy trong worktree tạm; khai
  `prSetup` (ví dụ `npm ci`) nếu cần cài trước. `prTestTimeout` (giây, mặc định 1.200) là một ngân
  sách chung cho cả `prSetup` lẫn test: quá hạn thì cả cây tiến trình bị dừng. Báo cáo kèm đoạn cuối
  output test, với đường dẫn trên máy đã được thay bằng `<repo>`, `<worktree>`, `~`; vẫn đọc lại
  trước khi dán lên PR. Không bật thì báo cáo ghi "chưa chạy", không bao giờ ngụ ý là đã pass.
- **PR đổi thì soi lại.** Đầu PR có commit mới thì brief đổi, findings cũ không còn khớp, và lệnh nói
  rõ "PR đã đổi".

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

`--close` chặn nếu thiếu bằng chứng, thiếu kết luận, thiếu pitfall, còn chữ mẫu, hay có khối code mở mà chưa đóng — lỗi nêu số dòng và tên mục. Đóng được thì pitfall tự chép vào `.knowledge/decided/pitfalls.md` — lần sau đọc được.

### Script và dữ liệu

Mọi file sinh ra lúc điều tra đều lưu vào `.compass/scripts/`, mỗi cái mở đầu bằng một dòng comment
nói nó làm gì. Đừng để ở `output/`: thư mục đó thuộc về một task và chứa thứ làm ra cho người dùng,
`compass scripts` không đọc tới, nên task sau không tìm thấy công cụ để ở đó.

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

`data/` được che sẵn vì query production trả về email và tên khách hàng. Compass viết
`.compass/.gitignore` gồm ba dòng `.salt`, `data/` và `review-brief.md`, dù `init` hay gate đầu tiên
chạm `.compass/` trước. `review-brief.md` là brief `compass review` sinh lại mỗi lần code đổi, đồ dùng
một lần; `findings.json` mới là bằng chứng và vẫn lên git. File chỉ có `.salt`, hoặc `.salt` và
`data/`, là file `init` bản cũ viết: `init` nâng nó lên và báo một dòng nói đúng dòng vừa thêm. File có nội dung khác là của bạn, Compass không sửa byte nào; nếu git nói `data/` chưa bị bỏ
qua, `init` cảnh báo và đưa dòng cần thêm — `data/`.

```
compass scripts        liệt kê những gì đã có
```

#### Một file `.sql`, nhiều query

Khuôn trên tính theo một script một kết quả. File `.sql` mười query thì cả mười cùng một `<việc>`,
nên khai tên ngay trên từng query — lúc bạn còn biết nó trả về cái gì:

```sql
-- Q0 — mỗi status có bao nhiêu đơn hàng?
-- @out: INV-4-q0-status-dist-0908.csv
select o.Status, count(*) from orders o group by o.Status;

-- Q1 — một khách hàng cụ thể. THAY <EMAIL> rồi chạy tay.
-- @out: -
select * from customers where Email = '<EMAIL>';
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

### Gate nào chạy theo repo

`convention`, `ui`, `visual` chạy lần lượt ở từng repo trong `Phạm vi`, mỗi repo một bản ghi ở khe
`<gate>@<repo>`: `convention@<repo>`, `ui@<repo>`, `visual@<repo>`. Gọi thẳng `compass convention <id>`
cũng đi qua từng repo như `check`, không bao giờ ghi một khe chung.

| Gate | Đo gì, ở đâu |
|---|---|
| `convention` | Chỉ file trong thư mục repo. Luật vẫn viết một lần ở `.knowledge/decided/conventions.md` của gốc; `scope` khớp cả đường dẫn tính từ repo (`src/**/*.jsx`) lẫn tính từ gốc (`fe/src/**/*.jsx`). Vi phạm in theo gốc để biết file nằm ở repo nào |
| `ui`, `visual` | Config đã gộp của repo (`dev`, `devUrl`, `devTimeoutMs`, `visualThreshold`). Dev server chạy **trong thư mục repo**, Playwright tìm từ thư mục repo — cài ở repo có giao diện |

Baseline của `visual` nằm ở `.compass/<id>/baseline/<repo>/<viewport>.png`, evidence ở
`.compass/<id>/evidence/repos/<repo>/`. Key `store/frontend` thành thư mục lồng. Tên repo đi vào đường
dẫn nên không được có đoạn rỗng, `.`, `..`, `\`, `:` hay `/` ở đầu — `ui`/`visual` từ chối trước khi ghi
gì. Dự án một repo giữ nguyên đường cũ: khe trần, `baseline/<viewport>.png`, `evidence/ui.json`.

`test` thì khác: nó chạy lệnh test từng repo, gộp output rồi đối chiếu ID **một lần**, nên vẫn ghi một khe
`test`.

### Repo con có git riêng

Mỗi repo có thể là một git riêng nằm dưới gốc (`be/.git`, `fe/.git`), còn gốc có git riêng chỉ theo dõi
`.compass/` hoặc không có git nào. Compass coi mỗi git là một đơn vị:

| Gate / lệnh | Làm gì với repo con có git riêng |
|---|---|
| `review` | Diff từng repo **trong `Phạm vi`** ngay trong git của nó, gộp vào một brief. Đường dẫn mang tiền tố repo (`be/b.js`), phần "Phạm vi" của brief có một dòng cho mỗi repo |
| `secrets` | Quét index và file chưa ignore của **mọi** repo trừ repo nằm ngoài gốc Compass bị bỏ qua, cả repo không nằm trong `Phạm vi`. Diff cũng của mọi repo; repo ngoài `Phạm vi` mà không khai gốc soi chỉ góp thay đổi chưa commit, đứng ở nhánh nào cũng vậy, còn repo trong `Phạm vi` được diff như `review` |
| `compass pr` | Dùng git chứa thư mục đang đứng: `cd be && compass pr 123`. Lệnh test của `--run-tests` lấy từ mục `repos.be` trong config của gốc, không bao giờ từ `.compass/config.json` mà PR commit |

Gốc soi của repo con khai riêng, vì sha của git gốc không có nghĩa gì trong git khác:

```
Gốc soi (be): abc1234
Soi đến (be): def5678
```

Hai dòng này nằm ở phần đầu spec, cạnh `Gốc soi:`. Config nhận `repos.be.reviewBase`; `reviewBase` ở phần
chung **không** áp cho repo con. `Soi đến (be):` thu hẹp diff của be theo các mục `be/…` trong `Phạm vi`.
`Gốc soi:` không ngoặc vẫn chỉ nói về git của gốc. Khai `Gốc soi (fe):` cho một repo dùng chung git với
gốc, hay cho repo không khai trong `repos`, là gate đỏ kèm lời chỉ cách khai đúng. Repo có git nằm ngoài
gốc (junction, đường dẫn trỏ ra ngoài), hay là một thư mục thường nằm ngoài gốc, bị từ chối khi nó nằm
trong `Phạm vi`: Compass không soi một git nó
không được giao. Ngoài `Phạm vi` thì cả hai gate bỏ qua nó, không đọc file chưa theo dõi nào git thấy
qua thư mục đó, và in một dòng `ℹ Bỏ qua repo "<tên>"`. Vì vậy `.env` trong repo đó không được quét. File
mà git của gốc (hay của repo con chứa nó) đã theo dõi dưới thư mục đó thì vẫn là file của git ấy, vẫn được
quét. Tên repo và `Phạm vi` so như hệ thống file của gốc so: không phân biệt hoa thường khi nó không phân biệt (Compass dò bằng chính thư mục `.compass`).

`Phạm vi` nhận cả tên repo (`web/x.js`) lẫn đường dẫn (`apps/web/x.js`). Repo khai trong `repos` mà chưa
clone thì `review` đỏ nếu nó nằm trong `Phạm vi`, và bỏ qua nếu không; `secrets` vẫn quét mọi repo còn lại.
`config.json` không đọc được mà có nhắc `repos` thì cả hai gate đỏ, vì không biết repo con nào cần quét.
Repo có `.git` mà git không đọc được (trên Windows hay gặp nhất là `safe.directory`) cũng làm cả hai gate
đỏ, dù `.git` đó nằm ngay trong repo, ở một thư mục cha dùng chung, hay là git của gốc: chạy
`git -C <thư mục> status` để xem git từ chối vì sao. Trừ khi repo đó nằm ngoài gốc Compass và ngoài
`Phạm vi`: khi ấy nó bị bỏ qua như mọi repo nằm ngoài gốc.

Hai giới hạn: file `.compass/` nằm trong repo con (`be/.compass/scripts/x.mjs`) không vào brief kể cả khi
khai trong `Phạm vi` — luật đó chỉ áp cho git của gốc. Và `compass pr` chạy trong repo con cần đọc được
`config.json` của gốc để biết repo đó là repo con; config hỏng thì lệnh báo không tìm thấy nhánh.

Bốn điều cần biết:

- **Dev server chạy trong thư mục repo**, không còn ở gốc. Lệnh `dev` chỉ chạy được từ gốc (`pnpm --filter
  fe dev`) mà khai ở phần chung thì giờ sẽ không lên — khai `dev` riêng trong repo.
- **Luật viết theo repo giờ có tác dụng.** `scope: src/**/*.jsx` trước đây không khớp file nào ở dự án
  nhiều repo, giờ khớp `src/` của mọi repo trong phạm vi — gate có thể đỏ trên code cũ. Đó là lần xanh giả
  biến mất.
- **Một hợp đồng thiết kế cho cả task.** `.compass/<id>/design-contract.json` được đo ở mọi repo khai
  `devUrl`. Hai frontend có DOM khác nhau trong một task thì chưa làm được — tách thành hai task.
- **Khe trần là bản ghi mốc.** Khe `convention`, `ui`, `visual` không mang tên repo (ghi trước khi khai
  `repos`, hay từ bản Compass cũ) không nói được đã đo repo nào. `done` báo nó và không tính, kể cả khi
  loại task không bắt buộc gate đó. Chạy lại `compass check <id>`: bản ghi theo repo thay hẳn khe trần.

### Dựng config cho dự án nhiều repo

```
compass init --multi
```

Lệnh này đọc các thư mục con và viết `repos` giúp bạn. Nó không nhận task id: nó dựng **config**,
không mở task. Chạy một lần lúc bắt đầu dự án, rồi `init <id> --type=` như thường.

Bốn lúc nó từ chối ghi, cả bốn cùng một lý do — một config sai tệ hơn không có config, vì người
dùng tin là nó đúng: config đã tồn tại (in cái dò được, để người tự gộp), không thấy repo con nào,
hai repo cùng tranh một `devUrl` (phải người chọn cổng, đoán thì `visual` chụp nhầm trang), và có
thư mục con nó đọc không ra — `package.json` hỏng, hay một dự án Go, Java, PHP cần bạn tự khai lệnh
test.

Lệnh đọc file chứ không chạy gì của dự án đích: một `scripts.test` chứa `&& rm -rf` đi vào config
nguyên văn như một chuỗi, không được thực thi lúc dò. Symlink bị bỏ qua hẳn, không đi theo.

Dò sai hay thiếu thì sửa tay theo bảng dưới — thông tin đều nằm sẵn trong file.

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

Năm luật khi viết:

1. **Không có `scripts.test`** → khai `"test": "echo 'chưa có test' && exit 1"`. Gate đỏ khi đụng tới,
   đúng như vậy — chưa có test thì chưa có bằng chứng. Đừng bỏ repo ra khỏi config.
2. **Không phải Node** (PHP, Java, Go) → vẫn khai, lệnh test của hệ đó. Compass không quan tâm ngôn ngữ,
   nó chỉ cần một lệnh và một mã thoát.
3. **Backend đừng khai `devUrl`** — khai vào thì `ui`/`visual` chạy oan rồi đỏ vì không có trang nào.
4. **Config đã có thì không ghi đè.** In ra cái vừa dò được, để người tự gộp.
5. **Repo lồng trong thư mục con** → key là đường dẫn: `"store/backend"`, `"store/frontend"`. Một thư
   mục cha chứa hai repo là chuyện thường; khai thành một entry thì lệnh test của một nửa sẽ sai.

Viết xong chạy `compass status` và **đọc kết quả cùng người dùng**. Đó là lúc bắt được lockfile đoán sai
hay repo bị bỏ sót — rẻ hơn nhiều so với phát hiện lúc gate đỏ giữa chừng.

## Giai đoạn hiện tại

Tám gate: `spec`, `knowledge`, `secrets`, `convention`, `test`, `ui`, `visual`, `review`.

Cộng knowledge base sinh tự động, lệnh `investigate`, config nhiều repo, và `check` chạy gate
theo từng repo.

Ở chế độ nhiều repo, mọi gate đều có bằng chứng đúng chỗ: `convention`, `ui`, `visual` đo từng repo và
ghi khe `<gate>@<repo>` (xem mục "Gate nào chạy theo repo"), `test` gộp mọi repo vào một khe `test`, còn
`spec`, `knowledge`, `secrets`, `review` chạy một lần ở gốc. `secrets` và `review` vẫn đọc git riêng của
từng repo con (xem mục "Repo con có git riêng").

`done` chỉ coi `convention`, `ui`, `visual` là xong khi **mọi** repo trong `Phạm vi` có khe riêng xanh —
hoặc, với `ui`/`visual`, khe bỏ qua hợp lệ mà `check` ghi cho repo không khai `devUrl`. Thiếu một repo,
hay config không đọc được, là "chưa chạy" — không có repo nào được ké bản ghi của repo khác, và khe trần
không bao giờ được dùng thay.

`compass knowledge --page` ghi `.knowledge/derived/index.html` — một file tự chứa, mở bằng trình
duyệt, không cần mạng. Tài liệu trong `decided/` nằm cạnh component máy quét, và component nào
`confident: false` thì dòng "đừng tin" nằm ngay cạnh nó, không phải ở cuối trang. Trang đọc
`components.json` chứ không quét lại: quét lại thì trang và gate có thể nói hai tập component khác
nhau, và lúc đó không ai biết tin cái nào.

Tài liệu trong `decided/` hiện nguyên văn, không render markdown — render nghĩa là sinh HTML từ text
của dự án đích, và một file `.md` chứa `<script>` sẽ chạy.

### Giới hạn còn lại của `done`

`done` đọc `gate.json` chứ không chạy lại test. Nó băm lại code và so với `sourceHash` của từng bản ghi, nên sửa code sau khi gate xanh thì `done` đỏ và bảo chạy lại `check`. Chỗ còn hở là khôi phục cả code lẫn bản ghi về một lúc xanh cũ — xem "Hai giới hạn còn lại". Chặn được sai sót vô tình, không chặn được cố ý.

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
