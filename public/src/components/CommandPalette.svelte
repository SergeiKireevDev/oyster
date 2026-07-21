<script>
  import { commandPalette, setCommandPaletteState } from "../stores/commandPalette.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { COMMAND_PALETTE_RUN_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();

  function setActive(index) {
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
  style:left={$commandPalette.left}
  style:top={$commandPalette.top}
  style:bottom={$commandPalette.bottom}
  style:width={$commandPalette.width}
  style:max-height={$commandPalette.maxHeight}
>
  {#if $commandPalette.emptyText}
    <div class="cmd-empty">{$commandPalette.emptyText}</div>
  {:else}
    {#each $commandPalette.items as cmd, i}
      <div
        class="cmd-row"
        class:active={cmd.active}
        role="option"
        tabindex="-1"
        aria-selected={cmd.active}
        onmousedown={(event) => choose(event, i)}
        onmousemove={() => setActive(i)}
      >
        <span class="cmd-ico">{cmd.icon}</span>
        <div class="cmd-body">
          <div class="cmd-name">:<mark>{cmd.highlight}</mark>{cmd.rest}</div>
          <div class="cmd-desc">{cmd.desc}</div>
        </div>
        <span class="cmd-hint">{cmd.active ? "enter ↵" : ""}</span>
      </div>
    {/each}
  {/if}
</div>
