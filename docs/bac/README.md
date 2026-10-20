# Bàn giao phần Bắc — mã hóa đầu cuối

## Phạm vi

Mã hóa/giải mã chạy trong trình duyệt bằng Web Crypto; backend giữ ciphertext, public key và wrapped AES key. MVP một thiết bị/một hồ sơ trình duyệt. Không hỗ trợ sao lưu, khôi phục hoặc xoay vòng private key. Xóa dữ liệu trình duyệt có thể làm mất khả năng mở tệp; đổi mật khẩu đăng nhập không khôi phục khóa.

## Module và tích hợp

- `frontend/src/crypto/aes.js`: AES-256-GCM, key mới mỗi tệp, IV 96 bit, tag 128 bit.
- `rsa.js`: RSA-OAEP 2048/SHA-256, exponent 65537; private key non-extractable, wrap/unwrap AES.
- `hash.js`: SHA-256 dạng hex.
- `fileCrypto.js`: protocol v1; metadata mã hóa; AAD gắn file ID; kiểm tra kích thước, SHA và GCM trước khi lưu tệp.
- `keyManager.js`: `check(profile)`, `enroll()`, `recipientStatus(userId, recipient)`, `trustRecipient(userId, recipient, fingerprint)`, `requireTrusted(userId, recipient)`.
- `components/DeviceKeys.jsx`: trạng thái khóa và tạo khóa có chủ ý, thông báo mất khóa.
- `components/ShareDialog.jsx`: xác minh fingerprint ngoài ứng dụng, cảnh báo đổi khóa.

`App.jsx` tạo một key manager dùng chung với API session; truyền `requireTrusted` vào file manager. Khi tích hợp layout khác, giữ cùng API instance để CSRF token từ `/me` được dùng cho `/me/keys`. File manager từ chối chia sẻ nếu chưa cung cấp bộ xác minh khóa.

## Lưu khóa và phục hồi

Giữ database IndexedDB `secure-share-keyring`, version 1, store `keys`, keyPath `[userId, keyId]` của Quang. Record khóa: `{userId, keyId, publicKey, privateKey}`.

Trước khi gọi `/me/keys`, ghi cặp khóa vào record có keyId nội bộ `pending` và đọc lại để kiểm tra persistence. Transaction readwrite chọn một candidate chung khi nhiều tab tạo khóa đồng thời. Chỉ public JWK được gửi lên server.

Sau đăng ký, đọc `/me`, đối chiếu fingerprint SHA-256 của SPKI, chuyển record sang keyId của server và xóa `pending` trong cùng transaction. Nếu mất phản hồi, giữ candidate và đối chiếu `/me` ở lần thử lại/đăng nhập sau. Không thay khóa đã được đăng ký bằng khóa ngẫu nhiên mới. Nếu private key không còn trên thiết bị, báo thiếu khóa.

Khi kiểm tra khóa, xác nhận thuộc tính private key, fingerprint public key và thử wrap/unwrap một AES key tạm để xác minh hai khóa thuộc cùng một cặp. Không xuất private key.

Các pin dùng record `keyId = trusted:<recipient-user-id>`, chỉ lưu fingerprint; được phân tách theo tài khoản hiện tại. Pin được giữ qua logout. Xóa dữ liệu trình duyệt cũng xóa pin.

## Xác minh người nhận

Lần đầu chia sẻ: lấy fingerprint từ người nhận qua kênh độc lập, nhập vào hộp thoại; ứng dụng đối chiếu với SHA-256 SPKI rồi ghi pin. Những lần tiếp theo phải khớp pin. Khi thay đổi, cảnh báo và yêu cầu đối chiếu lại. So fingerprint do server trả với public key chỉ kiểm tra tính nhất quán, không thay thế việc xác minh bên ngoài.

Non-extractable không ngăn mã JavaScript độc hại sử dụng khóa. Client/thiết bị phải đáng tin cậy. Thu hồi chỉ chặn truy cập mới, không xóa bản sao đã tải. Các giới hạn này cũng được nêu trong threat model.

## Kiểm thử

Chạy từ `frontend`: `npm ci`, `npm test`, `npm run build`. Từ repo root: `node --test security-tests/crypto.test.mjs`.

Test key manager dùng Web Crypto thật và fake-indexeddb: tạo/lưu/đọc lại khóa, file round-trip bằng khóa đã lưu, không xuất private key, lost response, retry, thiếu storage, mất khóa, đồng thời nhiều tab, pin và đổi khóa. Test UI kiểm tra tạo khóa có chủ ý và không đề nghị thay khóa bị mất. Test file manager chặn share chưa xác minh và envelope sai file ID.

Test HTTP frontend dùng transport giả; không chứng minh luồng trên MySQL/storage thật. API tệp/chia sẻ vẫn phụ thuộc phần backend của nhóm. Nghiệm thu tích hợp khi có API: A và B tạo khóa → A upload → reload → A xác minh fingerprint B và share → B download, so byte → sai khóa/ciphertext bị sửa bị từ chối → revoke chặn tải mới.

Benchmark 1/10/25 MiB cần ghi máy, trình duyệt, số lần đo và tách AES, RSA, mạng; không coi số đo unit test là kết quả benchmark.

## Kết quả local — 20/10/2026

- `npm test`: 47/47 test đạt, 9 test files.
- `node --test security-tests/crypto.test.mjs`: 5/5 đạt.
- `npm run build`: thành công.
- `git diff --check`: đạt.

Môi trường chạy Node 25.9.0; npm cảnh báo phiên bản này ngoài dải hỗ trợ đã khai báo. CI của repo dùng Node 24; chưa xác nhận lần chạy CI cho thay đổi này. Chưa chạy trình duyệt thật hoặc API/MySQL/storage end-to-end. Không suy ra các kết quả đó từ jsdom, fake-indexeddb và transport giả.
