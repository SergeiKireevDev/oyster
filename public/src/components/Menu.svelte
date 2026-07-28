<script>
  import AppIcon from "./AppIcon.svelte";
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
  <button role="menuitem" data-action="analytics" onclick={() => run("analytics")}><span class="menu-option-icon"><AppIcon name="analytics" size={17} /></span><span>Usage analytics…</span></button>
  <button role="menuitem" data-action="credentials" onclick={openCredentials}><span class="menu-option-icon"><AppIcon name="key" size={17} /></span><span>Credentials…</span></button>
  <button role="menuitem" data-action="settings" onclick={() => run("settings")}><span class="menu-option-icon"><AppIcon name="settings" size={17} /></span><span>Settings…</span></button>
  <button role="menuitem" class="menu-logout" data-action="logout" onclick={() => run("logout")}><span class="menu-option-icon"><AppIcon name="logout" size={17} /></span><span>Log out</span></button>
</div>
