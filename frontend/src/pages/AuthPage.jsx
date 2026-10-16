import React, { useState } from "react";
import { errorMessage } from "../services/errors.js";

export default function AuthPage({ api, onAuthenticated, initialError = "" }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm_password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (mode === "register" && form.password !== form.confirm_password) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await api.login({ email: form.email.trim(), password: form.password })
          : await api.register({
              full_name: form.full_name.trim(),
              email: form.email.trim(),
              password: form.password,
              confirm_password: form.confirm_password,
            });
      const profile = result?.id ? result : await api.me();
      onAuthenticated(profile);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ss-auth-wrap">
      <section className="ss-auth-card" aria-labelledby="auth-heading">
        <p className="ss-eyebrow">SECURE SHARE</p>
        <h1 id="auth-heading">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
        <p className="ss-subtitle">
          {mode === "login"
            ? "Đăng nhập để truy cập kho tệp được mã hóa."
            : "Tạo tài khoản để bắt đầu chia sẻ tệp an toàn."}
        </p>
        {error && <div className="ss-notice error" role="alert">{error}</div>}
        <form onSubmit={submit} className="ss-form">
          {mode === "register" && (
            <label>
              Họ và tên
              <input name="full_name" required value={form.full_name} onChange={update} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" required value={form.email} onChange={update} autoComplete="email" />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" required minLength="8" value={form.password} onChange={update} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {mode === "register" && (
            <label>
              Nhập lại mật khẩu
              <input name="confirm_password" type="password" required value={form.confirm_password} onChange={update} autoComplete="new-password" />
            </label>
          )}
          <button className="ss-button primary ss-auth-submit" disabled={busy} type="submit">
            {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </button>
        </form>
        <button className="ss-text-button ss-auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </button>
      </section>
    </div>
  );
}
