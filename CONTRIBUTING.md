# Làm việc nhóm

- main: mốc ổn định/demo; develop: nhánh tích hợp; feature/<chuc-nang>: việc của từng người.
- Tạo feature từ develop; mở PR về develop; một người khác review rồi merge.
- Cuối mốc tuần: PR develop → main sau khi kiểm tra luồng demo.
- Commit: feat:, fix:, docs:, test:, refactor:, security:.
- Mỗi Issue có tuần, người làm, người review, phụ thuộc và điều kiện nghiệm thu.
- Không tự merge thay đổi crypto chưa review. Mọi người cùng hiểu quản lý khóa.
- Mỗi thành viên viết tài liệu phần mình; TV5 tổng hợp.
- Đã có package-lock.json cho frontend; CI dùng npm ci. Khi đổi dependencies, commit cả package.json và lockfile.
- Nếu có quyền/cấu hình hỗ trợ: main/develop yêu cầu PR, review và CI. Bộ khung chưa tự thiết lập branch protection.
