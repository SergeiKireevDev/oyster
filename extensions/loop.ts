// Runs a Markdown checklist through isolated pi subagents, one item at a time.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_STALLED_ITERATIONS = 20;
const VALIDATION_TIMEOUT_MS = 30 * 60 * 1000;
const CONTEXT_OUTPUT_LIMIT = 50 * 1024;
const OYSTER_URL = process.env.OYSTER_URL ?? "http://127.0.0.1:8080";

interface ChecklistItem {
  line: number;
  checked: boolean;
  text: string;
}

interface IterationResult {
  iteration: number;
  item: string;
  succeeded: boolean;
  output: string;
  validationLog?: string;
  commitHash?: string;
}

interface PreviousIteration {
  output: string;
  validationLog?: string;
  succeeded: boolean;
}

// PURE_HELPERS_START
function checklistItems(markdown: string): ChecklistItem[] {
  return markdown.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*(?:[-*+] |\d+[.)] )\[([ xX])\]\s+(.+?)\s*$/);
    return match ? [{ line: index, checked: match[1].toLowerCase() === "x", text: match[2] }] : [];
  });
}

function firstUncheckedItem(markdown: string): ChecklistItem | undefined {
  return checklistItems(markdown).find((item) => !item.checked);
}

function checkItem(markdown: string, target: ChecklistItem): string {
  const lines = markdown.split(/\r?\n/);
  const current = lines[target.line];
  if (current === undefined) throw new Error(`Plan item disappeared: ${target.text}`);
  const match = current.match(/^(\s*(?:[-*+] |\d+[.)] ))\[([ xX])\](\s+)(.+?)\s*$/);
  if (!match || match[4] !== target.text) throw new Error(`Plan item changed during iteration: ${target.text}`);
  lines[target.line] = `${match[1]}[x]${match[3]}${match[4]}`;
  return lines.join("\n");
}

function commitMessage(summary: string, fallback: string): { title: string; body: string } {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line));
  const generatedTitle = (lines.shift() ?? "")
    .replace(/^\s*(?:(?:commit )?(?:message|subject|title)\s*:\s*)/i, "")
    .replace(/^[`"']+|[`"']+$/g, "")
    .replace(/\s+/g, " ");
  const title = (generatedTitle || fallback.replace(/\s+/g, " ").trim()).slice(0, 72).trimEnd();
  const body = lines
    .filter((line) => !/^(?:body|summary)\s*:\s*$/i.test(line))
    .map((line) => `- ${line.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim()}`)
    .filter((line) => line !== "- ")
    .join("\n");
  return { title, body };
}

function clipTail(text: string, limit = CONTEXT_OUTPUT_LIMIT): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  let clipped = text;
  while (Buffer.byteLength(clipped, "utf8") > limit) clipped = clipped.slice(Math.ceil(clipped.length / 20));
  return `[Earlier output omitted]\n${clipped}`;
}

function buildIterationPrompt(plan: string, previous?: PreviousIteration): string {
  const sections = [
    "You are one isolated iteration of a sequential implementation loop.",
    "Implement exactly the first unchecked checklist item in the plan. Work directly in the current repository, add or update focused tests, and do not edit the plan file or its checkboxes. Do not create, amend, or otherwise modify Git commits: leave every change in the working tree because the parent loop owns validation and commits only after validation passes. Always finish with a useful final response, even when you cannot complete the item: state what you attempted, what succeeded, what failed, and what the next iteration should do.",
    `# Plan\n\n${plan}`,
  ];
  if (previous) sections.push(`# Previous iteration output\n\n${clipTail(previous.output || "(no output)")}`);
  if (previous && !previous.succeeded) {
    sections.push(`# Previous iteration failure log\n\n${clipTail(previous.validationLog || "(no failure details)")}`);
  }
  return sections.join("\n\n");
}
// PURE_HELPERS_END

function resolveFromCwd(ctx: ExtensionContext, path: string): string {
  return isAbsolute(path) ? path : join(ctx.cwd, path);
}

function assertInputs(planPath: string, validationPath: string): void {
  if (!existsSync(planPath) || !statSync(planPath).isFile()) throw new Error(`Plan not found: ${planPath}`);
  if (!existsSync(validationPath) || !statSync(validationPath).isFile()) {
    throw new Error(`Validation executable not found: ${validationPath}`);
  }
  if ((statSync(validationPath).mode & 0o111) === 0) {
    throw new Error(`Validation script is not executable: ${validationPath}`);
  }
  if (!checklistItems(readFileSync(planPath, "utf8")).length) {
    throw new Error(`Plan has no Markdown checklist items: ${planPath}`);
  }
}

