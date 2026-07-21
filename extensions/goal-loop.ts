/**
 * Goal Loop
 *
 * Drives a plan one verified commit at a time. The agent implements a single
 * plan step, then MUST call goal_loop({ action: "verify", ... }). Verification
 * runs the project's full validation suite. Passing work is committed; failed
 * work is reset to the previous commit so the agent can retry from a clean
 * baseline. The agent calls complete only after inspecting the plan and
 * finding no remaining steps.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface GoalState {
  active: boolean;
  planPath: string;
  baseline: string;
  retries: number;
  maxRetries: number;
  currentStep: string;
  lastResult: string;
  lastCommit?: string;
}

const DEFAULT_PLAN = "plans/migration-svelte.md";
const VALIDATION_TIMEOUT = 30 * 60 * 1000;
const OUTPUT_LIMIT = 8_000;

function blankState(): GoalState {
  return {
    active: false,
    planPath: DEFAULT_PLAN,
    baseline: "",
    retries: 0,
    maxRetries: 3,
    currentStep: "",
    lastResult: "",
  };
}

function clipped(result: { stdout: string; stderr: string }) {
  const text = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
  return text.length > OUTPUT_LIMIT ? `…${text.slice(-OUTPUT_LIMIT)}` : text;
}

export default function goalLoop(pi: ExtensionAPI) {
  let state = blankState();
  let continuationQueued = false;

  function persist() {
    pi.appendEntry("goal-loop-state", state);
  }

  function updateStatus(ctx: ExtensionContext) {
    if (!state.active) {
      ctx.ui.setStatus("goal-loop", undefined);
      ctx.ui.setWidget("goal-loop", undefined);
      return;
    }
    const retry = state.retries ? ` · retry ${state.retries}/${state.maxRetries}` : "";
    ctx.ui.setStatus("goal-loop", `🎯 ${state.currentStep || "choosing step"}${retry}`);
    ctx.ui.setWidget("goal-loop", [
      `🎯 Goal loop active — ${state.currentStep || "inspect the plan for the next step"}`,
      `Plan: ${state.planPath} · baseline: ${state.baseline || "not captured"}${retry}`,
      "Implement one step, then call goal_loop verify. Passing work is committed; failures reset and retry.",
    ]);
  }

  async function command(command: string, args: string[], ctx: ExtensionContext, timeout = 60_000) {
    return pi.exec(command, args, { cwd: ctx.cwd, signal: ctx.signal, timeout });
  }

  async function validation(ctx: ExtensionContext, onUpdate?: (value: any) => void) {
    const checks: Array<{ label: string; command: string; args: string[]; cwd?: string }> = [
      { label: "build", command: "npm", args: ["run", "build"] },
      { label: "unit tests", command: "npm", args: ["test"] },
      { label: "Docker build", command: "docker", args: ["build", "-t", "pi-lot-ui", "."] },
      { label: "full e2e", command: "npm", args: ["test"], cwd: "tests/e2e" },
    ];
    const reports: string[] = [];
    for (const check of checks) {
      onUpdate?.({ content: [{ type: "text", text: `Running ${check.label}…` }] });
      const result = await pi.exec(check.command, check.args, {
        cwd: check.cwd ? `${ctx.cwd}/${check.cwd}` : ctx.cwd,
        signal: ctx.signal,
        timeout: VALIDATION_TIMEOUT,
      });
      reports.push(`## ${check.label} (exit ${result.code})\n${clipped(result)}`);
      if (result.code !== 0 || result.killed) return { ok: false, reports };
    }
    return { ok: true, reports };
  }

  async function resetToBaseline(ctx: ExtensionContext) {
    // baseline is always advanced only after a successful commit. Cleaning
    // untracked files is deliberate: they are part of a failed step too.
    const reset = await command("git", ["reset", "--hard", state.baseline], ctx);
    const clean = await command("git", ["clean", "-fd"], ctx);
    return `${clipped(reset)}\n${clipped(clean)}`.trim();
  }

  pi.registerCommand("goal-loop", {
    description: "Start, inspect, or stop verified plan execution: /goal-loop start [plan], status, stop",
    handler: async (args, ctx) => {
      const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (action === "status") {
        ctx.ui.notify(state.active
          ? `Goal loop: ${state.currentStep || "choosing step"}; baseline ${state.baseline}; retries ${state.retries}/${state.maxRetries}`
          : "Goal loop is inactive.", "info");
        return;
      }
      if (action === "stop") {
        state = { ...blankState(), lastResult: "Stopped by user." };
        persist();
        updateStatus(ctx);
        ctx.ui.notify("Goal loop stopped. Working tree was left unchanged.", "info");
        return;
      }
      if (action !== "start") {
        ctx.ui.notify("Usage: /goal-loop start [plan-path] | status | stop", "warning");
        return;
      }
      const planPath = rest.join(" ") || DEFAULT_PLAN;
      const dirty = await command("git", ["status", "--porcelain"], ctx);
      if (dirty.code !== 0) {
        ctx.ui.notify(`Cannot start goal loop: ${clipped(dirty)}`, "error");
        return;
      }
      if (dirty.stdout.trim()) {
        ctx.ui.notify("Commit or stash existing work before starting; goal-loop resets failed steps.", "warning");
        return;
      }
      const head = await command("git", ["rev-parse", "HEAD"], ctx);
      const plan = await command("test", ["-f", planPath], ctx);
      if (head.code !== 0 || plan.code !== 0) {
        ctx.ui.notify(head.code !== 0 ? "Goal loop requires a Git repository." : `Plan not found: ${planPath}`, "error");
        return;
      }
      state = {
        active: true,
        planPath,
        baseline: head.stdout.trim(),
        retries: 0,
        maxRetries: 3,
        currentStep: "inspect plan and choose one incomplete step",
        lastResult: "Started",
      };
      persist();
      updateStatus(ctx);
      await pi.sendUserMessage(
        `Start the verified goal loop using ${planPath}. Read the plan and implement exactly one remaining incomplete step. ` +
        "Before declaring it done, call goal_loop with action=verify, a precise step description, and a meaningful commit message. " +
        "After a passing verification/commit, inspect the plan again and continue with the next step. Call goal_loop complete only when no steps remain.",
      );
    },
  });

  pi.registerTool({
    name: "goal_loop",
    label: "Goal Loop",
    description: "Controls verified plan execution: inspect status, run full validation then commit a completed step, or finish when no plan steps remain.",
    promptSnippet: "Verify and commit each completed plan step, with rollback/retry on validation failure",
    promptGuidelines: [
      "When goal_loop is active, use goal_loop verify after every implementation step before claiming success.",
      "Use goal_loop complete only after reading the configured plan and confirming that no incomplete steps remain.",
      "After a goal_loop verification failure, work from the reset baseline and retry the same step; do not manually commit or reset it.",
    ],
    parameters: Type.Object({
      action: StringEnum(["status", "verify", "complete"] as const),
      step: Type.Optional(Type.String({ description: "Precise plan step being verified" })),
      commitMessage: Type.Optional(Type.String({ description: "Meaningful imperative Git commit message for a passing step" })),
      result: Type.Optional(Type.String({ description: "Completion summary when action is complete" })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Goal loop cancelled");
      if (params.action === "status") {
        return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], details: { ...state } };
      }
      if (!state.active) throw new Error("Goal loop is inactive. Start it with /goal-loop start [plan-path].");
      if (params.action === "complete") {
        state = { ...state, active: false, currentStep: "", lastResult: params.result?.trim() || "No remaining plan steps." };
        persist();
        updateStatus(ctx);
        return {
          content: [{ type: "text", text: `Goal loop complete. ${state.lastResult}` }],
          details: { ...state },
          terminate: true,
        };
      }
      const step = params.step?.trim();
      const commitMessage = params.commitMessage?.trim();
      if (!step || !commitMessage) throw new Error("verify requires both step and commitMessage.");
      if (commitMessage.length > 200) throw new Error("commitMessage must be 200 characters or fewer.");

      state = { ...state, currentStep: step, lastResult: "Validation running" };
      persist();
      updateStatus(ctx);
      const checked = await validation(ctx, onUpdate);
      if (!checked.ok) {
        const reset = await resetToBaseline(ctx);
        state = {
          ...state,
          retries: state.retries + 1,
          lastResult: `Validation failed; reset to ${state.baseline}.`,
        };
        persist();
        updateStatus(ctx);
        const exhausted = state.retries >= state.maxRetries;
        if (exhausted) {
          state = { ...state, active: false, lastResult: `Retry budget exhausted after ${state.retries} failed validations.` };
          persist();
          updateStatus(ctx);
        }
        return {
          content: [{ type: "text", text:
            `Validation FAILED for “${step}”. The worktree was reset to ${state.baseline}.\n\n` +
            `${checked.reports.join("\n\n")}\n\nReset output:\n${reset}\n\n` +
            (exhausted
              ? `Retry budget exhausted (${state.maxRetries}). Stop and report the failure to the user.`
              : `Retry ${state.retries}/${state.maxRetries}: diagnose the failure and reimplement the SAME step, then call goal_loop verify again.`),
          }],
          details: { ...state, reports: checked.reports },
          terminate: exhausted,
        };
      }

      const changed = await command("git", ["status", "--porcelain"], ctx);
      if (changed.code !== 0) throw new Error(`Could not inspect Git state: ${clipped(changed)}`);
      if (!changed.stdout.trim()) {
        state = { ...state, lastResult: "Validation passed but no changes were available to commit." };
        persist();
        return {
          content: [{ type: "text", text: "Validation passed, but there are no changes to commit. Recheck whether this plan step was already complete before continuing." }],
          details: { ...state, reports: checked.reports },
        };
      }
      const add = await command("git", ["add", "-A"], ctx);
      const commit = add.code === 0 ? await command("git", ["commit", "-m", commitMessage], ctx, VALIDATION_TIMEOUT) : add;
      if (commit.code !== 0) {
        state = { ...state, lastResult: `Commit failed: ${clipped(commit)}` };
        persist();
        throw new Error(`Validation passed but commit failed. Do not continue until resolved: ${clipped(commit)}`);
      }
      const head = await command("git", ["rev-parse", "HEAD"], ctx);
      state = {
        ...state,
        baseline: head.stdout.trim(),
        retries: 0,
        lastCommit: head.stdout.trim(),
        lastResult: `Validated and committed: ${commitMessage}`,
      };
      persist();
      updateStatus(ctx);
      return {
        content: [{ type: "text", text:
          `Validation PASSED and committed ${state.lastCommit}: ${commitMessage}.\n\n` +
          "Now read the plan. If a step remains, implement exactly one next step and call goal_loop verify again. If no steps remain, call goal_loop complete with a concise result.",
        }],
        details: { ...state, reports: checked.reports },
      };
    },
  });

  pi.on("before_agent_start", async () => {
    if (!state.active) return;
    return {
      message: {
        customType: "goal-loop-context",
        display: false,
        content: `[GOAL LOOP ACTIVE]
Plan: ${state.planPath}
Current step: ${state.currentStep || "choose one incomplete step"}
Baseline commit: ${state.baseline}
Retries: ${state.retries}/${state.maxRetries}

Implement exactly one plan step at a time. You MUST call goal_loop verify after changing code; it runs build, unit tests, Docker build, and full e2e, then commits only on success. On verification failure, the extension resets to the baseline—diagnose and retry. After every passing commit, inspect the plan for another incomplete step. Call goal_loop complete only when none remain.`,
      },
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!state.active || continuationQueued) return;
    continuationQueued = true;
    try {
      await pi.sendUserMessage(
        "Goal loop remains active. Continue the current plan step and call goal_loop verify before reporting success.",
        { deliverAs: "followUp" },
      );
    } finally {
      continuationQueued = false;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const entry = ctx.sessionManager.getEntries()
      .filter((item: { type: string; customType?: string }) => item.type === "custom" && item.customType === "goal-loop-state")
      .pop() as { data?: GoalState } | undefined;
    if (entry?.data) state = { ...blankState(), ...entry.data };
    updateStatus(ctx);
  });
}
