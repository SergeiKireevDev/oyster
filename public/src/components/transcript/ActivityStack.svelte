<script>
  import ToolCard from "./ToolCard.svelte";
  import { subscribeStoreGroup } from "../../lib/storeGroup.js";

  let { blocks = [], active = false, unsettled = false, thinkingPreview = (text) => text } = $props();

  const thinkingBlocks = $derived(blocks.filter((block) => block.type === "thinking"));
  const latestThinking = $derived(active ? thinkingBlocks.at(-1) : null);
  const headBlock = $derived(active ? blocks.at(-1) : null);
  const headTool = $derived(headBlock?.type === "toolCall" ? headBlock : null);
  const pastBlocks = $derived(blocks.filter((block) => (
    block !== latestThinking && block !== headTool
  )));
  const pastCardStores = $derived(pastBlocks
    .filter((block) => block.type === "toolCall")
    .map((block) => block.cardStore));
  let pastCards = $state([]);
  let historyOpen = $state(false);

  $effect(() => subscribeStoreGroup(pastCardStores, updatePastCards));

  function updatePastCards(values) {
    pastCards = values;
  }

  const failedCount = $derived(pastCards.reduce(
    (count, card) => count + (card?.status === "error" ? 1 : 0),
    0,
  ));
  const pastStepLabel = $derived(`${pastBlocks.length} past ${pastBlocks.length === 1 ? "step" : "steps"}`);
  const pastSummary = $derived(pastBlocks
    .slice(-4)
    .map((block) => block.type === "thinking" ? "thinking" : block.toolCall?.name || "tool")
    .join(" · "));
  const latestThinkingPreview = $derived(latestThinking ? thinkingPreview(latestThinking.text) : "");
</script>

<div class="activity-stack">
  {#if pastBlocks.length}
    <details class="activity-history" bind:open={historyOpen}>
      <summary>
        <span class="activity-history-chevron" aria-hidden="true">›</span>
        <span>{pastStepLabel}</span>
        {#if pastSummary}<span class="activity-history-preview">{pastSummary}</span>{/if}
        {#if failedCount}<span class="activity-history-failed">{failedCount} failed</span>{/if}
      </summary>
      <div class="activity-history-body">
        {#each pastBlocks as block (block)}
          {#if block.type === "thinking"}
            {@const preview = thinkingPreview(block.text)}
            <details class="block thinking activity-step">
              <summary title="Show thinking details">
                <span class="activity-indicator" aria-hidden="true"></span>
                <span class="thinking-label">Thinking</span>
                {#if preview}<span class="thinking-preview">{preview}</span>{/if}
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
        {#if latestThinkingPreview}
          <span class="thinking-preview">{latestThinkingPreview}</span>
        {/if}
      </summary>
      <div class="body">{latestThinking.text}</div>
    </details>
  {/if}

  {#if headTool}
    <ToolCard cardStore={headTool.cardStore} />
  {/if}
</div>
