# Kiểm thử và thực nghiệm

## Đã có trong bộ khung

Node test: A→B round-trip với owner envelope; private key sai; ciphertext/tag/IV/AAD và AES key sai; tệp rỗng/nhị phân; SHA-256 known vector. Backend: health smoke test sau khi cài dependencies.

## Nhóm cần bổ sung

- Auth: đăng ký trùng, mật khẩu sai, session hết hạn, logout.
- Keys: tải lại trang/đăng nhập lại; mất IndexedDB; fingerprint thay đổi.
- Files: upload hợp lệ, quá giới hạn, upload lỗi không để record/storage mồ côi.
- Authorization: người C đổi file_id/share_id; tải ciphertext và envelope; tìm người dùng có giới hạn.
- Sharing: chia sẻ cho B, thu hồi chặn lượt tải mới, owner mở lại và chia sẻ lần hai.
- Client: giải mã fail không tạo bản tải xuống; không log key/token/plaintext.
- Storage/request: kiểm tra không có tệp gốc/AES key rõ/private key rõ.

## Đo hiệu năng tuần 8

1/10/25 MiB, mỗi mức 10 lần, ghi máy/OS/browser và điều kiện mạng. Tách AES encrypt/decrypt, RSA wrap/unwrap, upload/download và bộ nhớ. Báo cáo median/min/max hoặc phân bố; không điền số giả. 50/100 MiB là mở rộng sau khi kiểm tra giới hạn/bộ nhớ.

Demo: A upload → server ciphertext → A share B → B decrypt mở tệp → C bị từ chối → sửa ciphertext → GCM báo lỗi. Dùng dữ liệu giả và quay video dự phòng.
