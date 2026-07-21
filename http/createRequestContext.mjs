import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
const DEFAULT_RAW_BODY_LIMIT = 100 * 1024 * 1024;
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const AUTH_FAIL_MAX = 20;

const MIME_TYPES = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".wasm", "application/wasm"],
]);

const within = (path, root) => path === root || path.startsWith(`${root}/`);

function collectBody(req, limit, encoding) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const error = new Error("body too large");
        error.code = "body_too_large";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        const body = Buffer.concat(chunks);
        resolvePromise(encoding ? body.toString(encoding) : body);
      }
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

/** Construct stateless request helpers around stable-core-owned state. */
export function createRequestContext(state, { now = Date.now, logger = console } = {}) {
  const { config } = state;
  const tokenBuffer = Buffer.from(config.TOKEN);
  const roots = [...new Set([homedir(), "/tmp", config.PI_DIR].map((path) => resolve(path)))];
  const denied = [
    ...[".ssh", ".gnupg", ".aws", ".netrc", ".git-credentials", ".config/gh"].map((name) => join(homedir(), name)),
    join(config.DIRNAME, ".ui-token"),
  ];

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
      json(res, 400, { error: `invalid JSON: ${error.message}` });
      return undefined;
    }
  }

  function tokenMatches(provided) {
    if (!provided) return false;
    const candidate = Buffer.from(String(provided).trim());
    return candidate.length === tokenBuffer.length && timingSafeEqual(candidate, tokenBuffer);
  }

  function parseCookies(req) {
    const cookies = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const separator = part.indexOf("=");
      if (separator > 0) cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
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
      cookie: parseCookies(req).pi_ui_token,
    };
  }

  function clientIp(req) {
    return req.headers["cf-connecting-ip"]
      || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
      || req.socket.remoteAddress || "?";
  }

  function recentAuthFailures(ip) {
    const failures = (state.authFails ??= new Map());
    const currentTime = now();
    const recent = (failures.get(ip) ?? []).filter((time) => currentTime - time < AUTH_FAIL_WINDOW_MS);
    if (recent.length) failures.set(ip, recent);
    else failures.delete(ip);
    return recent;
  }

  function recordAuthFailure(ip) {
    const recent = recentAuthFailures(ip);
    recent.push(now());
    state.authFails.set(ip, recent);
  }

  function checkAuth(req, url) {
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
      .map(([key, value]) => `${key}=${value ? `${String(value).slice(0, 4)}…(${String(value).length})` : "-"}`)
      .join(" ");
    logger.log(`[auth-fail] ${req.method} ${url.pathname} from ${ip} | ${seen} | ua=${req.headers["user-agent"] ?? "-"}`);
    return "fail";
  }

  function resolveSafePath(path) {
    let real = path;
    try {
      real = realpathSync(path);
    } catch {
      try { real = join(realpathSync(dirname(path)), basename(path)); } catch {}
    }
    if (!roots.some((root) => within(real, root))) return null;
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
