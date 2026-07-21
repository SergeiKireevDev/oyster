import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LEGACY_ROUTINES_DIR = join(homedir(), ".pi", "routines");
export const LEGACY_ROUTINE_BINDINGS_PATH = join(LEGACY_ROUTINES_DIR, "bindings.json");

/** Import legacy executable definitions and their bindings without modifying the source files. */
export function importLegacyRoutines({
  repository,
  resolveOwner,
  sourceDir = LEGACY_ROUTINES_DIR,
  bindingsPath = join(sourceDir, "bindings.json"),
  now = () => new Date().toISOString(),
  apply = true,
  onConflict = () => {},
  onCandidate = () => {},
} = {}) {
  if (!repository) throw new Error("routine repository is required");
  if (typeof resolveOwner !== "function") throw new Error("routine owner resolver is required");
  if (!existsSync(sourceDir)) return Object.freeze({ sourceDir, sourceCount: 0, importedCount: 0, existingCount: 0, orphanBindingCount: 0, status: "missing" });

  let bindings = {};
  if (existsSync(bindingsPath)) {
    try { bindings = JSON.parse(readFileSync(bindingsPath, "utf8")); }
    catch (error) { throw new Error(`cannot import legacy routine bindings from ${bindingsPath}: ${error.message}`, { cause: error }); }
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new Error(`cannot import legacy routine bindings from ${bindingsPath}: root must be an object`);
  }
  for (const [name, binding] of Object.entries(bindings)) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`cannot import malformed legacy binding for ${name}`);
    if (binding.sessionId != null && (typeof binding.sessionId !== "string" || !binding.sessionId)) throw new Error(`cannot import malformed legacy session binding for ${name}`);
    if (binding.cwd != null && typeof binding.cwd !== "string") throw new Error(`cannot import malformed legacy working directory for ${name}`);
  }

  const candidates = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === "bindings.json" || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    const sourcePath = join(sourceDir, entry.name);
    let metadata;
    try { metadata = statSync(sourcePath); } catch { continue; }
    if (!metadata.isFile() || !(metadata.mode & 0o111)) continue;
    const binding = bindings[entry.name] ?? {};
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`cannot import malformed legacy binding for ${entry.name}`);
    if (binding.sessionId != null && (typeof binding.sessionId !== "string" || !binding.sessionId)) throw new Error(`cannot import malformed legacy session binding for ${entry.name}`);
    if (binding.cwd != null && typeof binding.cwd !== "string") throw new Error(`cannot import malformed legacy working directory for ${entry.name}`);
    candidates.push({ name: entry.name, sourcePath, script: readFileSync(sourcePath, "utf8"), binding });
  }

  const names = new Set(candidates.map((candidate) => candidate.name));
  const orphanBindingCount = Object.keys(bindings).filter((name) => !names.has(name)).length;
  let importedCount = 0;
  let existingCount = 0;
  for (const candidate of candidates) {
    onCandidate(candidate);
    const existing = repository.findByName(candidate.name);
    if (existing) {
      existingCount++;
      const owner = candidate.binding.sessionId ? resolveOwner(candidate.binding.sessionId) : null;
      if (existing.script !== candidate.script || (existing.cwd ?? null) !== (candidate.binding.cwd ?? null)
        || (candidate.binding.sessionId ?? null) !== (existing.session_id ?? null)) {
        onConflict({ key: candidate.name, reason: "destination routine definition or binding differs" });
      }
      continue;
    }
    const owner = candidate.binding.sessionId ? resolveOwner(candidate.binding.sessionId) : null;
    if (candidate.binding.sessionId && !owner?.id) throw new Error(`cannot import legacy binding for ${candidate.name}: session owner was not resolved`);
    if (apply) repository.upsert({
      id: randomUUID(),
      ownerId: owner?.id ?? null,
      name: candidate.name,
      script: candidate.script,
      cwd: candidate.binding.cwd ?? null,
      now: now(),
    });
    importedCount++;
  }
  return Object.freeze({
    sourceDir,
    sourceCount: candidates.length,
    importedCount,
    existingCount,
    orphanBindingCount,
    status: apply ? "imported" : "dry-run",
  });
}
