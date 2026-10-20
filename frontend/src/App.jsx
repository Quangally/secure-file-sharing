import React, { useCallback, useEffect, useState } from "react";
import MyFilesPage from "./pages/MyFilesPage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import SharedFilesPage from "./pages/SharedFilesPage.jsx";
import ShareDialog from "./components/ShareDialog.jsx";
import { createFileApi } from "./services/fileApi.js";
import { createFileManager } from "./services/fileManager.js";
import { createDeviceKeyProvider } from "./services/keyStore.js";
import { createFileCrypto } from "./crypto/fileCrypto.js";
import { errorMessage } from "./services/errors.js";
import { createKeyManager } from "./crypto/keyManager.js";
import DeviceKeys from "./components/DeviceKeys.jsx";

const api = createFileApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
});
const keys = createKeyManager({ api });
const manager = createFileManager({
  api,
  requireTrusted: keys.requireTrusted,
  fileCrypto: createFileCrypto({ getKeyPair: createDeviceKeyProvider() }),
});

// An can embed MyFilesPage in the account/sharing layout without replacing it.
export default function App() {
  const [profile, setProfile] = useState(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const [view, setView] = useState("files");
  const [shareFile, setShareFile] = useState(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const authRequired = useCallback(() => {
    api.setCsrfToken("");
    setProfile(null);
    setShareFile(null);
    setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setProfile(null);
    api
      .me({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProfile(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  async function logout() {
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await api.logout();
      api.setCsrfToken("");
      setProfile(null);
      setShareFile(null);
      setView("files");
    } catch (reason) {
      setLogoutError(errorMessage(reason));
    } finally {
      setLogoutBusy(false);
    }
  }
  function authenticated(result) {
    setError("");
    setProfile(result);
    setAttempt((value) => value + 1);
  }
  return (
    <div className="ss-app">
      <header className="ss-topbar">
        <a className="ss-brand" href="/" aria-label="Secure Share — Trang chủ">
          <span>S</span>Secure Share
        </a>
        {profile && (
          <div className="ss-account">
            <span className="ss-avatar" aria-hidden="true">
              {profile.full_name.trim().charAt(0)}
            </span>
            <strong>{profile.full_name}</strong>
            <button className="ss-text-button" type="button" disabled={logoutBusy} onClick={logout}>
              {logoutBusy ? "Đang đăng xuất…" : "Đăng xuất"}
            </button>
          </div>
        )}
      </header>
      {logoutError && profile && <div className="ss-global-notice ss-notice error" role="alert">{logoutError}</div>}
      <div className="ss-layout">
        <aside className="ss-sidebar" aria-label="Điều hướng">
          <p>KHÔNG GIAN CỦA BẠN</p>
          {profile && <button className={`ss-nav-button ${view === "files" ? "active" : ""}`} aria-current={view === "files" ? "page" : undefined} onClick={() => setView("files")}>▣ Tệp của tôi</button>}
          {profile && <button className={`ss-nav-button ${view === "shared" ? "active" : ""}`} aria-current={view === "shared" ? "page" : undefined} onClick={() => setView("shared")}>↗ Được chia sẻ</button>}
          {profile && <button className={`ss-nav-button ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>⚙ Cài đặt</button>}
          <p className="ss-sidebar-note">
            Kho tệp cá nhân
            <br />
            AES-256-GCM
          </p>
        </aside>
        <main className="ss-main">
          {profile && <DeviceKeys key={profile.id} profile={profile} keys={keys} onReady={(updated) => setProfile((current) => current?.id === updated.id ? updated : current)} onAuthRequired={authRequired} />}
          {profile ? view === "files" ? (
            <MyFilesPage
              key={profile.id}
              profile={profile}
              manager={manager}
              onAuthRequired={authRequired}
              onShare={setShareFile}
            />
          ) : view === "shared" ? (
            <SharedFilesPage api={api} profile={profile} manager={manager} onAuthRequired={authRequired} />
          ) : (
            <div className="ss-page">
              <p className="ss-eyebrow">TÀI KHOẢN</p>
              <h1>Cài đặt</h1>
              <p className="ss-subtitle">Thông tin phiên đăng nhập và khóa mã hóa trên thiết bị.</p>
              <section className="ss-settings-card">
                <h2>{profile.full_name}</h2>
                <p>{profile.email}</p>
                <hr />
                <h3>Khóa mã hóa hiện tại</h3>
                {profile.current_key ? <p className="ss-fingerprint">{profile.current_key.fingerprint_sha256}</p> : <p>Chưa đăng ký khóa trên thiết bị.</p>}
              </section>
            </div>
          ) : (
            loading ? <div className="ss-connection"><p className="ss-eyebrow">SECURE SHARE</p><h1>Đang mở kho tệp…</h1><p role="status">Đang kiểm tra phiên đăng nhập.</p></div> :
              <AuthPage api={api} onAuthenticated={authenticated} initialError={error} />
          )}
        </main>
      </div>
      {shareFile && profile && <ShareDialog api={api} manager={manager} keys={keys} profile={profile} file={shareFile} onClose={() => setShareFile(null)} onChanged={() => setAttempt((value) => value + 1)} />}
    </div>
  );
}
