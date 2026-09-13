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

## CP-15: Test so hai vế cùng đi qua một hàm là phép kiểm tra rỗng

**Gặp:** 2026-09-06 · CP-15 · vòng soi 9 và 10, cùng một test hai lần
**Triệu chứng:** test CRLF xanh kể cả khi `split(/\r?\n/)` bị đổi thành `split('\n')` — đúng con bug nó sinh ra để canh
**Nguyên nhân:** test so `extractRanIds(crlf)` với `extractRanIds(lf)`. Hàm sai thì cả hai vế sai giống nhau, và phép so vẫn bằng. Lần sửa đầu thêm khẳng định tuyệt đối nhưng fixture không chạm regex nào neo `$`, nên vẫn rỗng.
**Vùng ảnh hưởng:** test/test-parser.test.mjs, và mọi test dạng "hai đầu vào phải cho cùng kết quả"
**Phòng tránh:** khẳng định **giá trị tuyệt đối** trước, so hai vế sau. Và fixture phải chạm đúng chỗ code có thể vỡ — ở đây là ba regex neo cuối dòng, không phải một dòng TAP bất kỳ. Cách kiểm tra duy nhất đáng tin: phá code, xem test có đỏ không.

## CP-10: Ngưỡng thời gian tuyệt đối không canh được hiệu năng

**Gặp:** 2026-09-06 · CP-10 · blind review sau khi đổi tên test
**Triệu chứng:** test khai "quét xong dưới 5 giây" xanh, trong khi gate chạy bậc hai — 120 file 91ms nhưng 960 file gần 4 giây
**Nguyên nhân:** ngưỡng chọn theo cỡ dữ liệu test, không theo cỡ dữ liệu thật. 120 file chạy 25ms nên còn dư 200 lần trước khi chạm 5 giây; code chậm đi 20 lần vẫn xanh.
**Vùng ảnh hưởng:** mọi test hiệu năng
**Phòng tránh:** đo **hình dạng**, không đo tốc độ. Chạy hai cỡ dữ liệu rồi so tỉ số: gấp bốn số file mà thời gian gấp bốn là tuyến tính, gấp mười sáu là bậc hai. Tỉ số không phụ thuộc máy nhanh hay chậm, nên vừa canh được vừa không chập chờn.

## CP-11: Fixture phải đi tới được chỗ cần kiểm tra

**Gặp:** 2026-09-06 · CP-11 · blind review
**Triệu chứng:** test khai "chỉ đọc header, không đọc cả file" xanh kể cả khi xoá sạch giới hạn header
**Nguyên nhân:** fixture đặt chuỗi đánh dấu sau một khối code 200KB. Hàm đọc header dừng ở dòng không-comment đầu tiên, nên nó thoát ngay tại khối code đó — chuỗi đánh dấu không bao giờ tới được, bất kể đọc bao nhiêu byte.
**Vùng ảnh hưởng:** test/investigate-command.test.mjs, và mọi test dựng dữ liệu lớn
**Phòng tránh:** hỏi "đường nào dẫn từ đầu vào tới chỗ tôi đang khẳng định". Ở đây phải để phía trước toàn dòng trống thì hàm mới đi tiếp được. Cách kiểm tra duy nhất đáng tin vẫn là phá code rồi xem test có đỏ không.

## CP-6: Loại trừ đường dẫn neo ở gốc thì thư mục lồng vẫn lọt

**Gặp:** 2026-09-06 · CP-6 · blind review sau khi đổi tên test
**Triệu chứng:** review pass, rồi một project lồng ghi bản ghi gate của nó, và review ở ngoài mở lại — đúng thứ EC5 sinh ra để cấm
**Nguyên nhân:** `EXCLUDED = ['.compass/']` dùng `startsWith`, pathspec dùng `:(exclude).compass/**` — cả hai neo ở gốc repo. Chính repo này có `examples/todo/.compass/`.
**Vùng ảnh hưởng:** lib/review-brief.mjs, và mọi chỗ loại trừ đường dẫn
**Phòng tránh:** hỏi "thư mục này có thể nằm ở cấp nào". Tên như `.compass`, `node_modules`, `dist` xuất hiện ở mọi cấp, nên phải khớp cả `a/b/.compass/` chứ không riêng `.compass/`. Và nếu có hai lớp chặn thì ghi rõ — mutation một lớp sẽ sống sót, và người sau dễ tưởng test rỗng nghĩa.

