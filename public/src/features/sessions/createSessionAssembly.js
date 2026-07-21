import { createLazySessionFeature } from "./createSessionFeature.js";
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
  const runnerState = createSessionRunnerState({ storage: deps.storage, updateAppSession: deps.updateAppSession });
  const sessionUi = createSessionUiRuntime({ updateAppSession: deps.updateAppSession, updateHeaderState: deps.updateHeaderState });
  const previewController = createSessionPreviewController(deps.preview);
  const sessionOpenController = createSessionOpenController({ ...deps.open, preview: previewController });
  const applyState = createSessionStateApplier({
    ...deps.stateApplier,
    hooks: { ...deps.stateApplier.hooks, syncUrlToSession },
  });
  const sessionFeature = createLazySessionFeature({
    createRuntime: createSessionRuntime,
    getDependencies: () => deps.featureDependencies({ sessionOpenController, previewController }),
  });
  let refresher = null;

  return {
    route,
    syncUrlToSession,
    runnerState,
    sessionUi,
    previewController,
    sessionOpenController,
    applyState,
    sessionFeature,
    configureRefresh(refreshDependencies) {
      return refresher ??= createSessionStateRefresher(refreshDependencies);
    },
    teardown() {
      sessionFeature.teardown();
      refresher = null;
    },
  };
}
