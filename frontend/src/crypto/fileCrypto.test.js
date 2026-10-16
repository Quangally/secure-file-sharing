// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  createFileCrypto,
  toBase64,
  fromBase64,
  safeFilename,
} from "./fileCrypto.js";
import { generateKeyPair, exportPublicKey } from "./rsa.js";
import { sha256Hex } from "./hash.js";
import { MAX_FILE_BYTES } from "../services/fileApi.js";
const userId = "10000000-0000-4000-8000-000000000001";
const keyId = "20000000-0000-4000-8000-000000000001";
let pair, profile, fileCrypto;
beforeAll(async () => {
  pair = await generateKeyPair();
  profile = {
    id: userId,
    current_key: {
      key_id: keyId,
      public_key_jwk: await exportPublicKey(pair.publicKey),
      fingerprint_sha256: await sha256Hex(
        await crypto.subtle.exportKey("spki", pair.publicKey),
      ),
    },
  };
  fileCrypto = createFileCrypto({ getKeyPair: async () => pair });
});
async function uploaded(
  input = new File(["Báo cáo thử nghiệm"], "báo cáo.txt", {
    type: "text/plain",
  }),
) {
  const payload = await fileCrypto.prepareUpload(input, { profile });
  const bytes = new Uint8Array(await payload.ciphertext.arrayBuffer());
  return {
    payload,
    bytes,
    envelope: {
      id: payload.manifest.file_id,
      key_id: keyId,
      protocol_version: 1,
      content_iv_base64: payload.manifest.content_iv_base64,
      metadata_iv_base64: payload.manifest.metadata_iv_base64,
      encrypted_metadata_base64: payload.manifest.encrypted_metadata_base64,
      wrapped_aes_key_base64: payload.manifest.owner_wrapped_aes_key_base64,
      ciphertext_size: bytes.length,
      ciphertext_sha256: await sha256Hex(bytes),
    },
  };
}
describe("protocol v1", () => {
  it("encrypts name and payload; restores the original bytes and safe filename", async () => {
    const original = new File(["Nội dung bí mật"], "báo cáo.txt", {
      type: "text/plain",
    });
    const { payload, bytes, envelope } = await uploaded(original);
    expect(JSON.stringify(payload.manifest)).not.toContain(original.name);
    expect(new TextDecoder().decode(bytes)).not.toContain("Nội dung");
    expect(payload.manifest.content_iv_base64).not.toBe(
      payload.manifest.metadata_iv_base64,
    );
    expect(
      fromBase64(envelope.wrapped_aes_key_base64, { length: 256 }),
    ).toHaveLength(256);
    expect(await fileCrypto.readMetadata(envelope, { userId })).toEqual({
      name: original.name,
      mimeType: "text/plain",
      size: original.size,
    });
    const output = await fileCrypto.restoreDownload(envelope, bytes, {
      userId,
    });
    expect(output.filename).toBe(original.name);
    expect(await output.blob.text()).toBe("Nội dung bí mật");
  });
  it("round-trips empty and binary files", async () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 128, 1])]) {
      const { envelope, bytes: encrypted } = await uploaded(
        new File([bytes], "binary.bin"),
      );
      const output = await fileCrypto.restoreDownload(envelope, encrypted, {
        userId,
      });
      expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(bytes);
    }
  });
  it("rejects modified ciphertext even when the server hash is replaced", async () => {
    const { envelope, bytes } = await uploaded();
    bytes[0] ^= 1;
    await expect(
      fileCrypto.restoreDownload(envelope, bytes, { userId }),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    envelope.ciphertext_sha256 = await sha256Hex(bytes);
    await expect(
      fileCrypto.restoreDownload(envelope, bytes, { userId }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });
  it("rejects a different file UUID/AAD and metadata edits", async () => {
    const { envelope } = await uploaded();
    await expect(
      fileCrypto.readMetadata(
        { ...envelope, id: crypto.randomUUID() },
        { userId },
      ),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    const changed = fromBase64(envelope.encrypted_metadata_base64);
    changed[0] ^= 1;
    await expect(
      fileCrypto.readMetadata(
        { ...envelope, encrypted_metadata_base64: toBase64(changed) },
        { userId },
      ),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });
  it("rejects the wrong private key and a missing device key", async () => {
    const { envelope } = await uploaded();
    const wrong = await generateKeyPair();
    await expect(
      createFileCrypto({ getKeyPair: async () => wrong }).readMetadata(
        envelope,
        { userId },
      ),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    await expect(
      createFileCrypto({
        getKeyPair: async () => {
          throw new Error("missing");
        },
      }).readMetadata(envelope, { userId }),
    ).rejects.toThrow("missing");
  });
  it("verifies a recipient public key fingerprint before wrapping", async () => {
    const { envelope } = await uploaded();
    const recipient = await generateKeyPair();
    const recipientJwk = await exportPublicKey(recipient.publicKey);
    const fingerprint = await sha256Hex(
      await crypto.subtle.exportKey("spki", recipient.publicKey),
    );
    await expect(
      fileCrypto.prepareShare(
        envelope,
        {
          key_id: crypto.randomUUID(),
          public_key_jwk: recipientJwk,
          fingerprint_sha256: fingerprint,
        },
        { userId },
      ),
    ).resolves.toMatchObject({
      verified_fingerprint_sha256: fingerprint,
    });
    await expect(
      fileCrypto.prepareShare(
        envelope,
        {
          key_id: crypto.randomUUID(),
          public_key_jwk: recipientJwk,
          fingerprint_sha256: "0".repeat(64),
        },
        { userId },
      ),
    ).rejects.toMatchObject({ code: "KEY_CHANGED" });
  });
  it("refuses oversized files, changed own key, malformed encoding and protocol", async () => {
    await expect(
      fileCrypto.prepareUpload({ size: MAX_FILE_BYTES + 1 }, { profile }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(
      fileCrypto.prepareUpload(new File(["x"], "a.txt"), {
        profile: {
          ...profile,
          current_key: {
            ...profile.current_key,
            fingerprint_sha256: "0".repeat(64),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "KEY_CHANGED" });
    const { envelope } = await uploaded();
    await expect(
      fileCrypto.readMetadata({ ...envelope, protocol_version: 2 }, { userId }),
    ).rejects.toMatchObject({ code: "BAD_PROTOCOL" });
    expect(() => fromBase64("not base64")).toThrow();
    expect(() => fromBase64("AB==", { length: 1 })).toThrow();
  });
  it("checks ciphertext length and IV separation", async () => {
    const { envelope, bytes } = await uploaded();
    await expect(
      fileCrypto.restoreDownload(envelope, bytes.subarray(1), { userId }),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    await expect(
      fileCrypto.readMetadata(
        { ...envelope, metadata_iv_base64: envelope.content_iv_base64 },
        { userId },
      ),
    ).rejects.toMatchObject({ code: "BAD_IV" });
  });
  it("does not continue after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fileCrypto.prepareUpload(new File(["x"], "x"), {
        profile,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("sanitizes paths, reserved Windows names and control characters", () => {
    expect(safeFilename("../../CON.txt")).toBe("_CON.txt");
    expect(safeFilename("..\\a\u202E.exe")).toBe("a_.exe");
    expect(safeFilename("...")).toBe("tep-da-giai-ma");
  });
});
