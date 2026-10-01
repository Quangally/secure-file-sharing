# Tạo repo bằng GitHub trên web

1. Mở https://github.com/new, đăng nhập tài khoản của bạn.
2. Owner: tài khoản của bạn; Repository name: `secure-file-sharing`.
3. Description: `Hệ thống chia sẻ tệp an toàn có mã hóa đầu cuối — AES-256-GCM, RSA-OAEP, SHA-256`.
4. Khuyên chọn Private trong giai đoạn làm đồ án. Nếu thầy cần xem thì cấp quyền hoặc chuyển Public khi nhóm thống nhất.
5. Không chọn tạo README, .gitignore hay license vì bộ khung đã có README và .gitignore. Bấm Create repository.
6. Giải nén secure-file-sharing-starter.zip trên máy. Trong repo trống chọn liên kết uploading an existing file; repo đã có file thì Add file → Upload files.
7. Mở thư mục secure-file-sharing vừa giải nén; kéo toàn bộ nội dung bên trong (frontend, backend, docs, security-tests, .github, README.md, .gitignore, .env.example, ...) vào trang upload. Không upload nguyên ZIP hoặc thêm một tầng secure-file-sharing bên trong repo.
8. Kiểm tra danh sách: README.md, frontend và backend phải nằm ngay gốc. Kiểm tra cả .github và .gitignore. Commit message: `chore: initialize secure file sharing project`. Bấm Commit changes.
9. Từ bộ chọn nhánh main, nhập develop và chọn Create branch. Đây là nhánh nhóm tích hợp.
10. Settings → Collaborators (tên mục có thể khác theo tài khoản) → Add people; mời 4 thành viên còn lại bằng đúng GitHub username. Việc gửi lời mời do bạn thực hiện.
11. Mỗi người tạo feature từ develop. Tạo PR về develop khi xong; người khác review.
12. Mở docs/planning/9-week-plan.md để xem phân công; dùng Issues và mẫu Task để lập đầu việc từ backlog.json.

Bộ khung có 45 đầu việc nhưng chưa tự tạo 45 Issues, chưa gán tài khoản và chưa thiết lập protection. Điền tên trong team.md trước.

Upload web không áp dụng .gitignore cho file bạn kéo lên; chỉ tải bộ khung sạch được cung cấp. Không kéo node_modules, .env, .venv hoặc private key vào trang upload. Nếu quyền GitHub web không cho ghi workflow, có thể upload phần còn lại rồi thêm .github/workflows/ci.yml bằng tài khoản có quyền phù hợp.

Nguồn hướng dẫn tạo repo: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
