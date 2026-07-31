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

  /**
   * Prevent the outer dismiss handler from immediately closing the menu.
   * @param {MouseEvent} event
   */
  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }
</script>

<header class="app-header">
  <div class="brand-mark" class:hub-mode={hubMode} aria-hidden="true"><img src={oysterIcon} alt="" /></div>
  <div class="header-context">
    <h1 class="title" id="sessionTitle" title={$appHeader.sessionTitle}>
      {$appHeader.sessionTitle}
    </h1>
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
    >
      <AppIcon name="fork" size={16} />
    </button>
    <button
      class="chip"
      id="cfgChip"
      type="button"
      aria-label={`Configure model and thinking level: ${$appHeader.cfgChip}`}
      title="Model & thinking level"
      onclick={openConfig}
    >
      <AppIcon name="sliders" size={15} />
      <span>{$appHeader.cfgChip}</span>
    </button>
    <button
      class="chip"
      id="modelChip"
      type="button"
      aria-label={`Change model. Current model: ${$appHeader.modelChip}`}
      title="Change model"
      onclick={chooseModel}
    >
      <AppIcon name="model" size={15} />
      <span>{$appHeader.modelChip}</span>
    </button>
    <button
      class="chip"
      id="thinkChip"
      type="button"
      aria-label={`Cycle thinking level. Current level: ${$appHeader.thinkChip}`}
      title="Cycle thinking level"
      onclick={cycleThinking}
    >
      <AppIcon name="thinking" size={15} />
      <span>{$appHeader.thinkChip}</span>
    </button>
    <span class="header-action-divider" aria-hidden="true"></span>
    <button class="chip" id="menuBtn"
      type="button"
      aria-controls="menu"
      aria-expanded={$menuOpen}
      aria-haspopup="menu"
      aria-label={$menuOpen ? "Close menu" : "Open menu"}
      title="More options"
      onclick={toggleMenu}
    >
      <AppIcon name="more" size={17} />
    </button>
  </nav>
</header>

<style>
  .app-header {
    position: relative;
    z-index: 25;
    display: flex;
    min-height: 48px;
    flex-shrink: 0;
    align-items: center;
    gap: 10px;
    padding: 0 14px 4px;
    border-bottom: 1px solid var(--header-border, rgba(255, 255, 255, 0.07));
    background: var(--header-bg, rgba(13, 16, 22, 0.82));
    box-shadow: var(--header-shadow, 0 1px 0 rgba(0, 0, 0, 0.25));
    backdrop-filter: blur(18px) saturate(1.25);
  }

  .brand-mark {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    border: 1px solid var(--header-brand-border, rgba(157, 169, 255, 0.35));
    border-radius: 11px;
    background: var(--header-brand-bg, linear-gradient(145deg, rgba(157, 169, 255, 0.22), rgba(104, 117, 223, 0.07)));
    box-shadow: var(--header-brand-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 8px 24px rgba(83, 93, 180, 0.12));
    color: var(--header-brand-color, #cbd1ff);
  }

  .brand-mark.hub-mode {
    outline: 2px solid rgba(157, 169, 255, 0.9);
    outline-offset: -3px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 0 9px rgba(157, 169, 255, 0.24), 0 0 8px rgba(157, 169, 255, 0.58), 0 0 18px rgba(157, 169, 255, 0.38);
  }

  .brand-mark img {
    display: block;
    width: 26px;
    height: 26px;
    filter: drop-shadow(0 0 6px rgba(157, 169, 255, 0.4));
  }

  .header-context {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    line-height: 1;
  }

  .title {
    min-width: 0;
    max-width: min(36vw, 460px);
    margin: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 680;
    letter-spacing: -0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--header-status-color, #717a8e);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }

  .dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    margin: 0;
    border-radius: 50%;
    background: var(--stopped);
    box-shadow: var(--header-dot-shadow, 0 0 0 3px rgba(255, 255, 255, 0.035));
  }

  .dot.ok {
    background: var(--green);
  }

  .dot.busy {
    background: var(--accent);
    animation: pulse 1s infinite;
  }

  .spacer {
    flex: 1;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--header-actions-border, rgba(255, 255, 255, 0.065));
    border-radius: 11px;
    background: var(--header-actions-bg, rgba(255, 255, 255, 0.025));
    box-shadow: var(--header-actions-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.025));
  }

  .app-header .chip {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 9px;
    border-color: transparent;
    border-radius: 7px;
    background: transparent;
    color: #8e97aa;
    font-size: 10.5px;
    font-weight: 600;
  }

  .app-header .chip:hover {
    border-color: var(--header-chip-hover-border, rgba(157, 169, 255, 0.12));
    background: var(--header-chip-hover-bg, rgba(157, 169, 255, 0.1));
    color: var(--header-chip-hover-color, #dfe2ff);
    transform: none;
  }

  .app-header .chip:focus-visible {
    outline: 2px solid rgba(157, 169, 255, 0.7);
    outline-offset: 1px;
  }

  #treeChip,
  #menuBtn {
    width: 30px;
    padding: 0;
  }

  #cfgChip {
    display: none;
    max-width: 44vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  #modelChip span,
  #thinkChip span,
  #cfgChip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  #modelChip span {
    max-width: 170px;
  }

  #thinkChip {
    color: #a4a0bc;
  }

  .header-action-divider {
    width: 1px;
    height: 17px;
    margin: 0 2px;
    background: var(--header-divider-bg, rgba(255, 255, 255, 0.08));
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot.busy {
      animation: none;
    }
  }

  @media (max-width: 760px) {
    .app-header {
      min-height: 44px;
      gap: 7px;
      padding: 0 9px 3px;
    }

    .brand-mark {
      width: 30px;
      height: 30px;
      border-radius: 8px;
    }

    .brand-mark img {
      width: 24px;
      height: 24px;
    }

    .title {
      max-width: 32vw;
    }

    .dot {
      margin-left: -3px;
    }

    .header-actions {
      gap: 1px;
      padding: 2px;
    }

    #modelChip,
    #thinkChip,
    #treeChip {
      display: none;
    }

    #cfgChip {
      display: inline-flex;
      max-width: 42vw;
    }

    #cfgChip span {
      max-width: 34vw;
    }

    .header-action-divider {
      margin-left: 1px;
    }

    .header-status {
      font-size: 8px;
    }
  }

</style>
