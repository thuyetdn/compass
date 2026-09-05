# INV-1: Gate visual đỏ khi chạy sau gate ui, chạy riêng thì xanh

**Mở:** 2026-09-05
**Vùng nghi:** lib/dev-server.mjs, hai gate browser chạy nối tiếp

## Triệu chứng

`compass check TD-001` trên demo todo fail ở gate `visual`:

```
✓ Gate ui PASSED — 28 thuộc tính, 2 viewport, không lệch
✗ Gate visual FAILED
  Không chụp được: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
```

`compass visual TD-001` chạy riêng thì xanh. Tần suất: 2 lần đỏ trong khoảng 15 lần chạy.

## Giả thuyết

### H1: waitForUrl nhận nhầm phản hồi từ server đang tắt dở của gate ui
**Cách kiểm:** chạy hai vòng startDevServer + waitForUrl liên tiếp, đo thời gian chờ vòng hai và fetch lại ngay sau đó
**Kết quả:** sai — vòng hai chờ 977ms rồi fetch trả 200, server thật sự sống

### H2: startDevServer để sót tiến trình, server cũ giữ cổng
**Cách kiểm:** chạy `check` 13 lần liên tiếp rồi `netstat -ano | grep :5173.*LISTENING`
**Kết quả:** đúng — còn 1 tiến trình node LISTENING sau khi mọi gate đã xong

### H3: killTree bỏ qua vì shell đã thoát trước tiến trình con
**Cách kiểm:** đọc điều kiện đầu hàm, rồi `taskkill /t` xem cây tiến trình sâu mấy tầng
**Kết quả:** đúng — taskkill báo "PID 4412 (child process of PID 20544)", cây ba tầng cmd → npm → vite

## Bằng chứng

Tiến trình còn sống sau khi gate xong:

```
$ netstat -ano | grep ":5173.*LISTENING"
  TCP    [::1]:5173    [::]:0    LISTENING    20544

$ tasklist /FI "PID eq 20544"
node.exe    20544    Console    4    110,076 K
```

Cây tiến trình ba tầng:

```
$ taskkill /PID 20544 /T /F
SUCCESS: The process with PID 4412 (child process of PID 20544) has been terminated.
SUCCESS: The process with PID 20544 (child process of PID 32344) has been terminated.
```

Đo vòng hai của waitForUrl (bác H1):

```
A đợi: { ok: true }
A đã stop
B đợi: {"ok":true} sau 977ms
fetch ngay sau đó: OK 200
```

## Kết luận

Hai lỗi cộng lại, cả hai trong `lib/dev-server.mjs`:

1. `stop()` gọi `spawn('taskkill', ...)` rồi trả về ngay, không đợi tiến trình chết. Gate sau
   khởi động server mới khi cổng còn bị giữ.
2. `killTree` thoát sớm khi `child.exitCode !== null`. Shell `cmd` thoát ngay sau khi bàn giao
   cho npm, nên điều kiện đó đúng trong khi vite vẫn chạy — không giết gì cả.

Server cũ giữ cổng, server mới không bind được, `waitForUrl` thấy server cũ trả lời rồi
Playwright gặp đúng lúc nó chết.

## Pitfall

**Gặp:** 2026-09-05 · INV-1 · gate `visual` đỏ sau gate `ui`
**Triệu chứng:** hai gate cùng dùng dev server, gate sau đỏ chập chờn với ERR_CONNECTION_REFUSED; chạy riêng thì xanh
**Nguyên nhân:** `child.exitCode !== null` không có nghĩa cây tiến trình đã chết. `npm run dev` là cmd → npm → vite, shell thoát trước con.
**Vùng ảnh hưởng:** lib/dev-server.mjs
**Phòng tránh:** giết theo cây (`taskkill /t`), và **đợi** nó chết trước khi trả về. Đừng suy ra trạng thái cây tiến trình từ exit code của tiến trình gốc.

## Việc cần làm tiếp

Đã sửa ở CP-8. Test tích hợp sâu ở CP-9 canh không cho rò rỉ tiến trình quay lại — nhưng EC1
trong đó không bắt được hồi quy khi hoàn nguyên bản sửa, nên chỗ này chưa kín.
