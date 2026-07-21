<script>
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import Menu from "./components/Menu.svelte";
  import ChatLayout from "./components/ChatLayout.svelte";
  import Overlays from "./components/Overlays.svelte";
  import AuthGate from "./components/AuthGate.svelte";

  onMount(() => {
    import("./legacy.js");
  });
</script>

<Header />
<Menu />
<ChatLayout />
<Overlays />
<AuthGate />
