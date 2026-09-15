---
name: flow
description: 'Evidence-based dev workflow for Vietnamese-speaking users. Use at the START of any coding task that writes or changes files: new feature, bug fix, refactor, or work spanning multiple repos. Also use when the user says compass, gate, spec-first, or asks why the AI claimed something was done when it was not. Enforces: classify the task, write a spec first, run real commands as proof, never auto-commit. Skip for pure questions that need no file changes.'
---

# Compass flow

Quy trình để AI không tự khai là đã xong khi chưa xong.

## 0. Ngôn ngữ

Quy tắc trả lời tiếng Việt nằm ở `references/language.md`. SessionStart hook của plugin đã nạp nó vào context từ đầu phiên, không cần đọc lại.

Nếu context không có mục "Cách trả lời tiếng Việt (compass)", hook chưa chạy: đọc `references/language.md` rồi làm theo, và báo cho người dùng biết hook không hoạt động.

Quy tắc đó áp dụng cho mọi câu chữ sinh ra trong lúc chạy compass: câu trả lời, nội dung spec, commit message, báo cáo gate.

Một điều riêng của compass, không có trong quy tắc ngôn ngữ chung:

**Không dùng từ "xong", "pass", "đã fix" khi chưa có output của máy chứng minh.** Đây là lý do compass tồn tại. Chưa chạy gate thì viết "đã implement, chưa verify".

## 1. Phân loại làn

Việc đầu tiên của mọi task: chốt nó thuộc làn nào. Bốn làn, mỗi làn đi qua các cửa khác nhau.

| Làn | Là gì | Dấu hiệu nhận ra |
|---|---|---|
| Điều tra | Đọc, tìm, giải thích. Không sửa file nào | Câu hỏi "tại sao", "ở đâu", "cái này chạy thế nào" |
| Sửa nhỏ | Typo, đổi chữ, sửa hằng số | Một file, một chỗ, không đổi hành vi chương trình |
| Tính năng | Thêm cái chưa có, hoặc sửa bug đổi hành vi | Có đầu vào đầu ra mới, hoặc chương trình chạy khác đi |
| Refactor | Đổi cấu trúc, giữ nguyên hành vi | Đầu vào như cũ thì đầu ra như cũ |

Nghi ngờ giữa hai làn thì chọn làn chặt hơn. Sửa nhỏ mà nghi là đổi hành vi thì đẩy lên Tính năng, đừng đẩy xuống.

Refactor mà đổi hành vi là tính năng trá hình. Muốn đổi hành vi thì tách ra thành việc riêng.

Nói ra làn đã chọn trước khi làm, một câu. Người dùng chặn được ngay nếu tôi phân loại sai.

## 2. Spec trước code

Làn Điều tra không cần spec. Làn Sửa nhỏ chỉ cần một câu nói trước sẽ sửa gì, ở file nào, dòng nào. Làn Tính năng và Refactor phải có spec viết ra và được người dùng gật trước khi gõ dòng code nào.

### Spec viết gì

Phần hay hỏng không phải phần quên làm, mà phần tôi tự làm thêm. Nên spec phải có cả cái sẽ không đụng tới:

- Hành vi mong muốn, viết bằng câu người đọc được, không phải pseudocode
- Repo nào bị sửa, mỗi repo sửa cái gì
- Cách kiểm chứng: chạy lệnh nào, thấy gì thì coi là đúng
- Trường hợp biên đã nghĩ tới
- Ngoài phạm vi: cái gì không làm lần này, file nào chắc chắn không sửa
- Chỗ nào còn chưa chắc thì hỏi thẳng trong spec, đừng tự quyết

Riêng làn Refactor, spec phải chốt thêm cách chứng minh hành vi không đổi. Đã có test phủ chỗ đó thì ghi rõ lệnh chạy. Chưa có thì viết test cho hành vi hiện tại trước, chạy pass rồi mới được refactor. Không test được thì nói thẳng là không chứng minh được, để người dùng quyết có làm không.

### Spec nằm ở đâu

Ngoài repo, tại `~/.compass/specs/<ten-task>.md`. Lý do: một dự án thường có nhiều repo cross app, một task đụng cả backend lẫn frontend. Để spec trong repo thì mỗi repo một bản copy, sửa một bên là lệch ngay.

Windows thì đường dẫn là `%USERPROFILE%\.compass\specs\`. Thư mục chưa có thì tạo.

Tên file lấy theo task, viết thường có gạch nối: `them-webhook-thanh-toan.md`.

### Spec cho dự án nhiều repo

Spec phải nói rõ đang sửa những repo nào và thứ tự làm. Mẫu:

```markdown
# Thêm webhook thanh toán

## Repo bị ảnh hưởng
- D:\work\payment-api   - thêm endpoint POST /webhooks/payment
- D:\work\admin-web     - thêm màn hình xem log webhook

## Thứ tự
1. payment-api trước, vì admin-web gọi endpoint này
2. admin-web sau, khi endpoint đã chạy được

## Hành vi mong muốn
...

