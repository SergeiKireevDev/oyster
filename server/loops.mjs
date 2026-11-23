import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { errorMessage } from "./errors.mjs";
import { signalProcessGroup, STOP_GRACE_MS } from "./process-groups.mjs";
import { isNonArrayObject } from "./valuePredicates.mjs";

/**
 * Sequential plan loops, owned by the Oyster server.
 *
 * A loop walks a Markdown checklist one unchecked item at a time. Each item is
 * implemented by a fresh managed subagent, gated by an executable validation
 * script, then checked off and committed by the loop itself.
 *
 * Every iteration starts from an empty context, so its prompt is the whole
 * cost of the step. The prompt therefore carries the step and nothing else of
 * the plan: the item with its nested detail, the headings it sits under, the
 * plan's prose that applies to it, and a short handoff from the previous
 * iteration. The checklist itself, every other step, is never sent; the plan
 * file stays on disk for the rare step that needs more.
 */

const BYTES_PER_KIBIBYTE = 1024;
const MILLISECONDS_PER_MINUTE = 60_000;
const VALIDATION_TIMEOUT_MINUTES = 30;
const STEP_KIBIBYTES = 16;
const NOTES_KIBIBYTES = 8;
const HANDOFF_KIBIBYTES = 4;
const FAILURE_LOG_KIBIBYTES = 16;
const REPORTED_FAILURE_KIBIBYTES = 4;
const EXEC_OUTPUT_KIBIBYTES = 256;
const CLIP_SHRINK_DIVISOR = 20;
const COMMIT_TITLE_MAX_CHARS = 72;
const SUBAGENT_NAME_ITEM_CHARS = 80;
const EXECUTABLE_BITS = 0o111;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MAX_PATH_BYTES = 4096;
const MAX_SESSION_ID_BYTES = 512;

export const MAX_STALLED_ITERATIONS = 20;
export const MAX_LAUNCH_FAILURES = 3;
export const STEP_LIMIT = STEP_KIBIBYTES * BYTES_PER_KIBIBYTE;
export const NOTES_LIMIT = NOTES_KIBIBYTES * BYTES_PER_KIBIBYTE;
export const HANDOFF_LIMIT = HANDOFF_KIBIBYTES * BYTES_PER_KIBIBYTE;
export const FAILURE_LOG_LIMIT = FAILURE_LOG_KIBIBYTES * BYTES_PER_KIBIBYTE;
const REPORTED_FAILURE_LIMIT = REPORTED_FAILURE_KIBIBYTES * BYTES_PER_KIBIBYTE;
const EXEC_OUTPUT_LIMIT = EXEC_OUTPUT_KIBIBYTES * BYTES_PER_KIBIBYTE;
const VALIDATION_TIMEOUT_MS = VALIDATION_TIMEOUT_MINUTES * MILLISECONDS_PER_MINUTE;

const ITEM_PATTERN = /^(?<marker>\s*(?:[-*+] |\d+[.)] ))\[(?<box>[ xX])\](?<gap>\s+)(?<text>.+?)\s*$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_MARKER_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE_PATTERN = /^\s*(?:```|~~~)/;
const COMMIT_MARKER_PATTERN = /^\s*(?:#{1,6}\s*)?[*_`]*commit message[*_`]*\s*:?[*_`]*\s*(.*)$/i;

// ── Plan parsing ────────────────────────────────────────────────────────────

/** Checklist items and headings of a plan; fenced code is never plan structure. */
export function scanPlan(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const items = [];
  const headings = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE_PATTERN.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const heading = line.match(HEADING_PATTERN);
    if (heading) { headings.push({ line: index, level: heading[1].length, text: heading[2] }); return; }
    const item = line.match(ITEM_PATTERN);
    if (item) {
      items.push({
        line: index,
        indent: indentOf(item.groups.marker),
        checked: item.groups.box.toLowerCase() === "x",
        text: item.groups.text,
      });
    }
  });
  return { lines, items, headings };
}

export function checklistItems(markdown) {
  return scanPlan(markdown).items;
}

