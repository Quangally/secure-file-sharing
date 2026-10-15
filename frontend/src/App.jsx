import React, { useCallback, useEffect, useState } from "react";
import MyFilesPage from "./pages/MyFilesPage.jsx";
import { createFileApi } from "./services/fileApi.js";
import { createFileManager } from "./services/fileManager.js";
import { createDeviceKeyProvider } from "./services/keyStore.js";
import { createFileCrypto } from "./crypto/fileCrypto.js";
import { errorMessage } from "./services/errors.js";

const api = createFileApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
});
const manager = createFileManager({
  api,
  fileCrypto: createFileCrypto({ getKeyPair: createDeviceKeyProvider() }),
});

// An can embed MyFilesPage in the account/sharing layout without replacing it.
export default function App() {
  const [profile, setProfile] = useState(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const authRequired = useCallback(() => {
    api.setCsrfToken("");
    setProfile(null);
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
          </div>
        )}
      </header>
      <div className="ss-layout">
        <aside className="ss-sidebar" aria-label="Điều hướng">
          <p>KHÔNG GIAN CỦA BẠN</p>
          <div className="ss-nav-active" aria-current="page">
            ▣ Tệp của tôi
          </div>
          <p className="ss-sidebar-note">
            Kho tệp cá nhân
            <br />
            AES-256-GCM
          </p>
        </aside>
        <main className="ss-main">
          {profile ? (
            <MyFilesPage
              key={profile.id}
              profile={profile}
              manager={manager}
              onAuthRequired={authRequired}
            />
          ) : (
            <div className="ss-connection">
              <p className="ss-eyebrow">SECURE SHARE</p>
              <h1>
                {loading ? "Đang mở kho tệp…" : "Kết nối tài khoản của bạn"}
              </h1>
              <p role={error ? "alert" : "status"}>
                {error || "Đang kiểm tra phiên đăng nhập."}
              </p>
              {!loading && (
                <button
                  className="ss-button primary"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Kết nối lại
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
