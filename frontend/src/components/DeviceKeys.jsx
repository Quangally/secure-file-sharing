import React, { useEffect, useState } from "react";
import { errorMessage } from "../services/errors.js";

export default function DeviceKeys({ profile, keys, onReady, onAuthRequired }) {
  const [verification, setVerification] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Do not reuse a previous check even for one render after the account/key
  // profile changes. Only a successful local check supplies a displayable hash.
  const current = verification?.profile === profile && verification?.keys === keys
    ? verification : { state: "checking" };
  const state = current.state;
  useEffect(() => {
    let active = true;
    setVerification(null);
    setMessage("");
    keys.check(profile).then((result) => {
      if (active) setVerification({ profile, keys, state: result.state,
        fingerprint: result.state === "ready" ? result.fingerprint : undefined });
    }).catch((error) => {
      if (active) setVerification({ profile, keys, state: "error", message: errorMessage(error) });
    });
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
    {state === "ready" && current.fingerprint && <>
      <p className="ss-fingerprint" aria-label="Fingerprint đã xác minh">{current.fingerprint}</p>
      <p>Gửi fingerprint này cho người chia sẻ qua kênh liên lạc đã xác thực để đối chiếu khóa.</p>
    </>}
    {(message || current.message) && <p role="alert">{message || current.message}</p>}
    {state === "new" && <>
      <p>Tạo khóa để bắt đầu tải lên và nhận tệp. Khóa riêng được giữ trong trình duyệt này.</p>
      <p>Xóa dữ liệu trình duyệt hoặc mất thiết bị sẽ khiến bạn không mở được các tệp cũ. Đổi mật khẩu không khôi phục khóa. Phiên bản này chưa hỗ trợ sao lưu hoặc chuyển khóa sang thiết bị khác.</p>
      <button className="ss-button primary" disabled={busy} onClick={create}>{busy ? "Đang thiết lập khóa…" : "Tạo khóa trên thiết bị này"}</button>
    </>}
    {state === "error" && <p>Hãy dùng hồ sơ trình duyệt đã tạo khóa. Không thể thay khóa để mở lại tệp cũ.</p>}
  </section>;
}
