// Protocol adapter for Quang's UI, composed from Bac's AES/RSA/SHA primitives.
import { encryptBytes, decryptBytes } from "./aes.js";
import { importPublicKey, wrapAesKey, unwrapAesKey } from "./rsa.js";
import { sha256Hex } from "./hash.js";
import {
  validId,
  MAX_FILE_BYTES,
  MAX_CIPHERTEXT_BYTES,
} from "../services/fileApi.js";
import { FileError, abortIfNeeded } from "../services/errors.js";

const utf8 = new TextEncoder();
export function toBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function fromBase64(value, { length, max = length ?? 4096 } = {}) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new FileError("BAD_ENCODING", "Dữ liệu mã hóa từ API không hợp lệ.");
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (
    bytes.byteLength > max ||
    (length !== undefined && bytes.byteLength !== length) ||
    toBase64(bytes) !== value
  )
    throw new FileError("BAD_ENCODING", "Độ dài dữ liệu mã hóa không hợp lệ.");
  return bytes;
}
export const fileAAD = (id, part) =>
  utf8.encode(`secure-share:v1:${validId(id)}:${part}`);

export function safeFilename(name) {
  let value = name
    .split(/[/\\]/)
    .pop()
    .replace(/[<>:"|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 180);
  if (!value || value === "." || value === "..") value = "tep-da-giai-ma";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
    value = "_" + value;
  return value;
}

function validateMetadata(value) {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 255 ||
    typeof value.mimeType !== "string" ||
    value.mimeType.length > 255 ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > MAX_FILE_BYTES
  )
    throw new FileError(
      "BAD_METADATA",
      "Metadata của tệp không đúng định dạng.",
    );
  return { name: value.name, mimeType: value.mimeType, size: value.size };
}
function validateEnvelope(value) {
  validId(value?.id);
  validId(value?.key_id);
  if (
    value.protocol_version !== 1 ||
    !Number.isSafeInteger(value.ciphertext_size) ||
    value.ciphertext_size < 16 ||
    value.ciphertext_size > MAX_CIPHERTEXT_BYTES
  )
    throw new FileError(
      "BAD_PROTOCOL",
      "Tệp chưa đúng phiên bản hoặc vượt giới hạn dung lượng.",
    );
  const contentIV = fromBase64(value.content_iv_base64, { length: 12 });
  const metadataIV = fromBase64(value.metadata_iv_base64, { length: 12 });
  if (contentIV.every((n, i) => n === metadataIV[i]))
    throw new FileError("BAD_IV", "IV nội dung và metadata phải khác nhau.");
  const metadata = fromBase64(value.encrypted_metadata_base64, { max: 4096 });
  if (metadata.length < 16)
    throw new FileError("BAD_METADATA", "Metadata mã hóa thiếu tag xác thực.");
  return {
    contentIV,
    metadataIV,
    metadata,
    wrapped: fromBase64(value.wrapped_aes_key_base64, { length: 256 }),
  };
}

export function createFileCrypto({ getKeyPair }) {
  async function open(value, { userId, signal, extractable = false }) {
    abortIfNeeded(signal);
    const encoded = validateEnvelope(value);
    const pair = await getKeyPair(userId, value.key_id, { signal });
    let key, metadata;
    try {
      key = await unwrapAesKey(encoded.wrapped, pair.privateKey, extractable);
      const plain = await decryptBytes(
        encoded.metadata,
        key,
        encoded.metadataIV,
        fileAAD(value.id, "metadata"),
      );
      metadata = validateMetadata(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
      );
      if (metadata.size + 16 !== value.ciphertext_size)
        throw new FileError(
          "BAD_SIZE",
          "Kích thước tệp không khớp metadata đã xác thực.",
        );
    } catch (error) {
      if (error instanceof FileError) throw error;
      throw new FileError(
        "DECRYPT_FAILED",
        "Không xác thực được tệp. Khóa không đúng hoặc dữ liệu đã bị thay đổi.",
      );
    }
    abortIfNeeded(signal);
    return { ...encoded, key, metadata };
  }

  return {
    async readMetadata(value, options) {
      return (await open(value, options)).metadata;
    },
    async prepareUpload(file, { profile, signal } = {}) {
      abortIfNeeded(signal);
      if (
        !file ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_BYTES
      )
        throw new FileError("TOO_LARGE", "Mỗi tệp tối đa 25 MiB.");
      const current = profile?.current_key;
      if (!current)
        throw new FileError(
          "KEY_MISSING",
          "Hãy tạo khóa trên thiết bị trước khi tải tệp lên.",
        );
      validId(profile.id);
      validId(current.key_id);
      const metadata = validateMetadata({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });
      const metadataBytes = utf8.encode(JSON.stringify(metadata));
      if (metadataBytes.length + 16 > 4096)
        throw new FileError("BAD_METADATA", "Thông tin tên tệp quá dài.");
      const pair = await getKeyPair(profile.id, current.key_id, { signal });
      if (!pair.publicKey)
        throw new FileError(
          "KEY_MISSING",
          "Kho khóa thiết bị chưa có public key để đối chiếu.",
        );
      const publicKey = await importPublicKey(current.public_key_jwk);
      if (
        publicKey.algorithm.modulusLength !== 2048 ||
        toBase64(publicKey.algorithm.publicExponent) !== "AQAB"
      )
        throw new FileError(
          "KEY_INVALID",
          "Public key phải là RSA 2048 với exponent 65537.",
        );
      const remoteFingerprint = await sha256Hex(
        await crypto.subtle.exportKey("spki", publicKey),
      );
      const localFingerprint = await sha256Hex(
        await crypto.subtle.exportKey("spki", pair.publicKey),
      );
      if (
        remoteFingerprint !== current.fingerprint_sha256 ||
        localFingerprint !== remoteFingerprint
      )
        throw new FileError(
          "KEY_CHANGED",
          "Khóa trên máy chủ không khớp khóa của thiết bị. Dừng tải lên để kiểm tra khóa.",
        );
      const id = crypto.randomUUID();
      const plaintext = await file.arrayBuffer();
      if (plaintext.byteLength !== file.size)
        throw new FileError("BAD_SIZE", "Không đọc được đầy đủ tệp đã chọn.");
      abortIfNeeded(signal);
      const payload = await encryptBytes(plaintext, fileAAD(id, "content"));
      let metadataIV;
      do {
        metadataIV = crypto.getRandomValues(new Uint8Array(12));
      } while (metadataIV.every((n, i) => n === payload.iv[i]));
      const encryptedMetadata = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: metadataIV,
          additionalData: fileAAD(id, "metadata"),
          tagLength: 128,
        },
        payload.key,
        metadataBytes,
      );
      const wrapped = await wrapAesKey(payload.key, publicKey);
      abortIfNeeded(signal);
      return {
        manifest: {
          file_id: id,
          protocol_version: 1,
          content_iv_base64: toBase64(payload.iv),
          metadata_iv_base64: toBase64(metadataIV),
          encrypted_metadata_base64: toBase64(encryptedMetadata),
          owner_key_id: current.key_id,
          owner_wrapped_aes_key_base64: toBase64(wrapped),
        },
        ciphertext: new Blob([payload.ciphertext], {
          type: "application/octet-stream",
        }),
      };
    },
    async prepareShare(envelope, recipientKey, { userId, signal } = {}) {
      abortIfNeeded(signal);
      if (!recipientKey?.public_key_jwk)
        throw new FileError(
          "KEY_MISSING",
          "Người nhận chưa đăng ký khóa mã hóa.",
        );
      const opened = await open(envelope, {
        userId,
        signal,
        extractable: true,
      });
      const publicKey = await importPublicKey(recipientKey.public_key_jwk);
      if (
        publicKey.algorithm.modulusLength !== 2048 ||
        toBase64(publicKey.algorithm.publicExponent) !== "AQAB"
      )
        throw new FileError(
          "KEY_INVALID",
          "Public key người nhận phải là RSA 2048 với exponent 65537.",
        );
      if (!/^[0-9a-f]{64}$/.test(recipientKey.fingerprint_sha256 || ""))
        throw new FileError(
          "KEY_INVALID",
          "Fingerprint public key người nhận không hợp lệ.",
        );
      const fingerprint = await sha256Hex(
        await crypto.subtle.exportKey("spki", publicKey),
      );
      if (fingerprint !== recipientKey.fingerprint_sha256)
        throw new FileError(
          "KEY_CHANGED",
          "Public key người nhận không khớp fingerprint từ máy chủ.",
        );
      const wrapped = await wrapAesKey(opened.key, publicKey);
      abortIfNeeded(signal);
      return {
        key_id: recipientKey.key_id,
        verified_fingerprint_sha256: fingerprint,
        wrapped_aes_key_base64: toBase64(wrapped),
      };
    },
    async restoreDownload(value, bytes, options) {
      const opened = await open(value, options);
      if (
        bytes.byteLength !== value.ciphertext_size ||
        !/^[0-9a-f]{64}$/.test(value.ciphertext_sha256 || "") ||
        (await sha256Hex(bytes)) !== value.ciphertext_sha256
      )
        throw new FileError(
          "HASH_MISMATCH",
          "Dữ liệu tải xuống không đầy đủ hoặc đã bị thay đổi.",
        );
      let plain;
      try {
        plain = await decryptBytes(
          bytes,
          opened.key,
          opened.contentIV,
          fileAAD(value.id, "content"),
        );
      } catch {
        throw new FileError(
          "DECRYPT_FAILED",
          "Tệp không vượt qua xác thực AES-GCM. Không tạo bản tải xuống.",
        );
      }
      abortIfNeeded(options.signal);
      if (plain.byteLength !== opened.metadata.size)
        throw new FileError("BAD_SIZE", "Kích thước tệp giải mã không khớp.");
      return {
        filename: safeFilename(opened.metadata.name),
        blob: new Blob([plain], { type: "application/octet-stream" }),
      };
    },
  };
}
