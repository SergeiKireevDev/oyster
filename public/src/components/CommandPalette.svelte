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
        <span class="cmd-hint" aria-hidden="true">{cmd.active ? "enter ↵" : ""}</span>
      </button>
    {/each}
  {/if}
</div>
