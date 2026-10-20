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

### Gate review

Từ `feature-s`, gate `review` cần một người soi khác bạn:

1. `compass review <id>` sinh `.compass/<id>/review-brief.md`, rồi thoát với mã 1.
2. Mở một phiên Codex mới, không mang lịch sử chat của phiên này, đưa nó file brief. Brief có
   spec, diff và ngữ cảnh máy dò từ repo; người soi không cần biết lý do bạn viết như vậy.
3. Phiên đó xét mười tiêu chí ghi trong brief và ghi kết quả vào
   `.compass/<id>/evidence/findings.json`, với một kết luận cho từng tiêu chí.
4. Chạy lại `compass review <id>` để gate đọc kết quả.

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
