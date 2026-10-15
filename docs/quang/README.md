# Bàn giao phần Trần Hoàng Đăng Quang

Phân công đối chiếu trong Doc ATBM ngày 15/10/2026: **MySQL + frontend quản lý tệp**, gồm thiết kế database, PK/FK, migration; kho tệp, upload/download và kết nối API. Bộ này hoàn thiện mã nguồn của phần Quang trên scaffold của nhóm; chưa khẳng định toàn hệ thống đã chạy khi phần API/tạo khóa chưa được ghép.

## Đã có

| Phần | Vị trí | Kết quả |
|---|---|---|
| CSDL MySQL 8.4 | database/01_schema.sql | Một SQL chính, 6 bảng, UNIQUE/FK/CHECK/index, không kèm seed |
| Migration | backend/alembic.ini, backend/alembic | Revision 0001_secure_share, online/offline, dùng cùng SQL v1 |
| Kết nối dữ liệu | backend/app/database/session.py | Engine lười khởi tạo, UTC/strict mode, session transaction |
| ERD/từ điển | docs/diagrams/database.*, docs/database/schema.md | Quan hệ, cột và giới hạn nghiệp vụ |
| Kho tệp | frontend/src/pages/MyFilesPage.jsx | Danh sách, tìm trong trang, phân trang, empty/loading/error/locked |
| Upload | fileManager + fileCrypto + fileApi | Tối đa 25 MiB, mã hóa content/metadata, owner envelope, tiến trình và hủy |
| Download | cùng các module trên | Chỉ lưu sau kiểm tra kích thước/hash và xác thực GCM, làm sạch tên lưu |
| Xóa | ConfirmDelete + API DELETE | Xác nhận, giữ focus/thoát bằng Escape, chỉ cập nhật sau server xác nhận |
| Ghép giao diện An | MyFilesPage props | onShare chuyển sang modal của An; không viết lại auth/share |
| Kiểm thử | frontend/src/**/*.test.* | Luồng bình thường, lỗi, quyền HTTP, khóa sai, sửa dữ liệu, hủy và phân trang |

## Chạy phần Quang

1. Cài MySQL Server 8.4 và mở kết nối Workbench. Chạy **database/01_schema.sql** một lần trên database dev mới; không cần chạy SQL examples. ERD nằm trong docs/diagrams.
2. Hoặc chọn Alembic theo docs/database/mysql-setup.md. Không chạy cả SQL tạo bảng và upgrade ban đầu nối tiếp trên cùng database. Không tự động downgrade/drop để reset.
3. Dùng Node 24.15+ thuộc dòng 24 hoặc 22.22.2+ thuộc dòng 22. Trong frontend: npm ci → npm test → npm run dev. Vite gọi /api và proxy sang backend cổng 8000.
4. Khởi động FastAPI của nhóm. Chỉ /health có sẵn trong scaffold. Trước khi API /me và /files được viết, trang báo chưa kết nối; đó là trạng thái thật, không phải dữ liệu mẫu đã được lưu.

Không có .env/password thật, private key hoặc tệp demo nhạy cảm trong commit này. Không đưa token đăng nhập lên URL/localStorage. File README và các SQL examples không phải lệnh bắt buộc chạy thêm.

## Nhúng vào frontend An

Giữ layout, router và session provider của An. Import trang và tạo manager một lần bằng useMemo hoặc ở module; không tạo một manager mới mỗi lần render, tránh tải lại liên tục.

```jsx
import MyFilesPage from './pages/MyFilesPage.jsx';
import { createFileApi } from './services/fileApi.js';
import { createFileManager } from './services/fileManager.js';
import { createFileCrypto } from './crypto/fileCrypto.js';
import { createDeviceKeyProvider } from './services/keyStore.js';

const api = createFileApi({ baseUrl: '/api' });
const manager = createFileManager({
  api,
  fileCrypto: createFileCrypto({ getKeyPair: createDeviceKeyProvider() }),
});

// profile lấy từ GET /me; api.me() tự nhận CSRF token cho instance này.
// Nếu session provider gọi /me qua client khác, gọi api.setCsrfToken(profile.csrf_token).
// Khi đổi user phải remount theo key; logout phải unmount trang và xóa profile.
<MyFilesPage
  key={profile.id}
  profile={profile}
  manager={manager}
  onShare={file => openShareModal(file.id)}
  onAuthRequired={() => navigate('/login')}
/>
```

openShareModal/navigate là callback của frontend An. App.jsx hiện là shell tối thiểu để mở trang Quang; không chứa màn hình đăng ký/đăng nhập/chia sẻ giả. Trong shell này nút chia sẻ bị khóa khi chưa truyền onShare. Sau khi share/revoke, component cha có thể remount trang hoặc gọi tải lại để cập nhật số người nhận.

Tìm tên chỉ trong 20 tệp của trang hiện tại vì tên đã mã hóa; chưa có chỉ mục tìm toàn bộ kho. Không lưu metadata rõ vào localStorage hoặc cache IndexedDB trong module kho tệp.

## Đầu vào từ các thành viên

| Người | Cần cung cấp để chạy thật |
|---|---|
| Phúc | Đăng nhập tạo cookie; GET /me gồm id/full_name/current_key/csrf_token; xác thực session và CSRF ở backend |
| Bắc | Sinh/đăng ký key; lưu cặp CryptoKey đúng user_id/key_id; xác minh khóa; đối chiếu protocol fileCrypto với phần nghiên cứu |
| Vũ | GET /files, POST /files, GET envelope/content, DELETE file; transaction owner envelope, storage, phân quyền và phân trang |
| An | Mã nguồn layout/router/tài khoản/chia sẻ để nhúng MyFilesPage và onShare; hiện repo chỉ có scaffold, chưa có source giống ảnh |

Chi tiết request/response nằm ở **docs/api/contract.md**. Không đổi đồng thời tên fields trong frontend và SQL một cách rời rạc. GET /me dùng current_key.key_id/public_key_jwk/fingerprint_sha256; dữ liệu nhị phân ở API dùng Base64 chuẩn, trong DB lưu bytes.

## Adapter kho khóa cho Bắc

Mặc định createDeviceKeyProvider chỉ đọc cặp khóa theo:

- IndexedDB database: secure-share-keyring, version 1.
- Object store: keys, keyPath ['userId','keyId'].
- Record: {userId, keyId, publicKey, privateKey}; keys là CryptoKey bằng structured clone, không phải chuỗi JWK/PEM.
- privateKey: RSA-OAEP 2048/SHA-256, extractable=false, usage unwrapKey. publicKey có thể export SPKI để đối chiếu fingerprint của chính chủ khi upload.

Provider không sinh hoặc upload private key. Nếu Bắc đã có key store khác, truyền getKeyPair(userId,keyId,{signal}) của Bắc vào createFileCrypto thay vì đổi toàn bộ UI. Không import private key demo vào môi trường thật. Mất key thì báo khóa thiếu; không âm thầm tạo key mới rồi báo mở được tệp cũ.

## Mốc nghiệm thu còn phụ thuộc ghép nhóm

Mã nguồn, kiểm thử frontend và SQL đã bàn giao. Trên môi trường thật, nhóm cần chạy: đăng ký/đăng nhập → Bắc lưu key → upload → reload trang vẫn hiện tên → tải xuống so byte gốc → xóa → không tải lại được. Chia sẻ/thu hồi cùng An/Vũ/Bắc để xác nhận số người nhận và các quyền. Các mốc này chưa đánh dấu đạt khi API thật chưa tồn tại.

Xem **validation.md** để phân biệt kiểm thử đã chạy và phạm vi chưa kiểm tra.
