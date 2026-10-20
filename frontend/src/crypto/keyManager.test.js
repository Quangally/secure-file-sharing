// @vitest-environment node
import { expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createKeyManager, publicFingerprint } from "./keyManager.js";
import { generateKeyPair, exportPublicKey } from "./rsa.js";
import { createDeviceKeyProvider } from "../services/keyStore.js";
import { createFileCrypto } from "./fileCrypto.js";

const userId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const db = new IDBFactory();
  let profile = { id: userId, current_key: null };
  const api = {
    me: vi.fn(async () => structuredClone(profile)),
    registerKey: vi.fn(async ({ public_key_jwk }) => {
      const key = await crypto.subtle.importKey("jwk", public_key_jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["wrapKey"]);
      profile.current_key = { key_id: keyId, public_key_jwk, fingerprint_sha256: await publicFingerprint(key) };
      return profile.current_key;
    }),
  };
  return { db, api, keys: createKeyManager({ api, indexedDBImpl: db }) };
}

it("persists non-extractable keys and uses them after reload for file round-trip", async () => {
  const { db, api, keys } = fixture();
  const profile = await keys.enroll();
  expect(Object.keys(api.registerKey.mock.calls[0][0])).toEqual(["public_key_jwk"]);
  expect(api.registerKey.mock.calls[0][0].public_key_jwk.d).toBeUndefined();
  const getKeyPair = createDeviceKeyProvider({ indexedDBImpl: db });
  const pair = await getKeyPair(userId, keyId);
  expect(pair.privateKey.extractable).toBe(false);
  await expect(crypto.subtle.exportKey("jwk", pair.privateKey)).rejects.toThrow();
  expect((await createKeyManager({ api, indexedDBImpl: db }).check(profile)).state).toBe("ready");
  await keys.enroll();
  expect(api.registerKey).toHaveBeenCalledTimes(1);
  const fileCrypto = createFileCrypto({ getKeyPair });
  const file = new File([new Uint8Array([0, 12, 255])], "bí mật.bin");
  const upload = await fileCrypto.prepareUpload(file, { profile });
  const bytes = new Uint8Array(await upload.ciphertext.arrayBuffer());
  const { sha256Hex } = await import("./hash.js");
  const envelope = {
    ...upload.manifest, id: upload.manifest.file_id, key_id: keyId,
    wrapped_aes_key_base64: upload.manifest.owner_wrapped_aes_key_base64,
    ciphertext_size: bytes.length, ciphertext_sha256: await sha256Hex(bytes),
  };
  const restored = await fileCrypto.restoreDownload(envelope, bytes, { userId });
  expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(new Uint8Array([0, 12, 255]));
});

it("recovers when registration commits but its response is lost", async () => {
  const { db, api, keys } = fixture();
  const register = api.registerKey.getMockImplementation();
  api.registerKey.mockImplementation(async (body) => { await register(body); throw new Error("lost response"); });
  const profile = await keys.enroll();
  expect((await createKeyManager({ api, indexedDBImpl: db }).check(profile)).state).toBe("ready");
});

it("recovers the pending key after the app closes before registration can be reconciled", async () => {
  const { db, api, keys } = fixture();
  const register = api.registerKey.getMockImplementation();
  const me = api.me.getMockImplementation();
  api.registerKey.mockImplementation(async (body) => {
    await register(body);
    api.me.mockRejectedValue(new Error("offline"));
    throw new Error("lost response");
  });
  await expect(keys.enroll()).rejects.toThrow("offline");
  api.me.mockImplementation(me);
  const reloaded = createKeyManager({ api, indexedDBImpl: db });
  expect((await reloaded.check(await api.me())).state).toBe("ready");
});

it("rejects substituted public keys even if the server updates their fingerprint too", async () => {
  const { keys } = fixture();
  const profile = await keys.enroll();
  const replacement = await generateKeyPair();
  profile.current_key.public_key_jwk = await exportPublicKey(replacement.publicKey);
  await expect(keys.check(profile)).rejects.toMatchObject({ code: "KEY_CHANGED" });
  profile.current_key.fingerprint_sha256 = await publicFingerprint(replacement.publicKey);
  await expect(keys.check(profile)).rejects.toMatchObject({ code: "KEY_CHANGED" });
});

it("retains pending keys after network failure and reuses them on retry", async () => {
  const { api, keys } = fixture();
  api.registerKey.mockRejectedValueOnce(new Error("offline"));
  await expect(keys.enroll()).rejects.toThrow("offline");
  await keys.enroll();
  expect(api.registerKey.mock.calls[0][0]).toEqual(api.registerKey.mock.calls[1][0]);
});

it("does not replace registered keys when device storage is missing", async () => {
  const { api, keys } = fixture();
  const profile = await keys.enroll();
  const emptyDevice = createKeyManager({ api, indexedDBImpl: new IDBFactory() });
  await expect(emptyDevice.check(profile)).rejects.toMatchObject({ code: "KEY_MISSING" });
  await expect(emptyDevice.enroll()).rejects.toMatchObject({ code: "KEY_MISSING" });
  expect(api.registerKey).toHaveBeenCalledTimes(1);
});

it("fails before publishing a key when IndexedDB is unavailable", async () => {
  const { api } = fixture();
  await expect(createKeyManager({ api, indexedDBImpl: null }).enroll()).rejects.toMatchObject({ code: "KEY_UNAVAILABLE" });
  expect(api.registerKey).not.toHaveBeenCalled();
});

it("concurrent enrollment uses the same persisted candidate", async () => {
  const { api, db, keys } = fixture();
  const other = createKeyManager({ api, indexedDBImpl: db });
  const profiles = await Promise.all([keys.enroll(), other.enroll()]);
  expect(profiles[0].current_key.fingerprint_sha256).toBe(profiles[1].current_key.fingerprint_sha256);
  if (api.registerKey.mock.calls.length > 1)
    expect(api.registerKey.mock.calls[0][0]).toEqual(api.registerKey.mock.calls[1][0]);
});

it("pins independently confirmed recipient fingerprints and blocks changed keys", async () => {
  const { keys, db, api } = fixture();
  const profile = await keys.enroll();
  const recipient = { ...profile, id: "33333333-3333-4333-8333-333333333333" };
  expect((await keys.recipientStatus(userId, recipient)).state).toBe("new");
  await expect(keys.requireTrusted(userId, recipient)).rejects.toMatchObject({ code: "KEY_UNVERIFIED" });
  await expect(keys.trustRecipient(userId, recipient, "wrong")).rejects.toMatchObject({ code: "KEY_UNVERIFIED" });
  await keys.trustRecipient(userId, recipient, profile.current_key.fingerprint_sha256);
  const reloaded = createKeyManager({ api, indexedDBImpl: db });
  await reloaded.requireTrusted(userId, recipient);
  expect((await keys.recipientStatus(recipient.id, recipient)).state).toBe("new");
  const replacement = await generateKeyPair();
  recipient.current_key = { key_id: keyId, public_key_jwk: await exportPublicKey(replacement.publicKey), fingerprint_sha256: await publicFingerprint(replacement.publicKey) };
  expect((await reloaded.recipientStatus(userId, recipient)).state).toBe("changed");
  await expect(reloaded.requireTrusted(userId, recipient)).rejects.toMatchObject({ code: "KEY_UNVERIFIED" });
  await keys.trustRecipient(userId, recipient, recipient.current_key.fingerprint_sha256);
  await reloaded.requireTrusted(userId, recipient);
});
