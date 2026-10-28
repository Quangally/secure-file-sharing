import { generateKeyPair, exportPublicKey, importPublicKey, wrapAesKey, unwrapAesKey } from "./rsa.js";
import { sha256Hex } from "./hash.js";
import { createDeviceKeyProvider } from "../services/keyStore.js";
import { FileError } from "../services/errors.js";
import { validId } from "../services/fileApi.js";

export async function publicFingerprint(key) {
  return sha256Hex(await crypto.subtle.exportKey("spki", key));
}

export async function verifyPublicKey(value) {
  validId(value?.key_id);
  const jwk = value.public_key_jwk;
  if (!jwk || Object.keys(jwk).some((name) => !["kty", "n", "e", "alg", "key_ops", "ext"].includes(name)))
    throw new FileError("KEY_INVALID", "Public key không hợp lệ.");
  const key = await importPublicKey(jwk);
  if (key.algorithm.modulusLength !== 2048 ||
      Array.from(key.algorithm.publicExponent).join(",") !== "1,0,1" ||
      await publicFingerprint(key) !== value.fingerprint_sha256)
    throw new FileError("KEY_CHANGED", "Public key không khớp fingerprint. Dừng để kiểm tra khóa.");
  return value.fingerprint_sha256;
}

export function createKeyManager({ api, indexedDBImpl = globalThis.indexedDB } = {}) {
  const getPair = createDeviceKeyProvider({ indexedDBImpl });
  // Reserved IDs share the existing v1 store, preserving existing device keys.
  async function transaction(mode, action) {
    if (!indexedDBImpl) throw new FileError("KEY_UNAVAILABLE", "Không truy cập được kho khóa thiết bị.");
    return new Promise((resolve, reject) => {
      const request = indexedDBImpl.open("secure-share-keyring", 1);
      const fail = () => reject(new FileError("KEY_UNAVAILABLE", "Không lưu/đọc được khóa. Hãy kiểm tra dung lượng và quyền trình duyệt."));
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("keys"))
          request.result.createObjectStore("keys", { keyPath: ["userId", "keyId"] });
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        try {
          const tx = db.transaction("keys", mode);
          let result;
          action(tx.objectStore("keys"), (value) => { result = value; });
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onabort = tx.onerror = () => { db.close(); fail(); };
        } catch { db.close(); fail(); }
      };
    });
  }
  const read = (userId, keyId) => transaction("readonly", (store, done) => {
    store.get([userId, keyId]).onsuccess = (event) => done(event.target.result);
  });

  async function check(profile) {
    validId(profile.id);
    if (!profile.current_key) return { state: "new" };
    const remote = profile.current_key;
    await verifyPublicKey(remote);
    let pair;
    try { pair = await getPair(profile.id, remote.key_id); }
    catch (error) {
      if (error.code !== "KEY_MISSING") throw error;
      const pending = await read(profile.id, "pending");
      if (pending && await publicFingerprint(pending.publicKey) === remote.fingerprint_sha256) {
        await transaction("readwrite", (store) => {
          // Another tab may already have finalized this key. Never overwrite a
          // stored private key with a stale pending snapshot.
          store.get([profile.id, remote.key_id]).onsuccess = (event) => {
            if (!event.target.result) {
              store.add({ ...pending, keyId: remote.key_id });
              store.delete([profile.id, "pending"]);
            }
          };
        });
      }
      // Promotion and deletion are atomic: a missing pending row can mean a
      // second tab has already installed the final row since our first read.
      pair = await getPair(profile.id, remote.key_id);
    }
    const fingerprint = await publicFingerprint(pair.publicKey);
    if (fingerprint !== remote.fingerprint_sha256)
      throw new FileError("KEY_CHANGED", "Khóa máy chủ khác khóa trên thiết bị.");
    // Prove the stored public/private keys belong together without exporting the private key.
    const challenge = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    try {
      await unwrapAesKey(await wrapAesKey(challenge, pair.publicKey), pair.privateKey);
    } catch { throw new FileError("KEY_INVALID", "Cặp khóa trên thiết bị không khớp."); }
    return { state: "ready", fingerprint };
  }

  async function enroll() {
    let profile = await api.me();
    if (profile.current_key) { await check(profile); return profile; }
    validId(profile.id);
    let pending = await read(profile.id, "pending");
    if (!pending) {
      const candidate = { userId: profile.id, keyId: "pending", ...await generateKeyPair() };
      // Serialize concurrent tabs: preserve whichever candidate committed first.
      pending = await transaction("readwrite", (store, done) => {
        store.get([profile.id, "pending"]).onsuccess = (event) => {
          const existing = event.target.result;
          if (!existing) store.add(candidate);
          done(existing || candidate);
        };
      });
    }
    const beforePublish = await api.me();
    if (beforePublish.id !== profile.id)
      throw new FileError("KEY_CHANGED", "Phiên tài khoản đã thay đổi. Vui lòng đăng nhập lại.");
    if (beforePublish.current_key) { await check(beforePublish); return beforePublish; }
    // Verify persistence before publishing. If another tab has just consumed
    // pending, reconcile its registered final key rather than creating a new one.
    try { await getPair(profile.id, "pending"); }
    catch (error) {
      if (error.code !== "KEY_MISSING") throw error;
      const fresh = await api.me();
      if (fresh.id !== profile.id || !fresh.current_key) throw error;
      await check(fresh);
      return fresh;
    }
    try {
      await api.registerKey({ public_key_jwk: await exportPublicKey(pending.publicKey) });
    } catch (error) {
      // A lost response or another tab may have already registered this same key.
      const fresh = await api.me();
      if (fresh.id !== profile.id || !fresh.current_key) throw error;
      await check(fresh);
      return fresh;
    }
    const fresh = await api.me();
    if (fresh.id !== profile.id || !fresh.current_key)
      throw new FileError("KEY_CHANGED", "Phiên tài khoản đã thay đổi. Vui lòng đăng nhập lại.");
    await check(fresh);
    return fresh;
  }

  async function recipientStatus(userId, recipient) {
    validId(userId); validId(recipient.id);
    const fingerprint = await verifyPublicKey(recipient.current_key);
    const pin = await read(userId, `trusted:${recipient.id}`);
    return { fingerprint, state: !pin ? "new" : pin.fingerprint === fingerprint ? "trusted" : "changed" };
  }
  async function trustRecipient(userId, recipient, confirmedFingerprint) {
    const { fingerprint } = await recipientStatus(userId, recipient);
    if (confirmedFingerprint.replace(/\s/g, "").toLowerCase() !== fingerprint)
      throw new FileError("KEY_UNVERIFIED", "Fingerprint nhập vào chưa khớp. Hãy đối chiếu trực tiếp với người nhận.");
    await transaction("readwrite", (store) => store.put({
      userId, keyId: `trusted:${recipient.id}`, fingerprint,
    }));
  }
  async function requireTrusted(userId, recipient) {
    if ((await recipientStatus(userId, recipient)).state !== "trusted")
      throw new FileError("KEY_UNVERIFIED", "Cần xác minh fingerprint của người nhận trước khi chia sẻ.");
  }
  return { check, enroll, recipientStatus, trustRecipient, requireTrusted };
}
