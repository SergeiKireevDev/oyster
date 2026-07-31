<script>
  import FolderIcon from "./FolderIcon.svelte";
  import { commandPalette, setCommandPaletteState } from "../stores/commandPalette.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { COMMAND_PALETTE_RUN_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function setActive(index) {
    if ($commandPalette.items[index]?.active) return;
    setCommandPaletteState({ items: $commandPalette.items.map((item, i) => ({ ...item, active: i === index })) });
  }

  function choose(event, index) {
    event.preventDefault();
    setActive(index);
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
>
  {#if $commandPalette.emptyText}
    <div class="cmd-empty" role="status">{$commandPalette.emptyText}</div>
  {:else}
    {#each $commandPalette.items as cmd, i (cmd.key)}
      <button
        type="button"
        class="cmd-row"
        class:active={cmd.active}
        tabindex="-1"
        onmousedown={(event) => event.preventDefault()}
        onmouseenter={() => setActive(i)}
        onclick={(event) => choose(event, i)}
      >
        <span class="cmd-ico">{#if cmd.icon === "folder"}<FolderIcon size={15} />{:else}{cmd.icon}{/if}</span>
        <div class="cmd-body">
          <div class="cmd-name">{cmd.prefix ?? ":"}<mark>{cmd.highlight}</mark>{cmd.rest}</div>
          <div class="cmd-desc">{cmd.desc}</div>
        </div>
        <span class="cmd-hint">{cmd.active ? "enter ↵" : ""}</span>
      </button>
    {/each}
  {/if}
</div>
