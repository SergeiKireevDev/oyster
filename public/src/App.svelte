<script>
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import Menu from "./components/Menu.svelte";
  import ChatLayout from "./components/ChatLayout.svelte";
  import Overlays from "./components/Overlays.svelte";
  import AuthGate from "./components/AuthGate.svelte";
  import { provideUiActionRegistry } from "./runtime/uiActionContext.js";
  import { provideDialogService } from "./runtime/dialogServiceContext.js";
  import { provideBrowserActions } from "./runtime/browserActionsContext.js";
  import { provideSettingsPreferences } from "./runtime/settingsPreferenceContext.js";
  import { provideCheckpointModelPicker } from "./runtime/checkpointModelPickerContext.js";
  import { provideAuthBrowser } from "./runtime/authBrowserContext.js";
  import { provideWorkspaceService } from "./runtime/workspaceServiceContext.js";

  export let applicationScope;

  provideUiActionRegistry(applicationScope.services.uiActions);
  provideDialogService(applicationScope.services.dialogs);
  provideBrowserActions(applicationScope.services.browserActions);
  provideSettingsPreferences(applicationScope.services.settingsPreferences);
  provideCheckpointModelPicker(applicationScope.services.checkpointModelPicker);
  provideAuthBrowser(applicationScope.services.authBrowser);
  provideWorkspaceService(applicationScope.services.workspaceService);

  onMount(() => {
    applicationScope.start();
    return () => applicationScope.teardown();
  });
</script>

<Header />
<Menu />
<ChatLayout />
<Overlays />
<AuthGate />
