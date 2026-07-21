<script>
  import { writable } from "svelte/store";
  import PermalinkButton from "./PermalinkButton.svelte";
  import ToolCard from "./ToolCard.svelte";

  let { assistantStore = writable({ blocks: [], errorMessage: "" }), role = "assistant", onPermalink = () => {} } = $props();
  let root = $state();
  const data = $derived($assistantStore);
</script>

<div class="msg assistant" data-role={role} bind:this={root}>
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
</div>
