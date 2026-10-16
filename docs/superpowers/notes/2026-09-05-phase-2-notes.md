# Compass GĐ 2 — Ghi chú xây bốn gate còn lại

**Ngày:** 2026-09-05
**Task:** CP-3 (`convention`) · CP-4 (`ui`) · CP-5 (`visual`) · CP-6 (`review`)
**Suite:** 253 → 385 test

Tiếp sau [chạy thử frontend](2026-09-05-frontend-trial.md). Bốn gate còn thiếu của GĐ 2 và
GĐ 4 đều đã chạy được; mọi task đều đi qua chính Compass.

---

## Ba chỗ đi chệch thiết kế, và lý do

| Thiết kế nói | Làm thật | Lý do |
|---|---|---|
| `convention` sinh ESLint config rồi chạy lint | Tự khớp mẫu trong Compass | ESLint phá zero-dependency và buộc mọi dự án đích phải cài. Đánh đổi: chỉ làm được luật theo dòng, không AST |
| `ui`/`visual` không nói rõ Playwright ở đâu | Nạp từ `node_modules` của dự án đích | Compass giữ zero-dep, và gate dùng đúng bản browser mà test của dự án đang dùng |
| `visual` không nói dùng thư viện ảnh nào | Tự đọc PNG bằng `node:zlib` | `node:zlib` lo phần nén, còn lại chỉ là scanline filter — khoảng trăm dòng. Chỉ đỡ 8-bit RGB/RGBA, đúng thứ Playwright xuất |

---

## Gate `ui` và `visual` bổ nhau, không thay nhau

Đây là điều chỉ thấy khi chạy thật. Đổi tiêu đề demo thành chuỗi dài hơn:

```
✓ Gate ui PASSED — 28 thuộc tính, 2 viewport, không lệch

✗ Gate visual FAILED
  desktop: 0.407% pixel khác (4688 pixel), ngưỡng 0.100%
  mobile: 4.763% pixel khác (12860 pixel), ngưỡng 0.100%
```

`ui` đo đúng những thuộc tính người ta nghĩ ra để khai — và mọi thuộc tính đều đúng thật.
Cái nó không thấy: chữ tràn ba dòng, đẩy cả form xuống. Ảnh diff cho thấy ngay.

---

## Tám vòng soi mù cho gate `review`

Gate `review` được soi bằng chính nó: mỗi vòng một agent chưa từng tham gia, chỉ nhận brief.
Tổng cộng **19 lỗi Critical/Major**, và các tests **không bắt được lỗi nào trong số đó** —
suite xanh 100% ở mọi vòng.

| Vòng | Lỗi chặn | Nặng nhất |
|---|---|---|
| 1 | 4 | Brief bỏ sót file untracked — chính brief của CP-6 thiếu ba file cốt lõi của nó |
| 2 | 3 | Chạy pha một lần hai xóa mất `diffHash`, vô hiệu hoá cơ chế chống findings lỗi thời |
| 3 | 3 | `git diff HEAD` — commit xong là diff rỗng, verdict cũ được tái dùng |
| 4 | 7 | `reviewBase` vào thẳng argv của git; `--output=<path>` ghi được file ra ngoài repo |
| 5 | 2 | Nhánh không-so-được-diff trả exit 2 nhưng không ghi record, `done` vẫn đóng |
| 6 | 1 | Diff chứa ``` đóng sớm code fence — code bị soi nói chuyện được với agent soi nó |
| 7 | 1 | Spec đổi thì gate mở lại đúng một lần rồi tự pass |
| 8 | 0 | sạch |

**Bài học rõ nhất:** vòng bốn báo 7 lỗi, trong đó có lỗi do chính bản sửa của vòng ba sinh ra.
Vòng năm lại bắt được lỗi do bản sửa vòng bốn sinh ra (giới hạn 2MB biến một commit lớn bình
thường thành đường đóng băng verdict cũ). Sửa bảo mật đẻ ra lỗ bảo mật — và chỉ có người
ngoài mới thấy.

**Điều đáng ngờ nhất:** nếu chỉ soi một vòng, 15 trong 19 lỗi này vẫn còn nguyên. Một vòng
soi không đủ, mà SKILL.md hiện chưa nói gì về việc soi mấy vòng.

---

## Số liệu

| Chỉ số | Giá trị |
|---|---|
| Suite trước GĐ 2 | 253 pass |
| Suite sau GĐ 2 | 385 pass |
| Gate `convention` trên Compass | 4 luật, 14 file, ~1s |
| Gate `ui` trên demo | 28 thuộc tính, 2 viewport, ~30s |
| Gate `visual` trên demo | 2 viewport, ~30s |
| Gate `review` | 8 vòng, 19 lỗi chặn |

---

## Còn nợ

| Việc | Vì sao chưa làm |
|---|---|
| `done` không đo lại code | Đọc `gate.json` chứ không chạy lại gate. Đúng với **mọi** gate, không riêng `review`. `diffHash` đã có sẵn trong record nhưng `done` chưa dùng |
| Knowledge base sinh tự động | GĐ 3 |
| `compass investigate` | GĐ 4 |
| Phân giải config đa repo | GĐ 4 |
| Chạy thử trên Shop thật | Repo chưa clone về máy này |
| Số vòng soi khuyến nghị | Tám vòng cho thấy một vòng là không đủ, nhưng chưa có cơ sở để nói con số nào là đủ |
