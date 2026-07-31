import { createBrowserAppRuntimeStarter } from "./appRuntime.js";
import { createUiActionRegistry } from "./uiActionRegistry.js";
import { createDialogService } from "./dialogService.js";
import { createSettingsPreferenceService } from "./settingsPreferenceService.js";
import { createCheckpointModelPickerService } from "./checkpointModelPickerService.js";
import { createAuthBrowserService } from "./authBrowserService.js";
import { createBrowserActions } from "../platform/createBrowserActions.js";
import { createWorkspaceService } from "../features/workspaces/createWorkspaceService.js";
import { SETTINGS_CHANGED_ACTION } from "./uiActionNames.js";
import { closeModalState, openModal } from "../stores/modal.js";

/** Builds the browser/persistence adapters once per application mount. */
export function createBrowserApplicationScope({ windowTarget, documentTarget, locationTarget, historyTarget, storage, attachPageIntegrations = () => () => {}, createRuntimeStarter = createBrowserAppRuntimeStarter }) {
  const uiActions = createUiActionRegistry();
  const dialogs = createDialogService();
  const browserActions = createBrowserActions({ windowTarget, storage });
  const authBrowser = createAuthBrowserService({ storage, reload: () => locationTarget.reload() });
  const settingsPreferences = createSettingsPreferenceService({
    storage,
    rootElement: documentTarget.documentElement,
    themeColorElement: documentTarget.querySelector('meta[name="theme-color"]'),
    onThinkingVisibilityChanged: () => uiActions.invoke(SETTINGS_CHANGED_ACTION),
  });
  const checkpointModelPicker = createCheckpointModelPickerService({
    modelPreference: {
      get: () => storage.getItem("pi_ckpt_model") ?? "",
      set: (value) => storage.setItem("pi_ckpt_model", value),
    },
    modalShell: { open: openModal, close: closeModalState },
  });
  // Resolve fetch at call time because authentication wraps window.fetch when
  // the application runtime starts.
  const workspaceService = createWorkspaceService({ fetchImpl: (...args) => windowTarget.fetch(...args) });
  const startRuntime = createRuntimeStarter({ windowTarget, documentTarget, locationTarget, historyTarget, storage });

  let stopRuntime;
  let detachPageIntegrations;
  let disposed = false;
  return Object.freeze({
    services: { uiActions, dialogs, browserActions, authBrowser, settingsPreferences, checkpointModelPicker, workspaceService },
    async start() {
      if (disposed || detachPageIntegrations) return;
      detachPageIntegrations = attachPageIntegrations() ?? (() => {});
      const stop = await startRuntime({ uiActions, dialogs, browserActions, checkpointModelPicker });
      if (disposed) stop();
      else stopRuntime = stop;
    },
    teardown() {
      if (disposed) return;
      disposed = true;
      stopRuntime?.();
      detachPageIntegrations?.();
      detachPageIntegrations = undefined;
      dialogs.teardown();
      checkpointModelPicker.teardown();
      settingsPreferences.teardown();
      uiActions.teardown();
    },
  });
}
