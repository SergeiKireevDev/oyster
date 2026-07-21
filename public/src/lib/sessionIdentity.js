/** Canonical browser identity for persisted sessions, with JSONL compatibility. */
export function sessionIdentity(value) {
  if (typeof value === "string") return value || null;
  return value?.sessionKey ?? value?.path ?? null;
}

export function runnerSessionIdentity(runner) {
  return runner?.sessionKey ?? runner?.sessionFile ?? null;
}

export function parentSessionIdentity(session) {
  return session?.parentSessionKey ?? session?.parentSession ?? null;
}

export function sameSession(left, right) {
  const a = sessionIdentity(left);
  const b = sessionIdentity(right);
  return !!a && a === b;
}

export function sessionOpenSelection(value) {
  const identity = sessionIdentity(value);
  if (!identity) return {};
  return identity.startsWith("ps1_") ? { sessionKey: identity } : { sessionPath: identity };
}

/** Query accepted by durable-session endpoints; old file links remain valid. */
export function sessionIdentityQuery(value) {
  const { sessionKey, sessionPath } = sessionOpenSelection(value);
  if (sessionKey) return `key=${encodeURIComponent(sessionKey)}`;
  const raw = String(sessionPath ?? "");
  const marker = "/.pi/agent/sessions/";
  const index = raw.indexOf(marker);
  const relative = index !== -1 ? raw.slice(index + marker.length) : raw.replace(/^\/+/, "");
  return `path=${encodeURIComponent(relative)}`;
}