## CP-6: Cột "Kỳ vọng" chép lại tên test thì spec không nói gì thêm

**Gặp:** 2026-09-06 · CP-6 · blind review
**Triệu chứng:** 26 dòng spec mới có mô tả chép nguyên tên test tiếng Anh và kỳ vọng ghi "Đúng như mô tả"
**Nguyên nhân:** thêm case vào spec cho khớp test đã viết, thay vì viết case rồi mới viết test. `spec-parser` không kiểm tra cột này nên gate không chặn.
**Vùng ảnh hưởng:** mọi spec, và cách bổ sung case sau khi đổi tên hàng loạt
**Phòng tránh:** cột "Kỳ vọng" phải nói **kết quả đo được**, khác với cột "Mô tả". "Gate exit 0 nhưng vẫn in ra finding đó" là kỳ vọng; "Đúng như mô tả" không phải. Khi hai case kiểm tra cùng chuyện ở hai tầng, nói rõ tầng nào — "ở tầng parser (H3 kiểm tra cùng case ở tầng gate)".

## CP-10: Đo hình dạng vẫn sai nếu đo ở thang quá nhỏ

**Gặp:** 2026-09-06 · CP-10 · blind review vòng hai, sau khi đã sửa một lần
**Triệu chứng:** test khai "không phải bậc hai" xanh, trong khi code vẫn bậc hai. Đo lại ở thang lớn hơn: 1000 file 143ms, 4000 file 2238ms — tỉ số 15.7.
**Nguyên nhân:** vòng sửa đầu bỏ được thừa số **đắt** (bóc chuỗi lại cho từng cặp) nhưng giữ vòng lồng component × file. Hệ số nhỏ đi nên ở 150→600 file tỉ số chỉ 2.9 — số hạng bậc hai chưa kịp trội, và test chọn đúng khoảng đó.
**Vùng ảnh hưởng:** lib/knowledge-scan.mjs, và mọi test đo hình dạng
**Phòng tránh:** đo hình dạng đúng hơn đo ngưỡng, nhưng phải chọn thang mà số hạng xấu đã trội. Cách kiểm tra: chạy ba mốc chứ không phải hai, xem tỉ số có ổn định không. Tỉ số 2.9 rồi 6.8 rồi 10.2 là đường cong đang cong lên — không phải tuyến tính có nhiễu.

## CP-11: Chữ mẫu vẫn là chữ mẫu khi có dấu đầu dòng

**Gặp:** 2026-09-06 · CP-11 · blind review vòng hai
**Triệu chứng:** hồ sơ điều tra để nguyên năm dòng chữ mẫu, chỉ thêm `- ` phía trước, và `--close` cho qua rồi chép cả năm dòng vào knowledge base
**Nguyên nhân:** regex nhận chữ mẫu neo `^` vào nhãn `**Gặp:**`, nên `- **Gặp:** <...>` trượt. Bullet-hoá một danh sách năm dòng là thói quen markdown bình thường.
**Vùng ảnh hưởng:** lib/investigation-parser.mjs
**Phòng tránh:** khi khớp một dòng markdown, hỏi "người ta có thể thêm gì ở đầu dòng mà vẫn là cùng nội dung". Dấu đầu dòng, số thứ tự, thụt lề, dấu trích dẫn — đều là cách viết bình thường của cùng một thứ.

## CP-6: Nhánh thoát quên ghi sổ là một đường cho verdict cũ sống sót

