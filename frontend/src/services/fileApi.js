import { FileError, abortIfNeeded, httpError } from "./errors.js";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CIPHERTEXT_BYTES = MAX_FILE_BYTES + 16;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validId(id) {
  if (!uuid.test(id))
    throw new FileError("INVALID_ID", "Mã tệp hoặc mã khóa không hợp lệ.");
  return id;
}

export function createFileApi({
  baseUrl = "/api",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  xhrFactory = () => new XMLHttpRequest(),
  timeoutMs = 120000,
} = {}) {
  const base = baseUrl.replace(/\/$/, "");
  let csrfToken = "";
  function mutationHeaders() {
    if (!csrfToken)
      throw new FileError(
        "MISSING_CSRF",
        "Hãy đăng nhập lại trước khi thay đổi dữ liệu.",
      );
    return { "X-CSRF-Token": csrfToken };
  }
  async function request(
    path,
    { signal, method = "GET", responseType = "json", onProgress } = {},
  ) {
    abortIfNeeded(signal);
    const controller = new AbortController();
    let timedOut = false;
    const relay = () => controller.abort();
    signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(base + path, {
        method,
        credentials: "include",
        signal: controller.signal,
        redirect: "error",
        headers: {
          Accept:
            responseType === "binary"
              ? "application/octet-stream"
              : "application/json",
          ...(method === "GET" ? {} : mutationHeaders()),
        },
      });
      if (!response.ok) throw httpError(response.status);
      if (responseType === "binary") {
        const declared = Number(response.headers.get("content-length"));
        if (declared > MAX_CIPHERTEXT_BYTES)
          throw new FileError("TOO_LARGE", "Tệp vượt quá giới hạn 25 MiB.");
        if (!response.body?.getReader) {
          const data = new Uint8Array(await response.arrayBuffer());
          if (data.byteLength > MAX_CIPHERTEXT_BYTES)
            throw new FileError("TOO_LARGE", "Tệp vượt quá giới hạn 25 MiB.");
          return data;
        }
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          while (true) {
            abortIfNeeded(signal);
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_CIPHERTEXT_BYTES)
              throw new FileError("TOO_LARGE", "Tệp vượt quá giới hạn 25 MiB.");
            chunks.push(value);
            onProgress?.(
              declared > 0
                ? Math.min(99, Math.round((size / declared) * 100))
                : null,
            );
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          result.set(part, offset);
          offset += part.byteLength;
        }
        return result;
      }
      if (response.status === 204) return null;
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new FileError(
          "BAD_RESPONSE",
          "API chưa trả dữ liệu JSON đúng định dạng.",
        );
      let result;
      try {
        result = await response.json();
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new FileError("BAD_RESPONSE", "Dữ liệu API không hợp lệ.");
      }
      abortIfNeeded(signal);
      return result;
    } catch (error) {
      if (timedOut)
        throw new FileError(
          "TIMEOUT",
          "Kết nối quá thời gian chờ. Vui lòng thử lại.",
        );
      if (error instanceof FileError || error?.name === "AbortError")
        throw error;
      throw new FileError(
        "NETWORK",
        "Không kết nối được máy chủ. Kiểm tra backend và kết nối mạng.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relay);
    }
  }

  return {
    // A parent session provider may set the CSRF value after Phuc's login flow.
    setCsrfToken(value) {
      csrfToken = typeof value === "string" ? value : "";
    },
    async me(options) {
      const profile = await request("/me", options);
      if (
        !profile ||
        !uuid.test(profile.id) ||
        typeof profile.full_name !== "string"
      )
        throw new FileError(
          "BAD_RESPONSE",
          "Thông tin tài khoản từ API chưa hợp lệ.",
        );
      csrfToken =
        typeof profile.csrf_token === "string" ? profile.csrf_token : "";
      return profile;
    },
    async list({ page = 1, pageSize = 20, signal } = {}) {
      const result = await request(
        `/files?page=${page}&page_size=${pageSize}`,
        { signal },
      );
      if (
        !result ||
        !Array.isArray(result.items) ||
        result.items.length > pageSize ||
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        result.page !== page ||
        result.page_size !== pageSize
      ) {
        throw new FileError(
          "BAD_RESPONSE",
          "Danh sách tệp từ API chưa đúng contract.",
        );
      }
      return result;
    },
    envelope(id, options) {
      return request(`/files/${validId(id)}/envelope`, options);
    },
    content(id, options) {
      return request(`/files/${validId(id)}/content`, {
        ...options,
        responseType: "binary",
      });
    },
    remove(id, options) {
      return request(`/files/${validId(id)}`, { ...options, method: "DELETE" });
    },
    upload(manifest, ciphertext, { signal, onProgress } = {}) {
      abortIfNeeded(signal);
      const headers = mutationHeaders();
      validId(manifest.file_id);
      if (
        !(ciphertext instanceof Blob) ||
        ciphertext.size > MAX_CIPHERTEXT_BYTES
      )
        throw new FileError(
          "TOO_LARGE",
          "Payload tải lên không hợp lệ hoặc quá 25 MiB.",
        );
      return new Promise((resolve, reject) => {
        const xhr = xhrFactory();
        const abort = () => xhr.abort();
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const finish = (callback) => (value) => {
          cleanup();
          callback(value);
        };
        xhr.open("POST", base + "/files");
        xhr.withCredentials = true;
        xhr.timeout = timeoutMs;
        xhr.setRequestHeader("Accept", "application/json");
        Object.entries(headers).forEach(([key, value]) =>
          xhr.setRequestHeader(key, value),
        );
        xhr.upload.onprogress = (event) =>
          onProgress?.(
            event.lengthComputable
              ? Math.min(99, Math.round((event.loaded / event.total) * 100))
              : null,
          );
        xhr.onerror = finish(() =>
          reject(
            new FileError(
              "NETWORK",
              "Mất kết nối trong khi tải tệp. Hãy tải lại danh sách trước khi thử lại.",
            ),
          ),
        );
        xhr.ontimeout = finish(() =>
          reject(
            new FileError(
              "TIMEOUT",
              "Tải tệp quá thời gian chờ. Hãy tải lại danh sách để kiểm tra kết quả.",
            ),
          ),
        );
        xhr.onabort = finish(() =>
          reject(new DOMException("Đã hủy.", "AbortError")),
        );
        xhr.onload = finish(() => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(httpError(xhr.status));
            return;
          }
          try {
            if (
              !xhr
                .getResponseHeader("content-type")
                ?.includes("application/json")
            )
              throw new Error();
            const body = JSON.parse(xhr.responseText);
            if (body.id !== manifest.file_id) throw new Error();
            onProgress?.(100);
            resolve(body);
          } catch {
            reject(
              new FileError(
                "BAD_RESPONSE",
                "Máy chủ chưa xác nhận đúng tệp vừa tải. Hãy tải lại danh sách.",
              ),
            );
          }
        });
        const data = new FormData();
        // The transport filename is deliberately an ID, never the original name.
        data.append("ciphertext", ciphertext, manifest.file_id + ".bin");
        data.append("manifest", JSON.stringify(manifest));
        signal?.addEventListener("abort", abort, { once: true });
        try {
          abortIfNeeded(signal);
          xhr.send(data);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
  };
}
