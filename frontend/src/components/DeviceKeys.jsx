import React, { useEffect, useState } from "react";
import { errorMessage } from "../services/errors.js";

export default function DeviceKeys({ profile, keys, onReady, onAuthRequired }) {
  const [state, setState] = useState("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setState("checking");
    keys.check(profile).then((result) => { if (active) setState(result.state); })
      .catch((error) => { if (active) { setState("error"); setMessage(errorMessage(error)); } });
    return () => { active = false; };
  }, [profile, keys]);
  async function create() {
    setBusy(true); setMessage("");
    try { onReady(await keys.enroll()); }
    catch (error) {
      setMessage(errorMessage(error));
      if (error.status === 401) onAuthRequired?.();
    } finally { setBusy(false); }
  }
  return <section className="ss-settings-card" aria-label="Khóa trên thiết bị">
    <h3>Khóa mã hóa trên thiết bị</h3>
    {state === "checking" && <p role="status">Đang kiểm tra khóa…</p>}
    {state === "ready" && <p>Khóa đã sẵn sàng để mã hóa và mở tệp.</p>}
    {profile.current_key && <p className="ss-fingerprint">{profile.current_key.fingerprint_sha256}</p>}
    {message && <p role="alert">{message}</p>}
    {state === "new" && <>
      <p>Tạo khóa để bắt đầu tải lên và nhận tệp. Khóa riêng được giữ trong trình duyệt này.</p>
      <p>Xóa dữ liệu trình duyệt hoặc mất thiết bị sẽ khiến bạn không mở được các tệp cũ. Đổi mật khẩu không khôi phục khóa. Phiên bản này chưa hỗ trợ sao lưu hoặc chuyển khóa sang thiết bị khác.</p>
      <button className="ss-button primary" disabled={busy} onClick={create}>{busy ? "Đang thiết lập khóa…" : "Tạo khóa trên thiết bị này"}</button>
    </>}
    {state === "error" && <p>Hãy dùng hồ sơ trình duyệt đã tạo khóa. Không thể thay khóa để mở lại tệp cũ.</p>}
  </section>;
}
