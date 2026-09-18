import { signalProcessGroup, STOP_GRACE_MS } from "./process-groups.mjs";

/** Run a one-shot agent that authors and registers a routine through the
 * bundled routine tool. The target session is explicit because this agent
 * deliberately has no durable session of its own. */
export function spawnRoutineAgent(state, { brief, sessionId }) {
  const text = String(brief ?? "").trim();
  if (!text) throw new Error("describe the routine to create");
  if (!sessionId) throw new Error("a current session is required to create a routine");
  const runner = [...state.runners.values()].find((candidate) => candidate.sessionId === sessionId);
  const cwd = runner?.dir ?? state.currentDir;
  const prompt = [
    "Create one durable oyster routine for the user request below.",
    "Use the routine tool with action=create and session_id exactly as supplied.",
    "Write the complete self-contained script yourself. It MUST handle both run and teardown,",
    "teardown MUST remove every byproduct made by run, it must not require interactive input,",
    "Plan explicit weighted steps for both modes and emit monotonic ::progress <0-100> <message> lines",
    "at startup, before and after every meaningful step, and at 100% only after success.",
    "For long-running steps, relay native done/total counts, subdivide or poll when possible,",
    "or emit a newline-flushed heartbeat at least every 30 seconds so progression never stalls.",
    "Do not merely write a file and do not start the routine. Choose a concise .sh name.",
    `Target session_id: ${sessionId}`,
    `User request: ${text}`,
  ].join("\n");

  return new Promise((resolvePromise, reject) => {
    const proc = state.piProcesses.ephemeral(["--no-session", "-p", prompt], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let tail = "";
    const capture = (chunk) => { tail = (tail + String(chunk)).slice(-3000); };
    proc.stdout.on("data", capture);
    proc.stderr.on("data", capture);
    let forceTimer = null;
    const timeout = setTimeout(() => {
      signalProcessGroup(proc, "SIGTERM");
      forceTimer = setTimeout(() => signalProcessGroup(proc, "SIGKILL"), STOP_GRACE_MS);
      forceTimer.unref();
      reject(new Error("timed out while the routine agent was working"));
    }, 5 * 60 * 1000);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
    };
    proc.once("error", (error) => {
      clearTimers();
      reject(new Error(`failed to spawn routine agent: ${error.message}`));
    });
    proc.once("exit", (code, signal) => {
      clearTimers();
      if (code === 0) resolvePromise({ output: tail.trim() });
      else reject(new Error(`routine agent exited (${signal ?? code}): ${tail.trim().split("\n").at(-1) ?? "unknown error"}`));
    });
    proc.unref();
  });
}
