# Bẫy đã từng sập

Mỗi mục đến từ một điều tra đã đóng.

## INV-1: Gate visual đỏ khi chạy sau gate ui, chạy riêng thì xanh

**Gặp:** 2026-09-05 · INV-1 · gate `visual` đỏ sau gate `ui`
**Triệu chứng:** hai gate cùng dùng dev server, gate sau đỏ chập chờn với ERR_CONNECTION_REFUSED; chạy riêng thì xanh
**Nguyên nhân:** `child.exitCode !== null` không có nghĩa cây tiến trình đã chết. `npm run dev` là cmd → npm → vite, shell thoát trước con.
**Vùng ảnh hưởng:** lib/dev-server.mjs
**Phòng tránh:** giết theo cây (`taskkill /t`), và **đợi** nó chết trước khi trả về. Đừng suy ra trạng thái cây tiến trình từ exit code của tiến trình gốc.

## INV-2: Gate test xanh cho task chưa viết dòng test nào

**Gặp:** 2026-09-06 · INV-2 · gate `test` xanh cho CP-14, task chỉ sửa tài liệu
**Triệu chứng:** gate báo đủ test đã chạy cho một task chưa viết dòng test nào; nhìn output thấy tên test lạ hoắc
**Nguyên nhân:** định danh dùng để đối chiếu (`H1`, `V1`) không định danh được thứ nó đối chiếu. 14 task chung một bộ ID, gate không nhận tham số nào cho biết task nào đang chạy.
**Vùng ảnh hưởng:** lib/test-parser.mjs, commands/test.mjs, lib/spec-validator.mjs
**Phòng tránh:** khi một gate đối chiếu hai danh sách, hỏi trước "định danh này có duy nhất trong phạm vi đối chiếu không". Nếu không thì gate đang đo thứ khác với thứ nó tưởng. Ở đây phạm vi là cả suite, mà ID chỉ duy nhất trong một spec.

## CP-15: Định danh so bằng chuỗi con thì tiền tố nuốt nhau

**Gặp:** 2026-09-06 · CP-15 · blind review vòng 1
**Triệu chứng:** task `CP-1` được ghi nhận đã chạy test mà `CP-15` viết; `CP-15` thì bị từ chối chính test của nó
**Nguyên nhân:** `line.includes(taskId)` không có biên. `CP-1` là chuỗi con của `CP-15`, và đường dẫn `.compass/CP-15/evidence` in trong output cũng đủ trao quyền sở hữu.
**Vùng ảnh hưởng:** lib/test-parser.mjs
**Phòng tránh:** định danh phải so theo biên, và phải so ở **đúng vị trí nó có nghĩa**. `CP-15` đứng trước ID là lời khai sở hữu; `CP-15` nằm trong đường dẫn thì không. Hỏi "chuỗi này ở đâu trên dòng thì mới mang ý nghĩa tôi cần" trước khi viết `includes`.

## CP-15: Gọt chuỗi để đoán ý tác giả thì sai mãi

**Gặp:** 2026-09-06 · CP-15 · blind review vòng 1, 2 và 3
**Triệu chứng:** ba vòng soi liên tiếp, mỗi vòng tìm ra một lỗi do bản vá vòng trước tạo ra — đều ở cùng một regex
**Nguyên nhân:** cố tách "thời gian chạy reporter in thêm" khỏi "tên tác giả đặt" bằng cách nhận dạng chuỗi. Bắt hẹp thì sót định dạng reporter khác (Vitest in một khoảng trắng, không phải hai). Bắt rộng thì ăn mất tên thật (`H1 backoff - 5s` và `- 2s` là hai test). Không có ranh giới nào đúng, vì thông tin cần thiết không nằm trong dòng text.
**Vùng ảnh hưởng:** lib/test-parser.mjs
**Phòng tránh:** khi vá lần thứ ba vào cùng một chỗ, dừng lại hỏi "dữ liệu tôi có đủ để trả lời câu hỏi này không". Nếu không đủ thì đừng đoán khéo hơn — hãy đổi câu hỏi. Ở đây câu trả lời là bỏ hẳn việc gộp: chỉ coi hai dòng là một khi chúng **y hệt nhau**, và chấp nhận báo đụng độ oan với retry. Sai mà kêu lên, kèm cách sửa, thì hơn sai mà im.

