import { abortIfNeeded, FileError } from "./errors.js";

export function createFileManager({ api, fileCrypto, requireTrusted }) {
  async function decryptListing(result, profile, options = {}) {
    // Metadata stays encrypted in both owner and shared-file listings.
    const items = new Array(result.items.length);
    let next = 0;
    const worker = async () => {
      while (next < result.items.length) {
        abortIfNeeded(options.signal);
        const index = next++;
        const raw = result.items[index];
        try {
          const metadata = await fileCrypto.readMetadata(raw, {
            userId: profile.id,
            signal: options.signal,
          });
          items[index] = { ...raw, ...metadata, locked: false };
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          items[index] = {
            ...raw,
            name: "Tệp chưa mở khóa",
            size: null,
            locked: true,
            lockReason:
              error instanceof FileError
                ? error.message
                : "Không xác thực được metadata của tệp.",
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, items.length) }, worker),
    );
    abortIfNeeded(options.signal);
    return { ...result, items };
  }

  return {
    async list(profile, options = {}) {
      return decryptListing(await api.list(options), profile, options);
    },
    async listShared(profile, options = {}) {
      return decryptListing(
        await api.sharedWithMe(options),
        profile,
        options,
      );
    },
    async upload(file, profile, { signal, onStage } = {}) {
      onStage?.({
        kind: "encrypt",
        text: "Đang mã hóa trên thiết bị…",
        percent: null,
      });
      const { manifest, ciphertext } = await fileCrypto.prepareUpload(file, {
        profile,
        signal,
      });
      abortIfNeeded(signal);
      onStage?.({
        kind: "upload",
        text: "Đang tải tệp đã mã hóa…",
        percent: 0,
      });
      return api.upload(manifest, ciphertext, {
        signal,
        onProgress: (percent) =>
          onStage?.({
            kind: "upload",
            text:
              percent === 100
                ? "Máy chủ đã xác nhận tệp."
                : "Đang tải tệp đã mã hóa…",
            percent,
          }),
      });
    },
    async download(id, profile, { signal, onStage } = {}) {
      const envelope = await api.envelope(id, { signal });
      if (envelope?.id !== id)
        throw new FileError("BAD_RESPONSE", "Máy chủ trả nhầm mã tệp.");
      const ciphertext = await api.content(id, {
        signal,
        onProgress: (percent) =>
          onStage?.({
            kind: "download",
            text: "Đang tải tệp đã mã hóa…",
            percent,
          }),
      });
      abortIfNeeded(signal);
      onStage?.({
        kind: "decrypt",
        text: "Đang xác thực và giải mã trên thiết bị…",
        percent: null,
      });
      return fileCrypto.restoreDownload(envelope, ciphertext, {
        userId: profile.id,
        signal,
      });
    },
    remove(id, options) {
      return api.remove(id, options);
    },
    async share(file, recipient, profile, options = {}) {
      if (!requireTrusted) throw new FileError("KEY_UNVERIFIED", "Chưa kết nối bộ xác minh khóa người nhận.");
      await requireTrusted(profile.id, recipient);
      const envelope = await api.envelope(file.id, options);
      if (envelope?.id !== file.id) throw new FileError("BAD_RESPONSE", "Máy chủ trả nhầm mã tệp.");
      const payload = await fileCrypto.prepareShare(envelope, recipient.current_key, {
        userId: profile.id,
        signal: options.signal,
      });
      return api.share(file.id, {
        recipient_user_id: recipient.id,
        ...payload,
      }, options);
    },
  };
}
