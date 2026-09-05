# Compass — Thiết kế hệ thống

**Ngày:** 2026-09-05
**Tác giả:** Thuyet Do (thiết kế cùng Claude)
**Trạng thái:** Đã xây xong cả bốn giai đoạn (2026-09-06). Chưa chạy thử trên codebase Nexus thật.

---

## 1. Vấn đề

Quy trình BMAD hiện tại (`BMAD-MEI/`) hoạt động, nhưng có 5 điểm đau đã xác nhận:

1. **Quá nhiều bước** — mọi task đi qua 4 conversation riêng, kể cả việc nhỏ
2. **AI báo xong khi chưa xong** — có validation gate nhưng AI tự chấm bài mình
3. **Phụ thuộc framework** — 42 skill gắn với BMAD, không mang sang Cursor/Gemini được
4. **Tài liệu phình to** — 6 file SOP + 11 file QA + CLAUDE.md, tự nó thành dự án phải bảo trì
5. **Tốn token** — mỗi task kéo cả rừng docs vào context

Cộng thêm 4 vấn đề phát sinh:

6. **Tiếng Việt khô khan** — AI giải thích code bằng cách dịch code thành lời, không giúp hiểu
7. **Task điều tra không có quy trình** — debug/investigate không có spec để viết, phải tự prompt
8. **Script điều tra mất tích** — viết tạm rồi vứt, tháng sau làm lại từ đầu
9. **Multi-repo phiền** — symlink cần admin, git đối xử kỳ lạ, phải chạy script setup

**Chẩn đoán gốc:** quy trình được xây bằng *tài liệu* thay vì bằng *cơ chế*. Tài liệu thì phình to,
tốn token, phụ thuộc framework, và quan trọng nhất — AI đọc rồi phớt lờ được.

---

## 2. Nguyên tắc thiết kế

| # | Nguyên tắc | Hệ quả |
|---|---|---|
| 1 | **Bằng chứng thay lời khai** | AI không tự tuyên bố kết quả; chỉ `compass` mới phán pass/fail |
| 2 | **Gate là máy, checkpoint là người** | Chỉ 1 điểm dừng bắt buộc cho người (sau spec); còn lại exit code |
| 3 | **Portable** | SKILL.md không nhắc framework nào; đặc thù dự án nằm ở config |
| 4 | **Co giãn theo task** | 1 entry point, tự chọn độ nặng; nghi ngờ thì nâng cấp, không hạ |
| 5 | **Kiến thức tách dẫn xuất / quyết định** | Dẫn xuất được thì máy sinh; không thì người viết |
| 6 | **Tích lũy thay vì bốc hơi** | Điều tra sinh pitfall; script có nơi ở cố định |

---

## 3. Kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│  SKILL.md          Quy trình AI phải theo               │
│                    (~250 dòng · portable)               │
└───────────────┬─────────────────────────────────────────┘
                │ AI gọi
                ▼
┌─────────────────────────────────────────────────────────┐
│  compass (CLI)     Chạy · Đo · Phán                     │
│                    Node thuần · không dependency        │
└───────┬─────────────────────────────────┬───────────────┘
        │ đọc                             │ ghi
        ▼                                 ▼
