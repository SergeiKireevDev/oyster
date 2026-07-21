<script>
  import { menuOpen } from "../stores/ui.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { CREDENTIALS_OPEN_ACTION, MENU_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function close() {
    menuOpen.set(false);
  }

  function run(action) {
    close();
    uiActions.invoke(MENU_ACTION, action);
  }

  function openCredentials() {
    close();
    uiActions.invoke(CREDENTIALS_OPEN_ACTION);
  }
</script>

<svelte:document onclick={close} />

<div id="menu" role="menu" tabindex="-1" class:open={$menuOpen} onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
  <button data-action="compact" onclick={() => run("compact")}>Compact context</button>
  <button data-action="analytics" onclick={() => run("analytics")}>Usage analytics…</button>
  <button data-action="credentials" onclick={openCredentials}>Credentials…</button>
  <button data-action="settings" onclick={() => run("settings")}>Settings…</button>
  <button data-action="restart" onclick={() => run("restart")}>Restart pi process</button>
  <button data-action="logout" onclick={() => run("logout")}>Forget token</button>
</div>
