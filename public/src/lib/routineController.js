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

export function createRoutineSidebarController({
  listRoutines,
  isVisible,
  getSessionId,
  getScopeAll,
  setRoutines,
  setTotal,
  setScopeAll,
  setCurrentSessionId,
  setLoading,
}) {
  let items = [];
  let loadSequence = 0;

  function sync({ loading = false } = {}) {
    setRoutines(items.filter(isVisible));
    setTotal(items.length);
    setScopeAll(getScopeAll());
    setCurrentSessionId(getSessionId());
    setLoading(loading);
  }

  async function load() {
    const sequence = ++loadSequence;
    const sessionAtStart = getSessionId();
    setLoading(true);
    setRoutines([]);
    setScopeAll(getScopeAll());
    setCurrentSessionId(sessionAtStart);
    let loadedItems;
    try {
      loadedItems = await listRoutines();
    } catch { /* sidebar is best-effort */ }
    if (sequence !== loadSequence || sessionAtStart !== getSessionId()) return;
    if (loadedItems) items = loadedItems;
    sync({ loading: false });
  }

  function update(routine, reason) {
    const index = items.findIndex((item) => item.path === routine.path);
    if (reason === "deleted") {
      if (index !== -1) items.splice(index, 1);
    } else if (index === -1) items.push(routine);
    else items[index] = routine;
    sync();
  }

  return { get items() { return items; }, sync, load, update };
}
