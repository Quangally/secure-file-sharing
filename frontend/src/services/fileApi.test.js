// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createFileApi, MAX_CIPHERTEXT_BYTES } from "./fileApi.js";
const id = "30000000-0000-4000-8000-000000000001";
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
describe("HTTP client", () => {
  it("sends cookies and maps session expiry without leaking response bodies", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("secret debug stack", { status: 401 }));
    const api = createFileApi({ fetchImpl });
    await expect(api.envelope(id)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl.mock.calls[0][1].credentials).toBe("include");
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });
  it("requires CSRF before mutation and sends the supplied value", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = createFileApi({ fetchImpl });
    await expect(api.remove(id)).rejects.toMatchObject({
      code: "MISSING_CSRF",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    api.setCsrfToken("csrf-for-test");
    await api.remove(id);
    expect(fetchImpl.mock.calls[0][1].headers["X-CSRF-Token"]).toBe(
      "csrf-for-test",
    );
  });
  it("checks list shape, rejects HTML and invalid IDs", async () => {
    const api = createFileApi({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          json({ items: [], total: 0, page: 1, page_size: 20 }),
        ),
    });
    expect((await api.list()).total).toBe(0);
    expect(() => api.envelope("../other")).toThrow();
    await expect(
      createFileApi({ fetchImpl: async () => new Response("<html>") }).list(),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
  it("limits actual streamed bytes even if content-length is absent", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_CIPHERTEXT_BYTES + 1));
        controller.close();
      },
    });
    const api = createFileApi({ fetchImpl: async () => new Response(stream) });
    await expect(api.content(id)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("handles timeout and an already cancelled request", async () => {
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const api = createFileApi({ fetchImpl, timeoutMs: 5 });
    await expect(api.envelope(id)).rejects.toMatchObject({ code: "TIMEOUT" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.envelope(id, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("uploads only ciphertext and an encrypted manifest with progress and CSRF", async () => {
    const xhr = {
      upload: {},
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      getResponseHeader: () => "application/json",
      send: vi.fn(function (data) {
        this.body = data;
        this.status = 201;
        this.responseText = JSON.stringify({ id });
        this.upload.onprogress({ lengthComputable: true, loaded: 3, total: 4 });
        this.onload();
      }),
      abort: vi.fn(),
    };
    const api = createFileApi({ xhrFactory: () => xhr });
    api.setCsrfToken("csrf");
    const onProgress = vi.fn();
    await api.upload({ file_id: id }, new Blob(["encrypted"]), { onProgress });
    expect([...xhr.body.keys()]).toEqual(["ciphertext", "manifest"]);
    expect(xhr.body.get("ciphertext").name).toBe(id + ".bin");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-CSRF-Token", "csrf");
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });
  it("cancels an upload and never reports a rejected upload as success", async () => {
    const xhr = {
      upload: {},
      open() {},
      setRequestHeader() {},
      send() {},
      abort() {
        this.onabort();
      },
    };
    const api = createFileApi({ xhrFactory: () => xhr });
    api.setCsrfToken("csrf");
    const controller = new AbortController();
    const promise = api.upload({ file_id: id }, new Blob(["x"]), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    const fail = api.upload({ file_id: id }, new Blob(["x"]));
    xhr.status = 403;
    xhr.onload();
    await expect(fail).rejects.toMatchObject({ status: 403 });
  });
});
