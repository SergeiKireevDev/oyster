import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildIterationPrompt, checkItem, checklistItems, commitMessage, createLoopService, firstUncheckedItem,
  FAILURE_LOG_LIMIT, HANDOFF_LIMIT, MAX_LAUNCH_FAILURES, splitFinalResponse, stepContext,
} from "../server/loops.mjs";
import { createLoopRoutes } from "../server/http/routes/loopRoutes.mjs";

const PLAN = [
  "# Billing rewrite",
  "",
  "Use integer cents everywhere.",
  "",
  "## Phase 1: storage",
  "",
  "Migrations live in db/migrations.",
  "",
  "- [x] Create the invoices table",
  "- [ ] Add the payments table",
  "  Columns: id, invoice_id, amount_cents.",
  "  ```sql",
  "  - [ ] not a step",
  "  ```",
  "- [ ] Backfill payments",
  "",
  "## Phase 2: api",
  "",
  "Handlers return JSON.",
  "",
  "- [ ] Expose GET /payments",
  "",
].join("\n");

test("checklists parse outside code fences and check exactly the selected item", () => {
  const plan = "# Plan\n\n- [x] done\n- [ ] first\n1. [ ] second\n";
  assert.deepEqual(checklistItems(plan).map(({ checked, text }) => ({ checked, text })), [
    { checked: true, text: "done" },
    { checked: false, text: "first" },
    { checked: false, text: "second" },
  ]);
  const target = firstUncheckedItem(plan);
  assert.equal(target.text, "first");
  assert.equal(checkItem(plan, target), "# Plan\n\n- [x] done\n- [x] first\n1. [ ] second\n");
  assert.throws(() => checkItem("- [ ] other\n", { line: 0, text: "first" }), /changed during iteration/);
  assert.deepEqual(checklistItems(PLAN).map((item) => item.text), [
    "Create the invoices table", "Add the payments table", "Backfill payments", "Expose GET /payments",
  ]);
});

test("step context carries the item, its detail, and its enclosing sections only", () => {
  const step = stepContext(PLAN, firstUncheckedItem(PLAN));
  assert.equal(step.index, 2);
  assert.equal(step.total, 4);
  assert.equal(step.done, 1);
  assert.deepEqual(step.trail, ["Billing rewrite", "Phase 1: storage"]);
  assert.equal(step.block, "Add the payments table\nColumns: id, invoice_id, amount_cents.\n```sql\n- [ ] not a step\n```");
  assert.equal(step.notes, "**Billing rewrite**\nUse integer cents everywhere.\n\n**Phase 1: storage**\nMigrations live in db/migrations.");
  assert.equal(step.next, "Backfill payments");

  const wrapped = "- [ ] Normalize mapped addresses,\n      and duplicate headers.\n\n      Return a fallback bucket.\n- [ ] Add proxy tests,\n      for every topology.\n  - nested note\n";
  const first = stepContext(wrapped, firstUncheckedItem(wrapped));
  assert.equal(first.text, "Normalize mapped addresses, and duplicate headers.");
  assert.equal(first.block, "Normalize mapped addresses,\nand duplicate headers.\n\nReturn a fallback bucket.");
  assert.equal(first.next, "Add proxy tests, for every topology.");

  const last = stepContext(PLAN, checklistItems(PLAN).at(-1));
  assert.deepEqual(last.trail, ["Billing rewrite", "Phase 2: api"]);
  assert.match(last.notes, /Handlers return JSON\./);
  assert.doesNotMatch(last.notes, /Migrations live/);
  assert.equal(last.next, null);
});

