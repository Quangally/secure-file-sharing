# Hợp đồng tích hợp đề xuất

Đây là contract v1 mà trang kho tệp của Quang đang gọi. API tài khoản đã triển khai; API tệp/chia sẻ còn cần triển khai. IDs là UUID chữ thường. Thời gian API dùng ISO 8601 có Z; SQL dùng DATETIME(6) UTC. Khi dùng SQLAlchemy, chuyển datetime có timezone về UTC trước khi ghi và gắn timezone UTC khi serialize.

## Phiên đăng nhập và phản hồi tài khoản

Frontend dùng cookie HttpOnly với credentials=include, không lưu token vào localStorage. Với lựa chọn session opaque ở schema, Phúc cung cấp GET /me sau khi đăng nhập:

```json
{
  "id":"10000000-0000-4000-8000-000000000001",
  "full_name":"Tên người dùng",
  "email":"user@example.test",
  "csrf_token":"random-session-bound-csrf-token",
  "current_key":{
    "key_id":"20000000-0000-4000-8000-000000000001",
    "public_key_jwk":{"kty":"RSA","n":"base64url-modulus","e":"AQAB","key_ops":["wrapKey"],"ext":true},
    "fingerprint_sha256":"64-lowercase-hex-characters"
  }
}
```

current_key=null khi chưa đăng ký key. csrf_token là token riêng chống CSRF gắn với phiên, không phải cookie đăng nhập, private key hoặc AES key. Backend sinh/xác minh token này và Origin/SameSite phù hợp; frontend gửi header X-CSRF-Token cho POST/DELETE. Không có CSRF token thì client từ chối thay đổi dữ liệu. Không dùng PHC password_hash hay auth_sessions.token_hash làm CSRF token. Nếu Phúc chọn cơ chế auth khác, đổi adapter cùng nhau trước khi ghép.

Local Vite proxy /api → localhost:8000 để dùng cùng origin; production cấu hình reverse proxy /api. Khi dùng VITE_API_BASE_URL khác origin, Phúc phải cho phép đúng origin, credentials, header X-CSRF-Token và các method cần thiết; không dùng wildcard origin với cookie.

## Màn hình và API

| Màn hình/thao tác | API dự kiến | Nguồn DB / người phối hợp |
|---|---|---|
| Đăng ký | POST /auth/register | users; Phúc + An |
| Đăng nhập | POST /auth/login | users, auth_sessions; Phúc + An |
| Đăng xuất | POST /auth/logout | revoke session; Phúc + An |
| Tên user / Cài đặt | GET /me | users + thông tin public key hiện tại; Phúc + Bắc |
| Sửa tên hiển thị | PATCH /me | users; yêu cầu X-CSRF-Token |
| Đổi mật khẩu | POST /me/password | users + thu hồi các phiên khác; yêu cầu X-CSRF-Token |
| Đăng ký public key | POST /me/keys | public_keys; Bắc + Phúc |
| Tệp của tôi | GET /files | my_files; Vũ + Quang + helper Bắc |
| Upload | POST /files | ciphertext + manifest + owner envelope; Vũ + Bắc + Quang |
| Tra người nhận | GET /users/lookup?email=... | recipient_lookup; Vũ + An + Bắc |
| Cấp quyền | POST /files/{id}/shares | file_access + audit; Vũ + Bắc + An |
| Người nhận hiện tại | GET /files/{id}/shares | share_recipients; Vũ + An |
| Thu hồi quyền | DELETE /files/{id}/shares/{user_id} | revoke_access; Vũ + An |
| Được chia sẻ với tôi | GET /files/shared-with-me | shared_with_me; Vũ + An + helper Bắc |
| Metadata/envelope của tôi | GET /files/{id}/envelope | authorized_download; Vũ + Bắc |
| Nội dung đã mã hóa | GET /files/{id}/content | authorized_download → stream storage; Vũ + Quang/An |
| Xóa tệp | DELETE /files/{id} | soft_delete_file; Vũ + Quang |

Đặt route tĩnh shared-with-me trước route UUID động hoặc dùng bộ định tuyến/UUID validation phù hợp. API danh sách cần phân trang và giới hạn kích thước trang. Không trả toàn bộ users/public keys để tra cứu vô hạn; xác thực và giới hạn tần suất lookup.

## Đăng ký

```json
{"full_name":"Tên người dùng","email":"user@example.test","password":"...","confirm_password":"..."}
```

Backend kiểm tra hai mật khẩu giống nhau rồi bỏ confirm_password; băm mật khẩu bằng Argon2id. Mật khẩu đăng nhập không dùng trực tiếp làm AES key của tệp. Đăng ký public key cần một request đã xác thực; backend tự lấy user_id.

## Public key

```json
{"public_key_jwk":{"kty":"RSA","n":"base64url-modulus","e":"AQAB","alg":"RSA-OAEP-256","key_ops":["encrypt","wrapKey"],"ext":true}}
```

