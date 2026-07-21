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
  return {
    files,
    hublots,
    routines,
    teardown() {
      files.teardown?.();
      routines.teardown();
      hublots.teardown();
    },
  };
}
