# SQL chính

Mở **01_schema.sql** bằng MySQL Workbench và chạy toàn bộ trên môi trường dev mới. File tạo database secure_share và 6 bảng; không chèn dữ liệu mẫu. Đây là file duy nhất cần dùng nếu bạn tạo CSDL bằng Workbench.

Thư mục examples chứa SELECT và mẫu truy vấn nghiệp vụ để backend tham khảo, không phải hai bước cài đặt bắt buộc. write_queries.sql có placeholders PyMySQL nên không chạy nguyên file trong Workbench. Backend cần thêm LIMIT/OFFSET và COUNT cùng bộ lọc quyền để trả API phân trang; SQL ví dụ thể hiện điều kiện truy cập cốt lõi.

Để quản lý phiên bản bằng Alembic thay vì import thủ công, xem docs/database/mysql-setup.md. Cùng một schema v1 được dùng cho cả hai cách; chọn một cách tạo bảng. Không sửa file khởi tạo v1 sau khi nhóm đã áp dụng, hãy thêm migration cho phiên bản kế tiếp.

ERD: docs/diagrams/database.svg hoặc database.png. Từ điển: docs/database/schema.md. Hợp đồng: docs/api/contract.md.
