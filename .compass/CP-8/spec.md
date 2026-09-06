# CP-8: Two browser gates in a row must not race over the dev port
Loại: bug
Phạm vi: lib/dev-server.mjs, commands/ui.mjs, commands/visual.mjs
Lệnh test: npm test && npm run test:deep

## Mục tiêu
`compass check` trên task frontend fail 100% ở gate `visual`, dù chạy `compass visual` riêng
thì xanh:

```
✓ Gate ui PASSED — 28 thuộc tính, 2 viewport, không lệch
✗ Gate visual FAILED
  Không chụp được: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
```

Đo trên máy: sau khi mọi gate chạy xong, vẫn còn một tiến trình node LISTENING trên 5173.
Hai lỗi trong `lib/dev-server.mjs`:

1. `stop()` gọi `spawn('taskkill', ...)` rồi trả về ngay, không đợi tiến trình chết. Gate sau
   khởi động server mới khi cổng còn bị giữ.
2. `killTree` bỏ qua khi `child.exitCode !== null`. Cây tiến trình là cmd → npm → vite; shell
   thoát sớm còn vite vẫn sống, nên nhánh đó không giết gì cả.

Server cũ giữ cổng làm server mới không bind được. `waitForUrl` thấy server **cũ** trả lời,
rồi Playwright gặp đúng lúc nó chết.

Tần suất: 2 lần đỏ trong ~15 lần chạy. Chập chờn, không phải mọi lần.

Xong nghĩa là: `compass check` trên task có design contract chạy hết cả sáu gate, và chạy lại
nhiều lần liên tiếp vẫn xanh.

## Ràng buộc
Zero runtime dependency. Không nới timeout để "may thì qua" — đó là che lỗi, không phải sửa.
Không đổi chữ ký `waitForUrl` theo kiểu phá code đang gọi nó.

## Rủi ro hồi quy
Bắt `waitForUrl` chờ chắc chắn hơn sẽ làm mọi gate browser chậm thêm. Phải đo, và không được
thêm độ trễ cố định vào đường đi bình thường.

Test hiện có của `waitForUrl` khẳng định nó trả về ngay khi URL phản hồi. Nếu đổi thành đòi
nhiều lần liên tiếp thì các test đó đổi kết quả — phải rà lại.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Server đã lên sẵn | waitForUrl trả ok | P0 |
| H2 | Happy | Server lên sau một lúc | Chờ được, trả ok | P0 |
| H3 | Happy | check chạy ui rồi visual | Cả hai gate xanh | P0 |
| V1 | Validation | Server trả 404 | Vẫn tính là đã lên | P0 |
| E1 | Error | Không có server nào | Trả lỗi sau timeout, nêu thời gian đã đợi | P0 |
| E2 | Error | Server tắt giữa lúc đang chờ | Không trả ok nhầm | P0 |
| EC1 | Edge | Cổng vừa bị nhả bởi tiến trình trước | Không nhận nhầm server cũ là server mới | P0 |
| EC2 | Edge | Gate chạy hai lần liên tiếp | Lần hai vẫn xanh | P0 |
| EC3 | Edge | Shell thoát sớm, tiến trình con còn sống | stop vẫn giết được cả cây | P0 |
| P1 | Performance | stop trả về | Chỉ trả về khi cổng đã thật sự nhả | P0 |
