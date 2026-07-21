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

  const uiActions = provideUiActionRegistry(createUiActionRegistry());

  onMount(() => {
    let teardown;
    let disposed = false;
    startAppRuntime({ uiActions }).then((dispose) => {
      if (disposed) dispose();
      else teardown = dispose;
    });
    return () => {
      disposed = true;
      teardown?.();
      uiActions.teardown();
    };
  });
</script>

<Header />
<Menu />
<ChatLayout />
<Overlays />
<AuthGate />
