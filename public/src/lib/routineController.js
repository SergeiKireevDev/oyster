export function createRoutineController({ runRoutine, getSessionId, refresh, toast }) {
  async function run(name, action) {
    try {
      await runRoutine({ name, action, sessionId: getSessionId() });
    } catch (error) {
      toast(`routine ${action} failed: ${error.message}`, "error");
    }
    refresh();
  }
  return { run };
}
