import React, { useEffect, useMemo, useRef, useState } from "react";
import ConfirmDelete from "../components/ConfirmDelete.jsx";
import { MAX_FILE_BYTES } from "../services/fileApi.js";
import { errorMessage } from "../services/errors.js";
import { saveFile } from "../services/saveFile.js";
import "./my-files.css";

export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "Chưa đọc được kích thước";
  if (bytes === 0) return "0 B";
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}
const date = (value) =>
  Number.isNaN(Date.parse(value))
    ? "Chưa có thời gian"
    : new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));

export default function MyFilesPage({
  profile,
  manager,
  onShare,
  onAuthRequired,
  saveDownload = saveFile,
}) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [listing, setListing] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const [query, setQuery] = useState(""),
    [notice, setNotice] = useState(null);
  const [operation, setOperation] = useState(null),
    [deleteTarget, setDeleteTarget] = useState(null);
  const input = useRef(null),
    activeOperation = useRef(null),
    mounted = useRef(false);
  const pageSize = 20;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeOperation.current?.abort();
    };
  }, [profile.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    setListing({ items: [], total: 0 });
    manager
      .list(profile, { page, pageSize, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const last = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > last) {
          setPage(last);
          return;
        }
        setListing(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setListError(errorMessage(error));
        if (error.status === 401) onAuthRequired?.();
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [manager, profile, page, reload, onAuthRequired]);
  const filtered = useMemo(
    () =>
      listing.items.filter((file) =>
        file.name
          .toLocaleLowerCase("vi")
          .includes(query.trim().toLocaleLowerCase("vi")),
      ),
    [listing.items, query],
  );
  const busy = Boolean(operation);
  function refresh() {
    setReload((value) => value + 1);
  }
  async function run(kind, work, success) {
    if (activeOperation.current) return;
    const controller = new AbortController();
    activeOperation.current = controller;
    setNotice(null);
    setOperation({ kind, text: "Đang chuẩn bị…", percent: null });
    try {
      await work({
        signal: controller.signal,
        onStage: (stage) => {
          if (mounted.current && !controller.signal.aborted)
            setOperation(stage);
        },
      });
      if (mounted.current && !controller.signal.aborted) {
        setNotice({ kind: "success", text: success });
        refresh();
      }
    } catch (error) {
      if (mounted.current) {
        setNotice({
          kind: error.name === "AbortError" ? "info" : "error",
          text: errorMessage(error),
        });
        if (error.status === 401) onAuthRequired?.();
        if (
          error.name === "AbortError" ||
          ["TIMEOUT", "NETWORK", "BAD_RESPONSE"].includes(error.code)
        )
          refresh();
      }
    } finally {
      activeOperation.current = null;
      if (mounted.current) setOperation(null);
    }
  }
  function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (file.size > MAX_FILE_BYTES) {
      setNotice({
        kind: "error",
        text: "Mỗi tệp tối đa 25 MiB. Hãy chọn tệp nhỏ hơn.",
      });
      return;
    }
    run(
      "encrypt",
      (options) => manager.upload(file, profile, options),
      "Tệp đã được mã hóa và tải lên thành công.",
    );
  }
  function download(file) {
    run(
      "download",
      async (options) => {
        const result = await manager.download(file.id, profile, options);
        if (!options.signal.aborted && mounted.current) saveDownload(result);
      },
      "Đã giải mã và gửi tệp tới trình duyệt để lưu.",
    );
  }
  function confirmDelete() {
    const file = deleteTarget;
    setDeleteTarget(null);
    run(
      "delete",
      (options) => manager.remove(file.id, options),
      "Đã xóa tệp khỏi kho.",
    );
  }
  return (
    <div className="ss-page">
      <header className="ss-page-heading">
        <div>
          <p className="ss-eyebrow">KHO TỆP</p>
          <h1>Tệp của tôi</h1>
          <p className="ss-subtitle">Quản lý và chia sẻ các tệp của bạn.</p>
        </div>
        <button
          className="ss-button primary ss-upload"
          disabled={busy || !profile.current_key}
          type="button"
          onClick={() => input.current?.click()}
        >
          <span aria-hidden="true">＋</span> Tải tệp lên
        </button>
        <input
          ref={input}
          className="ss-file-input"
          aria-label="Chọn tệp để tải lên"
          type="file"
          onChange={upload}
          disabled={busy || !profile.current_key}
        />
      </header>
      {!profile.current_key && (
        <div className="ss-notice info" role="status">
          Tài khoản chưa có khóa mã hóa. Hãy hoàn tất tạo khóa trong phần Cài
          đặt trước khi tải tệp lên.
        </div>
      )}
      {notice && (
        <div
          className={`ss-notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="ss-text-button"
            aria-label="Đóng thông báo"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {operation && (
        <section
          className="ss-operation"
          aria-label="Tiến trình thao tác"
          aria-live="polite"
        >
          <div>
            <strong>{operation.text}</strong>
            <span>
              {operation.percent === null
                ? "Vui lòng chờ"
                : `${operation.percent}%`}
            </span>
          </div>
          <progress
            aria-label="Tiến trình"
            max="100"
            {...(operation.percent === null
              ? {}
              : { value: operation.percent })}
          />
          <button
            className="ss-text-button"
            type="button"
            onClick={() => activeOperation.current?.abort()}
          >
            Hủy thao tác
          </button>
        </section>
      )}
      <section
        className="ss-file-panel"
        aria-labelledby="all-files-heading"
        aria-busy={loading}
      >
        <div className="ss-panel-heading">
          <div>
            <h2 id="all-files-heading">Tất cả tệp</h2>
            {!loading && !listError && <span>{listing.total} tệp</span>}
          </div>
          <div className="ss-panel-tools">
            <label className="ss-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Tìm tên tệp trong trang này"
                placeholder="Tìm trong trang này…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              className="ss-text-button"
              type="button"
              disabled={loading || busy}
              onClick={refresh}
            >
              Tải lại
            </button>
          </div>
        </div>
        {loading ? (
          <div className="ss-empty" role="status">
            <div className="ss-spinner" />
            <p>Đang tải và mở khóa danh sách tệp…</p>
          </div>
        ) : listError ? (
          <div className="ss-empty">
            <div className="ss-empty-icon" aria-hidden="true">
              !
            </div>
            <h3>Chưa tải được kho tệp</h3>
            <p role="alert">{listError}</p>
            <button
              type="button"
              className="ss-button secondary"
              onClick={refresh}
            >
              Thử lại
            </button>
          </div>
        ) : !listing.total ? (
          <div className="ss-empty">
            <div className="ss-empty-icon" aria-hidden="true">
              ↥
            </div>
            <h3>Kho tệp còn trống</h3>
            <p>Tải tệp đầu tiên lên để bắt đầu. Mỗi tệp tối đa 25 MiB.</p>
            <button
              className="ss-button secondary"
              disabled={busy || !profile.current_key}
              onClick={() => input.current?.click()}
            >
              Chọn tệp
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="ss-empty">
            <h3>Không tìm thấy tệp trong trang này</h3>
            <button
              type="button"
              className="ss-text-button"
              onClick={() => setQuery("")}
            >
              Xóa từ khóa
            </button>
          </div>
        ) : (
          <ul className="ss-file-list">
            {filtered.map((file) => (
              <li className="ss-file-row" key={file.id}>
                <div
                  className={`ss-file-symbol ${file.locked ? "locked" : ""}`}
                  aria-hidden="true"
                >
                  {file.locked ? "◈" : "↗"}
                </div>
                <div className="ss-file-description">
                  <h3 title={file.name}>{file.name}</h3>
                  <p>
                    {formatSize(file.size)}
                    <span aria-hidden="true"> · </span>Cập nhật{" "}
                    {date(file.updated_at)}
                  </p>
                  {file.locked && (
                    <p className="ss-lock-reason">{file.lockReason}</p>
                  )}
                </div>
                <span className="ss-share-count">
                  {file.share_count > 0
                    ? `${file.share_count} người`
                    : "Chưa chia sẻ"}
                </span>
                <div className="ss-file-actions">
                  <button
                    className="ss-button secondary"
                    type="button"
                    disabled={busy || file.locked}
                    aria-label={`Tải xuống ${file.name}`}
                    onClick={() => download(file)}
                  >
                    Tải xuống
                  </button>
                  <button
                    className="ss-button secondary"
                    type="button"
                    disabled={busy || file.locked || !onShare}
                    title={
                      onShare
                        ? "Chia sẻ tệp"
                        : "Giao diện chia sẻ sẽ được nối từ phần của An"
                    }
                    onClick={() => onShare?.(file)}
                  >
                    Chia sẻ
                  </button>
                  <button
                    className="ss-delete-button"
                    type="button"
                    disabled={busy}
                    aria-label={`Xóa ${file.name}`}
                    onClick={() => setDeleteTarget(file)}
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && !listError && listing.total > pageSize && (
          <nav className="ss-pagination" aria-label="Phân trang tệp">
            <button
              className="ss-button secondary"
              disabled={page === 1 || busy}
              onClick={() => {
                setQuery("");
                setPage((value) => value - 1);
              }}
            >
              Trang trước
            </button>
            <span>
              Trang {page}/{Math.ceil(listing.total / pageSize)}
            </span>
            <button
              className="ss-button secondary"
              disabled={page * pageSize >= listing.total || busy}
              onClick={() => {
                setQuery("");
                setPage((value) => value + 1);
              }}
            >
              Trang sau
            </button>
          </nav>
        )}
      </section>
      <p className="ss-security-note">
        <span aria-hidden="true">◇</span> Tệp được mã hóa trên thiết bị trước
        khi tải lên. Chỉ thiết bị có khóa phù hợp mới mở được nội dung.
      </p>
      {deleteTarget && (
        <ConfirmDelete
          file={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