export function firstUncheckedItem(markdown) {
  return checklistItems(markdown).find((item) => !item.checked);
}

/** Check exactly `target`, refusing if the plan moved underneath the iteration. */
export function checkItem(markdown, target) {
  const lines = String(markdown).split(/\r?\n/);
  const current = lines[target.line];
  if (current === undefined) throw new Error(`Plan item disappeared: ${target.text}`);
  const match = current.match(ITEM_PATTERN);
  if (!match || match.groups.text !== target.text) throw new Error(`Plan item changed during iteration: ${target.text}`);
  lines[target.line] = `${match.groups.marker}[x]${match.groups.gap}${match.groups.text}`;
  return lines.join("\n");
}

function shrinkToLimit(text, limit, shrink) {
  let clipped = text;
  while (Buffer.byteLength(clipped, "utf8") > limit) clipped = shrink(clipped, Math.ceil(clipped.length / CLIP_SHRINK_DIVISOR));
  return clipped;
}

/** Keep the end of `text`: failure logs put the verdict last. */
export function clipTail(text, limit) {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  return `[Earlier output omitted]\n${shrinkToLimit(text, limit, (value, drop) => value.slice(drop))}`;
}

/** Keep the start of `text`: prose puts what matters first. */
export function clipHead(text, limit) {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  return `${shrinkToLimit(text, limit, (value, drop) => value.slice(0, value.length - drop))}\n[Remainder omitted]`;
}

function indentOf(line) {
  return line.match(/^\s*/)[0].length;
}

/** The item's text plus the more-indented lines beneath it, dedented. */
function stepBlock(lines, item) {
  const detail = [];
  for (let index = item.line + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentOf(line) <= item.indent) break;
    detail.push(line);
  }
  while (detail.length && !detail.at(-1).trim()) detail.pop();
  const margin = Math.min(...detail.filter((line) => line.trim()).map(indentOf));
  return [item.text, ...detail.map((line) => line.slice(Math.min(margin, indentOf(line))))].join("\n");
}

/** The item as one line: its text plus the wrapped lines that continue the same sentence. */
function stepSummary(lines, item) {
  const parts = [item.text];
  for (let index = item.line + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const continues = line.trim() && indentOf(line) > item.indent && !FENCE_PATTERN.test(line) && !LIST_MARKER_PATTERN.test(line);
    if (!continues) break;
    parts.push(line.trim());
  }
  return parts.join(" ");
}

/** Headings enclosing `line`, outermost first. */
function headingTrail(headings, line) {
  const trail = [];
  for (const heading of headings) {
    if (heading.line > line) break;
    while (trail.length && trail.at(-1).level >= heading.level) trail.pop();
    trail.push(heading);
  }
  return trail;
}

/**
 * The plan's prose that applies to a step, without any other step.
 *
 * Sections enclosing the step contribute their intro, the text before their
 * first item or subheading. Sections beside the step that hold no checklist
 * items at all (rules, constraints, output formats) are shared context and are
 * kept whole. Sections that list other steps are left out.
 */
function sectionNotes({ lines, items, headings }, trail) {
  const enclosing = new Set(trail.map((heading) => heading.line));
  const sections = [{ heading: null, start: 0 }, ...headings.map((heading) => ({ heading, start: heading.line + 1 }))];
  const notes = sections.map(({ heading, start }, index) => {
    const end = sections[index + 1]?.heading.line ?? lines.length;
    const firstItem = items.find((item) => item.line >= start && item.line < end);
    const encloses = !heading || enclosing.has(heading.line);
    const beside = heading && !firstItem && headingTrail(headings, heading.line).slice(0, -1).every((ancestor) => enclosing.has(ancestor.line));
    if (!encloses && !beside) return "";
    const text = lines.slice(start, firstItem ? firstItem.line : end).join("\n").trim();
    if (!text) return "";
    return heading ? `**${heading.text}**\n${text}` : text;
  });
  return notes.filter(Boolean).join("\n\n");
}