┌───────────────────┐           ┌─────────────────────────┐
│  .knowledge/      │           │  .compass/              │
│  Ngữ cảnh dự án   │           │  Trạng thái + bằng chứng│
└───────────────────┘           └─────────────────────────┘
```

### 3.1 Phân vai — điểm cốt lõi

| | AI | compass |
|---|---|---|
| Viết spec, code, test | ✅ | ❌ |
| **Chạy** test/lint/đo UI | ❌ | ✅ |
| **Ghi** kết quả vào evidence | ❌ | ✅ |
| **Phán** pass/fail | ❌ | ✅ |

AI không có đường chèn kết quả giả: nó chỉ được gọi lệnh, `compass` tự spawn process,
tự bắt exit code, tự ghi file.

### 3.2 Cấu trúc thư mục

```
<project>/                          ← hoặc thư mục cha cho multi-repo
├── .compass/
│   ├── config.json                 ← khai báo repo, lệnh test/lint/dev
│   ├── .salt                       ← gitignore; dùng ký gate record
│   ├── scripts/                    ← git-tracked; thư viện script điều tra
│   │   ├── graph/
│   │   ├── db/
│   │   └── README.md
│   ├── <task-id>/                  ← task BUILD
│   │   ├── spec.md
│   │   ├── design-contract.json    ← chỉ khi có Figma
│   │   └── evidence/
│   │       ├── gate.json
│   │       └── *.log
│   └── INV-<id>/                   ← task INVESTIGATE
│       ├── investigation.md
│       └── evidence/
│
└── .knowledge/
    ├── index.md                    ← bản đồ ~50 dòng
    ├── decided/                    ← người viết · git-tracked
    │   ├── conventions.md
    │   ├── domain.md
    │   ├── pitfalls.md
    │   └── decisions/NNN-*.md
    └── derived/                    ← máy sinh · gitignore
        ├── components.json
        ├── api.json
        ├── entities.json
        ├── structure.json
        └── .manifest
```

---

## 4. Hai loại công việc

### 4.1 BUILD — biết cần làm gì

```
compass init <id> --type=<loại>
     ↓  AI viết spec
compass spec                  ← gate: spec hợp lệ?
     ↓  NGƯỜI DUYỆT           ← checkpoint bắt buộc duy nhất
     ↓  AI code + test
compass check                 ← chạy mọi gate áp dụng
     ↓
compass done                  ← cổng cuối
```

### 4.2 INVESTIGATE — chưa biết vấn đề ở đâu

```
compass investigate <id>
     ↓  AI nêu giả thuyết + cách kiểm
     ↓  thăm dò (script lưu vào .compass/scripts/)
     ↓  bằng chứng → kết luận
compass investigate --close <id>
     ↓  bắt buộc ghi pitfall vào .knowledge/decided/pitfalls.md
     ↓  sinh task BUILD nếu cần sửa
```

**Ba luật cứng cho điều tra:**

1. Không sửa code khi đang điều tra — sửa là task BUILD riêng
2. Mỗi giả thuyết phải nêu trước cách kiểm, không "để tôi xem thử"
3. Kết luận phải có bằng chứng, không phải suy luận

---

## 5. Phân loại task và gate áp dụng

| Loại | Spec | Test tối thiểu | knowledge | convention | ui | visual | review |
|---|---|---|---|---|---|---|---|
| `fix` | 5 dòng | 2 | ✅ | – | – | – | – |
| `bug` | ngắn | 6 | ✅ | – | – | – | – |
| `feature-s` | vừa | 13 | ✅ | ✅ | ✅ | ✅ | – |
| `feature-m` | đủ | 21 | ✅ | ✅ | ✅ | ✅ | ✅ |
| `feature-l` | đủ | 30+ | ✅ | ✅ | ✅ | ✅ | ✅ |

Số tối thiểu kế thừa từ `qa-standards/01-qa-strategy.md`.

Bảng này khớp `lib/task-types.mjs` tính đến 2026-09-06. `fix` và `bug` không chạy `convention`
như bản thiết kế đầu dự tính: một sửa đổi hai dòng không đáng phải quét cả cây source, và
`convention` chỉ khớp mẫu theo dòng nên nó bắt được rất ít ở phạm vi đó.

**Nguyên tắc một chiều:** AI được nâng cấp loại task giữa chừng (phải chạy lại `compass spec`),
không bao giờ được hạ cấp.

Gate `knowledge` và `test` bắt buộc cho mọi loại.

---

## 6. SKILL.md

### 6.1 Luật tối cao

```
1. Không bao giờ tự tuyên bố kết quả. Chỉ compass mới phán pass/fail.
2. Không sửa gì trong evidence/ và derived/. Đó là vùng của máy.
3. Spec trước code. Không có spec đã duyệt thì không gõ dòng code nào.
4. Nghi ngờ độ lớn task → nâng cấp. Không bao giờ hạ cấp.
5. Knowledge base mâu thuẫn với code → DỪNG, hỏi người. Không tự chọn bên.
```

### 6.2 Bước 1 — Định hướng

Trình tự bắt buộc, chống tốn token:

```
1. compass knowledge          → docs còn hạn không? lỗi thời thì --sync
2. đọc .knowledge/index.md    → bản đồ ~50 dòng
3. chỉ nạp mảnh liên quan     → task BE không đụng components.json
4. đọc code thật của vùng sẽ sửa
```

Luật kèm theo: *Knowledge base cho biết **ở đâu** và **tại sao**. Code cho biết **thực tế là gì**.
Khi lệch nhau, code thắng về sự thật — nhưng phải báo người, không tự sửa docs.*

### 6.3 Bước 2 — Spec

Template do `compass init` sinh:

```markdown
# <task-id>: <tiêu đề>
Loại: fix | bug | feature-s | feature-m | feature-l
Phạm vi: <file/module sẽ đụng>

