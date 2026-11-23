// Runs a Markdown checklist through Oyster's loop engine, one isolated subagent per item.
//
// The loop itself lives in the Oyster server (server/loops.mjs): it cuts each
// step out of the plan, runs it in a managed subagent, validates, checks the
// item off, and commits. This extension is the pi client of `POST /loops`; the
// MCP endpoint exposes the same engine to other harnesses.

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const OYSTER_URL = process.env.OYSTER_URL ?? "http://127.0.0.1:8080";

interface LoopParams {
  planPath: string;
  validationScript: string;
}

interface LoopResult {
  complete?: boolean;
  reason?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

type LoopEvent = LoopResult & { type?: string };
type LoopUpdate = (partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void;

async function readLoopStream(response: Response, onProgress: (event: LoopEvent) => void): Promise<LoopResult> {
  if (!response.body) throw new Error("Oyster loop response had no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let terminal: LoopResult | undefined;

  const consumeLines = (flush = false) => {
    const lines = buffered.split("\n");
    buffered = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: LoopEvent;
      try { event = JSON.parse(line); } catch { throw new Error("Oyster loop returned invalid NDJSON"); }
      if (event.type === "complete") terminal = event;
      else if (event.type === "progress") onProgress(event);
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
  if (!terminal) throw new Error("Oyster loop stream ended without a completion event");
  return terminal;
}

async function runLoop(
  ctx: ExtensionContext,
  params: LoopParams,
  signal?: AbortSignal,
  onUpdate?: LoopUpdate,
) {
  if (!ctx.sessionManager.isPersisted()) throw new Error("Loop requires a persisted Oyster parent session");
  const token = process.env.OYSTER_TOKEN?.trim();
  if (!token) throw new Error("OYSTER_TOKEN is required to run an Oyster loop");
  const response = await fetch(`${OYSTER_URL}/loops`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      planPath: params.planPath,
      validationScript: params.validationScript,
      dir: ctx.cwd,
      parentSessionId: ctx.sessionManager.getSessionId(),
    }),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as LoopResult;
    throw new Error(error.error ?? `Oyster loop request failed (${response.status})`);
  }
  const { type: _type, message, ...details } = await readLoopStream(response, (event) => {
    onUpdate?.({ content: [{ type: "text", text: event.message ?? "Loop running…" }], details: event });
  }) as LoopEvent;
  if (details.reason === "error") throw new Error(message ?? "Oyster loop failed");
  return { content: [{ type: "text" as const, text: message ?? "Loop finished." }], details };
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
        const result = await runLoop(ctx, { planPath, validationScript }, undefined, (partial) => {
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
    description: "Execute a Markdown checklist plan sequentially and autonomously. Each unchecked item runs in a fresh isolated subagent that receives only that step (with its nested detail and the plan's rule sections, never the other checklist items) and a short handoff from the previous step, never the whole plan. An executable validation script then decides whether the item is checked off and committed; a failed step is retried with the tail of its failure log. The call returns when every item is checked, or when one step fails to advance for 20 consecutive iterations. Write each checklist item so it is self-contained, with step-specific detail indented beneath it and shared rules in sections of their own, kept apart from the checklist.",
    promptSnippet: "Run a Markdown checklist through isolated, validated subagent iterations",
    promptGuidelines: [
      "Use loop when the user provides a Markdown checklist plan and an executable validation script for autonomous sequential implementation.",
    ],
    parameters: Type.Object({
      planPath: Type.String({ description: "Path to the Markdown checklist plan, relative to the working directory or absolute" }),
      validationScript: Type.String({ description: "Path to an executable validation script, relative to the working directory or absolute" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return runLoop(ctx, params, signal, onUpdate as LoopUpdate | undefined);
    },
  });
}
