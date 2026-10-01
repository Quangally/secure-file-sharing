# Threat model

| Nguy cơ | Biện pháp / giới hạn |
|---|---|
| Lộ database/storage | Ciphertext và wrapped keys; không lưu khóa rõ |
| Người C thay file_id để tải | Backend kiểm tra owner/share đang hoạt động trên mọi API |
| Sửa ciphertext/tag/IV/AAD | GCM reject; test âm |
| Server tráo public key | Fingerprint xác minh qua kênh độc lập, pin khóa và cảnh báo đổi khóa |
| XSS / mã JS độc hại | Giảm script bên thứ ba, CSP khi deploy, tránh HTML tùy ý; non-extractable không ngăn mã độc dùng khóa |
| Server phân phối JavaScript độc hại | Ngoài bảo đảm của MVP web; server bị chủ động kiểm soát có thể lấy dữ liệu tại client |
| Mất khóa riêng | Không khôi phục được tệp cũ ở MVP; ghi rõ khi đăng ký |
| Thu hồi sau khi đã tải | Chỉ ngăn lượt truy cập mới |
| Lộ metadata | Tên gốc trong ciphertext; kích thước, chủ tệp, người nhận, thời gian vẫn có thể lộ |
| Tệp quá lớn | Giới hạn MVP 25 MiB; benchmark bộ nhớ trước khi tăng |

Bảo đảm E2EE phụ thuộc thiết bị/client tin cậy và public key đã xác minh. Demo không chứng minh chống mọi kiểu tấn công.