## Mục tiêu
<1-3 câu. Xong nghĩa là gì.>

## Ràng buộc
<không đổi API / backward compatible / theo ADR-002...>

## Rủi ro hồi quy
<tính năng cũ nào có thể vỡ — bắt buộc, không được để trống>

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | ... | ... | P0 |

## Hợp đồng UI  (chỉ khi có Figma)
→ sinh design-contract.json
```

Sáu lớp test kế thừa từ QA standards: Happy Path · Validation · Error & Exception ·
Edge Cases · Security · Performance.

`compass spec` kiểm bằng máy: đủ lớp theo loại task · đủ số tối thiểu · không còn `TBD` ·
mỗi case có ID và kỳ vọng đo được · phần rủi ro hồi quy không trống.

### 6.4 Bước 3 — Luật khi implement

```
- Mỗi test case trong spec = một test function, tên bắt đầu bằng ID (test_H1_...)
- Viết test trước, thấy nó đỏ, rồi mới implement
- KHÔNG test implementation detail (state nội bộ, snapshot lớn, mock chính mình)
- FE: query bằng role/text người dùng thấy, không bằng test-id nội bộ
- Convention không phải gợi ý — compass convention sẽ chặn
- Phát hiện task lớn hơn dự tính → cập nhật loại trong spec, chạy lại compass spec
```

### 6.5 Quy tắc diễn đạt tiếng Việt

**Phân tuyến ngôn ngữ:**
- Đối thoại, giải thích, báo cáo với người → **tiếng Việt**
- Spec, test name, commit message, code comment, tài liệu code → **tiếng Anh**

**Cấm:**
- Dịch code thành lời (*"gọi hàm X để lấy Y rồi trả về Z"*)
- Hán-Việt nặng khi có từ thuần Việt: "thực hiện việc kiểm tra" → "kiểm tra"
- Câu bị động kiểu Tây: "dữ liệu được xử lý bởi service" → "service xử lý dữ liệu"
- Dịch thuật ngữ đã quen: giữ nguyên *token, cache, race condition, deadlock*

**Bắt buộc:**
- Kể theo **dòng chảy dữ liệu**, không theo thứ tự file
- Nói cái quan trọng trước — đọc 3 câu đầu vẫn nắm được ý chính
- **Chỉ ra chỗ đáng ngờ** — giả định ngầm, nhánh không xử lý, chỗ dễ vỡ
- Ví dụ cụ thể thay vì mô tả trừu tượng
- Sơ đồ khi có từ 4 bước trở lên

**Ví dụ đối chiếu:**

> ❌ *"Service CalendarSyncService thực hiện việc đồng bộ hóa dữ liệu lịch từ Microsoft Graph API.
> Phương thức syncEvents được gọi để lấy danh sách sự kiện và sau đó dữ liệu được lưu trữ vào cơ
> sở dữ liệu thông qua repository."*

> ✅ *"Lịch được kéo về theo cron 15 phút một lần. Mỗi lần chạy, nó hỏi Graph API 'có gì đổi từ
> lần cuối không' bằng deltaToken lưu trong DB.*
> *Chỗ dễ vỡ: nếu deltaToken hết hạn (Microsoft cho 30 ngày), Graph trả 410 và code hiện tại
> **không bắt lỗi này** — nó sẽ throw, cron chết, và lịch ngừng sync âm thầm cho tới khi có người
> để ý."*

### 6.6 Red Flags

| AI nghĩ | Thực tế |
|---|---|
| "Task nhỏ, bỏ spec cho nhanh" | Nhỏ = spec ngắn, không phải không có spec |
| "Test pass rồi, chắc compass cũng pass" | Chưa chạy thì chưa biết gì cả |
| "Convention này không hợp ở đây" | Convention sai thì sửa conventions.md và báo người, không lách |
| "Docs lỗi thời chút không sao" | Docs lỗi thời = quyết định dựa trên thông tin sai |
| "Screenshot trông giống rồi" | Trông giống không phải bằng chứng. Đo số. |
| "Còn 1 test fail nhưng không liên quan" | Fail là fail |
| "Tôi sẽ sửa gate.json cho nhanh" | Hash sẽ lộ. Và đó là gian lận. |

---

## 7. Compass CLI

### 7.1 Lệnh

**Khởi tạo**
```
compass init <id> [--type=fix|bug|feature-s|feature-m|feature-l]
compass investigate <id>
compass investigate --close <id>
```

**Gate**
```
compass spec          spec hợp lệ chưa
compass knowledge     docs còn khớp code không   (--sync, --view)
compass convention    lint theo quy ước dự án
compass test          chạy test + đối chiếu với spec
compass ui            đo computed style vs design contract
compass visual        screenshot diff vs baseline
compass review        spawn agent độc lập soi diff
compass check         chạy mọi gate áp dụng    (--only=<gate>)
compass done          cổng cuối
```

**Tiện ích**
```
compass scripts --list
compass status
```

### 7.2 Gate record và chữ ký

```json
{
  "gate": "test",
  "command": "pnpm vitest run",
  "exitCode": 0,
  "startedAt": "2026-09-05T10:22:31.004Z",
  "durationMs": 8420,
  "outputHash": "sha256:a3f9...",
  "outputFile": "evidence/test.log",
  "sourceHash": "sha256:4d1c...",
  "specHash": "sha256:8e70...",
  "configHash": "sha256:2b55...",
  "sig": "sha256:7b2e..."
}
```

`sig` = hash(bản ghi + salt từ `.compass/.salt`). `compass done` tính lại mọi sig.

**Bịt cửa lách:**

| AI có thể thử | Bị chặn bởi |
|---|---|
| Sửa gate.json cho pass | sig không khớp |
| Chạy test rồi sửa code sau | `sourceHash` đổi → gate hết hiệu lực |
| Viết test rỗng cho đủ số | gate `test` kiểm assertion tồn tại |
| Sửa spec cho khớp cái đã làm | `specHash` đổi → phải duyệt lại |
| Trỏ test command sang `echo ok` | `configHash` đổi → cảnh báo |

**Giới hạn đã biết:** không chống được AI cố tình phá hoại (nó có shell, xóa được `.compass/`).
Mục tiêu là loại bỏ **đường tắt vô tình** — phần lớn "báo xong khi chưa xong" không phải nói dối
có chủ đích, mà là AI thật sự tin mình đã xong.

### 7.3 Gate `test` — đối chiếu spec

```
1. Đọc danh sách test ID từ bảng trong spec
2. Chạy test command với reporter JSON
3. Trích tên test đã chạy, tìm ID trong tên
4. So hai danh sách
```

Output khi fail:
```
✗ Gate test FAILED
  Spec khai báo 21 test cases, chỉ tìm thấy 14 test đã chạy.
  Thiếu: EC3, EC4, EC5, S2, S3, P1, P2
  → Viết test cho các case này, hoặc sửa spec nếu chúng không còn cần thiết
    (sửa spec sẽ cần duyệt lại).
