# Todo — ví dụ chạy Compass trên frontend

Todo list React nhỏ, dùng làm bàn thử cho Compass. Task mẫu: `TD-001` (`feature-s`, 13 test case).

## Chạy

```bash
npm install
npx playwright install chromium   # gate ui và visual cần
npm test          # Vitest, 13 test
npm run dev       # xem app thật
```

## Chạy gate Compass

```bash
node ../../cli.mjs status TD-001
node ../../cli.mjs check TD-001
```

Spec nằm ở [.compass/TD-001/spec.md](.compass/TD-001/spec.md).

## Lưu ý về reporter

`.compass/config.json` gọi `npx vitest run --reporter=tap`, **không** phải `npm test`.

Reporter mặc định của Vitest chỉ in tên file (và tên vài test chậm) — gate `test` không tìm
thấy đủ ID và báo fail oan. TAP reporter in đủ tên test nên đối chiếu ID mới chạy được.

Đổi về mặc định thử xem: gate sẽ tự nhắc chính khả năng này trước khi bảo bạn đi viết test.

Cách dùng Compass từ đầu: [hướng dẫn](../../docs/huong-dan.md).
