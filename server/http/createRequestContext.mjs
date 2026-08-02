import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
const DEFAULT_RAW_BODY_LIMIT = 100 * 1024 * 1024;
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const AUTH_FAIL_MAX = 20;
const AUTH_FAIL_MAX_CLIENTS = 10_000;

const MIME_TYPES = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".wasm", "application/wasm"],
]);

function within(path, root) {
  const relationship = relative(root, path);
  return relationship === ""
    || (!isAbsolute(relationship) && relationship !== ".." && !relationship.startsWith(`..${sep}`));
}

/** Resolve symlinks in the existing portion of a path without requiring its leaf to exist. */
function canonicalPath(path) {
  let existing = resolve(path);
  const missing = [];
  while (true) {
    try {
      return resolve(realpathSync(existing), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") return null;
      const parent = dirname(existing);
      if (parent === existing) return null;
      missing.push(basename(existing));
      existing = parent;
    }
  }
}

function collectBody(req, limit, encoding) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    return Promise.reject(new RangeError("body limit must be a non-negative safe integer"));
  }
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const fail = (error, { guardSubsequentError = false } = {}) => {
      cleanup();
      // IncomingMessage commonly emits "error" after "aborted" or while an
      // oversized body is being drained. Keep that follow-up event handled.
      if (guardSubsequentError) req.once("error", () => {});
      reject(error);
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        const error = new Error("body too large");
        error.code = "body_too_large";
        fail(error, { guardSubsequentError: true });
        // Keep draining the request so callers can still send a useful 413 response.
        req.resume?.();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      const body = Buffer.concat(chunks, size);
      resolvePromise(encoding ? body.toString(encoding) : body);
    };
    const onError = (error) => fail(error);
    const onAborted = () => {
      const error = new Error("request aborted");
      error.code = "request_aborted";
      fail(error, { guardSubsequentError: true });
    };

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
  });
}

/** Construct stateless request helpers around stable-core-owned state. */
export function createRequestContext(state, { now = Date.now, logger = console } = {}) {
  const { config } = state;
  const tokenBuffer = Buffer.from(config.TOKEN);
  const roots = [...new Set([homedir(), "/tmp", config.PI_DIR].map(canonicalPath).filter(Boolean))];
  const denied = [
    ...[".ssh", ".gnupg", ".aws", ".netrc", ".git-credentials", ".config/gh"].map((name) => join(homedir(), name)),
    join(config.DIRNAME, ".ui-token"),
  ].map(canonicalPath).filter(Boolean);

  function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  function text(res, status, body, contentType = "text/plain; charset=utf-8") {
    const value = String(body);
    res.writeHead(status, {
      "content-type": contentType,
      "content-length": Buffer.byteLength(value),
    });
    res.end(value);
  }

  const readBody = (req, limit = DEFAULT_BODY_LIMIT) => collectBody(req, limit, "utf8");
  const readRawBody = (req, limit = DEFAULT_RAW_BODY_LIMIT) => collectBody(req, limit);

  async function readJsonBody(req, res) {
    try {
      return JSON.parse(await readBody(req));
    } catch (error) {
      const oversized = error?.code === "body_too_large";
      json(res, oversized ? 413 : 400, {
        error: oversized ? "request body too large" : `invalid JSON: ${error.message}`,
      });
      return undefined;
    }
  }

  function tokenMatches(provided) {
    if (!provided) return false;
    const candidate = Buffer.from(String(provided).trim());
    return candidate.length === tokenBuffer.length && timingSafeEqual(candidate, tokenBuffer);
  }

  function parseCookies(req) {
    const cookies = Object.create(null);
    for (const part of String(req.headers.cookie ?? "").split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;
      try {
        cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        // Ignore malformed cookie values rather than failing the whole request.
      }
    }
    return cookies;
  }

  function authCandidates(req, url) {
    const bearer = req.headers.authorization;
    return {
      query: url.searchParams.get("token"),
      bearer: bearer?.startsWith("Bearer ") ? bearer.slice(7) : bearer,
      xAuthToken: req.headers["x-auth-token"],
      xApiKey: req.headers["x-api-key"],
      cookie: parseCookies(req).oyster_token,
    };
  }

  function clientIp(req) {
    return req.headers["cf-connecting-ip"]
      || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
      || req.socket.remoteAddress || "?";
  }

  function recentAuthFailures(ip, currentTime = now()) {
    const failures = (state.authFails ??= new Map());
    const recent = (failures.get(ip) ?? []).filter((time) => currentTime - time < AUTH_FAIL_WINDOW_MS);
    if (recent.length) failures.set(ip, recent);
    else failures.delete(ip);
    return recent;
  }

  function recordAuthFailure(ip) {
    const currentTime = now();
    const recent = recentAuthFailures(ip, currentTime);
    if (!state.authFails.has(ip) && state.authFails.size >= AUTH_FAIL_MAX_CLIENTS) {
      state.authFails.delete(state.authFails.keys().next().value);
    }
    recent.push(currentTime);
    state.authFails.set(ip, recent);
  }

  function checkAuth(req, url) {
    if (config.UNAUTHENTICATED) return "ok";
    const ip = clientIp(req);
    if (recentAuthFailures(ip).length >= AUTH_FAIL_MAX) return "throttled";
    const candidates = authCandidates(req, url);
    if (req.method !== "GET") candidates.query = null;
    if (Object.values(candidates).some(tokenMatches)) {
      state.authFails?.delete(ip);
      return "ok";
    }
    recordAuthFailure(ip);
    const seen = Object.entries(candidates)
      .map(([key, value]) => `${key}=${value ? `present(${String(value).length})` : "-"}`)
      .join(" ");
    const safeLogValue = (value) => String(value ?? "-").replace(/[\x00-\x1f\x7f]/g, "_");
    logger.log(`[auth-fail] ${safeLogValue(req.method)} ${safeLogValue(url.pathname)} from ${safeLogValue(ip)} | ${seen} | ua=${safeLogValue(req.headers["user-agent"])}`);
    return "fail";
  }

  function resolveSafePath(path) {
    const real = canonicalPath(path);
    if (!real || !roots.some((root) => within(real, root))) return null;
    if (denied.some((blocked) => within(real, blocked))) return null;
    return real;
  }

  return {
    json,
    text,
    readBody,
    readRawBody,
    readJsonBody,
    mimeType: (path) => MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream",
    tokenMatches,
    authCandidates,
    clientIp,
    recentAuthFailures,
    recordAuthFailure,
    checkAuth,
    resolveSafePath,
  };
}
