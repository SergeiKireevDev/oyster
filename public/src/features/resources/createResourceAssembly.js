import { createFilesRuntime } from "../files/createFilesRuntime.js";
import { createHublotRuntime } from "../hublots/createHublotRuntime.js";
import { createRoutineRuntime } from "../routines/createRoutineRuntime.js";

/** Composes file, hublot, and routine resources behind one lifecycle boundary. */
export function createResourceAssembly(deps) {
  const buildHublots = deps.createHublotRuntime ?? createHublotRuntime;
  const buildRoutines = deps.createRoutineRuntime ?? createRoutineRuntime;
  const buildFiles = deps.createFilesRuntime ?? createFilesRuntime;
  let routines;
  const hublots = buildHublots({
    ...deps.hublots,
    refreshRoutines: (options) => routines?.sync(options),
  });
  routines = buildRoutines({
    ...deps.routines,
    getScopeAll: hublots.getScopeAll,
    isVisible: (routine) => deps.routines.isVisible(routine, hublots.getScopeAll()),
  });
  const files = buildFiles(deps.files);
  const operations = Object.freeze({
    getScopeAll: hublots.getScopeAll,
    toggleScope: (...args) => hublots.toggleScope(...args),
    loadHublots: (...args) => hublots.load(...args),
    loadRoutines: (...args) => routines.load(...args),
    syncRoutines: (...args) => routines.sync(...args),
    showHublots: (...args) => hublots.show(...args),
    showFileExplorer: (workdir) => files.explorer.show(workdir),
    createHublot: (...args) => hublots.create(...args),
    runRoutine: (...args) => routines.controller.run(...args),
    updateRoutine: (...args) => routines.sidebar.update(...args),
    getRoutineItems: () => routines.sidebar.items,
  });
  return {
    files,
    hublots,
    routines,
    operations,
    teardown() {
      files.teardown?.();
      routines.teardown();
      hublots.teardown();
    },
  };
}
