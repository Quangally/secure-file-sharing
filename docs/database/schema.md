# Thiết kế dữ liệu Secure Share v1

## Phạm vi và giả định

Thiết kế theo 6 ảnh giao diện của An và đã có adapter ở trang kho tệp của Quang. API nghiệp vụ của Phúc/Vũ chưa được triển khai trong repo. Công nghệ mục tiêu là **MySQL 8.4**, không dùng cấu trúc dành riêng cho PostgreSQL. SQL chính ở `database/01_schema.sql`; Alembic revision `0001_secure_share` sử dụng cùng định nghĩa, không tạo hai schema khác nhau.

Một user có một public key hoạt động; một tệp có một chủ và nhiều người nhận, tất cả ở quyền đọc/tải. File payload bất biến sau khi ready. Người nhận phải có tài khoản và key, không có link công khai, gửi email mời, thư mục, phiên bản tệp, quản trị viên hoặc quota trong phạm vi hiện tại.

## Từ điển dữ liệu

### users

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | CHAR(36), PK | UUID user do backend sinh |
| full_name | VARCHAR(100) | Họ tên ở form đăng ký và thanh tên người dùng |
| email | VARCHAR(254), UNIQUE | Email ASCII chuẩn hóa; so khớp không phân biệt hoa/thường |
| password_hash | VARCHAR(255) | Chuỗi Argon2id gồm tham số/salt/hash; không lưu mật khẩu hoặc SHA-256 đơn thuần |
| status | ENUM active/disabled | Vô hiệu hóa tài khoản mà giữ lịch sử |
| created_at, updated_at | DATETIME(6) | Thời gian UTC |
| last_login_at | DATETIME(6), NULL | Backend cập nhật sau login thành công |

### auth_sessions

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | CHAR(36), PK | UUID phiên |
| user_id | CHAR(36), FK users | Người đăng nhập |
| token_hash | BINARY(32), UNIQUE | SHA-256 của UTF-8 cookie token ngẫu nhiên; token rõ không lưu DB |
| created_at, expires_at | DATETIME(6) | Hạn phải sau thời điểm tạo |
| revoked_at | DATETIME(6), NULL | Có giá trị thì logout/thu hồi; luôn kiểm tra cả expires_at |

### public_keys

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | CHAR(36), PK | Key ID gắn với envelope, không thay bằng user ID |
| user_id | CHAR(36), FK users | Chủ khóa |
| public_key_jwk | JSON | JWK public RSA có kty/n/e, không có private components |
| fingerprint_sha256 | BINARY(32), UNIQUE | SHA-256(SPKI DER public key), API/client có thể hiển thị hex |
| rsa_bits | SMALLINT UNSIGNED | Cố định 2048 trong protocol v1 |
| created_at, revoked_at | DATETIME(6) | Key hết hiệu lực không nhận envelope mới |
| active_slot | TINYINT GENERATED | 1 khi chưa revoke, NULL khi revoke; không tự INSERT cột này |

UNIQUE(user_id, active_slot) đảm bảo mỗi user tối đa một key hoạt động. UNIQUE(id,user_id) cho phép FK ghép kiểm tra key đúng chủ. API còn phải parse JWK, kiểm tra số bit/exponent, thuật toán và tính lại fingerprint; SQL không chứng minh cặp khóa mật mã hợp lệ.

### files

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | CHAR(36), PK | UUID bất biến, tham gia AAD |
| owner_id | CHAR(36), FK users | Chủ tệp, lấy từ session |
| storage_key | VARCHAR(160), UNIQUE | Tên nội bộ ngẫu nhiên, ví dụ UUID.bin; không chứa tên gốc/path từ client |
| ciphertext_size | BIGINT UNSIGNED | Số byte ciphertext gồm tag, >=16 |
| ciphertext_sha256 | BINARY(32) | Backend tính trên ciphertext thực nhận, dùng đối chiếu lưu trữ |
| content_iv | VARBINARY(12) | Đúng 12 byte, nonce cho nội dung |
| metadata_iv | VARBINARY(12) | Đúng 12 byte, khác content_iv |
| encrypted_metadata | VARBINARY(4096) | AES-GCM C||tag của JSON name/mimeType/size; kiểm tra giới hạn trước khi lưu |
| protocol_version | SMALLINT UNSIGNED | Cố định 1, xác định thuật toán/AAD/encoding |
| status | ENUM uploading/ready/deleted | Chỉ ready mới liệt kê/tải/chia sẻ |
| created_at, updated_at | DATETIME(6) | UTC, frontend tự định dạng Hôm nay/Hôm qua |
| deleted_at | DATETIME(6), NULL | Bắt buộc có khi status=deleted, còn lại NULL |

