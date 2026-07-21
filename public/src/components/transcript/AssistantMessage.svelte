<script>
  import { writable } from "svelte/store";
  import AssistantPartActions from "./AssistantPartActions.svelte";
  import ToolCard from "./ToolCard.svelte";
  import ToolGroup from "./ToolGroup.svelte";
  import { checkpointMarker } from "../../stores/checkpointMarker.js";
  import { checkpointRestores } from "../../stores/checkpointRestores.js";

  let { assistantStore = writable({ blocks: [], copyText: "", errorMessage: "" }), role = "assistant", onPermalink = () => {}, onCopy = () => {}, onCheckpoint = () => {}, onRollback = () => {}, onRoot = () => {} } = $props();
  let root = $state();
  const data = $derived($assistantStore);
  const displayBlocks = $derived(groupConsecutiveTools(data.blocks));
  const restore = $derived($checkpointRestores.find((item) => item.target === root));
  $effect(() => { if (root) onRoot(root); });

  function thinkingPreview(text, maxLength = 110) {
    const compact = String(text ?? "").replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength).trimEnd()}…`;
  }

  function groupConsecutiveTools(blocks = []) {
    const grouped = [];
    for (let index = 0; index < blocks.length;) {
      const block = blocks[index];
      if (block.type !== "toolCall") {
        grouped.push(block);
        index += 1;
        continue;
      }

      const tools = [];
      while (index < blocks.length && blocks[index].type === "toolCall") {
        tools.push(blocks[index]);
        index += 1;
      }
      grouped.push(tools.length === 1 ? tools[0] : {
        type: "toolGroup",
        key: `tool-group:${tools[0].key ?? tools[0].id ?? grouped.length}`,
        blocks: tools,
      });
    }
    return grouped;
  }
</script>

<div class="assistant-entry" data-role={role} bind:this={root}>
  {#each displayBlocks as block, index (`${block.type}:${index}:${block.key ?? ""}`)}
    <div class="msg assistant assistant-part" class:ckpt-frozen={!!restore} data-assistant-part={block.type}>
      {#if block.type === "text"}
        <div class="md">{@html block.html}</div>
      {:else if block.type === "thinking"}
        <details class="block thinking">
          <summary>
            <span class="thinking-label">thinking</span>
            {#if thinkingPreview(block.text)}
              <span class="thinking-preview">{thinkingPreview(block.text)}</span>
            {/if}
          </summary>
          <div class="body">{block.text}</div>
        </details>
      {:else if block.type === "toolCall"}
        <ToolCard cardStore={block.cardStore} />
      {:else if block.type === "toolGroup"}
        <ToolGroup blocks={block.blocks} />
      {/if}
      <AssistantPartActions
        target={root}
        copyText={block.type === "text" ? block.text : ""}
        {onPermalink}
        {onCopy}
        {onCheckpoint}
        {onRollback}
        checkpoint={$checkpointMarker.target === root && index === displayBlocks.length - 1}
        checkpointBusy={$checkpointMarker.busy}
        restore={index === displayBlocks.length - 1 ? restore : null}
      />
    </div>
  {/each}
  {#if data.errorMessage}
    <div class="msg assistant assistant-part error-msg" class:ckpt-frozen={!!restore} data-assistant-part="error">
      {data.errorMessage}
      {#if displayBlocks.length === 0}
        <AssistantPartActions
          target={root}
          {onPermalink}
          {onCheckpoint}
          {onRollback}
          checkpoint={$checkpointMarker.target === root}
          checkpointBusy={$checkpointMarker.busy}
          {restore}
        />
      {/if}
    </div>
  {/if}
</div>
