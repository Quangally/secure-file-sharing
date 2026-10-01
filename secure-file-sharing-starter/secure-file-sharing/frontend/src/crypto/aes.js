// Primitive mẫu: mỗi lần mã hóa sinh AES key và IV mới. Tệp lớn cần thiết kế riêng.
export async function encryptBytes(plaintext, additionalData = new Uint8Array()) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintext);
  return { key, iv, ciphertext };
}
export async function decryptBytes(ciphertext, key, iv, additionalData = new Uint8Array()) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, ciphertext);
}
