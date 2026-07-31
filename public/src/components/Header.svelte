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

  function toggleTree() {
    uiActions.invoke(HEADER_TOGGLE_TREE_ACTION);
  }

  function openConfig() {
    uiActions.invoke(HEADER_OPEN_CONFIG_ACTION);
  }

  function chooseModel() {
    uiActions.invoke(HEADER_CHOOSE_MODEL_ACTION);
  }

  function cycleThinking() {
    uiActions.invoke(HEADER_CYCLE_THINKING_ACTION);
  }

  /** @param {MouseEvent} event */
  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }
</script>

<header class="app-header">
  <div class="brand-mark" class:hub-mode={hubMode} aria-hidden="true"><img src={oysterIcon} alt="" /></div>
  <div class="header-context">
    <span class="title" id="sessionTitle" title={$appHeader.sessionTitle}>{$appHeader.sessionTitle}</span>
    <span class="header-status" role="status" aria-atomic="true">
      <span class={$appHeader.connectionClass} id="connDot" aria-hidden="true"></span>
      {$appHeader.connectionLabel}
    </span>
  </div>
  <span class="spacer" aria-hidden="true"></span>
  <nav class="header-actions" aria-label="Session controls">
    <button
      class="chip"
      id="treeChip"
      type="button"
      aria-label="Checkpoints and forks"
      title="Checkpoints & forks tree"
      onclick={toggleTree}
    ><AppIcon name="fork" size={16} /></button>
    <button
      class="chip"
      id="cfgChip"
      type="button"
      aria-label={`Configure model and thinking level: ${$appHeader.cfgChip}`}
      title="Model & thinking level"
      onclick={openConfig}
    ><AppIcon name="sliders" size={15} /><span>{$appHeader.cfgChip}</span></button>
    <button
      class="chip"
      id="modelChip"
      type="button"
      aria-label={`Change model. Current model: ${$appHeader.modelChip}`}
      title="Change model"
      onclick={chooseModel}
    ><AppIcon name="model" size={15} /><span>{$appHeader.modelChip}</span></button>
    <button
      class="chip"
      id="thinkChip"
      type="button"
      aria-label={`Cycle thinking level. Current level: ${$appHeader.thinkChip}`}
      title="Cycle thinking level"
      onclick={cycleThinking}
    ><AppIcon name="thinking" size={15} /><span>{$appHeader.thinkChip}</span></button>
    <span class="header-action-divider" aria-hidden="true"></span>
    <button class="chip" id="menuBtn"
      type="button"
      aria-controls="menu"
      aria-expanded={$menuOpen}
      aria-haspopup="menu"
      aria-label={$menuOpen ? "Close menu" : "Open menu"}
      title="More options"
      onclick={toggleMenu}
    ><AppIcon name="more" size={17} /></button>
  </nav>
</header>