```

### 7.4 Gate `ui` — đo thật, không nhìn ảnh

```
1. Khởi động dev server (từ config), đợi devUrl phản hồi
2. Playwright mở trang, tới selector trong design-contract
3. getComputedStyle() → số thật
4. So với dung sai:
     color, font-weight, font-size  → đúng tuyệt đối
     padding, margin, gap           → ±2px
     border-radius, line-height     → ±1px
5. Lặp cho từng viewport
```

Dung sai kế thừa từ `qa-standards/10-pixel-perfect-figma-workflow.md`.

Output là bảng số:
```
✗ Gate ui FAILED — 3/47 thuộc tính lệch
  OrderCard > container
    padding-right   design 20px      actual 16px      lệch 4px   ✗ (>2px)
  OrderCard > title
    color           design #111827   actual #333333              ✗ (phải đúng tuyệt đối)
```

**Vai trò của screenshot đổi:** không còn để AI tự đánh giá, mà là baseline diff (% pixel khác).
AI nhìn ảnh chỉ còn là tầng tham khảo, không phải gate.

### 7.5 Gate `review` — agent độc lập

Chỉ bật cho `feature-m` trở lên.

```
1. compass review sinh .compass/<id>/review-brief.md
   CHỨA:     diff thuần + spec + acceptance criteria
   KHÔNG chứa: lịch sử chat, lý do AI đã làm thế, giải thích của nó
