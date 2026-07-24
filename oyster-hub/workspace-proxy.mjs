import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
export const DEFAULT_JSON_BODY_LIMIT = 5 * 1024 * 1024;

export function createUploadLimiter(maxConcurrent) {
  let active = 0;
  return {
    get active() { return active; },
    tryAcquire() {
      if (active >= maxConcurrent) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

function requestHasBody(req) {
  if (BODYLESS_METHODS.has(req.method)) return false;
  if (req.headers["transfer-encoding"]) return true;
  const length = Number(req.headers["content-length"] ?? 0);
  return Number.isFinite(length) && length > 0;
}

export async function readBufferedRequestBody(req, limit = DEFAULT_JSON_BODY_LIMIT) {
  if (BODYLESS_METHODS.has(req.method)) return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`request body exceeds ${limit} bytes`);
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodeDeep(value, scopes, parseScopedValue) {
  if (typeof value === "string") {
    const scoped = parseScopedValue(value);
    if (!scoped) return value;
    scopes.add(scoped.workspaceId);
    return scoped.value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeDeep(item, scopes, parseScopedValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeDeep(item, scopes, parseScopedValue)]));
  }
  return value;
}

export async function prepareScopedWorkspaceRequest(req, url, parseScopedValue, { jsonBodyLimit = DEFAULT_JSON_BODY_LIMIT } = {}) {
  const targetUrl = new URL(url);
  const scopes = new Set();
  for (const [name, value] of [...targetUrl.searchParams.entries()]) {
    const scoped = parseScopedValue(value);
    if (!scoped) continue;
    scopes.add(scoped.workspaceId);
    targetUrl.searchParams.set(name, scoped.value);
  }

  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (requestHasBody(req) && contentType.includes("application/json")) {
    const source = await readBufferedRequestBody(req, jsonBodyLimit);
    let body = source;
    try {
      body = Buffer.from(JSON.stringify(decodeDeep(JSON.parse(source.toString("utf8")), scopes, parseScopedValue)));
    } catch {}
    return { targetUrl, scopes, body, streaming: false, bodyTransformed: !body.equals(source) };
  }
  return { targetUrl, scopes, body: requestHasBody(req) ? req : undefined, streaming: requestHasBody(req), bodyTransformed: false };
}

export function prepareOpaqueWorkspaceRequest(req) {
  const hasBody = requestHasBody(req);
  return { body: hasBody ? req : undefined, streaming: hasBody, bodyTransformed: false };
}

export function workspaceRequestHeaders(req, workspace, { bodyTransformed = false } = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP.has(lower)
      && !["authorization", "x-api-key", "x-auth-token", "x-oyster-workspace", "cookie"].includes(lower)
      && !(bodyTransformed && lower === "content-length")
      && value != null) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  if (workspace.token) headers.set("authorization", `Bearer ${workspace.token}`);
  return headers;
}

export function publicWorkspaceHeaders(response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") headers[name] = value;
  });
  return headers;
}

function timerController(controller) {
  let timer = null;
  return {
    arm(ms, message) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(message)), ms);
      timer.unref?.();
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function monitoredBody(source, { controller, timer, uploadIdleTimeoutMs, uploadResponseTimeoutMs, workspaceId, onBytes }) {
  async function* monitor() {
    let completed = false;
    try {
      for await (const chunk of source) {
        if (controller.signal.aborted) throw controller.signal.reason;
        onBytes?.(chunk.length);
        timer.arm(uploadIdleTimeoutMs, `workspace upload idle for ${uploadIdleTimeoutMs}ms`);
        yield chunk;
      }
      completed = true;
    } finally {
      if (completed && !controller.signal.aborted) {
        timer.arm(uploadResponseTimeoutMs, `workspace ${workspaceId} did not respond within ${uploadResponseTimeoutMs}ms after upload`);
      }
    }
  }
  const body = Readable.from(monitor());
  // Undici may detach from an upload body immediately after its AbortSignal
  // fires. Keep an error consumer attached so the async generator's matching
  // abort cannot become an unhandled stream error and terminate Hub.
  body.on("error", () => {});
  return body;
}

