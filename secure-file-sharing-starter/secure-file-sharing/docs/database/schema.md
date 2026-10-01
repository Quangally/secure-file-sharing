# Thiết kế database dự kiến — TV4

| Bảng | Trường chính |
|---|---|
| users | id UUID PK, username UNIQUE, email UNIQUE, password_hash, created_at |
| public_keys | id UUID PK, user_id FK, public_key_jwk JSONB, fingerprint, algorithm, created_at, revoked_at |
| files | id UUID PK, owner_id FK, storage_name UNIQUE, ciphertext_size, ciphertext_sha256, iv_base64, aad_base64, protocol_version, created_at |
| file_access | id UUID PK, file_id FK, user_id FK, key_id FK, wrapped_aes_key, access_type owner/share, created_at, revoked_at |
| audit_logs | id UUID PK, actor_id FK, file_id nullable FK, action, created_at, request_id |

UNIQUE(file_id,user_id) cho file_access; kiểm tra key thuộc user và thuật toán đúng khi cấp quyền. Owner access luôn được tạo cùng upload. Khi chia sẻ lại sau thu hồi, cập nhật quyền/envelope trong transaction. Khóa public cũ giữ theo key_id để không làm hỏng envelope cũ; rotation hoàn chỉnh ngoài MVP.

Không có cột private_key hoặc raw_aes_key. Không lưu tên gốc dạng rõ. wrapped_aes_key và metadata không cần đưa vào audit log. Định nghĩa cascade/soft delete phù hợp trước migration; giữ log theo chính sách đã chốt.

Thực hiện SQLAlchemy models và Alembic migration tuần 2–4. docker-compose chưa tự tạo các bảng này.
