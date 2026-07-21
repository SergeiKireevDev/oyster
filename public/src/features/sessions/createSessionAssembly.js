import { createLazySessionFeature } from "./createSessionFeature.js";
import { createSessionPickerRuntime } from "./createSessionPickerRuntime.js";
import { createSessionBootController } from "../../runtime/sessionBootController.js";
import { createSessionBootDependencies } from "../../runtime/sessionBootDependencies.js";
import {
  createSessionOpenController,
  createSessionPreviewController,
  createSessionRunnerState,
  createSessionRuntime,
  createSessionStateApplier,
  createSessionStateRefresher,
  createSessionUiRuntime,
  parseSessionRoute,
  syncSessionUrl,
} from "../../runtime/sessionRuntime.js";

/** Constructs session route, runner, hydration, preview, and refresh controllers. */
export function createSessionAssembly(deps) {
  const route = parseSessionRoute(deps.location.pathname);
  const syncUrlToSession = (sessionId) => syncSessionUrl({ location: deps.location, history: deps.history, sessionId });
  const runnerState = createSessionRunnerState({ storage: deps.storage, updateAppSession: deps.updateAppSession, onRunnerChange: deps.onRunnerChange });
  let state = null;
  let currentRunner = runnerState.currentRunner;
  let runners = runnerState.runners;
  const sessionUi = createSessionUiRuntime({ updateAppSession: deps.updateAppSession, updateHeaderState: deps.updateHeaderState });
  const previewController = createSessionPreviewController(deps.preview);
  const sessionOpenController = createSessionOpenController({ ...deps.open, preview: previewController });
  const applyState = createSessionStateApplier({
    ...deps.stateApplier,
    getState: () => state,
    setState: (next) => { state = next; },
    getCurrentRunner: () => currentRunner,
    hooks: {
      ...deps.stateApplier.hooks,
      log: (sessionChanged) => deps.stateApplier.hooks.log(sessionChanged, state),
      syncUrlToSession,
    },
  });
  const sessionFeature = createLazySessionFeature({
    createRuntime: createSessionRuntime,
    getDependencies: () => deps.featureDependencies({ sessionOpenController, previewController }),
  });
  let refresher = null;
  let pickerRuntime = null;
  let bootController = null;
  let runnersUpdateHandler = null;
  const emptyRunners = new Set();

  const operations = {
    boot: (...args) => bootController(...args),
    getState: () => state,
    getCurrentRunner: () => currentRunner,
    getRunnerGeneration: () => runnerState.generation,
    getRunners: () => runners,
    getWorkdir: () => sessionUi.workdir,
    getBusy: () => sessionUi.busy,
    setRunner: (id) => { currentRunner = runnerState.setRunner(id); return currentRunner; },
    adoptRunner: (id) => { currentRunner = runnerState.adoptRunner(id); return currentRunner; },
    setRunners: (next) => { runners = runnerState.setRunners(next); return runners; },
    getRuntime: () => sessionFeature.get(),
    openSession: (...args) => sessionFeature.get().openSession(...args),
    switchRunner: (...args) => sessionFeature.get().switchRunner(...args),
    refresh: (...args) => refresher?.(...args),
    applyState,
    clearPreview: () => previewController.clear(),
    renderPreview: () => previewController.renderNow(),
    setWorkdir: (dir) => sessionUi.setWorkdir(dir),
    setBusy: (value) => sessionUi.setBusy(value),
    updateUsage: (message) => sessionUi.updateUsage(message),
    setRunnersUpdateHandler: (handler) => { runnersUpdateHandler = handler; },
    notifyRunnersChanged: (next) => runnersUpdateHandler?.(next),
    getEmptyRunners: () => emptyRunners,
    markEmptyRunner: (id) => emptyRunners.add(id),
    isEmptyRunner: (id) => emptyRunners.has(id),
  };

  return {
    operations,
    configureRefresh(refreshDependencies) {
      return refresher ??= createSessionStateRefresher(refreshDependencies);
    },
    configurePicker(pickerDependencies) {
      return pickerRuntime ??= createSessionPickerRuntime(pickerDependencies);
    },
    configureBoot(bootDependencies) {
      return bootController ??= createSessionBootController(createSessionBootDependencies({ route, ...bootDependencies }));
    },
    teardown() {
      pickerRuntime?.detachActions?.();
      sessionFeature.teardown();
      refresher = null;
      pickerRuntime = null;
      bootController = null;
      runnersUpdateHandler = null;
    },
  };
}
