import React, { useEffect, useState } from "react";
import { errorMessage } from "../services/errors.js";

export default function ShareDialog({ api, manager, profile, file, onClose, onChanged }) {
  const [email, setEmail] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [shares, setShares] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.listShares(file.id).then((result) => setShares(result?.items || result || [])).catch((reason) => setMessage(errorMessage(reason)));
  }, [api, file.id]);
  async function find(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRecipient(null);
    try {
      const result = await api.lookupRecipient(email.trim());
      const found = result?.user || result;
      if (!found?.id || !found.current_key) throw new Error("Người nhận chưa đăng ký khóa mã hóa.");
      setRecipient(found);
    } catch (reason) { setMessage(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function share() {
    setBusy(true); setMessage("");
    try {
      await manager.share(file, recipient, profile);
      setMessage("Đã cấp quyền truy cập cho người nhận.");
      setRecipient(null); setEmail("");
      const result = await api.listShares(file.id);
      setShares(result?.items || result || []);
      onChanged?.();
    } catch (reason) { setMessage(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function revoke(userId) {
    setBusy(true); setMessage("");
    try { await api.revokeShare(file.id, userId); setShares((current) => current.filter((share) => share.user_id !== userId)); onChanged?.(); }
    catch (reason) { setMessage(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <div className="ss-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="ss-dialog ss-share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-heading">
      <h2 id="share-heading">Chia sẻ tệp</h2><p className="ss-dialog-filename">{file.name}</p>
      {message && <div className="ss-notice error" role="alert">{message}</div>}
      <form className="ss-share-form" onSubmit={find}><label>Email người nhận<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required placeholder="nguoi-nhan@example.com" /></label><button className="ss-button secondary" disabled={busy}>Tìm người nhận</button></form>
      {recipient && <div className="ss-recipient"><strong>{recipient.full_name}</strong><span>{recipient.email}</span><small>Fingerprint: {recipient.current_key.fingerprint_sha256}</small><button className="ss-button primary" disabled={busy} onClick={share}>Xác nhận chia sẻ</button></div>}
      <h3 className="ss-share-list-heading">Đang được chia sẻ với</h3>
      {!shares.length ? <p className="ss-muted">Chưa có người nhận.</p> : shares.map((share) => <div className="ss-share-row" key={share.user_id}><span>{share.full_name || share.email}</span><button className="ss-text-button" disabled={busy} onClick={() => revoke(share.user_id)}>Thu hồi</button></div>)}
      <div className="ss-dialog-actions"><button className="ss-button secondary" type="button" onClick={onClose}>Đóng</button></div>
    </section>
  </div>;
}
