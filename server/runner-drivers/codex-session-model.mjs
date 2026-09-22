import { closeSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
const BYTES_PER_KIBIBYTE = 1024;
const SESSION_MODEL_READ_KIBIBYTES = 64;


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

function codexSessionMetadataFromRecord(record) {
  const provider = record.type === "session_meta" && typeof record.payload?.model_provider === "string"
    ? record.payload.model_provider.trim()
    : "";
  const model = record.type === "turn_context" && typeof record.payload?.model === "string"
    ? record.payload.model.trim()
    : "";
  return { provider, model };
}

function parseCodexRolloutLine(line) {
  try { return codexSessionMetadataFromRecord(JSON.parse(line)); }
  catch { return null; }
}

// exec --json omits the model; Codex records the resolved model in each
// rollout's turn_context. Read only appended bytes, including partial writes.
export function createCodexSessionStateReader(home, sessionId) {
  let path = null;
  let offset = 0;
  let pending = "";
  let model = null;
  let provider = "openai";
  let decoder = new StringDecoder("utf8");
  return () => {
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9-]+$/.test(sessionId)) return null;
    path ??= findRollout(join(home, "sessions"), sessionId) ?? findRollout(join(home, "archived_sessions"), sessionId);
    if (!path) return null;
    let fd;
    try {
      fd = openSync(path, "r");
      if (fstatSync(fd).size < offset) { offset = 0; pending = ""; model = null; decoder = new StringDecoder("utf8"); }
      const buffer = Buffer.alloc(SESSION_MODEL_READ_KIBIBYTES * BYTES_PER_KIBIBYTE);
      let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
        offset += count;
        pending += decoder.write(buffer.subarray(0, count));
        let end;
        while ((end = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          const metadata = parseCodexRolloutLine(line);
          if (metadata?.provider) provider = metadata.provider;
          if (metadata?.model) model = metadata.model;
        }
      }
    } catch { /* Metadata may not exist yet; never interrupt the turn. */ }
    finally { if (fd !== undefined) closeSync(fd); }
    return model ? { model: { provider, id: model } } : null;
  };
}

export function createCodexSessionModelReader(home, sessionId) {
  const readState = createCodexSessionStateReader(home, sessionId);
  return () => readState()?.model.id ?? null;
}
