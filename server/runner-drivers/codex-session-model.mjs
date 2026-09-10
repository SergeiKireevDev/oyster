import { closeSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";

function findRollout(directory, sessionId) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(`-${sessionId}.jsonl`)) return join(directory, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = findRollout(join(directory, entry.name), sessionId);
    if (path) return path;
  }
  return null;
}

// exec --json omits the model; Codex records the resolved model in each
// rollout's turn_context. Read only appended bytes, including partial writes.
export function createCodexSessionModelReader(home, sessionId) {
  let path = null;
  let offset = 0;
  let pending = "";
  let model = null;
  let decoder = new StringDecoder("utf8");
  return () => {
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9-]+$/.test(sessionId)) return null;
    path ??= findRollout(join(home, "sessions"), sessionId) ?? findRollout(join(home, "archived_sessions"), sessionId);
    if (!path) return null;
    let fd;
    try {
      fd = openSync(path, "r");
      if (fstatSync(fd).size < offset) { offset = 0; pending = ""; model = null; decoder = new StringDecoder("utf8"); }
      const buffer = Buffer.alloc(64 * 1024);
      let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
        offset += count;
        pending += decoder.write(buffer.subarray(0, count));
        let end;
        while ((end = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            const record = JSON.parse(line);
            if (record.type === "turn_context" && typeof record.payload?.model === "string" && record.payload.model.trim()) model = record.payload.model;
          } catch { /* Ignore malformed records without losing later context. */ }
        }
      }
    } catch { /* Metadata may not exist yet; never interrupt the turn. */ }
    finally { if (fd !== undefined) closeSync(fd); }
    return model;
  };
}
