import { resolve, relative, isAbsolute } from "node:path";

const KEY_PREFIX = "ps1_";
const BACKENDS = new Set(["jsonl", "sqlite"]);

function requirePathOption(value, name, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty path string`);
  }
  return value;
}

function confinedTo(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function requireId(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error("session reference id must be a trimmed string of 1–256 characters without control characters");
  }
  return value;
}

/**
 * Build validation and opaque-key operations for one configured session store.
 * Keys are transport identities, not authorization: decoded paths are always
 * revalidated against these configured roots before use.
 */
export function createSessionReferenceCodec({ agentDir, sqlitePath, jsonlRoot } = {}) {
  const resolvedAgentDir = resolve(requirePathOption(agentDir, "agentDir"));
  const configuredJsonlRoot = requirePathOption(jsonlRoot, "jsonlRoot", { optional: true });
  const configuredSqlitePath = requirePathOption(sqlitePath, "sqlitePath", { optional: true });
  const resolvedJsonlRoot = configuredJsonlRoot === undefined
    ? resolve(resolvedAgentDir, "sessions")
    : resolve(configuredJsonlRoot);
  const resolvedSqlitePath = configuredSqlitePath === undefined
    ? resolve(resolvedAgentDir, "sessions.sqlite")
    : resolve(configuredSqlitePath);

  function validate(reference) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw new Error("session reference must be an object");
    }
    const backend = reference.backend;
    if (!BACKENDS.has(backend)) throw new Error(`unsupported session reference backend: ${backend ?? "missing"}`);
    const id = requireId(reference.id);
    if (typeof reference.storagePath !== "string" || !reference.storagePath) {
      throw new Error("session reference storagePath is required");
    }
    const storagePath = resolve(reference.storagePath);
    if (backend === "jsonl") {
      if (!storagePath.endsWith(".jsonl") || !confinedTo(storagePath, resolvedJsonlRoot) || storagePath === resolvedJsonlRoot) {
        throw new Error(`JSONL session path must be a .jsonl file under ${resolvedJsonlRoot}`);
      }
    } else if (storagePath !== resolvedSqlitePath) {
      throw new Error(`SQLite session database must be ${resolvedSqlitePath}`);
    }
    return Object.freeze({ backend, id, storagePath });
  }

  function serialize(reference) {
    const valid = validate(reference);
    const payload = JSON.stringify({ b: valid.backend, i: valid.id, p: valid.storagePath });
    return `${KEY_PREFIX}${Buffer.from(payload).toString("base64url")}`;
  }

  function parse(key) {
    if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(key.slice(KEY_PREFIX.length))) {
      throw new Error("invalid session key format");
    }
    try {
      const encoded = key.slice(KEY_PREFIX.length);
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical base64url");
      const text = bytes.toString("utf8");
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid payload shape");

      const reference = validate({ backend: payload.b, id: payload.i, storagePath: payload.p });
      const canonical = JSON.stringify({ b: reference.backend, i: reference.id, p: reference.storagePath });
      if (text !== canonical) throw new Error("non-canonical payload");
      return reference;
    } catch {
      throw new Error("invalid session key payload");
    }
  }

  function equals(left, right) {
    const a = validate(left);
    const b = validate(right);
    return a.backend === b.backend && a.id === b.id && a.storagePath === b.storagePath;
  }

  return Object.freeze({
    agentDir: resolvedAgentDir,
    jsonlRoot: resolvedJsonlRoot,
    sqlitePath: resolvedSqlitePath,
    validate,
    serialize,
    parse,
    equals,
  });
}

/** Adapt opaque and legacy HTTP inputs at the JSONL compatibility boundary. */
export function createSessionRequestResolver({ codec, sessionFileParam, sessionFileFromSearch, readSessionHeaderInfo } = {}) {
  if (!codec || typeof codec.validate !== "function" || typeof codec.parse !== "function") {
    throw new TypeError("codec with validate() and parse() is required");
  }
  for (const [name, dependency] of Object.entries({ sessionFileParam, sessionFileFromSearch, readSessionHeaderInfo })) {
    if (typeof dependency !== "function") throw new TypeError(`${name} must be a function`);
  }

  const referenceFor = ({ id, path }) => codec.validate({ backend: "jsonl", id, storagePath: path });
  const parseKey = (key) => {
    try { return codec.parse(key); } catch { return null; }
  };
  const legacyTargetFromSearch = (url) => {
    try { return sessionFileFromSearch(url); } catch { return null; }
  };
  const referenceForTarget = (target) => {
    if (!target) return null;
    try {
      const info = readSessionHeaderInfo(target);
      return info?.id ? referenceFor({ id: info.id, path: target }) : null;
    } catch {
      return null;
    }
  };
  const targetFromSearch = (url) => {
    let hasKey;
    let key;
    try {
      hasKey = url.searchParams.has("key");
      key = url.searchParams.get("key");
    } catch {
      return null;
    }
    if (!hasKey) return legacyTargetFromSearch(url);
    const reference = parseKey(key);
    if (reference?.backend !== "jsonl") return null;
    try { return sessionFileParam(reference.storagePath); } catch { return null; }
  };
  const referenceFromSearch = (url) => {
    try {
      if (url.searchParams.has("key")) return parseKey(url.searchParams.get("key"));
    } catch {
      return null;
    }
    return referenceForTarget(legacyTargetFromSearch(url));
  };
  const referenceParam = ({ sessionKey, sessionPath } = {}) => {
    if (sessionKey !== undefined && sessionKey !== null) return parseKey(sessionKey);
    let file = null;
    try { file = sessionPath ? sessionFileParam(sessionPath) : null; } catch { return null; }
    return referenceForTarget(file);
  };
  return Object.freeze({ referenceFor, targetFromSearch, referenceFromSearch, referenceParam });
}
