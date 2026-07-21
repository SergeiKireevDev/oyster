/**
 * pi-lot-ui — checkpoints, rollback forks and git plumbing
 *
 * A checkpoint = one commit of every pending workdir change, anchored to the
 * session message it was taken at. Records live in ~/.pi/agent/checkpoints.json
 * ({ sessionId: [{ hash, anchorId, leafId, dir, sessionPath, … }] }) so they
 * survive restarts. Rolling back restores the workdir to the commit
 * (deterministically — no LLM involved) and opens a forked session whose
 * history ends at the checkpointed entry.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// same cache-busted instance app.mjs uses (identical ?v= -> shared module)
const SESSIONS_MOD_PATH = join(dirname(fileURLToPath(import.meta.url)), "sessions.mjs");
const { readSessionHeaderInfo, sessionCatalog: defaultSessionCatalog } =
  await import(`./sessions.mjs?v=${statSync(SESSIONS_MOD_PATH).mtimeMs}`);

const CHECKPOINTS_PATH = join(homedir(), ".pi", "agent", "checkpoints.json");

// NOTE: every load→modify→save of this store is synchronous (no await in
// between), so Node's single thread already serializes mutations. The
// failure modes to defend against are a crash mid-write (→ write tmp +
// atomic rename) and a corrupt file being silently read as {} and then
// overwritten on the next save (→ set the corrupt file aside, loudly).
export function loadLegacyCheckpoints() {
  if (!existsSync(CHECKPOINTS_PATH)) return {};
  try { return JSON.parse(readFileSync(CHECKPOINTS_PATH, "utf8")); }
  catch (e) {
    const backup = `${CHECKPOINTS_PATH}.corrupt-${Date.now()}`;
    try { renameSync(CHECKPOINTS_PATH, backup); } catch {}
    console.error(`[pi-ui] checkpoints.json is corrupt (${e.message}) — set aside as ${backup}`);
    return {};
  }
}

export function saveLegacyCheckpoints(db) {
  try {
    const tmp = `${CHECKPOINTS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, CHECKPOINTS_PATH);
  } catch (e) {
    console.error(`[pi-ui] failed to save checkpoints: ${e.message}`);
  }
}

/** Delete only records owned by one session; fork and ancestor keys are independent. */
export function deleteLegacySessionCheckpoints(sessionId) {
  if (!sessionId) return 0;
  const db = loadLegacyCheckpoints();
  const count = Array.isArray(db[sessionId]) ? db[sessionId].length : 0;
  if (!Object.hasOwn(db, sessionId)) return 0;
  delete db[sessionId];
  saveLegacyCheckpoints(db);
  return count;
}

function checkpointContext(input, options = {}) {
  const catalog = options.catalog ?? defaultSessionCatalog;
  if (typeof input === "string") {
    const header = readSessionHeaderInfo(input);
    return { catalog, reference: { backend: "jsonl", id: header.id, storagePath: input }, identity: input };
  }
  const reference = input;
  return { catalog, reference, identity: reference.backend === "sqlite" ? reference.id : reference.storagePath };
}

/** Anchor a commit to the current backend-neutral session tip. */
export function recordCheckpoint(session, dir, { hash, message }, options = {}) {
  const { catalog, reference, identity } = checkpointContext(session, options);
  const { sessionId, leafId, entries } = catalog.entries(identity);
  const anchorId = entries[entries.length - 1]?.id ?? null;
  if (!sessionId || !anchorId || !hash) return null;
  const checkpoint = {
    hash, anchorId, leafId, dir,
    sessionRef: reference,
    ...(reference.backend === "jsonl" ? { sessionPath: reference.storagePath } : {}),
    message: message ?? null,
    timestamp: new Date().toISOString(),
  };
  if (options.repository) return options.repository.record(reference, checkpoint);
  const load = options.loadCheckpoints ?? loadLegacyCheckpoints;
  const save = options.saveCheckpoints ?? saveLegacyCheckpoints;
  const db = load();
  const list = (db[sessionId] ??= []);
  const existing = list.find((item) => item.hash === hash && item.anchorId === anchorId);
  if (existing) return existing;
  list.push(checkpoint);
  save(db);
  return checkpoint;
}