2. AI host spawn subagent với brief đó
3. Subagent trả findings theo format cứng → ghi vào evidence/
4. Findings mức Critical/Major → gate fail
```

Subagent không thấy quá trình → không bị thiên vị công sức. Đây là Blind Hunter của BMAD,
nhưng bắt buộc và tự động.

### 7.6 `compass check` — điều phối

Chạy rẻ trước, đắt sau, dừng ngay khi fail:

```
knowledge (0.2s) → convention (3s) → test (10s) → ui (30s) → visual (20s) → review (~60s + token)
```

---

## 8. Knowledge Base

### 8.1 Phân loại — nguyên tắc gốc

| Loại | Là gì | Ai viết |
|---|---|---|
| **Derived** | Dẫn xuất được từ code: props, endpoint, entity, cấu trúc | **Máy sinh**, verify được còn khớp |
| **Decided** | Không dẫn xuất được: lý do chọn X, quy ước, nghiệp vụ, bài học | **Người viết**, sống lâu |

Bộ tài liệu cũ trộn hai loại vào một file — đó là lý do nó vừa khó cập nhật vừa dễ sai.

### 8.2 `index.md` — bản đồ, không phải nội dung

~50 dòng. AI đọc trước, rồi mới biết nạp mảnh nào. Đây là cơ chế chống tốn token.

```markdown
# Knowledge Map — nexus-app-frontend

| Cần biết gì | Đọc |
|---|---|
| Component có sẵn, props gì | derived/components.json |
| Quy ước code | decided/conventions.md |
| Tại sao chọn công nghệ X | decided/decisions/ |
| Thuật ngữ nghiệp vụ | decided/domain.md |
| Bẫy đã từng sập | decided/pitfalls.md |

## Ranh giới
- Frontend chỉ nói chuyện với BE qua REST + WebSocket
- State: Jotai (client) / React Query (server) — xem ADR-001

Cập nhật lần cuối: 2026-09-05 · Trạng thái derived: ✅ khớp code
```

### 8.3 `conventions.md` — vai trò kép

Người đọc để hiểu, máy đọc để thi hành. Khối ` ```rule ` là phần máy parse:

````markdown
### Không hardcode màu
Dùng semantic token để theme đổi được.

✅ `tw="text-text-primary"`
❌ `tw="text-[#333333]"`

```rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}"
scope: jsx-attribute:tw,css
severity: error
```
````

`compass convention` parse các khối này → sinh ESLint config tạm → chạy lint.

**Viết một lần, một chỗ** — vừa là tài liệu vừa là luật. Không phải duy trì song song
docs và eslint config.

