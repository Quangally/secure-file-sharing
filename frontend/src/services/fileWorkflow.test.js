// @vitest-environment node
// HTTP boundary test with real Web Crypto. The API transport is a test double,
// not a claim that Phuc/Vu's backend exists.
import { expect, it } from "vitest";
import { createFileApi } from "./fileApi.js";
import { createFileManager } from "./fileManager.js";
import { createFileCrypto } from "../crypto/fileCrypto.js";
import { generateKeyPair, exportPublicKey } from "../crypto/rsa.js";
import { sha256Hex } from "../crypto/hash.js";

it("runs me → encrypt/multipart upload → list/decrypt metadata → download/decrypt → delete", async () => {
  const pair = await generateKeyPair();
  const profile = {
    id: "10000000-0000-4000-8000-000000000001",
    full_name: "Test User",
    csrf_token: "test-csrf",
    current_key: {
      key_id: "20000000-0000-4000-8000-000000000001",
      public_key_jwk: await exportPublicKey(pair.publicKey),
      fingerprint_sha256: await sha256Hex(
        await crypto.subtle.exportKey("spki", pair.publicKey),
      ),
    },
  };
  let record = null,
    bytes = null,
    deleted = false;
  const json = (data) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  const fetchImpl = async (url, options) => {
    expect(options.credentials).toBe("include");
    if (url === "/api/me") return json(profile);
    if (url.startsWith("/api/files?"))
      return json({
        items: deleted ? [] : [record],
        total: deleted ? 0 : 1,
        page: 1,
        page_size: 20,
      });
    if (url === "/api/files/shared-with-me")
      return json({
        items: deleted ? [] : [record],
        total: deleted ? 0 : 1,
        page: 1,
        page_size: 20,
      });
    if (url.endsWith("/envelope")) return json(record);
    if (url.endsWith("/content")) return new Response(bytes);
    if (options.method === "DELETE") {
      expect(options.headers["X-CSRF-Token"]).toBe("test-csrf");
      deleted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected request");
  };
  const xhrFactory = () => ({
    upload: {},
    open() {},
    setRequestHeader() {},
    getResponseHeader: () => "application/json",
    async send(form) {
      const manifest = JSON.parse(form.get("manifest"));
      expect([...form.keys()]).toEqual(["ciphertext", "manifest"]);
      expect(form.get("ciphertext").name).toBe(manifest.file_id + ".bin");
      expect(JSON.stringify(manifest)).not.toContain("secret-file.txt");
      bytes = new Uint8Array(await form.get("ciphertext").arrayBuffer());
      record = {
        id: manifest.file_id,
        key_id: manifest.owner_key_id,
        protocol_version: 1,
        content_iv_base64: manifest.content_iv_base64,
        metadata_iv_base64: manifest.metadata_iv_base64,
        encrypted_metadata_base64: manifest.encrypted_metadata_base64,
        wrapped_aes_key_base64: manifest.owner_wrapped_aes_key_base64,
        ciphertext_size: bytes.length,
        ciphertext_sha256: await sha256Hex(bytes),
        share_count: 0,
        updated_at: new Date().toISOString(),
      };
      this.status = 201;
      this.responseText = JSON.stringify({ id: record.id });
      this.onload();
    },
  });
  const api = createFileApi({ fetchImpl, xhrFactory });
  const manager = createFileManager({
    api,
    fileCrypto: createFileCrypto({
      getKeyPair: async (userId, keyId) => {
        expect(userId).toBe(profile.id);
        expect(keyId).toBe(profile.current_key.key_id);
        return pair;
      },
    }),
  });
  const current = await api.me();
  await manager.upload(
    new File(["bytes of a private document"], "secret-file.txt"),
    current,
  );
  const list = await manager.list(current);
  expect(list.items[0].name).toBe("secret-file.txt");
  const shared = await manager.listShared(current);
  expect(shared.items[0].name).toBe("secret-file.txt");
  const output = await manager.download(record.id, current);
  expect(await output.blob.text()).toBe("bytes of a private document");
  await manager.remove(record.id);
  expect((await manager.list(current)).items).toEqual([]);
});
