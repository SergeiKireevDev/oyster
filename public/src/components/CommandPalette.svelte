<script>
  import FolderIcon from "./FolderIcon.svelte";
  import { commandPalette } from "../stores/commandPalette.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { COMMAND_PALETTE_RUN_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function keepComposerFocus(event) {
    event.preventDefault();
  }

  function keepActiveVisible(node, active) {
    return {
      update(nextActive) {
        if (nextActive && !active) node.scrollIntoView({ block: "nearest" });
        active = nextActive;
      },
    };
  }

  function choose(index) {
    uiActions.invoke(COMMAND_PALETTE_RUN_ACTION, index);
  }
</script>

<div
  id="cmdPalette"
  class:open={$commandPalette.open}
  class:path={$commandPalette.mode === "path"}
  class:command={$commandPalette.mode === "command"}
  style:left={$commandPalette.left}
  style:top={$commandPalette.top}
  style:bottom={$commandPalette.bottom}
  style:width={$commandPalette.width}
  style:max-height={$commandPalette.maxHeight}
  role={$commandPalette.emptyText ? "status" : "listbox"}
  aria-label={$commandPalette.emptyText ? undefined : $commandPalette.mode === "path" ? "Path suggestions" : "Command suggestions"}
  aria-live={$commandPalette.emptyText ? "polite" : undefined}
  aria-atomic={$commandPalette.emptyText ? "true" : undefined}
  aria-hidden={!$commandPalette.open}
>
  {#if $commandPalette.emptyText}
    <div class="cmd-empty">{$commandPalette.emptyText}</div>
  {:else}
    {#each $commandPalette.items as cmd, i (cmd.key)}
      <button
        type="button"
        class="cmd-row"
        class:active={cmd.active}
        role="option"
        aria-selected={cmd.active}
        tabindex="-1"
        use:keepActiveVisible={cmd.active}
        onmousedown={keepComposerFocus}
        onclick={() => choose(i)}
      >
        <span class="cmd-ico" aria-hidden="true">{#if cmd.icon === "folder"}<FolderIcon size={15} />{:else}{cmd.icon}{/if}</span>
        <div class="cmd-body">
          <div class="cmd-name">{cmd.prefix ?? ":"}<mark>{cmd.highlight}</mark>{cmd.rest}</div>
          <div class="cmd-desc">{cmd.desc}</div>
        </div>
        <kbd class="cmd-hint" aria-hidden="true">{cmd.active ? "Enter ↵" : ""}</kbd>
      </button>
    {/each}
  {/if}
</div>

<style>
  #cmdPalette {
    position: fixed;
    z-index: 80;
    display: none;
    min-width: min(280px, calc(100vw - 16px));
    max-width: min(420px, calc(100vw - 16px));
    max-height: min(320px, calc(100dvh - 16px));
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--panel-2) 96%, transparent);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(18px);
  }

  #cmdPalette.open {
    display: flex;
  }

  .cmd-row {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 48px;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    user-select: none;
    transition: background .14s ease, color .14s ease, box-shadow .14s ease;
  }

  .cmd-row:last-child {
    border-bottom: 0;
  }

  .cmd-row:hover {
    background: var(--surface-hover);
  }

  .cmd-row.active {
    background: var(--selection-bg);
    box-shadow: inset 2px 0 0 var(--selection-marker);
  }

  .cmd-row:focus-visible {
    z-index: 1;
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  .cmd-ico {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent-dim) 42%, transparent);
    color: var(--accent);
    font-size: 14px;
    font-weight: 680;
  }

  .cmd-body {
    flex: 1;
    min-width: 0;
  }

  .cmd-name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd-name mark {
    padding: 0;
    background: none;
    color: var(--accent);
    font-weight: 750;
  }

  .cmd-desc {
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd-hint {
    flex: none;
    padding: 2px 5px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--panel) 58%, transparent);
    color: var(--muted);
    font: 9.5px/1.3 var(--mono);
    opacity: 0;
    transition: opacity .14s ease;
  }

  .cmd-row.active .cmd-hint {
    opacity: 1;
  }

  .cmd-empty {
    min-width: 0;
    padding: 14px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
    overflow-wrap: anywhere;
    text-align: center;
  }

  #cmdPalette.path {
    max-width: calc(100vw - 16px);
    max-height: none !important;
    align-items: flex-start;
    gap: 6px;
    padding: 6px;
    overflow: visible;
    border: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }

  #cmdPalette.path .cmd-row,
  #cmdPalette.path .cmd-empty {
    flex: 0 1 auto;
    max-width: 100%;
    min-height: 34px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 96%, transparent);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 58%, transparent);
    backdrop-filter: blur(14px);
  }

  #cmdPalette.path .cmd-row:hover {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    background: var(--surface-hover);
  }

  #cmdPalette.path .cmd-row.active {
    border-color: var(--selection-border);
    background: var(--selection-bg);
  }

  #cmdPalette.path .cmd-ico {
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
  }

  #cmdPalette.path .cmd-body {
    flex: 0 1 auto;
  }

  #cmdPalette.path .cmd-desc,
  #cmdPalette.path .cmd-hint {
    display: none;
  }

  @media (max-width: 760px) {
    #cmdPalette {
      max-width: calc(100vw - 12px);
      max-height: min(320px, calc(100dvh - 12px));
    }

    .cmd-row {
      min-height: 44px;
      padding: 8px 10px;
    }

    #cmdPalette.path {
      max-width: calc(100vw - 12px);
      padding: 4px;
    }

    #cmdPalette.path .cmd-row {
      min-height: 40px;
    }
  }
</style>
