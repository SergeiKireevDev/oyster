<script>
  import AppIcon from "./AppIcon.svelte";
  import { menuOpen } from "../stores/ui.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { CREDENTIALS_OPEN_ACTION, MENU_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let returnFocusElement;

  function close() {
    menuOpen.set(false);
  }

  function focusWhenOpened(node, open) {
    function update(nextOpen) {
      if (nextOpen && !open) {
        returnFocusElement = node.ownerDocument.activeElement;
        queueMicrotask(() => {
          if ($menuOpen) node.focus();
        });
      }
      open = nextOpen;
    }

    const initiallyOpen = open;
    open = false;
    update(initiallyOpen);
    return { update };
  }

  function run(action) {
    close();
    uiActions.invoke(MENU_ACTION, action);
  }

  function openAnalytics() {
    run("analytics");
  }

  function openCredentials() {
    close();
    uiActions.invoke(CREDENTIALS_OPEN_ACTION);
  }

  function openSettings() {
    run("settings");
  }

  function logOut() {
    run("logout");
  }

  function focusItem(items, index) {
    items.at(index)?.focus();
  }

  function handleKeydown(event) {
    const items = [...event.currentTarget.children];
    const currentIndex = items.indexOf(event.target);
    let nextIndex;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        returnFocusElement?.focus();
        return;
      case "Tab":
        close();
        return;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    focusItem(items, nextIndex);
  }
</script>

<svelte:document onclick={close} />

<div
  id="menu"
  role="menu"
  aria-label="Application menu"
  aria-hidden={!$menuOpen}
  class:open={$menuOpen}
  onclick={(event) => event.stopPropagation()}
  onkeydown={handleKeydown}
>
  <button type="button" role="menuitem" tabindex="-1" data-action="analytics" use:focusWhenOpened={$menuOpen} onclick={openAnalytics}>
    <span class="menu-option-icon" aria-hidden="true"><AppIcon name="analytics" size={17} /></span>
    <span>Usage analytics…</span>
  </button>
  <button type="button" role="menuitem" tabindex="-1" data-action="credentials" onclick={openCredentials}>
    <span class="menu-option-icon" aria-hidden="true"><AppIcon name="key" size={17} /></span>
    <span>Credentials…</span>
  </button>
  <button type="button" role="menuitem" tabindex="-1" data-action="settings" onclick={openSettings}>
    <span class="menu-option-icon" aria-hidden="true"><AppIcon name="settings" size={17} /></span>
    <span>Settings…</span>
  </button>
  <button type="button" role="menuitem" tabindex="-1" class="menu-logout" data-action="logout" onclick={logOut}>
    <span class="menu-option-icon" aria-hidden="true"><AppIcon name="logout" size={17} /></span>
    <span>Log out</span>
  </button>
</div>