**Gặp:** 2026-09-06 · CP-6 · blind review vòng bốn
**Triệu chứng:** review đỏ (exit 1) nhưng `gate.json` vẫn ghi `exitCode: 0`, và `done` đóng task bình thường
**Nguyên nhân:** pha hai có bốn nhánh thoát, chỉ một nhánh gọi `writeGate`. `done` đọc sổ chứ không chạy lại gate, nên nhánh nào quên ghi là nhánh đó để nguyên verdict xanh của lần trước. Gate `review` lại không có `sourceHash` nên vòng kiểm tra của `done` không bắt bù được.
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
**Nguyên nhân:** vá đúng case reviewer nêu thay vì hỏi "còn cách viết nào của cùng nội dung". Comment tôi viết lúc vá còn nói rõ "bullet-hoá là thói quen bình thường" — nhưng không đi tiếp câu đó.
**Vùng ảnh hưởng:** lib/investigation-parser.mjs, và mọi regex khớp dòng markdown
**Phòng tránh:** khi vá một cách viết, liệt kê hết họ hàng của nó trước khi sửa. Markdown mở đầu dòng bằng: dấu đầu dòng `-*+`, đánh số `1.` `2)`, checkbox `- [ ]`, trích dẫn `>`, và tổ hợp. Viết một hằng dùng chung, đừng nhồi vào từng regex — chỗ nào quên là chỗ đó lọt.

## CP-16: Khe mang tên repo rơi giữa hai vòng kiểm tra

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

## CP-32: Quét trạng thái xong rồi quét lại bằng regex là tự mở lại lỗ vừa bịt

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 1
**Triệu chứng:** một dòng `-- @out: -` nằm trong khối comment `/* … */` được tính là khai báo thật, và ghi đè khai báo đúng ở trên. Gate xanh cho một file kết quả không tồn tại và không hề bị đòi.
**Nguyên nhân:** hàm tách câu lệnh theo dõi cẩn thận chuỗi và comment để biết `;` nào là ranh giới thật. Rồi hàm tìm khai báo **vứt hết trạng thái đó đi**, quét lại từng dòng bằng regex. Mọi công sức phân biệt code với comment mất sạch ở lần quét thứ hai.
**Vùng ảnh hưởng:** lib/query-outputs.mjs, và mọi chỗ có hai lần quét trên cùng một văn bản
**Phòng tránh:** một lần quét, trả về mọi thứ người gọi cần. Khi đã bỏ công theo dõi trạng thái thì đừng quét lại — lần quét thứ hai không có trạng thái, nên nó luôn dễ tin vào thứ *trông giống*. Dấu hiệu nhận ra: hàm A tính ra thông tin, hàm B tính lại cùng thông tin đó từ đầu.

## CP-32: reviewBase bỏ lại thì brief phình thành cả nhánh

**Gặp:** 2026-09-08 · CP-32 · lúc chạy gate review
**Triệu chứng:** brief 497KB, 74 file, cho một task sửa 4 file. Diff gộp cả việc của 17 commit thuộc các task đã đóng.
**Nguyên nhân:** `reviewBase` trong config trỏ tới commit của một task cũ và không ai cập nhật. Nhánh `compass-phase-1` sống qua nhiều task, nên "từ base tới HEAD" là cả nhánh chứ không phải một task.
**Vùng ảnh hưởng:** .compass/config.json, và mọi dự án làm nhiều task trên một nhánh dài
**Phòng tránh:** cập nhật `reviewBase` về `HEAD` **khi bắt đầu** mỗi task, không phải lúc chạy gate. Brief rộng quá thì reviewer đọc loãng và bỏ sót — mà gate vẫn xanh, nên không có gì báo cho bạn biết.

## CP-32: Test gọi thẳng hàm thư viện thì không canh được cách gate dùng nó