## Cách kiểm chứng
- payment-api: `npm test -- webhooks`
- admin-web:   `npm run test:e2e -- webhook-log`

## Ngoài phạm vi
- Không đụng schema database
- Không sửa payment-worker
```

Đường dẫn repo ghi tuyệt đối, vì mỗi lượt làm việc có thể ở repo khác nhau.

Đổi repo giữa chừng thì nói ra: "chuyển sang admin-web". Người dùng phải biết tôi đang ở đâu, nếu không thì diff hiện ra mà không hiểu của repo nào.

Một repo xong thì báo gate của repo đó trước, đừng gộp cả hai repo vào một báo cáo cuối.

### Lệch spec

Làm giữa chừng phát hiện spec sai là chuyện bình thường. Cái không bình thường là âm thầm làm khác rồi báo xong.

Lệch spec thì dừng, nói chỗ lệch, sửa spec trước, rồi mới làm tiếp.

## 3. Gate

Gate là điểm dừng bắt buộc. Không đi tiếp cho tới khi có bằng chứng, hoặc có người dùng gật.

Hai loại gate, phân vai rõ vì máy chặn được thứ đếm được, không chặn được thứ cần hiểu.

### Máy gác

Chạy lệnh thật của dự án rồi dán nguyên văn output kèm dòng lệnh.

| Gate | Chạy gì |
|---|---|
| Test | Lệnh test của repo. Đọc `package.json`, `Makefile`, `pyproject.toml` để biết |
| Build | Lệnh build, nếu repo có |
| Lint và format | Theo cấu hình có sẵn. Không có cấu hình thì không bịa ra chuẩn mới |
| Diff | `git diff --stat` ở làn Sửa nhỏ, nơi không có test riêng |

Fail thì báo fail, dán nguyên lỗi, nói đang nghi gì. Không diễn giải lại thành "gần xong".

Repo không có test runner thì nói thẳng là không có, đừng mượn chữ pass.

Làn Refactor phải chạy đúng bộ test đã chạy trước khi refactor, và ra kết quả y hệt. Phải sửa test mới pass là dấu hiệu hành vi đã đổi, tức là đã lạc sang làn Tính năng.

Làn Điều tra không có test để chạy, nên bằng chứng là chỗ đọc được: mỗi khẳng định kèm file và dòng, hoặc output lệnh đã chạy.

### Người gác

Bốn thứ này máy không gác được:

- **Code convention**: đặt tên, cấu trúc thư mục, cách tách module. Mỗi dự án một quy ước, tôi không đoán được.
- **Đúng ý hay chưa**: test pass không có nghĩa là làm đúng việc.
- **Commit**: cửa đóng mặc định, xem mục 4.
- **Push và mọi thứ ra ngoài**: push, mở PR, deploy, xóa branch. Hỏi riêng từng lần, không gộp vào lần hỏi commit.

## 4. Commit

**Không bao giờ tự commit.** Soạn message, đưa diff, đợi người dùng nói chạy. Người dùng im lặng thì không commit.

Message viết theo convention của repo. Xem `git log --oneline -20` để biết repo đó viết kiểu gì, đừng áp kiểu của repo khác.

**Commit không mang tên tôi.** Không gắn `Co-Authored-By: Claude`, không gắn dòng "Generated with". Commit đứng tên người dùng, vì trách nhiệm là của họ.

Dự án nhiều repo thì commit từng repo riêng, hỏi riêng từng lần. Không có commit nào đụng hai repo cùng lúc.

Làn Refactor sinh diff lớn, chính là loại diff dễ lọt thứ không ai định làm. Tách commit theo từng bước nhỏ, nói rõ commit nào chỉ đổi chỗ, commit nào có sửa thật.

## 5. Báo cáo

Ba kiểu kết thúc, nói bằng ba giọng khác nhau. Sai lầm nguy hiểm nhất không phải làm sai, mà là gộp cả ba thành một chữ "xong".

| Kiểu | Khi nào | Nói thế nào |
|---|---|---|
| Đã kiểm chứng | Máy chạy, máy nói pass | Dán lệnh và output. Đây là kiểu duy nhất được dùng chữ "xong" |
| Chưa kiểm chứng | Code viết rồi, chưa chạy | "Đã implement, chưa verify", kèm lý do chưa chạy được |
| Thất bại | Chạy rồi, hỏng | Dán nguyên lỗi, nói đang nghi gì, bước tiếp là gì. Không viết "gần xong rồi" |

Mẫu báo cáo:

```
Đã làm: <một câu>
Sửa ở: <repo/file:dòng>
Kiểm chứng: <lệnh + output, hoặc nói rõ chưa chạy được>
Còn lại: <cái gì chưa xong, hoặc "không còn gì">
```

Mục "Còn lại" bắt buộc khi việc chưa xong hết. Bỏ mục này đi là cách dễ nhất để một task dở dang trông như đã xong.

Phát hiện bug ngoài phạm vi thì liệt kê riêng ở cuối, không tự sửa. Để người dùng quyết.
