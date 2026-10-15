export class FileError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "FileError";
    this.code = code;
    this.status = status;
  }
}

export function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("Đã hủy thao tác.", "AbortError");
}

export function errorMessage(error) {
  if (error?.name === "AbortError")
    return "Đã hủy thao tác. Tải lại danh sách để kiểm tra trạng thái tệp.";
  return error instanceof FileError
    ? error.message
    : "Không thể hoàn thành thao tác. Vui lòng thử lại.";
}

export function httpError(status) {
  const messages = {
    401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    403: "Bạn không có quyền thực hiện thao tác này hoặc phiên cần được xác thực lại.",
    404: "Không tìm thấy dữ liệu hoặc API này chưa được nhóm kết nối.",
    409: "Dữ liệu hoặc khóa đã thay đổi. Hãy tải lại và thử lại.",
    413: "Tệp vượt quá dung lượng cho phép.",
    422: "Dữ liệu gửi lên chưa khớp định dạng API.",
    429: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
  };
  return new FileError(
    "HTTP_" + status,
    messages[status] || "Máy chủ chưa sẵn sàng. Vui lòng thử lại sau.",
    status,
  );
}