Backend trả key_id, public JWK và fingerprint_sha256 hex. Tự tính fingerprint từ SPKI DER, không tin fingerprint client gửi lúc đăng ký. Không gửi private JWK lên API. Đăng ký lần đầu và rotate key là hai luồng riêng: v1 không tự thay key đang tồn tại.

## Manifest upload

Upload multipart: `ciphertext` là Blob nhị phân, filename truyền tải dùng UUID.bin; `manifest` là JSON:

```json
{
  "file_id":"30000000-0000-4000-8000-000000000001",
  "protocol_version":1,
  "content_iv_base64":"12-byte-IV-as-standard-base64",
  "metadata_iv_base64":"different-12-byte-IV-as-standard-base64",
  "encrypted_metadata_base64":"AES-GCM-C-plus-tag-as-base64",
  "owner_key_id":"20000000-0000-4000-8000-000000000001",
  "owner_wrapped_aes_key_base64":"256-byte-RSA-ciphertext-as-base64"
}
```

Các chuỗi ở trên là nhãn mô tả định dạng, không phải dữ liệu Base64 chạy được. Xem `02_demo.sql`/fixtures để có bytes thật. Backend tính ciphertext_size/hash, tạo storage_key an toàn. Không nhận/trả filename gốc rõ hoặc raw AES key. UUID chỉ định đối tượng, không phải bí mật và không thay thế kiểm tra quyền. Từ chối UUID đã tồn tại, không cho ghi đè payload/envelope đã cấp cho người khác.

## Danh sách tệp

GET /files?page=1&page_size=20 trả JSON đúng dạng:

```json
{"items":[],"page":1,"page_size":20,"total":0}
```

page bắt đầu từ 1, page_size của trang Quang là 20. Backend áp dụng LIMIT/OFFSET, total đếm đủ tệp ready đúng owner với cùng bộ lọc quyền như my_files. Thứ tự updated_at DESC, id ASC. Tìm kiếm tên chạy trong trang hiện tại sau giải mã; server không thể tìm tên rõ đã mã hóa.

Mỗi item có id, content_iv_base64, metadata_iv_base64, encrypted_metadata_base64, protocol_version, key_id, wrapped_aes_key_base64 của user hiện tại, ciphertext_size và timestamps. Tệp của tôi có thêm share_count; danh sách nhận có shared_by/shared_at.

GET /files/{id}/envelope trả một item tương tự, bắt buộc thêm ciphertext_sha256 dạng hex thường 64 ký tự. GET /files/{id}/content trả bytes C||tag, không redirect sang trang HTML/login hoặc URL storage công khai. Giới hạn nội dung gốc 25 MiB; ciphertext đúng size+16. API phải kiểm tra quyền riêng ở cả hai endpoint. POST /files thành công trả 201 JSON {"id":"UUID-vừa-upload"}; DELETE /files/{id} thành công trả 204 không body. Không trả thành công trước khi transaction/storage hoàn tất.

Client gọi helper của Bắc để unwrap/decrypt metadata rồi tạo view model `{name,mimeType,size,updatedAt,shareCount}` cho giao diện. Không lấy ciphertext_size làm size gốc nếu muốn hiển thị đúng số byte của tệp trước mã hóa.

## Chia sẻ

```json
{
  "recipient_user_id":"10000000-0000-4000-8000-000000000002",
  "key_id":"20000000-0000-4000-8000-000000000002",
  "verified_fingerprint_sha256":"64-hex-characters",
  "wrapped_aes_key_base64":"256-byte-RSA-ciphertext-as-base64"
}
```

Không có raw_aes_key, private_key, owner_id lấy từ UI. Owner_id/current_user_id luôn lấy qua phiên. Nếu recipient chưa đăng ký/chưa có key thì UI thông báo, không tự tạo user từ chuỗi người nhận. Tình huống key thay đổi giữa lookup và POST phải từ chối/yêu cầu xác minh lại, không im lặng dùng key mới.

## Mẫu gọi SQL

Trong PyMySQL dùng `cursor.execute(sql, params)`; trong SQLAlchemy chuyển placeholder sang `:name` và bind parameters. `04_nghiep_vu.sql` dùng cú pháp PyMySQL, không phải f-string. Kiểm tra rowcount và ghi audit cùng transaction. Nếu lock_owned_file hoặc lock_recipient_key không có kết quả, dừng trước khi insert/update. Không cho frontend kết nối trực tiếp MySQL.

Các lỗi cần thống nhất gồm chưa đăng nhập/hết phiên, email trùng, người nhận không tồn tại/chưa có key, không có quyền, key thay đổi, payload sai định dạng và quá dung lượng. GCM tag sai được phát hiện ở client khi giải mã, không trả lỗi giả “giải mã thành công” từ backend chỉ dựa vào SHA-256.
