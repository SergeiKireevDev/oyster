import { resolve, relative, isAbsolute } from "node:path";

const KEY_PREFIX = "ps1_";
const BACKENDS = new Set(["jsonl", "sqlite"]);

function confinedTo(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function requireId(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new Error("session reference id must be a non-empty string without control characters");
  }
  return value;
}

/**
 * Build validation and opaque-key operations for one configured session store.
 * Keys are transport identities, not authorization: decoded paths are always
 * revalidated against these configured roots before use.
 */
export function createSessionReferenceCodec({ agentDir, sqlitePath, jsonlRoot } = {}) {
  if (!agentDir) throw new Error("agentDir is required for session references");
  const resolvedAgentDir = resolve(agentDir);
  const resolvedJsonlRoot = resolve(jsonlRoot ?? resolvedAgentDir, jsonlRoot ? "." : "sessions");
  const resolvedSqlitePath = sqlitePath ? resolve(sqlitePath) : resolve(resolvedAgentDir, "sessions.sqlite");

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
    let payload;
    try {
      const encoded = key.slice(KEY_PREFIX.length);
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) throw new Error("non-canonical base64url");
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("invalid session key payload");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("invalid session key payload");
    }
    return validate({ backend: payload.b, id: payload.i, storagePath: payload.p });
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
