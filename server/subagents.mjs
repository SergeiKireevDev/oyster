import { errorMessage } from "./errors.mjs";
import { isNonArrayObject as isJsonObject } from "./valuePredicates.mjs";

const SUBAGENT_TIMEOUT_MINUTES = 30;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = SUBAGENT_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

function failure(fallback, error, output) {
  return {
    ok: false,
    output,
    errorLog: error === undefined || error === null || error === "" ? fallback : errorMessage(error),
  };
}

function assistantText(message) {
  return (Array.isArray(message.content) ? message.content : [])
    .filter((part) => isJsonObject(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Managed child runners that execute one prompt and stop.
 *
 * A subagent is a persisted child session of `parentSessionId`. `run` resolves
 * with the final assistant text once the agent settles, fails, times out, or
 * the caller aborts; the child runner is always stopped before it resolves.
 * Both the `/subagents` route and the loop engine drive subagents through this
 * one lifecycle.
 */
export function createSubagentService({
  spawnRunner, observeRunner, sendToRunner, stopRunner,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
  timeoutMs = DEFAULT_SUBAGENT_TIMEOUT_MS,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("subagent timeoutMs must be a positive finite number");
  const available = [spawnRunner, observeRunner, sendToRunner, stopRunner].every((dependency) => typeof dependency === "function");

  async function start({ dir, parentSessionId, name }) {
    if (!available) throw new Error("managed subagents are unavailable");
    return spawnRunner({
      dir,
      autostart: false,
      // The loop tool is withheld so an iteration cannot start a nested loop.
      initialArgs: ["--parent-session", parentSessionId, "--name", name, "--exclude-tools", "loop"],
    });
  }

  async function run(runner, prompt, { signal } = {}) {
    let observerDispose = null;
    let disposeRequested = false;
    let timer = null;
    let done = false;
    let resolveCompletion;
    let assistantOutput = "";
    let assistantError = "";
    const completion = new Promise((resolvePromise) => { resolveCompletion = resolvePromise; });
    const dispose = () => {
      if (!observerDispose) {
        disposeRequested = true;
        return;
      }
      try { observerDispose(); } catch {}
      observerDispose = null;
    };
    const finish = (result) => {
      if (done) return;
      done = true;
      dispose();
      if (timer !== null) clearTimeoutImpl(timer);
      resolveCompletion(result);
    };
    const fail = (fallback, error) => finish(failure(fallback, error, assistantOutput));

    const rememberAssistantMessage = (message) => {
      const text = assistantText(message);
      if (text) assistantOutput = text;
      if (["error", "aborted"].includes(message.stopReason)) {
        assistantError = typeof message.errorMessage === "string" && message.errorMessage
          ? message.errorMessage
          : `assistant stopped: ${message.stopReason}`;
      }
    };
    const observeEvent = (event) => {
      if (!isJsonObject(event)) return;
      if (event.type === "message_end" && event.message?.role === "assistant") rememberAssistantMessage(event.message);
      else if (event.type === "agent_settled") finish({ ok: !assistantError, output: assistantOutput, errorLog: assistantError });
      else if (event.type === "response" && event.command === "prompt" && event.success === false) fail("Subagent prompt was rejected.", event.error);
      else if (event.type === "pi_error") fail("Subagent process failed.", event.error);
      else if (event.type === "pi_exit") {
        const signalSuffix = event.signal ? ` (${event.signal})` : "";
        fail(`Subagent exited before settling${signalSuffix}.`);
      }
    };

    try {
      observerDispose = observeRunner(runner, observeEvent);
      if (typeof observerDispose !== "function") throw new TypeError("observeRunner must return a disposal function");
      if (disposeRequested) dispose();
    } catch (error) {
      fail("Unable to observe subagent process.", error);
    }

    if (!done) {
      timer = setTimeoutImpl(() => fail("Subagent timed out."), timeoutMs);
      timer?.unref?.();
    }

    const cancel = () => fail("Subagent request was cancelled.");
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    runner.subagentStatus = "running";
    if (!done) {
      try {
        if (!await sendToRunner(runner, { type: "prompt", message: prompt })) fail("Subagent process was unavailable.");
      } catch (error) {
        fail("Subagent process was unavailable.", error);
      }
    }
    let result = await completion;
    signal?.removeEventListener("abort", cancel);
    runner.subagentStatus = result.ok ? "succeeded" : "failed";
    try {
      await stopRunner(runner);
    } catch (error) {
      result = { ok: false, output: result.output, errorLog: `Failed to stop subagent: ${errorMessage(error)}` };
      runner.subagentStatus = "failed";
    }
    return result;
  }

  return { available, start, run };
}