## CP-15: `split('\n')` là lỗ CRLF ẩn

**Gặp:** 2026-09-06 · CP-15 · blind review vòng 2
**Triệu chứng:** trên Windows, retry hợp lệ bị báo đụng độ; cùng output với LF thì xanh
**Nguyên nhân:** `\r` còn sót cuối mỗi dòng, nên mọi regex neo bằng `$` đều trượt. Tách dòng bằng `split('\n')` trông vô hại nên không ai soi.
**Vùng ảnh hưởng:** lib/test-parser.mjs, và mọi chỗ đọc output tiến trình hay file
**Phòng tránh:** `split(/\r?\n/)`, luôn luôn. Lớp lỗi này đã vá ở investigation parser rồi vẫn tái phát ở file khác — vá một chỗ không miễn nhiễm cho chỗ còn lại. Test dựng dữ liệu bằng `join('\n')` không bao giờ bắt được nó.

## CP-15: Nhận dạng vai trò một dòng bằng một ký tự thì tên test cũng có ký tự đó

**Gặp:** 2026-09-06 · CP-15 · blind review vòng 5 tới 8
**Triệu chứng:** mỗi vòng thêm một nhánh đọc định dạng reporter, vòng sau tìm ra nhánh đó tự mở một lỗ mới. Bốn vòng liên tiếp, cùng một hình mẫu.
**Nguyên nhân:** hỏi "dòng này là gì" bằng một dấu hiệu đơn lẻ. `PASS ` ở đầu → tiêu đề file Jest, nhưng `PASS H1 my test` là dòng test. `{` ở cuối → khối chứa Vitest, nhưng `H1 parses a block {` là tên test. `#` giữa dòng → chú thích TAP, nhưng `H1 handles # hash` là tên test. Tên test do người đặt, nên **mọi** ký tự đều có thể xuất hiện trong đó.
**Vùng ảnh hưởng:** lib/test-parser.mjs
**Phòng tránh:** đòi bằng chứng cấu trúc, không đòi một ký tự. Dòng tiêu đề Jest phải trông giống đường dẫn; dòng container Vitest phải có cả `# time=…` lẫn `{`; chú thích TAP phải đúng dạng máy in. Và mỗi lần thêm một nhánh nhận dạng, hỏi ngay: "tên test nào sẽ vô tình khớp nhánh này".

## CP-15: Mutation test qua heredoc cho kết quả giả

