import { createRoutineSidebarController, createRoutineController } from "../../lib/routineController.js";

export function createRoutineRuntime(deps) {
  const sidebar = createRoutineSidebarController({
    listRoutines: deps.listRoutines,
    isVisible: deps.isVisible,
    getSessionId: deps.getSessionId,
    getScopeAll: deps.getScopeAll,
    setRoutines: deps.setRoutines,
    setTotal: deps.setTotal,
    setScopeAll: deps.setScopeAll,
    setCurrentSessionId: deps.setCurrentSessionId,
    setLoading: deps.setLoading,
  });
  const controller = createRoutineController({ runRoutine: deps.runRoutine, getSessionId: deps.getSessionId, refresh: () => sidebar.load(), toast: deps.toast });
  return {
    sidebar,
    controller,
    load: () => sidebar.load(),
    sync: (options) => sidebar.sync(options),
    teardown() { sidebar.teardown?.(); controller.teardown?.(); },
  };
}
