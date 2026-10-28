import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ me: vi.fn(), check: vi.fn() }));
vi.mock("./services/fileApi.js", async (original) => ({ ...await original(), createFileApi: () => ({ me: mocks.me }) }));
vi.mock("./crypto/keyManager.js", () => ({ createKeyManager: () => ({ check: mocks.check }) }));
vi.mock("./pages/MyFilesPage.jsx", () => ({ default: () => <p>Kho tệp</p> }));
import App from "./App.jsx";
import { FileError } from "./services/errors.js";

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
