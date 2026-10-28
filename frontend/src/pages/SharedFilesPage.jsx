import React, { useEffect, useState } from "react";
import { errorMessage } from "../services/errors.js";
import { formatSize } from "./MyFilesPage.jsx";

export default function SharedFilesPage({ api, profile, manager, onAuthRequired }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    manager.listShared(profile, { signal: controller.signal }).then((result) => {
      setItems(result?.items || []);
      setState("ready");
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setMessage(errorMessage(reason));
      setState("error");
      if (reason.status === 401) onAuthRequired?.();
    });
    return () => controller.abort();
  }, [manager, profile, onAuthRequired]);
  async function download(item) {
    setBusy(true);
    setMessage("");
    try {
      const result = await manager.download(item.id, profile, {});
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (reason) {
      setMessage(errorMessage(reason));
      if (reason.status === 401) onAuthRequired?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ss-page">
      <header className="ss-page-heading">
        <div><p className="ss-eyebrow">CHIA SẺ VỚI TÔI</p><h1>Tệp được chia sẻ</h1><p className="ss-subtitle">Các tệp người khác đã cấp quyền cho bạn.</p></div>
      </header>
      {message && <div className="ss-notice error" role="alert">{message}</div>}
      {state === "loading" ? <div className="ss-empty"><div className="ss-spinner" /><p>Đang tải danh sách chia sẻ…</p></div> :
        state === "error" ? <div className="ss-empty"><h3>Chưa tải được danh sách</h3><p>Hãy kiểm tra kết nối rồi thử lại.</p></div> :
        !items.length ? <div className="ss-empty"><div className="ss-empty-icon">◇</div><h3>Chưa có tệp được chia sẻ</h3><p>Khi một người cấp quyền, tệp sẽ xuất hiện ở đây.</p></div> :
        <ul className="ss-file-list ss-file-panel">{items.map((item) => <li className="ss-file-row" key={item.id}>
          <div className="ss-file-symbol">↗</div><div className="ss-file-description"><h3>{item.name || "Tệp được chia sẻ"}</h3><p>{formatSize(item.size)} · Chia sẻ bởi {item.shared_by?.full_name || item.shared_by?.email || "người dùng khác"}</p></div>
          <button className="ss-button secondary" disabled={busy} onClick={() => download(item)}>Tải xuống</button>
        </li>)}</ul>}
    </div>
  );
}
