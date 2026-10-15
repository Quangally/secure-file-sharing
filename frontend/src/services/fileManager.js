import { abortIfNeeded, FileError } from "./errors.js";

export function createFileManager({ api, fileCrypto }) {
  return {
    async list(profile, options = {}) {
      const result = await api.list(options);
      // Bounded work: at most four decryptions at a time, with no persistent cache.
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
  };
}
