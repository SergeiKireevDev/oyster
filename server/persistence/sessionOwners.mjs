function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function requireSessionId(value) {
  if (typeof value !== "string" || !value || value !== value.trim()
      || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new TypeError("session id must be a trimmed string of 1–256 characters without control characters");
  }
  return value;
}

function requireTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("session owner timestamp must be a non-empty string");
  }
  return value;
}

function requireOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isInteger(value.id) || value.id < 1) {
    throw new TypeError("session owner repository must return an owner with a positive integer id");
  }
  return value;
}

/** Resolve backend-neutral session identities and upsert their app-local owner. */
export function createSessionOwnerResolver({
  appStore,
  sessionReferences,
  sessionCatalog,
  runners = () => [],
  now = () => new Date().toISOString(),
} = {}) {
  const upsert = appStore?.repositories?.sessions?.upsert;
  requireFunction(upsert, "session owner repository upsert");
  requireFunction(sessionReferences?.validate, "session reference validator");
  requireFunction(sessionCatalog?.findById, "session catalog findById");
  if (typeof sessionCatalog.backend !== "string" || !sessionCatalog.backend) {
    throw new TypeError("session catalog backend must be a non-empty string");
  }
  requireFunction(runners, "session runner provider");
  requireFunction(now, "session owner clock");

  async function referenceFromId(id) {
    const activeRunners = runners();
    if (activeRunners == null || typeof activeRunners[Symbol.iterator] !== "function") {
      throw new TypeError("session runner provider must return an iterable");
    }
    for (const runner of activeRunners) {
      if (!runner || typeof runner !== "object") {
        throw new TypeError("session runner provider entries must be objects");
      }
      if (runner.sessionId === id && runner.sessionRef) return runner.sessionRef;
    }

    const summary = await sessionCatalog.findById(id);
    if (summary == null) throw new Error(`cannot own resources for unknown session ${id}`);
    if (typeof summary !== "object" || Array.isArray(summary)) {
      throw new TypeError("session catalog findById must return an object or null");
    }
    return {
      backend: sessionCatalog.backend,
      id,
      storagePath: summary.storagePath ?? summary.path ?? sessionReferences.sqlitePath,
    };
  }

  return async function ensureSessionOwner(session) {
    const requestedId = typeof session === "string" ? requireSessionId(session) : null;
    const reference = requestedId === null ? session : await referenceFromId(requestedId);
    const valid = sessionReferences.validate(reference);
    if (!valid || typeof valid !== "object" || Array.isArray(valid) || typeof valid.then === "function") {
      throw new TypeError("session reference validator must synchronously return an object");
    }
    if (requestedId !== null && valid.id !== requestedId) {
      throw new Error(`resolved session reference does not match requested session ${requestedId}`);
    }
    const owner = await upsert.call(appStore.repositories.sessions, {
      backend: valid.backend,
      sessionId: valid.id,
      storagePath: valid.storagePath,
      createdAt: requireTimestamp(now()),
    });
    return requireOwner(owner);
  };
}
