<script>
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import Menu from "./components/Menu.svelte";
  import ChatLayout from "./components/ChatLayout.svelte";
  import Overlays from "./components/Overlays.svelte";
  import AuthGate from "./components/AuthGate.svelte";
  import { startAppRuntime } from "./runtime/appRuntime.js";
  import { createUiActionRegistry } from "./runtime/uiActionRegistry.js";
  import { provideUiActionRegistry } from "./runtime/uiActionContext.js";
  import { createDialogService } from "./runtime/dialogService.js";
  import { provideDialogService } from "./runtime/dialogServiceContext.js";
  import { createBrowserActions } from "./platform/createBrowserActions.js";
  import { provideBrowserActions } from "./runtime/browserActionsContext.js";
  import { SETTINGS_CHANGED_ACTION } from "./runtime/uiActionNames.js";
  import { createSettingsPreferenceService } from "./runtime/settingsPreferenceService.js";
  import { provideSettingsPreferences } from "./runtime/settingsPreferenceContext.js";
  import { createCheckpointModelPickerService } from "./runtime/checkpointModelPickerService.js";
  import { provideCheckpointModelPicker } from "./runtime/checkpointModelPickerContext.js";
  import { closeModalState, openModal } from "./stores/modal.js";

  const uiActions = provideUiActionRegistry(createUiActionRegistry());
  const settingsPreferences = provideSettingsPreferences(createSettingsPreferenceService({
    storage: localStorage,
    onThinkingVisibilityChanged: () => uiActions.invoke(SETTINGS_CHANGED_ACTION),
  }));
  const checkpointModelPicker = provideCheckpointModelPicker(createCheckpointModelPickerService({
    modelPreference: {
      get: () => localStorage.getItem("pi_ckpt_model") ?? "",
      set: (value) => localStorage.setItem("pi_ckpt_model", value),
    },
    modalShell: { open: openModal, close: closeModalState },
  }));
  const dialogs = provideDialogService(createDialogService());
  const browserActions = provideBrowserActions(createBrowserActions({ windowTarget: window }));

  onMount(() => {
    let teardown;
    let disposed = false;
    startAppRuntime({ uiActions, dialogs, browserActions, checkpointModelPicker }).then((dispose) => {
      if (disposed) dispose();
      else teardown = dispose;
    });
    return () => {
      disposed = true;
      teardown?.();
      dialogs.teardown();
      checkpointModelPicker.teardown();
      uiActions.teardown();
    };
  });
</script>

<Header />
<Menu />
<ChatLayout />
<Overlays />
<AuthGate />
