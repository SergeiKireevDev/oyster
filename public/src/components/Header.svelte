<script>
  import AppIcon from "./AppIcon.svelte";
  import oysterIcon from "../assets/oyster.png";
  import { appHeader } from "../stores/appSession.js";
  import { menuOpen } from "../stores/ui.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HEADER_CHOOSE_MODEL_ACTION,
    HEADER_CYCLE_THINKING_ACTION,
    HEADER_OPEN_CONFIG_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

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
  <div class="brand-mark" aria-hidden="true"><img src={oysterIcon} alt="" /></div>
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
    padding: 0 14px;
    border-bottom: 1px solid var(--header-border, color-mix(in srgb, var(--border) 78%, transparent));
    background: var(--header-bg, color-mix(in srgb, var(--panel) 86%, transparent));
    box-shadow: var(--header-shadow, 0 1px 0 color-mix(in srgb, var(--bg) 72%, transparent));
    backdrop-filter: blur(18px) saturate(1.15);
  }

  .brand-mark {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
  }

  .brand-mark img {
    display: block;
    width: 26px;
    height: 26px;
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 32%, transparent));
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
    color: var(--header-status-color, var(--muted));
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
    box-shadow: var(--header-dot-shadow, 0 0 0 3px color-mix(in srgb, var(--border) 58%, transparent));
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
    border: 1px solid var(--header-actions-border, color-mix(in srgb, var(--border) 72%, transparent));
    border-radius: 10px;
    background: var(--header-actions-bg, color-mix(in srgb, var(--panel-2) 34%, transparent));
    box-shadow: var(--header-actions-shadow, inset 0 1px 0 color-mix(in srgb, var(--text) 3%, transparent));
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
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
  }

  .app-header .chip:hover {
    border-color: var(--header-chip-hover-border, color-mix(in srgb, var(--accent) 22%, var(--border)));
    background: var(--header-chip-hover-bg, color-mix(in srgb, var(--accent) 10%, transparent));
    color: var(--header-chip-hover-color, var(--text));
    transform: none;
  }

  .app-header .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .app-header .chip[aria-expanded="true"] {
    border-color: var(--accent);
    background: var(--accent-dim);
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--text);
  }

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

  .header-action-divider {
    width: 1px;
    height: 17px;
    margin: 0 2px;
    background: var(--header-divider-bg, var(--border));
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
      min-height: 48px;
      gap: 7px;
      padding: 0 9px;
    }

    .brand-mark {
      width: 30px;
      height: 30px;
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
      gap: var(--icon-control-gap);
      margin: 3px 0;
      padding: 1px;
    }

    .app-header .chip {
      min-height: var(--icon-control-dense);
      margin: 0;
      gap: 5px;
      padding: 0 7px;
    }

    #modelChip,
    #thinkChip {
      display: none;
    }

    #cfgChip {
      display: inline-flex;
      max-width: 42vw;
    }

    #menuBtn {
      width: var(--icon-control-dense);
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