**Gặp:** 2026-09-08 · CP-32 · mutation test sau khi vá blind review
**Triệu chứng:** xoá tham số chống-đếm-trùng khỏi lệnh gate mà không test nào đỏ, dù có một test viết riêng cho đúng lỗi đó
**Nguyên nhân:** test gọi `matchDeclaredFile(q, actual, taken)` trực tiếp và tự truyền `taken`. Nó chứng minh hàm chạy đúng khi được gọi đúng — không chứng minh gate gọi đúng. Chỗ hỏng nằm ở lời gọi, không nằm trong hàm.
**Vùng ảnh hưởng:** test/data-command.test.mjs, và mọi test viết ở tầng thư viện cho một lỗi phát hiện ở tầng lệnh
**Phòng tránh:** lỗi tìm thấy ở tầng nào thì test ở tầng đó. Test tầng thư viện thêm vào cũng tốt, nhưng nó không thay được. Cách kiểm tra: mutation ở tầng lệnh — sống sót nghĩa là test đang canh chỗ khác.

## CP-32: Bịt lỗ theo từng đường thì đường thứ ba vẫn hở

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 1 và 2, cùng một lỗ
**Triệu chứng:** vòng 1 bắt marker giả trong khối comment; vá xong, vòng 2 bắt marker giả **cuối một dòng code** — cùng hậu quả, gate xanh cho file kết quả không tồn tại
**Nguyên nhân:** vòng 1 hỏi "comment này có thật không". Câu hỏi đúng là "dòng này có phải một lời khai không". Comment cuối dòng code là comment thật, nên bản vá vòng 1 cho nó qua. Ba đường vào cùng một lỗ: trong block comment, trong chuỗi, và sau code.
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** khi vá một lỗ, hỏi "còn đường nào khác tới đây". Liệt kê hết đường vào trước khi viết bản vá, đừng vá đường vừa thấy. Ở đây điều kiện đúng là "không có gì đứng trước `--` trên dòng vật lý này" — một phép kiểm tra phủ cả ba đường, thay vì ba phép kiểm tra riêng.

## CP-32: Không có quy tắc phá vỡ thế cân bằng nào đúng thì đừng chọn bừa

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 2
**Triệu chứng:** code giữ khai báo **cuối** khi một query có hai khai báo, kèm comment giải thích "chạy lại thì người ta thêm tên mới lên trên" — chính tình huống đó lại làm code giữ tên **cũ**. Mutation đổi sang lấy cái đầu: 38 test vẫn xanh.
**Nguyên nhân:** thêm tên mới lên trên hay xuống dưới đều là thói quen bình thường, nên không quy tắc nào đúng quá nửa số case. Chọn một cái rồi viết comment biện minh làm nó trông có chủ đích.
**Vùng ảnh hưởng:** lib/query-outputs.mjs, và mọi chỗ "nhiều đầu vào, chọn một"
**Phòng tránh:** dữ liệu không trả lời được thì báo lỗi, đừng đoán. Ở đây hai khai báo cho một query là lời khai mâu thuẫn — bắt người sửa mất một giây, còn đoán sai làm bằng chứng trỏ sai file mà không ai biết. Dấu hiệu: comment phải giải thích *vì sao* chọn hướng này thay vì chỉ nói nó làm gì.

## CP-32: Fixture một-kết-quả không phân biệt được hai chiều lỗi

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 5
**Triệu chứng:** test comment lồng nhau xanh kể cả khi bỏ phép giảm độ sâu — comment không bao giờ đóng, mà test vẫn xanh
**Nguyên nhân:** fixture khẳng định "tìm được 1 query". Lỗi đếm thừa cho ra 2 nên bị bắt; lỗi đếm thiếu cũng cho ra 1, y hệt kết quả đúng. Một con số không phân biệt được "đúng" với "thiếu" khi cả hai bằng nhau.
**Vùng ảnh hưởng:** test/query-outputs.test.mjs, và mọi test đếm số phần tử
**Phòng tránh:** hỏi "lỗi theo chiều ngược lại cho ra kết quả gì". Nếu bằng với kết quả đúng thì fixture phải có thêm phần tử phía sau — ở đây là một query nữa sau comment, để việc comment không đóng làm mất nó. Con số ở giữa dải mới đo được cả hai chiều.