/**
 * Everything one iteration needs to know about its step, cut from the plan.
 *
 * `text` is the item on one line, for titles and progress; `block` is what the subagent implements.
 *
 * @returns {{ index: number, total: number, done: number, text: string, block: string, trail: string[], notes: string, next: string | null }}
 */
export function stepContext(markdown, item) {
  const plan = scanPlan(markdown);
  const position = plan.items.findIndex((candidate) => candidate.line === item.line);
  if (position === -1) throw new Error(`Plan item disappeared: ${item.text}`);
  const trail = headingTrail(plan.headings, item.line);
  const next = plan.items.slice(position + 1).find((candidate) => !candidate.checked);
  return {
    index: position + 1,
    total: plan.items.length,
    done: plan.items.filter((candidate) => candidate.checked).length,
    text: stepSummary(plan.lines, item),
    block: clipHead(stepBlock(plan.lines, item), STEP_LIMIT),
    trail: trail.map((heading) => heading.text),
    notes: clipHead(sectionNotes(plan, trail), NOTES_LIMIT),
    next: next ? stepSummary(plan.lines, next) : null,
  };
}

// ── Iteration prompt and response ───────────────────────────────────────────

const ITERATION_RULES =
  "You are one isolated iteration of a sequential implementation loop driven by Oyster. " +
  "Carry out exactly the step below and nothing beyond it. Work directly in the current repository; when the step changes code, add or update focused tests. " +
  "The loop owns the plan file, validation, and Git history: do not edit the plan or its checkboxes, and do not create, amend, " +
  "or otherwise modify Git commits. Leave every change in the working tree; the loop validates it and commits only after validation passes.";

const RESPONSE_CONTRACT = [
  "Always finish with a final response in exactly this shape, even when you could not complete the step:",
  "1. A handoff of at most 150 words: what you changed, what the next step must know, and what failed if anything did.",
  "2. A line reading `COMMIT MESSAGE:`, then an imperative title of at most 72 characters and a few `- ` bullets describing the actual changes.",
].join("\n");

function widerPlanSection(planPath, step) {
  const lines = [
    `The full plan is \`${planPath}\`; ${step.done} of its ${step.total} steps are already done and committed (see \`git log\`). ` +
    "What applies to this step is already above; the rest of the file is the checklist of other steps, deliberately left out. " +
    "Do not open it unless this step cannot be understood without it.",
  ];
  if (step.next) lines.push(`The step after this one is “${step.next}”. Do not start it.`);
  return `# Wider plan\n\n${lines.join("\n")}`;
}

/**
 * The complete context of one iteration.
 *
 * @param {{ planPath: string, step: ReturnType<typeof stepContext>, attempt?: number,
 *   previous?: { handoff: string, succeeded: boolean, failureLog?: string } | null }} input
 */
export function buildIterationPrompt({ planPath, step, attempt = 1, previous = null }) {
  const location = step.trail.length ? `Plan section: ${step.trail.join(" › ")}\n\n` : "";
  const sections = [
    ITERATION_RULES,
    `# Step ${step.index} of ${step.total}\n\n${location}${step.block}`,
  ];
  if (step.notes) sections.push(`# Plan notes\n\n${step.notes}`);
  sections.push(widerPlanSection(planPath, step));
  if (previous?.handoff) sections.push(`# Handoff from the previous iteration\n\n${clipTail(previous.handoff, HANDOFF_LIMIT)}`);
  if (previous && !previous.succeeded) {
    sections.push([
      `# The previous attempt at this step failed (this is attempt ${attempt})`,
      "Its changes are still in the working tree. Inspect them with `git status` and `git diff`, then fix them instead of starting over.",
      clipTail(previous.failureLog || "(no failure details)", FAILURE_LOG_LIMIT),
    ].join("\n\n"));
  }
  sections.push(`# Final response\n\n${RESPONSE_CONTRACT}`);
  return sections.join("\n\n");
}

/** Split a subagent's final response into its handoff and its proposed commit message. */
export function splitFinalResponse(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  let marker = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (COMMIT_MARKER_PATTERN.test(lines[index])) { marker = index; break; }
  }
  if (marker === -1) return { handoff: lines.join("\n").trim(), commit: "" };
  const inline = lines[marker].match(COMMIT_MARKER_PATTERN)[1];
  return {
    handoff: lines.slice(0, marker).join("\n").trim(),
    commit: [inline, ...lines.slice(marker + 1)].join("\n").trim(),
  };
}

