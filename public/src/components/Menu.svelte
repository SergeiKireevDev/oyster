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

<style>
  #menu {
    position: absolute;
    top: 48px;
    right: max(14px, env(safe-area-inset-right));
    z-index: 30;
    display: none;
    width: max-content;
    min-width: 232px;
    max-width: calc(100vw - 28px);
    padding: 6px;
    overflow: hidden;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: 13px;
    background: color-mix(in srgb, var(--panel-2) 97%, transparent);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(18px);
  }

  #menu.open {
    display: flex;
  }

  #menu button {
    display: flex;
    min-width: 0;
    min-height: 42px;
    align-items: center;
    gap: 11px;
    padding: 6px 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: color-mix(in srgb, var(--text) 82%, var(--muted));
    font: inherit;
    font-size: 13px;
    font-weight: 560;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  #menu button:hover,
  #menu button:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }

  #menu button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  #menu button > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-option-icon {
    display: grid;
    width: 29px;
    height: 29px;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 11%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: color-mix(in srgb, var(--accent) 76%, var(--muted));
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  #menu button:hover .menu-option-icon,
  #menu button:focus-visible .menu-option-icon {
    border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
    background: color-mix(in srgb, var(--accent) 13%, transparent);
    color: color-mix(in srgb, var(--accent) 70%, var(--text));
  }

  #menu .menu-logout {
    margin-top: 5px;
    border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 0 0 9px 9px;
  }

  #menu .menu-logout .menu-option-icon {
    color: color-mix(in srgb, var(--red) 55%, var(--muted));
  }

  #menu .menu-logout:hover,
  #menu .menu-logout:focus-visible {
    background: color-mix(in srgb, var(--red) 10%, transparent);
    color: var(--red);
  }

  #menu .menu-logout:hover .menu-option-icon,
  #menu .menu-logout:focus-visible .menu-option-icon {
    border-color: color-mix(in srgb, var(--red) 24%, var(--border));
    background: color-mix(in srgb, var(--red) 10%, transparent);
    color: var(--red);
  }

  @media (max-width: 760px) {
    #menu {
      right: max(9px, env(safe-area-inset-right));
      max-width: calc(100vw - 18px - env(safe-area-inset-right));
    }

    #menu button {
      min-height: 44px;
    }
  }

  @media (max-width: 520px) {
    #menu {
      width: min(232px, calc(100vw - 18px - env(safe-area-inset-right)));
      min-width: 0;
    }
  }
</style>
