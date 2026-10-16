TV1: auth/users; TV4: files/shares/audit. Kiểm tra quyền ở server.

`accounts.py` triển khai POST `/auth/register`, `/auth/login`, `/auth/logout`, GET/PATCH `/me`, POST `/me/password`, POST `/me/keys`, GET `/users/lookup`. Đăng ký tự tạo phiên để frontend gọi `/me`; login cũng trả `{ "status": "ok" }` để adapter gọi `/me` và ghi nhớ CSRF token. `/me` trả `current_key` hoặc null.

API tệp dùng dependency `CurrentUser` cho GET và `MutatingUser` cho POST/PATCH/DELETE từ `app.api.accounts`. Dependency này lấy user từ cookie, kiểm tra session còn hiệu lực và xác minh `X-CSRF-Token` gắn với phiên. Không nhận owner/user id do client tự khai. `get_session` trong `app.database.session` là kết nối theo request; route tự `commit` transaction.

Biến môi trường: `DATABASE_URL` bắt buộc cho API tài khoản; `ALLOWED_ORIGINS` là danh sách origin frontend cách nhau bởi dấu phẩy; `COOKIE_SECURE=true` khi chạy HTTPS. Cookie mặc định 7 ngày, HttpOnly, SameSite=Lax; production cần HTTPS. Giới hạn tần suất login/lookup trong process chỉ là lớp bảo vệ cơ bản; cấu hình giới hạn chia sẻ ở reverse proxy khi chạy nhiều worker. Chưa có vai trò admin trong schema, nên API quản lý người dùng chỉ cho phép chủ tài khoản sửa hồ sơ/mật khẩu và tra cứu người nhận theo email.
