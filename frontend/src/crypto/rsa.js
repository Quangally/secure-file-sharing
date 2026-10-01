// Khóa riêng non-extractable; tuần 3 bổ sung lưu CryptoKey trong IndexedDB.
export async function generateKeyPair() {
  return crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['wrapKey', 'unwrapKey']);
}
export async function exportPublicKey(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey);
}
export async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['wrapKey']);
}
export async function wrapAesKey(aesKey, publicKey) {
  return crypto.subtle.wrapKey('raw', aesKey, publicKey, { name: 'RSA-OAEP' });
}
export async function unwrapAesKey(wrappedKey, privateKey, extractable = false) {
  // Chỉ chủ tệp dùng extractable=true trong RAM khi cần bọc lại khóa để chia sẻ.
  return crypto.subtle.unwrapKey('raw', wrappedKey, privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}
