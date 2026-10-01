import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBytes, decryptBytes } from '../frontend/src/crypto/aes.js';
import { generateKeyPair, exportPublicKey, importPublicKey, wrapAesKey, unwrapAesKey } from '../frontend/src/crypto/rsa.js';
import { sha256Hex } from '../frontend/src/crypto/hash.js';
const bytes = new TextEncoder().encode('Tài liệu thử nghiệm — chỉ dùng dữ liệu giả');
const aad = new TextEncoder().encode('protocol-v1:file-123');

test('A→B round-trip; owner envelope supports sharing again', async () => {
  const owner = await generateKeyPair();
  const recipient = await generateKeyPair();
  const payload = await encryptBytes(bytes, aad);
  const ownerEnvelope = await wrapAesKey(payload.key, owner.publicKey);
  const ownerKey = await unwrapAesKey(ownerEnvelope, owner.privateKey, true);
  const recipientPublic = await importPublicKey(await exportPublicKey(recipient.publicKey));
  const recipientEnvelope = await wrapAesKey(ownerKey, recipientPublic);
  const recipientKey = await unwrapAesKey(recipientEnvelope, recipient.privateKey);
  const restored = await decryptBytes(payload.ciphertext, recipientKey, payload.iv, aad);
  assert.deepEqual(new Uint8Array(restored), bytes);
  assert.equal(recipientKey.extractable, false);
  assert.equal(owner.privateKey.extractable, false);
});
test('GCM rejects changed ciphertext, tag, IV, AAD and wrong AES key', async () => {
  const p = await encryptBytes(bytes, aad);
  for (const offset of [0, new Uint8Array(p.ciphertext).length - 1]) {
    const altered = new Uint8Array(p.ciphertext.slice(0)); altered[offset] ^= 1;
    await assert.rejects(decryptBytes(altered, p.key, p.iv, aad));
  }
  const iv = p.iv.slice(); iv[0] ^= 1;
  await assert.rejects(decryptBytes(p.ciphertext, p.key, iv, aad));
  await assert.rejects(decryptBytes(p.ciphertext, p.key, p.iv, new Uint8Array()));
  const other = await encryptBytes(bytes, aad);
  await assert.rejects(decryptBytes(p.ciphertext, other.key, p.iv, aad));
});
test('wrong recipient private key cannot unwrap AES key', async () => {
  const b = await generateKeyPair(), c = await generateKeyPair();
  const p = await encryptBytes(bytes);
  const envelope = await wrapAesKey(p.key, b.publicKey);
  await assert.rejects(unwrapAesKey(envelope, c.privateKey));
});
test('empty and binary payloads round-trip', async () => {
  for (const input of [new Uint8Array(), new Uint8Array([0, 255, 1, 128])]) {
    const p = await encryptBytes(input);
    assert.deepEqual(new Uint8Array(await decryptBytes(p.ciphertext, p.key, p.iv)), input);
    assert.equal(p.ciphertext.byteLength, input.byteLength + 16);
  }
});
test('SHA-256 known vector', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
