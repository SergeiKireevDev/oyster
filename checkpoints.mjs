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

import { spawn, execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// same cache-busted instance app.mjs uses (identical ?v= -> shared module)
const SESSIONS_MOD_PATH = join(dirname(fileURLToPath(import.meta.url)), "sessions.mjs");
const { sessionEntries, readSessionHeaderInfo } =
  await import(`./sessions.mjs?v=${statSync(SESSIONS_MOD_PATH).mtimeMs}`);

const CHECKPOINTS_PATH = join(homedir(), ".pi", "agent", "checkpoints.json");

// NOTE: every load→modify→save of this store is synchronous (no await in
// between), so Node's single thread already serializes mutations. The
// failure modes to defend against are a crash mid-write (→ write tmp +
// atomic rename) and a corrupt file being silently read as {} and then
// overwritten on the next save (→ set the corrupt file aside, loudly).
export function loadCheckpoints() {
  if (!existsSync(CHECKPOINTS_PATH)) return {};
  try { return JSON.parse(readFileSync(CHECKPOINTS_PATH, "utf8")); }
  catch (e) {
    const backup = `${CHECKPOINTS_PATH}.corrupt-${Date.now()}`;
    try { renameSync(CHECKPOINTS_PATH, backup); } catch {}
    console.error(`[pi-ui] checkpoints.json is corrupt (${e.message}) — set aside as ${backup}`);
    return {};
  }
}

export function saveCheckpoints(db) {
  try {
    const tmp = `${CHECKPOINTS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, CHECKPOINTS_PATH);
  } catch (e) {
    console.error(`[pi-ui] failed to save checkpoints: ${e.message}`);
  }
}

/** anchor a commit to the session's current tip; returns the record or null */
export function recordCheckpoint(sessionPath, dir, { hash, message }) {
  const { sessionId, leafId, entries } = sessionEntries(sessionPath);
  const anchorId = entries[entries.length - 1]?.id ?? null; // last rendered message
  if (!sessionId || !anchorId || !hash) return null;
  const db = loadCheckpoints();
  const list = (db[sessionId] ??= []);
  let rec = list.find((c) => c.hash === hash && c.anchorId === anchorId);
  if (!rec) {
    rec = { hash, anchorId, leafId, dir, sessionPath, message: message ?? null, timestamp: new Date().toISOString() };
    list.push(rec);
    saveCheckpoints(db);
  }
  return rec;
}

/** The session family of `sessionPath` as a tree: walk parentSession links up
 *  to the root ancestor, then nest every descendant fork, with each session's
 *  checkpoint records attached. */
export function checkpointTree(sessionPath) {
  const dir = dirname(sessionPath);
  const infos = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    try {
      const info = readSessionHeaderInfo(join(dir, f));
      if (info) infos.push(info);
    } catch {}
  }
  const byPath = new Map(infos.map((i) => [i.path, i]));
  let root = byPath.get(sessionPath);
  if (!root) throw new Error("session not found in its folder");
  const seen = new Set();
  while (root.parentSession && byPath.has(root.parentSession) && !seen.has(root.path)) {
    seen.add(root.path);
    root = byPath.get(root.parentSession);
  }
  const db = loadCheckpoints();
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
        .filter((i) => i.parentSession === info.path)
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
function summarizeDiff(piBin, dir, model, diff) {
  return new Promise((resolvePromise) => {
    const prompt =
      "You are writing a git commit message for a checkpoint commit.\n" +
      "Summarize the following diff as ONE concise line: imperative mood, max 72 characters.\n" +
      "Reply with ONLY that line — no quotes, no code fences, no explanation.\n\n" +
      `<diff>\n${diff}\n</diff>`;
    const args = ["--no-session", "--no-tools", "--thinking", "off", "--model", model, "-p", prompt];
    console.log(`[pi-ui] checkpoint summary sub-agent (${model}) for ${dir}`);
    const proc = spawn(piBin, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
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
export async function checkpointWorkdir(piBin, dir, label, model = null) {
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
    const summary = diff.trim() ? await summarizeDiff(piBin, dir, model, diff) : null;
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