Quy ước mềm (kiểu "nên tách logic ra hook") cứ để dạng văn bản — AI vẫn đọc, chỉ là không có gate.
Không ép mọi thứ thành máy kiểm.

### 8.4 `derived/` — parser tĩnh, không LLM

Đọc AST TypeScript. Chạy vài giây, tốn 0 token.

**components.json** — quét `src/components/shared/**`:
```json
{
  "MEButton": {
    "path": "src/components/shared/Button/index.tsx",
    "import": "~root/components/shared/Button",
    "props": {
      "variant": { "type": "'primary'|'secondary'|'tertiary'", "default": "'primary'" },
      "size": { "type": "'tiny'|'small'|'medium'|'large'", "default": "'medium'" }
    },
    "usedIn": 47
  }
}
```

`props` trích từ type definition thật → không bao giờ lệch code.
`usedIn: 0` → component chết.

**api.json** — quét NestJS decorator:
```json
{
  "POST /mastercontact/search": {
    "module": "mastercontact",
    "file": "src/modules/mastercontact/controller.ts:88",
    "auth": "JwtAuthGuard",
    "body": "SearchContactPayload",
    "returns": "PaginatedResponse<MasterContactDto>"
  }
}
```

**.manifest** — hash mọi file nguồn đã quét:
```json
{
  "generatedAt": "2026-09-05T10:00:00Z",
  "sources": {
    "src/components/shared/Button/index.tsx": "sha256:9f2a..."
  }
}
```

**Phạm vi GĐ đầu:** chỉ TypeScript/JS (React + NestJS). Ngôn ngữ khác để `derived/` trống,
skill vẫn chạy dựa `decided/` + đọc code trực tiếp. Cấu trúc `derived/*.json` là điểm cắm sẵn —
thêm ngôn ngữ sau chỉ cần viết script sinh JSON cùng định dạng.

### 8.5 Chống lỗi thời — chữa bệnh gốc

```
compass knowledge
```
```
✗ Knowledge lỗi thời — 3 file nguồn đã đổi sau lần sinh cuối
  src/components/shared/Button/index.tsx      (đổi 2 giờ trước)
  src/modules/mastercontact/controller.ts     (đổi hôm qua)
  → Chạy: compass knowledge --sync
```

`compass done` **gọi gate này**. Sửa component xong không regen → task không đóng được.

Khác biệt căn bản với `document this project`: cái cũ là *nhớ thì chạy*,
cái này là *không chạy thì không xong việc*.

`derived/` gitignore. `compass` tự chạy `--sync` khi phát hiện chưa có → người mới clone
không phải nhớ gì.

### 8.6 Ba tầng tin cậy

```
1. code thật              → SỰ THẬT. Luôn thắng.
2. derived/ (còn hạn)     → tin được. Dùng định vị nhanh, khỏi quét cả repo.
3. decided/               → tin về LÝ DO và RÀNG BUỘC.
4. derived/ (lỗi thời)    → CẤM dùng. --sync trước đã.

Khi decided/ mâu thuẫn với code:
   DỪNG. Báo người. Không tự chọn bên, không tự sửa docs.
```

Lý do luật cuối: ví dụ `conventions.md` nói "luôn dùng MEButton" nhưng code mới có 3 chỗ
dùng `<button>` thuần. Hai khả năng — quy ước đã đổi mà chưa cập nhật, hoặc ai đó làm sai.
AI không có cách nào biết cái nào đúng. Đoán bừa là hỏng.

### 8.7 Trang trực quan — `compass knowledge --view`

HTML tĩnh, mở bằng browser, không cần server.

| Tab | Nội dung |
|---|---|
| Bản đồ hệ thống | Sơ đồ module + quan hệ từ `structure.json`; click để xem chi tiết |
| Component | Bảng tìm kiếm: tên, props, path, `usedIn` (sắp xếp được → thấy code chết) |
| API | Endpoint, method, auth guard, payload, response; nhóm theo module |
| Quyết định | Timeline ADR: ngày, bối cảnh, quyết định, hệ quả, còn hiệu lực không |
| **Sức khỏe** | Nơi hệ thống đang mục ruỗng |

