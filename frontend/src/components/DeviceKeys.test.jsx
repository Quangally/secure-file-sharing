import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
