import { FileError, abortIfNeeded } from "./errors.js";

// Read-only integration boundary. Bac owns creating/importing/storing the keys.
// Record: {userId, keyId, privateKey: CryptoKey, publicKey: CryptoKey}.
export function createDeviceKeyProvider({
  indexedDBImpl = globalThis.indexedDB,
} = {}) {
  return async function getKeyPair(userId, keyId, { signal } = {}) {
    abortIfNeeded(signal);
    if (!indexedDBImpl)
      throw new FileError(
        "KEY_UNAVAILABLE",
        "Trình duyệt chưa hỗ trợ kho khóa trên thiết bị.",
      );
    const record = await new Promise((resolve, reject) => {
      const request = indexedDBImpl.open("secure-share-keyring", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("keys"))
          request.result.createObjectStore("keys", {
            keyPath: ["userId", "keyId"],
          });
      };
      request.onerror = () =>
        reject(
          new FileError(
            "KEY_UNAVAILABLE",
            "Không mở được kho khóa trên thiết bị.",
          ),
        );
      request.onblocked = () =>
        reject(
          new FileError(
            "KEY_UNAVAILABLE",
            "Kho khóa đang được sử dụng. Hãy đóng các tab cũ rồi thử lại.",
          ),
        );
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (!db.objectStoreNames.contains("keys")) {
          db.close();
          reject(
            new FileError("KEY_UNAVAILABLE", "Kho khóa chưa đúng cấu trúc."),
          );
          return;
        }
        let result;
        const transaction = db.transaction("keys", "readonly");
        const get = transaction.objectStore("keys").get([userId, keyId]);
        get.onsuccess = () => {
          result = get.result;
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onabort = transaction.onerror = () => {
          db.close();
          reject(
            new FileError(
              "KEY_UNAVAILABLE",
              "Không đọc được khóa trên thiết bị.",
            ),
          );
        };
      };
    });
    abortIfNeeded(signal);
    if (
      !record?.privateKey ||
      record.userId !== userId ||
      record.keyId !== keyId
    )
      throw new FileError(
        "KEY_MISSING",
        "Thiết bị này chưa có khóa để mở tệp. Hãy dùng thiết bị đã tạo khóa.",
      );
    const privateKey = record.privateKey;
    if (
      privateKey.type !== "private" ||
      privateKey.extractable !== false ||
      privateKey.algorithm?.name !== "RSA-OAEP" ||
      privateKey.algorithm?.hash?.name !== "SHA-256" ||
      privateKey.algorithm?.modulusLength !== 2048 ||
      !privateKey.usages.includes("unwrapKey")
    ) {
      throw new FileError(
        "KEY_INVALID",
        "Khóa trên thiết bị chưa tương thích RSA-OAEP/SHA-256.",
      );
    }
    return record;
  };
}