Tab Sức khỏe:
```
Trạng thái đồng bộ    ✅ khớp code
Sinh lần cuối         2 giờ trước

⚠️  Component không ai dùng            3
⚠️  API không có test                  7
⚠️  Quy ước bị vi phạm                12
📌 ADR quá 12 tháng chưa xem lại       2
📌 Vùng code 6 tháng không ai đụng     4
```

Đây là thứ đọc markdown không bao giờ thấy được.

---

## 9. Thư viện script điều tra

```
.compass/scripts/          ← git-tracked, dùng lại được
├── graph/
│   ├── list-calendar-delta.ts
│   └── compare-event-times.ts
├── db/
│   └── find-orphan-contacts.sql
└── README.md              ← script nào làm gì, chạy sao
```

**Luật:**
- Script sinh trong lúc điều tra **phải** lưu vào đây, không viết tạm rồi vứt
- Mỗi script có header: mục đích, cách chạy, env cần, lần cuối dùng
- Script **chỉ đọc** theo mặc định; script ghi phải có cờ `--write` và hỏi lại
- `compass scripts --list` liệt kê → lần sau AI tìm thấy và dùng lại thay vì viết mới

---

## 10. Multi-repo — phân giải theo tầng

Bỏ symlink. `compass` tìm ngược lên trên cho tới khi gặp `.compass/config.json`,
rồi **gộp** kiến thức theo tầng — repo riêng đè lên chung, giống cách ESLint config hoạt động.

```
MEI/                              ← đứng ở đây
├── .knowledge/                   ← kiến thức DÙNG CHUNG
│   └── decided/
│       ├── conventions.md
│       └── domain.md
├── .compass/
│   ├── config.json
│   └── scripts/
│
├── nexus-app-backend/
│   └── .knowledge/               ← kiến thức RIÊNG (đè lên chung)
│       ├── decided/conventions.md
│       └── derived/api.json
│
└── nexus-app-frontend/
    └── .knowledge/
        ├── decided/conventions.md
        └── derived/components.json
```

`config.json`:
```json
{
  "repos": {
    "nexus-app-backend":  { "kind": "nestjs", "test": "yarn test", "lint": "yarn lint" },
    "nexus-app-frontend": { "kind": "react",  "test": "pnpm test", "dev": "pnpm dev",
                            "devUrl": "http://localhost:5173" }
  }
}
```

**So với symlink:** không cần admin · không cần script setup · clone về là chạy ·
task cross-repo được hỗ trợ tự nhiên · vẫn đứng ở thư mục cha như thói quen hiện tại.

`compass check` chạy gate ở đúng repo mà task đụng (đọc từ `Phạm vi` trong spec):
```
compass check
  → nexus-app-backend:  convention ✓  test ✓
  → nexus-app-frontend: convention ✓  test ✓  ui ✓  visual ✓
  → review (cross-repo, xem cả hai diff) ✓
```

---

## 11. Vòng phản hồi: điều tra → kiến thức

```
INV-xxx kết luận nguyên nhân gốc
      ↓
compass investigate --close INV-xxx
      ↓
Bắt buộc ghi một mục vào .knowledge/decided/pitfalls.md
```

```markdown
## Graph API deltaToken hết hạn im lặng

**Gặp:** 2026-09-05 · INV-014 · Lịch khách hàng X sai
**Triệu chứng:** cron chạy nhưng lịch ngừng cập nhật, không log lỗi
**Nguyên nhân:** deltaToken sống 30 ngày. Hết hạn → Graph trả 410.
CalendarSyncService.syncEvents() không bắt 410, throw, cron chết âm thầm.
**Vùng ảnh hưởng:** src/modules/outlook/calendar-sync.service.ts
**Phòng tránh:** bắt 410 → xóa token → full sync lại
```

Lần sau AI đụng vào `outlook/` sẽ đọc được. Kiến thức tích lũy thay vì bốc hơi.

---

## 12. Đối chiếu điểm đau

