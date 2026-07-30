<script>
  import ToolCard from "./ToolCard.svelte";
  import { subscribeStoreGroup } from "../../lib/storeGroup.js";

  let { blocks = [], active = false, unsettled = false, thinkingPreview = (text) => text } = $props();

  const thinkingBlocks = $derived(blocks.filter((block) => block.type === "thinking"));
  const latestThinking = $derived(active ? thinkingBlocks.at(-1) : null);
  const headBlock = $derived(active ? blocks.at(-1) : null);
  const headTool = $derived(headBlock?.type === "toolCall" ? headBlock : null);
  const toolBlocks = $derived(blocks.filter((block) => block.type === "toolCall"));
  let cards = $state([]);

  $effect(() => subscribeStoreGroup(
    toolBlocks.map((block) => block.cardStore),
    (values) => { cards = values; },
  ));

  const pastBlocks = $derived(blocks.filter((block) => (
    block !== latestThinking && block !== headTool
  )));
  const failed = $derived(toolBlocks.filter((block) => {
    if (!pastBlocks.includes(block)) return false;
    return cards[toolBlocks.indexOf(block)]?.status === "error";
  }).length);
  const pastSummary = $derived(pastBlocks
    .map((block) => block.type === "thinking" ? "thinking" : block.toolCall?.name || "tool")
    .slice(-4)
    .join(" · "));
</script>

<div class="activity-stack">
  {#if pastBlocks.length}
    <details class="activity-history">
      <summary>
        <span class="activity-history-chevron" aria-hidden="true">›</span>
        <span>{pastBlocks.length} past {pastBlocks.length === 1 ? "step" : "steps"}</span>
        {#if pastSummary}<span class="activity-history-preview">{pastSummary}</span>{/if}
        {#if failed}<span class="activity-history-failed">{failed} failed</span>{/if}
      </summary>
      <div class="activity-history-body">
        {#each pastBlocks as block, index (`${block.key ?? block.id ?? block.type}:${index}`)}
          {#if block.type === "thinking"}
            <details class="block thinking activity-step">
              <summary title="Show thinking details">
                <span class="activity-indicator" aria-hidden="true"></span>
                <span class="thinking-label">Thinking</span>
                {#if thinkingPreview(block.text)}<span class="thinking-preview">{thinkingPreview(block.text)}</span>{/if}
              </summary>
              <div class="body">{block.text}</div>
            </details>
          {:else}
            <ToolCard cardStore={block.cardStore} />
          {/if}
        {/each}
      </div>
    </details>
  {/if}

  {#if latestThinking}
    <details class="block thinking activity-step current-thinking">
      <summary title="Show thinking details">
        <span class="activity-indicator" class:glowing={unsettled} aria-hidden="true"></span>
        <span class="thinking-label">Thinking</span>
        {#if thinkingPreview(latestThinking.text)}
          <span class="thinking-preview">{thinkingPreview(latestThinking.text)}</span>
        {/if}
      </summary>
      <div class="body">{latestThinking.text}</div>
    </details>
  {/if}

  {#if headTool}
    <ToolCard cardStore={headTool.cardStore} />
  {/if}
</div>
