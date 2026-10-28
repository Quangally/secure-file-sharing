# Script chạy local

`start_backend.py` là launcher phát triển: cấu hình `.env` một lần, nạp cấu hình, kiểm tra kết nối MySQL bằng SELECT 1 và chạy Uvicorn với reload. Dùng thư mục gốc dự án làm working directory để đường dẫn storage không đổi theo nơi mở terminal.

Windows chạy `start-backend.cmd` ở thư mục gốc; script tự chọn `.venv` hoặc venv cũ `backend/.venv`. Không cần kích hoạt venv hay đổi execution policy PowerShell. Thêm `--configure` để nhập lại thông tin MySQL. Xem [hướng dẫn](../docs/development/local-backend.md).
