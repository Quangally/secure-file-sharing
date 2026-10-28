import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ me: vi.fn(), check: vi.fn(), login: vi.fn(), logout: vi.fn(), setCsrfToken: vi.fn() }));
vi.mock("./services/fileApi.js", async (original) => ({ ...await original(), createFileApi: () => mocks }));
vi.mock("./crypto/keyManager.js", () => ({ createKeyManager: () => ({ check: mocks.check }) }));
vi.mock("./pages/MyFilesPage.jsx", () => ({ default: ({ onAuthRequired }) => <>
  <h1>Tệp của tôi</h1>
  <button onClick={onAuthRequired}>Tải tệp khi phiên mất hiệu lực</button>
</> }));
vi.mock("./pages/SharedFilesPage.jsx", () => ({ default: () => <h1>Tệp được chia sẻ</h1> }));
import App from "./App.jsx";
import { FileError } from "./services/errors.js";

const profile = { id: "owner", full_name: "Quang", email: "quang@example.test", current_key: null };
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
  mocks.me.mockResolvedValue(profile);
  mocks.check.mockResolvedValue({ state: "new" });
});

it("opens a clean login form when no session exists on initial load", async () => {
  mocks.me.mockRejectedValue(new FileError("HTTP_401", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401));
  render(<App />);
  await screen.findByRole("heading", { name: "Đăng nhập" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps backend errors visible during the initial session check", async () => {
  mocks.me.mockRejectedValue(new FileError("HTTP_500", "Máy chủ chưa sẵn sàng.", 500));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Máy chủ chưa sẵn sàng.");
});

it("shows an expiry notice when a signed-in operation loses its session", async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Tải tệp khi phiên mất hiệu lực" }));
  await screen.findByRole("heading", { name: "Đăng nhập" });
  expect(screen.getByRole("alert")).toHaveTextContent("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  expect(mocks.setCsrfToken).toHaveBeenCalledWith("");
});

it.each([
  ["Tệp của tôi", "Tệp của tôi", "#/files"],
  ["Được chia sẻ", "Tệp được chia sẻ", "#/shared"],
  ["Cài đặt", "Cài đặt", "#/settings"],
])("restores %s when the app is reloaded at the current URL", async (label, heading, hash) => {
  const first = render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(label) }));
  expect(window.location.hash).toBe(hash);
  first.unmount();
  render(<App />);
  expect(await screen.findByRole("heading", { name: heading, exact: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-current", "page");
});

it("follows browser Back after navigation", async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /Được chia sẻ/ }));
  await userEvent.click(screen.getByRole("button", { name: /Cài đặt/ }));
  window.history.back();
  await waitFor(() => expect(window.location.hash).toBe("#/shared"));
  expect(await screen.findByRole("heading", { name: "Tệp được chia sẻ" })).toBeInTheDocument();
});

it("requires login before restoring the requested page after an expired session", async () => {
  window.history.replaceState(null, "", "/#/shared");
  mocks.me.mockRejectedValueOnce(new FileError("HTTP_401", "Phiên đã hết hạn.", 401));
  mocks.login.mockResolvedValue({ status: "ok" });
  render(<App />);
  await screen.findByRole("heading", { name: "Đăng nhập" });
  expect(screen.queryByRole("heading", { name: "Tệp được chia sẻ" })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Email"), "quang@example.test");
  await userEvent.type(screen.getByLabelText("Mật khẩu"), "test-password");
  await userEvent.click(screen.getByRole("button", { name: "Đăng nhập", exact: true }));
  expect(await screen.findByRole("heading", { name: "Tệp được chia sẻ" })).toBeInTheDocument();
});

it("resets the page on explicit logout", async () => {
  window.history.replaceState(null, "", "/#/settings");
  mocks.logout.mockResolvedValue(null);
  render(<App />);
  await screen.findByRole("heading", { name: "Cài đặt", exact: true });
  await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
  expect(await screen.findByRole("heading", { name: "Đăng nhập" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(window.location.hash).toBe("#/files");
});

it("never shows an unverified profile fingerprint in Settings either", async () => {
  mocks.me.mockResolvedValue({ id: "owner", full_name: "Quang", email: "quang@example.test", current_key: { fingerprint_sha256: "server-substitution" } });
  mocks.check.mockRejectedValue(new FileError("KEY_CHANGED", "Khóa trên máy chủ không khớp."));
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.queryByText("server-substitution")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Cài đặt/ }));
  expect(screen.getByRole("heading", { name: "Cài đặt" })).toBeInTheDocument();
  expect(screen.queryByText("server-substitution")).not.toBeInTheDocument();
});
