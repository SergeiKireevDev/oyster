<script>
  import { runCommandPaletteIndex, setCommandPaletteActive } from "../lib/legacyBridge.js";
  import { commandPalette } from "../stores/commandPalette.js";

  function choose(event, index) {
    event.preventDefault();
    setCommandPaletteActive(index);
    runCommandPaletteIndex(index);
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
        onmousemove={() => setCommandPaletteActive(i)}
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
