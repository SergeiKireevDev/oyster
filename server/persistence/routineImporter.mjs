import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const LEGACY_ROUTINES_DIR = join(homedir(), ".pi", "routines");
export const LEGACY_ROUTINE_BINDINGS_PATH = join(LEGACY_ROUTINES_DIR, "bindings.json");

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function callHook(hook, value, name) {
  const result = hook(value);
  if (result && typeof result.then === "function") throw new TypeError(`${name} must be synchronous`);
}

function validateBinding(name, binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error(`cannot import malformed legacy binding for ${name}`);
  }
  if (binding.sessionId != null && (typeof binding.sessionId !== "string" || !binding.sessionId)) {
    throw new Error(`cannot import malformed legacy session binding for ${name}`);
  }
  if (binding.cwd != null && typeof binding.cwd !== "string") {
    throw new Error(`cannot import malformed legacy working directory for ${name}`);
  }
  return Object.freeze({
    ...(binding.sessionId != null ? { sessionId: binding.sessionId } : {}),
    ...(binding.cwd != null ? { cwd: binding.cwd } : {}),
  });
}

function readUtf8(path, description) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read legacy ${description} from ${path}: ${error.message}`, { cause: error });
  }
}

/** Import legacy executable definitions and their bindings without modifying the source files. */
export async function importLegacyRoutines({
  repository,
  resolveOwner,
  sourceDir = LEGACY_ROUTINES_DIR,
  bindingsPath = join(sourceDir, "bindings.json"),
  now = () => new Date().toISOString(),
  apply = true,
  onConflict = () => {},
  onCandidate = () => {},
} = {}) {
  if (!repository || typeof repository.findByName !== "function" || typeof repository.upsert !== "function") {
    throw new TypeError("routine repository with findByName() and upsert() is required");
  }
  requireFunction(resolveOwner, "routine owner resolver");
  requireFunction(now, "now");
  requireFunction(onConflict, "onConflict");
  requireFunction(onCandidate, "onCandidate");
  if (typeof sourceDir !== "string" || !sourceDir.trim()) throw new TypeError("routine sourceDir must be a non-empty string");
  if (typeof bindingsPath !== "string" || !bindingsPath.trim()) throw new TypeError("routine bindingsPath must be a non-empty string");
  if (typeof apply !== "boolean") throw new TypeError("apply must be a boolean");
  if (!existsSync(sourceDir)) {
    return Object.freeze({ sourceDir, sourceCount: 0, importedCount: 0, existingCount: 0, orphanBindingCount: 0, status: "missing" });
  }

  let bindings = {};
  if (existsSync(bindingsPath)) {
    try {
      bindings = JSON.parse(readUtf8(bindingsPath, "routine bindings"));
    } catch (error) {
      if (error.message.startsWith("cannot read legacy routine bindings")) throw error;
      throw new Error(`cannot import legacy routine bindings from ${bindingsPath}: ${error.message}`, { cause: error });
    }
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
      throw new Error(`cannot import legacy routine bindings from ${bindingsPath}: root must be an object`);
    }
  }

  const normalizedBindings = new Map();
  for (const [name, binding] of Object.entries(bindings)) normalizedBindings.set(name, validateBinding(name, binding));

  let entries;
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read legacy routine directory ${sourceDir}: ${error.message}`, { cause: error });
  }
  const resolvedBindingsPath = resolve(bindingsPath);
  const candidates = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = join(sourceDir, entry.name);
    if (entry.name === "bindings.json" || resolve(sourcePath) === resolvedBindingsPath
      || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    let metadata;
    try {
      metadata = statSync(sourcePath);
    } catch (error) {
      throw new Error(`cannot inspect legacy routine ${sourcePath}: ${error.message}`, { cause: error });
    }
    if (!metadata.isFile() || !(metadata.mode & 0o111)) continue;
    const binding = normalizedBindings.get(entry.name) ?? Object.freeze({});
    candidates.push(Object.freeze({
      name: entry.name,
      sourcePath,
      script: readUtf8(sourcePath, "routine definition"),
      binding,
    }));
  }

  const names = new Set(candidates.map((candidate) => candidate.name));
  const orphanBindingCount = [...normalizedBindings.keys()].filter((name) => !names.has(name)).length;
  const inspections = await Promise.all(candidates.map(async (candidate) => {
    const existing = await repository.findByName(candidate.name);
    if (existing != null && (typeof existing !== "object" || Array.isArray(existing))) {
      throw new TypeError("routine repository findByName() must return an object or null");
    }
    let owner = null;
    if (candidate.binding.sessionId) {
      owner = await resolveOwner(candidate.binding.sessionId);
      if (owner != null && (typeof owner !== "object" || Array.isArray(owner))) {
        throw new TypeError("routine owner resolver must return an object or null");
      }
      if (!existing && !owner?.id) {
        throw new Error(`cannot import legacy binding for ${candidate.name}: session owner was not resolved`);
      }
    }
    return { candidate, existing, owner };
  }));

  let existingCount = 0;
  const imports = [];
  // Complete all resolution and observer work before writing, so those failures
  // cannot leave a partially imported source.
  for (const inspection of inspections) {
    const { candidate, existing, owner } = inspection;
    callHook(onCandidate, candidate, "onCandidate");
    if (!existing) {
      imports.push(inspection);
      continue;
    }
    existingCount++;
    if (existing.script !== candidate.script || (existing.cwd ?? null) !== (candidate.binding.cwd ?? null)
      || (existing.session_id ?? null) !== (candidate.binding.sessionId ?? null)
      || (owner?.id != null && (existing.owner_id ?? null) !== owner.id)) {
      callHook(onConflict, Object.freeze({
        key: candidate.name,
        reason: "destination routine definition or binding differs",
      }), "onConflict");
    }
  }

  if (apply) {
    const pendingRows = imports.map(({ candidate, owner }) => {
      const timestamp = now();
      if (typeof timestamp !== "string" || !timestamp) throw new TypeError("now must return a non-empty string");
      return {
        id: randomUUID(),
        ownerId: owner?.id ?? null,
        name: candidate.name,
        script: candidate.script,
        cwd: candidate.binding.cwd ?? null,
        now: timestamp,
      };
    });
    for (const row of pendingRows) await repository.upsert(row);
  }

  return Object.freeze({
    sourceDir,
    sourceCount: candidates.length,
    importedCount: imports.length,
    existingCount,
    orphanBindingCount,
    status: apply ? "imported" : "dry-run",
  });
}
