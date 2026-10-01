# Hợp đồng API dự kiến — chưa triển khai

Chỉ GET /health đã có code. Endpoint dưới đây là đầu việc tuần 3–6.

| Method | Endpoint | Quyền / chức năng |
|---|---|---|
| POST | /auth/register | Tạo tài khoản, password hash, public key |
| POST | /auth/login | Đăng nhập, token/session có hạn |
| GET | /users/me | Tài khoản hiện tại |
| GET | /users/search?q= | Tìm người nhận; yêu cầu đăng nhập, giới hạn kết quả |
| GET | /users/{id}/keys/current | Public key + key_id + fingerprint |
| POST | /files | Upload ciphertext và owner envelope, kiểm tra giới hạn |
| GET | /files | Tệp của tôi |
| GET | /files/shared-with-me | Tệp được chia sẻ |
| GET | /files/{id}/content | Ciphertext; owner hoặc share còn hiệu lực |
| GET | /files/{id}/envelope | Envelope của chính người gọi |
| POST | /files/{id}/shares | Chỉ owner; receiver_id, key_id, wrapped_key |
| DELETE | /files/{id}/shares/{share_id} | Chỉ owner; thu hồi truy cập mới |
| GET | /audit-logs/me | Nhật ký của người gọi |

Upload multipart gồm ciphertext binary và manifest JSON: protocol_version, file_id UUID, iv_base64 (12 byte), aad_base64, ciphertext_sha256, ciphertext_size, owner_key_id, owner_wrapped_key_base64. Tag 16 byte nối trong ciphertext. Tên gốc/MIME đặt trong payload mã hóa; backend dùng UUID làm storage name.

key_id/file_id/receiver_id được kiểm tra ở server. Owner_id lấy từ session, không tin input. Không nhận khóa raw/private key. MVP tệp gốc tối đa 25 MiB; giới hạn ciphertext cần thêm overhead đóng gói + tag.

Không trả lỗi chi tiết lộ sự tồn tại tệp cho người không có quyền. Token không đưa vào URL/log. Chốt cơ chế session/token, CORS, CSRF và lưu token trước tuần 3; không lưu token lâu dài vào localStorage theo thói quen.
