# Bẫy đã từng sập

Mỗi mục đến từ một điều tra đã đóng.

## INV-1: Gate visual đỏ khi chạy sau gate ui, chạy riêng thì xanh

**Gặp:** 2026-09-05 · INV-1 · gate `visual` đỏ sau gate `ui`
**Triệu chứng:** hai gate cùng dùng dev server, gate sau đỏ chập chờn với ERR_CONNECTION_REFUSED; chạy riêng thì xanh
**Nguyên nhân:** `child.exitCode !== null` không có nghĩa cây tiến trình đã chết. `npm run dev` là cmd → npm → vite, shell thoát trước con.
**Vùng ảnh hưởng:** lib/dev-server.mjs
**Phòng tránh:** giết theo cây (`taskkill /t`), và **đợi** nó chết trước khi trả về. Đừng suy ra trạng thái cây tiến trình từ exit code của tiến trình gốc.