| Đau | Chữa bằng |
|---|---|
| 1. Quá nhiều bước | 1 entry point · 1 checkpoint người · gate còn lại là máy |
| 2. AI báo xong khi chưa xong | compass tự chạy tự đo tự ghi · gate.json có chữ ký |
| 3. Phụ thuộc BMAD | SKILL.md không nhắc framework · đặc thù ở config.json |
| 4. Docs phình to | 17 file → 1 SKILL + knowledge tách derived/decided |
| 5. Tốn token | index.md là bản đồ · derived sinh bằng parser không LLM |
| 6. Tiếng Việt khô khan | Mục quy tắc diễn đạt trong SKILL.md |
| 7. Điều tra không có quy trình | Loại task INVESTIGATE |
| 8. Script mất tích | `.compass/scripts/` git-tracked |
| 9. Symlink phiền | Phân giải theo tầng |

---

## 13. Lộ trình

Mỗi giai đoạn **dùng được ngay** — không phải xây hết mới chạy.

> **Trạng thái 2026-09-06:** cả bốn giai đoạn đã đi hết. Bảy gate chạy được, 504 test.
> Bốn chỗ làm khác thiết kế và lý do: xem [ghi chú GĐ 2](../notes/2026-09-05-phase-2-notes.md)
> và [ghi chú GĐ 3-4](../notes/2026-09-06-phase-3-4-notes.md).
>
> Còn nợ: `check` chạy gate ở nhiều repo (GĐ 4 mới làm phần phân giải cấu hình),
> `derived/api.json` và `entities.json`, trang `--view`, và chạy thử trên codebase Nexus thật.

### GĐ 1 — Bộ xương
- `SKILL.md` bản đầu
- `compass`: `init` · `spec` · `test` · `check` · `done`
- `gate.json` + chữ ký
- `config.json` một repo

→ Có spec-first + gate cứng cho test. **Chạy thử trên một task thật ở Nexus.**

### GĐ 2 — Frontend
- `compass convention` (parse ```rule``` → ESLint)
- `compass ui` (Playwright đo computed style)
- `compass visual` (screenshot diff)
- `design-contract.json` từ Figma

→ FE có gate cứng ngang BE.

### GĐ 3 — Knowledge
- Parser sinh `components.json` · `api.json` · `entities.json` · `structure.json`
- `.manifest` + gate lỗi thời
- `--view` trang HTML
- Template `decided/`

→ Docs không lỗi thời được nữa.

### GĐ 4 — Điều tra & multi-repo
- `compass investigate` + template
- `.compass/scripts/` + `compass scripts`
- Phân giải theo tầng, bỏ symlink
- `compass review` (adversarial agent)

→ Thay thế hoàn toàn BMAD hiện tại.

---

## 14. Rủi ro và điều chưa chắc

Thiết kế này **chưa được kiểm chứng thực tế**. Những chỗ đáng ngờ nhất:

| Rủi ro | Biểu hiện nếu sai | Xử lý |
|---|---|---|
| Gate quá chặt → cản trở hơn giúp đỡ | Bực mình, muốn bỏ qua compass | GĐ 1 chạy thử task thật; nới dung sai nếu cần |
| AI tự phân loại task sai | feature-m bị làm như fix | Nguyên tắc một chiều + spec gate; theo dõi ở GĐ 1 |
| Parser derived không đủ chính xác | props trích sai, AI dùng sai | GĐ 3 test trên codebase Nexus thật trước |
| `compass ui` quá giòn (selector đổi là vỡ) | Gate fail liên tục vì lý do vặt | Cân nhắc gắn selector vào data-attribute ổn định |
| Overhead cho task nhỏ | `fix` mà vẫn phải init/spec/check | Đo thời gian thật ở GĐ 1; rút gọn nếu quá nặng |

**Nguyên tắc xử lý:** GĐ 1 là thử nghiệm. Chạy trên task thật, đo, rồi mới quyết giữ hay bỏ
từng cơ chế. Spec này là điểm xuất phát để sửa, không phải cam kết cuối.
