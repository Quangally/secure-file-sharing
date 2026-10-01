# Luồng mã hóa dự kiến

1. Client sinh RSA-OAEP 2048/SHA-256. Public key xuất JWK lên server, private CryptoKey non-extractable lưu IndexedDB trên thiết bị.
2. Chủ tệp tạo file_id và AES key 256-bit mới; đóng gói tên gốc + nội dung trong payload mã hóa. Dùng IV ngẫu nhiên 12 byte, GCM tag 128 bit và AAD cố định theo protocol/file_id.
3. Ciphertext từ Web Crypto có tag nối ở cuối. Upload ciphertext, IV, AAD/protocol, SHA-256 ciphertext và owner envelope (AES key bọc bằng public key của chính chủ).
4. Chia sẻ sau: chủ tệp unwrap owner envelope tại client, kiểm tra fingerprint public key người nhận và wrap AES key cho người nhận. Server kiểm tra quyền rồi lưu recipient envelope.
5. Người nhận được cấp ciphertext/envelope; private key unwrap AES key; GCM decrypt và kiểm tra tag/AAD tại client; chỉ lưu tệp gốc khi thành công.
6. Khi thu hồi, server chặn download/envelope mới. Người nhận đã tải có thể giữ bản sao; thu hồi không xóa bản sao đó.

SHA-256 không thay thế GCM authentication. Không công khai plaintext hash nếu không cần, để giảm khả năng suy đoán tệp. RSA-OAEP bảo vệ khóa, không xác thực người gửi. Fingerprint cần xác minh qua kênh độc lập, không chỉ tin khóa do server trả.

MVP: một thiết bị/một hồ sơ trình duyệt. Xóa IndexedDB hoặc mất thiết bị có thể mất khóa; reset mật khẩu đăng nhập không khôi phục khóa. Sao lưu khóa riêng mã hóa và nhiều thiết bị là mở rộng, chưa có trong bộ khung.

Nguồn: https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/
