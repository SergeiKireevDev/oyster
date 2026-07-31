<script>
  import AppIcon from "./AppIcon.svelte";
  import oysterIcon from "../assets/oyster.svg";
  import { appHeader } from "../stores/appSession.js";
  import { menuOpen } from "../stores/ui.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { isHubRuntime } from "../runtime/workspaceScope.js";
  import {
    HEADER_CHOOSE_MODEL_ACTION,
    HEADER_CYCLE_THINKING_ACTION,
    HEADER_OPEN_CONFIG_ACTION,
    HEADER_TOGGLE_TREE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const hubMode = isHubRuntime();

  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }
</script>

<header class="app-header">
  <div class="brand-mark" class:hub-mode={hubMode} aria-hidden="true"><img src={oysterIcon} alt="" /></div>
  <div class="header-context">
    <span class="title" id="sessionTitle">{$appHeader.sessionTitle}</span>
    <span class="header-status" role="status" aria-atomic="true"><span class={$appHeader.connectionClass} id="connDot" aria-hidden="true"></span>{$appHeader.connectionLabel}</span>
  </div>
  <span class="spacer"></span>
  <nav class="header-actions" aria-label="Session controls">
    <button class="chip" id="treeChip" aria-label="Checkpoints and forks" title="Checkpoints & forks tree" onclick={(event) => uiActions.invoke(HEADER_TOGGLE_TREE_ACTION, event)}><AppIcon name="fork" size={16} /></button>
    <button class="chip" id="cfgChip" title="Model & thinking level" onclick={() => uiActions.invoke(HEADER_OPEN_CONFIG_ACTION)}><AppIcon name="sliders" size={15} /><span>{$appHeader.cfgChip}</span></button>
    <button class="chip" id="modelChip" title="Change model" onclick={() => uiActions.invoke(HEADER_CHOOSE_MODEL_ACTION)}><AppIcon name="model" size={15} /><span>{$appHeader.modelChip}</span></button>
    <button class="chip" id="thinkChip" title="Cycle thinking level" onclick={() => uiActions.invoke(HEADER_CYCLE_THINKING_ACTION)}><AppIcon name="thinking" size={15} /><span>{$appHeader.thinkChip}</span></button>
    <span class="header-action-divider" aria-hidden="true"></span>
    <button class="chip" id="menuBtn" aria-label="Open menu" title="More options" onclick={toggleMenu}><AppIcon name="more" size={17} /></button>
  </nav>
</header>