interface SubagentResult {
  ok?: boolean;
  output?: string;
  errorLog?: string;
  error?: string;
}

async function readSubagentStream(response: Response): Promise<SubagentResult> {
  if (!response.body) throw new Error("Oyster subagent response had no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let terminal: SubagentResult | undefined;

  const consumeLines = (flush = false) => {
    const lines = buffered.split("\n");
    buffered = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: ({ type?: string } & SubagentResult);
      try { event = JSON.parse(line); } catch { throw new Error("Oyster subagent returned invalid NDJSON"); }
      if (event.type === "complete") terminal = event;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      consumeLines(done);
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!terminal) throw new Error("Oyster subagent stream ended without a completion event");
  return terminal;
}

async function runSubagent(
  ctx: ExtensionContext,
  prompt: string,
  iteration: number,
  item: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; output: string; errorLog: string }> {
  if (!ctx.sessionManager.isPersisted()) throw new Error("Loop requires a persisted Oyster parent session");
  const token = process.env.OYSTER_TOKEN?.trim();
  if (!token) throw new Error("OYSTER_TOKEN is required to start a managed loop subagent");
  const response = await fetch(`${OYSTER_URL}/subagents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      parentSessionId: ctx.sessionManager.getSessionId(),
      dir: ctx.cwd,
      name: `Loop iteration ${iteration}: ${item.slice(0, 80)}`,
      prompt,
    }),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as SubagentResult;
    throw new Error(error.error ?? `Oyster subagent request failed (${response.status})`);
  }
  const result = await readSubagentStream(response);
  return {
    ok: result.ok === true,
    output: result.output?.trim() || "(subagent produced no final text output)",
    errorLog: clipTail(result.errorLog || ""),
  };
}

async function currentGitHead(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: ctx.cwd, signal });
  const head = result.stdout.trim();
  if (result.code !== 0 || result.killed || !head) {
    throw new Error(clipTail([result.stdout, result.stderr, "Loop requires an existing Git HEAD."].filter(Boolean).join("\n")));
  }
  return head;
}

async function restoreLoopOwnedHead(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  expectedHead: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; log: string }> {
  const actualHead = await currentGitHead(pi, ctx, signal);
  if (actualHead === expectedHead) return { ok: true, log: "" };

  const reset = await pi.exec("git", ["reset", "--soft", expectedHead], { cwd: ctx.cwd, signal });
  if (reset.code !== 0 || reset.killed) {
    return {
      ok: false,
      log: clipTail([
        reset.stdout,
        reset.stderr,
        `Subagent changed Git HEAD from ${expectedHead} to ${actualHead}, and the loop could not restore it.`,
      ].filter(Boolean).join("\n")),
    };
  }
  return {
    ok: true,
    log: `Subagent-created commit history was reset to ${expectedHead}; its changes remain staged for validation.`,
  };
}

async function runValidation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  validationPath: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; log: string }> {
  const result = await pi.exec(validationPath, [], {
    cwd: ctx.cwd,
    signal,
    timeout: VALIDATION_TIMEOUT_MS,
  });
  return {
    ok: result.code === 0 && !result.killed,
    log: clipTail([
      result.stdout.trim(),
      result.stderr.trim(),
      result.killed ? "Validation executable was killed." : "",
      result.code ? `Validation exit code: ${result.code}` : "",
    ].filter(Boolean).join("\n")),
  };
}

async function generateCommitMessage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  item: string,
  subagentOutput: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!ctx.model) return commitMessage("", item).title;

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return commitMessage("", item).title;
    const diff = await pi.exec("git", ["diff", "--cached", "--no-ext-diff", "--unified=2"], { cwd: ctx.cwd, signal });
    const prompt = [
      "Write a meaningful Git commit message for this completed loop step.",
      "Return a title followed by concise bullet points summarizing the changes.",
      "The imperative title must be at most 72 characters with no prefix, quotes, bullet, or trailing period.",
      "The body must contain only `- ` bullet points. Describe the actual changes, not the checklist, validation, or process.",
      `Checklist item: ${item}`,
      `Implementation summary:\n${clipTail(subagentOutput)}`,
      `Staged diff:\n${clipTail(diff.stdout || "(no staged diff; this is an empty step commit)")}`,
    ].join("\n\n");
    const response = await complete(
      ctx.model,
      { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
      { apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
    );
    const summary = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const message = commitMessage(summary, item);
    return message.body ? `${message.title}\n\n${message.body}` : message.title;
  } catch {
    return commitMessage("", item).title;
  }
}

async function commitSuccessfulStep(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  item: string,
  subagentOutput: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; hash?: string; log: string }> {
  const staged = await pi.exec("git", ["add", "-A"], { cwd: ctx.cwd, signal });
  if (staged.code !== 0 || staged.killed) {
    return { ok: false, log: clipTail([staged.stdout, staged.stderr, "Unable to stage the validated loop changes."].filter(Boolean).join("\n")) };
  }

  const generated = await generateCommitMessage(pi, ctx, item, subagentOutput, signal);
  const [title, body = ""] = generated.split("\n\n", 2);
  const commitArgs = ["commit", "--allow-empty", "--no-gpg-sign", "-m", title];
  if (body) commitArgs.push("-m", body);
  const committed = await pi.exec("git", commitArgs, { cwd: ctx.cwd, signal });
  if (committed.code !== 0 || committed.killed) {
    return { ok: false, log: clipTail([committed.stdout, committed.stderr, "Unable to commit the validated loop changes."].filter(Boolean).join("\n")) };
  }

  const head = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { cwd: ctx.cwd, signal });
  return {
    ok: true,
    hash: head.code === 0 && !head.killed ? head.stdout.trim() || undefined : undefined,
    log: clipTail(committed.stdout.trim()),
  };
}

interface LoopParams {
  planPath: string;
  validationScript: string;
}

type LoopUpdate = (partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void;

async function runLoop(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: LoopParams,
  signal?: AbortSignal,
  onUpdate?: LoopUpdate,
) {
  const planPath = resolveFromCwd(ctx, params.planPath);
  const validationPath = resolveFromCwd(ctx, params.validationScript);
  assertInputs(planPath, validationPath);

  const results: IterationResult[] = [];
  let previous: PreviousIteration | undefined;
  let stalledItemKey: string | undefined;
  let stalledIterations = 0;

  for (let iteration = 1; ; iteration += 1) {
    if (signal?.aborted) throw new Error("Loop aborted");
    const planBefore = readFileSync(planPath, "utf8");
    const item = firstUncheckedItem(planBefore);
    if (!item) {
      const summary = `Loop complete after ${results.length} iteration${results.length === 1 ? "" : "s"}; every checklist item is checked.`;
      return { content: [{ type: "text" as const, text: summary }], details: { planPath, validationPath, complete: true, results } };
    }
    const itemKey = `${item.line}:${item.text}`;
    if (itemKey !== stalledItemKey) {
      stalledItemKey = itemKey;
      stalledIterations = 0;
    }

    onUpdate?.({
      content: [{ type: "text", text: `Iteration ${iteration}: running subagent for “${item.text}”…` }],
      details: { planPath, validationPath, complete: false, results },
    });
    const headBefore = await currentGitHead(pi, ctx, signal);
    const subagent = await runSubagent(
      ctx,
      buildIterationPrompt(planBefore, previous),
      iteration,
      item.text,
      signal,
    );
    const restoredHead = await restoreLoopOwnedHead(pi, ctx, headBefore, signal);
    if (!restoredHead.ok) {
      subagent.ok = false;
      subagent.errorLog = restoredHead.log;
    }

    let validation: { ok: boolean; log: string } | undefined;
    if (subagent.ok) {
      onUpdate?.({
        content: [{ type: "text", text: `Iteration ${iteration}: validating “${item.text}”…` }],
        details: { planPath, validationPath, complete: false, results },
      });
      validation = await runValidation(pi, ctx, validationPath, signal);
    } else {
      onUpdate?.({
        content: [{ type: "text", text: `Iteration ${iteration}: subagent failed; retrying “${item.text}” without validation…` }],
        details: { planPath, validationPath, complete: false, results },
      });
    }
    let succeeded = subagent.ok && validation?.ok === true;
    let validationLog = subagent.ok
      ? validation?.log ?? "Validation failed without output."
      : subagent.errorLog || "Subagent failed without process output.";
    let commitHash: string | undefined;

    if (succeeded) {
      writeFileSync(planPath, checkItem(planBefore, item), "utf8");
      onUpdate?.({
        content: [{ type: "text", text: `Iteration ${iteration}: committing “${item.text}”…` }],
        details: { planPath, validationPath, complete: false, results },
      });
      const commit = await commitSuccessfulStep(pi, ctx, item.text, subagent.output, signal);
      succeeded = commit.ok;
      commitHash = commit.hash;
      if (!commit.ok) validationLog = `Validation passed, but the step could not be committed.\n${commit.log}`;
    }

    if (!succeeded) {
      // The extension owns plan progression. A failed attempt must expose the
      // same unchecked plan to the retry even if the subagent touched it.
      writeFileSync(planPath, planBefore, "utf8");
    }

    const record: IterationResult = {
      iteration,
      item: item.text,
      succeeded,
      output: clipTail(subagent.output),
      ...(succeeded ? { commitHash } : { validationLog: validationLog || "Validation failed without output." }),
    };
    results.push(record);
    previous = { output: record.output, succeeded, validationLog: record.validationLog };

    if (succeeded) {
      stalledItemKey = undefined;
      stalledIterations = 0;
    } else {
      stalledIterations += 1;
      if (stalledIterations >= MAX_STALLED_ITERATIONS) {
        return {
          content: [{
            type: "text" as const,
            text: `Loop stopped after “${item.text}” failed to advance for ${MAX_STALLED_ITERATIONS} consecutive iterations.`,
          }],
          details: { planPath, validationPath, complete: false, stalled: true, results },
        };
      }
    }
  }
}

function commandArguments(input: string): string[] {
  const values: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    values.push(match[1] !== undefined ? match[1].replace(/\\([\\"])/g, "$1") : match[2] ?? match[3]);
  }
  return values;
}

export default function loopExtension(pi: ExtensionAPI) {
  pi.registerCommand("loop", {
    description: "Run a Markdown checklist: /loop <plan.md> <executable-validation-script>",
    handler: async (args, ctx) => {
      const values = commandArguments(args);
      let planPath = values[0];
      let validationScript = values[1];
      if (!planPath && ctx.hasUI) planPath = await ctx.ui.input("Loop plan", "PLAN.md");
      if (!validationScript && ctx.hasUI) validationScript = await ctx.ui.input("Validation executable", "./validate.sh");
      if (!planPath || !validationScript) {
        ctx.ui.notify("Usage: /loop <plan.md> <executable-validation-script>", "warning");
        return;
      }
      if (values.length > 2) {
        ctx.ui.notify("The loop no longer accepts a total iteration limit; it stops only after one step fails to advance for 20 consecutive iterations.", "error");
        return;
      }

      try {
        const hasConversation = ctx.sessionManager.getEntries().some((entry) => entry.type === "message");
        if (!pi.getSessionName() && !hasConversation) pi.setSessionName(`Loop: ${basename(planPath)}`);
        const result = await runLoop(pi, ctx, { planPath, validationScript }, undefined, (partial) => {
          ctx.ui.setStatus("loop", `🔁 ${partial.content[0].text}`);
        });
        ctx.ui.notify(result.content[0].text, result.details.complete ? "info" : "warning");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        ctx.ui.setStatus("loop", undefined);
      }
    },
  });

  pi.registerTool({
    name: "loop",
    label: "Loop",
    description: "Execute a Markdown checklist sequentially. Each iteration runs in a fresh isolated pi subagent, then an executable validation script decides whether that checklist item is checked and committed. Failed validation or commit retries the same item with the previous output and failure log; the loop stops only when one step fails to advance for 20 consecutive iterations. Output is capped at 50 KB per context section.",
    promptSnippet: "Run a Markdown checklist through isolated, validated subagent iterations",
    promptGuidelines: [
      "Use loop when the user provides a Markdown checklist plan and an executable validation script for autonomous sequential implementation.",
    ],
    parameters: Type.Object({
      planPath: Type.String({ description: "Path to the Markdown checklist plan, relative to the working directory or absolute" }),
      validationScript: Type.String({ description: "Path to an executable validation script, relative to the working directory or absolute" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return runLoop(pi, ctx, params, signal, onUpdate as LoopUpdate | undefined);
    },
  });
}
