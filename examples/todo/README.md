# Todo — ví dụ chạy Compass trên frontend

Todo list React nhỏ, dùng làm bàn thử cho Compass. Task mẫu: `TD-001` (`feature-s`, 13 test case).

## Chạy

```bash
npm install
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

Reporter mặc định của Vitest chỉ in tên file, không in tên từng test — gate `test` sẽ không
tìm thấy ID nào và báo fail oan. TAP reporter in đủ tên test nên đối chiếu ID mới chạy được.

Chi tiết và các chỗ gãy khác: [ghi chú chạy thử](../../docs/superpowers/notes/2026-09-05-frontend-trial.md).
