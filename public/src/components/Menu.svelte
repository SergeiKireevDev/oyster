<script>
  import { menuOpen } from "../stores/ui.js";
  import { runMenuAction } from "../lib/legacyBridge.js";

  function close() {
    menuOpen.set(false);
  }

  async function run(action) {
    close();
    await runMenuAction(action);
  }
</script>

<svelte:document onclick={close} />

<div id="menu" role="menu" tabindex="-1" class:open={$menuOpen} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
  <button data-action="newSession" onclick={() => run("newSession")}>New session</button>
  <button data-action="newSessionIn" onclick={() => run("newSessionIn")}>New session in folder…</button>
  <button data-action="sessions" onclick={() => run("sessions")}>Sessions…</button>
  <button data-action="compact" onclick={() => run("compact")}>Compact context</button>
  <button data-action="settings" onclick={() => run("settings")}>Settings…</button>
  <button data-action="restart" onclick={() => run("restart")}>Restart pi process</button>
  <button data-action="logout" onclick={() => run("logout")}>Forget token</button>
</div>
