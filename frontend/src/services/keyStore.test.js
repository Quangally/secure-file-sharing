// @vitest-environment node
import { expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createDeviceKeyProvider } from "./keyStore.js";
import { generateKeyPair } from "../crypto/rsa.js";
async function store(factory, record) {
  return new Promise((resolve, reject) => {
    const req = factory.open("secure-share-keyring", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("keys", { keyPath: ["userId", "keyId"] });
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = reject;
    };
    req.onerror = reject;
  });
}
it("reads the correct device key by user and key ID without exporting the private key", async () => {
  const factory = new IDBFactory(),
    pair = await generateKeyPair();
  await store(factory, { userId: "user", keyId: "key", ...pair });
  const get = createDeviceKeyProvider({ indexedDBImpl: factory });
  expect((await get("user", "key")).privateKey.extractable).toBe(false);
  await expect(get("another-user", "key")).rejects.toMatchObject({
    code: "KEY_MISSING",
  });
  await expect(get("user", "other-key")).rejects.toMatchObject({
    code: "KEY_MISSING",
  });
});
it("rejects extractable private keys and unavailable device storage", async () => {
  const factory = new IDBFactory();
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["wrapKey", "unwrapKey"],
  );
  await store(factory, { userId: "u", keyId: "k", ...pair });
  await expect(
    createDeviceKeyProvider({ indexedDBImpl: factory })("u", "k"),
  ).rejects.toMatchObject({ code: "KEY_INVALID" });
  await expect(
    createDeviceKeyProvider({ indexedDBImpl: null })("u", "k"),
  ).rejects.toMatchObject({ code: "KEY_UNAVAILABLE" });
});
