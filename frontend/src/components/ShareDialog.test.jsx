import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareDialog from "./ShareDialog.jsx";

it("shows recipients from the API items response and permits revocation", async () => {
  const api = {
    listShares: vi.fn(async () => ({ file_id: "file", items: [
      { user_id: "recipient", full_name: "Nguyễn Văn B", email: "b@test.local" },
    ] })),
    revokeShare: vi.fn(async () => null),
  };
  const onChanged = vi.fn();
  render(<ShareDialog api={api} profile={{ id: "owner" }} file={{ id: "file", name: "test.txt" }}
    onClose={vi.fn()} onChanged={onChanged} />);
  expect(await screen.findByText("Nguyễn Văn B")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
  await waitFor(() => expect(screen.queryByText("Nguyễn Văn B")).toBeNull());
  expect(api.revokeShare).toHaveBeenCalledWith("file", "recipient");
  expect(onChanged).toHaveBeenCalledOnce();
});

it("warns about a changed recipient key and requires fingerprint confirmation before sharing", async () => {
  const recipient = { id: "recipient", full_name: "B", email: "b@example.test", current_key: { fingerprint_sha256: "abcd" } };
  const api = { listShares: vi.fn(async () => ({ items: [] })), lookupRecipient: vi.fn(async () => recipient) };
  const keys = { recipientStatus: vi.fn(async () => ({ state: "changed" })), trustRecipient: vi.fn(async () => {}) };
  const manager = { share: vi.fn(async () => {}) };
  render(<ShareDialog api={api} keys={keys} manager={manager} profile={{ id: "owner" }} file={{ id: "file", name: "test.txt" }} onClose={vi.fn()} />);
  await userEvent.type(screen.getByRole("textbox", { name: /Email người nhận/ }), "b@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Tìm người nhận" }));
  expect(await screen.findByText(/Khóa người nhận đã thay đổi/)).toBeInTheDocument();
  const share = screen.getByRole("button", { name: "Xác nhận chia sẻ" });
  expect(share).toBeDisabled();
  expect(manager.share).not.toHaveBeenCalled();
  await userEvent.type(screen.getByRole("textbox", { name: "Fingerprint đã đối chiếu" }), "abcd");
  await userEvent.click(share);
  await waitFor(() => expect(manager.share).toHaveBeenCalled());
  expect(keys.trustRecipient).toHaveBeenCalledWith("owner", recipient, "abcd");
  expect(keys.trustRecipient.mock.invocationCallOrder[0]).toBeLessThan(manager.share.mock.invocationCallOrder[0]);
});
