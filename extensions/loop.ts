// Runs a Markdown checklist through isolated pi subagents, one item at a time.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MAX_ITERATIONS = 50;
const VALIDATION_TIMEOUT_MS = 30 * 60 * 1000;
const CONTEXT_OUTPUT_LIMIT = 50 * 1024;

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

function clipTail(text: string, limit = CONTEXT_OUTPUT_LIMIT): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  let clipped = text;
  while (Buffer.byteLength(clipped, "utf8") > limit) clipped = clipped.slice(Math.ceil(clipped.length / 20));
  return `[Earlier output omitted]\n${clipped}`;
}

function buildIterationPrompt(plan: string, previous?: PreviousIteration): string {
  const sections = [
    "You are one isolated iteration of a sequential implementation loop.",
    "Implement exactly the first unchecked checklist item in the plan. Work directly in the current repository, add or update focused tests, and do not edit the plan file or its checkboxes. Finish with a concise account of what you changed and any concerns for the next iteration.",
    `# Plan\n\n${plan}`,
  ];
  if (previous) sections.push(`# Previous iteration output\n\n${clipTail(previous.output || "(no output)")}`);
  if (previous && !previous.succeeded) {
    sections.push(`# Validation executable error log\n\n${clipTail(previous.validationLog || "(no validation output)")}`);
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

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && !currentScript.startsWith("/$bunfs/root/") && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const executable = process.execPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return /^(node|bun)(\.exe)?$/.test(executable)
    ? { command: process.env.PI_BIN || "pi", args }
    : { command: process.execPath, args };
}

function assistantOutput(stdout: string): string {
  let output = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
      const text = event.message.content
        ?.filter((part: { type?: string }) => part.type === "text")
        .map((part: { text?: string }) => part.text || "")
        .join("\n");
      if (text) output = text;
    } catch {
      // JSON mode may coexist with incidental non-JSON process output.
    }
  }
  return output.trim();
}

async function runSubagent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; output: string; errorLog: string }> {
  const invocation = getPiInvocation(["--mode", "json", "-p", "--no-session", "--exclude-tools", "loop", prompt]);
  const result = await pi.exec(invocation.command, invocation.args, {
    cwd: ctx.cwd,
    signal,
    timeout: VALIDATION_TIMEOUT_MS,
  });
  const output = assistantOutput(result.stdout);
  return {
    ok: result.code === 0 && !result.killed,
    output: output || "(subagent produced no final text output)",
    errorLog: clipTail([result.stderr.trim(), result.code ? `Subagent exit code: ${result.code}` : ""].filter(Boolean).join("\n")),
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

interface LoopParams {
  planPath: string;
  validationScript: string;
  maxIterations?: number;
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

  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const results: IterationResult[] = [];
  let previous: PreviousIteration | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (signal?.aborted) throw new Error("Loop aborted");
    const planBefore = readFileSync(planPath, "utf8");
    const item = firstUncheckedItem(planBefore);
    if (!item) {
      const summary = `Loop complete after ${results.length} iteration${results.length === 1 ? "" : "s"}; every checklist item is checked.`;
      return { content: [{ type: "text" as const, text: summary }], details: { planPath, validationPath, complete: true, results } };
    }

    onUpdate?.({
      content: [{ type: "text", text: `Iteration ${iteration}: running subagent for “${item.text}”…` }],
      details: { planPath, validationPath, complete: false, results },
    });
    const subagent = await runSubagent(pi, ctx, buildIterationPrompt(planBefore, previous), signal);

    onUpdate?.({
      content: [{ type: "text", text: `Iteration ${iteration}: validating “${item.text}”…` }],
      details: { planPath, validationPath, complete: false, results },
    });
    const validation = await runValidation(pi, ctx, validationPath, signal);
    const succeeded = subagent.ok && validation.ok;
    const validationLog = [subagent.errorLog, validation.log].filter(Boolean).join("\n\n");

    if (succeeded) {
      writeFileSync(planPath, checkItem(planBefore, item), "utf8");
    } else {
      // The extension owns plan progression. A failed attempt must expose the
      // same unchecked plan to the retry even if the subagent touched it.
      writeFileSync(planPath, planBefore, "utf8");
    }

    const record: IterationResult = {
      iteration,
      item: item.text,
      succeeded,
      output: clipTail(subagent.output),
      ...(succeeded ? {} : { validationLog: validationLog || "Validation failed without output." }),
    };
    results.push(record);
    previous = { output: record.output, succeeded, validationLog: record.validationLog };
  }

  const remaining = firstUncheckedItem(readFileSync(planPath, "utf8"));
  const complete = !remaining;
  return {
    content: [{
      type: "text" as const,
      text: complete
        ? `Loop complete after ${results.length} iterations; every checklist item is checked.`
        : `Loop stopped at the ${maxIterations}-iteration safety limit with “${remaining.text}” still unchecked.`,
    }],
    details: { planPath, validationPath, complete, results },
  };
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
    description: "Run a Markdown checklist: /loop <plan.md> <executable-validation-script> [max-iterations]",
    handler: async (args, ctx) => {
      const values = commandArguments(args);
      let planPath = values[0];
      let validationScript = values[1];
      if (!planPath && ctx.hasUI) planPath = await ctx.ui.input("Loop plan", "PLAN.md");
      if (!validationScript && ctx.hasUI) validationScript = await ctx.ui.input("Validation executable", "./validate.sh");
      if (!planPath || !validationScript) {
        ctx.ui.notify("Usage: /loop <plan.md> <executable-validation-script> [max-iterations]", "warning");
        return;
      }
      const maxIterations = values[2] === undefined ? undefined : Number(values[2]);
      if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 500)) {
        ctx.ui.notify("max-iterations must be an integer from 1 to 500.", "error");
        return;
      }

      try {
        const result = await runLoop(pi, ctx, { planPath, validationScript, maxIterations }, undefined, (partial) => {
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
    description: "Execute a Markdown checklist sequentially. Each iteration runs in a fresh isolated pi subagent, then an executable validation script decides whether that checklist item is checked. Failed validation retries the same item with the previous output and validation error log. Output is capped at 50 KB per context section.",
    promptSnippet: "Run a Markdown checklist through isolated, validated subagent iterations",
    promptGuidelines: [
      "Use loop when the user provides a Markdown checklist plan and an executable validation script for autonomous sequential implementation.",
    ],
    parameters: Type.Object({
      planPath: Type.String({ description: "Path to the Markdown checklist plan, relative to the working directory or absolute" }),
      validationScript: Type.String({ description: "Path to an executable validation script, relative to the working directory or absolute" }),
      maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: `Safety limit across successful and failed attempts; default ${DEFAULT_MAX_ITERATIONS}` })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return runLoop(pi, ctx, params, signal, onUpdate as LoopUpdate | undefined);
    },
  });
}
