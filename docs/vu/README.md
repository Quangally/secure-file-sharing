# Bàn giao API tệp và chia sẻ của Vũ

Nhánh đã tích hợp phần khóa của Bắc từ main. Không thay đổi schema hoặc cần migration mới.

## Các sửa đổi tích hợp

- Chủ tệp phải active ở cả shared-with-me (items và total), envelope và content. Tệp của chủ disabled trả 404 khi truy cập trực tiếp.
- `shared_by` giữ object `{id, full_name, email}`. SharedFilesPage hiển thị tên, dự phòng bằng email hoặc “người dùng khác”.
- Danh sách người nhận trả `{file_id, items: [...]}` để ShareDialog hiển thị người nhận và thu hồi được.
- Manifest dùng Pydantic strict: sai JSON, sai kiểu, thiếu trường, UUID/protocol không hợp lệ trả 422. Kiểm tra hoàn tất trước khi ghi dữ liệu hoặc storage.
- Share/revoke/delete khóa file trong transaction bằng FOR UPDATE; share khóa recipient và public key theo chế độ shared, đọc file_access bằng locking read. Timestamps thay đổi được lấy sau khi chờ khóa, tránh thời điểm thu hồi trước thời điểm cấp quyền.
- Backend chỉ lưu ciphertext và wrapped AES key; không giải mã tệp và không nhận private key/raw AES key.

## Kiểm thử

Từ thư mục gốc:

```powershell
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
npm run test:crypto
```

Test nhanh backend dùng SQLite; không dùng kết quả này để kết luận về khóa InnoDB. `test_mysql_files.py` dùng schema thật trong `database/01_schema.sql`, gồm cả FK/CHECK/generated column. Khi không có `MYSQL_TEST_URL`, các test MySQL được skip có chủ đích.

Job `mysql` trên GitHub Actions chạy MySQL 8.4 và kiểm tra upload/share/download/revoke/regrant/delete, owner disabled, fingerprint sai, cùng các giao dịch cạnh tranh: delete/share, share trùng, revoke/regrant, key revoke/share và recipient disable/share. Mỗi test tạo rồi xóa database riêng có tên `secure_share_test_*`.

Để chạy nhóm test MySQL tại máy cá nhân, dùng một MySQL test server và tài khoản có quyền CREATE/DROP DATABASE. Đặt `MYSQL_TEST_URL` theo mẫu sau bằng thông tin riêng tại máy, không commit mật khẩu:

```powershell
$env:MYSQL_TEST_URL = "mysql+pymysql://TEST_USER:TEST_PASSWORD@127.0.0.1:3306"
python -m pytest backend/tests/test_mysql_files.py -q
Remove-Item Env:MYSQL_TEST_URL
```

Chỉ trỏ đến server dành cho kiểm thử. URL-encode mật khẩu nếu có ký tự đặc biệt.

## Demo trình duyệt cần xác nhận

1. Dùng cùng hostname/port cho từng browser profile để giữ đúng IndexedDB của Bắc.
2. A và B đăng ký, tạo khóa riêng; dùng hai browser profile để giữ hai phiên độc lập.
3. A upload tệp, xác minh fingerprint B qua kênh độc lập rồi chia sẻ.
4. B mở trang được chia sẻ: hiển thị tên A, tải và giải mã đúng byte gốc.
5. A thấy B trong danh sách, bấm Thu hồi; B không lấy được envelope hoặc ciphertext mới.

Thu hồi chặn các lần truy cập sau; không thu hồi được bản rõ/khóa mà người nhận đã tải trước đó. Các test React/jsdom và API không thay thế việc chạy demo trình duyệt thật.
