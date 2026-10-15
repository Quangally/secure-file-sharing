# Kiểm tra phần Quang — 15/10/2026

## Đã chạy

| Kiểm tra | Kết quả thực tế |
|---|---|
| npm test trong frontend | 32 test đạt, 6 test files |
| node --test security-tests/crypto.test.mjs | 5 test mật mã nền đạt |
| npm run build | Vite build thành công |
| pytest backend/tests | 1 health test hiện có đạt; không phải test API tệp |
| Alembic upgrade head --sql | Sinh được initial DDL + version 0001_secure_share, không cần socket |
| SQL migration trên MySQL 8.4.6 | 42 assertion đạt: đủ schema, phiên bản, truy vấn tệp, session, share/revoke/regrant, owner/recipient, trạng thái và audit |
| Schema v1 trong bộ CSDL đã bàn giao | 53 kiểm tra native MySQL đạt, trong đó 12 ca dữ liệu sai bị UNIQUE/FK/CHECK từ chối |
| Adapter frontend mở fixtures Python từ gói CSDL đã bàn giao | 16 kiểm tra đạt: metadata + nội dung cho 8 owner/recipient envelope, SHA-256 bản gốc khớp |

Node thực hiện: 24.19.0; Python 3.12; MySQL Community Server 8.4.6. Các kiểm tra migration và schema có phần trùng nghiệp vụ, không cộng chúng thành số ca độc lập.

Test frontend gồm React Testing Library/jsdom cho trang kho tệp; fake-indexeddb cho ràng buộc user/key; transport HTTP giả và Web Crypto thật cho luồng upload/list/download/delete. Test mã hóa sinh khóa tạm thời khi chạy, không commit private key. Xác minh tệp bị sửa, sai UUID/AAD, khóa sai, hash sai, IV trùng, tệp rỗng/nhị phân, giới hạn size, CSRF, hết phiên, timeout, hủy, xác nhận xóa và phân trang.

Các ca MySQL chạy bằng mysqld --initialize-insecure --init-file trong data directory kiểm thử riêng; không sửa database thật. SQL đầu vào migration được sinh bằng Alembic rồi thực thi bởi MySQL, không chỉ đọc chuỗi hoặc dùng SQLite giả lập. Môi trường không cho mở socket nên chưa chạy đường kết nối Alembic/PyMySQL online.

## Chưa kiểm tra và không đánh dấu hoàn thành

- API nghiệp vụ FastAPI thật chưa có: chưa kiểm thử session/cookie/CSRF/phân quyền/storage trên HTTP thật hoặc kết nối MySQL qua mạng.
- Key registration/persistence bằng module thật của Bắc; router/layout/share bằng mã An chưa nằm trong repo.
- Chưa đo hiệu năng, đồng thời nhiều request hay thử trên nhiều thiết bị.
- Chưa kiểm tra bằng Chromium trực quan: trình duyệt không có sẵn và tải Chromium thử nghiệm không thành công. Kiểm thử UI ở đây là jsdom, không phải xác nhận pixel/responsive trong trình duyệt thật.
- Workflow GitHub đã thêm để chạy lại test/build; kết quả chạy trên GitHub phụ thuộc phiên push/PR, không suy ra từ kết quả local.

Sau khi nhóm ghép API và keys, chạy checklist trong README bàn giao; báo cáo chỉ ghi kết quả thật đã thực hiện.