## CP-32: sed không thay được mà vẫn báo test xanh

**Gặp:** 2026-09-08 · CP-32 · lúc kiểm tra lỗ test vòng 6
**Triệu chứng:** `sed -i` với regex chứa `\d{4}` không đổi gì, test xanh, đọc thành "mutation sống sót" — kết luận đúng nhưng bằng chứng rỗng
**Nguyên nhân:** shell và sed hiểu khác nhau về dấu escape, nên pattern không khớp gì cả. File không đổi, test đương nhiên xanh.
**Vùng ảnh hưởng:** mọi phép mutation testing
**Phòng tránh:** script mutation phải **in ra dòng trước và sau khi thay**, và tự thoát với mã lỗi nếu không thấy chuỗi cần tìm. Pitfall heredoc của CP-15 đã ghi điều này rồi mà vẫn tái phát bằng `sed` — quy tắc là "chứng minh bản vá đã đổi đúng chỗ", không phải "tránh heredoc".

## CP-32: Bịt đường marker giả lọt vào, quên đường khai báo thật bị mất

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 7, sau bốn vòng liền báo sạch
**Triệu chứng:** gate exit 0 và in "1/1 file có trong data/" trong khi một file khai báo không có mặt, không được miễn, và không hề được nhắc tới. Đúng cái duy nhất tính năng này sinh ra để chặn.
**Nguyên nhân:** file kết thúc khi còn `/*`, `'` hay `$$` chưa đóng thì mọi thứ sau đó bị ăn thành comment hoặc chuỗi — kể cả các dòng `@out:`. Hàm quét biết trạng thái đó nhưng **vứt đi** ở lần `push` cuối. Sáu vòng trước đều đi bịt đường *marker giả lọt vào*; không ai xét chiều ngược lại là *khai báo thật bị mất*.
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** một lỗ có hai chiều. Bịt xong chiều "thứ không đáng tin lọt vào", hỏi ngay "thứ đáng tin có thể mất đi không". Ở đây `/* a /* b */` là comment đóng hoàn chỉnh ở mọi dialect trừ Postgres — nên bộ đếm độ sâu thêm vào để xử lý comment lồng lại tự tạo case dừng giữa cấu trúc. Trạng thái đã có trong tay thì phải khai ra, đừng để nó chết trong hàm.

## CP-32: Backup cạnh file nguồn thì lọt vào bản phát hành

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 7
**Triệu chứng:** `lib/query-outputs.mjs.datebak` — bản sao y hệt module thật — nằm trong `npm pack`, 11KB code trùng sẽ lệch nhau ngay lần sửa đầu
**Nguyên nhân:** script mutation ghi backup thành `${file}.mutbak` cạnh file gốc, mà `package.json` khai `"files": ["lib/", "commands/"]` cả thư mục. Không có gì lọc theo đuôi.
**Vùng ảnh hưởng:** mọi script tạo file tạm cạnh file nguồn
**Phòng tránh:** file tạm ghi ra `os.tmpdir()`, đừng ghi cạnh nguồn. `.gitignore` không cứu được ở đây — `npm pack` đọc `files` trong package.json chứ không đọc gitignore, nên file bị git bỏ qua vẫn xuất bản ra ngoài.

## CP-32: Một lỗ có ba chiều, không phải hai

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 8, sau khi vòng 7 đã vá "khai báo bị mất"
**Triệu chứng:** gate exit 0 và in "1 query đã khai · 1 chạy tay" trong khi một query production thật không hề được đòi file. Lần thứ ba cùng một hậu quả, đường vào thứ ba.
**Nguyên nhân:** `hasCode` chỉ được đặt ở dòng cuối vòng lặp, mà ba nhánh mở chuỗi/comment đều `continue` trước đó. Nên một câu lệnh đã bị comment ra — `/* select ... */;` — không tính là câu lệnh, và dòng `@out: -` của nó **đi theo** sang query kế tiếp, biến một export thật thành "chạy tay".
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** ba chiều của một lỗ đối chiếu: thứ giả **lọt vào** (vòng 1-2), thứ thật **mất đi** (vòng 7), thứ thật **gán sai chỗ** (vòng 8). Vá hai chiều đầu rồi vẫn phải hỏi chiều thứ ba. Dấu hiệu ở đây rất rõ mà sáu vòng bỏ qua: code đã lưu `declLine: 1` và `line: 9` — nó giữ bằng chứng khai báo không thuộc query đó, và không bao giờ so hai số ấy.