UNIQUE(id,owner_id) dùng cho FK ghép bên file_access. Không có original_name, extension hay mime_type rõ vì các giá trị này nằm trong encrypted_metadata. Đếm tổng tệp bằng COUNT hoặc số kết quả của truy vấn đã lọc quyền, không lưu thêm một bộ đếm.

### file_access

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| file_id, user_id | CHAR(36), PK ghép | Một row quyền/envelope cho mỗi người trên một tệp |
| owner_id | CHAR(36), FK ghép với file_id | Bản sao owner có kiểm soát để kiểm tra vai trò bằng CHECK |
| key_id | CHAR(36), FK ghép với user_id | Khóa RSA đúng người được cấp quyền |
| access_type | ENUM owner/share | Chủ tệp hoặc người nhận |
| wrapped_aes_key | VARBINARY(256) | Đúng 256 byte RSA-OAEP ciphertext cho 32 byte AES key |
| created_at | DATETIME(6) | Lần đầu tạo quan hệ |
| granted_at | DATETIME(6) | Lần cấp/cấp lại gần nhất, dùng ngày chia sẻ trên UI |
| revoked_at | DATETIME(6), NULL | NULL là còn quyền; không được revoke owner |

Owner row bắt buộc user_id=owner_id và không revoke; share row phải user_id khác owner. Backend xác thực người gọi là owner trước khi thay đổi quyền. Ràng buộc dữ liệu không thay thế xác thực request.

Không có cột raw_aes_key. Recipient không dùng owner envelope; server trả envelope theo user hiện tại. Trường “2 người” được COUNT từ share rows chưa revoke của user active; không tính owner. Cấp lại sau revoke cập nhật cùng PK, audit giữ sự kiện lịch sử.

### audit_logs

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| id | BIGINT UNSIGNED AUTO_INCREMENT, PK | Mã nhật ký nội bộ |
| actor_id | CHAR(36), FK users, NULL | Người thao tác; NULL khi chưa xác định tài khoản |
| file_id | CHAR(36), FK files, NULL | Đối tượng tệp nếu có |
| target_user_id | CHAR(36), FK users, NULL | Người nhận/người bị thu hồi nếu có |
| action | VARCHAR(32) có CHECK | user.register, auth.login/logout, key.register/revoke, file.upload/download/share/revoke/delete |
| outcome | ENUM success/denied/error | Kết quả xử lý |
| request_id | CHAR(36), INDEX | UUID để liên kết request; không bắt buộc unique vì một request có thể có nhiều event |
| occurred_at | DATETIME(6) | Thời gian UTC |

Nhật ký chỉ giữ IDs và sự kiện, không có JSON tùy ý để tránh ghi nhầm khóa/token/nội dung/tên tệp. Backend phải bảo vệ quyền xem log. Không có bảng lịch sử giao diện vì UI chưa yêu cầu màn hình riêng.

## Quan hệ và chính sách xóa

- users 1–N auth_sessions, public_keys, files, file_access và audit_logs.
- files 1–N file_access, audit_logs.
- public_keys 1–N file_access; FK ghép bảo đảm key thuộc user của row quyền.
- FK ghép (file_id,owner_id) bảo đảm share row không khai sai chủ tệp.
- Tất cả FK giữ mặc định RESTRICT/NO ACTION. Chọn xóa mềm file, disable user, revoke session/key/share; giữ tham chiếu và audit. Nếu sau này purge, cần chính sách retention riêng và xóa theo thứ tự child→parent, không bật tắt FOREIGN_KEY_CHECKS để né lỗi.

CHECK không tham chiếu bảng khác/subquery; vì vậy các kiểm tra liên bảng dùng FK ghép. Không dùng CASCADE/SET NULL trên các cột tham gia CHECK. Thiết kế này chủ động tránh xung đột CHECK/referential action của MySQL.

## Quy tắc backend còn phải đảm bảo

DB không biết ai đang gọi HTTP và không thể xác minh AES/RSA ciphertext. Backend phải xác thực session, owner/recipient, active status, key/fingerprint, kích thước payload, transaction owner envelope và độ dài bytes sau decode. Client phải xác minh khóa, kiểm tra tag, giải mã metadata trước khi hiển thị và chỉ tạo file tải xuống sau khi decrypt thành công.

Không suy luận “mã hóa đầu cuối đã hoàn thành” chỉ vì DB không có private key: cần kiểm thử request/response, storage, logs và luồng client thực tế.
