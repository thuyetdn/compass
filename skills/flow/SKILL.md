---
name: flow
description: Quy trình phát triển có bằng chứng: spec trước code, gate máy chạy thật thay vì AI tự khai kết quả. Dùng khi bắt đầu bất kỳ task lập trình nào (thêm tính năng, sửa bug, refactor), hoặc khi người dùng nhắc compass, gate, spec-first, hay hỏi vì sao AI báo xong mà chưa xong.
---

# Compass flow

Quy trình để AI không tự khai là đã xong khi chưa xong.

## 0. Ngôn ngữ

Quy tắc trả lời tiếng Việt nằm ở `references/language.md`. SessionStart hook của plugin đã nạp nó vào context từ đầu phiên, không cần đọc lại.

Nếu context không có mục "Cách trả lời tiếng Việt (compass)", hook chưa chạy: đọc `references/language.md` rồi làm theo, và báo cho người dùng biết hook không hoạt động.

Quy tắc đó áp dụng cho mọi câu chữ sinh ra trong lúc chạy compass: câu trả lời, nội dung spec, commit message, báo cáo gate.

Một điều riêng của compass, không có trong quy tắc ngôn ngữ chung:

**Không dùng từ "xong", "pass", "đã fix" khi chưa có output của máy chứng minh.** Đây là lý do compass tồn tại. Chưa chạy gate thì viết "đã implement, chưa verify".

## 1. Spec trước code

(chưa viết)

## 2. Gate

(chưa viết)

## 3. Báo cáo

(chưa viết)