## CP-32: Escape backslash là chuyện riêng của MySQL

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 8
**Triệu chứng:** `where Path = 'D:\exports\';` — chuỗi đóng hoàn chỉnh — bị báo "chưa đóng", và lời khuyên đưa ra là đóng một thứ đã đóng
**Nguyên nhân:** coi `\` là ký tự escape trong mọi dialect. Chỉ MySQL làm vậy; Postgres từ 9.1, SQL Server, Oracle, SQLite đều coi nó là ký tự thường. Đường dẫn Windows kết thúc bằng dấu đó là chuyện thường gặp.
**Vùng ảnh hưởng:** lib/query-outputs.mjs, và mọi parser đọc chuỗi SQL
**Phòng tránh:** chỉ nhân đôi dấu nháy (`''`) là quy tắc chung của mọi dialect — dùng đúng nó thôi. Đánh đổi phải nói rõ: MySQL viết `'a\''` sẽ bị báo lỗi, nhưng **báo lỗi** khác hẳn **im lặng đọc sai**, và tác giả sửa được bằng `''`.

## CP-32: Query bị vô hiệu hoá thì khai báo của nó đi lạc sang query sau

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 9, đường thứ tư tới cùng một hậu quả
**Triệu chứng:** gate exit 0, in "3/3 file có trong data/", trong khi query production ở dòng 14 không có khai báo, không có file, và được ghi công bằng tên file của một query đã bị comment
**Nguyên nhân:** vô hiệu hoá một query bằng cách thêm `--` vào từng dòng, hay bọc trong `/* … */`, không để lại `;` ở vị trí code. Vòng 8 chỉ vá dạng còn `;`. Khối comment đó "mang khai báo đi" sang query kế tiếp, và không gì kiểm tra khoảng cách giữa hai thứ.
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** phân biệt *comment mô tả query sau* với *SQL đã bị vô hiệu hoá* — ở đây bằng cách xem dòng comment có mở đầu bằng từ khoá SQL không. Bản vá đầu tôi coi mọi comment có nội dung là ranh giới, làm đỏ 6 test và chặn oan mọi script có tiêu đề. Phép phân biệt phải hẹp đúng mức: rộng quá thì chặn việc hợp lệ, hẹp quá thì lọt.

**Bốn đường, cùng một hậu quả.** Vòng 1-2: marker giả lọt vào. Vòng 7: khai báo bị mất trong cấu trúc chưa đóng. Vòng 8: khai báo của câu lệnh đã comment (còn `;`) đi lạc. Vòng 9: cùng vậy nhưng không còn `;`, cộng thêm `;` rỗng. Bốn vòng "sạch" liên tiếp ở giữa (3,4,5,6) không có nghĩa hết lỗ — chỉ nghĩa là vòng đó chưa tìm ra.

## CP-32: CR trần cũng là dấu ngắt dòng

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 9
**Triệu chứng:** một CR lẻ trên dòng khai báo làm cả khai báo lẫn query của nó biến mất, không lỗi nào; file dùng CR làm dấu ngắt dòng thì đọc ra "không có query nào"
**Nguyên nhân:** vòng lặp chỉ tăng số dòng và đóng comment ở `LF`. Một `--` gặp CR thì comment chạy tới hết file.
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** pitfall CRLF của CP-15 nói "tách dòng bằng `/\r?\n/`" — đúng cho `split`, nhưng vòng quét từng ký tự cần luật riêng: `LF` hoặc CR đều kết thúc dòng, và `CRLF` là một dấu chứ không phải hai. Cùng một lớp lỗi, hai chỗ phải sửa khác nhau.

## CP-32: Vá xong phải hỏi phép bảo vệ cũ còn tác dụng không

**Gặp:** 2026-09-08 · CP-32 · mutation sau bản vá vòng 9
**Triệu chứng:** hai mutation vốn chết nay sống sót, ở hai dòng tôi không sửa
**Nguyên nhân:** bản vá mới che luôn việc của chúng. Cắt `CR` cuối dòng thành vô nghĩa vì chỗ cắt dòng đã dừng ở CR; còn `markContent` ở `;` thì vẫn cần — nhưng `lastCommentContentLine` che phần lớn case nên mutation trông như dư.
**Vùng ảnh hưởng:** mọi lần vá vào code đã có phép bảo vệ
**Phòng tránh:** mutation sống sót sau một bản vá có hai nghĩa khác nhau, và phải phân biệt bằng cách chạy: dựng một loạt đầu vào, mutation rồi so kết quả. Không khác gì thì thật sự dư — xoá đi. Có khác thì đó là lỗ test, viết test. Đoán thì nửa số lần sẽ xoá mất một phép bảo vệ đang làm việc: ở đây `;` rỗng vẫn làm khai báo nhảy sang query sau, và tôi suýt xoá dòng chặn nó.

## CP-32: Đoán ngữ nghĩa thì sai cả hai chiều cùng lúc

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 10, sau bản vá vòng 9
**Triệu chứng:** phép phân biệt "SQL bị comment" với "văn mô tả" bằng cách xem dòng có mở đầu bằng từ khoá SQL: **lọt** sáu cách vô hiệu hoá query (`-- (select …)`, `-- union all …`, `-- values (…)`, `-- merge into`, dòng nối `--   from t`, khối `/*` mở bằng dòng tiêu đề), đồng thời **chặn oan** năm câu văn thường (`-- update: Konsta changed this`, `-- Select the right threshold first`)
**Nguyên nhân:** danh sách từ khoá không phải một ranh giới. Thêm từ vào thì chặn thêm văn thường; bớt đi thì lọt thêm query. Không có bộ từ khoá nào đúng, vì thông tin cần thiết — "dòng này là code hay là lời nói về code" — không nằm trong văn bản.
**Vùng ảnh hưởng:** lib/query-outputs.mjs
**Phòng tránh:** đổi câu hỏi sang thứ đo được. Ở đây là **bố cục**: một query bị vô hiệu hoá luôn có dòng trống tách nó khỏi query sau, nên "khai báo cách query bởi một dòng trống rồi nội dung khác" bắt được cả sáu case mà không cần hiểu nội dung. 12/12 case đúng, so với 6/12 của phép đoán từ khoá.

**Dấu hiệu nhận ra sớm:** khi một phép kiểm tra cần *danh sách* để đúng, và danh sách đó không thể đầy đủ về nguyên tắc, thì phép kiểm tra sai — không phải danh sách thiếu.

## CP-32: Mười vòng review, sáu lỗi chặn, bốn vòng sạch ở giữa

**Gặp:** 2026-09-08 · CP-32 · toàn bộ quá trình
**Triệu chứng:** vòng 3,4,5,6 đều báo sạch. Vòng 7,8,9,10 mỗi vòng tìm một lỗi Major, tất cả cùng một hậu quả: gate exit 0 trong khi một file khai báo không có mặt và không ai nhắc tới.
**Nguyên nhân:** năm đường khác nhau tới cùng một hậu quả — marker giả lọt vào, khai báo mất trong cấu trúc chưa đóng, khai báo của query đã comment (còn `;`) đi lạc, cùng vậy nhưng không còn `;`, và `;` rỗng. Mỗi vòng bịt một đường; đường tiếp theo chỉ lộ ra khi có người tìm đúng chỗ.
**Vùng ảnh hưởng:** mọi tính năng đối chiếu hai danh sách, và cách đọc kết quả review
**Phòng tránh:** "review sạch" nghĩa là *vòng đó không tìm ra*, không phải *hết lỗ*. Với tính năng mà một lỗi im lặng làm gate xanh sai, hãy liệt kê **hậu quả** cần chặn rồi hỏi "có mấy đường tới đó", thay vì soi từng đoạn code. Và khi vá lần thứ tư vào cùng một chỗ, đó là lúc đổi cách tiếp cận — không phải vá khéo hơn.

## CP-32: Hạ một phép kiểm tra xuống cảnh báo thì phải kiểm tra chính cảnh báo đó

**Gặp:** 2026-09-08 · CP-32 · blind review vòng 12
**Triệu chứng:** sau khi đổi `stranded` từ lỗi thành cảnh báo, lỗ được ghi là "exit 0 **kèm cảnh báo**". Thực tế có cả một lớp case exit 0 mà **không cảnh báo gì** — file viết không có dòng trống.
**Nguyên nhân:** tín hiệu sinh cảnh báo vẫn là "có dòng trống rồi có nội dung". Khi hạ mức từ chặn xuống báo, tôi kiểm tra phần *hành vi gate* (không chặn nữa) mà không kiểm tra phần *phát hiện* còn đúng phạm vi không. Cảnh báo im lặng còn tệ hơn lỗi sai, vì tài liệu đã hứa nó sẽ nói.
**Vùng ảnh hưởng:** lib/query-outputs.mjs, và mọi lần hạ mức một phép kiểm tra
**Phòng tránh:** hạ mức không phải sửa một dòng `severity`. Cảnh báo là lời hứa "chỗ này tôi sẽ nói cho anh biết" — phải kiểm tra nó phủ đúng những case mình vừa thôi chặn. Và tài liệu ghi lỗ còn lại thì phải ghi đúng: viết "kèm cảnh báo" trong khi có case im lặng là dạng sai tệ nhất, vì người đọc tin vào đó.

## CP-36: Gate review chỉ soi tới HEAD, nên task nằm giữa lịch sử không đóng được

**Gặp:** 2026-09-09 · CP-4, CP-6, CP-10, CP-11, CP-13
**Triệu chứng:** năm task có `spec`, `knowledge`, `convention`, `test` đều xanh, chỉ thiếu `review`, và không cách nào chạy được gate đó cho đúng phạm vi của chúng.
**Nguyên nhân:** hai chuyện chồng lên nhau. Gate `review` luôn soi `<gốc soi>..HEAD`, nên task có việc kết thúc trước HEAD bị soi kèm mọi commit sau nó — CP-6 ra 78 file thay vì 13 nó chạm. Và commit `8dce192` gộp việc của CP-10, CP-11, CP-13 vào một, nên không khoảng commit nào tách được ba task đó.
**Vùng ảnh hưởng:** `lib/review-brief.mjs`, `commands/review.mjs` — và mọi dự án có nhiều task trên một nhánh dài
**Phòng tránh:** cập nhật `Gốc soi:` **lúc bắt đầu** mỗi task, và commit từng task riêng. Một commit mang việc của ba task là ba task không soi lại được, vĩnh viễn.

Quyết định 2026-09-09: **không đóng năm task này**. Lý do đo được, không phải cảm tính — 192 test mang id của chúng đang chạy xanh trong suite 875, ở bản code hôm nay. Thứ thiếu là một agent lạ đọc diff, không phải bằng chứng code chạy đúng. Sửa được thì cần thêm `Soi đến:` và lọc diff theo `Phạm vi:` (spec đã viết ở `.compass/CP-36/spec.md`, chưa duyệt) — tức là thêm code mới vào chính cơ chế sinh bằng chứng, mà lại là loại code **thu hẹp thứ reviewer nhìn thấy**. Cái giá đó lớn hơn cái được.

Gặp lại hình dạng này thì đọc `.compass/CP-36/spec.md` trước, đừng điều tra lại từ đầu.