/** Normalize a proposed commit message into a title and `- ` bullet body. */
export function commitMessage(summary, fallback) {
  const lines = String(summary ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line));
  const generatedTitle = (lines.shift() ?? "")
    .replace(/^\s*(?:(?:commit )?(?:message|subject|title)\s*:\s*)/i, "")
    .replace(/^[`"'*]+|[`"'*]+$/g, "")
    .replace(/\s+/g, " ");
  const title = (generatedTitle || fallback.replace(/\s+/g, " ").trim()).slice(0, COMMIT_TITLE_MAX_CHARS).trimEnd();
  const body = lines
    .filter((line) => !/^(?:body|summary)\s*:\s*$/i.test(line))
    .map((line) => `- ${line.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim()}`)
    .filter((line) => line !== "- ")
    .join("\n");
  return { title, body };
}

// ── Process execution ───────────────────────────────────────────────────────

/** Run a command in its own process group, keeping the tail of its output. */
export function execCommand(file, args, { cwd, signal, timeoutMs } = {}) {
  return new Promise((resolvePromise) => {
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let killed = false;
    let settled = false;
    let child;
    const settle = (code, spawnError) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolvePromise({
        code,
        killed,
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: spawnError ? errorMessage(spawnError) : Buffer.concat(output.stderr).toString("utf8"),
      });
    };
    const kill = () => {
      killed = true;
      signalProcessGroup(child, "SIGTERM");
      setTimeout(() => signalProcessGroup(child, "SIGKILL"), STOP_GRACE_MS).unref();
    };
    const collect = (stream) => (chunk) => {
      output[stream].push(chunk);
      sizes[stream] += chunk.length;
      while (sizes[stream] > EXEC_OUTPUT_LIMIT && output[stream].length > 1) sizes[stream] -= output[stream].shift().length;
    };
    let timer = null;
    try {
      child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (error) {
      settle(null, error);
      return;
    }
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", (error) => settle(null, error));
    child.on("close", (code) => settle(code));
    if (timeoutMs) timer = setTimeout(kill, timeoutMs);
    timer?.unref?.();
    if (signal?.aborted) kill();
    else signal?.addEventListener("abort", kill, { once: true });
  });
}

/** Session title of an iteration; the session lists recognize a loop by the "↻<n> " prefix and order by it. */
export function iterationTitle(iteration, itemText) {
  return `↻${iteration} ${itemText.slice(0, SUBAGENT_NAME_ITEM_CHARS).trimEnd()}`;
}

function joinLog(...parts) {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join("\n");
}

// ── Loop service ────────────────────────────────────────────────────────────

function loopError(status, message) {
  return Object.assign(new Error(message), { status });
}

function boundedString(value, maxBytes) {
  return typeof value === "string" && value.trim() !== "" && !value.includes("\0") && Buffer.byteLength(value) <= maxBytes;
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectoryPath(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function planProgress(planPath) {
  const items = checklistItems(readFileSync(planPath, "utf8"));
  return { done: items.filter((item) => item.checked).length, total: items.length };
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function outcomeMessage(reason, { results, steps, item, lastFailure }) {
  const progress = `${steps.done} of ${plural(steps.total, "step")} done`;
  const ran = plural(results.length, "iteration");
  const commits = results.filter((result) => result.succeeded)
    .map((result) => `- ${result.commitHash ?? "(uncommitted)"} ${result.item}`);
  const failure = lastFailure ? `\n\nLast failure:\n${lastFailure}` : "";
  const headline = {
    complete: `Loop complete after ${ran}; every checklist item is checked (${progress}).`,
    stalled: `Loop stopped after “${item}” failed to advance for ${MAX_STALLED_ITERATIONS} consecutive iterations (${progress}).`,
    subagent_unavailable: `Loop stopped: the iteration subagent could not run ${MAX_LAUNCH_FAILURES} times in a row (${progress}).`,
    aborted: `Loop aborted after ${ran} (${progress}).`,
  }[reason];
  const committed = commits.length ? `\n\nCommitted steps:\n${commits.join("\n")}` : "";
  return `${headline}${committed}${reason === "complete" ? "" : failure}`;
}

/**
 * @param {{ state: object, subagents: { available: boolean, start: Function, run: Function },
 *   resolveSafePath: (path: string) => string | null, exec?: typeof execCommand,
 *   validationTimeoutMs?: number, now?: () => number, createId?: () => string }} dependencies
 */
export function createLoopService({
  state, subagents, resolveSafePath, exec = execCommand,
  validationTimeoutMs = VALIDATION_TIMEOUT_MS, now = Date.now, createId = randomUUID,
}) {
  if (!state || typeof state !== "object") throw new TypeError("loop service requires server state");
  if (typeof subagents?.start !== "function" || typeof subagents?.run !== "function") throw new TypeError("loop service requires the subagent service");
  if (typeof resolveSafePath !== "function") throw new TypeError("loop service requires resolveSafePath");
  // Running loops outlive a hot reload, so the registry lives on the host-owned state.
  if (!(state.loops instanceof Map)) state.loops = new Map();
  const active = state.loops;

  /** Validate a request into absolute paths. Throws an error carrying an HTTP `status`. */
  function validate(params) {
    if (!isNonArrayObject(params)) throw loopError(HTTP_BAD_REQUEST, "request body must be a JSON object");
    for (const field of ["planPath", "validationScript"]) {
      if (!boundedString(params[field], MAX_PATH_BYTES)) throw loopError(HTTP_BAD_REQUEST, `${field} must be a non-empty path`);
    }
    if (!boundedString(params.parentSessionId, MAX_SESSION_ID_BYTES)) {
      throw loopError(HTTP_BAD_REQUEST, "parentSessionId must be a non-empty session identity no larger than 512 bytes");
    }
    if (params.dir !== undefined && !boundedString(params.dir, MAX_PATH_BYTES)) throw loopError(HTTP_BAD_REQUEST, "dir must be a non-empty string");
    const dir = resolveSafePath(resolve(params.dir ?? state.currentDir));
    if (!dir) throw loopError(HTTP_FORBIDDEN, `path outside the allowed roots: ${params.dir ?? state.currentDir}`);
    if (!isDirectoryPath(dir)) throw loopError(HTTP_BAD_REQUEST, `not a directory: ${dir}`);
    const fromDir = (path) => (isAbsolute(path) ? path : resolve(dir, path));
    const planPath = fromDir(params.planPath.trim());
    const validationPath = fromDir(params.validationScript.trim());
    if (!isFile(planPath)) throw loopError(HTTP_BAD_REQUEST, `Plan not found: ${planPath}`);
    if (!isFile(validationPath)) throw loopError(HTTP_BAD_REQUEST, `Validation executable not found: ${validationPath}`);
    if ((statSync(validationPath).mode & EXECUTABLE_BITS) === 0) throw loopError(HTTP_BAD_REQUEST, `Validation script is not executable: ${validationPath}`);
    if (!checklistItems(readFileSync(planPath, "utf8")).length) throw loopError(HTTP_BAD_REQUEST, `Plan has no Markdown checklist items: ${planPath}`);
    return { dir, planPath, validationPath, parentSessionId: params.parentSessionId.trim() };
  }

  function describe(entry) {
    const { id, dir, planPath, validationPath, parentSessionId, startedAt, iteration, phase, step } = entry;
    return { id, dir, planPath, validationPath, parentSessionId, startedAt, iteration, phase, step };
  }

  const git = (dir, args, signal) => exec("git", args, { cwd: dir, signal });

  async function gitHead(dir, signal) {
    const result = await git(dir, ["rev-parse", "--verify", "HEAD"], signal);
    const head = result.stdout.trim();
    if (result.code !== 0 || result.killed || !head) {
      throw loopError(HTTP_BAD_REQUEST, joinLog(result.stdout, result.stderr, "Loop requires a Git repository with an existing HEAD."));
    }
    return head;
  }

  /** Undo commits a subagent made against the rules, keeping its changes staged for validation. */
  async function restoreHead(dir, expectedHead, signal) {
    const actualHead = await gitHead(dir, signal);
    if (actualHead === expectedHead) return { ok: true, log: "" };
    const reset = await git(dir, ["reset", "--soft", expectedHead], signal);
    if (reset.code !== 0 || reset.killed) {
      return { ok: false, log: joinLog(reset.stdout, reset.stderr, `Subagent changed Git HEAD from ${expectedHead} to ${actualHead}, and the loop could not restore it.`) };
    }
    return { ok: true, log: "" };
  }

  async function runValidation({ dir, validationPath }, signal) {
    const result = await exec(validationPath, [], { cwd: dir, signal, timeoutMs: validationTimeoutMs });
    return {
      ok: result.code === 0 && !result.killed,
      log: joinLog(
        result.stdout, result.stderr,
        result.killed ? "Validation executable was killed." : "",
        result.code ? `Validation exit code: ${result.code}` : "",
      ) || "Validation failed without output.",
    };
  }

  async function commitStep(dir, item, proposedMessage, signal) {
    const staged = await git(dir, ["add", "-A"], signal);
    if (staged.code !== 0 || staged.killed) return { ok: false, log: joinLog(staged.stdout, staged.stderr, "Unable to stage the validated loop changes.") };
    const { title, body } = commitMessage(proposedMessage, item);
    const args = ["commit", "--allow-empty", "--no-gpg-sign", "-m", title];
    if (body) args.push("-m", body);
    const committed = await git(dir, args, signal);
    if (committed.code !== 0 || committed.killed) return { ok: false, log: joinLog(committed.stdout, committed.stderr, "Unable to commit the validated loop changes.") };
    const head = await git(dir, ["rev-parse", "--short", "HEAD"], signal);
    return { ok: true, hash: head.code === 0 && !head.killed ? head.stdout.trim() || undefined : undefined };
  }

  async function runSubagent({ dir, parentSessionId }, { iteration, title, prompt }, signal) {
    try {
      const name = iterationTitle(iteration, title);
      const runner = await subagents.start({ dir, parentSessionId, name });
      const result = await subagents.run(runner, prompt, { signal });
      return { ok: result.ok === true, output: String(result.output ?? "").trim(), errorLog: String(result.errorLog ?? "") };
    } catch (error) {
      return { ok: false, output: "", errorLog: `Unable to start the iteration subagent: ${errorMessage(error)}` };
    }
  }

  /** One attempt at one step: subagent, validation, then plan check-off and commit. */
  async function runIteration(inputs, context, { signal, report }) {
    const { dir, planPath } = inputs;
    const { item, title, planBefore } = context;
    report("subagent", `running subagent for “${title}”…`);
    const headBefore = await gitHead(dir, signal);
    const subagent = await runSubagent(inputs, context, signal);
    const { handoff, commit } = splitFinalResponse(subagent.output);
    const failed = (failureLog, launchFailed = false) => {
      // The loop owns plan progression: a retry sees the same unchecked plan even if the subagent touched it.
      writeFileSync(planPath, planBefore, "utf8");
      return { succeeded: false, handoff, failureLog, launchFailed };
    };
    if (signal?.aborted) return failed("Loop aborted.");
    const restored = await restoreHead(dir, headBefore, signal);
    if (!restored.ok) return failed(restored.log);
    if (!subagent.ok) return failed(subagent.errorLog || "Subagent failed without process output.", !subagent.output);

    report("validation", `validating “${title}”…`);
    const validation = await runValidation(inputs, signal);
    if (!validation.ok) return failed(validation.log);

    report("commit", `committing “${title}”…`);
    writeFileSync(planPath, checkItem(planBefore, item), "utf8");
    const committed = await commitStep(dir, title, commit, signal);
    if (!committed.ok) return failed(`Validation passed, but the step could not be committed.\n${committed.log}`);
    return { succeeded: true, handoff, commitHash: committed.hash };
  }

  async function iterate(inputs, entry, { signal, onProgress }) {
    const { planPath, validationPath } = inputs;
    const results = [];
    let previous = null;
    let stalledKey = null;
    let stalledCount = 0;
    let launchFailures = 0;
    let lastFailure = "";
    const outcome = (reason, item) => {
      const steps = planProgress(planPath);
      return {
        complete: reason === "complete", reason, planPath, validationPath, iterations: results.length, steps, results,
        ...(lastFailure && reason !== "complete" ? { lastFailure } : {}),
        message: outcomeMessage(reason, { results, steps, item, lastFailure }),
      };
    };

    for (let iteration = 1; ; iteration += 1) {
      if (signal?.aborted) return outcome("aborted");
      const planBefore = readFileSync(planPath, "utf8");
      const item = firstUncheckedItem(planBefore);
      if (!item) return outcome("complete");
      const key = `${item.line}:${item.text}`;
      if (key !== stalledKey) {
        stalledKey = key;
        stalledCount = 0;
        launchFailures = 0;
      }
      const step = stepContext(planBefore, item);
      const attempt = stalledCount + 1;
      const title = step.text;
      const stepInfo = { index: step.index, total: step.total, text: title };
      const report = (phase, detail, extra = {}) => {
        Object.assign(entry, { iteration, phase, step: stepInfo });
        onProgress({ phase, iteration, attempt, step: stepInfo, message: `Iteration ${iteration} (step ${step.index}/${step.total}): ${detail}`, ...extra });
      };
      const prompt = buildIterationPrompt({ planPath, step, attempt, previous });
      const record = await runIteration(inputs, { iteration, item, title, planBefore, prompt }, { signal, report });
      results.push({ iteration, item: title, succeeded: record.succeeded, ...(record.commitHash ? { commitHash: record.commitHash } : {}) });
      previous = { handoff: record.handoff, succeeded: record.succeeded, failureLog: record.failureLog };
      if (signal?.aborted) return outcome("aborted");
      if (record.succeeded) {
        stalledKey = null;
        lastFailure = "";
        const hash = record.commitHash ? ` as ${record.commitHash}` : "";
        report("step_done", `committed “${title}”${hash}.`, { succeeded: true, commitHash: record.commitHash });
        continue;
      }
      lastFailure = clipTail(record.failureLog, REPORTED_FAILURE_LIMIT);
      stalledCount += 1;
      launchFailures = record.launchFailed ? launchFailures + 1 : 0;
      report("step_failed", `“${title}” failed; retrying.`, { succeeded: false });
      if (launchFailures >= MAX_LAUNCH_FAILURES) return outcome("subagent_unavailable", title);
      if (stalledCount >= MAX_STALLED_ITERATIONS) return outcome("stalled", title);
    }
  }

  /**
   * Run a validated loop to its end.
   *
   * @param {ReturnType<typeof validate>} inputs
   * @param {{ signal?: AbortSignal, onProgress?: (event: object) => void, onStarted?: (loop: object) => void }} [options]
   */
  async function run(inputs, { signal, onProgress = () => {}, onStarted = () => {} } = {}) {
    if (!subagents.available) throw loopError(HTTP_SERVICE_UNAVAILABLE, "managed subagents are unavailable");
    // Two loops in one working tree would validate and commit each other's half-finished changes.
    if (active.has(inputs.dir)) throw loopError(HTTP_CONFLICT, `a loop is already running in ${inputs.dir}`);
    const entry = { id: createId(), ...inputs, startedAt: now(), iteration: 0, phase: "starting", step: null };
    active.set(inputs.dir, entry);
    try {
      await gitHead(inputs.dir, signal);
      onStarted(describe(entry));
      return await iterate(inputs, entry, { signal, onProgress });
    } finally {
      if (active.get(inputs.dir) === entry) active.delete(inputs.dir);
    }
  }

  return {
    validate,
    run,
    isRunning: (dir) => active.has(dir),
    list: () => [...active.values()].map(describe),
  };
}