test("iteration prompt contains the step, never the whole plan", () => {
  const step = stepContext(PLAN, firstUncheckedItem(PLAN));
  const prompt = buildIterationPrompt({ planPath: "/repo/PLAN.md", step });
  assert.match(prompt, /# Step 2 of 4\n\nPlan section: Billing rewrite › Phase 1: storage\n\nAdd the payments table/);
  assert.match(prompt, /Columns: id, invoice_id, amount_cents\./);
  assert.match(prompt, /# Plan notes\n\n\*\*Billing rewrite\*\*\nUse integer cents everywhere\./);
  assert.match(prompt, /The full plan is `\/repo\/PLAN\.md`; 1 of its 4 steps are already done/);
  assert.match(prompt, /The step after this one is “Backfill payments”\. Do not start it\./);
  assert.match(prompt, /do not create, amend, or otherwise modify Git commits/i);
  assert.match(prompt, /`COMMIT MESSAGE:`/);
  // Other steps and other sections stay on disk.
  assert.doesNotMatch(prompt, /Create the invoices table|Expose GET \/payments|Handlers return JSON/);
  assert.doesNotMatch(prompt, /Handoff from the previous iteration|previous attempt/);
});

test("rule sections beside the checklist are sent whole; the checklist never is", () => {
  const files = Array.from({ length: 283 }, (_, index) => `- [ ] A${String(index + 1).padStart(4, "0")} — \`crates/file_${index}.rs\``).join("\n");
  const plan = [
    "# File audit", "", "Audit only the first unchecked file.", "",
    "## Required output", "", "Append one row to results.tsv.", "", "```markdown", "### ANNNN-01 — Short title", "- [ ] not a step", "```", "",
    "## Files", "", files, "",
    "## Other batch", "", "- [ ] B0001 — unrelated", "",
    "### Batch notes", "", "Only for the other batch.", "",
  ].join("\n");
  const item = checklistItems(plan)[92];
  const step = stepContext(plan, item);
  assert.deepEqual(step.trail, ["File audit", "Files"]);
  assert.equal(step.notes, "**File audit**\nAudit only the first unchecked file.\n\n**Required output**\nAppend one row to results.tsv.\n\n```markdown\n### ANNNN-01 — Short title\n- [ ] not a step\n```");
  const prompt = buildIterationPrompt({ planPath: "/audit/plan.md", step });
  assert.match(prompt, /# Step 93 of 284\n\nPlan section: File audit › Files\n\nA0093 — `crates\/file_92\.rs`/);
  assert.match(prompt, /Append one row to results\.tsv\./);
  // Exactly two files are named: this step and the one it must not start.
  assert.deepEqual(prompt.match(/crates\/file_\d+\.rs/g), ["crates/file_92.rs", "crates/file_93.rs"]);
  assert.doesNotMatch(prompt, /B0001|Only for the other batch/);
  assert.ok(Buffer.byteLength(prompt) < 2500);
});

test("iteration prompt size does not grow with the plan", () => {
  const big = `# Plan\n\n${Array.from({ length: 400 }, (_, index) => `- [ ] Step number ${index}\n  Detail for ${index}: ${"x".repeat(200)}`).join("\n")}\n`;
  const small = `# Plan\n\n- [ ] Step number 0\n  Detail for 0: ${"x".repeat(200)}\n- [ ] Step number 1\n  Detail for 1: ${"x".repeat(200)}\n`;
  const promptFor = (plan) => buildIterationPrompt({ planPath: "/p.md", step: stepContext(plan, firstUncheckedItem(plan)) });
  assert.ok(Buffer.byteLength(big) > 80_000);
  assert.ok(Math.abs(promptFor(big).length - promptFor(small).length) < 20);
});

test("follow-up prompts carry a bounded handoff and, after a failure, the log tail", () => {
  const step = stepContext(PLAN, firstUncheckedItem(PLAN));
  const afterSuccess = buildIterationPrompt({ planPath: "/p.md", step, previous: { handoff: "Table created.", succeeded: true } });
  assert.match(afterSuccess, /# Handoff from the previous iteration\n\nTable created\./);
  assert.doesNotMatch(afterSuccess, /previous attempt/);

  const afterFailure = buildIterationPrompt({
    planPath: "/p.md", step, attempt: 3,
    previous: { handoff: "h".repeat(HANDOFF_LIMIT * 3), succeeded: false, failureLog: `${"noise\n".repeat(FAILURE_LOG_LIMIT)}AssertionError: expected 2` },
  });
  assert.match(afterFailure, /# The previous attempt at this step failed \(this is attempt 3\)/);
  assert.match(afterFailure, /fix them instead of starting over/);
  assert.match(afterFailure, /AssertionError: expected 2/);
  assert.ok(Buffer.byteLength(afterFailure) < HANDOFF_LIMIT + FAILURE_LOG_LIMIT + 4096);
});

test("final responses split into a handoff and a normalized commit message", () => {
  assert.deepEqual(splitFinalResponse("Added the table.\n\nCOMMIT MESSAGE:\nAdd payments table\n- Create migration"), {
    handoff: "Added the table.", commit: "Add payments table\n- Create migration",
  });
  assert.deepEqual(splitFinalResponse("Done.\n**Commit message:** Add payments table"), { handoff: "Done.", commit: "Add payments table" });
  assert.deepEqual(splitFinalResponse("No marker here."), { handoff: "No marker here.", commit: "" });
  assert.deepEqual(
    commitMessage('Title: "Handle failed job retries"\n\nSummary:\n* Preserve retry state\n2. Cover failures', "fallback"),
    { title: "Handle failed job retries", body: "- Preserve retry state\n- Cover failures" },
  );
  assert.deepEqual(commitMessage("", "  Add   retry handling\nfor failed jobs  "), { title: "Add retry handling for failed jobs", body: "" });
  assert.equal(commitMessage("x".repeat(100), "fallback").title, "x".repeat(72));
});

// ── Service, against a real Git repository ──────────────────────────────────

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function repository(t, { plan = "# Plan\n\nShared rule.\n\n- [ ] first step\n  first detail\n- [ ] second step\n", validation = "#!/bin/sh\nexit 0\n" } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oyster-loop-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "loop@example.test");
  git(dir, "config", "user.name", "Loop Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "PLAN.md"), plan);
  writeFileSync(join(dir, "validate.sh"), validation);
  chmodSync(join(dir, "validate.sh"), 0o755);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

function service(dir, act) {
  const state = { currentDir: dir };
  const prompts = [];
  const names = [];
  const subagents = {
    available: true,
    start: async ({ name, parentSessionId }) => { names.push(name); return { id: `runner-${names.length}`, parentSessionId }; },
    run: async (_runner, prompt) => { prompts.push(prompt); return act(prompts.length, prompt); },
  };
  const loops = createLoopService({ state, subagents, resolveSafePath: (path) => (path.startsWith(dir) ? path : null) });
  const params = { planPath: "PLAN.md", validationScript: "./validate.sh", dir, parentSessionId: "parent-1" };
  return { loops, prompts, names, params, state };
}

test("loop runs each step in a lean subagent, validates, checks it off, and commits", async (t) => {
  const dir = repository(t);
  const { loops, prompts, names, params } = service(dir, (count) => {
    writeFileSync(join(dir, `step-${count}.txt`), "work");
    return { ok: true, output: `Handoff ${count}.\n\nCOMMIT MESSAGE:\nImplement part ${count}\n- Add step-${count}.txt` };
  });
  const progress = [];
  const result = await loops.run(loops.validate(params), { onProgress: (event) => progress.push(event.phase) });

  assert.equal(result.complete, true);
  assert.equal(result.reason, "complete");
  assert.deepEqual(result.steps, { done: 2, total: 2 });
  assert.deepEqual(result.results.map(({ iteration, item, succeeded }) => ({ iteration, item, succeeded })), [
    { iteration: 1, item: "first step first detail", succeeded: true },
    { iteration: 2, item: "second step", succeeded: true },
  ]);
  assert.match(result.message, /Loop complete after 2 iterations/);
  assert.deepEqual(names, ["↻1 first step first detail", "↻2 second step"]);
  assert.deepEqual(progress, ["subagent", "validation", "commit", "step_done", "subagent", "validation", "commit", "step_done"]);

  assert.match(prompts[0], /# Step 1 of 2\n\nPlan section: Plan\n\nfirst step\nfirst detail/);
  assert.match(prompts[0], /Shared rule\./);
  assert.doesNotMatch(prompts[0], /- \[ \]/);
  assert.match(prompts[1], /# Step 2 of 2[\s\S]*second step/);
  assert.match(prompts[1], /# Handoff from the previous iteration\n\nHandoff 1\./);
  assert.doesNotMatch(prompts[1], /first detail|COMMIT MESSAGE:\nImplement part 1/);

  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), "# Plan\n\nShared rule.\n\n- [x] first step\n  first detail\n- [x] second step\n");
  assert.deepEqual(git(dir, "log", "--format=%s", "-3").split("\n"), ["Implement part 2", "Implement part 1", "initial"]);
  assert.equal(git(dir, "log", "--format=%b", "-1"), "- Add step-2.txt");
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.deepEqual(loops.list(), []);
});

test("a failed validation keeps the item unchecked and retries with the failure log", async (t) => {
  const dir = repository(t, {
    plan: "- [ ] only step\n",
    validation: "#!/bin/sh\nif [ -f fixed ]; then exit 0; fi\necho 'expected fixed to exist'\nexit 3\n",
  });
  const { loops, prompts, params } = service(dir, (count) => {
    writeFileSync(join(dir, "PLAN.md"), "- [x] only step\n"); // the subagent must not own plan progression
    if (count === 2) writeFileSync(join(dir, "fixed"), "");
    return { ok: true, output: `attempt ${count}` };
  });
  const result = await loops.run(loops.validate(params));
  assert.equal(result.complete, true);
  assert.deepEqual(result.results.map((entry) => entry.succeeded), [false, true]);
  assert.match(prompts[1], /previous attempt at this step failed \(this is attempt 2\)/);
  assert.match(prompts[1], /expected fixed to exist\nValidation exit code: 3/);
  assert.match(prompts[1], /# Handoff from the previous iteration\n\nattempt 1/);
  assert.equal(git(dir, "log", "--format=%s", "-1"), "only step");
  assert.equal(git(dir, "rev-list", "--count", "HEAD"), "2");
});

test("commits made by a subagent are unwound so the loop owns history", async (t) => {
  const dir = repository(t, { plan: "- [ ] only step\n" });
  const { loops, params } = service(dir, () => {
    writeFileSync(join(dir, "rogue.txt"), "x");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "rogue commit");
    return { ok: true, output: "done\nCOMMIT MESSAGE:\nAdd rogue file" };
  });
  const result = await loops.run(loops.validate(params));
  assert.equal(result.complete, true);
  assert.deepEqual(git(dir, "log", "--format=%s").split("\n"), ["Add rogue file", "initial"]);
  assert.equal(existsSync(join(dir, "rogue.txt")), true);
});

test("loop stops early when the subagent cannot run at all", async (t) => {
  const dir = repository(t, { plan: "- [ ] only step\n" });
  const { loops, prompts, params } = service(dir, () => ({ ok: false, output: "", errorLog: "Subagent exited before settling." }));
  const result = await loops.run(loops.validate(params));
  assert.equal(result.complete, false);
  assert.equal(result.reason, "subagent_unavailable");
  assert.equal(prompts.length, MAX_LAUNCH_FAILURES);
  assert.match(result.message, /could not run 3 times in a row \(0 of 1 step done\)[\s\S]*Subagent exited before settling\./);
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), "- [ ] only step\n");
});

test("loop validates its inputs and refuses a second loop in the same working tree", async (t) => {
  const dir = repository(t, { plan: "- [ ] only step\n" });
  let release;
  const { loops, params, state } = service(dir, () => new Promise((resolve) => { release = () => resolve({ ok: true, output: "done" }); }));
  const status = (overrides) => { try { loops.validate({ ...params, ...overrides }); return 200; } catch (error) { return error.status; } };
  assert.equal(status({ planPath: "missing.md" }), 400);
  assert.equal(status({ validationScript: "PLAN.md" }), 400);
  assert.equal(status({ parentSessionId: "" }), 400);
  assert.equal(status({ dir: "/somewhere/else" }), 403);
  writeFileSync(join(dir, "empty.md"), "no items\n");
  assert.equal(status({ planPath: "empty.md" }), 400);

  const inputs = loops.validate(params);
  const running = loops.run(inputs);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loops.isRunning(dir), true);
  assert.equal(state.loops.size, 1);
  assert.deepEqual(loops.list().map(({ phase, iteration, step }) => ({ phase, iteration, step })), [
    { phase: "subagent", iteration: 1, step: { index: 1, total: 1, text: "only step" } },
  ]);
  await assert.rejects(loops.run(inputs), (error) => error.status === 409);
  release();
  assert.equal((await running).complete, true);
  assert.equal(loops.isRunning(dir), false);
});

test("an aborted loop stops without checking the item off", async (t) => {
  const dir = repository(t, { plan: "- [ ] only step\n" });
  const controller = new AbortController();
  const { loops, params } = service(dir, () => { controller.abort(); return { ok: false, output: "", errorLog: "Subagent request was cancelled." }; });
  const result = await loops.run(loops.validate(params), { signal: controller.signal });
  assert.equal(result.reason, "aborted");
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), "- [ ] only step\n");
});

// ── Routes ──────────────────────────────────────────────────────────────────

function response() {
  const listeners = new Map();
  return {
    chunks: [], headers: {}, status: undefined, body: undefined, writableEnded: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    write(chunk) { this.chunks.push(chunk); },
    end() { this.writableEnded = true; },
    on(name, listener) { listeners.set(name, listener); },
    off(name) { listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); },
  };
}

function routes(loops) {
  return createLoopRoutes({
    loops: { validate: (body) => body, isRunning: () => false, list: () => [{ id: "loop-1" }], ...loops },
    requestContext: {
      json(res, status, value) { res.status = status; res.body = value; },
      readJsonBody: async (req) => req.body,
    },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
}

test("loop route streams progress as NDJSON and ends with the result", async () => {
  const route = routes({
    run: async (_inputs, { onStarted, onProgress }) => {
      onStarted({ id: "loop-1" });
      onProgress({ phase: "subagent", message: "Iteration 1" });
      return { complete: true, reason: "complete", message: "done" };
    },
  })["POST /loops"];
  const res = response();
  await route({ body: { dir: "/repo" }, headers: { accept: "application/x-ndjson" } }, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/x-ndjson; charset=utf-8");
  assert.deepEqual(res.chunks.map((chunk) => JSON.parse(chunk)), [
    { type: "started", loop: { id: "loop-1" } },
    { type: "progress", phase: "subagent", message: "Iteration 1" },
    { type: "complete", complete: true, reason: "complete", message: "done" },
  ]);
  assert.equal(res.writableEnded, true);
});

test("loop route answers JSON callers once, maps errors to statuses, and cancels on disconnect", async () => {
  const jsonRoute = routes({ run: async () => ({ complete: true, message: "done" }) })["POST /loops"];
  const res = response();
  await jsonRoute({ body: { dir: "/repo" }, headers: {} }, res);
  assert.deepEqual([res.status, res.body], [200, { complete: true, message: "done" }]);

  const invalid = response();
  await routes({ validate: () => { throw Object.assign(new Error("Plan not found: x"), { status: 400 }); }, run: async () => ({}) })["POST /loops"]({ body: {}, headers: {} }, invalid);
  assert.deepEqual([invalid.status, invalid.body], [400, { error: "Plan not found: x" }]);

  const busy = response();
  await routes({ isRunning: () => true, run: async () => ({}) })["POST /loops"]({ body: { dir: "/repo" }, headers: {} }, busy);
  assert.equal(busy.status, 409);

  let aborted = false;
  const streaming = response();
  const pending = routes({
    run: (_inputs, { signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve({ complete: false, reason: "aborted", message: "aborted" }); });
      setImmediate(() => streaming.emit("close"));
    }),
  })["POST /loops"]({ body: { dir: "/repo" }, headers: { accept: "application/x-ndjson" } }, streaming);
  await pending;
  assert.equal(aborted, true);

  const listing = response();
  await routes({ run: async () => ({}) })["GET /loops"]({}, listing);
  assert.deepEqual(listing.body, { loops: [{ id: "loop-1" }] });
});
