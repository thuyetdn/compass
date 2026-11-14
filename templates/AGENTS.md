## Quy trình Compass

Dự án này dùng [Compass](https://github.com/thuyetdn/compass): mọi lời "xong" phải có bằng chứng do
máy chạy ra. Bạn viết spec, code và test. Lệnh `compass` chạy test, đối chiếu với spec và phán pass
hay fail. Bạn không tự phán.

`compass` đã được cài sẵn trên máy (`npm install -g github:thuyetdn/compass`). Gõ thẳng
`compass <lệnh>` trong terminal.

### Năm luật không được phá

1. **Không bao giờ tự tuyên bố kết quả.** Chỉ `compass` mới phán pass/fail. Báo hoàn thành thì dán
   output của `compass done`.
2. **Không sửa gì trong `evidence/`.** Đó là vùng của máy. Không mở, không sửa, không chép
   `gate.json` từ task này sang task khác: bản ghi có chữ ký, sửa tay là bị bắt.
3. **Spec trước code.** Không có spec đã duyệt thì không gõ dòng code nào.
4. **Nghi ngờ độ lớn task → nâng cấp.** Không bao giờ hạ cấp.
5. **Knowledge base mâu thuẫn với code → DỪNG, hỏi người.** Không tự chọn bên.

### Vòng đời một task

```
compass init <id> --type=<loại>     tạo .compass/<id>/spec.md
                                    bạn điền spec
compass spec <id>                   gate: spec hợp lệ?
                                    DỪNG. Đưa spec cho người duyệt và chờ họ nói tiếp.
                                    viết test trước, thấy đỏ, rồi mới implement
compass check <id>                  chạy mọi gate áp dụng, dừng ở gate đỏ đầu tiên
compass done <id>                   cổng cuối, chỉ exit 0 mới được báo hoàn thành
```

Điểm dừng sau `compass spec` là bắt buộc. Gate spec xanh không có nghĩa là người đã duyệt.

Gate đỏ thì sửa rồi chạy lại `compass check`. Không bỏ qua, không giải thích vòng vo, không báo
"gần xong". Sửa code sau khi gate xanh thì `compass done` sẽ đỏ và bảo chạy lại, vì bằng chứng cũ
nói về bản code cũ.

### Loại task

| Loại | Dùng khi | Test tối thiểu | Lớp bắt buộc |
|---|---|---|---|
| `fix` | typo, 1-2 dòng, không đổi hành vi | 2 | Happy |
| `bug` | sửa lỗi có nguyên nhân rõ | 6 | Happy, Validation, Error, Edge |
| `feature-s` | tính năng nhỏ, 1 module | 13 | Happy, Validation, Error, Edge, Security |
| `feature-m` | tính năng vừa, nhiều module | 21 | Happy, Validation, Error, Edge, Security, Performance |
| `feature-l` | tính năng lớn, cross-repo | 30 | Happy, Validation, Error, Edge, Security, Performance |

Nghi ngờ giữa hai loại thì chọn loại nặng hơn.

### Đặt tên test

Mỗi test case trong spec có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`) và đúng một test function mang
ID đó. Đặt tên kèm task id để gate biết test nào của task nào khi nhiều task dùng chung một suite:

```js
test('CP-12-H1 thêm một việc', () => { ... });
```

Một tên test chỉ mang một ID. Reporter phải in tên từng test: `node --test` chạy sẵn, Vitest cần
`--reporter=tap`, Jest cần `--verbose`.

### Preflight và môi trường

`compass check` chạy gate `preflight` trước `test`: các lệnh khai trong `"preflight"` của config, và
kiểm tra migration đã có ở gốc soi bị sửa (`"migrations"`). Preflight đỏ thì `review` không sinh brief.
Migration đã áp thì viết migration mới; chỉ người duyệt mới thêm được dòng
`Ngoại lệ migration: <đường dẫn> — <lý do>` vào spec. Preflight cũng soi tuyên bố: đường dẫn, SHA và tên
hàm trong inline code của dòng tài liệu bạn thêm và của spec phải có thật. Sai thì sửa tài liệu; chỉ người
duyệt mới thêm được dòng `Tuyên bố ngoài repo: <span> — <lý do>`. Từ `feature-m`, spec cần mục `## Môi trường`:
bảng `| Sự thật | Nguồn | Ngày |`, hay một dòng `Không áp dụng: <lý do>`.

### Mutation

Từ `feature-s`, config khai `"mutation": { "test": "<lệnh test nhanh>" }` thì `compass check` chạy gate
`mutation` sau `test`: mỗi dòng code đổi nhiều nhất một mutant, chạy trong worktree tạm. Mutant sống không
làm gate đỏ mà vào brief vòng 1. Bạn không phán mutant của chính mình: người soi trả lời từng cái bằng một
finding `"mutant": "M3"` (criterion `tests`) hay một mục `"mutants": [{ "id", "verdict": "equivalent", "reason" }]`.
Mutation khai mà chưa xanh trên code hiện tại thì `review` không sinh brief.

### Gate review

Từ `feature-s`, gate `review` cần một người soi khác bạn:

1. `compass review <id>` sinh `.compass/<id>/review-brief.md`, rồi thoát với mã 1.
2. Mở một phiên Codex mới, không mang lịch sử chat của phiên này, đưa nó file brief. Brief có
   spec, diff và ngữ cảnh máy dò từ repo; người soi không cần biết lý do bạn viết như vậy.
3. Phiên đó xét mười tiêu chí ghi trong brief và ghi kết quả vào
   `.compass/<id>/evidence/findings.json`, với một kết luận cho từng tiêu chí. Mỗi finding có `id`
   và `disposition` (`fix`, hay `kept` kèm lý do) theo rubric trong brief.
4. Chạy lại `compass review <id>` để gate đọc kết quả. Gate đỏ khi còn finding `fix`.
5. Sửa các finding `fix`, mỗi bản sửa kèm test đỏ trước, xanh sau, rồi chạy lại `compass review <id>`. Vòng 2 chỉ kiểm tra bản sửa: Compass
   sinh brief mới gồm diff của bản sửa và các finding đang chờ, đưa cho một phiên mới như bước 2.
   Đừng xóa `findings.json`; phiên soi ghi đè nó, bản cũ đã nằm trong sổ cái.
   Phiên soi đóng từng finding bằng một closure. Bản sửa thêm hay đổi code (`narrow`, `reuse`,
   `mechanism`) phải nêu `redTest`: tên đầy đủ của test phủ nó, và test đó phải pass trong log của
   gate `test` hiện tại. Không có test để nêu (sửa tài liệu) thì `redTest: null` kèm `note`. Gỡ cơ chế
   (`revert`) không cần test. `rerunBy` (không bắt buộc) ghi lens đã chạy lại trên diff của bản sửa.

Config khai `"reviewLenses": { "feature-m": ["matrix", "deploy"] }` thì mỗi lens là một phiên soi riêng, ghi
`.compass/<id>/evidence/findings/<lens>.json` thay cho `findings.json`; brief nêu đúng tên từng file. Compass
gộp các file: id finding không trùng giữa các file, coverage lấy kết luận nặng nhất. Thiếu file của một lens
đã khai thì gate đỏ; có cả `findings.json` lẫn thư mục `findings/` là lỗi.

Giữ phạm vi đứng yên khi đang soi: yêu cầu mới thành task riêng. Sửa một finding thì ưu tiên gỡ hay
thu hẹp hơn là thêm cơ chế. Chuỗi lỗi sửa tới lần thứ ba thì gỡ cơ chế, hay hỏi người. Vòng 4 cần
dòng `Vòng soi tối đa: 4 — <lý do>` của người trong spec; Major giữ lại cần dòng `Chấp nhận <id>#<vân tay>: <lý do>` gate in ra.

### Convention thiếu hoặc đã cũ

`compass init` hay `compass check` in `⚠ Chưa có .knowledge/decided/conventions.md` hoặc
`⚠ … có thể đã cũ` thì làm ngay, không chờ ai bảo, và trước khi viết spec. Phiên đang soi code theo
một brief thì không làm việc này; nó chỉ ghi `findings.json`.

1. Chạy `compass convention --draft` (thêm `--force` nếu bản nháp cũ còn đó).
2. Đưa người xem `.compass/conventions-draft.md`, chỉ ra chỗ khác với file đang dùng.
3. Chờ người duyệt. Không tự sửa `.knowledge/decided/`.

Dự án nhiều repo: gate `convention` đỏ vì "Repo `be` chưa có convention đã duyệt" (hay `init`,
`status`, `done`, `compass pr` in dòng đó) thì **dừng và hỏi người dùng** có tạo bản nháp theo 12 tiêu
chí không. Đồng ý thì:

1. Chạy `compass convention --draft --repo=be`. Bản nháp ở `.compass/conventions-draft/be.md`.
2. Đọc các file mẫu bản nháp liệt kê, trả lời từng tiêu chí trong mục "Agent đọc và viết". Mỗi ý kèm
   một file trong repo làm bằng chứng, trong dấu backtick; không thấy thì ghi "Không thấy trong repo".
   Hai kiểu viết lẫn lộn thì thành một dòng `- [ ]`. Trả lời xong thì xóa dòng `compass-fill`.
3. Đưa người dùng duyệt bản nháp và từng dòng `- [ ]`.
4. Người dùng xác nhận thì chạy `compass convention --approve --repo=be`. Không chạy trước khi họ đồng ý.

Dòng `⚠ Gốc chưa có convention đã duyệt` thì làm ba bước phía trên, với `compass convention --draft`;
gốc chỉ được nhắc, không bị chặn. Ở workspace nhiều repo, bản nháp chung đề xuất luật như
`scope: **/*.js`: luật đó khớp file của repo con, nên nhận vào `conventions.md` của gốc là gate đỏ.
Chỉ ra điều đó khi đưa người duyệt; luật cho repo con soạn bằng `--draft --repo=<repo>`.

### Soi PR của người khác

`compass pr <số PR | nhánh>` soi một PR theo cùng mười tiêu chí, không đụng branch hay cây làm việc
của bạn. Nó sinh `.git/compass/pr/<key>/review-brief.md` rồi thoát mã 1. Đưa brief cho một phiên Codex
mới, phiên đó ghi `findings.json` cạnh brief, rồi chạy lại cùng lệnh để ra `report.md` dán vào PR.
Chỉ thêm `--run-tests` khi người dùng đồng ý: nó chạy code của người viết PR trên máy này. `--preflight` cũng
vậy: nó chạy lệnh `"preflight"` của config nhánh gốc trên code của PR (sau `prSetup` nếu có khai), đỏ thì
không sinh brief.
`--since=<sha>` soi lại PR sau khi người viết sửa: diff chỉ từ `<sha>` tới đầu PR, và brief liệt kê findings
của báo cáo lần trước để phiên soi kiểm tra.

### Khi chưa biết lỗi ở đâu

`compass investigate <id>` mở hồ sơ điều tra. Không sửa code trong lúc điều tra. Mỗi giả thuyết nêu
cách kiểm tra trước khi kiểm tra. Kết luận phải dẫn về bằng chứng.

### Đọc thêm

Quy trình đầy đủ, gồm chi tiết từng gate, cấu hình nhiều repo và cách viết luật convention:

```
<thư mục npm toàn cục>/compass/skills/compass/SKILL.md
```

Lấy đường dẫn thư mục npm toàn cục bằng `npm root -g`. File đó viết cho Claude Code nên mở đầu bằng
cách gọi lệnh qua một biến môi trường của Claude; ở đây cứ gõ `compass`.