/** Build a checkpoint family from catalog lineage rather than directory scans. */
export function checkpointTree(session, options = {}) {
  const { catalog, reference, identity } = checkpointContext(session, options);
  const target = catalog.readHeader(identity);
  if (!target) throw new Error("session not found");
  const summaries = catalog.backend === "sqlite"
    ? catalog.list({ cwd: target.cwd })
    : catalog.list({ location: dirname(reference.storagePath) });
  const infos = summaries.map((summary) => {
    const header = catalog.backend === "jsonl" ? catalog.readHeader(summary.path) : summary;
    const sessionRef = catalog.backend === "sqlite"
      ? { backend: "sqlite", id: summary.id, storagePath: catalog.storagePath }
      : { backend: "jsonl", id: summary.id, storagePath: summary.path };
    return {
      ...summary,
      ...header,
      id: summary.id,
      sessionRef,
      sessionKey: options.sessionReferences?.serialize(sessionRef) ?? null,
      path: catalog.backend === "jsonl" ? summary.path : null,
      parentId: catalog.backend === "sqlite" ? summary.parentSessionId : null,
    };
  });
  if (catalog.backend === "jsonl") {
    const idByPath = new Map(infos.map((info) => [info.path, info.id]));
    for (const info of infos) info.parentId = idByPath.get(info.parentSession) ?? null;
  }
  const byId = new Map(infos.map((info) => [info.id, info]));
  let root = byId.get(reference.id);
  if (!root) throw new Error("session not found in its family");
  const seen = new Set();
  while (root.parentId && byId.has(root.parentId) && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.parentId);
  }
  const db = options.repository
    ? Object.fromEntries(infos.map((info) => [info.id, options.repository.listForSession(info.sessionRef)]))
    : (options.loadCheckpoints ?? loadLegacyCheckpoints)();
  // forks inherit their ancestors' checkpoint records (so ↩ works inside
  // them), but the tree must not display those twice: each node only shows
  // checkpoints an ancestor hasn't already shown
  const build = (info, depth, shownAbove = new Set()) => {
    const all = db[info.id] ?? [];
    const key = (c) => `${c.hash}@${c.anchorId}`;
    const shown = new Set([...shownAbove, ...all.map(key)]);
    // legacy forks (pre-forkedAtHash headers): the newest record inherited
    // from an ancestor IS the checkpoint the fork was created from
    const inherited = all.filter((c) => shownAbove.has(key(c)));
    const forkedAtHash = info.forkedAtHash
      ?? (inherited.length
        ? inherited.reduce((a, b) => ((a.timestamp ?? "") > (b.timestamp ?? "") ? a : b)).hash
        : null);
    return {
      ...info,
      forkedAtHash,
      checkpoints: all
        .filter((c) => !shownAbove.has(key(c)))
        .map(({ hash, anchorId, message, timestamp }) => ({ hash, anchorId, message, timestamp })),
      children: depth > 25 ? [] : infos
        .filter((candidate) => candidate.parentId === info.id)
        .sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : 1))
        .map((i) => build(i, depth + 1, shown)),
    };
  };
  return { root: build(root, 0) };
}

/** run git in a workdir; resolves with { code, stdout, stderr } (never rejects) */
export function git(dir, args) {
  return new Promise((resolvePromise) => {
    execFile("git", args, { cwd: dir, timeout: 30_000 }, (err, stdout, stderr) => {
      resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Ask a one-shot pi sub-agent (no tools, no session) to summarize a staged
 *  diff into a single commit-message line. Resolves null on any failure so
 *  the caller can fall back to a timestamp message. */
function summarizeDiff(piProcesses, dir, model, diff) {
  return new Promise((resolvePromise) => {
    const prompt =
      "You are writing a git commit message for a checkpoint commit.\n" +
      "Summarize the following diff as ONE concise line: imperative mood, max 72 characters.\n" +
      "Reply with ONLY that line — no quotes, no code fences, no explanation.\n\n" +
      `<diff>\n${diff}\n</diff>`;
    const args = ["--no-session", "--no-tools", "--thinking", "off", "--model", model, "-p", prompt];
    console.log(`[pi-ui] checkpoint summary sub-agent (${model}) for ${dir}`);
    const proc = piProcesses.ephemeral(args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { err += c; });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 60_000);
    timer.unref?.();
    proc.on("error", () => { clearTimeout(timer); resolvePromise(null); });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`[pi-ui] summary sub-agent failed (code=${code}): ${err.trim().split("\n").pop() ?? ""}`);
        resolvePromise(null);
        return;
      }
      // first meaningful line, stripped of quotes/fences, length-capped
      const line = out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("```"))[0] ?? "";
      const clean = line.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
      resolvePromise(clean || null);
    });
  });
}

/** Commit every pending change in `dir` as a checkpoint commit. With a
 *  `model`, the staged diff is summarized into the commit message; `label`
 *  is the fallback message (before the timestamp) when there is no model
 *  or the sub-agent fails. */
export async function checkpointWorkdir(piProcesses, dir, label, model = null) {
  const top = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { status: 400, body: { error: `not a git repository: ${dir}` } };
  const st = await git(dir, ["status", "--porcelain"]);
  if (st.code !== 0) return { status: 500, body: { error: `git status failed: ${st.stderr.trim()}` } };
  const files = st.stdout.split("\n").filter(Boolean).length;
  if (!files) {
    // clean tree: nothing to commit, but HEAD still marks this exact state;
    // carry its subject so the tree can label the checkpoint
    const head = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
    const subject = (await git(dir, ["log", "-1", "--format=%s"])).stdout.trim();
    return { status: 200, body: { committed: false, reason: "workdir is clean", hash: head || undefined, message: subject || undefined } };
  }
  const add = await git(dir, ["add", "-A"]);
  if (add.code !== 0) return { status: 500, body: { error: `git add failed: ${add.stderr.trim()}` } };
  let message = null;
  let summarized = false;
  if (model) {
    const diff = (await git(dir, ["diff", "--cached"])).stdout.slice(0, 40_000);
    if (!piProcesses?.ephemeral) throw new Error("pi process launcher is required for checkpoint summaries");
    const summary = diff.trim() ? await summarizeDiff(piProcesses, dir, model, diff) : null;
    if (summary) { message = `checkpoint: ${summary}`; summarized = true; }
  }
  if (!message && label) message = `checkpoint: ${label}`;
  message ??= `checkpoint ${new Date().toISOString()}`;
  const ci = await git(dir, ["commit", "-m", message]);
  if (ci.code !== 0) {
    return { status: 500, body: { error: `git commit failed: ${(ci.stderr || ci.stdout).trim()}` } };
  }
  const hash = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  console.log(`[pi-ui] checkpoint ${hash} in ${dir} (${files} files): ${message}`);
  return { status: 200, body: { committed: true, hash, message, files, dir, summarized } };
}
