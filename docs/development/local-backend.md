# Khởi động backend local

MySQL Server phải chạy và database đã được tạo theo [hướng dẫn MySQL](../database/mysql-setup.md). Launcher không cài lại MySQL, tạo user, tạo bảng hoặc chạy migration.

## Windows

Mở PowerShell ở thư mục gốc dự án:

```powershell
.\start-backend.cmd
```

Lần đầu, nhập user MySQL (Enter để dùng root cho máy demo hiện tại) và mật khẩu MySQL. Ký tự mật khẩu không hiện khi gõ. Đây là tài khoản database, không phải tài khoản đăng nhập web. Có thể nhập user ứng dụng đã tạo, ví dụ `secure_share_app`, thay cho root.

Script tạo `.env` ở thư mục gốc, tự URL-encode mật khẩu có ký tự đặc biệt. Mặc định dùng MySQL `127.0.0.1:3306`, database `secure_share`. Nếu đã có URL trong `.env`, host/port/database được giữ khi cấu hình lại; các cài đặt khác trong file cũng được giữ.

Sau đó script đọc `.env`, kiểm tra kết nối và chạy backend tại http://127.0.0.1:8000. Những lần mở PowerShell sau chỉ cần chạy lại lệnh trên. Nhấn Ctrl+C để dừng. Frontend vẫn chạy bằng `npm run dev` trong terminal riêng.

Nếu đổi mật khẩu hoặc cấu hình nhầm:

```powershell
.\start-backend.cmd --configure
```

Nếu dùng MySQL ở host/port/database khác mặc định, sửa URL trong `.env` rồi chạy lại. Launcher ưu tiên cấu hình trong file, kể cả khi terminal còn biến DATABASE_URL cũ; các cách chạy backend thủ công không thay đổi quy tắc ưu tiên biến môi trường.

## Venv và thư viện

Launcher chọn `.venv/Scripts/python.exe`; nếu không có thì dùng `backend/.venv/Scripts/python.exe` để tương thích cách setup trước. Nếu chưa có venv, cài một lần ở thư mục gốc:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Linux/macOS dùng `.venv/bin/python -m pip install -r backend/requirements.txt`, rồi `.venv/bin/python scripts/start_backend.py`.

## Lỗi kết nối và cấu hình

- 1045: kiểm tra user/mật khẩu; chạy lại với `--configure`.
- 1049: chưa có database; tạo schema theo hướng dẫn MySQL trước.
- 2003: kiểm tra MySQL Server đang chạy, host và port.
- Cổng 8000 đang dùng: dừng backend cũ trước khi chạy launcher.

Preflight chỉ xác nhận kết nối bằng SELECT 1, không xác nhận đủ bảng hoặc quyền CRUD. Backend vẫn cần schema và quyền ứng dụng đúng.

`.env` chứa mật khẩu MySQL dạng văn bản, không mã hóa. Git đã bỏ qua file này; không đưa vào GitHub, ảnh chụp hoặc gửi cho người khác. Mỗi thành viên tự tạo cấu hình máy mình. `.env.example` chỉ là mẫu không chứa mật khẩu thật. Launcher không xuất connection string/mật khẩu ra log; kiểm thử chỉ dùng thông tin giả.
