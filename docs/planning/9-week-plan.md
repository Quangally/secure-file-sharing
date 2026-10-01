# Phân công 9 tuần — 5 thành viên

Tuần tính từ ngày nhóm bắt đầu; chưa gán ngày lịch và tên thật. TV1–TV5 là mã thành viên, có thể thay bằng tên.

| Thành viên | Vai trò | Trách nhiệm | Review chéo |
|---|---|---|---|
| TV1 | Trưởng nhóm + Backend xác thực | Yêu cầu, đăng ký/đăng nhập, phân quyền, tích hợp, CI | TV4 |
| TV2 | Mật mã + quản lý khóa | AES-GCM, RSA-OAEP, SHA-256, khóa riêng, dấu vân tay khóa | TV1 |
| TV3 | Frontend + UI/UX | React, màn hình tài khoản, kho tệp, chia sẻ, tải/giải mã | TV2 |
| TV4 | Database + Backend tệp | Schema, migration, lưu ciphertext, chia sẻ/thu hồi, nhật ký | TV1 |
| TV5 | Kiểm thử + thực nghiệm | Kiểm thử API/bảo mật, benchmark, bằng chứng và báo cáo | TV4 |

Mỗi người viết phần báo cáo của phần mình làm; TV5 tổng hợp và kiểm thử, không gánh toàn bộ báo cáo. Mỗi PR có ít nhất một người review; thay đổi mật mã cần TV2 và một người khác hiểu luồng.

## Tuần 1 — Phân tích và thống nhất phạm vi

| Thành viên | Công việc |
|---|---|
| TV1 | Chốt yêu cầu, use case và phạm vi MVP |
| TV2 | Mô tả luồng mật mã, chọn tham số, threat model |
| TV3 | Wireframe đăng nhập, kho tệp, chia sẻ, quản lý khóa |
| TV4 | ERD, mô hình key envelope và API dự kiến |
| TV5 | Ma trận kiểm thử, khung báo cáo, tổng hợp tài liệu |

**Điều kiện hoàn thành:** Duyệt yêu cầu, ERD, wireframe, API và quy tắc quản lý khóa; cả 5 người giải thích được E2EE.

## Tuần 2 — Dựng môi trường và hợp đồng API

| Thành viên | Công việc |
|---|---|
| TV1 | Dựng FastAPI, cấu hình, CORS và CI |
| TV2 | Thử AES/RSA/SHA bằng Web Crypto, viết kiểm thử âm |
| TV3 | Dựng React, layout và điều hướng |
| TV4 | Dựng MySQL, SQLAlchemy và Alembic migration |
| TV5 | Chạy lại setup trên máy khác, chuẩn bị fixture giả |

**Điều kiện hoàn thành:** Cả 5 máy chạy được frontend, backend /health và database; thống nhất payload upload/share.

## Tuần 3 — Tài khoản và quản lý khóa

| Thành viên | Công việc |
|---|---|
| TV1 | Đăng ký/đăng nhập, Argon2id, session/token hết hạn |
| TV2 | Sinh khóa trên client; khóa riêng non-extractable trong IndexedDB; fingerprint |
| TV3 | UI tài khoản, trạng thái mở khóa, hiển thị fingerprint |
| TV4 | Lưu public key có key_id; truy vấn người nhận và khóa |
| TV5 | Test sai mật khẩu, token hết hạn, đăng nhập lại và giữ khóa |

**Điều kiện hoàn thành:** Đăng nhập lại trên cùng thiết bị vẫn mở được khóa; server không có private key rõ. Chốt giới hạn một thiết bị và cách xác minh fingerprint.

## Tuần 4 — Mã hóa và tải lên

| Thành viên | Công việc |
|---|---|
| TV1 | Tích hợp upload API và xử lý lỗi/giới hạn |
| TV2 | AES key mới mỗi tệp, IV mới, tag; wrap AES key cho chính chủ |
| TV3 | Chọn tệp, tiến trình mã hóa/upload và danh sách tệp |
| TV4 | Lưu ciphertext, owner envelope và metadata; rollback upload lỗi |
| TV5 | Test round-trip tệp rỗng/nhị phân, kiểm tra request và storage |

**Điều kiện hoàn thành:** Chủ tệp tải lên rồi mở lại được sau khi tải lại trang; server chỉ nhận ciphertext và khóa AES đã bọc. MVP giới hạn tệp 25 MiB.

## Tuần 5 — Chia sẻ và quyền truy cập

