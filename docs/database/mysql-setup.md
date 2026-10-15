# Thiết lập MySQL cho nhóm

Bộ khung dùng MySQL 8.4 + SQLAlchemy + PyMySQL[rsa]. MySQL Workbench là công cụ thao tác; cần MySQL Server hoặc container MySQL để có database. Chọn một trong hai cách dưới đây.

## Cách 1 — MySQL Server đã cài trên máy

Mở kết nối local bằng Workbench với tài khoản có quyền tạo database/user. Chạy, sau khi thay mật khẩu mẫu:

```sql
CREATE DATABASE IF NOT EXISTS secure_share
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'secure_share'@'localhost'
  IDENTIFIED BY 'replace_with_local_password';
GRANT ALL PRIVILEGES ON secure_share.* TO 'secure_share'@'localhost';
```

Nếu user đã tồn tại thì CREATE USER IF NOT EXISTS không đổi mật khẩu: dùng mật khẩu hiện có hoặc ALTER USER theo cấu hình nhóm. Đây là quyền trên database của đồ án, không cấp quyền toàn server.

Tạo file .env ở gốc từ .env.example. Điền DATABASE_URL và password của tài khoản secure_share. Các biến MYSQL_* chỉ phục vụ khởi tạo Docker; sửa .env không tự đổi tài khoản trong MySQL Server đã cài.

```text
DATABASE_URL=mysql+pymysql://secure_share:YOUR_PASSWORD@127.0.0.1:3306/secure_share?charset=utf8mb4
```

Dùng đúng port local nếu khác 3306. URL-encode ký tự đặc biệt trong password nếu ghép URL dạng chuỗi. Không dùng tài khoản root làm tài khoản ứng dụng.

## Cách 2 — Docker

1. Sao chép .env.example thành .env ở gốc.
2. Thay MYSQL_PASSWORD và MYSQL_ROOT_PASSWORD bằng hai mật khẩu local khác nhau; cập nhật password trong DATABASE_URL tương ứng.
3. Chạy `docker compose up -d db`.
4. Xem `docker compose ps`; đợi trạng thái healthy. Lần khởi tạo đầu có thể mất thời gian.
5. Workbench kết nối host 127.0.0.1, port MYSQL_PORT (mặc định 3306), user secure_share và mật khẩu trong .env.

Nếu máy đã có MySQL dùng port 3306, có thể đổi MYSQL_PORT=3307 và port trong DATABASE_URL thành 3307. Dữ liệu lưu volume mysql_data. Không dùng lệnh xóa volume để sửa lỗi thông thường.

MYSQL_DATABASE/USER/PASSWORD/ROOT_PASSWORD chỉ khởi tạo tài khoản/database khi volume còn trống; sửa biến không tự cập nhật tài khoản trong volume đã có dữ liệu.

Backend bộ khung chạy trên máy, nên URL dùng 127.0.0.1. Nếu sau này đưa backend vào cùng Compose, host sẽ là db, port 3306.

## Tạo bảng — chọn một cách

**Dùng Workbench:** mở và chạy toàn bộ `database/01_schema.sql`. Đây là một file chính tạo database + 6 bảng, không kèm dữ liệu mẫu, không DROP. Không cần chạy các SQL ví dụ. Refresh SCHEMAS để xem bảng.

**Dùng migration trong dự án:** tạo database rỗng trước bằng Workbench hoặc Docker. Cài `backend/requirements.txt`, nạp DATABASE_URL vào môi trường rồi chạy từ thư mục gốc:

```powershell
# Ví dụ PowerShell: nhập URL local của bạn, không commit mật khẩu.
$env:DATABASE_URL = Read-Host 'DATABASE_URL'
python -m alembic -c backend/alembic.ini upgrade head
python -m alembic -c backend/alembic.ini current
```

Tạo `.env` không đồng nghĩa Alembic tự đọc file đó. Lệnh trên đọc biến môi trường; Phúc có thể dùng loader của backend sau. Alembic không tự CREATE DATABASE hoặc đổi sang tên database khác; nó chạy trong database đã chỉ định ở URL. Cần quyền DDL cho tài khoản chạy migration, tài khoản ứng dụng thường chỉ cần DML. Không dùng cả hai cách tạo bảng lần lượt trên cùng database.

Nếu đã chạy SQL trước, migration sẽ dừng khi phát hiện bảng tồn tại. Chỉ dùng `alembic stamp 0001_secure_share` sau khi đã đối chiếu tất cả cột, index, FK và CHECK với SQL v1; stamp chỉ ghi phiên bản, không sửa cấu trúc. Không stamp mù để bỏ lỗi. Không DROP database hoặc tắt FOREIGN_KEY_CHECKS để né lỗi.

`database/01_schema.sql` là định nghĩa khởi tạo v1 bất biến. Các thay đổi sau cần revision mới, không sửa ngược nội dung v1 khi đã được nhóm áp dụng. MySQL DDL có implicit commit; nếu migration dừng giữa chừng cần xem bảng đã tạo, không cho rằng ROLLBACK xóa toàn bộ DDL. `alembic downgrade base` xóa các bảng và dữ liệu; không phải lệnh setup thông thường.

## Kết nối backend

`backend/app/database/session.py` cung cấp get_engine() và session_scope(), đọc DATABASE_URL khi cần. Connection đặt UTC và strict mode; không tạo bảng tự động khi start API. Phúc/Vũ dùng session_scope cho giao dịch hoặc dùng engine này trong lớp ORM của mình. Không có thay đổi endpoint nghiệp vụ trong phần Quang.

FastAPI /health chỉ kiểm tra API, chưa kiểm tra MySQL. Xem `docs/api/contract.md` và `docs/quang/README.md` để ghép các phần. Không commit .env. File .env.example chỉ chứa placeholder.

Nguồn:
- https://docs.sqlalchemy.org/en/20/dialects/mysql.html#module-sqlalchemy.dialects.mysql.pymysql
- https://hub.docker.com/_/mysql
