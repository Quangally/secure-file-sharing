import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyFilesPage from "./MyFilesPage.jsx";
import { FileError } from "../services/errors.js";
const profile = {
  id: "10000000-0000-4000-8000-000000000001",
  full_name: "Trần Quốc An",
  current_key: { key_id: "20000000-0000-4000-8000-000000000001" },
};
const items = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "bao-cao-mon-hoc.pdf",
    size: 2400,
    updated_at: "2026-10-15T09:30:00Z",
    share_count: 2,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    name: "tai-lieu-tham-khao.docx",
    size: 840,
    updated_at: "2026-10-14T09:30:00Z",
    share_count: 0,
  },
];
function setup(overrides = {}, props = {}) {
  const manager = {
    list: vi.fn().mockResolvedValue({ items, total: 2 }),
    upload: vi.fn().mockResolvedValue({}),
    download: vi
      .fn()
      .mockResolvedValue({ filename: "bao-cao.pdf", blob: new Blob(["x"]) }),
    remove: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  const user = userEvent.setup();
  const result = render(
    <MyFilesPage profile={profile} manager={manager} {...props} />,
  );
  return { manager, user, ...result };
}
describe("My files page", () => {
  it("shows decrypted filenames, share count and page-local search", async () => {
    const { user } = setup();
    await screen.findByText("bao-cao-mon-hoc.pdf");
    expect(screen.getByText("2 người")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Tìm tên tệp trong trang này" }),
      "tham-khao",
    );
    expect(screen.queryByText("bao-cao-mon-hoc.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("tai-lieu-tham-khao.docx")).toBeInTheDocument();
  });
  it("handles the empty state and disables upload without an account key", async () => {
    setup(
      { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
      { profile: { ...profile, current_key: null } },
    );
    await screen.findByText("Kho tệp còn trống");
    expect(screen.getByRole("button", { name: /Tải tệp lên/ })).toBeDisabled();
  });
  it("sends the selected file through the encrypted workflow then reloads", async () => {
    const { user, manager } = setup();
    await screen.findByText("bao-cao-mon-hoc.pdf");
    const file = new File(["x"], "new.txt");
    await user.upload(screen.getByLabelText("Chọn tệp để tải lên"), file);
    await screen.findByText("Tệp đã được mã hóa và tải lên thành công.");
    expect(manager.upload.mock.calls[0][0]).toBe(file);
    await waitFor(() => expect(manager.list).toHaveBeenCalledTimes(2));
  });
  it("never saves a file after a decrypt failure", async () => {
    const saveDownload = vi.fn();
    const { user } = setup(
      {
        download: vi
          .fn()
          .mockRejectedValue(
            new FileError("DECRYPT_FAILED", "Dữ liệu đã bị sửa."),
          ),
      },
      { saveDownload },
    );
    await screen.findByText("bao-cao-mon-hoc.pdf");
    await user.click(
      screen.getByRole("button", { name: "Tải xuống bao-cao-mon-hoc.pdf" }),
    );
    await screen.findByRole("alert");
    expect(saveDownload).not.toHaveBeenCalled();
  });
  it("saves the verified download and passes share handling to An", async () => {
    const saveDownload = vi.fn(),
      onShare = vi.fn();
    const { user, manager } = setup({}, { saveDownload, onShare });
    await screen.findByText("bao-cao-mon-hoc.pdf");
    await user.click(screen.getAllByRole("button", { name: "Chia sẻ" })[0]);
    expect(onShare).toHaveBeenCalledWith(items[0]);
    await user.click(
      screen.getByRole("button", { name: "Tải xuống bao-cao-mon-hoc.pdf" }),
    );
    await waitFor(() => expect(saveDownload).toHaveBeenCalledTimes(1));
    expect(manager.download.mock.calls[0][0]).toBe(items[0].id);
  });
  it("requires delete confirmation and supports Escape cancellation", async () => {
    const { user, manager } = setup();
    await screen.findByText("bao-cao-mon-hoc.pdf");
    await user.click(
      screen.getByRole("button", { name: "Xóa bao-cao-mon-hoc.pdf" }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(manager.remove).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Xóa bao-cao-mon-hoc.pdf" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Xóa tệp",
      }),
    );
    await screen.findByText("Đã xóa tệp khỏi kho.");
    expect(manager.remove.mock.calls[0][0]).toBe(items[0].id);
  });
  it("shows retry for a network failure and signals an expired session", async () => {
    const onAuthRequired = vi.fn();
    const list = vi
      .fn()
      .mockRejectedValueOnce(new FileError("HTTP_401", "Hết phiên", 401))
      .mockResolvedValue({ items, total: 2 });
    const { user } = setup({ list }, { onAuthRequired });
    await screen.findByText("Hết phiên");
    expect(onAuthRequired).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("bao-cao-mon-hoc.pdf");
  });
  it("shows locked rows instead of fake names and refuses their downloads", async () => {
    setup({
      list: vi
        .fn()
        .mockResolvedValue({
          items: [
            {
              ...items[0],
              name: "Tệp chưa mở khóa",
              size: null,
              locked: true,
              lockReason: "Không có khóa trên máy.",
            },
          ],
          total: 1,
        }),
    });
    await screen.findByText("Tệp chưa mở khóa");
    expect(
      screen.getByRole("button", { name: "Tải xuống Tệp chưa mở khóa" }),
    ).toBeDisabled();
  });
  it("requests the next page and prevents previous navigation on page one", async () => {
    const { user, manager } = setup({
      list: vi.fn().mockResolvedValue({ items, total: 21 }),
    });
    await screen.findByText("bao-cao-mon-hoc.pdf");
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(manager.list.mock.calls.at(-1)[1].page).toBe(2));
  });
  it("aborts pending uploads on unmount", async () => {
    let signal;
    const { user, unmount } = setup({
      upload: vi.fn((_file, _profile, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    });
    await screen.findByText("bao-cao-mon-hoc.pdf");
    await user.upload(
      screen.getByLabelText("Chọn tệp để tải lên"),
      new File(["x"], "x.txt"),
    );
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
