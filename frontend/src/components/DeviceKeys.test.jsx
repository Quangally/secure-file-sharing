import React from "react";
import { expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeviceKeys from "./DeviceKeys.jsx";
import { FileError } from "../services/errors.js";

it("explains loss of keys and enrolls only after the user chooses creation", async () => {
  const profile = { id: "user", current_key: null };
  const updated = { ...profile, current_key: { fingerprint_sha256: "fingerprint" } };
  const keys = { check: vi.fn(async () => ({ state: "new" })), enroll: vi.fn(async () => updated) };
  const ready = vi.fn();
  render(<DeviceKeys profile={profile} keys={keys} onReady={ready} />);
  const button = await screen.findByRole("button", { name: "Tạo khóa trên thiết bị này" });
  expect(screen.getByText(/Đổi mật khẩu không khôi phục khóa/)).toBeInTheDocument();
  expect(keys.enroll).not.toHaveBeenCalled();
  await userEvent.click(button);
  await waitFor(() => expect(ready).toHaveBeenCalledWith(updated));
});

it("does not offer replacement when a registered private key is missing", async () => {
  const keys = { check: vi.fn(async () => { throw new FileError("KEY_MISSING", "Thiếu khóa riêng."); }), enroll: vi.fn() };
  render(<DeviceKeys profile={{ id: "user", current_key: { fingerprint_sha256: "fp" } }} keys={keys} onReady={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Thiếu khóa riêng");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(keys.enroll).not.toHaveBeenCalled();
  expect(screen.queryByText("fp")).not.toBeInTheDocument();
});

it("only shows the verified local fingerprint after checking finishes", async () => {
  let finish;
  const keys = { check: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
  const profile = { id: "user", current_key: { key_id: "key", fingerprint_sha256: "unverified-server-value" } };
  render(<DeviceKeys profile={profile} keys={keys} />);
  expect(screen.queryByText("unverified-server-value")).not.toBeInTheDocument();
  await act(async () => finish({ state: "ready", fingerprint: "verified-local-value" }));
  expect(screen.getByText("verified-local-value")).toBeInTheDocument();
  expect(screen.queryByText("unverified-server-value")).not.toBeInTheDocument();
});

it("does not expose a substituted server fingerprint when the local check rejects it", async () => {
  const keys = { check: vi.fn(async () => { throw new FileError("KEY_CHANGED", "Khóa không khớp."); }) };
  render(<DeviceKeys profile={{ id: "user", current_key: { fingerprint_sha256: "substituted-fingerprint" } }} keys={keys} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Khóa không khớp");
  expect(screen.queryByText("substituted-fingerprint")).not.toBeInTheDocument();
});

it("hides previous verification on profile changes and ignores an obsolete check", async () => {
  let finishOld, finishNew;
  const keys = { check: vi.fn()
    .mockResolvedValueOnce({ state: "ready", fingerprint: "original-local-fingerprint" })
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; })) };
  const { rerender } = render(<DeviceKeys profile={{ id: "user", current_key: { fingerprint_sha256: "first" } }} keys={keys} />);
  expect(await screen.findByText("original-local-fingerprint")).toBeInTheDocument();
  rerender(<DeviceKeys profile={{ id: "user", current_key: { fingerprint_sha256: "unverified-second" } }} keys={keys} />);
  expect(screen.queryByText("original-local-fingerprint")).not.toBeInTheDocument();
  expect(screen.queryByText("unverified-second")).not.toBeInTheDocument();
  rerender(<DeviceKeys profile={{ id: "user", current_key: { fingerprint_sha256: "unverified-third" } }} keys={keys} />);
  await act(async () => finishOld({ state: "ready", fingerprint: "obsolete-fingerprint" }));
  expect(screen.queryByText("obsolete-fingerprint")).not.toBeInTheDocument();
  await act(async () => finishNew({ state: "ready", fingerprint: "latest-local-fingerprint" }));
  expect(screen.getByText("latest-local-fingerprint")).toBeInTheDocument();
});
