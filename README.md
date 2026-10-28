# Secure File Sharing

**Hệ thống chia sẻ tệp an toàn có mã hóa đầu cuối** — đồ án môn Bảo mật và An toàn thông tin, nhóm 5 thành viên, thời gian 9 tuần.

## Trạng thái

Đã có schema MySQL 6 bảng, Alembic migration, backend tài khoản và API upload/download/chia sẻ/thu hồi/xóa tệp. Mã hóa chạy phía client qua Web Crypto, khóa riêng lưu trong trình duyệt; đã tích hợp quản lý khóa và xác minh/pin fingerprint người nhận. Giao diện giữ trang đang mở khi tải lại. Xem hướng dẫn chạy và kiểm thử bên dưới.

Xem **[Bàn giao phần Quang](docs/quang/README.md)** để setup, nhúng trang vào frontend An và xem các phụ thuộc còn lại.

## Công nghệ đề xuất

- Frontend: React + Vite, JavaScript, Web Crypto API.
- Backend: Python 3.11+ + FastAPI, SQLAlchemy + Alembic.
- Database: MySQL 8.4 (cài trực tiếp hoặc chạy database bằng Docker).
- Nghiên cứu trọng tâm AES-256-GCM; RSA-OAEP 2048/SHA-256 hỗ trợ chia sẻ khóa. Không triển khai ECC trong MVP.
- Mật khẩu đăng nhập: Argon2id, không mã hóa hai chiều.

## Cấu trúc

| Thư mục | Phụ trách | Nội dung |
|---|---|---|
| frontend/src/pages/MyFilesPage.jsx, components/ConfirmDelete.jsx | Quang | Kho tệp, upload/download/xóa |
| frontend/src/crypto | Bắc + adapter Quang | Mật mã phía client |
| frontend/src/services | Quang | Gọi API tệp, phối hợp Phúc/Vũ |
| backend/app/api, security | Phúc/Vũ | Tài khoản, API tệp và quyền |
| database, backend/alembic, backend/app/database | Quang | Schema, migration, kết nối MySQL |
| frontend tài khoản/chia sẻ | An | UI/UX và các trang tài khoản/chia sẻ |
| backend/tests, security-tests, frontend/src/**/*.test.* | Cả nhóm | Kiểm thử phần phụ trách |
| docs | Cả nhóm | Thiết kế, kế hoạch, báo cáo |
| .github | TV1 + TV5 | CI, mẫu Issue và PR |

## Chạy dự án

Frontend (Node.js 24.15+ thuộc dòng 24 hoặc Node 22.22.2+ thuộc dòng 22):

```bash
cd frontend
npm ci
npm run dev
```

Backend trên Windows: mở PowerShell tại thư mục gốc và chạy:

```powershell
.\start-backend.cmd
```

Lần đầu nhập tài khoản MySQL đang có và mật khẩu; trình khởi động tự tạo `.env` riêng trên máy, kiểm tra kết nối rồi mở backend. Những lần sau không cần nhập lại hoặc đặt `$env:DATABASE_URL`. File `.env` chứa mật khẩu DB dạng văn bản và đã được Git bỏ qua; không chia sẻ/commit file này. Khi đổi mật khẩu MySQL, dừng backend rồi chạy `.\start-backend.cmd --configure`.

Nếu chưa cài thư viện, chỉ cần cài một lần từ thư mục gốc:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Launcher cũng nhận venv cũ ở `backend/.venv`. Linux/macOS: tạo `.venv`, cài `backend/requirements.txt`, rồi chạy `.venv/bin/python scripts/start_backend.py`.

Xem [hướng dẫn khởi động backend](docs/development/local-backend.md) để cấu hình MySQL khác và xử lý lỗi. Các lệnh uvicorn/Alembic thủ công vẫn dùng biến môi trường như trước; launcher không tự tạo bảng hoặc chạy migration.

Frontend: http://127.0.0.1:5173. API: http://127.0.0.1:8000/health. Swagger: http://127.0.0.1:8000/docs. Vite chuyển `/api` tới backend; đăng ký/đăng nhập tự tạo cookie HttpOnly và frontend gọi `/me` để nhận CSRF token. Dùng thống nhất hostname/port để giữ đúng kho khóa IndexedDB.

Database: xem [hướng dẫn MySQL](docs/database/mysql-setup.md). Nếu đã cài MySQL Server 8.4, chạy **database/01_schema.sql** trong Workbench là tạo đủ 6 bảng. Hoặc dùng Docker và Alembic theo hướng dẫn; chọn một cách tạo bảng. Backend /health không truy vấn database.

## Kiểm tra

Từ thư mục gốc, không cần cài npm packages cho kiểm thử crypto:

```bash
node --test security-tests/crypto.test.mjs
python -m compileall backend/app
```

Sau khi cài frontend: `cd frontend` rồi `npm run build`.

Kiểm tra phần Quang: `cd frontend`, chạy `npm test` (component, HTTP adapter, IndexedDB và Web Crypto), rồi `npm run build`. Test HTTP dùng transport giả để kiểm tra frontend; chưa thay cho kiểm thử API thật.

## Tài liệu

- [Phân công chi tiết 9 tuần](docs/planning/9-week-plan.md)
- [Cách tạo repo trên GitHub web](docs/github-web-guide.md)
- [Quy tắc làm việc nhóm](CONTRIBUTING.md)
- [Luồng mã hóa và quản lý khóa](docs/security/encryption-flow.md)
- [Bàn giao phần Bắc: quản lý khóa và tích hợp E2EE](docs/bac/README.md)
- [Threat model và giới hạn](docs/security/threat-model.md)
- [Hợp đồng API dự kiến](docs/api/contract.md)
- [Thiết kế database](docs/database/schema.md)
- [Kế hoạch kiểm thử](docs/testing/test-plan.md)
- [45 đầu việc cho 9 tuần](docs/planning/backlog.json)

## Nguyên tắc bắt buộc

Mã hóa/giải mã nội dung và xử lý khóa riêng tại client. Backend lưu ciphertext, public key, wrapped AES keys và metadata tối thiểu; không nhận file gốc, AES key rõ hoặc private key rõ. Không commit mật khẩu, token, `.env`, private key hoặc dữ liệu cá nhân thật.

Mã hóa tệp không đồng nghĩa tên tệp/metadata được bảo mật; hợp đồng đề xuất đặt tên gốc bên trong payload mã hóa. Mất khóa riêng sẽ không mở được các tệp cũ. Thu hồi chỉ chặn lượt truy cập mới, không xóa được tệp hoặc khóa người nhận đã tải.