**Gặp:** 2026-09-06 · CP-15 · vòng soi 10, và cả người soi lẫn người sửa đều mắc
**Triệu chứng:** mutation báo "chết" hàng loạt nên tưởng test có răng; hoặc báo "sống sót" nên tưởng test rỗng nghĩa. Cả hai đều sai.
**Nguyên nhân:** shell nuốt dấu `\` trong heredoc. Chuỗi cần thay không khớp gì cả → không phá được gì → test xanh → đọc thành "mutation sống sót". Hoặc chuỗi thay vào thành syntax error → mọi test đỏ → đọc thành "mutation chết".
**Vùng ảnh hưởng:** mọi phép mutation testing, và mọi lần sửa file nguồn bằng heredoc
**Phòng tránh:** viết script ra file `.mjs` rồi chạy, đừng nhét vào heredoc. Ghép ký tự đặc biệt bằng `String.fromCharCode(92)`. Và luôn **in ra dòng trước/sau khi thay** — thấy nó đổi đúng chỗ mới tin kết quả. Cùng phiên này, lỗi đó làm hỏng ba phép đo và suýt để lọt hai lỗ thật.

## CP-15: Test so hai vế cùng đi qua một hàm là phép kiểm rỗng

**Gặp:** 2026-09-06 · CP-15 · vòng soi 9 và 10, cùng một test hai lần
**Triệu chứng:** test CRLF xanh kể cả khi `split(/\r?\n/)` bị đổi thành `split('\n')` — đúng con bug nó sinh ra để canh
**Nguyên nhân:** test so `extractRanIds(crlf)` với `extractRanIds(lf)`. Hàm sai thì cả hai vế sai giống nhau, và phép so vẫn bằng. Lần sửa đầu thêm khẳng định tuyệt đối nhưng fixture không chạm regex nào neo `$`, nên vẫn rỗng.
**Vùng ảnh hưởng:** test/test-parser.test.mjs, và mọi test dạng "hai đầu vào phải cho cùng kết quả"
**Phòng tránh:** khẳng định **giá trị tuyệt đối** trước, so hai vế sau. Và fixture phải chạm đúng chỗ code có thể vỡ — ở đây là ba regex neo cuối dòng, không phải một dòng TAP bất kỳ. Cách kiểm duy nhất đáng tin: phá code, xem test có đỏ không.

## CP-10: Ngưỡng thời gian tuyệt đối không canh được hiệu năng

**Gặp:** 2026-09-06 · CP-10 · blind review sau khi đổi tên test
**Triệu chứng:** test khai "quét xong dưới 5 giây" xanh, trong khi gate chạy bậc hai — 120 file 91ms nhưng 960 file gần 4 giây
**Nguyên nhân:** ngưỡng chọn theo cỡ dữ liệu test, không theo cỡ dữ liệu thật. 120 file chạy 25ms nên còn dư 200 lần trước khi chạm 5 giây; code chậm đi 20 lần vẫn xanh.
**Vùng ảnh hưởng:** mọi test hiệu năng
**Phòng tránh:** đo **hình dạng**, không đo tốc độ. Chạy hai cỡ dữ liệu rồi so tỉ số: gấp bốn số file mà thời gian gấp bốn là tuyến tính, gấp mười sáu là bậc hai. Tỉ số không phụ thuộc máy nhanh hay chậm, nên vừa canh được vừa không chập chờn.

## CP-11: Fixture phải đi tới được chỗ cần kiểm

**Gặp:** 2026-09-06 · CP-11 · blind review
**Triệu chứng:** test khai "chỉ đọc header, không đọc cả file" xanh kể cả khi xoá sạch giới hạn header
**Nguyên nhân:** fixture đặt chuỗi đánh dấu sau một khối code 200KB. Hàm đọc header dừng ở dòng không-comment đầu tiên, nên nó thoát ngay tại khối code đó — chuỗi đánh dấu không bao giờ tới được, bất kể đọc bao nhiêu byte.
**Vùng ảnh hưởng:** test/investigate-command.test.mjs, và mọi test dựng dữ liệu lớn
**Phòng tránh:** hỏi "đường nào dẫn từ đầu vào tới chỗ tôi đang khẳng định". Ở đây phải để phía trước toàn dòng trống thì hàm mới đi tiếp được. Cách kiểm duy nhất đáng tin vẫn là phá code rồi xem test có đỏ không.

## CP-6: Loại trừ đường dẫn neo ở gốc thì thư mục lồng vẫn lọt

**Gặp:** 2026-09-06 · CP-6 · blind review sau khi đổi tên test
**Triệu chứng:** review pass, rồi một project lồng ghi bản ghi gate của nó, và review ở ngoài mở lại — đúng thứ EC5 sinh ra để cấm
**Nguyên nhân:** `EXCLUDED = ['.compass/']` dùng `startsWith`, pathspec dùng `:(exclude).compass/**` — cả hai neo ở gốc repo. Chính repo này có `examples/todo/.compass/`.
**Vùng ảnh hưởng:** lib/review-brief.mjs, và mọi chỗ loại trừ đường dẫn
**Phòng tránh:** hỏi "thư mục này có thể nằm ở cấp nào". Tên như `.compass`, `node_modules`, `dist` xuất hiện ở mọi cấp, nên phải khớp cả `a/b/.compass/` chứ không riêng `.compass/`. Và nếu có hai lớp chặn thì ghi rõ — mutation một lớp sẽ sống sót, và người sau dễ tưởng test rỗng nghĩa.

## CP-6: Cột "Kỳ vọng" chép lại tên test thì spec không nói gì thêm

**Gặp:** 2026-09-06 · CP-6 · blind review
**Triệu chứng:** 26 dòng spec mới có mô tả chép nguyên tên test tiếng Anh và kỳ vọng ghi "Đúng như mô tả"
**Nguyên nhân:** thêm ca vào spec cho khớp test đã viết, thay vì viết ca rồi mới viết test. `spec-parser` không kiểm cột này nên gate không chặn.
**Vùng ảnh hưởng:** mọi spec, và cách bổ sung ca sau khi đổi tên hàng loạt
**Phòng tránh:** cột "Kỳ vọng" phải nói **kết quả đo được**, khác với cột "Mô tả". "Gate exit 0 nhưng vẫn in ra finding đó" là kỳ vọng; "Đúng như mô tả" không phải. Khi hai ca kiểm cùng chuyện ở hai tầng, nói rõ tầng nào — "ở tầng parser (H3 kiểm cùng ca ở tầng gate)".

## CP-10: Đo hình dạng vẫn sai nếu đo ở thang quá nhỏ

**Gặp:** 2026-09-06 · CP-10 · blind review vòng hai, sau khi đã sửa một lần
**Triệu chứng:** test khai "không phải bậc hai" xanh, trong khi code vẫn bậc hai. Đo lại ở thang lớn hơn: 1000 file 143ms, 4000 file 2238ms — tỉ số 15.7.
**Nguyên nhân:** vòng sửa đầu bỏ được thừa số **đắt** (bóc chuỗi lại cho từng cặp) nhưng giữ vòng lồng component × file. Hệ số nhỏ đi nên ở 150→600 file tỉ số chỉ 2.9 — số hạng bậc hai chưa kịp trội, và test chọn đúng khoảng đó.
**Vùng ảnh hưởng:** lib/knowledge-scan.mjs, và mọi test đo hình dạng
**Phòng tránh:** đo hình dạng đúng hơn đo ngưỡng, nhưng phải chọn thang mà số hạng xấu đã trội. Cách kiểm: chạy ba mốc chứ không phải hai, xem tỉ số có ổn định không. Tỉ số 2.9 rồi 6.8 rồi 10.2 là đường cong đang cong lên — không phải tuyến tính có nhiễu.

## CP-11: Chữ mẫu vẫn là chữ mẫu khi có dấu đầu dòng

**Gặp:** 2026-09-06 · CP-11 · blind review vòng hai
**Triệu chứng:** hồ sơ điều tra để nguyên năm dòng chữ mẫu, chỉ thêm `- ` phía trước, và `--close` cho qua rồi chép cả năm dòng vào knowledge base
**Nguyên nhân:** regex nhận chữ mẫu neo `^` vào nhãn `**Gặp:**`, nên `- **Gặp:** <...>` trượt. Bullet-hoá một danh sách năm dòng là thói quen markdown bình thường.
**Vùng ảnh hưởng:** lib/investigation-parser.mjs
**Phòng tránh:** khi khớp một dòng markdown, hỏi "người ta có thể thêm gì ở đầu dòng mà vẫn là cùng nội dung". Dấu đầu dòng, số thứ tự, thụt lề, dấu trích dẫn — đều là cách viết bình thường của cùng một thứ.

## CP-6: Nhánh thoát quên ghi sổ là một đường cho verdict cũ sống sót

**Gặp:** 2026-09-06 · CP-6 · blind review vòng bốn
**Triệu chứng:** review đỏ (exit 1) nhưng `gate.json` vẫn ghi `exitCode: 0`, và `done` đóng task bình thường
**Nguyên nhân:** pha hai có bốn nhánh thoát, chỉ một nhánh gọi `writeGate`. `done` đọc sổ chứ không chạy lại gate, nên nhánh nào quên ghi là nhánh đó để nguyên verdict xanh của lần trước. Gate `review` lại không có `sourceHash` nên vòng kiểm của `done` không bắt bù được.
**Vùng ảnh hưởng:** commands/review.mjs, và mọi gate có nhiều nhánh thoát
**Phòng tránh:** đếm nhánh `return` trong một gate, rồi đếm lời gọi `writeGate`. Hai số phải khớp. Và test phải khẳng định `readGate(...).exitCode`, không chỉ khẳng định exit code của lệnh — hai thứ đó lệch nhau chính là chỗ lỗ nằm.

## CP-13: Một lệnh có hai đường vào thì cả hai phải hiểu như nhau

**Gặp:** 2026-09-06 · CP-13 · blind review chỉ-đọc
**Triệu chứng:** `check` báo repo `fe` đỏ; chạy `compass test <id>` thì xanh và ghi đè đúng khe đó; `done` đóng task. Repo `fe` chưa từng xanh và không còn dấu vết.
**Nguyên nhân:** `check` truyền danh sách repo cho `testCommand`, `cli.mjs` thì không. Cùng một hàm, hai đường vào, hai hành vi — và đường không biết repo ghi đè bằng chứng của đường biết.
**Vùng ảnh hưởng:** commands/test.mjs, cli.mjs
**Phòng tránh:** để hàm tự nạp thứ nó cần thay vì trông chờ nơi gọi đưa. Sửa ở `cli.mjs` thì đường vào thứ ba sẽ lại quên; sửa trong hàm thì không đường nào quên được.

## CP-11: Vá một trong bốn cách viết không phải là vá

**Gặp:** 2026-09-06 · CP-11 · hai vòng soi liên tiếp, cùng một chỗ
**Triệu chứng:** vòng một tìm ra chữ mẫu bullet-hoá lọt qua; vá xong, vòng hai tìm ra đánh số, blockquote, checkbox vẫn lọt y hệt
**Nguyên nhân:** vá đúng ca reviewer nêu thay vì hỏi "còn cách viết nào của cùng nội dung". Comment tôi viết lúc vá còn nói rõ "bullet-hoá là thói quen bình thường" — nhưng không đi tiếp câu đó.
**Vùng ảnh hưởng:** lib/investigation-parser.mjs, và mọi regex khớp dòng markdown
**Phòng tránh:** khi vá một cách viết, liệt kê hết họ hàng của nó trước khi sửa. Markdown mở đầu dòng bằng: dấu đầu dòng `-*+`, đánh số `1.` `2)`, checkbox `- [ ]`, trích dẫn `>`, và tổ hợp. Viết một hằng dùng chung, đừng nhồi vào từng regex — chỗ nào quên là chỗ đó lọt.

## CP-16: Khe mang tên repo rơi giữa hai vòng kiểm

**Gặp:** 2026-09-06 · CP-16 · blind review chỉ-đọc, vòng cuối
**Triệu chứng:** bản ghi `test@be` đỏ với hash tươi, `done` vẫn xanh và đóng task
**Nguyên nhân:** vòng gate-bắt-buộc tra khoá trần `test`; vòng gate-ngoài-danh-sách thấy `test` nằm trong `required` rồi `continue`. Không vòng nào đọc `exitCode` của khe `test@be`.
**Vùng ảnh hưởng:** commands/done.mjs
**Phòng tránh:** khi một khoá có hai dạng (trần và mang hậu tố), đừng để hai vòng chia nhau bằng "tên gate có bắt buộc không" — chia bằng chính khoá. Ở đây điều kiện đúng là `name === ten && required.includes(ten)`. Và mỗi lần thêm một vòng duyệt sổ, chép cả chốt `if (!record)` sang: ba vòng cũ đều có, vòng mới thiếu là chỗ crash.

## CP-4: Khớp tiền tố không đủ cho tên CSS ghép

**Gặp:** 2026-09-06 · CP-4 · blind review lần đầu
**Triệu chứng:** `row-gap` nhận dung sai 0px thay vì 2px, nên `12px` lệch `12.5px` bị báo drift dù spec cho ±2px
**Nguyên nhân:** `property.startsWith(name)` chỉ bắt tiền tố. Tên CSS ghép bằng dấu gạch và phần quyết định nằm ở bất kỳ đoạn nào: `row-gap`, `min-width`, `border-top-width`.
**Vùng ảnh hưởng:** lib/tolerance.mjs
**Phòng tránh:** khớp theo **đoạn** tên, và khi nhiều tên cùng khớp thì chọn tên cụ thể nhất — không chọn tên gặp trước. Duyệt theo thứ tự khai báo thì một lần sắp xếp lại danh sách là đổi hành vi.
