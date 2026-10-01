# Module crypto — TV2

AES/RSA/SHA là primitive mẫu đã có kiểm thử, chưa ghép vào UI/API. Web Crypto yêu cầu môi trường trình duyệt phù hợp (HTTPS hoặc localhost).

Tuần 3–6: thêm keyManager.js (IndexedDB, khóa riêng non-extractable), fileCrypto.js (đóng gói tên gốc + dữ liệu trong payload mã hóa), encoding base64 và fingerprint SHA-256 của public key SPKI. Xác minh fingerprint qua kênh độc lập trước lần chia sẻ đầu; pin khóa và cảnh báo đổi khóa.

Thực hiện wrap cho chính chủ ngay khi upload; dùng owner envelope để chia sẻ sau. AES key extractable chỉ dùng để wrap trong RAM, không lưu raw key. API mẫu unwrap mặc định non-extractable cho người nhận. Không gửi CryptoKey hoặc khóa raw đến backend.

GCM đã xác thực ciphertext và AAD. SHA-256 ciphertext phục vụ so sánh/đo đạc; hash độc lập do server trả không chống được kẻ sửa cả nội dung lẫn hash. RSA-OAEP không chứng minh danh tính người gửi.

Nguồn: https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/