| Thành viên | Công việc |
|---|---|
| TV1 | API tìm người nhận, authorization và tích hợp share |
| TV2 | Unwrap owner envelope rồi wrap AES key cho người nhận; kiểm tra fingerprint |
| TV3 | Modal chia sẻ, xác nhận fingerprint, Shared with me |
| TV4 | File share, recipient envelope, thu hồi và audit log |
| TV5 | Test người C không được xem/tải/bọc khóa của tệp A→B |

**Điều kiện hoàn thành:** A chia sẻ cho B; C bị từ chối; mỗi envelope gắn file_id, user_id và key_id. Chủ tệp có thể chia sẻ lại mà không upload lại tệp.

## Tuần 6 — Tải xuống và giải mã hoàn chỉnh

| Thành viên | Công việc |
|---|---|
| TV1 | Download ciphertext API và xử lý session hết hạn |
| TV2 | Unwrap bằng khóa riêng, AES decrypt, xác minh GCM và SHA ciphertext |
| TV3 | UI tải/giải mã/lưu tệp, thông báo lỗi rõ ràng |
| TV4 | Chặn download/envelope sau thu hồi; kiểm tra quyền mọi endpoint |
| TV5 | Test A→B từ đầu đến cuối, sai khóa và ciphertext bị sửa |

**Điều kiện hoàn thành:** B tải được tệp giống bản gốc; ciphertext bị sửa/sai khóa bị từ chối; thu hồi chặn lượt tải mới. Ghi rõ không thể xóa bản B đã tải.

## Tuần 7 — Kiểm thử bảo mật và sửa lỗi

| Thành viên | Công việc |
|---|---|
| TV1 | Sửa lỗi xác thực, IDOR, giới hạn request/upload |
| TV2 | Rà IV, key exposure, GCM, fingerprint và key substitution |
| TV3 | Xử lý lỗi UI, tránh XSS, xóa dữ liệu nhạy cảm khỏi log |
| TV4 | Rà storage path, giao dịch, quyền truy cập và log |
| TV5 | Thực hiện bộ test bảo mật; ghi bằng chứng; tái kiểm thử |

**Điều kiện hoàn thành:** Đạt ma trận bảo mật: sửa ciphertext, tag/IV/AAD; sai private key; C truy cập; token hết hạn; thu hồi; key substitution được cảnh báo theo quy trình fingerprint.

## Tuần 8 — Thực nghiệm và ổn định

| Thành viên | Công việc |
|---|---|
| TV1 | Tích hợp bản ổn định, hướng dẫn môi trường HTTPS |
| TV2 | Đo AES encrypt/decrypt, RSA wrap/unwrap; kiểm tra bộ nhớ |
| TV3 | Hoàn thiện responsive, trạng thái rỗng và tiến trình |
| TV4 | Đo upload/download, tối ưu truy vấn và dọn dữ liệu thử |
| TV5 | Đo lặp 10 lần cho 1/10/25 MiB, lập bảng/biểu đồ thực nghiệm |

**Điều kiện hoàn thành:** Có kết quả đo thật kèm máy/trình duyệt/số lần; tách thời gian mã hóa khỏi mạng. 50/100 MiB chỉ mở rộng nếu thiết kế và bộ nhớ đáp ứng.

## Tuần 9 — Báo cáo và bảo vệ

| Thành viên | Công việc |
|---|---|
| TV1 | Viết kiến trúc/tích hợp; đóng phiên bản v1.0 |
| TV2 | Viết thuật toán/khóa/threat model và giới hạn E2EE |
| TV3 | Chuẩn bị demo/UI, quay video dự phòng |
| TV4 | Viết database/API, reset dữ liệu demo |
| TV5 | Viết kiểm thử/kết quả, ghép báo cáo và rà tài liệu |

**Điều kiện hoàn thành:** Báo cáo, slide, repo và demo A→B hoàn chỉnh; demo C bị chặn và ciphertext bị sửa; cả 5 người trả lời được luồng mật mã.

## Nhịp làm việc

- Đầu tuần: chốt Issue, đầu vào/đầu ra và việc phụ thuộc nhau.
- Giữa tuần: ghép một luồng nhỏ, xử lý vấn đề tích hợp.
- Cuối tuần: demo kết quả, review PR, đánh dấu mốc nghiệm thu.
- Bị chặn quá một ngày: báo trong nhóm để đổi cách làm hoặc phối hợp.
- Đến cuối tuần 6 phải chạy được A→B; tuần 7–9 dành cho kiểm thử, thực nghiệm và bảo vệ.
