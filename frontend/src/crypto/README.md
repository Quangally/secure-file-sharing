# Module crypto — TV2

AES/RSA/SHA được dùng bởi `fileCrypto.js` trong luồng upload/download/share. Web Crypto yêu cầu HTTPS hoặc localhost.

`keyManager.js` tạo và lưu cặp CryptoKey trong IndexedDB, đăng ký public JWK qua API tài khoản, kiểm tra khóa khi mở ứng dụng và phục hồi đăng ký khi mất phản hồi. `DeviceKeys` cung cấp nút tạo khóa và hướng dẫn giới hạn một thiết bị. Private key non-extractable không được xuất hoặc gửi đi.

`fileCrypto.js` mã hóa riêng nội dung và metadata bằng cùng AES key, hai IV khác nhau, AAD gắn UUID và loại payload. `ShareDialog` yêu cầu nhập fingerprint nhận qua kênh độc lập; key manager pin fingerprint theo tài khoản/người nhận và yêu cầu xác minh lại khi thay đổi. `fileManager.share` kiểm tra pin trước khi mở owner envelope.

Xem [bàn giao phần Bắc](../../../docs/bac/README.md) cho giao diện tích hợp, phục hồi lỗi và checklist nghiệm thu.

Thực hiện wrap cho chính chủ ngay khi upload; dùng owner envelope để chia sẻ sau. AES key extractable chỉ dùng để wrap trong RAM, không lưu raw key. API mẫu unwrap mặc định non-extractable cho người nhận. Không gửi CryptoKey hoặc khóa raw đến backend.

GCM đã xác thực ciphertext và AAD. SHA-256 ciphertext phục vụ so sánh/đo đạc; hash độc lập do server trả không chống được kẻ sửa cả nội dung lẫn hash. RSA-OAEP không chứng minh danh tính người gửi.

Nguồn: https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/
