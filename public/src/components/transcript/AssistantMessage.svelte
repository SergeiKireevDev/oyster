<script>
  import { writable } from "svelte/store";
  import PermalinkButton from "./PermalinkButton.svelte";
  import ToolCard from "./ToolCard.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";
  import { checkpointMarker } from "../../stores/checkpointMarker.js";
  import { checkpointRestores } from "../../stores/checkpointRestores.js";

  let { assistantStore = writable({ blocks: [], errorMessage: "" }), role = "assistant", onPermalink = () => {}, onCheckpoint = () => {}, onRollback = () => {} } = $props();
  let root = $state();
  const data = $derived($assistantStore);
  const restore = $derived($checkpointRestores.find((item) => item.target === root));
</script>

<div class="msg assistant" class:ckpt-frozen={!!restore} data-role={role} bind:this={root}>
  <div>
    {#each data.blocks as block, index (`${block.type}:${index}:${block.key ?? ""}`)}
      {#if block.type === "text"}
        <div class="md">{@html block.html}</div>
      {:else if block.type === "thinking"}
        <details class="block thinking">
          <summary>thinking</summary>
          <div class="body">{block.text}</div>
        </details>
      {:else if block.type === "toolCall"}
        <ToolCard cardStore={block.cardStore} />
      {/if}
    {/each}
    {#if data.errorMessage}
      <div class="msg error-msg">{data.errorMessage}</div>
    {/if}
  </div>
  <PermalinkButton target={root} {onPermalink} />
  {#if $checkpointMarker.target === root}
    <CheckpointButton {onCheckpoint} busy={$checkpointMarker.busy} />
  {/if}
  {#if restore}
    <CheckpointRestoreButton {restore} {onRollback} />
  {/if}
</div>
