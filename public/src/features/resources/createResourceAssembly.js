import { createFilesRuntime } from "../files/createFilesRuntime.js";
import { createHublotRuntime } from "../hublots/createHublotRuntime.js";
import { createRoutineRuntime } from "../routines/createRoutineRuntime.js";
import { configureFileExplorerActions } from "../files/fileExplorerActions.js";
import { configureFilesActions } from "../files/filesActions.js";
import { configureHublotActions } from "../hublots/hublotActions.js";
import { configureRoutineActions } from "../routines/routineActions.js";
import {
  FILE_PICKER_BROWSE_ACTION,
  FILE_PICKER_CANCEL_ACTION,
  FILE_PICKER_CHOOSE_ACTION,
  FILE_PICKER_USE_FOLDER_ACTION,
  FOLDER_BROWSER_BROWSE_ACTION,
  FOLDER_BROWSER_CANCEL_ACTION,
  FOLDER_BROWSER_CREATE_ACTION,
  FOLDER_BROWSER_SUBMIT_ACTION,
} from "../../runtime/uiActionNames.js";

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
  const actionDetachers = [];
  return {
    files,
    hublots,
    routines,
    operations,
    configureActions(actions) {
      if (actionDetachers.length) return;
      actionDetachers.push(
        deps.uiActions.register(FILE_PICKER_BROWSE_ACTION, actions.filePicker.browse),
        deps.uiActions.register(FILE_PICKER_CHOOSE_ACTION, actions.filePicker.pick),
        deps.uiActions.register(FILE_PICKER_USE_FOLDER_ACTION, actions.filePicker.useFolder),
        deps.uiActions.register(FILE_PICKER_CANCEL_ACTION, actions.filePicker.cancel),
        deps.uiActions.register(FOLDER_BROWSER_BROWSE_ACTION, actions.folderBrowser.browse),
        deps.uiActions.register(FOLDER_BROWSER_CREATE_ACTION, actions.folderBrowser.create),
        deps.uiActions.register(FOLDER_BROWSER_SUBMIT_ACTION, actions.folderBrowser.submit),
        deps.uiActions.register(FOLDER_BROWSER_CANCEL_ACTION, actions.folderBrowser.cancel),
        configureFileExplorerActions(actions.fileExplorer),
        configureFilesActions(actions.files),
        configureHublotActions(actions.hublots),
        configureRoutineActions(actions.routine),
      );
    },
    teardown() {
      if (tornDown) return;
      tornDown = true;
      actionDetachers.splice(0).reverse().forEach((detach) => detach());
      files.teardown?.();
      routines.teardown();
      hublots.teardown();
    },
  };
}
