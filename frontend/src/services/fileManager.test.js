// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createFileManager } from "./fileManager.js";
it("isolates metadata/key failures while keeping other files visible", async () => {
  const api = {
    list: async () => ({ items: [{ id: "a" }, { id: "b" }], total: 2 }),
  };
  const fileCrypto = {
    readMetadata: async (value) => {
      if (value.id === "b") throw new Error("bad GCM");
      return { name: "ok.txt", size: 2 };
    },
  };
  const result = await createFileManager({ api, fileCrypto }).list({
    id: "user",
  });
  expect(result.items[0].name).toBe("ok.txt");
  expect(result.items[1].locked).toBe(true);
});
it("never uploads plaintext when encryption/key loading fails", async () => {
  const api = { upload: vi.fn() },
    fileCrypto = {
      prepareUpload: async () => {
        throw new Error("no key");
      },
    };
  await expect(
    createFileManager({ api, fileCrypto }).upload(
      new File(["private"], "x"),
      {},
    ),
  ).rejects.toThrow("no key");
  expect(api.upload).not.toHaveBeenCalled();
});
it("refuses an envelope for the wrong file before downloading content", async () => {
  const api = { envelope: async () => ({ id: "other" }), content: vi.fn() };
  await expect(
    createFileManager({ api, fileCrypto: {} }).download("requested", {}),
  ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  expect(api.content).not.toHaveBeenCalled();
});
it("does not fetch envelopes or share until the recipient is trusted", async () => {
  const api = { envelope: vi.fn(), share: vi.fn() };
  const requireTrusted = vi.fn(async () => { throw new Error("unverified"); });
  await expect(createFileManager({ api, fileCrypto: {}, requireTrusted })
    .share({ id: "file" }, {}, { id: "user" })).rejects.toThrow("unverified");
  expect(api.envelope).not.toHaveBeenCalled();
  expect(api.share).not.toHaveBeenCalled();
});
it("refuses the wrong owner envelope during sharing", async () => {
  const api = { envelope: async () => ({ id: "other" }), share: vi.fn() };
  const fileCrypto = { prepareShare: vi.fn() };
  await expect(createFileManager({ api, fileCrypto, requireTrusted: async () => {} })
    .share({ id: "file" }, {}, { id: "user" })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  expect(fileCrypto.prepareShare).not.toHaveBeenCalled();
  expect(api.share).not.toHaveBeenCalled();
});
