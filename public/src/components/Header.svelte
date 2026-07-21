<script>
  import { appHeader } from "../stores/appSession.js";
  import { menuOpen } from "../stores/ui.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HEADER_CHOOSE_MODEL_ACTION,
    HEADER_CYCLE_THINKING_ACTION,
    HEADER_OPEN_CONFIG_ACTION,
    HEADER_TOGGLE_HUBLOTS_ACTION,
    HEADER_TOGGLE_TREE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }
</script>

<header>
  <span class={$appHeader.connectionClass} id="connDot"></span>
  <span class="title" id="sessionTitle">{$appHeader.sessionTitle}</span>
  <span class="spacer"></span>
  <button class="chip" id="hublotChip" title="Show hublots" onclick={(event) => uiActions.invoke(HEADER_TOGGLE_HUBLOTS_ACTION, event)}>❖</button>
  <button class="chip" id="treeChip" title="Checkpoints & forks tree" onclick={(event) => uiActions.invoke(HEADER_TOGGLE_TREE_ACTION, event)}>⎇</button>
  <button class="chip" id="cfgChip" title="Model & thinking level" onclick={() => uiActions.invoke(HEADER_OPEN_CONFIG_ACTION)}>{$appHeader.cfgChip}</button>
  <button class="chip" id="modelChip" title="Change model" onclick={() => uiActions.invoke(HEADER_CHOOSE_MODEL_ACTION)}>{$appHeader.modelChip}</button>
  <button class="chip" id="thinkChip" title="Cycle thinking level" onclick={() => uiActions.invoke(HEADER_CYCLE_THINKING_ACTION)}>{$appHeader.thinkChip}</button>
  <button class="chip" id="menuBtn" aria-label="Open menu" onclick={toggleMenu}>☰</button>
</header>
