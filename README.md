# Secure File Sharing

**Hệ thống chia sẻ tệp an toàn có mã hóa đầu cuối** — đồ án môn Bảo mật và An toàn thông tin, nhóm 5 thành viên, thời gian 9 tuần.

## Trạng thái

Đây là bộ khung khởi tạo, chưa phải hệ thống chia sẻ tệp hoàn chỉnh. Đã có màn hình React khởi động, API health, module AES/RSA/SHA mẫu và kiểm thử mật mã. Đăng ký, đăng nhập, upload, chia sẻ, IndexedDB và database migration sẽ được nhóm triển khai theo kế hoạch.

## Công nghệ đề xuất

- Frontend: React + Vite, JavaScript, Web Crypto API.
- Backend: Python 3.11+ + FastAPI, SQLAlchemy + Alembic.
- Database: MySQL 8.4 (cài trực tiếp hoặc chạy database bằng Docker).
- Mật mã bản đầu: AES-256-GCM + RSA-OAEP 2048/SHA-256. ECC là mở rộng.
- Mật khẩu đăng nhập: Argon2id, không mã hóa hai chiều.

## Cấu trúc

| Thư mục | Phụ trách | Nội dung |
|---|---|---|
| frontend/src/pages, components | TV3 | Giao diện |
| frontend/src/crypto | TV2 + TV3 | Mật mã phía client |
| frontend/src/services | TV3 + TV1 | Gọi API |
| backend/app/api, security | TV1 | Xác thực và quyền |
| backend/app/models, database, services | TV4 | Dữ liệu, tệp và chia sẻ |
| backend/tests, security-tests | TV5 + cả nhóm | Kiểm thử |
| docs | Cả nhóm | Thiết kế, kế hoạch, báo cáo |
| .github | TV1 + TV5 | CI, mẫu Issue và PR |

## Chạy bộ khung

Frontend (Node.js 22.12+):

```bash
cd frontend
npm ci
npm run dev
```

Backend (terminal khác, Windows PowerShell):

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Linux/macOS: dùng `python3 -m venv .venv`, sau đó `.venv/bin/python -m pip install -r requirements.txt` và `.venv/bin/python -m uvicorn app.main:app --reload`.

Frontend: http://localhost:5173. API: http://localhost:8000/health. Swagger: http://localhost:8000/docs.

Database: xem [hướng dẫn MySQL](docs/database/mysql-setup.md). Nếu dùng Docker, sao chép `.env.example` thành `.env`, thay mật khẩu mẫu rồi chạy `docker compose up -d db`. Nếu đã cài MySQL Server, dùng trực tiếp, không cần Docker. Backend health hiện chưa kết nối database; ORM và migration được triển khai theo kế hoạch.

## Kiểm tra

Từ thư mục gốc, không cần cài npm packages cho kiểm thử crypto:

```bash
node --test security-tests/crypto.test.mjs
python -m compileall backend/app
```

Sau khi cài frontend: `cd frontend` rồi `npm run build`.

## Tài liệu

- [Phân công chi tiết 9 tuần](docs/planning/9-week-plan.md)
- [Cách tạo repo trên GitHub web](docs/github-web-guide.md)
- [Quy tắc làm việc nhóm](CONTRIBUTING.md)
- [Luồng mã hóa và quản lý khóa](docs/security/encryption-flow.md)
- [Threat model và giới hạn](docs/security/threat-model.md)
- [Hợp đồng API dự kiến](docs/api/contract.md)
- [Thiết kế database](docs/database/schema.md)
- [Kế hoạch kiểm thử](docs/testing/test-plan.md)
- [45 đầu việc cho 9 tuần](docs/planning/backlog.json)

## Nguyên tắc bắt buộc

Mã hóa/giải mã nội dung và xử lý khóa riêng tại client. Backend lưu ciphertext, public key, wrapped AES keys và metadata tối thiểu; không nhận file gốc, AES key rõ hoặc private key rõ. Không commit mật khẩu, token, `.env`, private key hoặc dữ liệu cá nhân thật.

Mã hóa tệp không đồng nghĩa tên tệp/metadata được bảo mật; hợp đồng đề xuất đặt tên gốc bên trong payload mã hóa. Mất khóa riêng sẽ không mở được các tệp cũ. Thu hồi chỉ chặn lượt truy cập mới, không xóa được tệp hoặc khóa người nhận đã tải.
