# Kiểm tra schema MySQL v1

Schema ở database/01_schema.sql cùng các điều kiện truy vấn trong database/examples đã được chạy trên MySQL Community Server 8.4.6: **53/53 kiểm tra đạt**, gồm 41 ca dữ liệu/nghiệp vụ và 12 ca sai dữ liệu bị từ chối bởi UNIQUE, FOREIGN KEY hoặc CHECK.

Dữ liệu kiểm thử giả: 5 user, 4 tệp ready, 8 owner/recipient envelope, các session active/expired/revoked. Fixture chỉ dùng trong môi trường kiểm tra, không được import tự động vào ứng dụng hoặc commit private key trong repo. Bộ seed tùy chọn đã nằm trong gói CSDL bàn giao trước đó; không cần nó để chạy SQL tạo bảng.

Các ca đã đạt: danh sách của chủ/nhận, đếm người nhận không tính owner, tải envelope theo user, từ chối người ngoài, share/revoke/regrant, key đã thu hồi, trạng thái account/file, logout và audit. Các ca bị MySQL từ chối: email trùng (1062), key hoạt động thứ hai (1062), key sai user/sai owner (1452), private JWK, role sai, revoke owner, envelope/IV sai, IV trùng, deleted thiếu thời gian, session hạn sai (3819).

Sau khi ghép Alembic, SQL sinh bởi upgrade head --sql đã chạy thêm **42 assertion đạt** với seed/nghiệp vụ tương tự và kiểm tra revision 0001_secure_share. Đây là bộ kiểm tra có phần trùng với schema test, không phải 95 ca độc lập.

Cách thực thi: mysqld --initialize-insecure --init-file trong data directory tạm riêng, không mở socket. Chưa kiểm tra kết nối online qua driver hoặc HTTP backend thật. Chi tiết frontend và các giới hạn: docs/quang/validation.md.
