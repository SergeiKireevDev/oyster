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

  const uiActions = provideUiActionRegistry(createUiActionRegistry());
  const dialogs = provideDialogService(createDialogService());
  const browserActions = provideBrowserActions(createBrowserActions({ windowTarget: window }));

  onMount(() => {
    let teardown;
    let disposed = false;
    startAppRuntime({ uiActions, dialogs, browserActions }).then((dispose) => {
      if (disposed) dispose();
      else teardown = dispose;
    });
    return () => {
      disposed = true;
      teardown?.();
      dialogs.teardown();
      uiActions.teardown();
    };
  });
</script>

<Header />
<Menu />
<ChatLayout />
<Overlays />
<AuthGate />
