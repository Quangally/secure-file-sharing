import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SharedFilesPage from "./SharedFilesPage.jsx";
import { createFileManager } from "../services/fileManager.js";

it.each([
  [{ id: "owner", full_name: "Nguyễn Văn A", email: "a@test.local" }, "Nguyễn Văn A"],
  [{ id: "owner", full_name: "", email: "a@test.local" }, "a@test.local"],
  [null, "người dùng khác"],
])("renders the sharer name from API metadata without rendering an object", async (sharedBy, label) => {
  const api = { sharedWithMe: vi.fn(async () => ({
    items: [{ id: "file", shared_by: sharedBy }], total: 1, page: 1, page_size: 20,
  })) };
  const fileCrypto = { readMetadata: async () => ({ name: "test.txt", size: 3 }) };
  render(<SharedFilesPage api={api} profile={{ id: "recipient" }}
    manager={createFileManager({ api, fileCrypto })} />);
  expect(await screen.findByText(`3 B · Chia sẻ bởi ${label}`)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tải xuống" })).toBeEnabled();
});
