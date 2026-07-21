import { createFilesRuntime } from "../files/createFilesRuntime.js";
import { createHublotRuntime } from "../hublots/createHublotRuntime.js";
import { createRoutineRuntime } from "../routines/createRoutineRuntime.js";

/** Composes file, hublot, and routine resources behind one lifecycle boundary. */
export function createResourceAssembly(deps) {
  const buildHublots = deps.createHublotRuntime ?? createHublotRuntime;
  const buildRoutines = deps.createRoutineRuntime ?? createRoutineRuntime;
  const buildFiles = deps.createFilesRuntime ?? createFilesRuntime;
  let tornDown = false;
  let routines;
  const hublots = buildHublots({
    ...deps.hublots,
    refreshRoutines: (options) => !tornDown && routines?.sync(options),
  });
  routines = buildRoutines({
    ...deps.routines,
    getScopeAll: hublots.getScopeAll,
    isVisible: (routine) => deps.routines.isVisible(routine, hublots.getScopeAll()),
  });
  const files = buildFiles(deps.files);
  const active = (fn, ...args) => !tornDown ? fn(...args) : undefined;
  const operations = Object.freeze({
    getScopeAll: () => active(hublots.getScopeAll),
    toggleScope: (...args) => active(hublots.toggleScope, ...args),
    loadHublots: (...args) => active(hublots.load, ...args),
    loadRoutines: (...args) => active(routines.load, ...args),
    syncRoutines: (...args) => active(routines.sync, ...args),
    showHublots: (...args) => active(hublots.show, ...args),
    showFileExplorer: (workdir) => active(files.explorer.show, workdir),
    createHublot: (...args) => active(hublots.create, ...args),
    runRoutine: (...args) => active(routines.controller.run, ...args),
    updateRoutine: (...args) => active(routines.sidebar.update, ...args),
    getRoutineItems: () => !tornDown ? routines.sidebar.items : [],
  });
  return {
    files,
    hublots,
    routines,
    operations,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      files.teardown?.();
      routines.teardown();
      hublots.teardown();
    },
  };
}
