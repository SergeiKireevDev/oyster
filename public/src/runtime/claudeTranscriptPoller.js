/** Poll the durable Claude transcript only while the selected runner uses Claude Code. */
export function createClaudeTranscriptPoller({
  getRunner,
  sync,
  reload,
  intervalMs = 2000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  onError = () => {},
} = {}) {
  if (typeof getRunner !== "function" || typeof sync !== "function" || typeof reload !== "function") {
    throw new TypeError("Claude transcript poller requires getRunner, sync, and reload functions");
  }
  let timer = null;
  let running = false;
  let disposed = false;

  async function tick() {
    if (disposed || running) return;
    const runner = getRunner();
    if (!runner || runner.harness !== "claude-code" || !runner.sessionId) return;
    const identity = `${runner.id}:${runner.sessionId}`;
    running = true;
    try {
      const result = await sync(runner);
      const current = getRunner();
      if (result?.changed && current && `${current.id}:${current.sessionId}` === identity) await reload();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  return Object.freeze({
    tick,
    start() {
      if (disposed || timer) return;
      void tick();
      timer = setIntervalImpl(() => { void tick(); }, intervalMs);
      timer?.unref?.();
    },
    teardown() {
      disposed = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
    },
  });
}