export async function proxyWorkspaceRequest({
  req,
  res,
  target,
  workspace,
  prepared = prepareOpaqueWorkspaceRequest(req),
  fetchImpl = globalThis.fetch,
  timeoutMs,
  uploadIdleTimeoutMs,
  uploadResponseTimeoutMs,
  json,
  transformJson,
  transformStream,
  onTransfer,
  uploadLimiter,
}) {
  const releaseUpload = prepared.streaming && uploadLimiter ? uploadLimiter.tryAcquire() : () => {};
  if (!releaseUpload) {
    req.resume?.();
    json(res, 429, { error: "too many concurrent workspace uploads", workspace: workspace.id });
    return;
  }
  const controller = new AbortController();
  const timer = timerController(controller);
  const startedAt = performance.now();
  let uploadedBytes = 0;
  let downloadedBytes = 0;
  let closeReason = "complete";
  const abortRequest = () => {
    closeReason = "browser-disconnect";
    controller.abort(new Error("browser disconnected during workspace request"));
  };
  const abortResponse = () => {
    if (!res.writableEnded) abortRequest();
  };
  req.once("aborted", abortRequest);
  res.once("close", abortResponse);

  try {
    let body = prepared.body;
    if (prepared.streaming) {
      timer.arm(uploadIdleTimeoutMs, `workspace upload idle for ${uploadIdleTimeoutMs}ms`);
      body = monitoredBody(body, {
        controller,
        timer,
        uploadIdleTimeoutMs,
        uploadResponseTimeoutMs,
        workspaceId: workspace.id,
        onBytes(bytes) { uploadedBytes += bytes; },
      });
    } else {
      uploadedBytes = body?.length ?? 0;
      timer.arm(timeoutMs, `workspace timed out after ${timeoutMs}ms`);
    }

    const response = await fetchImpl(target, {
      method: req.method,
      headers: workspaceRequestHeaders(req, workspace, prepared),
      body,
      ...(prepared.streaming ? { duplex: "half" } : {}),
      redirect: "manual",
      signal: controller.signal,
    });
    timer.clear();
    const headers = publicWorkspaceHeaders(response);
    headers["x-oyster-workspace"] = workspace.id;
    const contentType = response.headers.get("content-type") || "";

    if (transformJson && contentType.includes("application/json")) {
      const value = await response.json().catch(() => null);
      const output = Buffer.from(JSON.stringify(await transformJson(value, response)));
      downloadedBytes += output.length;
      delete headers["content-length"];
      headers["content-length"] = String(output.length);
      res.writeHead(response.status, headers);
      res.end(output);
      return;
    }

    let source = response.body ? Readable.fromWeb(response.body) : null;
    if (source && transformStream) {
      source = await transformStream(source, response);
      delete headers["content-length"];
    }
    res.writeHead(response.status, headers);
    if (!source || req.method === "HEAD") return res.end();
    source.on("data", (chunk) => { downloadedBytes += chunk.length; });
    await pipeline(source, res);
  } catch (error) {
    const detail = controller.signal.aborted && controller.signal.reason instanceof Error
      ? controller.signal.reason.message
      : error.message;
    if (closeReason === "complete") {
      if (detail.includes("upload idle")) closeReason = "upload-idle-timeout";
      else if (detail.includes("after upload")) closeReason = "upload-response-timeout";
      else closeReason = controller.signal.aborted ? "aborted" : "upstream-error";
    }
    if (!res.headersSent) json(res, 502, { error: "workspace request failed", workspace: workspace.id, detail });
    else res.destroy(error);
  } finally {
    timer.clear();
    releaseUpload();
    req.off("aborted", abortRequest);
    res.off("close", abortResponse);
    onTransfer?.({
      workspaceId: workspace.id,
      uploadedBytes,
      downloadedBytes,
      durationMs: Math.round(performance.now() - startedAt),
      closeReason,
    });
  }
}
